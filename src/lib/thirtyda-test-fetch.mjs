/**
 * 30+DA test-only stand-in for the outside world — the dev server + the e2e, never production.
 *
 * ON only when ALL of these hold (testFetchAllowed):
 *   THIRTYDA_TEST_FETCH=1, MONGO_DB ends with "_dev", and the process is not on Railway (no RAILWAY_ENVIRONMENT /
 *   RAILWAY_PROJECT_ID / RAILWAY_SERVICE_ID).
 * Otherwise outboundFetch() is the plain global fetch and nothing here runs.
 *
 * When ON, a request to one of the provider addresses below (Google / Facebook / TikTok sign-in — TikTok's token
 * POST and user/info GET on open.tiktokapis.com; its authorize step is a browser redirect, which the e2e reads off
 * the 302 like Google's — Telegram Gateway, WhatsApp through graph.facebook.com) is answered from the dev DB collection `thirtyda_test_fetch` IF the e2e
 * left an answer there for it:
 *   { _id: "<METHOD> <origin + path, no query>", reply: { status, json, delayMs?, fail?: 'timeout' | 'network' }, calls: [...] }
 * and the request is noted in `calls` (the last 20) — redacted: a secret, a code or a token only as its last 4,
 * a phone number masked — so the e2e can check its shape. No answer stored → the real fetch, unchanged.
 *
 * The Telegram Bot API (api.telegram.org, the free 30+DA bot — src/lib/thirtyda-telegram-bot.mjs) is answered by a
 * small FAKE BOT instead, but only while the e2e left its doc there: { _id: "telegram-bot", fake: true, me?: { username,
 * first_name }, replies?: { <method>: { status, json } }, revoked?: [<key's last 4>], lastError?: { at, message },
 * pending? }. It answers getMe (the bot id is the key's number part), setWebhook, deleteWebhook, getWebhookInfo,
 * sendMessage, deleteMessage, setMyDescription and setMyShortDescription, and keeps on that doc:
 *   hook  { url, secretToken, allowedUpdates, botId, at } — setWebhook's address AND its secret token, so the e2e can
 *         post fake updates to the webhook with the right X-Telegram-Bot-Api-Secret-Token, as Telegram would (dev DB only);
 *   sent  the bot's replies (chat id, text, keyboard) — the last 50;
 *   deleted  the messages the bot deleted (chat id, message id) — the last 50 (a shared contact never stays in the chat);
 *   profile  { description: { default|km|zh|ko|ja: text }, short: { … } } — the bot's profile words (support, 2026-10-13);
 *   calls every request, the key only as its last 4 (bot…AbCd) and secret_token only as its last 4.
 * No doc → the real Bot API, unchanged.
 */

export const TEST_FETCH_COLLECTION = "thirtyda_test_fetch";
// nominatim.openstreetmap.org: the meeting place search (src/lib/thirtyda-places.mjs), so the dev server can show a fixed
// list instead of asking OpenStreetMap (the area names of src/lib/thirtyda-geo.mjs use the plain fetch, unchanged).
const HOSTS = new Set(["oauth2.googleapis.com", "openidconnect.googleapis.com", "graph.facebook.com", "gatewayapi.telegram.org", "open.tiktokapis.com", "nominatim.openstreetmap.org"]);
const BOT_HOST = "api.telegram.org";
/** The fake bot's doc in thirtyda_test_fetch (see above). */
export const FAKE_BOT_DOC = "telegram-bot";
const SECRET_KEYS = new Set(["client_secret", "code", "access_token", "refresh_token", "id_token", "code_verifier"]);

/** The one switch: an explicit flag, a dev database, and not the live server. */
export function testFetchAllowed(env = process.env) {
  return env.THIRTYDA_TEST_FETCH === "1"
    && /_dev$/.test(String(env.MONGO_DB ?? ""))
    && !env.RAILWAY_ENVIRONMENT && !env.RAILWAY_PROJECT_ID && !env.RAILWAY_SERVICE_ID;
}

const last4 = (v) => (v ? `…${String(v).slice(-4)}` : v);
const maskPhone = (p) => String(p ?? "").replace(/\d(?=\d{3})/g, "•");

function redactParams(params) {
  const out = {};
  for (const [k, v] of params) out[k] = SECRET_KEYS.has(k) ? last4(v) : v;
  return out;
}

/** What the e2e may see of one request: never a whole secret, code, token or phone number. */
export function redactCall(url, init = {}) {
  const u = new URL(String(url));
  const headers = {};
  for (const [k, v] of Object.entries(init.headers || {})) {
    headers[k.toLowerCase()] = k.toLowerCase() === "authorization" ? String(v).replace(/^(\w+)\s+(.*)$/, (_, s, t) => `${s} ${last4(t)}`) : v;
  }
  let body = null;
  const raw = typeof init.body === "string" ? init.body : null;
  if (raw) {
    if (String(headers["content-type"] || "").includes("x-www-form-urlencoded")) body = redactParams(new URLSearchParams(raw));
    else {
      try {
        const j = JSON.parse(raw);
        body = { ...j };
        if ("code" in body) body.code = "••••••";
        if ("phone_number" in body) body.phone_number = maskPhone(body.phone_number);
        if ("to" in body) body.to = maskPhone(body.to);
        if (body.template) body.template = { name: body.template.name, language: body.template.language };
      } catch {
        body = { length: raw.length };
      }
    }
  }
  return { at: new Date(), method: String(init.method || "GET").toUpperCase(), url: `${u.origin}${u.pathname}`, query: redactParams(u.searchParams), headers, body };
}

function waitFor(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(signal.reason); }, { once: true });
  });
}

/** A fetch that answers known provider addresses from `thirtyda_test_fetch` when an answer is stored there. */
export function makeTestFetch(dbFn, realFetch = globalThis.fetch) {
  return async function testFetch(url, init = {}) {
    let u;
    try {
      u = new URL(String(url));
    } catch {
      return realFetch(url, init);
    }
    if (u.host === BOT_HOST) {
      const bots = (await dbFn()).collection(TEST_FETCH_COLLECTION);
      const bot = await bots.findOne({ _id: FAKE_BOT_DOC });
      return bot?.fake ? fakeBotApi(bots, bot, u, init) : realFetch(url, init);
    }
    if (!HOSTS.has(u.host)) return realFetch(url, init);
    const key = `${String(init.method || "GET").toUpperCase()} ${u.origin}${u.pathname}`;
    const col = (await dbFn()).collection(TEST_FETCH_COLLECTION);
    const doc = await col.findOne({ _id: key });
    if (!doc?.reply) return realFetch(url, init);
    await col.updateOne({ _id: key }, { $push: { calls: { $each: [redactCall(url, init)], $slice: -20 } } });
    const { status = 200, json = {}, delayMs = 0, fail = null } = doc.reply;
    if (delayMs > 0) await waitFor(Math.min(Number(delayMs) || 0, 15_000), init.signal);
    if (fail === "network") throw new TypeError("fetch failed");
    if (fail === "timeout") {
      await waitFor(60_000, init.signal);
      throw new DOMException("The operation timed out.", "TimeoutError");
    }
    return new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });
  };
}

// ---------- the fake Telegram bot (Bot API) ----------

/** "/bot<key>/<method>" → { token, method }, or null. */
export function botApiPath(pathname) {
  const m = String(pathname).match(/^\/bot([^/]+)\/([A-Za-z]+)$/);
  if (!m) return null;
  let token = m[1];
  try { token = decodeURIComponent(token); } catch { /* as sent */ }
  return { token, method: m[2] };
}

/** A Bot API request as the e2e may see it: the key and the webhook secret only as their last 4. */
export function redactBotCall(u, init = {}) {
  const p = botApiPath(u.pathname);
  let body = null;
  try {
    body = typeof init.body === "string" && init.body ? JSON.parse(init.body) : {};
  } catch {
    body = { length: String(init.body).length };
  }
  if (body && typeof body === "object" && "secret_token" in body) body = { ...body, secret_token: last4(body.secret_token) };
  return { at: new Date(), method: p?.method ?? null, url: `${u.origin}/bot${last4(p?.token ?? "")}/${p?.method ?? ""}`, body };
}

async function fakeBotApi(col, doc, u, init) {
  const p = botApiPath(u.pathname);
  let params = {};
  try {
    params = typeof init.body === "string" && init.body ? JSON.parse(init.body) : {};
  } catch { /* not JSON: answered like an empty request */ }
  const answer = (status, json) => new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });
  const refuse = (code, description) => answer(code, { ok: false, error_code: code, description });
  const token = String(p?.token ?? "");
  const id = Number(token.split(":")[0]) || 0;
  const ops = { $push: { calls: { $each: [redactBotCall(u, init)], $slice: -30 } } };
  let out;
  if (!p || !/^\d+:/.test(token)) out = refuse(404, "Not Found");
  else if ((doc.revoked || []).includes(token.slice(-4))) out = refuse(401, "Unauthorized");
  else if (doc.replies?.[p.method]) out = answer(doc.replies[p.method].status ?? 200, doc.replies[p.method].json ?? {});
  else if (p.method === "getMe") {
    out = answer(200, { ok: true, result: { id, is_bot: true, first_name: doc.me?.first_name ?? "30+DA", username: doc.me?.username ?? "ThirtyDA_test_bot", can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false } });
  } else if (p.method === "setWebhook") {
    ops.$set = { hook: { url: String(params.url ?? ""), secretToken: String(params.secret_token ?? ""), allowedUpdates: params.allowed_updates ?? null, botId: id, at: new Date() } };
    ops.$unset = { lastError: "" };
    out = answer(200, { ok: true, result: true, description: "Webhook was set" });
  } else if (p.method === "deleteWebhook") {
    if (doc.hook?.botId === id) ops.$unset = { hook: "" };
    out = answer(200, { ok: true, result: true, description: "Webhook was deleted" });
  } else if (p.method === "getWebhookInfo") {
    const hook = doc.hook?.botId === id ? doc.hook : null;
    const lastError = hook && doc.lastError ? { last_error_date: Math.floor(new Date(doc.lastError.at).getTime() / 1000), last_error_message: String(doc.lastError.message) } : {};
    out = answer(200, { ok: true, result: { url: hook?.url ?? "", has_custom_certificate: false, pending_update_count: Number(doc.pending) || 0, max_connections: 40, ...(hook?.allowedUpdates ? { allowed_updates: hook.allowedUpdates } : {}), ...lastError } });
  } else if (p.method === "sendMessage") {
    const sent = { at: new Date(), botId: id, chatId: params.chat_id ?? null, text: String(params.text ?? ""), replyMarkup: params.reply_markup ?? null };
    ops.$push.sent = { $each: [sent], $slice: -50 };
    out = answer(200, { ok: true, result: { message_id: Date.now() % 1e9, date: Math.floor(Date.now() / 1000), chat: { id: params.chat_id, type: "private" }, text: sent.text } });
  } else if (p.method === "deleteMessage") {
    const deleted = { at: new Date(), botId: id, chatId: params.chat_id ?? null, messageId: params.message_id ?? null };
    ops.$push.deleted = { $each: [deleted], $slice: -50 };
    out = answer(200, { ok: true, result: true });
  } else if (p.method === "setMyDescription" || p.method === "setMyShortDescription") {
    const long = p.method === "setMyDescription";
    const lang = /^[a-z]{2}$/.test(String(params.language_code ?? "")) ? params.language_code : "default";
    ops.$set = { [`profile.${long ? "description" : "short"}.${lang}`]: String((long ? params.description : params.short_description) ?? "") };
    out = answer(200, { ok: true, result: true });
  } else {
    out = refuse(404, "Not Found: method not found");
  }
  await col.updateOne({ _id: FAKE_BOT_DOC }, ops);
  if (doc.delayMs > 0) await waitFor(Math.min(Number(doc.delayMs) || 0, 15_000), init.signal);
  return out;
}

let chosen = null;
/** The fetch the server uses for providers: the test stand-in when testFetchAllowed(), else the real fetch. */
export function outboundFetch() {
  if (chosen) return chosen;
  if (testFetchAllowed()) {
    console.warn("[30da] TEST FETCH ON (dev database only): provider answers may come from thirtyda_test_fetch.");
    // Loaded only here, so the unit tests (plain node) never import the TypeScript Mongo client.
    chosen = makeTestFetch(async () => (await import("./mongo.ts")).getDb());
  } else {
    chosen = (url, init) => globalThis.fetch(url, init);
  }
  return chosen;
}
