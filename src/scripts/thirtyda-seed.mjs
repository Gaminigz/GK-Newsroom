/**
 * 30+DA demo seed — `npm run 30da:seed`.
 *
 * Refuses to run unless MONGO_DB ends with "_dev" (or --force-demo is given).
 * Wipes the app's thirtyda_* collections in that database (the admin's
 * sessions and audit log are kept; the admin's question choices go back to the
 * built-in ones), then inserts 21 demo people around BKK1
 * plus the A2 design's sample pairs, chats and flags, and pairs in every
 * conversation state (Level 1 and 2 both ways, partial replies, the waits,
 * Level 3 with its history, an older one-way pair), and prints the dev
 * login phones. Demo people have no photos (the app shows a silhouette). In a *_dev database every demo
 * person gets the dev PIN 2580 (the app's lock screen asks for it).
 *
 * Usage:
 *   set -a && . ./.env && set +a
 *   MONGO_DB=gk_newsroom_30da_dev npm run 30da:seed
 */

import { getDb, closeDb } from "../lib/mongo.ts";
import { ensureThirtyDaIndexes } from "../lib/thirtyda-app.mjs";
import { deletePhoto } from "../lib/thirtyda-photos.mjs";
import { hashPin } from "../lib/thirtyda-pin.mjs";
import { buildDemo, DEMO_NOTES } from "../data/thirtyda-sample.mjs";

// Every demo person's PIN (the app asks for it each time it opens). Only ever set in a *_dev database: a
// --force-demo seed elsewhere leaves the demo people without a PIN (they set their own on first sign-in).
const DEV_PIN = "2580";

const APP_COLLECTIONS = [
  "thirtyda_users", "thirtyda_user_sessions", "thirtyda_otps", "thirtyda_pairs",
  "thirtyda_sets", "thirtyda_chats", "thirtyda_flags", "thirtyda_counters",
  "thirtyda_photos.files", "thirtyda_photos.chunks", // GridFS photo store
  "thirtyda_questions", // admin-set question choices: the demo starts on the built-in ones
  "thirtyda_settings", // admin Connections (sealed tokens): the demo starts with none, so codes are test codes
];

const dbName = process.env.MONGO_DB || "";
if (!dbName) {
  console.error("MONGO_DB is not set. Run with MONGO_DB=gk_newsroom_30da_dev.");
  process.exit(1);
}
if (!dbName.endsWith("_dev") && !process.argv.includes("--force-demo")) {
  console.error(`Refusing to seed "${dbName}": demo people only go into a *_dev database (or pass --force-demo).`);
  process.exit(1);
}

try {
  const d = await getDb(dbName);

  // Local-store photos live on disk; remove the ones the wipe orphans.
  const old = await d.collection("thirtyda_users").find({}, { projection: { photos: 1 } }).toArray();
  await Promise.all(old.flatMap((u) => u.photos || []).map(deletePhoto));
  for (const name of APP_COLLECTIONS) await d.collection(name).deleteMany({});

  const demo = buildDemo();
  const devPin = dbName.endsWith("_dev");
  if (devPin) {
    const pinHash = await hashPin(DEV_PIN);
    for (const u of demo.users) Object.assign(u, { pinHash, pinAt: new Date(), pinTries: 0 });
  }
  await d.collection("thirtyda_users").insertMany(demo.users);
  await d.collection("thirtyda_pairs").insertMany(demo.pairs);
  await d.collection("thirtyda_sets").insertMany(demo.sets);
  await d.collection("thirtyda_chats").insertMany(demo.chats);
  await d.collection("thirtyda_flags").insertMany(demo.flags);
  await d.collection("thirtyda_counters").insertMany(demo.counters);
  await ensureThirtyDaIndexes(d);

  console.log(`Seeded ${dbName}: ${demo.users.length} people, ${demo.pairs.length} conversations, ${demo.sets.length} sets of 5 lines, ${demo.flags.length} open flags.`);
  console.log("\nDev logins (THIRTYDA_DEV_AUTH=1: send-code returns the code):");
  if (devPin) console.log(`  (every demo person's PIN: ${DEV_PIN})`);
  for (const u of demo.users) {
    const note = DEMO_NOTES[u._id] ? ` · ${DEMO_NOTES[u._id]}` : "";
    console.log(`  ${u.phone}  ${u._id}  ${u.name.padEnd(10)} ${u.lang}  ${u.area}${note}`);
  }
} catch (err) {
  console.error("Seed failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closeDb();
}
