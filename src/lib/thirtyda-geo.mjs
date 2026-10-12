/**
 * 30+DA geo helpers.
 *
 * reverseArea(lat, lng) → { area, city } through Nominatim reverse geocoding
 * (OpenStreetMap usage policy: real User-Agent, at most 1 request a second,
 * cache results). Cached in memory on a ~200 m grid; any failure falls back
 * to Phnom Penh so the Nearby card always has a label.
 *
 * areaFor(lat, lng) is what requests use: one shared 1-per-second queue must not
 * make everyone wait behind a burst, so when a few lookups are already queued it
 * answers at once with the nearest cached area (or Phnom Penh) and hands back
 * `later`, a promise of the real area. The queue itself is capped; lookups past
 * the cap are dropped and the caller keeps the quick answer.
 */

const UA = "30DA/1.0 (gk.smart@ggmt.sg)";
const GRID = 0.002; // degrees ≈ 220 m at Phnom Penh's latitude
const CACHE_MAX = 5000;
const FALLBACK = { area: "Phnom Penh", city: "Phnom Penh" };

const QUEUE_WAIT = 2; // lookups ahead of us before we stop waiting in line
const QUEUE_MAX = 30; // lookups queued at all; past this new ones are dropped
const NEAREST_KM = 3; // a cached area this close stands in while the real one is looked up

const cache = new Map(); // "i:j" grid key -> { area, city }
const inflight = new Map(); // grid key -> Promise<{ area, city } | null>
let queue = Promise.resolve();
let lastCall = 0;
let pending = 0;

// Nominatim spells sangkats out ("Sangkat Boeng Keng Kang Ti Muoy");
// people in Phnom Penh say "BKK1", "Phsar Depou 1".
const ORDINALS = [[/\s+ti\s+muoy$/i, " 1"], [/\s+ti\s+pir$/i, " 2"], [/\s+ti\s+bei$/i, " 3"], [/\s+ti\s+buon$/i, " 4"]];

function tidy(name) {
  let s = String(name || "").replace(/^(sangkat|khan|krong|commune|district)\s+/i, "").replace(/\s+province$/i, "").trim();
  for (const [re, n] of ORDINALS) s = s.replace(re, n);
  return s.replace(/^boe?u?ng\s+keng\s+kang\s+([123])$/i, "BKK$1");
}

/** Wait our turn so Nominatim sees at most one request a second from us. */
function throttled(fn) {
  const run = queue.then(async () => {
    const wait = lastCall + 1000 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  });
  queue = run.catch(() => {});
  return run;
}

const keyOf = (lat, lng) => `${Math.round(lat / GRID)}:${Math.round(lng / GRID)}`;

function nominatim(lat, lng) {
  return throttled(async () => {
    const u = new URL("https://nominatim.openstreetmap.org/reverse");
    u.search = new URLSearchParams({
      format: "jsonv2", lat: String(lat), lon: String(lng), zoom: "16", addressdetails: "1", "accept-language": "en",
    });
    const res = await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`nominatim HTTP ${res.status}`);
    const a = (await res.json())?.address || {};
    // In Cambodia: village = sangkat, town = khan, state = Phnom Penh (or the province).
    const area = tidy(a.suburb || a.quarter || a.neighbourhood || a.village || a.city_district || a.town);
    const city = tidy(a.city || a.state || a.town) || FALLBACK.city;
    return { area: area || city, city };
  });
}

/** One lookup per grid cell at a time; null when the queue is full or the lookup failed. */
function lookup(lat, lng, key) {
  if (inflight.has(key)) return inflight.get(key);
  if (pending >= QUEUE_MAX) return null;
  pending++;
  const p = nominatim(lat, lng)
    .then((out) => {
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
      cache.set(key, out);
      return out;
    })
    .catch((err) => {
      console.error("[30da geo]", err instanceof Error ? err.message : err);
      return null;
    })
    .finally(() => {
      pending--;
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

function nearestCached(lat, lng) {
  let best = null;
  let bestKm = NEAREST_KM;
  for (const [key, value] of cache) {
    const [i, j] = key.split(":").map(Number);
    const km = haversineKm([lng, lat], [j * GRID, i * GRID]);
    if (km < bestKm) { best = value; bestKm = km; }
  }
  return best ?? FALLBACK;
}

/** { area, city, later }: later is null, or a promise of the real area when it could not wait. */
export async function areaFor(lat, lng) {
  const key = keyOf(lat, lng);
  if (cache.has(key)) return { ...cache.get(key), later: null };
  const busy = pending >= QUEUE_WAIT && !inflight.has(key);
  const p = lookup(lat, lng, key);
  if (p && !busy) return { ...((await p) ?? FALLBACK), later: null };
  return { ...nearestCached(lat, lng), later: p };
}

export async function reverseArea(lat, lng) {
  const key = keyOf(lat, lng);
  if (cache.has(key)) return cache.get(key);
  return (await lookup(lat, lng, key)) ?? { ...FALLBACK };
}

/** Great-circle distance in km. */
export function haversineKm([lng1, lat1], [lng2, lat2]) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(h));
}
