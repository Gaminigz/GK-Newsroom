/**
 * 30+DA sign-in with Google / Facebook — the keys the super admin saves on the admin Code page, and the
 * sign-in itself (server side, no SDK, no new dependency).
 *
 * The keys are kept sealed in thirtyda_settings (src/lib/thirtyda-settings.mjs, FIELD_SETTINGS.google /
 * .facebook) and shown back masked. With them saved the app's Google / Facebook buttons work; without them
 * the app shows "Coming soon" (test mode keeps its instant test sign-in).
 *
 *   google   { clientId, clientSecret }   Google Cloud → APIs & Services → Credentials → a Web application client
 *   facebook { appId, appSecret }         Meta for Developers → your app → App settings → Basic
 *
 * The flow (src/lib/thirtyda-app.mjs serves it; the admin's "Try sign-in" starts it in src/lib/thirtyda-admin.mjs):
 *   GET /30da/api/auth/<provider>/start      → 302 to Google / Facebook with a fresh `state`
 *   GET /30da/api/auth/<provider>/callback   ← ?code&state (or ?error=access_denied when the person cancels)
 *   state: 32 random bytes; only its SHA-256 is stored (thirtyda_signin_states, 10 minutes, TTL index) and it
 *   is used once. A cookie (thirtyda_oauth, HttpOnly, SameSite=Lax, Secure on https, Path=/30da/api/auth/<provider>)
 *   carries the same state, so the return only counts in the browser that started it.
 *   Google:   https://accounts.google.com/o/oauth2/v2/auth (response_type=code, scope "openid email profile",
 *             prompt=select_account) → POST https://oauth2.googleapis.com/token (form body) →
 *             GET https://openidconnect.googleapis.com/v1/userinfo (Bearer) → { sub, email, email_verified, name }
 *   Facebook: https://www.facebook.com/v21.0/dialog/oauth (scope public_profile,email) →
 *             GET https://graph.facebook.com/v21.0/oauth/access_token → GET /v21.0/me?fields=id,name,email with
 *             appsecret_proof = HMAC-SHA256(access token, key = app secret)
 *   TikTok:   (owner 2026-10-13, Login Kit for Web v2) https://www.tiktok.com/v2/auth/authorize/ (client_key,
 *             response_type=code, scope user.info.basic) → POST https://open.tiktokapis.com/v2/oauth/token/ (form
 *             body) → GET https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,display_name,avatar_url
 *             (Bearer). TikTok gives no email: the person is their open_id (kept), the display name only shows on
 *             the admin's try page. PKCE: TikTok documents code_verifier for its mobile / desktop apps only, not for
 *             web, so it is built (pkcePair: a verifier kept with the state, S256 challenge) but OFF (TIKTOK.pkce).
 * The provider's tokens never leave signinPerson(): not stored, not logged, not returned. What is kept is the
 * person's provider id (+ email when given) — see src/lib/thirtyda-app.mjs completeSignin.
 *
 * Pure apart from the `d` (Mongo Db) and `fetchImpl` handed in, so the unit tests run without a database or network.
 */

import crypto from "node:crypto";
import { readFields } from "./thirtyda-settings.mjs";

export const SIGNIN_PROVIDERS = ["google", "facebook", "tiktok"];
export const SIGNIN_NAMES = { google: "Google", facebook: "Facebook", tiktok: "TikTok" };
/** The sign-in is built: with its keys saved a button works (test mode without keys keeps its instant test sign-in). */
export const SIGNIN_WIRED = { google: true, facebook: true, tiktok: true };
/** Where a provider's sign-in is marked on the user / session (`verified.gmail` is older than Google sign-in). */
export const VERIFIED_KEY = { google: "gmail", facebook: "facebook", tiktok: "tiktok" };
/** The two saved boxes of each sign-in: [the public ID, the secret] (FIELD_SETTINGS in src/lib/thirtyda-settings.mjs). */
export const KEY_FIELDS = { google: ["clientId", "clientSecret"], facebook: ["appId", "appSecret"], tiktok: ["clientKey", "clientSecret"] };

const RULES = {
  google: {
    clientId: {
      re: /^[A-Za-z0-9][A-Za-z0-9._-]{4,200}\.apps\.googleusercontent\.com$/,
      empty: "Paste the Client ID first.",
      bad: "A Google Client ID ends with .apps.googleusercontent.com. Copy it again from Google Cloud → APIs & Services → Credentials.",
    },
    clientSecret: {
      secret: true,
      re: /^[A-Za-z0-9_-]{10,200}$/,
      empty: "Paste the Client secret first.",
      bad: "That does not look like a Google Client secret (letters, digits, - and _, no spaces). Copy it again from the same page.",
    },
  },
  facebook: {
    appId: {
      re: /^\d{5,25}$/,
      empty: "Write the App ID first.",
      bad: "The App ID is only digits. Copy it from Meta for Developers → your app → App settings → Basic.",
    },
    appSecret: {
      secret: true,
      re: /^[A-Za-z0-9]{16,128}$/,
      empty: "Paste the App secret first.",
      bad: "That does not look like a Facebook App secret (letters and digits, no spaces). Copy it again from App settings → Basic (press Show).",
    },
  },
  tiktok: {
    clientKey: {
      re: /^[A-Za-z0-9]{8,64}$/,
      empty: "Paste the Client key first.",
      bad: "That does not look like a TikTok Client key (letters and digits, no spaces). Copy it from developers.tiktok.com → Manage apps → your app.",
    },
    clientSecret: {
      secret: true,
      re: /^[A-Za-z0-9_-]{16,128}$/,
      empty: "Paste the Client secret first.",
      bad: "That does not look like a TikTok Client secret (letters and digits, no spaces). Copy it again from the same page.",
    },
  },
};

/**
 * Check what the admin typed for `provider`. A secret left empty keeps the saved one (`current`, when
 * readable). → { ok:true, values } | { ok:false, field, error } (plain words).
 */
export function checkSigninFields(provider, input = {}, current = null) {
  const rules = RULES[provider];
  if (!rules) return { ok: false, field: null, error: "No such sign-in." };
  const values = {};
  for (const [field, rule] of Object.entries(rules)) {
    let v = String(input?.[field] ?? "").trim();
    if (!v && rule.secret && current?.[field]) v = current[field];
    if (!v) return { ok: false, field, error: rule.empty };
    if (!rule.re.test(v)) return { ok: false, field, error: rule.bad };
    values[field] = v;
  }
  return { ok: true, values };
}

/** true when both keys of `provider` are saved and readable. */
export async function signinKeysSaved(d, provider) {
  if (!SIGNIN_PROVIDERS.includes(provider) || !d) return false;
  const f = await readFields(d, provider);
  return Boolean(f && checkSigninFields(provider, f).ok);
}

/** "https://ecom.ggmt.sg" from the request (http only on this machine), for the addresses the admin copies. */
export function publicOrigin(req) {
  const raw = String(req?.headers?.["x-forwarded-host"] || req?.headers?.host || "").split(",")[0].trim().toLowerCase();
  const host = /^[a-z0-9.-]+(?::\d{1,5})?$/.test(raw) || /^\[[0-9a-f:]+\](?::\d{1,5})?$/.test(raw) ? raw : "ecom.ggmt.sg";
  const name = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  const local = name === "localhost" || name === "127.0.0.1" || name === "::1" || name.endsWith(".localhost");
  return `${local ? "http" : "https"}://${host}`;
}

/** Where Google / Facebook send people back after they sign in (to paste into their consoles). */
export function signinRedirect(req, provider) {
  return `${publicOrigin(req)}/30da/api/auth/${provider}/callback`;
}

// ---------------------------------------------------------------- the sign-in itself

export const SIGNIN_STATES = "thirtyda_signin_states";
export const STATE_TTL_MS = 10 * 60e3;
export const STATE_COOKIE = "thirtyda_oauth";
const TIMEOUT_MS = 10_000;
const STATE_RE = /^[a-f0-9]{64}$/;

export const GOOGLE = {
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  userinfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
  scope: "openid email profile",
};
export const FACEBOOK = {
  authUrl: "https://www.facebook.com/v21.0/dialog/oauth",
  tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
  meUrl: "https://graph.facebook.com/v21.0/me",
  scope: "public_profile,email",
};
export const TIKTOK = {
  authUrl: "https://www.tiktok.com/v2/auth/authorize/",
  tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
  userInfoUrl: "https://open.tiktokapis.com/v2/user/info/",
  scope: "user.info.basic",
  fields: "open_id,union_id,display_name,avatar_url",
  // TikTok's web flow takes no code_challenge (only its mobile / desktop apps do, and those hash it to hex, not the
  // RFC's base64url). Built and tested, but off: turn on only after a Try sign-in proves TikTok accepts it.
  pkce: false,
};

/** The saved keys of `provider` as { id, secret } (checked), or null: not saved, not readable, or malformed. */
export async function signinKeys(d, provider) {
  if (!SIGNIN_PROVIDERS.includes(provider) || !d) return null;
  const f = await readFields(d, provider);
  if (!f || !checkSigninFields(provider, f).ok) return null;
  const [id, secret] = KEY_FIELDS[provider];
  return { id: f[id], secret: f[secret] };
}

/**
 * PKCE (RFC 7636, S256) for a provider that uses it: a fresh verifier — kept server side with the state, never in
 * the browser — and its challenge for the authorize address. null when the provider does not use it (`on`).
 */
export function pkcePair(provider, on = provider === "tiktok" && TIKTOK.pkce) {
  if (!on) return null;
  const verifier = crypto.randomBytes(48).toString("base64url"); // 64 characters, inside RFC 7636's 43–128
  return { verifier, challenge: crypto.createHash("sha256").update(verifier).digest("base64url") };
}

/** Where the person is sent to sign in (the client ID / app ID / client key is public; never the secret). */
export function authorizeUrl(provider, { clientId, redirectUri, state, codeChallenge = null }) {
  if (provider === "tiktok") {
    const q = new URLSearchParams({ client_key: clientId, response_type: "code", scope: TIKTOK.scope, redirect_uri: redirectUri, state });
    if (codeChallenge) {
      q.set("code_challenge", codeChallenge);
      q.set("code_challenge_method", "S256");
    }
    return `${TIKTOK.authUrl}?${q}`;
  }
  if (provider === "google") {
    const q = new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: GOOGLE.scope, state, prompt: "select_account",
    });
    return `${GOOGLE.authUrl}?${q}`;
  }
  if (provider === "facebook") {
    const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state, response_type: "code", scope: FACEBOOK.scope });
    return `${FACEBOOK.authUrl}?${q}`;
  }
  throw new Error("No such sign-in.");
}

const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
export const stateHash = sha256;

/**
 * A fresh state for one sign-in: 32 random bytes (64 hex). Only its SHA-256 is stored, with the provider, the
 * purpose (test: the admin's "Try sign-in", bound to that admin session by `adminHash`) and a 10-minute expiry.
 * `verifier`: the PKCE verifier of this sign-in (pkcePair), kept with it until the code comes back.
 */
export async function createSigninState(d, provider, { test = false, adminHash = null, verifier = null, to = null, now = Date.now() } = {}) {
  if (!SIGNIN_PROVIDERS.includes(provider)) throw new Error("No such sign-in.");
  const state = crypto.randomBytes(32).toString("hex");
  await d.collection(SIGNIN_STATES).insertOne({
    _id: sha256(state), provider, test: Boolean(test), ...(test && adminHash ? { adminHash } : {}),
    ...(verifier ? { verifier: String(verifier) } : {}),
    // 'me': started on #/me to add this account to the signed-in profile (never a switch); back to #/me after.
    ...(to === "me" ? { to: "me" } : {}),
    created: new Date(now), expires: new Date(now + STATE_TTL_MS),
  });
  return state;
}

/**
 * Use up the state that came back. It is deleted on first sight (single use), whatever happens next.
 * → { ok:true, rec } only when it was stored for this provider, has not expired, and the browser's cookie carries
 *   the same state; else { ok:false, rec } (rec = what was stored, or null — so a failed admin try still gets
 *   the admin's page).
 */
export async function takeSigninState(d, provider, state, cookieState, now = Date.now()) {
  if (!STATE_RE.test(String(state ?? ""))) return { ok: false, rec: null };
  const rec = await d.collection(SIGNIN_STATES).findOneAndDelete({ _id: sha256(state) });
  if (!rec) return { ok: false, rec: null };
  const sameBrowser = STATE_RE.test(String(cookieState ?? ""))
    && crypto.timingSafeEqual(Buffer.from(String(cookieState)), Buffer.from(String(state)));
  const fresh = new Date(rec.expires).getTime() > now;
  return { ok: rec.provider === provider && fresh && sameBrowser, rec };
}

/** The state cookie (Max-Age 0 clears it). Secure whenever the page is https; only sent back to /30da/api/auth/<provider>. */
export function stateCookie(req, provider, state, maxAgeS = STATE_TTL_MS / 1000) {
  const secure = publicOrigin(req).startsWith("https:");
  return `${STATE_COOKIE}=${state}; HttpOnly; SameSite=Lax; Path=/30da/api/auth/${provider}; Max-Age=${maxAgeS}${secure ? "; Secure" : ""}`;
}

/** The state the browser carries back, or null. */
export function readStateCookie(req) {
  return String(req?.headers?.cookie || "").match(new RegExp(`(?:^|;\\s*)${STATE_COOKIE}=([a-f0-9]{64})`))?.[1] ?? null;
}

/** true while the admin session that started a "Try sign-in" (its token's SHA-256) is still signed in. */
export async function adminSessionAlive(d, adminHash, now = new Date()) {
  if (!/^[a-f0-9]{64}$/.test(String(adminHash ?? ""))) return false;
  const live = await d.collection("thirtyda_admin_sessions").find({ expires: { $gt: now } }, { projection: { _id: 1 } }).limit(200).toArray();
  return live.some((s) => sha256(s._id) === adminHash);
}

// ---- the requests (each { url, init }); the secret goes only where the provider asks for it

export function googleTokenRequest(keys, code, redirectUri) {
  return {
    url: GOOGLE.tokenUrl,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        code: String(code), client_id: keys.id, client_secret: keys.secret, redirect_uri: redirectUri, grant_type: "authorization_code",
      }).toString(),
    },
  };
}

export function googleUserinfoRequest(token) {
  return { url: GOOGLE.userinfoUrl, init: { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } } };
}

export function facebookTokenRequest(keys, code, redirectUri) {
  const q = new URLSearchParams({ client_id: keys.id, redirect_uri: redirectUri, client_secret: keys.secret, code: String(code) });
  return { url: `${FACEBOOK.tokenUrl}?${q}`, init: { method: "GET", headers: { Accept: "application/json" } } };
}

/** Facebook's appsecret_proof: HMAC-SHA256 of the access token, keyed with the app secret (hex). */
export function appsecretProof(token, appSecret) {
  return crypto.createHmac("sha256", String(appSecret)).update(String(token)).digest("hex");
}

export function facebookMeRequest(keys, token) {
  const q = new URLSearchParams({ fields: "id,name,email", access_token: token, appsecret_proof: appsecretProof(token, keys.secret) });
  return { url: `${FACEBOOK.meUrl}?${q}`, init: { method: "GET", headers: { Accept: "application/json" } } };
}

/** TikTok's token exchange: a form POST (client_key + client_secret in the body); code_verifier only with PKCE. */
export function tiktokTokenRequest(keys, code, redirectUri, verifier = null) {
  const body = new URLSearchParams({
    client_key: keys.id, client_secret: keys.secret, code: String(code), grant_type: "authorization_code", redirect_uri: redirectUri,
  });
  if (verifier) body.set("code_verifier", String(verifier));
  return {
    url: TIKTOK.tokenUrl,
    init: { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: body.toString() },
  };
}

export function tiktokUserInfoRequest(token) {
  const q = new URLSearchParams({ fields: TIKTOK.fields });
  return { url: `${TIKTOK.userInfoUrl}?${q}`, init: { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } } };
}

// ---- who signed in

const cleanText = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
function cleanEmail(v) {
  const e = String(v ?? "").trim().toLowerCase();
  return e.length <= 254 && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(e) ? e : null;
}

/** Google's userinfo → { provider, id, email, name } (email only when Google says it is verified), or null without a usable sub. */
export function googlePerson(info) {
  const id = typeof info?.sub === "string" && /^[A-Za-z0-9_-]{1,255}$/.test(info.sub) ? info.sub : null;
  if (!id) return null;
  const verified = info.email_verified === true || info.email_verified === "true";
  return { provider: "google", id, email: verified ? cleanEmail(info.email) : null, name: cleanText(info.name, 100) || null };
}

/** Facebook's /me → { provider, id, email, name } (Facebook only returns a confirmed email), or null without an id. */
export function facebookPerson(info) {
  const raw = typeof info?.id === "string" || typeof info?.id === "number" ? String(info.id) : "";
  const id = /^\d{1,32}$/.test(raw) ? raw : null;
  if (!id) return null;
  return { provider: "facebook", id, email: cleanEmail(info.email), name: cleanText(info.name, 100) || null };
}

/**
 * TikTok's /v2/user/info/ → { provider, id: open_id, email: null (TikTok gives none), name: display_name }, or null
 * without a usable open_id. union_id and avatar_url are asked for but never kept.
 */
export function tiktokPerson(body) {
  const user = body?.data?.user;
  const raw = typeof user?.open_id === "string" ? user.open_id : "";
  const id = /^[A-Za-z0-9_.:=+/-]{1,128}$/.test(raw) ? raw : null;
  if (!id) return null;
  return { provider: "tiktok", id, email: null, name: cleanText(user.display_name, 100) || null };
}

// ---- why it did not work (plain reasons the app and the admin's page put into words)

/**
 *   cancelled  the person pressed Cancel (or did not allow it)
 *   bad_keys   the Client ID / App ID or the secret is wrong
 *   redirect   the return address is not the one added in Google / Facebook
 *   not_live   the Google / Facebook app is not open to everyone yet
 *   expired    took too long, the code was already used, or the return came to another browser
 *   provider_error  Google / Facebook had a problem on their side (an HTTP 5xx or 429, or Facebook's "transient"
 *              error) — not a sign the keys are wrong; wait and try again
 *   timeout | network | other
 */
export const SIGNIN_REASONS = ["cancelled", "bad_keys", "redirect", "not_live", "expired", "provider_error", "timeout", "network", "other"];

/** An answer that says "try again later": the provider's own server trouble or its rate limit. */
const temporaryStatus = (status) => status === 429 || status >= 500;

/** Google's error code (the callback's ?error= or the token endpoint's { error }) + HTTP status → a reason. */
export function classifyGoogleError(error, status = 200) {
  const e = String(error ?? "").toLowerCase();
  if (e === "access_denied") return "cancelled";
  if (e === "invalid_client" || e === "unauthorized_client" || e === "deleted_client" || status === 401) return "bad_keys";
  if (e === "redirect_uri_mismatch") return "redirect";
  if (e === "invalid_grant") return "expired";
  if (e === "org_internal" || e === "admin_policy_enforced" || e === "disallowed_useragent") return "not_live";
  return "other";
}

/** Facebook's error ({ code, error_subcode, message } or the callback's error / error_reason) → a reason. */
export function classifyFacebookError(error = {}) {
  const code = Number(error?.code);
  const msg = String(error?.message ?? "");
  if (String(error?.error ?? error?.type ?? "") === "access_denied" || error?.error_reason === "user_denied") return "cancelled";
  if (code === 101 || /client[_ ]secret|app(lication)? secret|invalid (client_id|app(lication)? id)|error validating (application|client)/i.test(msg)) return "bad_keys";
  if (code === 191 || /redirect_uri|redirect uri|url blocked/i.test(msg)) return "redirect";
  if (/not (active|live|available)|development mode|app is in dev|isn't available|app not set ?up/i.test(msg)) return "not_live";
  if (code === 100 && /code (has )?(been used|expired)|authorization code|verification code|session has expired/i.test(msg)) return "expired";
  return "other";
}

/**
 * TikTok's error → a reason. `error`: the OAuth code (the callback's ?error=, the token endpoint's { error }) or the
 * API's error.code (user/info); `description`: their error_description / message; `status`: the HTTP status.
 */
export function classifyTiktokError(error, status = 200, description = "") {
  const e = String(error ?? "").toLowerCase();
  const msg = String(description ?? "");
  if (e === "access_denied" || e === "scope_not_authorized") return "cancelled";
  if (e === "server_error" || e === "temporarily_unavailable" || e === "internal_error" || e === "rate_limit_exceeded") return "provider_error";
  if (/redirect[_ ]?ur[il]/i.test(msg)) return "redirect";
  if (e === "invalid_client" || e === "unauthorized_client" || /client[_ ]?(key|secret)/i.test(msg)) return "bad_keys";
  if (e === "invalid_scope" || e === "scope_permission_missed" || /not (been )?(approved|live|available)|under review|sandbox|target user/i.test(msg)) return "not_live";
  if (e === "invalid_grant" || /code (has )?(been used|expired)|authorization code.*(expired|invalid|used)/i.test(msg)) return "expired";
  if (status === 401 && e !== "access_token_invalid") return "bad_keys";
  return "other";
}

/**
 * TikTok's own error from an answer: the OAuth shape { error: "invalid_client", error_description } or the API
 * shape { error: { code, message, log_id } } (code "ok" = no error) → { code, said } ("" when it said nothing).
 * The log_id is left out.
 */
function tiktokSaid(body) {
  const e = body?.error;
  if (e && typeof e === "object") {
    const code = typeof e.code === "string" && e.code !== "ok" ? e.code.replace(/[^\w.-]/g, "").slice(0, 60) : "";
    const msg = typeof e.message === "string" ? e.message : "";
    return { code, said: code ? (msg ? `${code}: ${msg}` : code) : "" };
  }
  const code = typeof e === "string" ? e.replace(/[^\w.-]/g, "").slice(0, 60) : "";
  const msg = typeof body?.error_description === "string" ? body.error_description : "";
  return { code, said: code ? (msg ? `${code}: ${msg}` : code) : "" };
}

/** A short, safe note of what the provider said: never the secret, the code or a token; no long digit runs. */
function providerDetail(text, hide = []) {
  let s = cleanText(text, 300);
  for (const x of hide) if (x && String(x).length >= 6) s = s.split(String(x)).join("…");
  return s.replace(/\bOAuth\s*/gi, "").replace(/\d{10,}/g, "…").replace(/\s+/g, " ").trim().slice(0, 160) || null;
}

const isTimeout = (err) => err?.name === "TimeoutError" || err?.name === "AbortError";

async function getJson(fetchImpl, { url, init }, timeoutMs) {
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  let body = null;
  try {
    body = await res.json();
  } catch (err) {
    if (isTimeout(err)) throw err;
  }
  return { status: res.status, body: body && typeof body === "object" ? body : {} };
}

/** Google's own error code from a JSON answer ({ error: "invalid_client" }), or "" (an HTML page, nothing said). */
const googleSaid = (body) => (typeof body?.error === "string" ? body.error.replace(/[^\w.-]/g, "").slice(0, 60) : "");
/** Facebook's own words from { error: { message, code } }, or "" when it gave no message. */
function facebookSaid(e) {
  if (!e?.message) return "";
  const code = e.code != null && Number.isFinite(Number(e.code)) ? ` (code ${Number(e.code)})` : "";
  return `${e.message}${code}`;
}
/** A failure: `said` is only ever what Google / Facebook wrote themselves (never our own notes) — else no detail. */
const failed = (reason, said, hide) => ({ ok: false, reason, detail: said ? providerDetail(said, hide) : null });

/**
 * The code that came back → who signed in: exchange it for an access token, read the person with it, and drop
 * the token. → { ok:true, person:{ provider, id, email, name } } | { ok:false, reason, detail } (detail: only
 * Google's / Facebook's own short error code or message, safe to show the admin after "Google said:"; null when
 * they said nothing — a timeout, no connection, a bare HTTP error. Never a token, the code or the secret).
 * A 5xx / 429 that names no setup problem is provider_error (their side: try again), not a refusal.
 * 10 s per request (`timeoutMs`). The token never leaves this function.
 * TikTok: `verifier` = the PKCE verifier kept with the state (only when pkcePair made one).
 */
export async function signinPerson(provider, keys, code, redirectUri, { fetchImpl = fetch, timeoutMs = TIMEOUT_MS, verifier = null } = {}) {
  if (!SIGNIN_PROVIDERS.includes(provider) || !keys?.id || !keys?.secret) return { ok: false, reason: "bad_keys", detail: null };
  const hide = [keys.secret, code, verifier];
  try {
    if (provider === "tiktok") {
      const t = await getJson(fetchImpl, tiktokTokenRequest(keys, code, redirectUri, verifier), timeoutMs);
      const token = typeof t.body.access_token === "string" && t.body.access_token ? t.body.access_token : null;
      if (t.status < 200 || t.status >= 300 || !token) {
        const { code: err, said } = tiktokSaid(t.body);
        const reason = classifyTiktokError(err, t.status, said);
        return failed(reason === "other" && temporaryStatus(t.status) ? "provider_error" : reason, said, hide);
      }
      hide.push(token, typeof t.body.refresh_token === "string" ? t.body.refresh_token : null);
      const u = await getJson(fetchImpl, tiktokUserInfoRequest(token), timeoutMs);
      const { code: err, said } = tiktokSaid(u.body);
      const person = u.status >= 200 && u.status < 300 && !err ? tiktokPerson(u.body) : null;
      if (!person) {
        const reason = classifyTiktokError(err, u.status, said);
        return failed(reason === "other" && temporaryStatus(u.status) ? "provider_error" : reason, said, hide);
      }
      // The token was issued for one person (its open_id): user/info must have answered for that same person.
      if (typeof t.body.open_id === "string" && t.body.open_id && t.body.open_id !== person.id) return failed("other", null, hide);
      return { ok: true, person };
    }
    if (provider === "google") {
      const t = await getJson(fetchImpl, googleTokenRequest(keys, code, redirectUri), timeoutMs);
      const token = typeof t.body.access_token === "string" ? t.body.access_token : null;
      if (t.status < 200 || t.status >= 300 || !token) {
        const err = googleSaid(t.body);
        const reason = classifyGoogleError(err, t.status);
        return failed(reason === "other" && temporaryStatus(t.status) ? "provider_error" : reason, err, hide);
      }
      hide.push(token);
      const u = await getJson(fetchImpl, googleUserinfoRequest(token), timeoutMs);
      const person = u.status >= 200 && u.status < 300 ? googlePerson(u.body) : null;
      if (!person) {
        const reason = temporaryStatus(u.status) ? "provider_error" : u.status === 401 ? "bad_keys" : "other";
        return failed(reason, googleSaid(u.body), hide);
      }
      return { ok: true, person };
    }
    const t = await getJson(fetchImpl, facebookTokenRequest(keys, code, redirectUri), timeoutMs);
    const token = typeof t.body.access_token === "string" ? t.body.access_token : null;
    if (t.status < 200 || t.status >= 300 || !token) {
      const e = t.body.error && typeof t.body.error === "object" ? t.body.error : {};
      const reason = classifyFacebookError(e);
      const temporary = reason === "other" && (temporaryStatus(t.status) || e.is_transient === true);
      return failed(temporary ? "provider_error" : reason, facebookSaid(e), hide);
    }
    hide.push(token);
    const u = await getJson(fetchImpl, facebookMeRequest(keys, token), timeoutMs);
    const person = u.status >= 200 && u.status < 300 && !u.body.error ? facebookPerson(u.body) : null;
    if (!person) {
      const e = u.body.error && typeof u.body.error === "object" ? u.body.error : {};
      const reason = classifyFacebookError(e);
      const temporary = reason === "other" && (temporaryStatus(u.status) || e.is_transient === true);
      return failed(temporary ? "provider_error" : reason, facebookSaid(e), hide);
    }
    return { ok: true, person };
  } catch (err) {
    // Our own observation, not something Google / Facebook said: no detail.
    return { ok: false, reason: isTimeout(err) ? "timeout" : "network", detail: null };
  }
}

/**
 * The callback's own ?error=… (the person cancelled, or the provider refused before any code) → a reason, or null
 * when there is no error.
 */
export function callbackError(provider, params) {
  const error = params.get("error");
  if (!error) return null;
  if (provider === "google") return classifyGoogleError(error);
  if (provider === "tiktok") return classifyTiktokError(error, 200, params.get("error_description") || "");
  return classifyFacebookError({ error, error_reason: params.get("error_reason"), message: params.get("error_description") || params.get("error_message") || "" });
}

// ---- what a good sign-in does (pure; src/lib/thirtyda-app.mjs completeSignin carries it out)

/** The Mongo filter for the profile that signed in with this Google / Facebook / TikTok account before. */
export const signinUserFilter = (provider, id) => ({ [`signin.${provider}.id`]: String(id) });

/**
 * A good sign-in → what to write. The same shape as verify-code (phone) and test mode's verify-social:
 *   user (a profile already carrying this provider id)  → kind 'returning': a session for that profile
 *   me (a signed-in profile with NO account of this     → kind 'attach': the profile adds it; its session goes on
 *      provider yet)
 *   me already linked to ANOTHER account of this        → kind 'new' (switched): the browser switches to this
 *      provider                                           account — a clean session that carries nothing of `me`
 *                                                         (no profile, phone or other proof) and lands on Create
 *                                                         profile. `me` and its link stay exactly as they were, so a
 *                                                         second account can never replace the first one's link.
 *   anyone else                                          → kind 'new': a fresh session marked verified for the
 *                                                          provider (+ the id to keep), which lands on Create profile
 * → { kind, switched?, userId?, userSet?, session } — `session` = the fields for the new session token. Only the
 *   provider id (+ email when given) is ever kept; no token, no name.
 */
export function planSignin({ provider, person, user = null, me = null, session = null }) {
  const key = VERIFIED_KEY[provider];
  if (!key || !person?.id) throw new Error("No such sign-in.");
  const link = { id: String(person.id), ...(person.email ? { email: person.email } : {}) };
  // TikTok (added later) shows up only once proved, so the older { gmail, facebook } shape stays as it was.
  const proved = (u) => ({
    gmail: Boolean(u?.verified?.gmail), facebook: Boolean(u?.verified?.facebook), ...(u?.verified?.tiktok ? { tiktok: true } : {}), [key]: true,
  });
  if (user) {
    return {
      kind: "returning",
      userId: user._id,
      userSet: { [`verified.${key}`]: true, ...(person.email ? { [`signin.${provider}.email`]: person.email } : {}) },
      session: { userId: user._id, phone: user.phone ?? null, phoneVerified: Boolean(user.phone && user.verified?.phone), verified: proved(user) },
    };
  }
  if (me && me.signin?.[provider]?.id) {
    return {
      kind: "new",
      switched: true,
      session: {
        userId: null, phone: null, phoneVerified: false,
        verified: { gmail: false, facebook: false, [key]: true },
        signin: { [provider]: link },
      },
    };
  }
  if (me) {
    return {
      kind: "attach",
      userId: me._id,
      userSet: { [`signin.${provider}`]: link, [`verified.${key}`]: true },
      session: { verified: proved(me) },
    };
  }
  return { kind: "new", session: { verified: proved(session), signin: { ...(session?.signin || {}), [provider]: link } } };
}
