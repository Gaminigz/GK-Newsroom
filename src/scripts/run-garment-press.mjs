/**
 * One-shot: seed/refresh the garment trade-press directory + industry
 * associations directory, and pull real industry news via Google News RSS
 * (topical + site-restricted queries, merged — no Gemini, RSS only).
 *
 * Usage: npm run garment-press
 */

import { fetchGarmentPress, fetchGarmentAssociations } from "../lib/garment-press-fetch.ts";
import { closeDb } from "../lib/mongo.ts";

async function main() {
  const t0 = Date.now();
  const press = await fetchGarmentPress();
  const orgs = await fetchGarmentAssociations();
  console.log(
    `\ngarment-press: ${press.outlets} outlets, ${press.fetched} stories seen (${press.upserted} new)`,
  );
  console.log(
    `garment-associations: ${orgs.orgs} associations, ${orgs.fetched} stories seen (${orgs.upserted} new)`,
  );
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const errors = [...press.errors, ...orgs.errors];
  if (errors.length) {
    console.log(`errors (${errors.length}):`);
    for (const e of errors.slice(0, 15)) console.log("  " + e);
  }
  await closeDb();
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
