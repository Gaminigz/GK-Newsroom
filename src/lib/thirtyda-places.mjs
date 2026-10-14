/**
 * 30+DA · the place search of a Level 3 meeting (owner 2026-10-14: the free search, no Google key): GET /30da/api/places
 * asks OpenStreetMap's Nominatim through the server, never from the phone, so Nominatim sees only our server.
 *
 *   search({ q, lang, near }) → { places: [{ name, address, lat, lng }] } (at most 6), plus cached: true when it came from
 *   the cache, busy: true when too many searches already wait for their turn (nothing asked, the app says "busy"), or
 *   unavailable: true when Nominatim did not answer in 3 seconds or answered with an error.
 *
 * Cambodia first: countrycodes=kh and a viewbox around the person (their stored point, rounded to 2 decimals ≈ 1 km) or
 * Phnom Penh, bounded=0 so a place a little outside still counts. accept-language = the person's app language, so a
 * Khmer phone gets Khmer names where OpenStreetMap has them.
 *
 * Usage policy (src/lib/thirtyda-nominatim.mjs): our User-Agent, the server's one 1-per-second queue (shared with the
 * area names of src/lib/thirtyda-geo.mjs), and a cache (24 hours, 2,000 searches; the same search in flight is asked once).
 *
 * Every suggestion already passes the app's own contact-detail and bad-word checks (shared/rules.js) — the address is a
 * short line (road, area, city: no house number, no postcode, whose digits read like a phone number) — so picking one
 * never trips the same checks POST /pairs/:id/meet runs on what is sent.
 */
import { NOMINATIM_ORIGIN, NOMINATIM_UA, nominatimTurn } from "./thirtyda-nominatim.mjs";
import { LANGS, findContactDetails, findBadWords } from "../thirtyda-app/shared/rules.js";
import { PLACE_NAME_MAX, PLACE_ADDRESS_MAX, PLACE_QUERY_MIN, PLACE_QUERY_MAX, cleanLine, cutLine } from "../thirtyda-app/shared/meet.js";

export const PLACES_LIMIT = 6;
export const PLACES_TIMEOUT_MS = 3000;
export const PLACES_TTL_MS = 24 * 3600e3;
export const PLACES_CACHE_MAX = 2000;
/** Searches waiting for their turn in the 1-per-second queue before a new one is answered "busy" at once. */
export const PLACES_QUEUE_MAX = 4;
/** Phnom Penh (Independence Monument): the centre when we do not know where the person is. */
export const PHNOM_PENH = Object.freeze({ lat: 11.56, lng: 104.93 });
/** Half the side of the box the search prefers, in degrees (≈ 22 km at Phnom Penh). */
export const VIEW_HALF = 0.2;
// Cambodia, roughly: a point outside it (a traveller, a wrong fix) searches around Phnom Penh instead.
const KH = { minLat: 9.5, maxLat: 14.8, minLng: 102.2, maxLng: 107.8 };

const round2 = (n) => Math.round(n * 100) / 100;
const round6 = (n) => Math.round(n * 1e6) / 1e6;

/** The search centre: `near` ({ lat, lng }, rounded to 2 decimals) when it is in Cambodia, else Phnom Penh. */
export function searchCentre(near) {
  const lat = Number(near?.lat);
  const lng = Number(near?.lng);
  if (near == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return { ...PHNOM_PENH };
  if (lat < KH.minLat || lat > KH.maxLat || lng < KH.minLng || lng > KH.maxLng) return { ...PHNOM_PENH };
  return { lat: round2(lat), lng: round2(lng) };
}

/** "lat,lng" from a query parameter → { lat, lng } or null. */
export function parseNear(v) {
  const m = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(String(v ?? ''));
  return m ? { lat: Number(m[1]), lng: Number(m[2]) } : null;
}

/** Nominatim's viewbox "left,top,right,bottom" (lng,lat,lng,lat) around the centre. */
export function viewboxAround(centre) {
  const c = searchCentre(centre);
  const f = (n) => n.toFixed(2);
  return [f(c.lng - VIEW_HALF), f(c.lat + VIEW_HALF), f(c.lng + VIEW_HALF), f(c.lat - VIEW_HALF)].join(",");
}

/** What is searched: one line, 2–80 characters; "" when there is nothing to search. */
export function cleanQuery(q) {
  const s = cleanLine(q);
  const n = Array.from(s).length;
  return n >= PLACE_QUERY_MIN && n <= PLACE_QUERY_MAX ? s : "";
}

/** The Nominatim search address for one search. */
export function searchUrl({ q, lang = "en", near = null }) {
  const u = new URL("/search", NOMINATIM_ORIGIN);
  u.search = new URLSearchParams({
    q: cleanLine(q),
    format: "jsonv2",
    addressdetails: "1",
    countrycodes: "kh",
    viewbox: viewboxAround(near),
    bounded: "0",
    limit: String(PLACES_LIMIT),
    "accept-language": LANGS.includes(lang) ? lang : "en",
  }).toString();
  return u;
}

const passes = (text) => findContactDetails(text).ok && findBadWords(text).ok;

// The address parts, in order: the road, the area (in Cambodia the sangkat or the khan), the city or province.
const ROAD = ["road", "pedestrian", "street", "footway", "square"];
const AREA = ["suburb", "quarter", "neighbourhood", "village", "city_district", "town"];
const CITY = ["city", "state", "province", "town"];
const tidyArea = (s) => cleanLine(s).replace(/^(sangkat|khan|krong|commune|district)\s+/i, "");

/**
 * One Nominatim result → { name, address, lat, lng }, or null (no point, no name, or a name the app's checks would
 * stop). The address keeps only the parts that pass the checks, then is cut to fit.
 */
export function placeFromResult(r) {
  const lat = Number(r?.lat);
  const lng = Number(r?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const a = r?.address && typeof r.address === "object" ? r.address : {};
  const name = cutLine(cleanLine(r?.name) || cleanLine(String(r?.display_name ?? "").split(",")[0]), PLACE_NAME_MAX);
  if (Array.from(name).length < 2 || !passes(name)) return null;
  const first = (keys, tidy = cleanLine) => keys.map((k) => tidy(a[k])).find(Boolean) || "";
  const parts = [];
  for (const part of [first(ROAD), first(AREA, tidyArea), first(CITY, tidyArea)]) {
    if (!part || part === name || parts.includes(part)) continue;
    const next = [...parts, part].join(", ");
    if (Array.from(next).length > PLACE_ADDRESS_MAX || !passes(next)) continue;
    parts.push(part);
  }
  return { name, address: parts.join(", ") || null, lat: round6(lat), lng: round6(lng) };
}

/** The suggestions of one Nominatim answer: at most 6, each once (same name and address). */
export function placesFrom(list) {
  const out = [];
  const seen = new Set();
  for (const r of Array.isArray(list) ? list : []) {
    const p = placeFromResult(r);
    if (!p) continue;
    const key = `${p.name.toLowerCase()}|${(p.address || "").toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= PLACES_LIMIT) break;
  }
  return out;
}

/**
 * A place search with its own cache. fetchImpl(url, init) is the server's outbound fetch (the dev server's test stand-in
 * may answer it, src/lib/thirtyda-test-fetch.mjs); turn is the shared Nominatim queue. Both, and the clock, are for tests.
 */
export function createPlaceSearch({
  fetchImpl = (url, init) => globalThis.fetch(url, init),
  turn = nominatimTurn,
  now = () => Date.now(),
  ttlMs = PLACES_TTL_MS,
  cacheMax = PLACES_CACHE_MAX,
  timeoutMs = PLACES_TIMEOUT_MS,
  queueMax = PLACES_QUEUE_MAX,
  onError = (err) => console.error("[30da places]", err instanceof Error ? err.message : err),
} = {}) {
  const cache = new Map(); // key → { at, places } (oldest first: a hit moves to the end)
  const inflight = new Map(); // key → Promise of the answer
  let waiting = 0;

  async function ask(url) {
    const res = await fetchImpl(url, {
      headers: { "User-Agent": NOMINATIM_UA, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res?.ok) throw new Error(`nominatim HTTP ${res?.status}`);
    return placesFrom(await res.json());
  }

  async function search({ q, lang = "en", near = null } = {}) {
    const query = cleanQuery(q);
    if (!query) return { places: [] };
    const centre = searchCentre(near);
    const language = LANGS.includes(lang) ? lang : "en";
    const key = `${language}|${query.toLowerCase()}|${centre.lat.toFixed(1)},${centre.lng.toFixed(1)}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) {
      cache.delete(key);
      cache.set(key, hit);
      return { places: hit.places, cached: true };
    }
    if (hit) cache.delete(key);
    if (inflight.has(key)) return inflight.get(key);
    if (waiting >= queueMax) return { places: [], busy: true };
    waiting++;
    const url = searchUrl({ q: query, lang: language, near: centre });
    const p = turn(() => {
      waiting--;
      return ask(url);
    })
      .then((places) => {
        while (cache.size >= cacheMax) cache.delete(cache.keys().next().value);
        cache.set(key, { at: now(), places });
        return { places };
      })
      .catch((err) => {
        onError(err);
        return { places: [], unavailable: true };
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  return { search, size: () => cache.size };
}
