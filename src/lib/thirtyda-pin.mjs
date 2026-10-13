/**
 * 30+DA PIN lock (owner 2026-10-13, "Lock the app") — the server half. The rules every route follows; the
 * routes themselves are in src/lib/thirtyda-app.mjs (POST /me/lock, /me/unlock, /me/pin, /me/pin/forgot).
 *
 *   - A person's PIN is 4 digits (shared/pin.js: no 0000-style repeats, no 1234 / 4321 runs). Only a salted
 *     scrypt hash is kept on the profile (users.pinHash); the PIN itself is never stored, logged or returned.
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
const HASH_RE = /^scrypt\$(\d{1,7})\$(\d{1,2})\$(\d)\$([A-Za-z0-9_-]{16,64})\$([A-Za-z0-9_-]{32,128})$/;

function scrypt(pin, salt, { N, r, p }, keylen = KEY_BYTES) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(pin, salt, keylen, { N, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** 4 digits → "scrypt$N$r$p$salt$key" (random 16-byte salt). Async: never blocks the server. */
export async function hashPin(pin) {
  if (typeof pin !== "string" || !/^\d{4}$/.test(pin)) throw new Error("A PIN is 4 digits.");
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pin, salt, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

/** true when `pin` (as typed: Khmer / full-width digits are fine) matches the stored hash. Constant-time compare. */
export async function verifyPin(pin, stored) {
  const m = HASH_RE.exec(String(stored ?? ""));
  if (!m) return false;
  const [N, r, p] = [m[1], m[2], m[3]].map(Number);
  // Only parameters this module writes (a planted huge N must not tie the server up).
  if (N !== SCRYPT.N || r !== SCRYPT.r || p !== SCRYPT.p) return false;
  const digits = pinDigits(pin);
  if (digits.length !== PIN_LENGTH) return false;
  const want = Buffer.from(m[5], "base64url");
  const got = await scrypt(digits, Buffer.from(m[4], "base64url"), { N, r, p }, want.length);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
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
 *   'open'   — the rest of /auth/* (methods, sign out) and the PIN routes (lock, unlock, set / change, forgot);
 *   null     — everything else: 423 locked. (The version check and static files never reach the API router.)
 */
export function whileLocked(method, sub) {
  const path = String(sub || "");
  if (method === "POST" && /^\/auth\/(send-code|verify-code|verify-social)$/.test(path)) return "signin";
  // The free Telegram bot: its status signs in when Telegram has the number (src/lib/thirtyda-telegram-bot.mjs).
  if ((method === "POST" && path === "/auth/telegram/start") || (method === "GET" && path === "/auth/telegram/status")) return "signin";
  if (/^\/auth\//.test(path)) return "open";
  if (method === "POST" && /^\/me\/(lock|unlock|pin|pin\/forgot)$/.test(path)) return "open";
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
