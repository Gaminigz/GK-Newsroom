/**
 * MongoDB client — process-global singleton.
 *
 * Reads MONGO_URL from env. Caches a single MongoClient across the
 * lifetime of the Node process so scripts that call getDb() repeatedly
 * don't reopen a connection each time.
 */

import { MongoClient, Db } from "mongodb";

let cached: Promise<MongoClient> | null = null;

function client(): Promise<MongoClient> {
  const url = process.env.MONGO_URL;
  if (!url) {
    throw new Error(
      "MONGO_URL is not set. Copy .env.example to .env and fill it in " +
        "(Atlas connection string).",
    );
  }
  if (!cached) cached = new MongoClient(url).connect();
  return cached;
}

export async function getDb(name = process.env.MONGO_DB || "yaikh"): Promise<Db> {
  const c = await client();
  return c.db(name);
}

export async function closeDb(): Promise<void> {
  if (cached) {
    const c = await cached;
    await c.close();
    cached = null;
  }
}

/** Simple health probe. */
export async function pingDb(): Promise<{ ok: boolean; ms: number }> {
  const t0 = Date.now();
  const db = await getDb();
  await db.command({ ping: 1 });
  return { ok: true, ms: Date.now() - t0 };
}
