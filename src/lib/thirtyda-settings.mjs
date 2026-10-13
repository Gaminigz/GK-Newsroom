/**
 * 30+DA settings the super admin enters on the web (Connections page) — secrets such as the Telegram
 * Gateway API token.
 *
 * Mongo `thirtyda_settings`, one doc per setting:
 *   { _id:'telegram', kind:'secret', box:{ v:1, alg:'aes-256-gcm', iv, tag, data }, last4,
 *     updatedAt, updatedBy, lastSend?:{ ok, reason, detail, at } }
 * The value is sealed with AES-256-GCM under THIRTYDA_SECRET_KEY (64 hex characters = 32 bytes, server env only):
 * a fresh random 12-byte IV on every save, the 16-byte auth tag stored beside it, and the setting's name as
 * associated data, so a sealed value cannot be moved to another setting or changed without failing to open.
 * Without a valid key nothing is saved (SettingsError 'no_key'); a value sealed under another key reads as
 * "not readable" (and so not set) until it is saved again.
 *
 * The secret never leaves the server: views carry only { set, last4, updatedAt, updatedBy } (+ readable,
 * lastSend). Reads decrypt once and keep the value in memory for CACHE_MS; a save or a removal clears it at
 * once (the admin and the app run in one process), and the short TTL bounds how stale another instance is.
 *
 * Pure apart from the `d` (Mongo Db) handed in, so the unit tests run without a database.
 */

import crypto from "node:crypto";

export const SETTINGS_COLLECTION = "thirtyda_settings";
export const SECRET_NAMES = ["telegram"];
const CACHE_MS = 30e3;
const ALG = "aes-256-gcm";
const KEY_RE = /^[0-9a-fA-F]{64}$/;

export class SettingsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SettingsError";
    this.code = code;
  }
}

const NO_KEY = "THIRTYDA_SECRET_KEY is missing or is not 64 hex characters (32 bytes), so secrets cannot be saved. Set it on the server, then save again.";

/** THIRTYDA_SECRET_KEY → 32-byte Buffer. Throws SettingsError 'no_key' when missing or malformed. */
export function settingsKey(raw = process.env.THIRTYDA_SECRET_KEY) {
  const hex = String(raw ?? "").trim();
  if (!KEY_RE.test(hex)) throw new SettingsError("no_key", NO_KEY);
  return Buffer.from(hex, "hex");
}

/** true when THIRTYDA_SECRET_KEY (or `raw`) is a usable key. */
export function keyReady(raw = process.env.THIRTYDA_SECRET_KEY) {
  try {
    settingsKey(raw);
    return true;
  } catch {
    return false;
  }
}

function checkName(name) {
  if (!SECRET_NAMES.includes(name)) throw new SettingsError("unknown", `No such setting: ${String(name).slice(0, 40)}.`);
  return name;
}

const aad = (name) => Buffer.from(`${SETTINGS_COLLECTION}:${name}`, "utf8");

/** Seal `plain` for setting `name` → { v, alg, iv, tag, data } (base64). A new random IV every call. */
export function sealSecret(plain, key, name) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  cipher.setAAD(aad(name));
  const data = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return { v: 1, alg: ALG, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}

/** Open a sealed box → the plain string. Throws when the key, the name, the tag or the data do not match. */
export function openSecret(box, key, name) {
  if (!box || box.v !== 1 || box.alg !== ALG) throw new SettingsError("unreadable", "This value was not sealed in a known format.");
  const iv = Buffer.from(String(box.iv), "base64");
  const tag = Buffer.from(String(box.tag), "base64");
  if (iv.length !== 12 || tag.length !== 16) throw new SettingsError("unreadable", "This value is damaged.");
  const decipher = crypto.createDecipheriv(ALG, key, iv, { authTagLength: 16 });
  decipher.setAAD(aad(name));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(String(box.data), "base64")), decipher.final()]).toString("utf8");
}

/** The last 4 characters, the only part of a secret ever shown again. */
export const lastFour = (plain) => String(plain ?? "").slice(-4);

const iso = (t) => (t ? new Date(t).toISOString() : null);

/** What a client may see of a stored setting: never the box, never the value. */
export function secretView(doc) {
  const set = Boolean(doc?.box);
  return {
    set,
    last4: set ? doc.last4 ?? null : null,
    updatedAt: set ? iso(doc.updatedAt) : null,
    updatedBy: set ? doc.updatedBy ?? null : null,
  };
}

// ---------- cache ----------
const cache = new Map(); // name → { at, value: string | null, saved: boolean }
export function clearSettingsCache(name) {
  if (name) cache.delete(name);
  else cache.clear();
}

const warned = new Set();
function warnUnreadable(name, why) {
  if (warned.has(name)) return;
  warned.add(name);
  console.error(`[30da settings] the saved ${name} value cannot be read (${why}); save it again on the admin Connections page.`);
}

// ---------- reads ----------

async function cachedSecret(d, name, rawKey) {
  checkName(name);
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;
  const doc = await d.collection(SETTINGS_COLLECTION).findOne({ _id: name });
  let value = null;
  if (doc?.box) {
    try {
      value = openSecret(doc.box, settingsKey(rawKey), name);
    } catch (err) {
      warnUnreadable(name, err instanceof SettingsError ? err.code : "wrong key or damaged value");
    }
  }
  const entry = { at: Date.now(), value, saved: Boolean(doc?.box) };
  cache.set(name, entry);
  return entry;
}

/** The plain value of `name`, or null (not saved, or not readable with this server's key). Cached briefly. */
export async function readSecret(d, name, { rawKey } = {}) {
  return (await cachedSecret(d, name, rawKey)).value;
}

/**
 * true when a value is saved for `name`, readable or not (a changed THIRTYDA_SECRET_KEY leaves it saved but
 * unreadable). Shares readSecret's cache. Callers use it to fail closed: a saved channel that cannot be read
 * must not quietly fall back to on-screen test codes.
 */
export async function secretSaved(d, name, { rawKey } = {}) {
  return (await cachedSecret(d, name, rawKey)).saved;
}

/** The admin's view of `name`: secretView + whether this server can open it + the last live use. Never the value. */
export async function secretStatus(d, name, { rawKey } = {}) {
  checkName(name);
  const doc = await d.collection(SETTINGS_COLLECTION).findOne({ _id: name });
  let readable = false;
  if (doc?.box) {
    try {
      openSecret(doc.box, settingsKey(rawKey), name);
      readable = true;
    } catch { /* wrong key, damaged, or no key on this server */ }
  }
  const last = doc?.box && doc.lastSend ? {
    ok: Boolean(doc.lastSend.ok), reason: doc.lastSend.reason ?? null, detail: doc.lastSend.detail ?? null, at: iso(doc.lastSend.at),
  } : null;
  return { ...secretView(doc), readable, lastSend: last };
}

// ---------- writes ----------

/** Seal and store `plain` as `name`. Refuses (SettingsError 'no_key') without a valid THIRTYDA_SECRET_KEY. */
export async function saveSecret(d, name, plain, { by = "superadmin", rawKey } = {}) {
  checkName(name);
  const key = settingsKey(rawKey);
  const value = String(plain ?? "");
  if (!value) throw new SettingsError("empty", "Nothing to save.");
  const doc = {
    _id: name,
    kind: "secret",
    box: sealSecret(value, key, name),
    last4: lastFour(value),
    updatedAt: new Date(),
    updatedBy: by,
  };
  await d.collection(SETTINGS_COLLECTION).replaceOne({ _id: name }, doc, { upsert: true });
  clearSettingsCache(name);
  warned.delete(name);
  return secretView(doc);
}

/** Remove `name`. → the view of nothing ({ set:false, … }) and whether something was there. */
export async function removeSecret(d, name) {
  checkName(name);
  const r = await d.collection(SETTINGS_COLLECTION).deleteOne({ _id: name });
  clearSettingsCache(name);
  return { ...secretView(null), removed: r.deletedCount > 0 };
}

/** Keep the outcome of the last live use (never a phone number or the value) for the admin's card. */
export async function noteSecretUse(d, name, { ok, reason = null, detail = null } = {}) {
  checkName(name);
  await d.collection(SETTINGS_COLLECTION).updateOne(
    { _id: name, box: { $exists: true } },
    { $set: { lastSend: { ok: Boolean(ok), reason, detail, at: new Date() } } },
  );
}
