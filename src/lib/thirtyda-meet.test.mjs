// Run: npm run 30da:test (or node --test src/lib/thirtyda-meet.test.mjs)
// Meetings in the Level 3 chat (owner 2026-10-14, src/lib/thirtyda-meet.mjs), run on the app's own pieces (pairFor,
// chatGate, the chat's contact-detail and bad-word stops — meetHandlers() in src/lib/thirtyda-app.mjs) over an in-memory
// Mongo stand-in: suggest, one open suggestion, accept / decline / cancel and who may, Level 3 only, the two worlds,
// blocks, the limits, place names stopped and kept for the admin like a chat line (alone, name + address together, and
// with my chat lines both ways), the address and map pin only for a place the server suggested (its signed ref),
// reporting a meeting card, and the place search's gate.
// No database, no network: the place search is a fake, translation is off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

delete process.env.THIRTYDA_TRANSLATE_URL; // translation off: nothing leaves the test

const { meetHandlers, chatHandlers, API_ROUTES } = await import('./thirtyda-app.mjs');
const { MEET_TEXT, changedAt } = await import('./thirtyda-meet.mjs');
const { createPlaceRefs } = await import('./thirtyda-places.mjs');
const { reasonWithoutNames } = await import('./thirtyda-delete.mjs');
const { BLOCKS, addBlock } = await import('./thirtyda-blocks.mjs');
const { REVIEW } = await import('./thirtyda-review.mjs');
const { TALK_ROUTES, talksToSomeone } = await import('./thirtyda-verify.mjs');
const { MEET_PER_PAIR_HOUR, PLACE_SEARCHES_PER_MINUTE } = await import('../thirtyda-app/shared/meet.js');

// ---------------------------------------------------------------- an in-memory Mongo, just enough for these routes

const get = (doc, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc);
function cond(v, want) {
  if (want && typeof want === 'object' && !Array.isArray(want) && Object.keys(want).some((k) => k.startsWith('$'))) {
    return Object.entries(want).every(([op, w]) => {
      if (op === '$in') return w.some((x) => cond(v, x));
      if (op === '$ne') return !cond(v, w);
      if (op === '$lte') return v != null && v <= w;
      if (op === '$exists') return (v !== undefined) === w;
      throw new Error(`fake mongo: ${op}`);
    });
  }
  return Array.isArray(v) ? v.includes(want) : v === want;
}
const matches = (doc, q = {}) => Object.entries(q).every(([k, w]) => cond(get(doc, k), w));
function setPath(doc, path, value) {
  const keys = path.split('.');
  let o = doc;
  for (const k of keys.slice(0, -1)) o = (o[k] ??= {});
  const before = JSON.stringify(o[keys.at(-1)]);
  o[keys.at(-1)] = structuredClone(value);
  return before !== JSON.stringify(value);
}
function apply(doc, u, { insert = false, arrayFilters = [] } = {}) {
  let changed = false;
  // Like Mongo: the array filters pick their elements BEFORE any of the $set lands.
  const picked = new Map();
  const pick = (arr, id) => {
    const key = `${arr}|${id}`;
    if (!picked.has(key)) {
      const f = arrayFilters.find((x) => Object.keys(x).some((k) => k.startsWith(`${id}.`))) || {};
      picked.set(key, (doc[arr] || []).filter((el) => Object.entries(f).every(([k, w]) => cond(get(el, k.slice(id.length + 1)), w))));
    }
    return picked.get(key);
  };
  for (const k of Object.keys(u.$set || {})) {
    const m = /^(\w+)\.\$\[(\w+)\]\.(.+)$/.exec(k);
    if (m) pick(m[1], m[2]);
  }
  for (const [k, v] of Object.entries(u.$set || {})) {
    const m = /^(\w+)\.\$\[(\w+)\]\.(.+)$/.exec(k);
    if (!m) { changed = setPath(doc, k, v) || changed; continue; }
    for (const el of pick(m[1], m[2])) changed = setPath(el, m[3], v) || changed;
  }
  for (const [k, v] of Object.entries(u.$inc || {})) { setPath(doc, k, (Number(get(doc, k)) || 0) + v); changed = true; }
  for (const [k, v] of Object.entries(u.$push || {})) {
    const list = get(doc, k) ?? [];
    list.push(...structuredClone(v.$each ?? [v]));
    setPath(doc, k, list);
    changed = true;
  }
  for (const [k, v] of Object.entries(u.$max || {})) if (!(get(doc, k) >= v)) { setPath(doc, k, v); changed = true; }
  if (insert) for (const [k, v] of Object.entries(u.$setOnInsert || {})) setPath(doc, k, v);
  return changed;
}
function fakeCollection() {
  const docs = [];
  const seed = (q) => Object.fromEntries(Object.entries(q).filter(([, v]) => typeof v !== 'object'));
  return {
    docs,
    async findOne(q, opts = {}) {
      const d = docs.find((x) => matches(x, q));
      if (!d) return null;
      const out = structuredClone(d);
      // { projection: { messages: { $elemMatch } } }: only the first matching message, like Mongo (the chat's report).
      const em = opts.projection?.messages?.$elemMatch;
      if (em && Array.isArray(out.messages)) out.messages = out.messages.filter((m) => matches(m, em)).slice(0, 1);
      return out;
    },
    find(q) {
      const list = () => docs.filter((x) => matches(x, q)).map((x) => structuredClone(x));
      return { toArray: async () => list(), sort() { return this; }, limit() { return this; } };
    },
    async countDocuments(q) { return docs.filter((x) => matches(x, q)).length; },
    async insertOne(doc) { docs.push(structuredClone(doc)); return { insertedId: doc._id }; },
    async findOneAndUpdate(q, u, opts = {}) {
      let d = docs.find((x) => matches(x, q));
      if (!d && opts.upsert) { d = seed(q); docs.push(d); apply(d, u, { insert: true }); return structuredClone(d); }
      if (!d) return null;
      apply(d, u);
      return structuredClone(d);
    },
    async updateOne(q, u, opts = {}) {
      const d = docs.find((x) => matches(x, q));
      if (!d) {
        if (!opts.upsert) return { matchedCount: 0, modifiedCount: 0 };
        const fresh = seed(q);
        docs.push(fresh);
        apply(fresh, u, { insert: true, arrayFilters: opts.arrayFilters });
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      }
      return { matchedCount: 1, modifiedCount: apply(d, u, { arrayFilters: opts.arrayFilters }) ? 1 : 0 };
    },
    async updateMany(q, u) { for (const d of docs.filter((x) => matches(x, q))) apply(d, u); return {}; },
  };
}
function fakeDb() {
  const cols = new Map();
  return { collection: (name) => { if (!cols.has(name)) cols.set(name, fakeCollection()); return cols.get(name); } };
}

// ---------------------------------------------------------------- a small world

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const user = (id, extra = {}) => ({
  _id: id, id, name: `Name${id.slice(2)}`, lang: 'en', level: 3, verified: { phone: true }, phone: `+85510000${id.slice(2)}`,
  location: { type: 'Point', coordinates: [104.9012, 11.5731] }, ...extra,
});
const pair = (id, a, b, stage = 'l3_open') => ({
  _id: id, id, a, b, members: [a, b], stage, level: stage === 'l3_open' ? 3 : 2, decisions: {}, createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z', startedAt: '2026-10-01T00:00:00.000Z', lastChat: null,
});

async function world() {
  const d = fakeDb();
  const users = d.collection('thirtyda_users');
  for (const u of [
    user('U-1'), user('U-2'), user('U-3'), user('U-4'), user('U-5', { demo: REVIEW }), user('U-6', { demo: REVIEW }),
    user('U-7', { verified: {} }), user('U-8', { level: 2 }),
  ]) await users.insertOne(u);
  const pairs = d.collection('thirtyda_pairs');
  for (const p of [
    pair('P-1', 'U-1', 'U-2'), pair('P-2', 'U-1', 'U-3', 'l2_open'), pair('P-3', 'U-1', 'U-5'), pair('P-4', 'U-1', 'U-4'),
    pair('P-5', 'U-5', 'U-6'), pair('P-6', 'U-7', 'U-2'),
  ]) await pairs.insertOne(p);
  await addBlock(d.collection(BLOCKS), 'U-4', 'U-1');
  return d;
}

// Now (to the minute): the chat's own stops stamp their tries with the real clock, the meetings with the test's clock.
const T0 = Math.floor(Date.now() / 60e3) * 60e3;
const BROWN = { name: 'Brown Coffee TK', address: 'Russian Federation Blvd, Toul Kork', lat: 11.5728, lng: 104.8999 };
const at = (ms) => new Date(ms).toISOString();

/**
 * The meeting routes on a fresh world, a clock we move, a fake place search that remembers what it was asked, and the
 * place refs with a fixed key on that clock. propose() sends BROWN as the search suggested it to that person (its ref).
 */
async function setup(over = {}) {
  const d = await world();
  const clock = { now: T0 };
  const asked = [];
  const placeSearch = { search: async (q) => { asked.push(q); return { places: [BROWN] }; } };
  const refs = createPlaceRefs({ key: Buffer.alloc(32, 7), now: () => clock.now });
  const h = meetHandlers({ now: () => clock.now, nowIso: () => new Date(clock.now).toISOString(), placeSearch, placeRefs: refs, ...over });
  const me = async (id) => d.collection('thirtyda_users').findOne({ _id: id });
  const run = (handlers) => async (fn, id, { params = [], body = {}, url = 'https://ecom.ggmt.sg/30da/api/x' } = {}) => {
    const ctx = { d, me: await me(id), params, body, url: new URL(url), status: 200 };
    const out = await handlers[fn](ctx);
    return { ...out, status: ctx.status };
  };
  const call = run(h);
  const callChat = run(chatHandlers); // the chat's own send and report
  const err = async (p) => {
    try { await p; } catch (e) { return e; }
    assert.fail('expected a refusal');
  };
  const chat = async (pid = 'P-1') => (await d.collection('thirtyda_chats').findOne({ _id: pid }))?.messages || [];
  const signed = (place, id = 'U-1') => ({ ...place, ref: refs.sign(place, id) });
  const propose = (id, pid = 'P-1', body = {}) => call('propose', id, { params: [pid], body: { place: signed(BROWN, id), at: at(T0 + DAY), ...body } });
  const act = (id, mid, action, pid = 'P-1') => call('act', id, { params: [pid, mid], body: { action } });
  const say = (id, text, pid = 'P-1') => callChat('postMessage', id, { params: [pid], body: { text } });
  return { d, clock, asked, refs, call, callChat, err, chat, signed, propose, act, say };
}

// ---------------------------------------------------------------- suggest

test('suggest: a meet message in the chat stream (proposed), news for the other person like a chat line', async () => {
  const { d, propose, chat } = await setup();
  const r = await propose('U-1');
  assert.equal(r.status, 201);
  assert.equal(r.message.kind, 'meet');
  assert.equal(r.message.mine, true);
  assert.deepEqual(r.message.meet.place, BROWN);
  assert.equal(r.message.meet.at, at(T0 + DAY));
  assert.equal(r.message.meet.status, 'proposed');
  assert.equal(r.message.meet.mapsUrl, 'https://www.google.com/maps/search/?api=1&query=11.5728%2C104.8999');
  assert.deepEqual(r.replaced, []);
  const [m] = await chat();
  assert.equal(m.kind, 'meet');
  assert.equal(m.from, 'U-1');
  assert.equal(m.level, 3);
  assert.equal(m.stopped, false);
  assert.equal(m.text, 'Brown Coffee TK · Russian Federation Blvd, Toul Kork', 'the admin reads it as one line');
  assert.equal(m.meet.by, 'U-1');
  const p = await d.collection('thirtyda_pairs').findOne({ _id: 'P-1' });
  assert.equal(p.lastChat.from, 'U-1', 'the other person\'s red dot, as for a chat line');
  assert.equal(p.updatedAt, m.at);
});

test('suggest: what is refused before anything is kept (the place, the time)', async () => {
  const { err, propose, chat } = await setup();
  const cases = [
    [{ place: { name: 'B' } }, 'invalid'], [{ place: null }, 'invalid'], [{ place: { ...BROWN, lat: 'x' } }, 'invalid'],
    [{ at: at(T0 - 60e3) }, 'past'], [{ at: at(T0 + 61 * DAY) }, 'too_far'], [{ at: '2026-10-20T18:30' }, 'bad_time'], [{ at: null }, 'bad_time'],
  ];
  for (const [body, code] of cases) {
    const e = await err(propose('U-1', 'P-1', body));
    assert.equal(e.status, 422, JSON.stringify(body));
    assert.equal(e.code, code, JSON.stringify(body));
  }
  assert.equal((await err(propose('U-1', 'P-1', { place: { name: 'B' } }))).extra.field, 'place');
  assert.equal((await err(propose('U-1', 'P-1', { at: at(T0 - 1) }))).extra.field, 'at');
  assert.equal((await chat()).length, 0);
});

test('suggest: a contact detail or a bad word in the place is stopped and kept for the admin, like a chat line', async () => {
  const { d, err, propose, chat } = await setup();
  const e1 = await err(propose('U-1', 'P-1', { place: { name: 'Call me 012 345 678' } }));
  assert.equal(e1.status, 422);
  assert.equal(e1.code, 'contact_detail');
  assert.equal(e1.extra.index, 0, 'the name');
  const e2 = await err(propose('U-1', 'P-1', { place: { name: 'Brown Coffee', address: 'telegram @sophea_pp' } }));
  assert.equal(e2.code, 'contact_detail');
  assert.equal(e2.extra.index, 1, 'the address');
  const e3 = await err(propose('U-1', 'P-1', { place: { name: 'Brown Coffee', address: 'fuck street' } }));
  assert.equal(e3.code, 'bad_word');
  assert.equal(e3.extra.index, 1);
  const log = await chat();
  assert.equal(log.length, 3);
  assert.ok(log.every((m) => m.stopped === true && m.kind === 'meet' && m.level === 3 && m.flagId), 'kept as stopped meet tries');
  assert.equal(log.filter((m) => m.meet).length, 0, 'never a meeting');
  const flags = await d.collection('thirtyda_flags').find({}).toArray();
  assert.equal(flags.length, 3);
  assert.ok(flags.every((f) => f.kind === 'stopped' && f.status === 'open' && f.from === 'U-1' && f.to === 'U-2' && f.chatId === 'P-1'));
  const p = await d.collection('thirtyda_pairs').findOne({ _id: 'P-1' });
  assert.equal(p.lastChat, null, 'nothing reached the other person');
});

test('one open suggestion per pair: a new one (theirs or mine) replaces the open one with a note', async () => {
  const { clock, propose, chat } = await setup();
  const a = await propose('U-1');
  clock.now += 60e3;
  const b = await propose('U-2', 'P-1', { at: at(T0 + 2 * DAY) }); // "Suggest another time"
  assert.equal(b.replaced.length, 1);
  assert.equal(b.replaced[0].id, a.message.id);
  assert.equal(b.replaced[0].meet.status, 'cancelled');
  assert.equal(b.replaced[0].meet.note, 'replaced');
  const log = await chat();
  assert.deepEqual(log.map((m) => [m.id, m.meet.status, m.meet.note]), [[a.message.id, 'cancelled', 'replaced'], [b.message.id, 'proposed', null]]);
  assert.equal(log[0].meet.doneBy, 'U-2');
  assert.equal(log[1].meet.replaces, a.message.id);
  assert.ok(changedAt(log[0]) > Date.parse(log[0].at), 'the replaced one comes again in the next poll');
  clock.now += 60e3;
  const c = await propose('U-2', 'P-1', { at: at(T0 + 3 * DAY) });
  assert.equal(c.replaced[0].id, b.message.id, 'my own open one too');
  assert.equal((await chat()).filter((m) => m.meet.status === 'proposed').length, 1);
});

// ---------------------------------------------------------------- split contact details (review 2026-10-14)

test('a phone number split over the name and the address is stopped and kept for the admin, like the chat', async () => {
  const { d, err, propose, chat } = await setup();
  const e = await err(propose('U-1', 'P-1', { place: { name: 'Cafe 012 887', address: '766 Street' } }));
  assert.deepEqual([e.status, e.code], [422, 'contact_detail']);
  assert.equal(e.extra.index, 0, 'points at the name, where it starts');
  const [m] = await chat();
  assert.deepEqual([m.kind, m.stopped, m.level, m.text], ['meet', true, 3, 'Cafe 012 887\n766 Street'], 'the whole try, for the admin');
  assert.equal(m.meet, undefined, 'never a meeting');
  const flags = await d.collection('thirtyda_flags').find({}).toArray();
  assert.deepEqual(flags.map((f) => [f.kind, f.from, f.to, f.chatId]), [['stopped', 'U-1', 'U-2', 'P-1']]);
  assert.equal((await d.collection('thirtyda_pairs').findOne({ _id: 'P-1' })).lastChat, null, 'nothing reached the other person');
});

test('a phone number split between my chat line and a meeting is stopped, in both orders', async () => {
  // (B) A delivered chat line, then "Use what I typed".
  let w = await setup();
  assert.equal((await w.say('U-1', 'Lets meet soon ok 012 887')).status, 201, 'the line alone passes');
  let e = await w.err(w.propose('U-1', 'P-1', { place: { name: '766 Coffee' } }));
  assert.deepEqual([e.status, e.code], [422, 'contact_detail']);
  let last = (await w.chat()).at(-1);
  assert.deepEqual([last.kind, last.stopped, last.text], ['meet', true, '766 Coffee']);
  assert.equal((await w.propose('U-2', 'P-1', { place: { name: '766 Coffee' } })).status, 201, 'only my own lines count');

  // A meeting, then a chat line.
  w = await setup();
  assert.equal((await w.propose('U-1', 'P-1', { place: { name: 'Cafe 012 887' } })).status, 201, 'the place alone passes');
  e = await w.err(w.say('U-1', '766 is my lucky one ok'));
  assert.deepEqual([e.status, e.code], [422, 'contact_detail']);
  last = (await w.chat()).at(-1);
  assert.deepEqual([last.kind, last.stopped, last.text], ['chat', true, '766 is my lucky one ok']);
  assert.equal((await w.say('U-2', '766 is my lucky one ok')).status, 201, 'the other person\'s line is read with their own');

  // A meeting, then another meeting.
  w = await setup();
  await w.propose('U-1', 'P-1', { place: { name: 'Cafe 012 887' } });
  w.clock.now += 60e3;
  e = await w.err(w.propose('U-1', 'P-1', { place: { name: '766 Garden' } }));
  assert.equal(e.code, 'contact_detail');

  // Ordinary places and lines with numbers pass.
  w = await setup();
  await w.say('U-1', 'See you at 7 at the cafe ok');
  assert.equal((await w.propose('U-1', 'P-1', { place: { name: 'Street 214 Coffee' } })).status, 201);
  assert.equal((await w.say('U-1', 'I will be there by 6 30 pm')).status, 201);
});

test('a meeting\'s place is read with my Level 1 / 2 replies too, like a chat line (chatOrders)', async () => {
  const { d, err, propose, chat } = await setup();
  const t = at(T0 - DAY);
  await d.collection('thirtyda_sets').insertOne({
    _id: 'S-1', id: 'S-1', pairId: 'P-1', level: 1, from: 'U-2', to: 'U-1', sentAt: t,
    questions: [{ n: 1, source: 'bank', text: 'Coffee or tea?' }, { n: 2, source: 'bank', text: 'Cats or dogs?' }],
    answers: [{ n: 1, key: null, text: '012', at: t }, { n: 2, key: null, text: '887', at: t }],
  });
  const e = await err(propose('U-1', 'P-1', { place: { name: '766 Coffee' } }));
  assert.deepEqual([e.status, e.code], [422, 'contact_detail']);
  const last = (await chat()).at(-1);
  assert.deepEqual([last.kind, last.stopped], ['meet', true]);
  assert.match(last.text, /012[\s\S]*887[\s\S]*766 Coffee/, 'the whole attempt, piece by piece');
});

// ---------------------------------------------------------------- the place is the server's suggestion (review 2026-10-14)

test('the address and the map pin only for a place the server suggested to me (its ref); else the name alone', async () => {
  const far = { name: 'Brown Coffee TK', address: 'Russian Federation Blvd, Toul Kork', lat: 11.4801, lng: 104.7712 };
  const nameOnly = { name: 'Brown Coffee TK', address: null, lat: null, lng: null };

  let w = await setup();
  const [s] = (await w.call('places', 'U-1', { url: 'https://ecom.ggmt.sg/30da/api/places?q=Brown' })).places;
  const r = await w.propose('U-1', 'P-1', { place: s });
  assert.deepEqual(r.message.meet.place, BROWN, 'as the search suggested it');
  assert.equal(r.message.meet.mapsUrl, 'https://www.google.com/maps/search/?api=1&query=11.5728%2C104.8999');

  // Another point under the same name: no ref, a ref for another point, someone else's ref, an old ref. (Each on a
  // fresh world: the refs' key and clock are the same, so only what the ref says decides.)
  const cases = [
    ['no ref', 'U-1', far],
    ['a ref for another point', 'U-1', { ...far, ref: w.refs.sign(BROWN, 'U-1') }],
    ['the other person\'s ref', 'U-2', w.signed(BROWN, 'U-1')],
  ];
  for (const [what, id, place] of cases) {
    w = await setup();
    const out = await w.propose(id, 'P-1', { place });
    assert.deepEqual(out.message.meet.place, nameOnly, what);
    assert.equal(out.message.meet.mapsUrl, 'https://www.google.com/maps/search/?api=1&query=Brown%20Coffee%20TK', `${what}: Maps searches the name`);
    assert.equal((await w.chat())[0].text, 'Brown Coffee TK', `${what}: the line the admin reads`);
  }
  w = await setup();
  const old = w.signed(BROWN, 'U-1');
  w.clock.now += 61 * 60e3;
  assert.deepEqual((await w.propose('U-1', 'P-1', { place: old, at: at(w.clock.now + DAY) })).message.meet.place, nameOnly, 'an hour old');

  // Free text in the address: never shown.
  w = await setup();
  const long = 'I really want to see you alone tonight, come by yourself and do not tell your friends, I will wait at the back gate';
  const typed = await w.propose('U-1', 'P-1', { place: { name: 'My place', address: long } });
  assert.deepEqual(typed.message.meet.place, { name: 'My place', address: null, lat: null, lng: null });
  assert.equal((await w.chat())[0].text, 'My place');
});

test('a place already in this conversation goes back as it is ("Suggest another time"); a point outside Cambodia is dropped', async () => {
  const w = await setup();
  const first = await w.propose('U-1');
  w.clock.now += 60e3;
  const again = await w.propose('U-2', 'P-1', { place: { ...first.message.meet.place }, at: at(T0 + 2 * DAY) });
  assert.deepEqual(again.message.meet.place, BROWN, 'the other person sends my place back without a ref of their own');

  const sg = { name: 'Raffles Cafe', address: 'Beach Road, Singapore', lat: 1.2948, lng: 103.8545 };
  w.clock.now += 60e3;
  const out = await w.propose('U-1', 'P-1', { place: w.signed(sg, 'U-1'), at: at(T0 + 3 * DAY) });
  assert.deepEqual(out.message.meet.place, { ...sg, lat: null, lng: null }, 'outside Cambodia: no map point');
});

// ---------------------------------------------------------------- report a meeting card (review 2026-10-14)

test('the other person can report a meeting card like a chat line; the flag quotes the place', async () => {
  const { d, err, propose, callChat, chat } = await setup();
  const { message } = await propose('U-1');
  const report = (id, reason = 'rude') => callChat('report', id, { params: ['P-1', message.id], body: { reason } });
  let e = await err(report('U-1'));
  assert.deepEqual([e.status, e.code], [404, 'not_found'], 'not my own card');
  assert.equal((await report('U-2')).ok, true);
  const flags = await d.collection('thirtyda_flags').find({}).toArray();
  assert.equal(flags.length, 1);
  const [f] = flags;
  assert.deepEqual([f.kind, f.from, f.to, f.chatId, f.status], ['reported', 'U-1', 'U-2', 'P-1', 'open']);
  assert.equal(f.text, 'Meeting: Brown Coffee TK · Russian Federation Blvd, Toul Kork');
  assert.equal(f.reason, 'Reported by Name2 · rude message');
  assert.equal(reasonWithoutNames(f), 'Reported · rude message', 'account deletion still cuts the reason to its label');
  assert.equal((await chat())[0].flagId, f.id, 'the admin finds the card by its flag');
  assert.equal((await report('U-2')).already, true, 'once');
  // A stopped try is never a card to report.
  await err(propose('U-1', 'P-1', { place: { name: 'Call me 012 345 678' } }));
  const stopped = (await chat()).at(-1);
  e = await err(callChat('report', 'U-2', { params: ['P-1', stopped.id], body: { reason: 'rude' } }));
  assert.equal(e.code, 'not_found');
});

// ---------------------------------------------------------------- answer

test('accept / decline: only the other person; cancel: only the proposer; never twice, never after its time', async () => {
  const { d, clock, err, propose, act, chat } = await setup();
  const { message } = await propose('U-1');
  const id = message.id;
  let e = await err(act('U-1', id, 'accept'));
  assert.deepEqual([e.status, e.code], [403, 'not_yours']);
  assert.equal(e.extra.message.id, id, 'with the meeting as it is now');
  e = await err(act('U-2', id, 'cancel'));
  assert.deepEqual([e.status, e.code], [403, 'not_yours']);
  e = await err(act('U-2', id, 'maybe'));
  assert.deepEqual([e.status, e.code], [422, 'invalid']);

  clock.now += 60e3;
  const ok = await act('U-2', id, 'accept');
  assert.equal(ok.message.meet.status, 'accepted');
  assert.equal(ok.message.mine, false);
  assert.equal((await chat())[0].meet.doneBy, 'U-2');
  assert.equal((await d.collection('thirtyda_pairs').findOne({ _id: 'P-1' })).lastChat.from, 'U-2', 'news for the proposer');
  assert.equal((await act('U-2', id, 'accept')).message.meet.status, 'accepted', 'a double tap is fine');
  e = await err(act('U-2', id, 'decline'));
  assert.deepEqual([e.status, e.code], [409, 'not_open']);
  assert.equal(e.extra.message.meet.status, 'accepted');

  const cancelled = await act('U-1', id, 'cancel');
  assert.equal(cancelled.message.meet.status, 'cancelled', 'the proposer may cancel an accepted meeting');
  e = await err(act('U-2', id, 'accept'));
  assert.equal(e.code, 'not_open');

  const next = await propose('U-1', 'P-1', { at: at(clock.now + HOUR) });
  clock.now += 2 * HOUR;
  e = await err(act('U-2', next.message.id, 'accept'));
  assert.deepEqual([e.status, e.code], [409, 'past']);
  assert.equal(e.message, MEET_TEXT.passed);

  e = await err(act('U-2', 'M-999', 'accept'));
  assert.deepEqual([e.status, e.code], [404, 'not_found']);
});

test('decline: the proposer sees it declined; a declined one cannot be accepted or cancelled', async () => {
  const { err, propose, act } = await setup();
  const { message } = await propose('U-2');
  assert.equal((await act('U-1', message.id, 'decline')).message.meet.status, 'declined');
  assert.equal((await err(act('U-1', message.id, 'accept'))).code, 'not_open');
  assert.equal((await err(act('U-2', message.id, 'cancel'))).code, 'not_open');
});

test('a stopped try is not a meeting: it cannot be answered', async () => {
  const { err, propose, act, chat } = await setup();
  await err(propose('U-1', 'P-1', { place: { name: 'Call me 012 345 678' } }));
  const [stopped] = await chat();
  assert.equal((await err(act('U-2', stopped.id, 'accept'))).code, 'not_found');
});

// ---------------------------------------------------------------- like the chat: Level 3, worlds, blocks, verified

test('Level 3 only, my conversations only, same world only, never with a blocked person, verified only', async () => {
  const { err, propose, chat } = await setup();
  let e = await err(propose('U-1', 'P-2'));
  assert.deepEqual([e.status, e.code], [409, 'chat_closed'], 'Level 2: the chat is not open');
  e = await err(propose('U-1', 'P-3'));
  assert.deepEqual([e.status, e.code], [404, 'not_found'], 'a review account and a real person never meet');
  assert.equal((await propose('U-5', 'P-5')).status, 201, 'two review accounts do');
  e = await err(propose('U-1', 'P-4'));
  assert.deepEqual([e.status, e.code], [409, 'other_blocked'], 'blocked either way: closed');
  e = await err(propose('U-3', 'P-1'));
  assert.deepEqual([e.status, e.code], [404, 'not_found'], 'not my conversation');
  e = await err(propose('U-7', 'P-6'));
  assert.deepEqual([e.status, e.code], [403, 'phone_needed'], 'nothing verified');
  assert.equal((await chat('P-2')).length + (await chat('P-3')).length + (await chat('P-4')).length + (await chat('P-6')).length, 0);
});

test('limits: 6 suggestions an hour per conversation (stopped tries count), 20 a day in all', async () => {
  const { clock, err, propose } = await setup();
  for (let i = 0; i < MEET_PER_PAIR_HOUR - 1; i++) {
    await propose('U-1');
    clock.now += 60e3;
  }
  await err(propose('U-1', 'P-1', { place: { name: 'Call me 012 345 678' } })); // the 6th: stopped, still counted
  let e = await err(propose('U-1'));
  assert.deepEqual([e.status, e.code], [429, 'rate_limited']);
  assert.equal((await propose('U-2')).status, 201, 'the other person has their own count');
  clock.now += HOUR;
  assert.equal((await propose('U-1')).status, 201, 'an hour later');

  const capped = await setup({ limits: { daily: { over: () => true } } });
  e = await capped.err(capped.propose('U-1'));
  assert.deepEqual([e.status, e.code], [429, 'rate_limited']);
});

// ---------------------------------------------------------------- the place search

test('place search: Level 3 people only; the person\'s language and stored point (or ?near=); nothing for under 2 characters', async () => {
  const { call, err, asked, refs } = await setup();
  const url = (q) => `https://ecom.ggmt.sg/30da/api/places?${q}`;
  const r = await call('places', 'U-1', { url: url('q=Brown%20Coffee') });
  assert.deepEqual(r.places.map(({ ref, ...p }) => p), [BROWN]);
  assert.equal(refs.ok(BROWN, r.places[0].ref, 'U-1'), true, 'each suggestion signed for the one who searched');
  assert.equal(refs.ok(BROWN, r.places[0].ref, 'U-2'), false);
  assert.deepEqual(asked[0], { q: 'Brown Coffee', lang: 'en', near: { lat: 11.5731, lng: 104.9012 } });
  await call('places', 'U-1', { url: url('q=Wat%20Phnom&near=13.36,103.86') });
  assert.deepEqual(asked[1].near, { lat: 13.36, lng: 103.86 });
  assert.deepEqual((await call('places', 'U-1', { url: url('q=b') })).places, []);
  assert.equal(asked.length, 2, 'too short: not searched');
  const e = await err(call('places', 'U-8', { url: url('q=Brown') }));
  assert.deepEqual([e.status, e.code], [403, 'chat_closed'], 'Level 2: no meetings yet');
});

test('place search: 10 a minute per person (the app searches only on Enter or Search)', async () => {
  const { call, err } = await setup();
  const url = 'https://ecom.ggmt.sg/30da/api/places?q=Brown';
  assert.equal(PLACE_SEARCHES_PER_MINUTE, 10);
  for (let i = 0; i < PLACE_SEARCHES_PER_MINUTE; i++) await call('places', 'U-1', { url });
  const e = await err(call('places', 'U-1', { url }));
  assert.deepEqual([e.status, e.code], [429, 'rate_limited']);
  assert.equal((await call('places', 'U-2', { url })).places[0].name, BROWN.name, 'someone else still searches');
});

// ---------------------------------------------------------------- the wiring in the app

test('the router: the three routes; suggesting and answering talk to someone (verify gate), the search does not', () => {
  for (const [method, path] of [['GET', '/places'], ['POST', '/pairs/P-1/meet'], ['POST', '/pairs/P-1/meet/M-12']]) {
    assert.ok(API_ROUTES.some((r) => r.method === method && r.re.test(path)), `${method} ${path}`);
  }
  assert.equal(API_ROUTES.some((r) => r.method === 'GET' && r.re.test('/pairs/P-1/meet')), false);
  assert.equal(talksToSomeone('POST', '/pairs/P-1/meet'), true);
  assert.equal(talksToSomeone('POST', '/pairs/P-1/meet/M-3'), true);
  assert.equal(talksToSomeone('GET', '/places'), false);
  assert.equal(talksToSomeone('POST', '/pairs/P-1/meet/M-3/x'), false);
  assert.equal(TALK_ROUTES.length, 10); // + the starter's "Start Level 2 now" and "Go to Level 3 now" (owner 2026-10-15)
});

test('the chat read: meetings come with the chat lines (never a stopped try), and again whenever they change', () => {
  const src = readFileSync(new URL('./thirtyda-app.mjs', import.meta.url), 'utf8');
  const i = src.indexOf('async function listMessages(');
  const body = src.slice(i, src.indexOf('\n}\n', i));
  assert.match(body, /\(m\.kind === "chat" \|\| m\.kind === "meet"\) && !m\.stopped && \(Number\.isNaN\(after\) \|\| changedAt\(m\) > after\)/);
  assert.match(body, /m\.kind === "meet" \? meetView\(m, me\._id\)/);
  assert.match(body, /backfillMessages\(d, pair\._id, msgs\.filter\(\(m\) => m\.kind === "chat"\), lang\)/, 'place names are not translated');
  assert.match(src, /const MEET_DEPS = \{\n {2}C, fail, nowIso, nextId, appendMessages, pairFor, chatGate,\n {2}stopContactDetails, stopSplitContactDetails, stopSplitChat, stopBadWords,\n\};/,
    'the same pairFor (sameWorld, blocks) and the same stops as the chat, the split ones too');
  const split = src.slice(src.indexOf('async function stopSplitChat('), src.indexOf('async function postMessage('));
  assert.match(split, /\(m\.kind === "chat" \|\| m\.kind === "meet"\) && m\.from === me\._id && !m\.stopped/, 'my meetings are lines too');
  const m = { at: '2026-10-14T05:00:00.000Z', meet: { updatedAt: '2026-10-14T06:00:00.000Z' } };
  assert.equal(changedAt(m), Date.parse('2026-10-14T06:00:00.000Z'));
  assert.equal(changedAt({ at: '2026-10-14T05:00:00.000Z' }), Date.parse('2026-10-14T05:00:00.000Z'));
});

test('the privacy page says where place searches go and who sees a meeting (5 languages)', async () => {
  const { PAGE_STRINGS, PRIVACY_DATA } = await import('./thirtyda-pages.mjs');
  assert.ok(PRIVACY_DATA.includes('priv_meet'));
  for (const lang of Object.keys(PAGE_STRINGS)) {
    assert.match(PAGE_STRINGS[lang].priv_meet, /OpenStreetMap/, lang);
    assert.ok(PAGE_STRINGS[lang].priv_meet_k, lang);
  }
  assert.match(PAGE_STRINGS.en.priv_meet, /seen by the other person and kept with the chat/);
});
