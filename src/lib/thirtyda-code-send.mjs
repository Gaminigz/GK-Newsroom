/**
 * 30+DA sign-in codes: how a 6-digit code reaches a phone.
 *
 * The person picks the channel (Telegram first, then WhatsApp). A channel is LIVE when it is configured:
 *   telegram — a Telegram Gateway API token is saved on the admin Code page (thirtyda_settings,
 *              src/lib/thirtyda-settings.mjs), else the THIRTYDA_TG_TOKEN env var.
 *   whatsapp — all four WhatsApp Cloud API fields are saved there (access token, phone number ID,
 *              template name, template language).
 * The app (src/lib/thirtyda-app.mjs, POST /30da/api/auth/send-code) really delivers on a live channel and
 * shows on-screen test codes only when THIRTYDA_DEV_AUTH=1 AND no channel is set up at all (testCodesAllowed):
 * once one channel is saved, picking another that is not live is refused instead of showing a code.
 *
 * WhatsApp Cloud API (an approved Authentication template with a copy-code button):
 *   POST https://graph.facebook.com/v21.0/<phone_number_id>/messages
 *   Authorization: Bearer <token>
 *   { messaging_product:'whatsapp', to:'85512345678' (digits only), type:'template',
 *     template:{ name, language:{ code }, components:[ { type:'body', parameters:[{ type:'text', text:code }] },
 *                                                      { type:'button', sub_type:'url', index:'0', parameters:[{ type:'text', text:code }] } ] } }
 *   → { messages:[{ id }] } | { error:{ message, code, error_subcode, … } }
 * Failures come back in plain words (bad token / number not on WhatsApp / number not on the test number's
 * list / template not approved / payment problem / other) with Meta's own message as the detail. The token
 * is never logged or returned.
 *
 * Telegram Gateway API (https://core.telegram.org/gateway/api):
 *   POST https://gatewayapi.telegram.org/sendVerificationMessage
 *   Authorization: Bearer <token>
 *   { phone_number:'+855…', code:'123456', ttl:600 } → { ok:true, result:{ request_id, request_cost, … } }
 *                                                    | { ok:false, error:'ACCESS_TOKEN_INVALID' | … }
 * Failures come back in plain words: number not on Telegram / bad token / no balance / other (timeout,
 * network, anything else). The token is never logged or returned.
 *
 * HONEST CHANNELS (owner 2026-10-13): a live channel is OFFERED in the app (GET /auth/methods, POST /auth/send-code)
 * only after the admin's "Send test code" has gone through at least once since its keys were last saved. A later
 * real or test send that fails for a LASTING reason (LASTING_REASONS: bad token, no balance / payment problem,
 * template not approved or missing) stops it again until the next successful test. A wrong number, a number not
 * on the test number's list, a timeout or anything else does not. The state lives on the setting itself
 * (thirtyda_settings.<channel>.offer { on, mark, reason, detail, at, by }); `mark` names the keys it is about (the
 * sealed box's IV, new on every save — or a short hash of THIRTYDA_TG_TOKEN), so saving new keys starts over.
 */

import crypto from "node:crypto";
import { readSecret, readFields, secretSaved, noteSecretUse, SETTINGS_COLLECTION } from "./thirtyda-settings.mjs";

export const CODE_CHANNELS = ["telegram", "whatsapp"];
export const DEFAULT_CHANNEL = "telegram";
export const CHANNEL_NAMES = { telegram: "Telegram", whatsapp: "WhatsApp" };
export const TELEGRAM_SEND_URL = "https://gatewayapi.telegram.org/sendVerificationMessage";
export const WHATSAPP_GRAPH_URL = "https://graph.facebook.com/v21.0";
export const WHATSAPP_DEFAULT_LANG = "en_US";
export const CODE_TTL_S = 600;
const TIMEOUT_MS = 10_000;

/** A Telegram Gateway token as pasted: trimmed, 20–256 characters, letters, digits and _ - : . only. */
export const TELEGRAM_TOKEN_RE = /^[A-Za-z0-9_\-:.]{20,256}$/;
export function checkTelegramToken(raw) {
  const token = String(raw ?? "").trim();
  if (!token) return { ok: false, error: "Paste the token first." };
  if (/\s/.test(token)) return { ok: false, error: "A token has no spaces in it. Copy it again from gateway.telegram.org → API token." };
  if (!TELEGRAM_TOKEN_RE.test(token)) {
    return { ok: false, error: "That does not look like a Telegram Gateway token (20–256 letters, digits, _ - : .). Copy it again from gateway.telegram.org → API token." };
  }
  return { ok: true, token };
}

/** The Telegram token in use: the one saved on the Code page, else THIRTYDA_TG_TOKEN. null = none. */
export async function telegramToken(d, env = process.env) {
  const saved = d ? await readSecret(d, "telegram") : null;
  return saved || String(env.THIRTYDA_TG_TOKEN ?? "").trim() || null;
}

// ---------- WhatsApp fields (the admin Code page) ----------

/** What each WhatsApp field may hold. Meta's access tokens are long runs of letters and digits ("EAA…"). */
export const WHATSAPP_RULES = {
  token: /^[A-Za-z0-9_\-.|:]{20,1024}$/,
  phoneNumberId: /^\d{5,25}$/,
  templateName: /^[a-z0-9_]{1,512}$/,
  templateLang: /^[a-z]{2,3}(?:_[A-Za-z]{2,4})?$/,
};
const WHATSAPP_FIELD_TEXT = {
  token: {
    empty: "Paste the access token first.",
    spaces: "An access token has no spaces in it. Copy it again from Meta.",
    bad: "That does not look like a WhatsApp access token. Copy it again from Meta (Business settings → System users → Generate token).",
  },
  phoneNumberId: {
    empty: "Write the Phone number ID first.",
    bad: "The Phone number ID is only digits. Copy it from Meta: WhatsApp → API setup → Phone number ID.",
  },
  templateName: {
    empty: "Write the template name first.",
    bad: "Write the template name exactly as Meta shows it: small letters, digits and _ only (WhatsApp Manager → Message templates).",
  },
  templateLang: {
    bad: "Write the template language as Meta shows it on the template, for example en_US or en.",
  },
};

/**
 * Check what the admin typed for WhatsApp. A secret left empty keeps the saved one (`current`, when readable);
 * an empty language is en_US. → { ok:true, values } | { ok:false, field, error } (plain words).
 */
export function checkWhatsAppFields(input = {}, current = null) {
  const v = {
    token: String(input.token ?? "").trim(),
    phoneNumberId: String(input.phoneNumberId ?? "").replace(/\s+/g, ""),
    templateName: String(input.templateName ?? "").trim(),
    templateLang: String(input.templateLang ?? "").trim() || WHATSAPP_DEFAULT_LANG,
  };
  if (!v.token && current?.token) v.token = current.token;
  const bad = (field, kind) => ({ ok: false, field, error: WHATSAPP_FIELD_TEXT[field][kind] });
  if (!v.token) return bad("token", "empty");
  if (/\s/.test(v.token)) return bad("token", "spaces");
  for (const field of Object.keys(WHATSAPP_RULES)) {
    if (!v[field]) return bad(field, "empty");
    if (!WHATSAPP_RULES[field].test(v[field])) return bad(field, "bad");
  }
  return { ok: true, values: v };
}

/** The saved WhatsApp fields when all four are there and readable, else null. */
export async function whatsappConfig(d) {
  const f = d ? await readFields(d, "whatsapp") : null;
  if (!f) return null;
  return checkWhatsAppFields(f).ok ? f : null;
}

/** The Cloud API request for one code: { url, init } (the token only in the Authorization header). */
export function whatsappRequest({ token, phoneNumberId, templateName, templateLang }, phone, code) {
  const text = String(code);
  return {
    url: `${WHATSAPP_GRAPH_URL}/${encodeURIComponent(phoneNumberId)}/messages`,
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: String(phone).replace(/\D/g, ""),
        type: "template",
        template: {
          name: templateName,
          language: { code: templateLang || WHATSAPP_DEFAULT_LANG },
          components: [
            { type: "body", parameters: [{ type: "text", text }] },
            { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text }] },
          ],
        },
      }),
    },
  };
}

/**
 * Meta's error ({ code, error_subcode }) + HTTP status →
 *   bad_token | not_on_whatsapp | not_allowed | template | no_balance | other.
 * not_allowed (131030, "Recipient phone number not in allowed list"): the sender is still Meta's test number
 * and the recipient was never added to its list — the person IS on WhatsApp, so it is not not_on_whatsapp.
 * https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */
export function classifyWhatsAppError(error, status = 200) {
  const code = Number(error?.code);
  if ([190, 102, 463, 467, 10].includes(code) || (code >= 200 && code <= 299) || status === 401) return "bad_token";
  if (code >= 132000 && code <= 132999) return "template";
  if (code === 131030) return "not_allowed";
  if (code === 131026) return "not_on_whatsapp";
  if (code === 131042) return "no_balance";
  if (status === 403) return "bad_token";
  return "other";
}

/**
 * Meta's error message, short and safe to show and keep: never the token, no long digit runs (a phone
 * number), no line breaks, and in plain words ("OAuth" dropped). + " (code N)".
 */
export function whatsappDetail(error, token, status) {
  const said = String(error?.message ?? "").trim();
  const details = String(error?.error_data?.details ?? "").trim();
  let msg = [said, details && details !== said ? details : ""].filter(Boolean).join(": ").replace(/[\u0000-\u001f\u007f]+/g, " ");
  if (token) msg = msg.split(token).join("…");
  msg = msg.replace(/\bOAuth\s*/gi, "").replace(/\d{7,}/g, "…").replace(/\s+/g, " ").trim().slice(0, 200);
  const code = Number.isFinite(Number(error?.code)) && error?.code != null ? ` (code ${Number(error.code)})` : "";
  return (msg || `HTTP ${status}`) + code;
}

/** true when codes on `channel` really go out (Telegram: a token is configured; WhatsApp: all four fields). */
export async function channelLive(d, channel) {
  if (channel === "telegram") return Boolean(await telegramToken(d));
  if (channel === "whatsapp") return Boolean(await whatsappConfig(d));
  return false;
}

/**
 * true when ANY code channel is set up: live, or saved but unreadable (THIRTYDA_SECRET_KEY changed since).
 * Once one is, real codes are the only codes: no channel may show a code on screen any more.
 */
export async function codeChannelConfigured(d) {
  for (const channel of CODE_CHANNELS) if (await channelLive(d, channel)) return true;
  if (!d) return false;
  for (const channel of CODE_CHANNELS) if (await secretSaved(d, channel)) return true;
  return false;
}

/**
 * On-screen test codes (the "Test code" note): only in test mode (THIRTYDA_DEV_AUTH=1) AND while no code
 * channel is set up. Picking a channel that is not live never shows a code once another one is live, so
 * test mode cannot be used to sign in as a number that is not yours next to a real channel.
 */
export async function testCodesAllowed(d, devAuth = process.env.THIRTYDA_DEV_AUTH === "1") {
  if (!devAuth) return false;
  return !(await codeChannelConfigured(d));
}

const TEXT = {
  not_on_telegram: "Telegram cannot send a code to this number. It may not be on Telegram.",
  bad_token: "Telegram did not accept the token. Copy it again from gateway.telegram.org → API token and save it.",
  no_balance: "The Telegram Gateway account has no balance left. Add funds at gateway.telegram.org.",
  not_set: "No Telegram token is saved.",
  timeout: "Telegram did not answer within 10 seconds.",
  network: "Could not reach Telegram.",
};

/** Telegram's error (e.g. 'ACCESS_TOKEN_INVALID') + HTTP status → not_on_telegram | bad_token | no_balance | other. */
export function classifyTelegramError(detail, status = 200) {
  const e = String(detail ?? "").toUpperCase();
  if (/TOKEN|UNAUTHORI[SZ]ED|FORBIDDEN|ACCESS_DENIED/.test(e) || status === 401 || status === 403) return "bad_token";
  if (/BALANCE|FUNDS|PAYMENT|MONEY|CREDIT/.test(e) || status === 402) return "no_balance";
  if (/PHONE|NUMBER|USER|NOT_FOUND|UNSUPPORTED|CANNOT_SEND|NOT_AVAILABLE|PEER/.test(e)) return "not_on_telegram";
  return "other";
}

const WA_TEXT = {
  bad_token: "WhatsApp did not accept the access token. Make a new permanent token in Meta (Business settings → System users → Generate token) and save it again.",
  not_on_whatsapp: "WhatsApp cannot send a code to this number. It may not be on WhatsApp.",
  not_allowed: "This WhatsApp number is still Meta's test number: add the phone you are sending to in Meta → WhatsApp → API setup → 'To' list, or use your real business number.",
  template: "WhatsApp did not accept the message template. Check the template name and language, and that Meta has approved it (WhatsApp Manager → Message templates).",
  no_balance: "WhatsApp cannot send because of a payment problem on the Meta business account. Add or fix the payment method in Meta Business settings.",
  not_set: "WhatsApp is not set up yet.",
  timeout: "WhatsApp did not answer within 10 seconds.",
  network: "Could not reach WhatsApp.",
};

function failure(channel, reason, detail = null) {
  const name = CHANNEL_NAMES[channel] ?? "The channel";
  const words = channel === "telegram" ? TEXT : channel === "whatsapp" ? WA_TEXT : {};
  const pick = (k) => (k != null && Object.hasOwn(words, k) ? words[k] : undefined);
  const message = (reason === "other" ? pick(detail) : pick(reason))
    ?? (reason === "not_set" ? `${name} is not set up yet.` : `${name} refused the request${detail ? ` (${detail})` : ""}.`);
  return { ok: false, channel, reason, detail, message };
}

const isTimeout = (err) => err?.name === "TimeoutError" || err?.name === "AbortError";

/**
 * Deliver `code` to `phone` (E.164) on `channel`.
 * → { ok:true, channel, requestId, cost, balance } | { ok:false, channel, reason, detail, message }.
 * Never throws for a delivery problem. opts: d (Mongo Db, to read the saved settings), token (Telegram: use
 * this one), whatsapp (WhatsApp: use these fields), fetchImpl + timeoutMs (tests), record (default true: keep
 * ok/reason on the saved setting for the admin's card; the admin's own test sends pass false), test (the admin's
 * "Send test code": a success turns the channel on in the app), offer (default true: with `d` and the saved keys,
 * the outcome updates whether the app offers the channel — see noteChannelOutcome).
 */
export async function deliverCode(channel, phone, code, opts = {}) {
  if (!CODE_CHANNELS.includes(channel)) return failure(channel, "not_set");
  // The keys this send uses, named before it goes out (a save during the send cannot take its outcome).
  const track = Boolean(opts.d) && opts.offer !== false && !opts.token && !opts.whatsapp;
  const mark = track ? await channelKeyMark(opts.d, channel).catch(() => null) : null;
  const out = channel === "telegram" ? await deliverTelegram(phone, code, opts) : await deliverWhatsApp(phone, code, opts);
  if (mark) {
    try {
      await noteChannelOutcome(opts.d, channel, out, { test: Boolean(opts.test), mark });
    } catch (err) {
      console.error(`[30da code] could not note the ${channel} outcome:`, err instanceof Error ? err.message : err);
    }
  }
  return out;
}

// ---------- honest channels: offered in the app only once a test code went through ----------

/** Reasons that stay until someone fixes the setup in Telegram / Meta. Anything else (a number, a timeout) does not stop a channel. */
export const LASTING_REASONS = ["bad_token", "no_balance", "template"];
export const isLastingFailure = (reason) => LASTING_REASONS.includes(reason);

const settingDoc = (d, channel) => d.collection(SETTINGS_COLLECTION).findOne({ _id: channel });

/**
 * Which keys `channel` uses right now → "box:<iv of the sealed box>" (new on every save) or, for Telegram with
 * nothing readable saved, "env:<12 hex of SHA-256 of THIRTYDA_TG_TOKEN>". null = not live. `doc` = the setting
 * when already read.
 */
export async function channelKeyMark(d, channel, { doc, env = process.env } = {}) {
  if (!d || !CODE_CHANNELS.includes(channel)) return null;
  const saved = channel === "telegram" ? Boolean(await readSecret(d, "telegram")) : Boolean(await whatsappConfig(d));
  if (saved) {
    const s = doc === undefined ? await settingDoc(d, channel) : doc;
    return s?.box?.iv ? `box:${s.box.iv}` : null;
  }
  const envToken = channel === "telegram" ? String(env.THIRTYDA_TG_TOKEN ?? "").trim() : "";
  return envToken ? `env:${crypto.createHash("sha256").update(envToken).digest("hex").slice(0, 12)}` : null;
}

/**
 * Where `channel` stands for the app:
 *   { live, offered, state: 'off' | 'untested' | 'on' | 'stopped', reason, detail, at }
 * off: no keys in use · untested: keys saved, no test code has gone through since · on: offered in the app ·
 * stopped: a send failed for a lasting reason (reason/detail say which) — a new successful test turns it on.
 */
export async function channelOffer(d, channel) {
  const none = { reason: null, detail: null, at: null };
  if (!d || !CODE_CHANNELS.includes(channel)) return { live: false, offered: false, state: "off", ...none };
  const doc = await settingDoc(d, channel);
  const mark = await channelKeyMark(d, channel, { doc });
  if (!mark) return { live: false, offered: false, state: "off", ...none };
  const o = doc?.offer;
  if (!o || o.mark !== mark) return { live: true, offered: false, state: "untested", ...none };
  const at = o.at ? new Date(o.at).toISOString() : null;
  if (o.on) return { live: true, offered: true, state: "on", reason: null, detail: null, at };
  return { live: true, offered: false, state: "stopped", reason: o.reason ?? null, detail: o.detail ?? null, at };
}

/** true when the app offers `channel`: live AND a test code went through since its keys were saved AND not stopped since. */
export async function channelOffered(d, channel) {
  return (await channelOffer(d, channel)).offered;
}

/**
 * One send's outcome → the offer state of the keys `mark` names: a successful TEST turns the channel on; a send
 * (real or test) that failed for a lasting reason stops it. Anything else changes nothing. Never stores a phone
 * number or the code. Written only while the same keys are still saved (box IV), so a save in between wins.
 */
export async function noteChannelOutcome(d, channel, out, { test = false, mark } = {}) {
  if (!d || !mark || !CODE_CHANNELS.includes(channel)) return false;
  let offer = null;
  if (out?.ok && test) offer = { on: true, mark, reason: null, detail: null, at: new Date(), by: "test" };
  else if (out && !out.ok && isLastingFailure(out.reason)) {
    offer = { on: false, mark, reason: out.reason, detail: out.detail ? String(out.detail).slice(0, 200) : null, at: new Date(), by: test ? "test" : "send" };
  }
  if (!offer) return false;
  const col = d.collection(SETTINGS_COLLECTION);
  if (mark.startsWith("box:")) {
    await col.updateOne({ _id: channel, "box.iv": mark.slice(4) }, { $set: { offer } });
    return true;
  }
  // The server's own Telegram token (nothing saved here): a small doc that holds only this state.
  try {
    await col.updateOne({ _id: channel, box: { $exists: false } }, { $set: { offer } }, { upsert: true });
  } catch (err) {
    if (err?.code !== 11000) throw err; // a token was saved meanwhile: its own state starts fresh
  }
  return true;
}

async function deliverWhatsApp(phone, code, { d = null, whatsapp, fetchImpl = fetch, timeoutMs = TIMEOUT_MS, record = true } = {}) {
  const cfg = whatsapp ?? (await whatsappConfig(d));
  if (!cfg) return failure("whatsapp", "not_set");
  const { url, init } = whatsappRequest(cfg, phone, code);
  let out;
  try {
    const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    let body = null;
    try {
      body = await res.json();
    } catch (err) {
      if (isTimeout(err)) throw err;
    }
    const id = body?.messages?.[0]?.id;
    if (res.status >= 200 && res.status < 300 && id && !body?.error) {
      out = { ok: true, channel: "whatsapp", requestId: String(id).slice(0, 120), cost: null, balance: null };
    } else {
      const error = body?.error ?? {};
      out = failure("whatsapp", classifyWhatsAppError(error, res.status), whatsappDetail(error, cfg.token, res.status));
    }
  } catch (err) {
    out = failure("whatsapp", "other", isTimeout(err) ? "timeout" : "network");
  }
  if (record && d) {
    noteSecretUse(d, "whatsapp", { ok: out.ok, reason: out.ok ? null : out.reason, detail: out.ok ? null : out.detail }).catch(() => {});
  }
  return out;
}

async function deliverTelegram(phone, code, { d = null, token, fetchImpl = fetch, timeoutMs = TIMEOUT_MS, record = true } = {}) {
  const channel = "telegram";
  const tok = token ?? (await telegramToken(d));
  if (!tok) return failure(channel, "not_set");

  let out;
  let res = null;
  try {
    res = await fetchImpl(TELEGRAM_SEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ phone_number: phone, code: String(code), ttl: CODE_TTL_S }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    let body = null;
    try {
      body = await res.json();
    } catch (err) {
      if (err?.name === "TimeoutError" || err?.name === "AbortError") throw err;
    }
    if (body?.ok === true) {
      const r = body.result ?? {};
      out = {
        ok: true,
        channel,
        requestId: r.request_id != null ? String(r.request_id) : null,
        cost: Number.isFinite(r.request_cost) ? r.request_cost : null,
        balance: Number.isFinite(r.remaining_balance) ? r.remaining_balance : null,
      };
    } else {
      // Keep only a short code-like string from Telegram (it never carries the token).
      const detail = String(body?.error || `HTTP_${res.status}`).replace(/[^\w .:-]/g, "").slice(0, 80) || `HTTP_${res.status}`;
      out = failure(channel, classifyTelegramError(detail, res.status), detail);
    }
  } catch (err) {
    const timeout = err?.name === "TimeoutError" || err?.name === "AbortError";
    out = failure(channel, "other", timeout ? "timeout" : "network");
  }
  if (record && d) {
    noteSecretUse(d, "telegram", { ok: out.ok, reason: out.ok ? null : out.reason, detail: out.ok ? null : out.detail }).catch(() => {});
  }
  return out;
}
