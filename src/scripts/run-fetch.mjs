/**
 * One-shot fetch → rewrite → archive.
 *
 * Runs the full daily-news pipeline once and exits:
 *   1. Pull the 7 curated RSS feeds (Western + Chinese).
 *   2. Extract images (og:image scrape → fallback tile).
 *   3. Gemini rewrite + classify (Chinese → English translation happens
 *      in the same call).
 *   4. Upsert into MongoDB `ai_feed_items` keyed by URL, so re-running
 *      never duplicates a story.
 *
 * Usage:
 *   npm run fetch
 *   # or
 *   npx tsx src/scripts/run-fetch.mjs
 */

import { fetchAiFeed } from "../lib/feed-fetch.ts";
import { closeDb } from "../lib/mongo.ts";

async function main() {
  const t0 = Date.now();
  const { items, errors } = await fetchAiFeed({
    perSourceLimit: 5,
    totalLimit: 40,
  });
  console.log(`\nfetched ${items.length} items in ${(Date.now() - t0) / 1000}s`);
  if (errors.length) {
    console.log(`errors (${errors.length}):`);
    for (const e of errors) console.log("  " + e);
  }
  console.log("\ntop 6 headlines:");
  for (const it of items.slice(0, 6)) {
    console.log(`  [${it.source}] ${it.title}`);
  }
  await closeDb();
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
