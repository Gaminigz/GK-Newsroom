#!/usr/bin/env node
/**
 * Pre-generate Gemini ingredient recipes for the 150 Sri Lankan dishes.
 *
 * Two run modes:
 *
 *   Daily incremental (safe for Gemini free tier, ~250 req/day):
 *     tsx src/scripts/seed-lanka-recipes.mjs --daily=30
 *   → seeds the catalogue, then generates recipes for up to 30 dishes
 *     that are NOT yet cached, skipping ones that already have recipes.
 *     Set as a Railway cron job (see package.json script daily:lanka).
 *
 *   One-shot backfill (uses ~150 req in one go — only run when quota is fine):
 *     tsx src/scripts/seed-lanka-recipes.mjs
 *
 * Both write each recipe to Mongo `app_dish_recipes` (the same cache the
 * app's /ai-recipe endpoint reads from). After a dish is cached, the app
 * returns its recipe instantly with zero AI calls at request time.
 *
 * Flags:
 *   --daily=N    process at most N NEW (uncached) dishes, then stop.
 *                Used by the daily cron so we don't blow the free tier.
 *   --force      re-generate even if already cached (default: skip existing)
 *   --dry-run    print what would run, don't call Gemini or write Mongo
 *   --only=N     process only the first N dishes in catalogue order (testing)
 */

import { MongoClient } from "mongodb";
import { LANKA_DISHES_150, LANKA_DISHES_FLAT_ENTRIES, LANKA_DISHES_FLAT } from "../data/lanka-dishes-150.mjs";
import { LANKA_SPICES, LANKA_SPICES_FLAT_ENTRIES } from "../data/lanka-spices.mjs";
import { LANKA_BAKERY, LANKA_BAKERY_FLAT_ENTRIES } from "../data/lanka-bakery.mjs";
import { generateRecipe } from "../lib/ai-dish.mjs";

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const only = rawArgs.find((a) => a.startsWith("--only="));
const daily = rawArgs.find((a) => a.startsWith("--daily="));
const onlyN = only ? Number(only.split("=")[1]) : null;
const dailyN = daily ? Number(daily.split("=")[1]) : null;
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

  // Step 1a: seed the dish catalogue (Mongo `lanka_dishes`, the list the
  // app reads for the picker). Idempotent — upserts by lowercased name,
  // preserves any manual edits, carries English + Sinhala names.
  console.log("Seeding lanka_dishes catalogue…");
  let dishOrder = 0;
  const dishOps = LANKA_DISHES_FLAT_ENTRIES.map((d) => {
    dishOrder++;
    return {
      updateOne: {
        filter: { _id: d.name.toLowerCase() },
        update: {
          $setOnInsert: { _id: d.name.toLowerCase(), addedAt: new Date() },
          $set: { name: d.name, nameSi: d.si, category: d.category, order: dishOrder },
        },
        upsert: true,
      },
    };
  });
  if (!dry && dishOps.length) {
    const r = await catalogue.bulkWrite(dishOps, { ordered: false });
    console.log(`  lanka_dishes: upserted=${r.upsertedCount} matched=${r.matchedCount} modified=${r.modifiedCount}`);
  } else if (dry) {
    console.log(`  (dry) would upsert ${dishOps.length} dish entries`);
  }

  // Helper: upsert-by-lowercased-name into a topic catalogue (spices, bakery).
  // Newsroom pipeline reads from these to generate feed posts.
  async function seedCatalogue(collectionName, entries, label) {
    const col = db.collection(collectionName);
    let order = 0;
    const ops = entries.map((e) => {
      order++;
      return {
        updateOne: {
          filter: { _id: e.name.toLowerCase() },
          update: {
            $setOnInsert: { _id: e.name.toLowerCase(), addedAt: new Date() },
            $set: { name: e.name, nameSi: e.si, category: e.category, order },
          },
          upsert: true,
        },
      };
    });
    if (!dry && ops.length) {
      const r = await col.bulkWrite(ops, { ordered: false });
      console.log(`  ${collectionName}: upserted=${r.upsertedCount} matched=${r.matchedCount} modified=${r.modifiedCount}`);
    } else if (dry) {
      console.log(`  (dry) would upsert ${ops.length} ${label} entries`);
    }
  }

  console.log("Seeding lanka_spices catalogue…");
  await seedCatalogue("lanka_spices", LANKA_SPICES_FLAT_ENTRIES, "spice");

  console.log("Seeding lanka_bakery catalogue…");
  await seedCatalogue("lanka_bakery", LANKA_BAKERY_FLAT_ENTRIES, "bakery");

  // Step 2: pre-generate per-serving recipes via Gemini.
  // In --daily=N mode we STOP after generating N new (uncached) recipes,
  // regardless of how deep in the list we've walked. This keeps the
  // day's Gemini spend well under the free tier's request cap.
  const dishes = onlyN ? LANKA_DISHES_FLAT.slice(0, onlyN) : LANKA_DISHES_FLAT;
  const modeTag = dailyN ? ` (daily quota ${dailyN})` : force ? " (force)" : "";
  console.log(`\nProcessing ${dishes.length} dish recipes${modeTag}${dry ? " (DRY RUN)" : ""}`);

  let generated = 0, skipped = 0, failed = 0;
  for (let i = 0; i < dishes.length; i++) {
    if (dailyN && generated >= dailyN) {
      console.log(`\n  ↳ daily quota (${dailyN}) reached — stopping for today.`);
      break;
    }
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
    // Small delay so we don't hit Gemini's per-minute rate limit
    // (free tier is 10 RPM — 250ms spacing = 4 RPS max = well under).
    await new Promise((res) => setTimeout(res, 250));
  }

  console.log(`\nDone. generated=${generated} skipped=${skipped} failed=${failed}`);
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
