// Run: npm run 30da:test (or node --test src/lib/thirtyda-places.test.mjs)
// The meeting place search (owner 2026-10-14, src/lib/thirtyda-places.mjs): what we ask OpenStreetMap's Nominatim (Cambodia
// first, around the person, in their language), the suggestions we keep (no house numbers or postcodes, nothing the chat's
// checks would stop), the cache, the shared 1-per-second queue, "busy", and the 3-second timeout. A fake fetch only:
// these tests never reach Nominatim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PHNOM_PENH, PLACES_LIMIT, PLACES_TIMEOUT_MS, searchCentre, parseNear, viewboxAround, cleanQuery, searchUrl, placeFromResult,
  placesFrom, createPlaceSearch,
} from './thirtyda-places.mjs';
import { NOMINATIM_UA, NOMINATIM_ORIGIN, makeThrottle, nominatimTurn } from './thirtyda-nominatim.mjs';
import { findContactDetails } from '../thirtyda-app/shared/rules.js';

const BROWN = {
  lat: '11.5728123', lon: '104.8999456', name: 'Brown Coffee',
  display_name: "Brown Coffee, 110, Russian Federation Boulevard, Sangkat Tuek L'ak Ti Muoy, Khan Tuol Kouk, Phnom Penh, 120408, Cambodia",
  address: {
    amenity: 'Brown Coffee', house_number: '110', road: 'Russian Federation Boulevard', suburb: "Sangkat Tuek L'ak Ti Muoy",
    city_district: 'Khan Tuol Kouk', city: 'Phnom Penh', postcode: '120408', country: 'Cambodia', country_code: 'kh',
  },
};

/** A fetch that answers from `reply(url)` and remembers every call. */
function fakeFetch(reply = () => [BROWN]) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: new URL(String(url)), init });
    const out = await reply(new URL(String(url)), init);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  fn.calls = calls;
  return fn;
}
const instant = (fn) => fn(); // a turn that never waits

// ---------------------------------------------------------------- what we ask

test('the search address: Cambodia first, around the person (or Phnom Penh), 6 results, in the app language', () => {
  const u = searchUrl({ q: '  Brown   Coffee TK ', lang: 'km', near: { lat: 11.5731, lng: 104.9012 } });
  assert.equal(u.origin, NOMINATIM_ORIGIN);
  assert.equal(u.pathname, '/search');
  const p = Object.fromEntries(u.searchParams);
  assert.deepEqual(p, {
    q: 'Brown Coffee TK', format: 'jsonv2', addressdetails: '1', countrycodes: 'kh', viewbox: '104.70,11.77,105.10,11.37',
    bounded: '0', limit: String(PLACES_LIMIT), 'accept-language': 'km',
  });
  assert.equal(PLACES_LIMIT, 6);
  assert.equal(searchUrl({ q: 'x', lang: 'fr' }).searchParams.get('accept-language'), 'en', 'only the 5 app languages');
  assert.equal(viewboxAround(null), '104.73,11.76,105.13,11.36', 'no point → around Phnom Penh');
});

test('the search centre: rounded to 2 decimals (≈ 1 km); outside Cambodia or unknown → Phnom Penh', () => {
  assert.deepEqual(searchCentre({ lat: 11.57312, lng: 104.90127 }), { lat: 11.57, lng: 104.9 });
  assert.deepEqual(searchCentre({ lat: 13.3633, lng: 103.8564 }), { lat: 13.36, lng: 103.86 }, 'Siem Reap is Cambodia');
  assert.deepEqual(searchCentre({ lat: 1.29, lng: 103.85 }), PHNOM_PENH, 'Singapore → Phnom Penh');
  assert.deepEqual(searchCentre(null), PHNOM_PENH);
  assert.deepEqual(searchCentre({ lat: 'x', lng: 1 }), PHNOM_PENH);
  assert.deepEqual(parseNear('11.57,104.92'), { lat: 11.57, lng: 104.92 });
  assert.deepEqual(parseNear(' -1.5 , 2 '), { lat: -1.5, lng: 2 });
  for (const bad of ['', '11.57', 'a,b', '11.57,104.92,3', null]) assert.equal(parseNear(bad), null, String(bad));
  assert.equal(cleanQuery(' b '), '', 'at least 2 characters');
  assert.equal(cleanQuery('x'.repeat(81)), '', 'at most 80');
  assert.equal(cleanQuery(' Brown\n Coffee '), 'Brown Coffee');
});

// ---------------------------------------------------------------- what we keep

test('a suggestion: name, a short address (road, area, city — no house number, no postcode), the point', () => {
  assert.deepEqual(placeFromResult(BROWN), {
    name: 'Brown Coffee', address: "Russian Federation Boulevard, Tuek L'ak Ti Muoy, Phnom Penh", lat: 11.572812, lng: 104.899946,
  });
  // House numbers and postcodes stay out: with them a plain address reads like a phone number to the chat's check.
  const corner = { lat: '11.55', lon: '104.92', name: 'Corner Cafe', address: { house_number: '25', road: 'Street 214', city: 'Phnom Penh', postcode: '12211' } };
  assert.equal(findContactDetails('#25 Street 214, Phnom Penh 12211').ok, false);
  assert.equal(placeFromResult(corner).address, 'Street 214, Phnom Penh');
  assert.equal(findContactDetails(placeFromResult(corner).address).ok, true);
  assert.doesNotMatch(placeFromResult(BROWN).address, /110|120408/);
  // No name of its own (a street, an address): the first part of the display name.
  assert.equal(placeFromResult({ lat: '11.5', lon: '104.9', name: '', display_name: 'Street 271, Phnom Penh', address: { road: 'Street 271', city: 'Phnom Penh' } }).name, 'Street 271');
  // Khmer names (accept-language km) pass as they are.
  assert.equal(placeFromResult({ ...BROWN, name: 'ប្រោនកាហ្វេ' }).name, 'ប្រោនកាហ្វេ');
});

test('a suggestion the app would stop is never offered: a contact detail or a bad word in the name; such address parts are left out', () => {
  assert.equal(placeFromResult({ ...BROWN, name: 'Call 012 345 678' }), null);
  assert.equal(placeFromResult({ ...BROWN, name: 'Telegram Cafe' }), null, 'a chat app name');
  assert.equal(placeFromResult({ ...BROWN, name: 'fuck cafe' }), null);
  const odd = placeFromResult({ ...BROWN, address: { ...BROWN.address, road: 'Street 012 345 678' } });
  assert.equal(odd.address, "Tuek L'ak Ti Muoy, Phnom Penh", 'the road that reads like a phone number is dropped');
  for (const bad of [{ ...BROWN, lat: 'x' }, { ...BROWN, lon: undefined }, { ...BROWN, lat: '95' }, null, {}]) assert.equal(placeFromResult(bad), null);
  // At most 6, each place once.
  const many = Array.from({ length: 9 }, (_, i) => ({ ...BROWN, name: `Cafe ${String.fromCharCode(65 + i)}` }));
  assert.equal(placesFrom([...many, BROWN, BROWN]).length, 6);
  assert.equal(placesFrom([BROWN, BROWN, { ...BROWN, name: 'Brown Coffee' }]).length, 1);
  assert.deepEqual(placesFrom('nonsense'), []);
});

// ---------------------------------------------------------------- the proxy

test('proxy: our User-Agent and a timeout signal on every request; the answer as suggestions', async () => {
  const fetchImpl = fakeFetch();
  const s = createPlaceSearch({ fetchImpl, turn: instant });
  const r = await s.search({ q: 'brown coffee', lang: 'en', near: { lat: 11.57, lng: 104.9 } });
  assert.deepEqual(r, { places: [placeFromResult(BROWN)] });
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].init.headers['User-Agent'], NOMINATIM_UA);
  assert.match(NOMINATIM_UA, /^30DA\/1\.0 \(.+@.+\)$/, 'says who we are, with a contact');
  assert.ok(fetchImpl.calls[0].init.signal instanceof AbortSignal);
  assert.equal(fetchImpl.calls[0].url.searchParams.get('q'), 'brown coffee');
  assert.equal(PLACES_TIMEOUT_MS, 3000);
  assert.deepEqual(await s.search({ q: 'b' }), { places: [] }, 'too short: nothing asked');
  assert.equal(fetchImpl.calls.length, 1);
});

test('proxy cache: the same search (any case, any spacing, same area, same language) is asked once; 24 hours, then again', async () => {
  let now = 1_000_000;
  const fetchImpl = fakeFetch();
  const s = createPlaceSearch({ fetchImpl, turn: instant, now: () => now });
  await s.search({ q: 'Brown Coffee', lang: 'en', near: { lat: 11.571, lng: 104.902 } });
  const again = await s.search({ q: '  brown   coffee ', lang: 'en', near: { lat: 11.574, lng: 104.899 } });
  assert.equal(again.cached, true);
  assert.equal(fetchImpl.calls.length, 1);
  await s.search({ q: 'Brown Coffee', lang: 'km', near: { lat: 11.571, lng: 104.902 } });
  assert.equal(fetchImpl.calls.length, 2, 'another language is another answer');
  await s.search({ q: 'Brown Coffee', lang: 'en', near: { lat: 13.36, lng: 103.86 } });
  assert.equal(fetchImpl.calls.length, 3, 'another area (Siem Reap) is another answer');
  now += 24 * 3600e3;
  const stale = await s.search({ q: 'Brown Coffee', lang: 'en', near: { lat: 11.571, lng: 104.902 } });
  assert.equal(stale.cached, undefined);
  assert.equal(fetchImpl.calls.length, 4, 'after 24 hours it is asked again');
  // Two at once: one request.
  const [a, b] = await Promise.all([s.search({ q: 'Wat Phnom' }), s.search({ q: 'wat phnom' })]);
  assert.deepEqual(a, b);
  assert.equal(fetchImpl.calls.length, 5);
});

test('proxy cache: a full cache drops its oldest search', async () => {
  const fetchImpl = fakeFetch();
  const s = createPlaceSearch({ fetchImpl, turn: instant, cacheMax: 2 });
  for (const q of ['aa', 'bb', 'cc']) await s.search({ q });
  assert.equal(s.size(), 2);
  await s.search({ q: 'aa' });
  assert.equal(fetchImpl.calls.length, 4, '"aa" was dropped');
  await s.search({ q: 'cc' });
  assert.equal(fetchImpl.calls.length, 4, '"cc" is still there');
});

test('the queue: at most one Nominatim request a second (the next starts a second after the one before)', async () => {
  let clock = 0;
  const slept = [];
  const turn = makeThrottle({ now: () => clock, sleep: async (ms) => { slept.push(ms); clock += ms; } });
  const started = [];
  const job = (name, takes = 0) => turn(async () => { started.push([name, clock]); clock += takes; return name; });
  const out = await Promise.all([job('a', 200), job('b', 1500), job('c'), job('d')]);
  assert.deepEqual(out, ['a', 'b', 'c', 'd']);
  assert.deepEqual(started, [['a', 0], ['b', 1000], ['c', 2500], ['d', 3500]], 'a slow one is waited for; then a second more');
  assert.deepEqual(slept, [800, 1000], 'c started 1.5 s after b: no wait');
  assert.equal(turn.waiting(), 0);
  // A job that fails does not stop the queue.
  const bad = turn(async () => { throw new Error('boom'); });
  await assert.rejects(bad, /boom/);
  assert.equal(await job('e'), 'e');
  assert.equal(typeof nominatimTurn, 'function', 'the server\'s one queue (src/lib/thirtyda-geo.mjs uses it too)');
});

test('proxy: searches wait in the shared queue; too many waiting → "busy" at once, nothing asked', async () => {
  const fetchImpl = fakeFetch();
  let release;
  const gate = new Promise((r) => { release = r; });
  const turn = (fn) => gate.then(fn); // nothing starts until released
  const s = createPlaceSearch({ fetchImpl, turn, queueMax: 2 });
  const a = s.search({ q: 'aa' });
  const b = s.search({ q: 'bb' });
  assert.deepEqual(await s.search({ q: 'cc' }), { places: [], busy: true });
  release();
  assert.deepEqual((await a).places.length, 1);
  assert.deepEqual((await b).places.length, 1);
  assert.equal(fetchImpl.calls.length, 2);
  assert.equal((await s.search({ q: 'cc' })).busy, undefined, 'room again');
});

test('proxy: no answer in time (3 s, here 30 ms) or an error → unavailable, logged, not cached', async () => {
  const errors = [];
  const slow = fakeFetch((url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
  }));
  const s = createPlaceSearch({ fetchImpl: slow, turn: instant, timeoutMs: 30, onError: (e) => errors.push(e) });
  const t0 = Date.now();
  assert.deepEqual(await s.search({ q: 'brown coffee' }), { places: [], unavailable: true });
  assert.ok(Date.now() - t0 < 2000, 'gave up on time');
  assert.equal(errors.length, 1);
  assert.equal(s.size(), 0);

  const down = fakeFetch(() => new Response('{"error":"too many"}', { status: 429 }));
  const s2 = createPlaceSearch({ fetchImpl: down, turn: instant, onError: (e) => errors.push(e) });
  assert.deepEqual(await s2.search({ q: 'brown coffee' }), { places: [], unavailable: true });
  assert.match(String(errors.at(-1)?.message), /HTTP 429/);
  await s2.search({ q: 'brown coffee' });
  assert.equal(down.calls.length, 2, 'a failure is not cached');

  const broken = fakeFetch(() => { throw new TypeError('fetch failed'); });
  const s3 = createPlaceSearch({ fetchImpl: broken, turn: instant, onError: () => {} });
  assert.deepEqual(await s3.search({ q: 'brown coffee' }), { places: [], unavailable: true });
});

test('the area names (src/lib/thirtyda-geo.mjs) wait in the same Nominatim queue with the same User-Agent', async () => {
  const { readFileSync } = await import('node:fs');
  const geo = readFileSync(new URL('./thirtyda-geo.mjs', import.meta.url), 'utf8');
  assert.match(geo, /import \{ NOMINATIM_UA as UA, nominatimTurn \} from "\.\/thirtyda-nominatim\.mjs";/);
  assert.match(geo, /const throttled = nominatimTurn;/);
  assert.doesNotMatch(geo, /let lastCall/, 'no second queue of its own');
  const places = readFileSync(new URL('./thirtyda-places.mjs', import.meta.url), 'utf8');
  assert.match(places, /turn = nominatimTurn,/);
});
