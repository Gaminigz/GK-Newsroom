// Run: npm run 30da:test (or node --test src/lib/thirtyda-apple.test.mjs)
// Sign in with Apple (owner 2026-10-14; src/lib/thirtyda-apple.mjs): the identity token checked against Apple's keys (a
// generated RSA key + a fake JWKS answered by the dev-only test fetch), the nonce (single use, this web view only), the
// ES256 client secret, the token exchange / revoke / "Try the key", the sealed refresh token, what a good sign-in writes,
// the routes in every guard list, and the button only inside the iPhone app. No database, no network, no real key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  APPLE, KEYS_TTL_MS, SKEW_S, CLIENT_SECRET_S, APPLE_NONCES, NONCE_TTL_MS, NONCE_COOKIE, normalizeP8, checkAppleFields, appleKeys,
  appleClientSecret, newAppleBinder, createAppleNonce, takeAppleNonce, appleNonceCookie, readAppleNonceCookie, appleKeyCache,
  jwksKeys, appleKey, verifyAppleToken, applePerson, appleTokenRequest, appleRevokeRequest, classifyAppleError, exchangeAppleCode,
  revokeAppleToken, tryAppleKey, sealAppleRefresh, openAppleRefresh, appleRefreshFor, revokeAppleFor, appleRevokeOf, nonceHash, TOKEN_REASONS,
} from './thirtyda-apple.mjs';
import { saveFields, clearSettingsCache, FIELD_SETTINGS, SETTINGS_COLLECTION } from './thirtyda-settings.mjs';
import { makeTestFetch, redactCall, TEST_FETCH_COLLECTION } from './thirtyda-test-fetch.mjs';
import { planSignin, withSigninExtra, VERIFIED_KEY, ACCOUNT_PROVIDERS, SIGNIN_PROVIDERS, KEEP_NAME } from './thirtyda-signin.mjs';
import { whileLocked } from './thirtyda-pin.mjs';
import { talksToSomeone, signinsOf, canTalk, neverVerifiedFilter } from './thirtyda-verify.mjs';
import { API_ROUTES, meView } from './thirtyda-app.mjs';
import { handlesOf, claimUpdate, COVERAGE, NOT_COLLECTIONS } from './thirtyda-delete.mjs';

// ---------------------------------------------------------------- fixtures

const NOW = Date.parse('2026-10-14T08:00:00Z');
const S = Math.floor(NOW / 1000);
const SUB = '001234.fake0a1b2c3d4e5f60718293a4b5c6d7e8f.0800';
const KID = 'FAKEkid01';

/** An RSA key pair standing in for one of Apple's, and its JWK as Apple publishes it. */
function rsaKey(kid = KID) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  return { kid, privateKey, jwk: { kty: 'RSA', kid, use: 'sig', alg: 'RS256', n: jwk.n, e: jwk.e } };
}
const APPLE_KEY = rsaKey();

const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
/** A signed identity token (RS256) with Apple's usual claims, changed by `over`. */
function idToken(over = {}, { key = APPLE_KEY, header = {} } = {}) {
  const head = b64({ kid: key.kid, alg: 'RS256', ...header });
  const claims = {
    iss: APPLE.issuer, aud: APPLE.bundleId, exp: S + 600, iat: S, sub: SUB, c_hash: 'x', email: 'nary.fake@privaterelay.appleid.com',
    email_verified: 'true', is_private_email: 'true', auth_time: S, nonce_supported: true, ...over,
  };
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${b64(claims)}`), key.privateKey).toString('base64url');
  return `${head}.${b64(claims)}.${sig}`;
}

/** The few Mongo calls the nonces, the settings and the test fetch make, in memory. */
function fakeDb() {
  const cols = new Map();
  return {
    cols,
    collection(name) {
      if (!cols.has(name)) {
        const docs = new Map();
        cols.set(name, {
          docs,
          async insertOne(doc) { if (docs.has(doc._id)) throw Object.assign(new Error('dup'), { code: 11000 }); docs.set(doc._id, structuredClone(doc)); return { acknowledged: true }; },
          async findOne(q) { const x = docs.get(q._id); return x ? structuredClone(x) : null; },
          async findOneAndDelete(q) { const x = docs.get(q._id); docs.delete(q._id); return x ? structuredClone(x) : null; },
          async replaceOne(q, doc, opts = {}) { if (!docs.has(q._id) && !opts.upsert) return { matchedCount: 0 }; docs.set(q._id, structuredClone(doc)); return { matchedCount: 1 }; },
          async deleteOne(q) { return { deletedCount: docs.delete(q._id) ? 1 : 0 }; },
          async updateOne(q, u) {
            const x = docs.get(q._id);
            if (!x || (q.box?.$exists && !x.box)) return { matchedCount: 0 };
            Object.assign(x, u.$set || {});
            for (const [k, v] of Object.entries(u.$push || {})) x[k] = [...(x[k] || []), ...(v.$each || [v])].slice(v.$slice ?? -Infinity);
            return { matchedCount: 1 };
          },
        });
      }
      return cols.get(name);
    },
  };
}

/** The dev-only test fetch (THIRTYDA_TEST_FETCH) answering Apple from stored replies; anything else must not go out. */
function appleStandIn(d, replies = {}) {
  const KEYS = {
    keys: `GET ${APPLE.keysUrl}`, token: `POST ${APPLE.tokenUrl}`, revoke: `POST ${APPLE.revokeUrl}`,
  };
  const col = d.collection(TEST_FETCH_COLLECTION);
  const set = async (which, reply) => col.replaceOne({ _id: KEYS[which] }, { _id: KEYS[which], reply, calls: [] }, { upsert: true });
  const calls = async (which) => (await col.findOne({ _id: KEYS[which] }))?.calls ?? [];
  const fetchImpl = makeTestFetch(async () => d, async (url) => { throw new Error(`no network in the tests: ${url}`); });
  return { set, calls, fetchImpl, ready: Promise.all(Object.entries(replies).map(([k, r]) => set(k, r))) };
}
const jwks = (...keys) => ({ status: 200, json: { keys: keys.map((k) => k.jwk) } });

async function withKey(fn) {
  const prev = process.env.THIRTYDA_SECRET_KEY;
  process.env.THIRTYDA_SECRET_KEY = crypto.randomBytes(32).toString('hex');
  clearSettingsCache();
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.THIRTYDA_SECRET_KEY; else process.env.THIRTYDA_SECRET_KEY = prev;
    clearSettingsCache();
  }
}

/** An Apple-style .p8 (PKCS #8, EC P-256), its armoured text and the public key that checks its signatures. */
function p8() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pem = privateKey.export({ format: 'pem', type: 'pkcs8' });
  const body = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  return { pem, body, publicKey };
}
const P8 = p8();
const KEYS = { teamId: APPLE.teamId, keyId: 'ABC123DEFG', privateKey: P8.body };
const NONCE = 'a'.repeat(64);
const HASHED = nonceHash(NONCE);

// ---------------------------------------------------------------- the identity token

test('a good identity token: RS256 with Apple\'s key (fetched once, kept 6 h), iss, aud sg.ggmt.thirtyda, exp, the nonce', async () => {
  const d = fakeDb();
  const apple = appleStandIn(d, { keys: jwks(APPLE_KEY) });
  await apple.ready;
  const cache = appleKeyCache();
  const r = await verifyAppleToken(idToken({ nonce: HASHED }), { nonce: HASHED, fetchImpl: apple.fetchImpl, now: NOW, cache });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.claims.sub, SUB);
  assert.equal((await apple.calls('keys')).length, 1);
  // Kept: a second token in the same 6 hours fetches nothing.
  const again = await verifyAppleToken(idToken({ nonce: HASHED, exp: S + KEYS_TTL_MS / 1000 + 600 }), { nonce: HASHED, fetchImpl: apple.fetchImpl, now: NOW + KEYS_TTL_MS - 1, cache });
  assert.equal(again.ok, true);
  assert.equal((await apple.calls('keys')).length, 1, 'the keys are kept 6 hours');
  await verifyAppleToken(idToken({ nonce: HASHED, exp: S + KEYS_TTL_MS / 1000 + 600 }), { nonce: HASHED, fetchImpl: apple.fetchImpl, now: NOW + KEYS_TTL_MS + 1, cache });
  assert.equal((await apple.calls('keys')).length, 2, 'after 6 hours they are fetched again');
  // Who signed in: the Apple id, the verified (relay) email, the name only from the app (the first time).
  assert.deepEqual(applePerson(r.claims, { givenName: ' Nary ', familyName: 'Sok‮' }),
    { provider: 'apple', id: SUB, email: 'nary.fake@privaterelay.appleid.com', name: 'Nary Sok', privateEmail: true });
  assert.deepEqual(applePerson({ sub: SUB, email: 'x@y.co', email_verified: false }), { provider: 'apple', id: SUB, email: null, name: null, privateEmail: false },
    'an email Apple does not call verified is not kept');
  assert.equal(applePerson({ sub: SUB }, { givenName: 'A'.repeat(300) }).name.length, 50);
});

test('refused tokens: wrong audience, wrong issuer, expired (60 s of skew), issued in the future, another nonce, tampered, not RS256', async () => {
  const d = fakeDb();
  const apple = appleStandIn(d, { keys: jwks(APPLE_KEY) });
  await apple.ready;
  const cache = appleKeyCache();
  const check = (token, nonce = HASHED, now = NOW) => verifyAppleToken(token, { nonce, fetchImpl: apple.fetchImpl, now, cache });
  assert.equal((await check(idToken({ nonce: HASHED, aud: 'com.someone.else' }))).reason, 'audience');
  assert.equal((await check(idToken({ nonce: HASHED, aud: [APPLE.bundleId, 'com.other'] }))).reason, 'audience', 'only this app');
  assert.equal((await check(idToken({ nonce: HASHED, aud: [APPLE.bundleId] }))).ok, true, 'a one-item audience list is fine');
  assert.equal((await check(idToken({ nonce: HASHED, iss: 'https://appleid.apple.com.evil.example' }))).reason, 'issuer');
  assert.equal((await check(idToken({ nonce: HASHED, exp: S - SKEW_S - 1 }))).reason, 'expired');
  assert.equal((await check(idToken({ nonce: HASHED, exp: S - SKEW_S + 5 }))).ok, true, 'inside the 60 s of skew');
  assert.equal((await check(idToken({ nonce: HASHED, exp: undefined }))).reason, 'expired', 'no exp: refused');
  assert.equal((await check(idToken({ nonce: HASHED, iat: S + SKEW_S + 30 }))).reason, 'expired', 'issued in the future');
  assert.equal((await check(idToken({ nonce: HASHED }), nonceHash('b'.repeat(64)))).reason, 'nonce', 'another nonce');
  assert.equal((await check(idToken({ nonce: NONCE }))).reason, 'nonce', 'the raw nonce in the token: not what the app must pass');
  assert.equal((await check(idToken({}))).reason, 'nonce', 'no nonce at all');
  assert.equal((await check(idToken({ nonce: HASHED, sub: '' }))).reason, 'no_user');
  const good = idToken({ nonce: HASHED });
  const [h, , sig] = good.split('.');
  assert.equal((await check(`${h}.${b64({ iss: APPLE.issuer, aud: APPLE.bundleId, exp: S + 600, sub: 'someone-else', nonce: HASHED })}.${sig}`)).reason, 'signature', 'claims changed after signing');
  assert.equal((await check(idToken({ nonce: HASHED }, { key: { ...rsaKey(KID), kid: KID } }))).reason, 'signature', 'signed with another key under Apple\'s kid');
  assert.equal((await check(idToken({ nonce: HASHED }, { header: { alg: 'HS256' } }))).reason, 'malformed');
  assert.equal((await check(`${b64({ alg: 'none', kid: KID })}.${b64({ sub: SUB, nonce: HASHED })}.`)).reason, 'malformed');
  for (const junk of ['', 'a.b', 'a.b.c.d', `${'x'.repeat(9000)}.y.z`, null, undefined]) assert.equal((await check(junk)).reason, 'malformed', String(junk).slice(0, 20));
  assert.ok(TOKEN_REASONS.includes('nonce') && TOKEN_REASONS.includes('unknown_key'));
});

test('an unknown key id: Apple\'s keys fetched again once (a rotation), at most once a minute; Apple down keeps the keys we had', async () => {
  const d = fakeDb();
  const apple = appleStandIn(d, { keys: jwks(APPLE_KEY) });
  await apple.ready;
  const cache = appleKeyCache();
  const NEW = rsaKey('FAKEkid02');
  const check = (token, now) => verifyAppleToken(token, { nonce: HASHED, fetchImpl: apple.fetchImpl, now, cache });
  assert.equal((await check(idToken({ nonce: HASHED }), NOW)).ok, true);
  assert.equal((await apple.calls('keys')).length, 1);
  // Apple rotates: the new kid is unknown to the cache → fetched again (once) → found.
  await apple.set('keys', jwks(APPLE_KEY, NEW));
  const later = NOW + 5 * 60e3;
  assert.equal((await check(idToken({ nonce: HASHED, exp: S + 900 }, { key: NEW }), later)).ok, true, 'a rotated key is fetched again');
  assert.equal((await apple.calls('keys')).length, 1, 'that was the stand-in\'s first call since it was set again');
  // A made-up kid: one fetch at most a minute, then refused as unknown.
  const BOGUS = rsaKey('nobody-kid');
  assert.equal((await check(idToken({ nonce: HASHED, exp: S + 900 }, { key: BOGUS }), later + 1000)).reason, 'unknown_key');
  assert.equal((await check(idToken({ nonce: HASHED, exp: S + 900 }, { key: BOGUS }), later + 2000)).reason, 'unknown_key');
  assert.equal((await apple.calls('keys')).length, 1, 'no fetch for every made-up kid (once a minute at most)');
  assert.equal((await check(idToken({ nonce: HASHED, exp: S + 900 }, { key: BOGUS }), later + 61e3)).reason, 'unknown_key');
  assert.equal((await apple.calls('keys')).length, 2, 'a minute later: one more fetch');
  // Apple down: the keys we had still count; with none at all → keys_unavailable.
  await apple.set('keys', { status: 503, json: {} });
  assert.equal((await check(idToken({ nonce: HASHED, exp: S + 99999 }), NOW + KEYS_TTL_MS + 10)).ok, true, 'stale keys beat no keys');
  const empty = appleKeyCache();
  const r = await verifyAppleToken(idToken({ nonce: HASHED }), { nonce: HASHED, fetchImpl: apple.fetchImpl, now: NOW, cache: empty });
  assert.equal(r.reason, 'keys_unavailable');
  await apple.set('keys', { status: 200, json: {}, fail: 'network' });
  assert.equal((await verifyAppleToken(idToken({ nonce: HASHED }), { nonce: HASHED, fetchImpl: apple.fetchImpl, now: NOW, cache: appleKeyCache() })).reason, 'keys_unavailable');
});

test('Apple\'s JWKS: only RSA signing keys for RS256', () => {
  const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'jwk' });
  const weak = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({ format: 'jwk' });
  const keys = jwksKeys({ keys: [APPLE_KEY.jwk, { ...APPLE_KEY.jwk, kid: 'enc', use: 'enc' }, { ...APPLE_KEY.jwk, kid: 'ps', alg: 'PS256' }, { ...ec, kid: 'ec' },
    { kty: 'RSA', kid: 'bad', n: '', e: '' }, { ...weak, kid: 'weak', alg: 'RS256' }, null] });
  assert.deepEqual([...keys.keys()], [KID]);
  assert.equal(jwksKeys(null).size, 0);
  assert.equal(jwksKeys({ keys: 'x' }).size, 0);
});

// ---------------------------------------------------------------- the nonce

test('the nonce: only its SHA-256 kept with the binder\'s, single use, 10 minutes, only in the web view that asked', async () => {
  const d = fakeDb();
  const binder = newAppleBinder();
  assert.match(binder, /^[a-f0-9]{64}$/);
  const nonce = await createAppleNonce(d, binder, { now: NOW });
  assert.match(nonce, /^[a-f0-9]{64}$/);
  const stored = [...d.collection(APPLE_NONCES).docs.values()];
  assert.equal(stored.length, 1);
  assert.equal(stored[0]._id, nonceHash(nonce), 'kept by its hash');
  assert.equal(stored[0].binder, nonceHash(binder));
  assert.equal(JSON.stringify(stored).includes(nonce) || JSON.stringify(stored).includes(binder), false, 'never the nonce or the binder itself');
  assert.equal(stored[0].expires.getTime() - NOW, NONCE_TTL_MS);
  assert.equal(await takeAppleNonce(d, nonce, newAppleBinder(), NOW), false, 'another web view');
  assert.equal(await takeAppleNonce(d, nonce, binder, NOW), false, '…and that used it up: a nonce counts once, whatever happened');
  const n2 = await createAppleNonce(d, binder, { now: NOW });
  assert.equal(await takeAppleNonce(d, n2, binder, NOW + 1000), true, 'the right web view, in time');
  assert.equal(await takeAppleNonce(d, n2, binder, NOW + 2000), false, 'reused: refused');
  const n3 = await createAppleNonce(d, binder, { now: NOW });
  assert.equal(await takeAppleNonce(d, n3, binder, NOW + NONCE_TTL_MS + 1), false, 'too late');
  for (const bad of ['', 'x', 'A'.repeat(64), null, undefined]) assert.equal(await takeAppleNonce(d, bad, binder, NOW), false);
  await assert.rejects(createAppleNonce(d, 'not-a-binder'));
});

test('the binder cookie: HttpOnly, SameSite=Lax, only /30da/api/auth/apple, 10 minutes, Secure off this machine; read back', () => {
  const b = newAppleBinder();
  const live = appleNonceCookie({ headers: { host: 'ecom.ggmt.sg' } }, b);
  assert.equal(live, `${NONCE_COOKIE}=${b}; HttpOnly; SameSite=Lax; Path=/30da/api/auth/apple; Max-Age=600; Secure`);
  assert.ok(!appleNonceCookie({ headers: { host: 'localhost:8800' } }, b).includes('Secure'));
  assert.ok(appleNonceCookie({ headers: { host: 'localhost:8800' } }, '', 0).includes('Max-Age=0'));
  assert.equal(readAppleNonceCookie({ headers: { cookie: `thirtyda_s=${'1'.repeat(64)}; ${NONCE_COOKIE}=${b}` } }), b);
  assert.equal(readAppleNonceCookie({ headers: { cookie: `${NONCE_COOKIE}=${b}x` } }), null);
  assert.equal(readAppleNonceCookie({ headers: {} }), null);
  assert.equal(NOT_COLLECTIONS.includes(NONCE_COOKIE), true, 'a cookie, not a collection');
  assert.equal(COVERAGE[APPLE_NONCES], null, 'the nonces hold no person (a delete has nothing to do there)');
});

// ---------------------------------------------------------------- the admin's key

test('the key boxes: Team ID, Key ID (10 letters and digits), the .p8 (EC P-256, armour and line breaks dropped); an empty key keeps the saved one', () => {
  assert.equal(normalizeP8(P8.pem), P8.body);
  assert.equal(normalizeP8(P8.pem.replace(/\n/g, '')), P8.body, 'pasted into a one-line box: the line breaks are gone');
  assert.equal(normalizeP8(`  ${P8.body}  `), P8.body);
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs8' });
  assert.equal(normalizeP8(rsa), null, 'an RSA key is not an Apple key');
  const p384 = crypto.generateKeyPairSync('ec', { namedCurve: 'secp384r1' }).privateKey.export({ format: 'pem', type: 'pkcs8' });
  assert.equal(normalizeP8(p384), null, 'another curve');
  for (const junk of ['', 'hello', 'A'.repeat(200), null]) assert.equal(normalizeP8(junk), null);

  const ok = checkAppleFields({ teamId: ' 4kx4774v2u ', keyId: 'abc123defg', privateKey: P8.pem });
  assert.deepEqual(ok, { ok: true, values: { teamId: '4KX4774V2U', keyId: 'ABC123DEFG', privateKey: P8.body } });
  assert.equal(checkAppleFields({ keyId: 'ABC123DEFG', privateKey: P8.pem }).field, 'teamId');
  assert.equal(checkAppleFields({ teamId: '4KX4774V2', keyId: 'ABC123DEFG', privateKey: P8.pem }).field, 'teamId');
  assert.equal(checkAppleFields({ teamId: '4KX4774V2U', keyId: 'ABC-123', privateKey: P8.pem }).field, 'keyId');
  assert.equal(checkAppleFields({ teamId: '4KX4774V2U', keyId: 'ABC123DEFG' }).field, 'privateKey');
  assert.match(checkAppleFields({ teamId: '4KX4774V2U', keyId: 'ABC123DEFG', privateKey: 'nope' }).error, /\.p8/);
  assert.deepEqual(checkAppleFields({ teamId: '4KX4774V2U', keyId: 'ZZZ999YYYY', privateKey: '' }, KEYS).values.privateKey, P8.body, 'left empty: the saved key');
  assert.deepEqual(Object.keys(FIELD_SETTINGS.apple), ['teamId', 'keyId', 'privateKey']);
});

test('the key is saved sealed and masked (last 4 of the key only); appleKeys reads it back checked', async () => withKey(async () => {
  const d = fakeDb();
  assert.equal(await appleKeys(d), null, 'nothing saved');
  const view = await saveFields(d, 'apple', KEYS);
  assert.deepEqual(view.masks, { privateKey: P8.body.slice(-4) });
  assert.deepEqual(view.fields, { teamId: KEYS.teamId, keyId: KEYS.keyId }, 'the plain boxes come back; the key never does');
  const raw = JSON.stringify([...d.collection(SETTINGS_COLLECTION).docs.values()]);
  assert.equal(raw.includes(P8.body.slice(0, 40)), false, 'the key only sealed');
  assert.deepEqual(await appleKeys(d), KEYS);
}));

test('the ES256 client secret: kid = Key ID, iss = Team ID, sub = the bundle id, aud Apple, 5 minutes; a raw r‖s signature', () => {
  const jwt = appleClientSecret(KEYS, { now: NOW });
  const [h, c, sig] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'ES256', kid: 'ABC123DEFG', typ: 'JWT' });
  assert.deepEqual(JSON.parse(Buffer.from(c, 'base64url')), { iss: '4KX4774V2U', iat: S, exp: S + CLIENT_SECRET_S, aud: 'https://appleid.apple.com', sub: 'sg.ggmt.thirtyda' });
  assert.equal(CLIENT_SECRET_S, 300);
  assert.equal(Buffer.from(sig, 'base64url').length, 64, 'JWS ES256: r‖s, not DER');
  assert.equal(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: P8.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')), true);
  assert.notEqual(appleClientSecret(KEYS, { now: NOW }), jwt, 'ECDSA: a fresh signature each time');
});

// ---------------------------------------------------------------- Apple's token endpoint (only with the key)

test('the requests: a form POST, client_id = the bundle id, the client secret; the revoke names the refresh token', () => {
  const t = appleTokenRequest(KEYS, 'c0de.1.abc', { now: NOW });
  assert.equal(t.url, 'https://appleid.apple.com/auth/token');
  assert.equal(t.init.method, 'POST');
  assert.equal(t.init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  const body = Object.fromEntries(new URLSearchParams(t.init.body));
  assert.deepEqual(Object.keys(body).sort(), ['client_id', 'client_secret', 'code', 'grant_type']);
  assert.equal(body.client_id, 'sg.ggmt.thirtyda');
  assert.equal(body.grant_type, 'authorization_code');
  assert.equal(body.code, 'c0de.1.abc');
  const r = appleRevokeRequest(KEYS, 'r.FAKE-refresh', { now: NOW });
  assert.equal(r.url, 'https://appleid.apple.com/auth/revoke');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(r.init.body)), {
    client_id: 'sg.ggmt.thirtyda', client_secret: Object.fromEntries(new URLSearchParams(r.init.body)).client_secret, token: 'r.FAKE-refresh', token_type_hint: 'refresh_token',
  });
  // The dev-only stand-in notes these calls with the secrets cut to their last 4.
  const seen = redactCall(r.url, r.init);
  assert.equal(seen.body.token, '…resh');
  assert.ok(seen.body.client_secret.startsWith('…') && seen.body.client_secret.length === 5);
  assert.equal(redactCall(t.url, t.init).body.code, '….abc');
});

test('"Try the key": invalid_grant to a made-up code = the key works; invalid_client = a wrong key; Apple\'s trouble is said as such', async () => {
  const d = fakeDb();
  const apple = appleStandIn(d, { token: { status: 400, json: { error: 'invalid_grant', error_description: 'The code has expired or has been revoked.' } } });
  await apple.ready;
  assert.deepEqual(await tryAppleKey(KEYS, { fetchImpl: apple.fetchImpl, now: NOW }), { ok: true });
  const [call] = await apple.calls('token');
  assert.equal(call.body.client_id, 'sg.ggmt.thirtyda');
  assert.match(call.body.code, /^…/, 'the made-up code only as its last 4');
  await apple.set('token', { status: 400, json: { error: 'invalid_client' } });
  assert.deepEqual(await tryAppleKey(KEYS, { fetchImpl: apple.fetchImpl, now: NOW }), { ok: false, reason: 'bad_key', detail: 'invalid_client' });
  await apple.set('token', { status: 503, json: {} });
  assert.equal((await tryAppleKey(KEYS, { fetchImpl: apple.fetchImpl, now: NOW })).reason, 'provider_error');
  await apple.set('token', { status: 200, json: {}, fail: 'network' });
  assert.equal((await tryAppleKey(KEYS, { fetchImpl: apple.fetchImpl, now: NOW })).reason, 'network');
  assert.deepEqual(await tryAppleKey(null), { ok: false, reason: 'no_key', detail: null });
  assert.equal(classifyAppleError('invalid_grant'), 'bad_code');
  assert.equal(classifyAppleError('unauthorized_client'), 'bad_key');
  assert.equal(classifyAppleError('', 429), 'provider_error');
  assert.equal(classifyAppleError('invalid_request'), 'other');
});

test('the code exchange: Apple\'s refresh token for this person only; a used code or a wrong key → none (the sign-in goes on)', async () => {
  const d = fakeDb();
  const idFromApple = `${b64({ alg: 'RS256' })}.${b64({ sub: SUB })}.sig`;
  const apple = appleStandIn(d, { token: { status: 200, json: { access_token: 'a.FAKE', token_type: 'Bearer', expires_in: 3600, refresh_token: 'r.FAKE-refresh-0001', id_token: idFromApple } } });
  await apple.ready;
  assert.deepEqual(await exchangeAppleCode(KEYS, 'c.code', { sub: SUB, fetchImpl: apple.fetchImpl, now: NOW }), { ok: true, refreshToken: 'r.FAKE-refresh-0001' });
  assert.equal((await exchangeAppleCode(KEYS, 'c.code', { sub: 'someone-else', fetchImpl: apple.fetchImpl, now: NOW })).ok, false, 'another person\'s code: never kept');
  await apple.set('token', { status: 400, json: { error: 'invalid_grant' } });
  assert.deepEqual(await exchangeAppleCode(KEYS, 'c.code', { sub: SUB, fetchImpl: apple.fetchImpl, now: NOW }), { ok: false, reason: 'bad_code', detail: 'invalid_grant' });
  assert.equal((await exchangeAppleCode(KEYS, '', { sub: SUB, fetchImpl: apple.fetchImpl })).ok, false);
  assert.equal((await exchangeAppleCode(null, 'c', { sub: SUB, fetchImpl: apple.fetchImpl })).ok, false);
});

test('the refresh token is sealed for its Apple id only; revokeAppleFor: revoked / no_key / unreadable / failed, never throws', async () => withKey(async () => {
  const box = sealAppleRefresh('r.FAKE-refresh-0001', SUB);
  assert.equal(JSON.stringify(box).includes('r.FAKE-refresh'), false);
  assert.equal(openAppleRefresh(box, SUB), 'r.FAKE-refresh-0001');
  assert.equal(openAppleRefresh(box, 'another.apple.id'), null, 'moved to another account: unreadable');
  assert.equal(openAppleRefresh(null, SUB), null);

  const d = fakeDb();
  const apple = appleStandIn(d, { revoke: { status: 200, json: {} } });
  await apple.ready;
  assert.equal(await revokeAppleFor(d, { sub: SUB, box }, { fetchImpl: apple.fetchImpl }), 'no_key', 'no admin key: nothing can sign the request');
  assert.equal((await apple.calls('revoke')).length, 0);
  await saveFields(d, 'apple', KEYS);
  assert.equal(await revokeAppleFor(d, { sub: SUB, box }, { fetchImpl: apple.fetchImpl }), 'revoked');
  const [call] = await apple.calls('revoke');
  assert.deepEqual({ ...call.body, client_secret: 'x' }, { client_id: 'sg.ggmt.thirtyda', client_secret: 'x', token: '…0001', token_type_hint: 'refresh_token' });
  assert.equal(await revokeAppleFor(d, { sub: 'another.apple.id', box }, { fetchImpl: apple.fetchImpl }), 'unreadable');
  await apple.set('revoke', { status: 400, json: { error: 'invalid_client' } });
  assert.equal(await revokeAppleFor(d, { sub: SUB, box }, { fetchImpl: apple.fetchImpl }), 'failed');
  await apple.set('revoke', { status: 200, json: {}, fail: 'network' });
  assert.equal(await revokeAppleFor(d, { sub: SUB, box }, { fetchImpl: apple.fetchImpl }), 'failed');
  assert.equal(await revokeAppleFor(d, null, { fetchImpl: apple.fetchImpl }), 'unreadable');
  assert.deepEqual(await revokeAppleToken(KEYS, 't', { fetchImpl: async () => { throw new TypeError('fetch failed'); } }), { ok: false, reason: 'network', detail: null });
}));

test('a pending session that signs in with a second Apple id keeps only that id\'s token (none when its exchange fails); Create profile keeps a token only for its own Apple id', async () => withKey(async () => {
  const A = SUB;
  const B = '009876.fakeb1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6.0800';
  const boxA = sealAppleRefresh('r.FAKE-refresh-A', A);
  const boxB = sealAppleRefresh('r.FAKE-refresh-B', B);
  const withB = { user: { appleRefresh: boxB }, session: { appleRefresh: boxB } };
  // No profile yet, Apple id A signed in (its exchange worked): A's link and A's token wait on the session.
  const session = { userId: null, verified: { gmail: false, facebook: false, apple: true }, signin: { apple: { id: A } }, appleRefresh: boxA };
  const plan = planSignin({ provider: 'apple', person: { id: B }, session });
  assert.equal(plan.kind, 'new');
  assert.equal(plan.session.signin.apple.id, B, 'B replaces A on the session');
  // B's exchange failed (Apple slow, a used code, no code, no key): the new session says "no token", never keeps A's.
  assert.equal(withSigninExtra(plan, 'apple', null).session.appleRefresh, null);
  assert.equal(withSigninExtra(plan, 'apple', withB).session.appleRefresh, boxB);
  const switched = planSignin({ provider: 'apple', person: { id: B }, me: { _id: 'U-1', signin: { apple: { id: A } } } });
  assert.equal(withSigninExtra(switched, 'apple', null).session.appleRefresh, null, 'a switch to another Apple id: none either');
  // Another provider onto Create profile leaves the Apple link and its token as they were (they still match).
  const google = withSigninExtra(planSignin({ provider: 'google', person: { id: 'g1' }, session }), 'google', null);
  assert.equal('appleRefresh' in google.session, false);
  assert.equal(google.session.signin.apple.id, A);
  // A profile signed in / attached to: the token goes on the profile, never on its session.
  const back = withSigninExtra(planSignin({ provider: 'apple', person: { id: B }, user: { _id: 'U-2' } }), 'apple', withB);
  assert.equal(back.userSet.appleRefresh, boxB);
  assert.equal('appleRefresh' in back.session, false);
  const attach = withSigninExtra(planSignin({ provider: 'apple', person: { id: B }, me: { _id: 'U-3', verified: { phone: true } } }), 'apple', null);
  assert.equal('appleRefresh' in attach.userSet || 'appleRefresh' in attach.session, false);
  // Create profile: only a token that opens for the profile's own Apple id.
  assert.equal(appleRefreshFor(boxA, B), null, 'A\'s token on B\'s profile: never kept (it could never be revoked)');
  assert.equal(appleRefreshFor(boxB, B), boxB);
  assert.equal(appleRefreshFor(boxA, A), boxA);
  assert.equal(appleRefreshFor(boxA, null), null, 'no Apple id on the profile');
  assert.equal(appleRefreshFor(null, A), null);
  // The app carries it out: completeSignin plans through withSigninExtra, a session drops an empty token, Create profile
  // keeps the token through appleRefreshFor.
  const src = readFileSync(new URL('./thirtyda-app.mjs', import.meta.url), 'utf8');
  const body = (name) => src.slice(src.indexOf(`async function ${name}(`), src.indexOf('\n}\n', src.indexOf(`async function ${name}(`)));
  assert.match(body('completeSignin'), /const withExtra = \(p\) => withSigninExtra\(p, provider, extra\);/);
  assert.match(body('startSession'), /if \(doc\.userId \|\| !doc\.appleRefresh\) delete doc\.appleRefresh;/);
  assert.match(body('createProfile'), /appleRefreshFor\(session\?\.appleRefresh, signinOf\(session\)\?\.apple\?\.id\) \? \{ appleRefresh: session\.appleRefresh \}/);
  assert.equal((body('createProfile').match(/appleRefresh: session\.appleRefresh/g) || []).length, 1, 'no other way onto the profile');
}));

// ---------------------------------------------------------------- what a sign-in writes, and the delete's handles

test('Apple is a kept account like Google (verified.apple, one profile per Apple id), never a browser sign-in; the name kept once given', () => {
  assert.deepEqual(ACCOUNT_PROVIDERS, ['google', 'facebook', 'tiktok', 'apple']);
  assert.equal(SIGNIN_PROVIDERS.includes('apple'), false, 'no /auth/apple/start, no app sheet ticket');
  assert.equal(VERIFIED_KEY.apple, 'apple');
  assert.deepEqual(KEEP_NAME, ['apple']);
  const person = { provider: 'apple', id: SUB, email: 'nary.fake@privaterelay.appleid.com', name: 'Nary Sok' };
  const fresh = planSignin({ provider: 'apple', person });
  assert.deepEqual(fresh, { kind: 'new', session: { verified: { gmail: false, facebook: false, apple: true }, signin: { apple: { id: SUB, email: person.email, name: 'Nary Sok' } } } });
  const back = planSignin({ provider: 'apple', person: { ...person, name: null }, user: { _id: 'U-1', verified: { apple: true } } });
  assert.deepEqual(back.userSet, { 'verified.apple': true, 'signin.apple.email': person.email }, 'no name the second time: the kept one stays');
  const named = planSignin({ provider: 'apple', person, user: { _id: 'U-1', verified: { apple: true } } });
  assert.equal(named.userSet['signin.apple.name'], 'Nary Sok');
  const add = planSignin({ provider: 'apple', person, me: { _id: 'U-2', verified: { phone: true } } });
  assert.deepEqual(add.userSet, { 'signin.apple': { id: SUB, email: person.email, name: 'Nary Sok' }, 'verified.apple': true });
  // Google never keeps a name.
  assert.deepEqual(planSignin({ provider: 'google', person: { id: 'g1', name: 'X' } }).session.signin, { google: { id: 'g1' } });
  // Verified with Apple only: may chat, is not "never verified", and the Me page says so.
  assert.equal(canTalk({ verified: { apple: true } }), true);
  assert.deepEqual(neverVerifiedFilter()['verified.apple'], { $ne: true });
  assert.deepEqual(signinsOf({ signin: { apple: { id: SUB } } }), { google: false, facebook: false, tiktok: false, apple: true });
  const v = meView({ _id: 'U-3', name: 'Nary', photos: [], verified: { apple: true }, signin: { apple: { id: SUB, email: person.email } }, appleRefresh: { data: 'sealed' } });
  assert.equal(v.verified.apple, true);
  assert.equal(v.signins.apple, true);
  assert.equal(JSON.stringify(v).includes(SUB) || JSON.stringify(v).includes('sealed') || JSON.stringify(v).includes('privaterelay'), false, 'never the id, the token or the email');
});

test('delete: the Apple account is a handle; the claim strips it and keeps the sealed token (with its Apple id) for the revoke', () => {
  const box = { v: 1, alg: 'aes-256-gcm', iv: 'i', tag: 't', data: 'd' };
  const user = { _id: 'U-9', signin: { apple: { id: SUB, email: 'x@privaterelay.appleid.com' } }, appleRefresh: box, verified: { apple: true } };
  assert.deepEqual(handlesOf(user).signins, [{ provider: 'apple', id: SUB }]);
  assert.deepEqual(appleRevokeOf(user), { sub: SUB, box });
  assert.equal(appleRevokeOf({ signin: { apple: { id: SUB } } }), null, 'no token kept (no admin key at sign-in): nothing to revoke');
  const u = claimUpdate(user, handlesOf(user), new Date(NOW));
  assert.deepEqual(u.$set.deleting.apple, { sub: SUB, box });
  assert.equal(u.$set.verified.apple, false);
  assert.ok('appleRefresh' in u.$unset && 'signin' in u.$unset, 'no way in, no token left on the profile');
  assert.deepEqual(appleRevokeOf({ deleting: { apple: { sub: SUB, box } } }), { sub: SUB, box }, 'a delete that stopped half way still revokes');
});

// ---------------------------------------------------------------- the routes, in every guard list

test('the routes: GET /auth/apple/nonce and POST /auth/apple — sign-in routes for the PIN lock, no profile, no "I agree", talk to no one', () => {
  for (const [method, path] of [['GET', '/auth/apple/nonce'], ['POST', '/auth/apple']]) {
    assert.ok(API_ROUTES.some((r) => r.method === method && r.re.test(path)), `${method} ${path} is a route`);
    assert.equal(talksToSomeone(method, path), false);
  }
  assert.equal(whileLocked('POST', '/auth/apple'), 'signin', 'the token signs in with the web callback\'s own lock rule');
  assert.equal(whileLocked('GET', '/auth/apple/nonce'), 'open', 'a nonce signs nobody in');
  assert.equal(whileLocked('GET', '/auth/apple'), 'open', 'not a route (404 anyway), and not a sign-in');
  const src = readFileSync(new URL('./thirtyda-app.mjs', import.meta.url), 'utf8');
  assert.match(src, /\["GET", \/\^\\\/auth\\\/apple\\\/nonce\$\/, appleNonce, \{ auth: "none", blockedOk: true \}\]/);
  assert.match(src, /\["POST", \/\^\\\/auth\\\/apple\$\/, appleSignin, \{ auth: "none", blockedOk: true \}\]/);
  const body = (name) => src.slice(src.indexOf(`async function ${name}(`), src.indexOf('\n}\n', src.indexOf(`async function ${name}(`)));
  const signin = body('appleSignin');
  // The order that matters: the nonce is used up before the token is looked at; the token before anything is written.
  assert.ok(signin.indexOf('takeAppleNonce(') < signin.indexOf('verifyAppleToken('));
  assert.ok(signin.indexOf('verifyAppleToken(') < signin.indexOf('signinOutcome('));
  assert.match(signin, /nonce: nonceHash\(nonce\)/, 'the token must carry sha256(nonce)');
  assert.match(signin, /if \(!req\.headers\.origin\)/, 'the app\'s page only');
  // The same path as the Google callback, and App review accounts refuse it there (completeSignin).
  assert.match(body('finishSignin'), /signinOutcome\(req, d, provider, person, \{ to \}\)/);
  assert.match(body('completeSignin'), /refused: "review"/);
  assert.match(src, /"verified\.apple"|verified\?\.apple/);
});

// ---------------------------------------------------------------- the button: only inside the iPhone app

/** Run fn with a browser-like world: this user agent, this Capacitor, this page address. */
async function inBrowser({ ua, plugin = null, platform = null, href = 'https://ecom.ggmt.sg/30da/#/create' }, fn) {
  const saved = { window: globalThis.window, location: globalThis.location, history: globalThis.history };
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const loc = new URL(href);
  const moves = [];
  const location = {
    get href() { return loc.href; }, get origin() { return loc.origin; }, get pathname() { return loc.pathname; },
    get search() { return loc.search; }, get hash() { return loc.hash; }, set hash(v) { loc.hash = v; },
    assign(u) { moves.push(['assign', String(u)]); }, reload() { moves.push(['reload', loc.href]); },
  };
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: ua }, configurable: true, writable: true });
  globalThis.window = { Capacitor: plugin || platform ? { isNativePlatform: () => Boolean(platform), getPlatform: () => platform, Plugins: { ThirtyDaShell: plugin } } : undefined };
  globalThis.location = location;
  globalThis.history = { state: null, replaceState(_s, _t, u) { loc.href = new URL(u, loc.href).href; moves.push(['replace', loc.href]); } };
  try {
    const shell = await import(`../thirtyda-app/shell.js?t=${Math.random()}`);
    return await fn(shell, moves);
  } finally {
    if (nav) Object.defineProperty(globalThis, 'navigator', nav); else delete globalThis.navigator;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
  }
}
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 30DA-iOS/1.0';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36 30DA-Android/0.1.5';
const WEB_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

test('the Apple button shows only in the iPhone app (never the website — not even Safari on an iPhone — never Android)', async () => {
  const plugin = { signInWithApple: async () => ({ cancelled: true }), openAuth: async () => ({}) };
  assert.equal(await inBrowser({ ua: IOS_UA, plugin }, (s) => s.shellApple()), plugin, 'the iPhone app');
  assert.equal(await inBrowser({ ua: WEB_UA, plugin: null }, (s) => s.shellApple()), null, 'Safari on an iPhone (the website)');
  assert.equal(await inBrowser({ ua: ANDROID_UA, plugin }, (s) => s.shellApple()), null, 'the Android app');
  assert.equal(await inBrowser({ ua: 'Mozilla/5.0 (Macintosh)', plugin }, (s) => s.shellApple()), null, 'a computer');
  assert.equal(await inBrowser({ ua: IOS_UA, plugin: { openAuth: async () => ({}) } }, (s) => s.shellApple()), null, 'an older iPhone app without the plugin method');
  assert.equal(await inBrowser({ ua: WEB_UA, plugin, platform: 'ios' }, (s) => s.shellApple()), plugin, 'Capacitor itself says iOS');

  // The row: Apple FIRST, the same round button as the others, only when shellApple() says so; label "Apple".
  const cp = readFileSync(new URL('../thirtyda-app/screens/create-profile.js', import.meta.url), 'utf8');
  assert.match(cp, /const appleHere = \(\) => Boolean\(shellApple\(\)\);/);
  assert.match(cp, /\? \[appleHere\(\) \? signinBtn\(sign\.apple\) : null, signinBtn\(sign\.tiktok\), codeBtn\(code\.telegram\)/, 'first in the row');
  assert.match(cp, /\['apple', 'apple', 'Apple'\]/, 'named "Apple" under the logo');
  assert.match(cp, /apple: '<circle cx="12" cy="12" r="12" fill="#000"\/>'\s*\+ '<path fill="#fff"/, 'a black circle, the white Apple logo');
  assert.match(cp, /if \(provider === 'apple'\) return signInByApple\(to\);/);
  for (const lang of ['en', 'km', 'zh', 'ko', 'ja']) assert.match(cp, new RegExp(`${lang}: \\{ cp_apple_aria: '[^']+' \\}`), `${lang}: its words`);
  // The "Verify to chat" sheet and #/me use the same row (phoneVerifier) and know an Apple-verified profile.
  const vc = readFileSync(new URL('../thirtyda-app/screens/verify-chat.js', import.meta.url), 'utf8');
  assert.match(vc, /apple: Boolean\(state\.me\?\.verified\?\.apple\)/);
  assert.match(vc, /SIGNIN_NAMES = \{[^}]*apple: 'Apple'/);
  const me = readFileSync(new URL('../thirtyda-app/screens/my-profile.js', import.meta.url), 'utf8');
  assert.match(me, /apple: Boolean\(v\.apple \|\| ins\.apple\)/);
});

test('the app\'s Apple sign-in: nonce → the sheet gets sha256(nonce) → POST /auth/apple → the page loads where the server says', async () => {
  const sheet = [];
  const plugin = {
    async signInWithApple(opts) {
      sheet.push(opts);
      return { identityToken: 'id.token.x', authorizationCode: 'c.code', user: SUB, givenName: 'Nary', familyName: 'Sok', state: opts.state };
    },
  };
  const posted = [];
  const api = {
    async get(path) { assert.equal(path, '/auth/apple/nonce'); return { nonce: NONCE }; },
    async post(path, body) { posted.push([path, body]); return { ok: true, next: '/30da/#/create?signin=apple&ok=1' }; },
  };
  const [how, moves] = await inBrowser({ ua: IOS_UA, plugin }, async (s, m) => [await s.shellAppleSignIn(api, null), m]);
  assert.equal(how, 'done');
  assert.equal(sheet[0].nonce, HASHED, 'Apple gets the SHA-256 hex of the nonce');
  assert.match(sheet[0].state, /^[a-f0-9]{32}$/);
  assert.deepEqual(posted, [['/auth/apple', {
    identityToken: 'id.token.x', authorizationCode: 'c.code', nonce: NONCE, givenName: 'Nary', familyName: 'Sok', email: undefined,
  }]]);
  assert.deepEqual(moves, [['replace', 'https://ecom.ggmt.sg/30da/#/create?signin=apple&ok=1'], ['reload', 'https://ecom.ggmt.sg/30da/#/create?signin=apple&ok=1']],
    'a fresh load, like the redirect at the end of a Google sign-in');

  // Closed: nothing is posted, nothing moves.
  const closed = { signInWithApple: async () => ({ cancelled: true }) };
  const posts2 = [];
  const api2 = { get: async () => ({ nonce: NONCE }), post: async (p, b) => { posts2.push(b); return {}; } };
  assert.equal(await inBrowser({ ua: IOS_UA, plugin: closed }, (s) => s.shellAppleSignIn(api2)), 'cancelled');
  assert.equal(await inBrowser({ ua: IOS_UA, plugin: { signInWithApple: async () => { throw Object.assign(new Error('The user canceled'), { code: '1001 canceled' }); } } }, (s) => s.shellAppleSignIn(api2)), 'cancelled');
  assert.equal(await inBrowser({ ua: IOS_UA, plugin: { signInWithApple: async (o) => ({ identityToken: 'x', state: 'f'.repeat(32) === o.state ? 'g' : 'f'.repeat(32) }) } }, (s) => s.shellAppleSignIn(api2)), 'failed', 'another state');
  assert.deepEqual(posts2, []);
  // Refused by the server: the page goes where the Google sign-in would have gone for that reason; #/me attaches (to=me).
  const refusing = {
    get: async () => ({ nonce: NONCE }),
    post: async (p, b) => { posts2.push(b); throw Object.assign(new Error('x'), { status: 401, code: 'expired', data: { back: '/30da/#/me?signin=apple&error=expired' } }); },
  };
  const [left, m2] = await inBrowser({ ua: IOS_UA, plugin }, async (s, m) => [await s.shellAppleSignIn(refusing, 'me'), m]);
  assert.equal(left, 'left');
  assert.equal(posts2.at(-1).to, 'me');
  assert.deepEqual(m2, [['replace', 'https://ecom.ggmt.sg/30da/#/me?signin=apple&error=expired'], ['reload', 'https://ecom.ggmt.sg/30da/#/me?signin=apple&error=expired']]);
  // From another page address: a plain load there.
  const [, m4] = await inBrowser({ ua: IOS_UA, plugin, href: 'https://ecom.ggmt.sg/30da/index.html#/create' }, async (s, m) => [s.loadFresh('/30da/#/nearby'), m]);
  assert.deepEqual(m4, [['assign', 'https://ecom.ggmt.sg/30da/#/nearby']]);
  // Never anywhere but this site's /30da/.
  const [, m3] = await inBrowser({ ua: IOS_UA, plugin }, async (s, m) => [s.loadFresh('https://evil.example/30da/'), m]);
  assert.equal(m3.at(-1)[1], 'https://ecom.ggmt.sg/30da/');
  // Not the iPhone app: nothing at all.
  assert.equal(await inBrowser({ ua: ANDROID_UA, plugin }, (s) => s.shellAppleSignIn(api)), 'failed');
});
