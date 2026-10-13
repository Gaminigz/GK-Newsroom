// 30+DA conversation state — the one model the server, the app and the board demo share.
//
// Owner's model (Gamini 2026-10-13): Dara can start and send to Sophea; Sophea replies and Dara sees the
// replies above. Sophea can start too and send to Dara, and Dara sees her lines in the same screen.
// Level 2 works the same way. Level 3 is the direct chat, and everything before it stays as plain text.
//
// So Level 1 and Level 2 each have TWO directions: each person sends ONE set of 5 lines per level to the
// other, in any order, and replies to the set they received line by line. A level is done when both
// sets exist and both have all 5 replies; then the next level opens after the wait.
//
// Stored stages: 'l1' (old pairs: 'l1_ask' / 'l1_answer'), 'l2_wait', 'l2_open', 'l3_wait', 'l3_open'.
// Plain ES module: no DOM, no Node.

import { LEVEL_RULES } from './questions.js';

/** The levels that have line sets (Level 3 is the chat). */
export const SET_LEVELS = Object.freeze([1, 2]);

const STAGES = ['l1', 'l2_wait', 'l2_open', 'l3_wait', 'l3_open'];

/** A stored stage as the conversation stage: old 'l1_ask' / 'l1_answer' (and anything unknown) → 'l1'. */
export function convStage(stage) {
  return STAGES.includes(stage) ? stage : 'l1';
}

/** Stored stage values that mean Level 1 is open (for conditional updates on old and new pairs). */
export const L1_STAGES = Object.freeze(['l1', 'l1_ask', 'l1_answer']);

/** The level whose sets can be sent and replied to now: 1 at 'l1', 2 at 'l2_open', otherwise null. */
export function openSetLevel(stage) {
  const s = convStage(stage);
  return s === 'l1' ? 1 : s === 'l2_open' ? 2 : null;
}

/**
 * The level a pair is in for its recap: the open level, or at a wait the level just finished
 * (l2_wait → 1, l3_wait → 2). null at Level 3.
 */
export function currentSetLevel(stage) {
  const s = convStage(stage);
  return s === 'l1' || s === 'l2_wait' ? 1 : s === 'l2_open' || s === 'l3_wait' ? 2 : null;
}

/** The level number a stage belongs to, for the level bar: l1 / l2_wait → 1, l2_open / l3_wait → 2, l3_open → 3. */
export function stageLevel(stage) {
  return currentSetLevel(stage) ?? 3;
}

/**
 * State of a level for a stage: 'open' | 'wait' | 'done' | 'locked'.
 * Level 1 is open from the start; Level 2 waits after Level 1 and opens after the wait; Level 3 = the chat.
 */
export function levelState(level, stage) {
  const s = convStage(stage);
  if (Number(level) === 1) return s === 'l1' ? 'open' : 'done';
  if (Number(level) === 2) {
    if (s === 'l1') return 'locked';
    return s === 'l2_wait' ? 'wait' : s === 'l2_open' ? 'open' : 'done';
  }
  if (Number(level) === 3) return s === 'l3_open' ? 'open' : s === 'l3_wait' ? 'wait' : 'locked';
  return 'locked';
}

/** pick + write of a level (5 lines), or null for a level without sets. */
export function setRules(level) {
  const r = LEVEL_RULES[level];
  return r ? { pick: r.pick, write: r.write } : null;
}

/** How many lines of a set have a reply (one per line, by n). */
export function repliedCount(set) {
  const ns = new Set((set?.questions || []).map((q) => q.n));
  return new Set((set?.answers || []).map((a) => a?.n).filter((n) => ns.has(n))).size;
}

/** Every line of a set has a reply. */
export function allReplied(set) {
  const total = set?.questions?.length ?? 0;
  return total > 0 && repliedCount(set) >= total;
}

/** A set is complete once all its lines have replies (completedAt is set when that happens). */
export const setComplete = (set) => Boolean(set?.completedAt);

/** A level is done when both people have sent their set and both sets are complete. */
export function levelComplete(mine, theirs) {
  return setComplete(mine) && setComplete(theirs);
}

/**
 * One reply put into a set's replies: the reply for line `reply.n` replaced (or added), sorted by n.
 * Pure (a new array); used by the board demo and checked by the tests.
 */
export function withReply(answers, reply) {
  const list = (Array.isArray(answers) ? answers : []).filter((a) => a && a.n !== reply.n);
  return [...list, reply].sort((x, y) => x.n - y.n);
}

/** What I do next (the same in PairView.next and the conversation). */
export const NEXT_STEPS = Object.freeze(['send', 'reply', 'send_reply', 'wait_them', 'wait_timer', 'chat', 'frozen']);

/**
 * What `me` does next. `mine` / `theirs` = the sets of the OPEN level (mine = the one I sent, theirs =
 * the one sent to me), null when not sent. 'send' = I can still send my 5; 'reply' = their set to me has
 * lines without my reply; both → 'send_reply'; neither → 'wait_them'. Waits → 'wait_timer', Level 3 → 'chat'.
 */
export function nextStep({ stage, mine = null, theirs = null, frozen = false }) {
  if (frozen) return 'frozen';
  const s = convStage(stage);
  if (s === 'l3_open') return 'chat';
  if (s === 'l2_wait' || s === 'l3_wait') return 'wait_timer';
  const send = !mine;
  const reply = Boolean(theirs && !theirs.completedAt);
  return send && reply ? 'send_reply' : send ? 'send' : reply ? 'reply' : 'wait_them';
}

/** My turn (red dot, notifications): I can send my set, I have lines to reply to, or the chat's last line is theirs. */
export function isMyTurn(next, lastFrom = null) {
  return next === 'send' || next === 'reply' || next === 'send_reply' || (next === 'chat' && lastFrom === 'them');
}
