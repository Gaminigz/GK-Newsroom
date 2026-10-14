// 30+DA conversation state — the one model the server, the app and the board demo share.
//
// Owner's model (Gamini 2026-10-13): Dara can start and send to Sophea; Sophea replies and Dara sees the
// replies above. Sophea can start too and send to Dara, and Dara sees her lines in the same screen.
// Level 2 works the same way. Level 3 is the direct chat, and everything before it stays as plain text.
//
// So Level 1 and Level 2 each have TWO directions: each person sends ONE set of 5 lines per level to the
// other, in any order, and replies to the set they received line by line (a short typed reply each, 1–10
// characters, at both levels — owner 2026-10-14; the taps before it still read back). A level is done when
// both sets exist and both have all 5 replies. Level 2 opens after a wait.
//
// After Level 2 (owner 2026-10-13: "after these 10 answers the sender can activate Level 3 or forget it"):
// each person chooses "Open the chat" or "Forget it". The chat (Level 3) opens as soon as BOTH chose to
// open it; one "Forget it" ends the conversation for both ('ended': readable history, nothing more to send).
//
// Stored stages: 'l1' (old pairs: 'l1_ask' / 'l1_answer'), 'l2_wait', 'l2_open', 'l3_decide', 'l3_open',
// 'ended'. Old pairs may still say 'l3_wait' (the 24 h wait that came before the choice); the server moves
// them to 'l3_decide' when it reads them. Plain ES module: no DOM, no Node.

import { LEVEL_RULES } from './questions.js';

/** The levels that have line sets (Level 3 is the chat). */
export const SET_LEVELS = Object.freeze([1, 2]);

const STAGES = ['l1', 'l2_wait', 'l2_open', 'l3_wait', 'l3_decide', 'l3_open', 'ended'];

/** After Level 2: each person chooses to open the chat or forget it. */
export const DECIDE_STAGE = 'l3_decide';
/** Someone chose "Forget it": the conversation is over for both (it stays readable). */
export const ENDED_STAGE = 'ended';

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
 * The level a pair is in for its recap: the open level, or the level just finished while waiting or
 * choosing (l2_wait → 1; l3_wait / l3_decide / ended → 2). null at Level 3.
 */
export function currentSetLevel(stage) {
  const s = convStage(stage);
  if (s === 'l1' || s === 'l2_wait') return 1;
  return s === 'l2_open' || s === 'l3_wait' || s === 'l3_decide' || s === 'ended' ? 2 : null;
}

/** The level number a stage belongs to, for the level bar: l1 / l2_wait → 1, l2_open … l3_decide / ended → 2, l3_open → 3. */
export function stageLevel(stage) {
  return currentSetLevel(stage) ?? 3;
}

/**
 * State of a level for a stage: 'open' | 'wait' | 'done' | 'locked', and for Level 3 also 'decide' (the
 * two people are choosing) and 'ended' (one chose "Forget it"). Level 1 is open from the start; Level 2
 * waits after Level 1 and opens after the wait; Level 3 = the chat, open once both chose it.
 */
export function levelState(level, stage) {
  const s = convStage(stage);
  if (Number(level) === 1) return s === 'l1' ? 'open' : 'done';
  if (Number(level) === 2) {
    if (s === 'l1') return 'locked';
    return s === 'l2_wait' ? 'wait' : s === 'l2_open' ? 'open' : 'done';
  }
  if (Number(level) === 3) {
    return { l3_open: 'open', l3_wait: 'wait', l3_decide: 'decide', ended: 'ended' }[s] || 'locked';
  }
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

/** A stored reply that was typed (2026-10-14 on), not one of the old taps (key 'yes' / 'no' / 'not_really' / 'maybe' / 'ok'). */
export const typedReply = (a) => Boolean(a && !a.key && typeof a.text === 'string' && a.text);

const timeOf = (x) => Date.parse(x?.at ?? '') || 0;
const byTime = (x, y) => timeOf(x) - timeOf(y) || (x.level ?? 0) - (y.level ?? 0) || (x.n ?? 0) - (y.n ?? 0);

/**
 * Everything one person wrote in a pair, oldest first: their written lines (in the sets they sent) and their typed
 * replies (in the sets sent to them; a tap was not typed). `sets` as stored ({ level, from, to, sentAt,
 * questions:[{ n, source, text }], answers:[{ n, key, text, at }] }). → [{ kind:'line'|'reply', level, n, text, at }]
 */
export function ownTexts(sets, me) {
  const out = [];
  for (const s of Array.isArray(sets) ? sets : []) {
    if (!s) continue;
    if (s.from === me) {
      for (const q of s.questions || []) {
        if (q?.source === 'written' && q.text) out.push({ kind: 'line', level: s.level, n: q.n, text: String(q.text), at: s.sentAt });
      }
    }
    if (s.to === me) {
      for (const a of s.answers || []) if (typedReply(a)) out.push({ kind: 'reply', level: s.level, n: a.n, text: a.text, at: a.at ?? s.sentAt });
    }
  }
  return out.sort(byTime);
}

/**
 * The orders a new reply is read in together with the rest of what the same person wrote in the pair (owner
 * 2026-10-14: "can not write numbers like a phone or a TG handle … even if they write them vertically or
 * horizontally"), for rules.js findSplitContactDetails:
 *   1. down the screen: their typed replies line by line, Level 1 then Level 2, the new one in its line's place;
 *   2. as typed: their written lines, replies and last chat lines, oldest first, the new one last.
 * The reply it changes (same level and line) is left out of both. reply = { level, n, text }; chat = their recent
 * chat lines [{ text, at }].
 */
export function replyOrders({ sets, me, reply, chat = [] }) {
  const fresh = { kind: 'reply', level: Number(reply.level), n: Number(reply.n), text: reply.text, fresh: true };
  const mine = ownTexts(sets, me).filter((x) => !(x.kind === 'reply' && x.level === fresh.level && x.n === fresh.n));
  const down = [...mine.filter((x) => x.kind === 'reply'), fresh].sort((x, y) => x.level - y.level || x.n - y.n);
  const typed = [...[...mine, ...(Array.isArray(chat) ? chat : []).filter((m) => m?.text)].sort(byTime), fresh];
  const plain = (list) => list.map((x) => ({ text: x.text, fresh: Boolean(x.fresh) }));
  return [plain(down), plain(typed)];
}

/**
 * The written lines of a set about to be sent, read after everything the same person wrote in the pair before
 * (their replies, their earlier lines, their last chat lines): a reply "012" and "887", then a line "766 …".
 * written = the new set's lines in order (null for a picked line); each fresh item's id = its place in that list.
 */
export function writtenOrders({ sets, me, written, chat = [] }) {
  const before = [...ownTexts(sets, me), ...(Array.isArray(chat) ? chat : []).filter((m) => m?.text)].sort(byTime);
  const lines = (written || []).map((text, i) => (text ? { text, fresh: true, id: i } : null)).filter(Boolean);
  return before.length && lines.length ? [[...before.map((x) => ({ text: x.text, fresh: false })), ...lines]] : [];
}

/** What I do next (the same in PairView.next and the conversation). */
export const NEXT_STEPS = Object.freeze(['send', 'reply', 'send_reply', 'wait_them', 'wait_timer', 'decide', 'chat', 'ended', 'frozen']);

/**
 * What `me` does next. `mine` / `theirs` = the sets of the OPEN level (mine = the one I sent, theirs =
 * the one sent to me), null when not sent. 'send' = I can still send my 5; 'reply' = their set to me has
 * lines without my reply; both → 'send_reply'; neither → 'wait_them'. The Level 1 → 2 wait → 'wait_timer'.
 * After Level 2: 'decide' until I chose, then 'wait_them' until they choose too; Level 3 → 'chat';
 * someone chose "Forget it" → 'ended'. `decided` = my choice after Level 2 (true = open, false = forget, null).
 */
export function nextStep({ stage, mine = null, theirs = null, frozen = false, decided = null }) {
  const s = convStage(stage);
  if (s === 'ended') return 'ended';
  if (frozen) return 'frozen';
  if (s === 'l3_open') return 'chat';
  if (s === 'l3_decide') return decided === true ? 'wait_them' : 'decide';
  if (s === 'l2_wait' || s === 'l3_wait') return 'wait_timer';
  const send = !mine;
  const reply = Boolean(theirs && !theirs.completedAt);
  return send && reply ? 'send_reply' : send ? 'send' : reply ? 'reply' : 'wait_them';
}

/**
 * My turn (red dot, notifications): I can send my set, I have lines to reply to, I still have to choose
 * after Level 2, or the chat's last line is theirs. An ended conversation is never my turn.
 */
export function isMyTurn(next, lastFrom = null) {
  return next === 'send' || next === 'reply' || next === 'send_reply' || next === 'decide' || (next === 'chat' && lastFrom === 'them');
}

/** One person's choice after Level 2 from a pair's `decisions` ({ [userId]: { open, at } }): true / false / null. */
export function decisionOf(decisions, userId) {
  const v = decisions?.[userId]?.open;
  return typeof v === 'boolean' ? v : null;
}

/**
 * The stage after the choices so far at 'l3_decide' (`decisions` as stored, `members` = the two ids):
 * 'ended' as soon as either chose "Forget it", 'l3_open' once both chose to open the chat, else 'l3_decide'.
 */
export function afterDecisions(decisions, members) {
  const choices = (members || []).map((id) => decisionOf(decisions, id));
  if (choices.includes(false)) return 'ended';
  return choices.length === 2 && choices.every((c) => c === true) ? 'l3_open' : 'l3_decide';
}
