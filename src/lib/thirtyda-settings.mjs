/**
 * 30+DA settings the super admin enters on the web (the admin "Code" page, /30da/admin/connections) —
 * the Telegram Gateway API token, the free Telegram bot's key, the WhatsApp Cloud API keys, and the Google / Facebook
 * sign-in keys.
 *
 * Mongo `thirtyda_settings`, one doc per setting:
 *   { _id:'telegram', kind:'secret', box:{ v:1, alg:'aes-256-gcm', iv, tag, data }, last4,
 *     updatedAt, updatedBy, lastSend?:{ ok, reason, detail, at } }
 *   { _id:'whatsapp'|'google'|'facebook'|'telegram_bot', kind:'fields', box (sealed JSON of ALL the fields), last4, masks:{ <secret field>: last4 },
 *     updatedAt, updatedBy, lastSend? }
 * A "fields" setting (FIELD_SETTINGS) keeps every field in the one sealed box; the fields marked secret are
 * only ever shown as their last 4 characters, the others (a phone number ID, a template name, an app ID)
 * are shown back to the admin as saved.
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
/** Settings that hold ONE secret string (saveSecret / readSecret). review_code: the App review sign-in code (thirtyda-review.mjs). */
export const SECRET_NAMES = ["telegram", "review_code"];
/**
 * Settings that hold several fields in one sealed box (saveFields / readFields); secret:true → shown as last 4 only;
 * secret + hidden → never shown at all, not even its last 4 (the Telegram bot's webhook secret).
 */
export const FIELD_SETTINGS = {
  whatsapp: { token: { secret: true }, phoneNumberId: {}, templateName: {}, templateLang: {} },
  // The free 30+DA Telegram bot (src/lib/thirtyda-telegram-bot.mjs): the key from @BotFather + what Save set up.
  telegram_bot: { token: { secret: true }, hookSecret: { secret: true, hidden: true }, username: {}, botId: {}, hookUrl: {} },
  google: { clientId: {}, clientSecret: { secret: true } },
  facebook: { appId: {}, appSecret: { secret: true } },
  tiktok: { clientKey: {}, clientSecret: { secret: true } },
};
export const SETTING_NAMES = [...SECRET_NAMES, ...Object.keys(FIELD_SETTINGS)];
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

function checkName(name, names = SETTING_NAMES) {
  if (!names.includes(name)) throw new SettingsError("unknown", `No such setting: ${String(name).slice(0, 40)}.`);
  return name;
}
const checkFieldsName = (name) => checkName(name, Object.keys(FIELD_SETTINGS));

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
  console.error(`[30da settings] the saved ${name} value cannot be read (${why}); save it again on the admin Code page.`);
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
    kind: doc.lastSend.kind ?? null,
  } : null;
  return { ...secretView(doc), readable, lastSend: last };
}

// ---------- writes ----------

/** Seal and store `plain` as `name`. Refuses (SettingsError 'no_key') without a valid THIRTYDA_SECRET_KEY. */
export async function saveSecret(d, name, plain, { by = "superadmin", rawKey } = {}) {
  checkName(name, SECRET_NAMES);
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

/**
 * Keep the outcome of the last live use (never a phone number, a name, an email or the value) for the admin's
 * card. kind (optional): what it was — 'try' (the admin's "Try sign-in") or 'signin' (a real Google / Facebook sign-in).
 */
export async function noteSecretUse(d, name, { ok, reason = null, detail = null, kind = null } = {}) {
  checkName(name);
  await d.collection(SETTINGS_COLLECTION).updateOne(
    { _id: name, box: { $exists: true } },
    { $set: { lastSend: { ok: Boolean(ok), reason, detail, at: new Date(), ...(kind ? { kind: String(kind) } : {}) } } },
  );
}

// ---------- several fields in one sealed box (WhatsApp, Google, Facebook) ----------

/** { field: value } with only the fields of `name`, each a trimmed string (missing → ""). */
function pickFields(name, values) {
  const out = {};
  for (const f of Object.keys(FIELD_SETTINGS[name])) out[f] = String(values?.[f] ?? "").trim();
  return out;
}
/** The secret fields shown as their last 4 (a hidden one is never shown at all). */
const secretFields = (name) => Object.keys(FIELD_SETTINGS[name]).filter((f) => FIELD_SETTINGS[name][f].secret && !FIELD_SETTINGS[name][f].hidden);
const plainFields = (name) => Object.keys(FIELD_SETTINGS[name]).filter((f) => !FIELD_SETTINGS[name][f].secret);

/** The fields of a sealed box → object, or null when it is not a JSON object. */
function parseFields(name, json) {
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" && !Array.isArray(v) ? pickFields(name, v) : null;
  } catch {
    return null;
  }
}

/**
 * What a client may see of a "fields" setting: never the box, never a secret field — only its last 4
 * (masks). The plain fields come from the opened box (`values`), so they show only when this server can read it.
 */
export function fieldsView(name, doc, values = null) {
  checkFieldsName(name);
  const set = Boolean(doc?.box);
  const shown = {};
  if (set && values) for (const f of plainFields(name)) shown[f] = values[f] ?? "";
  return {
    set,
    last4: set ? doc.last4 ?? null : null,
    masks: set ? { ...(doc.masks ?? {}) } : {},
    fields: set && values ? shown : null,
    updatedAt: set ? iso(doc.updatedAt) : null,
    updatedBy: set ? doc.updatedBy ?? null : null,
  };
}

/** Every field of `name` (secrets included), or null: not saved, not readable, or damaged. Cached like readSecret. */
export async function readFields(d, name, { rawKey } = {}) {
  checkFieldsName(name);
  const json = await readSecret(d, name, { rawKey });
  return json == null ? null : parseFields(name, json);
}

/** The admin's view of a "fields" setting: fieldsView + readable + the last live use. Never a secret value. */
export async function fieldsStatus(d, name, { rawKey } = {}) {
  checkFieldsName(name);
  const doc = await d.collection(SETTINGS_COLLECTION).findOne({ _id: name });
  let values = null;
  if (doc?.box) {
    try {
      values = parseFields(name, openSecret(doc.box, settingsKey(rawKey), name));
    } catch { /* wrong key, damaged, or no key on this server */ }
  }
  const last = doc?.box && doc.lastSend ? {
    ok: Boolean(doc.lastSend.ok), reason: doc.lastSend.reason ?? null, detail: doc.lastSend.detail ?? null, at: iso(doc.lastSend.at),
    kind: doc.lastSend.kind ?? null,
  } : null;
  return { ...fieldsView(name, doc, values), readable: Boolean(values), lastSend: last };
}

/**
 * Seal and store every field of `name` (one box; a fresh IV each time). Each field must be filled in
 * (SettingsError 'empty', err.field). Refuses (SettingsError 'no_key') without a valid THIRTYDA_SECRET_KEY.
 * → fieldsView (the plain fields + the secrets' last 4). A save starts a new card: the last live use is dropped.
 */
export async function saveFields(d, name, values, { by = "superadmin", rawKey } = {}) {
  checkFieldsName(name);
  const key = settingsKey(rawKey);
  const all = pickFields(name, values);
  for (const [f, v] of Object.entries(all)) {
    if (!v) throw Object.assign(new SettingsError("empty", `Fill in ${f} first.`), { field: f });
  }
  const masks = Object.fromEntries(secretFields(name).map((f) => [f, lastFour(all[f])]));
  const doc = {
    _id: name,
    kind: "fields",
    box: sealSecret(JSON.stringify(all), key, name),
    last4: masks[secretFields(name)[0]] ?? null,
    masks,
    updatedAt: new Date(),
    updatedBy: by,
  };
  await d.collection(SETTINGS_COLLECTION).replaceOne({ _id: name }, doc, { upsert: true });
  clearSettingsCache(name);
  warned.delete(name);
  return fieldsView(name, doc, all);
}
