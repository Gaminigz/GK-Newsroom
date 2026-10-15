// Our own list of places to meet at (owner 2026-10-15: "Browns" said "No places found" — OpenStreetMap's Nominatim
// matches whole words only, and the café is "Brown Coffee"): how a place search is matched and ranked, written once.
// The server (src/lib/thirtyda-places-index.mjs) searches its OpenStreetMap list of named cafés, restaurants, bars,
// malls, parks … in greater Phnom Penh with it before it asks Nominatim; the board demo (board/demo.js) its DEMO_PLACES.
//
// What a search forgives:
//   case, accents, punctuation and spaces ("Café", "cafe", "CAFE!"); "&" is "and";
//   a plural or a possessive ("Browns", "Brown's" → brown);
//   the same thing said another way (coffee / cafe / café / kafe / coffee shop; mall / shopping center; pub / bar …) —
//   never a word that names other kinds of place too ("Golden Plaza Hotel" is no mall, "Temple Bar" no pagoda);
//   the start of a word ("Starb"), and a small typo — one letter wrong, missing, extra or two swapped in a word of 4 or
//   more letters, two in a word of 8 or more ("Bown Coffee", "Starbuks"); nothing in a shorter word;
//   an area word ("tk", "Toul Kork", "BKK1", "riverside", "7 Makara", "ទួលគោក" …): it picks the area instead of
//   matching the name, and places there come first ("Brown Coffee TK" → the Toul Kork branch). A search of area words
//   only ("riverside") matches them in the names;
//   Khmer, Chinese, Korean and Japanese: any part of a name in that script ("ប្រោន" finds "ប្រោនកាហ្វេ");
//   a word of the place's own street, area or branch, with a word of its name ("Brown Coffee Norodom", "Starbucks
//   Aeon"); the city or the country ("Browns Phnom Penh", "星巴克 金边": the whole list is Phnom Penh).
// Ranked: in the area asked for > the whole name > every word whole > a word begun (or the kind: "cafe" finds every
// café; or its street, area or branch) > a typo; then nearer to the person; then more words matched.

const LATIN_MARKS = /[̀-ͯ]/g;

/** A name or a search as it is matched: lowercase, no accents (Latin), no punctuation, single spaces. */
export function normPlace(s) {
  return String(s ?? '')
    .normalize('NFKD').replace(LATIN_MARKS, '').normalize('NFC')
    .toLowerCase()
    .replace(/['’‘`ʼ]/g, '') // "Brown's" → "browns"
    .replace(/&/g, ' and ') // "Brown Coffee & Bakery" is found by "brown coffee and bakery"
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ') // Khmer vowel signs and the coeng are marks (\p{M}): they stay
    .trim();
}

const LATIN_WORD = /^[\p{Script=Latin}\p{N}]+$/u;
/** A word matched word by word (Latin letters, digits); anything else (Khmer, CJK, Hangul, Kana) as part of a name. */
export const isLatinWord = (w) => LATIN_WORD.test(w);

/** One plural or possessive "s" off a word of 4+ letters ("browns" → "brown"; "glass", "tous", "paris" stay). */
export function stem(w) {
  return w.length >= 4 && /^[a-z]+s$/.test(w) && !/(ss|us|is)$/.test(w) ? w.slice(0, -1) : w;
}

// The same thing said another way: every word of a group stands for the first one, in a search AND in a name — so never
// a word that names other kinds of place too (plaza: "Golden Plaza Hotel"; temple: "Temple Bar"; garden: "Garden
// Bistro"; cafeteria): it would make them whole-word hits for "mall", "pagoda", "park", ahead of the real ones.
const SYNONYM_GROUPS = [
  ['cafe', 'coffee', 'kafe', 'caffe', 'kopi', 'coffeeshop'],
  ['mall', 'shoppingmall', 'shoppingcenter', 'shoppingcentre'],
  ['restaurant', 'resto', 'restaurante'],
  ['bar', 'pub', 'tavern'],
  ['bbq', 'barbecue', 'barbeque', 'grill'],
  ['icecream', 'gelato', 'gelateria'],
  ['bakery', 'boulangerie', 'patisserie', 'bakehouse'],
  ['pagoda', 'wat'],
  ['market', 'phsar', 'psar'],
  ['street', 'st'],
];
const CANON = new Map(SYNONYM_GROUPS.flatMap((g) => g.map((w) => [w, g[0]])));
// Two words that mean one thing: read as that one word (in a search; a name gets it as an extra word).
const PHRASES = [
  [/\bcoffee (shop|house|bar)\b/g, 'cafe'],
  [/\bshopping (center|centre|mall)\b/g, 'mall'],
  [/\bice cream\b/g, 'icecream'],
  [/\bfast food\b/g, 'fastfood'],
  [/\bfood court\b/g, 'foodcourt'],
];

/** A word's own forms: as typed, without its plural, and the first word of its synonym group. */
export function wordForms(w) {
  const s = stem(w);
  return [...new Set([w, s, CANON.get(s) ?? CANON.get(w)].filter(Boolean))];
}
const canonOf = (w) => CANON.get(stem(w)) ?? CANON.get(w) ?? stem(w);

// A search word that also finds a place by its kind ("cafe tk" → every café in Toul Kork, named so or not).
const KIND_WORDS = {
  cafe: ['cafe'],
  restaurant: ['restaurant', 'fast_food', 'food_court'],
  food: ['restaurant', 'fast_food', 'food_court', 'cafe', 'bakery'],
  fastfood: ['fast_food'],
  foodcourt: ['food_court'],
  bar: ['bar', 'pub'],
  icecream: ['ice_cream'],
  mall: ['mall'],
  bakery: ['bakery'],
  supermarket: ['supermarket'],
  park: ['park', 'garden'],
  garden: ['garden', 'park'],
  museum: ['museum'],
  viewpoint: ['viewpoint'],
  hotel: ['hotel'],
};

// ---------------------------------------------------------------- areas of Phnom Penh

/**
 * The areas a search can name instead of a place, and the area line a place without an address of its own gets.
 * Each: a box (the central khans and BKK1, whose edges are streets) or a circle (centre, radius km); its words (as
 * normPlace leaves them; Khmer too); its label (English, Khmer). Rough on purpose: a place inside counts as there, and
 * its own address tags count too; where two overlap, the smaller names the point.
 */
export const PLACE_AREAS = Object.freeze([
  { id: 'bkk1', label: 'BKK1', km: 'បឹងកេងកង១', box: { south: 11.5455, west: 104.919, north: 11.5565, east: 104.9288 },
    words: ['bkk1', 'bkk 1', 'boeung keng kang 1', 'boeng keng kang 1', 'beung keng kang 1', 'boeng keng kang muoy', 'boeung keng kang muoy', 'បឹងកេងកង១', 'បឹងកេងកងទី១'] },
  { id: 'bkk', label: 'Boeung Keng Kang', km: 'បឹងកេងកង', box: { south: 11.541, west: 104.904, north: 11.5605, east: 104.9288 },
    words: ['bkk', 'boeung keng kang', 'boeng keng kang', 'beung keng kang', 'bkk2', 'bkk 2', 'bkk3', 'bkk 3', 'បឹងកេងកង'] },
  { id: 'tk', label: 'Toul Kork', km: 'ទួលគោក', lat: 11.5790, lng: 104.8950, r: 2.0,
    words: ['tk', 'toul kork', 'tuol kouk', 'tuol kork', 'toul kouk', 'tuol kok', 'toulkork', 'tuolkouk', 'ទួលគោក'] },
  { id: 'riverside', label: 'Riverside', km: 'មាត់ទន្លេ', box: { south: 11.556, west: 104.9255, north: 11.580, east: 104.9345 },
    words: ['riverside', 'river side', 'sisowath quay', 'មាត់ទន្លេ'] },
  { id: '7makara', label: '7 Makara', km: '៧មករា', box: { south: 11.556, west: 104.898, north: 11.575, east: 104.917 },
    words: ['7 makara', '7makara', 'prampi makara', 'prampir makara', 'prampir meakkakra', 'prampi meakkakra', '៧មករា', 'ប្រាំពីរមករា'] },
  { id: 'daunpenh', label: 'Daun Penh', km: 'ដូនពេញ', box: { south: 11.556, west: 104.916, north: 11.598, east: 104.936 },
    words: ['daun penh', 'doun penh', 'duan penh', 'daunpenh', 'ដូនពេញ'] },
  { id: 'chamkarmon', label: 'Chamkar Mon', km: 'ចំការមន', box: { south: 11.524, west: 104.904, north: 11.5615, east: 104.942 },
    words: ['chamkar mon', 'chamkarmon', 'chamkar morn', 'chamkamon', 'ចំការមន'] },
  { id: 'ttp', label: 'Russian Market', km: 'ផ្សារទួលទំពូង', lat: 11.5395, lng: 104.9185, r: 0.7,
    words: ['russian market', 'ttp', 'toul tom poung', 'tuol tumpung', 'toul tompong', 'tuol tom poung', 'ផ្សារទួលទំពូង', 'ទួលទំពូង'] },
  { id: 'kohpich', label: 'Koh Pich', km: 'កោះពេជ្រ', lat: 11.5440, lng: 104.9400, r: 0.9,
    words: ['koh pich', 'kohpich', 'diamond island', 'កោះពេជ្រ'] },
  { id: 'sensok', label: 'Sen Sok', km: 'សែនសុខ', lat: 11.6030, lng: 104.8800, r: 3.0,
    words: ['sen sok', 'sensok', 'sen sokh', 'សែនសុខ'] },
  { id: 'russeykeo', label: 'Russey Keo', km: 'ឫស្សីកែវ', lat: 11.6170, lng: 104.9050, r: 3.0,
    words: ['russey keo', 'ruessei kaev', 'russei keo', 'russey kaev', 'ឫស្សីកែវ'] },
  { id: 'chbarampov', label: 'Chbar Ampov', km: 'ច្បារអំពៅ', lat: 11.5350, lng: 104.9550, r: 2.5,
    words: ['chbar ampov', 'chbar ampeou', 'chba ampov', 'ច្បារអំពៅ'] },
  { id: 'chroychangvar', label: 'Chroy Changvar', km: 'ជ្រោយចង្វារ', lat: 11.5950, lng: 104.9380, r: 2.5,
    words: ['chroy changvar', 'chrouy changvar', 'chroy changva', 'ជ្រោយចង្វារ'] },
  { id: 'meanchey', label: 'Mean Chey', km: 'មានជ័យ', lat: 11.5150, lng: 104.9250, r: 2.5,
    words: ['mean chey', 'meanchey', 'មានជ័យ'] },
  { id: 'pousenchey', label: 'Pou Senchey', km: 'ពោធិ៍សែនជ័យ', lat: 11.5450, lng: 104.8350, r: 4.0,
    words: ['pou senchey', 'por senchey', 'posenchey', 'ពោធិ៍សែនជ័យ'] },
  { id: 'dangkao', label: 'Dangkao', km: 'ដង្កោ', lat: 11.4950, lng: 104.8750, r: 3.5,
    words: ['dangkao', 'dangkor', 'ដង្កោ'] },
  { id: 'preknorv', label: 'Prek Pnov', km: 'ព្រែកព្នៅ', lat: 11.6550, lng: 104.8650, r: 4.0,
    words: ['prek pnov', 'prek phnov', 'ព្រែកព្នៅ'] },
].map((a) => Object.freeze({
  ...a,
  words: Object.freeze(a.words.map(normPlace)),
  // How big it is (km, a circle's radius or a box's like it): the smallest area around a point names it.
  size: a.box ? Math.sqrt(((a.box.north - a.box.south) * 111.32 * (a.box.east - a.box.west) * 109) / Math.PI) : a.r,
})));

const LINKING = new Set(['in', 'at', 'near', 'on', 'around', 'by']);

/** The city and the country, in the 5 app languages: the whole list is Phnom Penh, so in a search they say nothing. */
const CITY_WORDS = [
  'phnom penh', 'phnompenh', 'pp', 'cambodia', 'kampuchea', 'ភ្នំពេញ', 'កម្ពុជា', '金边', '金邊', '柬埔寨', '프놈펜', '캄보디아',
  'プノンペン', 'カンボジア',
].map(normPlace);

/** A search (` words `) without the city and the country: each Latin one as whole words, any other wherever it is. */
function withoutCity(rest) {
  let s = rest;
  for (const word of CITY_WORDS) {
    if (!word.split(' ').every(isLatinWord)) s = s.split(word).join(' ');
    else while (s.includes(` ${word} `)) s = s.replace(` ${word} `, ' ');
  }
  return ` ${s.split(' ').filter(Boolean).join(' ')} `;
}

/**
 * Kinds of place the server's own list does not hold (src/lib/thirtyda-places-index.mjs INDEX_KINDS: no pagodas, no
 * markets), and "temple": a search for one is found there only in other places' names ("Wat Phnom Restaurant"), so
 * those are not "enough" to leave OpenStreetMap's Nominatim out (placeQuery `elsewhere`).
 */
const ELSEWHERE = new Set(['pagoda', 'market', 'temple']);

/** Every area word, the longest first ("bkk 1" before "bkk"). */
const AREA_WORDS = PLACE_AREAS.flatMap((area) => area.words.map((word) => ({ word, area })))
  .sort((a, b) => b.word.length - a.word.length);

/** Kilometres between two points (lat / lng): flat-earth, good to a few metres across a city. */
export function kmBetween(a, b) {
  const x = (b.lng - a.lng) * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const y = b.lat - a.lat;
  return Math.sqrt(x * x + y * y) * 111.32;
}

const hasPoint = (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng);

/** Is the point in the area (its box, or its circle)? */
export function inPlaceArea(area, lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (area.box) return lat >= area.box.south && lat <= area.box.north && lng >= area.box.west && lng <= area.box.east;
  return kmBetween(area, { lat, lng }) <= area.r;
}

/** The area line of a place that has no address of its own: the smallest area around the point, or null. */
export function areaLabel(lat, lng, lang = 'en') {
  let best = null;
  for (const a of PLACE_AREAS) if (inPlaceArea(a, lat, lng) && (!best || a.size < best.size)) best = a;
  return best ? (lang === 'km' ? best.km : best.label) : null;
}

// ---------------------------------------------------------------- typos

/**
 * The Damerau–Levenshtein distance of two words (optimal string alignment: a letter wrong, missing, extra, or two side
 * by side swapped), counted only up to `max`: anything further is max + 1.
 */
export function typoDistance(a, b, max = 2) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let before = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let low = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, before[j - 2] + 1);
      cur[j] = v;
      if (v < low) low = v;
    }
    if (low > max) return max + 1;
    before = prev;
    prev = cur;
  }
  return Math.min(prev[b.length], max + 1);
}

/** The typos a search word may have: none under 4 letters, 1 from 4, 2 from 8. */
export const typosAllowed = (w) => (w.length >= 8 ? 2 : w.length >= 4 ? 1 : 0);

// ---------------------------------------------------------------- names and searches, ready to match

/** One name ready to match: its words (each with its own forms), its letters without spaces, its key (exact name). */
export function nameKey(name) {
  const norm = normPlace(name);
  if (!norm) return null;
  const tokens = norm.split(' ');
  const words = tokens.map(wordForms);
  for (const [re, one] of PHRASES) if (new RegExp(re.source).test(norm)) words.push([one]);
  return { norm, flat: tokens.join(''), key: tokens.map(canonOf).join(' '), words };
}

/**
 * A place ready to search: { names: [every name it goes by], kind?, lat, lng, areaText?: its own address words } plus
 * `data` (what the caller wants back: a row, a demo place).
 */
export function placeEntry({ names = [], kind = null, lat = null, lng = null, areaText = '' } = {}, data = null) {
  const seen = new Set();
  const variants = [];
  for (const n of names) {
    const k = n ? nameKey(n) : null;
    if (!k || seen.has(k.norm)) continue;
    seen.add(k.norm);
    variants.push(k);
  }
  const num = (v) => (v == null || v === '' ? NaN : Number(v));
  return { variants, kind, lat: num(lat), lng: num(lng), areaText: ` ${normPlace(areaText)} `, data };
}

/**
 * A search ready to match: { required: the words a name must have, optional: area words (a name that has them anyway
 * ranks higher), areas, key (the exact name), flat }.
 */
export function placeQuery(q) {
  let norm = normPlace(q);
  for (const [re, one] of PHRASES) norm = norm.replace(re, one);
  const areas = [];
  const optional = [];
  let rest = ` ${norm} `;
  for (const { word, area } of AREA_WORDS) {
    const latin = word.split(' ').every(isLatinWord);
    const at = latin ? rest.indexOf(` ${word} `) : rest.indexOf(word);
    if (at < 0) continue;
    const end = latin ? at + word.length + 2 : at + word.length; // a Latin word with the spaces around it
    rest = ` ${`${rest.slice(0, at)} ${rest.slice(end)}`.trim()} `;
    if (!areas.includes(area)) areas.push(area);
    optional.push(...word.split(' '));
  }
  // "Browns Phnom Penh", "星巴克 金边": the city and the country go (unless they and linking words are all there is).
  const city = withoutCity(rest);
  if (city.trim().split(' ').some((w) => w && !LINKING.has(w))) rest = city;
  let words = rest.trim() ? rest.trim().split(' ') : [];
  // "Brown Coffee in TK": the little linking words go (unless that is all there is).
  if (words.some((w) => !LINKING.has(w))) words = words.filter((w) => !LINKING.has(w));
  if (!words.length) {
    // Only area words ("riverside", "tk"): then they are what the name has (and the area still comes first).
    words = norm ? norm.split(' ') : [];
    optional.length = 0;
  }
  return {
    norm,
    required: words.map((w) => ({ w, forms: wordForms(w), latin: isLatinWord(w) })),
    optional,
    areas,
    key: words.map(canonOf).join(' '),
    // The whole search as typed, area words too ("TK Avenue" is a name as well as an area and a word).
    fullKey: norm ? norm.split(' ').map(canonOf).join(' ') : '',
    flat: words.join(''),
    // A pagoda, a market … (ELSEWHERE): what our own list holds is not enough, Nominatim is asked too.
    elsewhere: words.some((w) => wordForms(w).some((f) => ELSEWHERE.has(f))),
  };
}

/** How well one search word is in one name: 3 a whole word (or the whole name), 2 a word begun, 1 a typo, 0 not. */
function wordIn(q, v) {
  if (!q.latin) return v.flat === q.w ? 3 : v.flat.includes(q.w) ? 2 : 0; // Khmer / CJK: any part of the name
  let best = 0;
  for (const forms of v.words) {
    for (const n of forms) {
      for (const a of q.forms) {
        if (a === n) return 3;
        if (best < 2 && n.startsWith(a)) best = 2;
        else if (best < 1) {
          const max = typosAllowed(a);
          if (max && Math.abs(n.length - a.length) <= max && typoDistance(a, n, max) <= max) best = 1;
        }
      }
    }
  }
  return best;
}

const kindFits = (q, kind) => Boolean(kind) && q.latin && q.forms.some((f) => KIND_WORDS[f]?.includes(kind));

/** Is a search word a whole word, or the start of one, of the place's own street, area or branch ("norodom", "aeon")? */
const inAddress = (q, entry) => (q.latin ? q.forms.some((f) => entry.areaText.includes(` ${f}`)) : entry.areaText.includes(q.w));

/**
 * The tier of one place for one search (0: not a match): 4 the whole name, 3 every word whole, 2 begun (or the kind, or
 * its street / area / branch), 1 a typo. Its address words count only with a word of its name or its kind.
 */
function scoreOf(entry, query) {
  let low = 3;
  let sum = 0;
  let named = false;
  for (const q of query.required) {
    let best = 0;
    for (const v of entry.variants) {
      best = Math.max(best, wordIn(q, v));
      if (best === 3) break;
    }
    if (best < 2 && kindFits(q, entry.kind)) best = 2;
    if (best) named = true;
    if (best < 2 && inAddress(q, entry)) best = 2; // "Brown Coffee Norodom", "Starbucks Aeon", "Brown Coffee Street 315"
    if (!best) return null;
    low = Math.min(low, best);
    sum += best;
  }
  if (!named) return null; // "Norodom" alone is a street, not the name of a place on it
  for (const o of query.optional) {
    const q = { w: o, forms: wordForms(o), latin: isLatinWord(o) };
    if (entry.variants.some((v) => wordIn(q, v) === 3)) sum += 1;
  }
  const whole = entry.variants.some((v) => v.key === query.key || v.key === query.fullKey
    || (!query.required.every((r) => r.latin) && v.flat === query.flat));
  return { tier: whole ? 4 : low, sum };
}

/** Is the place in one of the areas the search named: its point, or its own address words? */
function inAreas(entry, areas) {
  const said = (w) => (w.split(' ').every(isLatinWord) ? entry.areaText.includes(` ${w} `) : entry.areaText.includes(w));
  return areas.some((a) => inPlaceArea(a, entry.lat, entry.lng) || a.words.some(said));
}

/**
 * The places (placeEntry) that match a search, best first: [{ entry, tier, inArea, km, sum }], at most `limit`.
 * `centre` ({ lat, lng }): nearer ranks higher among equals. A search with nothing to match (no words, or only one
 * letter) finds nothing.
 */
export function matchPlaces(entries, q, { centre = null, limit = 6 } = {}) {
  const query = typeof q === 'string' ? placeQuery(q) : q;
  if (!query.required.length || query.required.every((r) => Array.from(r.w).length < 2)) return [];
  const out = [];
  for (const entry of entries || []) {
    const s = scoreOf(entry, query);
    if (!s) continue;
    out.push({
      entry,
      tier: s.tier,
      sum: s.sum,
      inArea: query.areas.length > 0 && inAreas(entry, query.areas),
      km: hasPoint(centre) && hasPoint(entry) ? kmBetween(centre, entry) : 0,
    });
  }
  out.sort((a, b) => (b.inArea - a.inArea) || (b.tier - a.tier) || (a.km - b.km) || (b.sum - a.sum));
  return limit ? out.slice(0, limit) : out;
}
