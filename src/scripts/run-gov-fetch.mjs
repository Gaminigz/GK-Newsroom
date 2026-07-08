/**
 * One-shot: pull the Cambodian government sources (GDT, ACAR, MEF, MoC,
 * GDCE, NA, MoI), translate Khmer → English with Gemini, and upsert into
 * MongoDB `gov_feed_items` for the GK SMART Accounting channel.
 *
 * Usage:
 *   npm run gov
 */

import { fetchGovFeed } from "../lib/gov-fetch.ts";
import { closeDb } from "../lib/mongo.ts";

async function main() {
  const t0 = Date.now();
  const { counts, errors } = await fetchGovFeed();
  console.log(`gov fetch done in ${(Date.now() - t0) / 1000}s`);
  console.log("posts per agency:", JSON.stringify(counts));
  if (errors.length) {
    console.log(`errors (${errors.length}):`);
    for (const e of errors) console.log("  " + e);
  }
  await closeDb();
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
