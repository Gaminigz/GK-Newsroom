#!/usr/bin/env node
/**
 * Pre-generate Gemini ingredient recipes for all 150 Sri Lankan dishes.
 *
 * Writes each recipe to Mongo `app_dish_recipes` (the same cache the
 * app's /ai-recipe endpoint reads from). After running once, the app's
 * Plan Menu picker for any of the 150 dishes returns instantly with
 * zero AI calls at request time.
 *
 * Usage (locally, with env vars loaded from Railway CLI or dotenv):
 *   MONGO_URL=... MONGO_DB=... GEMINI_API_KEY=... \
 *     tsx src/scripts/seed-lanka-recipes.mjs
 *
 * Or on Railway (one-off command):
 *   railway run tsx src/scripts/seed-lanka-recipes.mjs
 *
 * Flags:
 *   --force      re-generate even if already cached (default: skip existing)
 *   --dry-run    print what would run, don't call Gemini or write Mongo
 *   --only=N     process only the first N dishes (for testing)
 */

import { MongoClient } from "mongodb";
import { LANKA_DISHES_150, LANKA_DISHES_FLAT } from "../data/lanka-dishes-150.mjs";
import { generateRecipe } from "../lib/ai-dish.mjs";

const args = new Set(process.argv.slice(2));
const only = process.argv.slice(2).find((a) => a.startsWith("--only="));
const onlyN = only ? Number(only.split("=")[1]) : null;
const force = args.has("--force");
const dry = args.has("--dry-run");

async function main() {
  if (!process.env.MONGO_URL) throw new Error("MONGO_URL not set");
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");

  const client = new MongoClient(process.env.MONGO_URL);
  await client.connect();
  const db = client.db(process.env.MONGO_DB || "gk_newsroom");
  const col = db.collection("app_dish_recipes");
  const catalogue = db.collection("lanka_dishes");

  // Step 1: seed the dish catalogue (the list the app reads for the picker).
  // Idempotent — upserts by lowercased name, preserves any manual edits.
  console.log("Seeding lanka_dishes catalogue…");
  let catalogueOrder = 0;
  const catalogueOps = [];
  for (const [category, list] of Object.entries(LANKA_DISHES_150)) {
    for (const name of list) {
      catalogueOrder++;
      catalogueOps.push({
        updateOne: {
          filter: { _id: name.toLowerCase() },
          update: {
            $setOnInsert: { _id: name.toLowerCase(), addedAt: new Date() },
            $set: { name, category, order: catalogueOrder },
          },
          upsert: true,
        },
      });
    }
  }
  if (!dry && catalogueOps.length) {
    const r = await catalogue.bulkWrite(catalogueOps, { ordered: false });
    console.log(`  catalogue: upserted=${r.upsertedCount} matched=${r.matchedCount} modified=${r.modifiedCount}`);
  } else if (dry) {
    console.log(`  (dry) would upsert ${catalogueOps.length} catalogue entries`);
  }

  // Step 2: pre-generate per-serving recipes via Gemini for each dish.
  const dishes = onlyN ? LANKA_DISHES_FLAT.slice(0, onlyN) : LANKA_DISHES_FLAT;
  console.log(`\nSeeding ${dishes.length} dish recipes${force ? " (force)" : ""}${dry ? " (DRY RUN)" : ""}`);

  let generated = 0, skipped = 0, failed = 0;
  for (let i = 0; i < dishes.length; i++) {
    const dish = dishes[i];
    const key = dish.toLowerCase();
    if (!force) {
      const existing = await col.findOne({ _id: key });
      if (existing && existing.recipe) { skipped++; continue; }
    }
    if (dry) { console.log(`  [${i + 1}/${dishes.length}] would generate: ${dish}`); generated++; continue; }
    process.stdout.write(`  [${i + 1}/${dishes.length}] ${dish} … `);
    const r = await generateRecipe(dish, col);
    if (r.ok) { console.log(r.cached ? "cached" : "✓"); generated++; }
    else { console.log(`✗ ${r.error}`); failed++; }
    // Small delay so we don't rate-limit Gemini.
    await new Promise((res) => setTimeout(res, 250));
  }

  console.log(`\nDone. generated=${generated} skipped=${skipped} failed=${failed}`);
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
