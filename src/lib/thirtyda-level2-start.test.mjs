// Run: npm run 30da:test (or node --test src/lib/thirtyda-level2-start.test.mjs)
// "Start Level 2 now" (owner 2026-10-15, testing as Sopal on "Level 2 opens in 00:01:22 · Remind me": "level 2 can
// start the person who started the conversation 1st time .. any time if he or she want ... or can wait for timmer so
// need "start" button then go on to level 2"). POST /pairs/:id/level2/start, run on the app's own handlers
// (levelHandlers in src/lib/thirtyda-app.mjs) over an in-memory Mongo stand-in whose every call waits a turn, so two
// requests sent together really run side by side: only the starter (pair.a), only while Level 2 waits; it opens
// exactly as the timer does (users.level, chats.level, the pair's level and updatedAt), once for two taps, never on a
// frozen pair; the conversation tells each side whether it may start it; the other person learns it like a timed
// opening; the route's place in the PIN / verify / terms gates; the screen's button and its strings in 5 languages.
// No database, no network: translation is off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

delete process.env.THIRTYDA_TRANSLATE_URL; // translation off: nothing leaves the test

const { levelHandlers, API_ROUTES } = await import('./thirtyda-app.mjs');
const { BLOCKS, addBlock } = await import('./thirtyda-blocks.mjs');
const { REVIEW } = await import('./thirtyda-review.mjs');
const { TALK_ROUTES, OPEN_WRITES, talksToSomeone } = await import('./thirtyda-verify.mjs');
const { whileLocked } = await import('./thirtyda-pin.mjs');
const { termsFree } = await import('./thirtyda-terms.mjs');

// ---------------------------------------------------------------- an in-memory Mongo, just enough for these routes

const tick = () => new Promise((r) => setImmediate(r));
const get = (doc, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc);
function cond(v, want) {
  if (want && typeof want === 'object' && !Array.isArray(want) && Object.keys(want).some((k) => k.startsWith('$'))) {
    return Object.entries(want).every(([op, w]) => {
      if (op === '$in') return w.some((x) => cond(v, x));
      if (op === '$ne') return !cond(v, w);
      if (op === '$lte') return v != null && v <= w;
      if (op === '$gt') return v != null && v > w;
      if (op === '$exists') return (v !== undefined) === w;
      throw new Error(`fake mongo: ${op}`);
    });
  }
  return Array.isArray(v) ? v.includes(want) : v === want;
}
const matches = (doc, q = {}) => Object.entries(q).every(([k, w]) => (k === '$or'
  ? w.some((alt) => matches(doc, alt))
  : cond(get(doc, k), w)));
function setPath(doc, path, value) {
  const keys = path.split('.');
  let o = doc;
  for (const k of keys.slice(0, -1)) o = (o[k] ??= {});
  const before = JSON.stringify(o[keys.at(-1)]);
  o[keys.at(-1)] = structuredClone(value);
  return before !== JSON.stringify(value);
}
function apply(doc, u, { insert = false } = {}) {
  let changed = false;
  for (const [k, v] of Object.entries(u.$set || {})) changed = setPath(doc, k, v) || changed;
  for (const [k, v] of Object.entries(u.$inc || {})) { setPath(doc, k, (Number(get(doc, k)) || 0) + v); changed = true; }
  for (const [k, v] of Object.entries(u.$push || {})) {
    const list = get(doc, k) ?? [];
    list.push(...structuredClone(v.$each ?? [v]));
    setPath(doc, k, list);
    changed = true;
  }
  for (const [k, v] of Object.entries(u.$max || {})) if (!(get(doc, k) >= v)) { setPath(doc, k, v); changed = true; }
  for (const k of Object.keys(u.$unset || {})) {
    const keys = k.split('.');
    const o = keys.slice(0, -1).reduce((v, x) => (v == null ? undefined : v[x]), doc);
    if (o && keys.at(-1) in o) { delete o[keys.at(-1)]; changed = true; }
  }
  if (insert) for (const [k, v] of Object.entries(u.$setOnInsert || {})) setPath(doc, k, v);
  return changed;
}
function fakeCollection() {
  const docs = [];
  const seed = (q) => Object.fromEntries(Object.entries(q).filter(([, v]) => typeof v !== 'object'));
  return {
    docs,
    async findOne(q) {
      await tick();
      const d = docs.find((x) => matches(x, q));
      return d ? structuredClone(d) : null;
    },
    find(q) {
      const list = async () => {
        await tick();
        return docs.filter((x) => matches(x, q)).map((x) => structuredClone(x));
      };
      return { toArray: list, sort() { return this; }, limit() { return this; } };
    },
    async countDocuments(q) { await tick(); return docs.filter((x) => matches(x, q)).length; },
    async insertOne(doc) { docs.push(structuredClone(doc)); return { insertedId: doc._id }; },
    async findOneAndUpdate(q, u, opts = {}) {
      await tick();
      let d = docs.find((x) => matches(x, q));
      if (!d && opts.upsert) { d = seed(q); docs.push(d); apply(d, u, { insert: true }); return structuredClone(d); }
      if (!d) return null;
      apply(d, u);
      return structuredClone(d);
    },
    async updateOne(q, u, opts = {}) {
      await tick();
      const d = docs.find((x) => matches(x, q));
      if (!d) {
        if (!opts.upsert) return { matchedCount: 0, modifiedCount: 0 };
        const fresh = seed(q);
        docs.push(fresh);
        apply(fresh, u, { insert: true });
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      }
      return { matchedCount: 1, modifiedCount: apply(d, u) ? 1 : 0 };
    },
    async updateMany(q, u) { await tick(); for (const d of docs.filter((x) => matches(x, q))) apply(d, u); return {}; },
  };
}
function fakeDb() {
  const cols = new Map();
  return { collection: (name) => { if (!cols.has(name)) cols.set(name, fakeCollection()); return cols.get(name); } };
}

// ---------------------------------------------------------------- a small world: Sopal started it with Meng

const HOUR = 3600e3;
const SOPAL = 'U-1'; // started the conversation (sent the first 5): pair.a
const MENG = 'U-2';
const at = (ms) => new Date(ms).toISOString();
const user = (id, name, extra = {}) => ({
  _id: id, id, name, lang: 'en', gender: id === SOPAL ? 'woman' : 'man', level: 1, verified: { phone: true },
  phone: `+85510000${id.slice(2)}`, location: { type: 'Point', coordinates: [104.9012, 11.5731] }, ...extra,
});
const line = (n, text) => ({ n, source: 'written', key: null, text, lang: 'en', translations: { en: text } });
const reply = (n, text, t) => ({ n, key: null, text, lang: 'en', translations: { en: text }, at: t });
/** One Level 1 set, all 5 replied. */
const l1Set = (id, pairId, from, to, t) => ({
  _id: id, id, pairId, level: 1, from, to, sentAt: at(t), completedAt: at(t + HOUR),
  questions: [1, 2, 3, 4, 5].map((n) => line(n, `Line ${n} from ${from}`)),
  answers: [1, 2, 3, 4, 5].map((n) => reply(n, `ok ${n}`, at(t + HOUR))),
});

/**
 * Sopal (U-1) ⇄ Meng (U-2): Level 1 done, Level 2 waiting (`stage`, opening `opensIn` from now). U-3 / U-4 are App review
 * accounts with their own pair P-2 (a = U-3); U-5 is a real person.
 */
async function world({ stage = 'l2_wait', opensIn = 23 * HOUR, users = {} } = {}) {
  const d = fakeDb();
  const now = Date.now();
  const done = now - HOUR;
  for (const u of [
    user(SOPAL, 'Sopal', users[SOPAL]), user(MENG, 'Meng', users[MENG]),
    user('U-3', 'Sopal', { demo: REVIEW }), user('U-4', 'Meng', { demo: REVIEW }), user('U-5', 'Dara'),
  ]) await d.collection('thirtyda_users').insertOne(u);
  const pair = (id, a, b) => ({
    _id: id, id, key: [a, b].sort().join('|'), a, b, members: [a, b], stage, level: stage === 'l1' || stage === 'l2_wait' ? 1 : 2,
    startedAt: at(done - 3 * HOUR), l2OpensAt: stage === 'l1' ? null : at(now + opensIn), l3OpensAt: null, remind: {},
    opened: { [a]: at(done - 4 * HOUR) }, decisions: {}, lastChat: null, createdAt: at(done - 4 * HOUR), updatedAt: at(done),
  });
  for (const p of [pair('P-1', SOPAL, MENG), pair('P-2', 'U-3', 'U-4')]) {
    await d.collection('thirtyda_pairs').insertOne(p);
    await d.collection('thirtyda_chats').insertOne({ _id: p._id, id: p._id, a: p.a, b: p.b, level: p.level, messages: [] });
  }
  if (stage !== 'l1') {
    await d.collection('thirtyda_sets').insertOne(l1Set('S-1', 'P-1', SOPAL, MENG, done - 3 * HOUR));
    await d.collection('thirtyda_sets').insertOne(l1Set('S-2', 'P-1', MENG, SOPAL, done - 2 * HOUR));
  }
  return d;
}

const ctxOf = async (d, id, params = ['P-1'], body = {}) => ({
  d, me: await d.collection('thirtyda_users').findOne({ _id: id }), params, body,
  url: new URL('https://ecom.ggmt.sg/30da/api/x'), status: 200,
});
const call = async (d, fn, id, params, body) => levelHandlers[fn](await ctxOf(d, id, params, body));
const start = (d, id = SOPAL, pid = 'P-1') => call(d, 'startLevel2', id, [pid]);
const view = (d, id, pid = 'P-1') => call(d, 'getConversation', id, [pid]);
async function refusal(p) {
  try { await p; } catch (e) { return e; }
  return assert.fail('expected a refusal');
}
const pairDoc = (d, id = 'P-1') => d.collection('thirtyda_pairs').findOne({ _id: id });
const levelOf = async (d, id) => (await d.collection('thirtyda_users').findOne({ _id: id })).level;
const startedRows = async (d, id = 'P-1') => ((await d.collection('thirtyda_chats').findOne({ _id: id }))?.messages || [])
  .filter((m) => m.kind === 'decision' && /Started Level 2/.test(m.text));

// ---------------------------------------------------------------- the starter opens it

test('the starter opens Level 2 at once: the answer is the conversation at Level 2 with the send panel', async () => {
  const d = await world();
  const before = Date.now();
  const r = await start(d);
  assert.deepEqual(Object.keys(r), ['conversation']);
  const c = r.conversation;
  assert.equal(c.pair.stage, 'l2_open');
  assert.equal(c.pair.level, 2);
  assert.deepEqual(c.levels.map((L) => L.state), ['done', 'open']);
  assert.equal(c.canSend.level, 2, 'the send panel: my 5 for Level 2');
  assert.equal(c.next, 'send');
  assert.equal(c.canStartLevel2, false, 'nothing left to start');
  assert.equal(c.otherCanStartLevel2, false);

  const p = await pairDoc(d);
  assert.equal(p.stage, 'l2_open');
  assert.equal(p.level, 2);
  assert.ok(Date.parse(p.l2OpensAt) >= before - 5 && Date.parse(p.l2OpensAt) <= Date.now(), 'l2OpensAt brought forward to now');
  assert.equal(p.updatedAt, p.l2OpensAt, 'the conversation goes to the top of both lists, as a timed opening');
  assert.equal(p.l2StartedBy, SOPAL);
  assert.equal(p.a, SOPAL, 'who started it never changes');
  // The admin's chat log notes it once, as the starter's.
  const rows = await startedRows(d);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].from, SOPAL);
  assert.equal(rows[0].level, 2);
  assert.equal(rows[0].text, 'Started Level 2 now, before the wait was over');
});

test('levels are raised exactly as a timed opening raises them (users.level of both, chats.level)', async () => {
  // The same world twice: one opened by the starter, one by the timer.
  const early = await world();
  await start(early);
  const timed = await world({ opensIn: -1000 });
  await view(timed, MENG); // any read settles it

  for (const d of [early, timed]) {
    assert.equal(await levelOf(d, SOPAL), 2);
    assert.equal(await levelOf(d, MENG), 2);
    assert.equal((await d.collection('thirtyda_chats').findOne({ _id: 'P-1' })).level, 2);
    const p = await pairDoc(d);
    assert.equal(p.stage, 'l2_open');
    assert.equal(p.level, 2);
    assert.equal(p.updatedAt, p.l2OpensAt);
  }
  // The other conversations are untouched.
  for (const d of [early, timed]) {
    assert.equal((await pairDoc(d, 'P-2')).stage, 'l2_wait');
    assert.equal(await levelOf(d, 'U-3'), 1);
  }
  assert.equal((await startedRows(timed)).length, 0, 'the timer is not the starter');
});

test('the other person sees Level 2 open as after the timer, and learns it the usual way (the heartbeat\'s actions)', async () => {
  const d = await world();
  // Meng asked to be reminded when Level 2 opens.
  const on = await call(d, 'remind', MENG, ['P-1'], { on: true });
  assert.equal(on.pair.remind, true);
  let hb = await call(d, 'heartbeat', MENG, []);
  assert.deepEqual(hb.actions.map((a) => a.id), [], 'waiting for the timer is nothing to do');

  await start(d);
  const c = await view(d, MENG);
  assert.equal(c.pair.stage, 'l2_open');
  assert.deepEqual(c.levels.map((L) => L.state), ['done', 'open']);
  assert.equal(c.canSend.level, 2);
  assert.equal(c.canStartLevel2, false);
  assert.equal(c.otherCanStartLevel2, false);
  hb = await call(d, 'heartbeat', MENG, []);
  assert.deepEqual(hb.actions.map((a) => [a.id, a.next, a.turn]), [['P-1', 'send', true]], '"Level 2 is open": a notification where allowed');
  // Remind me stays harmless: still saved, and switching it off after the opening is fine.
  const off = await call(d, 'remind', MENG, ['P-1'], { on: false });
  assert.equal(off.pair.remind, false);
  assert.equal((await pairDoc(d)).stage, 'l2_open');
});

// ---------------------------------------------------------------- who and when

test('the other person cannot start it: 403 not_starter, nothing changes', async () => {
  const d = await world();
  const before = await pairDoc(d);
  const e = await refusal(start(d, MENG));
  assert.equal(e.status, 403);
  assert.equal(e.code, 'not_starter');
  assert.deepEqual(await pairDoc(d), before);
  assert.equal(await levelOf(d, MENG), 1);
  assert.equal((await startedRows(d)).length, 0);
  // Someone outside the conversation: no such conversation.
  const outside = await refusal(start(d, 'U-5'));
  assert.equal(outside.status, 404);
});

test('only while Level 2 waits: 409 not_waiting at Level 1, once open, at the choice, at Level 3, once ended', async () => {
  for (const stage of ['l1', 'l2_open', 'l3_decide', 'l3_open', 'ended']) {
    const d = await world({ stage });
    const before = await pairDoc(d);
    const e = await refusal(start(d));
    assert.equal(e.status, 409, stage);
    assert.equal(e.code, 'not_waiting', stage);
    assert.deepEqual(await pairDoc(d), before, `${stage}: nothing changes`);
    assert.equal((await startedRows(d)).length, 0, stage);
  }
  // The other person at a wrong stage: still "not yours" first.
  const d = await world({ stage: 'l2_open' });
  assert.equal((await refusal(start(d, MENG))).status, 403);
});

test('the timer came first: 409 not_waiting, the level opened by the timer, nothing noted as started early', async () => {
  const d = await world({ opensIn: -500 });
  const e = await refusal(start(d));
  assert.equal(e.status, 409);
  assert.equal(e.code, 'not_waiting');
  const p = await pairDoc(d);
  assert.equal(p.stage, 'l2_open');
  assert.equal(p.l2StartedBy, undefined);
  assert.equal(await levelOf(d, MENG), 2);
  assert.equal((await startedRows(d)).length, 0);
});

test('a double tap opens it once: two starts sent together, then a third', async () => {
  const d = await world();
  const both = await Promise.allSettled([start(d), start(d)]);
  assert.ok(both.some((r) => r.status === 'fulfilled'), 'at least one answers with the conversation');
  for (const r of both) {
    if (r.status === 'fulfilled') assert.equal(r.value.conversation.pair.stage, 'l2_open');
    else assert.equal(r.reason.code, 'not_waiting');
  }
  assert.equal((await pairDoc(d)).stage, 'l2_open');
  assert.equal((await startedRows(d)).length, 1, 'noted once');
  const opened = (await pairDoc(d)).l2OpensAt;
  // A tap after it opened: 409, and the opening time stays as it was.
  const e = await refusal(start(d));
  assert.equal(e.code, 'not_waiting');
  assert.equal((await pairDoc(d)).l2OpensAt, opened);
  assert.equal((await startedRows(d)).length, 1);
  assert.equal(await levelOf(d, SOPAL), 2);
});

test('two taps whose writes reach the database out of order still claim it once: one note, the later tap\'s time', async () => {
  // The first tap takes its time first, but its write is held until the second tap's write has landed (two pooled
  // connections, or two app instances): the time order alone would let it through as well — the l2StartedBy claim does not.
  const d = await world();
  const pairs = d.collection('thirtyda_pairs');
  const update = pairs.updateOne;
  let firstAt = null;
  let arrived;
  let release;
  const firstArrived = new Promise((r) => { arrived = r; });
  const gate = new Promise((r) => { release = r; });
  pairs.updateOne = async (q, u, o) => {
    if (!u.$set?.l2StartedBy) return update(q, u, o);
    if (!firstAt) {
      firstAt = u.$set.l2OpensAt;
      arrived();
      await gate;
      return update(q, u, o);
    }
    const r = await update(q, u, o);
    release(); // the first tap's write goes now, before the second tap's settle() has moved the stage
    return r;
  };
  const first = start(d);
  await firstArrived;
  await new Promise((r) => setTimeout(r, 3)); // the second tap's time is later
  const second = start(d);
  const both = await Promise.allSettled([first, second]);
  pairs.updateOne = update;
  for (const r of both) {
    if (r.status === 'fulfilled') assert.equal(r.value.conversation.pair.stage, 'l2_open');
    else assert.equal(r.reason.code, 'not_waiting');
  }
  const p = await pairDoc(d);
  assert.equal(p.stage, 'l2_open');
  assert.ok(p.l2OpensAt > firstAt, 'the first tap never wrote its (earlier) time');
  assert.equal(p.l2StartedBy, SOPAL);
  assert.equal((await startedRows(d)).length, 1, 'noted once');
  assert.equal(await levelOf(d, MENG), 2);
});

// ---------------------------------------------------------------- frozen pairs never move

test('a frozen pair stays: the other blocked by the admin, or one of them blocked the other → 409 other_blocked', async () => {
  const blockedByAdmin = await world({ users: { [MENG]: { blocked: true } } });
  const blockedByOne = await world();
  await addBlock(blockedByOne.collection(BLOCKS), MENG, SOPAL);
  for (const d of [blockedByAdmin, blockedByOne]) {
    const before = await pairDoc(d);
    const e = await refusal(start(d));
    assert.equal(e.status, 409);
    assert.equal(e.code, 'other_blocked');
    assert.deepEqual(await pairDoc(d), before, 'stage, level and l2OpensAt as they were');
    assert.equal(await levelOf(d, SOPAL), 1);
    assert.equal((await startedRows(d)).length, 0);
    const c = await view(d, SOPAL);
    assert.equal(c.canStartLevel2, false, 'no button on a frozen pair');
    assert.equal(c.otherCanStartLevel2, false);
  }
});

test('a block that lands while it is being started: the start is undone (time, claim, no note), levels untouched', async () => {
  const d = await world();
  const original = (await pairDoc(d)).l2OpensAt;
  const pairs = d.collection('thirtyda_pairs');
  const update = pairs.updateOne;
  // Right after the time is brought forward, Meng blocks Sopal.
  pairs.updateOne = async (q, u, o) => {
    const r = await update(q, u, o);
    if (u.$set?.l2StartedBy) await addBlock(d.collection(BLOCKS), MENG, SOPAL);
    return r;
  };
  const e = await refusal(start(d));
  pairs.updateOne = update;
  assert.equal(e.status, 409);
  assert.equal(e.code, 'other_blocked', 'answered like any write on a frozen pair');
  const p = await pairDoc(d);
  assert.equal(p.stage, 'l2_wait', 'a frozen pair does not move');
  assert.equal(p.level, 1);
  assert.equal(p.l2OpensAt, original, 'the original time comes back: the starter was told it failed');
  assert.equal('l2StartedBy' in p, false, 'the claim is undone');
  assert.equal((await startedRows(d)).length, 0, 'nothing noted: Level 2 never opened');
  assert.equal(await levelOf(d, SOPAL), 1);
  assert.equal(await levelOf(d, MENG), 1);
  assert.equal((await d.collection('thirtyda_chats').findOne({ _id: 'P-1' })).level, 1);
  const c = await view(d, SOPAL);
  assert.equal(c.pair.next, 'frozen');
  assert.equal(c.canStartLevel2, false);
  // Once the block is lifted the pair waits for its own timer again — and the starter may still start it now.
  d.collection(BLOCKS).docs.splice(0);
  const after = await view(d, MENG);
  assert.equal(after.pair.stage, 'l2_wait');
  assert.equal(await levelOf(d, MENG), 1);
  assert.equal((await view(d, SOPAL)).canStartLevel2, true);
  assert.equal((await start(d)).conversation.pair.stage, 'l2_open');
  assert.equal((await startedRows(d)).length, 1);
  assert.equal(await levelOf(d, MENG), 2);
});

test('an admin block of the starter that lands while it is being started: undone the same way', async () => {
  const d = await world();
  const original = (await pairDoc(d)).l2OpensAt;
  const pairs = d.collection('thirtyda_pairs');
  const update = pairs.updateOne;
  pairs.updateOne = async (q, u, o) => {
    const r = await update(q, u, o);
    if (u.$set?.l2StartedBy) await d.collection('thirtyda_users').updateOne({ _id: SOPAL }, { $set: { blocked: true } });
    return r;
  };
  const e = await refusal(start(d));
  pairs.updateOne = update;
  assert.equal(e.code, 'other_blocked');
  const p = await pairDoc(d);
  assert.equal(p.stage, 'l2_wait');
  assert.equal(p.l2OpensAt, original);
  assert.equal('l2StartedBy' in p, false);
  assert.equal((await startedRows(d)).length, 0);
});

// ---------------------------------------------------------------- the conversation says who may start it

test('canStartLevel2 only for the starter while Level 2 waits; otherCanStartLevel2 only for the other person', async () => {
  const d = await world();
  const a = await view(d, SOPAL);
  const b = await view(d, MENG);
  assert.equal(a.canStartLevel2, true);
  assert.equal(a.otherCanStartLevel2, false);
  assert.equal(b.canStartLevel2, false);
  assert.equal(b.otherCanStartLevel2, true);
  assert.equal(a.pair.role, 'a');
  assert.equal(b.pair.role, 'b');
  assert.equal(a.next, 'wait_timer');
  assert.equal(b.next, 'wait_timer');
  assert.ok(a.levels[1].opensAt, 'the countdown stays for both');
  for (const stage of ['l1', 'l2_open', 'l3_decide', 'l3_open', 'ended']) {
    const w = await world({ stage });
    for (const id of [SOPAL, MENG]) {
      const c = await view(w, id);
      assert.equal(c.canStartLevel2, false, `${stage} ${id}`);
      assert.equal(c.otherCanStartLevel2, false, `${stage} ${id}`);
    }
  }
});

test('App review accounts work the same, among themselves only', async () => {
  const d = await world();
  assert.equal((await view(d, 'U-3', 'P-2')).canStartLevel2, true);
  assert.equal((await refusal(start(d, 'U-4', 'P-2'))).code, 'not_starter');
  const r = await start(d, 'U-3', 'P-2');
  assert.equal(r.conversation.pair.stage, 'l2_open');
  assert.equal(await levelOf(d, 'U-4'), 2);
  assert.equal((await pairDoc(d)).stage, 'l2_wait', 'the real conversation is untouched');
  // A real person and a review account never reach each other's conversation.
  assert.equal((await refusal(start(d, 'U-5', 'P-2'))).status, 404);
});

// ---------------------------------------------------------------- the gates

test('the route: POST only, locked by the PIN like the rest, waits for "I agree", and talks to someone (verify to chat)', () => {
  const path = '/pairs/P-1/level2/start';
  assert.ok(API_ROUTES.some((r) => r.method === 'POST' && r.re.test(path)));
  assert.equal(API_ROUTES.some((r) => r.method === 'GET' && r.re.test(path)), false);
  assert.equal(API_ROUTES.some((r) => r.method === 'POST' && r.re.test('/pairs/P-1/level2/start/x')), false);
  assert.equal(API_ROUTES.some((r) => r.method === 'POST' && r.re.test('/pairs/P-1/level3/start')), false);
  assert.equal(whileLocked('POST', path), null, '423 while locked');
  assert.equal(termsFree('POST', path), false, '403 terms_needed before "I agree"');
  assert.equal(talksToSomeone('POST', path), true, '403 verify_needed without a verified way');
  assert.ok(TALK_ROUTES.some(([m, re]) => m === 'POST' && re.test(path)));
  assert.equal(OPEN_WRITES.some(([m, re]) => m === 'POST' && re.test(path)), false);
  // The handler loads the pair for writing (frozen → 409) like the other pair actions.
  const src = readFileSync(new URL('./thirtyda-app.mjs', import.meta.url), 'utf8');
  const i = src.indexOf('async function startLevel2(');
  const body = src.slice(i, src.indexOf('\n}\n', i));
  assert.match(body, /await pairFor\(ctx, params\[0\], \{ write: true \}\)/);
  assert.match(body, /await settle\(d, await pairs\.findOne\(\{ _id: pair\._id \}\)\)/, 'the timer\'s own rules open it');
  assert.match(body, /\{ _id: pair\._id, a: me\._id, stage: "l2_wait", l2OpensAt: \{ \$gt: at \}, l2StartedBy: \{ \$exists: false \} \}/,
    'forward only, while it waits, by the starter, claimed once');
  // Noted only once it really opened: the frozen path throws (and undoes its claim) before the note.
  assert.ok(body.indexOf('throw fail(409, "other_blocked"') < body.indexOf('appendMessages('), 'no note for a start a block refused');
  assert.match(body, /\{ _id: pair\._id, stage: "l2_wait", l2StartedBy: me\._id, l2OpensAt: at \},\s+\{ \$set: \{ l2OpensAt: pair\.l2OpensAt \}, \$unset: \{ l2StartedBy: "" \} \}/);
});

// ---------------------------------------------------------------- the screen

const APP_DIR = new URL('../thirtyda-app/', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, APP_DIR), 'utf8');
const LANGS = ['en', 'km', 'zh', 'ko', 'ja'];
function stringsOf(src, lang) {
  const reg = src.slice(src.lastIndexOf('registerStrings({'));
  const at0 = reg.indexOf(`\n  ${lang}: {\n`);
  assert.ok(at0 >= 0, `${lang} block`);
  const block = reg.slice(at0, reg.indexOf('\n  },', at0));
  return Object.fromEntries([...block.matchAll(/^ {4}(\w+): '((?:[^'\\]|\\.)*)',/gm)].map((m) => [m[1], m[2]]));
}

test('the screen: "Start Level 2 now" for the starter on the countdown, a line for the other person, in 5 languages', () => {
  const conv = read('screens/conversation.js');
  assert.match(conv, /const canStart = !chatMode && level === 2 && conv\.canStartLevel2 === true && !frozen\(\);/);
  assert.match(conv, /const theyCan = !chatMode && level === 2 && conv\.otherCanStartLevel2 === true && !frozen\(\);/);
  assert.match(conv, /canStart \? startButton\(level\) : null,/);
  assert.match(conv, /theyCan \? el\('p', \{ class: 'conv-wait-note' \}, t\('cv_start_sooner', \{ name: name\(\), n: level \}\)\) : null/);
  assert.match(conv, /chatMode \|\| !canRemind\(\) \? null : remindButton\(level, until\)/, 'Remind me stays for both');
  assert.match(conv, /await api\.post\(`\$\{base\}\/level2\/start`, \{\}\)/);
  assert.match(conv, /apply\(unwrap\(r\)\); \/\/ "Level 2 is open\." and the send panel/);
  assert.match(conv, /if \(!alive \|\| starting\) return;/, 'one request at a time');
  // "Verify to chat" closed without verifying (403 verify_needed): the greyed button is painted free again.
  const s0 = conv.indexOf('async function startLevel2(');
  const startFn = conv.slice(s0, conv.indexOf('\n  }\n', s0));
  assert.equal(startFn.includes('if (!alive || redirected(err)) return;'), false, 'no early return past the repaint');
  assert.match(startFn, /if \(redirected\(err\)\) \{\n\s+if \(err\.code === 'verify_needed'\) renderSoon\(\);/);
  // A reminder this phone set for the old time is cancelled once Level 2 shows open.
  assert.match(conv, /shell\.cancelRemind\(\{ id: reminderId\(pairId\) \}\)\.catch\(\(\) => \{\}\);/);
  for (const lang of LANGS) {
    const s = stringsOf(conv, lang);
    assert.ok(s.cv_start_now?.includes('{n}'), `${lang}.cv_start_now`);
    assert.ok(s.cv_start_sooner?.includes('{name}') && s.cv_start_sooner.includes('{n}'), `${lang}.cv_start_sooner`);
  }
  assert.equal(stringsOf(conv, 'en').cv_start_now, 'Start Level {n} now');
  assert.equal(stringsOf(conv, 'en').cv_start_sooner, '{name} can start Level {n} sooner.');
  assert.match(stringsOf(conv, 'km').cv_start_now, /^ចាប់ផ្ដើមកម្រិត \{n\}/);
  // The profile's "Level 2 opens in …" re-reads the pair once the heartbeat lists it (an early start), and stops listening.
  const prof = read('screens/profile.js');
  const w0 = prof.indexOf("case 'wait_timer': {");
  const waitCase = prof.slice(w0, prof.indexOf("case 'decide':", w0));
  assert.match(waitCase, /if \(!state\.actions\.some\(\(a\) => a\.id === pair\.id\)\) return;/);
  assert.match(waitCase, /bus\.removeEventListener\('actions', moved\);\n\s+reload\(\);/);
  assert.match(waitCase, /bus\.addEventListener\('actions', moved\);/);
  assert.match(waitCase, /stops\.push\(\(\) => bus\.removeEventListener\('actions', moved\)\);/);
  assert.match(prof, /^ {2}screen, el, icon, t, go, api, toast, modal, state, bus, topBar,/m);
  const css = read('app.css');
  for (const sel of ['.conv-wait-more {', '.conv-start {', '.conv-wait-note {']) assert.ok(css.includes(`\n${sel}`), sel);
  // The design board answers it like the server.
  const demo = read('board/demo.js');
  assert.match(demo, /\['POST', \/\^\\\/pairs\\\/\(P-\\d\+\)\\\/level2\\\/start\$\/, startLevel2\]/);
  assert.match(demo, /canStartLevel2: l2Waiting && pair\.a === u\.id,/);
});
