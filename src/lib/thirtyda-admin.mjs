/**
 * 30+DA super admin web — screens 13 (Sign in) + A2 (Users & chat monitor) + Questions.
 *
 *   GET  /30da/admin                      sign-in page (code only)
 *   GET  /30da/admin/monitor              live overview + chat monitor
 *   GET  /30da/admin/questions            the question choices people pick from (Level 1 / Level 2)
 *   POST /30da/admin/api/signin           { code }
 *   POST /30da/admin/api/signout
 *   GET  /30da/admin/api/overview         counts, users, open flags
 *   GET  /30da/admin/api/chat?flag=|user= one full conversation
 *   POST /30da/admin/api/users/:id/block|unblock   { flagId?, undo? }
 *   POST /30da/admin/api/flags/:id/warn|dismiss
 *   GET  /30da/admin/api/questions        both levels: [{ id:'L1', slots:[[{key,text:{en,km,zh,ko,ja}}×5]×4], titles, … }]
 *   PUT  /30da/admin/api/questions/L1|L2  { slots, titles?, updatedAt? } → saved level | 422 { problems } | 409 changed
 *   POST /30da/admin/api/questions/L1|L2/reset   back to the built-in choices
 *   GET  /30da/admin/connections  (= /30da/admin/code)   the "Code" page: how people get their code / sign in
 *   GET  /30da/admin/api/connections      { keyReady, devAuth, testCodes, onRailway, connections:[{ id, name, set, last4, updatedAt, updatedBy, live, … }] }
 *   PUT  /30da/admin/api/connections/telegram        { token } → saved (encrypted) | 422 bad format | 503 no key
 *   PUT  /30da/admin/api/connections/whatsapp        { token?, phoneNumberId, templateName, templateLang? } (empty token = keep the saved one)
 *   PUT  /30da/admin/api/connections/google          { clientId, clientSecret? }   (empty secret = keep the saved one)
 *   PUT  /30da/admin/api/connections/facebook        { appId, appSecret? }
 *   DELETE /30da/admin/api/connections/:id           remove what is saved for telegram | whatsapp | google | facebook
 *   POST /30da/admin/api/connections/telegram|whatsapp/test   { phone } → a real code to that phone, or why not.
 *        A test that goes through turns the channel on in the app (src/lib/thirtyda-code-send.mjs channelOffer);
 *        the answer carries the page's fresh data (`view`) so the card can say so at once.
 *   GET  /30da/admin/api/connections/google|facebook/try    (a new tab) the real sign-in with a test state bound to
 *        this admin session → Google / Facebook → the app's callback, which ends on a small "Works ✓ / Did not work"
 *        page and makes no user or session (src/lib/thirtyda-app.mjs signinTry)
 *
 * Secrets (src/lib/thirtyda-settings.mjs) are sealed with THIRTYDA_SECRET_KEY and never sent back:
 * only { set, last4, updatedAt, updatedBy }. The audit log never carries them either.
 *
 * Auth: one access code from the THIRTYDA_ADMIN_CODE env var — NO default,
 * NEVER in the repo (public). Unset means sign-in fails closed.
 * Every admin action is written to `thirtyda_audit`.
 * Data lives in the `thirtyda_*` collections the app (src/lib/thirtyda-app.mjs)
 * writes. Nothing is seeded here: demo data only comes from
 * `npm run 30da:seed`, which refuses to touch a non-dev database.
 */

import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { getDb } from "./mongo.ts";
import { clientIp } from "./thirtyda-net.mjs";
import {
  QUESTION_LEVELS, levelDocId, levelFromId, questionConfig, saveQuestions, resetQuestions,
} from "./thirtyda-questions.mjs";
import { LEVEL_RULES } from "../thirtyda-app/shared/questions.js";
import {
  keyReady, saveSecret, removeSecret, secretStatus, saveFields, readFields, fieldsStatus, SettingsError,
} from "./thirtyda-settings.mjs";
import {
  checkTelegramToken, checkWhatsAppFields, channelLive, channelOffer, deliverCode, testCodesAllowed, CODE_TTL_S,
} from "./thirtyda-code-send.mjs";
import {
  checkSigninFields, signinRedirect, signinKeys, publicOrigin, createSigninState, authorizeUrl, stateCookie, stateHash, SIGNIN_WIRED,
} from "./thirtyda-signin.mjs";
import { outboundFetch } from "./thirtyda-test-fetch.mjs";
import { tryResultPage, requestLang } from "./thirtyda-pages.mjs";
import { normalizePhone } from "./thirtyda-app.mjs";
import { QUESTION_CHOICES, CHOICE_LIMITS, TITLE_LIMITS } from "../thirtyda-app/shared/question-slots.js";

const BASE = "/30da/admin";
const CODE = process.env.THIRTYDA_ADMIN_CODE || "";
const COOKIE = "thirtyda_admin";
const WARNING_TEXT =
  "We stopped a message that broke the 30+DA rules. Contact details are never allowed. Next time the account is blocked.";
const SESSION_HOURS = 8;
const MAX_ATTEMPTS = 5; // wrong codes per IP per window
const MAX_FAILURES = 20; // wrong codes from everyone together per window: caps guessing from rotating IPs
const WINDOW_MS = 15 * 60 * 1000;
const MAX_WRITES = 30; // question saves/resets per admin session per window
const QUESTIONS_BODY_MAX = 200_000; // 20 choices × 5 languages × 100 characters, with room to spare
const MAX_TESTS = 10; // real Telegram test codes per admin session per window (each one costs money)

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "Content-Security-Policy":
    "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'",
};

// ---------- db ----------
let ready = null;
async function db() {
  const d = await getDb();
  if (!ready) {
    ready = d.collection("thirtyda_admin_sessions")
      .createIndex({ expires: 1 }, { expireAfterSeconds: 0 })
      .catch((e) => { ready = null; throw e; });
  }
  await ready;
  return d;
}

const LEVEL_NAMES = { 1: "question", 2: "answer", 3: "chat" };
const strip = ({ _id, ...doc }) => doc;

/** Live presence from the app's heartbeat; older (sample) rows keep their stored value. */
function presenceOf(u, now = Date.now()) {
  if (!u.lastSeenAt) return u.presence || "offline";
  const age = now - new Date(u.lastSeenAt).getTime();
  return age < 2 * 60e3 ? "online" : age < 15 * 60e3 ? "idle" : "offline";
}

async function load() {
  const d = await db();
  const [users, chats, flags] = await Promise.all(
    ["thirtyda_users", "thirtyda_chats", "thirtyda_flags"].map((c) => d.collection(c).find({}).toArray()),
  );
  return { d, users: users.map(strip), chats: chats.map(strip), flags: flags.map(strip) };
}

async function overview() {
  const { users: rows, chats, flags } = await load();
  const users = rows.map((u) => ({ ...u, presence: presenceOf(u) }));
  const byId = new Map(users.map((u) => [u.id, u]));
  const open = flags.filter((f) => f.status === "open").sort((a, b) => b.at.localeCompare(a.at));
  const live = users.filter((u) => !u.blocked);
  return {
    updatedAt: new Date().toISOString(),
    stats: {
      online: live.filter((u) => u.presence === "online").length,
      level3Chats: chats.filter((c) => c.level === 3 && !byId.get(c.a)?.blocked && !byId.get(c.b)?.blocked).length,
      openFlags: open.length,
      blocked: users.length - live.length,
    },
    users: users.map(({ blockResolved, location, locOffset, locMoves, locAt, notices, ...u }) => ({
      ...u,
      openFlags: open.filter((f) => f.from === u.id).length,
    })),
    flags: open.map((f) => {
      const chat = chats.find((c) => c.id === f.chatId);
      const msg = chat?.messages.find((m) => m.flagId === f.id) ?? {};
      // The level the message was written at, not where the pair is now.
      const level = msg.level ?? chat?.level;
      return {
        ...f,
        fromName: byId.get(f.from)?.name ?? f.from,
        toName: byId.get(f.to)?.name ?? f.to,
        level,
        levelName: LEVEL_NAMES[level],
        message: { text: msg.text ?? "", english: msg.english ?? null, hit: msg.hit ?? null },
      };
    }),
  };
}

async function chatFor({ flag, user }) {
  const { users, chats, flags } = await load();
  let chat;
  if (flag) chat = chats.find((c) => c.id === flags.find((f) => f.id === flag)?.chatId);
  else if (user) {
    // Most recent conversation with messages for this user.
    chat = chats
      .filter((c) => (c.a === user || c.b === user) && c.messages.length)
      .sort((x, y) => y.messages.at(-1).at.localeCompare(x.messages.at(-1).at))[0];
  }
  if (!chat) return null;
  const name = (id) => users.find((u) => u.id === id)?.name ?? id;
  const people = { [chat.a]: name(chat.a), [chat.b]: name(chat.b) };
  return {
    id: chat.id,
    level: chat.level,
    levelName: LEVEL_NAMES[chat.level],
    // Someone chose "Forget it" after Level 2: the conversation is over (the 'decision' rows say who).
    endedAt: chat.endedAt ?? null,
    people,
    messages: chat.messages.map((m) => {
      const f = m.flagId && flags.find((x) => x.id === m.flagId);
      // A 'decision' row with no sender is the app's own note ("Both chose to open the chat").
      return { ...m, fromName: m.from ? people[m.from] : "30+DA", flag: f ? { kind: f.kind, reason: f.reason, status: f.status } : null };
    }),
  };
}

// ---------- auth ----------
function checkCode(code) {
  if (!CODE) return false;
  // Compare digests so length differences don't leak through timing.
  const a = crypto.createHash("sha256").update(String(code)).digest();
  const b = crypto.createHash("sha256").update(CODE).digest();
  return crypto.timingSafeEqual(a, b);
}

const attempts = new Map(); // ip -> [timestamps of wrong codes]
let failures = []; // every wrong code, any IP
function rateLimited(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  attempts.set(ip, list);
  failures = failures.filter((t) => now - t < WINDOW_MS);
  return list.length >= MAX_ATTEMPTS || failures.length >= MAX_FAILURES;
}

function tokenOf(req) {
  return (req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`))?.[1] ?? null;
}

async function signedIn(req) {
  const token = tokenOf(req);
  if (!token) return false;
  const d = await db();
  return Boolean(await d.collection("thirtyda_admin_sessions").findOne({ _id: token, expires: { $gt: new Date() } }));
}

async function audit(req, action, extra = {}) {
  const d = await db();
  await d.collection("thirtyda_audit").insertOne({ at: new Date(), action, ip: clientIp(req), ...extra });
}

// ---------- http ----------
function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

function json(res, status, obj, headers = {}) {
  send(res, status, JSON.stringify(obj), { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
}

const TYPES = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8" };
async function serveFile(res, name) {
  const buf = await readFile(new URL(`../thirtyda-admin/${name}`, import.meta.url));
  send(res, 200, buf, { "Content-Type": TYPES[name.split(".").pop()], "Cache-Control": "no-store" });
}

function readJson(req) {
  return readJsonBody(req, 1e4).then((r) => r.value ?? {});
}

/**
 * A JSON object body up to `max` BYTES → { value }, or { tooLarge } / { bad }.
 * The raw Buffers are joined before decoding: decoding chunk by chunk would turn a Khmer or
 * Chinese character split across two chunks into U+FFFD.
 */
function readJsonBody(req, max) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let over = false;
    req.on("data", (c) => {
      if (over) return;
      size += c.length;
      if (size > max) { over = true; chunks.length = 0; return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (over) return resolve({ tooLarge: true });
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        const v = JSON.parse(raw.trim() ? raw : "{}");
        resolve(v && typeof v === "object" && !Array.isArray(v) ? { value: v } : { bad: true });
      } catch {
        resolve({ bad: true });
      }
    });
    req.on("error", () => resolve({ bad: true }));
  });
}

/**
 * Writes must come from the admin pages themselves. SameSite=Strict keeps the cookie off other
 * sites, but not off a sibling subdomain: refuse a foreign Origin / Sec-Fetch-Site, and any body
 * that is not JSON (an HTML form can only send form-encoded or text/plain without a preflight).
 * → null when fine, else [status, message].
 */
function writeRefused(req) {
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") return [403, "Requests must come from the admin pages."];
  const origin = req.headers.origin;
  if (origin) {
    let host = null;
    try { host = new URL(origin).host; } catch { /* "null" or junk */ }
    if (host !== (req.headers["x-forwarded-host"] || req.headers.host)) return [403, "Requests must come from the admin pages."];
  }
  const type = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return [415, "Send JSON (Content-Type: application/json)."];
  return null;
}

const writes = new Map(); // admin session → [timestamps of question saves/resets]
function writeLimited(req) {
  const key = tokenOf(req) || clientIp(req);
  const now = Date.now();
  const list = (writes.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= MAX_WRITES) {
    writes.set(key, list);
    return true;
  }
  list.push(now);
  writes.set(key, list);
  return false;
}

const tests = new Map(); // admin session → [timestamps of test sends]
function testLimited(req) {
  const key = tokenOf(req) || clientIp(req);
  const now = Date.now();
  const list = (tests.get(key) || []).filter((t) => now - t < WINDOW_MS);
  tests.set(key, list);
  if (list.length >= MAX_TESTS) return true;
  list.push(now);
  return false;
}

/** "+85512345678" → "+855•••••678": enough for the audit to tell test numbers apart. */
const maskPhone = (p) => (p ? `${p.slice(0, 4)}${"•".repeat(Math.max(0, p.length - 7))}${p.slice(-3)}` : null);

/**
 * The Code page's data. Never a secret: a secret shows only its last 4 characters (last4 / masks); the
 * plain fields (WhatsApp phone number ID + template, Google client ID, Facebook app ID) show as saved.
 */
async function connectionsView(d, req) {
  const tg = await secretStatus(d, "telegram");
  const envToken = String(process.env.THIRTYDA_TG_TOKEN ?? "").trim();
  const { readable, lastSend, ...view } = tg;
  const devAuth = process.env.THIRTYDA_DEV_AUTH === "1";
  const [wa, google, facebook] = await Promise.all(["whatsapp", "google", "facebook"].map((n) => fieldsStatus(d, n)));
  const [tgOffer, waOffer] = await Promise.all(["telegram", "whatsapp"].map((c) => channelOffer(d, c)));
  // Whether the app offers the channel: only once a test code went through (and no lasting failure since).
  const offer = ({ offered, state, reason, detail, at }) => ({ offered, offer: { state, reason, detail, at } });
  const origin = publicOrigin(req);
  const keysOk = { google: Boolean(await signinKeys(d, "google")), facebook: Boolean(await signinKeys(d, "facebook")) };
  const signin = (id, name, st) => ({
    id, name, kind: "signin", ...st,
    // Live = the app's button really signs people in (the same rule as GET /auth/methods).
    live: Boolean(SIGNIN_WIRED[id]) && keysOk[id],
    wired: SIGNIN_WIRED[id],
    redirect: signinRedirect(req, id),
    privacyUrl: `${origin}/30da/privacy`,
    deleteUrl: `${origin}/30da/delete-data`,
    tryUrl: `${BASE}/api/connections/${id}/try`,
  });
  return {
    keyReady: keyReady(),
    devAuth,
    // Exactly what the app does (same rule): on-screen test codes only in test mode with no channel set up.
    testCodes: await testCodesAllowed(d, devAuth),
    // On Railway (the live server) test mode must be off: the page shows a red warning while it is on.
    onRailway: Boolean(process.env.RAILWAY_ENVIRONMENT),
    connections: [
      {
        id: "telegram",
        name: "Telegram",
        kind: "code",
        ...view,
        readable,
        lastSend,
        // THIRTYDA_TG_TOKEN is used only while nothing readable is saved here.
        envFallback: envToken ? { last4: envToken.slice(-4) } : null,
        live: (view.set && readable) || Boolean(envToken),
        ...offer(tgOffer),
      },
      // Live once all four fields are saved and readable (channelLive); offered once a test code went through.
      { id: "whatsapp", name: "WhatsApp", kind: "code", ...wa, live: await channelLive(d, "whatsapp"), ...offer(waOffer) },
      signin("google", "Google sign-in", google),
      signin("facebook", "Facebook sign-in", facebook),
    ],
  };
}

/** PUT bodies of the "fields" connections: what the admin typed → checked values (a secret left empty keeps the saved one). */
const FIELD_CHECKS = {
  whatsapp: (input, current) => checkWhatsAppFields(input, current),
  google: (input, current) => checkSigninFields("google", input, current),
  facebook: (input, current) => checkSigninFields("facebook", input, current),
};
const CONNECTION_NAMES = { telegram: "Telegram", whatsapp: "WhatsApp", google: "Google", facebook: "Facebook" };
const TESTABLE = ["telegram", "whatsapp"];

/** One level as the Questions page edits it. */
function questionsView(level, config) {
  return {
    id: levelDocId(level),
    level,
    pick: LEVEL_RULES[level].pick,
    write: LEVEL_RULES[level].write,
    choices: QUESTION_CHOICES,
    limits: { min: CHOICE_LIMITS[0], max: CHOICE_LIMITS[1] },
    titleLimits: { min: TITLE_LIMITS[0], max: TITLE_LIMITS[1] },
    slots: config.slots,
    titles: config.titles,
    updatedAt: config.updatedAt,
    updatedBy: config.updatedBy,
    reset: config.reset,
    isDefault: config.isDefault,
    matchesDefault: config.matchesDefault,
  };
}

export async function handleThirtyDaAdmin(req, res, url) {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const sub = path.slice(BASE.length) || "/";

  const asset = sub.match(/^\/(app\.css|signin\.js|monitor\.js|questions\.js|connections\.js)$/);
  if (req.method === "GET" && asset) return serveFile(res, asset[1]);

  if (req.method !== "GET" && req.method !== "HEAD" && sub.startsWith("/api/")) {
    const refused = writeRefused(req);
    if (refused) {
      req.resume();
      return json(res, refused[0], { error: refused[1] });
    }
  }

  if (req.method === "POST" && sub === "/api/signin") {
    const ip = clientIp(req);
    if (rateLimited(ip)) {
      await audit(req, "signin_blocked", { reason: "rate_limit" });
      return json(res, 429, { error: "Too many attempts. Try again in 15 minutes." });
    }
    const { code = "" } = await readJson(req);
    if (!checkCode(code)) {
      attempts.get(ip).push(Date.now());
      failures.push(Date.now());
      await audit(req, "signin_failed");
      return json(res, 401, { error: "That code is not right." });
    }
    attempts.delete(ip);
    const token = crypto.randomBytes(32).toString("hex");
    const d = await db();
    await d.collection("thirtyda_admin_sessions").insertOne({
      _id: token,
      created: new Date(),
      expires: new Date(Date.now() + SESSION_HOURS * 3600e3),
    });
    await audit(req, "signin");
    return json(res, 200, { ok: true, next: `${BASE}/monitor` }, {
      "Set-Cookie": `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=${BASE}; Max-Age=${SESSION_HOURS * 3600}`,
    });
  }

  const me = await signedIn(req);

  if (req.method === "GET" && sub === "/") {
    if (me) return send(res, 302, "", { Location: `${BASE}/monitor` });
    return serveFile(res, "signin.html");
  }
  if (req.method === "GET" && sub === "/monitor") {
    if (!me) return send(res, 302, "", { Location: BASE });
    await audit(req, "view_monitor");
    return serveFile(res, "monitor.html");
  }
  if (req.method === "GET" && sub === "/questions") {
    if (!me) return send(res, 302, "", { Location: BASE });
    await audit(req, "view_questions");
    return serveFile(res, "questions.html");
  }
  if (req.method === "GET" && (sub === "/connections" || sub === "/code")) {
    // The "Code" page; /code is the same page under its new name.
    if (!me) return send(res, 302, "", { Location: BASE });
    await audit(req, "view_connections");
    return serveFile(res, "connections.html");
  }

  // "Try sign-in" (Google / Facebook card): opened in a new tab, so it answers with pages and redirects, not JSON.
  const tryM = req.method === "GET" && sub.match(/^\/api\/connections\/(google|facebook)\/try$/);
  if (tryM) {
    if (!me) return send(res, 302, "", { Location: BASE });
    const provider = tryM[1];
    const page = (reason) => send(res, 200, tryResultPage({ provider, ok: false, reason, lang: requestLang(req, url) }), {
      "Content-Type": TYPES.html, "Cache-Control": "no-store", "X-Robots-Tag": "noindex", Vary: "Accept-Language",
    });
    if (testLimited(req)) return page("too_many");
    const d = await db();
    const keys = await signinKeys(d, provider);
    if (!keys) return page("no_keys");
    // The test state is bound to this admin session (its token's hash): the callback checks it is still signed in.
    const state = await createSigninState(d, provider, { test: true, adminHash: stateHash(tokenOf(req)) });
    await audit(req, "signin_try_start", { connection: provider });
    return send(res, 302, "", {
      Location: authorizeUrl(provider, { clientId: keys.id, redirectUri: signinRedirect(req, provider), state }),
      "Set-Cookie": stateCookie(req, provider, state),
      "Cache-Control": "no-store",
    });
  }

  if (sub.startsWith("/api/") && !me) return json(res, 401, { error: "signed_out" });

  if (req.method === "POST" && sub === "/api/signout") {
    const d = await db();
    await d.collection("thirtyda_admin_sessions").deleteOne({ _id: tokenOf(req) });
    await audit(req, "signout");
    return json(res, 200, { ok: true }, { "Set-Cookie": `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=${BASE}; Max-Age=0` });
  }

  if (req.method === "GET" && sub === "/api/overview") return json(res, 200, await overview());

  if (req.method === "GET" && sub === "/api/chat") {
    const flag = url.searchParams.get("flag");
    const user = url.searchParams.get("user");
    const chat = await chatFor({ flag, user });
    await audit(req, "view_chat", { flag, user, chat: chat?.id ?? null });
    return json(res, 200, { chat });
  }

  if (req.method === "GET" && sub === "/api/questions") {
    const d = await db();
    const levels = await Promise.all(QUESTION_LEVELS.map(async (level) => questionsView(level, await questionConfig(d, level))));
    return json(res, 200, { levels });
  }

  let m = sub.match(/^\/api\/questions\/(L\d)(\/reset)?$/);
  if (m && ((req.method === "PUT" && !m[2]) || (req.method === "POST" && m[2]))) {
    const level = levelFromId(m[1]);
    if (!level) return json(res, 404, { error: "No such level." });
    if (writeLimited(req)) return json(res, 429, { error: "Too many saves. Try again in a few minutes." });
    const d = await db();
    if (m[2]) {
      const { config, diff } = await resetQuestions(d, level);
      await audit(req, "questions_reset", { level: m[1], changes: diff.changes, summary: diff.summary });
      return json(res, 200, { ...questionsView(level, config), changes: diff.changes, summary: diff.summary });
    }
    const body = await readJsonBody(req, QUESTIONS_BODY_MAX);
    if (body.tooLarge) return json(res, 413, { error: "That is too much text to save." });
    if (body.bad || !Array.isArray(body.value.slots)) return json(res, 400, { error: "Send { slots: [...] }." });
    const opts = {
      ...("updatedAt" in body.value ? { baseUpdatedAt: body.value.updatedAt } : {}),
      ...("titles" in body.value ? { titles: body.value.titles } : {}),
    };
    const r = await saveQuestions(d, level, body.value.slots, opts);
    if (r.conflict) {
      return json(res, 409, {
        error: "These questions were changed in another tab. Reload to see the latest before saving.",
        current: questionsView(level, r.current),
      });
    }
    if (!r.ok) {
      const n = r.problems.length;
      return json(res, 422, { error: `Fix ${n} ${n === 1 ? "problem" : "problems"} before saving.`, problems: r.problems });
    }
    await audit(req, "questions_update", { level: m[1], changes: r.diff.changes, summary: r.diff.summary });
    return json(res, 200, { ...questionsView(level, r.config), changes: r.diff.changes, summary: r.diff.summary });
  }

  if (req.method === "GET" && sub === "/api/connections") return json(res, 200, await connectionsView(await db(), req));

  m = sub.match(/^\/api\/connections\/([a-z]+)(\/test)?$/);
  if (m && ((m[2] && req.method === "POST") || (!m[2] && (req.method === "PUT" || req.method === "DELETE")))) {
    const id = m[1];
    if (!CONNECTION_NAMES[id]) {
      req.resume();
      return json(res, 404, { error: "There is no such card on this page." });
    }
    if (m[2] && !TESTABLE.includes(id)) {
      req.resume();
      return json(res, 404, { error: `${CONNECTION_NAMES[id]} has no test code: use Try sign-in on its card.` });
    }
    if (writeLimited(req)) {
      req.resume();
      return json(res, 429, { error: "Too many changes. Try again in a few minutes." });
    }
    const d = await db();
    const name = CONNECTION_NAMES[id];

    if (m[2]) {
      // A real code to a real phone through what is saved (Telegram: or THIRTYDA_TG_TOKEN): proves the setup works.
      const body = await readJsonBody(req, 1e4);
      if (body.bad || body.tooLarge) return json(res, 400, { error: "Send { phone }." });
      const phone = normalizePhone(body.value.phone);
      if (!phone) return json(res, 422, { error: "That phone number does not look right. Write it with the country code, e.g. +855 12 345 678.", reason: "bad_phone" });
      const view = await connectionsView(d, req);
      if (!view.connections.find((c) => c.id === id)?.live) {
        const what = id === "telegram" ? "a Telegram token" : "all four WhatsApp boxes";
        return json(res, 400, { error: `Save ${what} first, then send a test code.`, reason: "not_set" });
      }
      if (testLimited(req)) return json(res, 429, { error: `That is ${MAX_TESTS} test codes in 15 minutes. Try again later.` });
      const code = String(crypto.randomInt(0, 1e6)).padStart(6, "0");
      // test: a code that goes through turns the channel on in the app; a lasting failure stops it (channelOffer).
      const r = await deliverCode(id, phone, code, { d, record: false, test: true, fetchImpl: outboundFetch() });
      await audit(req, "connection_test", {
        connection: id, phone: maskPhone(phone), ok: r.ok, ...(r.ok ? { requestId: r.requestId } : { reason: r.reason, detail: r.detail }),
      });
      const fresh = await connectionsView(d, req);
      if (!r.ok) return json(res, 422, { ok: false, error: r.message, reason: r.reason, detail: r.detail, phone, view: fresh });
      // The test code is not a sign-in code (nothing stores it): showing it lets the admin match what arrives.
      return json(res, 200, { ok: true, phone, code, ttl: CODE_TTL_S, requestId: r.requestId, cost: r.cost, balance: r.balance, view: fresh });
    }

    if (req.method === "DELETE") {
      req.resume();
      const r = await removeSecret(d, id);
      await audit(req, "connection_remove", { connection: id, removed: r.removed });
      return json(res, 200, await connectionsView(d, req));
    }

    const body = await readJsonBody(req, 1e4);
    if (body.tooLarge) return json(res, 413, { error: "That is far too long to save." });
    if (body.bad) return json(res, 400, { error: id === "telegram" ? "Send { token }." : "Send the boxes as JSON." });
    try {
      if (id === "telegram") {
        const c = checkTelegramToken(body.value.token);
        if (!c.ok) return json(res, 422, { error: c.error, field: "token" });
        const saved = await saveSecret(d, "telegram", c.token, { by: "superadmin" });
        await audit(req, "connection_save", { connection: "telegram", last4: saved.last4 });
      } else {
        // An empty secret box keeps the secret already saved (so a template name can change without the token).
        const current = await readFields(d, id).catch(() => null);
        const c = FIELD_CHECKS[id](body.value, current);
        if (!c.ok) return json(res, 422, { error: c.error, field: c.field });
        const saved = await saveFields(d, id, c.values, { by: "superadmin" });
        // Never a secret in the audit: only which boxes changed, and the secrets' last 4.
        const changed = Object.keys(c.values).filter((f) => !current || current[f] !== c.values[f]);
        await audit(req, "connection_save", { connection: id, masks: saved.masks, changed });
      }
    } catch (err) {
      if (err instanceof SettingsError && err.code === "no_key") {
        await audit(req, "connection_save_refused", { connection: id, reason: "no_key" });
        return json(res, 503, {
          error: `The server's lock key is missing, so the ${name} keys cannot be saved yet. Ask your developer to set it, then save again.`,
          reason: "no_key",
        });
      }
      throw err;
    }
    return json(res, 200, await connectionsView(d, req));
  }

  m = sub.match(/^\/api\/users\/(U-\d+)\/(block|unblock)$/);
  if (req.method === "POST" && m) {
    const d = await db();
    const users = d.collection("thirtyda_users");
    const flags = d.collection("thirtyda_flags");
    const u = await users.findOne({ _id: m[1] });
    if (!u) return json(res, 404, { error: "No such user." });
    const { flagId = null, undo = false } = await readJson(req);
    const alreadyBlocked = m[2] === "block" && Boolean(u.blocked);
    if (m[2] === "block") {
      // Blocking settles every open flag this user raised; undo reopens exactly those. A flag
      // raised after the block (e.g. a report on an older message) settles too, but then the
      // block itself is not new, so there is nothing to undo.
      const settled = (await flags.find({ from: u.id, status: "open" }).toArray()).map((f) => f._id);
      await flags.updateMany({ _id: { $in: settled } }, { $set: { status: "blocked" } });
      await users.updateOne(
        { _id: u._id },
        alreadyBlocked ? { $addToSet: { blockResolved: { $each: settled } } } : { $set: { blocked: true, blockResolved: settled } },
      );
    } else if (m[2] === "unblock" && u.blocked) {
      if (undo) await flags.updateMany({ _id: { $in: u.blockResolved || [] } }, { $set: { status: "open" } });
      await users.updateOne({ _id: u._id }, { $set: { blocked: false, blockResolved: [] } });
    }
    await audit(req, m[2] === "block" ? (alreadyBlocked ? "block_user_again" : "block_user") : undo ? "undo_block" : "unblock_user", { user: u.id, flagId });
    return json(res, 200, { ...(await overview()), alreadyBlocked });
  }

  m = sub.match(/^\/api\/flags\/(f\d+)\/(warn|dismiss)$/);
  if (req.method === "POST" && m) {
    const d = await db();
    const flags = d.collection("thirtyda_flags");
    const f = await flags.findOne({ _id: m[1], status: "open" });
    if (!f) return json(res, 404, { error: "This flag is already closed." });
    // A warning keeps the flag in the queue so it can still be blocked or dismissed.
    await flags.updateOne({ _id: f._id }, { $set: m[2] === "warn" ? { warned: true } : { status: "dismissed" } });
    if (m[2] === "warn" && !f.warned) {
      // The app shows unseen notices as a dialog the user has to acknowledge.
      await d.collection("thirtyda_users").updateOne({ _id: f.from }, {
        $push: {
          notices: {
            id: `N-${crypto.randomBytes(6).toString("hex")}`,
            kind: "warning",
            flagId: f.id,
            text: WARNING_TEXT,
            at: new Date().toISOString(),
            seenAt: null,
          },
        },
      });
    }
    await audit(req, m[2] === "warn" ? "send_warning" : "dismiss_flag", { flag: f.id, user: f.from });
    return json(res, 200, await overview());
  }

  send(res, 404, "Not found", { "Content-Type": "text/plain" });
}
