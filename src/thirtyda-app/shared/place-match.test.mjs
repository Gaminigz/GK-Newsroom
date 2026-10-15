// Run: npm run 30da:test (or node --test src/thirtyda-app/shared/place-match.test.mjs)
// How a place search is matched and ranked (owner 2026-10-15: "Browns" found nothing), shared/place-match.js: the words
// it forgives (case, accents, plurals, synonyms, a word begun, a small typo), the area words that pick an area instead
// of matching the name, Khmer / Chinese / Korean / Japanese parts of a name, and the order (area, whole name, every word,
// begun, typo; then nearer). The server's own list (src/lib/thirtyda-places-index.mjs) and the board demo both use it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normPlace, stem, wordForms, typoDistance, typosAllowed, placeQuery, placeEntry, matchPlaces, areaLabel, inPlaceArea,
  kmBetween, PLACE_AREAS, isLatinWord,
} from './place-match.js';

const TK = { lat: 11.5808, lng: 104.8959 };
const BKK1 = { lat: 11.5533, lng: 104.9248 };
const SEN_SOK = { lat: 11.605, lng: 104.879 };
const PP = { lat: 11.56, lng: 104.93 };

const PLACES = [
  placeEntry({ names: ['Brown Coffee', 'ប្រោនកាហ្វេ'], kind: 'cafe', ...TK, areaText: 'Street 315' }, 'brown-tk'),
  placeEntry({ names: ['Brown Coffee'], kind: 'cafe', ...BKK1, areaText: 'Street 57 Sangkat Boeng Keng Kang Muoy' }, 'brown-bkk1'),
  placeEntry({ names: ['Brown Coffee'], kind: 'cafe', ...SEN_SOK }, 'brown-sensok'),
  placeEntry({ names: ['Browny Burger'], kind: 'fast_food', lat: 11.57, lng: 104.92 }, 'browny'),
  placeEntry({ names: ['Starbucks', '星巴克', '스타벅스', 'スターバックス'], kind: 'cafe', lat: 11.551, lng: 104.928 }, 'starbucks'),
  placeEntry({ names: ['TK Avenue'], kind: 'mall', lat: 11.5833, lng: 104.8986 }, 'tk-avenue'),
  placeEntry({ names: ['AEON Mall Phnom Penh'], kind: 'mall', lat: 11.5481, lng: 104.9326 }, 'aeon1'),
  placeEntry({ names: ['Sorya Shopping Center'], kind: 'mall', lat: 11.5687, lng: 104.9205 }, 'sorya'),
  placeEntry({ names: ['Riverside Bistro'], kind: 'restaurant', lat: 11.5705, lng: 104.9302 }, 'riverside-bistro'),
  placeEntry({ names: ['Café Lumière'], kind: 'cafe', lat: 11.556, lng: 104.92 }, 'lumiere'),
  placeEntry({ names: ['The Shop'], kind: 'bakery', lat: 11.553, lng: 104.926 }, 'the-shop'),
];
const find = (q, centre = PP, limit = 6) => matchPlaces(PLACES, q, { centre, limit }).map((m) => m.entry.data);

test('normPlace: lowercase, no accents, no punctuation, single spaces; Khmer marks and CJK stay', () => {
  assert.equal(normPlace("  Brown's  Café — BKK1! "), 'browns cafe bkk1');
  assert.equal(normPlace('CAFÉ LUMIÈRE'), 'cafe lumiere');
  assert.equal(normPlace('Ｂｒｏｗｎ'), 'brown', 'full-width letters');
  assert.equal(normPlace('ប្រោនកាហ្វេ'), 'ប្រោនកាហ្វេ', 'the coeng and the vowel signs are marks: kept');
  assert.equal(normPlace('星巴克（金边）'), '星巴克 金边');
  assert.equal(normPlace(null), '');
  assert.equal(isLatinWord('brown'), true);
  assert.equal(isLatinWord('57'), true);
  assert.equal(isLatinWord('ប្រោន'), false);
});

test('a plural or a possessive is the word; synonyms are one word', () => {
  assert.equal(stem('browns'), 'brown');
  assert.equal(stem('cafes'), 'cafe');
  for (const w of ['glass', 'tous', 'paris', 'bus', 'brown']) assert.equal(stem(w), w, w);
  for (const w of ['coffee', 'cafe', 'kafe', 'coffees', 'cafes']) assert.ok(wordForms(w).includes('cafe'), w);
  assert.ok(wordForms('pub').includes('bar'));
  assert.deepEqual(placeQuery('brown coffee shop').required.map((r) => r.w), ['brown', 'cafe'], '"coffee shop" is one word: cafe');
  assert.deepEqual(placeQuery('shopping center').required.map((r) => r.w), ['mall']);
});

test('typos: Damerau–Levenshtein, none under 4 letters, 1 from 4, 2 from 8', () => {
  assert.equal(typoDistance('bown', 'brown'), 1, 'a letter missing');
  assert.equal(typoDistance('borwn', 'brown'), 1, 'two letters swapped');
  assert.equal(typoDistance('brovn', 'brown'), 1, 'a letter wrong');
  assert.equal(typoDistance('browwn', 'brown'), 1, 'a letter extra');
  assert.equal(typoDistance('starbukcs', 'starbucks'), 1);
  assert.equal(typoDistance('abcdef', 'uvwxyz', 2), 3, 'counted only up to max');
  assert.deepEqual([typosAllowed('bar'), typosAllowed('bown'), typosAllowed('starbuck'), typosAllowed('cafe')], [0, 1, 2, 1]);
  assert.deepEqual(find('Bown Coffee'), ['brown-tk', 'brown-bkk1', 'brown-sensok'].sort((a, b) => kmBetween(PP, PLACES.find((p) => p.data === a)) - kmBetween(PP, PLACES.find((p) => p.data === b))));
  assert.deepEqual(find('starbuks'), ['starbucks']);
  assert.deepEqual(find('strabucks'), ['starbucks'], '"tr" ↔ "ta" swapped');
  assert.deepEqual(find('bat'), [], 'a 3-letter word has no typo room ("bat" is not "bar")');
  assert.equal(find('brxwn cxffee').length, 3, 'one typo in each word is fine …');
  assert.deepEqual(find('brxwx'), [], '… two in a word under 8 letters is not');
  assert.deepEqual(find('strabuks'), ['starbucks'], 'two in a word of 8');
});

test('"Browns" finds the Brown Coffee branches (nearest first), then a name that only begins with it', () => {
  assert.deepEqual(find('Browns'), ['brown-bkk1', 'brown-tk', 'brown-sensok', 'browny']);
  assert.deepEqual(find('browns', SEN_SOK), ['brown-sensok', 'brown-tk', 'brown-bkk1', 'browny'], 'nearer to the person first');
  assert.deepEqual(find('brown coffee').slice(0, 3).sort(), ['brown-bkk1', 'brown-sensok', 'brown-tk']);
  const m = matchPlaces(PLACES, 'Brown Coffee', { centre: PP });
  assert.deepEqual(m.slice(0, 3).map((x) => x.tier), [4, 4, 4], 'the whole name');
  assert.equal(matchPlaces(PLACES, 'Browns', { centre: PP })[0].tier, 3, 'every word whole');
  assert.equal(matchPlaces(PLACES, 'Browns', { centre: PP }).at(-1).tier, 2, '"browny": begun');
  assert.equal(matchPlaces(PLACES, 'Bown', { centre: PP })[0].tier, 1, 'a typo');
  assert.deepEqual(find('brown cafe'), find('brown coffee'), 'coffee / cafe');
  assert.deepEqual(find("Brown's Coffee"), find('brown coffee'));
});

test('area words pick the area instead of matching the name: "brown coffee tk", "Brown BKK1", Khmer too', () => {
  assert.equal(find('brown coffee tk')[0], 'brown-tk');
  assert.equal(find('brown coffee tk', SEN_SOK)[0], 'brown-tk', 'the area beats nearness');
  assert.equal(find('brown coffee toul kork')[0], 'brown-tk');
  assert.equal(find('brown coffee tuol kouk', BKK1)[0], 'brown-tk');
  assert.equal(find('Brown BKK1', TK)[0], 'brown-bkk1');
  assert.equal(find('brown bkk 1', TK)[0], 'brown-bkk1');
  assert.equal(find('brown boeung keng kang', TK)[0], 'brown-bkk1');
  assert.equal(find('brown coffee in tk')[0], 'brown-tk', '"in" is only a linking word');
  assert.equal(find('ប្រោន ទួលគោក', BKK1)[0], 'brown-tk', 'a Khmer area word');
  const q = placeQuery('Brown Coffee TK');
  assert.deepEqual([q.required.map((r) => r.w), q.areas.map((a) => a.id)], [['brown', 'coffee'], ['tk']]);
  assert.equal(q.key, 'brown cafe', 'the exact name, synonyms as one');
  // The area by the place's own address words too (here BKK1's sangkat), not only by its point.
  const far = placeEntry({ names: ['Brown Coffee'], kind: 'cafe', lat: 11.6, lng: 104.95, areaText: 'Sangkat Boeng Keng Kang Muoy' }, 'tagged');
  assert.equal(matchPlaces([...PLACES, far], 'brown bkk1', { centre: TK }).filter((m) => m.inArea).length, 2);
  // Only area words: then they are the name ("riverside", "tk") — and the area still comes first.
  assert.deepEqual(find('riverside'), ['riverside-bistro']);
  assert.deepEqual(find('tk'), ['tk-avenue']);
  assert.deepEqual(find('TK Avenue'), ['tk-avenue']);
  assert.equal(matchPlaces(PLACES, 'TK Avenue', { centre: PP })[0].tier, 4, 'an area word that is the name too: the whole name');
});

test('a kind word finds places of that kind as well as by name: "cafe tk", "mall"', () => {
  const cafes = find('cafe tk', TK, 0);
  assert.equal(cafes[0], 'brown-tk');
  assert.ok(cafes.includes('starbucks'), 'a café whatever its name');
  assert.ok(!cafes.includes('tk-avenue'), 'not a café');
  assert.deepEqual(find('mall', PP, 0).sort(), ['aeon1', 'sorya', 'tk-avenue'].sort());
  assert.equal(matchPlaces(PLACES, 'mall', { centre: PP })[0].entry.data, 'aeon1', 'a name with the word first');
  assert.deepEqual(find('aeon'), ['aeon1']);
  assert.deepEqual(find('lumiere'), ['lumiere'], 'accents aside');
  assert.deepEqual(find('the shop'), ['the-shop']);
});

test('a synonym never makes another kind of place a whole-word hit: "mall" is no Plaza hotel, "pagoda" no Temple Bar', () => {
  const list = [
    placeEntry({ names: ['Golden Plaza Hotel'], kind: 'hotel', lat: 11.571, lng: 104.902 }, 'golden-plaza'),
    placeEntry({ names: ['Plaza Noodle House'], kind: 'restaurant', lat: 11.5712, lng: 104.9021 }, 'plaza-noodle'),
    placeEntry({ names: ['Temple Club'], kind: 'bar', lat: 11.5714, lng: 104.9022 }, 'temple-club'),
    placeEntry({ names: ['Temple Bar'], kind: 'bar', lat: 11.5716, lng: 104.9023 }, 'temple-bar'),
    placeEntry({ names: ['Garden Bistro'], kind: 'restaurant', lat: 11.5718, lng: 104.9024 }, 'garden-bistro'),
    placeEntry({ names: ['Hun Sen Park'], kind: 'park', lat: 11.55, lng: 104.93 }, 'park'),
    placeEntry({ names: ['Royal Garden'], kind: 'garden', lat: 11.56, lng: 104.93 }, 'royal-garden'),
    placeEntry({ names: ['Wat Phnom'], kind: 'attraction', lat: 11.5762, lng: 104.9231 }, 'wat-phnom'),
    placeEntry({ names: ['AEON Mall Phnom Penh'], kind: 'mall', lat: 11.5481, lng: 104.9326 }, 'aeon1'),
    placeEntry({ names: ['Olympia City'], kind: 'mall', lat: 11.5640, lng: 104.9010 }, 'olympia'),
  ];
  const near = { lat: 11.571, lng: 104.902 };
  const f = (q) => matchPlaces(list, q, { centre: near, limit: 0 }).map((m) => m.entry.data);
  assert.deepEqual(f('mall'), ['aeon1', 'olympia'], 'the malls: by name, then by kind');
  assert.deepEqual(f('pagoda'), ['wat-phnom'], 'wat is a pagoda; a temple bar is not');
  assert.deepEqual(f('wat'), ['wat-phnom']);
  assert.deepEqual(f('park').sort(), ['park', 'royal-garden'].sort(), 'parks and gardens by kind, no Garden Bistro');
  assert.ok(f('garden').includes('royal-garden') && f('garden').includes('park'), '"garden": gardens and parks by kind');
  assert.deepEqual(f('golden plaza'), ['golden-plaza'], 'its own name still finds it');
  for (const w of ['plaza', 'temple', 'garden', 'cafeteria']) assert.deepEqual(wordForms(w), [w], `${w}: no synonym`);
  // Kinds the server's list does not hold: the search says so (Nominatim is asked too).
  for (const q of ['pagoda', 'wat', 'market', 'phsar thmei', 'temple', 'russian market']) assert.equal(placeQuery(q).elsewhere, true, q);
  for (const q of ['brown coffee', 'mall', 'cafe tk']) assert.equal(placeQuery(q).elsewhere, false, q);
});

test('"&" is "and"; a street, an area or a branch counts with the name; the city and the country say nothing', () => {
  assert.equal(normPlace('Brown Coffee & Bakery'), 'brown coffee and bakery');
  assert.equal(normPlace('Ｂｒｏｗｎ ＆ Co'), 'brown and co', 'a full-width & too');
  const list = [
    placeEntry({ names: ['Brown Coffee & Bakery'], kind: 'cafe', lat: 11.5705, lng: 104.9302, areaText: 'Sisowath Quay' }, 'bakery'),
    placeEntry({ names: ['Brown Coffee'], kind: 'cafe', lat: 11.5481, lng: 104.9326, areaText: 'Norodom Boulevard' }, 'norodom'),
    placeEntry({ names: ['Brown Coffee'], kind: 'cafe', ...SEN_SOK, areaText: 'Aeon Mall Sen Sok' }, 'aeon'),
    placeEntry({ names: ['Starbucks'], kind: 'cafe', lat: 11.551, lng: 104.928, areaText: 'Street 51 Aeon Mall' }, 'starbucks'),
    placeEntry({ names: ['Norodom Sihanouk Memorial'], kind: 'attraction', lat: 11.5564, lng: 104.9282 }, 'memorial'),
  ];
  const f = (q) => matchPlaces(list, q, { centre: PP, limit: 0 }).map((m) => m.entry.data);
  for (const q of ['brown coffee and bakery', 'coffee & bakery', 'brown and bakery']) assert.equal(f(q)[0], 'bakery', q);
  assert.deepEqual(f('Brown Coffee Norodom'), ['norodom'], 'its street');
  assert.deepEqual(f('brown coffee norod'), ['norodom'], 'the start of a word of it');
  assert.deepEqual(f('brown coffee aeon'), ['aeon'], 'its branch');
  assert.deepEqual(f('Starbucks Aeon'), ['starbucks']);
  assert.deepEqual(f('cafe norodom'), ['norodom'], 'the kind and the street');
  assert.equal(matchPlaces(list, 'Brown Coffee Norodom', { centre: PP })[0].tier, 2, 'below a name that has every word');
  assert.deepEqual(f('norodom'), ['memorial'], 'a street alone finds names, never every place on it');
  for (const q of ['Browns Phnom Penh', 'browns in phnom penh', 'browns pp', 'browns, Cambodia', 'browns phnompenh']) {
    assert.deepEqual(placeQuery(q).required.map((r) => r.w), ['browns'], q);
  }
  assert.deepEqual(placeQuery('星巴克 金边').required.map((r) => r.w), ['星巴克']);
  assert.deepEqual(placeQuery('ប្រោន ភ្នំពេញ').required.map((r) => r.w), ['ប្រោន']);
  assert.deepEqual(placeQuery('phnom penh').required.map((r) => r.w), ['phnom', 'penh'], 'the city alone stays');
  assert.deepEqual(placeQuery('in phnom penh').required.map((r) => r.w), ['phnom', 'penh']);
  assert.deepEqual(placeQuery('wat phnom').required.map((r) => r.w), ['wat', 'phnom'], '"phnom" alone is not the city');
  assert.deepEqual(placeQuery('PP coffee').required.map((r) => r.w), ['coffee']);
  assert.equal(placeQuery('PP coffee').fullKey, 'pp cafe', 'a name with it is still the whole name');
});

test('Khmer, Chinese, Korean, Japanese: any part of a name in that script', () => {
  assert.deepEqual(find('ប្រោន'), ['brown-tk']);
  assert.deepEqual(find('កាហ្វេ'), ['brown-tk']);
  assert.equal(matchPlaces(PLACES, 'ប្រោនកាហ្វេ', { centre: PP })[0].tier, 4, 'the whole Khmer name');
  assert.deepEqual(find('星巴'), ['starbucks']);
  assert.deepEqual(find('스타벅스'), ['starbucks']);
  assert.deepEqual(find('スターバ'), ['starbucks']);
  assert.deepEqual(find('ការ'), [], 'not in any name');
});

test('nothing to match: empty, only punctuation, only one letter', () => {
  for (const q of ['', '   ', '!!', 'b', 'b c', '-']) assert.deepEqual(find(q), [], JSON.stringify(q));
  assert.deepEqual(matchPlaces([], 'brown'), []);
  assert.equal(find('brown c').length, 3, 'one letter with other words: the start of a word ("c" → coffee)');
});

test('areas: the smallest area around a point names it (English or Khmer); points outside every area have none', () => {
  assert.equal(areaLabel(TK.lat, TK.lng), 'Toul Kork');
  assert.equal(areaLabel(BKK1.lat, BKK1.lng), 'BKK1', 'BKK1 inside Boeung Keng Kang: the smaller one');
  assert.equal(areaLabel(BKK1.lat, BKK1.lng, 'km'), 'បឹងកេងកង១');
  assert.equal(areaLabel(11.5705, 104.9302), 'Riverside');
  assert.equal(areaLabel(11.5399, 104.9187), 'Russian Market');
  assert.equal(areaLabel(SEN_SOK.lat, SEN_SOK.lng), 'Sen Sok');
  assert.equal(areaLabel(11.3, 104.6), null);
  assert.equal(areaLabel(NaN, 104.9), null);
  const ids = PLACE_AREAS.map((a) => a.id);
  for (const id of ['tk', 'bkk1', 'bkk', 'riverside', '7makara', 'daunpenh', 'chamkarmon', 'sensok', 'russeykeo', 'chbarampov']) assert.ok(ids.includes(id), id);
  assert.equal(new Set(ids).size, ids.length);
  for (const a of PLACE_AREAS) {
    assert.ok(a.label && a.km && a.words.length, a.id);
    assert.ok(inPlaceArea(a, a.box ? (a.box.south + a.box.north) / 2 : a.lat, a.box ? (a.box.west + a.box.east) / 2 : a.lng), a.id);
    for (const w of a.words) assert.equal(normPlace(w), w, `${a.id}: "${w}" as normPlace leaves it`);
  }
  assert.ok(Math.abs(kmBetween(TK, BKK1) - 4.3) < 0.3, 'about 4.3 km');
});

test('the board demo searches its DEMO_PLACES with this file (board/demo.js), and "Browns" / "brown tk" work there too', () => {
  const demo = readFileSync(new URL('../board/demo.js', import.meta.url), 'utf8');
  assert.match(demo, /import\('\/30da\/shared\/place-match\.js'\),/);
  assert.match(demo, /R\.matchPlaces\(demoEntries, q, \{ centre: \{ lat: 11\.56, lng: 104\.93 \} \}\)\.map\(\(m\) => m\.entry\.data\)/);
  // The demo's own list, as it is in the file.
  const list = demo.slice(demo.indexOf('const DEMO_PLACES = ['), demo.indexOf('];', demo.indexOf('const DEMO_PLACES = [')) + 2);
  const DEMO_PLACES = (0, eval)(`(${list.replace('const DEMO_PLACES = ', '').replace(/;$/, '')})`);
  assert.equal(DEMO_PLACES.length, 5);
  const entries = DEMO_PLACES.map((p) => placeEntry({ names: [p.name], lat: p.lat, lng: p.lng, areaText: p.address }, p.name));
  const q = (s) => matchPlaces(entries, s, { centre: PP }).map((m) => m.entry.data);
  assert.deepEqual(q('Browns').sort(), ['Brown Coffee BKK1', 'Brown Coffee Toul Kork']);
  assert.equal(q('brown tk')[0], 'Brown Coffee Toul Kork');
  assert.equal(q('Brown BKK1')[0], 'Brown Coffee BKK1');
  assert.deepEqual(q('wat phnom'), ['Wat Phnom']);
  assert.deepEqual(q('aeon'), ['Aeon Mall Phnom Penh']);
  assert.deepEqual(q('independance monument'), ['Independence Monument'], 'a typo');
});

test('among equals the better words rank before the nearer place: "Bown Coffee", "cafe riverside" (real rows, 2026-10-15)', () => {
  const RIVER = { lat: 11.5600, lng: 104.9292 };
  const near = { lat: 11.5605, lng: 104.9293 };
  const far = { lat: 11.5640, lng: 104.9300 };
  const rows = [
    // OpenStreetMap tags "Pho Bowl" a café; "bown" is one letter off "bowl" as it is off "brown" — and it is the nearer.
    placeEntry({ names: ['Pho Bowl'], kind: 'cafe', ...near }, 'pho-bowl'),
    placeEntry({ names: ['Brown 51'], kind: 'cafe', ...far }, 'brown-51'),
    placeEntry({ names: ['Brown Coffee'], kind: 'cafe', lat: 11.5700, lng: 104.9300 }, 'brown-coffee'),
    // A restaurant whose old English name still says "Cafe", nearest of all; the cafés are a little further.
    placeEntry({ names: ['Taqueria Corona', 'Lone Pine Cafe'], kind: 'restaurant', ...near }, 'taqueria'),
    placeEntry({ names: ['Enso Cafe'], kind: 'cafe', ...far }, 'enso'),
  ];
  const ids = (q) => matchPlaces(rows, q, { centre: RIVER }).map((m) => m.entry.data);
  assert.deepEqual(ids('Bown Coffee').slice(0, 2), ['brown-coffee', 'brown-51'], 'both words, then the name begun by "bown"');
  assert.equal(ids('Bown Coffee').at(-1), 'pho-bowl', 'Pho Bowl last');
  const river = ids('cafe riverside');
  assert.ok(river.indexOf('enso') < river.indexOf('taqueria'), 'the café before the restaurant');
  // The whole name still comes first, however far: then "Brown" + a café; Pho Bowl is no match without the typo.
  assert.deepEqual(ids('Brown Coffee'), ['brown-coffee', 'brown-51']);
});
