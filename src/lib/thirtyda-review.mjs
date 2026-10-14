/**
 * 30+DA App review accounts (owner 2026-10-14: "for the test user log in 1122 and 2244"). Apple (2.1, a demo account)
 * and Google Play ("App access") need a way in that needs nothing outside the app: their reviewers install fresh, with
 * no Telegram. Nothing here is hidden — the admin page "App review" (/30da/admin/review) shows and switches all of it.
 *
 *   - The admin turns EXISTING profiles into review accounts ("Use as review account": users.demo = 'review'): a mock
 *     number becomes the profile's verified phone (phoneVia 'review') and the admin's PIN becomes its PIN (hashed exactly
 *     like the app's own PIN; the PIN itself is also kept SEALED on the profile, reviewPinBox, so the page can show it
 *     in the review notes). Photos, birth year, level and conversations stay exactly as they are. "Stop being a review
 *     account" puts the profile's own number / PIN back (reviewWas) and ends the sessions the review code made.
 *   - Two worlds: review profiles see ONLY review profiles; real people (and guests) never see them — Nearby, guest
 *     cards, a profile, photos, conversations (lists, the heartbeat's actions, the pending count) — and neither side can
 *     open or start a conversation with the other (the server checks, see sameWorld). Pairs between two review profiles
 *     keep working.
 *   - Sign-in: ONE 6-digit review code (made by the server, "New code", kept sealed in thirtyda_settings as
 *     'review_code') works ONLY while the admin switch "Review sign-in" is ON (thirtyda_settings 'review_signin', read
 *     from the database on every check: OFF stops it at once) and ONLY for a current review account's mock number.
 *     5 wrong tries per number per 15 minutes, the address limit of verify-code, and REVIEW_WRONG_MAX wrong tries in
 *     total per code (then only a New code works again). A review account is never signed into any other way by its
 *     number (a code or Telegram for it answers phone_in_use).
 *
 * Pure apart from the `d` (Mongo Db) handed in, so the unit tests run without a database.
 */

import crypto from "node:crypto";
import { SETTINGS_COLLECTION, saveSecret, readSecret, secretSaved, sealSecret, openSecret, settingsKey, keyReady } from "./thirtyda-settings.mjs";
import { hashPin, checkNewPin } from "./thirtyda-pin.mjs";
import { PHOTO_MAX } from "../thirtyda-app/shared/rules.js";

export const REVIEW = "review"; // users.demo
export const REVIEW_MAX = 4; // review accounts at most
/** What the admin form offers for the 1st / 2nd review account (owner 2026-10-14). */
export const REVIEW_DEFAULTS = [{ phone: "+855100001122", pin: "1122" }, { phone: "+855100002244", pin: "2244" }];
export const REVIEW_CODE = "review_code"; // the sealed code (thirtyda_settings, a SECRET_NAMES entry)
export const REVIEW_SWITCH = "review_signin"; // { on, updatedAt, updatedBy } in thirtyda_settings
export const REVIEW_TRIES = 5; // wrong review codes per number per 15 minutes
export const REVIEW_WRONG_MAX = 50; // wrong review codes per code, ever: then only a New code works
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

/** The verified ways of a profile as the page shows them: a real number masked, a mock number in full. */
export function waysOf(u) {
  const phone = u?.verified?.phone && u?.phone ? (isReview(u) ? spacedPhone(u.phone) : maskTail(u.phone)) : null;
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

/**
 * The text for App Store Connect / Play Console review notes: each review account's app name, mock number and PIN,
 * the code, and the steps. `code` null → "<no code yet>".
 */
export function reviewNotes({ accounts, code }) {
  const lines = ["30+DA demo accounts for app review", ""];
  accounts.forEach((a, i) => {
    lines.push(`Demo account ${i + 1}: ${a.name} · phone ${spacedPhone(a.phone)} · PIN ${a.pin ?? "(not readable: save it again)"}`);
  });
  lines.push(`Review code (for every demo account): ${code ?? "<no code yet: press New code>"}`, "");
  lines.push(
    "Steps:",
    "1. Open the app and pick a language.",
    "2. Set any 4-digit PIN (it only locks the app on this phone).",
    "3. Tap the profile icon (top right). In the phone number box keep +855, type the demo number (for example 10 000 1122) and tap Telegram. No Telegram app is needed.",
    "4. Enter the review code, then the demo account's PIN.",
  );
  lines.push("");
  if (accounts.length > 1) {
    lines.push(`The demo accounts see only each other${accounts.some((a) => a.talks?.length) ? " and already have a conversation with each other" : ""}.`);
  }
  lines.push("Please keep the demo accounts: to try Delete my account, make a new profile (no sign-in needed) and delete that one.");
  return lines.join("\n");
}

// ---------------------------------------------------------------- the switch and the code

/** The admin switch "Review sign-in": always read from the database (OFF stops the code at once). */
export async function reviewSwitch(d) {
  const doc = await d.collection(SETTINGS_COLLECTION).findOne({ _id: REVIEW_SWITCH });
  return { on: doc?.on === true, updatedAt: iso(doc?.updatedAt) };
}

export async function setReviewSwitch(d, on, { by = "superadmin" } = {}) {
  await d.collection(SETTINGS_COLLECTION).updateOne(
    { _id: REVIEW_SWITCH }, { $set: { on: on === true, updatedAt: new Date(), updatedBy: by } }, { upsert: true },
  );
  return reviewSwitch(d);
}

/** A fresh 6-digit code, sealed (saveSecret: a new code also starts a new wrong-try count). → the code. */
export async function newReviewCode(d, { by = "superadmin" } = {}) {
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, "0");
  await saveSecret(d, REVIEW_CODE, code, { by });
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
 * account (not blocked, not being deleted). → the profile, or null.
 */
export async function reviewAccountFor(d, phone) {
  if (!phone) return null;
  if (!(await reviewSwitch(d)).on) return null;
  const u = await d.collection(USERS).findOne({ phone, demo: REVIEW });
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
 * "Use as review account" (or save it again with another number / PIN): `phone` already normalised by the caller
 * (the app's normalizePhone). Refuses: no such profile (404), blocked / being deleted (409), REVIEW_MAX reached (409),
 * a number another profile has (409 phone_in_use), a PIN the app would not take (422), no lock key (503).
 * The profile's own number / PIN / phoneVia are kept the first time (reviewWas) for "Stop being a review account".
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
  const at = new Date(now);
  const set = {
    demo: REVIEW, phone, "verified.phone": true, phoneVia: "review", pinHash: await hashPin(c.pin), pinAt: at, pinTries: 0,
    reviewPinBox: sealSecret(c.pin, settingsKey(), pinAad(id)),
  };
  // The first time only: when (the notes' order) and what to put back on "Stop being a review account".
  if (!isReview(u)) {
    set.reviewAt = at;
    set.reviewWas = {
      phone: u.phone ?? null, verifiedPhone: Boolean(u.verified?.phone), phoneVia: u.phoneVia ?? null, pinHash: u.pinHash ?? null, pinAt: u.pinAt ?? null,
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
 * profile has taken it meanwhile), its own phoneVia and PIN too (none → the app asks for a new PIN). The sessions the
 * review code made for it end (a reviewer's phone never keeps a real profile).
 */
export async function stopReviewAccount(d, id) {
  const users = d.collection(USERS);
  const u = await users.findOne({ _id: id });
  if (!u || !isReview(u)) throw new ReviewError(404, "not_found", "This profile is not a review account.");
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
  await users.updateOne({ _id: id, demo: REVIEW }, { $set: set, $unset: unset });
  const ended = await d.collection(SESSIONS).deleteMany({ userId: id, reviewSignin: true });
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
        name: 1, createdAt: 1, level: 1, photos: 1, birthYear: 1, verified: 1, phone: 1, demo: 1, blocked: 1, deleting: 1, reviewPinBox: 1, reviewAt: 1,
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
    phone: u.phone ?? null,
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
