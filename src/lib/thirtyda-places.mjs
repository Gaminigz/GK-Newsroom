/**
 * 30+DA · the place search of a Level 3 meeting (owner 2026-10-14: the free search, no Google key): GET /30da/api/places
 * asks OpenStreetMap's Nominatim through the server, never from the phone, so Nominatim sees only our server.
 *
 *   search({ q, lang, near }) → { places: [{ name, address, lat, lng }] } (at most 6), plus cached: true when it came from
 *   the cache, busy: true when too many lookups already wait in the shared Nominatim queue (the area names' too; nothing
 *   asked, the app says "busy"), or unavailable: true when there was no answer within 4 seconds in all (the wait for its
 *   turn included; a search that never got its turn is not sent at all), Nominatim did not answer in 3 seconds, or it
 *   answered with an error.
 *
 * Only when the person asks: the app searches on Enter or its Search button, never as they type. The usage policy
 * forbids auto-complete searches ("you must not implement such a service on the client side using the API").
 *
 * Cambodia first: countrycodes=kh and a viewbox around the person (their stored point, rounded to 2 decimals ≈ 1 km) or
 * Phnom Penh, bounded=0 so a place a little outside still counts. accept-language = the person's app language, so a
 * Khmer phone gets Khmer names where OpenStreetMap has them.
 *
 * Usage policy (src/lib/thirtyda-nominatim.mjs): our User-Agent, the server's one 1-per-second queue (shared with the
 * area names of src/lib/thirtyda-geo.mjs), and a cache (24 hours, 2,000 searches; the same search in flight is asked once).
 *
 * Every suggestion already passes the app's own contact-detail and bad-word checks (shared/rules.js) — the address is a
 * short line (road, area, city: no house number, no postcode, whose digits read like a phone number), and the name and
 * the address read together pass too — so picking one never trips the same checks POST /pairs/:id/meet runs on what is
 * sent.
 *
 * Each suggestion the server hands out carries `ref` (createPlaceRefs): POST /pairs/:id/meet keeps a place's address and
 * map point only with it, so a card's name and its map always belong together.
 *
 * Our own Phnom Penh list first (owner 2026-10-15: "Browns" found nothing — Nominatim matches whole words only, and the
 * café is "Brown Coffee"): createPlaceSearch({ index }) asks src/lib/thirtyda-places-index.mjs before Nominatim — the
 * named cafés, restaurants, malls, parks … of greater Phnom Penh from OpenStreetMap, kept on the server and searched
 * there (plurals, synonyms, area words like "tk" or "BKK1", word starts, small typos, Khmer / Chinese / Korean /
 * Japanese parts of a name: shared/place-match.js). Only for a search around Phnom Penh: its centre within 30 km of
 * the city (PLACES_INDEX_KM), and only our places within 30 km of that centre; anywhere else in Cambodia (Siem Reap,
 * Sihanoukville …) Nominatim alone around the person, as before. 3 or more of ours (found without a typo): Nominatim is
 * not asked at all. Fewer: Nominatim as above, its suggestions after ours and before our near-misses (one place once:
 * the same name within 150 m, or anything within 40 m: sameSpot). Ours are made the same way (addressLine, the same
 * checks) and get the same ref. No list yet: Nominatim alone, as before.
 *
 * Google first when it is on (owner 2026-10-16: OpenStreetMap is thin on Phnom Penh's own chains — Tube Coffee,
 * BreadTalk, Pasta Corner): createPlaceSearch({ google }) (src/lib/thirtyda-places-google.mjs, the key on Tower 12) is
 * asked before anything else. Places from Google: they come first (source 'google', credited "Google Maps" in the app),
 * our own sure ones fill what is left, and Nominatim is not asked. Google not set, Off, past its monthly cap, failing or
 * finding nothing: exactly the search above. Nothing Google answers is cached or kept.
 *
 * A brand chip (owner 2026-10-16, shared/meet.js MEET_BRANDS: search({ brand })): the brand's own words, strict — ours
 * only with every word whole in a name, Google's and Nominatim's only with the brand's words in the name — and the
 * answer nearest first, each place with `km` from the person (one decimal).
 */
import crypto from "node:crypto";
import { NOMINATIM_ORIGIN, NOMINATIM_UA, SKIPPED, nominatimTurn } from "./thirtyda-nominatim.mjs";
import { normPlace, kmBetween } from "../thirtyda-app/shared/place-match.js";
import { LANGS, findContactDetails, findContactDetailsAcross, findBadWords } from "../thirtyda-app/shared/rules.js";
import {
  PLACE_NAME_MAX, PLACE_ADDRESS_MAX, PLACE_QUERY_MIN, PLACE_QUERY_MAX, cleanLine, cutLine, checkPlace, inCambodia, brandMatches,
} from "../thirtyda-app/shared/meet.js";

export const PLACES_LIMIT = 6;
export const PLACES_TIMEOUT_MS = 3000;
/** The whole search at most: its wait in the shared queue plus Nominatim's answer. Past it: "unavailable". */
export const PLACES_DEADLINE_MS = 4000;
export const PLACES_TTL_MS = 24 * 3600e3;
export const PLACES_CACHE_MAX = 2000;
/**
 * Lookups waiting for their turn in the shared 1-per-second queue (place searches and area names alike) before a new
 * search is answered "busy" at once.
 */
export const PLACES_QUEUE_MAX = 4;
/** Our own list's hits that are enough: with this many, Nominatim is not asked. */
export const PLACES_INDEX_ENOUGH = 3;
/** Phnom Penh (Independence Monument): the centre when we do not know where the person is. */
export const PHNOM_PENH = Object.freeze({ lat: 11.56, lng: 104.93 });
/**
 * Our own list is greater Phnom Penh (thirtyda-places-index.mjs INDEX_BOX, its corners ~27 km from PHNOM_PENH): asked
 * only for a search centred within this many km of the city, and only its places within this many km of that centre.
 */
export const PLACES_INDEX_KM = 30;
/** Half the side of the box the search prefers, in degrees (≈ 22 km at Phnom Penh). */
export const VIEW_HALF = 0.2;

const round2 = (n) => Math.round(n * 100) / 100;
const round6 = (n) => Math.round(n * 1e6) / 1e6;

/** The search centre: `near` ({ lat, lng }, rounded to 2 decimals) when it is in Cambodia, else Phnom Penh. */
export function searchCentre(near) {
  const lat = Number(near?.lat);
  const lng = Number(near?.lng);
  // Cambodia only: a point outside it (a traveller, a wrong fix) searches around Phnom Penh instead.
  if (near == null || !inCambodia(lat, lng)) return { ...PHNOM_PENH };
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

/** A name or an address line the app's own checks let through: no contact detail, no bad word. */
export const passes = (text) => findContactDetails(text).ok && findBadWords(text).ok;

// The address parts, in order: the road, the area (in Cambodia the sangkat or the khan), the city or province.
const ROAD = ["road", "pedestrian", "street", "footway", "square"];
const AREA = ["suburb", "quarter", "neighbourhood", "village", "city_district", "town"];
const CITY = ["city", "state", "province", "town"];
/** An area name without its "Sangkat" / "Khan" / … in front. */
export const tidyArea = (s) => cleanLine(s).replace(/^(sangkat|khan|krong|commune|district)\s+/i, "");

/**
 * A suggestion's short address line from its parts, in order (blank ones skipped): each part kept only when it passes
 * the checks alone and read together with the name ("Cafe 012 887" + "766 Street" is a phone number), is not the name
 * or a part already there, and still fits (140). null when nothing is left. The Nominatim answers and our own list
 * (src/lib/thirtyda-places-index.mjs) both make their lines here.
 */
export function addressLine(name, list) {
  const parts = [];
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  for (const raw of list) {
    const part = cleanLine(raw);
    if (!part || same(part, name) || parts.some((x) => same(x, part))) continue;
    const next = [...parts, part].join(", ");
    if (Array.from(next).length > PLACE_ADDRESS_MAX || !passes(next) || !findContactDetailsAcross([name, next]).ok) continue;
    parts.push(part);
  }
  return parts.join(", ") || null;
}

/**
 * One Nominatim result → { name, address, lat, lng }, or null (no point, no name, or a name the app's checks would
 * stop). The address keeps only the parts that pass the checks — alone, and read together with the name ("Cafe 012
 * 887" + "766 Street" is a phone number) — and fit.
 */
export function placeFromResult(r) {
  const lat = Number(r?.lat);
  const lng = Number(r?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const a = r?.address && typeof r.address === "object" ? r.address : {};
  const name = cutLine(cleanLine(r?.name) || cleanLine(String(r?.display_name ?? "").split(",")[0]), PLACE_NAME_MAX);
  if (Array.from(name).length < 2 || !passes(name)) return null;
  const first = (keys, tidy = cleanLine) => keys.map((k) => tidy(a[k])).find(Boolean) || "";
  const address = addressLine(name, [first(ROAD), first(AREA, tidyArea), first(CITY, tidyArea)]);
  return { name, address, lat: round6(lat), lng: round6(lng) };
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

/** Metres between two suggestions (Infinity when either has no point). */
const metres = (a, b) => (Number.isFinite(a?.lat) && Number.isFinite(b?.lat) ? kmBetween(a, b) * 1000 : Infinity);
/** One place twice: anything within 40 m, or the same name (case, accents, punctuation aside) within 150 m. */
export const SAME_SPOT_M = 40;
export const SAME_NAME_M = 150;

/**
 * Two suggestions that are one place (SAME_SPOT_M / SAME_NAME_M) — by where they are, never by their words: two branches
 * of a chain with the same name and the same area line are two places.
 */
export function sameSpot(a, b) {
  const m = metres(a, b);
  return m < SAME_SPOT_M || (m < SAME_NAME_M && normPlace(a.name) === normPlace(b.name));
}

/**
 * Our own suggestions first, then Nominatim's that are not one of ours again (sameSpot): at most 6.
 */
export function mergePlaces(own, more, limit = PLACES_LIMIT) {
  const out = [...(own || [])].slice(0, limit);
  for (const p of more || []) {
    if (out.length >= limit) break;
    if (!out.some((o) => sameSpot(o, p))) out.push(p);
  }
  return out;
}

/**
 * A place search with its own cache. fetchImpl(url, init) is the server's outbound fetch (the dev server's test stand-in
 * may answer it, src/lib/thirtyda-test-fetch.mjs); turn is the shared Nominatim queue. Both, and the clock, are for tests.
 * index: our own place list (src/lib/thirtyda-places-index.mjs createPlaceIndex: search({ q, lang, centre, limit }) →
 * { places, sure } — the first `sure` matched without a typo — or null while there is no list yet), asked first when
 * the search centre is within PLACES_INDEX_KM of Phnom Penh; 3 sure ones are enough; none at all (or a centre further
 * away) → Nominatim alone, exactly as before.
 *
 * search({ …, explain: true }) (the Code page's Tower 12 test search only; GET /places never asks for it) adds
 * `explain`: { ours: was our list asked, own / sure: its hits / those without a typo, nominatim: 'not_asked' | 'asked' |
 * 'cached' | 'busy' | 'unavailable', from: per place 'ours' | 'ours_typo' | 'nominatim' }.
 */
export function createPlaceSearch({
  index = null,
  google = null,
  fetchImpl = (url, init) => globalThis.fetch(url, init),
  turn = nominatimTurn,
  now = () => Date.now(),
  ttlMs = PLACES_TTL_MS,
  cacheMax = PLACES_CACHE_MAX,
  timeoutMs = PLACES_TIMEOUT_MS,
  deadlineMs = PLACES_DEADLINE_MS,
  queueMax = PLACES_QUEUE_MAX,
  onError = (err) => console.error("[30da places]", err instanceof Error ? err.message : err),
} = {}) {
  const cache = new Map(); // key → { at, places } (oldest first: a hit moves to the end)
  const inflight = new Map(); // key → Promise of the answer
  let waiting = 0; // my own searches not started yet (the queue's turn.waiting() counts everyone's)
  const queued = () => Math.max(waiting, typeof turn.waiting === "function" ? turn.waiting() : 0);

  async function ask(url) {
    const res = await fetchImpl(url, {
      headers: { "User-Agent": NOMINATIM_UA, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res?.ok) throw new Error(`nominatim HTTP ${res?.status}`);
    return placesFrom(await res.json());
  }

  // force: the tower's test search asks Google even while it is Off (a key can be tried before it is turned on).
  async function search({ q, lang = "en", near = null, explain = false, force = false, brand = null } = {}) {
    const r = await searchOnce({ q, lang, near, force, brand });
    if (brand) r.answer = { ...r.answer, places: nearestOfBrand(r, brand, searchCentre(near)) };
    if (!explain) return r.answer;
    const { answer, ours, own, sure, typos, nominatim, google: g } = r;
    const from = (answer.places || []).map((p) => (p.source === "google" ? "google" : sure.includes(p) ? "ours" : typos.includes(p) ? "ours_typo" : "nominatim"));
    return { ...answer, explain: { ours, own: own.length, sure: sure.length, nominatim, google: g, from } };
  }

  /**
   * One search → { answer (what GET /places returns), ours, own, sure, typos, nominatim, google } (all but the answer:
   * explain). google: 'not_set' | 'off' | 'cap' | 'failed' | 'none' (asked, nothing found) | 'asked'.
   */
  async function searchOnce({ q, lang, near, force = false, brand = null }) {
    const none = { ours: false, own: [], sure: [], typos: [], nominatim: "not_asked", google: "not_set" };
    const query = cleanQuery(q);
    if (!query) return { answer: { places: [] }, ...none };
    const centre = searchCentre(near);
    const language = LANGS.includes(lang) ? lang : "en";
    // Google first when it is on (src/lib/thirtyda-places-google.mjs): anything else only behind it.
    let g = { skipped: "not_set" };
    if (google) {
      try {
        g = await google.search({ q: query, lang: language, centre, force, brand });
      } catch (err) {
        onError(err);
        g = { failed: String(err) };
      }
    }
    const googleWord = g.skipped || (g.failed ? "failed" : g.places?.length ? "asked" : "none");
    if (g.places?.length) {
      // Ours (sure ones only) fill what Google left; Nominatim has nothing Google lacks.
      let fill = [];
      if (g.places.length < PLACES_LIMIT && index && kmBetween(centre, PHNOM_PENH) <= PLACES_INDEX_KM) {
        try {
          const own = await index.search({ q: query, lang: language, centre, limit: PLACES_LIMIT, minTier: brand ? 3 : 0 });
          fill = (own?.places || []).slice(0, Math.max(0, Number(own?.sure) || 0));
        } catch (err) {
          onError(err);
        }
      }
      return { answer: { places: mergePlaces(g.places, fill) }, ours: Boolean(fill.length), own: fill, sure: fill, typos: [], nominatim: "not_asked", google: googleWord };
    }
    const r = await withoutGoogle({ query, language, centre, minTier: brand ? 3 : 0 });
    return { ...r, google: googleWord };
  }

  /**
   * A brand chip's answer: ours as found (strict already; their names may be Khmer or Chinese), the others only with the
   * brand's words in the name; nearest first, each with `km`; at most 6.
   */
  function nearestOfBrand(r, brand, centre) {
    const mine = new Set([...(r.sure || []), ...(r.typos || [])]);
    return (r.answer.places || [])
      .filter((p) => mine.has(p) || brandMatches(p.name, brand))
      .map((p) => ({ p, km: Math.round(kmBetween(centre, p) * 10) / 10 }))
      .sort((a, b) => a.km - b.km)
      .slice(0, PLACES_LIMIT)
      .map(({ p, km }) => ({ ...p, km })); // a copy: Nominatim's cache keeps its own places as they were
  }

  /** The search without Google: our own list, then Nominatim (the whole story in this file's head). */
  async function withoutGoogle({ query, language, centre, minTier = 0 }) {
    // Our own Phnom Penh list first: in memory, forgiving, nothing leaves the server (src/lib/thirtyda-places-index.mjs).
    // Only around Phnom Penh: a person in Siem Reap searching "Brown Coffee" wants the one there, not ours 300 km away.
    const started = Date.now();
    let own = null;
    const ours = Boolean(index && kmBetween(centre, PHNOM_PENH) <= PLACES_INDEX_KM);
    if (ours) {
      try {
        own = await index.search({ q: query, lang: language, centre, limit: PLACES_LIMIT, minTier });
      } catch (err) {
        onError(err);
        own = null;
      }
    }
    const ownPlaces = Array.isArray(own?.places) ? own.places : [];
    const sure = ownPlaces.slice(0, Math.max(0, Number(own?.sure) || 0)); // matched without a typo
    const typos = ownPlaces.slice(sure.length);
    const how = { ours, own: ownPlaces, sure, typos };
    if (sure.length >= PLACES_INDEX_ENOUGH) return { answer: { places: ownPlaces.slice(0, PLACES_LIMIT) }, ...how, nominatim: "not_asked" };
    // Not enough of ours: Nominatim, within what is left of the deadline (the first search after a start may have
    // waited a moment for the stored list).
    const r = await nominatim(query, language, centre, Math.max(1, deadlineMs - (Date.now() - started)));
    const nominatimWord = r.cached ? "cached" : r.busy ? "busy" : r.unavailable ? "unavailable" : "asked";
    if (!ownPlaces.length) return { answer: r, ...how, nominatim: nominatimWord };
    // Ours, then Nominatim's, then our near-misses (a typo): "busy" or "unavailable" does not matter while there is
    // something to pick.
    const answer = { places: mergePlaces(mergePlaces(sure, r.places), typos), ...(r.cached ? { cached: true } : {}) };
    return { answer, ...how, nominatim: nominatimWord };
  }

  /** Nominatim's suggestions for one search: the cache, the shared queue, "busy", the deadline. */
  function nominatim(query, language, centre, timeLeftMs) {
    const key = `${language}|${query.toLowerCase()}|${centre.lat.toFixed(1)},${centre.lng.toFixed(1)}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) {
      cache.delete(key);
      cache.set(key, hit);
      return Promise.resolve({ places: hit.places, cached: true });
    }
    if (hit) cache.delete(key);
    if (inflight.has(key)) return inflight.get(key);
    // The queue is shared with the area names (src/lib/thirtyda-geo.mjs): count every lookup that waits, not only mine.
    if (queued() >= queueMax) return Promise.resolve({ places: [], busy: true });
    waiting++;
    let started = false;
    let late = false; // past the deadline: if its turn has not come yet, it never asks Nominatim
    const url = searchUrl({ q: query, lang: language, near: centre });
    const job = turn(() => {
      started = true;
      waiting--;
      return ask(url);
    }, { skip: () => late })
      .then((places) => {
        if (places === SKIPPED || !Array.isArray(places)) return { places: [], unavailable: true };
        while (cache.size >= cacheMax) cache.delete(cache.keys().next().value);
        cache.set(key, { at: now(), places });
        return { places };
      })
      .catch((err) => {
        onError(err);
        return { places: [], unavailable: true };
      })
      .finally(() => {
        if (!started) waiting--;
      });
    // The whole search, its wait for a turn included, has at most `deadlineMs` (here: what is left of it): the app never
    // shows "Searching…" for long.
    let timer = null;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => {
        late = true;
        resolve({ places: [], unavailable: true });
      }, timeLeftMs);
      timer.unref?.();
    });
    const p = Promise.race([job, deadline]).finally(() => {
      clearTimeout(timer);
      inflight.delete(key);
    });
    inflight.set(key, p);
    return p;
  }

  return { search, size: () => cache.size };
}

/** How long a suggestion's `ref` stays good: time enough to pick a date and a time, and send. */
export const PLACE_REF_TTL_MS = 3600e3;

/**
 * The key place refs are signed with: derived from THIRTYDA_SECRET_KEY when it is set (refs outlive a restart), else
 * random for this process (a restart then only makes a just-picked place name-only).
 */
export function placeRefKey(raw = process.env.THIRTYDA_SECRET_KEY) {
  const s = String(raw ?? "").trim();
  if (/^[0-9a-f]{64}$/i.test(s)) return crypto.createHmac("sha256", Buffer.from(s, "hex")).update("30da place ref v1").digest();
  return crypto.randomBytes(32);
}

/**
 * Places the server itself suggested (review 2026-10-14): every /places suggestion carries `ref`, a signature over the
 * person, the place exactly as checkPlace keeps it (name, address, point) and an expiry (1 hour). POST /pairs/:id/meet
 * keeps a place's address and point only with a good ref (shared/meet.js keptPlace): a card can never name a public
 * café while its map opens somewhere else, and nobody puts 140 characters of their own words under a meeting.
 *   sign(place, uid) → ref | null      ok(place, ref, uid) → boolean (place: as checkPlace gives it)
 */
export function createPlaceRefs({ key = placeRefKey(), ttlMs = PLACE_REF_TTL_MS, now = () => Date.now() } = {}) {
  const mac = (uid, exp, p) => crypto.createHmac("sha256", key)
    .update(JSON.stringify([String(uid), exp, p.name, p.address ?? null, p.lat ?? null, p.lng ?? null]))
    .digest("base64url")
    .slice(0, 32);

  function sign(place, uid) {
    const c = checkPlace(place);
    if (!c.ok) return null;
    const exp = Math.ceil((now() + ttlMs) / 1000);
    return `${exp.toString(36)}.${mac(uid, exp, c.place)}`;
  }

  function ok(place, ref, uid) {
    const m = /^([0-9a-z]{1,12})\.([A-Za-z0-9_-]{32})$/.exec(typeof ref === "string" ? ref : "");
    if (!m || !place) return false;
    const exp = parseInt(m[1], 36);
    if (!(exp * 1000 > now())) return false;
    const want = Buffer.from(mac(uid, exp, place));
    const got = Buffer.from(m[2]);
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  }

  return { sign, ok };
}
