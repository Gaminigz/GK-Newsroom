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
 * Collections: thirtyda_users, thirtyda_user_sessions, thirtyda_otps,
 * thirtyda_pairs, thirtyda_sets, thirtyda_chats, thirtyda_flags, thirtyda_counters; reads the
 * admin's question choices from thirtyda_questions (src/lib/thirtyda-questions.mjs).
 */

import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { getDb } from "./mongo.ts";
import { savePhoto, readPhoto, deletePhoto, isPhotoId, PhotoError } from "./thirtyda-photos.mjs";
import { translate, translateAll, translateEnabled } from "./thirtyda-translate.mjs";
import { areaFor, haversineKm } from "./thirtyda-geo.mjs";
import { clientIp } from "./thirtyda-net.mjs";
import {
  LANGS, LANG_ENGLISH, CONTACT_REASONS, findContactDetails, findContactDetailsAcross, charCount, checkChatMessage, checkWrittenQuestion,
  checkWrittenAnswer, PHOTO_MAX, PHOTO_SLOT_LEVELS, photoSlotsFor, photoSlotLevel, stageOpenLevel, photoVisible,
  NAME_MIN, NAME_MAX, AGE_MIN, AGE_MAX, checkAppName, checkBirthYear,
} from "../thirtyda-app/shared/rules.js";
import {
  LEVEL_RULES, L1_ANSWERS, l1Answers, ROLES, questionText, answerText,
} from "../thirtyda-app/shared/questions.js";
import { questionConfig, slotsView, flatView } from "./thirtyda-questions.mjs";

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
const STAGE_LEVEL = { l1_ask: 1, l1_answer: 1, l2_wait: 1, l2_open: 2, l3_wait: 2, l3_open: 3 };
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
    d.collection(C.sessions).createIndex({ expires: 1 }, { expireAfterSeconds: 0 }),
    d.collection(C.otps).createIndex({ expires: 1 }, { expireAfterSeconds: 0 }),
    d.collection(C.pairs).createIndex({ key: 1 }, { unique: true, sparse: true }),
    d.collection(C.pairs).createIndex({ members: 1, updatedAt: -1 }),
    d.collection(C.sets).createIndex({ pairId: 1, level: 1, from: 1 }, { unique: true }),
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

/** Every sign-in step gets a fresh token (no session fixation); what the old session proved carries over. */
async function startSession(ctx, fields) {
  const { d, session } = ctx;
  const token = crypto.randomBytes(32).toString("hex");
  const doc = {
    _id: token,
    userId: session?.userId ?? null,
    phone: session?.phone ?? null,
    phoneVerified: Boolean(session?.phoneVerified),
    verified: { gmail: Boolean(session?.verified?.gmail), facebook: Boolean(session?.verified?.facebook) },
    ...fields,
    created: new Date(),
    expires: new Date(Date.now() + SESSION_DAYS * 864e5),
  };
  await d.collection(C.sessions).insertOne(doc);
  if (session) await d.collection(C.sessions).deleteOne({ _id: session._id });
  ctx.session = doc;
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

function meView(u) {
  return {
    id: u._id,
    name: u.name,
    realName: u.realName ?? "",
    role: u.role ?? null,
    gender: u.gender ?? null,
    lang: u.lang ?? "en",
    phone: u.phone ?? null,
    // Set once (sign-up, or once on #/me for profiles made before the rule); only ever shown to its owner.
    birthYear: Number.isInteger(u.birthYear) ? u.birthYear : null,
    verified: { phone: Boolean(u.verified?.phone), gmail: Boolean(u.verified?.gmail), facebook: Boolean(u.verified?.facebook) },
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

function nextStep(stage, out, inc) {
  switch (stage) {
    case "l1_ask": return "ask";
    case "l1_answer": return inc && !inc.completedAt ? "answer" : "wait_them";
    case "l2_wait":
    case "l3_wait": return "wait_timer";
    case "l2_open": {
      const ask = !out;
      const answer = Boolean(inc && !inc.completedAt);
      return ask && answer ? "ask_answer" : ask ? "ask" : answer ? "answer" : "wait_them";
    }
    default: return "chat";
  }
}

/** PairView for `me`. `sets` = this pair's sets (questions/answers may be projected away). */
function pairView(pair, me, other, sets) {
  // An unsent Level 1 (l1_ask) is a draft of whoever opened it: each side sees it as their own
  // ("a", opened when they tapped Ask), so nothing tells B that A tapped first.
  const draft = pair.stage === "l1_ask";
  const role = draft || pair.a === me._id ? "a" : "b";
  const otherId = pair.a === me._id ? pair.b : pair.a;
  const level = STAGE_LEVEL[pair.stage] ?? 1;
  const find = (lvl, from) => sets.find((s) => s.level === lvl && s.from === from) ?? null;
  const out = level < 3 ? find(level, me._id) : null;
  const inc = level < 3 ? find(level, otherId) : null;
  const status = (s) => ({ sent: Boolean(s), answered: Boolean(s?.completedAt) });
  const received = (s) => ({ received: Boolean(s), answered: Boolean(s?.completedAt) });

  let myOutgoing = null;
  let myIncoming = null;
  if (level === 1) {
    // Level 1 runs one way: whoever sends first asks, the other answers.
    if (pair.stage === "l1_ask" || role === "a") myOutgoing = status(out);
    if (pair.stage !== "l1_ask" && role === "b") myIncoming = received(inc);
  } else if (level === 2) {
    myOutgoing = status(out);
    myIncoming = received(inc);
  }

  const answeredIn = (list) => list.reduce((n, s) => n + (s.answers?.length ?? 0), 0);
  const l1 = sets.filter((s) => s.level === 1);
  const l2 = sets.filter((s) => s.level === 2);

  return {
    id: pair._id,
    stage: pair.stage,
    level: pair.level ?? level,
    role,
    other: other
      ? { id: other._id, name: other.name, gender: other.gender ?? null, lang: other.lang ?? "en", photo: other.blocked ? null : photoUrl(other.photos?.[0]) }
      : { id: otherId, name: "", gender: null, lang: "en", photo: null },
    l2OpensAt: pair.l2OpensAt ?? null,
    l3OpensAt: pair.l3OpensAt ?? null,
    remind: Boolean(pair.remind?.[me._id]),
    next: !other || other.blocked ? "frozen" : nextStep(pair.stage, out, inc),
    myOutgoing,
    myIncoming,
    recap: { l1: { answered: answeredIn(l1), total: 5 }, l2: { answered: answeredIn(l2), total: 10 } },
    lastFrom: pair.lastChat ? (pair.lastChat.from === me._id ? "me" : "them") : null,
    updatedAt: draft ? pair.opened?.[me._id] ?? pair.createdAt : pair.updatedAt,
  };
}

/** An l1_ask pair is a draft: hidden from the other person until they open it themselves (tap Ask). */
const hiddenFrom = (pair, me) => pair.stage === "l1_ask" && pair.a !== me._id && !pair.opened?.[me._id];

/** Move l2_wait → l2_open and l3_wait → l3_open once their time has come. */
async function settle(d, pair) {
  const now = Date.now();
  let to = null;
  if (pair.stage === "l2_wait" && Date.parse(pair.l2OpensAt) <= now) to = { stage: "l2_open", level: 2, at: pair.l2OpensAt };
  else if (pair.stage === "l3_wait" && Date.parse(pair.l3OpensAt) <= now) to = { stage: "l3_open", level: 3, at: pair.l3OpensAt };
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
 * users.level = the highest level `me` has OPENED with anyone (l2_open / l3_wait → 2, l3_open → 3,
 * else 1). Pairs whose timer has run out are settled first, so a level that just opened counts at
 * once. The stored field (the admin's column) is corrected when it disagrees. Returns `me`.
 */
async function syncLevel(d, me) {
  const pairs = d.collection(C.pairs);
  const due = await pairs.find({ members: me._id, stage: { $in: ["l2_wait", "l3_wait"] } }).toArray();
  await Promise.all(due.map((p) => settle(d, p)));
  const open = await pairs
    .find({ members: me._id, stage: { $in: ["l2_open", "l3_wait", "l3_open"] } }, { projection: { stage: 1 } })
    .toArray();
  const level = open.reduce((m, p) => Math.max(m, stageOpenLevel(p.stage)), 1);
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

const SET_SUMMARY = { pairId: 1, level: 1, from: 1, to: 1, completedAt: 1, "answers.n": 1 };
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

/** E.164, +855 by default. null when it does not look like a phone number. */
function normalizePhone(raw) {
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

async function sendCode(ctx) {
  const { d, body, req } = ctx;
  const phone = normalizePhone(body.phone);
  if (!phone) throw invalid("That phone number does not look right.", { field: "phone" });
  if (!DEV_AUTH) throw fail(503, "sms_unavailable", "Text-message codes are not available yet.");

  const now = Date.now();
  const ip = clientIp(req);
  const recent = (ipSends.get(ip) || []).filter((t) => now - t < OTP_WINDOW_MS);
  if (recent.length >= IP_SENDS) throw fail(429, "rate_limited", "Too many codes. Try again in 15 minutes.");
  // Counted before any await, so parallel requests from one address all see each other.
  recent.push(now);
  ipSends.set(ip, recent);

  const code = String(crypto.randomInt(0, 1e6)).padStart(6, "0");
  try {
    await claimCodeSend(d, phone, hashCode(phone, code), now);
  } catch (err) {
    const list = ipSends.get(ip) || [];
    const k = list.indexOf(now);
    if (k >= 0) list.splice(k, 1); // nothing was sent: give the address its turn back
    throw err;
  }
  // No SMS provider yet: in dev the code comes back for the "Test code" note.
  return { ok: true, phone, resendIn: OTP_RESEND_S, ...(DEV_AUTH ? { devCode: code } : {}) };
}

/**
 * Store a new code for `phone` only if the 30 s resend gap and the 3-per-15-minutes limit allow
 * it — checked and written in one atomic update, so a burst of parallel requests gets one code,
 * not ten. Throws 429 too_soon / rate_limited otherwise.
 */
async function claimCodeSend(d, phone, codeHash, now) {
  const otps = d.collection(C.otps);
  const inWindow = {
    $filter: { input: { $ifNull: ["$sends", []] }, as: "t", cond: { $gt: ["$$t", new Date(now - OTP_WINDOW_MS)] } },
  };
  const fields = { codeHash, expires: new Date(now + OTP_WINDOW_MS), attempts: 0, sentAt: new Date(now) };
  const claimed = await otps.findOneAndUpdate(
    {
      _id: phone,
      $expr: { $and: [{ $lte: ["$sentAt", new Date(now - OTP_RESEND_S * 1000)] }, { $lt: [{ $size: inWindow }, OTP_SENDS] }] },
    },
    [{ $set: { ...fields, sends: { $concatArrays: [inWindow, [new Date(now)]] } } }],
    { returnDocument: "after" },
  );
  if (claimed) return;
  try {
    await otps.insertOne({ _id: phone, ...fields, sends: [new Date(now)] });
    return;
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

async function verifyCode(ctx) {
  const { d, body, me } = ctx;
  const phone = normalizePhone(body.phone);
  const code = String(body.code ?? "").replace(/\D/g, "");
  if (!phone || code.length !== 6) throw invalid("Enter the 6-digit code.", { field: "code" });

  const otps = d.collection(C.otps);
  // Count the attempt before comparing so parallel guesses cannot exceed the limit.
  const otp = await otps.findOneAndUpdate(
    { _id: phone, expires: { $gt: new Date() }, attempts: { $lt: OTP_ATTEMPTS } },
    { $inc: { attempts: 1 } },
    { returnDocument: "after" },
  );
  if (!otp) {
    const left = await otps.findOne({ _id: phone, expires: { $gt: new Date() } });
    if (left) throw fail(429, "too_many_attempts", "Too many tries. Ask for a new code.");
    throw fail(400, "code_expired", "That code has expired. Ask for a new one.");
  }
  if (!safeEqualHex(otp.codeHash, hashCode(phone, code))) {
    throw fail(400, "wrong_code", "That code is not right.", { attemptsLeft: Math.max(0, OTP_ATTEMPTS - otp.attempts) });
  }
  await otps.deleteOne({ _id: phone });

  const users = d.collection(C.users);
  let user = await users.findOne({ phone });
  if (!user && me) {
    // A signed-in profile (made with Google/Facebook) adds or changes its phone.
    await users.updateOne({ _id: me._id }, { $set: { phone, "verified.phone": true } });
    user = await users.findOne({ _id: me._id });
  } else if (user && !user.verified?.phone) {
    await users.updateOne({ _id: user._id }, { $set: { "verified.phone": true } });
    user.verified = { ...user.verified, phone: true };
  }
  await startSession(ctx, { userId: user?._id ?? null, phone, phoneVerified: true });
  return { ok: true, existing: Boolean(user), user: user ? meView(user) : null };
}

async function verifySocial(ctx) {
  const { d, body, me } = ctx;
  const key = { google: "gmail", facebook: "facebook" }[body.provider];
  if (!key) throw invalid("Choose Google or Facebook.", { field: "provider" });
  if (!DEV_AUTH) throw fail(503, "oauth_unavailable", "Google and Facebook sign-in are not available yet.");
  const s = ctx.session;
  const verified = { gmail: Boolean(s?.verified?.gmail), facebook: Boolean(s?.verified?.facebook), [key]: true };
  await startSession(ctx, { verified });
  if (me) await d.collection(C.users).updateOne({ _id: me._id }, { $set: { [`verified.${key}`]: true } });
  return { ok: true, verified };
}

async function signout(ctx) {
  if (ctx.session) await ctx.d.collection(C.sessions).deleteOne({ _id: ctx.session._id });
  ctx.headers["Set-Cookie"] = cookieFor(ctx.req, "", 0);
  return { ok: true };
}

// ---------------------------------------------------------------- profile handlers

async function createProfile(ctx) {
  const { d, body, session, me } = ctx;
  if (me) throw fail(409, "profile_exists", "You already have a profile.");
  if (!session.phoneVerified && !session.verified?.gmail && !session.verified?.facebook) {
    throw fail(403, "not_verified", "Verify your phone, Google or Facebook first.");
  }
  const name = checkName(body.name);
  const birthYear = checkBirth(body.birthYear);
  const realName = String(body.realName ?? "").trim().replace(/\s+/g, " ");
  if (charCount(realName) < 2 || charCount(realName) > 60) throw invalid("Write your first and last name.", { field: "realName" });
  const role = checkRole(body.role);
  if (!GENDERS.includes(body.gender)) throw invalid("Choose male, female or other.", { field: "gender" });
  const lang = checkLang(body.lang);

  const users = d.collection(C.users);
  const phone = session.phoneVerified ? session.phone : null;
  if (phone && (await users.findOne({ phone }))) throw fail(409, "phone_in_use", "This phone number already has a profile.");

  const photoId = await storePhoto(body.photo);
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
    verified: { phone: Boolean(phone), gmail: Boolean(session.verified?.gmail), facebook: Boolean(session.verified?.facebook) },
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
    createdAt: new Date(),
  };
  try {
    await users.insertOne(user);
  } catch (err) {
    await deletePhoto(photoId);
    if (err?.code === 11000) throw fail(409, "phone_in_use", "This phone number already has a profile.");
    throw err;
  }
  await d.collection(C.sessions).updateOne({ _id: session._id }, { $set: { userId: id } });
  return { user: meView(user) };
}

async function getMe(ctx) {
  const { d, me, session, url } = ctx;
  if (!session) {
    // The app's start-up probe asks without failing, so a signed-out visit logs no error.
    if (url.searchParams.get("probe") === "1") return { user: null, notices: [], session: null };
    throw fail(401, "signed_out", "Please sign in.");
  }
  if (!me) {
    return {
      user: null,
      notices: [],
      session: { phone: session.phone ?? null, phoneVerified: Boolean(session.phoneVerified), verified: session.verified ?? { gmail: false, facebook: false } },
    };
  }
  await Promise.all([
    d.collection(C.users).updateOne({ _id: me._id }, { $set: { lastSeenAt: new Date() } }),
    syncLevel(d, me),
  ]);
  return { user: meView(me), notices: unseenNotices(me) };
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
  const actions = views.filter((v) =>
    ["ask", "answer", "ask_answer"].includes(v.next) || (v.next === "chat" && v.lastFrom === "them"));
  return { actions, notices: unseenNotices(me) };
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
  if (!owner || (owner.blocked && owner._id !== me._id)) throw fail(404, "not_found", "No such photo.");
  // Per person, bound to the slot: the owner sees all; anyone sees slot 1; slot 2 needs Level 2
  // opened together, slots 3–4 Level 3. Slots never move, so a photo keeps its level.
  const index = slotsOf(owner).indexOf(id);
  let allowed = owner._id === me._id || photoVisible(index, 1);
  if (!allowed) allowed = photoVisible(index, await openLevelBetween(d, me._id, owner._id));
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
  return {
    person: {
      id: u._id,
      name: u.name,
      gender: u.gender ?? null,
      role: u.role ?? null,
      lang: u.lang ?? "en",
      km: kmBetween(me, u, Boolean(view)),
      area: u.area ?? "",
      hearts: heartsOf(u),
      verified: { phone: Boolean(u.verified?.phone), gmail: Boolean(u.verified?.gmail), facebook: Boolean(u.verified?.facebook) },
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
      _id: id, id, key, a: me._id, b: to, members: [me._id, to], level: 1, stage: "l1_ask",
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
  if (level === 1 && pair.stage !== "l1_ask") throw notYourTurn();
  if (level === 2 && (pair.stage !== "l2_open" || (await sets.findOne({ pairId: pair._id, level: 2, from: me._id })))) {
    throw notYourTurn();
  }

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
  if (level === 1) {
    // Whoever sends Level 1 first is `a`; the other is asked.
    const moved = await pairs.updateOne(
      { _id: pair._id, stage: "l1_ask" },
      { $set: { stage: "l1_answer", a: me._id, b: other._id, members: [me._id, other._id], updatedAt: at } },
    );
    if (!moved.modifiedCount) {
      await sets.deleteOne({ _id: setId });
      throw notYourTurn();
    }
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
  return { pair: await viewOf(d, me, await pairs.findOne({ _id: pair._id })) };
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
  if (level === 1) {
    return { n: a.n, key: a.key, text: answerText(a.key, lang), original: answerText(a.key, a.lang), originalLang: a.lang };
  }
  const tr = a.lang === lang ? null : a.translations?.[lang] ?? null;
  return { n: a.n, key: null, text: tr ?? a.text, original: a.text, originalLang: a.lang, translated: Boolean(tr) };
}

async function setFor(ctx, direction) {
  const { d, me, url, params } = ctx;
  const { pair, other } = await pairFor(ctx, params[0]);
  const level = url.searchParams.has("level") ? levelParam(url.searchParams.get("level")) : Math.min(2, STAGE_LEVEL[pair.stage]);
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
      ...(answered ? { answers: set.answers.map((a) => answerView(a, level, lang)) } : {}),
    },
  };
}

async function sendAnswers(ctx) {
  const { d, me, body, params } = ctx;
  const level = levelParam(body.level);
  const { pair, other } = await pairFor(ctx, params[0], { write: true });
  const sets = d.collection(C.sets);
  const set = await sets.findOne({ pairId: pair._id, level, to: me._id });
  if (!set || set.completedAt) throw notYourTurn();
  if (pair.stage !== (level === 1 ? "l1_answer" : "l2_open")) throw notYourTurn();

  const list = Array.isArray(body.answers) ? body.answers : [];
  if (level === 2) {
    const texts = list.map((a) => String(a?.text ?? "").trim());
    await stopContactDetails(ctx, pair, other, texts, { level, kind: "answer" });
    await stopSplitContactDetails(ctx, pair, other, texts, { level, kind: "answer" });
  }
  if (list.length !== set.questions.length) throw invalid(`Reply to all ${set.questions.length}.`, { index: list.length });
  const seen = new Set();
  list.forEach((a, i) => {
    const n = Number(a?.n);
    if (!set.questions.some((q) => q.n === n) || seen.has(n)) throw invalid("Reply to each line once.", { index: i });
    seen.add(n);
    if (level === 1) {
      const source = set.questions.find((q) => q.n === n)?.source;
      if (!l1Answers(source).some((x) => x.key === a.key)) {
        throw invalid(source === "written" ? "Reply to the written line with Yes or No." : "Pick one of the replies.", { index: i });
      }
    } else {
      const r = checkWrittenAnswer(String(a.text ?? "").trim());
      if (!r.ok) throw invalid(ERROR_TEXT[r.error] || "Check this reply.", { index: i, reason: r.error });
    }
  });

  const lang = me.lang ?? "en";
  const at = nowIso();
  const answers = await Promise.all(
    [...list].sort((x, y) => Number(x.n) - Number(y.n)).map(async (a) => {
      if (level === 1) {
        return { n: Number(a.n), key: a.key, text: null, lang, translations: bankTranslations((l) => answerText(a.key, l)), at };
      }
      const text = String(a.text).trim();
      const { translations } = await translateAll(text, lang);
      return { n: Number(a.n), key: null, text, lang, translations, at };
    }),
  );
  const saved = await sets.updateOne({ _id: set._id, completedAt: null }, { $set: { answers, completedAt: at } });
  if (!saved.modifiedCount) throw notYourTurn();

  const msgIds = await nextIds(d, "msg", answers.length);
  await appendMessages(d, pair, answers.map((a, i) => {
    const text = level === 1 ? answerText(a.key, lang) : a.text;
    return {
      id: msgIds[i], from: me._id, at, kind: "answer", level, n: a.n, text, lang,
      english: lang === "en" ? null : a.translations.en ?? null, translations: a.translations, hit: null, flagId: null, stopped: false,
    };
  }));

  const pairs = d.collection(C.pairs);
  const opensAt = new Date(Date.now() + WAIT_MS).toISOString();
  if (level === 1) {
    await pairs.updateOne({ _id: pair._id, stage: "l1_answer" }, { $set: { stage: "l2_wait", l2OpensAt: opensAt, updatedAt: at } });
  } else {
    const done = await sets.countDocuments({ pairId: pair._id, level: 2, completedAt: { $ne: null } });
    await pairs.updateOne(
      { _id: pair._id, stage: "l2_open" },
      { $set: done >= 2 ? { stage: "l3_wait", l3OpensAt: opensAt, updatedAt: at } : { updatedAt: at } },
    );
  }
  return { pair: await viewOf(d, me, await pairs.findOne({ _id: pair._id })) };
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
      // A blocked partner's photos are gone (the pair is frozen; GET /people says 404).
      ? { id: other._id, name: other.name, lang: other.lang ?? "en", photos: photosFor(other, { openLevel: stageOpenLevel(pair.stage) }).photos }
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

// ---------------------------------------------------------------- router

// auth: "none" (anyone), "session" (any session, profile optional), "user" (default: a profile).
const ROUTES = [
  ["POST", /^\/auth\/send-code$/, sendCode, { auth: "none" }],
  ["POST", /^\/auth\/verify-code$/, verifyCode, { auth: "none" }],
  ["POST", /^\/auth\/verify-social$/, verifySocial, { auth: "none" }],
  ["POST", /^\/auth\/signout$/, signout, { auth: "none", blockedOk: true }],
  ["POST", /^\/profile$/, createProfile, { auth: "session" }],
  ["GET", /^\/me$/, getMe, { auth: "none", blockedOk: true }],
  ["PATCH", /^\/me$/, patchMe],
  ["POST", /^\/me\/photos$/, addPhoto],
  ["PUT", /^\/me\/photos\/([0-3])$/, putPhoto],
  ["DELETE", /^\/me\/photos\/([0-3])$/, removePhoto],
  ["POST", /^\/me\/location$/, setLocation],
  ["POST", /^\/me\/heartbeat$/, heartbeat],
  ["POST", /^\/notices\/([\w-]{1,64})\/seen$/, noticeSeen],
  ["GET", /^\/photos\/([a-f0-9]{32})$/, getPhoto],
  ["GET", /^\/nearby$/, nearby],
  ["GET", /^\/people\/(U-\d+)$/, person],
  ["POST", /^\/pairs$/, createPair],
  ["GET", /^\/pairs$/, listPairs],
  ["GET", /^\/pairs\/(P-\d+)$/, getPair],
  ["GET", /^\/questions$/, questions],
  ["POST", /^\/pairs\/(P-\d+)\/sets$/, sendSet],
  ["GET", /^\/pairs\/(P-\d+)\/incoming$/, (ctx) => setFor(ctx, "in")],
  ["GET", /^\/pairs\/(P-\d+)\/outgoing$/, (ctx) => setFor(ctx, "out")],
  ["POST", /^\/pairs\/(P-\d+)\/answers$/, sendAnswers],
  ["POST", /^\/pairs\/(P-\d+)\/remind$/, remind],
  ["GET", /^\/pairs\/(P-\d+)\/messages$/, listMessages],
  ["POST", /^\/pairs\/(P-\d+)\/messages$/, postMessage],
  ["POST", /^\/pairs\/(P-\d+)\/messages\/(M-\d+)\/report$/, report],
];

async function handleApi(req, res, url, sub) {
  const ctx = { req, res, url, headers: {}, status: 200, sent: false };
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
    const auth = route.opts.auth ?? "user";
    if (auth !== "none" && !ctx.session) throw fail(401, "signed_out", "Please sign in.");
    if (auth === "user" && !ctx.me) throw fail(401, "no_profile", "Create your profile first.");
    if (ctx.me?.blocked && !route.opts.blockedOk) throw fail(403, "blocked", "This account is blocked.");
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

export async function handleThirtyDaApp(req, res, url) {
  const path = url.pathname;
  if (path === API || path.startsWith(`${API}/`)) return handleApi(req, res, url, path.slice(API.length) || "/");
  if (req.method === "GET" || req.method === "HEAD") {
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
