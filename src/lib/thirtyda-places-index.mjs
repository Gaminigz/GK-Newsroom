/**
 * 30+DA · our own list of places to meet at in greater Phnom Penh (owner 2026-10-15: the search for "Browns" said "No
 * places found" — OpenStreetMap's Nominatim matches whole words only, and the café is "Brown Coffee"). GET
 * /30da/api/places searches it FIRST (src/lib/thirtyda-places.mjs createPlaceSearch({ index })): in memory, nothing
 * leaves the server, and forgiving — plurals, synonyms, area words ("tk", "BKK1", "riverside" pick the area instead of
 * matching the name), word starts, small typos, any part of a Khmer / Chinese / Korean / Japanese name — ranked the
 * whole name first, then nearer to the person (src/thirtyda-app/shared/place-match.js). Fewer than 3 hits: Nominatim
 * as before, its suggestions after ours. Only for a search around Phnom Penh, and only places within 30 km of the
 * person (thirtyda-places.mjs PLACES_INDEX_KM).
 *
 * The list: ONE Overpass API query (overpass-api.de: OpenStreetMap's data, our User-Agent, once a week — its usage
 * policy asks for under 10,000 queries and 1 GB a day) for every NAMED cafe, restaurant, bar, pub, fast_food,
 * food_court, ice_cream (amenity), mall, bakery, supermarket (shop), park, garden (leisure), attraction, museum,
 * viewpoint, hotel (tourism) in a box a little larger than Phnom Penh (INDEX_BOX). Kept of each, one compact row: its
 * id, kind, point (a way's or a relation's centre: "out center"), names (name, name:en / km / zh / ko / ja, brand),
 * branch, street and area tags (addr:street; addr:suburb / district / city_district). ~1,500–3,000 rows.
 *
 * Kept where: in memory, plus ONE copy (gzip'd JSON, ~50–150 KB; refused over INDEX_MAX_BYTES): the Mongo doc
 * thirtyda_places_index/'phnom-penh' on the live server (THIRTYDA_PHOTO_STORE=mongo — an M0 cluster, 512 MB in all),
 * else the file .data/30da-places-index.json.gz (gitignored). Fresh for 7 days (INDEX_MAX_AGE_MS):
 *   - the first search after a start waits for the stored copy at most INDEX_WAIT_MS; no copy (yet) → Nominatim alone;
 *   - a search on an old copy is answered from it at once and starts ONE refresh in the background — never more than
 *     one at a time; it first reads the stored copy again (another server may have refreshed it), then asks Overpass;
 *   - a refresh that fails (no answer, an error, an Overpass "runtime error" remark, fewer than INDEX_MIN_ROWS places)
 *     keeps the old copy and is not tried again for INDEX_RETRY_MS (an hour).
 *
 * Each suggestion is made like a Nominatim one: the name in the person's language (name:<lang>, else for zh / ko / ja
 * name:en, else name), checked (a contact detail or a bad word: never offered), and a short address line through
 * thirtyda-places.mjs addressLine — branch, street, area (the area tag, else the area of PLACE_AREAS the point is in);
 * no house number, no postcode, read with the name by the same checks — or "Phnom Penh" when there is nothing else.
 * The route signs it (`ref`) like any other. ODbL: the sheet that shows suggestions credits "© OpenStreetMap contributors".
 *
 *   createPlaceIndex({ fetchImpl, store, now, … }) → { search({ q, lang, centre, limit }) → { places, sure } | null,
 *   refresh({ force }), load(), info() }      (fetchImpl, store and the clock: for tests — no network, no Mongo there)
 *   refresh({ force: true }): Overpass even when the stored copy is fresh (the Code page's Tower 12 "Refresh now").
 *   info(): what Tower 12 shows — the list's time and size, where it is kept, a refresh on its way, the last Overpass
 *   ask and the last error (its words only: never a key, there is none).
 *   `sure`: how many of the places (they come first) matched without a typo; only those count as "enough" to leave
 *   Nominatim out — a search that found only near-misses still asks it, and its near-misses come after Nominatim's. A
 *   search for a kind of place this list does not hold (a pagoda, a market: place-match.js `elsewhere`) counts only a
 *   whole name as sure: the rest are near-misses, after Nominatim's real pagodas and markets.
 */
import { gzipSync, gunzipSync } from "node:zlib";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { NOMINATIM_UA } from "./thirtyda-nominatim.mjs";
import { PLACES_LIMIT, PLACES_INDEX_KM, PHNOM_PENH, addressLine, passes, tidyArea, sameSpot } from "./thirtyda-places.mjs";
import { placeEntry, placeQuery, matchPlaces, areaLabel } from "../thirtyda-app/shared/place-match.js";
import { PLACE_NAME_MAX, cleanLine, cutLine } from "../thirtyda-app/shared/meet.js";

export const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
/** Greater Phnom Penh, a little larger than the city (11.45–11.65 N, 104.80–105.00 E). */
export const INDEX_BOX = Object.freeze({ south: 11.4, west: 104.75, north: 11.72, east: 105.05 });
/** What is kept: the OpenStreetMap key and its values. Named places only. */
export const INDEX_KINDS = Object.freeze({
  amenity: Object.freeze(["cafe", "restaurant", "bar", "pub", "fast_food", "food_court", "ice_cream"]),
  shop: Object.freeze(["mall", "bakery", "supermarket"]),
  leisure: Object.freeze(["park", "garden"]),
  tourism: Object.freeze(["attraction", "museum", "viewpoint", "hotel"]),
});
export const INDEX_MAX_AGE_MS = 7 * 864e5;
export const INDEX_RETRY_MS = 3600e3;
/** The first search after a start waits at most this long for the stored copy (then Nominatim alone, this time). */
export const INDEX_WAIT_MS = 1000;
export const OVERPASS_TIMEOUT_MS = 120e3;
/** An answer with fewer places than this is taken for a broken one: the old copy stays. */
export const INDEX_MIN_ROWS = 50;
export const INDEX_MAX_ROWS = 12000;
/** The stored copy, gzip'd, at most (the M0 cluster has 512 MB in all). */
export const INDEX_MAX_BYTES = 1e6;
export const INDEX_COLLECTION = "thirtyda_places_index";
export const INDEX_DOC = "phnom-penh";
const COPY_VERSION = 1;

// One row: [id, kind, lat, lng, name, name:en, name:km, name:zh, name:ko, name:ja, brand, branch, addr:street, area].
export const ROW = Object.freeze({
  id: 0, kind: 1, lat: 2, lng: 3, name: 4, en: 5, km: 6, zh: 7, ko: 8, ja: 9, brand: 10, branch: 11, street: 12, area: 13,
});
const NAME_TAGS = ["name", "name:en", "name:km", "name:zh", "name:ko", "name:ja", "brand"];
const AREA_TAGS = ["addr:suburb", "addr:district", "addr:city_district", "addr:quarter", "addr:neighbourhood"];
const LANG_COL = { en: ROW.en, km: ROW.km, zh: ROW.zh, ko: ROW.ko, ja: ROW.ja };
const CITY = { en: "Phnom Penh", km: "ភ្នំពេញ" };
const TAG_MAX = 100;

const round6 = (n) => Math.round(n * 1e6) / 1e6;
const tag = (v) => cutLine(cleanLine(v), TAG_MAX);

/** The Overpass QL of the one query: every named place of INDEX_KINDS in the box, a way's / relation's centre. */
export function overpassQuery(box = INDEX_BOX) {
  const b = [box.south, box.west, box.north, box.east].join(",");
  const lines = Object.entries(INDEX_KINDS).map(([key, vals]) => `  nwr["${key}"~"^(${vals.join("|")})$"]["name"](${b});`);
  return `[out:json][timeout:90];\n(\n${lines.join("\n")}\n);\nout center qt;`;
}

const inBox = (box, lat, lng) => lat >= box.south && lat <= box.north && lng >= box.west && lng <= box.east;

/** The kind of a place: the first of its tags in INDEX_KINDS (a café that is also a bakery is a café). */
function kindOf(tags) {
  for (const [key, vals] of Object.entries(INDEX_KINDS)) if (vals.includes(tags[key])) return tags[key];
  return null;
}

/** Overpass's answer → compact rows: named places of our kinds with a point in the box, each once. */
export function rowsFromOverpass(json, box = INDEX_BOX) {
  const rows = [];
  const seen = new Set();
  for (const el of Array.isArray(json?.elements) ? json.elements : []) {
    const tags = el?.tags && typeof el.tags === "object" ? el.tags : null;
    if (!tags) continue;
    const lat = Number(el.lat ?? el.center?.lat);
    const lng = Number(el.lon ?? el.center?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inBox(box, lat, lng)) continue;
    const kind = kindOf(tags);
    if (!kind) continue;
    const names = NAME_TAGS.map((k) => tag(tags[k]));
    if (!names[0] && !names[1]) continue; // nothing to call it by
    const id = `${String(el.type ?? "x").charAt(0)}${el.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const area = AREA_TAGS.map((k) => tag(tags[k])).find(Boolean) || "";
    rows.push([id, kind, round6(lat), round6(lng), ...names, tag(tags.branch), tag(tags["addr:street"]), area]);
  }
  return rows.length > INDEX_MAX_ROWS ? rows.slice(0, INDEX_MAX_ROWS) : rows;
}

/** A stored copy { at, rows } as bytes (gzip'd JSON), and back (null when it is not one of ours). */
export function encodeCopy({ at, rows }) {
  return gzipSync(JSON.stringify({ v: COPY_VERSION, at, rows }));
}
export function decodeCopy(bytes) {
  let j = null;
  try {
    j = JSON.parse(gunzipSync(bytes).toString("utf8"));
  } catch {
    return null; // a broken copy is no copy: the next refresh writes a good one over it
  }
  if (j?.v !== COPY_VERSION || !Number.isFinite(j.at) || !Array.isArray(j.rows)) return null;
  return { at: j.at, rows: j.rows.filter((r) => Array.isArray(r) && r.length > ROW.area) };
}

/** A row ready to search (shared/place-match.js placeEntry): every name it goes by, its kind, point and address words. */
export function entryOf(row) {
  return placeEntry({
    names: [row[ROW.name], row[ROW.en], row[ROW.km], row[ROW.zh], row[ROW.ko], row[ROW.ja], row[ROW.brand]],
    kind: row[ROW.kind],
    lat: row[ROW.lat],
    lng: row[ROW.lng],
    areaText: [row[ROW.street], row[ROW.area], row[ROW.branch]].join(" "),
  }, row);
}

/**
 * One row → a suggestion { name, address, lat, lng } in the person's language, exactly like a Nominatim one — or null
 * when its name would be stopped (a contact detail, a bad word) or is too short.
 */
export function placeFromRow(row, lang = "en") {
  const own = row[LANG_COL[lang] ?? ROW.en];
  const fallback = lang === "km" || lang === "en" ? "" : row[ROW.en];
  const name = cutLine(cleanLine(own || fallback || row[ROW.name] || row[ROW.en]), PLACE_NAME_MAX);
  if (Array.from(name).length < 2 || !passes(name)) return null;
  const lat = Number(row[ROW.lat]);
  const lng = Number(row[ROW.lng]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const area = tidyArea(row[ROW.area]) || areaLabel(lat, lng, lang) || "";
  const address = addressLine(name, [row[ROW.branch], row[ROW.street], area])
    ?? addressLine(name, [CITY[lang] ?? CITY.en]);
  return { name, address, lat: round6(lat), lng: round6(lng) };
}

/**
 * The suggestions for one search, best first: { sure, typos } — the matches (shared/place-match.js) within `maxKm` of
 * the centre made into places, those found only through a typo apart (at most `limit` of each; for a pagoda or a
 * market — `elsewhere` — every match but a whole name is apart too). A place whose name the checks stop is left out,
 * and one place is offered once (sameSpot: the better / nearer one) — two branches with the same name and the same area
 * line are two places, both offered, nearer first.
 */
export function rankRows(entries, q, { lang = "en", centre = PHNOM_PENH, limit = PLACES_LIMIT, maxKm = PLACES_INDEX_KM } = {}) {
  const sure = [];
  const typos = [];
  const query = placeQuery(q);
  for (const m of matchPlaces(entries, query, { centre, limit: 0 })) {
    if (m.km > maxKm) continue; // ours are Phnom Penh's: never 300 km from the person
    const list = m.tier > 1 && (m.tier === 4 || !query.elsewhere) ? sure : typos;
    if (list.length >= limit) {
      if (sure.length >= limit) break;
      continue;
    }
    const p = placeFromRow(m.entry.data, lang);
    if (!p) continue;
    if (sure.some((o) => sameSpot(o, p)) || typos.some((o) => sameSpot(o, p))) continue;
    list.push(p);
  }
  return { sure, typos };
}

/** The suggestions for one search as one list: the sure ones, then the typo ones; at most `limit`. */
export function searchRows(entries, q, opts = {}) {
  const { sure, typos } = rankRows(entries, q, opts);
  return [...sure, ...typos].slice(0, opts.limit ?? PLACES_LIMIT);
}

// ---------------------------------------------------------------- the stored copy

/** In memory: the unit tests. */
export function memoryIndexStore(copy = null) {
  let bytes = copy ? encodeCopy(copy) : null;
  const store = {
    kind: "memory",
    saves: 0,
    async load() { return bytes ? decodeCopy(bytes) : null; },
    async save(c) { bytes = encodeCopy(c); store.saves++; },
    bytes: () => bytes,
  };
  return store;
}

/** A file (dev): <repo>/.data/30da-places-index.json.gz, gitignored like the photos. */
export function fileIndexStore(file = new URL("../../.data/30da-places-index.json.gz", import.meta.url)) {
  return {
    kind: "local",
    async load() {
      try {
        return decodeCopy(await readFile(file));
      } catch (err) {
        if (err?.code === "ENOENT") return null;
        throw err;
      }
    },
    async save(copy) {
      const bytes = encodeCopy(copy);
      if (bytes.length > INDEX_MAX_BYTES) throw new Error(`places index: ${bytes.length} bytes is too big to keep`);
      await mkdir(new URL("./", file), { recursive: true });
      const tmp = new URL(`${file.pathname.split("/").pop()}.tmp`, file);
      await writeFile(tmp, bytes);
      await rename(tmp, file); // never half a file
    },
  };
}

/** Bytes from what the driver gives back for a stored Buffer (a BSON Binary, or a Buffer / Uint8Array). */
function bytesOf(v) {
  if (!v) return null;
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return Buffer.from(v);
  if (typeof v.read === "function" && typeof v.length === "function") return Buffer.from(v.read(0, v.length()));
  if (v.buffer instanceof Uint8Array) return Buffer.from(v.buffer);
  return null;
}

/**
 * One Mongo doc (the live server): thirtyda_places_index/'phnom-penh' { v, at, count, bytes, gz } — the gzip'd copy, a
 * few hundred KB at most, written over in place (never a second doc). dbFn: the server's getDb (src/lib/mongo.ts).
 */
export function mongoIndexStore(dbFn = null) {
  const coll = async () => {
    const getDb = dbFn ?? (await import("./mongo.ts")).getDb;
    return (await getDb()).collection(INDEX_COLLECTION);
  };
  return {
    kind: "mongo",
    async load() {
      const doc = await (await coll()).findOne({ _id: INDEX_DOC });
      const bytes = bytesOf(doc?.gz);
      return bytes ? decodeCopy(bytes) : null;
    },
    async save(copy) {
      const gz = encodeCopy(copy);
      if (gz.length > INDEX_MAX_BYTES) throw new Error(`places index: ${gz.length} bytes is too big to keep`);
      await (await coll()).replaceOne(
        { _id: INDEX_DOC },
        { v: COPY_VERSION, at: new Date(copy.at), count: copy.rows.length, bytes: gz.length, gz },
        { upsert: true },
      );
    },
  };
}

/** The store the live server uses: Mongo when the photos are there (THIRTYDA_PHOTO_STORE=mongo), else the file. */
export const defaultIndexStore = (env = process.env) => (
  env.THIRTYDA_PHOTO_STORE === "mongo" ? mongoIndexStore() : fileIndexStore()
);

// ---------------------------------------------------------------- the list itself

/**
 * The place list of one server: loaded from its store, refreshed from Overpass when older than 7 days. fetchImpl(url,
 * init): the server's outbound fetch (src/lib/thirtyda-test-fetch.mjs may answer it on the dev server); store: where
 * the copy is kept; now: the clock. All for tests.
 */
export function createPlaceIndex({
  fetchImpl = (url, init) => globalThis.fetch(url, init),
  store = defaultIndexStore(),
  now = () => Date.now(),
  box = INDEX_BOX,
  maxAgeMs = INDEX_MAX_AGE_MS,
  retryMs = INDEX_RETRY_MS,
  waitMs = INDEX_WAIT_MS,
  timeoutMs = OVERPASS_TIMEOUT_MS,
  minRows = INDEX_MIN_ROWS,
  onError = (err) => console.error("[30da places index]", err instanceof Error ? err.message : err),
} = {}) {
  let current = null; // { at, rows, entries }
  let loading = null; // the stored copy's first load (once)
  let loaded = false; // that load is over (found or not)
  let waited = false; // a search already waited for it
  let refreshing = null; // the refresh on its way (one at a time)
  let failedAt = -Infinity; // the last refresh that failed
  let fetches = 0;
  let askedAt = null; // the last time Overpass was asked (ok or not)
  let okAt = null; // the last time Overpass answered with a good list
  let lastError = null; // { at, message } — the last thing that went wrong (load, Overpass, save)
  let sized = null; // { at, bytes }: the current copy's size, gzip'd (worked out once, for info())

  const noteError = (err) => {
    lastError = { at: now(), message: String(err instanceof Error ? err.message : err).slice(0, 200) };
    onError(err);
  };

  const use = (copy) => {
    if (!copy?.rows?.length) return false;
    if (current && current.at >= copy.at) return false; // never back to an older copy
    current = { at: copy.at, rows: copy.rows, entries: copy.rows.map(entryOf) };
    return true;
  };

  function load() {
    loading ??= Promise.resolve()
      .then(() => store.load())
      .then((copy) => { use(copy); })
      .catch((err) => noteError(err))
      .finally(() => { loaded = true; });
    return loading;
  }

  async function fromOverpass() {
    fetches++;
    askedAt = now();
    const res = await fetchImpl(OVERPASS_URL, {
      method: "POST",
      headers: {
        "User-Agent": NOMINATIM_UA,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ data: overpassQuery(box) }).toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res?.ok) throw new Error(`overpass HTTP ${res?.status}`);
    const json = await res.json();
    // Overpass answers 200 with a "remark" when the query ran out of time or memory: the elements are then partial.
    const remark = String(json?.remark ?? "");
    if (/error|timed out|out of memory/i.test(remark)) throw new Error(`overpass: ${remark.slice(0, 160)}`);
    const rows = rowsFromOverpass(json, box);
    if (rows.length < minRows) throw new Error(`overpass: only ${rows.length} places`);
    okAt = now();
    return rows;
  }

  /**
   * Refresh now (one at a time: a second call gets the same one). → true when the list is fresh after it. force: ask
   * Overpass even when the stored copy is fresh (the admin's "Refresh now").
   */
  function refresh({ force = false } = {}) {
    refreshing ??= (async () => {
      try {
        // Another server (or an earlier run) may have stored a fresh copy meanwhile: then no need to ask Overpass.
        const stored = await Promise.resolve().then(() => store.load()).catch((err) => { noteError(err); return null; });
        if (!force && stored && now() - stored.at < maxAgeMs) {
          use(stored);
          return true;
        }
        const copy = { at: now(), rows: await fromOverpass() };
        use(copy);
        await Promise.resolve().then(() => store.save(copy)).catch((err) => noteError(err)); // in memory it is fresh anyway
        return true;
      } catch (err) {
        failedAt = now();
        noteError(err);
        return false; // the old copy stays
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  const stale = () => !current || now() - current.at >= maxAgeMs;

  /** Starts a refresh when the list is old (or missing), none is on its way, and the last failure is an hour ago. */
  function maybeRefresh() {
    if (loaded && !refreshing && stale() && now() - failedAt >= retryMs) refresh();
  }

  /**
   * The suggestions for one search: { places, sure } — `sure` of them (first) matched without a typo — or null while
   * there is no list (then Nominatim alone, as before).
   */
  async function search({ q, lang = "en", centre = PHNOM_PENH, limit = PLACES_LIMIT } = {}) {
    if (!loaded && !waited) {
      waited = true; // a store that hangs costs one search a moment, not every search
      let timer = null;
      await Promise.race([load(), new Promise((r) => { timer = setTimeout(r, waitMs); timer.unref?.(); })]);
      clearTimeout(timer);
    }
    maybeRefresh(); // in the background: this search is answered from what there is now
    if (!current) return null;
    const { sure, typos } = rankRows(current.entries, q, { lang, centre, limit });
    return { places: [...sure, ...typos].slice(0, limit), sure: sure.length };
  }

  return {
    search,
    refresh,
    load,
    info,
  };

  /** What the Code page's Tower 12 shows. bytes: the list gzip'd, as it is kept (worked out once per list). */
  function info() {
    if (current && sized?.at !== current.at) sized = { at: current.at, bytes: encodeCopy(current).length };
    return {
      at: current?.at ?? null,
      count: current?.rows.length ?? 0,
      bytes: current ? sized.bytes : 0,
      store: store.kind ?? null,
      loaded,
      stale: stale(),
      refreshing: Boolean(refreshing),
      fetches,
      askedAt,
      okAt,
      failedAt: Number.isFinite(failedAt) ? failedAt : null,
      // A failed refresh is not tried again by a search before this (the admin's "Refresh now" may).
      retryAt: Number.isFinite(failedAt) && stale() ? failedAt + retryMs : null,
      lastError,
      maxAgeMs,
    };
  }
}
