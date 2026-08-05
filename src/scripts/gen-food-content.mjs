#!/usr/bin/env node
/**
 * Batch-generate full post content (English + Sinhala description +
 * ingredients for dishes) for every catalogue item not yet present in
 * src/data/spices.ts, using Gemini text generation (cheap/near-free).
 *
 * Reads the three catalogues (dishes / spices / bakery), skips any item
 * whose name already exists in SPICES, and for each remaining item asks
 * Gemini for structured JSON, then appends a new Spice entry to
 * spices.ts (idempotent — re-running only fills gaps).
 *
 * After this, run:
 *   npm run genimages     # photos (Wikimedia free → Gemini paid fallback)
 *   npm run spicecast     # audio (shortened Dara & Maly script)
 *
 * Flags:
 *   --limit=N     process at most N new items this run (default: all)
 *   --dry-run     print what would be generated, write nothing
 *
 * Usage:
 *   npm run genfood
 *   npm run genfood -- --limit=30
 */

import { GoogleGenAI, Type } from "@google/genai";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SPICES } from "../data/spices.ts";
import { LANKA_DISHES_FLAT_ENTRIES } from "../data/lanka-dishes-150.mjs";
import { LANKA_SPICES_FLAT_ENTRIES } from "../data/lanka-spices.mjs";
import { LANKA_BAKERY_FLAT_ENTRIES } from "../data/lanka-bakery.mjs";

const rawArgs = process.argv.slice(2);
const limitArg = rawArgs.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : Infinity;
const DRY = rawArgs.includes("--dry-run");
const MODEL = "gemini-flash-latest";
const SPICES_FILE = path.resolve("src/data/spices.ts");

// Categories that are raw spices/aromatics (no ingredients table) vs
// prepared dishes/sweets (need a 5-person ingredients list).
const RAW_CATEGORIES = new Set([
  "Fresh Spices & Aromatics",
  "Dried Whole Spices",
  "Powdered Spices & Blends",
  "Pre-Processed & Specialty Spice Pastes / Items",
]);

function slugify(name) {
  return name.toLowerCase()
    .replace(/[()]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

const CONTENT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    post: { type: Type.STRING, description: "40-60 word English description: what it is, how it's used in Sri Lankan cooking, one concrete detail. No markdown." },
    postSi: { type: Type.STRING, description: "The same description in natural Sinhala, 1-2 sentences." },
    imgQuery: { type: Type.STRING, description: "A short Wikimedia Commons image search term, e.g. 'Sri Lankan fish curry bowl'." },
    ingredients: {
      type: Type.ARRAY,
      description: "For prepared dishes/sweets only: 5-8 ingredients for a 5-person portion. Empty array for raw spices.",
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: "Ingredient name in English" },
          nameSi: { type: Type.STRING, description: "Ingredient name in Sinhala" },
          qty5: { type: Type.STRING, description: "Quantity for 5 persons, e.g. '400 g', '2 tbsp'" },
        },
        required: ["name", "nameSi", "qty5"],
      },
    },
  },
  required: ["post", "postSi", "imgQuery"],
};

function systemPrompt(isRaw) {
  return `You are a Sri Lankan food and spice expert writing short encyclopedia-style posts for a bilingual (English + Sinhala) food catalogue. Be accurate and concrete; use only common culinary knowledge, never invent history or statistics. ${
    isRaw
      ? "This item is a raw spice/aromatic/ingredient — return an EMPTY ingredients array."
      : "This item is a prepared dish/sweet/snack — return a realistic 5-8 ingredient list scaled for 5 persons."
  }`;
}

async function generateOne(ai, entry) {
  const isRaw = RAW_CATEGORIES.has(entry.category);
  const r = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: `Item: ${entry.name} (Sinhala: ${entry.si}, category: ${entry.category})` }] }],
    config: {
      systemInstruction: systemPrompt(isRaw),
      responseMimeType: "application/json",
      responseSchema: CONTENT_SCHEMA,
      temperature: 0.7,
    },
  });
  const text = r.text || "";
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("non-JSON from Gemini"); }
  if (!data.post || !data.postSi) throw new Error("missing post/postSi");
  return { ...data, isRaw };
}

/** Render one Spice entry as TypeScript source. */
function renderEntry(id, entry, gen) {
  const esc = (s) => String(s).replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
  const ingLines = (gen.ingredients || []).map(
    (i) => `      { name: ${JSON.stringify(i.name)}, nameSi: ${JSON.stringify(i.nameSi)}, qty5: ${JSON.stringify(i.qty5)} },`
  ).join("\n");
  const ingBlock = !gen.isRaw && gen.ingredients?.length
    ? `\n    ingredients: [\n${ingLines}\n    ],`
    : "";
  return `  {
    id: ${JSON.stringify(id)},
    imgQuery: ${JSON.stringify(gen.imgQuery)},
    name: ${JSON.stringify(entry.name)},
    sinhala: ${JSON.stringify(entry.si)},
    category: ${JSON.stringify(entry.category)},
    emoji: "🍽️",
    post: \`${esc(gen.post)}\`,
    postSi: \`${esc(gen.postSi)}\`,${ingBlock}
  },`;
}

async function main() {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // All catalogue entries, deduped by lowercased name (some names repeat
  // across categories — keep first occurrence for a stable slug).
  const all = [...LANKA_SPICES_FLAT_ENTRIES, ...LANKA_DISHES_FLAT_ENTRIES, ...LANKA_BAKERY_FLAT_ENTRIES];
  const seenName = new Set();
  const catalogue = [];
  for (const e of all) {
    const k = e.name.toLowerCase();
    if (seenName.has(k)) continue;
    seenName.add(k);
    catalogue.push(e);
  }

  const existingNames = new Set(SPICES.map((s) => s.name.toLowerCase()));
  const existingIds = new Set(SPICES.map((s) => s.id));
  const todo = catalogue.filter((e) => !existingNames.has(e.name.toLowerCase()));
  console.log(`Catalogue: ${catalogue.length} unique · already in spices.ts: ${SPICES.length} · to generate: ${todo.length}`);

  const batch = todo.slice(0, LIMIT);
  console.log(`This run: ${batch.length}${DRY ? " (DRY)" : ""}\n`);

  const newEntries = [];
  let ok = 0, fail = 0;
  for (let i = 0; i < batch.length; i++) {
    const e = batch[i];
    let id = slugify(e.name);
    while (existingIds.has(id) || newEntries.some((n) => n.id === id)) id = `${id}-x`;
    process.stdout.write(`  [${i + 1}/${batch.length}] ${e.name} … `);
    if (DRY) { console.log("(dry)"); ok++; continue; }
    try {
      const gen = await generateOne(ai, e);
      newEntries.push({ id, src: renderEntry(id, e, gen) });
      console.log(gen.isRaw ? "✓ (spice)" : `✓ (${gen.ingredients?.length || 0} ingr)`);
      ok++;
    } catch (err) {
      console.log(`✗ ${err.message}`);
      fail++;
      if (String(err.message).includes("RESOURCE_EXHAUSTED") || String(err.message).includes("429")) {
        console.log("  ↳ quota hit — stopping, will resume next run.");
        break;
      }
    }
    await new Promise((res) => setTimeout(res, 300));
  }

  if (!DRY && newEntries.length) {
    // Insert before the final closing "];" of the SPICES array.
    let file = readFileSync(SPICES_FILE, "utf8");
    const marker = file.lastIndexOf("];");
    if (marker === -1) throw new Error("could not find end of SPICES array");
    const block = "\n" + newEntries.map((n) => n.src).join("\n") + "\n";
    file = file.slice(0, marker) + block + file.slice(marker);
    writeFileSync(SPICES_FILE, file);
    console.log(`\nWrote ${newEntries.length} entries to spices.ts.`);
  }
  console.log(`Done — ${ok} ok, ${fail} failed. ${todo.length - ok} remaining after this run.`);
}

main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
