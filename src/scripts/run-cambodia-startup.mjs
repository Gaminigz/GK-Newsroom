/**
 * One-shot: watch Cambodia startup/tech ecosystem Telegram channels (Startup
 * Cambodia, Cambodia 4.0, Techo Startup Center) and upsert into `ai_feed_items`
 * so posts show up on /ai. See cambodia-startup-fetch.ts.
 *
 * Usage:
 *   npm run cambodia-startup
 */

import { fetchCambodiaStartup } from "../lib/cambodia-startup-fetch.ts";
import { closeDb } from "../lib/mongo.ts";

async function main() {
  const t0 = Date.now();
  const { channels, posts, free, raw, carried, errors } = await fetchCambodiaStartup();
  console.log(`cambodia-startup: ${posts} Gemini-translated, ${free} free-translated, ${raw} raw, ${carried} already on feed, from ${channels} channels in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
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
