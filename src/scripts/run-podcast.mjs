/**
 * One-shot: generate today's "The Yai Ai Brief" podcast episode and
 * upsert into MongoDB.
 *
 * Idempotent — if today's episode is already stored, exits without
 * calling Gemini or TTS. Pass --force to regenerate.
 *
 * Usage:
 *   npm run podcast
 *   npm run podcast -- --force
 */

import { ensureEpisode, todayKey } from "../lib/podcast.ts";
import { closeDb, getDb } from "../lib/mongo.ts";

async function main() {
  const key = todayKey();
  const force = process.argv.includes("--force");

  if (force) {
    const db = await getDb();
    await db.collection("ai_feed_podcast").deleteOne({ _id: key });
    console.log(`--force: deleted existing episode ${key}`);
  }

  console.log(`ensuring episode for ${key}...`);
  const meta = await ensureEpisode(key);
  console.log("done:", JSON.stringify(meta, null, 2));
  await closeDb();
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
