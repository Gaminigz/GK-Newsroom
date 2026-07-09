/**
 * One-shot: generate the 3una5aha mini-episodes (one per spice) into
 * MongoDB `spice_podcast`. Idempotent — ready episodes are skipped, so
 * re-running only fills gaps (and new spices added to spices.ts).
 *
 * Cost ≈ $0.35 per newly generated episode (one-time, stored forever).
 *
 * Usage:
 *   npm run spicecast              # generate all missing
 *   npm run spicecast -- --only cinnamon
 *   npm run spicecast -- --force cinnamon   # regenerate one
 */

import { SPICES } from "../data/spices.ts";
import { ensureSpiceEpisode } from "../lib/spice-podcast.ts";
import { closeDb } from "../lib/mongo.ts";

async function main() {
  const only = (() => {
    const i = process.argv.findIndex((a) => a === "--only" || a === "--force");
    return i > -1 ? process.argv[i + 1] : null;
  })();
  const force = process.argv.includes("--force");

  const targets = only ? SPICES.filter((s) => s.id === only) : SPICES;
  if (targets.length === 0) throw new Error(`no spice with id "${only}"`);

  let ready = 0, failed = 0;
  for (const spice of targets) {
    const meta = await ensureSpiceEpisode(spice, force);
    if (meta.status === "ready") {
      ready++;
      console.log(`✓ ${spice.id} (${meta.durationSec}s)`);
    } else {
      failed++;
      console.log(`✗ ${spice.id}: ${meta.error}`);
    }
  }
  console.log(`done — ${ready} ready, ${failed} failed of ${targets.length}`);
  await closeDb();
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
