/**
 * 30+DA PIN lock (owner 2026-10-13, "Lock the app") — the server half. The rules every route follows; the
 * routes themselves are in src/lib/thirtyda-app.mjs (POST /me/lock, /me/unlock, /me/pin, /me/pin/forgot).
 *
 *   - A person's PIN is 4 digits (shared/pin.js: no 0000-style repeats, no 1234 / 4321 runs). Only a salted
 *     scrypt hash is kept on the profile (users.pinHash); the PIN itself is never stored, logged or returned.
 *     With THIRTYDA_PIN_PEPPER set (server env only, never in Mongo) the hash also needs that secret
 *     ("scrypt2$…"), so a copy of the users collection alone cannot be tried against all 10,000 PINs.
 *   - A session is OPEN only after a sign-in (Google / Facebook / phone code) or the right PIN, and only while
 *     the person really uses the app: no real activity for SERVER_IDLE_MS (2 minutes) → locked. Real activity
 *     comes from the app's X-30DA-Input-Age header (seconds since the last touch / mouse / key / scroll), so
 *     the background heartbeat and polling never keep a session open.
 *   - While locked every data API answers 423 { error:'locked' }; only whileLocked() routes stay open.
 *   - 5 wrong PINs (per session AND per person) end the session: sign in again and set a new PIN.
 *
 * Sessions carry: pinOk (open), activeAt (last real activity), pinTries, pinResetUntil (a fresh sign-in may
 * set a new PIN without the old one until then, once). Profiles carry: pinHash, pinAt, pinTries.
 */

import crypto from "node:crypto";
import {
  PIN_LENGTH, PIN_TRIES, IDLE_COVER_MS, LOCK_IDLE_MS, INPUT_AGE_HEADER, checkNewPin, pinDigits, pinTriesLeft,
} from "../thirtyda-app/shared/pin.js";

export { PIN_LENGTH, PIN_TRIES, INPUT_AGE_HEADER, checkNewPin, pinDigits, pinTriesLeft };

/** A test override may only SHORTEN a time (a typo cannot switch the lock off in production). */
function shorterFromEnv(name, fallback) {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n >= 1000 ? Math.min(n, fallback) : fallback;
}
/** No real activity for this long → locked (server backstop). THIRTYDA_LOCK_IDLE_MS shortens it for tests. */
export const SERVER_IDLE_MS = shorterFromEnv("THIRTYDA_LOCK_IDLE_MS", LOCK_IDLE_MS);
/** The app covers itself after this long without a touch. THIRTYDA_IDLE_COVER_MS shortens it for tests. */
export const COVER_MS = shorterFromEnv("THIRTYDA_IDLE_COVER_MS", IDLE_COVER_MS);
/** After a sign-in, a new PIN may replace the old one without it for this long (once). */
export const PIN_RESET_MS = 15 * 60e3;

/** What the app is told about the lock (GET /me, 423 answers). Nothing secret. */
export const lockInfo = () => ({ coverMs: COVER_MS, idleMs: SERVER_IDLE_MS, tries: PIN_TRIES });

// ---------------------------------------------------------------- hash

const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEY_BYTES = 32;
// "scrypt$" = the PIN alone (before the pepper, or a server without one); "scrypt2$" = HMAC-SHA256(pepper, PIN).
const HASH_RE = /^(scrypt2?)\$(\d{1,7})\$(\d{1,2})\$(\d)\$([A-Za-z0-9_-]{16,64})\$([A-Za-z0-9_-]{32,128})$/;

/** The server's PIN pepper: at least 16 characters, else none (a short one would be a false comfort). */
export const PEPPER_MIN = 16;
export function pepperFrom(raw) {
  const v = typeof raw === "string" ? raw.trim() : "";
  return v.length >= PEPPER_MIN ? v : null;
}
/**
 * THIRTYDA_PIN_PEPPER — a server secret mixed into every new PIN hash and never stored in Mongo. Its own value
 * (not THIRTYDA_SECRET_KEY, which may be rotated): changing or removing it later means every "scrypt2" PIN stops
 * matching, and those people use "Forgot PIN?" (sign in again, set a new PIN).
 */
const PIN_PEPPER = pepperFrom(process.env.THIRTYDA_PIN_PEPPER);
if (process.env.THIRTYDA_PIN_PEPPER && !PIN_PEPPER) {
  console.warn(`[30da pin] THIRTYDA_PIN_PEPPER is shorter than ${PEPPER_MIN} characters, so it is not used.`);
}
/** true when this server hashes new PINs with the pepper (never says what it is). */
export const pinPepperSet = () => Boolean(PIN_PEPPER);

function scrypt(secret, salt, { N, r, p }, keylen = KEY_BYTES) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(secret, salt, keylen, { N, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** What scrypt is given: the 4 digits, or with a pepper HMAC-SHA256(pepper, digits). */
const secretFor = (digits, pepper) => (pepper ? crypto.createHmac("sha256", pepper).update(digits).digest() : digits);

let warnedNoPepper = false;
/**
 * 4 digits → "scrypt2$N$r$p$salt$key" with the pepper ("scrypt$…" without one; random 16-byte salt either way).
 * Async: never blocks the server. `opts.pepper` is for tests; the server uses THIRTYDA_PIN_PEPPER.
 */
export async function hashPin(pin, { pepper = PIN_PEPPER } = {}) {
  if (typeof pin !== "string" || !/^\d{4}$/.test(pin)) throw new Error("A PIN is 4 digits.");
  const key = pepperFrom(pepper);
  // Said once on a real database (not the _dev one, not under node --test), never with any value in it.
  if (!key && !warnedNoPepper && !String(process.env.MONGO_DB || "yaikh").endsWith("_dev") && !process.env.NODE_TEST_CONTEXT) {
    warnedNoPepper = true;
    console.warn("[30da pin] THIRTYDA_PIN_PEPPER is not set: PINs are hashed without the server pepper.");
  }
  const salt = crypto.randomBytes(16);
  const out = await scrypt(secretFor(pin, key), salt, SCRYPT);
  return `${key ? "scrypt2" : "scrypt"}$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${out.toString("base64url")}`;
}

/**
 * true when `pin` (as typed: Khmer / full-width digits are fine) matches the stored hash. Constant-time compare.
 * A "scrypt2" hash needs the same pepper (none, or another one → false); an older "scrypt" hash needs none.
 */
export async function verifyPin(pin, stored, { pepper = PIN_PEPPER } = {}) {
  const m = HASH_RE.exec(String(stored ?? ""));
  if (!m) return false;
  const [N, r, p] = [m[2], m[3], m[4]].map(Number);
  // Only parameters this module writes (a planted huge N must not tie the server up).
  if (N !== SCRYPT.N || r !== SCRYPT.r || p !== SCRYPT.p) return false;
  const key = m[1] === "scrypt2" ? pepperFrom(pepper) : null;
  if (m[1] === "scrypt2" && !key) return false;
  const digits = pinDigits(pin);
  if (digits.length !== PIN_LENGTH) return false;
  const want = Buffer.from(m[6], "base64url");
  const got = await scrypt(secretFor(digits, key), Buffer.from(m[5], "base64url"), { N, r, p }, want.length);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/**
 * true when a stored hash was made without the pepper this server now has: after the next right PIN it is
 * hashed again with the pepper (so old profiles move over without anyone setting a new PIN).
 */
export function pinHashStale(stored, { pepper = PIN_PEPPER } = {}) {
  return Boolean(pepperFrom(pepper)) && /^scrypt\$/.test(String(stored ?? ""));
}

// ---------------------------------------------------------------- lock state

const time = (v) => (v == null ? NaN : new Date(v).getTime());

/**
 * Is this session locked? Open only after a sign-in or the right PIN (pinOk) and while its last real activity
 * (activeAt) is inside the idle window; the window slides with activity. → { locked, why: null | 'locked' | 'idle' }.
 */
export function lockState(session, now = Date.now(), idleMs = SERVER_IDLE_MS) {
  if (!session || session.pinOk !== true) return { locked: true, why: "locked" };
  const at = time(session.activeAt);
  if (!Number.isFinite(at) || now - at > idleMs) return { locked: true, why: "idle" };
  return { locked: false, why: null };
}

/** The lock fields of a session a sign-in has just made: open, active now, no wrong tries, may set a new PIN. */
export function freshSigninFields(now = Date.now()) {
  return { pinOk: true, activeAt: new Date(now), pinTries: 0, pinResetUntil: new Date(now + PIN_RESET_MS) };
}

/**
 * A session made before the PIN lock (no pinOk yet): the person had proved who they are, so with no PIN yet it
 * stays open (the app asks them to set one before anything else); a person who already has a PIN gets the PIN.
 */
export function legacyLockFields(hasPin, now = Date.now()) {
  return { pinOk: !hasPin, activeAt: new Date(now), pinTries: 0 };
}

/**
 * When the person last really used the app, from one API call. The app sends X-30DA-Input-Age (seconds since
 * the last touch / mouse / key / scroll) on every call, so its background calls (heartbeat, polling) carry an
 * old time and never keep a session open. Without the header a call counts as now (a person using the API),
 * except a background route (the heartbeat). A header that is not a number counts as no activity.
 * → ms timestamp, or null (not activity).
 */
export function activityAt(header, now = Date.now(), { background = false } = {}) {
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw == null || String(raw).trim() === "") return background ? null : now;
  const s = Number(raw);
  if (!Number.isFinite(s) || s < 0) return null;
  return now - Math.min(s, 10 * 365 * 86400) * 1000;
}

/**
 * Calls that are never "use" on their own: the heartbeat (a timer) and photo loads (an <img> the page shows,
 * which cannot carry the input-age header). They count only when they carry the header (the app's heartbeat).
 */
export function backgroundCall(method, sub) {
  const path = String(sub || "");
  return (method === "POST" && path === "/me/heartbeat") || (method === "GET" && /^\/photos\//.test(path));
}

/**
 * Calls that are NEVER use, header or not: GET /me/pending, the check a hidden, locked app makes for "Remind me"
 * (owner 2026-10-13). It must not keep a session open, so it never moves the last activity.
 */
export function passiveCall(method, sub) {
  return method === "GET" && String(sub || "") === "/me/pending";
}

/**
 * The activeAt to store after a call that showed activity at `at`, or null when there is nothing to write:
 * never moves back, and skips writes closer than a tenth of the window (≤ 5 s) to the stored one — so the
 * server may lock up to that much before the full window, never after it.
 */
export function nextActiveAt(session, at, idleMs = SERVER_IDLE_MS) {
  if (at == null || !Number.isFinite(at)) return null;
  const prev = time(session?.activeAt);
  const step = Math.min(5e3, Math.floor(idleMs / 10));
  if (Number.isFinite(prev) && at <= prev + step) return null;
  return new Date(at);
}

/**
 * What a LOCKED session may still call (sub = path under /30da/api):
 *   'signin' — the sign-in steps, as if signed out (a locked session never lends its profile to a new sign-in);
 *   'open'   — the rest of /auth/* (methods, sign out), the PIN routes (lock, unlock, set / change, forgot) and
 *              GET /me/pending ("something new is waiting": a number only, for the notification of a locked app);
 *   null     — everything else: 423 locked. (The version check and static files never reach the API router.)
 */
export function whileLocked(method, sub) {
  const path = String(sub || "");
  if (method === "POST" && /^\/auth\/(send-code|verify-code|verify-social)$/.test(path)) return "signin";
  // The free Telegram bot: its status signs in when Telegram has the number (src/lib/thirtyda-telegram-bot.mjs).
  if ((method === "POST" && path === "/auth/telegram/start") || (method === "GET" && path === "/auth/telegram/status")) return "signin";
  // The native apps (src/lib/thirtyda-signin.mjs): begin a sign-in for the app's sheet, and claim what it did — the
  // claim applies the web callback's own lock rule to the session.
  if ((method === "POST" && path === "/auth/app/begin") || (method === "GET" && path === "/auth/app")) return "signin";
  // App review (src/lib/thirtyda-review.mjs): the review code signs in like a code (its check says yes / no only: 'open').
  if (method === "POST" && path === "/auth/review/verify") return "signin";
  if (/^\/auth\//.test(path)) return "open";
  if (method === "POST" && /^\/me\/(lock|unlock|pin|pin\/forgot)$/.test(path)) return "open";
  if (passiveCall(method, path)) return "open";
  return null;
}

/**
 * How POST /me/pin may set a new PIN, or why not:
 *   no PIN yet           → 'first' (the session must be open: a locked one signs in again instead);
 *   the old PIN given    → 'old' (checked, and a wrong one counts as a wrong try — even from the lock screen);
 *   a fresh sign-in      → 'fresh' (open session, inside pinResetUntil; used up once);
 * otherwise { refuse: 423 locked | 403 old_pin_needed }.
 */
export function pinSetPlan({ hasPin, locked, hasOld, resetUntil, now = Date.now() }) {
  if (!hasPin) return locked ? { refuse: { status: 423, code: "locked" } } : { kind: "first" };
  if (hasOld) return { kind: "old" };
  if (!locked && time(resetUntil) > now) return { kind: "fresh" };
  return { refuse: locked ? { status: 423, code: "locked" } : { status: 403, code: "old_pin_needed" } };
}

/** After one more wrong PIN: { end: false, triesLeft } or { end: true, everywhere } (the person's count ran out → every session). */
export function afterWrongPin(sessionTries, userTries) {
  const left = pinTriesLeft(sessionTries, userTries);
  if (left > 0) return { end: false, triesLeft: left };
  return { end: true, everywhere: (Number(userTries) || 0) >= PIN_TRIES, triesLeft: 0 };
}
