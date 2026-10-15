// Run: npm run 30da:test (or node --test src/lib/thirtyda-level3-start.test.mjs)
// "Go to Level 3 now" (owner 2026-10-15, testing at Level 2 as Sopal — the starter — after Meng replied to all 5 of her
// Level 2 lines while he had not sent his own 5: "again same situvation after level 2 if the 1st starting want to jump
// to level 3 can do ..."). POST /pairs/:id/level3/start, run on the app's own handlers (levelHandlers in
// src/lib/thirtyda-app.mjs) over an in-memory Mongo stand-in whose every call waits a turn, so two requests sent together
// really run side by side: only the starter (pair.a), only while Level 2 is open, only once all 5 of her own Level 2 lines
// have Meng's reply; it moves the pair to the choice after Level 2 (l3_decide) with HER choice "Open the chat" recorded,
// and Meng still chooses (open → the chat, forget → ended) — nobody is put into a chat they did not choose. Once, for two
// taps; never on a frozen pair; Meng's late Level 2 send (also one already on its way when she moves) / Sopal's late
// replies are refused like after any finished level and the Level 2 history there is still reads back; the conversation
// tells each side whether it may; the route's place in the PIN / verify / terms gates; the screen's button (waiting for
// Meng's 5, or her turn to reply to them), the other one's line, his toast when it happened, their strings in 5 languages.
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
const { questionConfig } = await import('./thirtyda-questions.mjs');

// ---------------------------------------------------------------- an in-memory Mongo, just enough for these routes

const tick = () => new Promise((r) => setImmediate(r));
const get = (doc, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc);
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
/** The aggregation expressions the reply saves use ($expr filter, the one-line pipeline update). */
function expr(doc, e, vars = {}) {
  if (typeof e === 'string' && e.startsWith('$$')) {
    const [v, ...rest] = e.slice(2).split('.');
    return rest.reduce((o, k) => (o == null ? undefined : o[k]), vars[v]);
  }
  if (typeof e === 'string' && e.startsWith('$')) return get(doc, e.slice(1));
  if (Array.isArray(e)) return e.map((x) => expr(doc, x, vars));
  if (!e || typeof e !== 'object') return e;
  const [op] = Object.keys(e);
  const a = e[op];
  switch (op) {
    case '$literal': return structuredClone(a);
    case '$ifNull': { const v = expr(doc, a[0], vars); return v == null ? expr(doc, a[1], vars) : v; }
    case '$eq': { const [x, y] = expr(doc, a, vars); return same(x, y); }
    case '$ne': { const [x, y] = expr(doc, a, vars); return !same(x, y); }
    case '$add': return expr(doc, a, vars).reduce((s, x) => s + x, 0);
    case '$concatArrays': return expr(doc, a, vars).flat(1);
    case '$filter': return (expr(doc, a.input, vars) || []).filter((x) => expr(doc, a.cond, { ...vars, this: x }));
    default:
      if (op.startsWith('$')) throw new Error(`fake mongo expr: ${op}`);
      return structuredClone(e);
  }
}
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
const matches = (doc, q = {}) => Object.entries(q).every(([k, w]) => {
  if (k === '$or') return w.some((alt) => matches(doc, alt));
  if (k === '$expr') return Boolean(expr(doc, w));
  return cond(get(doc, k), w);
});
function setPath(doc, path, value) {
  const keys = path.split('.');
  let o = doc;
  for (const k of keys.slice(0, -1)) o = (o[k] ??= {});
  const before = JSON.stringify(o[keys.at(-1)]);
  o[keys.at(-1)] = structuredClone(value);
  return before !== JSON.stringify(value);
}
function apply(doc, u, { insert = false } = {}) {
  if (Array.isArray(u)) { // a pipeline update: each $set reads the document as it is at that stage
    let changed = false;
    for (const stage of u) {
      const values = Object.fromEntries(Object.entries(stage.$set || {}).map(([k, e]) => [k, expr(doc, e)]));
      for (const [k, v] of Object.entries(values)) changed = setPath(doc, k, v) || changed;
    }
    return changed;
  }
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
    async insertOne(doc) {
      await tick();
      if (docs.some((x) => x._id === doc._id)) throw Object.assign(new Error('duplicate key'), { code: 11000 });
      docs.push(structuredClone(doc));
      return { insertedId: doc._id };
    },
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
    async deleteOne(q) {
      await tick();
      const i = docs.findIndex((x) => matches(x, q));
      if (i >= 0) docs.splice(i, 1);
      return { deletedCount: i >= 0 ? 1 : 0 };
    },
  };
}
function fakeDb() {
  const cols = new Map();
  return { collection: (name) => { if (!cols.has(name)) cols.set(name, fakeCollection()); return cols.get(name); } };
}

// ---------------------------------------------------------------- a small world: Sopal started it with Meng, now at Level 2

const HOUR = 3600e3;
const SOPAL = 'U-1'; // started the conversation (sent the first 5): pair.a
const MENG = 'U-2';
const at = (ms) => new Date(ms).toISOString();
// No digits anywhere: the split check reads all of one person's texts together, and "1", "2", "3"… would make a number.
const LINES = ['Coffee or tea?', 'Rain or sun?', 'City or sea?', 'Books or films?', 'Dogs or cats?'];
const WORDS = ['tea', 'sun', 'sea', 'books', 'cats'];
const user = (id, name, extra = {}) => ({
  _id: id, id, name, lang: 'en', gender: id === SOPAL || id === 'U-3' ? 'woman' : 'man', level: 1, verified: { phone: true },
  phone: `+85510000${id.slice(2)}`, location: { type: 'Point', coordinates: [104.9012, 11.5731] }, ...extra,
});
const line = (n) => ({ n, source: 'written', key: null, text: LINES[n - 1], lang: 'en', translations: { en: LINES[n - 1] } });
const reply = (n, t) => ({ n, key: null, text: WORDS[n - 1], lang: 'en', translations: { en: WORDS[n - 1] }, at: t });
/** One set of 5 lines with `replied` replies (all 5: complete). */
const aSet = (id, pairId, level, from, to, t, replied = 5) => ({
  _id: id, id, pairId, level, from, to, sentAt: at(t), completedAt: replied >= 5 ? at(t + HOUR / 2) : null,
  questions: [1, 2, 3, 4, 5].map(line),
  answers: [1, 2, 3, 4, 5].slice(0, replied).map((n) => reply(n, at(t + HOUR / 2))),
});
const LEVEL_OF = { l1: 1, l2_wait: 1, l2_open: 2, l3_decide: 2, l3_open: 3, ended: 2 };

/**
 * Sopal (U-1) ⇄ Meng (U-2) at `stage` (Level 2 open by default). Level 1 done. At Level 2: Sopal's 5 sent, `mengReplied`
 * of them replied by Meng; Meng's own 5 sent when `mengSent`, `sopalReplied` of them replied by Sopal. U-3 / U-4 are App
 * review accounts with the same story in their own pair P-2 (a = U-3); U-5 is a real person outside both.
 */
async function world({ stage = 'l2_open', mengReplied = 5, mengSent = false, sopalReplied = 0, users = {} } = {}) {
  const d = fakeDb();
  const now = Date.now();
  const lvl = LEVEL_OF[stage];
  for (const u of [
    user(SOPAL, 'Sopal', { level: lvl, ...users[SOPAL] }), user(MENG, 'Meng', { level: lvl, ...users[MENG] }),
    user('U-3', 'Sopal', { demo: REVIEW, level: lvl }), user('U-4', 'Meng', { demo: REVIEW, level: lvl }), user('U-5', 'Dara'),
  ]) await d.collection('thirtyda_users').insertOne(u);
  const l2 = ['l2_open', 'l3_decide', 'l3_open', 'ended'].includes(stage);
  const pair = (id, a, b) => ({
    _id: id, id, key: [a, b].sort().join('|'), a, b, members: [a, b], stage, level: lvl,
    startedAt: at(now - 9 * HOUR), l2OpensAt: stage === 'l1' ? null : stage === 'l2_wait' ? at(now + 20 * HOUR) : at(now - 4 * HOUR),
    l3OpensAt: stage === 'l3_open' ? at(now - HOUR) : null, remind: {}, opened: { [a]: at(now - 10 * HOUR) },
    decisions: stage === 'l3_open' ? { [a]: { open: true, at: at(now - HOUR) }, [b]: { open: true, at: at(now - HOUR) } } : {},
    ...(stage === 'ended' ? { endedAt: at(now - HOUR), endedBy: b } : {}),
    lastChat: null, createdAt: at(now - 10 * HOUR), updatedAt: at(now - 2 * HOUR),
  });
  for (const [p, x] of [[pair('P-1', SOPAL, MENG), ''], [pair('P-2', 'U-3', 'U-4'), 'R']]) {
    await d.collection('thirtyda_pairs').insertOne(p);
    await d.collection('thirtyda_chats').insertOne({ _id: p._id, id: p._id, a: p.a, b: p.b, level: lvl, messages: [] });
    const sets = d.collection('thirtyda_sets');
    if (stage !== 'l1') {
      await sets.insertOne(aSet(`S-${x}1`, p._id, 1, p.a, p.b, now - 9 * HOUR));
      await sets.insertOne(aSet(`S-${x}2`, p._id, 1, p.b, p.a, now - 8 * HOUR));
    }
    if (l2) {
      // A finished Level 2 (the choice, the chat, ended) had both sets complete; an open one has what the test says.
      const open = stage === 'l2_open';
      await sets.insertOne(aSet(`S-${x}3`, p._id, 2, p.a, p.b, now - 3 * HOUR, open ? mengReplied : 5));
      if (!open || mengSent) await sets.insertOne(aSet(`S-${x}4`, p._id, 2, p.b, p.a, now - 3 * HOUR + 60e3, open ? sopalReplied : 5));
    }
  }
  return d;
}

const ctxOf = async (d, id, params = ['P-1'], body = {}) => ({
  d, me: await d.collection('thirtyda_users').findOne({ _id: id }), params, body,
  url: new URL('https://ecom.ggmt.sg/30da/api/x'), status: 200,
});
const call = async (d, fn, id, params, body) => levelHandlers[fn](await ctxOf(d, id, params, body));
const start = (d, id = SOPAL, pid = 'P-1') => call(d, 'startLevel3', id, [pid]);
const view = (d, id, pid = 'P-1') => call(d, 'getConversation', id, [pid]);
const decide = (d, id, open, pid = 'P-1') => call(d, 'decide', id, [pid], { open });
async function refusal(p) {
  try { await p; } catch (e) { return e; }
  return assert.fail('expected a refusal');
}
const pairDoc = (d, id = 'P-1') => d.collection('thirtyda_pairs').findOne({ _id: id });
const levelOf = async (d, id) => (await d.collection('thirtyda_users').findOne({ _id: id })).level;
const chatLevel = async (d, id = 'P-1') => (await d.collection('thirtyda_chats').findOne({ _id: id })).level;
const movedRows = async (d, id = 'P-1') => ((await d.collection('thirtyda_chats').findOne({ _id: id }))?.messages || [])
  .filter((m) => m.kind === 'decision' && /Moved on to Level 3/.test(m.text));
const setDoc = (d, id) => d.collection('thirtyda_sets').docs.find((s) => s._id === id);

// ---------------------------------------------------------------- the starter moves on

test('Meng replied to all 5 of Sopal\'s Level 2 lines: she moves on — her "Open the chat" recorded, Meng still chooses', async () => {
  const d = await world();
  const before = await pairDoc(d);
  const r = await start(d);
  assert.deepEqual(Object.keys(r), ['conversation']);
  const c = r.conversation;
  assert.equal(c.pair.stage, 'l3_decide');
  assert.equal(c.pair.level, 2, 'the choice after Level 2 is still Level 2');
  assert.deepEqual(c.levels.map((L) => L.state), ['done', 'done']);
  assert.equal(c.decision.mine, true, 'her own choice: open the chat');
  assert.equal(c.decision.canDecide, false);
  assert.equal(c.decision.ended, false);
  assert.equal(c.next, 'wait_them', '"You chose to open the chat — waiting for Meng"');
  assert.equal(c.pair.turn, false);
  assert.equal(c.chat.open, false, 'nobody is in a chat they did not choose');
  assert.equal(c.canSend, null);
  assert.equal(c.canStartLevel3, false, 'nothing left to move on to');
  assert.equal(c.otherCanStartLevel3, false);
  assert.equal(c.other.realName, undefined, 'real names only once the chat is open');

  const p = await pairDoc(d);
  assert.equal(p.stage, 'l3_decide');
  assert.equal(p.level, 2);
  assert.deepEqual(Object.keys(p.decisions), [SOPAL], 'only her choice: Meng has not chosen');
  assert.equal(p.decisions[SOPAL].open, true);
  assert.equal(p.decisions[SOPAL].at, p.updatedAt);
  assert.ok(p.updatedAt > before.updatedAt, 'the conversation goes to the top of both lists');
  assert.equal(p.l3StartedBy, SOPAL);
  assert.equal(p.a, SOPAL, 'who started it never changes');
  assert.equal(p.l2OpensAt, before.l2OpensAt);
  // The admin's chat log notes it once, as hers.
  const rows = await movedRows(d);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].from, SOPAL);
  assert.equal(rows[0].level, 2);
  assert.equal(rows[0].open, true);
  assert.equal(rows[0].text, 'Moved on to Level 3 before Level 2 was finished');
  // The other conversation is untouched.
  assert.equal((await pairDoc(d, 'P-2')).stage, 'l2_open');
});

test('Meng chooses on the usual screen: "Open the chat" opens Level 3 for both (as when both chose it)', async () => {
  const d = await world();
  await start(d);
  const m = await view(d, MENG);
  assert.equal(m.pair.stage, 'l3_decide');
  assert.equal(m.decision.canDecide, true, 'the usual choice after Level 2');
  assert.equal(m.decision.mine, null);
  assert.equal(m.next, 'decide');
  assert.equal(m.pair.turn, true, 'his turn: the red dot and a notification');
  assert.equal(m.chat.open, false);
  const r = await decide(d, MENG, true);
  assert.equal(r.conversation.pair.stage, 'l3_open');
  assert.equal(r.conversation.chat.open, true);
  const p = await pairDoc(d);
  assert.equal(p.stage, 'l3_open');
  assert.equal(p.level, 3);
  assert.equal(p.decisions[SOPAL].open, true);
  assert.equal(p.decisions[MENG].open, true);
  assert.equal(await levelOf(d, SOPAL), 3);
  assert.equal(await levelOf(d, MENG), 3);
  assert.equal(await chatLevel(d), 3);
  assert.equal((await view(d, SOPAL)).chat.open, true);
  const log = (await d.collection('thirtyda_chats').findOne({ _id: 'P-1' })).messages.filter((x) => x.kind === 'decision').map((x) => x.text);
  assert.deepEqual(log, [
    'Moved on to Level 3 before Level 2 was finished', 'Chose to open the chat (Level 3)', 'Both chose to open the chat: Level 3 is open',
  ]);
});

test('Meng chooses "Forget it": the conversation ends for both, as always', async () => {
  const d = await world();
  await start(d);
  const r = await decide(d, MENG, false);
  assert.equal(r.conversation.pair.stage, 'ended');
  assert.equal(r.conversation.decision.ended, true);
  const p = await pairDoc(d);
  assert.equal(p.stage, 'ended');
  assert.equal(p.endedBy, MENG);
  assert.equal(p.level, 2);
  assert.equal(await levelOf(d, SOPAL), 2);
  const s = await view(d, SOPAL);
  assert.equal(s.next, 'ended');
  assert.equal(s.chat.open, false);
});

test('Sopal can still change her mind ("Forget it") while Meng has not chosen; the same choice again changes nothing', async () => {
  const d = await world();
  await start(d);
  const again = await decide(d, SOPAL, true);
  assert.equal(again.conversation.pair.stage, 'l3_decide');
  assert.equal((await movedRows(d)).length, 1);
  const forget = await decide(d, SOPAL, false);
  assert.equal(forget.conversation.pair.stage, 'ended');
  assert.equal((await pairDoc(d)).endedBy, SOPAL);
});

test('levels: the choice is Level 2 like the usual finish of Level 2 (users.level and chats.level stay 2, the heartbeat agrees)', async () => {
  const d = await world();
  assert.equal(await levelOf(d, SOPAL), 2);
  await start(d);
  for (const id of [SOPAL, MENG]) {
    await call(d, 'heartbeat', id, []);
    assert.equal(await levelOf(d, id), 2, id);
  }
  assert.equal(await chatLevel(d), 2);
  assert.equal((await pairDoc(d)).level, 2);
});

test('the heartbeat: Meng has something to do (choose), Sopal waits', async () => {
  const d = await world();
  let hb = await call(d, 'heartbeat', MENG, []);
  assert.deepEqual(hb.actions.map((a) => a.id), ['P-1'], 'before: his 5 to send');
  assert.equal(hb.actions[0].next, 'send');
  await start(d);
  hb = await call(d, 'heartbeat', MENG, []);
  assert.deepEqual(hb.actions.map((a) => [a.id, a.next, a.turn]), [['P-1', 'decide', true]]);
  hb = await call(d, 'heartbeat', SOPAL, []);
  assert.deepEqual(hb.actions.map((a) => a.id), [], 'she chose: waiting for Meng is nothing to do');
});

// ---------------------------------------------------------------- the Level 2 that was not finished

test('Meng\'s Level 2 lines are no longer needed: sending them after the move is refused cleanly (409 not_your_turn)', async () => {
  const d = await world();
  await start(d);
  const sets = d.collection('thirtyda_sets').docs.length;
  const e = await refusal(call(d, 'sendSet', MENG, ['P-1'], {
    level: 2, questions: LINES.map((text) => ({ source: 'written', text })),
  }));
  assert.equal(e.status, 409);
  assert.equal(e.code, 'not_your_turn');
  assert.equal(d.collection('thirtyda_sets').docs.length, sets, 'nothing saved');
  assert.equal((await pairDoc(d)).stage, 'l3_decide');
  // And the view: no send panel for him, the history as it is.
  const m = await view(d, MENG);
  assert.equal(m.canSend, null);
  assert.equal(m.levels[1].mine, null, 'he never sent his 5');
  assert.equal(m.levels[1].theirs.replied, 5);
  assert.equal(m.levels[1].theirs.canReply, false);
});

test('Meng\'s 5 on their way while Sopal moves on: the move wins, his set is taken back (409 not_your_turn, nothing logged)', async () => {
  // A valid Level 2 set (3 picked from the admin's lists, 2 written): it is kept when nothing moves meanwhile.
  const body = async (d) => {
    const { slots } = await questionConfig(d, 2);
    return {
      level: 2, questions: [
        ...[0, 1, 2].map((i) => ({ source: 'system', key: slots[i][0].key })),
        { source: 'written', text: LINES[0] }, { source: 'written', text: LINES[1] },
      ],
    };
  };
  const fresh = async () => {
    const d = await world();
    await d.collection('thirtyda_counters').insertOne({ _id: 'set', seq: 100 }); // past the world's own S-1 … S-R4
    return d;
  };
  const mengL2 = (d) => d.collection('thirtyda_sets').docs.filter((s) => s.level === 2 && s.from === MENG);
  const mengRows = async (d) => ((await d.collection('thirtyda_chats').findOne({ _id: 'P-1' })).messages || [])
    .filter((m) => m.kind === 'question' && m.level === 2 && m.from === MENG);
  {
    const d = await fresh();
    const ctx = await ctxOf(d, MENG, ['P-1'], await body(d));
    await levelHandlers.sendSet(ctx);
    assert.equal(ctx.status, 201, 'the same send with nothing moving meanwhile');
    assert.equal(mengL2(d).length, 1);
    assert.equal((await mengRows(d)).length, 5);
  }
  // Sopal's move lands while his checks and translations run: just before his set is stored, or just after it.
  for (const when of ['before', 'after']) {
    const d = await fresh();
    const sets = d.collection('thirtyda_sets');
    const insert = sets.insertOne;
    sets.insertOne = async (doc) => {
      if (doc.level === 2 && doc.from === MENG && when === 'before') await start(d);
      const r = await insert(doc);
      if (doc.level === 2 && doc.from === MENG && when === 'after') await start(d);
      return r;
    };
    const e = await refusal(call(d, 'sendSet', MENG, ['P-1'], await body(d)));
    sets.insertOne = insert;
    assert.equal(e.status, 409, when);
    assert.equal(e.code, 'not_your_turn', when);
    assert.deepEqual(mengL2(d), [], `${when}: his set is not kept — nobody could reply to it`);
    assert.deepEqual(await mengRows(d), [], `${when}: no Level 2 lines after the move in the chat log`);
    const p = await pairDoc(d);
    assert.equal(p.stage, 'l3_decide', when);
    assert.deepEqual(Object.keys(p.decisions), [SOPAL], when);
    assert.equal(p.updatedAt, p.decisions[SOPAL].at, `${when}: not bumped by the refused send`);
    assert.equal((await movedRows(d)).length, 1, when);
    const s = await view(d, SOPAL);
    assert.equal(s.levels[1].theirs, null, `${when}: no lines for Sopal she cannot reply to`);
    const m = await view(d, MENG);
    assert.equal(m.levels[1].mine, null, when);
    assert.equal(m.decision.canDecide, true, `${when}: Meng still chooses`);
  }
});

test('Meng had sent his 5 and Sopal replied to 2: the rest is not needed — her late replies are refused, the history reads back', async () => {
  const d = await world({ mengSent: true, sopalReplied: 2 });
  const s0 = await view(d, SOPAL);
  assert.equal(s0.canStartLevel3, true, 'all 5 of hers replied: she may move on even with his lines waiting');
  await start(d);
  for (const [fn, body] of [
    ['saveReply', { level: 2, n: 3, text: 'fine' }],
    ['sendAnswers', { level: 2, answers: [1, 2, 3, 4, 5].map((n) => ({ n, text: 'fine' })) }],
  ]) {
    const e = await refusal(call(d, fn, SOPAL, ['P-1'], body));
    assert.equal(e.status, 409, fn);
    assert.equal(e.code, 'not_your_turn', fn);
  }
  assert.equal(setDoc(d, 'S-4').answers.length, 2, 'his set as it was');
  assert.equal(setDoc(d, 'S-4').completedAt, null);
  // Both read the Level 2 there is: her 5 with his replies, his 5 with her 2 replies; nothing open to reply to.
  const s = await view(d, SOPAL);
  assert.equal(s.levels[1].state, 'done');
  assert.equal(s.levels[1].mine.replied, 5);
  assert.equal(s.levels[1].theirs.replied, 2);
  assert.equal(s.levels[1].theirs.canReply, false);
  assert.deepEqual(s.levels[1].theirs.lines.map((l) => Boolean(l.reply)), [true, true, false, false, false]);
  const m = await view(d, MENG);
  assert.equal(m.levels[1].mine.replied, 2);
  assert.equal(m.levels[1].theirs.replied, 5);
  assert.equal(m.decision.canDecide, true);
  assert.deepEqual([m.pair.recap.l2.answered, m.pair.recap.l2.total], [7, 10]);
  // His choice still opens the chat.
  assert.equal((await decide(d, MENG, true)).conversation.pair.stage, 'l3_open');
});

test('Level 2 finishing the usual way and the move: whichever comes first, the other changes nothing', async () => {
  // The move first: her last reply to his 5 is refused (Level 2 is finished), her choice stays.
  {
    const d = await world({ mengSent: true, sopalReplied: 4 });
    await start(d);
    const e = await refusal(call(d, 'saveReply', SOPAL, ['P-1'], { level: 2, n: 5, text: 'cats' }));
    assert.equal(e.code, 'not_your_turn');
    const p = await pairDoc(d);
    assert.equal(p.stage, 'l3_decide');
    assert.equal(p.decisions[SOPAL].open, true);
  }
  // Her last reply first: Level 2 is done the usual way (nobody has chosen yet), and the move answers 409 not_open.
  {
    const d = await world({ mengSent: true, sopalReplied: 4 });
    const r = await call(d, 'saveReply', SOPAL, ['P-1'], { level: 2, n: 5, text: 'cats' });
    assert.equal(r.conversation.pair.stage, 'l3_decide');
    const e = await refusal(start(d));
    assert.equal(e.status, 409);
    assert.equal(e.code, 'not_open');
    const p = await pairDoc(d);
    assert.deepEqual(p.decisions, {});
    assert.equal('l3StartedBy' in p, false);
    assert.equal((await movedRows(d)).length, 0);
  }
  // Both at once: one of them moves it, never a mix (her choice recorded ⇔ the move noted).
  for (let i = 0; i < 4; i++) {
    const d = await world({ mengSent: true, sopalReplied: 4 });
    const both = await Promise.allSettled([call(d, 'saveReply', SOPAL, ['P-1'], { level: 2, n: 5, text: 'cats' }), start(d)]);
    for (const r of both) if (r.status === 'rejected') assert.ok(['not_open', 'not_your_turn'].includes(r.reason.code), r.reason.message);
    const p = await pairDoc(d);
    assert.equal(p.stage, 'l3_decide');
    const moved = p.l3StartedBy === SOPAL;
    assert.equal(moved, both[1].status === 'fulfilled');
    assert.equal(moved ? p.decisions[SOPAL]?.open : p.decisions[SOPAL], moved ? true : undefined);
    assert.equal((await movedRows(d)).length, moved ? 1 : 0);
    assert.equal(p.decisions[MENG], undefined, 'Meng has not chosen');
  }
});

// ---------------------------------------------------------------- who and when

test('not before Meng replied to all 5 of hers: 409 not_ready (4 of 5, none, or her 5 not sent), nothing changes', async () => {
  for (const mengReplied of [4, 0]) {
    const d = await world({ mengReplied, mengSent: true, sopalReplied: 5 });
    const before = await pairDoc(d);
    const e = await refusal(start(d));
    assert.equal(e.status, 409, `${mengReplied}`);
    assert.equal(e.code, 'not_ready');
    assert.deepEqual(await pairDoc(d), before);
    assert.equal((await movedRows(d)).length, 0);
    assert.equal((await view(d, SOPAL)).canStartLevel3, false);
    assert.equal((await view(d, MENG)).otherCanStartLevel3, false);
  }
  // Her own 5 not sent yet (only his): nothing of hers has a reply.
  const d = await world();
  d.collection('thirtyda_sets').docs.splice(d.collection('thirtyda_sets').docs.findIndex((s) => s._id === 'S-3'), 1);
  assert.equal((await refusal(start(d))).code, 'not_ready');
  assert.equal((await pairDoc(d)).stage, 'l2_open');
});

test('Meng cannot do it: 403 not_starter, nothing changes; someone outside the conversation: 404', async () => {
  const d = await world();
  const before = await pairDoc(d);
  const e = await refusal(start(d, MENG));
  assert.equal(e.status, 403);
  assert.equal(e.code, 'not_starter');
  assert.deepEqual(await pairDoc(d), before);
  assert.equal((await movedRows(d)).length, 0);
  assert.equal((await refusal(start(d, 'U-5'))).status, 404);
});

test('only while Level 2 is open: 409 not_open at Level 1, while Level 2 waits, at the choice, at Level 3, once ended', async () => {
  for (const stage of ['l1', 'l2_wait', 'l3_decide', 'l3_open', 'ended']) {
    const d = await world({ stage });
    const before = await pairDoc(d);
    const e = await refusal(start(d));
    assert.equal(e.status, 409, stage);
    assert.equal(e.code, 'not_open', stage);
    assert.deepEqual(await pairDoc(d), before, `${stage}: nothing changes`);
    assert.equal((await movedRows(d)).length, 0, stage);
  }
  // Meng at a wrong stage: still "not yours" first.
  const d = await world({ stage: 'l3_decide' });
  assert.equal((await refusal(start(d, MENG))).status, 403);
});

test('a double tap moves it once: two sent together, then a third', async () => {
  const d = await world();
  const both = await Promise.allSettled([start(d), start(d)]);
  assert.ok(both.some((r) => r.status === 'fulfilled'), 'at least one answers with the conversation');
  for (const r of both) {
    if (r.status === 'fulfilled') {
      assert.equal(r.value.conversation.pair.stage, 'l3_decide');
      assert.equal(r.value.conversation.decision.mine, true);
    } else {
      assert.equal(r.reason.code, 'not_open');
    }
  }
  const p = await pairDoc(d);
  assert.equal(p.stage, 'l3_decide');
  assert.equal((await movedRows(d)).length, 1, 'noted once');
  // A tap after it moved: 409, and her choice stays as it was.
  const e = await refusal(start(d));
  assert.equal(e.code, 'not_open');
  assert.deepEqual((await pairDoc(d)).decisions, p.decisions);
  assert.equal((await movedRows(d)).length, 1);
});

// ---------------------------------------------------------------- frozen pairs never move

test('a frozen pair stays: Meng blocked by the admin, or one of them blocked the other → 409 other_blocked', async () => {
  const blockedByAdmin = await world({ users: { [MENG]: { blocked: true } } });
  const blockedByOne = await world();
  await addBlock(blockedByOne.collection(BLOCKS), MENG, SOPAL);
  for (const d of [blockedByAdmin, blockedByOne]) {
    const before = await pairDoc(d);
    const e = await refusal(start(d));
    assert.equal(e.status, 409);
    assert.equal(e.code, 'other_blocked');
    assert.deepEqual(await pairDoc(d), before, 'stage, choices and levels as they were');
    assert.equal((await movedRows(d)).length, 0);
    const c = await view(d, SOPAL);
    assert.equal(c.canStartLevel3, false, 'no button on a frozen pair');
    assert.equal(c.otherCanStartLevel3, false);
  }
});

test('a block that lands while she moves on: the move is undone (Level 2 open, no choice, no claim, nothing noted)', async () => {
  for (const block of [
    (d) => addBlock(d.collection(BLOCKS), MENG, SOPAL), // Meng blocks Sopal
    (d) => d.collection('thirtyda_users').updateOne({ _id: MENG }, { $set: { blocked: true } }), // the admin blocks Meng
  ]) {
    const d = await world();
    const before = await pairDoc(d);
    const pairs = d.collection('thirtyda_pairs');
    const update = pairs.updateOne;
    pairs.updateOne = async (q, u, o) => {
      const r = await update(q, u, o);
      if (u.$set?.l3StartedBy) await block(d);
      return r;
    };
    const e = await refusal(start(d));
    pairs.updateOne = update;
    assert.equal(e.status, 409);
    assert.equal(e.code, 'other_blocked', 'answered like any write on a frozen pair');
    const p = await pairDoc(d);
    assert.equal(p.stage, 'l2_open', 'a frozen pair does not move');
    assert.deepEqual(p.decisions, before.decisions, 'no choice recorded');
    assert.equal(p.updatedAt, before.updatedAt);
    assert.equal('l3StartedBy' in p, false, 'the claim is undone');
    assert.deepEqual(p, before);
    assert.equal((await movedRows(d)).length, 0, 'nothing noted');
    assert.equal(await levelOf(d, SOPAL), 2);
  }
  // Once the block is lifted she may move on again.
  const d = await world();
  const pairs = d.collection('thirtyda_pairs');
  const update = pairs.updateOne;
  pairs.updateOne = async (q, u, o) => {
    const r = await update(q, u, o);
    if (u.$set?.l3StartedBy) await addBlock(d.collection(BLOCKS), MENG, SOPAL);
    return r;
  };
  await refusal(start(d));
  pairs.updateOne = update;
  d.collection(BLOCKS).docs.splice(0);
  assert.equal((await view(d, SOPAL)).canStartLevel3, true);
  assert.equal((await start(d)).conversation.pair.stage, 'l3_decide');
  assert.equal((await movedRows(d)).length, 1);
});

// ---------------------------------------------------------------- the conversation says who may move on

test('canStartLevel3 only for the starter once all 5 of hers are replied; otherCanStartLevel3 only for Meng', async () => {
  const d = await world();
  const a = await view(d, SOPAL);
  const b = await view(d, MENG);
  assert.deepEqual([a.canStartLevel3, a.otherCanStartLevel3], [true, false]);
  assert.deepEqual([b.canStartLevel3, b.otherCanStartLevel3], [false, true]);
  assert.equal(a.next, 'wait_them', 'Sopal: "Waiting for Meng\'s 5 lines"');
  assert.equal(b.next, 'send', 'Meng: his 5 still to send');
  assert.equal(a.canStartLevel2, false);
  // Not yet (4 of 5 replied), and never at another stage.
  const early = await world({ mengReplied: 4 });
  for (const id of [SOPAL, MENG]) {
    const c = await view(early, id);
    assert.deepEqual([c.canStartLevel3, c.otherCanStartLevel3], [false, false], id);
  }
  for (const stage of ['l1', 'l2_wait', 'l3_decide', 'l3_open', 'ended']) {
    const w = await world({ stage });
    for (const id of [SOPAL, MENG]) {
      const c = await view(w, id);
      assert.deepEqual([c.canStartLevel3, c.otherCanStartLevel3], [false, false], `${stage} ${id}`);
    }
  }
});

test('App review accounts work the same, among themselves only', async () => {
  const d = await world();
  assert.equal((await view(d, 'U-3', 'P-2')).canStartLevel3, true);
  assert.equal((await refusal(start(d, 'U-4', 'P-2'))).code, 'not_starter');
  const r = await start(d, 'U-3', 'P-2');
  assert.equal(r.conversation.pair.stage, 'l3_decide');
  assert.equal((await pairDoc(d)).stage, 'l2_open', 'the real conversation is untouched');
  assert.equal((await decide(d, 'U-4', true, 'P-2')).conversation.pair.stage, 'l3_open');
  assert.equal((await refusal(start(d, 'U-5', 'P-2'))).status, 404);
});

// ---------------------------------------------------------------- the gates

test('the route: POST only, locked by the PIN like the rest, waits for "I agree", and talks to someone (verify to chat)', () => {
  const path = '/pairs/P-1/level3/start';
  assert.ok(API_ROUTES.some((r) => r.method === 'POST' && r.re.test(path)));
  assert.equal(API_ROUTES.some((r) => r.method === 'GET' && r.re.test(path)), false);
  assert.equal(API_ROUTES.some((r) => r.method === 'POST' && r.re.test('/pairs/P-1/level3/start/x')), false);
  assert.equal(whileLocked('POST', path), null, '423 while locked');
  assert.equal(termsFree('POST', path), false, '403 terms_needed before "I agree"');
  assert.equal(talksToSomeone('POST', path), true, '403 verify_needed without a verified way');
  assert.ok(TALK_ROUTES.some(([m, re]) => m === 'POST' && re.test(path)));
  assert.equal(TALK_ROUTES.length, 10, '+ "Go to Level 3 now"');
  assert.equal(OPEN_WRITES.some(([m, re]) => m === 'POST' && re.test(path)), false);
  const src = readFileSync(new URL('./thirtyda-app.mjs', import.meta.url), 'utf8');
  const i = src.indexOf('async function startLevel3(');
  const body = src.slice(i, src.indexOf('\n}\n', i));
  assert.match(body, /await pairFor\(ctx, params\[0\], \{ write: true \}\)/, 'frozen → 409 like the other pair actions');
  assert.match(body, /\{ _id: pair\._id, a: me\._id, stage: "l2_open", l3StartedBy: \{ \$exists: false \} \}/,
    'while Level 2 is open, by the starter, claimed once');
  assert.match(body, /\{ \$set: \{ stage: "l3_decide", decisions: \{ \[me\._id\]: \{ open: true, at \} \}, l3StartedBy: me\._id, updatedAt: at \} \}/);
  assert.match(body, /if \(!setComplete\(mine\)\) throw fail\(409, "not_ready"/);
  assert.ok(body.indexOf('throw fail(409, "other_blocked"') < body.indexOf('appendMessages('), 'no note for a move a block refused');
  assert.match(src, /\["POST", \/\^\\\/pairs\\\/\(P-\\d\+\)\\\/level3\\\/start\$\/, startLevel3\]/);
});

// ---------------------------------------------------------------- the screen

test('the "<name> moved on to Level 3" toast reads the server right: Meng after Sopal moved on, never the usual finish or Sopal', async () => {
  // The screen's announce() condition (asserted in the source below), on the conversations the server gives.
  const movedToast = (prev, next) => prev.pair?.stage !== 'l3_decide' && next.pair?.stage === 'l3_decide'
    && prev.pair?.stage === 'l2_open' && Boolean(next.decision?.canDecide)
    && !(next.levels || []).find((x) => x?.level === 2)?.mine?.completedAt;
  // Meng had not sent his 5 (his send panel open): told.
  {
    const d = await world();
    const before = await view(d, MENG);
    const mine = await view(d, SOPAL);
    const r = await start(d);
    assert.equal(movedToast(before, await view(d, MENG)), true, 'Meng: his 5 not sent');
    assert.equal(movedToast(mine, r.conversation), false, 'Sopal: she chose it herself');
  }
  // Meng had sent his 5, Sopal replied to 2 of them: told.
  {
    const d = await world({ mengSent: true, sopalReplied: 2 });
    const before = await view(d, MENG);
    await start(d);
    assert.equal(movedToast(before, await view(d, MENG)), true, 'Meng: his 5 not all replied');
  }
  // The usual finish, his own set completed last (her 5th reply to his lines): not told — "Level 2 is done" is true.
  {
    const d = await world({ mengSent: true, sopalReplied: 4 });
    const before = await view(d, MENG);
    assert.equal(before.levels[1].mine.completedAt, null, 'his set was not complete just before');
    await call(d, 'saveReply', SOPAL, ['P-1'], { level: 2, n: 5, text: 'cats' });
    const after = await view(d, MENG);
    assert.equal(after.pair.stage, 'l3_decide');
    assert.equal(movedToast(before, after), false);
  }
});

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

test('the screen: "Go to Level 3 now" where Sopal waits for Meng\'s 5, a line for Meng, in 5 languages', () => {
  const conv = read('screens/conversation.js');
  assert.match(conv, /const canJump = \(\) => !chatMode && conv\.canStartLevel3 === true && !frozen\(\) && !ended\(\);/);
  // The button, with what it means under it, stands under the status line whenever the server says she may.
  const j0 = conv.indexOf('  function withJump(row) {');
  const withJump = conv.slice(j0, conv.indexOf('\n  }\n', j0));
  assert.match(withJump, /if \(!canJump\(\)\) return row;/);
  assert.match(withJump, /row,\n\s+jumpButton\(\),\n\s+el\('p', \{ class: 'conv-l3-hint', id: 'cv-l3-hint' \}, t\('cv_l3_hint', \{ name: name\(\) \}\)\)/);
  // …in the "Waiting for Meng's 5 lines" foot (Meng replied to all of hers, his own 5 not sent: the owner's case)…
  const w0 = conv.indexOf("} else if (kind === 'wait') {");
  const waitFoot = conv.slice(w0, conv.indexOf('} else {', w0 + 40));
  assert.match(waitFoot, /foot\.replaceChildren\(withJump\(statusRow\('clock', text\)\)\);/);
  // …and in the "Your turn: reply to Meng" foot (his 5 came first and wait for her replies): canStartLevel3 is true there
  // too, and Meng reads "Sopal can move on to Level 3 sooner." — the screen keeps that promise, and the button stays
  // when his 5 arrive while she waits.
  const r0 = conv.indexOf("} else if (kind === 'reply') {");
  const replyFoot = conv.slice(r0, w0);
  assert.ok(r0 > 0 && r0 < w0);
  assert.match(replyFoot, /foot\.replaceChildren\(withJump\(statusRow\('chat', t\('cv_turn_reply', \{ name: name\(\), n: done, total \}\), show\)\)\);/);
  assert.equal([...conv.matchAll(/withJump\(statusRow\(/g)].length, 2, 'both feet, nowhere else');
  assert.match(conv, /\(kind === 'wait' \|\| kind === 'reply'\) && canJump\(\), jumping\]\);/, 'the foot repaints when it may / while it goes');
  assert.match(conv, /await api\.post\(`\$\{base\}\/level3\/start`, \{\}\)/);
  assert.match(conv, /apply\(unwrap\(r\)\); \/\/ "You chose to open the chat — waiting for <name>"/);
  assert.match(conv, /if \(!alive \|\| jumping\) return;/, 'one request at a time');
  const s0 = conv.indexOf('async function startLevel3(');
  const startFn = conv.slice(s0, conv.indexOf('\n  }\n', s0));
  assert.match(startFn, /if \(redirected\(err\)\) \{\n\s+if \(err\.code === 'verify_needed'\) renderFoot\(\);/);
  // Meng's line, at the end of the history.
  assert.match(conv, /if \(!chatMode && conv\.otherCanStartLevel3 === true && !frozen\(\) && !ended\(\)\) \{/);
  assert.match(conv, /t\('cv_l3_sooner', \{ name: name\(\) \}\)/);
  assert.match(conv, /c\.otherCanStartLevel3,\n\s+\]\);/, 'the history repaints when it changes');
  // When Sopal moved on before Meng's own Level 2 was done, his screen (his send panel too) swaps to the choice with a
  // toast that says why — not on the usual finish of Level 2 (his own set complete then), and not for Sopal (she chose).
  const a0 = conv.indexOf('  function announce(prev, next) {');
  const announce = conv.slice(a0, conv.indexOf('\n  }\n', a0));
  const toDecide = announce.slice(0, announce.indexOf('return;'));
  assert.match(toDecide, /if \(prev\.pair\?\.stage !== 'l3_decide' && next\.pair\?\.stage === 'l3_decide'\) \{/);
  assert.match(toDecide, /const mine2 = \(next\.levels \|\| \[\]\)\.find\(\(x\) => x\?\.level === 2\)\?\.mine;/);
  assert.match(toDecide,
    /if \(prev\.pair\?\.stage === 'l2_open' && next\.decision\?\.canDecide && !mine2\?\.completedAt\) toast\(t\('cv_l3_moved', \{ name: name\(\) \}\)\);/);
  // A finished Level 2 never says "Waiting" under a line that will not get a reply any more.
  assert.match(conv, /: ended\(\) \|\| levelOf\(s\.level\)\?\.state === 'done' \? null : el\('span', \{ class: 'conv-pending' \}/);
  // Khmer (and the rest) only through t().
  assert.equal(/[ក-៿]/.test(conv.slice(0, conv.lastIndexOf('registerStrings({'))), false, 'no Khmer outside the strings');
  for (const lang of LANGS) {
    const s = stringsOf(conv, lang);
    assert.ok(s.cv_l3_now?.includes('3'), `${lang}.cv_l3_now`);
    assert.ok(s.cv_l3_hint?.includes('{name}'), `${lang}.cv_l3_hint`);
    assert.ok(s.cv_l3_sooner?.includes('{name}') && s.cv_l3_sooner.includes('3'), `${lang}.cv_l3_sooner`);
    assert.ok(s.cv_l3_moved?.includes('{name}') && s.cv_l3_moved.includes('3'), `${lang}.cv_l3_moved`);
  }
  assert.equal(stringsOf(conv, 'en').cv_l3_moved, '{name} moved on to Level 3. Choose now.');
  assert.equal(stringsOf(conv, 'en').cv_l3_now, 'Go to Level 3 now');
  assert.equal(stringsOf(conv, 'en').cv_l3_hint, 'This says yes to the chat. {name} still chooses.');
  assert.equal(stringsOf(conv, 'en').cv_l3_sooner, '{name} can move on to Level 3 sooner.');
  assert.match(stringsOf(conv, 'km').cv_l3_now, /^ទៅកម្រិត 3/);
  const css = read('app.css');
  for (const sel of ['.conv-l3 {', '.conv-l3-go {', '.conv-l3-hint {', '.conv-l3-note {']) assert.ok(css.includes(`\n${sel}`), sel);
  // The design board answers it like the server.
  const demo = read('board/demo.js');
  assert.match(demo, /\['POST', \/\^\\\/pairs\\\/\(P-\\d\+\)\\\/level3\\\/start\$\/, startLevel3\]/);
  assert.match(demo, /canStartLevel3: l3Ready && pair\.a === u\.id,/);
  assert.match(demo, /otherCanStartLevel3: l3Ready && pair\.a !== u\.id,/);
  assert.match(demo, /Object\.assign\(pair, \{ stage: 'l3_decide', decisions: \{ \[u\.id\]: \{ open: true, at \} \}, l3StartedBy: u\.id, updatedAt: at \}\);/);
  // …and its other person lets the button show: at Level 2 when I started, all 5 of mine get a reply before their own 5.
  assert.match(demo, /const holdOwn = lvl === 2 && pair\.a === u\.id;\n\s+if \(!theirs && \(!mine \|\| \(replied >= 2 && !holdOwn\) \|\| mine\.completedAt\)\) \{/);
});
