/**
 * 30+DA · Google Places in the meeting place search (owner 2026-10-16: OpenStreetMap is thin on Phnom Penh's own chains —
 * Tube Coffee ~25 branches on Google, 3 in our list; BreadTalk ~20 / 4; Pasta Corner ~25 / 2 — "pick up and fix it").
 * GET /30da/api/places asks Google FIRST when the key is saved on Tower 12 and switched on; our own list and Nominatim
 * stay as they were behind it (src/lib/thirtyda-places.mjs createPlaceSearch({ google })).
 *
 * Google's own terms, kept here:
 *   - asked live, one search at a time, only when the person presses Search (never as they type);
 *   - nothing Google answers is kept: no cache, no list, never written into our own place list (copying Maps results
 *     into a database of our own is not allowed — the owner's "harvest it" idea of 2026-10-16 is exactly what this
 *     replaces). A place a person picks is sent in their chat like a typed one;
 *   - credited: each Google suggestion says source 'google'; the app's sheet shows "Google Maps" with them.
 *
 * Places API (New), Text Search: POST https://places.googleapis.com/v1/places:searchText with X-Goog-Api-Key and a field
 * mask of just what a suggestion needs (id, name, short address, point). regionCode KH, the person's language, a 30 km
 * circle around them (or Phnom Penh) as a bias, at most 6.
 *
 * Kept in thirtyda_settings:
 *   'googleplaces'          the key (one sealed box, src/lib/thirtyda-settings.mjs FIELD_SETTINGS; its last 4 only)
 *   'googleplaces_options'  { enabled, monthlyCap }: off until "Turn on"; at most monthlyCap searches a calendar month
 *                           (Phnom Penh time), then Google is not asked and our list answers alone until the 1st
 *   'googleplaces_usage'    { month: 'YYYY-MM', calls, ok, failed, lastOk?, lastError? } — counts only, never a search
 *
 *   createGooglePlaces({ dbFn, fetchImpl, now }) → { search({ q, lang, centre }) → { places } | { skipped: reason } |
 *     { failed: message }, status(d?) → the tower's `google` block (d: the admin's own Db), reset() }
 *   googleTextBody / placeFromGoogle / placesFromGoogle: pure, for the tests.
 */
import { SETTINGS_COLLECTION, readFields, fieldsStatus } from "./thirtyda-settings.mjs";
import { addressLine, passes, PLACES_LIMIT } from "./thirtyda-places.mjs";
import { LANGS } from "../thirtyda-app/shared/rules.js";
import { PLACE_NAME_MAX, cleanLine, cutLine, inCambodia, PP_OFFSET_MS, brandMatches } from "../thirtyda-app/shared/meet.js";
import { kmBetween } from "../thirtyda-app/shared/place-match.js";

export const GOOGLE_SETTING = "googleplaces";
export const GOOGLE_OPTIONS = "googleplaces_options";
export const GOOGLE_USAGE = "googleplaces_usage";
export const GOOGLE_URL = "https://places.googleapis.com/v1/places:searchText";
export const GOOGLE_FIELDS = "places.id,places.displayName,places.shortFormattedAddress,places.formattedAddress,places.location";
/** Google's answer at most this long; past it our own list answers. */
export const GOOGLE_TIMEOUT_MS = 3000;
/** The bias circle around the person (Google allows up to 50 km). */
export const GOOGLE_RADIUS_M = 30000;
export const CAP_DEFAULT = 3000;
export const CAP_MIN = 0;
export const CAP_MAX = 100000;
/** A Google API key: "AIza" + 35 letters, digits, - and _. */
const KEY_RE = /^AIza[0-9A-Za-z_-]{35}$/;
/** Google's languageCode for the app's 5 languages. */
const GOOGLE_LANG = { en: "en", km: "km", zh: "zh-CN", ko: "ko", ja: "ja" };
const CACHE_MS = 30e3;

/** The tower's key box → checked values. An empty box keeps the saved key. */
export function checkGooglePlacesFields(input = {}, current = null) {
  let key = String(input?.key ?? "").trim();
  if (!key && current?.key) key = current.key;
  if (!key) return { ok: false, field: "key", error: "Paste the API key from Google Cloud first (it starts with AIza)." };
  if (!KEY_RE.test(key)) {
    return { ok: false, field: "key", error: "That is not a Google API key: it starts with AIza and is 39 letters and digits long." };
  }
  return { ok: true, values: { key } };
}

/** "YYYY-MM" of a moment in Phnom Penh time: the month the cap counts in. */
export const monthOf = (ms) => new Date(ms + PP_OFFSET_MS).toISOString().slice(0, 7);

/** A brand chip asks for this many (one request whatever the size), keeps that brand's, nearest first. */
export const BRAND_PAGE = 20;

/**
 * The JSON body of one Text Search. brand (a chip, shared/meet.js MEET_BRANDS): English names (its words are matched
 * on them) and 20 places, so the nearest branches are among them.
 */
export function googleTextBody({ q, lang = "en", centre, brand = null }) {
  return {
    textQuery: cleanLine(q),
    languageCode: brand ? "en" : GOOGLE_LANG[lang] || "en",
    regionCode: "KH",
    pageSize: brand ? BRAND_PAGE : PLACES_LIMIT,
    locationBias: { circle: { center: { latitude: centre.lat, longitude: centre.lng }, radius: GOOGLE_RADIUS_M } },
  };
}

const round6 = (n) => Math.round(n * 1e6) / 1e6;

/**
 * One Google place → { name, address, lat, lng, source: 'google' } or null: no point, outside Cambodia, or a name the
 * app's checks would stop. The address is Google's short one, cut into its parts and kept only where they pass the
 * same checks as ours (addressLine: a house number that reads like a phone number goes). "Cambodia" and the postcode go.
 */
export function placeFromGoogle(p) {
  const lat = Number(p?.location?.latitude);
  const lng = Number(p?.location?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inCambodia(lat, lng)) return null;
  const name = cutLine(cleanLine(p?.displayName?.text), PLACE_NAME_MAX);
  if (Array.from(name).length < 2 || !passes(name)) return null;
  const raw = cleanLine(p?.shortFormattedAddress || p?.formattedAddress || "");
  // "Phnom Penh 12000": the postcode goes (its 5 digits help nobody find a café, and read like part of a number).
  const parts = raw.split(/\s*,\s*/).map((s) => s.replace(/\s*\b\d{5}$/, "")).filter((s) => s && !/^(cambodia|kampuchea)$/i.test(s));
  return { name, address: addressLine(name, parts), lat: round6(lat), lng: round6(lng), source: "google" };
}

/**
 * Google's answer → at most 6 suggestions, each once (the same name and address). brand + centre (a chip): only that
 * brand's places, nearest first.
 */
export function placesFromGoogle(json, { brand = null, centre = null } = {}) {
  const out = [];
  const seen = new Set();
  let list = (Array.isArray(json?.places) ? json.places : []).map(placeFromGoogle).filter(Boolean);
  if (brand) {
    list = list.filter((p) => brandMatches(p.name, brand));
    if (centre) list.sort((a, b) => kmBetween(centre, a) - kmBetween(centre, b));
  }
  for (const p of list) {
    const key = `${p.name.toLowerCase()}|${(p.address || "").toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= PLACES_LIMIT) break;
  }
  return out;
}

const iso = (t) => (t instanceof Date ? t.toISOString() : t ? new Date(t).toISOString() : null);

/** The options as saved: { enabled (false until turned on), monthlyCap }. */
export async function googleOptions(d) {
  const doc = await d.collection(SETTINGS_COLLECTION).findOne({ _id: GOOGLE_OPTIONS });
  const cap = Number.isInteger(doc?.monthlyCap) ? doc.monthlyCap : CAP_DEFAULT;
  return { enabled: doc?.enabled === true, monthlyCap: cap, updatedAt: iso(doc?.updatedAt) };
}

/** This month's counts (a new month starts at 0). */
export async function googleUsage(d, now = Date.now()) {
  const doc = await d.collection(SETTINGS_COLLECTION).findOne({ _id: GOOGLE_USAGE });
  const month = monthOf(now);
  const same = doc?.month === month;
  return {
    month,
    calls: same ? doc.calls ?? 0 : 0,
    ok: same ? doc.ok ?? 0 : 0,
    failed: same ? doc.failed ?? 0 : 0,
    lastOk: doc?.lastOk ? { at: iso(doc.lastOk.at), ms: doc.lastOk.ms ?? null } : null,
    lastError: doc?.lastError ? { at: iso(doc.lastError.at), message: doc.lastError.message } : null,
  };
}

/** One search counted (ok or not). A new month restarts the counts. */
async function countUse(d, { ok, ms = null, message = null }, now) {
  const coll = d.collection(SETTINGS_COLLECTION);
  const month = monthOf(now);
  const at = new Date(now);
  // A new month: start from 0 (only the doc of the old month matches the filter).
  await coll.updateOne({ _id: GOOGLE_USAGE, month: { $ne: month } }, { $set: { month, calls: 0, ok: 0, failed: 0 } });
  await coll.updateOne(
    { _id: GOOGLE_USAGE },
    {
      $setOnInsert: { month },
      $inc: { calls: 1, ok: ok ? 1 : 0, failed: ok ? 0 : 1 },
      $set: ok ? { lastOk: { at, ms } } : { lastError: { at, message: String(message).slice(0, 200) } },
    },
    { upsert: true },
  );
}

export async function saveGoogleOptions(d, input, { by = "superadmin" } = {}) {
  const v = input && typeof input === "object" ? input : {};
  const cur = await googleOptions(d);
  const next = { _id: GOOGLE_OPTIONS, kind: "options", enabled: cur.enabled, monthlyCap: cur.monthlyCap };
  if ("enabled" in v) {
    if (typeof v.enabled !== "boolean") return { ok: false, field: "enabled", error: "On or Off." };
    next.enabled = v.enabled;
  }
  if ("monthlyCap" in v) {
    const n = v.monthlyCap;
    if (!Number.isInteger(n) || n < CAP_MIN || n > CAP_MAX) {
      return { ok: false, field: "monthlyCap", error: `A whole number of searches from ${CAP_MIN} to ${CAP_MAX.toLocaleString("en-GB")}.` };
    }
    next.monthlyCap = n;
  }
  next.updatedAt = new Date();
  next.updatedBy = by;
  await d.collection(SETTINGS_COLLECTION).replaceOne({ _id: GOOGLE_OPTIONS }, next, { upsert: true });
  return { ok: true, options: await googleOptions(d) };
}

/**
 * The app's Google client. dbFn: the Mongo Db (the server's getDb); fetchImpl: the outbound fetch. The key and the
 * options are read at most every 30 s (a save on the tower calls reset()).
 */
export function createGooglePlaces({
  dbFn = null,
  fetchImpl = (url, init) => globalThis.fetch(url, init),
  now = () => Date.now(),
  timeoutMs = GOOGLE_TIMEOUT_MS,
  onError = (err) => console.error("[30da places google]", err instanceof Error ? err.message : err),
} = {}) {
  const getDb = async () => (dbFn ?? (await import("./mongo.ts")).getDb)();
  let conf = null; // { at, key, enabled, monthlyCap }
  const inflight = new Map();

  async function config() {
    if (conf && now() - conf.at < CACHE_MS) return conf;
    const d = await getDb();
    const [fields, options] = await Promise.all([readFields(d, GOOGLE_SETTING).catch(() => null), googleOptions(d)]);
    conf = { at: now(), key: fields?.key || null, enabled: options.enabled, monthlyCap: options.monthlyCap };
    return conf;
  }

  /** One live Text Search with the given key (also the tower's test search, even while Off). */
  async function ask(key, { q, lang, centre, brand = null }) {
    const started = now();
    const res = await fetchImpl(GOOGLE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": GOOGLE_FIELDS },
      body: JSON.stringify(googleTextBody({ q, lang, centre, brand })),
      signal: AbortSignal.timeout(timeoutMs),
    });
    let json = null;
    try { json = await res.json(); } catch { /* below */ }
    if (!res?.ok) {
      // Google's own words (e.g. "API key not valid", "Places API (New) has not been used in project …"), never the key.
      const why = cleanLine(json?.error?.message || "").slice(0, 160);
      throw new Error(`Google HTTP ${res?.status}${why ? `: ${why}` : ""}`);
    }
    return { places: placesFromGoogle(json, { brand, centre }), ms: now() - started };
  }

  /**
   * The app's search: { places } (possibly empty), { skipped: 'not_set' | 'off' | 'cap' } (Google not asked), or
   * { failed: message } (asked, no good answer). force: ask even while Off (the tower's test search) — never past the cap.
   */
  async function search({ q, lang = "en", centre, force = false, brand = null }) {
    let c;
    try {
      c = await config();
    } catch (err) {
      onError(err);
      return { skipped: "not_set" };
    }
    if (!c.key) return { skipped: "not_set" };
    if (!c.enabled && !force) return { skipped: "off" };
    const d = await getDb();
    const used = await googleUsage(d, now());
    if (used.calls >= c.monthlyCap) return { skipped: "cap" };
    const language = LANGS.includes(lang) ? lang : "en";
    const k = `${brand?.id ?? ""}|${language}|${cleanLine(q).toLowerCase()}|${centre.lat.toFixed(2)},${centre.lng.toFixed(2)}`;
    // The same search already on its way is asked once (two taps on Search): not a cache, nothing is kept after it.
    if (inflight.has(k)) return inflight.get(k);
    const p = ask(c.key, { q, lang: language, centre, brand })
      .then(async (r) => {
        await countUse(d, { ok: true, ms: r.ms }, now()).catch(onError);
        return { places: r.places, ms: r.ms };
      })
      .catch(async (err) => {
        const message = err instanceof Error ? (err.name === "TimeoutError" ? `no answer within ${timeoutMs / 1000} s` : err.message) : String(err);
        onError(message);
        await countUse(d, { ok: false, message }, now()).catch(onError);
        return { failed: message };
      })
      .finally(() => inflight.delete(k));
    inflight.set(k, p);
    return p;
  }

  /** Tower 12's `google` block: the key (its last 4), On / Off, the cap and this month's counts. Never the key. */
  async function status(db = null) {
    const d = db ?? (await getDb());
    const [saved, options, usage] = await Promise.all([fieldsStatus(d, GOOGLE_SETTING), googleOptions(d), googleUsage(d, now())]);
    let state = "not_set";
    if (saved.set && !saved.readable) state = "unreadable";
    else if (saved.set && !options.enabled) state = "off";
    else if (saved.set && usage.calls >= options.monthlyCap) state = "cap";
    else if (saved.set && usage.lastError && (!usage.lastOk || usage.lastError.at > usage.lastOk.at)) state = "failing";
    else if (saved.set) state = "live";
    return { id: GOOGLE_SETTING, state, ...saved, options, usage, capRange: [CAP_MIN, CAP_MAX] };
  }

  const reset = () => { conf = null; };
  return { search, status, reset };
}
