// Run: npm run 30da:test (or node --test src/lib/thirtyda-hub-places.test.mjs)
// GK API Hub, Tower 12 · Places on the admin Code page (src/lib/thirtyda-hub-places.mjs): the place list's status
// (places, size, age, store, the last Overpass ask, the last error), "Refresh now" (forced, in the background, at most
// once every 5 minutes, one at a time) and the test search (our hits, sure / typo, Nominatim asked or not). A fake
// fetch and an in-memory store: these tests reach neither Overpass, Nominatim nor Mongo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  createPlaceIndex, memoryIndexStore, rowsFromOverpass, INDEX_MAX_AGE_MS, INDEX_RETRY_MS, OVERPASS_SERVERS, OVERPASS_URL, OVERPASS_ROUNDS,
  OVERPASS_TIMEOUT_MS, REFRESH_BUDGET_MS,
} from './thirtyda-places-index.mjs';
import { createPlaceSearch } from './thirtyda-places.mjs';
import { placesAdminView, refreshPlaces, placesTry, REFRESH_GAP_MS } from './thirtyda-hub-places.mjs';

const node = (id, lat, lon, tags) => ({ type: 'node', id, lat, lon, tags });
const ELEMENTS = [
  node(1, 11.5808, 104.8959, { amenity: 'cafe', name: 'Brown Coffee', 'addr:street': 'Street 315' }),
  node(2, 11.5533, 104.9248, { amenity: 'cafe', name: 'Brown Coffee', 'addr:street': 'Street 57' }),
  node(3, 11.5481, 104.9326, { amenity: 'cafe', name: 'Brown Coffee', 'addr:street': 'Sothearos Boulevard' }),
  node(4, 11.551, 104.928, { amenity: 'cafe', name: 'Starbucks' }),
  ...Array.from({ length: 6 }, (_, i) => node(100 + i, 11.55 + i * 0.002, 104.91, { amenity: 'restaurant', name: `Noodle House ${i + 1}` })),
];
const ANSWER = { elements: ELEMENTS };
const ROWS = rowsFromOverpass(ANSWER);

function overpassFetch(reply = () => ANSWER) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push(String(url));
    const out = await reply(url, init);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  fn.calls = calls;
  return fn;
}
const nominatimFetch = (list) => {
  const fn = async (url) => {
    fn.calls.push(String(url));
    return new Response(JSON.stringify(list), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  fn.calls = [];
  return fn;
};
const instant = (fn) => fn();
const clock = (t) => { const c = () => c.t; c.t = t; return c; };

test('info(): the list\'s time, size, store; nothing asked yet; a fresh list is "live"', async () => {
  const now = clock(1_800_000_000_000);
  const index = createPlaceIndex({ fetchImpl: overpassFetch(), store: memoryIndexStore({ at: now.t - 864e5, rows: ROWS }), now, minRows: 5, onError: () => {} });
  const before = index.info();
  assert.equal(before.loaded, false);
  assert.equal(before.count, 0);
  const v = await placesAdminView(index, { now: now.t });
  assert.equal(v.status, 'live');
  assert.equal(v.count, ROWS.length);
  assert.ok(v.bytes > 100 && v.bytes < 5000, `gzip'd: ${v.bytes} bytes`);
  assert.equal(v.store, 'memory');
  assert.equal(v.ageS, 86400);
  assert.equal(v.at, new Date(now.t - 864e5).toISOString());
  assert.equal(v.nextAt, new Date(now.t - 864e5 + INDEX_MAX_AGE_MS).toISOString());
  assert.equal(v.maxAgeDays, 7);
  assert.deepEqual([v.askedAt, v.okAt, v.lastError, v.retryAt, v.canRefreshAt, v.refreshing], [null, null, null, null, null, false]);
  assert.match(v.source, /OpenStreetMap/);
});

test('no list: "none"; an old list: "old"; a failed refresh keeps the old list and shows its error and the retry time', async () => {
  const now = clock(1_800_000_000_000);
  const empty = createPlaceIndex({ fetchImpl: overpassFetch(), store: memoryIndexStore(), now, minRows: 5, onError: () => {} });
  assert.equal((await placesAdminView(empty, { now: now.t })).status, 'none');

  const errors = [];
  const down = overpassFetch(() => new Response('busy', { status: 504 }));
  const old = createPlaceIndex({ fetchImpl: down, store: memoryIndexStore({ at: now.t - INDEX_MAX_AGE_MS - 1, rows: ROWS }), now, minRows: 5, pauseMs: 0, onError: (e) => errors.push(e) });
  assert.equal((await placesAdminView(old, { now: now.t })).status, 'old');
  assert.equal(await old.refresh(), false);
  const v = await placesAdminView(old, { now: now.t });
  assert.equal(v.status, 'old', 'the old list stays');
  assert.equal(v.count, ROWS.length);
  assert.deepEqual(v.lastError, {
    at: new Date(now.t).toISOString(),
    message: 'overpass: overpass-api.de: HTTP 504; overpass.private.coffee: HTTP 504; maps.mail.ru: HTTP 504; overpass-api.de: HTTP 504; overpass.private.coffee: HTTP 504; maps.mail.ru: HTTP 504',
  });
  assert.equal(down.calls.length, 6, 'three servers, two rounds');
  assert.equal(v.askedAt, new Date(now.t).toISOString());
  assert.equal(v.okAt, null);
  assert.equal(v.retryAt, new Date(now.t + INDEX_RETRY_MS).toISOString());
  assert.equal(errors.length, 1, 'still logged');
});

test('Refresh now: forced (Overpass even when the stored list is fresh), in the background, one at a time, then 5 minutes apart', async () => {
  const now = clock(1_800_000_000_000);
  let release;
  const gate = new Promise((r) => { release = r; });
  const fetchImpl = overpassFetch(async () => { await gate; return ANSWER; });
  const store = memoryIndexStore({ at: now.t - 3600e3, rows: ROWS.slice(0, 5) });
  const index = createPlaceIndex({ fetchImpl, store, now, minRows: 5, onError: () => {} });
  await index.load();
  assert.deepEqual(refreshPlaces(index, { now: now.t }), { ok: true });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(fetchImpl.calls.length, 1, 'asked although the stored list is an hour old');
  assert.equal((await placesAdminView(index, { now: now.t })).status, 'refreshing');
  assert.equal(refreshPlaces(index, { now: now.t }).reason, 'busy', 'one at a time');
  release();
  while (index.info().refreshing) await new Promise((r) => setTimeout(r, 0));
  const v = await placesAdminView(index, { now: now.t });
  assert.equal(v.status, 'live');
  assert.equal(v.count, ROWS.length, 'the new list');
  assert.equal(v.okAt, v.askedAt);
  assert.equal(store.saves, 1, 'kept');
  assert.equal(v.canRefreshAt, new Date(now.t + REFRESH_GAP_MS).toISOString());

  now.t += REFRESH_GAP_MS - 60e3;
  const soon = refreshPlaces(index, { now: now.t });
  assert.deepEqual([soon.ok, soon.reason], [false, 'too_soon']);
  assert.match(soon.error, /Try again in 1 min/);
  assert.equal(fetchImpl.calls.length, 1);
  now.t += 60e3;
  assert.equal(refreshPlaces(index, { now: now.t }).ok, true);
  while (index.info().refreshing) await new Promise((r) => setTimeout(r, 0));
  assert.equal(fetchImpl.calls.length, 2);
  // A search's own refresh is not forced: a fresh stored list is used without asking Overpass.
  assert.equal(await index.refresh(), true);
  assert.equal(fetchImpl.calls.length, 2);
});

test('the test search: ours (sure / typo), Nominatim asked or not, never a ref; a bad query is refused', async () => {
  const index = createPlaceIndex({ fetchImpl: overpassFetch(), store: memoryIndexStore({ at: Date.now(), rows: ROWS }), minRows: 5, onError: () => {} });
  const nominatim = nominatimFetch([{ lat: '11.5600', lon: '104.9100', name: 'Brown Sugar Bakery', address: { road: 'Street 63', city: 'Phnom Penh' } }]);
  const search = createPlaceSearch({ fetchImpl: nominatim, turn: instant, index });

  const three = await placesTry(search, { q: 'browns', lang: 'en' });
  assert.equal(three.q, 'browns');
  assert.equal(three.nominatim, 'not_asked');
  assert.equal(three.sure, 3);
  assert.equal(three.own, 3);
  assert.equal(three.ours, true);
  assert.deepEqual(three.places.map((p) => [p.name, p.from]), [['Brown Coffee', 'ours'], ['Brown Coffee', 'ours'], ['Brown Coffee', 'ours']]);
  assert.ok(three.places.every((p) => !('ref' in p)), 'never signed');
  assert.ok(Number.isFinite(three.ms));
  assert.equal(nominatim.calls.length, 0);

  const one = await placesTry(search, { q: 'starbucks', lang: 'km' });
  assert.equal(one.lang, 'km');
  assert.equal(one.nominatim, 'asked');
  assert.deepEqual(one.places.map((p) => p.from), ['ours', 'nominatim']);
  assert.equal(nominatim.calls.length, 1);
  const again = await placesTry(search, { q: 'starbucks', lang: 'km' });
  assert.equal(again.nominatim, 'cached');

  const typo = await placesTry(search, { q: 'Bown Coffee', lang: 'xx' });
  assert.equal(typo.lang, 'en', 'an unknown language: English');
  assert.equal(typo.sure, 0);
  assert.ok(typo.places.some((p) => p.from === 'ours_typo'));
  assert.equal(typo.places[0].from, 'nominatim', 'Nominatim before our near-misses');

  assert.match((await placesTry(search, { q: ' x ' })).error, /at least 2 letters/);
  assert.match((await placesTry(search, { q: 'a'.repeat(200) })).error, /at least 2 letters/);
});

test('the app\'s own search answers exactly as before: no `explain` unless asked', async () => {
  const index = createPlaceIndex({ fetchImpl: overpassFetch(), store: memoryIndexStore({ at: Date.now(), rows: ROWS }), minRows: 5, onError: () => {} });
  const s = createPlaceSearch({ fetchImpl: nominatimFetch([]), turn: instant, index });
  assert.deepEqual(Object.keys(await s.search({ q: 'browns' })), ['places']);
  assert.deepEqual(await s.search({ q: 'x' }), { places: [] });
  const e = await s.search({ q: 'x', explain: true });
  assert.deepEqual(e, { places: [], explain: { ours: false, own: 0, sure: 0, nominatim: 'not_asked', google: 'not_set', from: [] } });
});

// ---------------------------------------------------------------- the backup Overpass servers (owner 2026-10-16)

const MAIN = OVERPASS_URL;
const COFFEE = 'https://overpass.private.coffee/api/interpreter';
const VK = 'https://maps.mail.ru/osm/tools/overpass/api/interpreter';
/** Each server answers from its own list of replies (the last one repeats): a Response, an answer, or a thrown error. */
function serversFetch(replies) {
  const calls = [];
  const seen = {};
  const fn = async (url, init) => {
    calls.push(String(url));
    const list = replies[url] ?? [() => new Response('nope', { status: 500 })];
    const n = (seen[url] = (seen[url] ?? -1) + 1);
    const out = await list[Math.min(n, list.length - 1)](init);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: 200 });
  };
  fn.calls = calls;
  return fn;
}
const busy = () => new Response('This Overpass API server is currently at capacity.', { status: 502 });

test('the servers: the main one, then two full-planet mirrors that welcome light use; 2 rounds; 90 s a server, 3 minutes in all', () => {
  assert.deepEqual(OVERPASS_SERVERS, [MAIN, COFFEE, VK]);
  assert.equal(MAIN, 'https://overpass-api.de/api/interpreter');
  assert.deepEqual([OVERPASS_ROUNDS, OVERPASS_TIMEOUT_MS, REFRESH_BUDGET_MS], [2, 90e3, 180e3]);
  const tf = readFileSync(new URL('./thirtyda-test-fetch.mjs', import.meta.url), 'utf8');
  assert.match(tf, /"overpass-api\.de", "overpass\.private\.coffee", "maps\.mail\.ru",/, 'all three are test-fetch hosts on the dev server');
});

test('main down, the next one a bad answer → the third fills the list; the copy says which; each server\'s last answer', async () => {
  const now = clock(1_800_000_000_000);
  const fetchImpl = serversFetch({
    [MAIN]: [busy],
    [COFFEE]: [() => ({ remark: 'runtime error: Query timed out in "query" at line 3 after 91 seconds.', elements: ELEMENTS })],
    [VK]: [() => ANSWER],
  });
  const store = memoryIndexStore();
  const index = createPlaceIndex({ fetchImpl, store, now, minRows: 5, pauseMs: 0, onError: () => {} });
  assert.equal(await index.refresh({ force: true }), true);
  assert.deepEqual(fetchImpl.calls, [MAIN, COFFEE, VK], 'in order, each once');
  const v = await placesAdminView(index, { now: now.t });
  assert.deepEqual([v.status, v.count, v.from], ['live', ROWS.length, 'maps.mail.ru']);
  assert.deepEqual(v.servers.map((s) => [s.host, Boolean(s.okAt), s.error?.message ?? null]), [
    ['overpass-api.de', false, 'HTTP 502'],
    ['overpass.private.coffee', false, 'runtime error: Query timed out in "query" at line 3 after 91 seconds.'],
    ['maps.mail.ru', true, null],
  ]);
  assert.equal(v.servers[2].rows, ROWS.length);
  assert.equal(v.lastError, null, 'a refresh that worked is no error');
  assert.equal((await store.load()).from, 'maps.mail.ru', 'kept with the copy');
  // After a restart, the stored copy still says which server filled it.
  const again = createPlaceIndex({ fetchImpl: serversFetch({}), store, now, minRows: 5, onError: () => {} });
  assert.equal((await placesAdminView(again, { now: now.t })).from, 'maps.mail.ru');
});

test('too few places, not JSON, a server that hangs: each moves on to the next server', async () => {
  const now = clock(1_800_000_000_000);
  const fetchImpl = serversFetch({
    [MAIN]: [() => ({ elements: ELEMENTS.slice(0, 2) })],
    [COFFEE]: [() => new Response('<html>oops</html>', { status: 200 })],
    [VK]: [() => ANSWER],
  });
  const index = createPlaceIndex({ fetchImpl, store: memoryIndexStore(), now, minRows: 5, pauseMs: 0, onError: () => {} });
  assert.equal(await index.refresh(), true);
  const v = await placesAdminView(index, { now: now.t });
  assert.deepEqual(v.servers.map((s) => s.error?.message ?? 'ok'), ['only 2 places', 'not JSON', 'ok']);
  // A hanging main server is cut off at its own wait; the next is asked.
  const hang = serversFetch({
    [MAIN]: [(init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('x'), { name: 'TimeoutError' }))))],
    [COFFEE]: [() => ANSWER],
  });
  const slow = createPlaceIndex({ fetchImpl: hang, store: memoryIndexStore(), now, minRows: 5, pauseMs: 0, timeoutMs: 30, budgetMs: 10e3, onError: () => {} });
  const running = slow.refresh();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual((await placesAdminView(slow, { now: now.t })).servers.map((s) => s.asking), [true, false, false], 'the one being asked');
  assert.equal(await running, true);
  const w = await placesAdminView(slow, { now: now.t });
  assert.deepEqual([w.from, w.servers[0].error.message], ['overpass.private.coffee', 'no answer in 0 s']);
});

test('every server down: a second round after the pause, then the old copy stays, the error names each, and searches wait the hour', async () => {
  const now = clock(1_800_000_000_000);
  const fetchImpl = serversFetch({ [MAIN]: [busy], [COFFEE]: [busy], [VK]: [() => { throw new TypeError('fetch failed'); }] });
  const errors = [];
  const old = { at: now.t - INDEX_MAX_AGE_MS - 1, rows: ROWS };
  const store = memoryIndexStore(old);
  const index = createPlaceIndex({ fetchImpl, store, now, minRows: 5, pauseMs: 5, onError: (e) => errors.push(e) });
  await index.load();
  assert.equal(await index.refresh(), false);
  assert.deepEqual(fetchImpl.calls, [MAIN, COFFEE, VK, MAIN, COFFEE, VK], 'two rounds');
  const v = await placesAdminView(index, { now: now.t });
  assert.deepEqual([v.status, v.count, v.from], ['old', ROWS.length, null], 'the old copy stays');
  assert.equal(store.saves, 0);
  assert.match(v.lastError.message, /^overpass: overpass-api\.de: HTTP 502; overpass\.private\.coffee: HTTP 502; maps\.mail\.ru: fetch failed; /);
  assert.equal(v.retryAt, new Date(now.t + INDEX_RETRY_MS).toISOString());
  assert.equal(errors.length, 1, 'one line in the log per refresh');
  // A search within the hour answers from the old copy and asks nobody.
  now.t += INDEX_RETRY_MS - 1000;
  assert.ok((await index.search({ q: 'browns' })).places.length);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(fetchImpl.calls.length, 6);
  // No time for a second round: the refresh ends after the first.
  const quick = serversFetch({ [MAIN]: [busy], [COFFEE]: [busy], [VK]: [busy] });
  const short = createPlaceIndex({ fetchImpl: quick, store: memoryIndexStore(old), now, minRows: 5, pauseMs: 60e3, budgetMs: 30e3, onError: () => {} });
  assert.equal(await short.refresh(), false);
  assert.equal(quick.calls.length, 3, 'the pause does not fit in what is left of the 3 minutes');
});

test('Code page: Tower 12 lists each server (main, backup) with its last answer; the copy\'s server on the List line', () => {
  const js = readFileSync(new URL('../thirtyda-admin/connections.js', import.meta.url), 'utf8');
  assert.match(js, /p\.servers\?\.length \? row\('Servers', placesServers\(p\)\) : null,/);
  assert.ok(js.includes("${i ? 'backup' : 'main'}"));
  assert.ok(js.includes("${p.from ? ` · from ${p.from}` : ''}"));
  assert.ok(js.includes('The refresh failed on every server.'));
});

// ---------------------------------------------------------------- the Code page (connections.js, the admin routes)

test('Code page: tower 12 "Places" (Search) after Wan, its words, its own icon; the routes; no inline style', () => {
  const js = readFileSync(new URL('../thirtyda-admin/connections.js', import.meta.url), 'utf8');
  const towers = js.slice(js.indexOf('const TOWERS = ['), js.indexOf('const towerNumber'));
  assert.match(towers, /key: 'wan'[\s\S]*key: 'places', name: 'Places', kind: 'Search', has: \(byId, data\) => Boolean\(data\?\.places\)/);
  assert.match(js, /\n {2}places: '<path /, 'our own drawing in LOGOS');
  for (const words of ['Live', 'Out of date', 'No list yet', 'Refreshing', 'Refresh now', 'Test search', 'not asked (3 of ours were enough)',
    'Ours · typo', '© OpenStreetMap contributors (ODbL)', 'Our own Phnom Penh place list · searched before Nominatim']) {
    assert.ok(js.includes(words), words);
  }
  assert.ok(js.includes('`${API}/places/refresh`') && js.includes('`${API}/places/search`'));
  for (const lang of ["['en', 'English']", "['km', 'ខ្មែរ']", "['zh', '中文']", "['ko', '한국어']", "['ja', '日本語']"]) assert.ok(js.includes(lang), lang);
  assert.equal((js.match(/innerHTML/g) || []).length, 1, 'only the logo template');
  assert.equal(/style=|\.style\.(?!setProperty)|setAttribute\('style'/.test(js), false, 'no inline style');
  // The headline groups the "wait" pills by their words: "Waiting for the M5: Wan", "Refreshing: Places".
  assert.match(js, /for \(const text of waits\) parts\.push\(`\$\{text\}: \$\{named\(\(st\) => st\.pill === 'wait' && st\.text === text\)\.join\(' \+ '\)\}`\);/);
  const css = readFileSync(new URL('../thirtyda-admin/app.css', import.meta.url), 'utf8');
  assert.ok(css.includes('.input.cx-lang'));
  const admin = readFileSync(new URL('./thirtyda-admin.mjs', import.meta.url), 'utf8');
  assert.match(admin, /m = sub\.match\(\/\^\\\/api\\\/connections\\\/places\\\/\(refresh\|search\|google\)\$\/\);\n {2}if \(m\) return placesRoute\(req, res, m\);/);
  assert.match(admin, /places: await placesAdminView\(placeIndex\(\)\)\.then\(async \(p\) => \(\{[\s\S]{0,400}?\}\)\)\.catch\(/, 'a Places failure never takes the page down');
  assert.match(admin, /google: await placesGoogle\(\)\.status\(d\)\.catch\(/, 'nor does a Google one: the list still shows');
  assert.match(admin, /placeTries\.over\(tokenOf\(req\) \|\| clientIp\(req\), 20\)/);
  assert.match(admin, /const r = refreshPlaces\(placeIndex\(\)\);\n {4}await audit\(req, "places_refresh"/);
});

/** The refresh poll (connections.js), run on its own with a stand-in page. */
function placesPollBox() {
  const js = readFileSync(new URL('../thirtyda-admin/connections.js', import.meta.url), 'utf8');
  const from = js.indexOf('const PLACES_ASK_MS');
  const to = js.indexOf('// ---------- Tower 13 · Translate');
  assert.ok(from > 0 && to > from);
  const box = { now: 0, timers: [], calls: 0, answer: null, drawn: [], toasts: [], state: { busy: false, data: null }, document: { hidden: false } };
  const ctx = vm.createContext({
    API: '/api', state: box.state, document: box.document,
    Date: { now: () => box.now },
    setTimeout: (fn) => { box.timers.push(fn); return box.timers.length; },
    clearTimeout: () => { box.timers.length = 0; },
    call: async () => { box.calls += 1; return box.answer; },
    renderPlaces: (data) => { box.drawn.push(data); box.state.data = data; box.api.pollPlaces(data); },
    toast: (text) => box.toasts.push(text),
  });
  box.api = vm.runInContext(`${js.slice(from, to)}\n;({ placesAsk, pollPlaces, askPlaces })`, ctx);
  box.tick = async () => { const fn = box.timers.shift(); assert.ok(fn, 'a timer is set'); await fn(); };
  return box;
}

test('Code page refresh poll: asks every 4 s while refreshing, re-draws Places only, says how it ended, gives up after 4 minutes', async () => {
  const box = placesPollBox();
  const places = (refreshing, extra = {}) => ({ connections: [], places: { refreshing, count: 2143, askedAt: 'A', okAt: null, ...extra } });
  box.api.pollPlaces(places(false));
  assert.equal(box.timers.length, 0, 'nothing to wait for');
  box.state.data = places(true);
  box.api.pollPlaces(box.state.data);
  assert.equal(box.timers.length, 1);
  box.answer = { ok: true, data: places(true) };
  box.now += 4000;
  await box.tick();
  assert.deepEqual([box.calls, box.drawn.length, box.timers.length], [1, 1, 1]);
  box.answer = { ok: true, data: places(false, { okAt: 'A' }) };
  await box.tick();
  assert.deepEqual([box.calls, box.timers.length], [2, 0]);
  assert.deepEqual(box.toasts, ['Place list refreshed: 2,143 places.']);
  // A failed one says so, with the error.
  box.state.data = places(true);
  box.api.pollPlaces(box.state.data);
  box.answer = { ok: true, data: places(false, { lastError: { message: 'overpass HTTP 504' } }) };
  await box.tick();
  assert.equal(box.toasts[1], 'The refresh failed on every server. The old list stays.', 'the servers\' words are on the card');
  // Still refreshing after 4 minutes: the page stops asking.
  box.state.data = places(true);
  box.api.pollPlaces(box.state.data);
  box.now += 4 * 60e3 + 1;
  box.answer = { ok: true, data: places(true) };
  await box.tick();
  assert.equal(box.timers.length, 0);
});
