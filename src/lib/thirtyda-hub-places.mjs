/**
 * 30+DA · GK API Hub, Tower 12 · Places on the admin Code page (owner 2026-10-15): our own Phnom Penh place list
 * (src/lib/thirtyda-places-index.mjs, searched first by GET /30da/api/places) — how it is, a "Refresh now", and a test
 * search that shows our hits and whether Nominatim was asked. The list and the search are the server's own ones
 * (src/lib/thirtyda-meet.mjs placeIndex / placeSearch): a refresh here is the app's refresh, a test search uses the
 * same cache and the same 1-per-second Nominatim queue.
 *
 *   placesAdminView(index, { now }) → the page's `places` block { status, at, ageS, count, bytes, store, refreshing,
 *     askedAt, okAt, retryAt, nextAt, lastError, maxAgeDays, source }   status: 'live' | 'old' | 'none' | 'refreshing'
 *   refreshPlaces(index, { now }) → { ok: true } (started, in the background: Overpass takes up to 2 minutes) |
 *     { ok: false, reason: 'busy' | 'too_soon', error }   at most once every REFRESH_GAP_MS (Overpass's usage policy)
 *   placesTry(search, { q, lang }) → { q, lang, places: [{ name, address, lat, lng, from }], ours, own, sure, nominatim,
 *     busy?, unavailable?, ms } | { error } — never signed (no `ref`): the page shows them, nobody can send one.
 *
 * Not here (owner: "only if I say so"): a Google Places key.
 */
import { LANGS } from "../thirtyda-app/shared/rules.js";
import { cleanQuery } from "./thirtyda-places.mjs";

/** "Refresh now" at most this often: Overpass asks for few, big queries. */
export const REFRESH_GAP_MS = 5 * 60e3;
/** The page waits at most this long for the stored copy's first load (then it shows what there is). */
export const VIEW_WAIT_MS = 1500;

const iso = (t) => (Number.isFinite(t) ? new Date(t).toISOString() : null);

export async function placesAdminView(index, { now = Date.now(), waitMs = VIEW_WAIT_MS } = {}) {
  // The list loads on the first search after a start: the page loads it too, so it shows what is stored.
  let timer = null;
  await Promise.race([
    Promise.resolve().then(() => index.load()).catch(() => {}),
    new Promise((r) => { timer = setTimeout(r, waitMs); timer.unref?.(); }),
  ]);
  clearTimeout(timer);
  const i = index.info();
  const status = i.refreshing ? "refreshing" : !i.count ? "none" : i.stale ? "old" : "live";
  return {
    status,
    at: iso(i.at),
    ageS: Number.isFinite(i.at) ? Math.max(0, Math.round((now - i.at) / 1000)) : null,
    count: i.count,
    bytes: i.bytes,
    store: i.store,
    refreshing: i.refreshing,
    askedAt: iso(i.askedAt),
    okAt: iso(i.okAt),
    retryAt: iso(i.retryAt),
    // A search after this starts a refresh by itself.
    nextAt: Number.isFinite(i.at) ? iso(i.at + i.maxAgeMs) : null,
    lastError: i.lastError ? { at: iso(i.lastError.at), message: i.lastError.message } : null,
    maxAgeDays: Math.round(i.maxAgeMs / 864e5),
    canRefreshAt: Number.isFinite(i.askedAt) && now - i.askedAt < REFRESH_GAP_MS ? iso(i.askedAt + REFRESH_GAP_MS) : null,
    source: "OpenStreetMap (Overpass API)",
  };
}

export function refreshPlaces(index, { now = Date.now() } = {}) {
  const i = index.info();
  if (i.refreshing) return { ok: false, reason: "busy", error: "A refresh is already on its way." };
  if (Number.isFinite(i.askedAt) && now - i.askedAt < REFRESH_GAP_MS) {
    const min = Math.ceil((i.askedAt + REFRESH_GAP_MS - now) / 60e3);
    return { ok: false, reason: "too_soon", error: `OpenStreetMap was asked a moment ago. Try again in ${min} min.` };
  }
  // In the background: the page asks again every few seconds while it runs. A failure keeps the old list.
  index.refresh({ force: true }).catch(() => {});
  return { ok: true };
}

export async function placesTry(search, { q, lang } = {}) {
  const query = cleanQuery(q);
  if (!query) return { error: "Type at least 2 letters of a place." };
  const language = LANGS.includes(lang) ? lang : "en";
  const started = Date.now();
  // near: null → around Phnom Penh, like a person whose point is not known.
  const r = await search.search({ q: query, lang: language, near: null, explain: true });
  const e = r.explain || { ours: false, own: 0, sure: 0, nominatim: "not_asked", from: [] };
  return {
    q: query,
    lang: language,
    places: (r.places || []).map((p, n) => ({ name: p.name, address: p.address ?? null, lat: p.lat, lng: p.lng, from: e.from[n] || "nominatim" })),
    ours: e.ours,
    own: e.own,
    sure: e.sure,
    nominatim: e.nominatim,
    ...(r.busy ? { busy: true } : {}),
    ...(r.unavailable ? { unavailable: true } : {}),
    ms: Date.now() - started,
  };
}
