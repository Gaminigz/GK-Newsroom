// Run: npm run 30da:test (or node --test src/lib/thirtyda-blocks.test.mjs)
// Block + report (store policy, owner 2026-10-14): src/lib/thirtyda-blocks.mjs (the store, both ways, only my own
// blocks listed, the admin's flags) and src/thirtyda-app/shared/safety.js (reasons, what a report points at).
// In-memory collections: no database, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCKS, blockId, blockedIds, blockedBetween, addBlock, removeBlock, myBlocks, blockFlag, reportFlag, blockFlagKey,
  reportFlagKey, resolveUpdate, reopenUpdate,
} from './thirtyda-blocks.mjs';
import { API_ROUTES } from './thirtyda-app.mjs';
import {
  PERSON_REPORT_REASONS, CHAT_REPORT_REASONS, REPORT_LABELS, reportTarget, parseReportTarget, targetLabel,
} from '../thirtyda-app/shared/safety.js';
import { reasonWithoutNames, minimalFlag } from './thirtyda-delete.mjs';

// ---------------------------------------------------------------- a tiny collection

const eq = (v, want) => (Array.isArray(v) ? v.includes(want) : v === want);
function matches(doc, q) {
  return Object.entries(q || {}).every(([k, cond]) => {
    if (k === '$or') return cond.some((c) => matches(doc, c));
    if (cond && typeof cond === 'object' && '$in' in cond) return cond.$in.some((w) => eq(doc[k], w));
    return eq(doc[k], cond);
  });
}
function coll(rows = []) {
  const docs = new Map(rows.map((r) => [r._id, { ...r }]));
  const all = (q) => [...docs.values()].filter((x) => matches(x, q));
  return {
    docs,
    find: (q) => ({ toArray: async () => all(q).map((x) => ({ ...x })) }),
    findOne: async (q) => { const x = all(q)[0]; return x ? { ...x } : null; },
    async updateOne(q, u, { upsert = false } = {}) {
      const x = all(q)[0];
      if (x) return { matchedCount: 1, upsertedCount: 0 };
      if (!upsert) return { matchedCount: 0, upsertedCount: 0 };
      docs.set(q._id, { _id: q._id, ...u.$setOnInsert });
      return { matchedCount: 0, upsertedCount: 1 };
    },
    async deleteMany(q) { const xs = all(q); xs.forEach((x) => docs.delete(x._id)); return { deletedCount: xs.length }; },
  };
}

const ANN = 'U-10001';
const BEA = 'U-10002';
const CY = 'U-10003';

// ---------------------------------------------------------------- the store

test('a block works both ways: each side sees the other as blocked, nobody else is touched', async () => {
  const blocks = coll();
  assert.equal(BLOCKS, 'thirtyda_blocks');
  assert.deepEqual(await addBlock(blocks, ANN, BEA, 't1'), { created: true, at: 't1' });
  assert.deepEqual([...await blockedIds(blocks, ANN)], [BEA]);
  assert.deepEqual([...await blockedIds(blocks, BEA)], [ANN], 'Bea is hidden from Ann AND Ann from Bea');
  assert.deepEqual([...await blockedIds(blocks, CY)], []);
  assert.equal(await blockedBetween(blocks, ANN, BEA), true);
  assert.equal(await blockedBetween(blocks, BEA, ANN), true);
  assert.equal(await blockedBetween(blocks, ANN, CY), false);
  assert.equal(await blockedBetween(blocks, ANN, ANN), false);
  assert.equal(await blockedBetween(blocks, ANN, null), false);
  assert.deepEqual([...await blockedIds(blocks, null)], []);
});

test('addBlock is idempotent and keeps the first time; only the one who blocked can lift it', async () => {
  const blocks = coll();
  await addBlock(blocks, ANN, BEA, 't1');
  assert.deepEqual(await addBlock(blocks, ANN, BEA, 't2'), { created: false, at: 't1' });
  assert.equal(blocks.docs.size, 1);
  assert.deepEqual(blocks.docs.get(blockId(ANN, BEA)), { _id: `${ANN}|${BEA}`, by: ANN, who: BEA, at: 't1' });
  assert.equal(await removeBlock(blocks, BEA, ANN), false, 'Bea cannot lift Ann\'s block');
  assert.equal(await blockedBetween(blocks, ANN, BEA), true);
  // Both blocked each other: Ann lifting hers leaves Bea's.
  await addBlock(blocks, BEA, ANN, 't3');
  assert.equal(await removeBlock(blocks, ANN, BEA), true);
  assert.equal(await blockedBetween(blocks, ANN, BEA), true, 'Bea\'s own block still stands');
  assert.equal(await removeBlock(blocks, BEA, ANN), true);
  assert.equal(await blockedBetween(blocks, ANN, BEA), false);
  assert.equal(await removeBlock(blocks, BEA, ANN), false, 'nothing left to lift');
});

test('myBlocks: only the people I blocked (never who blocked me), newest first, someone gone is left out', async () => {
  const blocks = coll();
  const users = coll([{ _id: BEA, name: 'Bea' }, { _id: CY, name: 'Cy' }, { _id: ANN, name: 'Ann' }]);
  await addBlock(blocks, ANN, BEA, '2026-10-14T01:00:00.000Z');
  await addBlock(blocks, ANN, CY, '2026-10-14T02:00:00.000Z');
  await addBlock(blocks, ANN, 'U-19999', '2026-10-14T03:00:00.000Z'); // deleted since
  await addBlock(blocks, BEA, ANN, '2026-10-14T04:00:00.000Z');
  assert.deepEqual(await myBlocks(blocks, users, ANN), [
    { id: CY, name: 'Cy', at: '2026-10-14T02:00:00.000Z' },
    { id: BEA, name: 'Bea', at: '2026-10-14T01:00:00.000Z' },
  ]);
  assert.deepEqual((await myBlocks(blocks, users, BEA)).map((x) => x.id), [ANN], 'Bea sees her own block only');
  assert.deepEqual(await myBlocks(blocks, users, CY), [], 'Cy never learns Ann blocked him');
});

// ---------------------------------------------------------------- the admin's flags

test('a block flag: about who was blocked, by whom, no names, one open per block', () => {
  const f = blockFlag({ id: 'f7', by: ANN, who: BEA, at: 't', chatId: 'P-3' });
  assert.deepEqual(f, {
    _id: 'f7', id: 'f7', chatId: 'P-3', from: BEA, to: ANN, at: 't', reason: 'Blocked in the app', kind: 'blocked', status: 'open',
    warned: false, key: blockFlagKey(ANN, BEA),
  });
  assert.equal(blockFlag({ id: 'f8', by: ANN, who: BEA, at: 't' }).chatId, null);
  assert.notEqual(blockFlagKey(ANN, BEA), blockFlagKey(BEA, ANN));
});

test('a report flag: "Reported by <name> · <label>" like a chat report, the target, one open per reporter + person + target', () => {
  const f = reportFlag({
    id: 'f9', by: ANN, byName: 'Ann', who: BEA, at: 't', label: REPORT_LABELS.fake, target: 'photo:2', extra: { photoId: 'x', slot: 3 },
  });
  assert.deepEqual(f, {
    _id: 'f9', id: 'f9', chatId: null, from: BEA, to: ANN, at: 't', reason: 'Reported by Ann · fake profile', kind: 'reported',
    status: 'open', warned: false, target: 'photo:2', photoId: 'x', slot: 3, key: reportFlagKey(ANN, BEA, 'photo:2'),
  });
  assert.notEqual(reportFlagKey(ANN, BEA, 'profile'), reportFlagKey(ANN, BEA, 'photo:1'), 'each target its own flag');
  assert.equal(reasonWithoutNames(f), 'Reported · fake profile', 'a deleted account takes the name out (thirtyda-delete.mjs)');
  const kept = minimalFlag({ ...f, resolvedAt: 'r', resolvedAction: 'dismissed' }, BEA);
  assert.deepEqual([kept.target, kept.resolvedAt, kept.resolvedAction, kept.photoId, kept.key], ['photo:2', 'r', 'dismissed', undefined, undefined]);
  // Names with the separator in them still lose only the name part.
  assert.equal(reasonWithoutNames(reportFlag({ id: 'f', by: ANN, byName: 'A · B', who: BEA, at: 't', label: 'rude', target: 'profile' })), 'Reported · rude');
});

test('closing a flag writes resolvedAt + resolvedAction and drops the open key; Undo opens it again', () => {
  assert.deepEqual(resolveUpdate('dismissed', 't'), { $set: { status: 'dismissed', resolvedAt: 't', resolvedAction: 'dismissed' }, $unset: { key: '' } });
  assert.deepEqual(resolveUpdate('unblocked', 't', 'withdrawn'), { $set: { status: 'withdrawn', resolvedAt: 't', resolvedAction: 'unblocked' }, $unset: { key: '' } });
  assert.deepEqual(reopenUpdate(), { $set: { status: 'open' }, $unset: { resolvedAt: '', resolvedAction: '' } });
});

// ---------------------------------------------------------------- the rules (shared/safety.js)

test('reasons: the person report has all six, the chat report gained "underage"; every reason has the admin\'s words', () => {
  assert.deepEqual([...PERSON_REPORT_REASONS], ['rude', 'sexual', 'scam', 'underage', 'fake', 'other']);
  assert.deepEqual([...CHAT_REPORT_REASONS], ['rude', 'scam', 'sexual', 'underage', 'other']);
  for (const r of new Set([...PERSON_REPORT_REASONS, ...CHAT_REPORT_REASONS])) assert.equal(typeof REPORT_LABELS[r], 'string', r);
  assert.ok(Object.isFrozen(PERSON_REPORT_REASONS) && Object.isFrozen(CHAT_REPORT_REASONS));
});

test('report targets: profile, photo 1–4, a line of a set, a typed reply to a line; anything else is refused', () => {
  assert.equal(reportTarget.profile(), 'profile');
  assert.equal(reportTarget.photo(2), 'photo:2');
  assert.equal(reportTarget.line('S-12', 3), 'line:S-12/3');
  assert.deepEqual(parseReportTarget('profile'), { kind: 'profile' });
  assert.deepEqual(parseReportTarget(reportTarget.photo(4)), { kind: 'photo', n: 4 });
  assert.deepEqual(parseReportTarget(reportTarget.line('S-12', 3)), { kind: 'line', setId: 'S-12', n: 3 });
  // A reply they typed to line 3 of a set I sent them (typed replies, owner 2026-10-14).
  assert.equal(reportTarget.reply('S-12', 3), 'reply:S-12/3');
  assert.deepEqual(parseReportTarget(reportTarget.reply('S-12', 3)), { kind: 'reply', setId: 'S-12', n: 3 });
  for (const bad of ['', 'Profile', 'photo:0', 'photo:5', 'photo:12', 'photo:-1', 'photo:1x', 'line:S-1/0', 'line:S-1/10', 'line:P-1/2',
    'line:S-/2', 'line:S-1/2/3', 'line:S-1', 'chat:M-1', ' profile', null, undefined, 3, {}, ['profile'],
    'reply:S-1/0', 'reply:S-1/10', 'reply:P-1/2', 'reply:S-1', 'replies:S-1/2', 'Reply:S-1/2']) {
    assert.equal(parseReportTarget(bad), null, String(bad));
  }
  assert.equal(targetLabel('profile'), 'Profile');
  assert.equal(targetLabel('photo:2'), 'Photo 2');
  assert.equal(targetLabel('line:S-9/4'), 'Line 4');
  assert.equal(targetLabel('reply:S-9/4'), 'Reply to line 4');
  assert.equal(targetLabel('nope'), '');
});

test('the routes are real: block, unblock, my blocks, report', () => {
  for (const [method, path] of [['POST', '/people/U-1/block'], ['DELETE', '/people/U-1/block'], ['GET', '/me/blocks'], ['POST', '/people/U-1/report']]) {
    assert.ok(API_ROUTES.some((r) => r.method === method && r.re.test(path)), `${method} ${path}`);
  }
  assert.equal(API_ROUTES.some((r) => r.method === 'GET' && r.re.test('/people/U-1/block')), false, 'nobody can ask who blocked whom');
});
