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
 * Failures come back in plain words (bad token / number not on WhatsApp / template not approved / payment
 * problem / other) with Meta's own message as the detail. The token is never logged or returned.
 *
 * Telegram Gateway API (https://core.telegram.org/gateway/api):
 *   POST https://gatewayapi.telegram.org/sendVerificationMessage
 *   Authorization: Bearer <token>
 *   { phone_number:'+855…', code:'123456', ttl:600 } → { ok:true, result:{ request_id, request_cost, … } }
 *                                                    | { ok:false, error:'ACCESS_TOKEN_INVALID' | … }
 * Failures come back in plain words: number not on Telegram / bad token / no balance / other (timeout,
 * network, anything else). The token is never logged or returned.
 */

import { readSecret, readFields, secretSaved, noteSecretUse } from "./thirtyda-settings.mjs";

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
 * Meta's error ({ code, error_subcode }) + HTTP status → bad_token | not_on_whatsapp | template | no_balance | other.
 * https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */
export function classifyWhatsAppError(error, status = 200) {
  const code = Number(error?.code);
  if ([190, 102, 463, 467, 10].includes(code) || (code >= 200 && code <= 299) || status === 401) return "bad_token";
  if (code >= 132000 && code <= 132999) return "template";
  if ([131026, 131030].includes(code)) return "not_on_whatsapp";
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
 * ok/reason on the saved setting for the admin's card; the admin's own test sends pass false).
 */
export async function deliverCode(channel, phone, code, opts = {}) {
  if (channel === "telegram") return deliverTelegram(phone, code, opts);
  if (channel === "whatsapp") return deliverWhatsApp(phone, code, opts);
  return failure(channel, "not_set");
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
