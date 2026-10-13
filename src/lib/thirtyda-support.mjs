/**
 * 30+DA support through the free Telegram bot (owner 2026-10-13): "this bot can act as support — questions land on
 * the Admin web page, and admin uses the bot to reply".
 *
 * In — the bot's webhook (src/lib/thirtyda-telegram-bot.mjs, handleTelegramHook): a private text (or a photo's
 *   caption) that is not part of a phone check (/start <token>, a shared contact, a number typed as text) is a support
 *   message. Stored:
 *     thirtyda_support        one doc per message: { chatId, dir: 'in', from: { name, username }, text (≤ 2000), at,
 *                             lang (a guess), profileId, tgMessageId, read } — the person's first name and @username
 *                             only: never a phone number (Telegram sends none with a text).
 *     thirtyda_support_chats  one doc per Telegram chat: { _id: chatId, from, lang, profileId, firstAt, lastAt, lastText,
 *                             lastDir, unread, count, ackDay, blockedAt? }.
 *   The bot thanks them once per conversation-day (the first message of each Phnom Penh day): "Thanks — the 30+DA team
 *   will reply here." (5 languages). At most 20 messages per chat per hour are taken; past that, quietly nothing.
 *   profileId: the 30+DA profile of a Telegram user who verified a number with the bot before — the bot keeps
 *   thirtyda_tg_links { _id: Telegram user id, phone (the number typed in the app that Telegram vouched for), at }
 *   when it verifies, and the profile is the one with that number.
 *
 * Out — the admin Support page (src/thirtyda-admin/support.html + support.js; routes in src/lib/thirtyda-admin.mjs):
 *   the list (newest first, unread counts), one conversation (opening it marks it read), and a reply that the bot sends
 *   to that chat (sendMessage, plain text ≤ 2000), stored as { dir: 'out', by: 'team' }. Only a chat that wrote to the
 *   bot can get a reply. When Telegram refuses (the person blocked the bot) the admin is told so in plain words.
 *
 * The bot's own profile words (setMyDescription / setMyShortDescription, 5 languages via language_code) go out,
 * best effort, when the admin saves or tries the bot on the Code page (describeBot).
 *
 * Pure apart from the `d` (Mongo Db) and `fetchImpl` handed in, so the unit tests run without a database or network.
 */

import {
  BOT_LANGS, TG_CHECKS, TG_LINKS, botCall, botConfig, langFor, windowLimiter,
} from "./thirtyda-telegram-bot.mjs";

export const SUPPORT = "thirtyda_support";
export const SUPPORT_CHATS = "thirtyda_support_chats";
export const SUPPORT_TEXT_MAX = 2000;
export const SUPPORT_PER_HOUR = 20;
const USERS = "thirtyda_users";
const PREVIEW_MAX = 140;
const NAME_MAX = 64;
const DESCRIBE_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------- words

/** The day as a Phnom Penh calendar shows it ("2026-10-13"): fixed UTC+7, never the server's own zone. */
export const phnomPenhDay = (t) => new Date(new Date(t).getTime() + 7 * 3600e3).toISOString().slice(0, 10);

/**
 * A message as it may be kept and shown: line breaks kept, other control characters and direction overrides dropped,
 * trimmed, at most `max` characters.
 */
export function supportText(raw, max = SUPPORT_TEXT_MAX) {
  return String(raw ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f‪-‮⁦-⁩]/g, "")
    .trim()
    .slice(0, max);
}

const oneLine = (s, max) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Who wrote: their Telegram first name and @username only. */
export function supportFrom(u) {
  const name = oneLine(supportText(u?.firstName, NAME_MAX), NAME_MAX) || "Telegram user";
  const username = /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(String(u?.username ?? "")) ? `@${u.username}` : null;
  return { name, username };
}

/**
 * The language a message is written in, from its script: Khmer, Japanese (kana), Korean (Hangul), Chinese (Han);
 * anything else (Latin, emoji, digits) → `fallback` (the person's check or Telegram language), else English.
 */
export function guessLang(text, fallback = "en") {
  const s = String(text ?? "");
  if (/[ក-៿᧠-᧿]/.test(s)) return "km";
  if (/[぀-ヿㇰ-ㇿ]/.test(s)) return "ja";
  if (/[가-힯ᄀ-ᇿ㄰-㆏]/.test(s)) return "ko";
  if (/[㐀-䶿一-鿿]/.test(s)) return "zh";
  return BOT_LANGS.includes(fallback) ? fallback : "en";
}

/** The bot's profile words (setMyDescription ≤ 512, setMyShortDescription ≤ 120), in the 5 app languages. */
export const BOT_DESCRIPTION = {
  en: "GKVerify — GK SMART's number check for 30+DA and other GK apps. Verify your number here, or ask us anything.",
  km: "GKVerify — ការផ្ទៀងផ្ទាត់លេខរបស់ GK SMART សម្រាប់ 30+DA និងកម្មវិធី GK ផ្សេងទៀត។ ផ្ទៀងផ្ទាត់លេខរបស់អ្នកនៅទីនេះ ឬសួរយើងអ្វីក៏បាន។",
  zh: "GKVerify — GK SMART 为 30+DA 及其他 GK 应用提供的号码验证。在这里验证你的号码，或问我们任何问题。",
  ko: "GKVerify — 30+DA와 다른 GK 앱을 위한 GK SMART 번호 인증. 여기에서 번호를 인증하거나 무엇이든 물어보세요.",
  ja: "GKVerify — 30+DA などの GK アプリのための GK SMART の番号確認。ここで番号の確認ができます。何でも聞いてください。",
};
export const BOT_SHORT_DESCRIPTION = {
  en: "GK SMART number check for 30+DA and other GK apps. Verify or ask us anything.",
  km: "ការផ្ទៀងផ្ទាត់លេខ GK SMART សម្រាប់ 30+DA និងកម្មវិធី GK។ ផ្ទៀងផ្ទាត់ ឬសួរយើង។",
  zh: "GK SMART 号码验证，适用于 30+DA 及其他 GK 应用。验证或提问。",
  ko: "30+DA와 GK 앱을 위한 GK SMART 번호 인증. 인증하거나 질문하세요.",
  ja: "30+DA などの GK アプリ向け GK SMART 番号確認。確認やご質問はこちら。",
};

// ---------------------------------------------------------------- in (the webhook)

const ready = new WeakMap();
/** The indexes support reads by (once per database handle, best effort). */
function ensureSupportIndexes(d) {
  if (!ready.has(d)) {
    const make = (name, keys) => (typeof d.collection(name).createIndex === "function" ? d.collection(name).createIndex(keys) : null);
    ready.set(d, Promise.all([
      make(SUPPORT, { chatId: 1, at: 1 }),
      make(SUPPORT_CHATS, { lastAt: -1 }),
      make(TG_LINKS, { at: 1 }),
    ]).catch(() => ready.delete(d)));
  }
  return ready.get(d);
}

/** The 30+DA profile id of a Telegram user who verified a number with the bot before, or null. */
export async function profileForTelegram(d, tgUserId) {
  try {
    let phone = (await d.collection(TG_LINKS).findOne({ _id: tgUserId }))?.phone ?? null;
    if (!phone) {
      // A check verified in the last half hour (before links were kept, or the link write failed).
      const c = await d.collection(TG_CHECKS).findOne({ tgUserId, state: { $in: ["verified", "used"] } }, { sort: { verifiedAt: -1 } });
      phone = c?.phone ?? null;
    }
    if (!phone) return null;
    const user = await d.collection(USERS).findOne({ phone: String(phone) }, { projection: { _id: 1 } });
    return user ? String(user._id) : null;
  } catch {
    return null;
  }
}

/** Per chat: at most SUPPORT_PER_HOUR messages are taken in any hour. */
const supportLimits = windowLimiter(60 * 60e3);

/**
 * One support message from the bot's webhook (`u` from parseUpdate: kind 'other' with text). Stored with who wrote it
 * (first name + @username), the text (≤ 2000), the time, a language guess and their 30+DA profile when known.
 * → { stored, ack, lang, profileId?, reason? } — ack: this is the chat's first message of the Phnom Penh day, so the
 * bot says thanks (once a day). Over the hourly limit or empty → { stored:false, ack:false } and nothing is said.
 * opts.lang: the language the bot would answer in otherwise (the person's check, else their Telegram language).
 */
export async function recordSupport(d, u, { now = Date.now(), lang = null, limiter = supportLimits } = {}) {
  const text = supportText(u?.text);
  if (!text || !Number.isSafeInteger(u?.chatId)) return { stored: false, ack: false, reason: "empty" };
  if (limiter.over(`chat:${u.chatId}`, SUPPORT_PER_HOUR, now)) return { stored: false, ack: false, reason: "rate" };
  await ensureSupportIndexes(d);
  const at = new Date(now);
  const from = supportFrom(u);
  const guessed = guessLang(text, lang ?? langFor(null, u.langCode));
  const profileId = await profileForTelegram(d, u.fromId);
  const day = phnomPenhDay(now);
  try {
    await d.collection(SUPPORT).insertOne({
      // Keyed by Telegram's message id: an update Telegram sends again (after a slow answer) is not kept twice.
      ...(Number.isSafeInteger(u.messageId) ? { _id: `in:${u.chatId}:${u.messageId}` } : {}),
      chatId: u.chatId, dir: "in", from, text, at, lang: guessed, profileId, tgMessageId: u.messageId ?? null, read: false,
    });
  } catch (err) {
    if (err?.code === 11000) return { stored: false, ack: false, reason: "duplicate" };
    throw err;
  }
  const before = await d.collection(SUPPORT_CHATS).findOneAndUpdate(
    { _id: u.chatId },
    {
      $set: { from, lang: guessed, lastAt: at, lastText: oneLine(text, PREVIEW_MAX), lastDir: "in", ackDay: day, ...(profileId ? { profileId } : {}) },
      $inc: { unread: 1, count: 1 },
      $setOnInsert: { firstAt: at },
      // Writing again reopens a chat whose earlier reply Telegram refused.
      $unset: { blockedAt: "" },
    },
    { upsert: true, returnDocument: "before" },
  );
  return { stored: true, ack: (before?.ackDay ?? null) !== day, lang: guessed, profileId };
}

// ---------------------------------------------------------------- out (the admin page)

const iso = (t) => (t ? new Date(t).toISOString() : null);

async function profileNames(d, ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map();
  const rows = await d.collection(USERS).find({ _id: { $in: list } }, { projection: { _id: 1, name: 1 } }).toArray();
  return new Map(rows.map((r) => [String(r._id), r.name ?? null]));
}

function chatView(c, names) {
  return {
    chatId: c._id,
    name: c.from?.name ?? "Telegram user",
    username: c.from?.username ?? null,
    lang: c.lang ?? null,
    profileId: c.profileId ?? null,
    profileName: c.profileId ? names.get(c.profileId) ?? null : null,
    firstAt: iso(c.firstAt),
    lastAt: iso(c.lastAt),
    lastText: c.lastText ?? "",
    lastDir: c.lastDir ?? "in",
    unread: Math.max(0, Number(c.unread) || 0),
    count: Math.max(0, Number(c.count) || 0),
    blocked: Boolean(c.blockedAt),
  };
}

/** The conversations, newest first → { chats: [...], unread: total unread messages }. */
export async function listSupportChats(d, { limit = 200 } = {}) {
  const rows = await d.collection(SUPPORT_CHATS).find({}).sort({ lastAt: -1 }).limit(limit).toArray();
  const names = await profileNames(d, rows.map((r) => r.profileId));
  const chats = rows.map((r) => chatView(r, names));
  return { chats, unread: await supportUnread(d) };
}

/** Unread messages over all conversations (the sidebar badge). */
export async function supportUnread(d) {
  const rows = await d.collection(SUPPORT_CHATS).find({ unread: { $gt: 0 } }, { projection: { unread: 1 } }).toArray();
  return rows.reduce((n, r) => n + Math.max(0, Number(r.unread) || 0), 0);
}

const messageView = (m) => ({
  id: String(m._id),
  dir: m.dir === "out" ? "out" : "in",
  text: m.text ?? "",
  at: iso(m.at),
  ...(m.dir === "out" ? { by: m.by ?? "team" } : { lang: m.lang ?? null }),
});

/**
 * One conversation (their messages + the team's replies, oldest first; the last 500) → { chat, messages } | null.
 * Opening it marks it read (markRead).
 */
export async function supportThread(d, chatId, { markRead = true, now = Date.now(), limit = 500 } = {}) {
  const chats = d.collection(SUPPORT_CHATS);
  const c = await chats.findOne({ _id: chatId });
  if (!c) return null;
  const rows = await d.collection(SUPPORT).find({ chatId }).sort({ at: -1 }).limit(limit).toArray();
  if (markRead && (c.unread ?? 0) > 0) {
    await chats.updateOne({ _id: chatId }, { $set: { unread: 0, readAt: new Date(now) } });
    await d.collection(SUPPORT).updateMany({ chatId, dir: "in", read: false }, { $set: { read: true } });
    c.unread = 0;
  }
  const names = await profileNames(d, [c.profileId]);
  return { chat: chatView(c, names), messages: rows.reverse().map(messageView) };
}

const REPLY_WORDS = {
  empty: "Write a reply first.",
  too_long: `A reply can be at most ${SUPPORT_TEXT_MAX} characters.`,
  no_chat: "There is no such conversation. Only people who wrote to the bot can get a reply.",
  no_bot: "The Telegram bot is not set up on this site. Save its key on the Code page first.",
  blocked: "Telegram did not deliver it: this person has blocked the bot (or left Telegram). If they write to the bot again, you can reply again.",
  not_found: "Telegram cannot find this chat any more, so the reply was not sent.",
  bad_token: "Telegram no longer accepts the bot key, so the reply was not sent. Save the key again on the Code page.",
  too_many: "Telegram asks us to wait a little. Try again in a minute.",
  timeout: "Telegram did not answer within 10 seconds. Try again.",
  network: "Could not reach Telegram. Check the connection and try again.",
  other: (detail) => `Telegram refused the reply${detail ? ` (${detail})` : ""}. Try again.`,
};

/**
 * The team's reply to one conversation: sendMessage { chat_id, text } — plain text (no parse mode), at most 2000
 * characters, only to a chat that wrote to the bot. Stored as { dir:'out', by:'team' } once Telegram took it.
 * → { ok:true, message } | { ok:false, status, reason, error }.
 */
export async function sendSupportReply(d, chatId, rawText, { fetchImpl = fetch, now = Date.now() } = {}) {
  const refuse = (status, reason, detail = null) => {
    const w = REPLY_WORDS[reason] ?? REPLY_WORDS.other;
    return { ok: false, status, reason, error: typeof w === "function" ? w(detail) : w };
  };
  if (typeof rawText !== "string") return refuse(400, "empty");
  if (rawText.trim().length > SUPPORT_TEXT_MAX) return refuse(422, "too_long");
  const text = supportText(rawText);
  if (!text) return refuse(422, "empty");
  const chats = d.collection(SUPPORT_CHATS);
  const c = Number.isSafeInteger(chatId) ? await chats.findOne({ _id: chatId }) : null;
  if (!c) return refuse(404, "no_chat");
  const cfg = await botConfig(d);
  if (!cfg) return refuse(503, "no_bot");
  const r = await botCall(cfg.token, "sendMessage", { chat_id: chatId, text }, { fetchImpl });
  if (!r.ok) {
    if (r.reason === "blocked") {
      await chats.updateOne({ _id: chatId }, { $set: { blockedAt: new Date(now) } });
      return refuse(422, "blocked");
    }
    if (/chat not found|user not found/i.test(String(r.description ?? ""))) return refuse(422, "not_found");
    return refuse(r.reason === "too_many" ? 429 : 502, r.reason, r.description);
  }
  const at = new Date(now);
  const doc = { chatId, dir: "out", by: "team", text, at, tgMessageId: r.result?.message_id ?? null, read: true };
  const ins = await d.collection(SUPPORT).insertOne(doc);
  await chats.updateOne({ _id: chatId }, {
    $set: { lastAt: at, lastText: oneLine(text, PREVIEW_MAX), lastDir: "out" },
    $inc: { count: 1 },
    $unset: { blockedAt: "" },
  });
  return { ok: true, message: messageView({ ...doc, _id: ins?.insertedId ?? "" }) };
}

// ---------------------------------------------------------------- the bot's profile words

/**
 * setMyDescription + setMyShortDescription for every app language (English is also the default, for everyone else).
 * Best effort: never throws, never blocks a save. → { ok: calls that went through, failed }.
 */
export async function describeBot(d, { fetchImpl = fetch } = {}) {
  const cfg = await botConfig(d).catch(() => null);
  if (!cfg) return { ok: 0, failed: 0 };
  const calls = [];
  for (const lang of BOT_LANGS) {
    const language_code = lang === "en" ? "" : lang; // "" = the default, for every language without its own
    calls.push(["setMyDescription", { description: BOT_DESCRIPTION[lang], language_code }]);
    calls.push(["setMyShortDescription", { short_description: BOT_SHORT_DESCRIPTION[lang], language_code }]);
  }
  const results = await Promise.all(calls.map(([method, params]) =>
    botCall(cfg.token, method, params, { fetchImpl, timeoutMs: DESCRIBE_TIMEOUT_MS }).catch(() => ({ ok: false }))));
  const ok = results.filter((r) => r.ok).length;
  return { ok, failed: results.length - ok };
}
