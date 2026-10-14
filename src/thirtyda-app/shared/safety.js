// 30+DA, blocking and reporting (store policy, owner 2026-10-14: Apple 1.2 / Google Play UGC — a user must be able to
// block another user and report what they see, in the app). Imported by the server AND served to the browser
// unchanged, so: plain ES module, no Node imports, no DOM, and no regex lookbehind (older iOS Safari cannot parse it).
//
//  - Block (POST /people/:id/block): from then on the two never see each other — not on Nearby, not the profile, not a
//    photo — and a conversation between them is frozen and left out of both lists. Only the person who blocked can lift
//    it (the "Blocked people" list on Me: DELETE /people/:id/block). Each block is also a flag for the admin.
//  - Report (POST /people/:id/report { reason, target }): a profile, one of its photos, a line the other person wrote
//    in a conversation, or a reply they typed to one of my lines (typed since 2026-10-14); a Level 3 chat line keeps
//    its own report (POST /pairs/:id/messages/:mid/report).

import { PHOTO_MAX } from './rules.js';

/** Why a profile, a photo or a written line is reported (the order the sheet lists them in). */
export const PERSON_REPORT_REASONS = Object.freeze(['rude', 'sexual', 'scam', 'underage', 'fake', 'other']);
/** Why a Level 3 chat line is reported. */
export const CHAT_REPORT_REASONS = Object.freeze(['rude', 'scam', 'sexual', 'underage', 'other']);
/** The admin's words for a reason (the admin pages are English only). */
export const REPORT_LABELS = Object.freeze({
  rude: 'rude', sexual: 'sexual or nudity', scam: 'scam or money', underage: 'underage (a minor)', fake: 'fake profile', other: 'other',
});

/** What a report points at, as the API takes it: 'profile' | 'photo:2' | 'line:S-12/3' | 'reply:S-12/3'. */
export const reportTarget = Object.freeze({
  profile: () => 'profile',
  /** n = 1-based place among the photos the reporter can see (GET /people's `photos`, in that order). */
  photo: (n) => `photo:${n}`,
  /** One line of a set of 5 the other person sent me (its set id and line number). */
  line: (setId, n) => `line:${setId}/${n}`,
  /** Their typed reply to one line of a set I sent them (its set id and line number). */
  reply: (setId, n) => `reply:${setId}/${n}`,
});

const PHOTO_RE = /^photo:(\d)$/;
const LINE_RE = /^(line|reply):(S-\d{1,12})\/(\d)$/;

/**
 * 'profile' → { kind:'profile' }; 'photo:n' → { kind:'photo', n }; 'line:S-12/3' → { kind:'line', setId, n };
 * 'reply:S-12/3' → { kind:'reply', setId, n }; else null.
 */
export function parseReportTarget(raw) {
  const s = typeof raw === 'string' ? raw : '';
  if (s === 'profile') return { kind: 'profile' };
  let m = PHOTO_RE.exec(s);
  if (m) {
    const n = Number(m[1]);
    return n >= 1 && n <= PHOTO_MAX ? { kind: 'photo', n } : null;
  }
  m = LINE_RE.exec(s);
  if (m) {
    const n = Number(m[3]);
    return n >= 1 ? { kind: m[1], setId: m[2], n } : null;
  }
  return null;
}

/** "Profile", "Photo 2", "Line 3", "Reply to line 3" (the admin queue), or '' for something that is not a target. */
export function targetLabel(raw) {
  const t = parseReportTarget(raw);
  if (!t) return '';
  if (t.kind === 'profile') return 'Profile';
  if (t.kind === 'reply') return `Reply to line ${t.n}`;
  return t.kind === 'photo' ? `Photo ${t.n}` : `Line ${t.n}`;
}
