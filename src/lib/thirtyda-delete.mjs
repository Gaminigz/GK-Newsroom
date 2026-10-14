/**
 * 30+DA "Delete my account" (owner 2026-10-13: "Delete everything"). Google Play and Apple ask a dating app for an
 * account deletion inside the app; the Me page has it (src/thirtyda-app/screens/delete-account.js).
 *
 *   POST /30da/api/me/delete { pin? } → { ok: true, deleted: true } and the session cookie cleared.
 *     Only from the app's own page (an Origin header from this host: the router refuses other sites, this route also
 *     refuses none), only while the app is unlocked (the PIN lock answers 423 first: it is not a whileLocked route),
 *     DELETE_PER_IP per address and DELETE_PER_PROFILE per profile per 15 minutes (429 rate_limited). A profile with a
 *     PIN types it: checked exactly like the lock screen's PIN (the app's checkPinTry: a wrong one is 400 wrong_pin and
 *     the app asks again — no try limit; only the session's script guard, 429 too_many_tries). A blocked
 *     profile cannot delete itself here (403 blocked: it writes to the team, /30da/delete-data) — unless its own delete
 *     already started (the route is blockedOk only for that).
 *
 * What goes, at once (deleteAccount — the order matters, see there):
 *   the profile (thirtyda_users), every photo (thirtyda-photos.mjs: GridFS bucket thirtyda_photos or the local files),
 *   its Sign in with Apple: the sealed refresh token (users.appleRefresh, only with the admin's Apple key) is REVOKED at
 *   Apple while the rest goes (Apple 5.1.1(v); src/lib/thirtyda-apple.mjs revokeAppleFor) — best effort, 5 s, never in the
 *   way of the delete; the result says how it went (deleteAccount → apple: 'revoked' | 'failed' | 'no_key' | 'unreadable'),
 *   every session (thirtyda_user_sessions; also a pending sign-in that carries its verified number or its Google /
 *   Facebook / TikTok account), the sign-in links + phone + phoneUnverified + phoneVia + the PIN (with the profile),
 *   codes for its verified number (thirtyda_otps), Telegram bot checks and links for it (thirtyda_tg_checks,
 *   thirtyda_tg_links), the native apps' sign-in tickets for its accounts (thirtyda_app_tickets), its sets of lines
 *   (thirtyda_sets: deleted) and its replies in the sets sent to it (removed), its lines in every chat log
 *   (thirtyda_chats). A number typed without a code (phoneUnverified) goes with the profile only: it proves nothing, so
 *   rows keyed by it may be someone else's (handlesOf).
 * A delete that stops half way is finished by the person's own retry or, within about two minutes, in the background
 * (finishDeletesInBackground, started with the app).
 * Never verified (owner 2026-10-14): a profile made without verifying that still has no verified way at its users.verifyBy
 * (48 hours after it was made) is deleted the same way by the server itself, at start and every 10 minutes
 * (expireUnverified / expireUnverifiedInBackground; its audit line says 'unverified_expired').
 * What changes for others:
 *   every conversation with it → stage 'ended', endedReason 'left' (the other person reads "This person left 30+DA",
 *   nothing more can be sent; their own lines stay theirs to read). A draft the other person never opened (nothing was
 *   ever sent, they never knew) is deleted instead, so it never surfaces as a conversation they did not have; so is a
 *   conversation whose other person already left (nobody is left to read it).
 *   Flags / reports about it or by it (thirtyda_flags): only the minimal record stays for safety — ids, reason, time,
 *   kind, status (names cut out of the reason; an open flag about it is closed as 'left'), and what a report pointed at
 *   ('profile' | 'photo:n' | 'line:…') and what the admin did. The words and photos they pointed at were its own, gone.
 *   Blocks by it or of it (thirtyda_blocks): deleted.
 *   Support through the Telegram bot (thirtyda_support, thirtyda_support_chats): the link to the profile is dropped;
 *   the Telegram thread itself stays for the team.
 *   The audit log (thirtyda_audit) gets one { action: 'account_deleted', userId } (and the time), nothing else.
 * Not user data (nothing to delete): see COVERAGE.
 *
 * Pure apart from the `d` (Mongo Db) and the photo store handed in, so the unit tests run without a database.
 */

import { deletePhoto as deleteStoredPhoto, isPhotoId } from "./thirtyda-photos.mjs";
import { ACCOUNT_PROVIDERS, APP_TICKETS, SIGNIN_STATES } from "./thirtyda-signin.mjs";
import { APPLE_NONCES, appleRevokeOf, revokeAppleFor } from "./thirtyda-apple.mjs";
import { TG_CHECKS, TG_LINKS, windowLimiter } from "./thirtyda-telegram-bot.mjs";
import { SUPPORT, SUPPORT_CHATS } from "./thirtyda-support.mjs";
import { SIGNUP_LIMITS, SIGNUP_DEVICES, neverVerifiedFilter, verifyByFrom } from "./thirtyda-verify.mjs";
import { PIN_LENGTH, pinDigits } from "./thirtyda-pin.mjs";
import { clientIp } from "./thirtyda-net.mjs";
import { BLOCKS } from "./thirtyda-blocks.mjs";

export const USERS = "thirtyda_users";
export const SESSIONS = "thirtyda_user_sessions";
export const OTPS = "thirtyda_otps";
export const PAIRS = "thirtyda_pairs";
export const SETS = "thirtyda_sets";
export const CHATS = "thirtyda_chats";
export const FLAGS = "thirtyda_flags";
export const AUDIT = "thirtyda_audit";
export const PHOTOS = "thirtyda_photos";

/**
 * Every thirtyda_* collection, and what a deleted account does to it (null: it holds no person's data). The unit test
 * reads the code for collection names and fails on one that is not here, so a new collection is never forgotten.
 */
export const COVERAGE = {
  [USERS]: "the profile: stripped of every way in first, deleted last",
  [SESSIONS]: "every session of the profile (once the profile is gone), and a pending sign-in carrying its verified number or accounts: deleted",
  [OTPS]: "codes sent to its verified number: deleted (never by a number typed without a code)",
  [PAIRS]: "every conversation with it: ended (endedReason 'left'); a draft the other person never opened, or one whose other person already left: deleted",
  [SETS]: "its sets: deleted; its replies in the sets sent to it: removed",
  [CHATS]: "its lines in every chat log: removed (the log of a deleted draft: deleted)",
  [FLAGS]: "flags about it or by it: only ids, reason (no names), time, kind, status",
  [AUDIT]: "one { action: 'account_deleted', userId } (admin entries carry ids only)",
  [PHOTOS]: "every photo: deleted (GridFS, or the local files)",
  [TG_CHECKS]: "Telegram bot checks for its verified number: deleted",
  [TG_LINKS]: "Telegram user ↔ its verified number: deleted",
  [APP_TICKETS]: "the native apps' sign-in tickets for its accounts: deleted",
  [SUPPORT]: "the link to the profile: dropped (the Telegram thread stays for the team)",
  [SUPPORT_CHATS]: "the link to the profile: dropped (the Telegram thread stays for the team)",
  [BLOCKS]: "every block by it or of it: deleted (nobody is left to hide from; its flags keep the minimal record)",
  [SIGNIN_STATES]: null, // a 10-minute state carries no profile; a 'to: me' one that comes back later is a plain new sign-in
  [APPLE_NONCES]: null, // Sign in with Apple's 10-minute nonces: two hashes, no profile
  [SIGNUP_LIMITS]: null, // per address and day (hashed), no profile
  [SIGNUP_DEVICES]: null, // per phone (a one-way hash of its id), no link to any profile; gone after 30 days
  thirtyda_review_devices: null, // App review phones (a one-way hash of the id), no link to any profile; gone when review sign-in goes OFF
  thirtyda_counters: null, // id counters
  thirtyda_questions: null, // the admin's question choices
  thirtyda_settings: null, // the admin's sealed keys
  thirtyda_admin_sessions: null, // the admin's sessions
  thirtyda_test_fetch: null, // the dev DB's stand-in answers for the e2e
  // The GK API Hub, tower 11 · Wan (src/lib/thirtyda-hub-wan.mjs): renders for Yai Media Director, tied to no 30+DA profile.
  // A picture goes when its render is done or failed, a clip 48 h after done, the record 30 days after.
  thirtyda_hub_wan_jobs: null,
  thirtyda_hub_wan: null, // their GridFS bucket (the pictures and clips)
};

/** Names that look like collections but are cookies / browser storage keys. */
export const NOT_COLLECTIONS = ["thirtyda_s", "thirtyda_oauth", "thirtyda_app", "thirtyda_apple", "thirtyda_tg", "thirtyda_admin", "thirtyda_lang", "thirtyda_km", "thirtyda_show"];

export const DELETE_PER_IP = 20; // per address per 15 minutes (loose: many phones behind one NAT address)
export const DELETE_PER_PROFILE = 10; // per profile per 15 minutes (each wrong PIN counts as a lock-screen try anyway)
/**
 * A delete that stopped half way (the server went down) is finished after this long: by finishDeletesInBackground's
 * next round (it runs this often), or by the next delete — sooner by the person's own retry, which needs no wait.
 */
export const RESUME_AFTER_MS = 60e3;

const uniq = (list) => [...new Set(list.filter(Boolean))];

/**
 * The ways into a profile and the things kept only through it: { phones, signins: [{ provider, id }], photos }.
 * Merged with what a delete that already started wrote down (user.deleting), so a retry still knows them.
 * phones = its VERIFIED number only (`phone`): codes, Telegram checks / links and pending sign-ins are deleted by it.
 * Never `phoneUnverified`: anyone can type any number there without a code (Create profile, no session needed), so
 * it proves nothing — deleting by it would wipe another person's pending code, Telegram link or sign-in for that
 * number. It goes with the profile document; an unfinished check for it expires by itself (TTL).
 */
export function handlesOf(user) {
  const was = user?.deleting ?? {};
  const signins = [...(Array.isArray(was.signins) ? was.signins : [])];
  for (const provider of ACCOUNT_PROVIDERS) {
    const id = user?.signin?.[provider]?.id;
    if (id) signins.push({ provider, id: String(id) });
  }
  const seen = new Set();
  return {
    phones: uniq([...(Array.isArray(was.phones) ? was.phones : []), user?.phone].map((p) => (p ? String(p) : null))),
    signins: signins.filter((s) => {
      const key = `${s?.provider}:${s?.id}`;
      if (!ACCOUNT_PROVIDERS.includes(s?.provider) || !s.id || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(({ provider, id }) => ({ provider, id: String(id) })),
    photos: uniq([...(Array.isArray(was.photos) ? was.photos : []), ...(Array.isArray(user?.photos) ? user.photos : [])]).filter(isPhotoId),
  };
}

/** a ∪ b (two handlesOf results). */
export const mergeHandles = (a, b) => handlesOf({ deleting: { phones: [...a.phones, ...b.phones], signins: [...a.signins, ...b.signins], photos: [...a.photos, ...b.photos] } });

/**
 * The first write (one atomic update): the profile is marked `deleting` with every handle written down, and stripped
 * of every way in — no phone, no Google / Facebook / TikTok / Apple link, no PIN — so from here on no sign-in can find it.
 * It is also hidden at once (blocked, no location): nobody sees it on Nearby or its profile, and its conversations are
 * frozen until they are ended a moment later. A session it still has meets only "blocked" (no use of a half-deleted
 * account). Its Sign in with Apple token (sealed) moves into `deleting.apple` with its Apple id, so a delete that stops
 * half way can still revoke it; it goes with the profile.
 */
export function claimUpdate(user, handles, at) {
  const apple = appleRevokeOf(user);
  return {
    $set: {
      deleting: { at: user?.deleting?.at ?? at, ...handles, ...(apple ? { apple } : {}) },
      blocked: true,
      location: null,
      verified: { phone: false, gmail: false, facebook: false, tiktok: false, apple: false },
    },
    $unset: {
      phone: "", phoneUnverified: "", phoneVia: "", signin: "", pinHash: "", pinAt: "", pinTries: "", locOffset: "", locMoves: "", locAt: "",
      appleRefresh: "",
    },
  };
}

/** A pair nothing was ever sent in ('l1_ask', or 'l1' before its first set). */
const isDraft = (pair) => pair?.stage === "l1_ask" || (pair?.stage === "l1" && !pair?.startedAt);
const otherOf = (pair, userId) => (pair.a === userId ? pair.b : pair.b === userId ? pair.a : (pair.members || []).find((m) => m !== userId));

/**
 * What happens to one of its pairs: 'delete' (a draft the other person never opened: they never knew about it) or
 * 'end' (stage 'ended', endedReason 'left').
 */
export function pairOutcome(pair, userId) {
  const other = otherOf(pair, userId);
  return isDraft(pair) && !pair.opened?.[other] ? "delete" : "end";
}

/**
 * The update that ends a pair because `userId` left. Its own keys go (its choice after Level 2, its "Remind me", when it
 * opened the draft); an ended pair keeps when it ended. Idempotent.
 */
export function endPairUpdate(pair, userId, at) {
  const already = pair.stage === "ended";
  return {
    $set: {
      stage: "ended",
      endedReason: "left",
      endedAt: pair.endedAt ?? at,
      ...(already ? {} : { updatedAt: at }),
      ...(pair.lastChat?.from === userId ? { lastChat: null } : {}),
    },
    $unset: { [`decisions.${userId}`]: "", [`remind.${userId}`]: "", [`opened.${userId}`]: "" },
  };
}

/** "Reported by Dara · rude message" → "Reported · rude message": a reason without anyone's name. */
export function reasonWithoutNames(flag) {
  const reason = String(flag?.reason ?? "");
  if (flag?.kind !== "reported" && !/^Reported by /.test(reason)) return reason;
  const label = reason.split(" · ").at(-1);
  return label && label !== reason ? `Reported · ${label}` : "Reported";
}

/**
 * A flag about `userId` (from) or by it (to), cut to the minimal record kept for safety: ids, reason (no names), time,
 * kind, status. An open flag about it is closed ('left'): there is nobody left to warn or block. Idempotent.
 */
export function minimalFlag(flag, userId) {
  const about = flag.from === userId;
  return {
    _id: flag._id,
    id: flag.id ?? flag._id,
    chatId: flag.chatId ?? null,
    from: flag.from ?? null,
    to: flag.to ?? null,
    at: flag.at ?? null,
    reason: reasonWithoutNames(flag),
    kind: flag.kind ?? null,
    status: about && flag.status === "open" ? "left" : flag.status ?? null,
    warned: Boolean(flag.warned),
    left: about ? "from" : "to",
    // What a report pointed at ('profile' | 'photo:n' | 'line:S-12/3': no words, no photo) and what the admin did.
    ...(flag.target ? { target: String(flag.target) } : {}),
    ...(flag.resolvedAt ? { resolvedAt: flag.resolvedAt, resolvedAction: flag.resolvedAction ?? null } : {}),
  };
}

/**
 * Sessions that lead to this person: a sign-in still before Create profile with its (verified) number / accounts, and
 * — only with `own` — the profile's own sessions.
 */
function sessionFilter(userId, h, own) {
  const or = [
    ...(own ? [{ userId }] : []),
    ...(h.phones.length ? [{ userId: null, phone: { $in: h.phones } }] : []),
    ...h.signins.map((s) => ({ userId: null, [`signin.${s.provider}.id`]: s.id })),
  ];
  return or.length ? { $or: or } : null;
}

/**
 * Everything but the profile itself, for `userId` with handles `h`. Every step is safe to run again (and it is: once
 * before the profile goes and once after, for anything a request already in flight wrote meanwhile).
 * `ownSessions`: also end the profile's own sessions. The first pass keeps them: should it stop half way, the person's
 * own session can still send the delete again and finish it (the profile is already stripped and blocked, so that
 * session reaches nothing else); they end only once all the rest is done (deleteAccount step 4).
 */
async function cleanUp(d, userId, h, at, { deletePhoto, ownSessions }) {
  const done = {};
  // Ways in that do not need the profile: pending sign-ins, codes, Telegram checks / links, the apps' tickets.
  const sessions = sessionFilter(userId, h, ownSessions);
  done.sessions = sessions ? (await d.collection(SESSIONS).deleteMany(sessions)).deletedCount ?? 0 : 0;
  if (h.phones.length) {
    done.otps = (await d.collection(OTPS).deleteMany({ _id: { $in: h.phones } })).deletedCount ?? 0;
    done.tgChecks = (await d.collection(TG_CHECKS).deleteMany({ phone: { $in: h.phones } })).deletedCount ?? 0;
    done.tgLinks = (await d.collection(TG_LINKS).deleteMany({ phone: { $in: h.phones } })).deletedCount ?? 0;
  }
  if (h.signins.length) {
    done.tickets = (await d.collection(APP_TICKETS).deleteMany({ $or: h.signins.map((s) => ({ provider: s.provider, "person.id": s.id })) })).deletedCount ?? 0;
  }

  // Conversations: drafts nobody else saw go; every other one ends for the other person ("This person left 30+DA").
  const pairs = await d.collection(PAIRS).find({ $or: [{ members: userId }, { a: userId }, { b: userId }] }).toArray();
  // Both people gone (the other one deleted their account before): nobody is left to read it — it goes.
  const otherIds = pairs.map((p) => otherOf(p, userId)).filter(Boolean);
  const alive = new Set((await d.collection(USERS).find({ _id: { $in: otherIds } }, { projection: { _id: 1 } }).toArray()).map((u) => u._id));
  const outcome = (p) => (alive.has(otherOf(p, userId)) ? pairOutcome(p, userId) : "delete");
  const gone = pairs.filter((p) => outcome(p) === "delete").map((p) => p._id);
  const ended = pairs.filter((p) => outcome(p) === "end");
  if (gone.length) {
    await d.collection(PAIRS).deleteMany({ _id: { $in: gone } });
    await d.collection(SETS).deleteMany({ pairId: { $in: gone } });
    await d.collection(CHATS).deleteMany({ _id: { $in: gone } });
  }
  for (const p of ended) await d.collection(PAIRS).updateOne({ _id: p._id }, endPairUpdate(p, userId, at));
  done.pairsEnded = ended.length;
  done.pairsDeleted = gone.length;

  // Its lines: its sets go (the other person's replies to them with them); its replies to the sets sent to it go.
  done.sets = (await d.collection(SETS).deleteMany({ from: userId })).deletedCount ?? 0;
  await d.collection(SETS).updateMany({ to: userId }, { $set: { answers: [], completedAt: null } });
  // The admin's chat logs: its lines (questions, replies, choices, chat, stopped ones) go; the log notes the end.
  await d.collection(CHATS).updateMany({ $or: [{ a: userId }, { b: userId }] }, { $pull: { messages: { from: userId } } });
  if (ended.length) {
    await d.collection(CHATS).updateMany({ _id: { $in: ended.map((p) => p._id) }, endedAt: { $exists: false } }, { $set: { endedAt: at } });
    await d.collection(CHATS).updateMany({ _id: { $in: ended.map((p) => p._id) } }, { $set: { endedReason: "left" } });
  }

  // Blocks by it or of it (src/lib/thirtyda-blocks.mjs): nobody is left to hide from.
  done.blocks = (await d.collection(BLOCKS).deleteMany({ $or: [{ by: userId }, { who: userId }] })).deletedCount ?? 0;

  // Flags about it / by it: the minimal record only.
  const flags = await d.collection(FLAGS).find({ $or: [{ from: userId }, { to: userId }] }).toArray();
  for (const f of flags) await d.collection(FLAGS).replaceOne({ _id: f._id }, minimalFlag(f, userId));
  done.flags = flags.length;

  // Support: the Telegram thread stays for the team, the link to the profile goes.
  await d.collection(SUPPORT).updateMany({ profileId: userId }, { $unset: { profileId: "" } });
  await d.collection(SUPPORT_CHATS).updateMany({ profileId: userId }, { $unset: { profileId: "" } });

  // Photos (the profile no longer shows them: it is blocked, then gone). Already gone = fine.
  for (const id of h.photos) await deletePhoto(id);
  done.photos = h.photos.length;
  return done;
}

/**
 * Delete everything of profile `userId`, at once. Safe to run again at any point (a retry, or resumeDeletions after the
 * server went down half way), in this order, so a crash never leaves an account anyone can use:
 *   1. claim (one write): marked `deleting` with every handle written down, every way in stripped, hidden (claimUpdate);
 *   2. everything else (cleanUp): pending sign-ins, codes, Telegram, tickets, conversations, sets, chat lines, flags,
 *      support, photos — but not the profile's own sessions yet: if this stops half way, the person's own retry (the
 *      route skips the PIN once `deleting` is set) finishes it; so does finishDeletesInBackground within ~2 minutes;
 *      meanwhile its Sign in with Apple token is revoked at Apple (revokeApple, best effort: an error or a slow Apple
 *      never stops the delete — at most REVOKE_TIMEOUT_MS, 5 s);
 *   3. the audit line (once: an upsert);
 *   4. its own sessions (the person is signed out), then the profile itself;
 *   5. cleanUp again, with anything a request already in flight added meanwhile (a session, a number, a photo, a line).
 * → { ok, already, done, apple? } (already: there was no such profile — done before, or never there; apple: how the Apple
 * revoke went — 'revoked' | 'failed' | 'no_key' | 'unreadable' — only when the profile had a Sign in with Apple token).
 * onlyIf: the claim (step 1) happens only while the profile still matches it — the 48-hour sweep's "still never
 * verified", so a person who verifies at that very moment keeps the profile (→ { ok: false, skipped: true }, nothing
 * changed). action: the audit line's action ('account_deleted'; the sweep's 'unverified_expired').
 */
export async function deleteAccount(d, userId, {
  now = Date.now(), deletePhoto = deleteStoredPhoto, onlyIf = null, action = "account_deleted", revokeApple = revokeAppleFor,
} = {}) {
  const at = new Date(now).toISOString();
  const users = d.collection(USERS);
  const user = await users.findOne({ _id: userId });
  if (!user) {
    // Gone already (steps 1–4 ran): only its sessions (step 5 stopped) or one a request in flight made may be left.
    await d.collection(SESSIONS).deleteMany({ userId });
    return { ok: true, already: true };
  }
  const handles = handlesOf(user);
  // An App review account (src/lib/thirtyda-review.mjs): `phone` is the admin's mock number; the profile's own verified
  // number waits in reviewWas. Its codes, Telegram checks and links go too — unless another profile has verified that
  // number meanwhile (then they are that profile's).
  const own = user.reviewWas?.phone ? String(user.reviewWas.phone) : null;
  if (own && !handles.phones.includes(own) && !(await users.findOne({ phone: own, _id: { $ne: userId } }, { projection: { _id: 1 } }))) {
    handles.phones.push(own);
  }
  const claimed = await users.updateOne({ _id: userId, ...(onlyIf || {}) }, claimUpdate(user, handles, new Date(now)));
  if (onlyIf && !claimed?.matchedCount) return { ok: false, skipped: true };
  // Sign in with Apple (5.1.1(v)): its token revoked at Apple while the rest is cleaned up — never in the delete's way.
  const apple = appleRevokeOf(user);
  const revoking = apple ? Promise.resolve().then(() => revokeApple(d, apple)).catch(() => "failed") : null;
  const done = await cleanUp(d, userId, handles, at, { deletePhoto, ownSessions: false });
  const appleResult = revoking ? await revoking : null;
  await d.collection(AUDIT).updateOne(
    { action, userId }, { $setOnInsert: { at: new Date(now) } }, { upsert: true },
  );
  // Everything else is done: its own sessions end now, while the profile (marked deleting) is still there — should
  // this stop right here, the background still finds the profile and finishes it; no session is ever left pointing at
  // a profile that is gone.
  done.sessions += (await d.collection(SESSIONS).deleteMany({ userId })).deletedCount ?? 0;
  const last = await users.findOneAndDelete({ _id: userId });
  const after = await cleanUp(d, userId, last ? mergeHandles(handles, handlesOf(last)) : handles, at, { deletePhoto, ownSessions: true });
  done.sessions += after.sessions;
  return { ok: true, already: false, done, ...(appleResult ? { apple: appleResult } : {}) };
}

/**
 * Finish deletes that stopped half way (the server went down, the database failed a step): profiles marked `deleting`
 * for over RESUME_AFTER_MS, oldest first. One that fails again is logged and left for the next round; the rest still
 * run. → how many were finished.
 */
export async function resumeDeletions(d, { now = Date.now(), limit = 5, deletePhoto = deleteStoredPhoto } = {}) {
  const stale = await d.collection(USERS).find({ "deleting.at": { $lt: new Date(now - RESUME_AFTER_MS) } })
    .sort({ "deleting.at": 1 }).limit(limit).toArray();
  let finished = 0;
  for (const u of stale) {
    try {
      await deleteAccount(d, u._id, { now, deletePhoto });
      finished += 1;
    } catch (err) {
      console.error("[30da delete] resume", u._id, ":", err instanceof Error ? err.message : err);
    }
  }
  return finished;
}

let resumer = null; // one per process

/**
 * Finish half-way deletes without waiting for anyone: one round as soon as the app reaches its database (server start —
 * src/lib/thirtyda-app.mjs calls this next to its indexes), then every RESUME_AFTER_MS. Best effort: an error is logged
 * and the next round tries again; rounds never overlap; the timer never keeps the process alive. Called again → the
 * same one. → { ran: Promise<number> (the first round), stop() }.
 */
export function finishDeletesInBackground(d, { every = RESUME_AFTER_MS, deletePhoto = deleteStoredPhoto } = {}) {
  if (resumer) return resumer;
  let busy = false;
  const round = async () => {
    if (busy) return 0;
    busy = true;
    try {
      return await resumeDeletions(d, { now: Date.now(), deletePhoto });
    } catch (err) {
      console.error("[30da delete] resume:", err instanceof Error ? err.message : err);
      return 0;
    } finally {
      busy = false;
    }
  };
  // Half-deleted profiles are found by their `deleting.at` (only they carry one): a small sparse index.
  Promise.resolve(d.collection(USERS).createIndex?.({ "deleting.at": 1 }, { sparse: true })).catch(() => {});
  const timer = setInterval(round, every);
  timer.unref?.();
  resumer = { ran: round(), stop() { clearInterval(timer); resumer = null; } };
  return resumer;
}

// ---------------------------------------------------------------- never verified: gone after 48 hours (owner 2026-10-14)

/** How often the server looks for profiles past their 48 hours (and once at start). */
export const EXPIRE_EVERY_MS = 10 * 60e3;

/**
 * A profile that never verified any way (neverVerifiedFilter) is deleted at users.verifyBy — 48 hours after it was made
 * (createProfile sets it; the app shows the time left). One made before the rule gets its 48 hours from this run on. A
 * blocked one is left alone (the admin's case: its record stays until the admin decides); one already being deleted is
 * finished by resumeDeletions. Each goes through deleteAccount (everything of it, the others' conversations end as
 * 'left'), claimed only while still never verified. → how many were deleted.
 */
export async function expireUnverified(d, { now = Date.now(), limit = 20, deletePhoto = deleteStoredPhoto } = {}) {
  const users = d.collection(USERS);
  const still = { ...neverVerifiedFilter(), blocked: { $ne: true }, deleting: { $exists: false } };
  await users.updateMany({ ...still, verifyBy: { $exists: false } }, { $set: { verifyBy: verifyByFrom(now) } });
  const due = await users.find({ ...still, verifyBy: { $lt: new Date(now) } }, { projection: { _id: 1 } })
    .sort({ verifyBy: 1 }).limit(limit).toArray();
  let deleted = 0;
  for (const u of due) {
    try {
      const r = await deleteAccount(d, u._id, { now, deletePhoto, onlyIf: still, action: "unverified_expired" });
      if (r.ok && !r.already) deleted += 1;
    } catch (err) {
      console.error("[30da delete] unverified", u._id, ":", err instanceof Error ? err.message : err);
    }
  }
  return deleted;
}

let expirer = null; // one per process

/**
 * expireUnverified without waiting for anyone: one round as soon as the app reaches its database (server start), then
 * every EXPIRE_EVERY_MS. Best effort, rounds never overlap, the timer never keeps the process alive. Called again → the
 * same one. → { ran: Promise<number> (the first round), stop() }.
 */
export function expireUnverifiedInBackground(d, { every = EXPIRE_EVERY_MS, deletePhoto = deleteStoredPhoto } = {}) {
  if (expirer) return expirer;
  let busy = false;
  const round = async () => {
    if (busy) return 0;
    busy = true;
    try {
      return await expireUnverified(d, { now: Date.now(), deletePhoto });
    } catch (err) {
      console.error("[30da delete] unverified:", err instanceof Error ? err.message : err);
      return 0;
    } finally {
      busy = false;
    }
  };
  // Profiles with a deadline (only never-verified ones get one): a small sparse index.
  Promise.resolve(d.collection(USERS).createIndex?.({ verifyBy: 1 }, { sparse: true })).catch(() => {});
  const timer = setInterval(round, every);
  timer.unref?.();
  expirer = { ran: round(), stop() { clearInterval(timer); expirer = null; } };
  return expirer;
}

const limits = windowLimiter(15 * 60e3);

/**
 * POST /me/delete { pin? } — the route (src/lib/thirtyda-app.mjs registers it, blockedOk). `deps` come from the app's
 * router: fail(status, code, message, extra) makes its API errors, checkPinTry(ctx, pin) is the lock screen's own PIN
 * check (no try limit; 429 only for scripts), signedOutCookie(req) the cleared session cookie.
 */
export async function deleteMe(ctx, { fail, checkPinTry, signedOutCookie, deletePhoto = deleteStoredPhoto, now = Date.now(), demo = false, revokeApple = null }) {
  const { d, req, me, body } = ctx;
  if (!req.headers.origin) throw fail(403, "bad_origin", "Requests must come from the 30+DA app.");
  if (limits.over(`ip:${clientIp(req)}`, DELETE_PER_IP, now) || limits.over(`user:${me._id}`, DELETE_PER_PROFILE, now)) {
    throw fail(429, "rate_limited", "Too many tries. Try again in 15 minutes.");
  }
  const resuming = Boolean(me.deleting);
  // A blocked profile writes to the team instead (the delete-data page): never a way round a block.
  if (me.blocked && !resuming) throw fail(403, "blocked", "This account is blocked.");
  if (me.pinHash && !resuming) {
    const pin = pinDigits(body?.pin);
    if (pin.length !== PIN_LENGTH) throw fail(422, "invalid", "Enter your 4-digit PIN.", { field: "pin" });
    await checkPinTry(ctx, pin); // 400 wrong_pin (ask again) · 429 too_many_tries (scripts only) — like the lock screen
  }
  if (demo) return demoDelete(ctx, { signedOutCookie, now });
  // Others' deletes that stopped half way finish now too (best effort, never in the way of this one).
  await resumeDeletions(d, { now, deletePhoto }).catch((err) => {
    console.error("[30da delete] resume:", err instanceof Error ? err.message : err);
  });
  const r = await deleteAccount(d, me._id, { now, deletePhoto, ...(revokeApple ? { revokeApple } : {}) });
  ctx.session = null;
  ctx.headers["Set-Cookie"] = signedOutCookie(req);
  // Sign in with Apple: whether its token was revoked at Apple too (only for a profile that had one).
  return { ok: true, deleted: true, ...(r?.apple ? { appleRevoke: r.apple } : {}) };
}

/**
 * "Delete my account" on an App review demo account (deleteMe { demo }, src/lib/thirtyda-review.mjs; owner 2026-10-14,
 * the iOS audit): the store reviewer must be able to finish the flow, but the demo profile, its PIN and its conversation
 * stay for the next reviewer. After the same checks (Origin, limits, the PIN like the lock screen) it ends exactly like a
 * real delete for the reviewer — THIS session signed out, the cookie cleared, the same answer, so the app says "Your
 * account was deleted." — and deletes nothing. One audit line, ids only.
 */
async function demoDelete(ctx, { signedOutCookie, now }) {
  const { d, req, me, session } = ctx;
  if (session?._id) await d.collection(SESSIONS).deleteMany({ _id: session._id });
  await d.collection(AUDIT).insertOne({ at: new Date(now), action: "review_delete_kept", userId: me._id }).catch(() => {});
  ctx.session = null;
  ctx.headers["Set-Cookie"] = signedOutCookie(req);
  return { ok: true, deleted: true };
}
