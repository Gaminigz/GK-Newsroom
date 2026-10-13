/**
 * 30+DA sign-in codes: how a 6-digit code reaches a phone.
 *
 * The person picks the channel (Telegram first; WhatsApp next). A channel is LIVE when it is configured:
 *   telegram — a Telegram Gateway API token is saved on the admin Connections page (thirtyda_settings,
 *              src/lib/thirtyda-settings.mjs), else the THIRTYDA_TG_TOKEN env var.
 *   whatsapp — not wired yet (never live).
 * The app (src/lib/thirtyda-app.mjs, POST /30da/api/auth/send-code) really delivers on a live channel and
 * falls back to on-screen test codes only when a channel is not live and THIRTYDA_DEV_AUTH=1.
 *
 * Telegram Gateway API (https://core.telegram.org/gateway/api):
 *   POST https://gatewayapi.telegram.org/sendVerificationMessage
 *   Authorization: Bearer <token>
 *   { phone_number:'+855…', code:'123456', ttl:600 } → { ok:true, result:{ request_id, request_cost, … } }
 *                                                    | { ok:false, error:'ACCESS_TOKEN_INVALID' | … }
 * Failures come back in plain words: number not on Telegram / bad token / no balance / other (timeout,
 * network, anything else). The token is never logged or returned.
 */

import { readSecret, noteSecretUse } from "./thirtyda-settings.mjs";

export const CODE_CHANNELS = ["telegram", "whatsapp"];
export const DEFAULT_CHANNEL = "telegram";
export const CHANNEL_NAMES = { telegram: "Telegram", whatsapp: "WhatsApp" };
export const TELEGRAM_SEND_URL = "https://gatewayapi.telegram.org/sendVerificationMessage";
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

/** The Telegram token in use: the one saved on the Connections page, else THIRTYDA_TG_TOKEN. null = none. */
export async function telegramToken(d, env = process.env) {
  const saved = d ? await readSecret(d, "telegram") : null;
  return saved || String(env.THIRTYDA_TG_TOKEN ?? "").trim() || null;
}

/** true when codes on `channel` really go out (Telegram: a token is configured). */
export async function channelLive(d, channel) {
  if (channel === "telegram") return Boolean(await telegramToken(d));
  return false;
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

function failure(channel, reason, detail = null) {
  const name = CHANNEL_NAMES[channel] ?? "The channel";
  const message = channel !== "telegram" ? `${name} is not set up yet.`
    : (reason === "other" ? TEXT[detail] : TEXT[reason]) ?? `${name} refused the request${detail ? ` (${detail})` : ""}.`;
  return { ok: false, channel, reason, detail, message };
}

/**
 * Deliver `code` to `phone` (E.164) on `channel`.
 * → { ok:true, channel, requestId, cost, balance } | { ok:false, channel, reason, detail, message }.
 * Never throws for a delivery problem. opts: d (Mongo Db, to read the saved token), token (use this one),
 * fetchImpl + timeoutMs (tests), record (default true: keep ok/reason on the saved setting for the admin's
 * card; the admin's own test sends pass false).
 */
export async function deliverCode(channel, phone, code, { d = null, token, fetchImpl = fetch, timeoutMs = TIMEOUT_MS, record = true } = {}) {
  if (channel !== "telegram") return failure(channel, "not_set");
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
