/**
 * One-shot: watch public Cambodian gov/finance Telegram channels via their
 * t.me/s web pages, translate Khmer → English, and upsert into `gov_feed_items`
 * for the GK SMART Accounting feed. Self-growing watch-list (see telegram-fetch).
 *
 * Usage:
 *   npm run telegram
 */

import { fetchTelegram } from "../lib/telegram-fetch.ts";
import { closeDb } from "../lib/mongo.ts";

async function main() {
  const t0 = Date.now();
  const { channels, posts, carried, discovered, errors } = await fetchTelegram();
  console.log(`telegram: ${posts} new posts translated, ${carried} already on feed, from ${channels} channels (+${discovered} newly discovered) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
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
