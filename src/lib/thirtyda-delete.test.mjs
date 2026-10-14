// Run: npm run 30da:test (or node --test src/lib/thirtyda-delete.test.mjs)
// "Delete my account" (src/lib/thirtyda-delete.mjs): every collection that holds a person's data is covered (read from
// the code itself), a whole world loses everything of the person and nothing of anyone else, every pair with them ends
// as 'left' (a draft the other never saw goes), flags keep only ids / reason / time, the run is idempotent, a crash half
// way leaves no way in and is finished later, and the route's gates (Origin, PIN, blocked, rate limit).
// In-memory Mongo stand-in: no database, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  COVERAGE, NOT_COLLECTIONS, USERS, SESSIONS, OTPS, PAIRS, SETS, CHATS, FLAGS, AUDIT, RESUME_AFTER_MS, DELETE_PER_PROFILE,
  handlesOf, pairOutcome, endPairUpdate, reasonWithoutNames, minimalFlag, deleteAccount, resumeDeletions, deleteMe,
  finishDeletesInBackground, expireUnverified, expireUnverifiedInBackground, EXPIRE_EVERY_MS,
} from './thirtyda-delete.mjs';
import { SIGNUP_DEVICES } from './thirtyda-verify.mjs';
import { VERIFY_KEEP_MS } from '../thirtyda-app/shared/visitor.js';
import { APP_TICKETS } from './thirtyda-signin.mjs';
import { TG_CHECKS, TG_LINKS } from './thirtyda-telegram-bot.mjs';
import { SUPPORT, SUPPORT_CHATS } from './thirtyda-support.mjs';
import { BLOCKS } from './thirtyda-blocks.mjs';

// ---------------------------------------------------------------- an in-memory Mongo, just enough

const get = (doc, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc);
const val = (v) => (v instanceof Date ? v.getTime() : v);
const same = (a, b) => val(a) === val(b);
/** Mongo's equality: a field holding an array matches when any element does; null matches a missing field. */
const eq = (v, want) => (want === null ? v == null : Array.isArray(v) ? v.some((x) => same(x, want)) || same(v, want) : same(v, want));
function matches(doc, q) {
  for (const [k, cond] of Object.entries(q || {})) {
    if (k === '$or') { if (!cond.some((c) => matches(doc, c))) return false; continue; }
    const v = get(doc, k);
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond) && Object.keys(cond).some((x) => x.startsWith('$'))) {
      for (const [op, want] of Object.entries(cond)) {
        if (op === '$exists' && (v !== undefined) !== want) return false;
        if (op === '$lt' && !(v != null && val(v) < val(want))) return false;
        if (op === '$gt' && !(v != null && val(v) > val(want))) return false;
        if (op === '$ne' && eq(v, want)) return false;
        if (op === '$in' && !want.some((w) => eq(v, w))) return false;
      }
    } else if (!eq(v, cond)) return false;
  }
  return true;
}
function setPath(doc, path, value) {
  const keys = path.split('.');
  let o = doc;
  for (const k of keys.slice(0, -1)) o = (o[k] ??= {});
  o[keys.at(-1)] = structuredClone(value);
}
function unsetPath(doc, path) {
  const keys = path.split('.');
  let o = doc;
  for (const k of keys.slice(0, -1)) { o = o?.[k]; if (o == null) return; }
  delete o[keys.at(-1)];
}
function apply(doc, u, inserting) {
  for (const [k, v] of Object.entries(u.$set || {})) setPath(doc, k, v);
  if (inserting) for (const [k, v] of Object.entries(u.$setOnInsert || {})) setPath(doc, k, v);
  for (const k of Object.keys(u.$unset || {})) unsetPath(doc, k);
  for (const [k, cond] of Object.entries(u.$pull || {})) {
    const list = get(doc, k);
    if (Array.isArray(list)) setPath(doc, k, list.filter((x) => !matches(x, cond)));
  }
  for (const [k, v] of Object.entries(u.$push || {})) setPath(doc, k, [...(get(doc, k) || []), v]);
}
function fakeDb() {
  const cols = new Map();
  let seq = 0;
  const hooks = { before: null }; // before(name, op, args): a request "in flight" can write in the middle of a delete
  const collection = (name) => {
    if (!cols.has(name)) {
      const docs = new Map();
      const all = (q) => [...docs.values()].filter((x) => matches(x, q));
      const hook = async (op, ...args) => { if (hooks.before) await hooks.before(name, op, args); };
      cols.set(name, {
        docs,
        async findOne(q) { await hook('findOne', q); const x = all(q)[0]; return x ? structuredClone(x) : null; },
        find(q) {
          let limit = Infinity;
          const cur = { limit(n) { limit = n; return cur; }, sort() { return cur; }, async toArray() { await hook('find', q); return all(q).slice(0, limit).map((x) => structuredClone(x)); } };
          return cur;
        },
        async insertOne(doc) {
          await hook('insertOne', doc);
          const id = doc._id ?? `oid${++seq}`;
          if (docs.has(id)) throw Object.assign(new Error('dup'), { code: 11000 });
          docs.set(id, structuredClone({ ...doc, _id: id }));
          return { insertedId: id };
        },
        async updateOne(q, u, opts = {}) {
          await hook('updateOne', q, u);
          const x = all(q)[0];
          if (!x && opts.upsert) {
            const plain = Object.fromEntries(Object.entries(q).filter(([k, v]) => !k.startsWith('$') && (v == null || typeof v !== 'object' || v instanceof Date)));
            const d = { _id: plain._id ?? `oid${++seq}`, ...plain };
            apply(d, u, true);
            docs.set(d._id, d);
            return { matchedCount: 0, upsertedCount: 1 };
          }
          if (!x) return { matchedCount: 0, modifiedCount: 0 };
          apply(x, u, false);
          return { matchedCount: 1, modifiedCount: 1 };
        },
        async updateMany(q, u) { await hook('updateMany', q, u); const xs = all(q); xs.forEach((x) => apply(x, u, false)); return { matchedCount: xs.length }; },
        async replaceOne(q, doc) {
          await hook('replaceOne', q, doc);
          const x = all(q)[0];
          if (!x) return { matchedCount: 0 };
          docs.set(x._id, structuredClone({ ...doc, _id: x._id }));
          return { matchedCount: 1 };
        },
        async deleteMany(q) { await hook('deleteMany', q); const xs = all(q); xs.forEach((x) => docs.delete(x._id)); return { deletedCount: xs.length }; },
        async findOneAndDelete(q) { await hook('findOneAndDelete', q); const x = all(q)[0]; if (!x) return null; docs.delete(x._id); return structuredClone(x); },
      });
    }
    return cols.get(name);
  };
  const dump = () => Object.fromEntries([...cols].map(([n, c]) => [n, [...c.docs.values()].map((x) => structuredClone(x))]));
  return { collection, cols, hooks, dump, docs: (name) => [...collection(name).docs.values()] };
}

/** The photo store: ids that exist; deletePhoto removes one (already gone = fine, like the real one). */
function fakePhotos(ids) {
  const store = new Set(ids);
  return { store, deletePhoto: async (id) => { store.delete(id); } };
}

const pid = (n) => String(n).padStart(32, 'a');
const A = 'U-10001';
const B = 'U-10002';
const C = 'U-10003';
const D = 'U-10004';
const E = 'U-10005';
const A_PHONE = '+85512000111';
const A_TYPED = '+85512000999'; // an older unverified number kept on the profile (the real profile has one or the other)
const A_GOOGLE = 'g-sub-ann-000111';
const A_PHOTOS = [pid(1), null, pid(3)];
const B_PHOTO = pid(2);
const PIN_HASH = 'scrypt$16384$8$1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';

/** A whole small world around Ann (A): her talks with B, C, D, E, flags both ways, support, Telegram, sign-ins. */
async function world() {
  const d = fakeDb();
  const ins = (name, docs) => Promise.all(docs.map((x) => d.collection(name).insertOne(x)));
  await ins(USERS, [
    {
      _id: A, id: A, name: 'Ann', realName: 'Ann Example', birthYear: 1980, phone: A_PHONE, phoneUnverified: A_TYPED, phoneVia: 'telegram',
      verified: { phone: true, gmail: true, facebook: false, tiktok: false }, signin: { google: { id: A_GOOGLE, email: 'ann@example.com' } },
      photos: A_PHOTOS, location: { type: 'Point', coordinates: [104.9, 11.55] }, locOffset: [0.3, 0.1], pinHash: PIN_HASH, pinTries: 1,
      blocked: false, notices: [], level: 3,
    },
    { _id: B, id: B, name: 'Bee', realName: 'Bee Person', phone: '+85512000222', photos: [B_PHOTO], blocked: false, verified: { phone: true } },
    { _id: C, id: C, name: 'Cee', phone: '+85512000333', photos: [], blocked: false },
    { _id: D, id: D, name: 'Dee', phone: '+85512000444', photos: [], blocked: false },
    { _id: E, id: E, name: 'Eee', phone: '+85512000555', photos: [], blocked: false },
  ]);
  await ins(SESSIONS, [
    { _id: 's-a1', userId: A, phone: A_PHONE }, { _id: 's-a2', userId: A, phone: null },
    { _id: 's-pending-phone', userId: null, phone: A_PHONE, phoneVerified: true },
    { _id: 's-pending-google', userId: null, phone: null, signin: { google: { id: A_GOOGLE } } },
    { _id: 's-b', userId: B, phone: '+85512000222' },
    { _id: 's-other-pending', userId: null, phone: '+85599000000' },
  ]);
  await ins(OTPS, [{ _id: A_PHONE, codeHash: 'x' }, { _id: '+85512000222', codeHash: 'y' }]);
  await ins(TG_CHECKS, [{ _id: 'c1', phone: A_PHONE, state: 'waiting', pinHash: 'z' }, { _id: 'c2', phone: '+85512000222', state: 'used' }]);
  await ins(TG_LINKS, [{ _id: 7001, phone: A_PHONE }, { _id: 7002, phone: '+85512000222' }]);
  await ins(APP_TICKETS, [{ _id: 't1', provider: 'google', person: { id: A_GOOGLE } }, { _id: 't2', provider: 'google', person: { id: 'someone-else' } }]);
  await ins(PAIRS, [
    // A ↔ B: in the chat (Level 3), A wrote last, both chose to open, A asked to be reminded.
    { _id: 'P-1', key: `${A}|${B}`, a: A, b: B, members: [A, B], stage: 'l3_open', level: 3, startedAt: 't', opened: { [A]: 't' },
      decisions: { [A]: { open: true }, [B]: { open: true } }, remind: { [A]: true, [B]: false }, lastChat: { from: A, at: 't' }, updatedAt: 'old' },
    // A → C: A's draft, nothing sent, C never opened it (C never knew).
    { _id: 'P-2', key: `${A}|${C}`, a: A, b: C, members: [A, C], stage: 'l1', startedAt: null, opened: { [A]: 't' } },
    // D → A: D's draft that D opened (D knows A): it ends for D.
    { _id: 'P-3', key: `${A}|${D}`, a: D, b: A, members: [D, A], stage: 'l1', startedAt: null, opened: { [D]: 't' } },
    // A ↔ E: ended earlier ("Forget it"): it keeps when it ended.
    { _id: 'P-4', key: `${A}|${E}`, a: E, b: A, members: [E, A], stage: 'ended', level: 2, startedAt: 't', endedAt: '2026-10-01T00:00:00.000Z', endedBy: E, updatedAt: 'old4' },
    // C ↔ D: nothing to do with A.
    { _id: 'P-5', key: `${C}|${D}`, a: C, b: D, members: [C, D], stage: 'l1', startedAt: 't' },
  ]);
  await ins(SETS, [
    { _id: 'S-1', pairId: 'P-1', level: 1, from: A, to: B, questions: [{ n: 1, text: 'Ann asks' }], answers: [{ n: 1, key: 'yes' }], completedAt: 't' },
    { _id: 'S-2', pairId: 'P-1', level: 1, from: B, to: A, questions: [{ n: 1, text: 'Bee asks' }], answers: [{ n: 1, key: 'no', lang: 'en' }], completedAt: 't' },
    { _id: 'S-3', pairId: 'P-5', level: 1, from: C, to: D, questions: [{ n: 1, text: 'Cee asks' }], answers: [{ n: 1, key: 'yes' }], completedAt: 't' },
  ]);
  await ins(CHATS, [
    { _id: 'P-1', id: 'P-1', a: A, b: B, level: 3, messages: [
      { id: 'M-1', from: A, kind: 'question', text: 'Ann asks' },
      { id: 'M-2', from: B, kind: 'question', text: 'Bee asks' },
      { id: 'M-3', from: null, kind: 'decision', text: 'Both chose to open the chat' },
      { id: 'M-4', from: A, kind: 'chat', text: 'Ann writes 0129 stopped', stopped: true, flagId: 'f1' },
      { id: 'M-5', from: B, kind: 'chat', text: 'Bee writes back to you', flagId: 'f3' },
    ] },
    { _id: 'P-2', id: 'P-2', a: A, b: C, level: 1, messages: [{ id: 'M-6', from: A, kind: 'question', text: 'stopped in a draft', stopped: true }] },
    { _id: 'P-5', id: 'P-5', a: C, b: D, level: 1, messages: [{ id: 'M-7', from: C, kind: 'question', text: 'Cee asks' }] },
  ]);
  await ins(FLAGS, [
    { _id: 'f1', id: 'f1', chatId: 'P-1', from: A, to: B, at: 't1', reason: 'Contact details shared', kind: 'stopped', status: 'open', warned: false, note: 'Ann typed 0129' },
    { _id: 'f2', id: 'f2', chatId: 'P-1', from: A, to: B, at: 't2', reason: 'Reported by Bee · rude message', kind: 'reported', status: 'open', warned: true },
    { _id: 'f3', id: 'f3', chatId: 'P-1', from: B, to: A, at: 't3', reason: 'Reported by Ann · scam or money', kind: 'reported', status: 'open', warned: false },
    { _id: 'f4', id: 'f4', chatId: 'P-5', from: C, to: D, at: 't4', reason: 'Reported by Dee · other', kind: 'reported', status: 'open', warned: false },
  ]);
  await ins(SUPPORT, [
    { _id: 'in:1:1', chatId: 1, dir: 'in', text: 'help me', profileId: A, from: { name: 'Telegram first name' } },
    { _id: 'in:2:1', chatId: 2, dir: 'in', text: 'hello', profileId: B, from: { name: 'Bee TG' } },
  ]);
  await ins(SUPPORT_CHATS, [{ _id: 1, profileId: A, lastText: 'help me' }, { _id: 2, profileId: B, lastText: 'hello' }]);
  await ins(AUDIT, [{ _id: 'au1', action: 'block_user', user: B }]);
  const photos = fakePhotos([pid(1), pid(3), B_PHOTO]);
  return { d, photos };
}

const ANN_TRACES = [A_PHONE, A_TYPED, A_GOOGLE, 'Ann', 'ann@example.com', pid(1), pid(3), PIN_HASH];

/** Everything still in the world that would tell who Ann was (her id may stay, as an id). */
function traces(d) {
  const raw = JSON.stringify(d.dump());
  return ANN_TRACES.filter((x) => raw.includes(x));
}

// ---------------------------------------------------------------- coverage, read from the code

test('every thirtyda_* collection in the code is covered (deleted, changed, or said to hold no person)', () => {
  const lib = new URL('./', import.meta.url);
  const scripts = new URL('../scripts/', import.meta.url);
  const files = [
    ...readdirSync(lib).filter((f) => /^thirtyda-.*\.mjs$/.test(f) && !f.endsWith('.test.mjs')).map((f) => new URL(f, lib)),
    ...readdirSync(scripts).filter((f) => /^thirtyda-.*\.mjs$/.test(f)).map((f) => new URL(f, scripts)),
  ];
  const names = new Set();
  for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/["'`](thirtyda_[a-z_]+)/g)) names.add(m[1]);
  assert.ok(names.has('thirtyda_users') && names.has('thirtyda_photos') && names.has('thirtyda_tg_links'), 'the scan finds collections');
  for (const n of names) {
    assert.ok(n in COVERAGE || NOT_COLLECTIONS.includes(n), `${n}: say in COVERAGE what a deleted account does to it`);
  }
  // Every collection with a person's data says what happens to it.
  for (const n of [USERS, SESSIONS, OTPS, PAIRS, SETS, CHATS, FLAGS, AUDIT, TG_CHECKS, TG_LINKS, APP_TICKETS, SUPPORT, SUPPORT_CHATS, 'thirtyda_photos']) {
    assert.equal(typeof COVERAGE[n], 'string', `${n} is handled`);
  }
});

// ---------------------------------------------------------------- the small rules

test('handlesOf: its verified number, sign-in accounts and photos — merged with what a started delete wrote down', () => {
  const h = handlesOf({ phone: '+1', phoneUnverified: '+2', signin: { google: { id: 'g' }, tiktok: { id: 't' } }, photos: [pid(1), null, 'nope'] });
  assert.deepEqual(h, { phones: ['+1'], signins: [{ provider: 'google', id: 'g' }, { provider: 'tiktok', id: 't' }], photos: [pid(1)] },
    'a number typed without a code (phoneUnverified) is never a handle: it proves nothing');
  assert.deepEqual(handlesOf({ phoneUnverified: '+2' }).phones, []);
  const again = handlesOf({ deleting: { phones: ['+1'], signins: [{ provider: 'google', id: 'g' }], photos: [pid(1)] }, photos: [pid(2)] });
  assert.deepEqual(again, { phones: ['+1'], signins: [{ provider: 'google', id: 'g' }], photos: [pid(1), pid(2)] });
  assert.deepEqual(handlesOf(null), { phones: [], signins: [], photos: [] });
});

test('pairOutcome: a draft the other person never opened goes; everything else ends as "left"', () => {
  assert.equal(pairOutcome({ a: A, b: C, members: [A, C], stage: 'l1', startedAt: null, opened: { [A]: 't' } }, A), 'delete');
  assert.equal(pairOutcome({ a: A, b: C, members: [A, C], stage: 'l1_ask', opened: {} }, A), 'delete');
  assert.equal(pairOutcome({ a: D, b: A, members: [D, A], stage: 'l1', startedAt: null, opened: { [D]: 't' } }, A), 'end', 'D opened it: D knows');
  assert.equal(pairOutcome({ a: A, b: B, members: [A, B], stage: 'l1', startedAt: 't' }, A), 'end');
  assert.equal(pairOutcome({ a: A, b: B, members: [A, B], stage: 'ended', startedAt: 't' }, A), 'end');
});

test('endPairUpdate: ended, left, its own keys gone; an ended pair keeps when it ended', () => {
  const u = endPairUpdate({ stage: 'l3_open', lastChat: { from: A } }, A, 'now');
  assert.deepEqual(u.$set, { stage: 'ended', endedReason: 'left', endedAt: 'now', updatedAt: 'now', lastChat: null });
  assert.deepEqual(Object.keys(u.$unset).sort(), [`decisions.${A}`, `opened.${A}`, `remind.${A}`]);
  const kept = endPairUpdate({ stage: 'ended', endedAt: 'then', lastChat: { from: B } }, A, 'now');
  assert.deepEqual(kept.$set, { stage: 'ended', endedReason: 'left', endedAt: 'then' });
});

test('flags: names cut out of the reason, only ids / reason / time / kind / status kept, an open flag about them closed', () => {
  assert.equal(reasonWithoutNames({ kind: 'reported', reason: 'Reported by Ann · scam or money' }), 'Reported · scam or money');
  assert.equal(reasonWithoutNames({ kind: 'reported', reason: 'Reported by A · B · rude message' }), 'Reported · rude message');
  assert.equal(reasonWithoutNames({ kind: 'reported', reason: 'Reported · rude message' }), 'Reported · rude message', 'idempotent');
  assert.equal(reasonWithoutNames({ kind: 'stopped', reason: 'Contact details shared' }), 'Contact details shared');
  const about = minimalFlag({ _id: 'f1', id: 'f1', chatId: 'P-1', from: A, to: B, at: 't', reason: 'Reported by Bee · rude message', kind: 'reported', status: 'open', warned: true, note: 'x', text: 'y' }, A);
  assert.deepEqual(about, { _id: 'f1', id: 'f1', chatId: 'P-1', from: A, to: B, at: 't', reason: 'Reported · rude message', kind: 'reported', status: 'left', warned: true, left: 'from' });
  const by = minimalFlag({ _id: 'f3', from: B, to: A, at: 't', reason: 'Reported by Ann · other', kind: 'reported', status: 'open' }, A);
  assert.equal(by.status, 'open', 'a report BY them about someone else stays open for the team');
  assert.equal(by.reason, 'Reported · other');
  assert.equal(by.left, 'to');
  assert.deepEqual(minimalFlag(about, A), about, 'idempotent');
});

// ---------------------------------------------------------------- the whole world

test('deleteAccount: everything of the person goes, nothing of anyone else; pairs end as "left"; one audit line', async () => {
  const { d, photos } = await world();
  const r = await deleteAccount(d, A, { now: Date.parse('2026-10-13T10:00:00Z'), deletePhoto: photos.deletePhoto });
  assert.equal(r.ok, true);
  assert.equal(r.already, false);

  assert.deepEqual(traces(d), [], 'no number, account, name, email, photo id or PIN hash of hers anywhere');
  assert.deepEqual(d.docs(USERS).map((u) => u._id).sort(), [B, C, D, E], 'the profile is gone, the others are untouched');
  assert.equal(d.docs(USERS).find((u) => u._id === B).name, 'Bee');
  assert.deepEqual(d.docs(SESSIONS).map((s) => s._id).sort(), ['s-b', 's-other-pending'], 'her sessions and her pending sign-ins');
  assert.deepEqual(d.docs(OTPS).map((x) => x._id), ['+85512000222']);
  assert.deepEqual(d.docs(TG_CHECKS).map((x) => x._id), ['c2']);
  assert.deepEqual(d.docs(TG_LINKS).map((x) => x._id), [7002]);
  assert.deepEqual(d.docs(APP_TICKETS).map((x) => x._id), ['t2']);
  assert.deepEqual([...photos.store], [B_PHOTO], 'every photo of hers is deleted from the store');

  const pair = (id) => d.docs(PAIRS).find((p) => p._id === id);
  assert.equal(pair('P-2'), undefined, "her draft C never saw is gone (C never knew)");
  for (const id of ['P-1', 'P-3', 'P-4']) {
    assert.equal(pair(id).stage, 'ended', `${id} ended`);
    assert.equal(pair(id).endedReason, 'left', `${id}: "This person left 30+DA"`);
  }
  assert.deepEqual(pair('P-1').decisions, { [B]: { open: true } }, 'her choice is gone, Bee\'s stays');
  assert.deepEqual(pair('P-1').remind, { [B]: false });
  assert.equal(pair('P-1').lastChat, null, 'her last line is not the last line any more');
  assert.equal(pair('P-1').endedAt, '2026-10-13T10:00:00.000Z');
  assert.equal(pair('P-4').endedAt, '2026-10-01T00:00:00.000Z', 'an ended pair keeps when it ended');
  assert.equal(pair('P-4').updatedAt, 'old4');
  assert.equal(pair('P-5').stage, 'l1', 'C ↔ D untouched');

  assert.deepEqual(d.docs(SETS).map((s) => s._id).sort(), ['S-2', 'S-3'], 'her sets are deleted');
  const s2 = d.docs(SETS).find((s) => s._id === 'S-2');
  assert.deepEqual([s2.answers, s2.completedAt, s2.questions[0].text], [[], null, 'Bee asks'], "Bee's lines stay, Ann's replies go");
  assert.equal(d.docs(SETS).find((s) => s._id === 'S-3').answers.length, 1);

  const chat = (id) => d.docs(CHATS).find((c) => c._id === id);
  assert.deepEqual(chat('P-1').messages.map((m) => m.id), ['M-2', 'M-3', 'M-5'], 'her lines (stopped ones too) are gone from the log');
  assert.equal(chat('P-1').endedReason, 'left');
  assert.equal(chat('P-2'), undefined, "the deleted draft's log goes with it");
  assert.equal(chat('P-5').messages.length, 1);

  const flag = (id) => d.docs(FLAGS).find((f) => f._id === id);
  assert.deepEqual(Object.keys(flag('f1')).sort(), ['_id', 'at', 'chatId', 'from', 'id', 'kind', 'left', 'reason', 'status', 'to', 'warned']);
  assert.equal(flag('f1').status, 'left', 'an open flag about her is closed');
  assert.equal(flag('f1').note, undefined, 'no text kept');
  assert.equal(flag('f2').reason, 'Reported · rude message');
  assert.equal(flag('f3').reason, 'Reported · scam or money', 'her name is cut out of her own report');
  assert.equal(flag('f3').status, 'open', 'her report about Bee stays open for the team');
  assert.equal(flag('f4').reason, 'Reported by Dee · other', 'flags without her are untouched');

  assert.equal(d.docs(SUPPORT).find((m) => m.chatId === 1).profileId, undefined, 'the support thread stays, without the profile');
  assert.equal(d.docs(SUPPORT).find((m) => m.chatId === 1).text, 'help me');
  assert.equal(d.docs(SUPPORT_CHATS).find((c) => c._id === 1).profileId, undefined);
  assert.equal(d.docs(SUPPORT).find((m) => m.chatId === 2).profileId, B);

  const lines = d.docs(AUDIT).filter((x) => x.action === 'account_deleted');
  assert.equal(lines.length, 1);
  assert.deepEqual(Object.keys(lines[0]).sort(), ['_id', 'action', 'at', 'userId'], 'the audit line is { action, userId } (+ the time) only');
  assert.equal(lines[0].userId, A);
});

test('when the other person deletes too, nobody is left to read the conversation: it goes with its log and sets', async () => {
  const { d, photos } = await world();
  await deleteAccount(d, A, { deletePhoto: photos.deletePhoto });
  assert.equal(d.docs(PAIRS).find((p) => p._id === 'P-1')?.endedReason, 'left');
  await deleteAccount(d, B, { deletePhoto: photos.deletePhoto });
  assert.equal(d.docs(PAIRS).some((p) => p._id === 'P-1'), false);
  assert.equal(d.docs(CHATS).some((c) => c._id === 'P-1'), false);
  assert.equal(d.docs(SETS).some((s) => s.pairId === 'P-1'), false);
  assert.deepEqual([...photos.store], [], "Bea's photo goes with her");
  assert.ok(d.docs(PAIRS).some((p) => p._id === 'P-5'), 'others untouched');
});

test('deleteAccount is idempotent: a second run finds nothing to do and changes nothing', async () => {
  const { d, photos } = await world();
  await deleteAccount(d, A, { deletePhoto: photos.deletePhoto });
  const after = JSON.stringify(d.dump());
  const again = await deleteAccount(d, A, { deletePhoto: photos.deletePhoto });
  assert.deepEqual(again, { ok: true, already: true });
  assert.equal(JSON.stringify(d.dump()), after);
});

test('a crash half way: no way in from the first write on, hidden at once; the next delete finishes it', async () => {
  const { d, photos } = await world();
  let crash = true;
  const boom = async (id) => {
    if (crash) throw new Error('the server went down');
    return photos.deletePhoto(id);
  };
  const t0 = Date.parse('2026-10-13T10:00:00Z');
  await assert.rejects(deleteAccount(d, A, { now: t0, deletePhoto: boom }), /went down/);
  const half = d.docs(USERS).find((u) => u._id === A);
  assert.ok(half.deleting?.at, 'marked deleting');
  assert.deepEqual(half.deleting.phones, [A_PHONE], 'what is left to clean is written down (her verified number only)');
  for (const k of ['phone', 'phoneUnverified', 'phoneVia', 'signin', 'pinHash', 'locOffset']) assert.equal(half[k], undefined, `no ${k} on the half-deleted profile`);
  assert.equal(half.blocked, true, 'hidden from everyone at once (and its own sessions meet "blocked")');
  assert.equal(half.location, null, 'off Nearby');
  assert.equal(await d.collection(USERS).findOne({ phone: A_PHONE }), null, 'a sign-in by her number cannot find it');
  assert.equal(await d.collection(USERS).findOne({ 'signin.google.id': A_GOOGLE }), null, 'nor by her Google account');
  assert.deepEqual(d.docs(SESSIONS).filter((s) => s.userId === A).map((s) => s._id).sort(), ['s-a1', 's-a2'],
    'her own sessions stay until the profile is gone: her retry can finish it');
  assert.equal(d.docs(SESSIONS).some((s) => ['s-pending-phone', 's-pending-google'].includes(s._id)), false, 'her pending sign-ins went');

  // Too soon: an in-flight delete is left alone.
  assert.equal(await resumeDeletions(d, { now: t0 + 5e3, deletePhoto: photos.deletePhoto }), 0);
  crash = false;
  assert.equal(await resumeDeletions(d, { now: t0 + RESUME_AFTER_MS + 1, deletePhoto: photos.deletePhoto }), 1);
  assert.deepEqual(traces(d), []);
  assert.equal(d.docs(USERS).some((u) => u._id === A), false);
  assert.equal(d.docs(SESSIONS).some((s) => s.userId === A), false, 'her sessions end once the profile is gone');
  assert.deepEqual([...photos.store], [B_PHOTO]);
  assert.equal(d.docs(AUDIT).filter((x) => x.action === 'account_deleted').length, 1);
});

test('a crash half way: her own retry (POST /me/delete from her session) finishes it at once — no PIN, no wait', async () => {
  const { d, photos } = await world();
  let crash = true;
  const boom = async (id) => {
    if (crash) throw new Error('the database failed');
    return photos.deletePhoto(id);
  };
  const calls = [];
  const me = await d.collection(USERS).findOne({ _id: A });
  await assert.rejects(deleteMe(routeCtx(d, me, { pin: '2580' }), { ...deps(calls, photos), deletePhoto: boom }), /database failed/);
  assert.ok(d.docs(SESSIONS).some((s) => s._id === 's-a1'), 'the session that asked is still there (the app shows "Try again")');
  crash = false;
  // What the router hands the retry: her session's profile, now stripped and marked deleting (its PIN is gone).
  const half = await d.collection(USERS).findOne({ _id: A });
  assert.ok(half.deleting && half.blocked && !half.pinHash);
  const ctx = routeCtx(d, half, { pin: '2580' });
  assert.deepEqual(await deleteMe(ctx, deps(calls, photos)), { ok: true, deleted: true });
  assert.deepEqual(calls, ['2580'], 'the PIN was checked once, on the first try; the retry needs none');
  assert.equal(ctx.headers['Set-Cookie'], 'thirtyda_s=; Max-Age=0');
  assert.deepEqual(traces(d), []);
  assert.equal(d.docs(SESSIONS).some((s) => s.userId === A), false);
  assert.deepEqual([...photos.store], [B_PHOTO]);
});

test('a stop after her sessions ended but before the profile went: the profile is still there, marked, and gets finished', async () => {
  const { d, photos } = await world();
  const t0 = Date.parse('2026-10-13T10:00:00Z');
  d.hooks.before = async (name, op) => { if (name === USERS && op === 'findOneAndDelete') { d.hooks.before = null; throw new Error('the server went down'); } };
  await assert.rejects(deleteAccount(d, A, { now: t0, deletePhoto: photos.deletePhoto }), /went down/);
  assert.equal(d.docs(SESSIONS).some((s) => s.userId === A), false, 'signed out everywhere (her sessions ended last, before the profile)');
  assert.ok(d.docs(USERS).find((u) => u._id === A)?.deleting, 'the profile is still there, marked: the background finds it (no orphan session)');
  assert.equal(await resumeDeletions(d, { now: t0 + RESUME_AFTER_MS + 1, deletePhoto: photos.deletePhoto }), 1);
  assert.deepEqual(traces(d), []);
  assert.equal(d.docs(AUDIT).filter((x) => x.action === 'account_deleted').length, 1, 'still one audit line');
});

test('finishDeletesInBackground: a half-way delete finishes with nobody else deleting; one that keeps failing holds up no other', async () => {
  const { d, photos } = await world();
  const stuck = new Set([pid(1)]); // Ann's first photo cannot be deleted (yet)
  const flaky = async (id) => { if (stuck.has(id)) throw new Error('photo store down'); return photos.deletePhoto(id); };
  const long = Date.now() - 2 * RESUME_AFTER_MS; // both stopped two minutes ago
  await assert.rejects(deleteAccount(d, A, { now: long, deletePhoto: flaky }), /photo store down/);
  // C (no photos) stops half way at its flags step.
  d.hooks.before = async (name, op) => { if (name === FLAGS && op === 'find') { d.hooks.before = null; throw new Error('the server went down'); } };
  await assert.rejects(deleteAccount(d, C, { now: long, deletePhoto: flaky }), /went down/);
  assert.ok(d.docs(USERS).find((u) => u._id === C)?.deleting, 'C stopped half way too');

  const logged = [];
  const error = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  let bg;
  try {
    bg = finishDeletesInBackground(d, { every: 3600e3, deletePhoto: flaky });
    assert.equal(finishDeletesInBackground(d), bg, 'one per process');
    assert.equal(await bg.ran, 1, 'the first round runs at once (server start) and finishes C');
  } finally {
    console.error = error;
    bg?.stop();
  }
  assert.equal(d.docs(USERS).some((u) => u._id === C), false, 'C is gone without anyone else deleting');
  assert.ok(d.docs(USERS).some((u) => u._id === A && u.deleting), 'A, still failing, waits for the next round');
  assert.ok(logged.some((l) => l.includes(A) && l.includes('photo store down')), 'and the failure is logged');

  stuck.clear();
  assert.equal(await resumeDeletions(d, { deletePhoto: flaky }), 1, 'the next round finishes A');
  assert.deepEqual(traces(d), []);
  assert.notEqual(finishDeletesInBackground(d, { every: 3600e3, deletePhoto: flaky }), bg, 'stopped → a new one');
  finishDeletesInBackground(d).stop();
});

test('a number typed without a code proves nothing: deleting that profile leaves the number\'s real owner alone', async () => {
  const { d, photos } = await world();
  const BEE = '+85512000222'; // Bee's verified number (her code, Telegram check and link are in the world)
  const NEW = '+85512000888'; // someone signing up right now, no profile yet
  await d.collection(OTPS).insertOne({ _id: NEW, codeHash: 'pending' });
  await d.collection(TG_CHECKS).insertOne({ _id: 'c-new', phone: NEW, state: 'waiting' });
  await d.collection(TG_LINKS).insertOne({ _id: 7008, phone: NEW });
  await d.collection(SESSIONS).insertOne({ _id: 's-new', userId: null, phone: NEW, phoneVerified: true });
  await d.collection(SESSIONS).insertOne({ _id: 's-bee-2', userId: null, phone: BEE, phoneVerified: true }); // Bee on a 2nd phone
  // Mallory: two unverified profiles (no session needed, no code), each typed someone else's number.
  const M1 = 'U-10066';
  const M2 = 'U-10067';
  await d.collection(USERS).insertOne({ _id: M1, id: M1, name: 'Mal', phoneUnverified: BEE, photos: [], blocked: false });
  await d.collection(USERS).insertOne({ _id: M2, id: M2, name: 'Mal2', phoneUnverified: NEW, photos: [], blocked: false });
  const before = JSON.stringify([OTPS, TG_CHECKS, TG_LINKS].map((c) => d.docs(c)));
  for (const m of [M1, M2]) {
    const me = await d.collection(USERS).findOne({ _id: m });
    assert.deepEqual(await deleteMe(routeCtx(d, me), deps([], photos)), { ok: true, deleted: true });
  }
  assert.equal(JSON.stringify([OTPS, TG_CHECKS, TG_LINKS].map((c) => d.docs(c))), before, 'every code, Telegram check and link stays');
  assert.ok(d.docs(SESSIONS).some((s) => s._id === 's-bee-2'), "Bee's sign-in on her 2nd phone stays");
  assert.ok(d.docs(SESSIONS).some((s) => s._id === 's-new'), "the newcomer's sign-in stays");
  assert.equal(d.docs(USERS).some((u) => [M1, M2].includes(u._id)), false, 'the typed numbers went with the profiles');
  assert.equal(JSON.stringify(d.docs(USERS)).includes(NEW), false);
});

test('an App review account: its own number (kept in reviewWas, the phone is the mock) loses its codes and Telegram links too', async () => {
  const MOCK = '+855100001122';
  const asReview = async (d) => d.collection(USERS).updateOne({ _id: A }, {
    $set: { demo: 'review', phone: MOCK, phoneVia: 'review', reviewWas: { phone: A_PHONE, verifiedPhone: true, phoneVia: 'telegram' } },
  });
  const { d, photos } = await world();
  await asReview(d);
  await d.collection(TG_LINKS).insertOne({ _id: 7011, phone: MOCK });
  await deleteAccount(d, A, { now: Date.parse('2026-10-14T10:00:00Z'), deletePhoto: photos.deletePhoto });
  assert.deepEqual(traces(d), [], 'nothing of hers, her own number included');
  assert.deepEqual(d.docs(OTPS).map((x) => x._id), ['+85512000222']);
  assert.deepEqual(d.docs(TG_CHECKS).map((x) => x._id), ['c2']);
  assert.deepEqual(d.docs(TG_LINKS).map((x) => x._id), [7002], 'her own number\'s link and the mock\'s');

  // Her old number was verified by another profile meanwhile: its code / check / link are that profile's — they stay.
  const other = await world();
  await asReview(other.d);
  await other.d.collection(USERS).updateOne({ _id: C }, { $set: { phone: A_PHONE } });
  await deleteAccount(other.d, A, { now: Date.parse('2026-10-14T10:00:00Z'), deletePhoto: other.photos.deletePhoto });
  assert.ok(other.d.docs(OTPS).some((x) => x._id === A_PHONE), "Cee's code stays");
  assert.ok(other.d.docs(TG_LINKS).some((x) => x._id === 7001), "Cee's Telegram link stays");
});

test('a request in flight that writes during the delete (a new session, a number, a line) is cleaned up too', async () => {
  const { d, photos } = await world();
  let once = true;
  d.hooks.before = async (name, op) => {
    if (once && name === SESSIONS && op === 'deleteMany') {
      once = false;
      d.hooks.before = null;
      // A sign-in that found her before the claim lands now: a fresh session, a number attached, a chat line, a code.
      await d.collection(SESSIONS).insertOne({ _id: 's-late', userId: A, phone: '+85512000777' });
      await d.collection(USERS).updateOne({ _id: A }, { $set: { phone: '+85512000777' } });
      await d.collection(OTPS).insertOne({ _id: '+85512000777', codeHash: 'late' });
      await d.collection(CHATS).updateOne({ _id: 'P-1' }, { $push: { messages: { id: 'M-9', from: A, kind: 'chat', text: 'late line' } } });
      d.hooks.before = null;
    }
  };
  await deleteAccount(d, A, { deletePhoto: photos.deletePhoto });
  assert.equal(d.docs(SESSIONS).some((s) => s.userId === A), false);
  assert.equal(d.docs(OTPS).some((x) => x._id === '+85512000777'), false, "the number added meanwhile is cleaned up after the profile went");
  assert.equal(JSON.stringify(d.dump()).includes('late line'), false);
});

// ---------------------------------------------------------------- the route

class Fail extends Error {
  constructor(status, code, message, extra = {}) { super(message); Object.assign(this, { status, code, extra }); }
}
const fail = (...a) => new Fail(...a);
let ip = 0;
function routeCtx(d, me, { origin = 'https://ecom.ggmt.sg', pin } = {}) {
  return {
    d, me, session: { _id: 's-a1' }, headers: {}, body: pin === undefined ? {} : { pin },
    req: { headers: origin ? { origin } : {}, socket: { remoteAddress: `203.0.113.${(ip++ % 250) + 1}` } },
  };
}
const deps = (calls, photos) => ({
  fail,
  checkPinTry: async (ctx, pin) => {
    calls.push(pin);
    if (pin !== '2580') throw fail(400, 'wrong_pin', 'That PIN is not right.');
  },
  signedOutCookie: () => 'thirtyda_s=; Max-Age=0',
  deletePhoto: photos.deletePhoto,
});

test('POST /me/delete: Origin needed, the PIN checked like the lock screen, then gone and signed out', async () => {
  const { d, photos } = await world();
  const me = await d.collection(USERS).findOne({ _id: A });
  const calls = [];
  await assert.rejects(deleteMe(routeCtx(d, me, { origin: null }), deps(calls, photos)), (e) => e.code === 'bad_origin' && e.status === 403);
  await assert.rejects(deleteMe(routeCtx(d, me), deps(calls, photos)), (e) => e.code === 'invalid' && e.extra.field === 'pin', 'a PIN profile must type it');
  await assert.rejects(deleteMe(routeCtx(d, me, { pin: '1111' }), deps(calls, photos)), (e) => e.code === 'wrong_pin' && e.status === 400);
  assert.deepEqual(calls, ['1111'], 'the wrong PIN went through the lock screen\'s own check (no try limit, the script guard only)');
  assert.ok(d.docs(USERS).some((u) => u._id === A), 'a wrong PIN deletes nothing');
  const ctx = routeCtx(d, me, { pin: '២៥៨០' }); // typed on a Khmer keyboard
  const out = await deleteMe(ctx, deps(calls, photos));
  assert.deepEqual(out, { ok: true, deleted: true });
  assert.equal(calls.at(-1), '2580');
  assert.equal(ctx.headers['Set-Cookie'], 'thirtyda_s=; Max-Age=0', 'the cookie is cleared');
  assert.deepEqual(traces(d), []);
});

test('POST /me/delete: no PIN on the profile → none asked; blocked → refused; a started delete finishes without the PIN', async () => {
  const { d, photos } = await world();
  const calls = [];
  const c = await d.collection(USERS).findOne({ _id: C });
  assert.deepEqual(await deleteMe(routeCtx(d, c), deps(calls, photos)), { ok: true, deleted: true });
  assert.deepEqual(calls, []);
  assert.equal(d.docs(USERS).some((u) => u._id === C), false);

  await d.collection(USERS).updateOne({ _id: D }, { $set: { blocked: true } });
  const blocked = await d.collection(USERS).findOne({ _id: D });
  await assert.rejects(deleteMe(routeCtx(d, blocked), deps(calls, photos)), (e) => e.code === 'blocked' && e.status === 403);
  assert.ok(d.docs(USERS).some((u) => u._id === D), 'never a way round a block');

  await d.collection(USERS).updateOne({ _id: A }, { $set: { deleting: { at: new Date(), phones: [A_PHONE], signins: [], photos: [] }, blocked: true }, $unset: { pinHash: '' } });
  const half = await d.collection(USERS).findOne({ _id: A });
  assert.deepEqual(await deleteMe(routeCtx(d, half), deps(calls, photos)), { ok: true, deleted: true }, 'a retry after a crash finishes it');
  assert.equal(d.docs(USERS).some((u) => u._id === A), false);
});

test('POST /me/delete: rate-limited per profile', async () => {
  const { d, photos } = await world();
  const me = { _id: 'U-99999', pinHash: PIN_HASH };
  const calls = [];
  for (let i = 0; i < DELETE_PER_PROFILE; i++) {
    await assert.rejects(deleteMe(routeCtx(d, me, { pin: '0000' }), deps(calls, photos)), (e) => e.code === 'wrong_pin');
  }
  await assert.rejects(deleteMe(routeCtx(d, me, { pin: '2580' }), deps(calls, photos)), (e) => e.code === 'rate_limited' && e.status === 429);
});

// ---------------------------------------------------------------- the public pages

test('delete-data: in the app (My profile → Delete my account, instant) or by email (30 days), 5 languages; pages link back to #/me', async () => {
  const { deleteDataPage, privacyPage, termsPage, PAGE_STRINGS } = await import('./thirtyda-pages.mjs');
  const appWords = { en: ['My profile', 'Delete my account'], km: ['ប្រវត្តិរូបរបស់ខ្ញុំ', 'លុបគណនីរបស់ខ្ញុំ'], zh: ['我的资料', '删除我的账号'], ko: ['내 프로필', '내 계정 삭제'], ja: ['マイプロフィール', 'アカウントを削除'] };
  for (const lang of ['en', 'km', 'zh', 'ko', 'ja']) {
    const t = PAGE_STRINGS[lang];
    const html = deleteDataPage({ lang });
    assert.ok(html.includes(`<li><b>${t.del_app_k}</b> ${t.del_app}</li>`), `${lang}: the in-app way first`);
    for (const w of appWords[lang]) assert.ok(t.del_app.includes(w), `${lang}: names the app's own "${w}"`);
    assert.ok(html.includes(`<b>${t.del_mail_k}</b>`) && html.includes('mailto:gk.smart@ggmt.sg?subject=') && t.del_step3.includes('30'), `${lang}: or email, within 30 days`);
    for (const page of [html, privacyPage({ lang }), termsPage({ lang })]) {
      assert.ok(page.includes(`<a class="doc-btn" href="/30da/#/me">${t.back_app}</a>`), `${lang}: back to the app`);
    }
    // Google Play: what is kept after a delete, and why, is said — on both pages.
    for (const page of [html, privacyPage({ lang })]) {
      assert.ok(page.includes(`<b>${t.kept_k}</b> ${t.kept}`), `${lang}: says what stays after a delete`);
    }
    assert.ok(t.kept.includes('Telegram'), `${lang}: names the Telegram support chat`);
  }
  assert.match(PAGE_STRINGS.en.del_app, /instant/);
  assert.doesNotMatch(PAGE_STRINGS.en.del_lede, /delete everything/i, 'never "everything" while a bare note stays');
  assert.match(PAGE_STRINGS.en.kept, /report/);
  assert.match(PAGE_STRINGS.en.kept, /safety/);
});

// ---------------------------------------------------------------- never verified: gone after 48 hours (owner 2026-10-14)

const HOUR = 3600e3;
const NONE = { phone: false, gmail: false, facebook: false, tiktok: false };
const T0 = Date.parse('2026-10-16T10:00:00Z');

/** Ann's world plus profiles made without verifying, each in its own case. */
async function unverifiedWorld() {
  const w = await world();
  const { d } = w;
  const u = (id, extra) => ({ _id: id, id, name: id.slice(-3), photos: [], verified: { ...NONE }, blocked: false, createdAt: new Date(T0 - 49 * HOUR), ...extra });
  await Promise.all([
    // Past its 48 hours, never verified, one photo, Bee opened a talk with it: deleted, Bee's talk ends as 'left'.
    u('U-20001', { photos: [pid(7)], phoneUnverified: '+85512000777', verifyBy: new Date(T0 - HOUR) }),
    // Still within its 48 hours.
    u('U-20002', { createdAt: new Date(T0 - 47 * HOUR), verifyBy: new Date(T0 + HOUR) }),
    // Verified (Google) after it was made: the old deadline means nothing now.
    u('U-20003', { verified: { ...NONE, gmail: true }, signin: { google: { id: 'g-20003' } }, verifyBy: new Date(T0 - HOUR) }),
    // Blocked by the admin: left alone (the admin's case).
    u('U-20004', { blocked: true, verifyBy: new Date(T0 - HOUR) }),
    // Made before the rule (no deadline yet): 48 hours from now on.
    u('U-20005', { createdAt: new Date(T0 - 10 * 24 * HOUR) }),
    // No createdAt (older than unverified profiles) and a verified number without the flag: never touched.
    { _id: 'U-20006', id: 'U-20006', name: 'Old', phone: '+85512000666', photos: [], blocked: false },
  ].map((x) => d.collection(USERS).insertOne(x)));
  await d.collection(SESSIONS).insertOne({ _id: 's-20001', userId: 'U-20001', phone: null });
  await d.collection(PAIRS).insertOne({ _id: 'P-20', key: `${B}|U-20001`, a: B, b: 'U-20001', members: [B, 'U-20001'], stage: 'l1', startedAt: 't', opened: { [B]: 't' } });
  w.photos.store.add(pid(7));
  return w;
}

test('expireUnverified: never verified at its deadline → deleted like "Delete my account"; everyone else untouched', async () => {
  assert.equal(VERIFY_KEEP_MS, 48 * HOUR);
  assert.equal(EXPIRE_EVERY_MS, 10 * 60e3);
  const { d, photos } = await unverifiedWorld();
  const before = d.dump();
  assert.equal(await expireUnverified(d, { now: T0, deletePhoto: photos.deletePhoto }), 1);
  const user = (id) => d.docs(USERS).find((x) => x._id === id);
  assert.equal(user('U-20001'), undefined, 'past 48 hours, never verified: gone');
  assert.equal(d.docs(SESSIONS).some((x) => x.userId === 'U-20001'), false, 'and signed out');
  assert.equal(photos.store.has(pid(7)), false, 'its photo too');
  const talk = d.docs(PAIRS).find((p) => p._id === 'P-20');
  assert.equal(talk.stage, 'ended');
  assert.equal(talk.endedReason, 'left', 'Bee reads "This person left 30+DA"');
  const audit = d.docs(AUDIT).filter((x) => x.userId === 'U-20001');
  assert.deepEqual(audit.map((x) => x.action), ['unverified_expired'], 'one audit line, saying why');
  assert.deepEqual(Object.keys(audit[0]).sort(), ['_id', 'action', 'at', 'userId']);
  for (const id of ['U-20002', 'U-20003', 'U-20004', 'U-20006']) {
    assert.deepEqual(user(id), before[USERS].find((x) => x._id === id), `${id} is untouched`);
  }
  assert.equal(user('U-20005').verifyBy.getTime(), T0 + VERIFY_KEEP_MS, 'made before the rule: 48 hours from the first run');
  assert.equal(user('U-20006').verifyBy, undefined, 'no createdAt + a proved number: never given a deadline');
  for (const id of [A, B, C, D, E]) assert.deepEqual(user(id), before[USERS].find((x) => x._id === id), `${id} (verified, older shapes) untouched`);
  // Later runs: each goes at its own deadline — U-20002 an hour on, U-20005 only once its 48 hours are up.
  assert.equal(await expireUnverified(d, { now: T0 + 2 * HOUR, deletePhoto: photos.deletePhoto }), 1, 'U-20002');
  assert.equal(await expireUnverified(d, { now: T0 + VERIFY_KEEP_MS - 1, deletePhoto: photos.deletePhoto }), 0);
  assert.equal(await expireUnverified(d, { now: T0 + VERIFY_KEEP_MS + 1, deletePhoto: photos.deletePhoto }), 1, 'U-20005');
  assert.deepEqual(d.docs(USERS).filter((x) => /^U-2000/.test(x._id)).map((x) => x._id).sort(), ['U-20003', 'U-20004', 'U-20006']);
});

test('expireUnverified: verifying at the very moment of the sweep keeps the profile (the claim checks again)', async () => {
  const { d, photos } = await unverifiedWorld();
  d.hooks.before = async (name, op) => {
    if (name !== USERS || op !== 'updateOne') return;
    d.hooks.before = null;
    const doc = d.collection(USERS).docs.get('U-20001');
    doc.verified.phone = true; // the person's code went through just now
    doc.phone = '+85512000777';
  };
  assert.equal(await expireUnverified(d, { now: T0, deletePhoto: photos.deletePhoto }), 0);
  const kept = d.docs(USERS).find((x) => x._id === 'U-20001');
  assert.ok(kept && !kept.deleting && kept.blocked === false && kept.verified.phone === true, 'kept, not marked, not hidden');
  assert.equal(photos.store.has(pid(7)), true);
  assert.equal(d.docs(AUDIT).some((x) => x.userId === 'U-20001'), false);
  assert.deepEqual(await deleteAccount(d, 'U-20001', { now: T0, onlyIf: { 'verified.phone': { $ne: true } } }), { ok: false, skipped: true });
});

test('expireUnverifiedInBackground: runs at once (server start), one per process, a failure is logged and waits', async () => {
  const { d, photos } = await unverifiedWorld();
  const logged = [];
  const error = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  const realNow = Date.now;
  Date.now = () => T0;
  let bg;
  try {
    const stuck = async (id) => { if (id === pid(7)) throw new Error('photo store down'); return photos.deletePhoto(id); };
    bg = expireUnverifiedInBackground(d, { every: 3600e3, deletePhoto: stuck });
    assert.equal(expireUnverifiedInBackground(d), bg, 'one per process');
    assert.equal(await bg.ran, 0, 'the first round ran at once; its one delete failed');
  } finally {
    Date.now = realNow;
    console.error = error;
    bg?.stop();
  }
  assert.ok(logged.some((l) => l.includes('U-20001') && l.includes('photo store down')), 'the failure is logged');
  assert.ok(d.docs(USERS).find((x) => x._id === 'U-20001')?.deleting, 'marked: resumeDeletions finishes it');
  assert.equal(await resumeDeletions(d, { now: T0 + RESUME_AFTER_MS + 1, deletePhoto: photos.deletePhoto }), 1);
  assert.equal(d.docs(USERS).some((x) => x._id === 'U-20001'), false);
  expireUnverifiedInBackground(d, { every: 3600e3 }).stop();
});

test('the phones that made an unverified profile (hashed ids) hold no person: a delete leaves them, they go after 30 days', () => {
  assert.equal(COVERAGE[SIGNUP_DEVICES], null);
});

// ---------------------------------------------------------------- blocks + reports (store policy, owner 2026-10-14)

test('deleteAccount: every block by her or of her goes; others\' blocks stay; her report flags keep target + what the admin did', async () => {
  const { d, photos } = await world();
  await Promise.all([
    d.collection(BLOCKS).insertOne({ _id: `${A}|${C}`, by: A, who: C, at: 't' }),
    d.collection(BLOCKS).insertOne({ _id: `${D}|${A}`, by: D, who: A, at: 't' }),
    d.collection(BLOCKS).insertOne({ _id: `${B}|${C}`, by: B, who: C, at: 't' }),
    d.collection(FLAGS).insertOne({
      _id: 'f9', id: 'f9', chatId: null, from: A, to: C, at: 't9', reason: 'Reported by Cee · fake profile', kind: 'reported',
      status: 'dismissed', warned: false, target: 'photo:1', photoId: pid(1), slot: 1, resolvedAt: 't10', resolvedAction: 'dismissed',
    }),
    d.collection(FLAGS).insertOne({
      _id: 'f10', id: 'f10', chatId: null, from: E, to: A, at: 't11', reason: 'Blocked in the app', kind: 'blocked', status: 'open',
      warned: false, key: `blocked|${A}|${E}`,
    }),
  ]);
  assert.equal(COVERAGE[BLOCKS].includes('deleted'), true);
  await deleteAccount(d, A, { now: Date.parse('2026-10-14T10:00:00Z'), deletePhoto: photos.deletePhoto });
  assert.deepEqual(d.docs(BLOCKS).map((b) => b._id), [`${B}|${C}`], 'only a block between two other people stays');
  const f9 = d.docs(FLAGS).find((f) => f._id === 'f9');
  assert.deepEqual([f9.target, f9.resolvedAt, f9.resolvedAction, f9.photoId, f9.slot], ['photo:1', 't10', 'dismissed', undefined, undefined],
    'what was reported and what the admin did stay; the photo id goes (the photo is gone)');
  assert.equal(f9.reason, 'Reported · fake profile', 'no name');
  const f10 = d.docs(FLAGS).find((f) => f._id === 'f10');
  assert.equal(f10.key, undefined, 'the open-flag key goes with the minimal record');
  assert.equal(f10.status, 'open', 'a block BY her stays open for the team (about someone else)');
  assert.deepEqual(traces(d), []);
});
