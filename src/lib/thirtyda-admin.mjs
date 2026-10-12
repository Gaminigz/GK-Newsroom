/**
 * 30+DA super admin web — screens 13 (Sign in) + A2 (Users & chat monitor).
 *
 *   GET  /30da/admin                      sign-in page (code only)
 *   GET  /30da/admin/monitor              live overview + chat monitor
 *   POST /30da/admin/api/signin           { code }
 *   POST /30da/admin/api/signout
 *   GET  /30da/admin/api/overview         counts, users, open flags
 *   GET  /30da/admin/api/chat?flag=|user= one full conversation
 *   POST /30da/admin/api/users/:id/block|unblock   { flagId?, undo? }
 *   POST /30da/admin/api/flags/:id/warn|dismiss
 *
 * Auth: one access code from the THIRTYDA_ADMIN_CODE env var — NO default,
 * NEVER in the repo (public). Unset means sign-in fails closed.
 * Every admin action is written to `thirtyda_audit`.
 * Data lives in `thirtyda_*` collections; sample data is seeded on first use.
 */

import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { getDb } from "./mongo.ts";
import { makeState } from "../data/thirtyda-sample.mjs";

const BASE = "/30da/admin";
const CODE = process.env.THIRTYDA_ADMIN_CODE || "";
const COOKIE = "thirtyda_admin";
const SESSION_HOURS = 8;
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

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
    ready = (async () => {
      await d.collection("thirtyda_admin_sessions").createIndex({ expires: 1 }, { expireAfterSeconds: 0 });
      if (!(await d.collection("thirtyda_users").countDocuments({}, { limit: 1 }))) {
        const s = makeState();
        await d.collection("thirtyda_users").insertMany(s.users.map((u) => ({ _id: u.id, ...u })));
        await d.collection("thirtyda_chats").insertMany(s.chats.map((c) => ({ _id: c.id, ...c })));
        await d.collection("thirtyda_flags").insertMany(s.flags.map((f) => ({ _id: f.id, ...f })));
      }
    })().catch((e) => { ready = null; throw e; });
  }
  await ready;
  return d;
}

const LEVEL_NAMES = { 1: "question", 2: "answer", 3: "chat" };
const strip = ({ _id, ...doc }) => doc;

async function load() {
  const d = await db();
  const [users, chats, flags] = await Promise.all(
    ["thirtyda_users", "thirtyda_chats", "thirtyda_flags"].map((c) => d.collection(c).find({}).toArray()),
  );
  return { d, users: users.map(strip), chats: chats.map(strip), flags: flags.map(strip) };
}

async function overview() {
  const { users, chats, flags } = await load();
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
    users: users.map(({ blockResolved, ...u }) => ({
      ...u,
      openFlags: open.filter((f) => f.from === u.id).length,
    })),
    flags: open.map((f) => {
      const chat = chats.find((c) => c.id === f.chatId);
      const msg = chat?.messages.find((m) => m.flagId === f.id) ?? {};
      return {
        ...f,
        fromName: byId.get(f.from)?.name ?? f.from,
        toName: byId.get(f.to)?.name ?? f.to,
        level: chat?.level,
        levelName: LEVEL_NAMES[chat?.level],
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
    people,
    messages: chat.messages.map((m) => {
      const f = m.flagId && flags.find((x) => x.id === m.flagId);
      return { ...m, fromName: people[m.from], flag: f ? { kind: f.kind, reason: f.reason, status: f.status } : null };
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

const attempts = new Map(); // ip -> [timestamps]
function rateLimited(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  attempts.set(ip, list);
  return list.length >= MAX_ATTEMPTS;
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "unknown";
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
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch { resolve({}); } });
  });
}

export async function handleThirtyDaAdmin(req, res, url) {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const sub = path.slice(BASE.length) || "/";

  const asset = sub.match(/^\/(app\.css|signin\.js|monitor\.js)$/);
  if (req.method === "GET" && asset) return serveFile(res, asset[1]);

  if (req.method === "POST" && sub === "/api/signin") {
    const ip = clientIp(req);
    if (rateLimited(ip)) {
      await audit(req, "signin_blocked", { reason: "rate_limit" });
      return json(res, 429, { error: "Too many attempts. Try again in 15 minutes." });
    }
    const { code = "" } = await readJson(req);
    if (!checkCode(code)) {
      attempts.get(ip).push(Date.now());
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

  let m = sub.match(/^\/api\/users\/(U-\d+)\/(block|unblock)$/);
  if (req.method === "POST" && m) {
    const d = await db();
    const users = d.collection("thirtyda_users");
    const flags = d.collection("thirtyda_flags");
    const u = await users.findOne({ _id: m[1] });
    if (!u) return json(res, 404, { error: "No such user." });
    const { flagId = null, undo = false } = await readJson(req);
    if (m[2] === "block" && !u.blocked) {
      // Blocking settles every open flag this user raised; undo reopens exactly those.
      const settled = (await flags.find({ from: u.id, status: "open" }).toArray()).map((f) => f._id);
      await flags.updateMany({ _id: { $in: settled } }, { $set: { status: "blocked" } });
      await users.updateOne({ _id: u._id }, { $set: { blocked: true, blockResolved: settled } });
    } else if (m[2] === "unblock" && u.blocked) {
      if (undo) await flags.updateMany({ _id: { $in: u.blockResolved || [] } }, { $set: { status: "open" } });
      await users.updateOne({ _id: u._id }, { $set: { blocked: false, blockResolved: [] } });
    }
    await audit(req, m[2] === "block" ? "block_user" : undo ? "undo_block" : "unblock_user", { user: u.id, flagId });
    return json(res, 200, await overview());
  }

  m = sub.match(/^\/api\/flags\/(f\d+)\/(warn|dismiss)$/);
  if (req.method === "POST" && m) {
    const d = await db();
    const flags = d.collection("thirtyda_flags");
    const f = await flags.findOne({ _id: m[1], status: "open" });
    if (!f) return json(res, 404, { error: "This flag is already closed." });
    // A warning keeps the flag in the queue so it can still be blocked or dismissed.
    await flags.updateOne({ _id: f._id }, { $set: m[2] === "warn" ? { warned: true } : { status: "dismissed" } });
    await audit(req, m[2] === "warn" ? "send_warning" : "dismiss_flag", { flag: f.id, user: f.from });
    return json(res, 200, await overview());
  }

  send(res, 404, "Not found", { "Content-Type": "text/plain" });
}
