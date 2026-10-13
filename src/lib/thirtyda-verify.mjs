/**
 * 30+DA "Verify to chat" (owner 2026-10-13) — the server half. The routes are in src/lib/thirtyda-app.mjs.
 *
 *   - Create profile no longer waits for a verification: once photo 1, app name, birth year, real name, I am and You
 *     are are filled, Next makes the profile (POST /profile { …, unverified: true }) with a fresh session, and the
 *     person goes on to Nearby. A few such profiles per address per day (UNVERIFIED_PER_DAY), then a plain 429.
 *   - "Needed to chat": a profile with no verified way yet may look around (Nearby, profiles, its own profile), but
 *     every route that TALKS TO ANOTHER PERSON answers 403 { error:'verify_needed' } until it has one (canTalk). The
 *     app then opens the small "Verify to chat" sheet and, after a good verify, sends the same call again.
 *   - Verifying from such a profile ATTACHES to it (a phone code, the Telegram bot, Google / Facebook / TikTok). A
 *     number or account that already belongs to another profile is refused in plain words — never a switch to that
 *     profile, never a merge.
 */

import crypto from "node:crypto";

/** The verified ways a profile can have (users.verified.*): a phone (a code or the Telegram bot), Google, Facebook, TikTok. */
export const VERIFIED_WAYS = ["phone", "gmail", "facebook", "tiktok"];

/** A profile may talk to people once it has at least one verified way. */
export const canTalk = (user) => VERIFIED_WAYS.some((k) => user?.verified?.[k] === true);

/**
 * Every route that talks to another person (path under /30da/api). Each is gated by verify_needed for a profile
 * with no verified way. src/lib/thirtyda-verify.test.mjs checks every real route is listed here or in OPEN_WRITES.
 */
export const TALK_ROUTES = [
  ["POST", /^\/pairs$/], // start a conversation (the draft the 5 lines go into)
  ["POST", /^\/pairs\/(P-\d+)\/sets$/], // send my 5 lines
  ["PUT", /^\/pairs\/(P-\d+)\/replies$/], // one tap reply to a line of theirs
  ["POST", /^\/pairs\/(P-\d+)\/answers$/], // all replies at once (the older screens)
  ["POST", /^\/pairs\/(P-\d+)\/decide$/], // after Level 2: open the chat / forget it
  ["POST", /^\/pairs\/(P-\d+)\/messages$/], // a Level 3 chat line
];

/**
 * Writes under the conversation code that do NOT talk to the other person, so they stay open: a reminder for
 * myself, and a report to the admin (never blocked: reporting abuse must always work).
 */
export const OPEN_WRITES = [
  ["POST", /^\/pairs\/(P-\d+)\/remind$/],
  ["POST", /^\/pairs\/(P-\d+)\/messages\/(M-\d+)\/report$/],
];

/** true when METHOD sub (path under /30da/api) talks to another person. */
export const talksToSomeone = (method, sub) => TALK_ROUTES.some(([m, re]) => m === method && re.test(String(sub ?? "")));

// ---------------------------------------------------------------- unverified profiles per address per day

/** New profiles made WITHOUT a verification, per address per Phnom Penh day. */
export const UNVERIFIED_PER_DAY = 3;
/** One counter per address per day, the address kept only hashed; gone two days later (TTL on purgeAt). */
export const SIGNUP_LIMITS = "thirtyda_signup_limits";

/** Phnom Penh's day (fixed UTC+7), "2026-10-13". */
export const ppDay = (now = Date.now()) => new Date(now + 7 * 3600e3).toISOString().slice(0, 10);

/** The counter's id for this address today: a hash, never the address itself. */
export const signupKey = (ip, now = Date.now()) => crypto.createHash("sha256").update(`30da-unverified|${ppDay(now)}|${String(ip ?? "")}`).digest("hex");

/**
 * Take one of today's unverified sign-ups for this address, atomically (parallel requests cannot pass the limit).
 * → { ok: true, key } (give it back with releaseSignup if the profile is not made after all) | { ok: false }.
 */
export async function claimSignup(coll, ip, { now = Date.now(), max = UNVERIFIED_PER_DAY } = {}) {
  const key = signupKey(ip, now);
  let doc = null;
  for (let tries = 0; tries < 2 && !doc; tries++) {
    try {
      doc = await coll.findOneAndUpdate(
        { _id: key }, { $inc: { n: 1 }, $setOnInsert: { purgeAt: new Date(now + 2 * 864e5) } }, { upsert: true, returnDocument: "after" },
      );
    } catch (err) {
      if (err?.code !== 11000 || tries) throw err; // two first sign-ups at once: the second one updates
    }
  }
  if ((doc?.n ?? 1) > max) {
    await coll.updateOne({ _id: key, n: { $gt: 0 } }, { $inc: { n: -1 } });
    return { ok: false, key: null };
  }
  return { ok: true, key };
}

/** Give a claimed sign-up back (the profile was not made: a bad photo, a clash). */
export async function releaseSignup(coll, key) {
  if (key) await coll.updateOne({ _id: key, n: { $gt: 0 } }, { $inc: { n: -1 } });
}

// ---------------------------------------------------------------- the way back from Google / Facebook / TikTok

/** Reasons the app words for a sign-in started from the "Verify to chat" sheet (in_use: that account has another profile). */
export const VERIFY_BACK_REASONS = ["cancelled", "expired", "unavailable", "failed", "too_many", "in_use"];

/** Screens a sign-in may be started from to ATTACH an account (never switch): #/me (owner 2026-10-13). */
export const ATTACH_FROM = ["me"];

/**
 * Where such a sign-in comes back to: the app's #/verified, which returns the person to what they were doing — or,
 * for one started on #/me (to: 'me'), straight back to #/me, which words it there.
 */
export function verifyBackPath(provider, { ok = false, reason = "failed", to = null } = {}) {
  const why = VERIFY_BACK_REASONS.includes(reason) ? reason : "failed";
  const screen = ATTACH_FROM.includes(to) ? to : "verified";
  return `/30da/#/${screen}?signin=${encodeURIComponent(provider)}&${ok ? "ok=1" : `error=${why}`}`;
}

// ---------------------------------------------------------------- which way proved the phone (owner 2026-10-13)

/**
 * users.phoneVia: the way the profile's phone was LAST proved — the Telegram bot or a code by Telegram / WhatsApp
 * (or 'sms'). Set by verify-code (the code's own channel, kept with the code) and by the bot; a new verify replaces
 * it. Profiles verified before it was kept have none: unknown (no app ✓, "Number verified ✓" still shows).
 */
export const PHONE_VIAS = ["telegram", "whatsapp", "sms"];
export const phoneViaOf = (v) => (PHONE_VIAS.includes(v) ? v : null);

/** The Mongo update that records (or, unknown, clears) phoneVia, merged into `update`. */
export function withPhoneVia(update = {}, via = null) {
  const v = phoneViaOf(via);
  const out = { ...update };
  if (v) out.$set = { ...(update.$set || {}), phoneVia: v };
  else out.$unset = { ...(update.$unset || {}), phoneVia: "" };
  return out;
}

/** The sign-ins ON a profile (an account id is kept for it), as booleans — never the ids. */
export const signinsOf = (u) => ({
  google: Boolean(u?.signin?.google?.id), facebook: Boolean(u?.signin?.facebook?.id), tiktok: Boolean(u?.signin?.tiktok?.id),
});
