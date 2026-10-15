// Run: npm run 30da:test (or node --test src/lib/thirtyda-places-index.test.mjs)
// Our own Phnom Penh place list (owner 2026-10-15: "Browns" said "No places found", src/lib/thirtyda-places-index.mjs):
// the one Overpass query and the rows we keep, the suggestions it makes (the same shape, checks, address lines and refs
// as Nominatim's), "Browns" / "brown coffee tk" / "Brown BKK1" / a typo / Khmer, the place search asking it first (only
// around Phnom Penh) and Nominatim only for fewer than 3, the stored copy (memory, a file, one Mongo doc — under 1 MB) and the refresh rules
// (an old copy is served while ONE refresh runs; a failed Overpass keeps the old copy). A fake fetch, a fake Mongo
// collection: these tests reach neither Overpass, Nominatim nor Mongo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  OVERPASS_URL, INDEX_BOX, INDEX_KINDS, INDEX_MAX_AGE_MS, INDEX_RETRY_MS, INDEX_MIN_ROWS, INDEX_MAX_BYTES, INDEX_COLLECTION,
  INDEX_DOC, ROW, overpassQuery, rowsFromOverpass, encodeCopy, decodeCopy, entryOf, placeFromRow, searchRows,
  memoryIndexStore, fileIndexStore, mongoIndexStore, defaultIndexStore, createPlaceIndex,
} from './thirtyda-places-index.mjs';
import {
  PLACES_LIMIT, PLACES_INDEX_ENOUGH, PLACES_INDEX_KM, PHNOM_PENH, createPlaceSearch, createPlaceRefs, placeFromResult, mergePlaces,
} from './thirtyda-places.mjs';
import { kmBetween } from '../thirtyda-app/shared/place-match.js';
import { NOMINATIM_UA } from './thirtyda-nominatim.mjs';
import { findContactDetails, findContactDetailsAcross, findBadWords } from '../thirtyda-app/shared/rules.js';
import { checkPlace } from '../thirtyda-app/shared/meet.js';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const TK = { lat: 11.58, lng: 104.9 };
const BKK1 = { lat: 11.5533, lng: 104.9248 };
const PP = { lat: 11.56, lng: 104.93 };

// ---------------------------------------------------------------- an Overpass answer, as overpass-api.de gives it

const node = (id, lat, lon, tags) => ({ type: 'node', id, lat, lon, tags });
const way = (id, lat, lon, tags) => ({ type: 'way', id, center: { lat, lon }, nodes: [1, 2, 3, 1], tags });
const ELEMENTS = [
  node(101, 11.5808, 104.8959, { amenity: 'cafe', name: 'Brown Coffee', 'name:km': 'ប្រោនកាហ្វេ', 'name:zh': '布朗咖啡', brand: 'Brown Coffee', 'addr:street': 'Street 315', 'addr:housenumber': '12', 'addr:postcode': '120406' }),
  node(102, 11.5533, 104.9248, { amenity: 'cafe', name: 'Brown Coffee', brand: 'Brown Coffee', 'addr:street': 'Street 57', 'addr:suburb': 'Sangkat Boeng Keng Kang Muoy' }),
  way(103, 11.5481, 104.9326, { amenity: 'cafe', name: 'Brown Coffee', 'addr:street': 'Samdech Sothearos Boulevard' }),
  node(104, 11.605, 104.879, { amenity: 'cafe', name: 'Brown Coffee', branch: 'Aeon Mall Sen Sok' }),
  node(105, 11.5705, 104.9302, { amenity: 'cafe', name: 'Brown Coffee & Bakery', 'addr:street': 'Sisowath Quay' }),
  node(106, 11.557, 104.921, { amenity: 'fast_food', name: "Browny's Burger" }),
  node(107, 11.551, 104.928, { amenity: 'cafe', name: 'Starbucks', 'name:zh': '星巴克', 'name:ko': '스타벅스', 'name:ja': 'スターバックス' }),
  way(108, 11.5481, 104.9332, { shop: 'mall', name: 'AEON Mall Phnom Penh', 'name:km': 'អ៊ីអន ម៉ល ភ្នំពេញ' }),
  { type: 'relation', id: 109, center: { lat: 11.5762, lon: 104.9231 }, members: [], tags: { tourism: 'attraction', name: 'Wat Phnom' } },
  node(110, 11.56, 104.92, { amenity: 'cafe', name: 'Cafe 012 345 678' }), // a phone number: never offered
  node(111, 11.561, 104.921, { amenity: 'cafe', name: 'Telegram Cafe' }), // a chat app: never offered
  node(112, 11.562, 104.922, { amenity: 'cafe', name: 'Cafe 012 887', 'addr:street': '766 Street' }), // split over name + street
  node(113, 11.563, 104.923, { amenity: 'cafe' }), // no name
  node(114, 11.564, 104.924, { amenity: 'atm', name: 'ABA ATM' }), // not a kind we keep
  node(115, 13.36, 103.86, { amenity: 'cafe', name: 'Brown Coffee Siem Reap' }), // outside the box
  { type: 'way', id: 116, tags: { amenity: 'cafe', name: 'No Point Cafe' } }, // no centre
  node(101, 11.5808, 104.8959, { amenity: 'cafe', name: 'Brown Coffee' }), // the same element twice
];
/** Filler cafés so a refresh has more than INDEX_MIN_ROWS places. */
const filler = (n) => Array.from({ length: n }, (_, i) => node(1000 + i, 11.5 + (i % 20) * 0.005, 104.85 + Math.floor(i / 20) * 0.005, { amenity: i % 2 ? 'restaurant' : 'bar', name: `Place ${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}` }));
const ANSWER = { version: 0.6, generator: 'Overpass API', elements: [...ELEMENTS, ...filler(60)] };
const ROWS = rowsFromOverpass(ANSWER);
const ENTRIES = ROWS.map(entryOf);
const search = (q, opts = {}) => searchRows(ENTRIES, q, { centre: PP, ...opts });

/** A fetch that answers Overpass from `reply()` and remembers every call. */
function overpassFetch(reply = () => ANSWER) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    const out = await reply(url, init);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  fn.calls = calls;
  return fn;
}

// ---------------------------------------------------------------- the query and the rows

test('the Overpass query: one POST, our User-Agent, every kind we keep, named only, in the Phnom Penh box, way centres', async () => {
  const q = overpassQuery();
  assert.match(q, /^\[out:json\]\[timeout:90\];/);
  const box = `(${INDEX_BOX.south},${INDEX_BOX.west},${INDEX_BOX.north},${INDEX_BOX.east})`;
  for (const [key, vals] of Object.entries(INDEX_KINDS)) {
    assert.ok(q.includes(`nwr["${key}"~"^(${vals.join('|')})$"]["name"]${box};`), key);
  }
  assert.match(q, /out center qt;$/, 'a way or a relation as its centre');
  assert.deepEqual(INDEX_KINDS.amenity, ['cafe', 'restaurant', 'bar', 'pub', 'fast_food', 'food_court', 'ice_cream']);
  assert.deepEqual([...INDEX_KINDS.shop, ...INDEX_KINDS.leisure, ...INDEX_KINDS.tourism], ['mall', 'bakery', 'supermarket', 'park', 'garden', 'attraction', 'museum', 'viewpoint', 'hotel']);
  assert.ok(INDEX_BOX.south < 11.45 && INDEX_BOX.north > 11.65 && INDEX_BOX.west < 104.8 && INDEX_BOX.east > 105, 'a bit larger than the city box');

  const fetchImpl = overpassFetch();
  const index = createPlaceIndex({ fetchImpl, store: memoryIndexStore(), onError: () => {} });
  assert.equal(await index.refresh(), true);
  assert.equal(fetchImpl.calls.length, 1);
  const { url, init } = fetchImpl.calls[0];
  assert.equal(url, OVERPASS_URL);
  assert.equal(OVERPASS_URL, 'https://overpass-api.de/api/interpreter');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['User-Agent'], NOMINATIM_UA, 'says who we are, with a contact');
  assert.ok(init.signal instanceof AbortSignal);
  assert.equal(new URLSearchParams(init.body).get('data'), q);
});

test('the rows: named places of our kinds with a point in the box, each once; only what the search needs', () => {
  const ids = ROWS.map((r) => r[ROW.id]);
  for (const id of ['n101', 'n102', 'w103', 'n104', 'n105', 'n106', 'n107', 'w108', 'r109', 'n110', 'n111', 'n112']) assert.ok(ids.includes(id), id);
  for (const id of ['n113', 'n114', 'n115', 'w116']) assert.ok(!ids.includes(id), `${id} is not kept`);
  assert.equal(ids.filter((id) => id === 'n101').length, 1, 'each once');
  const tk = ROWS.find((r) => r[ROW.id] === 'n101');
  assert.deepEqual(tk, ['n101', 'cafe', 11.5808, 104.8959, 'Brown Coffee', '', 'ប្រោនកាហ្វេ', '布朗咖啡', '', '', 'Brown Coffee', '', 'Street 315', '']);
  assert.ok(!JSON.stringify(ROWS).includes('120406'), 'no postcode kept');
  assert.equal(ROWS.find((r) => r[ROW.id] === 'w103')[ROW.lat], 11.5481, 'a way: its centre');
  assert.equal(ROWS.find((r) => r[ROW.id] === 'n102')[ROW.area], 'Sangkat Boeng Keng Kang Muoy');
  assert.equal(ROWS.find((r) => r[ROW.id] === 'w108')[ROW.kind], 'mall');
  assert.deepEqual(rowsFromOverpass(null), []);
  assert.deepEqual(rowsFromOverpass({ elements: 'x' }), []);
});

// ---------------------------------------------------------------- the suggestions

test('"Browns" → the Brown Coffee branches, each with its street / area, nearest first', () => {
  const r = search('Browns');
  const brown = r.filter((p) => p.name === 'Brown Coffee');
  assert.ok(brown.length >= 4, 'several branches');
  assert.equal(new Set(brown.map((p) => p.address)).size, brown.length, 'each told apart by its line');
  assert.deepEqual(brown.map((p) => p.address), [
    'Street 57, Boeng Keng Kang Muoy', // 0.9 km from the centre; its own sangkat tag, without "Sangkat"
    'Samdech Sothearos Boulevard, Chamkar Mon', // 1.4 km; no area tag: the area its point is in
    'Street 315, Toul Kork', // 4.1 km
    'Aeon Mall Sen Sok, Sen Sok', // 7.4 km; the branch tag
  ]);
  assert.equal(r[1].name, 'Brown Coffee & Bakery', 'a name with the word in it, by its distance (1.2 km)');
  assert.equal(r[1].address, 'Sisowath Quay, Riverside');
  assert.ok(r.length <= PLACES_LIMIT);
  assert.ok(r.some((p) => p.name === 'Brown Coffee & Bakery'));
});

test('"brown coffee tk" ranks the Toul Kork branch first; "Brown BKK1" the BKK1 one; "Bown Coffee" (a typo) still finds them', () => {
  assert.equal(search('brown coffee tk')[0].address, 'Street 315, Toul Kork');
  assert.equal(search('brown coffee toul kork', { centre: BKK1 })[0].address, 'Street 315, Toul Kork');
  assert.equal(search('Brown BKK1', { centre: TK })[0].address, 'Street 57, Boeng Keng Kang Muoy');
  assert.equal(search('brown coffee riverside')[0].name, 'Brown Coffee & Bakery');
  const typo = search('Bown Coffee');
  assert.ok(typo.length >= 4);
  assert.ok(typo.every((p) => /^Brown Coffee/.test(p.name)));
  assert.equal(search('starbuks')[0].name, 'Starbucks');
});

test('the person\'s language: name:<lang> (zh / ko / ja fall back to name:en, then name); Khmer and CJK parts of a name match', () => {
  const km = search('ប្រោន', { lang: 'km' });
  assert.deepEqual(km.map((p) => p.name), ['ប្រោនកាហ្វេ']);
  assert.equal(km[0].address, 'Street 315, ទួលគោក', 'the area in Khmer');
  assert.equal(search('Brown Coffee TK', { lang: 'zh' })[0].name, '布朗咖啡');
  assert.equal(search('星巴', { lang: 'zh' })[0].name, '星巴克');
  assert.equal(search('스타벅', { lang: 'ko' })[0].name, '스타벅스');
  assert.equal(search('スターバ', { lang: 'ja' })[0].name, 'スターバックス');
  assert.equal(search('スターバ', { lang: 'en' })[0].name, 'Starbucks', 'found in Japanese, shown in English');
  assert.equal(search('aeon mall', { lang: 'km' })[0].name, 'អ៊ីអន ម៉ល ភ្នំពេញ');
  assert.equal(search('wat phnom')[0].address, 'Daun Penh', 'no street: the area');
});

test('branches of a chain with the same name and the same area line are each offered: one place once only by where it is', () => {
  // Toul Kork: one branch with its street, three with no address tags (their line is just "Toul Kork"), 650–950 m apart.
  const brown = (id, lat, lng, street = '') => [id, 'cafe', lat, lng, 'Brown Coffee', '', '', '', '', '', '', '', street, ''];
  const rows = [
    brown('n1', 11.5800, 104.8940, 'Street 315'),
    brown('n2', 11.5790, 104.8930),
    brown('n3', 11.5760, 104.8990),
    brown('n4', 11.5850, 104.9010),
    brown('n5', 11.5762, 104.9231), brown('n6', 11.605, 104.879), brown('n7', 11.5700, 104.9300), brown('n8', 11.5533, 104.9248),
  ];
  const centre = { lat: 11.58, lng: 104.895 };
  for (const q of ['Brown Coffee TK', 'brown coffee toul kork']) {
    const r = searchRows(rows.map(entryOf), q, { centre });
    assert.deepEqual(r.slice(0, 4).map((p) => [p.lat, p.lng]).sort(), [[11.576, 104.899], [11.579, 104.893], [11.58, 104.894], [11.585, 104.901]], q);
    assert.ok(r.slice(0, 4).every((p) => /Toul Kork$/.test(p.address)), q);
    assert.equal(r.filter((p) => p.address === 'Toul Kork').length, 3, `${q}: the three untagged ones, all of them`);
  }
  // One place twice is still once: the same name 11 m away, or anything within 40 m.
  const twice = [...rows, brown('n9', 11.5801, 104.8940, 'Street 315'), ['n10', 'cafe', 11.57602, 104.89902, 'Brown Coffee Kiosk', '', '', '', '', '', '', '', '', '']];
  const r = searchRows(twice.map(entryOf), 'brown coffee tk', { centre, limit: 20 });
  const at = (lat, lng) => r.filter((p) => Math.abs(p.lat - lat) < 0.0002 && Math.abs(p.lng - lng) < 0.0002).length;
  assert.equal(at(11.58, 104.894), 1, 'same name within 150 m');
  assert.equal(at(11.576, 104.899), 1, 'within 40 m');
});

test('a street, an area or a branch of the place counts with its name; the city and the country say nothing', () => {
  for (const q of ['Browns Phnom Penh', 'Browns in Phnom Penh', 'browns pp', 'brown coffee cambodia']) {
    const r = search(q);
    assert.ok(r.filter((p) => p.name === 'Brown Coffee').length >= 4, q);
  }
  assert.deepEqual(search('Starbucks Phnom Penh').map((p) => p.name), ['Starbucks']);
  assert.deepEqual(search('星巴克 金边', { lang: 'zh' }).map((p) => p.name), ['星巴克']);
  assert.equal(search('aeon mall phnom penh')[0].name, 'AEON Mall Phnom Penh', 'a name with the city in it: still the whole name');
  assert.deepEqual(search('Brown Coffee Street 315').map((p) => p.address), ['Street 315, Toul Kork'], 'its street');
  assert.deepEqual(search('brown coffee sothearos').map((p) => p.address), ['Samdech Sothearos Boulevard, Chamkar Mon']);
  assert.deepEqual(search('brown coffee aeon').map((p) => p.address), ['Aeon Mall Sen Sok, Sen Sok'], 'its branch');
  assert.deepEqual(search('sisowath').map((p) => p.name), [], 'a street alone is not a place');
});

test('"and" is "&": "brown coffee and bakery" finds "Brown Coffee & Bakery"', () => {
  for (const q of ['brown coffee and bakery', 'Brown Coffee & Bakery', 'coffee and bakery', 'brown and bakery']) {
    assert.equal(search(q)[0]?.name, 'Brown Coffee & Bakery', q);
  }
});

test('nothing to search: empty, punctuation, one letter → no suggestions', () => {
  for (const q of ['', ' ', '!!', 'b', '.']) assert.deepEqual(search(q), [], JSON.stringify(q));
  assert.deepEqual(search('zzzzqqq'), []);
});

test('a suggestion is exactly a Nominatim one: { name, address, lat, lng }, the same checks, a ref that POST /meet keeps', () => {
  const p = search('brown coffee tk')[0];
  const nominatim = placeFromResult({ lat: '11.57', lon: '104.9', name: 'Brown Coffee', address: { road: 'Street 315' } });
  assert.deepEqual(Object.keys(p), Object.keys(nominatim));
  assert.deepEqual(Object.keys(p), ['name', 'address', 'lat', 'lng']);
  assert.equal(typeof p.lat, 'number');
  assert.deepEqual(checkPlace(p).place, p, 'checkPlace keeps it as it is');
  const refs = createPlaceRefs({ key: Buffer.alloc(32, 7) });
  assert.equal(refs.ok(checkPlace(p).place, refs.sign(p, 'U-1'), 'U-1'), true);
  // Never a contact detail or a bad word: not in a name, not in an address, not split over the two.
  const all = searchRows(ENTRIES, 'cafe', { centre: PP, limit: 1000 });
  for (const s of all) {
    assert.ok(findContactDetails(s.name).ok && findBadWords(s.name).ok, s.name);
    if (s.address) assert.ok(findContactDetails(s.address).ok && findContactDetailsAcross([s.name, s.address]).ok, s.address);
  }
  assert.ok(!all.some((s) => /012 345 678|Telegram/.test(s.name)), 'stopped names are never offered');
  const split = all.find((s) => s.name === 'Cafe 012 887');
  assert.ok(!split || !/766/.test(split.address ?? ''), 'a street that makes a phone number with the name is left out');
  // No house number, no postcode.
  assert.ok(!search('brown coffee tk').some((s) => /\b12\b|120406/.test(s.address ?? '')));
  // The same name and line once.
  const twice = [...ROWS, [...ROWS.find((r) => r[ROW.id] === 'n101')].map((v, i) => (i === ROW.id ? 'n999' : i === ROW.lat ? 11.5809 : v))];
  assert.equal(searchRows(twice.map(entryOf), 'brown coffee tk', { centre: PP }).filter((s) => s.address === 'Street 315, Toul Kork').length, 1);
  assert.equal(placeFromRow(['n1', 'cafe', 11.56, 104.92, 'X', '', '', '', '', '', '', '', '', '']), null, 'a one-letter name');
  assert.deepEqual(placeFromRow(['n1', 'cafe', 11.3, 104.6, 'Far Cafe', '', '', '', '', '', '', '', '', '']).address, 'Phnom Penh', 'nothing else to say');
});

// ---------------------------------------------------------------- the place search: ours first, Nominatim for fewer than 3

/** A fake Nominatim (thirtyda-places.test.mjs style). */
function nominatimFetch(list) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push(String(url));
    return new Response(JSON.stringify(list), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  fn.calls = calls;
  return fn;
}
const instant = (fn) => fn();
const NOMINATIM_BROWN = { lat: '11.5808', lon: '104.8960', name: 'Brown Coffee', address: { road: 'Street 315', suburb: 'Sangkat Boeng Kak Ti Pir', city: 'Phnom Penh' } };
const NOMINATIM_OTHER = { lat: '11.5600', lon: '104.9100', name: 'Brown Sugar Bakery', address: { road: 'Street 63', city: 'Phnom Penh' } };
const fixedIndex = (rows = ROWS) => {
  const index = createPlaceIndex({ fetchImpl: overpassFetch(), store: memoryIndexStore({ at: Date.now(), rows }), onError: () => {} });
  return index;
};

test('3 or more of ours: Nominatim is not asked; the same shape the route signs', async () => {
  const fetchImpl = nominatimFetch([NOMINATIM_BROWN]);
  const s = createPlaceSearch({ fetchImpl, turn: instant, index: fixedIndex() });
  const r = await s.search({ q: 'Browns', lang: 'en', near: { lat: 11.571, lng: 104.902 } });
  assert.ok(r.places.length >= PLACES_INDEX_ENOUGH);
  assert.equal(PLACES_INDEX_ENOUGH, 3);
  assert.equal(fetchImpl.calls.length, 0, 'Nominatim not asked');
  assert.deepEqual(Object.keys(r), ['places'], 'no busy / unavailable / cached');
  assert.ok(r.places.every((p) => p.name.startsWith('Brown')));
});

test('fewer than 3 of ours: Nominatim too, after ours, the same place once (by distance and name)', async () => {
  const fetchImpl = nominatimFetch([NOMINATIM_BROWN, NOMINATIM_OTHER]);
  const few = ROWS.filter((r) => r[ROW.id] === 'n101' || r[ROW.id] === 'n107');
  const s = createPlaceSearch({ fetchImpl, turn: instant, index: fixedIndex(few) });
  const r = await s.search({ q: 'brown coffee', lang: 'en' });
  assert.equal(fetchImpl.calls.length, 1, 'Nominatim asked');
  assert.deepEqual(r.places.map((p) => p.name), ['Brown Coffee', 'Brown Sugar Bakery'], 'Nominatim\'s Brown Coffee is ours again (11 m away): once');
  assert.equal(r.places[0].address, 'Street 315, Toul Kork', 'ours first');
  // Nothing of ours: Nominatim's answer exactly as before.
  const s2 = createPlaceSearch({ fetchImpl: nominatimFetch([NOMINATIM_OTHER]), turn: instant, index: fixedIndex(few) });
  assert.deepEqual(await s2.search({ q: 'sugar bakery' }), { places: [placeFromResult(NOMINATIM_OTHER)] });
  // Nominatim busy while ours had something: ours, without "busy".
  let release;
  const gate = new Promise((res) => { release = res; });
  const s3 = createPlaceSearch({ fetchImpl: nominatimFetch([]), turn: (fn) => gate.then(fn), queueMax: 0, index: fixedIndex(few) });
  const busy = await s3.search({ q: 'starbucks' });
  assert.deepEqual(busy.places.map((p) => p.name), ['Starbucks']);
  assert.equal(busy.busy, undefined);
  release();
});

test('near-misses (a typo) are not "enough": Nominatim is asked too, and its places come before them', async () => {
  const fetchImpl = nominatimFetch([NOMINATIM_OTHER]);
  const s = createPlaceSearch({ fetchImpl, turn: instant, index: fixedIndex() });
  const r = await s.search({ q: 'Bown Coffee' });
  assert.equal(fetchImpl.calls.length, 1, 'Nominatim asked');
  assert.equal(r.places[0].name, 'Brown Sugar Bakery', 'Nominatim\'s first');
  assert.ok(r.places.slice(1).length >= 3 && r.places.slice(1).every((p) => /^Brown Coffee/.test(p.name)), 'then ours');
  assert.equal(r.places.length, PLACES_LIMIT);
  // One exact place and the rest near-misses: the exact one, Nominatim's, then the near-misses.
  const index = fixedIndex();
  const one = await index.search({ q: 'starbucks', centre: PP });
  assert.deepEqual([one.sure, one.places.map((p) => p.name)], [1, ['Starbucks']]);
  const both = await index.search({ q: 'brown', centre: PP });
  assert.equal(both.sure, both.places.length, 'whole words: all sure');
});

test('a search outside Phnom Penh (Siem Reap, Sihanoukville) is Nominatim alone around the person: never ours 300 km away', async () => {
  const SIEM_REAP = { lat: 13.36, lng: 103.86 };
  const SIHANOUKVILLE = { lat: 10.63, lng: 103.52 };
  const local = { lat: '13.3605', lon: '103.8601', name: 'Brown Coffee', address: { road: 'Sivatha Road', city: 'Siem Reap' } };
  for (const [near, q] of [[SIEM_REAP, 'Brown Coffee'], [SIEM_REAP, 'Browns'], [SIHANOUKVILLE, 'cafe']]) {
    const fetchImpl = nominatimFetch([local]);
    const s = createPlaceSearch({ fetchImpl, turn: instant, index: fixedIndex() });
    const r = await s.search({ q, lang: 'en', near });
    assert.equal(fetchImpl.calls.length, 1, `${q}: Nominatim asked`);
    assert.deepEqual(r, { places: [placeFromResult(local)] }, `${q}: Nominatim's alone, exactly as before`);
    const box = new URL(fetchImpl.calls[0]).searchParams.get('viewbox').split(',').map(Number);
    assert.ok(box[0] < near.lng && near.lng < box[2] && box[3] < near.lat && near.lat < box[1], 'around the person');
  }
  // The list is not even asked there.
  let asked = 0;
  const counting = { search: async () => { asked++; return { places: [], sure: 0 }; } };
  await createPlaceSearch({ fetchImpl: nominatimFetch([]), turn: instant, index: counting }).search({ q: 'Brown Coffee', near: SIEM_REAP });
  assert.equal(asked, 0);
  await createPlaceSearch({ fetchImpl: nominatimFetch([]), turn: instant, index: counting }).search({ q: 'Brown Coffee', near: TK });
  assert.equal(asked, 1, 'in Phnom Penh it is');
  // The whole list is within PLACES_INDEX_KM of the city; ours more than that from the person are never offered.
  assert.equal(PLACES_INDEX_KM, 30);
  for (const lat of [INDEX_BOX.south, INDEX_BOX.north]) for (const lng of [INDEX_BOX.west, INDEX_BOX.east]) {
    assert.ok(kmBetween(PHNOM_PENH, { lat, lng }) < PLACES_INDEX_KM, `${lat},${lng}`);
  }
  assert.deepEqual(searchRows(ENTRIES, 'Browns', { centre: SIEM_REAP }), []);
  const west = { lat: 11.56, lng: 104.70 }; // ~25 km west of the city: the list is asked …
  assert.ok(kmBetween(west, PHNOM_PENH) <= PLACES_INDEX_KM);
  const edge = [['n1', 'cafe', 11.56, 104.75, 'Brown Coffee', '', '', '', '', '', '', '', '', ''], ['n2', 'cafe', 11.56, 105.04, 'Brown Coffee', '', '', '', '', '', '', '', '', '']];
  assert.deepEqual(searchRows(edge.map(entryOf), 'brown coffee', { centre: west }).map((p) => p.lng), [104.75], '… but not for a place 37 km away');
});

test('a pagoda or a market (kinds our list does not hold): names with the word are not "enough", Nominatim\'s real one comes first', async () => {
  const market = (id, name, lng) => [id, 'restaurant', 11.56, lng, name, '', '', '', '', '', '', '', '', ''];
  const rows = [...ROWS, market('n901', 'Night Market BBQ', 104.921), market('n902', 'Market Cafe', 104.922), market('n903', 'Farmers Market Kitchen', 104.923)];
  const phsar = { lat: '11.5697', lon: '104.9211', name: 'Central Market', address: { road: 'Street 53', city: 'Phnom Penh' } };
  const fetchImpl = nominatimFetch([phsar]);
  const s = createPlaceSearch({ fetchImpl, turn: instant, index: fixedIndex(rows) });
  const r = await s.search({ q: 'market', near: PP });
  assert.equal(fetchImpl.calls.length, 1, 'Nominatim asked');
  assert.equal(r.places[0].name, 'Central Market', 'the real market first');
  assert.deepEqual(r.places.slice(1).map((p) => p.name).sort(), ['Farmers Market Kitchen', 'Market Cafe', 'Night Market BBQ']);
  // The whole name of a place we do hold is still sure: "Wat Phnom" (an attraction) without asking.
  const index = fixedIndex(rows);
  assert.equal((await index.search({ q: 'wat phnom', centre: PP })).sure, 1);
  assert.equal((await index.search({ q: 'pagoda', centre: PP })).sure, 0, 'Wat Phnom is a pagoda by its name only');
});

test('mergePlaces: ours first, at most 6; anything within 40 m or the same name within 150 m is one place', () => {
  const a = { name: 'Brown Coffee', address: 'x', lat: 11.58, lng: 104.9 };
  const near = { name: 'Other', address: null, lat: 11.5801, lng: 104.9001 }; // ~15 m
  const sameName = { name: 'BROWN COFFEE!', address: null, lat: 11.581, lng: 104.9 }; // ~110 m
  const farSame = { name: 'Brown Coffee', address: null, lat: 11.59, lng: 104.9 }; // ~1.1 km: another branch
  assert.deepEqual(mergePlaces([a], [near, sameName, farSame]), [a, farSame]);
  const many = Array.from({ length: 9 }, (_, i) => ({ name: `P${i}`, address: null, lat: 11 + i * 0.01, lng: 104 }));
  assert.equal(mergePlaces(many.slice(0, 4), many.slice(4)).length, PLACES_LIMIT);
  assert.deepEqual(mergePlaces(null, [a]), [a]);
});

test('no list yet: the search is Nominatim alone, exactly as before (the stored copy is empty, Overpass not answered yet)', async () => {
  let answer;
  const pending = new Promise((r) => { answer = r; });
  const index = createPlaceIndex({ fetchImpl: overpassFetch(() => pending), store: memoryIndexStore(), onError: () => {} });
  const fetchImpl = nominatimFetch([NOMINATIM_BROWN]);
  const s = createPlaceSearch({ fetchImpl, turn: instant, index });
  assert.deepEqual(await s.search({ q: 'Brown Coffee' }), { places: [placeFromResult(NOMINATIM_BROWN)] });
  assert.equal(await index.search({ q: 'Brown Coffee' }), null);
  assert.equal(index.info().refreshing, true, 'the first search started the list');
  answer(ANSWER);
  await tick(5);
  assert.ok(index.info().count > INDEX_MIN_ROWS);
  const r = await s.search({ q: 'Browns' });
  assert.equal(fetchImpl.calls.length, 1, 'now ours: Nominatim not asked again');
  assert.ok(r.places.length >= 3);
});

test('an index that throws is logged and the search is Nominatim alone', async () => {
  const errors = [];
  const s = createPlaceSearch({
    fetchImpl: nominatimFetch([NOMINATIM_BROWN]), turn: instant, onError: (e) => errors.push(e),
    index: { search: async () => { throw new Error('boom'); } },
  });
  assert.deepEqual(await s.search({ q: 'Brown Coffee' }), { places: [placeFromResult(NOMINATIM_BROWN)] });
  assert.match(String(errors[0]?.message), /boom/);
});

// ---------------------------------------------------------------- the stored copy and its refresh

test('a fresh stored copy: loaded once, searched at once, Overpass never asked', async () => {
  let now = 5_000_000_000;
  const store = memoryIndexStore({ at: now - INDEX_MAX_AGE_MS + 60e3, rows: ROWS });
  const fetchImpl = overpassFetch();
  const index = createPlaceIndex({ fetchImpl, store, now: () => now, onError: () => {} });
  assert.ok((await index.search({ q: 'Browns', centre: PP })).places.length >= 3);
  await index.search({ q: 'starbucks' });
  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(INDEX_MAX_AGE_MS, 7 * 864e5, 'a week');
});

test('an old copy (over 7 days) is served at once while ONE refresh runs; then the new one, stored', async () => {
  let now = 5_000_000_000;
  const oldRows = ROWS.filter((r) => r[ROW.id] !== 'n107'); // no Starbucks in the old copy
  const store = memoryIndexStore({ at: now - INDEX_MAX_AGE_MS - 1, rows: oldRows });
  let answer;
  const pending = new Promise((r) => { answer = r; });
  const fetchImpl = overpassFetch(() => pending);
  const index = createPlaceIndex({ fetchImpl, store, now: () => now, onError: () => {} });
  const t0 = Date.now();
  const first = await index.search({ q: 'Browns', centre: PP });
  assert.ok(first.places.length >= 3 && first.sure === first.places.length, 'the old copy answers');
  assert.ok(Date.now() - t0 < 500, 'without waiting for Overpass');
  await tick(5);
  assert.deepEqual(await index.search({ q: 'starbucks' }), { places: [], sure: 0 }, 'still the old copy');
  const running = index.refresh();
  assert.equal(index.refresh(), running, 'a second refresh is the same one');
  await Promise.all([index.search({ q: 'brown' }), index.search({ q: 'aeon' })]);
  assert.equal(fetchImpl.calls.length, 1, 'one refresh at a time');
  assert.equal(index.info().refreshing, true);
  answer(ANSWER);
  await tick(5);
  assert.equal(index.info().refreshing, false);
  assert.equal(index.info().at, now);
  assert.equal((await index.search({ q: 'starbucks' })).places[0].name, 'Starbucks', 'the new copy');
  assert.equal(store.saves, 1, 'stored');
  assert.equal(decodeCopy(store.bytes()).rows.length, ROWS.length);
  await index.search({ q: 'brown' });
  assert.equal(fetchImpl.calls.length, 1, 'fresh again: no more asks');
});

test('Overpass fails (an error, a "runtime error" remark, too few places, no answer): the old copy stays; tried again only after an hour', async () => {
  let now = 5_000_000_000;
  const errors = [];
  const old = { at: now - INDEX_MAX_AGE_MS - 1, rows: ROWS.slice(0, 20) };
  const answers = [
    () => new Response('{"error":"rate limited"}', { status: 429 }),
    () => ({ remark: 'runtime error: Query timed out in "query" at line 3 after 91 seconds.', elements: ELEMENTS }),
    () => ({ elements: ELEMENTS }), // fewer than INDEX_MIN_ROWS places
    () => { throw new TypeError('fetch failed'); },
  ];
  for (const reply of answers) {
    const store = memoryIndexStore(old);
    const fetchImpl = overpassFetch(reply);
    const index = createPlaceIndex({ fetchImpl, store, now: () => now, onError: (e) => errors.push(e) });
    assert.ok((await index.search({ q: 'brown' })).places.length > 0, 'the old copy answers');
    await tick(5);
    assert.equal(fetchImpl.calls.length, 1);
    assert.equal(index.info().at, old.at, 'the old copy stays');
    assert.equal(store.saves, 0, 'nothing written over it');
    await index.search({ q: 'brown' });
    now += INDEX_RETRY_MS - 1000;
    await index.search({ q: 'brown' });
    await tick(5);
    assert.equal(fetchImpl.calls.length, 1, 'not again within the hour');
    now += 2000;
    await index.search({ q: 'brown' });
    await tick(5);
    assert.equal(fetchImpl.calls.length, 2, 'an hour later: once more');
  }
  assert.ok(errors.some((e) => /HTTP 429/.test(e.message)));
  assert.ok(errors.some((e) => /runtime error/.test(e.message)));
  assert.ok(errors.some((e) => /only \d+ places/.test(e.message)));
  assert.ok(errors.some((e) => /fetch failed/.test(e.message)));
  assert.equal(INDEX_RETRY_MS, 3600e3);
  assert.equal(INDEX_MIN_ROWS, 50);
});

test('the refresh reads the store again first: a fresh copy another server stored is used, Overpass not asked', async () => {
  let now = 5_000_000_000;
  const store = memoryIndexStore({ at: now - INDEX_MAX_AGE_MS - 1, rows: ROWS.slice(0, 10) });
  const fetchImpl = overpassFetch();
  const index = createPlaceIndex({ fetchImpl, store, now: () => now, onError: () => {} });
  await index.load();
  await store.save({ at: now - 1000, rows: ROWS }); // another server refreshed meanwhile
  assert.equal(await index.refresh(), true);
  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(index.info().count, ROWS.length);
});

test('the first search waits for the stored copy only a moment (then Nominatim alone), and only once', async () => {
  let release;
  const slow = { kind: 'slow', load: () => new Promise((r) => { release = r; }), save: async () => {} };
  const index = createPlaceIndex({ fetchImpl: overpassFetch(), store: slow, waitMs: 30, onError: () => {} });
  const t0 = Date.now();
  assert.equal(await index.search({ q: 'brown' }), null);
  assert.ok(Date.now() - t0 < 500);
  const t1 = Date.now();
  assert.equal(await index.search({ q: 'brown' }), null);
  assert.ok(Date.now() - t1 < 20, 'not a second wait');
  release({ at: Date.now(), rows: ROWS });
  await tick(5);
  assert.ok((await index.search({ q: 'brown' })).places.length > 0);
});

test('a store that fails to load: logged, then the list is fetched from Overpass', async () => {
  const errors = [];
  const store = { kind: 'broken', load: async () => { throw new Error('mongo down'); }, save: async () => { throw new Error('mongo down'); } };
  const fetchImpl = overpassFetch();
  const index = createPlaceIndex({ fetchImpl, store, onError: (e) => errors.push(e) });
  assert.equal(await index.search({ q: 'brown' }), null);
  await tick(10);
  assert.equal(fetchImpl.calls.length, 1);
  assert.ok((await index.search({ q: 'brown' })).places.length > 0, 'in memory even when it could not be stored');
  assert.ok(errors.length >= 2);
});

test('stores: a gzip\'d copy well under 1 MB — one file (dev) or one Mongo doc (live), read back the same', async () => {
  const big = Array.from({ length: 3000 }, (_, i) => ['n' + i, 'restaurant', 11.5 + i * 1e-5, 104.9, `Restaurant number ${i}`, '', 'ភោជនីយដ្ឋាន', '', '', '', 'Brand', '', 'Street 271', 'Sangkat Tuol Svay Prey Ti Muoy']);
  const bytes = encodeCopy({ at: 1, rows: big });
  assert.ok(bytes.length < INDEX_MAX_BYTES / 4, `${bytes.length} bytes`);
  assert.deepEqual(decodeCopy(bytes), { at: 1, rows: big });
  assert.equal(INDEX_MAX_BYTES, 1e6);

  const dir = mkdtempSync(join(tmpdir(), '30da-places-'));
  try {
    const file = pathToFileURL(join(dir, 'sub', 'index.json.gz'));
    const fs = fileIndexStore(file);
    assert.equal(await fs.load(), null, 'no file yet');
    await fs.save({ at: 7, rows: ROWS });
    assert.deepEqual(await fs.load(), { at: 7, rows: ROWS });
    assert.equal(existsSync(new URL('index.json.gz.tmp', file)), false, 'no half file left');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // One doc, written over in place.
  const docs = new Map();
  const db = { collection: (name) => { assert.equal(name, INDEX_COLLECTION); return {
    findOne: async (q) => docs.get(q._id) ?? null,
    replaceOne: async (q, doc, opts) => { assert.equal(opts.upsert, true); docs.set(q._id, { _id: q._id, ...doc }); },
  }; } };
  const ms = mongoIndexStore(async () => db);
  assert.equal(await ms.load(), null);
  await ms.save({ at: 8, rows: ROWS });
  await ms.save({ at: 9, rows: ROWS });
  assert.equal(docs.size, 1);
  const doc = docs.get(INDEX_DOC);
  assert.deepEqual(Object.keys(doc).sort(), ['_id', 'at', 'bytes', 'count', 'gz', 'v']);
  assert.equal(doc.count, ROWS.length);
  assert.ok(doc.bytes < 50_000);
  assert.deepEqual(await ms.load(), { at: 9, rows: ROWS });
  // As the driver gives a stored Buffer back: a BSON Binary.
  docs.set(INDEX_DOC, { ...doc, gz: { read: (at, n) => doc.gz.subarray(at, at + n), length: () => doc.gz.length } });
  assert.deepEqual(await ms.load(), { at: 9, rows: ROWS });
  assert.equal(defaultIndexStore({ THIRTYDA_PHOTO_STORE: 'mongo' }).kind, 'mongo');
  assert.equal(defaultIndexStore({}).kind, 'local');
  assert.equal(decodeCopy(Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0])), null, 'not one of ours');
});

// ---------------------------------------------------------------- the wiring

test('the server asks our list first: the meeting routes build the place search with the index; Overpass is a test-fetch host', () => {
  const meet = readFileSync(new URL('./thirtyda-meet.mjs', import.meta.url), 'utf8');
  assert.match(meet, /import \{ createPlaceIndex \} from "\.\/thirtyda-places-index\.mjs";/);
  // One list and one search per server, shared with the Code page's Tower 12 (src/lib/thirtyda-hub-places.mjs).
  assert.match(meet, /export const placeIndex = \(\) => \(sharedIndex \?\?= createPlaceIndex\(\{ fetchImpl: outboundFetch\(\) \}\)\);/);
  assert.match(meet, /export const placeSearch = \(\) => \(sharedSearch \?\?= createPlaceSearch\(\{ fetchImpl: outboundFetch\(\), index: placeIndex\(\) \}\)\);/);
  assert.match(meet, /const searcher = \(\) => \(search \?\?= placeSearch\(\)\);/);
  const tf = readFileSync(new URL('./thirtyda-test-fetch.mjs', import.meta.url), 'utf8');
  assert.match(tf, /"overpass-api\.de",/);
  const del = readFileSync(new URL('./thirtyda-delete.mjs', import.meta.url), 'utf8');
  assert.match(del, /thirtyda_places_index: null,/, 'holds no person');
});

test('the sheet credits OpenStreetMap where its suggestions show (ODbL), in all 5 languages', () => {
  const src = readFileSync(new URL('../thirtyda-app/screens/meet.js', import.meta.url), 'utf8');
  assert.match(src, /el\('a', \{ href: 'https:\/\/www\.openstreetmap\.org\/copyright', target: '_blank', rel: 'noopener noreferrer' \}, t\('meet_osm'\)\)/);
  assert.match(src, /note, results, credit\);/);
  assert.match(src, /credit\.hidden = !found\.length;/);
  assert.match(src, /meet_osm: '© OpenStreetMap contributors',/);
  for (const w of ['© អ្នករួមចំណែក OpenStreetMap', '© OpenStreetMap 贡献者', '© OpenStreetMap 기여자', '© OpenStreetMap 貢献者']) assert.ok(src.includes(`meet_osm: '${w}',`), w);
});
