/**
 * 30+DA App review accounts (owner 2026-10-14: Dara PIN 1122 and Sophea PIN 3344). Apple (2.1, a demo account)
 * and Google Play ("App access") need a way in that needs nothing outside the app: their reviewers install fresh, with
 * no Telegram. Nothing here is hidden — the admin page "App review" (/30da/admin/review) shows and switches all of it.
 *
 *   - The admin turns EXISTING profiles into review accounts ("Use as review account": users.demo = 'review'): a mock
 *     number becomes the profile's verified phone (phoneVia 'review') and the admin's PIN becomes its PIN (hashed exactly
 *     like the app's own PIN; the PIN itself is also kept SEALED on the profile, reviewPinBox, so the page can show it
 *     in the review notes). Photos, birth year, level and conversations stay exactly as they are. "Stop being a review
 *     account" puts the profile's own number / PIN back (reviewWas) and ends the sessions the review code made.
 *   - "Create demo account" (src/lib/thirtyda-demo.mjs, owner 2026-10-14: "1 woman 1 man", PINs 4455 / 6677) makes a NEW,
 *     fully filled profile directly as a review account (users.demoPreset), with 4 approved photos; Remove deletes it.
 *   - A PINNED Phnom Penh location: a review account is put on a fixed point in central Phnom Penh (REVIEW_SPOTS, area
 *     "Phnom Penh") and keeps it — POST /me/location answers OK but changes nothing for it (src/lib/thirtyda-app.mjs
 *     setLocation), so a store reviewer abroad tapping "Allow" never moves the demo. The spots are about 1.2 km apart,
 *     so the two demo accounts see each other at a small, sensible distance. Stop puts its own location back.
 *   - Two worlds: review profiles see ONLY review profiles; real people (and guests) never see them — Nearby, guest
 *     cards, a profile, photos, conversations (lists, the heartbeat's actions, the pending count) — and neither side can
 *     open or start a conversation with the other (the server checks, see sameWorld). Pairs between two review profiles
 *     keep working.
 *   - Sign-in: ONE 6-digit review code (made by the server, "New code", kept sealed in thirtyda_settings as
 *     'review_code') works ONLY while the admin switch "Review sign-in" is ON (thirtyda_settings 'review_signin', read
 *     from the database on every check: OFF stops it at once) and ONLY for a current review account's mock number.
 *     5 wrong tries per number per 15 minutes, the address limit of verify-code, and REVIEW_WRONG_MAX wrong tries in
 *     total per code (then only a New code works again). A review account is never signed into any other way: not by
 *     its number (a code or Telegram for it answers phone_in_use), not by Google / Facebook / TikTok. Its number is
 *     set only here: signed in, it can neither prove another number nor add a Google / Facebook / TikTok account
 *     (409 review_account), so the code can never come to work for a real number.
 *
 * Pure apart from the `d` (Mongo Db) handed in, so the unit tests run without a database.
 */

import crypto from "node:crypto";
import { SETTINGS_COLLECTION, saveSecret, readSecret, secretSaved, sealSecret, openSecret, settingsKey, keyReady } from "./thirtyda-settings.mjs";
import { hashPin, checkNewPin, verifyPin, pinDigits, PIN_LENGTH } from "./thirtyda-pin.mjs";
import { PHOTO_MAX } from "../thirtyda-app/shared/rules.js";

export const REVIEW = "review"; // users.demo
export const REVIEW_MAX = 4; // review accounts at most
/** What the admin form offers for the 1st / 2nd review account (owner 2026-10-14). */
export const REVIEW_DEFAULTS = [{ phone: "+855100001122", pin: "1122" }, { phone: "+855100003344", pin: "3344" }];
/**
 * Where review accounts stay (owner 2026-10-14): fixed points in central Phnom Penh, [lng, lat] rounded to 3 decimals
 * like every point the app stores. The 1st and 2nd are about 1.2 km apart (Nearby: "1.2 km"); each review account
 * takes the first spot no other review account has.
 */
export const REVIEW_SPOTS = [[104.921, 11.562], [104.93, 11.556], [104.915, 11.552], [104.926, 11.548]];
export const REVIEW_PLACE = { area: "Phnom Penh", city: "Phnom Penh" };
export const REVIEW_CODE = "review_code"; // the sealed code (thirtyda_settings, a SECRET_NAMES entry)
export const REVIEW_SWITCH = "review_signin"; // { on, updatedAt, updatedBy } in thirtyda_settings
export const REVIEW_TRIES = 5; // wrong review codes per number per 15 minutes
export const REVIEW_WRONG_MAX = 50; // wrong review codes per code, ever: then only a New code works
// Wrong review PINs per address per 15 minutes ("App review sign-in" and the probe; owner 2026-10-14: raised from 5 —
// people are never limited, and a store reviewer behind a shared address must not be stopped).
export const REVIEW_PIN_TRIES = 30;
const WINDOW_MS = 15 * 60e3;
const USERS = "thirtyda_users";
const SESSIONS = "thirtyda_user_sessions";
const PAIRS = "thirtyda_pairs";

// ---------------------------------------------------------------- the two worlds

export const isReview = (u) => u?.demo === REVIEW;
/** viewer may see / talk to other: both review profiles, or both not (a guest — no profile — is the real world). */
export const sameWorld = (viewer, other) => isReview(viewer) === isReview(other);
/** The Mongo filter for the profiles `viewer` may see (null / a guest → real profiles only). */
export const worldFilter = (viewer) => (isReview(viewer) ? { demo: REVIEW } : { demo: { $ne: REVIEW } });

/**
 * The pairs of `me` whose other person is in `me`'s world (one lookup for all of them). A pair whose other person is
 * gone counts as the real world. `otherOf(pair)` → the other member's id.
 */
export async function pairsInWorld(d, me, pairs) {
  if (!pairs.length) return pairs;
  const otherOf = (p) => (p.a === me._id ? p.b : p.a);
  const review = new Set((await d.collection(USERS)
    .find({ _id: { $in: pairs.map(otherOf) }, demo: REVIEW }, { projection: { _id: 1 } }).toArray()).map((u) => u._id));
  return pairs.filter((p) => review.has(otherOf(p)) === isReview(me));
}

// ---------------------------------------------------------------- what the admin page shows

/** "+85512345678" → "•••••••••678": all but the last 3 digits hidden (a real number is never shown in full). */
export function maskTail(v, keep = 3) {
  const s = String(v ?? "");
  if (!s) return null;
  return `${"•".repeat(Math.max(0, s.length - keep))}${s.slice(-keep)}`;
}

/** "+855100001122" → "+855 10 000 1122" (a Cambodian number in readable groups; others as they are). */
export function spacedPhone(p) {
  const s = String(p ?? "");
  const m = s.match(/^\+855(\d{2})(\d{3})(\d{3,4})$/);
  return m ? `+855 ${m[1]} ${m[2]} ${m[3]}` : s;
}

const filled = (u) => (Array.isArray(u?.photos) ? u.photos.slice(0, PHOTO_MAX).filter(Boolean).length : 0);
const iso = (t) => (t ? new Date(t).toISOString() : null);

/** A mock number the admin set (shown in full: it is not real); any other number is masked. */
const isMock = (u) => isReview(u) && u?.phoneVia === REVIEW;

/** The verified ways of a profile as the page shows them: a real number masked, a mock number in full. */
export function waysOf(u) {
  const phone = u?.verified?.phone && u?.phone ? (isMock(u) ? spacedPhone(u.phone) : maskTail(u.phone)) : null;
  return { phone, google: Boolean(u?.verified?.gmail), facebook: Boolean(u?.verified?.facebook), tiktok: Boolean(u?.verified?.tiktok) };
}

/** One row of "All profiles": what a reviewer would see of it. Never a real number in full, never an email. */
export function profileRow(u) {
  return {
    id: u._id,
    name: u.name ?? "",
    created: iso(u.createdAt),
    level: Number(u.level) || 1,
    photos: filled(u),
    photoMax: PHOTO_MAX,
    birthYear: Number.isInteger(u.birthYear) ? u.birthYear : null,
    ways: waysOf(u),
    review: isReview(u),
    blocked: Boolean(u.blocked),
  };
}

/** "1122 / 3344": the review accounts' PINs. */
const pinList = (accounts) => accounts.map((a) => a.pin).filter(Boolean).join(" / ") || "shown above";
/** "1122, 3344, 4455 or 6677" (step 3 of the notes). */
function pinOr(accounts) {
  const pins = accounts.map((a) => a.pin).filter(Boolean);
  return pins.length > 1 ? `${pins.slice(0, -1).join(", ")} or ${pins.at(-1)}` : pins[0] ?? "shown below";
}

/** "Dara and Sophea already have a conversation (Level 3 chat)." for every pair of review accounts (once each). */
function talkLines(accounts) {
  const seen = new Map();
  for (const a of accounts) {
    for (const t of a.talks ?? []) {
      if (!seen.has(t.pairId)) seen.set(t.pairId, `${a.name} and ${t.withName} already have a conversation${t.stage === "l3_open" ? " (Level 3 chat)" : ""}.`);
    }
  }
  return [...seen.values()];
}

const GENDER_WORD = { woman: "woman", man: "man", other: "other" };

/**
 * The text for App Store Connect / Play Console review notes (owner 2026-10-14: "it should be right now only 1122 and
 * 3344 in the system" — a demo PIN typed on the PIN screen signs straight in): the PIN-only way first, then EVERY review
 * account (the ones made on the page too) with its app name, PIN and mock number, and the number + code way as a
 * second way. `code` null → "<no code yet>".
 */
export function reviewNotes({ accounts, code }) {
  const lines = ["30+DA demo accounts for app review", ""];
  const talks = talkLines(accounts);
  lines.push(
    "Sign in (no phone number, no code):",
    "1. Open the app and pick a language.",
    "2. Read the community rules and tap \"I agree\".",
    `3. On "Set your PIN" type a demo PIN (${pinOr(accounts)}): you are signed in to that demo account at once, in the language you picked. (Or tap "App review sign-in" there and type it.)`,
    `4. Nearby shows the other demo accounts with their photos.${talks.length ? ` ${talks.join(" ")} To report a message, tap it in the chat.` : ""}`,
    `When the app locks itself (30 seconds without a touch), unlock it with the same PIN (${pinList(accounts)}).`,
    "",
  );
  accounts.forEach((a, i) => {
    const kind = GENDER_WORD[a.gender] ? ` (${GENDER_WORD[a.gender]})` : "";
    lines.push(`Demo account ${i + 1}: ${a.name}${kind} · PIN ${a.pin ?? "(not readable: save it again)"} · phone ${spacedPhone(a.phone)}`);
  });
  lines.push("");
  lines.push(
    "Second way (not needed): tap the profile icon (top right), keep +855, type the demo number (for example 10 000 1122), tap Telegram (no Telegram app is needed), enter the review code, then the demo account's PIN.",
    `Review code (for every demo account): ${code ?? "<no code yet: press New code>"}`,
    "",
  );
  if (accounts.length > 1) lines.push("The demo accounts see only each other.");
  if (accounts.length) lines.push("The demo accounts stay in Phnom Penh, Cambodia: allowing location on your device does not move them.");
  lines.push("Please keep the demo accounts: to try Delete my account, make a new profile (no sign-in needed) and delete that one.");
  return lines.join("\n");
}

// ---------------------------------------------------------------- the switch and the code

/** The admin switch "Review sign-in": always read from the database (OFF stops the code at once). */
export async function reviewSwitch(d) {
  const doc = await d.collection(SETTINGS_COLLECTION).findOne({ _id: REVIEW_SWITCH });
  return { on: doc?.on === true, updatedAt: iso(doc?.updatedAt) };
}

/**
 * Turning it OFF also ends every session a review sign-in started (reviewSignin: the code or the PIN-only way), so
 * nobody who signed in as a demo account during the review window stays in it afterwards. → { on, updatedAt,
 * sessionsEnded }.
 */
export async function setReviewSwitch(d, on, { by = "superadmin" } = {}) {
  await d.collection(SETTINGS_COLLECTION).updateOne(
    { _id: REVIEW_SWITCH }, { $set: { on: on === true, updatedAt: new Date(), updatedBy: by } }, { upsert: true },
  );
  const ended = on === true ? null : await d.collection(SESSIONS).deleteMany({ reviewSignin: true });
  return { ...(await reviewSwitch(d)), sessionsEnded: ended?.deletedCount ?? 0 };
}

/**
 * A fresh 6-digit code, sealed (saveSecret: a new code also starts a new wrong-try count). No last4 next to it: 4 of
 * 6 digits in plain text would leave 100 guesses to anyone who can read the database. → the code.
 */
export async function newReviewCode(d, { by = "superadmin" } = {}) {
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, "0");
  await saveSecret(d, REVIEW_CODE, code, { by, last4: false });
  return code;
}

/** The admin's view of the code: the code itself (for the notes), when it was made, its wrong tries. */
export async function reviewCodeView(d) {
  const [code, saved, doc] = await Promise.all([
    readSecret(d, REVIEW_CODE).catch(() => null), secretSaved(d, REVIEW_CODE).catch(() => false),
    d.collection(SETTINGS_COLLECTION).findOne({ _id: REVIEW_CODE }),
  ]);
  const wrong = Number(doc?.wrong) || 0;
  return {
    set: Boolean(code), saved, readable: Boolean(code) || !saved, code: code ?? null, updatedAt: iso(doc?.updatedAt),
    wrong, blocked: wrong >= REVIEW_WRONG_MAX,
  };
}

const digest = (s) => crypto.createHash("sha256").update(String(s)).digest();
/** Timing-safe: the same work whatever was typed. */
export const sameCode = (a, b) => typeof a === "string" && typeof b === "string" && a.length > 0 && b.length > 0
  && crypto.timingSafeEqual(digest(a), digest(b));

/** A small per-key try counter: take() counts a try before any await, giveBack() returns one (a right code). */
export function tryCounter(windowMs = WINDOW_MS) {
  const map = new Map();
  const live = (key, now) => {
    const list = (map.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length) map.set(key, list);
    else map.delete(key);
    return list;
  };
  return {
    take(key, max, now = Date.now()) {
      const list = live(key, now);
      if (list.length >= max) return false;
      list.push(now);
      map.set(key, list);
      return true;
    },
    giveBack(key, now = Date.now()) {
      const list = live(key, now);
      list.pop();
      if (!list.length) map.delete(key);
    },
    left(key, max, now = Date.now()) { return Math.max(0, max - live(key, now).length); },
  };
}

/**
 * Which review account this number signs into right now: only while "Review sign-in" is ON, only a current review
 * account (not blocked, not being deleted), and only the mock number the admin set (phoneVia 'review'). → the
 * profile, or null.
 */
export async function reviewAccountFor(d, phone) {
  if (!phone) return null;
  if (!(await reviewSwitch(d)).on) return null;
  const u = await d.collection(USERS).findOne({ phone, demo: REVIEW, phoneVia: REVIEW });
  return u && !u.blocked && !u.deleting ? u : null;
}

/**
 * Check a typed review code against the sealed one. → { ok } | { ok:false, reason: 'no_code' | 'blocked' | 'wrong', wrong }.
 * A wrong one adds to the code's total (REVIEW_WRONG_MAX → blocked until a New code).
 */
export async function checkReviewCode(d, typed) {
  const code = await readSecret(d, REVIEW_CODE).catch(() => null);
  if (!code) return { ok: false, reason: "no_code" };
  const doc = await d.collection(SETTINGS_COLLECTION).findOne({ _id: REVIEW_CODE }, { projection: { wrong: 1 } });
  if ((Number(doc?.wrong) || 0) >= REVIEW_WRONG_MAX) return { ok: false, reason: "blocked" };
  if (sameCode(String(typed ?? ""), code)) return { ok: true };
  await d.collection(SETTINGS_COLLECTION).updateOne({ _id: REVIEW_CODE, box: { $exists: true } }, { $inc: { wrong: 1 } });
  return { ok: false, reason: "wrong" };
}

// ---------------------------------------------------------------- the PIN-only way (owner 2026-10-14: "it's just 1122 3344")

/**
 * Which review account this PIN signs into: only while "Review sign-in" is ON and only CURRENT review accounts (demo
 * 'review' with the admin's mock number, not blocked, not being deleted; REVIEW_MAX at most). The query asks for review
 * accounts only, so a real profile's PIN is never even compared: a real person who chose 1122 never lands in Dara.
 * Every account is checked with the app's own PIN check (verifyPin: scrypt + timingSafeEqual), all of them every time,
 * so a right and a wrong PIN cost the same. Two accounts with the same PIN → the one made first. → the profile, or null.
 */
export async function reviewAccountForPin(d, pin) {
  const digits = pinDigits(String(pin ?? ""));
  if (digits.length !== PIN_LENGTH) return null;
  if (!(await reviewSwitch(d)).on) return null;
  const ms = (t) => (t ? new Date(t).getTime() || 0 : 0);
  const list = (await d.collection(USERS).find({ demo: REVIEW, phoneVia: REVIEW }).toArray())
    .filter((u) => !u.blocked && !u.deleting && u.pinHash && u.phone)
    .sort((x, y) => ms(x.reviewAt) - ms(y.reviewAt) || String(x._id).localeCompare(String(y._id)))
    .slice(0, REVIEW_MAX);
  const ok = await Promise.all(list.map((u) => verifyPin(digits, u.pinHash).catch(() => false)));
  return list.find((_, i) => ok[i]) ?? null;
}

/**
 * POST /auth/review/pin's checks, in order: the switch OFF → 404 (like an unknown route); not 4 digits → 422; then a
 * try is counted on `tries` under `key` (the address) BEFORE any await — REVIEW_PIN_TRIES per 15 minutes → 429; a PIN
 * that is no current review account's → 400 not_review (the try stays counted); a right one gives its try back.
 * → the review profile (the caller signs this browser into it).
 */
export async function reviewPinCheck(d, { pin, key, tries, now = Date.now() }) {
  if (!(await reviewSwitch(d)).on) throw new ReviewError(404, "not_found", "No such endpoint.");
  const digits = pinDigits(String(pin ?? ""));
  if (digits.length !== PIN_LENGTH) throw new ReviewError(422, "bad_pin", "A PIN is 4 digits.");
  if (!tries.take(key, REVIEW_PIN_TRIES, now)) throw new ReviewError(429, "too_many_attempts", "Too many tries. Try again in 15 minutes.");
  const user = await reviewAccountForPin(d, digits);
  if (!user) {
    const err = new ReviewError(400, "not_review", "That PIN is not a review account.");
    err.attemptsLeft = tries.left(key, REVIEW_PIN_TRIES, now);
    throw err;
  }
  tries.giveBack(key, now);
  return user;
}

/**
 * "Is this a demo PIN?" (POST /auth/review/pin { pin, probe: true }, owner 2026-10-14): exactly reviewPinCheck's checks
 * and try count (OFF → 404, review accounts only, REVIEW_PIN_TRIES wrong per address → 429, not one → 400 not_review),
 * but it NEVER signs in and never touches a session. The app asks it first about a PIN typed on a visitor PIN screen
 * and, on { review: true }, signs straight in with the normal sign-in (owner 2026-10-14: no confirm sheet any more), so
 * a visitor's own PIN never counts as a wrong sign-in. → { review: true, name } (the demo account's app name).
 */
export async function reviewPinProbe(d, opts) {
  const user = await reviewPinCheck(d, opts);
  return { review: true, name: String(user.name ?? "") };
}

// ---------------------------------------------------------------- turning a profile into a review account

export class ReviewError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const pinAad = (id) => `review_pin:${id}`;
/** The review PIN of a profile, opened from its sealed box (null: none, or this server cannot read it). */
export function reviewPinOf(u) {
  if (!u?.reviewPinBox) return null;
  try {
    return openSecret(u.reviewPinBox, settingsKey(), pinAad(u._id));
  } catch {
    return null;
  }
}

/**
 * The other CURRENT review account (demo 'review', not being deleted; any but `selfId`) whose PIN is `pin` → it, else
 * null. Two review accounts never share a PIN: the PIN-only way would sign into the one made first while the notes
 * name the other (reviewAccountForPin). Matched on the sealed PIN (reviewPinOf) and on the hash the sign-in itself
 * checks (verifyPin), so an account whose box this server cannot open still counts.
 */
export async function reviewPinInUse(d, pin, selfId = null) {
  const others = (await d.collection(USERS).find(
    { demo: REVIEW, _id: { $ne: selfId } }, { projection: { _id: 1, name: 1, reviewPinBox: 1, pinHash: 1, deleting: 1 } },
  ).toArray()).filter((o) => !o.deleting);
  for (const o of others) {
    if (reviewPinOf(o) === pin) return o;
    if (o.pinHash && (await verifyPin(pin, o.pinHash).catch(() => false))) return o;
  }
  return null;
}

/** 409 pin_in_use: the PIN is another review account's (its app name says which). */
export const pinInUse = (other) => Object.assign(new ReviewError(
  409, "pin_in_use", `${other?.name ? `${other.name} (another review account)` : "Another review account"} already has this PIN. Choose another PIN.`,
), { field: "pin" });

const spotKey = (c) => (Array.isArray(c) ? `${c[0]},${c[1]}` : "");

/**
 * The pinned spot of review account `u`: the one it already stands on (when no other review account has it), else the
 * first spot no other review account has. → [lng, lat] (a copy).
 */
export async function reviewSpotFor(d, u) {
  const others = await d.collection(USERS).find({ demo: REVIEW, _id: { $ne: u._id } }, { projection: { location: 1 } }).toArray();
  const taken = new Set(others.map((o) => spotKey(o.location?.coordinates)));
  const own = REVIEW_SPOTS.find((s) => spotKey(s) === spotKey(u.location?.coordinates));
  const spot = own && !taken.has(spotKey(own)) ? own : REVIEW_SPOTS.find((s) => !taken.has(spotKey(s))) ?? REVIEW_SPOTS[0];
  return [...spot];
}

/**
 * "Use as review account" (or save it again with another number / PIN): `phone` already normalised by the caller
 * (the app's normalizePhone). Refuses: no such profile (404), blocked / being deleted (409), REVIEW_MAX reached (409),
 * a number another profile has (409 phone_in_use), a PIN another review account has (409 pin_in_use), a PIN the app
 * would not take (422), no lock key (503).
 * The profile's own number / PIN / phoneVia / location are kept the first time (reviewWas) for "Stop being a review
 * account". Its location is pinned to a Phnom Penh spot (reviewSpotFor) every time it is saved.
 */
export async function makeReviewAccount(d, id, { phone, pin }, { now = Date.now() } = {}) {
  const users = d.collection(USERS);
  const u = await users.findOne({ _id: id });
  if (!u || u.deleting) throw new ReviewError(404, "not_found", "There is no such profile.");
  if (u.blocked) throw new ReviewError(409, "blocked", "This profile is blocked. Unblock it first.");
  if (!phone) throw new ReviewError(422, "bad_phone", "That number does not look right. Write it with the country code, e.g. +855 10 000 1122.");
  const c = checkNewPin(String(pin ?? ""));
  if (!c.ok) throw new ReviewError(422, "bad_pin", c.error === "format" ? "A PIN is 4 digits." : "The app does not take that PIN (like 1111 or 1234). Choose another.");
  if (!keyReady()) throw new ReviewError(503, "no_key", "The server's lock key is missing, so the PIN cannot be kept for the notes.");
  if (!isReview(u) && (await users.countDocuments({ demo: REVIEW, _id: { $ne: id } })) >= REVIEW_MAX) {
    throw new ReviewError(409, "too_many", `There are already ${REVIEW_MAX} review accounts. Stop one first.`);
  }
  if (await users.findOne({ phone, _id: { $ne: id } }, { projection: { _id: 1 } })) {
    throw new ReviewError(409, "phone_in_use", "Another profile has this number. Choose another mock number.");
  }
  // One PIN, one review account: a shared PIN would sign into the one made first (reviewAccountForPin).
  const clash = await reviewPinInUse(d, c.pin, id);
  if (clash) throw pinInUse(clash);
  const at = new Date(now);
  const set = {
    demo: REVIEW, phone, "verified.phone": true, phoneVia: "review", pinHash: await hashPin(c.pin), pinAt: at, pinTries: 0,
    reviewPinBox: sealSecret(c.pin, settingsKey(), pinAad(id)),
    // Pinned in Phnom Penh: the app's POST /me/location changes nothing for a review account (setLocation).
    location: { type: "Point", coordinates: await reviewSpotFor(d, u) }, area: REVIEW_PLACE.area, city: REVIEW_PLACE.city,
  };
  // The first time only: when (the notes' order) and what to put back on "Stop being a review account".
  if (!isReview(u)) {
    set.reviewAt = at;
    set.reviewWas = {
      phone: u.phone ?? null, verifiedPhone: Boolean(u.verified?.phone), phoneVia: u.phoneVia ?? null, pinHash: u.pinHash ?? null, pinAt: u.pinAt ?? null,
      location: u.location ?? null, area: u.area ?? "", city: u.city ?? "",
    };
  }
  try {
    await users.updateOne({ _id: id }, { $set: set });
  } catch (err) {
    if (err?.code === 11000) throw new ReviewError(409, "phone_in_use", "Another profile has this number. Choose another mock number.");
    throw err;
  }
  return users.findOne({ _id: id });
}

/**
 * "Stop being a review account": the mark and the mock number go; the profile's own number comes back (unless another
 * profile has taken it meanwhile), its own phoneVia and PIN too (none → the app asks for a new PIN), and its own location
 * (none → none: the app's next fix sets it; POST /me/location works for it again). Every session
 * the review code made for it ends (reviewSignin, kept when such a session is renewed), and so does any other session
 * of it started since it became a review account: a reviewer's phone never keeps a real profile. Its sessions from
 * before (the owner's own phone) stay.
 */
export async function stopReviewAccount(d, id) {
  const users = d.collection(USERS);
  const u = await users.findOne({ _id: id });
  if (!u || !isReview(u)) throw new ReviewError(404, "not_found", "This profile is not a review account.");
  // Made on the page ("Create demo account", src/lib/thirtyda-demo.mjs): no profile of its own to go back to — stopping
  // would only put a demo with made-up photos among real people. Remove deletes it.
  if (u.demoPreset) throw new ReviewError(409, "made_here", "This demo account was made on this page: Remove it instead.");
  const was = u.reviewWas ?? {};
  const set = { pinTries: 0 };
  const unset = { demo: "", reviewWas: "", reviewPinBox: "", reviewAt: "" };
  const back = was.phone && !(await users.findOne({ phone: was.phone, _id: { $ne: id } }, { projection: { _id: 1 } })) ? was.phone : null;
  if (back) {
    Object.assign(set, { phone: back, "verified.phone": Boolean(was.verifiedPhone) });
    if (was.phoneVia) set.phoneVia = was.phoneVia;
    else unset.phoneVia = "";
  } else {
    Object.assign(unset, { phone: "", phoneVia: "" });
    set["verified.phone"] = false;
  }
  if (was.pinHash) Object.assign(set, { pinHash: was.pinHash, pinAt: was.pinAt ?? new Date() });
  else Object.assign(unset, { pinHash: "", pinAt: "" });
  if ("location" in was) Object.assign(set, { location: was.location ?? null, area: was.area ?? "", city: was.city ?? "" });
  await users.updateOne({ _id: id, demo: REVIEW }, { $set: set, $unset: unset });
  const since = u.reviewAt ? new Date(u.reviewAt) : null;
  const ended = await d.collection(SESSIONS).deleteMany({
    userId: id, $or: [{ reviewSignin: true }, ...(since && !Number.isNaN(since.getTime()) ? [{ created: { $gte: since } }] : [])],
  });
  return { user: await users.findOne({ _id: id }), sessionsEnded: ended.deletedCount ?? 0 };
}

// ---------------------------------------------------------------- the page's data

/**
 * Everything the "App review" page shows: the switch, the code, the review accounts (number + PIN for the notes, and
 * what a reviewer will find: photos, birth year, level, verified ways, their conversations with each other), every
 * profile (masked), and the notes text.
 */
export async function reviewView(d) {
  const [sw, code, users] = await Promise.all([
    reviewSwitch(d), reviewCodeView(d),
    d.collection(USERS).find({}, {
      projection: {
        name: 1, createdAt: 1, level: 1, photos: 1, birthYear: 1, verified: 1, phone: 1, phoneVia: 1, demo: 1, blocked: 1, deleting: 1, reviewPinBox: 1, reviewAt: 1,
        gender: 1, demoPreset: 1,
      },
    }).toArray(),
  ]);
  const live = users.filter((u) => !u.deleting);
  const ms = (t) => (t ? new Date(t).getTime() || 0 : 0);
  // Review accounts in the order they were made (the notes' "Demo account 1, 2"); profiles newest first.
  const review = live.filter(isReview).sort((x, y) => ms(x.reviewAt) - ms(y.reviewAt) || String(x._id).localeCompare(String(y._id)));
  const ids = review.map((u) => u._id);
  const pairs = ids.length > 1
    ? await d.collection(PAIRS).find({ members: { $in: ids } }, { projection: { members: 1, stage: 1, level: 1 } }).toArray()
    : [];
  const nameOf = new Map(review.map((u) => [u._id, u.name]));
  const accounts = review.map((u) => ({
    ...profileRow(u),
    gender: u.gender ?? null,
    // Made on the page (Create demo account): Remove, never Stop; "Refresh photos".
    made: u.demoPreset ?? null,
    phone: isMock(u) ? u.phone ?? null : maskTail(u.phone),
    pin: reviewPinOf(u),
    talks: pairs.filter((p) => p.members.includes(u._id) && p.members.every((m) => nameOf.has(m)))
      .map((p) => {
        const other = p.members.find((m) => m !== u._id);
        return { pairId: p._id, with: other, withName: nameOf.get(other) ?? other, stage: p.stage, level: Number(p.level) || 1 };
      }),
  }));
  const profiles = live
    .sort((x, y) => ms(y.createdAt) - ms(x.createdAt) || String(x._id).localeCompare(String(y._id)))
    .map(profileRow);
  return {
    on: sw.on,
    switchedAt: sw.updatedAt,
    keyReady: keyReady(),
    code: { set: code.set, code: code.code, readable: code.readable, updatedAt: code.updatedAt, wrong: code.wrong, blocked: code.blocked, wrongMax: REVIEW_WRONG_MAX },
    max: REVIEW_MAX,
    defaults: REVIEW_DEFAULTS,
    accounts,
    profiles,
    counts: { profiles: profiles.length, review: accounts.length, real: profiles.length - accounts.length },
    notes: reviewNotes({ accounts, code: code.code }),
  };
}
