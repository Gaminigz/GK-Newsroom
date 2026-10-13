/**
 * 30+DA phone check with our own Telegram bot — FREE (owner 2026-10-13), instead of the paid Telegram Gateway.
 * Nobody types a code: the person types their number in the app, taps Telegram, and shares their number with the
 * 30+DA bot ("Share my number"). Telegram itself vouches that a shared contact is the sender's own number.
 *
 * Setup — the admin Code page, Telegram card, "Telegram bot (free)" (src/lib/thirtyda-admin.mjs):
 *   one box, the bot key from @BotFather. Kept sealed in thirtyda_settings.telegram_bot (src/lib/thirtyda-settings.mjs:
 *   token = secret, shown as …last4; hookSecret = secret and hidden, never shown; username, botId, hookUrl = plain).
 *   Save   getMe (→ "@<bot username>") → setWebhook { url: https://<host>/30da/api/telegram/hook, secret_token:
 *          32 random bytes, allowed_updates: ["message"] } → saved. A save starts "not tried".
 *   Try    getMe + getWebhookInfo: the url is the one saved, and no delivery error since the save → the app offers
 *          the bot (offer { on, mark: this save's box IV } on the setting, like the code channels). A failed try stops it.
 *   Remove deleteWebhook, then the setting (and every open check) is gone.
 *
 * The check — the app (src/lib/thirtyda-app.mjs):
 *   POST /30da/api/auth/telegram/start { phone, lang?, pin? } → startCheck: thirtyda_tg_checks
 *        { _id: SHA-256(token), browser: SHA-256(cookie), phone (E.164), lang, match, state, expires (10 min), purgeAt,
 *        pinHash? }. The token (24 random bytes, base64url) goes only into https://t.me/<bot>?start=<token>; the browser
 *        gets a fresh random cookie (thirtyda_tg: HttpOnly, SameSite=Lax, Path=/30da/api/auth/telegram, 12 minutes = the
 *        check + the verified grace), like the sign-in state. match ("🍊 47") is shown in the app's waiting box and
 *        repeated by the bot, so a forwarded link is caught: the bot names who is asking (masked number, Phnom Penh
 *        time, the sign) and says "If someone sent you this link, do not tap."
 *   GET  /30da/api/auth/telegram/status → pollCheck: { state: waiting | verified | mismatch | expired | none } for THIS
 *        browser's check. verified is taken ONCE (state → used) and signs in exactly like a good code.
 * The bot — POST /30da/api/telegram/hook (handleTelegramHook): Telegram's X-Telegram-Bot-Api-Secret-Token must match the
 *   saved one, else 401 and nothing happens.
 *   "/start <token>"  → the check is bound to this Telegram user (the first one only) and the bot asks for the number
 *                       with a one-button keyboard { request_contact: true, text: "Share my number" } (one_time_keyboard),
 *                       saying when it was asked: "Signing in to 30+DA (14:05, Phnom Penh time)? Check that your 30+DA
 *                       screen shows 🍊 47 … If someone sent you this link, do not tap." (owner 2026-10-13: the bot never
 *                       shows the number, not even masked.)
 *   a contact         → ACCEPTED ONLY IF contact.user_id === from.id (their own number) AND its digits are the typed
 *                       number's → verified, "Number verified ✓ Go back to 30+DA." (keyboard removed). Their own number
 *                       but another one → mismatch, "That number is not the one you typed in 30+DA." + how to type it.
 *                       Someone else's contact → asked again. Every shared contact is then DELETED from the chat
 *                       (deleteMessage; a failed delete is ignored), so the number does not stay on screen.
 *                       A number typed as text is never believed (the button again).
 *   any other text    → support (src/lib/thirtyda-support.mjs): stored for the admin Support page; the bot thanks them
 *                       once a day. "/help" → the help line (it says they can ask here).
 *   Replies are in the check's language (en/km/zh/ko/ja), else the person's Telegram language, else English. No reply
 *   ever carries a phone number.
 * Never stored: the shared contact's number (only compared) or a check token (only its hash). The Telegram user id is
 * kept on the check (it binds the check to one person), and once verified in thirtyda_tg_links next to the number that
 * was typed in the app (so support can name their 30+DA profile). Never logged, returned or audited: the bot key, the webhook
 * secret, a check token.
 *
 * Pure apart from the `d` (Mongo Db) and `fetchImpl` handed in, so the unit tests run without a database or network.
 */

import crypto from "node:crypto";
import {
  readFields, saveFields, removeSecret, fieldsStatus, settingsKey, SETTINGS_COLLECTION,
} from "./thirtyda-settings.mjs";
import { publicOrigin } from "./thirtyda-signin.mjs";

export const BOT_SETTING = "telegram_bot";
export const BOT_API_ORIGIN = "https://api.telegram.org";
export const HOOK_PATH = "/30da/api/telegram/hook";
export const TG_CHECKS = "thirtyda_tg_checks";
/** Telegram user id → the number the bot verified for them ({ _id, phone, at }), so support can name their profile. */
export const TG_LINKS = "thirtyda_tg_links";
export const CHECK_TTL_MS = 10 * 60e3;
/** A check that ended stays readable this long after it expires (status can say "expired"); a TTL index on purgeAt drops it. */
export const CHECK_KEEP_MS = 30 * 60e3;
/** A check verified close to its end may still be collected this long after the verification. */
export const VERIFIED_GRACE_MS = 2 * 60e3;
/**
 * The browser's cookie lives as long as the server may still hand over a verified check (10 minutes + the grace),
 * else a number shared at 9:30 and collected after 10:00 finds no cookie and reads "took too long".
 */
export const CHECK_COOKIE_MAX_AGE_S = (CHECK_TTL_MS + VERIFIED_GRACE_MS) / 1000;
export const CHECK_COOKIE = "thirtyda_tg";
export const CHECK_COOKIE_PATH = "/30da/api/auth/telegram";
export const SECRET_HEADER = "x-telegram-bot-api-secret-token";
export const ALLOWED_UPDATES = ["message"];
export const BOT_LANGS = ["en", "km", "zh", "ko", "ja"];
export const POLL_MS = 2000;
const TIMEOUT_MS = 10_000;
const HOOK_BODY_MAX = 64 * 1024;
const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
const BROWSER_RE = /^[a-f0-9]{64}$/;
const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const isTimeout = (err) => err?.name === "TimeoutError" || err?.name === "AbortError";
const iso = (t) => (t ? new Date(t).toISOString() : null);

// ---------------------------------------------------------------- the bot key (admin)

/** A bot key as @BotFather gives it: digits, a colon, then 30–80 letters, digits, _ and -. */
export const BOT_TOKEN_RE = /^\d{5,16}:[A-Za-z0-9_-]{30,80}$/;

/** Check what the admin pasted → { ok:true, token } | { ok:false, error } (plain words). */
export function checkBotToken(raw) {
  const token = String(raw ?? "").trim();
  if (!token) return { ok: false, error: "Paste the bot key first." };
  if (/\s/.test(token)) return { ok: false, error: "A bot key has no spaces in it. Copy it again from @BotFather." };
  if (!BOT_TOKEN_RE.test(token)) {
    return {
      ok: false,
      error: "That does not look like a bot key (numbers, a colon, then about 35 letters). In Telegram open @BotFather → /mybots → your bot → API Token, and copy it again.",
    };
  }
  return { ok: true, token };
}

/** Where Telegram sends the bot's messages: https://<host>/30da/api/telegram/hook. */
export const hookUrl = (origin) => `${origin}${HOOK_PATH}`;

/** The start link for one check. */
export const startLink = (username, token) => `https://t.me/${username}?start=${token}`;

/** Telegram's own words, short and safe to show and keep: never the key, no line breaks. */
export function cleanDescription(text, token = null) {
  let s = String(text ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ");
  if (token) s = s.split(token).join("…");
  return s.replace(/\bbot\d{5,16}:[A-Za-z0-9_-]+/g, "bot…").replace(/\s+/g, " ").trim().slice(0, 160) || null;
}

/** Telegram's error_code + description → bad_token | bad_webhook | too_many | blocked | other. */
export function classifyBotError(code, description = "") {
  const d = String(description).toLowerCase();
  if (code === 401 || code === 404) return "bad_token"; // a revoked or mistyped key: Unauthorized / Not Found
  if (code === 429) return "too_many";
  if (code === 403) return "blocked"; // this person blocked the bot: not a setup problem
  if (/webhook|https url|ssl|certificate|resolve host|ip address/.test(d)) return "bad_webhook";
  return "other";
}

/**
 * One Bot API call (POST, JSON). → { ok:true, result } | { ok:false, reason, status, description }.
 * Never throws for a Telegram or network problem. The key travels only in the request address.
 */
export async function botCall(token, method, params = {}, { fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  let res;
  try {
    res = await fetchImpl(`${BOT_API_ORIGIN}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return { ok: false, reason: isTimeout(err) ? "timeout" : "network", status: 0, description: null };
  }
  let body = null;
  try {
    body = await res.json();
  } catch (err) {
    if (isTimeout(err)) return { ok: false, reason: "timeout", status: 0, description: null };
  }
  if (body?.ok === true) return { ok: true, result: body.result, status: res.status };
  const code = Number(body?.error_code) || res.status;
  const description = cleanDescription(body?.description, token) || `HTTP ${res.status}`;
  return { ok: false, reason: classifyBotError(code, description), status: code, description };
}

const SAVE_WORDS = {
  bad_token: "Telegram did not accept this bot key. In @BotFather open /mybots → your bot → API Token, copy it again and save.",
  not_bot: "That key is not a bot's key. In Telegram open @BotFather → /newbot, then copy the key it gives you.",
  bad_webhook: (url) => `Telegram cannot send the bot's messages to this site's address (${url}). It needs the live site's https address: save the bot key on the live site.`,
  too_many: "Telegram asks us to wait a little. Try again in a minute.",
  timeout: "Telegram did not answer within 10 seconds. Try again.",
  network: "Could not reach Telegram. Check the connection and try again.",
  other: (detail) => `Telegram refused${detail ? ` (${detail})` : ""}. Try again, or make a new key in @BotFather.`,
};

function refusal(r, url = null) {
  const words = SAVE_WORDS[r.reason] ?? SAVE_WORDS.other;
  const error = typeof words === "function" ? words(r.reason === "bad_webhook" ? url : r.description) : words;
  return { ok: false, status: 422, field: "token", reason: r.reason === "blocked" ? "other" : r.reason, error, detail: r.description ?? null };
}

const settingDoc = (d) => d.collection(SETTINGS_COLLECTION).findOne({ _id: BOT_SETTING });

/** The saved bot { token, hookSecret, username, botId, hookUrl } when saved, readable and whole; else null. */
export async function botConfig(d) {
  const f = d ? await readFields(d, BOT_SETTING).catch(() => null) : null;
  if (!f || !BOT_TOKEN_RE.test(f.token) || !f.hookSecret || !USERNAME_RE.test(f.username)) return null;
  return f;
}

/**
 * Save a bot key: getMe → setWebhook (a new random secret) → sealed. Any refusal comes back in plain words and
 * nothing is saved. Throws SettingsError 'no_key' (before Telegram is called) without THIRTYDA_SECRET_KEY.
 * → { ok:true, username, last4 } | { ok:false, status, field, reason, error, detail }.
 */
export async function saveBot(d, rawToken, { origin, fetchImpl = fetch, by = "superadmin" } = {}) {
  const c = checkBotToken(rawToken);
  if (!c.ok) return { ok: false, status: 422, field: "token", reason: "format", error: c.error, detail: null };
  settingsKey(); // no lock key → nothing goes to Telegram either
  const me = await botCall(c.token, "getMe", {}, { fetchImpl });
  if (!me.ok) return refusal(me);
  const username = String(me.result?.username ?? "");
  if (me.result?.is_bot !== true || !USERNAME_RE.test(username) || !Number.isSafeInteger(me.result?.id)) {
    return { ok: false, status: 422, field: "token", reason: "not_bot", error: SAVE_WORDS.not_bot, detail: null };
  }
  const previous = await botConfig(d);
  const url = hookUrl(origin);
  const hookSecret = crypto.randomBytes(32).toString("base64url");
  const set = await botCall(c.token, "setWebhook", {
    url, secret_token: hookSecret, allowed_updates: ALLOWED_UPDATES, drop_pending_updates: true, max_connections: 40,
  }, { fetchImpl });
  if (!set.ok) return refusal(set, url);
  // Another bot was saved before: it stops sending here (its old secret is refused from now on anyway).
  if (previous && previous.botId !== String(me.result.id)) {
    await botCall(previous.token, "deleteWebhook", { drop_pending_updates: true }, { fetchImpl });
  }
  const view = await saveFields(d, BOT_SETTING, {
    token: c.token, hookSecret, username, botId: String(me.result.id), hookUrl: url,
  }, { by });
  return { ok: true, username, last4: view.last4 };
}

const TRY_WORDS = {
  not_set: "Save a bot key first, then try it.",
  unreadable: "The saved bot key cannot be read on this server. Paste and save it again.",
  no_hook: "The bot is not sending its messages to this site any more. Press Save again with the same key.",
  moved: (host) => `The bot now sends its messages somewhere else (${host}). If that is another copy of 30+DA, give it its own bot. Press Save again to bring this one back here.`,
  hook_error: "Telegram could not deliver the bot's messages to this site.",
};

const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return "another address";
  }
};

/**
 * "Try": the bot answers (getMe, the same bot) and Telegram sends its messages here (getWebhookInfo: the saved url,
 * no delivery error since the save). The outcome turns the bot on in the app or stops it, for THIS save only.
 * → { ok:true, username, pending } | { ok:false, status, reason, error, detail }.
 */
export async function tryBot(d, { fetchImpl = fetch, now = Date.now() } = {}) {
  const doc = await settingDoc(d);
  if (!doc?.box) return { ok: false, status: 400, reason: "not_set", error: TRY_WORDS.not_set, detail: null };
  const cfg = await botConfig(d);
  if (!cfg) return { ok: false, status: 400, reason: "unreadable", error: TRY_WORDS.unreadable, detail: null };
  const out = await probeBot(cfg, doc, { fetchImpl });
  await noteBotOutcome(d, doc.box.iv, out, { by: "try", now });
  return out;
}

async function probeBot(cfg, doc, { fetchImpl }) {
  const me = await botCall(cfg.token, "getMe", {}, { fetchImpl });
  if (!me.ok) return { ...refusal(me), status: 422 };
  const info = await botCall(cfg.token, "getWebhookInfo", {}, { fetchImpl });
  if (!info.ok) return { ...refusal(info), status: 422 };
  const url = String(info.result?.url ?? "");
  if (url !== cfg.hookUrl) {
    return url
      ? { ok: false, status: 422, reason: "moved", error: TRY_WORDS.moved(hostOf(url)), detail: null }
      : { ok: false, status: 422, reason: "no_hook", error: TRY_WORDS.no_hook, detail: null };
  }
  const errorAt = Number(info.result?.last_error_date) * 1000;
  const savedAt = doc.updatedAt ? new Date(doc.updatedAt).getTime() : 0;
  if (errorAt && errorAt >= savedAt - 1000) {
    return { ok: false, status: 422, reason: "hook_error", error: TRY_WORDS.hook_error, detail: cleanDescription(info.result?.last_error_message, cfg.token) };
  }
  return { ok: true, username: String(me.result?.username || cfg.username), pending: Number(info.result?.pending_update_count) || 0 };
}

/** Keep a try's (or a reply's) outcome on the setting — only while the same save is there (box IV). Never a number. */
async function noteBotOutcome(d, iv, out, { by, now = Date.now() }) {
  const at = new Date(now);
  const reason = out.ok ? null : out.reason;
  const detail = out.ok ? null : out.detail ? String(out.detail).slice(0, 200) : null;
  const $set = { offer: { on: Boolean(out.ok), mark: `box:${iv}`, reason, detail, at, by } };
  if (by === "try") $set.lastSend = { ok: Boolean(out.ok), reason, detail, at, kind: "try" };
  await d.collection(SETTINGS_COLLECTION).updateOne({ _id: BOT_SETTING, "box.iv": iv }, { $set });
}

/**
 * Where the bot stands for the app: { live, offered, state: off | untested | on | stopped, reason, detail, at }.
 * off: nothing saved (or not readable) · untested: saved, no good try since · on: offered · stopped: a try (or a reply
 * with a key Telegram no longer takes) failed — a new good try turns it on.
 */
export async function botOffer(d) {
  const none = { reason: null, detail: null, at: null };
  if (!d) return { live: false, offered: false, state: "off", ...none };
  const [doc, cfg] = await Promise.all([settingDoc(d), botConfig(d)]);
  if (!doc?.box || !cfg) return { live: false, offered: false, state: "off", ...none };
  const o = doc.offer;
  if (!o || o.mark !== `box:${doc.box.iv}`) return { live: true, offered: false, state: "untested", ...none };
  if (o.on) return { live: true, offered: true, state: "on", reason: null, detail: null, at: iso(o.at) };
  return { live: true, offered: false, state: "stopped", reason: o.reason ?? null, detail: o.detail ?? null, at: iso(o.at) };
}

/** true when the app offers the bot: saved, readable, and its last try (since the save) went through. */
export async function botOffered(d) {
  return (await botOffer(d)).offered;
}

/** The admin card's view: never the key (only …last4) and never the webhook secret. */
export async function botView(d) {
  const st = await fieldsStatus(d, BOT_SETTING);
  const offer = await botOffer(d);
  const username = st.fields?.username || null;
  return {
    set: st.set,
    readable: st.readable,
    last4: st.last4,
    username,
    link: username ? `https://t.me/${username}` : null,
    hookUrl: st.fields?.hookUrl || null,
    updatedAt: st.updatedAt,
    updatedBy: st.updatedBy,
    live: offer.live,
    offered: offer.offered,
    offer: { state: offer.state, reason: offer.reason, detail: offer.detail, at: offer.at },
    lastTry: st.lastSend,
  };
}

/** Remove: Telegram stops sending here (deleteWebhook, best effort), the key is gone, and open checks end. */
export async function removeBot(d, { fetchImpl = fetch } = {}) {
  const cfg = await botConfig(d);
  let webhookDeleted = null;
  if (cfg) webhookDeleted = (await botCall(cfg.token, "deleteWebhook", { drop_pending_updates: true }, { fetchImpl })).ok;
  const r = await removeSecret(d, BOT_SETTING);
  await d.collection(TG_CHECKS).deleteMany({});
  return { removed: r.removed, webhookDeleted };
}

// ---------------------------------------------------------------- the check (app)

export const newCheckToken = () => crypto.randomBytes(24).toString("base64url"); // 32 characters
export const newBrowserKey = () => crypto.randomBytes(32).toString("hex");
export const checkId = (token) => sha256(token);

/**
 * The sign the app's waiting box shows and the bot repeats ("🍊 47"): the person shares only when both show the same.
 * A forwarded link fails that test (the person has no 30+DA screen asking), so a stranger who typed someone else's
 * number cannot quietly borrow their "Share my number". Not a secret, and no words: the same in every language.
 */
export const MATCH_SIGNS = ["🍊", "🍋", "🍉", "🍇", "🍓", "🍒", "🍍", "🥝", "🥥", "🌽", "🐟", "🐢", "🐘", "🦋", "🌙", "⭐"];
export const MATCH_RE = new RegExp(`^(?:${MATCH_SIGNS.join("|")}) [1-9]\\d$`, "u");
export const newMatchMark = () => `${MATCH_SIGNS[crypto.randomInt(MATCH_SIGNS.length)]} ${crypto.randomInt(10, 100)}`;

/** The typed number with its middle hidden ("+855 ••••• 678"): its owner knows it, a stranger learns little. */
export function maskPhone(p) {
  const s = String(p ?? "");
  return s.length < 8 ? "•••" : `${s.slice(0, 4)} ${"•".repeat(s.length - 7)} ${s.slice(-3)}`;
}

/** A moment as a Phnom Penh clock shows it ("14:05"): fixed UTC+7, never the server's own time zone. */
export const phnomPenhTime = (t) => new Date(new Date(t).getTime() + 7 * 3600e3).toISOString().slice(11, 16);

/** The browser's cookie for its check (12 minutes: the check + the grace; Max-Age 0 clears it). Secure on https. */
export function checkCookie(req, value, maxAgeS = CHECK_COOKIE_MAX_AGE_S) {
  const secure = publicOrigin(req).startsWith("https:");
  return `${CHECK_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=${CHECK_COOKIE_PATH}; Max-Age=${maxAgeS}${secure ? "; Secure" : ""}`;
}

/** The check cookie this browser carries, or null. */
export function readCheckCookie(req) {
  return String(req?.headers?.cookie || "").match(new RegExp(`(?:^|;\\s*)${CHECK_COOKIE}=([a-f0-9]{64})`))?.[1] ?? null;
}

/**
 * A new check for `phone` (E.164), bound to `browser` (the new cookie value). The browser's earlier check (its old
 * cookie, `previousBrowser`) ends. Only the token's hash is stored. → { token, expiresAt, match } (match: the sign
 * the app shows and the bot repeats).
 */
export async function startCheck(d, { phone, lang = "en", browser, previousBrowser = null, pinHash = null, now = Date.now() }) {
  if (!BROWSER_RE.test(String(browser))) throw new Error("A check needs a browser key.");
  const col = d.collection(TG_CHECKS);
  if (previousBrowser && BROWSER_RE.test(previousBrowser)) await col.deleteMany({ browser: sha256(previousBrowser) });
  const token = newCheckToken();
  const match = newMatchMark();
  await col.insertOne({
    _id: checkId(token),
    browser: sha256(browser),
    phone: String(phone),
    lang: BOT_LANGS.includes(lang) ? lang : "en",
    match,
    state: "waiting",
    created: new Date(now),
    expires: new Date(now + CHECK_TTL_MS),
    purgeAt: new Date(now + CHECK_TTL_MS + CHECK_KEEP_MS),
    ...(pinHash ? { pinHash } : {}),
  });
  return { token, expiresAt: now + CHECK_TTL_MS, match };
}

const expiresAt = (c) => new Date(c.expires).getTime();

/**
 * One status call from the browser that carries `browser` (its cookie value):
 *   none     no check (or it was already used / removed)
 *   waiting  { opened: the bot got "/start" from someone, expiresIn (s) }
 *   verified the check is taken ONCE (state → used, its PIN hash dropped) and onVerified(check) runs — the app signs
 *            in exactly like a good code; its answer is merged into this one. A second call finds nothing (none).
 *   mismatch / expired  said once, then the check is gone.
 */
export async function pollCheck(d, browser, { onVerified, now = Date.now() } = {}) {
  if (!BROWSER_RE.test(String(browser ?? ""))) return { state: "none" };
  const col = d.collection(TG_CHECKS);
  const mine = { browser: sha256(browser) };
  const c = await col.findOne(mine, { sort: { created: -1 } });
  if (!c || c.state === "used") return { state: "none" };
  if (c.state === "verified" && expiresAt(c) > now) {
    const taken = await col.findOneAndUpdate(
      { _id: c._id, state: "verified", expires: { $gt: new Date(now) } },
      { $set: { state: "used", usedAt: new Date(now) }, $unset: { pinHash: "" } },
      { returnDocument: "before" },
    );
    if (!taken) return { state: "none" }; // another call took it a moment ago
    const out = onVerified ? await onVerified(taken) : {};
    return { ...out, state: "verified" };
  }
  if (c.state === "mismatch") {
    await col.deleteOne({ _id: c._id });
    return { state: "mismatch" };
  }
  if (expiresAt(c) <= now) {
    await col.deleteOne({ _id: c._id });
    return { state: "expired" };
  }
  return { state: "waiting", opened: Boolean(c.tgUserId), expiresIn: Math.max(1, Math.ceil((expiresAt(c) - now) / 1000)) };
}

// ---------------------------------------------------------------- the bot (webhook)

/** The secret header Telegram sends matches the saved one (constant time; missing or empty never matches). */
export function hookSecretOk(given, stored) {
  if (typeof given !== "string" || !given || typeof stored !== "string" || !stored) return false;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(stored).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * A Telegram update → what it is. Only private chats with a person count (groups, channels, other bots, edits → ignore).
 *   { kind:'start', token|null, hadParam } · { kind:'contact', contact:{ userId, phone } } · { kind:'help' } (/help) ·
 *   { kind:'other', text } (a text, or a photo's caption; '' for anything else) · { kind:'ignore' }
 * plus fromId, chatId, langCode, messageId (to delete a shared contact), firstName and username (support's "from").
 */
export function parseUpdate(update) {
  const m = update?.message;
  if (!m || typeof m !== "object") return { kind: "ignore" };
  const from = m.from;
  const chat = m.chat;
  if (!from || from.is_bot || !Number.isSafeInteger(from.id) || chat?.type !== "private" || !Number.isSafeInteger(chat?.id)) {
    return { kind: "ignore" };
  }
  const base = {
    fromId: from.id, chatId: chat.id, langCode: String(from.language_code ?? "").slice(0, 12),
    messageId: Number.isSafeInteger(m.message_id) ? m.message_id : null,
    firstName: String(from.first_name ?? "").slice(0, 64),
    username: USERNAME_RE.test(String(from.username ?? "")) ? from.username : null,
  };
  if (m.contact && typeof m.contact === "object") {
    const userId = Number.isSafeInteger(m.contact.user_id) ? m.contact.user_id : null;
    return { ...base, kind: "contact", contact: { userId, phone: String(m.contact.phone_number ?? "").slice(0, 32) } };
  }
  const text = typeof m.text === "string" ? m.text.trim() : "";
  const s = text.match(/^\/start(?:@\w+)?(?:\s+(\S+))?\s*$/);
  if (s) return { ...base, kind: "start", token: s[1] && TOKEN_RE.test(s[1]) ? s[1] : null, hadParam: Boolean(s[1]) };
  if (/^\/help(?:@\w+)?\s*$/i.test(text)) return { ...base, kind: "help" };
  const said = typeof m.text === "string" ? m.text : typeof m.caption === "string" ? m.caption : "";
  return { ...base, kind: "other", text: said.trim().slice(0, 4096) };
}

/** Only the digits of a phone number ("+855 12-345 678" → "85512345678"). */
export const phoneDigits = (p) => String(p ?? "").replace(/\D/g, "");

/** A text that is only a phone number ("+855 12 345 678", "012-345-678"): a try at the check, never a support message. */
export const looksLikePhone = (text) => /^[\s+\-().\d]+$/.test(String(text ?? "")) && phoneDigits(text).length >= 6;

/**
 * A shared contact against the number typed in the app:
 *   'not_own'  not the sender's own contact (contact.user_id missing or someone else's) — Telegram does not vouch for it;
 *   'mismatch' their own number, but not the one typed;
 *   'ok'       their own number, digit for digit the typed one.
 */
export function contactVerdict(contact, fromId, typedPhone) {
  if (contact?.userId == null || contact.userId !== fromId) return "not_own";
  const got = phoneDigits(contact.phone);
  return got && got === phoneDigits(typedPhone) ? "ok" : "mismatch";
}

/** The reply language: the check's, else the person's Telegram language, else English. */
export function langFor(check, langCode) {
  if (check?.lang && BOT_LANGS.includes(check.lang)) return check.lang;
  const l = String(langCode ?? "").toLowerCase().slice(0, 2);
  return BOT_LANGS.includes(l) ? l : "en";
}

/**
 * The bot's words, short and plain, in the 5 app languages. `ask` says when it was asked — {time} (Phnom Penh) and
 * {mark} (the sign the app's waiting box shows) — and warns against a link someone sent. No text ever carries a phone
 * number, not even masked (owner 2026-10-13: "just: number verified"). support_ack: the once-a-day thanks for a
 * support message (src/lib/thirtyda-support.mjs).
 */
export const BOT_TEXT = {
  en: {
    ask: "Signing in to 30+DA ({time}, Phnom Penh time)?\nCheck that your 30+DA screen shows {mark}, then tap the button to share your number.\nIf someone sent you this link, do not tap.",
    button: "Share my number",
    done: "Number verified ✓ Go back to 30+DA.",
    mismatch: "That number is not the one you typed in 30+DA. In 30+DA, type the same number your Telegram uses, with its country code, then tap Telegram again.",
    not_own: "Please share your own number with the button below.",
    expired: "This link has expired. Go back to 30+DA and tap Telegram again.",
    help: "To sign in, open 30+DA, type your number and tap Telegram. You can also ask us anything here.",
    support_ack: "Thanks — the 30+DA team will reply here.",
  },
  km: {
    ask: "អ្នកកំពុងចូល 30+DA ({time} ម៉ោងភ្នំពេញ) មែនទេ?\nសូមពិនិត្យថា អេក្រង់ 30+DA របស់អ្នកបង្ហាញ {mark} រួចចុចប៊ូតុង ដើម្បីចែករំលែកលេខរបស់អ្នក។\nបើមាននរណាម្នាក់ផ្ញើតំណនេះមកអ្នក សូមកុំចុច។",
    button: "ចែករំលែកលេខរបស់ខ្ញុំ",
    done: "បានផ្ទៀងផ្ទាត់លេខ ✓ សូមត្រឡប់ទៅ 30+DA វិញ។",
    mismatch: "លេខនេះមិនមែនជាលេខដែលអ្នកបានវាយក្នុង 30+DA ទេ។ នៅក្នុង 30+DA សូមវាយលេខដូចគ្នានឹងលេខដែល Telegram របស់អ្នកប្រើ ជាមួយលេខកូដប្រទេស រួចចុច Telegram ម្ដងទៀត។",
    not_own: "សូមចែករំលែកលេខផ្ទាល់ខ្លួនរបស់អ្នក ដោយប្រើប៊ូតុងខាងក្រោម។",
    expired: "តំណនេះផុតកំណត់ហើយ។ សូមត្រឡប់ទៅ 30+DA ហើយចុច Telegram ម្ដងទៀត។",
    help: "ដើម្បីចូល សូមបើក 30+DA វាយលេខទូរសព្ទរបស់អ្នក ហើយចុច Telegram។ អ្នកក៏អាចសួរយើងអ្វីក៏បាននៅទីនេះ។",
    support_ack: "អរគុណ — ក្រុម 30+DA នឹងឆ្លើយតបនៅទីនេះ។",
  },
  zh: {
    ask: "你正在登录 30+DA 吗？（金边时间 {time}）\n请确认你的 30+DA 屏幕上显示 {mark}，再点按钮分享你的号码。\n如果这个链接是别人发给你的，请不要点。",
    button: "分享我的号码",
    done: "号码已验证 ✓ 请回到 30+DA。",
    mismatch: "这个号码不是你在 30+DA 里输入的号码。请在 30+DA 里输入你的 Telegram 用的同一个号码（带国家区号），再点一次 Telegram。",
    not_own: "请用下面的按钮分享你自己的号码。",
    expired: "这个链接已过期。请回到 30+DA，再点一次 Telegram。",
    help: "要登录，请打开 30+DA，输入你的号码，然后点 Telegram。你也可以在这里问我们任何问题。",
    support_ack: "谢谢！30+DA 团队会在这里回复你。",
  },
  ko: {
    ask: "30+DA에 로그인하는 중인가요? (프놈펜 시간 {time})\n30+DA 화면에 {mark} 표시가 있는지 확인한 뒤, 버튼을 눌러 번호를 공유하세요.\n누군가 이 링크를 보내 줬다면 누르지 마세요.",
    button: "내 번호 공유",
    done: "번호 인증 완료 ✓ 30+DA로 돌아가세요.",
    mismatch: "이 번호는 30+DA에 입력한 번호가 아니에요. 30+DA에서 Telegram에 쓰는 번호를 국가 번호와 함께 입력한 뒤 Telegram을 다시 누르세요.",
    not_own: "아래 버튼으로 본인 번호를 공유해 주세요.",
    expired: "이 링크는 만료됐어요. 30+DA로 돌아가 Telegram을 다시 누르세요.",
    help: "로그인하려면 30+DA를 열고 번호를 입력한 뒤 Telegram을 누르세요. 궁금한 점은 여기에서 물어보셔도 돼요.",
    support_ack: "고마워요 — 30+DA 팀이 여기에서 답해 드릴게요.",
  },
  ja: {
    ask: "30+DA にログインしようとしていますか？（プノンペン時間 {time}）\n30+DA の画面に {mark} が出ているか確かめてから、ボタンを押して番号を共有してください。\n誰かからこのリンクが送られてきた場合は、押さないでください。",
    button: "自分の番号を共有",
    done: "番号を確認しました ✓ 30+DA に戻ってください。",
    mismatch: "この番号は 30+DA で入力した番号ではありません。30+DA で、Telegram で使っている番号を国番号から入力し、もう一度 Telegram を押してください。",
    not_own: "下のボタンで、ご自分の番号を共有してください。",
    expired: "このリンクは期限切れです。30+DA に戻って、もう一度 Telegram を押してください。",
    help: "ログインするには、30+DA を開いて番号を入力し、Telegram を押してください。ご質問があれば、ここで何でも聞いてください。",
    support_ack: "ありがとうございます。30+DA チームがここで返信します。",
  },
};

/** What `ask` names for one check: { time (Phnom Penh, when it was started), mark } — never the number. */
export const askVars = (check) => ({
  time: check?.created ? phnomPenhTime(check.created) : "—",
  mark: check?.match || "—",
});

/**
 * The sendMessage parameters for one reply (kind: ask | not_own | done | mismatch | expired | help | support_ack);
 * vars fill ask. support_ack leaves the keyboard alone (a "Share my number" button may still be waiting).
 */
export function botReply(kind, lang, chatId, vars = null) {
  const T = BOT_TEXT[lang] ?? BOT_TEXT.en;
  const button = { keyboard: [[{ text: T.button, request_contact: true }]], one_time_keyboard: true, resize_keyboard: true };
  const fill = { ...askVars(null), ...(vars ?? {}) };
  const text = (T[kind] ?? T.help).replace(/\{(time|mark)\}/g, (_, k) => String(fill[k]));
  if (kind === "support_ack") return { chat_id: chatId, text };
  const askAgain = kind === "ask" || kind === "not_own";
  return { chat_id: chatId, text, reply_markup: askAgain ? button : { remove_keyboard: true } };
}

/**
 * What one update does to the checks, and which reply it gets → { kind, lang, vars? } | null (no reply). An ask
 * carries vars (askVars: the time, the sign) so the person can tell it is their own sign-in before sharing.
 * kind 'support': a text that is not part of a check — handleTelegramHook hands it to src/lib/thirtyda-support.mjs.
 * Every write is conditional (still waiting, still live), so a repeated or late update changes nothing.
 */
export async function processUpdate(d, u, now = Date.now()) {
  if (!u || u.kind === "ignore") return null;
  const col = d.collection(TG_CHECKS);
  const live = { state: "waiting", expires: { $gt: new Date(now) } };
  if (u.kind === "help") return { kind: "help", lang: langFor(null, u.langCode) };
  if (u.kind === "start") {
    if (!u.token) return { kind: u.hadParam ? "expired" : "help", lang: langFor(null, u.langCode) };
    const id = checkId(u.token);
    const c = await col.findOne({ _id: id });
    const lang = langFor(c, u.langCode);
    if (!c || c.state !== "waiting" || expiresAt(c) <= now) return { kind: "expired", lang };
    // Bound to the FIRST Telegram user who opens the link; the same person may open it again.
    const r = await col.updateOne(
      { _id: id, ...live, $or: [{ tgUserId: { $exists: false } }, { tgUserId: u.fromId }] },
      { $set: { tgUserId: u.fromId, openedAt: new Date(now) } },
    );
    return r.matchedCount ? { kind: "ask", lang, vars: askVars(c) } : { kind: "expired", lang };
  }
  // A contact, or anything else: about this person's most recently opened live check.
  const c = await col.findOne({ tgUserId: u.fromId, ...live }, { sort: { openedAt: -1 } });
  const lang = langFor(c, u.langCode);
  // Words that are not a number: a question for the team (support), even in the middle of a check.
  if (u.kind === "other" && u.text && !looksLikePhone(u.text)) return { kind: "support", lang };
  if (!c) return { kind: "help", lang };
  if (u.kind !== "contact") return { kind: "ask", lang, vars: askVars(c) }; // a number typed as text is never believed: the button again
  const verdict = contactVerdict(u.contact, u.fromId, c.phone);
  if (verdict === "not_own") return { kind: "not_own", lang };
  if (verdict === "mismatch") {
    await col.updateOne({ _id: c._id, state: "waiting" }, { $set: { state: "mismatch", endedAt: new Date(now) } });
    return { kind: "mismatch", lang };
  }
  const r = await col.updateOne(
    { _id: c._id, state: "waiting" },
    { $set: { state: "verified", verifiedAt: new Date(now) }, $max: { expires: new Date(now + VERIFIED_GRACE_MS) } },
  );
  if (r.matchedCount) {
    // Support can name this person's 30+DA profile later (best effort: the check itself is what signs in).
    await d.collection(TG_LINKS).updateOne({ _id: u.fromId }, { $set: { phone: c.phone, at: new Date(now) } }, { upsert: true })
      .catch(() => {});
  }
  return { kind: r.matchedCount ? "done" : "expired", lang };
}

/** A small JSON body (Telegram's update) → object, or null when too big or not JSON. */
function readSmallJson(req, max = HOOK_BODY_MAX) {
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
      if (over) return resolve(null);
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
        resolve(v && typeof v === "object" && !Array.isArray(v) ? v : null);
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

/**
 * POST /30da/api/telegram/hook — Telegram's updates for the saved bot. 401 unless the secret header matches (and
 * nothing is read or written). A good update → 200 (Telegram does not send it again); our own failure → 500 (it does).
 * opts: db (async () => Mongo Db), fetchImpl (the Bot API), now.
 */
export async function handleTelegramHook(req, res, { db, fetchImpl = fetch, now } = {}) {
  const end = (status) => {
    res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end();
  };
  if (req.method !== "POST") {
    req.resume();
    return end(405);
  }
  try {
    const d = await db();
    const cfg = await botConfig(d);
    if (!cfg || !hookSecretOk(req.headers[SECRET_HEADER], cfg.hookSecret)) {
      req.resume();
      return end(401);
    }
    const update = await readSmallJson(req);
    const u = parseUpdate(update);
    const at = now ?? Date.now();
    let plan = await processUpdate(d, u, at);
    // A shared contact does not stay in the chat (owner 2026-10-13: the number is only compared): bots may delete
    // incoming messages in private chats. A delete Telegram refuses changes nothing else.
    if (u.kind === "contact" && u.messageId != null) {
      const del = await botCall(cfg.token, "deleteMessage", { chat_id: u.chatId, message_id: u.messageId }, { fetchImpl });
      if (!del.ok) console.warn(`[30da telegram] a shared contact was not deleted: ${del.reason}`);
    }
    // Words for the team: kept for the admin Support page; the bot thanks them once a day (or says nothing).
    if (plan?.kind === "support") {
      const { recordSupport } = await import("./thirtyda-support.mjs"); // loaded here: it imports this module
      const s = await recordSupport(d, u, { now: at, lang: plan.lang });
      plan = s.ack ? { kind: "support_ack", lang: s.lang } : null;
    }
    if (plan) {
      const sent = await botCall(cfg.token, "sendMessage", botReply(plan.kind, plan.lang, u.chatId, plan.vars), { fetchImpl });
      if (!sent.ok) {
        console.warn(`[30da telegram] the bot's reply was not sent: ${sent.reason}`);
        // Telegram no longer takes this key: the app stops offering the bot until the admin saves and tries again.
        if (sent.reason === "bad_token") {
          const doc = await settingDoc(d);
          if (doc?.box?.iv) await noteBotOutcome(d, doc.box.iv, { ok: false, reason: "bad_token", detail: sent.description }, { by: "reply" });
        }
      }
    }
    return end(200);
  } catch (err) {
    console.error("[30da telegram] hook:", err instanceof Error ? err.message.slice(0, 120) : "error");
    if (!res.headersSent) end(500);
  }
}

// ---------------------------------------------------------------- limits

/**
 * In-memory sliding-window limits (start / status per address, number and browser). over(key, max) → true when `key`
 * already has `max` in the window; otherwise counts this one. Empty keys are dropped every window.
 */
export function windowLimiter(windowMs = 15 * 60e3) {
  const map = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, list] of map) if (!list.some((t) => now - t < windowMs)) map.delete(k);
  }, windowMs);
  timer.unref?.();
  return {
    over(key, max, now = Date.now()) {
      const list = (map.get(key) || []).filter((t) => now - t < windowMs);
      map.set(key, list);
      if (list.length >= max) return true;
      list.push(now);
      return false;
    },
  };
}
