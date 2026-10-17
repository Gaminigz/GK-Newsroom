/**
 * GK API Hub · tower 15 "Local AI" (owner 2026-10-17: "llm.ggmt.sg becomes the main local AI for everything", plan step 3).
 * The M1 runs a gateway, llm.ggmt.sg/v2, beside today's guard: every app calls it with its OWN token, and it answers with
 * local models first (chat, translate, places, the Gemini Worker's jobs, embeddings, Yai's PA / Big Brain routes, and
 * Claude only where an app's rule allows it). This tower is where those rules live: the per-app tokens, what each app may
 * use, the caps, and what happened (counts only).
 *
 * Pull design, like towers 11 · Wan and 14 · Agent Desk: this server never calls the M1. The gateway calls OUT with the
 * GATEWAY token to (1) fetch its config — every app's token as a SHA-256, its allowed services, the caps — and (2) post
 * a heartbeat with its health and its counts. The apps never call this hub: they call the gateway, which checks their
 * token against the hashes it fetched. A token is shown once on the tower and kept here only as SHA-256 + last 4.
 *
 * Rules kept here: 30+DA may use `translate` only — never a Gemini Worker service and never Claude (private chats: Hy-MT2
 * on the M1, the paid Gemini API as tower 13's backup). Counts only, never a prompt or an answer.
 *
 * Contract v1 (2026-10-17). Base /30da/hub/ai (https://ecom.ggmt.sg/30da/hub/ai), JSON, every call
 * `Authorization: Bearer <gateway token "aigw_…">`. Errors are { error: <code>, message, field? } like towers 11 and 14.
 *   GET  /config  [If-None-Match: "<version>"]
 *        → 200 { version, updated_at, poll_seconds: 60, services: { <service>: { enabled, daily_cap } },
 *          apps: { <app>: { name, enabled, token_sha256 | null, token_last4 | null, allowed: [<service>…], daily_cap } } }
 *          (ETag: "<version>") · 304 nothing changed · 401 unauthorized
 *        services: chat · translate · places · desk_khmer (Gemini Worker: Khmer for our own content) · desk_maps (Maps
 *          details) · desk_images (pictures) · embeddings · yai_routes (Yai's PA / Big Brain routes) · claude
 *        apps: yai · iews · iews_ba · thirtyda · newsroom · media · mobile (the mobile apps' backends)
 *        An app call is allowed when: its token's SHA-256 matches, the app is enabled, the service is in its `allowed`
 *        and enabled, and today's calls (Phnom Penh day) are under both the app's and the service's daily_cap (0 = no cap).
 *   POST /heartbeat  { gateway: "M1 Local AI", version?, uptime_s?,
 *          models?: [{ id, loaded?: bool, kind?: "chat"|"translate"|"embed"|"other" }] (≤ 30),
 *          ram?: { free_mb, total_mb }, desk?: { text?, image?, maps? : "ready"|"busy"|"signed_out"|"error"|"closed" },
 *          counts?: { batch_id, by: [{ app, service, calls, ok, failed, ms_total? }] (≤ 200) } }
 *        → 200 { ok: true, config_version } (fetch /config again when it differs) · 400 invalid {field} · 401
 *        Call it every ~60 s. `counts` are the calls since the last heartbeat that went through; a retry with the same
 *        batch_id is counted once. The tower shows the M1 Live for 3 minutes after a heartbeat.
 *
 * Kept: the config in thirtyda_settings `ai_config` (services, apps); the tokens as hashed TOKEN_SETTINGS (ai_gateway,
 * ai_<app>); the last heartbeat in `ai_gateway_seen`; daily counts per app and service in `thirtyda_hub_ai_counts`
 * (one small doc per day, app and service; gone after 90 days).
 *
 * The admin side (src/lib/thirtyda-admin.mjs, Code page tower 15): aiAdminView, newAiToken, revokeAiToken,
 * saveAiService, saveAiApp.
 */

import crypto from "node:crypto";
import { getDb } from "./mongo.ts";
import { SETTINGS_COLLECTION, checkToken, tokenStatus, makeToken, removeToken } from "./thirtyda-settings.mjs";
import { publicOrigin } from "./thirtyda-signin.mjs";
import { PP_OFFSET_MS } from "../thirtyda-app/shared/meet.js";
import { HUB_BASE, HubError, fail, invalid, readJson, sendJson, BASE_HEADERS } from "./thirtyda-hub-wan.mjs";

export const AI_BASE = `${HUB_BASE}/ai`;
export const AI_COUNTS = "thirtyda_hub_ai_counts";
const CONFIG_ID = "ai_config";
const SEEN_ID = "ai_gateway_seen";
export const AI_GATEWAY = "ai_gateway";

/** The services the gateway offers, in the tower's order, with their defaults. */
export const AI_SERVICES = Object.freeze({
  chat: { name: "Chat + agents", note: "Qwen 2.5 7B on the M1", dailyCap: 0 },
  translate: { name: "Translate", note: "Hy-MT2 1.8B on the M1", dailyCap: 0 },
  places: { name: "Places", note: "the Places API key", dailyCap: 2000 },
  desk_khmer: { name: "Gemini Worker · Khmer", note: "our own content only", dailyCap: 300 },
  desk_maps: { name: "Gemini Worker · Maps details", note: "Agent Desk", dailyCap: 300 },
  desk_images: { name: "Gemini Worker · images", note: "Agent Desk", dailyCap: 100 },
  embeddings: { name: "Embeddings", note: "on the M1", dailyCap: 0 },
  yai_routes: { name: "Yai PA / Big Brain routes", note: "today's guard routes", dailyCap: 0 },
  claude: { name: "Claude", note: "real clients only, by the app's rule", dailyCap: 200 },
});
export const SERVICE_IDS = Object.keys(AI_SERVICES);

/** The apps, each with its own token (prefix) and what it may use until the tower says otherwise. */
export const AI_APPS = Object.freeze({
  yai: { name: "Yai", setting: "ai_yai", prefix: "aiyai_", allowed: ["chat", "yai_routes", "translate", "embeddings"] },
  iews: { name: "IEWS", setting: "ai_iews", prefix: "aiiews_", allowed: ["chat", "translate", "embeddings", "claude"] },
  iews_ba: { name: "IEWS BA", setting: "ai_iews_ba", prefix: "aiba_", allowed: ["chat", "translate", "claude"] },
  thirtyda: { name: "30+DA", setting: "ai_thirtyda", prefix: "ai30_", allowed: ["translate"] },
  newsroom: { name: "Newsroom", setting: "ai_newsroom", prefix: "ainews_", allowed: ["chat", "translate", "desk_khmer", "desk_images", "embeddings"] },
  media: { name: "Media teams", setting: "ai_media", prefix: "aimedia_", allowed: ["desk_images", "desk_maps", "desk_khmer", "places"] },
  mobile: { name: "Mobile backends", setting: "ai_mobile", prefix: "aimob_", allowed: [] },
});
export const APP_IDS = Object.keys(AI_APPS);
/** 30+DA's private chats never reach the Gemini Worker or Claude (tower 13 has the paid Gemini API as its backup). */
const NEVER = { thirtyda: ["desk_khmer", "desk_maps", "desk_images", "claude"] };
const APP_DAILY_DEFAULT = 5000;
const CAP_MAX = 1_000_000;
export const LIVE_MS = 3 * 60e3;
export const POLL_SECONDS = 60;
const COUNT_KEEP_DAYS = 90;
const DESK_STATES = ["ready", "busy", "signed_out", "error", "closed"];
const MODEL_KINDS = ["chat", "translate", "embed", "other"];

// Unit tests only: an in-memory database and a clock.
const testHooks = { db: null, now: null };
export function setHubAiTestHooks({ db: d = null, now = null } = {}) {
  testHooks.db = d;
  testHooks.now = now;
}
const clock = () => (testHooks.now ? testHooks.now() : Date.now());

let ready = null;
async function db() {
  if (testHooks.db) return testHooks.db;
  const d = await getDb();
  if (!ready) {
    ready = d.collection(AI_COUNTS).createIndex({ day: 1 }).catch((e) => { ready = null; throw e; });
  }
  await ready;
  return d;
}
const settingsOf = (d) => d.collection(SETTINGS_COLLECTION);
const countsOf = (d) => d.collection(AI_COUNTS);
const isoOf = (t) => (t ? new Date(t).toISOString() : null);
/** "YYYY-MM-DD" in Phnom Penh time: the day the caps and the counts go by. */
export const dayOf = (ms) => new Date(ms + PP_OFFSET_MS).toISOString().slice(0, 10);
const oneLine = (s, max) => String(s).replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);
const capOk = (n) => Number.isInteger(n) && n >= 0 && n <= CAP_MAX;

// ---------------------------------------------------------------- the config

/** The tower's rules as saved (defaults filled in): { services: { id: { enabled, dailyCap } }, apps: { id: { enabled, allowed, dailyCap } } }. */
export async function aiConfig(d) {
  const doc = await settingsOf(d).findOne({ _id: CONFIG_ID });
  const services = {};
  for (const [id, s] of Object.entries(AI_SERVICES)) {
    const v = doc?.services?.[id];
    services[id] = { enabled: typeof v?.enabled === "boolean" ? v.enabled : true, dailyCap: capOk(v?.dailyCap) ? v.dailyCap : s.dailyCap };
  }
  const apps = {};
  for (const [id, a] of Object.entries(AI_APPS)) {
    const v = doc?.apps?.[id];
    const allowed = Array.isArray(v?.allowed) ? v.allowed : a.allowed;
    apps[id] = {
      enabled: typeof v?.enabled === "boolean" ? v.enabled : true,
      // In the services' order; never one of NEVER (a stored list that names one is still never handed out).
      allowed: SERVICE_IDS.filter((s) => allowed.includes(s) && !(NEVER[id] ?? []).includes(s)),
      dailyCap: capOk(v?.dailyCap) ? v.dailyCap : APP_DAILY_DEFAULT,
    };
  }
  return { services, apps, updatedAt: isoOf(doc?.updatedAt) };
}

async function writeConfig(d, cfg, by) {
  await settingsOf(d).replaceOne(
    { _id: CONFIG_ID },
    { _id: CONFIG_ID, kind: "options", services: cfg.services, apps: cfg.apps, updatedAt: new Date(clock()), updatedBy: by },
    { upsert: true },
  );
}

/** One service: { enabled?, dailyCap? } → { ok, config } | { ok: false, field, error }. */
export async function saveAiService(d, id, input, { by = "superadmin" } = {}) {
  if (!SERVICE_IDS.includes(id)) return { ok: false, field: "service", error: "No such service." };
  const v = input && typeof input === "object" ? input : {};
  const cfg = await aiConfig(d);
  const s = { ...cfg.services[id] };
  if ("enabled" in v) {
    if (typeof v.enabled !== "boolean") return { ok: false, field: "enabled", error: "On or Off." };
    s.enabled = v.enabled;
  }
  if ("dailyCap" in v) {
    if (!capOk(v.dailyCap)) return { ok: false, field: "dailyCap", error: `A whole number of calls a day from 0 (no cap) to ${CAP_MAX.toLocaleString("en-GB")}.` };
    s.dailyCap = v.dailyCap;
  }
  cfg.services[id] = s;
  await writeConfig(d, cfg, by);
  return { ok: true, config: await aiConfig(d) };
}

/** One app: { enabled?, allowed?: [service…], dailyCap? } → { ok, config } | { ok: false, field, error }. */
export async function saveAiApp(d, id, input, { by = "superadmin" } = {}) {
  if (!APP_IDS.includes(id)) return { ok: false, field: "app", error: "No such app." };
  const v = input && typeof input === "object" ? input : {};
  const cfg = await aiConfig(d);
  const a = { ...cfg.apps[id] };
  if ("enabled" in v) {
    if (typeof v.enabled !== "boolean") return { ok: false, field: "enabled", error: "On or Off." };
    a.enabled = v.enabled;
  }
  if ("allowed" in v) {
    if (!Array.isArray(v.allowed) || v.allowed.some((s) => !SERVICE_IDS.includes(s))) return { ok: false, field: "allowed", error: "Pick from the services listed." };
    const never = (NEVER[id] ?? []).filter((s) => v.allowed.includes(s));
    if (never.length) {
      return { ok: false, field: "allowed", error: `${AI_APPS[id].name} never uses ${never.map((s) => AI_SERVICES[s].name).join(", ")}: its chats are private.` };
    }
    a.allowed = SERVICE_IDS.filter((s) => v.allowed.includes(s));
  }
  if ("dailyCap" in v) {
    if (!capOk(v.dailyCap)) return { ok: false, field: "dailyCap", error: `A whole number of calls a day from 0 (no cap) to ${CAP_MAX.toLocaleString("en-GB")}.` };
    a.dailyCap = v.dailyCap;
  }
  cfg.apps[id] = a;
  await writeConfig(d, cfg, by);
  return { ok: true, config: await aiConfig(d) };
}

/** What the gateway gets: the rules and every app token's SHA-256 (never a token), with a version over all of it. */
async function gatewayConfig(d) {
  const cfg = await aiConfig(d);
  const tokens = await Promise.all(APP_IDS.map(async (id) => [id, await settingsOf(d).findOne({ _id: AI_APPS[id].setting })]));
  const apps = {};
  for (const [id, doc] of tokens) {
    apps[id] = {
      name: AI_APPS[id].name,
      enabled: cfg.apps[id].enabled,
      token_sha256: doc?.hash ?? null,
      token_last4: doc?.hash ? doc.last4 ?? null : null,
      allowed: cfg.apps[id].allowed,
      daily_cap: cfg.apps[id].dailyCap,
    };
  }
  const services = Object.fromEntries(SERVICE_IDS.map((id) => [id, { enabled: cfg.services[id].enabled, daily_cap: cfg.services[id].dailyCap }]));
  const body = { services, apps };
  const version = crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 16);
  return { version, updated_at: cfg.updatedAt, poll_seconds: POLL_SECONDS, ...body };
}

// ---------------------------------------------------------------- the routes (the gateway)

async function authedGateway(d, req) {
  const t = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(String(req.headers.authorization ?? ""))?.[1];
  if (!t || !(await checkToken(d, AI_GATEWAY, t))) {
    throw fail(401, "unauthorized", "Send the gateway token: Authorization: Bearer <token>.", {}, { "WWW-Authenticate": 'Bearer realm="ai"' });
  }
}

/** GET /config: the rules, or 304 when the gateway already has this version. */
async function getConfig(ctx) {
  const { d, req, res } = ctx;
  await authedGateway(d, req);
  const cfg = await gatewayConfig(d);
  const etag = `"${cfg.version}"`;
  if (String(req.headers["if-none-match"] ?? "") === etag) {
    res.writeHead(304, { ...BASE_HEADERS, ETag: etag });
    res.end();
    ctx.sent = true;
    return null;
  }
  sendJson(res, 200, cfg, { ETag: etag });
  ctx.sent = true;
  return null;
}

const int = (v, field, max = 1e9) => {
  if (v == null) return 0;
  if (!Number.isInteger(v) || v < 0 || v > max) throw invalid(field, `${field}: a whole number from 0.`);
  return v;
};

/** The heartbeat's health part, checked and kept short. */
function health(body) {
  const out = {};
  if (body.gateway != null && (typeof body.gateway !== "string" || !body.gateway.trim())) throw invalid("gateway", 'gateway: a short name, like "M1 Local AI".');
  out.gateway = body.gateway == null ? "gateway" : oneLine(body.gateway, 40);
  if (body.version != null) out.version = oneLine(body.version, 30);
  if (body.uptime_s != null) out.uptimeS = int(body.uptime_s, "uptime_s");
  if (body.models != null) {
    if (!Array.isArray(body.models) || body.models.length > 30) throw invalid("models", "models: a list of at most 30.");
    out.models = body.models.map((m) => {
      if (!m || typeof m.id !== "string" || !m.id.trim()) throw invalid("models", "models: each one { id }.");
      return { id: oneLine(m.id, 80), loaded: m.loaded !== false, kind: MODEL_KINDS.includes(m.kind) ? m.kind : "other" };
    });
  }
  if (body.ram != null) {
    if (typeof body.ram !== "object") throw invalid("ram", "ram: { free_mb, total_mb }.");
    out.ram = { freeMb: int(body.ram.free_mb, "ram.free_mb", 1e7), totalMb: int(body.ram.total_mb, "ram.total_mb", 1e7) };
  }
  if (body.desk != null && typeof body.desk === "object") {
    out.desk = {};
    for (const t of ["text", "image", "maps"]) if (DESK_STATES.includes(body.desk[t])) out.desk[t] = body.desk[t];
  }
  return out;
}

/** The heartbeat's counts → rows { app, service, calls, ok, failed, msTotal } (checked; unknown apps / services refused). */
function countRows(counts) {
  if (counts == null) return null;
  if (typeof counts !== "object" || typeof counts.batch_id !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(counts.batch_id)) {
    throw invalid("counts", "counts: { batch_id (8–64 letters, digits, - _), by: [...] }.");
  }
  if (!Array.isArray(counts.by) || counts.by.length > 200) throw invalid("counts", "counts.by: a list of at most 200.");
  const rows = counts.by.map((r) => {
    if (!r || !APP_IDS.includes(r.app)) throw invalid("counts", `counts: app is one of ${APP_IDS.join(", ")}.`);
    if (!SERVICE_IDS.includes(r.service)) throw invalid("counts", `counts: service is one of ${SERVICE_IDS.join(", ")}.`);
    return { app: r.app, service: r.service, calls: int(r.calls, "calls", 1e7), ok: int(r.ok, "ok", 1e7), failed: int(r.failed, "failed", 1e7), msTotal: int(r.ms_total, "ms_total", 1e12) };
  });
  return { batch: counts.batch_id, rows };
}

/** POST /heartbeat: the M1's health (kept), its counts (added to today's, once per batch), and the config's version. */
async function heartbeat(ctx) {
  const { d, req, now } = ctx;
  await authedGateway(d, req);
  const body = await readJson(req, 64 * 1024, "That heartbeat");
  const h = health(body);
  const counts = countRows(body.counts);
  const seen = await settingsOf(d).findOne({ _id: SEEN_ID });
  let counted = false;
  if (counts && counts.rows.length && !(seen?.batches ?? []).includes(counts.batch)) {
    const day = dayOf(now);
    for (const r of counts.rows) {
      await countsOf(d).updateOne(
        { _id: `${day}|${r.app}|${r.service}` },
        { $setOnInsert: { day, app: r.app, service: r.service }, $inc: { calls: r.calls, ok: r.ok, failed: r.failed, msTotal: r.msTotal } },
        { upsert: true },
      );
    }
    counted = true;
  }
  const batches = counts ? [counts.batch, ...(seen?.batches ?? []).filter((b) => b !== counts.batch)].slice(0, 20) : seen?.batches ?? [];
  await settingsOf(d).updateOne({ _id: SEEN_ID }, { $set: { kind: "status", at: new Date(now), ...h, batches } }, { upsert: true });
  // Old days go (at most once a day matters; cheap either way).
  await countsOf(d).deleteMany({ day: { $lt: dayOf(now - COUNT_KEEP_DAYS * 864e5) } });
  const cfg = await gatewayConfig(d);
  return [200, { ok: true, config_version: cfg.version, counted }];
}

const ROUTES = [
  ["GET", /^\/config$/, getConfig],
  ["POST", /^\/heartbeat$/, heartbeat],
];

/** /30da/hub/ai/… (src/lib/thirtyda-hub-wan.mjs handleThirtyDaHub sends it here). Errors answer like towers 11 and 14. */
export async function handleAi(req, res, path) {
  const ctx = { req, res, sent: false };
  try {
    const sub = path.slice(AI_BASE.length) || "/";
    let hit = null;
    for (const [method, re, fn] of ROUTES) {
      if (!re.test(sub)) continue;
      if (method !== req.method) {
        hit ??= "method";
        continue;
      }
      hit = fn;
      break;
    }
    if (!hit) throw fail(404, "not_found", "No such endpoint.");
    if (hit === "method") throw fail(405, "method_not_allowed", "Not with this method.");
    ctx.d = await db();
    ctx.now = clock();
    const out = await hit(ctx);
    if (ctx.sent) return;
    sendJson(res, out[0], out[1]);
  } catch (err) {
    if (res.headersSent) return;
    const tooBig = err instanceof HubError && err.code === "too_large";
    const close = tooBig ? { Connection: "close" } : {};
    if (!tooBig) req.resume();
    if (err instanceof HubError) {
      sendJson(res, err.status, { error: err.code, message: err.message, ...err.extra }, { ...err.headers, ...close });
      return;
    }
    console.error("[30da hub ai]", req.method, path, err instanceof Error ? err.message : err);
    sendJson(res, 500, { error: "server_error", message: "Something went wrong. Try again." }, close);
  }
}

// ---------------------------------------------------------------- the admin's tower (src/lib/thirtyda-admin.mjs)

/** not_set (no gateway token) · waiting (no heartbeat for 3 minutes) · live. */
export function aiStatus({ gatewaySet, seenAt, now }) {
  if (!gatewaySet) return "not_set";
  return seenAt && now - new Date(seenAt).getTime() <= LIVE_MS ? "live" : "waiting";
}

/** The Code page's `ai` block. Never a token, a hash, a prompt or an answer: counts only. */
export async function aiAdminView(d, req) {
  const now = clock();
  const [cfg, gateway, seen] = await Promise.all([aiConfig(d), tokenStatus(d, AI_GATEWAY), settingsOf(d).findOne({ _id: SEEN_ID })]);
  const tokens = Object.fromEntries(await Promise.all(APP_IDS.map(async (id) => [id, await tokenStatus(d, AI_APPS[id].setting)])));
  const today = dayOf(now);
  const weekAgo = dayOf(now - 6 * 864e5);
  const rows = await countsOf(d).find({ day: { $gte: weekAgo } }).toArray();
  const sum = (filter) => rows.filter(filter).reduce((n, r) => ({
    calls: n.calls + (r.calls ?? 0), ok: n.ok + (r.ok ?? 0), failed: n.failed + (r.failed ?? 0), msTotal: n.msTotal + (r.msTotal ?? 0),
  }), { calls: 0, ok: 0, failed: 0, msTotal: 0 });
  const tally = (t) => ({ ...t, avgMs: t.ok && t.msTotal ? Math.round(t.msTotal / t.ok) : null, msTotal: undefined });
  const seenAt = seen?.at ? new Date(seen.at) : null;
  return {
    status: aiStatus({ gatewaySet: gateway.set, seenAt, now }),
    endpoint: `${publicOrigin(req)}${AI_BASE}`,
    contract: "v1",
    gateway: seenAt ? {
      seenAt: seenAt.toISOString(),
      seenAgoS: Math.max(0, Math.round((now - seenAt.getTime()) / 1000)),
      name: seen.gateway ?? null,
      version: seen.version ?? null,
      uptimeS: seen.uptimeS ?? null,
      models: Array.isArray(seen.models) ? seen.models : [],
      ram: seen.ram ?? null,
      desk: seen.desk ?? {},
    } : null,
    tokens: { gateway, apps: tokens },
    services: SERVICE_IDS.map((id) => ({
      id, name: AI_SERVICES[id].name, note: AI_SERVICES[id].note, ...cfg.services[id],
      today: tally(sum((r) => r.day === today && r.service === id)), week: tally(sum((r) => r.service === id)),
    })),
    apps: APP_IDS.map((id) => ({
      id, name: AI_APPS[id].name, ...cfg.apps[id], never: NEVER[id] ?? [],
      today: tally(sum((r) => r.day === today && r.app === id)), week: tally(sum((r) => r.app === id)),
    })),
    day: today,
    limits: { pollSeconds: POLL_SECONDS, liveMinutes: LIVE_MS / 60e3, keepDays: COUNT_KEEP_DAYS, capMax: CAP_MAX },
    updatedAt: cfg.updatedAt,
  };
}

const settingOf = (who) => (who === "gateway" ? AI_GATEWAY : AI_APPS[who]?.setting);

/** "New token" for an app or the gateway: the old one stops at once (the gateway on its next /config). → { token, view } */
export async function newAiToken(d, who, { by = "superadmin" } = {}) {
  const setting = settingOf(who);
  if (!setting) throw new Error(`No such token: ${String(who).slice(0, 20)}`);
  return makeToken(d, setting, { by });
}

/** "Revoke" → { removed }. */
export async function revokeAiToken(d, who) {
  const setting = settingOf(who);
  if (!setting) throw new Error(`No such token: ${String(who).slice(0, 20)}`);
  return removeToken(d, setting);
}
