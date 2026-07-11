/**
 * One-shot: fetch per-country AI funding / startup / government news from
 * Google News RSS search and upsert into `ai_country_items`.
 *
 * Usage:
 *   npm run ai-countries
 *   # or
 *   npx tsx src/scripts/run-ai-countries.mjs
 */

import { fetchCountryAi } from "../lib/ai-country-fetch.ts";
import { closeDb } from "../lib/mongo.ts";

async function main() {
  const t0 = Date.now();
  const { fetched, upserted, errors } = await fetchCountryAi();
  console.log(`\ncountry-AI: ${fetched} items (${upserted} new) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
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
