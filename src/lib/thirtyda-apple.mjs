/**
 * 30+DA Sign in with Apple (owner 2026-10-14) — on the iPhone app only. Apple's App Review asks for it (Guideline 4.8:
 * the app offers Google / Facebook / TikTok) and asks that deleting the account also revokes Apple's token (5.1.1(v)).
 * Server side, no SDK, no new dependency: Node's own crypto (RS256 verify with a JWK, ES256 sign).
 *
 * The flow (the routes are in src/lib/thirtyda-app.mjs; the button in src/thirtyda-app/screens/create-profile.js and
 * src/thirtyda-app/shell.js):
 *   GET  /30da/api/auth/apple/nonce → { nonce }: 32 random bytes (64 hex). Only its SHA-256 is stored (thirtyda_apple_nonces,
 *        10 minutes, TTL index, single use) with the SHA-256 of a BINDER — 32 random bytes in an HttpOnly cookie of this
 *        web view (thirtyda_apple, Path=/30da/api/auth/apple) — so the nonce counts only in the web view that asked for it.
 *   the app  ThirtyDaShell.signInWithApple({ nonce: sha256hex(nonce), state }) — Apple writes that hash into the token.
 *   POST /30da/api/auth/apple { identityToken, authorizationCode?, nonce, givenName?, familyName?, email?, to? }:
 *        the nonce is used up (same binder), then the identity token is checked: RS256 against Apple's keys
 *        (https://appleid.apple.com/auth/keys, kept 6 hours, fetched again once for a key id it does not know), iss
 *        https://appleid.apple.com, aud sg.ggmt.thirtyda, not expired (60 s of clock skew), token.nonce = sha256(nonce).
 *        sub = the person's Apple id. The email (often an @privaterelay.appleid.com address) comes from the token; the name
 *        only from the app, and only the first time — kept when given. Then the same path as Google (planSignin /
 *        completeSignin): an existing profile with this Apple id signs in, to=me attaches, else Create profile.
 *   With the admin's key saved (the Code page, tower 10: Team ID, Key ID, the .p8 private key — sealed), the app's
 *        authorizationCode is exchanged at https://appleid.apple.com/auth/token with an ES256 client secret (5 minutes)
 *        and the refresh_token is kept SEALED on the profile (users.appleRefresh). Without the key the sign-in works the
 *        same; there is just no token to revoke later.
 *   "Delete my account" (src/lib/thirtyda-delete.mjs): a sealed token + the key → POST https://appleid.apple.com/auth/revoke,
 *        best effort (5 s), never in the way of the delete.
 * Never a token, the code, the key or the secret in a log, an answer or the audit.
 *
 * Pure apart from the `d` (Mongo Db) and `fetchImpl` handed in, so the unit tests run without a database or network.
 */

import crypto from "node:crypto";
import { readFields, sealSecret, openSecret, settingsKey } from "./thirtyda-settings.mjs";
import { outboundFetch } from "./thirtyda-test-fetch.mjs";

export const APPLE = Object.freeze({
  issuer: "https://appleid.apple.com",
  keysUrl: "https://appleid.apple.com/auth/keys",
  tokenUrl: "https://appleid.apple.com/auth/token",
  revokeUrl: "https://appleid.apple.com/auth/revoke",
  /** The iPhone app's bundle id: the identity token's audience and the client_id. Fixed: never taken from a request. */
  bundleId: "sg.ggmt.thirtyda",
  /** The owner's Apple developer team (the Code page's Team ID box starts with it). */
  teamId: "4KX4774V2U",
});

export const KEYS_TTL_MS = 6 * 3600e3; // Apple's public keys are kept 6 hours
const KEYS_REFETCH_MS = 60e3; // a key id we do not know: fetched again, at most once a minute
export const SKEW_S = 60; // clock skew allowed on exp / iat
export const CLIENT_SECRET_S = 300; // the ES256 client secret lives 5 minutes
const TIMEOUT_MS = 10_000;
export const REVOKE_TIMEOUT_MS = 5_000;
const TOKEN_MAX = 8192;
const HEX64 = /^[a-f0-9]{64}$/;
const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
export const nonceHash = sha256;

// ---------------------------------------------------------------- the admin's key (Code page, tower 10)

const ID10 = /^[A-Z0-9]{10}$/;

/**
 * The .p8 file's text → its base64 body (one line, no armour, no spaces), or null when it is not an Apple private key
 * (PKCS #8, EC P-256). Kept like this so the Code page can show its last 4 characters (the armour's would all be "-").
 */
export function normalizeP8(text) {
  const body = String(text ?? "")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "").replace(/-----END PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  if (body.length < 100 || body.length > 600 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return null;
  try {
    const key = crypto.createPrivateKey({ key: Buffer.from(body, "base64"), format: "der", type: "pkcs8" });
    return key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1" ? body : null;
  } catch {
    return null;
  }
}

const p8Key = (body) => crypto.createPrivateKey({ key: Buffer.from(String(body), "base64"), format: "der", type: "pkcs8" });

/**
 * Check what the admin typed (Team ID, Key ID, the private key). The key left empty keeps the saved one (`current`).
 * → { ok:true, values: { teamId, keyId, privateKey } } | { ok:false, field, error } (plain words).
 */
export function checkAppleFields(input = {}, current = null) {
  const teamId = String(input?.teamId ?? "").trim().toUpperCase();
  const keyId = String(input?.keyId ?? "").trim().toUpperCase();
  let raw = String(input?.privateKey ?? "").trim();
  if (!teamId) return { ok: false, field: "teamId", error: "Write the Team ID first." };
  if (!ID10.test(teamId)) return { ok: false, field: "teamId", error: "A Team ID is 10 letters and digits (yours: 4KX4774V2U). Apple shows it at the top right of the developer portal." };
  if (!keyId) return { ok: false, field: "keyId", error: "Write the Key ID first." };
  if (!ID10.test(keyId)) return { ok: false, field: "keyId", error: "A Key ID is 10 letters and digits. Apple shows it on the key's page (Keys → your key)." };
  if (!raw && current?.privateKey) raw = current.privateKey;
  if (!raw) return { ok: false, field: "privateKey", error: "Paste the private key (the .p8 file) first." };
  const privateKey = normalizeP8(raw);
  if (!privateKey) {
    return { ok: false, field: "privateKey", error: "That is not an Apple private key. Open the .p8 file you downloaded in a text editor and paste all of it, from -----BEGIN PRIVATE KEY----- to -----END PRIVATE KEY-----." };
  }
  return { ok: true, values: { teamId, keyId, privateKey } };
}

/** The admin's saved key as { teamId, keyId, privateKey } (checked), or null: not saved, not readable, or malformed. */
export async function appleKeys(d) {
  if (!d) return null;
  const f = await readFields(d, "apple");
  const c = f ? checkAppleFields(f) : null;
  return c?.ok ? c.values : null;
}

const b64url = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");

/**
 * The client secret Apple asks for at /auth/token and /auth/revoke: a JWT signed ES256 with the .p8 key —
 * header { alg: ES256, kid: Key ID }, claims { iss: Team ID, iat, exp: iat + 5 minutes, aud: https://appleid.apple.com,
 * sub: the bundle id }. The signature is the raw r‖s (64 bytes), as JWS wants.
 */
export function appleClientSecret(keys, { now = Date.now() } = {}) {
  const iat = Math.floor(now / 1000);
  const head = b64url({ alg: "ES256", kid: keys.keyId, typ: "JWT" });
  const body = b64url({ iss: keys.teamId, iat, exp: iat + CLIENT_SECRET_S, aud: APPLE.issuer, sub: APPLE.bundleId });
  const sig = crypto.sign("sha256", Buffer.from(`${head}.${body}`), { key: p8Key(keys.privateKey), dsaEncoding: "ieee-p1363" });
  return `${head}.${body}.${sig.toString("base64url")}`;
}

// ---------------------------------------------------------------- the nonce (single use, this web view only)

export const APPLE_NONCES = "thirtyda_apple_nonces";
export const NONCE_TTL_MS = 10 * 60e3;
export const NONCE_COOKIE = "thirtyda_apple";

/** A fresh binder for the web view's cookie: 32 random bytes (64 hex); only its SHA-256 is stored. */
export const newAppleBinder = () => crypto.randomBytes(32).toString("hex");

/** A fresh raw nonce (64 hex) for this web view: only its SHA-256 is stored, with the binder's SHA-256. → the raw nonce. */
export async function createAppleNonce(d, binder, { now = Date.now() } = {}) {
  if (!HEX64.test(String(binder ?? ""))) throw new Error("No binder.");
  const nonce = crypto.randomBytes(32).toString("hex");
  await d.collection(APPLE_NONCES).insertOne({
    _id: sha256(nonce), binder: sha256(binder), created: new Date(now), expires: new Date(now + NONCE_TTL_MS),
  });
  return nonce;
}

/**
 * Use up the nonce that came back: deleted on first sight (single use, atomic), whatever happens next. → true only when
 * it was stored, has not expired, and `binder` (this web view's cookie) is the one it was made for (timing-safe).
 */
export async function takeAppleNonce(d, nonce, binder, now = Date.now()) {
  if (!HEX64.test(String(nonce ?? ""))) return false;
  const rec = await d.collection(APPLE_NONCES).findOneAndDelete({ _id: sha256(nonce) });
  if (!rec) return false;
  const bound = HEX64.test(String(binder ?? "")) && HEX64.test(String(rec.binder ?? ""))
    && crypto.timingSafeEqual(Buffer.from(sha256(binder), "hex"), Buffer.from(String(rec.binder), "hex"));
  return bound && new Date(rec.expires).getTime() > now;
}

const secureOn = (req) => {
  const host = String(req?.headers?.["x-forwarded-host"] || req?.headers?.host || "").split(",")[0].trim().toLowerCase()
    .replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return !(host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost"));
};

/** The binder cookie (Max-Age 0 clears it): HttpOnly, SameSite=Lax, Secure on https, only for /30da/api/auth/apple*. */
export function appleNonceCookie(req, binder, maxAgeS = NONCE_TTL_MS / 1000) {
  return `${NONCE_COOKIE}=${binder}; HttpOnly; SameSite=Lax; Path=/30da/api/auth/apple; Max-Age=${maxAgeS}${secureOn(req) ? "; Secure" : ""}`;
}

/** The binder this web view carries, or null. */
export function readAppleNonceCookie(req) {
  return String(req?.headers?.cookie || "").match(new RegExp(`(?:^|;\\s*)${NONCE_COOKIE}=([a-f0-9]{64})(?=;|\\s*$)`))?.[1] ?? null;
}

// ---------------------------------------------------------------- Apple's public keys (JWKS)

/** A cache of Apple's keys: { at, tried, keys: Map(kid → KeyObject) }. One per process; the tests make their own. */
export const appleKeyCache = () => ({ at: 0, tried: 0, keys: new Map() });
const defaultCache = appleKeyCache();
export const clearAppleKeyCache = (cache = defaultCache) => Object.assign(cache, appleKeyCache());

/** Apple's JWKS → Map(kid → KeyObject): RSA keys (2048 bits or more) meant for RS256 signatures only. */
export function jwksKeys(body) {
  const out = new Map();
  for (const jwk of Array.isArray(body?.keys) ? body.keys : []) {
    if (jwk?.kty !== "RSA" || typeof jwk.kid !== "string" || !jwk.kid || typeof jwk.n !== "string" || !jwk.n || typeof jwk.e !== "string" || !jwk.e) continue;
    if (jwk.alg != null && jwk.alg !== "RS256") continue;
    if (jwk.use != null && jwk.use !== "sig") continue;
    try {
      const key = crypto.createPublicKey({ key: { kty: "RSA", n: jwk.n, e: jwk.e }, format: "jwk" });
      if ((key.asymmetricKeyDetails?.modulusLength ?? 0) >= 2048) out.set(jwk.kid, key); // never a weak key
    } catch { /* a key Node cannot read: skipped */ }
  }
  return out;
}

async function fetchKeys(cache, fetchImpl, now, timeoutMs) {
  cache.tried = now;
  const res = await fetchImpl(APPLE.keysUrl, { method: "GET", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  if (res.status < 200 || res.status >= 300) throw new Error(`Apple's keys: HTTP ${res.status}`);
  const keys = jwksKeys(await res.json());
  if (!keys.size) throw new Error("Apple's keys: none");
  Object.assign(cache, { at: now, keys });
}

/**
 * The public key for `kid`: from the cache while it is fresh (6 hours); else fetched. A kid the cache does not know →
 * fetched again once (Apple rotates keys), at most once a minute. Apple out of reach: the keys we had still count.
 * → KeyObject | null (unknown) — throws { code: 'keys_unavailable' } when there are no keys at all.
 */
export async function appleKey(kid, { fetchImpl = outboundFetch(), now = Date.now(), cache = defaultCache, timeoutMs = TIMEOUT_MS } = {}) {
  const fresh = cache.keys.size && now - cache.at < KEYS_TTL_MS;
  if (fresh && cache.keys.has(kid)) return cache.keys.get(kid);
  const mayFetch = !fresh || now - cache.tried >= KEYS_REFETCH_MS;
  if (mayFetch) {
    try {
      await fetchKeys(cache, fetchImpl, now, timeoutMs);
    } catch (err) {
      if (!cache.keys.size) throw Object.assign(new Error("Apple's keys are out of reach."), { code: "keys_unavailable", cause: err });
    }
  }
  return cache.keys.get(kid) ?? null;
}

// ---------------------------------------------------------------- the identity token

function decodePart(part) {
  try {
    const v = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

const cleanText = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
function cleanEmail(v) {
  const e = String(v ?? "").trim().toLowerCase();
  return e.length <= 254 && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(e) ? e : null;
}
const yes = (v) => v === true || v === "true";
const SUB_RE = /^[A-Za-z0-9._-]{1,255}$/;

/**
 * Why a token was refused (plain reasons, never the token):
 *   malformed     not a JWT, or not RS256
 *   unknown_key   signed with a key Apple does not list
 *   signature     the signature does not match
 *   issuer | audience   not Apple's, or not for this app
 *   expired       past exp (60 s of skew), or issued in the future
 *   nonce         not the nonce this web view asked for
 *   no_user       no usable sub
 *   keys_unavailable   Apple's keys could not be fetched (and none were kept)
 */
export const TOKEN_REASONS = ["malformed", "unknown_key", "signature", "issuer", "audience", "expired", "nonce", "no_user", "keys_unavailable"];

/**
 * Check an identity token from Sign in with Apple. `nonce`: the SHA-256 hex the app passed to Apple (sha256 of the raw
 * nonce the server handed out). → { ok:true, claims } | { ok:false, reason }.
 */
export async function verifyAppleToken(token, { nonce, fetchImpl = outboundFetch(), now = Date.now(), cache = defaultCache, audience = APPLE.bundleId } = {}) {
  const raw = String(token ?? "");
  const parts = raw.split(".");
  if (raw.length > TOKEN_MAX || parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return { ok: false, reason: "malformed" };
  const header = decodePart(parts[0]);
  const claims = decodePart(parts[1]);
  if (!header || !claims || header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) return { ok: false, reason: "malformed" };
  let key;
  try {
    key = await appleKey(header.kid, { fetchImpl, now, cache });
  } catch (err) {
    return { ok: false, reason: err?.code === "keys_unavailable" ? "keys_unavailable" : "malformed" };
  }
  if (!key) return { ok: false, reason: "unknown_key" };
  const good = crypto.verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], "base64url"));
  if (!good) return { ok: false, reason: "signature" };
  if (claims.iss !== APPLE.issuer) return { ok: false, reason: "issuer" };
  const aud = Array.isArray(claims.aud) ? (claims.aud.length === 1 ? claims.aud[0] : null) : claims.aud;
  if (aud !== audience) return { ok: false, reason: "audience" };
  const s = Math.floor(now / 1000);
  if (!Number.isFinite(claims.exp) || claims.exp + SKEW_S <= s) return { ok: false, reason: "expired" };
  if (Number.isFinite(claims.iat) && claims.iat - SKEW_S > s) return { ok: false, reason: "expired" };
  const want = String(nonce ?? "");
  const got = typeof claims.nonce === "string" ? claims.nonce : "";
  if (!HEX64.test(want) || got.length !== want.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) return { ok: false, reason: "nonce" };
  if (typeof claims.sub !== "string" || !SUB_RE.test(claims.sub)) return { ok: false, reason: "no_user" };
  return { ok: true, claims };
}

/**
 * The token's claims (+ the name the app sent, given only the first time) → { provider:'apple', id: sub, email, name,
 * privateEmail }. The email only when Apple says it is verified (a private relay address counts: it reaches the person).
 */
export function applePerson(claims, { givenName = null, familyName = null } = {}) {
  const email = yes(claims?.email_verified) ? cleanEmail(claims?.email) : null;
  const name = cleanText([cleanText(givenName, 50), cleanText(familyName, 50)].filter(Boolean).join(" "), 100) || null;
  return { provider: "apple", id: String(claims.sub), email, name, privateEmail: Boolean(email && yes(claims?.is_private_email)) };
}

// ---------------------------------------------------------------- the refresh token (only with the admin's key)

const form = (fields) => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
  body: new URLSearchParams(fields).toString(),
});

/** POST /auth/token: the app's authorization code → tokens (client_id = the bundle id; no redirect_uri for an app). */
export function appleTokenRequest(keys, code, { now = Date.now() } = {}) {
  return {
    url: APPLE.tokenUrl,
    init: form({ client_id: APPLE.bundleId, client_secret: appleClientSecret(keys, { now }), code: String(code), grant_type: "authorization_code" }),
  };
}

/** POST /auth/revoke: ends a refresh token (and the person's Sign in with Apple link to 30+DA). */
export function appleRevokeRequest(keys, token, { now = Date.now() } = {}) {
  return {
    url: APPLE.revokeUrl,
    init: form({ client_id: APPLE.bundleId, client_secret: appleClientSecret(keys, { now }), token: String(token), token_type_hint: "refresh_token" }),
  };
}

/**
 * Apple's answer → a reason: bad_key (invalid_client: the Key ID, the Team ID, the key, or Sign in with Apple not set up
 * for sg.ggmt.thirtyda), bad_code (invalid_grant: the code is used, too old, or made up), provider_error (their side),
 * other.
 */
export function classifyAppleError(error, status = 400) {
  const e = String(error ?? "").toLowerCase();
  if (e === "invalid_client" || e === "unauthorized_client" || status === 401) return "bad_key";
  if (e === "invalid_grant") return "bad_code";
  if (status === 429 || status >= 500) return "provider_error";
  return "other";
}
const appleSaid = (body) => (typeof body?.error === "string" ? body.error.replace(/[^\w.-]/g, "").slice(0, 60) : "");
const isTimeout = (err) => err?.name === "TimeoutError" || err?.name === "AbortError";

async function postApple(fetchImpl, { url, init }, timeoutMs) {
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  let body = {};
  try {
    const j = await res.json();
    if (j && typeof j === "object") body = j;
  } catch (err) {
    if (isTimeout(err)) throw err;
  }
  return { status: res.status, body };
}

/**
 * The app's authorization code → Apple's refresh token, with the admin's key. The id_token Apple sends back must be for
 * the same person (`sub`): it came straight from Apple, so its claims are read, not verified again.
 * → { ok:true, refreshToken } | { ok:false, reason, detail } (detail: only Apple's own error code). Never logged.
 */
export async function exchangeAppleCode(keys, code, { sub, fetchImpl = outboundFetch(), now = Date.now(), timeoutMs = TIMEOUT_MS } = {}) {
  if (!keys || typeof code !== "string" || !code || code.length > 2048) return { ok: false, reason: "bad_code", detail: null };
  try {
    const r = await postApple(fetchImpl, appleTokenRequest(keys, code, { now }), timeoutMs);
    const refreshToken = typeof r.body.refresh_token === "string" && r.body.refresh_token ? r.body.refresh_token : null;
    if (r.status < 200 || r.status >= 300 || !refreshToken) {
      const said = appleSaid(r.body);
      return { ok: false, reason: classifyAppleError(said, r.status), detail: said || null };
    }
    const idClaims = typeof r.body.id_token === "string" ? decodePart(r.body.id_token.split(".")[1] || "") : null;
    if (sub && idClaims?.sub && idClaims.sub !== sub) return { ok: false, reason: "other", detail: null };
    return { ok: true, refreshToken };
  } catch (err) {
    return { ok: false, reason: isTimeout(err) ? "timeout" : "network", detail: null };
  }
}

/** Revoke one refresh token. → { ok } | { ok:false, reason, detail }. Best effort: never throws. */
export async function revokeAppleToken(keys, token, { fetchImpl = outboundFetch(), now = Date.now(), timeoutMs = REVOKE_TIMEOUT_MS } = {}) {
  try {
    const r = await postApple(fetchImpl, appleRevokeRequest(keys, token, { now }), timeoutMs);
    if (r.status >= 200 && r.status < 300) return { ok: true };
    const said = appleSaid(r.body);
    return { ok: false, reason: classifyAppleError(said, r.status), detail: said || null };
  } catch (err) {
    return { ok: false, reason: isTimeout(err) ? "timeout" : "network", detail: null };
  }
}

/**
 * The Code page's "Try the key": the ES256 client secret and a made-up code at /auth/token. Apple answering invalid_grant
 * means it accepted the key and refused only the code — the key works. invalid_client means the key is wrong.
 * → { ok:true } | { ok:false, reason, detail }.
 */
export async function tryAppleKey(keys, { fetchImpl = outboundFetch(), now = Date.now(), timeoutMs = TIMEOUT_MS } = {}) {
  if (!keys) return { ok: false, reason: "no_key", detail: null };
  const code = `c${crypto.randomBytes(16).toString("hex")}.0.try.30da`;
  try {
    const r = await postApple(fetchImpl, appleTokenRequest(keys, code, { now }), timeoutMs);
    const said = appleSaid(r.body);
    if (said === "invalid_grant") return { ok: true };
    if (r.status >= 200 && r.status < 300) return { ok: false, reason: "other", detail: null }; // a made-up code never works
    return { ok: false, reason: classifyAppleError(said, r.status), detail: said || null };
  } catch (err) {
    return { ok: false, reason: isTimeout(err) ? "timeout" : "network", detail: null };
  }
}

// ---------------------------------------------------------------- the sealed refresh token (users.appleRefresh)

/** The sealing name: bound to the person's Apple id, so a sealed token cannot be moved to another account. */
const refreshName = (sub) => `users.appleRefresh:${sub}`;

/** Seal Apple's refresh token for the person `sub` (AES-256-GCM under THIRTYDA_SECRET_KEY). Throws without the key. */
export const sealAppleRefresh = (token, sub, { rawKey } = {}) => sealSecret(String(token), settingsKey(rawKey), refreshName(sub));

/** The plain refresh token, or null (no key, another key, another person, damaged). */
export function openAppleRefresh(box, sub, { rawKey } = {}) {
  try {
    return openSecret(box, settingsKey(rawKey), refreshName(sub));
  } catch {
    return null;
  }
}

/**
 * The sealed token a new profile keeps from its session (Create profile): only one that opens for the Apple id the profile
 * is made with — a token another Apple id left on the session could never be revoked for this one. → the box, or null.
 */
export const appleRefreshFor = (box, sub, { rawKey } = {}) => (box && sub && openAppleRefresh(box, String(sub), { rawKey }) ? box : null);

/**
 * What "Delete my account" does with a profile's Sign in with Apple (`apple` = { sub, box }: its Apple id and the sealed
 * refresh token). Best effort and quick (5 s): → 'revoked' | 'no_key' (no admin key saved: nothing to sign the request
 * with) | 'unreadable' (the token cannot be opened) | 'failed' (Apple did not take it, or did not answer).
 */
export async function revokeAppleFor(d, apple, { fetchImpl = outboundFetch(), now = Date.now(), rawKey } = {}) {
  try {
    const keys = await appleKeys(d);
    if (!keys) return "no_key";
    const token = openAppleRefresh(apple?.box, apple?.sub, { rawKey });
    if (!token) return "unreadable";
    const r = await revokeAppleToken(keys, token, { fetchImpl, now });
    if (!r.ok) console.warn(`[30da apple] revoke did not work: ${r.reason}${r.detail ? ` (${r.detail})` : ""}`);
    return r.ok ? "revoked" : "failed";
  } catch {
    return "failed";
  }
}

/** The Apple link kept for a delete: { sub, box } from the profile (or from what a started delete wrote down), or null. */
export function appleRevokeOf(user) {
  const was = user?.deleting?.apple;
  if (was?.sub && was?.box) return { sub: String(was.sub), box: was.box };
  const sub = user?.signin?.apple?.id;
  return sub && user?.appleRefresh ? { sub: String(sub), box: user.appleRefresh } : null;
}
