// node --test src/thirtyda-app/shared/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SET_LEVELS, convStage, openSetLevel, currentSetLevel, stageLevel, levelState, setRules, repliedCount, allReplied,
  setComplete, levelComplete, withReply, NEXT_STEPS, nextStep, isMyTurn, L1_STAGES,
} from './conversation.js';

const lines = (k = 5) => Array.from({ length: k }, (_, i) => ({ n: i + 1, source: i < 4 ? 'system' : 'written' }));
const set = (replied = 0, done = false) => ({
  questions: lines(), answers: Array.from({ length: replied }, (_, i) => ({ n: i + 1, key: 'yes' })), completedAt: done ? '2026-10-13T00:00:00Z' : null,
});

test('stages: old l1_ask / l1_answer read as l1', () => {
  assert.deepEqual(SET_LEVELS, [1, 2]);
  for (const s of ['l1', 'l1_ask', 'l1_answer', undefined, null, 'nope']) assert.equal(convStage(s), 'l1', String(s));
  for (const s of ['l2_wait', 'l2_open', 'l3_wait', 'l3_open']) assert.equal(convStage(s), s);
  assert.deepEqual([...L1_STAGES].sort(), ['l1', 'l1_answer', 'l1_ask']);
});

test('open level, current level, level bar', () => {
  const rows = [
    // stage, open set level, current set level, level bar
    ['l1_ask', 1, 1, 1], ['l1_answer', 1, 1, 1], ['l1', 1, 1, 1], ['l2_wait', null, 1, 1],
    ['l2_open', 2, 2, 2], ['l3_wait', null, 2, 2], ['l3_open', null, null, 3],
  ];
  for (const [s, open, cur, bar] of rows) {
    assert.equal(openSetLevel(s), open, `open ${s}`);
    assert.equal(currentSetLevel(s), cur, `current ${s}`);
    assert.equal(stageLevel(s), bar, `bar ${s}`);
  }
});

test('levelState: open / wait / done / locked', () => {
  const rows = {
    l1: ['open', 'locked', 'locked'],
    l1_answer: ['open', 'locked', 'locked'],
    l2_wait: ['done', 'wait', 'locked'],
    l2_open: ['done', 'open', 'locked'],
    l3_wait: ['done', 'done', 'wait'],
    l3_open: ['done', 'done', 'open'],
  };
  for (const [s, want] of Object.entries(rows)) assert.deepEqual([1, 2, 3].map((l) => levelState(l, s)), want, s);
  assert.equal(levelState(4, 'l3_open'), 'locked');
});

test('setRules: Level 1 = 4 picked + 1 written, Level 2 = 3 + 2', () => {
  assert.deepEqual(setRules(1), { pick: 4, write: 1 });
  assert.deepEqual(setRules(2), { pick: 3, write: 2 });
  assert.equal(setRules(3), null);
});

test('replies: counted per line, complete with all 5, a level done with both sets complete', () => {
  assert.equal(repliedCount(null), 0);
  assert.equal(repliedCount(set(2)), 2);
  // A reply twice for the same line, or for a line that does not exist, counts once / not at all.
  assert.equal(repliedCount({ questions: lines(), answers: [{ n: 1 }, { n: 1 }, { n: 9 }] }), 1);
  assert.equal(allReplied(set(4)), false);
  assert.equal(allReplied(set(5)), true);
  assert.equal(allReplied({ questions: [], answers: [] }), false);
  assert.equal(setComplete(set(5)), false); // completedAt decides
  assert.equal(setComplete(set(5, true)), true);
  assert.equal(levelComplete(set(5, true), set(5, true)), true);
  assert.equal(levelComplete(set(5, true), null), false); // the other direction is not sent yet
  assert.equal(levelComplete(set(5, true), set(3)), false);
});

test('withReply: replaces the reply of one line, keeps line order, never mutates', () => {
  const before = [{ n: 3, key: 'no' }, { n: 1, key: 'yes' }];
  const after = withReply(before, { n: 3, key: 'maybe' });
  assert.deepEqual(after, [{ n: 1, key: 'yes' }, { n: 3, key: 'maybe' }]);
  assert.deepEqual(before, [{ n: 3, key: 'no' }, { n: 1, key: 'yes' }]);
  assert.deepEqual(withReply(null, { n: 2, key: 'yes' }), [{ n: 2, key: 'yes' }]);
});

test('nextStep: both directions, any order', () => {
  assert.ok(NEXT_STEPS.includes('send_reply'));
  // A new conversation: I can send. Old l1_ask drafts too.
  assert.equal(nextStep({ stage: 'l1' }), 'send');
  assert.equal(nextStep({ stage: 'l1_ask' }), 'send');
  // Dara sent; Sophea has his lines to reply to AND can send her own.
  assert.equal(nextStep({ stage: 'l1', mine: null, theirs: set(0) }), 'send_reply');
  assert.equal(nextStep({ stage: 'l1_answer', mine: null, theirs: set(2) }), 'send_reply'); // old one-way pair
  // Sophea sent hers and is still replying to his.
  assert.equal(nextStep({ stage: 'l1', mine: set(0), theirs: set(3) }), 'reply');
  // Sophea replied to all of his but has not sent hers.
  assert.equal(nextStep({ stage: 'l1', mine: null, theirs: set(5, true) }), 'send');
  // Dara sent and is waiting for her.
  assert.equal(nextStep({ stage: 'l1', mine: set(2), theirs: null }), 'wait_them');
  assert.equal(nextStep({ stage: 'l1', mine: set(5, true), theirs: set(5, true) }), 'wait_them');
  // Level 2 the same.
  assert.equal(nextStep({ stage: 'l2_open', mine: null, theirs: set(1) }), 'send_reply');
  // Waits, chat, frozen.
  assert.equal(nextStep({ stage: 'l2_wait' }), 'wait_timer');
  assert.equal(nextStep({ stage: 'l3_wait' }), 'wait_timer');
  assert.equal(nextStep({ stage: 'l3_open' }), 'chat');
  assert.equal(nextStep({ stage: 'l1', frozen: true }), 'frozen');
});

test('isMyTurn: send, reply, or their chat line last', () => {
  for (const n of ['send', 'reply', 'send_reply']) assert.equal(isMyTurn(n), true, n);
  for (const n of ['wait_them', 'wait_timer', 'frozen']) assert.equal(isMyTurn(n, 'them'), false, n);
  assert.equal(isMyTurn('chat', 'them'), true);
  assert.equal(isMyTurn('chat', 'me'), false);
  assert.equal(isMyTurn('chat', null), false);
});
