/**
 * One-shot: harvest AI-adoption signals for garment brands, score them,
 * and (re)generate approach dossiers for the hottest ones.
 *
 * Local sales tool — view the results with `npm run brands-page`.
 *
 * Usage:
 *   npm run brands
 */

import { scoutBrands } from "../lib/brand-scout.ts";
import { closeDb } from "../lib/mongo.ts";

async function main() {
  const t0 = Date.now();
  const { brands, stories, newSignals, dossiers, errors } = await scoutBrands();
  console.log(
    `\nbrand-scout: ${brands} brands, ${stories} stories seen, ${newSignals} new signals, ${dossiers} dossiers updated in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
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
