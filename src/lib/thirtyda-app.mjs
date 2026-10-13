/**
 * 30+DA dating app — the web client and its JSON API, all under /30da.
 *
 *   GET /30da/                       src/thirtyda-app/index.html
 *   GET /30da/<file>.js|css          src/thirtyda-app/ (also screens/*.js, shared/*.js)
 *   /30da/api/...                    JSON API (auth, profile, photos, nearby, people,
 *                                    pairs + levels, question sets, answers, chat, reports)
 *
 * The server is the authority for every rule. Contact details are refused at
 * every level, and each refused attempt is kept for the admin as a stopped
 * message plus an open flag (never shown to the other person). Level-3 chat is
 * 20–30 characters and not trivial. Only the person whose turn it is can act.
 * Blocked users are locked out and their pairs are frozen. A pair's stage is
 * recomputed lazily from its timestamps, so no timers run on the server.
 *
 * A conversation (shared/conversation.js): Level 1 and Level 2 each run both ways. Each person sends
 * the other ONE set of 5 lines per level, in any order, and replies to the set they got line by line
 * with one tap (PUT /pairs/:id/replies saves one reply at a time; a reply can change until all 5 are in).
 * A level is done when both sets are complete. Level 2 opens after the wait. After Level 2 each person
 * chooses (POST /pairs/:id/decide): the chat (Level 3) opens as soon as both chose to open it, and one
 * "Forget it" ends the conversation for both (stage 'ended': readable, nothing more to send). Real names
 * are shown to the other person only once the chat is open.
 * GET /pairs/:id/conversation is the one read model the conversation screen lives on.
 *
 * Collections: thirtyda_users, thirtyda_user_sessions, thirtyda_otps,
 * thirtyda_pairs, thirtyda_sets, thirtyda_chats, thirtyda_flags, thirtyda_counters; reads the
 * admin's question choices from thirtyda_questions (src/lib/thirtyda-questions.mjs) and the code
 * channels' settings from thirtyda_settings (src/lib/thirtyda-code-send.mjs: Telegram / WhatsApp codes are
 * real once the admin saves their keys on the admin Code page — and offered only once a test code went through,
 * see channelOffer). GET /auth/methods tells the phone step which of its 4 buttons work (Telegram, WhatsApp,
 * Facebook, Google), and which Telegram it is (telegram: 'bot' | 'code' | null).
 *
 * The free Telegram bot (owner 2026-10-13, src/lib/thirtyda-telegram-bot.mjs): no code is typed. POST
 * /auth/telegram/start { phone, lang?, pin? } → { link: https://t.me/<bot>?start=<token> } + a browser cookie; the
 * person shares their own number with the bot (POST /30da/api/telegram/hook, Telegram's secret header); GET
 * /auth/telegram/status from the SAME browser → { state: waiting | verified | mismatch | expired | none }, and
 * verified signs in exactly like a good verify-code (signInWithPhone, the waiting PIN carried), once.
 *
 * Google / Facebook / TikTok sign-in (src/lib/thirtyda-signin.mjs): GET /30da/api/auth/<provider>/start → the provider →
 * GET /30da/api/auth/<provider>/callback → 302 to /30da/#/create (new person) or /30da/#/nearby (returning person),
 * or back to the phone step with ?signin=<provider>&error=<cancelled|expired|unavailable|failed|too_many>.
 * The admin's "Try sign-in" ends on a small result page instead and makes no user or session.
 * The native apps (owner 2026-10-13, src/lib/thirtyda-signin.mjs): the app's web view POSTs /auth/app/begin (a binder
 * cookie of that web view + { url }), its sign-in sheet (own cookies) goes to the provider and the callback signs nobody
 * in there — it hands a one-time ticket to the app (iOS: 302 sg.ggmt.thirtyda://auth?t=<t>; Android: a page with an
 * intent:// link), and the web view finishes it at GET /30da/api/auth/app?t=<t> only with the same binder (appClaim).
 *
 * The PIN lock (owner 2026-10-13, src/lib/thirtyda-pin.mjs): a 4-digit PIN locks the app. A profile's session
 * is open only after a sign-in or the PIN, and only while the person really uses the app (2 minutes without
 * real activity → locked; the app itself covers after 30 s and POSTs /me/lock). While locked, every data
 * route answers 423 { error:'locked' }: POST /me/unlock { pin }, POST /me/pin { pin, old? } (set / change),
 * POST /me/pin/forgot (signs out) and /auth/* stay open. 5 wrong PINs end the session. GET /me/pending stays
 * open too: { count } only, never use, so a hidden, locked app can still say "something new is waiting".
 *
 * "Verify to chat" (owner 2026-10-13, src/lib/thirtyda-verify.mjs): POST /profile { …, unverified: true } makes a
 * profile with nothing verified (and its own fresh session), a few per address per day. Such a profile browses
 * Nearby and profiles, but every route that talks to someone (TALK_ROUTES) answers 403 { error:'verify_needed' }
 * until it has a verified way. Verifying from it attaches to it; a number / account another profile has → refused
 * (verify-code 409 phone_in_use, Telegram status { state:'in_use' }, Google / Facebook / TikTok → 302
 * /30da/#/verified?signin=<provider>&error=in_use). Its other sign-ins come back to /30da/#/verified?…&ok=1 | &error=….
 * Public pages Google / Facebook / TikTok ask for: GET /30da/privacy, GET /30da/delete-data, GET /30da/terms
 * (src/lib/thirtyda-pages.mjs).
 */

import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { getDb } from "./mongo.ts";
import { savePhoto, readPhoto, deletePhoto, isPhotoId, PhotoError } from "./thirtyda-photos.mjs";
import { translate, translateAll, translateEnabled } from "./thirtyda-translate.mjs";
import { areaFor, haversineKm } from "./thirtyda-geo.mjs";
import { clientIp } from "./thirtyda-net.mjs";
import { guestLimiter, guestPoint, guestCard, GUEST_LIMIT } from "./thirtyda-guest.mjs";
import { CODE_CHANNELS, DEFAULT_CHANNEL, CHANNEL_NAMES, channelOffered, testCodesAllowed, deliverCode } from "./thirtyda-code-send.mjs";
import {
  SIGNIN_PROVIDERS, SIGNIN_WIRED, VERIFIED_KEY, SIGNIN_STATES, signinKeys, signinKeysSaved, signinRedirect, authorizeUrl,
  createSigninState, takeSigninState, stateCookie, readStateCookie, adminSessionAlive, signinPerson, callbackError,
  signinUserFilter, planSignin, pkcePair,
  stateHash, APP_TICKETS, APP_ERRORS, platformOf, newBinder, appCookie, readAppCookie, createAppTicket, takeAppTicket, appReturnQuery,
  appSchemeUrl, appIntentUrl,
} from "./thirtyda-signin.mjs";
import { noteSecretUse } from "./thirtyda-settings.mjs";
import { outboundFetch } from "./thirtyda-test-fetch.mjs";
import {
  TG_CHECKS, CHECK_TTL_MS, POLL_MS, botOffered, botConfig, startCheck, startLink, pollCheck, checkCookie, readCheckCookie,
  newBrowserKey, handleTelegramHook, windowLimiter,
} from "./thirtyda-telegram-bot.mjs";
import {
  PIN_LENGTH, INPUT_AGE_HEADER, checkNewPin, pinDigits, hashPin, verifyPin, lockState, lockInfo, freshSigninFields,
  legacyLockFields, activityAt, backgroundCall, passiveCall, nextActiveAt, whileLocked, pinSetPlan, afterWrongPin,
  pinHashStale,
} from "./thirtyda-pin.mjs";
import { privacyPage, deleteDataPage, termsPage, tryResultPage, appReturnPage, requestLang } from "./thirtyda-pages.mjs";
import {
  canTalk, talksToSomeone, SIGNUP_LIMITS, claimSignup, releaseSignup, verifyBackPath, ATTACH_FROM, phoneViaOf, withPhoneVia, signinsOf,
} from "./thirtyda-verify.mjs";
import {
  LANGS, LANG_ENGLISH, CONTACT_REASONS, findContactDetails, findContactDetailsAcross, charCount, checkChatMessage, checkWrittenQuestion,
  PHOTO_MAX, PHOTO_SLOT_LEVELS, photoSlotsFor, photoSlotLevel, stageOpenLevel, photoVisible,
  NAME_MIN, NAME_MAX, AGE_MIN, AGE_MAX, checkAppName, checkBirthYear,
} from "../thirtyda-app/shared/rules.js";
import {
  LEVEL_RULES, replyOptions, ROLES, questionText, answerText,
} from "../thirtyda-app/shared/questions.js";
import { questionConfig, slotsView, flatView } from "./thirtyda-questions.mjs";
import {
  convStage, L1_STAGES, openSetLevel, currentSetLevel, levelState, repliedCount, allReplied, levelComplete,
  nextStep, isMyTurn, decisionOf, afterDecisions,
} from "../thirtyda-app/shared/conversation.js";

const BASE = "/30da";
const API = "/30da/api";
const APP_DIR = new URL("../thirtyda-app/", import.meta.url);
const COOKIE = "thirtyda_s";
const SESSION_DAYS = 30;
const DEV_AUTH = process.env.THIRTYDA_DEV_AUTH === "1";
const WAIT_MINUTES = Number.parseFloat(process.env.THIRTYDA_WAIT_MINUTES ?? "");
const WAIT_MS = (Number.isFinite(WAIT_MINUTES) && WAIT_MINUTES >= 0 ? WAIT_MINUTES : 1440) * 60e3;
const BODY_MAX = 1024 * 1024;
const PHOTO_BYTES_MAX = 600 * 1024;
const OTP_WINDOW_MS = 15 * 60e3; // code lifetime and send-rate window
const OTP_RESEND_S = 30;
const OTP_SENDS = 3;
const OTP_ATTEMPTS = 5;
const IP_SENDS = 30; // per IP per window; loose because carriers put many phones behind one NAT address
const IP_GUESSES = 60; // code checks per IP per window (a right code is not counted); same NAT reasoning
const OTP_GIVE_BACKS = 2; // failed live sends per number per window that do not use up a send (see failCodeSend)
const LOC_MOVE_MS = 2 * 60e3; // one location move every 2 minutes
const LOC_DAY_MAX = 30; // location moves per 24 hours
const LOC_OFFSET_KM = [0.3, 0.5]; // every stored point sits this far from the real one (see setLocation)
const NEARBY_MAX_KM = 50;
const CHAT_SPLIT_LINES = 3; // my last chat lines read together with a new one …
const CHAT_SPLIT_MS = 10 * 60e3; // … when they are this recent

const C = {
  users: "thirtyda_users",
  sessions: "thirtyda_user_sessions",
  otps: "thirtyda_otps",
  pairs: "thirtyda_pairs",
  sets: "thirtyda_sets",
  chats: "thirtyda_chats",
  flags: "thirtyda_flags",
  counters: "thirtyda_counters",
};

const ID_PREFIX = { user: "U-", pair: "P-", set: "S-", msg: "M-", flag: "f" };
const REPORT_REASONS = { rude: "rude message", scam: "scam or money", sexual: "sexual message", other: "other" };
const GENDERS = ["man", "woman", "other"]; // Male / Female / Other

const CSP =
  "default-src 'self'; img-src 'self' data: blob:; style-src 'self' https://fonts.googleapis.com; " +
  "font-src https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'";
const MIME = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  ico: "image/x-icon",
  webmanifest: "application/manifest+json",
};
const STATIC_RE = /^\/30da\/((?:screens\/|shared\/)?[A-Za-z0-9][\w.-]*\.(js|css|svg|png|ico|webmanifest))$/;
// /30da/board — every screen of the app on one page (src/thirtyda-app/board/).
const BOARD_RE = /^\/30da\/board\/([A-Za-z0-9][\w.-]*\.(html|js|css|png))$/;
// The board page holds same-origin frames of the app (board/frame.html), and only that demo frame
// may be framed — by this origin. Every other page keeps frame-ancestors 'none' + DENY.
const CSP_BOARD = CSP.replace("frame-ancestors 'none'", "frame-src 'self'; frame-ancestors 'none'");
const CSP_FRAME = CSP.replace("frame-ancestors 'none'", "frame-ancestors 'self'");

// ---------------------------------------------------------------- db

/** Indexes + id counters. Exported so the seed script can rebuild them after a wipe. */
export async function ensureThirtyDaIndexes(d) {
  await Promise.all([
    d.collection(C.users).createIndex({ location: "2dsphere" }),
    d.collection(C.users).createIndex({ phone: 1 }, { unique: true, sparse: true }),
    d.collection(C.users).createIndex({ photos: 1 }),
    // One profile per Google / Facebook account (only profiles that signed in with one carry it).
    ...SIGNIN_PROVIDERS.map((p) => d.collection(C.users).createIndex(
      { [`signin.${p}.id`]: 1 }, { unique: true, partialFilterExpression: { [`signin.${p}.id`]: { $exists: true } } })),
    d.collection(SIGNIN_STATES).createIndex({ expires: 1 }, { expireAfterSeconds: 0 }),
    // The native apps' one-time sign-in tickets (2 minutes, single use — src/lib/thirtyda-signin.mjs).
    d.collection(APP_TICKETS).createIndex({ expires: 1 }, { expireAfterSeconds: 0 }),
    // Telegram bot checks: gone 30 minutes after they expire; found by browser (status) and by Telegram user (the bot).
    d.collection(TG_CHECKS).createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0 }),
    d.collection(TG_CHECKS).createIndex({ browser: 1, created: -1 }),
    d.collection(TG_CHECKS).createIndex({ tgUserId: 1, openedAt: -1 }, { sparse: true }),
    d.collection(C.sessions).createIndex({ expires: 1 }, { expireAfterSeconds: 0 }),
    d.collection(C.otps).createIndex({ expires: 1 }, { expireAfterSeconds: 0 }),
    d.collection(C.pairs).createIndex({ key: 1 }, { unique: true, sparse: true }),
    d.collection(C.pairs).createIndex({ members: 1, updatedAt: -1 }),
    d.collection(C.sets).createIndex({ pairId: 1, level: 1, from: 1 }, { unique: true }),
    // Unverified profiles per address per day (src/lib/thirtyda-verify.mjs): each day's counters go two days later.
    d.collection(SIGNUP_LIMITS).createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0 }),
  ]);
  // Counters never fall behind ids already in use (sample data, older runs).
  const maxOf = async (coll, re) => {
    const docs = await d.collection(coll).find({}, { projection: { _id: 1 } }).toArray();
    return docs.reduce((m, x) => Math.max(m, Number(String(x._id).match(re)?.[1] ?? 0)), 0);
  };
  const floors = {
    user: Math.max(10000, await maxOf(C.users, /^U-(\d+)$/)),
    pair: await maxOf(C.pairs, /^P-(\d+)$/),
    set: await maxOf(C.sets, /^S-(\d+)$/),
    flag: await maxOf(C.flags, /^f(\d+)$/),
    msg: 0,
  };
  await Promise.all(
    Object.entries(floors).map(([k, v]) =>
      d.collection(C.counters).updateOne({ _id: k }, { $max: { seq: v } }, { upsert: true })),
  );
}

let ready = null;
async function db() {
  const d = await getDb();
  if (!ready) ready = ensureThirtyDaIndexes(d).catch((e) => { ready = null; throw e; });
  await ready;
  return d;
}

/** `n` fresh ids of one kind in a single counter round trip. */
async function nextIds(d, kind, n) {
  const doc = await d.collection(C.counters).findOneAndUpdate(
    { _id: kind }, { $inc: { seq: n } }, { upsert: true, returnDocument: "after" },
  );
  return Array.from({ length: n }, (_, i) => `${ID_PREFIX[kind]}${doc.seq - n + 1 + i}`);
}

const nextId = async (d, kind) => (await nextIds(d, kind, 1))[0];

const nowIso = () => new Date().toISOString();
const photoUrl = (id) => (id ? `${API}/photos/${id}` : null);
const heartsOf = (u) => ({ red: u?.hearts?.red ?? 0, orange: u?.hearts?.orange ?? 0 });
const round1 = (n) => Math.round(n * 10) / 10;
const round3 = (n) => Math.round(n * 1000) / 1000;

// ---------------------------------------------------------------- http

class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
const fail = (status, code, message, extra) => new ApiError(status, code, message, extra);
const notYourTurn = () => fail(409, "not_your_turn", "It is not your turn yet.");
const invalid = (message, extra = {}) => fail(422, "invalid", message, extra);

const BASE_HEADERS = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" };

function sendJson(res, status, obj, headers = {}) {
  res.writeHead(status, {
    ...BASE_HEADERS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers,
  });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  if (Number(req.headers["content-length"] || 0) > BODY_MAX) {
    req.resume();
    return Promise.reject(fail(413, "too_large", "That is too big to send."));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on("data", (c) => {
      if (done) return;
      size += c.length;
      if (size > BODY_MAX) {
        done = true;
        reject(fail(413, "too_large", "That is too big to send."));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (done) return;
      done = true;
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) return resolve({});
      try {
        const v = JSON.parse(raw);
        resolve(v && typeof v === "object" && !Array.isArray(v) ? v : {});
      } catch {
        reject(fail(400, "bad_json", "The request was not valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

// A write from another site's page is refused (the cookie is SameSite=Lax too).
function crossSite(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host !== (req.headers["x-forwarded-host"] || req.headers.host);
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------- static

async function serveStatic(req, res, rel) {
  let buf;
  try {
    buf = await readFile(new URL(rel, APP_DIR));
  } catch {
    res.writeHead(404, { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
    return;
  }
  const ext = rel.split(".").pop();
  const etag = `"${crypto.createHash("sha1").update(buf).digest("base64url")}"`;
  const headers = { ...BASE_HEADERS, "Content-Type": MIME[ext], "Cache-Control": "no-cache", ETag: etag };
  if (ext === "html") {
    const demoFrame = rel === "board/frame.html";
    Object.assign(headers, {
      "Content-Security-Policy": demoFrame ? CSP_FRAME : rel === "board/index.html" ? CSP_BOARD : CSP,
      "X-Frame-Options": demoFrame ? "SAMEORIGIN" : "DENY",
    });
  }
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, headers).end();
    return;
  }
  res.writeHead(200, headers);
  res.end(req.method === "HEAD" ? undefined : buf);
}

// ---------------------------------------------------------------- sessions

function tokenOf(req) {
  return (req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`))?.[1] ?? null;
}

function cookieFor(req, token, maxAge) {
  const host = String(req.headers.host || "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=${BASE}; Max-Age=${maxAge}${local ? "" : "; Secure"}`;
}

async function loadSession(d, req) {
  const token = tokenOf(req);
  if (!token) return null;
  return d.collection(C.sessions).findOne({ _id: token, expires: { $gt: new Date() } });
}

/**
 * Every sign-in step gets a fresh token (no session fixation); what the old session proved carries over —
 * unless it was LOCKED (ctx.lockedSession, see handleApi): then nothing carries over, so a sign-in on a locked
 * phone never lends that profile to the new session. A sign-in is open (no PIN needed right now) and may set a
 * new PIN without the old one for a while (freshSigninFields); it clears the profile's wrong-PIN count.
 */
async function startSession(ctx, fields) {
  const { d, session } = ctx;
  const old = session ?? ctx.lockedSession ?? null;
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  const doc = {
    _id: token,
    userId: session?.userId ?? null,
    phone: session?.phone ?? null,
    phoneVerified: Boolean(session?.phoneVerified),
    // How this browser proved its phone (kept until Create profile puts it on the profile as phoneVia).
    ...(phoneViaOf(session?.phoneVia) ? { phoneVia: session.phoneVia } : {}),
    verified: { gmail: Boolean(session?.verified?.gmail), facebook: Boolean(session?.verified?.facebook), tiktok: Boolean(session?.verified?.tiktok) },
    // The Google / Facebook account(s) this browser proved, kept until Create profile puts them on the profile.
    ...(session?.signin ? { signin: session.signin } : {}),
    ...fields,
    ...freshSigninFields(now),
    created: new Date(now),
    expires: new Date(now + SESSION_DAYS * 864e5),
  };
  await d.collection(C.sessions).insertOne(doc);
  if (old) await d.collection(C.sessions).deleteOne({ _id: old._id });
  if (doc.userId) await d.collection(C.users).updateOne({ _id: doc.userId }, { $set: { pinTries: 0 } });
  ctx.session = doc;
  ctx.lockedSession = null;
  ctx.headers["Set-Cookie"] = cookieFor(ctx.req, token, SESSION_DAYS * 86400);
  return doc;
}

// ---------------------------------------------------------------- views

/**
 * A person's photo slots as stored: `photos[i]` is the photo in slot i+1, or null for an empty slot.
 * Slots never move: removing a photo leaves its slot empty, so every photo keeps the level its owner
 * put it at (slot 1 = main face photo for everyone, slot 2 = Level 2, slots 3–4 = Level 3).
 */
const slotsOf = (u) => (Array.isArray(u?.photos) ? u.photos.slice(0, PHOTO_MAX) : []);
const filledCount = (u) => slotsOf(u).filter(Boolean).length;
/** The lowest empty slot index below `limit`, or -1. */
function emptySlot(photos, limit) {
  for (let i = 0; i < Math.min(limit, PHOTO_MAX); i++) if (!photos[i]) return i;
  return -1;
}
/** Slot-aligned photo urls ([url|null]), without trailing empty slots. */
function slotUrls(u) {
  const urls = slotsOf(u).map((id) => photoUrl(id ?? null));
  while (urls.length && !urls.at(-1)) urls.pop();
  return urls;
}

export function meView(u) {
  return {
    id: u._id,
    name: u.name,
    realName: u.realName ?? "",
    role: u.role ?? null,
    gender: u.gender ?? null,
    lang: u.lang ?? "en",
    phone: u.phone ?? null,
    // Typed on Create profile but never proved by a code (only its owner sees it; chat still needs verified.phone).
    phoneUnverified: u.phone ? null : u.phoneUnverified ?? null,
    // Set once (sign-up, or once on #/me for profiles made before the rule); only ever shown to its owner.
    birthYear: Number.isInteger(u.birthYear) ? u.birthYear : null,
    verified: { phone: Boolean(u.verified?.phone), gmail: Boolean(u.verified?.gmail), facebook: Boolean(u.verified?.facebook), tiktok: Boolean(u.verified?.tiktok) },
    // Which way last proved the phone ('telegram' | 'whatsapp' | 'sms'; null = not known: verified before it was kept).
    phoneVia: u.verified?.phone && u.phone ? phoneViaOf(u.phoneVia) : null,
    // The Google / Facebook / TikTok accounts on this profile — booleans only, never the ids.
    signins: signinsOf(u),
    // Slot-aligned: photos[i] is slot i+1's url, or null for an empty slot (trailing empty slots left out).
    photos: slotUrls(u),
    // Slots unlock by level (1 → 1, 2 → 2, 3 → 4). Photos kept from before the rule stay even past `allowed`.
    // All 4 can be uploaded at any time (Gamini 2026-10-13); who SEES them still goes by level.
    photoSlots: { max: PHOTO_MAX, allowed: PHOTO_MAX, levels: [...PHOTO_SLOT_LEVELS], filled: filledCount(u) },
    area: u.area ?? "",
    city: u.city ?? "",
    hearts: heartsOf(u),
    level: u.level ?? 1,
    blocked: Boolean(u.blocked),
    // A PIN locks the app on this phone (the PIN itself and its hash never leave the server).
    pinSet: Boolean(u.pinHash),
  };
}

/**
 * The owner's photos one viewer may see (slot order, empty slots skipped), and the ones still locked
 * for them (slot + level only — never an id or url). Visibility is bound to the slot, never to a
 * position in a list. A blocked owner shows nothing to anyone else.
 */
function photosFor(owner, { isOwner = false, openLevel = 1 } = {}) {
  const photos = [];
  const lockedPhotos = [];
  if (!isOwner && owner?.blocked) return { photos, lockedPhotos };
  slotsOf(owner).forEach((id, i) => {
    if (!id) return;
    if (isOwner || photoVisible(i, openLevel)) photos.push(photoUrl(id));
    else lockedPhotos.push({ slot: i + 1, level: photoSlotLevel(i) });
  });
  return { photos, lockedPhotos };
}

const unseenNotices = (u) => (u.notices || []).filter((n) => !n.seenAt);

/**
 * A pair nobody has sent anything in yet is a draft of whoever opened it. Old pairs: 'l1_ask' was the
 * draft and 'l1_answer' had a Level 1 set; new pairs are 'l1' until `startedAt` (the first set sent).
 */
const isDraft = (pair) => pair.stage === "l1_ask" || (pair.stage === "l1" && !pair.startedAt);

/** The pair's stage as the conversation sees it ('l1' for old 'l1_ask' / 'l1_answer'). */
const stageOf = (pair) => convStage(pair.stage);

/** { mine, theirs } at `level` from this pair's sets: the set I sent and the set sent to me. */
function setsAt(sets, level, meId, otherId) {
  if (!level) return { mine: null, theirs: null };
  return {
    mine: sets.find((s) => s.level === level && s.from === meId) ?? null,
    theirs: sets.find((s) => s.level === level && s.from === otherId) ?? null,
  };
}

/**
 * PairView for `me`. `sets` = this pair's sets (questions/answers may be projected to their `n`).
 * next: 'send' | 'reply' | 'send_reply' | 'wait_them' | 'wait_timer' | 'decide' | 'chat' | 'ended' | 'frozen'
 * (shared/conversation.js); turn = my turn (I can send my set for the open level, their set to me has lines
 * without my reply, I still have to choose after Level 2, or the chat's last line is theirs) — the red dot
 * and the heartbeat's actions. decision = MY choice after Level 2 (true open / false forget / null); the
 * other person's choice is never shown, and an ended conversation never says who ended it.
 */
function pairView(pair, me, other, sets) {
  // A draft is shown to each side as their own ("a", opened when they tapped), so nothing tells B that A tapped first.
  const draft = isDraft(pair);
  const role = draft || pair.a === me._id ? "a" : "b";
  const otherId = pair.a === me._id ? pair.b : pair.a;
  const stage = stageOf(pair);
  const frozen = !other || Boolean(other.blocked);
  const open = setsAt(sets, openSetLevel(stage), me._id, otherId);
  const cur = setsAt(sets, currentSetLevel(stage), me._id, otherId);
  const total = (s) => s?.questions?.length || 5;
  const decided = decisionOf(pair.decisions, me._id);
  const next = nextStep({ stage, mine: open.mine, theirs: open.theirs, frozen, decided });
  const lastFrom = pair.lastChat ? (pair.lastChat.from === me._id ? "me" : "them") : null;
  const curLevel = currentSetLevel(stage);
  const replies = (level) => sets.filter((s) => s.level === level).reduce((n, s) => n + repliedCount(s), 0);

  return {
    id: pair._id,
    stage,
    level: pair.level ?? stageOpenLevel(stage),
    role,
    other: other
      ? { id: other._id, name: other.name, gender: other.gender ?? null, lang: other.lang ?? "en", photo: other.blocked ? null : photoUrl(other.photos?.[0]) }
      : { id: otherId, name: "", gender: null, lang: "en", photo: null },
    l2OpensAt: pair.l2OpensAt ?? null,
    l3OpensAt: pair.l3OpensAt ?? null,
    decision: stage === "l3_decide" || stage === "l3_open" || stage === "ended" ? decided : null,
    endedAt: stage === "ended" ? pair.endedAt ?? null : null,
    remind: Boolean(pair.remind?.[me._id]),
    next,
    turn: !frozen && isMyTurn(next, lastFrom),
    // The current level (the open one, or the one just finished while waiting); null at Level 3.
    myOutgoing: curLevel
      ? { level: curLevel, sent: Boolean(cur.mine), answered: Boolean(cur.mine?.completedAt), replied: repliedCount(cur.mine), total: total(cur.mine) }
      : null,
    myIncoming: curLevel
      ? { level: curLevel, received: Boolean(cur.theirs), answered: Boolean(cur.theirs?.completedAt), replied: repliedCount(cur.theirs), total: total(cur.theirs) }
      : null,
    recap: { l1: { answered: replies(1), total: 10 }, l2: { answered: replies(2), total: 10 } },
    lastFrom,
    updatedAt: draft ? pair.opened?.[me._id] ?? pair.createdAt : pair.updatedAt,
  };
}

/** A draft is hidden from the other person until they open it themselves (tap Start a conversation). */
const hiddenFrom = (pair, me) => isDraft(pair) && pair.a !== me._id && !pair.opened?.[me._id];

/**
 * Move l2_wait → l2_open once its time has come. A pair from before the choice (l3_wait: Level 2 done, the
 * old 24 h wait for the chat) moves to l3_decide at once: both people choose, like every pair after Level 2.
 */
async function settle(d, pair) {
  if (pair.stage === "l3_wait") {
    const moved = await d.collection(C.pairs).findOneAndUpdate(
      { _id: pair._id, stage: "l3_wait" }, { $set: { stage: "l3_decide", level: 2 } }, { returnDocument: "after" },
    );
    return settle(d, moved ?? await d.collection(C.pairs).findOne({ _id: pair._id }));
  }
  const now = Date.now();
  let to = null;
  if (pair.stage === "l2_wait" && Date.parse(pair.l2OpensAt) <= now) to = { stage: "l2_open", level: 2, at: pair.l2OpensAt };
  if (!to) return pair;
  // A frozen pair (someone is blocked) keeps its stage and levels; it moves on once the block is lifted.
  if (await d.collection(C.users).countDocuments({ _id: { $in: pair.members }, blocked: true }, { limit: 1 })) return pair;
  const moved = await d.collection(C.pairs).findOneAndUpdate(
    { _id: pair._id, stage: pair.stage },
    { $set: { stage: to.stage, level: to.level, updatedAt: to.at } },
    { returnDocument: "after" },
  );
  if (!moved) return settle(d, await d.collection(C.pairs).findOne({ _id: pair._id }));
  await Promise.all([
    d.collection(C.users).updateMany({ _id: { $in: pair.members } }, { $max: { level: to.level } }),
    d.collection(C.chats).updateOne({ _id: pair._id }, { $max: { level: to.level } }),
  ]);
  return settle(d, moved);
}

/**
 * users.level = the highest level `me` has OPENED with anyone (l2_open / l3_decide → 2, l3_open → 3, an
 * ended conversation the level it reached, else 1). Pairs whose timer has run out are settled first, so
 * a level that just opened counts at once. The stored field (the admin's column) is corrected when it
 * disagrees. Returns `me`.
 */
async function syncLevel(d, me) {
  const pairs = d.collection(C.pairs);
  const due = await pairs.find({ members: me._id, stage: { $in: ["l2_wait", "l3_wait"] } }).toArray();
  await Promise.all(due.map((p) => settle(d, p)));
  const open = await pairs
    .find({ members: me._id, stage: { $in: ["l2_open", "l3_wait", "l3_decide", "l3_open", "ended"] } }, { projection: { stage: 1, level: 1 } })
    .toArray();
  const level = open.reduce((m, p) => Math.max(m, p.stage === "ended" ? Math.min(2, Number(p.level) || 2) : stageOpenLevel(p.stage)), 1);
  if (me.level !== level) {
    await d.collection(C.users).updateOne({ _id: me._id }, { $set: { level } });
    me.level = level;
  }
  return me;
}

/** The level two people have opened together, for photos (1 without a pair). Settles the pair first. */
async function openLevelBetween(d, viewerId, ownerId) {
  const pair = await d.collection(C.pairs).findOne({ members: { $all: [viewerId, ownerId] } });
  return pair ? stageOpenLevel((await settle(d, pair)).stage) : 1;
}

const SET_SUMMARY = { pairId: 1, level: 1, from: 1, to: 1, completedAt: 1, "answers.n": 1, "questions.n": 1 };
const OTHER_FIELDS = { name: 1, gender: 1, lang: 1, photos: 1, blocked: 1 };

async function viewsFor(d, me, pairs) {
  pairs = await Promise.all(pairs.map((p) => settle(d, p)));
  if (!pairs.length) return [];
  const otherOf = (p) => (p.a === me._id ? p.b : p.a);
  const [others, sets] = await Promise.all([
    d.collection(C.users).find({ _id: { $in: pairs.map(otherOf) } }, { projection: OTHER_FIELDS }).toArray(),
    d.collection(C.sets).find({ pairId: { $in: pairs.map((p) => p._id) } }, { projection: SET_SUMMARY }).toArray(),
  ]);
  const byId = new Map(others.map((u) => [u._id, u]));
  return pairs.map((p) => pairView(p, me, byId.get(otherOf(p)), sets.filter((s) => s.pairId === p._id)));
}

async function viewOf(d, me, pair) {
  return (await viewsFor(d, me, [pair]))[0];
}

/** Load one of my pairs (settled) and the other person. `write` refuses frozen pairs. */
async function pairFor(ctx, id, { write = false } = {}) {
  const { d, me } = ctx;
  const found = await d.collection(C.pairs).findOne({ _id: id, members: me._id });
  if (!found || hiddenFrom(found, me)) throw fail(404, "not_found", "No such conversation.");
  const pair = await settle(d, found);
  const other = await d.collection(C.users).findOne({ _id: pair.a === me._id ? pair.b : pair.a });
  if (write && (!other || other.blocked)) throw fail(409, "other_blocked", "This conversation is closed.");
  return { pair, other };
}

// ---------------------------------------------------------------- chat log (admin reads it)

async function appendMessages(d, pair, messages) {
  await d.collection(C.chats).updateOne(
    { _id: pair._id },
    {
      $push: { messages: { $each: messages } },
      $setOnInsert: { id: pair._id, a: pair.a, b: pair.b, level: pair.level ?? 1 },
    },
    { upsert: true },
  );
}

/**
 * A message the rules refused: kept in the chat log with stopped:true and an
 * open `stopped` flag so the admin can act. Never shown to either user.
 */
async function recordStopped(ctx, pair, other, { text, level, kind, hits, reason }) {
  const { d, me } = ctx;
  const lang = me.lang ?? "en";
  const [flagId, msgId, english] = await Promise.all([
    nextId(d, "flag"),
    nextId(d, "msg"),
    lang === "en" ? null : translate(text, lang, "en"),
  ]);
  const h = hits?.[0];
  const hit = h ? (text.includes(h.match) ? h.match : text.slice(h.start, h.end)) : null;
  const at = nowIso();
  await appendMessages(d, pair, [{
    id: msgId, from: me._id, at, kind, level, text, lang, english, translations: { [lang]: text },
    hit, flagId, stopped: true,
  }]);
  await d.collection(C.flags).insertOne({
    _id: flagId, id: flagId, chatId: pair._id, from: me._id, to: other._id, at, reason: reason || "Contact details shared",
    kind: "stopped", status: "open", warned: false,
  });
}

const plainHits = (hits) => hits.map(({ type, match, start, end }) => ({ type, match, start, end }));

/**
 * Contact details split over several texts that pass one by one ("My number starts 012" …
 * "887" … "766"): the texts are read together. On a hit the joined texts are kept as one
 * stopped message (the admin sees the whole attempt) and 422 points at the first text.
 */
async function stopSplitContactDetails(ctx, pair, other, texts, { level, kind }) {
  const used = texts.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
  if (used.length < 2) return;
  const c = findContactDetailsAcross(used.map((i) => texts[i]));
  if (c.ok) return;
  await recordStopped(ctx, pair, other, { text: c.text, level, kind, hits: c.hits, reason: c.reason });
  throw fail(422, "contact_detail", c.reason || "Contact details are not allowed.", {
    index: used[c.hits[0].index], hits: plainHits(c.hits), reason: c.reason,
  });
}

/** Contact details anywhere in `texts` → stop + record the first one and throw 422. */
async function stopContactDetails(ctx, pair, other, texts, { level, kind }) {
  for (let i = 0; i < texts.length; i++) {
    if (texts[i] == null) continue;
    const text = String(texts[i]).trim();
    const c = findContactDetails(text);
    if (c.ok) continue;
    await recordStopped(ctx, pair, other, { text, level, kind, hits: c.hits, reason: c.reason });
    throw fail(422, "contact_detail", c.reason || "Contact details are not allowed.", {
      index: i, hits: c.hits, reason: c.reason,
    });
  }
}

// Translations missing at write time (provider down) are filled in when someone reads them.
async function backfillSet(d, set, lang) {
  if (!translateEnabled()) return;
  const jobs = [];
  for (const q of set.questions || []) {
    if (q.source === "written" && q.lang !== lang && !q.translations?.[lang]) {
      jobs.push(translate(q.text, q.lang, lang).then(async (tr) => {
        if (!tr) return;
        (q.translations ??= {})[lang] = tr;
        await d.collection(C.sets).updateOne(
          { _id: set._id }, { $set: { [`questions.$[q].translations.${lang}`]: tr } }, { arrayFilters: [{ "q.n": q.n }] },
        );
      }));
    }
  }
  for (const a of set.answers || []) {
    if (a.text && a.lang !== lang && !a.translations?.[lang]) {
      jobs.push(translate(a.text, a.lang, lang).then(async (tr) => {
        if (!tr) return;
        (a.translations ??= {})[lang] = tr;
        await d.collection(C.sets).updateOne(
          { _id: set._id }, { $set: { [`answers.$[a].translations.${lang}`]: tr } }, { arrayFilters: [{ "a.n": a.n }] },
        );
      }));
    }
  }
  await Promise.all(jobs);
}

async function backfillMessages(d, pairId, messages, lang) {
  if (!translateEnabled()) return;
  await Promise.all(messages.filter((m) => m.lang !== lang && !m.translations?.[lang]).map(async (m) => {
    const tr = await translate(m.text, m.lang, lang);
    if (!tr) return;
    (m.translations ??= {})[lang] = tr;
    const set = { [`messages.$[m].translations.${lang}`]: tr };
    if (lang === "en") set["messages.$[m].english"] = tr;
    await d.collection(C.chats).updateOne({ _id: pairId }, { $set: set }, { arrayFilters: [{ "m.id": m.id }] });
  }));
}

// ---------------------------------------------------------------- validation helpers

const DIGITS = { "០": 0, "១": 1, "២": 2, "៣": 3, "៤": 4, "៥": 5, "៦": 6, "៧": 7, "៨": 8, "៩": 9 };

/** E.164, +855 by default. null when it does not look like a phone number. (The admin's test send uses it too.) */
export function normalizePhone(raw) {
  let s = String(raw ?? "")
    .replace(/[០-៩]/g, (c) => String(DIGITS[c]))
    .replace(/[０-９＋]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s().-]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  else if (s.startsWith("0")) s = `+855${s.slice(1)}`;
  else if (!s.startsWith("+")) s = s.startsWith("855") && s.length >= 11 ? `+${s}` : `+855${s}`;
  if (!/^\+[1-9]\d{7,14}$/.test(s)) return null;
  if (s.startsWith("+855") && !/^\+855[1-9]\d{7,8}$/.test(s)) return null;
  return s;
}

const hashCode = (phone, code) => crypto.createHash("sha256").update(`${phone}:${code}`).digest("hex");

function safeEqualHex(a, b) {
  const x = Buffer.from(String(a), "hex");
  const y = Buffer.from(String(b), "hex");
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

/** App name: 2–7 characters, the user's own pick, never a contact detail (that is checked first). */
function checkName(raw) {
  const c = checkAppName(raw);
  if (c.error === "contact") throw fail(422, "contact_detail", c.reason, { field: "name", hits: c.hits, reason: c.reason });
  if (!c.ok) throw invalid(`Your app name needs ${NAME_MIN} to ${NAME_MAX} characters.`, { field: "name", min: NAME_MIN, max: NAME_MAX });
  return c.name;
}

/** Birth year: from the list of ages 30–80 (Phnom Penh's year). Younger → 422 too_young. */
function checkBirth(raw) {
  const c = checkBirthYear(raw);
  if (c.error === "too_young") {
    throw fail(422, "too_young", `30+DA is for people aged ${AGE_MIN} and over.`, { field: "birthYear", minAge: AGE_MIN });
  }
  if (c.error === "missing") throw invalid("Choose your birth year.", { field: "birthYear" });
  if (!c.ok) throw invalid("Choose your birth year from the list.", { field: "birthYear", minAge: AGE_MIN, maxAge: AGE_MAX });
  return c.year;
}

const checkLang = (lang) => {
  if (!LANGS.includes(lang)) throw invalid("Choose one of the five languages.", { field: "lang" });
  return lang;
};
const checkRole = (role) => {
  if (!ROLES.some((r) => r.key === role)) throw invalid("Choose what you do.", { field: "role" });
  return role;
};

/** data:image/...;base64 → Buffer (≤ 600 KB). */
function decodePhoto(dataUrl) {
  const m = String(dataUrl ?? "").match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!m) throw invalid("Add a photo (JPEG, PNG or WebP).", { field: "photo" });
  const buf = Buffer.from(m[2], "base64");
  if (!buf.length) throw invalid("Add a photo.", { field: "photo" });
  if (buf.length > PHOTO_BYTES_MAX) throw fail(413, "photo_too_large", "That photo is too big. Try a smaller one.", { field: "photo" });
  return buf;
}

async function storePhoto(dataUrl) {
  try {
    return await savePhoto(decodePhoto(dataUrl));
  } catch (err) {
    if (err instanceof PhotoError) throw invalid(err.message, { field: "photo" });
    throw err;
  }
}

const levelParam = (v) => {
  const level = Number(v);
  if (level !== 1 && level !== 2) throw invalid("Level must be 1 or 2.", { field: "level" });
  return level;
};

const ERROR_TEXT = {
  empty: "Write something first.",
  too_short: "Write 20 to 30 characters.",
  too_long: "That is too long.",
  trivial: "Say a little more than yes, ok, hi or bye.",
};

// ---------------------------------------------------------------- auth handlers

const ipSends = new Map(); // ip -> [timestamps]
const ipGuesses = new Map(); // ip -> [timestamps] of code checks (verify-code)
const giveBacks = new Map(); // phone -> [timestamps] of failed live sends that were given back
const ipSigninStarts = new Map(); // ip -> [timestamps] of Google / Facebook sign-ins started
const ipSigninReturns = new Map(); // ip -> [timestamps] of returns from Google / Facebook
const ipSigninClaims = new Map(); // ip -> [timestamps] of the native apps' ticket claims (GET /auth/app)

/** Timestamps of `key` still inside the window (the list is stored back, pruned). */
function inWindowFor(map, key, now) {
  const list = (map.get(key) || []).filter((t) => now - t < OTP_WINDOW_MS);
  map.set(key, list);
  return list;
}
/** Drop keys with nothing left in the window, so the limiter maps cannot grow without end. */
setInterval(() => {
  const now = Date.now();
  for (const map of [ipSends, ipGuesses, giveBacks, ipSigninStarts, ipSigninReturns, ipSigninClaims]) {
    for (const [key, list] of map) if (!list.some((t) => now - t < OTP_WINDOW_MS)) map.delete(key);
  }
}, OTP_WINDOW_MS).unref();

/** true (and counted) when this number may have one more failed live send given back in this window. */
function takeGiveBack(phone, now) {
  const list = inWindowFor(giveBacks, phone, now);
  if (list.length >= OTP_GIVE_BACKS) return false;
  list.push(now);
  return true;
}

/**
 * Who gets the code where: the person picks Telegram (default) or WhatsApp on the phone step. `other` is the
 * other channel's name only when it really works; null → the words never send people to a channel that is off.
 */
const CHANNEL_FAILED_TEXT = {
  not_on: (name, other) => `We could not send a ${name} code to this number. Check the number${other ? `, or get the code by ${other}` : ""}.`,
  unavailable: (name, other) => `${name} codes are not working right now. ${other ? `Try ${other}.` : "Please try again in a little while."}`,
};

/** Google / Facebook really sign people in: the sign-in is built and its keys are saved (and readable). */
async function signinReady(d, provider) {
  return Boolean(SIGNIN_WIRED[provider]) && (await signinKeysSaved(d, provider).catch(() => false));
}

/**
 * GET /auth/methods → which of the phone step's buttons work right now:
 *   { code: { telegram, whatsapp }, signin: { google, facebook, tiktok }, signinTest: { google, facebook, tiktok } } (booleans).
 * A code channel works when it is OFFERED (live and a test code went through since its keys were saved, and no
 * lasting failure since — channelOffer), or (test mode only) while no channel is set up at all — the same rule
 * send-code applies. Google / Facebook work once their keys are saved (the real sign-in: the app goes to
 * /auth/<provider>/start); in test mode without keys they keep the instant test sign-in (signinTest: the app
 * calls POST /auth/verify-social). Otherwise the app shows "Coming soon". Nothing here is secret.
 * telegram: which Telegram the button is — 'bot' (the free 30+DA bot is saved and its Try passed: no code, the
 * person shares their number with the bot, /auth/telegram/start), 'code' (a 6-digit code: the Gateway passed its
 * test, or test mode) or null (off). The bot wins when both work.
 */
async function authMethods(ctx) {
  const { d } = ctx;
  const testCodes = await testCodesAllowed(d, DEV_AUTH);
  const code = {};
  for (const channel of CODE_CHANNELS) code[channel] = testCodes || (await channelOffered(d, channel));
  const bot = await botOffered(d).catch(() => false);
  const telegram = bot ? "bot" : code.telegram ? "code" : null;
  code.telegram = Boolean(telegram);
  const signin = {};
  const signinTest = {};
  for (const provider of SIGNIN_PROVIDERS) {
    const real = await signinReady(d, provider);
    signin[provider] = real || DEV_AUTH;
    signinTest[provider] = !real && DEV_AUTH;
  }
  return { code, telegram, signin, signinTest };
}

/**
 * POST /auth/send-code { phone, channel:'telegram'|'whatsapp' } (channel defaults to telegram).
 * Offered channel (keys saved on the admin Code page AND a test code went through since, with no lasting failure
 * since — channelOffer in src/lib/thirtyda-code-send.mjs) → the code really goes out and is never
 * returned, test mode or not. Saved but not offered → 503 channel_unavailable, never an on-screen code. The new code is claimed PENDING: verify-code checks nothing against it (nor
 * against the number's older code) until Telegram / WhatsApp has accepted it, so a send that fails was never
 * guessable. If delivery fails → 422 channel_failed { channel, reason: 'not_on_telegram' | 'not_on_whatsapp' |
 * 'unavailable' (everything else, incl. WhatsApp's not_allowed: a setup problem, not the person's number),
 * message } (never a devCode, never the provider's own words): the number's older code comes back
 * exactly as it was (its tries already used stay used), and the send itself is given back (no 30 s wait,
 * no use of its 3 per 15 minutes) at most OTP_GIVE_BACKS times per number per 15 minutes; after that a
 * failed send counts like a sent one. The address's count always stays used.
 * Not live → on-screen test code (devCode for the "Test code" note) only when THIRTYDA_DEV_AUTH=1 and no
 * code channel is set up at all (testCodesAllowed); otherwise 503 channel_unavailable.
 */
async function sendCode(ctx) {
  const { d, body, req } = ctx;
  const phone = normalizePhone(body.phone);
  if (!phone) throw invalid("That phone number does not look right.", { field: "phone" });
  const channel = body.channel == null || body.channel === "" ? DEFAULT_CHANNEL : body.channel;
  if (!CODE_CHANNELS.includes(channel)) throw invalid("Choose Telegram or WhatsApp.", { field: "channel" });
  const name = CHANNEL_NAMES[channel];
  const otherKey = CODE_CHANNELS.find((c) => c !== channel);
  // Live AND offered (a test code went through since the keys were saved, no lasting failure since): see channelOffer.
  const live = await channelOffered(d, channel);
  if (!live && !(await testCodesAllowed(d, DEV_AUTH))) {
    throw fail(503, "channel_unavailable", `Codes by ${name} are not available yet.`, { channel });
  }

  const now = Date.now();
  const ip = clientIp(req);
  const recent = inWindowFor(ipSends, ip, now);
  if (recent.length >= IP_SENDS) throw fail(429, "rate_limited", "Too many codes. Try again in 15 minutes.");
  // Counted before any await, so parallel requests from one address all see each other.
  recent.push(now);

  const code = String(crypto.randomInt(0, 1e6)).padStart(6, "0");
  const codeHash = hashCode(phone, code);
  let claim;
  try {
    claim = await claimCodeSend(d, phone, codeHash, now, { pending: live, channel });
  } catch (err) {
    const list = ipSends.get(ip) || [];
    const k = list.indexOf(now);
    if (k >= 0) list.splice(k, 1); // nothing was sent: give the address its turn back
    throw err;
  }

  if (live) {
    let sent;
    try {
      sent = await deliverCode(channel, phone, code, { d, fetchImpl: outboundFetch() });
    } catch (err) {
      sent = { ok: false, reason: "other", detail: err instanceof Error ? err.message.slice(0, 80) : "error" };
    }
    if (sent.ok) {
      // Delivered: only now can the code be checked.
      await d.collection(C.otps).updateOne({ _id: phone, codeHash, pending: true }, { $unset: { pending: "" } });
      return { ok: true, phone, channel, live: true, resendIn: OTP_RESEND_S };
    }
    const givenBack = takeGiveBack(phone, now);
    try {
      await failCodeSend(d, phone, codeHash, claim.prev, { givenBack });
    } catch (err) {
      console.error("[30da api] could not clear a failed code send:", err instanceof Error ? err.message : err);
    }
    console.warn(`[30da api] ${channel} code not delivered: ${sent.reason}${sent.detail ? ` (${sent.detail})` : ""}${givenBack ? "" : " · send counted"}`);
    const notOn = sent.reason === "not_on_telegram" || sent.reason === "not_on_whatsapp";
    const reason = notOn ? sent.reason : "unavailable";
    // This channel is live, so test codes are off: the other one works only if it is live too.
    const other = (await channelOffered(d, otherKey).catch(() => false)) ? CHANNEL_NAMES[otherKey] : null;
    throw fail(422, "channel_failed", CHANNEL_FAILED_TEXT[notOn ? "not_on" : "unavailable"](name, other), { channel, reason });
  }
  // Not live (test mode with no channel set up, checked above): the code comes back for the "Test code" note.
  return { ok: true, phone, channel, live: false, resendIn: OTP_RESEND_S, devCode: code };
}

/**
 * A pending send whose delivery failed (only our own claim: same codeHash, still pending). The undelivered
 * code is never left checkable. Nothing was checked while it was pending, so the record from before the
 * claim (`prev`) still has the right tries count: putting it back never lowers it.
 *   givenBack → the record is exactly as before the claim (older code, its tries, its sends and 30 s gap);
 *               no record before → none now.
 *   otherwise → the send stays counted (sentAt, sends) but carries no code: the older code is dropped too,
 *               as asking for a new one does, so verify-code answers code_expired.
 */
async function failCodeSend(d, phone, codeHash, prev, { givenBack }) {
  const otps = d.collection(C.otps);
  const ours = { _id: phone, codeHash, pending: true };
  if (!givenBack) {
    await otps.updateOne(ours, { $unset: { codeHash: "", attempts: "", pending: "" } });
    return;
  }
  if (!prev) {
    await otps.deleteOne(ours);
    return;
  }
  const { _id, pending, ...was } = prev;
  await otps.replaceOne(ours, was);
}

/**
 * Store a new code for `phone` only if the 30 s resend gap and the 3-per-15-minutes limit allow
 * it — checked and written in one atomic update, so a burst of parallel requests gets one code,
 * not ten. Throws 429 too_soon / rate_limited otherwise. → { prev }: the record as it was before
 * (null when there was none), so a failed delivery can put it back (failCodeSend).
 * pending:true (a live channel) → the code cannot be checked until the send succeeds and clears the flag.
 */
async function claimCodeSend(d, phone, codeHash, now, { pending = false, channel = null } = {}) {
  const otps = d.collection(C.otps);
  const inWindow = {
    $filter: { input: { $ifNull: ["$sends", []] }, as: "t", cond: { $gt: ["$$t", new Date(now - OTP_WINDOW_MS)] } },
  };
  // channel: where this code goes — a good verify-code records it on the profile (phoneVia).
  const fields = { codeHash, expires: new Date(now + OTP_WINDOW_MS), attempts: 0, sentAt: new Date(now), channel: phoneViaOf(channel) };
  const claimed = await otps.findOneAndUpdate(
    {
      _id: phone,
      $expr: { $and: [{ $lte: ["$sentAt", new Date(now - OTP_RESEND_S * 1000)] }, { $lt: [{ $size: inWindow }, OTP_SENDS] }] },
    },
    [{ $set: { ...fields, pending: pending ? true : "$$REMOVE", sends: { $concatArrays: [inWindow, [new Date(now)]] } } }],
    { returnDocument: "before" },
  );
  if (claimed) return { prev: claimed };
  try {
    await otps.insertOne({ _id: phone, ...fields, ...(pending ? { pending: true } : {}), sends: [new Date(now)] });
    return { prev: null };
  } catch (err) {
    if (err?.code !== 11000) throw err; // a code exists: fall through and say why it cannot be resent
  }
  const prev = await otps.findOne({ _id: phone });
  const sentAt = prev?.sentAt ? new Date(prev.sentAt).getTime() : now;
  if (now - sentAt < OTP_RESEND_S * 1000) {
    const resendIn = Math.max(1, Math.ceil((sentAt + OTP_RESEND_S * 1000 - now) / 1000));
    throw fail(429, "too_soon", `Wait ${resendIn} s before asking for a new code.`, { resendIn });
  }
  const sends = (prev?.sends || []).map((t) => new Date(t).getTime()).filter((t) => now - t < OTP_WINDOW_MS);
  const retryIn = Math.ceil(((sends[0] ?? now) + OTP_WINDOW_MS - now) / 1000);
  throw fail(429, "rate_limited", "Too many codes for this number. Try again later.", { retryIn });
}

/**
 * POST /auth/verify-code { phone, code }. 5 tries per code (counted before comparing, so parallel guesses
 * cannot exceed it), IP_GUESSES checks per address per 15 minutes (a right code gives its check back), and
 * nothing is compared while a live send is pending (409 code_sending): a code is checkable only once delivered.
 */
async function verifyCode(ctx) {
  const { d, body, me, req } = ctx;
  const phone = normalizePhone(body.phone);
  const code = String(body.code ?? "").replace(/\D/g, "");
  if (!phone || code.length !== 6) throw invalid("Enter the 6-digit code.", { field: "code" });
  // The PIN chosen before signing in (it waited on the phone): checked before the code is used up.
  const newPin = waitingPin(body);

  const now = Date.now();
  const ip = clientIp(req);
  const guesses = inWindowFor(ipGuesses, ip, now);
  if (guesses.length >= IP_GUESSES) throw fail(429, "rate_limited", "Too many tries. Try again in 15 minutes.");
  guesses.push(now); // before any await, like the send limit

  const otps = d.collection(C.otps);
  const checkable = { _id: phone, codeHash: { $exists: true }, pending: { $ne: true }, expires: { $gt: new Date() } };
  const otp = await otps.findOneAndUpdate(
    { ...checkable, attempts: { $lt: OTP_ATTEMPTS } },
    { $inc: { attempts: 1 } },
    { returnDocument: "after" },
  );
  if (!otp) {
    const left = await otps.findOne({ _id: phone, codeHash: { $exists: true }, expires: { $gt: new Date() } });
    if (left?.pending) throw fail(409, "code_sending", "A new code is on its way. Enter the new code when it arrives.");
    if (left) throw fail(429, "too_many_attempts", "Too many tries. Ask for a new code.");
    throw fail(400, "code_expired", "That code has expired. Ask for a new one.");
  }
  if (!safeEqualHex(otp.codeHash, hashCode(phone, code))) {
    throw fail(400, "wrong_code", "That code is not right.", { attemptsLeft: Math.max(0, OTP_ATTEMPTS - otp.attempts) });
  }
  const list = ipGuesses.get(ip) || [];
  const k = list.indexOf(now);
  if (k >= 0) list.splice(k, 1); // a right code does not count against the address
  await otps.deleteOne({ _id: phone, codeHash: otp.codeHash });
  return signInWithPhone(ctx, phone, { newPin, via: otp.channel });
}

/**
 * What a PROVED phone number does — a good code (verify-code) or Telegram's own-number check (the bot's status):
 * the profile with this number is signed in; a signed-in profile without one adds it; otherwise a session that
 * carries the verified number (Create profile comes next). A returning person's waiting PIN (newPin, or already
 * hashed: newPinHash) becomes their PIN. → { ok, existing, user }.
 */
async function signInWithPhone(ctx, phone, { newPin = null, newPinHash = null, via = null } = {}) {
  const { d, me } = ctx;
  const users = d.collection(C.users);
  let user = await users.findOne({ phone });
  // "Verify to chat" (owner 2026-10-13): a profile with no verified way yet ATTACHES the number it proves. A number
  // that already belongs to another profile is refused in plain words — never a switch to it, never a merge.
  if (user && me && user._id !== me._id && !canTalk(me)) throw phoneInUse();
  const signedInByPhone = Boolean(user);
  if (!user && me) {
    // A signed-in profile (made with Google/Facebook) adds or changes its phone; the verified number replaces
    // the one typed on Create profile without a code (phoneUnverified).
    try {
      await users.updateOne({ _id: me._id }, withPhoneVia({ $set: { phone, "verified.phone": true }, $unset: { phoneUnverified: "" } }, via));
    } catch (err) {
      if (err?.code === 11000) throw phoneInUse(); // another profile took this number a moment ago
      throw err;
    }
    user = await users.findOne({ _id: me._id });
  } else if (user) {
    // Proved again (a sign-in by phone): the way it was proved this time replaces the last one.
    await users.updateOne({ _id: user._id }, withPhoneVia({ $set: { "verified.phone": true } }, via));
    user.verified = { ...user.verified, phone: true };
    user.phoneVia = phoneViaOf(via) ?? undefined;
  }
  await startSession(ctx, { userId: user?._id ?? null, phone, phoneVerified: true, phoneVia: phoneViaOf(via) });
  // A sign-in by phone plus a waiting PIN sets (or replaces) that profile's PIN: the person just proved who they are.
  if (signedInByPhone && (newPin || newPinHash)) user = await savePin(ctx, user, newPin, newPinHash);
  return { ok: true, existing: Boolean(user), user: user ? meView(user) : null };
}

const phoneInUse = () => fail(409, "phone_in_use", "This phone number already has a profile.");

// ---------------------------------------------------------------- the free Telegram bot (owner 2026-10-13)

const TG_STARTS = 30; // checks started per address per 15 minutes (loose, like send-code: NAT)
const TG_PHONE_STARTS = 6; // per typed number per 15 minutes
const TG_POLLS = 3000; // status calls per address per 15 minutes (every 2 s while waiting; many phones behind one NAT)
const TG_BROWSER_POLLS = 600; // per browser per 15 minutes (2 s polling for 10 minutes is 300, plus coming back)
const tgLimits = windowLimiter(OTP_WINDOW_MS);

/**
 * POST /auth/telegram/start { phone, lang?, pin? } — the bot must be saved and its Try passed (else 503
 * channel_unavailable). A new check (10 minutes) bound to this browser by a fresh cookie; the waiting PIN is checked
 * first and kept only hashed. → { ok, phone, link: https://t.me/<bot>?start=<token>, bot, expiresIn, pollMs, match }.
 * match ("🍊 47") is the sign the waiting box shows and the bot repeats next to the masked number and the time.
 */
async function telegramStart(ctx) {
  const { d, body, req } = ctx;
  const phone = normalizePhone(body.phone);
  if (!phone) throw invalid("That phone number does not look right.", { field: "phone" });
  const newPin = waitingPin(body);
  const cfg = (await botOffered(d)) ? await botConfig(d) : null;
  if (!cfg) throw fail(503, "channel_unavailable", "Telegram is not available yet.", { channel: "telegram" });
  const now = Date.now();
  if (tgLimits.over(`ip:${clientIp(req)}`, TG_STARTS, now) || tgLimits.over(`phone:${phone}`, TG_PHONE_STARTS, now)) {
    throw fail(429, "rate_limited", "Too many tries. Try again in 15 minutes.");
  }
  const lang = LANGS.includes(body.lang) ? body.lang : LANGS.includes(ctx.me?.lang) ? ctx.me.lang : "en";
  const browser = newBrowserKey();
  const { token, match } = await startCheck(d, {
    phone, lang, browser, previousBrowser: readCheckCookie(req), pinHash: newPin ? await hashPin(newPin) : null, now,
  });
  ctx.headers["Set-Cookie"] = checkCookie(req, browser);
  return { ok: true, phone, link: startLink(cfg.username, token), bot: cfg.username, expiresIn: CHECK_TTL_MS / 1000, pollMs: POLL_MS, match };
}

/**
 * GET /auth/telegram/status — this browser's check (its cookie): { state: waiting (opened, expiresIn) | verified |
 * mismatch | expired | none }. verified does exactly what a good verify-code does (signInWithPhone, the waiting PIN
 * carried), once; the answer then also carries { ok, existing, user } like verify-code's.
 */
async function telegramStatus(ctx) {
  const { d, req } = ctx;
  const browser = readCheckCookie(req);
  if (!browser) return { state: "none" };
  const now = Date.now();
  if (tgLimits.over(`poll:${clientIp(req)}`, TG_POLLS, now) || tgLimits.over(`browser:${browser}`, TG_BROWSER_POLLS, now)) {
    throw fail(429, "rate_limited", "Too many tries. Try again in a few minutes.");
  }
  // "Verify to chat": a number Telegram proved that belongs to another profile → { state: 'in_use' } (the check is used up).
  let inUse = false;
  let out = await pollCheck(d, browser, {
    now,
    onVerified: (check) => signInWithPhone(ctx, check.phone, { newPinHash: check.pinHash ?? null, via: "telegram" }).catch((err) => {
      if (err?.code !== "phone_in_use") throw err;
      inUse = true;
      return {};
    }),
  });
  if (inUse) out = { state: "in_use" };
  // The check is over (signed in, or said once): the browser drops its cookie, next to the new session's.
  if (out.state !== "waiting") ctx.headers["Set-Cookie"] = [ctx.headers["Set-Cookie"], checkCookie(req, "", 0)].filter(Boolean);
  return out;
}

async function verifySocial(ctx) {
  const { d, body, me } = ctx;
  const key = VERIFIED_KEY[body.provider];
  if (!key) throw invalid("Choose Google, Facebook or TikTok.", { field: "provider" });
  if (!DEV_AUTH) throw fail(503, "oauth_unavailable", "Google, Facebook and TikTok sign-in are not available yet.");
  const s = ctx.session;
  const verified = { gmail: Boolean(s?.verified?.gmail), facebook: Boolean(s?.verified?.facebook), tiktok: Boolean(s?.verified?.tiktok), [key]: true };
  await startSession(ctx, { verified });
  if (me) await d.collection(C.users).updateOne({ _id: me._id }, { $set: { [`verified.${key}`]: true } });
  return { ok: true, verified };
}

async function signout(ctx) {
  if (ctx.session) await ctx.d.collection(C.sessions).deleteOne({ _id: ctx.session._id });
  ctx.headers["Set-Cookie"] = cookieFor(ctx.req, "", 0);
  return { ok: true };
}

// ---------------------------------------------------------------- Google / Facebook sign-in (real)

const SIGNIN_STARTS = 30; // sign-ins started per address per 15 minutes (loose, like send-code: NAT)
const SIGNIN_RETURNS = 30; // returns from Google / Facebook per address per 15 minutes

/** What a session proved with Google / Facebook, as kept on a new profile: { google?: { id, email? }, facebook?: … } | null. */
function signinOf(session) {
  const out = {};
  for (const p of SIGNIN_PROVIDERS) {
    const s = session?.signin?.[p];
    if (s?.id && session?.verified?.[VERIFIED_KEY[p]]) out[p] = { id: String(s.id), ...(s.email ? { email: String(s.email) } : {}) };
  }
  return Object.keys(out).length ? out : null;
}

/** A provider's reason → what the phone step says (in the person's language, in the client). */
const APP_SIGNIN_REASON = { cancelled: "cancelled", expired: "expired", bad_keys: "unavailable", redirect: "unavailable", not_live: "unavailable" };
const appSigninReason = (reason) => APP_SIGNIN_REASON[reason] ?? "failed";
/** Reasons a real sign-in notes on the admin's card (a setup problem); a cancel or a slow network does not. */
const SIGNIN_SETUP_REASONS = new Set(["bad_keys", "redirect", "not_live"]);

function redirectTo(res, location, headers = {}) {
  res.writeHead(302, { ...BASE_HEADERS, "Cache-Control": "no-store", Location: location, ...headers }).end();
}

function sendPage(req, res, status, html, headers = {}) {
  res.writeHead(status, {
    ...BASE_HEADERS, "Content-Type": MIME.html, "Cache-Control": "no-store", "Content-Security-Policy": CSP, "X-Frame-Options": "DENY", ...headers,
  });
  res.end(req.method === "HEAD" ? undefined : html);
}

/** true when `ip` is over `max` in the window; otherwise counts this one. */
function overLimit(map, ip, max, now = Date.now()) {
  const list = inWindowFor(map, ip, now);
  if (list.length >= max) return true;
  list.push(now);
  return false;
}

const backToPhoneStep = (provider, reason) => `${BASE}/#/create?signin=${provider}&error=${reason}`;
/** A provider's ?error_description=… cut down to something safe to keep and show. */
const safeNote = (v) => String(v ?? "").replace(/[^\w .,:;()'/+-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) || null;

/** { "Set-Cookie": … } for the cookies given (a single one stays a plain string), or no header at all. */
function setCookies(...list) {
  const all = list.flat().filter(Boolean);
  return all.length ? { "Set-Cookie": all.length === 1 ? all[0] : all } : {};
}

/**
 * GET /auth/<provider>/start → 302 to Google / Facebook with a fresh single-use state and its cookie. Keys not
 * saved → back to the phone step (unavailable). SIGNIN_STARTS per address per 15 minutes (too_many).
 */
async function signinStart(req, res, url, d, provider) {
  // ?to=me: started on #/me to ADD this account to the signed-in profile (never a switch); it comes back to #/me.
  const to = ATTACH_FROM.includes(url?.searchParams?.get("to")) ? url.searchParams.get("to") : null;
  if (overLimit(ipSigninStarts, clientIp(req), SIGNIN_STARTS)) return redirectTo(res, await signinBack(d, req, provider, "too_many", to));
  const keys = SIGNIN_WIRED[provider] ? await signinKeys(d, provider) : null;
  if (!keys) return redirectTo(res, await signinBack(d, req, provider, "unavailable", to));
  // PKCE where the provider uses it (pkcePair): the verifier stays with the state, only its challenge goes out.
  const pkce = pkcePair(provider);
  const state = await createSigninState(d, provider, { verifier: pkce?.verifier, to });
  redirectTo(res, authorizeUrl(provider, { clientId: keys.id, redirectUri: signinRedirect(req, provider), state, codeChallenge: pkce?.challenge }), {
    "Set-Cookie": stateCookie(req, provider, state),
  });
}

/**
 * GET /auth/<provider>/callback?code&state (or ?error=…). The state is used up first (single use, 10 minutes, same
 * browser). A test state (the admin's "Try sign-in") ends on the result page (signinTry). Otherwise:
 * the person → completeSignin → 302 /30da/#/nearby (returning) or /30da/#/create?signin=<provider>&ok=1 (new);
 * any failure → 302 back to the phone step with ?signin=<provider>&error=<reason> (the app words it calmly).
 * A native app's state (POST /auth/app/begin): never signed in here (the sheet's cookies are not the app's) — a good
 * exchange → a one-time ticket handed to the app (appReturn), which only the web view holding the binder can claim
 * (appClaim); a failure → the app with ?error=<reason>&p=<provider>[&to=me].
 */
async function signinCallback(req, res, url, d, provider) {
  const clear = stateCookie(req, provider, "", 0);
  let to = null; // 'me': started on #/me (the state says so), it goes back there
  let app = null; // a native app's sign-in (the state says so): it ends in the app
  const back = async (reason) => (app
    ? appReturn(req, res, app.platform, { error: reason, provider, to })
    : redirectTo(res, await signinBack(d, req, provider, reason, to), { "Set-Cookie": clear }));
  if (overLimit(ipSigninReturns, clientIp(req), SIGNIN_RETURNS)) return back("too_many");
  const params = url.searchParams;
  const { ok: stateOk, rec } = await takeSigninState(d, provider, params.get("state"), readStateCookie(req));
  to = stateOk && ATTACH_FROM.includes(rec?.to) ? rec.to : null;
  if (rec?.test) return signinTry(req, res, d, provider, { rec, stateOk, params, clear });
  if (typeof rec?.app === "string") app = { platform: platformOf(rec.platform) ?? "android", hash: rec.app };
  if (!stateOk) return back("expired");
  const refused = callbackError(provider, params);
  if (refused) return back(appSigninReason(refused));
  const code = params.get("code");
  if (!code || code.length > 2048) return back("failed");
  const keys = await signinKeys(d, provider);
  if (!keys) return back("unavailable");

  const r = await signinPerson(provider, keys, code, signinRedirect(req, provider), { fetchImpl: outboundFetch(), verifier: rec?.verifier ?? null });
  if (r.ok || SIGNIN_SETUP_REASONS.has(r.reason)) {
    await noteSecretUse(d, provider, { ok: r.ok, reason: r.ok ? null : r.reason, detail: r.ok ? null : r.detail, kind: "signin" }).catch(() => {});
  }
  if (!r.ok) {
    console.warn(`[30da signin] ${provider} sign-in did not work: ${r.reason}${r.detail ? ` (${r.detail})` : ""}`);
    return back(appSigninReason(r.reason));
  }
  // A native app's sheet has its own cookies, not the app's: nothing is signed in here. The person waits under a
  // one-time ticket (2 minutes, with to=me) that only the web view holding the binder can claim (appClaim).
  if (app) {
    const ticket = await createAppTicket(d, provider, r.person, { to, app: app.hash });
    return appReturn(req, res, app.platform, { ticket, provider });
  }
  return finishSignin(req, res, d, provider, r.person, { to, clear: [clear] });
}

/**
 * A good sign-in, finished with THIS request's session: the web callback's own ending, and the native apps' claim
 * (appClaim, in the app's web view). The PIN lock rules, to=me (attach, never a switch) and "Verify to chat" apply, then 302
 * to where the person goes next. `clear`: cookies cleared on the way (the web callback's state cookie).
 */
async function finishSignin(req, res, d, provider, person, { to = null, clear = [] } = {}) {
  const back = async (reason) => redirectTo(res, await signinBack(d, req, provider, reason, to), setCookies(clear));
  const ctx = { d, req, headers: {}, session: await loadSession(d, req) };
  ctx.me = ctx.session?.userId ? await d.collection(C.users).findOne({ _id: ctx.session.userId }) : null;
  // Coming back to a LOCKED phone: the sign-in starts from nothing (it never attaches to the locked profile).
  if (ctx.session && ctx.me) {
    await upgradeSession(d, ctx.session, ctx.me, Date.now());
    if (lockState(ctx.session).locked) {
      // "Verify to chat": a profile with nothing verified has no other way back in than this session — starting from
      // nothing would end it for good. It stays as it is: the PIN, then try again ("took too long").
      // Started on #/me to add an account: never a new start either — the PIN, then try again.
      if (to || (!ctx.me.blocked && !canTalk(ctx.me))) return back("expired");
      Object.assign(ctx, { lockedSession: ctx.session, session: null, me: null });
    }
  }
  // Signed out meanwhile: a sign-in started on #/me is just a sign-in now (back to the normal ways).
  if (!ctx.me) to = null;
  // "Verify to chat": a profile with no verified way yet attaches this account and goes back to what it was doing
  // (#/verified); an account that already has another profile is refused there (nothing changes, no switch).
  // #/me (owner 2026-10-13): the same attach-never-switch for any profile, and back to #/me.
  const attaching = Boolean(ctx.me && (to || !canTalk(ctx.me)));
  const { existing, inUse, refused: notAdded } = await completeSignin(ctx, provider, person, { attachOnly: attaching });
  if (inUse) return redirectTo(res, verifyBackPath(provider, { reason: "in_use", to }), setCookies(clear));
  if (notAdded) return back(notAdded);
  redirectTo(res, attaching ? verifyBackPath(provider, { ok: true, to }) : existing ? `${BASE}/#/nearby` : `${BASE}/#/create?signin=${provider}&ok=1`,
    setCookies(clear, ctx.headers["Set-Cookie"]));
}

/** The Android return page: no inline script at all; its one script (the auto-try) and its styles are our own files. */
const CSP_APP_RETURN = "default-src 'none'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; "
  + "font-src https://fonts.gstatic.com; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/**
 * The sheet hands a sign-in to the app — { ticket } after a good exchange, else { error, provider, to }:
 *   iOS     → 302 sg.ggmt.thirtyda://auth?<query> (ASWebAuthenticationSession catches its own scheme);
 *   Android → 200, a small page in 5 languages: "Open 30+DA" = Chrome's intent:// link for the app's package, plus the
 *             plain sg.ggmt.thirtyda:// link (a Custom Tab may want a tap before it leaves for an app).
 * The query is fixed by appReturnQuery: t=<ticket> | error=<reason>&p=<provider>[&to=me]. Never an address from the request.
 */
function appReturn(req, res, platform, { ticket = null, error = null, provider = null, to = null }) {
  const query = appReturnQuery(ticket ? { ticket } : { error, provider, to });
  if (platform === "ios") return redirectTo(res, appSchemeUrl(query), { "Referrer-Policy": "no-referrer" });
  return sendPage(req, res, 200, appReturnPage({
    ok: Boolean(ticket), provider, intentUrl: appIntentUrl(query), schemeUrl: appSchemeUrl(query), lang: requestLang(req),
  }), { "Content-Security-Policy": CSP_APP_RETURN, "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex", Vary: "Accept-Language" });
}

/**
 * POST /auth/app/begin { provider, to?: 'me', platform: 'ios' | 'android' } — the native apps' sign-in, asked by the
 * app's web view (its own page: a same-host Origin is required). The same limits, keys and state as
 * /auth/<provider>/start, plus a BINDER: 32 random bytes in an HttpOnly cookie of THIS web view (thirtyda_app,
 * Path=/30da/api/auth/app, 10 minutes), its SHA-256 kept with the state and then the ticket, so only this web view
 * can claim the sign-in (GET /auth/app). → { url }: the provider's authorize address (the same redirect_uri as the
 * web) for the app's sign-in sheet. Every refusal is JSON { error, message, back } — back: where the web sign-in
 * sends the person for that reason (always /30da/…; the app goes there): 429 too_many, 503 unavailable (keys not
 * saved / the sign-in off), 403 bad_origin / 422 invalid (→ 'failed'), 500 failed. (Another site's Origin never
 * gets this far: the router's plain 403.)
 */
async function appBegin(ctx) {
  const { d, req, body } = ctx;
  const provider = SIGNIN_PROVIDERS.includes(body.provider) ? body.provider : null;
  const to = ATTACH_FROM.includes(body.to) ? body.to : null;
  const refuse = async (status, error, message, reason) => {
    let back = `${BASE}/`; // no such sign-in: the app's start, which knows where the person is
    if (provider) back = await signinBack(d, req, provider, reason, to).catch(() => backToPhoneStep(provider, reason));
    return fail(status, error, message, { back });
  };
  if (!req.headers.origin) throw await refuse(403, "bad_origin", "Requests must come from the 30+DA app.", "failed");
  if (!provider) throw await refuse(422, "invalid", "No such sign-in.", "failed");
  const platform = platformOf(body.platform);
  if (!platform) throw await refuse(422, "invalid", "Which app: ios or android.", "failed");
  if (overLimit(ipSigninStarts, clientIp(req), SIGNIN_STARTS)) throw await refuse(429, "too_many", "Too many tries. Wait 15 minutes.", "too_many");
  try {
    const keys = SIGNIN_WIRED[provider] ? await signinKeys(d, provider) : null;
    if (!keys) throw await refuse(503, "unavailable", "This sign-in is not working right now.", "unavailable");
    const pkce = pkcePair(provider);
    const binder = newBinder();
    const state = await createSigninState(d, provider, { verifier: pkce?.verifier, to, app: stateHash(binder), platform });
    ctx.headers["Set-Cookie"] = appCookie(req, binder);
    return { url: authorizeUrl(provider, { clientId: keys.id, redirectUri: signinRedirect(req, provider), state, codeChallenge: pkce?.challenge }) };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    console.error("[30da signin] app begin:", err instanceof Error ? err.message : err);
    throw await refuse(500, "failed", "Something went wrong. Try again.", "failed");
  }
}

/**
 * GET /auth/app?t=<ticket> (or ?error=<reason>&p=<provider>[&to=me]) — the native apps' end of a sign-in, loaded in
 * the app's web view with the query exactly as the sheet handed it over. The ticket is used up at once (single use,
 * 2 minutes) and counts only with THIS web view's binder cookie (the one /auth/app/begin set; its SHA-256 compared
 * timing-safe) — a ticket fired into someone else's app is refused, so nobody can push their own account onto
 * another person's profile. Then the sign-in finishes exactly like the web callback with this request's session
 * (finishSignin: the PIN lock rules, to=me attaches, never a switch) and the binder cookie is cleared. An error →
 * where the callback sends that reason; a refused ticket → 'expired'. Always a redirect (a 4xx page load would show the
 * app's offline page); never the ticket in a log. SIGNIN_RETURNS per address per 15 minutes, like the callback.
 */
async function appClaim(ctx) {
  const { d, req, res, url } = ctx;
  ctx.sent = true;
  const params = url.searchParams;
  const binder = readAppCookie(req);
  const clear = binder ? [appCookie(req, "", 0)] : [];
  let provider = SIGNIN_PROVIDERS.includes(params.get("p")) ? params.get("p") : null;
  let to = null;
  const back = async (reason) => redirectTo(res, provider ? await signinBack(d, req, provider, reason, to) : `${BASE}/`, setCookies(clear));
  try {
    if (overLimit(ipSigninClaims, clientIp(req), SIGNIN_RETURNS)) return await back("too_many");
    if (!params.has("t")) {
      // The sheet said why not: the callback's own reasons, back where it would have sent them.
      to = ATTACH_FROM.includes(params.get("to")) ? params.get("to") : null;
      const reason = params.get("error");
      return await back(APP_ERRORS.includes(reason) ? reason : "failed");
    }
    const { ok, rec, person } = await takeAppTicket(d, params.get("t"), binder);
    if (SIGNIN_PROVIDERS.includes(rec?.provider)) provider = rec.provider;
    if (!ok) return await back("expired");
    to = ATTACH_FROM.includes(rec.to) ? rec.to : null;
    return await finishSignin(req, res, d, provider, person, { to, clear });
  } catch (err) {
    console.error("[30da signin] app claim:", err instanceof Error ? err.message : err);
    if (!res.headersSent) redirectTo(res, provider ? backToPhoneStep(provider, "failed") : `${BASE}/`, setCookies(clear));
  }
}

/**
 * Where a sign-in that did not work goes back to: the phone step, or — for a session of a profile with no verified
 * way yet (the "Verify to chat" sheet started it) — #/verified, which puts the person back where they were (after
 * the PIN, when the session locked meanwhile).
 */
async function signinBack(d, req, provider, reason, to = null) {
  if (to) return verifyBackPath(provider, { reason, to });
  const session = await loadSession(d, req);
  const me = session?.userId ? await d.collection(C.users).findOne({ _id: session.userId }) : null;
  if (me && !me.blocked && !canTalk(me)) return verifyBackPath(provider, { reason });
  return backToPhoneStep(provider, reason);
}

/**
 * What a good sign-in does — the same shape as verify-code (phone) and the test-mode verify-social:
 *   a person whose profile carries this provider id (signin.<provider>.id) → a session for that profile;
 *   a signed-in profile with no account of this provider yet (and nobody else has this one) → the profile adds it;
 *   a signed-in profile already linked to ANOTHER account of this provider → this browser switches to the new
 *   account (a clean session, onto Create profile); the profile's own link is never replaced;
 *   anyone else → a fresh session marked verified for the provider, which lands on Create profile; the profile
 *   made there keeps the provider id (+ email when given). Never the provider's tokens.
 * → { existing } (true: a profile is signed in), or { inUse } (see above: nothing was done).
 */
async function completeSignin(ctx, provider, person, { attachOnly = false } = {}) {
  const users = ctx.d.collection(C.users);
  const user = await users.findOne(signinUserFilter(provider, person.id));
  // "Verify to chat" (and any sign-in started on #/me: attachOnly): the profile never switches to (or merges with)
  // the profile that has this account → { inUse } and nothing changes.
  const otherOwner = (u) => Boolean(u && ctx.me && u._id !== ctx.me._id && (attachOnly || !canTalk(ctx.me)));
  if (otherOwner(user)) return { existing: false, inUse: true };
  let plan = planSignin({ provider, person, user, me: ctx.me, session: ctx.session });
  // #/me: the profile already has ANOTHER account of this provider — never replaced, never a switch.
  if (attachOnly && plan.switched) return { existing: false, refused: "failed" };
  if (plan.kind === "attach") {
    // Only while the profile still has no account of this provider: two returns at once cannot overwrite each other.
    const r = await users.updateOne({ _id: plan.userId, [`signin.${provider}.id`]: { $exists: false } }, { $set: plan.userSet });
    if (!r.matchedCount) {
      // Raced: look again (the profile may have been linked meanwhile) and plan from what is there now.
      const [again, me] = await Promise.all([users.findOne(signinUserFilter(provider, person.id)), users.findOne({ _id: plan.userId })]);
      if (otherOwner(again)) return { existing: false, inUse: true };
      plan = planSignin({ provider, person, user: again, me, session: ctx.session });
      if (plan.kind === "attach") throw new Error("the profile changed during the sign-in");
      if (plan.userSet) await users.updateOne({ _id: plan.userId }, { $set: plan.userSet });
    }
  } else if (plan.userSet) {
    await users.updateOne({ _id: plan.userId }, { $set: plan.userSet });
  }
  await startSession(ctx, plan.session);
  return { existing: plan.kind !== "new" };
}

/**
 * The admin's "Try sign-in" coming back: the real exchange with Google / Facebook, then a small page that says
 * whether it works ("Works ✓ — Google said: <name> (<email>)") or why not, in plain words. It makes NO user and
 * NO session, and it counts only while the admin session that started it is still signed in. The outcome
 * (ok / reason + time, never a name, email or token) goes on the card and in the audit.
 */
async function signinTry(req, res, d, provider, { rec, stateOk, params, clear }) {
  // In the browser's language first (Google / Facebook send no ?lang back); the page's flags switch it.
  const page = (o) => sendPage(req, res, 200, tryResultPage({ provider, lang: requestLang(req), ...o }), {
    "Set-Cookie": clear, "X-Robots-Tag": "noindex", Vary: "Accept-Language",
  });
  const record = async (r) => {
    await noteSecretUse(d, provider, { ok: r.ok, reason: r.ok ? null : r.reason, detail: r.ok ? null : r.detail ?? null, kind: "try" }).catch(() => {});
    await d.collection("thirtyda_audit").insertOne({
      at: new Date(), action: "signin_try", connection: provider, ok: r.ok, ...(r.ok ? {} : { reason: r.reason }), ip: clientIp(req),
    }).catch(() => {});
  };
  if (!(await adminSessionAlive(d, rec.adminHash))) return page({ ok: false, reason: "admin_gone" });
  if (!stateOk) return page({ ok: false, reason: "expired" });
  const refused = callbackError(provider, params);
  if (refused) {
    const r = { ok: false, reason: refused, detail: safeNote(params.get("error_description") || params.get("error_message") || params.get("error")) };
    await record(r);
    return page(r);
  }
  const code = params.get("code");
  const keys = await signinKeys(d, provider);
  if (!keys) return page({ ok: false, reason: "no_keys" });
  if (!code || code.length > 2048) {
    // Nothing came back from Google / Facebook (no code, no error): there is nothing they "said" to show.
    const r = { ok: false, reason: "other", detail: null };
    await record(r);
    return page(r);
  }
  const r = await signinPerson(provider, keys, code, signinRedirect(req, provider), { fetchImpl: outboundFetch(), verifier: rec?.verifier ?? null });
  await record(r);
  return page(r.ok ? { ok: true, person: r.person } : { ok: false, reason: r.reason, detail: r.detail });
}

/** GET /30da/api/auth/<provider>/start | callback. Never JSON: every answer is a redirect or a page. */
async function handleSignin(req, res, url, provider, step) {
  try {
    const d = await db();
    if (step === "start") return await signinStart(req, res, url, d, provider);
    return await signinCallback(req, res, url, d, provider);
  } catch (err) {
    console.error("[30da signin]", provider, step, err instanceof Error ? err.message : err);
    if (!res.headersSent) redirectTo(res, backToPhoneStep(provider, "failed"));
  }
}

// ---------------------------------------------------------------- profile handlers

/**
 * POST /profile. A session that proved a phone / Google / Facebook / TikTok makes the profile as it always has.
 * "Verify to chat" (owner 2026-10-13, src/lib/thirtyda-verify.mjs): without one, the app sends { unverified: true }
 * once the fields are filled — the profile is made with nothing verified and a fresh session of its own (startSession,
 * open, the waiting PIN kept like any new profile), UNVERIFIED_PER_DAY per address per day (429 too_many_profiles);
 * talking to people waits for a verified way (verify_needed). Without the flag an unproved session is refused as
 * before (401 signed_out / 403 not_verified: a sign-in that ran out is never turned into an unverified profile).
 */
async function createProfile(ctx) {
  const { d, body, session, me } = ctx;
  if (me) throw fail(409, "profile_exists", "You already have a profile.");
  const proved = Boolean(session && (session.phoneVerified || session.verified?.gmail || session.verified?.facebook || session.verified?.tiktok));
  const unverified = !proved && body.unverified === true;
  if (!proved && !unverified) {
    if (!session) throw fail(401, "signed_out", "Please sign in.");
    throw fail(403, "not_verified", "Verify your phone, Google, Facebook or TikTok first.");
  }
  const name = checkName(body.name);
  const birthYear = checkBirth(body.birthYear);
  const realName = String(body.realName ?? "").trim().replace(/\s+/g, " ");
  if (charCount(realName) < 2 || charCount(realName) > 60) throw invalid("Write your first and last name.", { field: "realName" });
  const role = checkRole(body.role);
  if (!GENDERS.includes(body.gender)) throw invalid("Choose male, female or other.", { field: "gender" });
  const lang = checkLang(body.lang);
  // The PIN chosen right after the language (it waited on the phone until now). Without one the app asks next.
  const newPin = waitingPin(body);

  const users = d.collection(C.users);
  const phone = proved && session.phoneVerified ? session.phone : null;
  if (phone && (await users.findOne({ phone }))) throw fail(409, "phone_in_use", "This phone number already has a profile.");
  // A number typed on the phone step but never proved by a code (the person signed in with Google / Facebook):
  // kept, normalised like `phone`, as `phoneUnverified` — never in `phone` (unique, and a code for it signs in
  // to that profile) and never verified.phone. A verified session's own number wins; nothing else is checked.
  const typedPhone = phone || body.phone == null || body.phone === "" ? null : normalizePhone(body.phone);
  if (!phone && body.phone != null && body.phone !== "" && !typedPhone) throw invalid("That phone number does not look right.", { field: "phone" });

  const pinHash = newPin ? await hashPin(newPin) : null;
  // Unverified: one of today's few for this address, given back if the profile is not made after all.
  const limits = d.collection(SIGNUP_LIMITS);
  const slot = unverified ? await claimSignup(limits, clientIp(ctx.req)) : null;
  if (slot && !slot.ok) throw fail(429, "too_many_profiles", "Too many new profiles from this connection today. Please try again tomorrow.");
  let photoId;
  try {
    photoId = await storePhoto(body.photo);
  } catch (err) {
    await releaseSignup(limits, slot?.key);
    throw err;
  }
  const id = await nextId(d, "user");
  const user = {
    _id: id,
    id,
    name,
    realName,
    birthYear,
    role,
    gender: body.gender,
    lang,
    language: LANG_ENGLISH[lang],
    ...(phone ? { phone } : {}),
    ...(phone && phoneViaOf(session.phoneVia) ? { phoneVia: session.phoneVia } : {}),
    ...(typedPhone ? { phoneUnverified: typedPhone } : {}),
    verified: { phone: Boolean(phone), gmail: Boolean(session?.verified?.gmail), facebook: Boolean(session?.verified?.facebook), tiktok: Boolean(session?.verified?.tiktok) },
    // The Google / Facebook account this browser signed in with: its id (+ email when given), never a token.
    ...(signinOf(session) ? { signin: signinOf(session) } : {}),
    photos: [photoId],
    location: null,
    area: "",
    city: "",
    hearts: { red: 0, orange: 0 },
    level: 1,
    presence: "online",
    lastSeenAt: new Date(),
    blocked: false,
    blockResolved: [],
    notices: [],
    ...(pinHash ? { pinHash, pinAt: new Date() } : {}),
    pinTries: 0,
    createdAt: new Date(),
  };
  try {
    await users.insertOne(user);
  } catch (err) {
    await deletePhoto(photoId);
    await releaseSignup(limits, slot?.key);
    if (err?.code === 11000 && /signin\./.test(JSON.stringify(err.keyPattern ?? err.message ?? ""))) {
      throw fail(409, "signin_in_use", "This Google, Facebook or TikTok account already has a profile. Sign in with it again.");
    }
    if (err?.code === 11000) throw fail(409, "phone_in_use", "This phone number already has a profile.");
    throw err;
  }
  // Unverified: a fresh session for the new profile, the same shape a sign-in makes (the old one, if any, goes).
  if (unverified) {
    await startSession(ctx, { userId: id, phone: null, phoneVerified: false, verified: { gmail: false, facebook: false, tiktok: false } });
  }
  // The new profile starts open: its maker is the one holding the phone (a pending session may be old).
  await d.collection(C.sessions).updateOne(
    { _id: ctx.session._id }, { $set: { userId: id, pinOk: true, activeAt: new Date(), pinTries: 0 }, $unset: { pinResetUntil: "" } },
  );
  return { user: meView(user), lock: lockInfo() };
}

async function getMe(ctx) {
  const { d, me, session, url } = ctx;
  if (!session) {
    // The app's start-up probe asks without failing, so a signed-out visit logs no error.
    if (url.searchParams.get("probe") === "1") return { user: null, notices: [], session: null, lock: lockInfo() };
    throw fail(401, "signed_out", "Please sign in.");
  }
  if (!me) {
    return {
      user: null,
      notices: [],
      session: {
        phone: session.phone ?? null, phoneVerified: Boolean(session.phoneVerified),
        phoneVia: session.phoneVerified ? phoneViaOf(session.phoneVia) : null, verified: session.verified ?? { gmail: false, facebook: false },
      },
      lock: lockInfo(),
    };
  }
  // A locked session never gets here: handleApi answers 423 first.
  await Promise.all([
    d.collection(C.users).updateOne({ _id: me._id }, { $set: { lastSeenAt: new Date() } }),
    syncLevel(d, me),
  ]);
  return { user: meView(me), notices: unseenNotices(me), lock: lockInfo() };
}

async function patchMe(ctx) {
  const { d, body, me } = ctx;
  const set = {};
  if (body.name !== undefined) set.name = checkName(body.name);
  if (body.lang !== undefined) Object.assign(set, { lang: checkLang(body.lang), language: LANG_ENGLISH[body.lang] });
  if (body.role !== undefined) set.role = checkRole(body.role);
  if (body.realName !== undefined) {
    const realName = String(body.realName ?? "").trim().replace(/\s+/g, " ");
    if (charCount(realName) < 2 || charCount(realName) > 60) throw invalid("Write your first and last name.", { field: "realName" });
    set.realName = realName;
  }
  if (body.gender !== undefined) {
    if (!GENDERS.includes(body.gender)) throw invalid("Choose male, female or other.", { field: "gender" });
    set.gender = body.gender;
  }
  // The birth year is set once: at sign-up, or here once for a profile made before it was asked.
  if (body.birthYear !== undefined) {
    if (Number.isInteger(me.birthYear)) throw birthYearSet();
    set.birthYear = checkBirth(body.birthYear);
  }
  if (!Object.keys(set).length) throw invalid("Nothing to change.");
  const filter = { _id: me._id };
  // Atomic: two parallel first-time saves cannot both win.
  if (set.birthYear !== undefined) filter.$or = [{ birthYear: { $exists: false } }, { birthYear: null }];
  const r = await d.collection(C.users).updateOne(filter, { $set: set });
  if (!r.matchedCount && set.birthYear !== undefined) throw birthYearSet();
  return { user: meView({ ...me, ...set }) };
}

const birthYearSet = () => fail(409, "birth_year_set", "Your birth year is already set.", { field: "birthYear" });

/**
 * Why a photo cannot go in slot `index` (default: the lowest empty slot): all 4 slots used (409), or
 * that slot is still locked for this person's level (403).
 */
function photoRefusal(u, index = emptySlot(slotsOf(u), PHOTO_MAX)) {
  if (index < 0) return fail(409, "too_many_photos", `You can have ${PHOTO_MAX} photos.`, { max: PHOTO_MAX });
  const needLevel = photoSlotLevel(index);
  return fail(403, "photo_locked", `Photo ${index + 1} unlocks at Level ${needLevel}.`, {
    needLevel, slot: index + 1, allowed: photoSlotsFor(u?.level ?? 1),
  });
}

/**
 * Matches while slot `i` is empty. (`{"photos.1": null}` alone misses a slot past the end of the
 * array, so an explicit null and a missing element are both checked.)
 */
const emptySlotFilter = (i) => ({ $or: [{ [`photos.${i}`]: { $type: "null" } }, { [`photos.${i}`]: { $exists: false } }] });

/** Older profiles may lack the array; slot updates by index need one. */
async function ensurePhotoArray(users, me) {
  if (Array.isArray(me.photos)) return;
  await users.updateOne({ _id: me._id, photos: { $not: { $type: "array" } } }, { $set: { photos: [] } });
  me.photos = [];
}

/** Drop empty slots at the end of the list (one atomic update; a slot filled meanwhile stays). */
function trimPhotoSlots(users, id) {
  return users.updateOne({ _id: id, photos: { $type: "array" } }, [{
    $set: {
      photos: {
        $reduce: {
          input: { $reverseArray: "$photos" },
          initialValue: [],
          in: { $cond: [{ $and: [{ $eq: [{ $size: "$$value" }, 0] }, { $eq: ["$$this", null] }] }, [], { $concatArrays: [["$$this"], "$$value"] }] },
        },
      },
    },
  }]);
}

/**
 * POST /me/photos — into the lowest empty slot this person's level has unlocked. Each slot is claimed
 * with one conditional update (it must still be empty), so parallel uploads never pass the limit.
 */
async function addPhoto(ctx) {
  const { d, body } = ctx;
  const users = d.collection(C.users);
  let me = await syncLevel(d, ctx.me);
  await ensurePhotoArray(users, me);
  const allowed = PHOTO_MAX;
  let slot = emptySlot(slotsOf(me), allowed);
  if (slot < 0) throw photoRefusal(me);
  const photoId = await storePhoto(body.photo);
  for (let tries = 0; tries < PHOTO_MAX && slot >= 0; tries++) {
    const r = await users.updateOne(
      { _id: me._id, photos: { $type: "array" }, ...emptySlotFilter(slot) }, { $set: { [`photos.${slot}`]: photoId } },
    );
    if (r.modifiedCount) return { user: meView(await users.findOne({ _id: me._id })) };
    me = { ...me, ...(await users.findOne({ _id: me._id }, { projection: { photos: 1 } })) };
    slot = emptySlot(slotsOf(me), allowed);
  }
  await deletePhoto(photoId);
  throw photoRefusal(me);
}

/**
 * PUT /me/photos/:index — put a photo in that slot: fills an empty slot or replaces the photo in it
 * (the way to change the main photo, which cannot be removed). The slot must be unlocked for this
 * person's level; slot 1 is always theirs. Photos never change slots, so neither do their viewers.
 */
async function putPhoto(ctx) {
  const { d, body, params } = ctx;
  const users = d.collection(C.users);
  const me = await syncLevel(d, ctx.me);
  await ensurePhotoArray(users, me);
  const index = Number(params[0]);
  if (index >= PHOTO_MAX) throw photoRefusal(me, index);
  const photos = slotsOf(me);
  if (index > 0 && !photos[0]) throw fail(409, "main_first", "Add your main photo first.");
  const old = photos[index] ?? null;
  const photoId = await storePhoto(body.photo);
  const r = await users.updateOne(
    { _id: me._id, photos: { $type: "array" }, ...(old ? { [`photos.${index}`]: old } : emptySlotFilter(index)) },
    { $set: { [`photos.${index}`]: photoId } },
  );
  if (!r.modifiedCount) {
    await deletePhoto(photoId);
    throw fail(409, "photo_changed", "Your photos changed. Try again.");
  }
  if (old) await deletePhoto(old);
  return { user: meView(await users.findOne({ _id: me._id })) };
}

/**
 * DELETE /me/photos/:index — empties that slot; the other photos stay where they are (a Level 3 photo
 * never slides into the Level 2 slot). The main photo (slot 1) can be replaced, not removed.
 */
async function removePhoto(ctx) {
  const { d, me, params } = ctx;
  const users = d.collection(C.users);
  const index = Number(params[0]);
  const photos = slotsOf(me);
  const id = photos[index];
  if (!id) throw fail(404, "not_found", "No such photo.");
  if (index === 0) {
    throw filledCount(me) > 1
      ? fail(409, "main_photo", "Your main photo can be replaced, not removed.")
      : fail(409, "last_photo", "Keep at least one photo of your face.");
  }
  // Only while that exact photo is in that slot and a main photo remains.
  const r = await users.updateOne(
    { _id: me._id, [`photos.${index}`]: id, "photos.0": { $type: "string" } }, { $set: { [`photos.${index}`]: null } },
  );
  if (!r.modifiedCount) {
    const now = await users.findOne({ _id: me._id }, { projection: { photos: 1 } });
    if (slotsOf(now)[index] !== id) throw fail(404, "not_found", "No such photo.");
    throw fail(409, "last_photo", "Keep at least one photo of your face.");
  }
  await trimPhotoSlots(users, me._id);
  await deletePhoto(id);
  return { user: meView(await users.findOne({ _id: me._id })) };
}

/** A random direction and 300–500 m, made once per person: [km east, km north]. */
function randomOffsetKm() {
  const angle = (crypto.randomInt(0, 360000) / 1000) * (Math.PI / 180);
  const km = LOC_OFFSET_KM[0] + (crypto.randomInt(0, 1001) / 1000) * (LOC_OFFSET_KM[1] - LOC_OFFSET_KM[0]);
  return [round3(km * Math.sin(angle)), round3(km * Math.cos(angle))];
}

/**
 * Privacy: the real fix is never stored. Each person's point is moved by their own fixed random
 * offset (300–500 m, made on their first fix and never shown), so every distance the app reports
 * is between offset points: moving your own point around to trilaterate someone finds their
 * offset point, never their door. Moves are also limited (one per 2 minutes, 30 a day); a move
 * inside the limit is ignored and the current area comes back.
 */
async function setLocation(ctx) {
  const { d, body, me } = ctx;
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw invalid("That location does not look right.", { field: "location" });
  }
  const users = d.collection(C.users);
  const now = Date.now();
  const offset = Array.isArray(me.locOffset) ? me.locOffset : randomOffsetKm();
  const kmLng = 1 / (111.32 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  const point = [
    round3(Math.max(-180, Math.min(180, lng + offset[0] * kmLng))),
    round3(Math.max(-90, Math.min(90, lat + offset[1] / 110.574))),
  ];
  const stay = { area: me.area ?? "", city: me.city ?? "", moved: false };
  const [x, y] = me.location?.coordinates ?? [];
  const moves = (me.locMoves || []).filter((t) => now - new Date(t).getTime() < 864e5);
  if ((x === point[0] && y === point[1]) || (me.location && moves.length >= LOC_DAY_MAX)) {
    await users.updateOne({ _id: me._id }, { $set: { lastSeenAt: new Date(now) } });
    return stay;
  }
  // Claim the move atomically: parallel requests cannot squeeze several moves into one slot.
  const claimed = await users.updateOne(
    { _id: me._id, $or: [{ locAt: null }, { locAt: { $lte: new Date(now - LOC_MOVE_MS) } }, { location: null }] },
    {
      $set: { location: { type: "Point", coordinates: point }, locOffset: offset, locAt: new Date(now), lastSeenAt: new Date(now) },
      $push: { locMoves: { $each: [new Date(now)], $slice: -LOC_DAY_MAX } },
    },
  );
  if (!claimed.modifiedCount) {
    await users.updateOne({ _id: me._id }, { $set: { lastSeenAt: new Date(now) } });
    return stay;
  }
  // The area name comes from the real fix (it is what the person expects to read), only to street-block level.
  const at = { _id: me._id, "location.coordinates": point };
  const { area, city, later } = await areaFor(round3(lat), round3(lng));
  await users.updateOne(at, { $set: { area, city } });
  later?.then((real) => real && users.updateOne(at, { $set: { area: real.area, city: real.city } })).catch(() => {});
  return { area, city, moved: true };
}

async function heartbeat(ctx) {
  const { d, me } = ctx;
  await d.collection(C.users).updateOne({ _id: me._id }, { $set: { lastSeenAt: new Date() } });
  const pairs = await d.collection(C.pairs).find({ members: me._id }).sort({ updatedAt: -1 }).limit(100).toArray();
  const views = await viewsFor(d, me, pairs.filter((p) => !hiddenFrom(p, me)));
  await syncLevel(d, me); // keeps users.level (the admin's column, the photo slots) on the pairs
  const actions = views.filter((v) => v.turn);
  return { actions, notices: unseenNotices(me) };
}

/**
 * GET /me/pending → { count }: how many conversations wait for this person (the heartbeat's actions), and nothing
 * else — no names, no text. Open while locked and never counted as use (passiveCall): a hidden app that is
 * locked asks it for "Remind me", and says only "Something new is waiting" (owner 2026-10-13).
 */
async function pendingCount(ctx) {
  const { d, me } = ctx;
  const pairs = await d.collection(C.pairs).find({ members: me._id }).sort({ updatedAt: -1 }).limit(100).toArray();
  const views = await viewsFor(d, me, pairs.filter((p) => !hiddenFrom(p, me)));
  return { count: views.filter((v) => v.turn).length };
}

async function noticeSeen(ctx) {
  const { d, me, params } = ctx;
  await d.collection(C.users).updateOne(
    { _id: me._id }, { $set: { "notices.$[n].seenAt": nowIso() } }, { arrayFilters: [{ "n.id": params[0], "n.seenAt": null }] },
  );
  return { ok: true };
}

async function getPhoto(ctx) {
  const { d, me, params, res } = ctx;
  const id = params[0];
  if (!isPhotoId(id)) throw fail(404, "not_found", "No such photo.");
  const owner = await d.collection(C.users).findOne({ photos: id }, { projection: { photos: 1, blocked: 1 } });
  // A blocked person has vanished: their photos go with them (as GET /people and Nearby already do).
  // A guest (no profile yet, the home screen before Create profile): photo 1 only, like any stranger.
  if (!owner || (owner.blocked && owner._id !== me?._id)) throw fail(404, "not_found", "No such photo.");
  // Per person, bound to the slot: the owner sees all; anyone sees slot 1; slot 2 needs Level 2
  // opened together, slots 3–4 Level 3. Slots never move, so a photo keeps its level.
  const index = slotsOf(owner).indexOf(id);
  let allowed = owner._id === me?._id || photoVisible(index, 1);
  if (!allowed && me) allowed = photoVisible(index, await openLevelBetween(d, me._id, owner._id));
  const buf = allowed ? await readPhoto(id) : null;
  if (!buf) throw fail(404, "not_found", "No such photo.");
  res.writeHead(200, {
    ...BASE_HEADERS, "Content-Type": "image/jpeg", "Content-Length": buf.length, "Cache-Control": "private, max-age=3600",
  });
  res.end(buf);
  ctx.sent = true;
}

// ---------------------------------------------------------------- people handlers

async function nearby(ctx) {
  const { d, me, url } = ctx;
  const km = Math.min(NEARBY_MAX_KM, Math.max(1, Number(url.searchParams.get("km")) || 10));
  const show = url.searchParams.get("show");
  const gender = show === "women" ? "woman" : show === "men" ? "man" : null;
  const base = { area: me.area ?? "", city: me.city ?? "" };
  if (!me.location?.coordinates) return { ...base, gps: false, count: 0, people: [] };

  const rows = await d.collection(C.users).aggregate([
    {
      $geoNear: {
        near: me.location,
        key: "location",
        distanceField: "dist",
        maxDistance: km * 1000,
        spherical: true,
        query: { _id: { $ne: me._id }, blocked: { $ne: true }, ...(gender ? { gender } : {}) },
      },
    },
    { $limit: 300 },
    { $project: { name: 1, gender: 1, role: 1, hearts: 1, dist: 1, photo: { $arrayElemAt: ["$photos", 0] } } },
  ]).toArray();
  const people = rows.map((u) => ({
    id: u._id,
    name: u.name,
    gender: u.gender ?? null,
    role: u.role ?? null,
    km: Math.max(0.1, round1(u.dist / 1000)),
    hearts: heartsOf(u),
    photo: photoUrl(u.photo),
  }));
  return { ...base, gps: true, count: people.length, people };
}

/**
 * POST /guest/nearby { km, show, lat?, lng? } → { guest: true, near: 'you' | 'phnom_penh', gps: true, count, people }.
 * The home screen before a profile exists (owner 2026-10-13): who is on 30+DA, as cards only (src/lib/thirtyda-guest.mjs:
 * app name, role, a distance band, hearts, photo 1). No session needed, rate-limited per IP, writes nothing — the
 * guest's position (POST body, so it stays out of URLs and logs) is used for this one answer and never stored.
 */
const guestReads = guestLimiter();
async function guestNearby(ctx) {
  const { d, me, req, body } = ctx;
  if (!guestReads.take(clientIp(req))) throw fail(429, "rate_limited", "Too many looks. Try again in a few minutes.");
  const km = Math.min(NEARBY_MAX_KM, Math.max(1, Number(body.km) || 10));
  const gender = body.show === "women" ? "woman" : body.show === "men" ? "man" : null;
  const { point, device } = guestPoint(body);
  const rows = await d.collection(C.users).aggregate([
    {
      $geoNear: {
        near: { type: "Point", coordinates: point },
        key: "location",
        distanceField: "dist",
        maxDistance: km * 1000,
        spherical: true,
        query: { blocked: { $ne: true }, ...(me ? { _id: { $ne: me._id } } : {}), ...(gender ? { gender } : {}) },
      },
    },
    { $limit: GUEST_LIMIT },
    { $project: { name: 1, gender: 1, role: 1, hearts: 1, dist: 1, photo: { $arrayElemAt: ["$photos", 0] } } },
  ]).toArray();
  const people = rows.map((u) => guestCard(u, { photoUrl }));
  return { guest: true, near: device ? "you" : "phnom_penh", gps: true, count: people.length, people };
}

/** Distance for a profile: only for someone within Nearby range (or with a pair), never 0. */
function kmBetween(me, u, paired) {
  if (u._id === me._id || !me.location?.coordinates || !u.location?.coordinates) return null;
  const km = haversineKm(me.location.coordinates, u.location.coordinates);
  return km <= NEARBY_MAX_KM || paired ? Math.max(0.1, round1(km)) : null;
}

async function person(ctx) {
  const { d, me, params } = ctx;
  const u = await d.collection(C.users).findOne({ _id: params[0] });
  if (!u || (u.blocked && u._id !== me._id)) throw fail(404, "not_found", "This person is not here any more.");
  let pair = await d.collection(C.pairs).findOne({ members: { $all: [me._id, u._id] } });
  if (pair && hiddenFrom(pair, me)) pair = null;
  const view = pair && u._id !== me._id ? await viewOf(d, me, pair) : null;
  const photo = photoUrl(u.photos?.[0]);
  // What this viewer may see of u's photos (viewOf settled the pair), plus how many are still locked.
  const { photos, lockedPhotos } = photosFor(u, { isOwner: u._id === me._id, openLevel: stageOpenLevel(view?.stage) });
  // The real name: only for the other person once the chat (Level 3) is open between us.
  const real = view ? realNameFor(u, view.stage) : null;
  return {
    person: {
      id: u._id,
      name: u.name,
      ...(real ? { realName: real } : {}),
      gender: u.gender ?? null,
      role: u.role ?? null,
      lang: u.lang ?? "en",
      km: kmBetween(me, u, Boolean(view)),
      area: u.area ?? "",
      hearts: heartsOf(u),
      verified: { phone: Boolean(u.verified?.phone), gmail: Boolean(u.verified?.gmail), facebook: Boolean(u.verified?.facebook), tiktok: Boolean(u.verified?.tiktok) },
      photo,
      photos,
      lockedPhotos,
    },
    pair: view,
  };
}

// ---------------------------------------------------------------- pair handlers

async function createPair(ctx) {
  const { d, me, body } = ctx;
  const to = String(body.to ?? "");
  if (!/^U-\d+$/.test(to) || to === me._id) throw invalid("Choose someone to talk to.", { field: "to" });
  const other = await d.collection(C.users).findOne({ _id: to }, { projection: { blocked: 1 } });
  if (!other || other.blocked) throw fail(404, "not_found", "This person is not here any more.");

  const pairs = d.collection(C.pairs);
  const key = [me._id, to].sort().join("|");
  let pair = await pairs.findOne({ key });
  if (!pair) {
    const id = await nextId(d, "pair");
    const at = nowIso();
    const doc = {
      _id: id, id, key, a: me._id, b: to, members: [me._id, to], level: 1, stage: "l1", startedAt: null,
      l2OpensAt: null, l3OpensAt: null, remind: {}, opened: { [me._id]: at }, lastChat: null, createdAt: at, updatedAt: at,
    };
    try {
      await pairs.insertOne(doc);
      pair = doc;
    } catch (err) {
      if (err?.code !== 11000) throw err;
      pair = await pairs.findOne({ key }); // the other person asked at the same moment
    }
  }
  if (hiddenFrom(pair, me)) {
    // The other person's unsent draft: it becomes mine as well, from now (see pairView).
    pair = await pairs.findOneAndUpdate(
      { _id: pair._id }, { $set: { [`opened.${me._id}`]: nowIso() } }, { returnDocument: "after" },
    ) ?? pair;
  }
  return { pair: await viewOf(d, me, pair) };
}

async function listPairs(ctx) {
  const { d, me } = ctx;
  const pairs = await d.collection(C.pairs).find({ members: me._id }).toArray();
  const views = await viewsFor(d, me, pairs.filter((p) => !hiddenFrom(p, me)));
  views.sort((x, y) => String(y.updatedAt).localeCompare(String(x.updatedAt)));
  return { pairs: views };
}

async function getPair(ctx) {
  const { pair } = await pairFor(ctx, ctx.params[0]);
  return { pair: await viewOf(ctx.d, ctx.me, pair) };
}

// The admin's choices: Question N of the set is picked from slot N's own 5 (thirtyda_questions).
// `system` is the same choices as one flat list, choice 1 of every slot first (older clients).
// slots[i].title = Question i+1's optional topic in my language (null when the admin set none).
async function questions(ctx) {
  const level = levelParam(ctx.url.searchParams.get("level"));
  const lang = ctx.me.lang ?? "en";
  const { pick, write } = LEVEL_RULES[level];
  const config = await questionConfig(ctx.d, level);
  const slots = slotsView(config.slots, lang, config.titles);
  return { level, pick, write, slots, system: flatView(slots) };
}

const bankTranslations = (fn) => Object.fromEntries(LANGS.map((l) => [l, fn(l)]));

async function sendSet(ctx) {
  const { d, me, body, params } = ctx;
  const level = levelParam(body.level);
  const { pair, other } = await pairFor(ctx, params[0], { write: true });
  const sets = d.collection(C.sets);
  // Either person sends ONE set per level, while that level is open, in any order.
  if (openSetLevel(pair.stage) !== level) throw notYourTurn();
  if (await sets.findOne({ pairId: pair._id, level, from: me._id }, { projection: { _id: 1 } })) throw notYourTurn();

  const list = Array.isArray(body.questions) ? body.questions : [];
  // A contact detail is recorded for the admin even when the rest of the set is incomplete.
  const written = list.map((q) => (q?.source === "written" ? String(q.text ?? "").trim() : null));
  await stopContactDetails(ctx, pair, other, written, { level, kind: "question" });
  await stopSplitContactDetails(ctx, pair, other, written, { level, kind: "question" });

  const { pick, write } = LEVEL_RULES[level];
  if (list.length !== pick + write) throw invalid(`Send exactly ${pick + write} lines.`, { index: Math.min(list.length, pick + write - 1) });
  // The k-th picked question must be one of the 5 choices the admin set for Question k (slot k).
  const { slots, titles = [] } = await questionConfig(d, level);
  const chosen = new Map(); // index in the list → { slot (1-based), choice }
  let picked = 0;
  list.forEach((q, i) => {
    if (q?.source === "system") {
      if (picked >= pick) throw invalid(`Pick ${pick} and write ${write}.`, { index: i });
      const choice = slots[picked].find((c) => c.key === q.key);
      if (!choice) throw invalid(`Pick line ${picked + 1} from its own list.`, { index: i, slot: picked + 1 });
      chosen.set(i, { slot: picked + 1, choice });
      picked++;
    } else if (q?.source === "written") {
      const r = checkWrittenQuestion(String(q.text ?? "").trim(), level);
      if (!r.ok) throw invalid(ERROR_TEXT[r.error] || "Check this line.", { index: i, reason: r.error });
    } else {
      throw invalid("Unknown line.", { index: i });
    }
  });
  if (picked !== pick) throw invalid(`Pick ${pick} and write ${write}.`, { index: 0 });

  const lang = me.lang ?? "en";
  const qs = await Promise.all(list.map(async (q, i) => {
    if (q.source === "system") {
      // The full 5-language text goes into the set, so a later admin edit never rewrites it.
      const { slot, choice } = chosen.get(i);
      return {
        n: i + 1, source: "system", key: q.key, slot, text: choice.text[lang] || choice.text.en, lang,
        translations: Object.fromEntries(LANGS.map((l) => [l, choice.text[l] || choice.text.en])),
        topic: titles[slot - 1] || null, // the list's topic ("Communication") as it was when sent
      };
    }
    const text = String(q.text).trim();
    const { translations } = await translateAll(text, lang);
    return { n: i + 1, source: "written", key: null, text, lang, translations };
  }));

  const at = nowIso();
  const setId = await nextId(d, "set");
  try {
    await sets.insertOne({
      _id: setId, id: setId, pairId: pair._id, level, from: me._id, to: other._id, questions: qs, answers: [], sentAt: at, completedAt: null,
    });
  } catch (err) {
    if (err?.code === 11000) throw notYourTurn();
    throw err;
  }

  const pairs = d.collection(C.pairs);
  // The first set ever sent starts the conversation: its sender is `a` (the admin's chat log reads a/b)
  // and the pair stops being a draft, so the other person sees it too. Old 'l1_ask' drafts become 'l1'.
  const started = await pairs.updateOne(
    { _id: pair._id, $or: [{ stage: "l1_ask" }, { stage: "l1", startedAt: null }] },
    { $set: { stage: "l1", startedAt: at, a: me._id, b: other._id, members: [me._id, other._id], updatedAt: at } },
  );
  if (started.modifiedCount) {
    pair.a = me._id;
    pair.b = other._id;
    await d.collection(C.chats).updateOne({ _id: pair._id }, { $set: { a: me._id, b: other._id } });
  } else {
    await pairs.updateOne({ _id: pair._id }, { $set: { updatedAt: at } });
  }

  const msgIds = await nextIds(d, "msg", qs.length);
  await appendMessages(d, pair, qs.map((q, i) => ({
    id: msgIds[i], from: me._id, at, kind: "question", level, n: q.n, text: q.text, lang,
    english: lang === "en" ? null : q.translations.en ?? null, translations: q.translations, hit: null, flagId: null, stopped: false,
  })));
  ctx.status = 201;
  const fresh = await pairs.findOne({ _id: pair._id });
  return { pair: await viewOf(d, me, fresh), conversation: await conversationFor(d, me, fresh, other) };
}

function questionView(q, level, lang, titles = []) {
  if (q.source === "system") {
    // The text stored with the set when it was sent (admin edits since then never show here);
    // a set without stored translations falls back to the built-in bank by key.
    const text = (q.lang === lang ? q.text : null) || q.translations?.[lang] || questionText(level, q.key, lang) || q.text;
    // Topic stored with the set; older sets read the list's current topic.
    const topicText = q.topic || titles[(q.slot ?? q.n) - 1] || null;
    return {
      n: q.n, source: "system", key: q.key, text, topic: topicText ? topicText[lang] || topicText.en : null,
      original: q.text, originalLang: q.lang, translated: q.lang !== lang,
    };
  }
  const tr = q.lang === lang ? null : q.translations?.[lang] ?? null;
  return { n: q.n, source: "written", key: null, text: tr ?? q.text, original: q.text, originalLang: q.lang, translated: Boolean(tr) };
}

function answerView(a, level, lang) {
  if (level === 1 || a.key) {
    return { n: a.n, key: a.key, text: answerText(a.key, lang), original: answerText(a.key, a.lang), originalLang: a.lang };
  }
  const tr = a.lang === lang ? null : a.translations?.[lang] ?? null;
  return { n: a.n, key: null, text: tr ?? a.text, original: a.text, originalLang: a.lang, translated: Boolean(tr) };
}

// ---------------------------------------------------------------- the conversation (one read model)

/** A set's replies in line order (stored in the order they were last saved). */
const byLine = (answers) => [...(answers || [])].sort((x, y) => x.n - y.n);

/** A reply as its line shows it: the words in my language (Level 1: the option's text), the replier's own words, when. */
function replyView(a, level, lang) {
  if (!a) return null;
  if (level === 1 || a.key) {
    return {
      key: a.key ?? null, text: answerText(a.key, lang) ?? a.text ?? "", original: answerText(a.key, a.lang) ?? a.text ?? "",
      translated: a.lang !== lang, at: a.at ?? null,
    };
  }
  const tr = a.lang === lang ? null : a.translations?.[lang] ?? null;
  return { key: null, text: tr ?? a.text, original: a.text, translated: Boolean(tr), at: a.at ?? null };
}

/**
 * SetView: one set of 5 lines with the replies so far. from 'me' = the set I sent (its replies are theirs:
 * the sender sees "2 of 5" and the words as they come); 'them' = the set sent to me (the replies are mine,
 * and `canReply` while the level is open and the set is not complete). Lines I reply to carry their tap
 * `options` at both levels (a written line: Yes / No only). Level 2 sets replied to in words before the
 * taps (2026-10-13) read back as they were. Stopped texts are never saved, so they never show.
 */
function setView(set, meId, lang, titles, { open }) {
  const level = set.level;
  const from = set.from === meId ? "me" : "them";
  const byN = new Map((set.answers || []).map((a) => [a.n, a]));
  const lines = [...(set.questions || [])].sort((x, y) => x.n - y.n).map((q) => {
    const v = questionView(q, level, lang, titles);
    const line = {
      n: v.n, source: v.source, topic: v.topic ?? null, text: v.text, original: v.original, originalLang: v.originalLang,
      translated: v.translated, reply: replyView(byN.get(q.n), level, lang),
    };
    if (from === "them") line.options = replyOptions(q.source).map((o) => ({ key: o.key, text: o.text[lang] || o.text.en }));
    return line;
  });
  return {
    id: set._id, level, from, sentAt: set.sentAt, completedAt: set.completedAt ?? null,
    replied: repliedCount(set), total: lines.length, canReply: from === "them" && open && !set.completedAt, lines,
  };
}

/**
 * GET /pairs/:id/conversation for `me`:
 * { pair: PairView, other: { id, name, gender, lang, photos, lockedPhotos, realName? }, levels: [{ level: 1|2,
 *   state: 'open'|'wait'|'done'|'locked', opensAt, rules: { pick, write }, mine: SetView|null, theirs: SetView|null }],
 *   canSend: { level, pick, write, slots } | null, chat: { open, opensAt, phoneNeeded },
 *   decision: { canDecide, mine: true|false|null, ended, endedAt }, next }.
 * other.realName is there only once the chat (Level 3) is open. `sets` may be passed when already loaded.
 */
async function conversationFor(d, me, pair, other, sets = null) {
  const lang = me.lang ?? "en";
  sets ??= await d.collection(C.sets).find({ pairId: pair._id }).toArray();
  await Promise.all(sets.map((s) => backfillSet(d, s, lang)));
  const otherId = pair.a === me._id ? pair.b : pair.a;
  const stage = stageOf(pair);
  const frozen = !other || Boolean(other.blocked);
  const [c1, c2] = await Promise.all([questionConfig(d, 1), questionConfig(d, 2)]);
  const config = { 1: c1, 2: c2 };
  const rulesOf = (level) => ({ pick: LEVEL_RULES[level].pick, write: LEVEL_RULES[level].write });

  const levels = [1, 2].map((level) => {
    const { mine, theirs } = setsAt(sets, level, me._id, otherId);
    const state = levelState(level, stage);
    const view = (s) => (s ? setView(s, me._id, lang, config[level].titles || [], { open: state === "open" && !frozen }) : null);
    return {
      level, state, opensAt: level === 2 ? pair.l2OpensAt ?? null : null, rules: rulesOf(level), mine: view(mine), theirs: view(theirs),
    };
  });

  const openLevel = openSetLevel(stage);
  const open = setsAt(sets, openLevel, me._id, otherId);
  const canSend = !frozen && openLevel && !open.mine
    ? { level: openLevel, ...rulesOf(openLevel), slots: slotsView(config[openLevel].slots, lang, config[openLevel].titles) }
    : null;

  const view = pairView(pair, me, other, sets);
  const seen = other ? photosFor(other, { openLevel: stageOpenLevel(stage) }) : { photos: [], lockedPhotos: [] };
  const real = realNameFor(other, stage);
  return {
    pair: view,
    other: other
      ? {
        id: other._id, name: other.name, gender: other.gender ?? null, lang: other.lang ?? "en", photos: seen.photos, lockedPhotos: seen.lockedPhotos,
        ...(real ? { realName: real } : {}),
      }
      : { id: otherId, name: "", gender: null, lang: "en", photos: [], lockedPhotos: [] },
    levels,
    canSend,
    chat: { open: stage === "l3_open", opensAt: null, phoneNeeded: !me.verified?.phone },
    decision: {
      canDecide: stage === "l3_decide" && !frozen && view.decision === null,
      mine: view.decision,
      ended: stage === "ended",
      endedAt: view.endedAt,
    },
    next: view.next,
  };
}

/** The other person's real name: only once the chat (Level 3) is open, never for a blocked person. */
const realNameFor = (other, stage) => (other && !other.blocked && convStage(stage) === "l3_open" && other.realName ? other.realName : null);

async function getConversation(ctx) {
  const { pair, other } = await pairFor(ctx, ctx.params[0]);
  return conversationFor(ctx.d, ctx.me, pair, other);
}

async function setFor(ctx, direction) {
  const { d, me, url, params } = ctx;
  const { pair, other } = await pairFor(ctx, params[0]);
  const level = url.searchParams.has("level") ? levelParam(url.searchParams.get("level")) : currentSetLevel(pair.stage) ?? 2;
  const query = direction === "in" ? { to: me._id } : { from: me._id };
  const set = await d.collection(C.sets).findOne({ pairId: pair._id, level, ...query });
  if (!set) throw fail(404, "no_set", direction === "in" ? "Nothing for you to reply to yet." : "You have not started this conversation yet.");
  const lang = me.lang ?? "en";
  await backfillSet(d, set, lang);
  const { titles = [] } = await questionConfig(d, level);
  const who = (u) => (u ? { id: u._id, name: u.name, gender: u.gender ?? null } : null);
  const [from, to] = direction === "in" ? [other, me] : [me, other];
  const answered = Boolean(set.completedAt);
  return {
    set: {
      id: set._id,
      level,
      from: who(from),
      to: who(to),
      questions: set.questions.map((q) => questionView(q, level, lang, titles)),
      answered,
      sentAt: set.sentAt,
      completedAt: set.completedAt,
      // Replies are saved one at a time (a changed one goes to the end of the stored list): in line order here.
      ...(answered ? { answers: byLine(set.answers).map((a) => answerView(a, level, lang)) } : {}),
    },
  };
}

/**
 * The set sent to me at `level` that I may still reply to: the level must be open and the set not complete.
 * 409 not_your_turn otherwise.
 */
async function replyableSet(d, pair, me, level) {
  if (openSetLevel(pair.stage) !== level) throw notYourTurn();
  const set = await d.collection(C.sets).findOne({ pairId: pair._id, level, to: me._id });
  if (!set) throw fail(409, "not_your_turn", "There is nothing to reply to yet.");
  if (set.completedAt) throw fail(409, "not_your_turn", "Your replies to these lines are already sent.");
  return set;
}

/**
 * A set got its last reply: the admin's chat log gets the 5 replies (once), and when both sets of the
 * level are complete the level is done: Level 2 opens after the wait; after Level 2 both people choose
 * (l3_decide) — no wait any more.
 */
async function onSetComplete(d, pair, set) {
  const at = set.completedAt;
  const answers = byLine(set.answers);
  const msgIds = await nextIds(d, "msg", answers.length);
  await appendMessages(d, pair, answers.map((a, i) => ({
    id: msgIds[i], from: set.to, at, kind: "answer", level: set.level, n: a.n,
    text: a.key ? answerText(a.key, a.lang) : a.text, lang: a.lang,
    english: a.lang === "en" ? null : a.translations?.en ?? null, translations: a.translations ?? {}, hit: null, flagId: null, stopped: false,
  })));
  const back = await d.collection(C.sets).findOne({ pairId: pair._id, level: set.level, from: set.to });
  if (!levelComplete(set, back)) return;
  const pairs = d.collection(C.pairs);
  if (set.level === 1) {
    const opensAt = new Date(Date.now() + WAIT_MS).toISOString();
    await pairs.updateOne({ _id: pair._id, stage: { $in: L1_STAGES } }, { $set: { stage: "l2_wait", l2OpensAt: opensAt, updatedAt: at } });
  } else {
    await pairs.updateOne({ _id: pair._id, stage: "l2_open" }, { $set: { stage: "l3_decide", decisions: {}, updatedAt: at } });
  }
}

/**
 * PUT /pairs/:id/replies { level, n, key } → { conversation }. One tap reply at Level 1 and Level 2:
 * Yes / No / Not really / Maybe to a picked line, Yes / No to the sender's own written line. Saved on its
 * own; it can be changed until the set is complete (all 5 replied). Replies in words are no longer taken.
 */
async function saveReply(ctx) {
  const { d, me, body, params } = ctx;
  const level = levelParam(body.level);
  const { pair, other } = await pairFor(ctx, params[0], { write: true });
  const set = await replyableSet(d, pair, me, level);
  const n = Number(body.n);
  const q = set.questions.find((x) => x.n === n);
  if (!q) throw invalid("Reply to one of the lines.", { field: "n", n: body.n ?? null });

  // Level 2 used to take replies in words; every reply is one tap now (old word replies still read back).
  if (body.key === undefined && body.text !== undefined) {
    throw invalid("Reply with one tap.", { field: "key", n, reason: "taps_only" });
  }
  if (!replyOptions(q.source).some((x) => x.key === body.key)) {
    throw invalid(q.source === "written" ? "Reply to this line with Yes or No." : "Pick one of the replies.", { field: "key", n });
  }
  const lang = me.lang ?? "en";
  const at = nowIso();
  const reply = { n, key: body.key, text: null, lang, translations: bankTranslations((l) => answerText(body.key, l)), at };

  const sets = d.collection(C.sets);
  // Replace this line's reply in one atomic update, only while the set is still open ($literal: the
  // reply is data, never a field path).
  let saved = await sets.findOneAndUpdate(
    { _id: set._id, completedAt: null },
    [{
      $set: {
        answers: {
          $concatArrays: [
            { $filter: { input: { $ifNull: ["$answers", []] }, cond: { $ne: ["$$this.n", n] } } },
            [{ $literal: reply }],
          ],
        },
      },
    }],
    { returnDocument: "after" },
  );
  if (!saved) throw fail(409, "not_your_turn", "Your replies to these lines are already sent.");
  if (allReplied(saved)) {
    const done = await sets.findOneAndUpdate({ _id: set._id, completedAt: null }, { $set: { completedAt: at } }, { returnDocument: "after" });
    if (done) {
      saved = done;
      await onSetComplete(d, pair, done);
    }
  }
  const pairs = d.collection(C.pairs);
  await pairs.updateOne({ _id: pair._id }, { $set: { updatedAt: at } });
  const fresh = await settle(d, await pairs.findOne({ _id: pair._id }));
  return { conversation: await conversationFor(d, me, fresh, other) };
}

/** POST /pairs/:id/answers — all replies to a set at once (the older screens). Same rules as saveReply: taps only. */
async function sendAnswers(ctx) {
  const { d, me, body, params } = ctx;
  const level = levelParam(body.level);
  const { pair, other } = await pairFor(ctx, params[0], { write: true });
  const sets = d.collection(C.sets);
  const set = await replyableSet(d, pair, me, level);

  const list = Array.isArray(body.answers) ? body.answers : [];
  if (list.length !== set.questions.length) throw invalid(`Reply to all ${set.questions.length}.`, { index: list.length });
  const seen = new Set();
  list.forEach((a, i) => {
    const n = Number(a?.n);
    if (!set.questions.some((q) => q.n === n) || seen.has(n)) throw invalid("Reply to each line once.", { index: i });
    seen.add(n);
    const source = set.questions.find((q) => q.n === n)?.source;
    if (!replyOptions(source).some((x) => x.key === a.key)) {
      throw invalid(source === "written" ? "Reply to the written line with Yes or No." : "Pick one of the replies.", { index: i });
    }
  });

  const lang = me.lang ?? "en";
  const at = nowIso();
  const answers = [...list].sort((x, y) => Number(x.n) - Number(y.n))
    .map((a) => ({ n: Number(a.n), key: a.key, text: null, lang, translations: bankTranslations((l) => answerText(a.key, l)), at }));
  const saved = await sets.findOneAndUpdate(
    { _id: set._id, completedAt: null }, { $set: { answers, completedAt: at } }, { returnDocument: "after" },
  );
  if (!saved) throw notYourTurn();
  await onSetComplete(d, pair, saved);

  const pairs = d.collection(C.pairs);
  await pairs.updateOne({ _id: pair._id }, { $set: { updatedAt: at } });
  const fresh = await settle(d, await pairs.findOne({ _id: pair._id }));
  return { pair: await viewOf(d, me, fresh), conversation: await conversationFor(d, me, fresh, other) };
}

// The admin's chat log notes each choice after Level 2 (kind 'decision'; never shown in the app).
const DECISION_TEXT = {
  open: "Chose to open the chat (Level 3)",
  forget: "Chose to forget it: the conversation ended for both",
  opened: "Both chose to open the chat: Level 3 is open",
};

/**
 * POST /pairs/:id/decide { open: true|false } → { conversation }. After Level 2 (stage l3_decide) each
 * person chooses: open the chat or forget it. The chat opens at once when both chose to open it; one
 * "Forget it" ends the conversation for both (stage 'ended'). Idempotent: the same choice again answers
 * with the conversation as it is now. "Open" can still turn into "Forget it" while the other has not
 * chosen; nothing else changes a choice (409). Either person, in any order; every choice is in the
 * admin's chat log.
 */
async function decide(ctx) {
  const { d, me, body, params } = ctx;
  if (typeof body.open !== "boolean") throw invalid("Choose to open the chat or forget it.", { field: "open" });
  const open = body.open;
  const { pair, other } = await pairFor(ctx, params[0], { write: true });
  const pairs = d.collection(C.pairs);
  const answer = async () => {
    const fresh = await pairs.findOne({ _id: pair._id });
    return { conversation: await conversationFor(d, me, fresh, other) };
  };
  const stage = stageOf(pair);
  const mine = decisionOf(pair.decisions, me._id);
  if (mine === open && ["l3_decide", "l3_open", "ended"].includes(stage)) return answer();
  if (stage === "ended") throw fail(409, "conversation_ended", "This conversation has ended.");
  if (stage !== "l3_decide") throw notYourTurn();

  const at = nowIso();
  const set = { [`decisions.${me._id}`]: { open, at }, updatedAt: at };
  if (!open) Object.assign(set, { stage: "ended", endedAt: at, endedBy: me._id });
  // Only while the choice is still open (the other person may have just ended it) and only when it changes
  // my choice: of two identical requests at once (two tabs, a retry) one writes and logs, the other answers.
  const saved = await pairs.findOneAndUpdate(
    { _id: pair._id, stage: "l3_decide", [`decisions.${me._id}.open`]: { $ne: open } },
    { $set: set },
    { returnDocument: "after" },
  );
  if (!saved) {
    const now = await pairs.findOne({ _id: pair._id });
    if (now && decisionOf(now.decisions, me._id) === open && ["l3_decide", "l3_open", "ended"].includes(stageOf(now))) return answer();
    if (now?.stage === "ended") throw fail(409, "conversation_ended", "This conversation has ended.");
    throw notYourTurn();
  }
  const log = [{ from: me._id, text: open ? DECISION_TEXT.open : DECISION_TEXT.forget, open }];
  if (open && afterDecisions(saved.decisions, saved.members) === "l3_open") {
    // Both chose it: the chat opens now (only one of two racing requests moves it).
    const opened = await pairs.updateOne(
      { _id: pair._id, stage: "l3_decide", [`decisions.${saved.a}.open`]: true, [`decisions.${saved.b}.open`]: true },
      { $set: { stage: "l3_open", level: 3, l3OpensAt: at, updatedAt: at } },
    );
    if (opened.modifiedCount) {
      log.push({ from: null, text: DECISION_TEXT.opened, open: true });
      await Promise.all([
        d.collection(C.users).updateMany({ _id: { $in: saved.members } }, { $max: { level: 3 } }),
        d.collection(C.chats).updateOne({ _id: pair._id }, { $max: { level: 3 } }),
      ]);
    }
  }
  const ids = await nextIds(d, "msg", log.length);
  await appendMessages(d, pair, log.map((m, i) => ({
    id: ids[i], from: m.from, at, kind: "decision", level: 2, open: m.open, text: m.text, lang: "en", english: null,
    translations: { en: m.text }, hit: null, flagId: null, stopped: false,
  })));
  if (!open) await d.collection(C.chats).updateOne({ _id: pair._id }, { $set: { endedAt: at } });
  return answer();
}

async function remind(ctx) {
  const { d, me, body, params } = ctx;
  const { pair } = await pairFor(ctx, params[0], { write: true });
  await d.collection(C.pairs).updateOne({ _id: pair._id }, { $set: { [`remind.${me._id}`]: Boolean(body.on) } });
  return { pair: await viewOf(d, me, await d.collection(C.pairs).findOne({ _id: pair._id })) };
}

// ---------------------------------------------------------------- chat handlers

function chatGate(ctx, pair) {
  if (pair.stage !== "l3_open") throw fail(409, "chat_closed", "The chat opens at Level 3.");
  if (!ctx.me.verified?.phone) throw fail(403, "phone_needed", "Verify your phone number to chat.");
}

async function listMessages(ctx) {
  const { d, me, url, params } = ctx;
  const { pair, other } = await pairFor(ctx, params[0]);
  chatGate(ctx, pair);
  const after = Date.parse(url.searchParams.get("after") || "");
  const chat = await d.collection(C.chats).findOne({ _id: pair._id }, { projection: { messages: 1 } });
  const msgs = (chat?.messages || []).filter((m) =>
    m.kind === "chat" && !m.stopped && (Number.isNaN(after) || Date.parse(m.at) > after));
  const lang = me.lang ?? "en";
  await backfillMessages(d, pair._id, msgs, lang);
  return {
    other: other
      // A blocked partner's photos are gone (the pair is frozen; GET /people says 404). The chat is open
      // here (chatGate), so the real name shows.
      ? {
        id: other._id, name: other.name, lang: other.lang ?? "en", photos: photosFor(other, { openLevel: stageOpenLevel(pair.stage) }).photos,
        ...(realNameFor(other, pair.stage) ? { realName: realNameFor(other, pair.stage) } : {}),
      }
      : null,
    messages: msgs.map((m) => ({
      id: m.id,
      mine: m.from === me._id,
      at: m.at,
      text: m.text,
      lang: m.lang,
      translated: m.lang === lang ? null : m.translations?.[lang] ?? null,
    })),
  };
}

/**
 * A contact detail spread over my last few chat lines and this one ("012 887" now, "766" next):
 * only hits that reach into the new line count, since the earlier lines were already delivered.
 */
async function stopSplitChat(ctx, pair, other, text) {
  const { d, me } = ctx;
  if (!text) return;
  const chat = await d.collection(C.chats).findOne({ _id: pair._id }, { projection: { messages: { $slice: -40 } } });
  const since = Date.now() - CHAT_SPLIT_MS;
  const recent = (chat?.messages || [])
    .filter((m) => m.kind === "chat" && m.from === me._id && !m.stopped && Date.parse(m.at) >= since)
    .slice(-CHAT_SPLIT_LINES)
    .map((m) => m.text);
  if (!recent.length) return;
  const c = findContactDetailsAcross([...recent, text]);
  const offset = c.text.length - text.length;
  const hits = c.hits.filter((h) => h.lastIndex === recent.length).map((h) => {
    const start = Math.max(0, h.start - offset);
    return { type: h.type, match: text.slice(start, h.end - offset), start, end: h.end - offset };
  });
  if (!hits.length) return;
  const reason = CONTACT_REASONS[hits[0].type] ?? c.reason;
  await recordStopped(ctx, pair, other, { text, level: 3, kind: "chat", hits, reason });
  throw fail(422, "contact_detail", reason || "Contact details are not allowed.", { hits, reason, count: charCount(text) });
}

async function postMessage(ctx) {
  const { d, me, body, params } = ctx;
  const { pair, other } = await pairFor(ctx, params[0], { write: true });
  chatGate(ctx, pair);
  const text = String(body.text ?? "").trim();
  await stopContactDetails(ctx, pair, other, [text], { level: 3, kind: "chat" });
  await stopSplitChat(ctx, pair, other, text);
  const r = checkChatMessage(text);
  if (!r.ok) {
    throw fail(422, r.error, ERROR_TEXT[r.error] || "Check your message.", { hits: r.hits ?? [], reason: r.reason ?? null, count: r.count });
  }
  const lang = me.lang ?? "en";
  const [{ translations, english }, id] = await Promise.all([translateAll(text, lang), nextId(d, "msg")]);
  const at = nowIso();
  await appendMessages(d, pair, [{
    id, from: me._id, at, kind: "chat", level: 3, text, lang, english, translations, hit: null, flagId: null, stopped: false,
  }]);
  await d.collection(C.pairs).updateOne({ _id: pair._id }, { $set: { updatedAt: at, lastChat: { from: me._id, at } } });
  ctx.status = 201;
  return { message: { id, mine: true, at, text, lang, translated: null } };
}

async function report(ctx) {
  const { d, me, body, params } = ctx;
  const label = REPORT_REASONS[body.reason];
  if (!label) throw invalid("Choose a reason.", { field: "reason" });
  const { pair, other } = await pairFor(ctx, params[0], { write: true });
  const msgId = params[1];
  const chats = d.collection(C.chats);
  const chat = await chats.findOne({ _id: pair._id }, { projection: { messages: { $elemMatch: { id: msgId } } } });
  const m = chat?.messages?.[0];
  if (!m || m.kind !== "chat" || m.stopped || m.from !== other?._id) throw fail(404, "not_found", "No such message.");
  if (m.flagId) return { ok: true, already: true };

  const flagId = await nextId(d, "flag");
  // Claim the message first so a double tap cannot raise two flags.
  const claimed = await chats.updateOne(
    { _id: pair._id }, { $set: { "messages.$[m].flagId": flagId } }, { arrayFilters: [{ "m.id": msgId, "m.flagId": null }] },
  );
  if (!claimed.modifiedCount) return { ok: true, already: true };
  await d.collection(C.flags).insertOne({
    _id: flagId, id: flagId, chatId: pair._id, from: other._id, to: me._id, at: nowIso(),
    reason: `Reported by ${me.name} · ${label}`, kind: "reported", status: "open", warned: false,
  });
  return { ok: true };
}

// ---------------------------------------------------------------- PIN lock (owner 2026-10-13; rules in src/lib/thirtyda-pin.mjs)

const lockedError = (me) => fail(423, "locked", "Enter your PIN.", { pin: Boolean(me?.pinHash), lock: lockInfo() });

/** A new PIN from the body (4 digits, not 0000-style, not a 1234 / 4321 run) → "1357"; 422 otherwise. */
function newPinOrFail(raw, field = "pin") {
  const c = checkNewPin(pinDigits(raw));
  if (c.ok) return c.pin;
  if (c.error === "format") throw invalid("A PIN is 4 digits.", { field });
  throw fail(422, "weak_pin", "Choose a PIN that is harder to guess.", { field, reason: c.error });
}

/** The PIN that waited on the phone before the account existed (body.pin), or null when none was sent. */
function waitingPin(body) {
  const raw = body?.pin;
  return raw === undefined || raw === null || raw === "" ? null : newPinOrFail(raw);
}

/**
 * Keep a new PIN's hash on the profile and leave this session open, with no wrong tries left over. → the profile.
 * `hashed`: the PIN arrived already hashed (it waited, hashed, on a Telegram bot check).
 */
async function savePin(ctx, user, pin, hashed = null) {
  const { d, session } = ctx;
  const pinHash = hashed ?? await hashPin(pin);
  const pinAt = new Date();
  await d.collection(C.users).updateOne({ _id: user._id }, { $set: { pinHash, pinAt, pinTries: 0 } });
  if (session) {
    await d.collection(C.sessions).updateOne(
      { _id: session._id }, { $set: { pinOk: true, activeAt: new Date(), pinTries: 0 }, $unset: { pinResetUntil: "" } },
    );
  }
  return { ...user, pinHash, pinAt, pinTries: 0 };
}

/**
 * Wrong tries ran out: this session ends — every session of the profile when the profile's own count ran out —
 * and the answer is 401 pin_tries (the app goes to the sign-in step: "Sign in again to set a new PIN.").
 */
async function endForTries(ctx, everywhere) {
  const { d, session, me } = ctx;
  if (everywhere) {
    await d.collection(C.sessions).deleteMany({ userId: me._id });
    await d.collection(C.users).updateOne({ _id: me._id }, { $set: { pinTries: 0 } });
  } else {
    await d.collection(C.sessions).deleteOne({ _id: session._id });
  }
  ctx.headers["Set-Cookie"] = cookieFor(ctx.req, "", 0);
  throw fail(401, "pin_tries", "Too many wrong PINs. Sign in again to set a new PIN.", { signedOut: true });
}

/**
 * One PIN check, counted BEFORE comparing (parallel guesses cannot get past the limit): the session's and the
 * profile's wrong tries both go up, and a right PIN clears both. The 5th wrong one (either count) ends the
 * session (endForTries); a wrong one before that → 400 wrong_pin { triesLeft }.
 */
async function checkPinTry(ctx, pin) {
  const { d, session, me } = ctx;
  const sessions = d.collection(C.sessions);
  const users = d.collection(C.users);
  const [s, u] = await Promise.all([
    sessions.findOneAndUpdate({ _id: session._id }, { $inc: { pinTries: 1 } }, { returnDocument: "after", projection: { pinTries: 1 } }),
    users.findOneAndUpdate({ _id: me._id }, { $inc: { pinTries: 1 } }, { returnDocument: "after", projection: { pinTries: 1, pinHash: 1 } }),
  ]);
  if (!s || !u) throw fail(401, "signed_out", "Please sign in.");
  const over = afterWrongPin(s.pinTries - 1, u.pinTries - 1);
  if (over.end) return endForTries(ctx, over.everywhere); // already out of tries: not even compared
  if (await verifyPin(pin, u.pinHash)) {
    // A hash from before the server pepper (THIRTYDA_PIN_PEPPER) is made again with it, now that the PIN is known.
    const better = pinHashStale(u.pinHash) ? await hashPin(pin) : null;
    await Promise.all([
      sessions.updateOne({ _id: session._id }, { $set: { pinTries: 0 } }),
      users.updateOne({ _id: me._id }, { $set: { pinTries: 0 } }),
      better && users.updateOne({ _id: me._id, pinHash: u.pinHash }, { $set: { pinHash: better } }),
    ]);
    return;
  }
  const next = afterWrongPin(s.pinTries, u.pinTries);
  if (next.end) return endForTries(ctx, next.everywhere);
  throw fail(400, "wrong_pin", "That PIN is not right.", { triesLeft: next.triesLeft });
}

/** POST /me/lock — the app covered itself (30 s without a touch, hidden, closed): the PIN is needed again. */
async function lockMe(ctx) {
  const { d, session } = ctx;
  await d.collection(C.sessions).updateOne({ _id: session._id }, { $set: { pinOk: false } });
  return { ok: true, locked: true };
}

/** POST /me/unlock { pin } → open again { user, notices, lock } · 400 wrong_pin { triesLeft } · 401 pin_tries · 409 no_pin. */
async function unlockMe(ctx) {
  const { d, session, me, body } = ctx;
  if (!me.pinHash) throw fail(409, "no_pin", "Sign in again to set a PIN.");
  const pin = pinDigits(body.pin);
  if (pin.length !== PIN_LENGTH) throw invalid("Enter your 4-digit PIN.", { field: "pin" });
  await checkPinTry(ctx, pin);
  await d.collection(C.sessions).updateOne({ _id: session._id }, { $set: { pinOk: true, activeAt: new Date(), pinTries: 0 } });
  return { ok: true, user: meView(me), notices: unseenNotices(me), lock: lockInfo() };
}

/**
 * POST /me/pin { pin, old? } — the first PIN (open session), or a new one: with the old PIN (a wrong one counts
 * as a wrong try, like on the lock screen), or without it once right after a sign-in (the PIN that waited on the
 * phone, "Forgot PIN?"). Leaves this session open. → { ok, user, lock }.
 */
async function setPin(ctx) {
  const { d, session, me, body } = ctx;
  const pin = newPinOrFail(body.pin);
  const hasOld = body.old !== undefined && body.old !== null && body.old !== "";
  const plan = pinSetPlan({ hasPin: Boolean(me.pinHash), locked: ctx.locked, hasOld, resetUntil: session.pinResetUntil });
  if (plan.refuse) {
    if (plan.refuse.code === "locked") throw lockedError(me);
    throw fail(plan.refuse.status, plan.refuse.code, "Type your old PIN first.", { field: "old" });
  }
  if (plan.kind === "old") {
    const old = pinDigits(body.old);
    if (old.length !== PIN_LENGTH) throw invalid("Type your old 4-digit PIN.", { field: "old" });
    await checkPinTry(ctx, old);
  } else if (plan.kind === "fresh") {
    // Used up once, atomically: two parallel sets cannot both skip the old PIN.
    const r = await d.collection(C.sessions).updateOne({ _id: session._id, pinResetUntil: { $gt: new Date() } }, { $unset: { pinResetUntil: "" } });
    if (!r.matchedCount) throw fail(403, "old_pin_needed", "Type your old PIN first.", { field: "old" });
  }
  const user = await savePin(ctx, me, pin);
  return { ok: true, user: meView(user), lock: lockInfo() };
}

/** POST /me/pin/forgot — "Forgot PIN?": this session ends; signing in again (Google / Facebook / phone) sets a new PIN. */
async function forgotPin(ctx) {
  if (ctx.session) await ctx.d.collection(C.sessions).deleteOne({ _id: ctx.session._id });
  ctx.headers["Set-Cookie"] = cookieFor(ctx.req, "", 0);
  return { ok: true, signedOut: true };
}

/** A session made before the PIN lock gets its lock fields once (see legacyLockFields). */
async function upgradeSession(d, session, me, now) {
  if (session.pinOk !== undefined) return;
  const fields = legacyLockFields(Boolean(me.pinHash), now);
  await d.collection(C.sessions).updateOne({ _id: session._id, pinOk: { $exists: false } }, { $set: fields });
  Object.assign(session, fields);
}

/**
 * The lock, before any route runs. A profile's session that is locked may only call whileLocked() routes:
 * everything else is 423 locked; the sign-in steps run as if signed out (ctx.lockedSession is replaced by the
 * new session). An open session slides its idle window with real activity (X-30DA-Input-Age; the heartbeat
 * and photo loads alone never count).
 */
async function applyLock(ctx, req, sub) {
  const { d, session, me } = ctx;
  ctx.locked = false;
  if (!session || !me) return;
  const now = Date.now();
  await upgradeSession(d, session, me, now);
  // A profile with no PIN yet never counts as locked: there is nothing to unlock with, and the app asks for a PIN
  // before anything else (owner 2026-10-13: old test profiles were stuck on "sign in again" with no way back in).
  if (me.pinHash && lockState(session, now).locked) {
    ctx.locked = true;
    const may = whileLocked(req.method, sub);
    if (!may) throw lockedError(me);
    if (may === "signin") {
      ctx.lockedSession = session;
      ctx.session = null;
      ctx.me = null;
    }
    return;
  }
  if (passiveCall(req.method, sub)) return; // GET /me/pending: never use, header or not
  const at = activityAt(req.headers[INPUT_AGE_HEADER.toLowerCase()], ctx.arrivedAt ?? now, { background: backgroundCall(req.method, sub) });
  const next = nextActiveAt(session, at);
  if (next) {
    await d.collection(C.sessions).updateOne({ _id: session._id }, { $max: { activeAt: next } });
    session.activeAt = next;
  }
}

// ---------------------------------------------------------------- router

// auth: "none" (anyone), "session" (any session, profile optional), "user" (default: a profile).
const ROUTES = [
  ["GET", /^\/auth\/methods$/, authMethods, { auth: "none", blockedOk: true }],
  ["POST", /^\/auth\/send-code$/, sendCode, { auth: "none" }],
  ["POST", /^\/auth\/verify-code$/, verifyCode, { auth: "none" }],
  ["POST", /^\/auth\/verify-social$/, verifySocial, { auth: "none" }],
  // The free Telegram bot: start a check, then ask from the same browser until Telegram has the number.
  ["POST", /^\/auth\/telegram\/start$/, telegramStart, { auth: "none" }],
  ["GET", /^\/auth\/telegram\/status$/, telegramStatus, { auth: "none" }],
  // The native apps (src/lib/thirtyda-signin.mjs): the web view begins a sign-in for its sheet (binder cookie + the
  // provider's address), then claims what the sheet did (a redirect, never JSON; the web callback's own lock rules).
  ["POST", /^\/auth\/app\/begin$/, appBegin, { auth: "none", blockedOk: true }],
  ["GET", /^\/auth\/app$/, appClaim, { auth: "none", blockedOk: true }],
  ["POST", /^\/auth\/signout$/, signout, { auth: "none", blockedOk: true }],
  // auth "none": no session at all may make an unverified profile ({ unverified: true }, see createProfile).
  ["POST", /^\/profile$/, createProfile, { auth: "none" }],
  ["GET", /^\/me$/, getMe, { auth: "none", blockedOk: true }],
  ["PATCH", /^\/me$/, patchMe],
  ["POST", /^\/me\/photos$/, addPhoto],
  ["PUT", /^\/me\/photos\/([0-3])$/, putPhoto],
  ["DELETE", /^\/me\/photos\/([0-3])$/, removePhoto],
  ["POST", /^\/me\/location$/, setLocation],
  ["POST", /^\/me\/heartbeat$/, heartbeat],
  ["GET", /^\/me\/pending$/, pendingCount],
  // The PIN lock: open while locked (whileLocked in src/lib/thirtyda-pin.mjs); set / change checks for itself.
  ["POST", /^\/me\/lock$/, lockMe, { auth: "session", blockedOk: true }],
  ["POST", /^\/me\/unlock$/, unlockMe, { blockedOk: true }],
  ["POST", /^\/me\/pin$/, setPin],
  ["POST", /^\/me\/pin\/forgot$/, forgotPin, { auth: "none", blockedOk: true }],
  ["POST", /^\/notices\/([\w-]{1,64})\/seen$/, noticeSeen],
  // auth "none": a guest (no profile yet) sees photo 1 only, as on the cards of POST /guest/nearby.
  ["GET", /^\/photos\/([a-f0-9]{32})$/, getPhoto, { auth: "none" }],
  ["GET", /^\/nearby$/, nearby],
  ["POST", /^\/guest\/nearby$/, guestNearby, { auth: "none" }],
  ["GET", /^\/people\/(U-\d+)$/, person],
  ["POST", /^\/pairs$/, createPair],
  ["GET", /^\/pairs$/, listPairs],
  ["GET", /^\/pairs\/(P-\d+)$/, getPair],
  ["GET", /^\/pairs\/(P-\d+)\/conversation$/, getConversation],
  ["PUT", /^\/pairs\/(P-\d+)\/replies$/, saveReply],
  ["GET", /^\/questions$/, questions],
  ["POST", /^\/pairs\/(P-\d+)\/sets$/, sendSet],
  ["GET", /^\/pairs\/(P-\d+)\/incoming$/, (ctx) => setFor(ctx, "in")],
  ["GET", /^\/pairs\/(P-\d+)\/outgoing$/, (ctx) => setFor(ctx, "out")],
  ["POST", /^\/pairs\/(P-\d+)\/answers$/, sendAnswers],
  ["POST", /^\/pairs\/(P-\d+)\/decide$/, decide],
  ["POST", /^\/pairs\/(P-\d+)\/remind$/, remind],
  ["GET", /^\/pairs\/(P-\d+)\/messages$/, listMessages],
  ["POST", /^\/pairs\/(P-\d+)\/messages$/, postMessage],
  ["POST", /^\/pairs\/(P-\d+)\/messages\/(M-\d+)\/report$/, report],
];

/** The route table (method + path pattern only), for the lock's 423 tests (src/lib/thirtyda-pin.test.mjs). */
export const API_ROUTES = ROUTES.map(([method, re]) => ({ method, re }));

async function handleApi(req, res, url, sub) {
  // arrivedAt: when the call came in, before any database lookup (the input age it carries is counted from then).
  const ctx = { req, res, url, headers: {}, status: 200, sent: false, arrivedAt: Date.now() };
  try {
    let route = null;
    for (const [method, re, fn, opts = {}] of ROUTES) {
      const m = req.method === method && sub.match(re);
      if (m) { route = { fn, opts, params: m.slice(1) }; break; }
    }
    if (!route) throw fail(404, "not_found", "No such endpoint.");
    if (req.method !== "GET" && crossSite(req)) throw fail(403, "bad_origin", "Requests must come from the 30+DA app.");

    ctx.d = await db();
    ctx.params = route.params;
    ctx.session = await loadSession(ctx.d, req);
    ctx.me = ctx.session?.userId ? await ctx.d.collection(C.users).findOne({ _id: ctx.session.userId }) : null;
    await applyLock(ctx, req, sub); // locked → 423, except the sign-in steps and the PIN routes
    const auth = route.opts.auth ?? "user";
    if (auth !== "none" && !ctx.session) throw fail(401, "signed_out", "Please sign in.");
    if (auth === "user" && !ctx.me) throw fail(401, "no_profile", "Create your profile first.");
    if (ctx.me?.blocked && !route.opts.blockedOk) throw fail(403, "blocked", "This account is blocked.");
    // "Needed to chat" (owner 2026-10-13): talking to someone waits for one verified way (src/lib/thirtyda-verify.mjs).
    if (ctx.me && talksToSomeone(req.method, sub) && !canTalk(ctx.me)) {
      throw fail(403, "verify_needed", "Verify your phone, Google, Facebook or TikTok to chat.");
    }
    ctx.body = req.method === "GET" ? {} : await readBody(req);

    const out = await route.fn(ctx);
    if (!ctx.sent) sendJson(res, ctx.status, out, ctx.headers);
  } catch (err) {
    if (res.headersSent) return;
    if (err instanceof ApiError) {
      sendJson(res, err.status, { error: err.code, message: err.message, ...err.extra }, ctx.headers);
      return;
    }
    console.error("[30da api]", req.method, sub, err instanceof Error ? err.message : err);
    sendJson(res, 500, { error: "server_error", message: "Something went wrong. Try again." });
  }
}

// Which build is running: open tabs compare it and reload after a deploy, so nobody keeps old code.
const BUILD = (process.env.RAILWAY_GIT_COMMIT_SHA || "").slice(0, 12) || String(Date.now());

export async function handleThirtyDaApp(req, res, url) {
  const path = url.pathname;
  if (path === `${API}/version`) {
    res.writeHead(200, { ...BASE_HEADERS, "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify({ build: BUILD }));
    return;
  }
  // Google / Facebook / TikTok sign-in: browser navigations (redirects and pages), not JSON.
  const sm = req.method === "GET" && path.match(/^\/30da\/api\/auth\/(google|facebook|tiktok)\/(start|callback)$/);
  if (sm) return handleSignin(req, res, url, sm[1], sm[2]);
  // The free Telegram bot's updates: Telegram's secret header, not a session (src/lib/thirtyda-telegram-bot.mjs).
  if (path === `${API}/telegram/hook`) return handleTelegramHook(req, res, { db, fetchImpl: outboundFetch() });
  if (path === API || path.startsWith(`${API}/`)) return handleApi(req, res, url, path.slice(API.length) || "/");
  if (req.method === "GET" || req.method === "HEAD") {
    // The pages Google and Facebook ask for (their addresses are on the admin Code page).
    // In 5 languages: ?lang=en|km|zh|ko|ja, else the browser's language, else English.
    const docHeaders = { "Cache-Control": "no-cache", Vary: "Accept-Language" };
    // TikTok checks that the website is ours (URL prefix https://ecom.ggmt.sg/30da/): a public, non-secret file.
    if (path === `${BASE}/tiktokW03cvSBvhBWjIUvBNbumExjZmgY8sW1r.txt`) {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" })
        .end("tiktok-developers-site-verification=W03cvSBvhBWjIUvBNbumExjZmgY8sW1r");
      return;
    }
    if (path === `${BASE}/privacy`) return sendPage(req, res, 200, privacyPage({ lang: requestLang(req, url) }), docHeaders);
    if (path === `${BASE}/delete-data`) return sendPage(req, res, 200, deleteDataPage({ lang: requestLang(req, url) }), docHeaders);
    // The terms of service TikTok asks for (same look, same 5 languages).
    if (path === `${BASE}/terms`) return sendPage(req, res, 200, termsPage({ lang: requestLang(req, url) }), docHeaders);
    // The client loads its modules relative to /30da/, so the bare path gets a slash.
    if (path === BASE) {
      res.writeHead(302, { ...BASE_HEADERS, Location: `${BASE}/${url.search}` }).end();
      return;
    }
    if (path === `${BASE}/` || path === `${BASE}/index.html`) return serveStatic(req, res, "index.html");
    if (path === `${BASE}/board` || path === `${BASE}/board/`) return serveStatic(req, res, "board/index.html");
    const bm = path.match(BOARD_RE);
    if (bm) return serveStatic(req, res, `board/${bm[1]}`);
    const m = path.match(STATIC_RE);
    if (m) return serveStatic(req, res, m[1]);
  }
  res.writeHead(404, { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
}
