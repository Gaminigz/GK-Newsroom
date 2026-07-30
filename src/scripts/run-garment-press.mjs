/**
 * One-shot: seed/refresh the garment trade-press directory and pull each
 * outlet's recent headlines via Google News RSS (no Gemini — RSS only).
 *
 * Usage: npm run garment-press
 */

import { fetchGarmentPress } from "../lib/garment-press-fetch.ts";
import { closeDb } from "../lib/mongo.ts";

async function main() {
  const t0 = Date.now();
  const { outlets, fetched, upserted, errors } = await fetchGarmentPress();
  console.log(`\ngarment-press: ${outlets} outlets, ${fetched} stories seen (${upserted} new) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (errors.length) {
    console.log(`errors (${errors.length}):`);
    for (const e of errors.slice(0, 12)) console.log("  " + e);
  }
  await closeDb();
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
