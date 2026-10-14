// node --test src/lib/thirtyda-replies.test.mjs
// Replies saved at the same moment (review 2026-10-14): three PUT /replies to lines 1–3 with "0128", "8776" and "6"
// each pass alone, and together make 012887766. saveReplyInTurn saves them one after another (the set's `rev`), so the
// split check of each sees the others, as it would one after another. In-memory sets: no database, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveReplyInTurn } from './thirtyda-app.mjs';
import { checkReply, findSplitContactDetails } from '../thirtyda-app/shared/rules.js';
import { replyOrders } from '../thirtyda-app/shared/conversation.js';

const ME = 'U-1';
const THEM = 'U-2';
const PAIR = 'P-1';
const SET = 'S-1';
const tick = () => new Promise((r) => setImmediate(r));
const copy = (x) => structuredClone(x);

/**
 * The sets collection, as far as saveReplyInTurn uses it: find({ pairId }).toArray() and findOneAndUpdate with its
 * filter (_id, completedAt: null, the rev it read) and its update (this line's reply replaced, rev + 1). Every call
 * waits a turn first, so saves sent together run side by side.
 */
function fakeSets(docs) {
  const log = [];
  return {
    docs,
    log,
    find: (q) => ({
      toArray: async () => {
        await tick();
        return docs.filter((d) => d.pairId === q.pairId).map(copy);
      },
    }),
    async findOneAndUpdate(filter, pipeline) {
      await tick();
      const doc = docs.find((d) => d._id === filter._id);
      const [rev, read] = filter.$expr.$eq;
      assert.deepEqual(rev, { $ifNull: ['$rev', 0] });
      const set = pipeline[0].$set;
      const n = set.answers.$concatArrays[0].$filter.cond.$ne[1];
      const reply = set.answers.$concatArrays[1][0].$literal;
      if (!doc || doc.completedAt !== filter.completedAt || (doc.rev ?? 0) !== read) {
        log.push(['missed', n, reply.text]);
        return null;
      }
      doc.answers = [...(doc.answers || []).filter((a) => a.n !== n), reply];
      doc.rev = (doc.rev ?? 0) + 1;
      log.push(['saved', n, reply.text]);
      return copy(doc);
    },
  };
}

const storedSet = () => ({
  _id: SET, pairId: PAIR, level: 1, from: THEM, to: ME, sentAt: '2026-10-14T10:00:00.000Z', completedAt: null, answers: [],
  questions: [1, 2, 3, 4, 5].map((n) => ({ n, source: n === 5 ? 'written' : 'system', key: n === 5 ? null : `k${n}`, text: 'Line?' })),
});

/** checkedReply's reading, without the database: the one-reply check, then the split check over the sets as read. */
const check = (n, text) => async (all) => {
  const one = checkReply(text);
  if (!one.ok) throw Object.assign(new Error(one.error), { status: 422 });
  await tick(); // the translation call sits here on the server
  const c = findSplitContactDetails(replyOrders({ sets: all, me: ME, reply: { level: 1, n, text } }));
  if (!c.ok) throw Object.assign(new Error('contact_detail'), { status: 422, split: true, hits: c.hits });
  return { n, key: null, text, lang: 'en', translations: { en: text }, at: `2026-10-14T10:0${n}:00.000Z` };
};

const save = (sets, n, text) => saveReplyInTurn(sets, { pairId: PAIR, setId: SET, n, check: check(n, text) });

test('three replies sent at the same moment are read with each other: the one that makes the number is stopped', async () => {
  for (const pieces of [['0128', '8776', '6'], ['012', '887', '766'], ['零幺两八', '八七七六', '六']]) {
    const sets = fakeSets([storedSet()]);
    const results = await Promise.allSettled(pieces.map((text, i) => save(sets, i + 1, text)));
    const stopped = results.filter((r) => r.status === 'rejected');
    assert.ok(stopped.length >= 1, `${JSON.stringify(pieces)}: one is stopped`);
    for (const r of stopped) assert.equal(r.reason.status, 422, r.reason.message);
    assert.ok(sets.log.some(([what]) => what === 'missed'), 'a save that read an older set did not land');
    // What is kept never reads as the number.
    const kept = sets.docs[0].answers.sort((a, b) => a.n - b.n).map((a) => a.text);
    assert.ok(kept.length < pieces.length, JSON.stringify(kept));
    const again = findSplitContactDetails([kept.map((text) => ({ text, fresh: true }))]);
    assert.equal(again.ok, true, `${JSON.stringify(kept)} is not a number`);
    assert.equal(sets.docs[0].rev, kept.length, 'one rev per save that landed');
  }
});

test('ordinary replies sent at the same moment all land, one after another', async () => {
  const sets = fakeSets([storedSet()]);
  const texts = ['Yes', 'Not today', 'Maybe', 'A bit', 'Sure'];
  const results = await Promise.allSettled(texts.map((text, i) => save(sets, i + 1, text)));
  assert.deepEqual(results.map((r) => r.status), texts.map(() => 'fulfilled'));
  assert.deepEqual(sets.docs[0].answers.sort((a, b) => a.n - b.n).map((a) => a.text), texts);
  assert.equal(sets.docs[0].rev, 5);
});

test('a set completed meanwhile, or one that keeps changing, answers 409', async () => {
  const done = fakeSets([{ ...storedSet(), completedAt: '2026-10-14T11:00:00.000Z' }]);
  await assert.rejects(save(done, 1, 'Yes'), (err) => err.status === 409 && err.code === 'not_your_turn');
  // Someone else always saves in between: after a few tries, 409 busy (the app reloads and the reply can be sent again).
  const busy = fakeSets([storedSet()]);
  const real = busy.findOneAndUpdate.bind(busy);
  busy.findOneAndUpdate = async (filter, pipeline) => {
    busy.docs[0].rev = (busy.docs[0].rev ?? 0) + 1;
    return real(filter, pipeline);
  };
  await assert.rejects(save(busy, 1, 'Yes'), (err) => err.status === 409 && err.code === 'busy');
  assert.equal(busy.docs[0].answers.length, 0);
});
