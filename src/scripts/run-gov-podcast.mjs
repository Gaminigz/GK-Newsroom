/**
 * One-shot: generate today's "GK SMART Brief" episode (Cambodian
 * government announcements, ~2 min) into MongoDB `gov_podcast`.
 * Idempotent — pass --force to regenerate today's.
 *
 * Usage:
 *   npm run govcast
 *   npm run govcast -- --force
 */

import { ensureGovEpisode } from "../lib/gov-podcast.ts";
import { closeDb } from "../lib/mongo.ts";

async function main() {
  const force = process.argv.includes("--force");
  const meta = await ensureGovEpisode(undefined, force);
  console.log(JSON.stringify(meta, null, 2));
  if (meta.status !== "ready") process.exitCode = 1;
  await closeDb();
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
