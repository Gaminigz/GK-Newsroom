// Run: npm run 30da:test (or node --test src/lib/thirtyda-places-google.test.mjs)
// Google Places in the meeting place search (src/lib/thirtyda-places-google.mjs, owner 2026-10-16: OpenStreetMap is thin
// on Phnom Penh's own chains): the key's check, the Text Search request (field mask, KH, language, the circle), what a
// Google place becomes (the same checks as ours), Off until turned on, the monthly cap, the counts, and the search order
// in src/lib/thirtyda-places.mjs — Google first, our sure ones after, Nominatim not asked; anything wrong with Google and
// the search is exactly the old one. A fake fetch and an in-memory settings collection: no Google, no Mongo.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { saveFields, clearSettingsCache, SETTINGS_COLLECTION } from './thirtyda-settings.mjs';
import {
  checkGooglePlacesFields, googleTextBody, placeFromGoogle, placesFromGoogle, createGooglePlaces, saveGoogleOptions,
  googleUsage, monthOf, GOOGLE_URL, GOOGLE_FIELDS, GOOGLE_SETTING, CAP_DEFAULT,
} from './thirtyda-places-google.mjs';
import { createPlaceSearch, PHNOM_PENH } from './thirtyda-places.mjs';

const KEY = 'AIzaFAKE_0123456789abcdefghijklmnopqrst';

function fakeDb() {
  const docs = new Map();
  const col = {
    async findOne(q) { const x = docs.get(q._id); return x ? structuredClone(x) : null; },
    async replaceOne(q, doc) { docs.set(q._id, structuredClone({ ...doc, _id: q._id })); return { acknowledged: true }; },
    async deleteOne(q) { return { deletedCount: docs.delete(q._id) ? 1 : 0 }; },
    async updateOne(q, u, opts = {}) {
      let x = docs.get(q._id);
      if (x && q.month?.$ne !== undefined && x.month === q.month.$ne) return { matchedCount: 0 };
      if (x && q.box?.$exists && !x.box) return { matchedCount: 0 };
      if (!x) {
        if (!opts.upsert) return { matchedCount: 0 };
        x = { _id: q._id, ...structuredClone(u.$setOnInsert || {}) };
        docs.set(q._id, x);
      }
      Object.assign(x, structuredClone(u.$set || {}));
      for (const [k, v] of Object.entries(u.$inc || {})) x[k] = (x[k] || 0) + v;
      return { matchedCount: 1 };
    },
  };
  return { docs, collection(name) { assert.equal(name, SETTINGS_COLLECTION); return col; } };
}

/** Google as it answers Text Search; `reply(body, init)` → { places } or a Response. */
function googleFetch(reply = () => ({ places: [TUBE_KP, TUBE_7M] })) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    const out = await reply(JSON.parse(init.body), init);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  fn.calls = calls;
  return fn;
}
const g = (name, lat, lng, addr) => ({ id: `id-${name}-${lat}`, displayName: { text: name, languageCode: 'en' }, shortFormattedAddress: addr, location: { latitude: lat, longitude: lng } });
const TUBE_KP = g('Tube Coffee Koh Pich City', 11.5435, 104.9405, 'Koh Pich, Phnom Penh');
const TUBE_7M = g('TUBE Coffee Hengly Market', 11.5655, 104.9012, 'Street 271, Phnom Penh, Cambodia');

let saved;
let d;
let clock;
beforeEach(() => {
  saved = process.env.THIRTYDA_SECRET_KEY;
  process.env.THIRTYDA_SECRET_KEY = crypto.randomBytes(32).toString('hex');
  clearSettingsCache();
  d = fakeDb();
  clock = { t: Date.parse('2026-10-16T03:00:00Z') };
});
afterEach(() => {
  if (saved === undefined) delete process.env.THIRTYDA_SECRET_KEY; else process.env.THIRTYDA_SECRET_KEY = saved;
  clearSettingsCache();
});
const client = (fetchImpl) => createGooglePlaces({ dbFn: async () => d, fetchImpl, now: () => clock.t, onError: () => {} });
const saveKey = () => saveFields(d, GOOGLE_SETTING, { key: KEY });

test('the key box: a Google API key (AIza + 35), an empty box keeps the saved one', () => {
  assert.deepEqual(checkGooglePlacesFields({ key: ` ${KEY} ` }), { ok: true, values: { key: KEY } });
  assert.equal(checkGooglePlacesFields({ key: '' }).field, 'key');
  assert.equal(checkGooglePlacesFields({ key: 'sk-123' }).ok, false);
  assert.equal(checkGooglePlacesFields({ key: `${KEY}x` }).ok, false, 'one character too many');
  assert.deepEqual(checkGooglePlacesFields({ key: '' }, { key: KEY }), { ok: true, values: { key: KEY } });
});

test('the request: Text Search (New), only the fields a suggestion needs, Cambodia, the language, a 30 km circle', async () => {
  await saveKey();
  await saveGoogleOptions(d, { enabled: true });
  const f = googleFetch();
  await client(f).search({ q: ' bread  talk ', lang: 'zh', centre: { lat: 11.57, lng: 104.92 } });
  const [c] = f.calls;
  assert.equal(c.url, GOOGLE_URL);
  assert.equal(c.init.method, 'POST');
  assert.equal(c.init.headers['X-Goog-Api-Key'], KEY);
  assert.equal(c.init.headers['X-Goog-FieldMask'], GOOGLE_FIELDS);
  assert.ok(!/rating|photos|reviews|openingHours|priceLevel/.test(GOOGLE_FIELDS), 'nothing a suggestion does not show (cost)');
  assert.deepEqual(c.body, googleTextBody({ q: 'bread talk', lang: 'zh', centre: { lat: 11.57, lng: 104.92 } }));
  assert.equal(c.body.textQuery, 'bread talk');
  assert.equal(c.body.languageCode, 'zh-CN');
  assert.equal(c.body.regionCode, 'KH');
  assert.equal(c.body.pageSize, 6);
  assert.deepEqual(c.body.locationBias, { circle: { center: { latitude: 11.57, longitude: 104.92 }, radius: 30000 } });
});

test('a Google place: name, a short address through our checks, the point; outside Cambodia or a phone number never', () => {
  assert.deepEqual(placeFromGoogle(TUBE_7M), { name: 'TUBE Coffee Hengly Market', address: 'Street 271, Phnom Penh', lat: 11.5655, lng: 104.9012, source: 'google' });
  assert.equal(placeFromGoogle(g('Tube Coffee Bangkok', 13.75, 100.5, 'Bangkok')), null, 'outside Cambodia');
  assert.equal(placeFromGoogle(g('Call 012 345 678', 11.56, 104.92, 'Phnom Penh')), null, 'a name with a phone number');
  assert.equal(placeFromGoogle({ displayName: { text: 'No point' } }), null);
  const p = placeFromGoogle(g('Pasta Corner', 11.56, 104.92, '012 345 678, Street 63, Phnom Penh 12000'));
  assert.equal(p.address, 'Street 63, Phnom Penh', 'a part that reads like a phone number and the postcode go');
  assert.equal(placesFromGoogle({ places: [TUBE_KP, TUBE_KP, TUBE_7M] }).length, 2, 'each once');
  assert.deepEqual(placesFromGoogle({}), []);
});

test('Off until turned on; no key → not asked; the test search may ask while Off', async () => {
  const f = googleFetch();
  const c = client(f);
  assert.deepEqual(await c.search({ q: 'tube', centre: PHNOM_PENH }), { skipped: 'not_set' });
  await saveKey();
  c.reset();
  assert.deepEqual(await c.search({ q: 'tube', centre: PHNOM_PENH }), { skipped: 'off' });
  assert.equal(f.calls.length, 0);
  const r = await c.search({ q: 'tube', centre: PHNOM_PENH, force: true });
  assert.equal(r.places.length, 2);
  assert.equal(f.calls.length, 1);
  await saveGoogleOptions(d, { enabled: true });
  c.reset();
  assert.equal((await c.search({ q: 'tube', centre: PHNOM_PENH })).places.length, 2);
});

test('the monthly cap: counted per Phnom Penh month, then Google is not asked (not even by the test search)', async () => {
  await saveKey();
  assert.equal((await saveGoogleOptions(d, { monthlyCap: 2.5 })).field, 'monthlyCap');
  assert.equal((await saveGoogleOptions(d, { monthlyCap: -1 })).ok, false);
  await saveGoogleOptions(d, { enabled: true, monthlyCap: 2 });
  const f = googleFetch();
  const c = client(f);
  await c.search({ q: 'tube', centre: PHNOM_PENH });
  await c.search({ q: 'bread talk', centre: PHNOM_PENH });
  assert.deepEqual(await c.search({ q: 'pasta corner', centre: PHNOM_PENH }), { skipped: 'cap' });
  assert.deepEqual(await c.search({ q: 'pasta corner', centre: PHNOM_PENH, force: true }), { skipped: 'cap' });
  assert.equal(f.calls.length, 2);
  const u = await googleUsage(d, clock.t);
  assert.deepEqual([u.month, u.calls, u.ok, u.failed], ['2026-10', 2, 2, 0]);
  // 31 Oct 17:30 UTC is already 1 November in Phnom Penh: a new month, counted from 0.
  clock.t = Date.parse('2026-10-31T17:30:00Z');
  assert.equal(monthOf(clock.t), '2026-11');
  assert.equal((await c.search({ q: 'pasta corner', centre: PHNOM_PENH })).places.length, 2);
  assert.deepEqual([(await googleUsage(d, clock.t)).calls], [1]);
  assert.equal(CAP_DEFAULT, 3000);
});

test('a failure: counted, Google\'s own words kept (never the key), the search goes on without it', async () => {
  await saveKey();
  await saveGoogleOptions(d, { enabled: true });
  const f = googleFetch(() => new Response(JSON.stringify({ error: { code: 403, message: 'Places API (New) has not been used in project 123 before or it is disabled.' } }), { status: 403 }));
  const r = await client(f).search({ q: 'tube', centre: PHNOM_PENH });
  assert.match(r.failed, /^Google HTTP 403: Places API \(New\) has not been used/);
  assert.ok(!r.failed.includes(KEY));
  const u = await googleUsage(d, clock.t);
  assert.deepEqual([u.calls, u.ok, u.failed], [1, 0, 1]);
  assert.match(u.lastError.message, /403/);
});

test('the tower\'s block: the key only as its last 4, On / Off, the cap and the counts', async () => {
  const c = client(googleFetch());
  assert.equal((await c.status()).state, 'not_set');
  await saveKey();
  const off = await c.status();
  assert.equal(off.state, 'off');
  assert.equal(off.masks.key, KEY.slice(-4));
  assert.ok(!JSON.stringify(off).includes(KEY), 'never the key');
  await saveGoogleOptions(d, { enabled: true, monthlyCap: 1 });
  c.reset();
  await c.search({ q: 'tube', centre: PHNOM_PENH });
  const capped = await c.status();
  assert.equal(capped.state, 'cap');
  assert.deepEqual([capped.usage.calls, capped.options.monthlyCap], [1, 1]);
});

// ---------------------------------------------------------------- the order in the app's search

/** Our own list, as createPlaceIndex answers: `places`, the first `sure` without a typo. */
const ownIndex = (places, sure = places.length) => ({ search: async () => ({ places, sure }) });
const OURS = { name: 'Tube Coffee', address: 'Koh Pich', lat: 11.5436, lng: 104.9404 }; // the same café as TUBE_KP (≈ 15 m)
const OURS2 = { name: 'Tube Coffee', address: '7 Makara', lat: 11.5690, lng: 104.9060 };
const noNominatim = async () => { throw new Error('Nominatim must not be asked'); };
const fakeGoogle = (answer) => ({ calls: 0, async search() { this.calls++; return answer; } });

test('Google first: its places, then our sure ones it does not have; Nominatim not asked', async () => {
  const google = fakeGoogle({ places: [placeFromGoogle(TUBE_KP), placeFromGoogle(TUBE_7M)] });
  const s = createPlaceSearch({ index: ownIndex([OURS, OURS2]), google, fetchImpl: noNominatim, turn: (fn) => fn() });
  const r = await s.search({ q: 'tube coffee', near: null, explain: true });
  assert.deepEqual(r.places.map((p) => p.name), ['Tube Coffee Koh Pich City', 'TUBE Coffee Hengly Market', 'Tube Coffee']);
  assert.equal(r.places[2].address, '7 Makara', 'ours at Koh Pich is the same spot as Google\'s: once');
  assert.deepEqual(r.explain.from, ['google', 'google', 'ours']);
  assert.equal(r.explain.google, 'asked');
  assert.equal(r.explain.nominatim, 'not_asked');
});

test('Google off, capped, failing or finding nothing: the old search, exactly', async () => {
  for (const [answer, word] of [[{ skipped: 'off' }, 'off'], [{ skipped: 'cap' }, 'cap'], [{ failed: 'Google HTTP 500' }, 'failed'], [{ places: [] }, 'none']]) {
    const s = createPlaceSearch({ index: ownIndex([OURS, OURS2, { ...OURS2, lat: 11.6 }]), google: fakeGoogle(answer), fetchImpl: noNominatim, turn: (fn) => fn() });
    const r = await s.search({ q: 'tube coffee', explain: true });
    assert.deepEqual(r.explain.from, ['ours', 'ours', 'ours'], word);
    assert.equal(r.explain.google, word);
  }
  // A Google that throws is a failed Google, never a failed search.
  const broken = { async search() { throw new Error('boom'); } };
  const s = createPlaceSearch({ index: ownIndex([OURS, OURS2, { ...OURS2, lat: 11.6 }]), google: broken, fetchImpl: noNominatim, turn: (fn) => fn(), onError: () => {} });
  assert.equal((await s.search({ q: 'tube coffee' })).places.length, 3);
});

test('what the app gets: no explain, source on Google\'s places only (the sheet credits "Google Maps" by it)', async () => {
  const s = createPlaceSearch({ index: ownIndex([OURS2]), google: fakeGoogle({ places: [placeFromGoogle(TUBE_KP)] }), fetchImpl: noNominatim, turn: (fn) => fn() });
  const r = await s.search({ q: 'tube coffee' });
  assert.deepEqual(Object.keys(r), ['places']);
  assert.deepEqual(r.places.map((p) => p.source ?? null), ['google', null]);
});

test('a brand chip: Google asked in English for 20, only that brand kept, nearest first, each with km', async () => {
  const { brandById } = await import('../thirtyda-app/shared/meet.js');
  const tube = brandById('tube');
  const centre = { lat: 11.55, lng: 104.92 };
  assert.deepEqual([googleTextBody({ q: tube.q, lang: 'km', centre, brand: tube }).languageCode, googleTextBody({ q: tube.q, lang: 'km', centre, brand: tube }).pageSize], ['en', 20]);
  const far = g('Tube Coffee Sen Sok', 11.60, 104.88, 'Sen Sok, Phnom Penh');
  const other = g('Brown Coffee', 11.551, 104.921, 'BKK1, Phnom Penh');
  const got = placesFromGoogle({ places: [far, other, TUBE_7M, TUBE_KP] }, { brand: tube, centre });
  assert.deepEqual(got.map((p) => p.name), ['TUBE Coffee Hengly Market', 'Tube Coffee Koh Pich City', 'Tube Coffee Sen Sok'].sort((a, b) => {
    const at = (n) => got.find((p) => p.name === n);
    return Math.hypot(at(a).lat - centre.lat, at(a).lng - centre.lng) - Math.hypot(at(b).lat - centre.lat, at(b).lng - centre.lng);
  }));
  // Through the app's search: ours (strict) and Google's, one list, nearest first, km on each.
  const ours = { name: 'Tube Café', address: 'Russian Market', lat: 11.5396, lng: 104.9186 };
  const asked = [];
  const index = { search: async (o) => { asked.push(o.minTier); return { places: [ours], sure: 1 }; } };
  const google = { async search(o) { assert.equal(o.brand, tube); return { places: placesFromGoogle({ places: [TUBE_KP, other] }, { brand: tube, centre: o.centre }) }; } };
  const s = createPlaceSearch({ index, google, fetchImpl: async () => { throw new Error('no Nominatim'); }, turn: (fn) => fn() });
  const r = await s.search({ q: tube.q, near: centre, brand: tube });
  assert.deepEqual(asked, [3], 'ours: every word whole');
  assert.deepEqual(r.places.map((p) => p.name), ['Tube Café', 'Tube Coffee Koh Pich City']);
  assert.ok(r.places.every((p) => Number.isFinite(p.km)) && r.places[0].km <= r.places[1].km);
});
