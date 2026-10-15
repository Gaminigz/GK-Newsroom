// Run: npm run 30da:test (or node --test src/lib/thirtyda-signin.test.mjs)
// Real Google / Facebook sign-in (src/lib/thirtyda-signin.mjs): the state (single use, 10 minutes, same browser),
// the exact requests to Google and Facebook with a fake fetch (incl. appsecret_proof), who signed in, why not,
// what a good sign-in writes (returning person / new person), that no token is ever kept or returned — plus
// the honest code channels (src/lib/thirtyda-code-send.mjs: offered only after a test code went through) and the
// test-only fetch switch (src/lib/thirtyda-test-fetch.mjs). No database, no network, no real key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  SIGNIN_STATES, STATE_TTL_MS, GOOGLE, FACEBOOK, authorizeUrl, createSigninState, takeSigninState, stateCookie, readStateCookie,
  stateHash, adminSessionAlive, googleTokenRequest, googleUserinfoRequest, facebookTokenRequest, facebookMeRequest, appsecretProof,
  googlePerson, facebookPerson, classifyGoogleError, classifyFacebookError, signinPerson, callbackError, planSignin, signinUserFilter,
  signinKeys, signinRedirect, SIGNIN_REASONS,
} from './thirtyda-signin.mjs';
import { saveFields, saveSecret, clearSettingsCache, SETTINGS_COLLECTION } from './thirtyda-settings.mjs';
import {
  deliverCode, channelOffer, channelOffered, channelKeyMark, noteChannelOutcome, isLastingFailure, LASTING_REASONS,
} from './thirtyda-code-send.mjs';
import { testFetchAllowed, redactCall, makeTestFetch, TEST_FETCH_COLLECTION } from './thirtyda-test-fetch.mjs';
import { tryResultPage, privacyPage as privacyHtml, deleteDataPage as deleteDataHtml, esc, pickLang, requestLang, PAGE_STRINGS, POLICY_DATE, policyDate } from './thirtyda-pages.mjs';
import { khmerPlain } from '../thirtyda-app/shared/khmer.js';

// The pages keep each Khmer phrase whole with invisible marks (shared/khmer.js khmerKeep): the words are
// compared without them (the joiners themselves: thirtyda-pages.test.mjs).
const privacyPage = (opts) => khmerPlain(privacyHtml(opts));
const deleteDataPage = (opts) => khmerPlain(deleteDataHtml(opts));

const KEY_HEX = crypto.randomBytes(32).toString('hex');
const G_KEYS = { id: '1234567890-abcdefghij.apps.googleusercontent.com', secret: 'GOCSPX-FAKEsecret0123456789_Ab12' };
const FB_KEYS = { id: '987654321012345', secret: 'f0a1b2c3d4e5f60718293a4b5c6dZz99' };
const REDIRECT_G = 'https://ecom.ggmt.sg/30da/api/auth/google/callback';
const REDIRECT_FB = 'https://ecom.ggmt.sg/30da/api/auth/facebook/callback';
const TOKEN = 'ya29.FAKE-access-token-0123456789abcdefTOKN';
const CODE = '4/0AfakeAuthCode-0123456789';

// ---------- a small in-memory Mongo: equality on dotted paths, $exists, $gt, $ne; $set / $push; upsert ----------

const get = (doc, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc);
function matches(doc, q) {
  return Object.entries(q).every(([k, cond]) => {
    const v = get(doc, k);
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && Object.keys(cond).some((x) => x.startsWith('$'))) {
      if ('$exists' in cond && (v !== undefined) !== cond.$exists) return false;
      if ('$gt' in cond && !(v > cond.$gt)) return false;
      if ('$ne' in cond && v === cond.$ne) return false;
      return true;
    }
    return v === cond;
  });
}
function setPath(doc, path, value) {
  const keys = path.split('.');
  let o = doc;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys.at(-1)] = value;
}
function fakeDb() {
  const cols = new Map();
  const col = (name) => {
    if (!cols.has(name)) cols.set(name, new Map());
    const docs = cols.get(name);
    const find1 = (q) => [...docs.values()].find((d) => matches(d, q));
    return {
      docs,
      async findOne(q) { const x = find1(q); return x ? structuredClone(x) : null; },
      async insertOne(doc) {
        if (docs.has(doc._id)) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
        docs.set(doc._id, structuredClone(doc));
        return { acknowledged: true };
      },
      async replaceOne(q, doc, opts = {}) {
        const x = find1(q);
        if (!x && !opts.upsert) return { matchedCount: 0 };
        docs.set(q._id, structuredClone(doc));
        return { matchedCount: x ? 1 : 0 };
      },
      async deleteOne(q) { const x = find1(q); if (x) docs.delete(x._id); return { deletedCount: x ? 1 : 0 }; },
      async findOneAndDelete(q) { const x = find1(q); if (x) docs.delete(x._id); return x ? structuredClone(x) : null; },
      async updateOne(q, u, opts = {}) {
        let x = find1(q);
        if (!x) {
          if (!opts.upsert) return { matchedCount: 0 };
          if (docs.has(q._id)) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
          x = { _id: q._id };
          docs.set(q._id, x);
        }
        for (const [k, v] of Object.entries(u.$set || {})) setPath(x, k, structuredClone(v));
        for (const [k, v] of Object.entries(u.$push || {})) {
          const list = get(x, k) || [];
          setPath(x, k, [...list, ...(v.$each || [v])].slice(v.$slice ?? -Infinity));
        }
        return { matchedCount: 1 };
      },
      find(q) {
        const rows = [...docs.values()].filter((d) => matches(d, q)).map((d) => structuredClone(d));
        return { limit: () => ({ toArray: async () => rows }), toArray: async () => rows };
      },
    };
  };
  const handles = new Map();
  return { cols, collection(name) { if (!handles.has(name)) handles.set(name, col(name)); return handles.get(name); } };
}

async function withKey(fn) {
  const prev = { key: process.env.THIRTYDA_SECRET_KEY, tg: process.env.THIRTYDA_TG_TOKEN };
  process.env.THIRTYDA_SECRET_KEY = KEY_HEX;
  delete process.env.THIRTYDA_TG_TOKEN;
  clearSettingsCache();
  try {
    return await fn();
  } finally {
    if (prev.key === undefined) delete process.env.THIRTYDA_SECRET_KEY; else process.env.THIRTYDA_SECRET_KEY = prev.key;
    if (prev.tg !== undefined) process.env.THIRTYDA_TG_TOKEN = prev.tg;
    clearSettingsCache();
  }
}

/** A fake fetch: replies in order (the last one repeats); every call kept as { url, init }. */
function fakeFetch(...replies) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (r === 'hang') {
      return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
    }
    if (r === 'network') throw new TypeError('fetch failed');
    return { status: r.status ?? 200, json: async () => r.body };
  };
  fn.calls = calls;
  return fn;
}

const req = (host, cookie = '') => ({ headers: { host, cookie } });

// ---------- the state ----------

test('state: 64 hex, only its hash stored with provider + 10-minute expiry, used once, same browser, same provider', async () => {
  const d = fakeDb();
  const now = Date.now();
  const state = await createSigninState(d, 'google', { now });
  assert.match(state, /^[a-f0-9]{64}$/);
  const stored = [...d.collection(SIGNIN_STATES).docs.values()];
  assert.equal(stored.length, 1);
  assert.equal(stored[0]._id, stateHash(state), 'stored by its SHA-256');
  assert.ok(!JSON.stringify(stored).includes(state), 'the state itself is never stored');
  assert.equal(stored[0].provider, 'google');
  assert.equal(stored[0].test, false);
  assert.equal(new Date(stored[0].expires).getTime() - now, STATE_TTL_MS);

  const first = await takeSigninState(d, 'google', state, state, now + 1000);
  assert.equal(first.ok, true);
  const again = await takeSigninState(d, 'google', state, state, now + 2000);
  assert.deepEqual(again, { ok: false, rec: null }, 'single use: the second return finds nothing');
});

test('state: refused when expired, from another browser (no / other cookie), for the other provider, or malformed', async () => {
  const d = fakeDb();
  const now = Date.now();
  const s1 = await createSigninState(d, 'google', { now });
  const late = await takeSigninState(d, 'google', s1, s1, now + STATE_TTL_MS + 1);
  assert.equal(late.ok, false, 'past 10 minutes');
  assert.ok(late.rec, '…but the record is reported (and gone)');
  assert.equal(d.collection(SIGNIN_STATES).docs.size, 0);

  const s2 = await createSigninState(d, 'google', { now });
  assert.equal((await takeSigninState(d, 'google', s2, null, now)).ok, false, 'no cookie: another browser');
  const s3 = await createSigninState(d, 'google', { now });
  const other = crypto.randomBytes(32).toString('hex');
  assert.equal((await takeSigninState(d, 'google', s3, other, now)).ok, false, 'another state in the cookie');
  const s4 = await createSigninState(d, 'facebook', { now });
  assert.equal((await takeSigninState(d, 'google', s4, s4, now)).ok, false, 'a Facebook state on the Google return');
  assert.deepEqual(await takeSigninState(d, 'google', 'not-a-state', 'x', now), { ok: false, rec: null });
  assert.equal(d.collection(SIGNIN_STATES).docs.size, 0, 'every state that came back is used up');
});

test('state cookie: HttpOnly, SameSite=Lax, only for that provider\'s return path, Secure on https only; read back', () => {
  const s = 'a'.repeat(64);
  const live = stateCookie(req('ecom.ggmt.sg'), 'google', s);
  assert.equal(live, `thirtyda_oauth=${s}; HttpOnly; SameSite=Lax; Path=/30da/api/auth/google; Max-Age=600; Secure`);
  assert.ok(!stateCookie(req('localhost:8400'), 'facebook', s).includes('Secure'), 'http on this machine');
  assert.match(stateCookie(req('ecom.ggmt.sg'), 'google', '', 0), /^thirtyda_oauth=; .*Max-Age=0/);
  assert.equal(readStateCookie(req('x', `thirtyda_s=${'b'.repeat(64)}; thirtyda_oauth=${s}`)), s);
  assert.equal(readStateCookie(req('x', 'thirtyda_oauth=short')), null);
});

test('a test state is bound to the admin session that started it', async () => {
  const d = fakeDb();
  const adminToken = crypto.randomBytes(32).toString('hex');
  await d.collection('thirtyda_admin_sessions').insertOne({ _id: adminToken, expires: new Date(Date.now() + 3600e3) });
  const state = await createSigninState(d, 'facebook', { test: true, adminHash: stateHash(adminToken) });
  const { ok, rec } = await takeSigninState(d, 'facebook', state, state);
  assert.equal(ok, true);
  assert.equal(rec.test, true);
  assert.equal(await adminSessionAlive(d, rec.adminHash), true);
  assert.equal(await adminSessionAlive(d, stateHash('another admin')), false);
  await d.collection('thirtyda_admin_sessions').deleteOne({ _id: adminToken });
  assert.equal(await adminSessionAlive(d, rec.adminHash), false, 'signed out → the try no longer counts');
  assert.ok(!JSON.stringify([...d.collection(SIGNIN_STATES).docs.values()]).includes(adminToken), 'never the admin token itself');
});

// ---------- the requests ----------

test('Google: authorize URL (code, openid email profile, select_account), token POST (form body), userinfo with Bearer', () => {
  const u = new URL(authorizeUrl('google', { clientId: G_KEYS.id, redirectUri: REDIRECT_G, state: 's'.repeat(64) }));
  assert.equal(`${u.origin}${u.pathname}`, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.deepEqual(Object.fromEntries(u.searchParams), {
    client_id: G_KEYS.id, redirect_uri: REDIRECT_G, response_type: 'code', scope: 'openid email profile', state: 's'.repeat(64), prompt: 'select_account',
  });
  assert.ok(!u.href.includes(G_KEYS.secret), 'never the secret in the browser');

  const t = googleTokenRequest(G_KEYS, CODE, REDIRECT_G);
  assert.equal(t.url, 'https://oauth2.googleapis.com/token');
  assert.equal(t.init.method, 'POST');
  assert.equal(t.init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(t.init.body)), {
    code: CODE, client_id: G_KEYS.id, client_secret: G_KEYS.secret, redirect_uri: REDIRECT_G, grant_type: 'authorization_code',
  });
  const i = googleUserinfoRequest(TOKEN);
  assert.equal(i.url, 'https://openidconnect.googleapis.com/v1/userinfo');
  assert.equal(i.init.headers.Authorization, `Bearer ${TOKEN}`);
});

test('Facebook: dialog URL (public_profile,email), token GET, /me with fields + appsecret_proof = HMAC-SHA256(token, app secret)', () => {
  const u = new URL(authorizeUrl('facebook', { clientId: FB_KEYS.id, redirectUri: REDIRECT_FB, state: 's'.repeat(64) }));
  assert.equal(`${u.origin}${u.pathname}`, 'https://www.facebook.com/v21.0/dialog/oauth');
  assert.equal(u.searchParams.get('client_id'), FB_KEYS.id);
  assert.equal(u.searchParams.get('redirect_uri'), REDIRECT_FB);
  assert.equal(u.searchParams.get('scope'), 'public_profile,email');
  assert.equal(u.searchParams.get('state'), 's'.repeat(64));

  const t = new URL(facebookTokenRequest(FB_KEYS, CODE, REDIRECT_FB).url);
  assert.equal(`${t.origin}${t.pathname}`, 'https://graph.facebook.com/v21.0/oauth/access_token');
  assert.deepEqual(Object.fromEntries(t.searchParams), { client_id: FB_KEYS.id, redirect_uri: REDIRECT_FB, client_secret: FB_KEYS.secret, code: CODE });

  const m = new URL(facebookMeRequest(FB_KEYS, TOKEN).url);
  assert.equal(`${m.origin}${m.pathname}`, 'https://graph.facebook.com/v21.0/me');
  assert.equal(m.searchParams.get('fields'), 'id,name,email');
  const proof = crypto.createHmac('sha256', FB_KEYS.secret).update(TOKEN).digest('hex');
  assert.equal(m.searchParams.get('appsecret_proof'), proof);
  assert.equal(appsecretProof(TOKEN, FB_KEYS.secret), proof);
  // A fixed vector, so a change in how the proof is made shows up.
  assert.equal(appsecretProof('token', 'secret'), 'e941110e3d2bfe82621f0e3e1434730d7305d106c5f68c87165d0b27a4611a4a');
  assert.ok(!m.searchParams.get('appsecret_proof').includes(FB_KEYS.secret));
});

// ---------- who signed in ----------

test('userinfo → person: Google keeps the email only when verified; Facebook id must be digits; names cleaned', () => {
  assert.deepEqual(googlePerson({ sub: '1098765432123', email: 'Nary@Gmail.com', email_verified: true, name: ' Nary  Sok ' }),
    { provider: 'google', id: '1098765432123', email: 'nary@gmail.com', name: 'Nary Sok' });
  assert.equal(googlePerson({ sub: '1', email: 'a@b.co', email_verified: false }).email, null, 'unverified email not kept');
  assert.equal(googlePerson({ email: 'a@b.co' }), null, 'no sub → nobody');
  assert.equal(googlePerson({ sub: 'bad sub!' }), null);
  assert.deepEqual(facebookPerson({ id: '10225', name: 'Dara‮', email: 'dara@example.com' }),
    { provider: 'facebook', id: '10225', email: 'dara@example.com', name: 'Dara' });
  assert.equal(facebookPerson({ id: '10225' }).email, null, 'no email shared');
  assert.equal(facebookPerson({ id: 'abc' }), null);
  assert.equal(facebookPerson({ id: '1', email: 'not an email' }).email, null);
});

test('Google sign-in end to end with a fake fetch: exchange, then userinfo; the token stays inside', async () => {
  const f = fakeFetch(
    { status: 200, body: { access_token: TOKEN, expires_in: 3599, token_type: 'Bearer', id_token: 'eyJfake' } },
    { status: 200, body: { sub: '110248', name: 'Nary', email: 'nary@gmail.com', email_verified: true } },
  );
  const r = await signinPerson('google', G_KEYS, CODE, REDIRECT_G, { fetchImpl: f });
  assert.deepEqual(r, { ok: true, person: { provider: 'google', id: '110248', email: 'nary@gmail.com', name: 'Nary' } });
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].url, GOOGLE.tokenUrl);
  assert.equal(new URLSearchParams(f.calls[0].init.body).get('client_secret'), G_KEYS.secret);
  assert.equal(f.calls[1].url, GOOGLE.userinfoUrl);
  assert.equal(f.calls[1].init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.ok(f.calls.every((c) => c.init.signal instanceof AbortSignal), 'every request has a timeout');
  assert.ok(!JSON.stringify(r).includes(TOKEN) && !JSON.stringify(r).includes('eyJfake'), 'no token in the result');
});

test('Facebook sign-in end to end with a fake fetch: exchange, then /me with appsecret_proof', async () => {
  const f = fakeFetch(
    { status: 200, body: { access_token: TOKEN, token_type: 'bearer', expires_in: 5183944 } },
    { status: 200, body: { id: '10229876543', name: 'Dara', email: 'dara@example.com' } },
  );
  const r = await signinPerson('facebook', FB_KEYS, CODE, REDIRECT_FB, { fetchImpl: f });
  assert.deepEqual(r, { ok: true, person: { provider: 'facebook', id: '10229876543', email: 'dara@example.com', name: 'Dara' } });
  const me = new URL(f.calls[1].url);
  assert.equal(me.searchParams.get('appsecret_proof'), appsecretProof(TOKEN, FB_KEYS.secret));
  assert.equal(new URL(f.calls[0].url).searchParams.get('code'), CODE);
  assert.ok(!JSON.stringify(r).includes(TOKEN));
});

test('why not, in reasons: wrong keys, redirect, used code, cancel, not live, timeout — never a secret, code or token in the detail', async () => {
  const cases = [
    ['google', { status: 401, body: { error: 'invalid_client', error_description: 'Unauthorized' } }, 'bad_keys'],
    ['google', { status: 400, body: { error: 'redirect_uri_mismatch' } }, 'redirect'],
    ['google', { status: 400, body: { error: 'invalid_grant', error_description: 'Bad Request' } }, 'expired'],
    ['facebook', { status: 400, body: { error: { message: 'Error validating client secret.', type: 'OAuthException', code: 1 } } }, 'bad_keys'],
    ['facebook', { status: 400, body: { error: { message: 'Invalid redirect_uri: Given URL is not allowed', type: 'OAuthException', code: 191 } } }, 'redirect'],
    ['facebook', { status: 400, body: { error: { message: 'This authorization code has been used.', type: 'OAuthException', code: 100 } } }, 'expired'],
    ['facebook', { status: 400, body: { error: { message: `Bad secret ${FB_KEYS.secret} for code ${CODE}`, code: 2 } } }, 'other'],
  ];
  for (const [provider, reply, reason] of cases) {
    const keys = provider === 'google' ? G_KEYS : FB_KEYS;
    const r = await signinPerson(provider, keys, CODE, REDIRECT_G, { fetchImpl: fakeFetch(reply) });
    assert.equal(r.ok, false);
    assert.equal(r.reason, reason, `${provider} ${JSON.stringify(reply.body)}`);
    const all = JSON.stringify(r);
    assert.ok(!all.includes(keys.secret) && !all.includes(CODE) && !/OAuth/.test(all), `${reason}: nothing secret, plain words`);
  }
  const slow = await signinPerson('google', G_KEYS, CODE, REDIRECT_G, { fetchImpl: fakeFetch('hang'), timeoutMs: 40 });
  assert.equal(slow.reason, 'timeout');
  assert.equal((await signinPerson('facebook', FB_KEYS, CODE, REDIRECT_FB, { fetchImpl: fakeFetch('network') })).reason, 'network');
  const noToken = await signinPerson('google', G_KEYS, CODE, REDIRECT_G, { fetchImpl: fakeFetch({ status: 200, body: {} }) });
  assert.equal(noToken.ok, false);

  assert.equal(slow.detail, null, 'a timeout is our own observation: nothing "Google said"');
  assert.equal(SIGNIN_REASONS.includes('provider_error'), true);

  assert.equal(classifyGoogleError('access_denied'), 'cancelled');
  assert.equal(classifyGoogleError('org_internal'), 'not_live');
  assert.equal(classifyFacebookError({ message: 'App not active: This app is not accessible right now' }), 'not_live');
  assert.equal(callbackError('google', new URLSearchParams('error=access_denied&state=x')), 'cancelled');
  assert.equal(callbackError('facebook', new URLSearchParams('error=access_denied&error_reason=user_denied&error_code=200')), 'cancelled');
  assert.equal(callbackError('google', new URLSearchParams('code=abc&state=x')), null);
});

test('their side, not the keys: a 5xx / 429 / transient answer is provider_error; "said" is only their own words, never ours', async () => {
  const ok = { status: 200, body: { access_token: TOKEN } };
  const cases = [
    // [provider, replies, reason, detail]
    ['google', [{ status: 503 }], 'provider_error', null], // an HTML error page: Google said nothing we can quote
    ['google', [{ status: 429, body: { error: 'rate_limit_exceeded' } }], 'provider_error', 'rate_limit_exceeded'],
    ['google', [ok, { status: 500 }], 'provider_error', null], // userinfo answered 500
    ['google', [ok, { status: 502, body: { error: 'backend_error' } }], 'provider_error', 'backend_error'],
    ['google', [{ status: 401, body: { error: 'invalid_client' } }], 'bad_keys', 'invalid_client'],
    ['google', [{ status: 400 }], 'other', null],
    ['google', ['network'], 'network', null],
    ['facebook', [{ status: 500, body: { error: { message: 'An unknown error has occurred.', type: 'OAuthException', code: 1 } } }],
      'provider_error', 'An unknown error has occurred. (code 1)'],
    ['facebook', [{ status: 400, body: { error: { message: 'Application request limit reached', code: 4, is_transient: true } } }],
      'provider_error', 'Application request limit reached (code 4)'],
    ['facebook', [ok, { status: 503 }], 'provider_error', null], // /me answered 503
    ['facebook', [{ status: 500, body: { error: { message: 'Error validating client secret.', code: 1 } } }], 'bad_keys', 'Error validating client secret. (code 1)'],
    ['facebook', [{ status: 400 }], 'other', null],
  ];
  for (const [provider, replies, reason, detail] of cases) {
    const keys = provider === 'google' ? G_KEYS : FB_KEYS;
    const r = await signinPerson(provider, keys, CODE, REDIRECT_G, { fetchImpl: fakeFetch(...replies) });
    const label = `${provider} ${JSON.stringify(replies.map((x) => x.status ?? x))}`;
    assert.equal(r.ok, false, label);
    assert.equal(r.reason, reason, label);
    assert.equal(r.detail, detail, label);
    assert.ok(!/\b(token|userinfo|HTTP|me HTTP|could not connect)\b/.test(String(r.detail ?? '')), `${label}: none of our own technical words`);
  }
  const slow = await signinPerson('facebook', FB_KEYS, CODE, REDIRECT_FB, { fetchImpl: fakeFetch(ok, 'hang'), timeoutMs: 40 });
  assert.deepEqual([slow.reason, slow.detail], ['timeout', null], '/me never answered');
});

// ---------- what a good sign-in writes ----------

test('returning person: the profile with this provider id gets a session; only id (+ email) kept; no token, no name', () => {
  assert.deepEqual(signinUserFilter('google', '110248'), { 'signin.google.id': '110248' });
  const person = { provider: 'google', id: '110248', email: 'nary@gmail.com', name: 'Nary' };
  const user = { _id: 'U-10500', phone: '+85512345678', verified: { phone: true, gmail: true, facebook: false } };
  const p = planSignin({ provider: 'google', person, user, session: { verified: { gmail: false, facebook: true } } });
  assert.equal(p.kind, 'returning');
  assert.equal(p.userId, 'U-10500');
  assert.deepEqual(p.session, { userId: 'U-10500', phone: '+85512345678', phoneVerified: true, verified: { gmail: true, facebook: false } });
  assert.deepEqual(p.userSet, { 'verified.gmail': true, 'signin.google.email': 'nary@gmail.com' });
  assert.ok(!JSON.stringify(p).includes('Nary"'), 'the name is not kept');
});

test('new person: a fresh session marked verified for the provider, with the id to keep; earlier proofs carry over', () => {
  const person = { provider: 'facebook', id: '10229', email: null, name: 'Dara' };
  const session = { phone: '+85512000000', phoneVerified: true, verified: { gmail: true, facebook: false }, signin: { google: { id: '1' } } };
  const p = planSignin({ provider: 'facebook', person, session });
  assert.equal(p.kind, 'new');
  assert.deepEqual(p.session, { verified: { gmail: true, facebook: true }, signin: { google: { id: '1' }, facebook: { id: '10229' } } });
  assert.equal(p.userSet, undefined, 'no profile is touched');
  const g = planSignin({ provider: 'google', person: { id: '7', email: 'x@y.co' }, session: null });
  assert.deepEqual(g.session, { verified: { gmail: true, facebook: false }, signin: { google: { id: '7', email: 'x@y.co' } } });
});

test('a signed-in profile without this account adds it', () => {
  const me = { _id: 'U-10001', verified: { phone: true, gmail: false, facebook: false } };
  const p = planSignin({ provider: 'google', person: { id: '42', email: 'me@x.co' }, me });
  assert.equal(p.kind, 'attach');
  assert.deepEqual(p.userSet, { 'signin.google': { id: '42', email: 'me@x.co' }, 'verified.gmail': true });
  assert.deepEqual(p.session, { verified: { gmail: true, facebook: false } });
  // Linked to the OTHER provider only: this one is still added.
  const fbOnly = { _id: 'U-10002', verified: { facebook: true }, signin: { facebook: { id: '10229' } } };
  assert.equal(planSignin({ provider: 'google', person: { id: '43' }, me: fbOnly }).kind, 'attach');
});

test('a signed-in profile already linked to another account of this provider is never re-linked: the browser switches', () => {
  const me = {
    _id: 'U-10876', phone: '+85512345678', verified: { phone: true, gmail: true, facebook: true },
    signin: { google: { id: 'S1', email: 'one@x.co' }, facebook: { id: '10229' } },
  };
  const session = { userId: 'U-10876', phone: '+85512345678', phoneVerified: true, verified: { gmail: true, facebook: true }, signin: { google: { id: 'S1' } } };
  const p = planSignin({ provider: 'google', person: { id: 'S3', email: 'three@x.co' }, me, session });
  assert.equal(p.kind, 'new');
  assert.equal(p.switched, true);
  assert.equal(p.userSet, undefined, 'the profile (and its S1 link) is not touched');
  assert.equal(p.userId, undefined);
  assert.deepEqual(p.session, {
    userId: null, phone: null, phoneVerified: false, verified: { gmail: true, facebook: false }, signin: { google: { id: 'S3', email: 'three@x.co' } },
  }, 'a clean session: nothing of the old profile (no user, no phone, no Facebook proof, no S1) carries over');
  // The profile that owns S3 already → a session for that profile, as always.
  const other = { _id: 'U-20000', verified: { gmail: true }, signin: { google: { id: 'S3' } } };
  assert.equal(planSignin({ provider: 'google', person: { id: 'S3' }, user: other, me, session }).kind, 'returning');
});

// ---------- the saved keys feed the sign-in ----------

test('signinKeys: the saved Client ID / App ID + secret, or null; the redirect address from the host', async () => {
  await withKey(async () => {
    const d = fakeDb();
    assert.equal(await signinKeys(d, 'google'), null);
    await saveFields(d, 'google', { clientId: G_KEYS.id, clientSecret: G_KEYS.secret });
    await saveFields(d, 'facebook', { appId: FB_KEYS.id, appSecret: FB_KEYS.secret });
    assert.deepEqual(await signinKeys(d, 'google'), G_KEYS);
    assert.deepEqual(await signinKeys(d, 'facebook'), FB_KEYS);
    assert.equal(await signinKeys(d, 'apple'), null);
    assert.equal(signinRedirect(req('ecom.ggmt.sg'), 'google'), REDIRECT_G);
  });
});

// ---------- the small pages: privacy, delete-data, the admin's try page (5 languages) ----------

const PAGE_LANGS = ['en', 'km', 'zh', 'ko', 'ja'];
const shown = (html) => html.replace(/<(head|nav)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('page language: ?lang, else the browser Accept-Language (by weight), else English', () => {
  assert.equal(pickLang('km', 'ja'), 'km');
  assert.equal(pickLang('KO', ''), 'ko');
  assert.equal(pickLang('fr', 'zh-CN,zh;q=0.9,en;q=0.8'), 'zh', 'unknown ?lang → the browser');
  assert.equal(pickLang(null, 'km-KH'), 'km');
  assert.equal(pickLang(null, 'fr-FR, de;q=0.9, ja;q=0.5, en;q=0.4'), 'ja');
  assert.equal(pickLang(null, 'en;q=0.3, ko;q=0.8'), 'ko', 'by weight, not order');
  assert.equal(pickLang(null, 'zh-TW'), 'zh');
  assert.equal(pickLang(null, 'ko;q=0, fr'), 'en', 'q=0 means not wanted');
  assert.equal(pickLang(null, 'fr, de'), 'en');
  assert.equal(pickLang(undefined, undefined), 'en');
  assert.equal(pickLang('', '*'), 'en');
  assert.equal(requestLang({ headers: { 'accept-language': 'ja-JP' } }, new URL('https://x.test/30da/privacy?lang=km')), 'km');
  assert.equal(requestLang({ headers: { 'accept-language': 'ja-JP' } }, new URL('https://x.test/30da/privacy')), 'ja');
  assert.equal(requestLang({ headers: {} }), 'en');
});

test('every page string is there in all 5 languages, with the same {placeholders}', () => {
  assert.deepEqual(Object.keys(PAGE_STRINGS), PAGE_LANGS);
  const keys = Object.keys(PAGE_STRINGS.en);
  const holes = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
  for (const lang of PAGE_LANGS) {
    assert.deepEqual(Object.keys(PAGE_STRINGS[lang]).sort(), [...keys].sort(), `${lang}: same keys as English`);
    for (const k of keys) {
      const s = PAGE_STRINGS[lang][k];
      assert.ok(typeof s === 'string' && s.trim().length > 0, `${lang}.${k} is filled`);
      assert.equal(holes(s), holes(PAGE_STRINGS.en[k]), `${lang}.${k}: same placeholders`);
      assert.ok(!/[<>]/.test(s), `${lang}.${k}: plain text, no markup`);
      if (lang !== 'en') assert.ok(s !== PAGE_STRINGS.en[k] || /^[\w .:+-]*$/.test(s), `${lang}.${k} is translated`);
    }
  }
});

test('privacy + delete-data: plain one-line points, in each language, flags on top, what Google / Facebook ask for', () => {
  for (const lang of PAGE_LANGS) {
    const t = PAGE_STRINGS[lang];
    const p = privacyPage({ lang });
    const d = deleteDataPage({ lang });
    for (const [name, html] of [['privacy', p], ['delete-data', d]]) {
      assert.ok(html.includes(`<html lang="${lang}">`), `${name} ${lang}: html lang`);
      assert.ok(!/<script|style=|undefined|\{\w+\}/.test(html), `${name} ${lang}: no script, no inline style, nothing unfilled`);
      // The flag row: 5 plain links to the same page, this language marked.
      const flags = html.match(/<nav class="langs"[\s\S]*?<\/nav>/)?.[0] || '';
      for (const code of PAGE_LANGS) assert.ok(flags.includes(`href="/30da/${name}?lang=${code}"`), `${name} ${lang}: flag ${code}`);
      assert.equal((flags.match(/aria-current="true"/g) || []).length, 1);
      assert.ok(flags.includes(`hreflang="${lang}" lang="${lang}" aria-current="true"`), `${name} ${lang}: current flag`);
      assert.ok(html.includes('mailto:gk.smart@ggmt.sg'), `${name} ${lang}: contact`);
      assert.ok(html.includes('<b>GGMT PTE. LTD.</b>'), `${name} ${lang}: the operator by its legal name`);
      assert.ok(!/OAuth|token|redirect|cookie/i.test(shown(html)), `${name} ${lang}: no technical words`);
    }
    // Privacy: in short (what we keep, why, never sold), then the whole of it.
    for (const k of ['priv_keep', 'priv_why', 'priv_never', 'priv_long', 'priv_operator']) {
      assert.ok(p.includes(t[k].split('{')[0]), `privacy ${lang}: ${k}`);
    }
    assert.ok(p.includes(`<h1>${t.priv_title}</h1>`) && p.includes(`href="/30da/delete-data?lang=${lang}"`));
    // Never a wall: each point one plain line.
    for (const li of p.match(/<li>[\s\S]*?<\/li>/g) || []) assert.ok([...shown(li).trim()].length <= 240, `privacy ${lang}: one line, not a wall: ${shown(li)}`);
    // Delete-data: email us (subject filled in), within 30 days, links back to the policy in the same language.
    assert.ok(d.includes(`<h1>${t.del_title} · 30+DA:Safe Calm Dating for 30+</h1>`) && d.includes("Delete my 30+DA account") && d.includes("30"));
    assert.ok(d.includes('href="mailto:gk.smart@ggmt.sg?subject=Delete%20my%2030%2BDA%20account"'));
    assert.ok(d.includes(`href="/30da/privacy?lang=${lang}"`));
  }
  assert.ok(privacyPage().includes('<html lang="en">') && privacyPage().includes('<h1>Privacy policy</h1>'), 'no language → English');
  assert.ok(privacyPage({ lang: 'xx' }).includes('<html lang="en">'));
  // The whole policy (store policy, owner 2026-10-14) — still a few screens, not a contract.
  assert.ok(shown(privacyPage()).length < 3600, `privacy (en) stays readable: ${shown(privacyPage()).length} characters`);
  // The in-app way step by step, the email way, what goes, what stays and for how long (Google Play).
  assert.ok(shown(deleteDataPage()).length < 1500, `delete-data (en) stays short: ${shown(deleteDataPage()).length} characters`);
});

test('privacy: the date comes from POLICY_DATE alone, written each language\'s way; Google / Facebook line says what we keep', () => {
  assert.match(POLICY_DATE, /^\d{4}-\d{2}-\d{2}$/);
  const want = { en: '13 Oct 2026', km: '13 តុលា 2026', zh: '2026 年 10 月 13 日', ko: '2026년 10월 13일', ja: '2026年10月13日' };
  for (const lang of PAGE_LANGS) {
    assert.equal(policyDate(lang, '2026-10-13'), want[lang], `${lang}: date format`);
    assert.ok(PAGE_STRINGS[lang].priv_date.includes('{date}'), `${lang}: priv_date is filled from POLICY_DATE`);
    assert.ok(!/\d/.test(PAGE_STRINGS[lang].priv_date), `${lang}: no date typed into the words`);
    const date = `<p class="doc-date">${PAGE_STRINGS[lang].priv_date.replace('{date}', policyDate(lang))}</p>`;
    assert.ok(privacyPage({ lang }).includes(date), `privacy ${lang}: shows ${policyDate(lang)}`);
  }
  assert.equal(policyDate('en', '2027-01-05'), '5 Jan 2027', 'change POLICY_DATE → every language follows');
  assert.equal(policyDate('km', '2027-01-05'), '5 មករា 2027');
  assert.equal(policyDate('xx', '2027-01-05'), '5 Jan 2027');
  // The app asks Google / Facebook for name + email but keeps only the account number + email: say "keep".
  assert.equal(PAGE_STRINGS.en.priv_social, 'we keep only your account number and email.');
  assert.ok(PAGE_STRINGS.km.priv_social.includes('រក្សាទុក') && PAGE_STRINGS.zh.priv_social.includes('保存')
    && PAGE_STRINGS.ko.priv_social.includes('보관') && PAGE_STRINGS.ja.priv_social.includes('保存'), 'every language says "keep"');
});

test('pages.css: the flag row fits phones narrower than 380 px (no sideways scroll at 360 / 320)', () => {
  const css = readFileSync(new URL('../thirtyda-app/pages.css', import.meta.url), 'utf8');
  const narrow = css.match(/@media \(max-width: 379px\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(narrow, /\.langs \{[^}]*padding: 8px 6px;[^}]*gap: 0;/);
  assert.match(narrow, /\.langs a \{[^}]*padding: 0 4px;/);
});

test('try page: big "Works ✓", "Google: name (email)" escaped, one short line; failures one line what to fix; 5 languages', () => {
  const ok = tryResultPage({ provider: 'google', ok: true, person: { name: '<b>Nary</b>', email: 'nary@gmail.com' } });
  assert.match(ok, /Works <span class="try-mark" aria-hidden="true">✓<\/span>/);
  assert.ok(ok.includes('Google: &lt;b&gt;Nary&lt;/b&gt; (nary@gmail.com)'), 'escaped');
  assert.ok(!ok.includes('<b>Nary'));
  assert.ok(ok.includes('Others can sign in once the app is published.'));
  assert.ok(!/Testing|test users|People can (now )?sign in/.test(ok), 'no long Testing paragraph; never claims everyone can sign in');
  const fbOk = tryResultPage({ provider: 'facebook', ok: true, person: { name: 'Dara', email: null } });
  assert.ok(fbOk.includes('Facebook: Dara (no email shared)') && fbOk.includes('once the app is Live.'));
  assert.ok(tryResultPage({ provider: 'google', ok: true, person: { name: '', email: 'a@b.c' } }).includes('Google: no name (a@b.c)'));

  for (const reason of ['cancelled', 'bad_keys', 'redirect', 'not_live', 'expired', 'provider_error', 'timeout', 'network', 'no_keys', 'admin_gone', 'too_many', 'other', 'something_new']) {
    for (const provider of ['google', 'facebook']) {
      const html = tryResultPage({ provider, ok: false, reason, detail: '<script>x</script>' });
      assert.match(html, /Did not work/);
      assert.ok(!html.includes('<script>x') && !html.includes('&lt;script'), `${reason}: their words stay on the Code page card`);
      assert.ok(!/THIRTYDA_|Railway|undefined|\{\w+\}/.test(html), `${reason}: plain words, all filled`);
      const en = html.match(/<div class="tr on" id="en" lang="en">[\s\S]*?<\/section>/)?.[0] || '';
      assert.equal((en.match(/<p class="try-line">/g) || []).length, 1, `${reason}: one line`);
    }
  }
  assert.ok(tryResultPage({ provider: 'google', ok: false, reason: 'redirect' }).includes('Add the Redirect address from the Code page in Google.'));
  assert.ok(tryResultPage({ provider: 'facebook', ok: false, reason: 'bad_keys' }).includes('Facebook did not accept the App ID or App secret.'));
  assert.ok(tryResultPage({ provider: 'google', ok: false, reason: 'not_live' }).includes('“Publish app”'));
  assert.ok(tryResultPage({ provider: 'facebook', ok: false, reason: 'not_live' }).includes('Live in Meta'));
  const down = tryResultPage({ provider: 'google', ok: false, reason: 'provider_error', detail: null });
  assert.ok(down.includes('A problem on Google’s side, not your keys.') && !down.includes('said:'));
  assert.ok(tryResultPage({ provider: 'facebook', ok: false, reason: 'network' }).includes('could not reach Facebook'));
  assert.equal(esc(`<a href="x">'`), '&lt;a href=&quot;x&quot;&gt;&#39;');

  // All 5 languages in the page (its address works once); the browser's one shows first; flags are #links.
  const km = tryResultPage({ provider: 'google', ok: true, person: { name: 'Nary', email: 'n@x.kh' }, lang: 'km' });
  assert.ok(km.includes('<html lang="km">') && km.includes('<div class="tr on" id="km" lang="km">'));
  assert.ok(km.lastIndexOf('<div class="tr') === km.indexOf('<div class="tr on"'), 'the first shown is last in the page (pages.css)');
  for (const code of PAGE_LANGS) {
    assert.ok(km.includes(`id="${code}" lang="${code}"`), `try page carries ${code}`);
    assert.ok(km.includes(PAGE_STRINGS[code].try_works) && km.includes(PAGE_STRINGS[code].try_back));
    assert.ok(km.includes(`href="#${code}"`), `flag #${code}`);
  }
  assert.equal((km.match(/class="tr on"/g) || []).length, 1);
  assert.ok(!/<script|style=/.test(km) && !/<main/.test(km), 'no script / inline style; no hidden <main>s');
  assert.ok(km.includes('<title>ការចូលតាម Google ដំណើរការ · 30+DA</title>'));
  assert.ok(tryResultPage({ provider: 'facebook', ok: false, reason: 'too_many', lang: 'xx' }).includes('<div class="tr on" id="en"'));
});

// ---------- honest code channels ----------

const TG_TOKEN = 'FAKEtelegramGatewayToken_0123456789abcd';
const WA = { token: 'EAAFAKEtestTOKEN0123456789abcdefghijklmnopQRSTuvwxyz_W9x8', phoneNumberId: '106540352242922', templateName: 'login_code', templateLang: 'en_US' };
const tgOk = { status: 200, body: { ok: true, result: { request_id: 'r1', request_cost: 0.01 } } };
const tgNoMoney = { status: 200, body: { ok: false, error: 'BALANCE_NOT_ENOUGH' } };
const tgBadNumber = { status: 200, body: { ok: false, error: 'PHONE_NUMBER_INVALID' } };

test('a channel is offered only after a test code went through since its keys were saved', async () => {
  await withKey(async () => {
    const d = fakeDb();
    assert.deepEqual(await channelOffer(d, 'telegram'), { live: false, offered: false, state: 'off', reason: null, detail: null, at: null });
    await saveSecret(d, 'telegram', TG_TOKEN);
    assert.equal((await channelOffer(d, 'telegram')).state, 'untested', 'saved, not tested: not offered');
    assert.equal(await channelOffered(d, 'telegram'), false);

    // A real send that goes through does not turn it on — only the admin's test does.
    await deliverCode('telegram', '+85512345678', '123456', { d, fetchImpl: fakeFetch(tgOk) });
    assert.equal(await channelOffered(d, 'telegram'), false);
    // A test that fails for a reason that is not lasting (the number) changes nothing.
    await deliverCode('telegram', '+85512345678', '123456', { d, record: false, test: true, fetchImpl: fakeFetch(tgBadNumber) });
    assert.equal((await channelOffer(d, 'telegram')).state, 'untested');

    await deliverCode('telegram', '+85512345678', '123456', { d, record: false, test: true, fetchImpl: fakeFetch(tgOk) });
    const on = await channelOffer(d, 'telegram');
    assert.equal(on.state, 'on');
    assert.equal(on.offered, true);
    assert.ok(on.at);
    const doc = d.collection(SETTINGS_COLLECTION).docs.get('telegram');
    assert.ok(!JSON.stringify(doc.offer).includes('85512345678') && !JSON.stringify(doc.offer).includes('123456'), 'no number, no code kept');

    // Saving the keys again starts over.
    await saveSecret(d, 'telegram', TG_TOKEN);
    assert.equal((await channelOffer(d, 'telegram')).state, 'untested', 'new keys → test again');
  });
});

test('a lasting failure (no balance, bad token, template) — real or test — stops it until the next good test; others do not', async () => {
  assert.deepEqual(LASTING_REASONS, ['bad_token', 'no_balance', 'template']);
  for (const r of ['not_on_telegram', 'not_on_whatsapp', 'not_allowed', 'other']) assert.equal(isLastingFailure(r), false, r);
  await withKey(async () => {
    const d = fakeDb();
    await saveSecret(d, 'telegram', TG_TOKEN);
    await deliverCode('telegram', '+85512345678', '1', { d, test: true, record: false, fetchImpl: fakeFetch(tgOk) });
    assert.equal(await channelOffered(d, 'telegram'), true);

    await deliverCode('telegram', '+85512345678', '2', { d, fetchImpl: fakeFetch(tgBadNumber) });
    assert.equal(await channelOffered(d, 'telegram'), true, 'a number problem does not stop the channel');
    await deliverCode('telegram', '+85512345678', '3', { d, fetchImpl: fakeFetch('network') });
    assert.equal(await channelOffered(d, 'telegram'), true, 'nor does a network hiccup');

    await deliverCode('telegram', '+85512345678', '4', { d, fetchImpl: fakeFetch(tgNoMoney) });
    const stopped = await channelOffer(d, 'telegram');
    assert.equal(stopped.state, 'stopped');
    assert.equal(stopped.reason, 'no_balance');
    assert.equal(stopped.offered, false, 'a real send with no balance stops it');

    await deliverCode('telegram', '+85512345678', '5', { d, test: true, record: false, fetchImpl: fakeFetch(tgOk) });
    assert.equal(await channelOffered(d, 'telegram'), true, 'the next good test turns it on again');

    // WhatsApp: a template Meta has not approved stops it too (a test send).
    await saveFields(d, 'whatsapp', WA);
    const waOk = { status: 200, body: { messages: [{ id: 'wamid.1' }] } };
    await deliverCode('whatsapp', '+85512345678', '6', { d, test: true, record: false, fetchImpl: fakeFetch(waOk) });
    assert.equal(await channelOffered(d, 'whatsapp'), true);
    const tpl = { status: 400, body: { error: { message: 'Template name does not exist in the translation', code: 132001 } } };
    await deliverCode('whatsapp', '+85512345678', '7', { d, test: true, record: false, fetchImpl: fakeFetch(tpl) });
    assert.deepEqual([(await channelOffer(d, 'whatsapp')).state, (await channelOffer(d, 'whatsapp')).reason], ['stopped', 'template']);
    const allowed = { status: 400, body: { error: { message: 'Recipient phone number not in allowed list', code: 131030 } } };
    await deliverCode('whatsapp', '+85512345678', '8', { d, test: true, record: false, fetchImpl: fakeFetch(waOk) });
    await deliverCode('whatsapp', '+85512345678', '9', { d, fetchImpl: fakeFetch(allowed) });
    assert.equal(await channelOffered(d, 'whatsapp'), true, 'a phone not on the test list is not lasting');
  });
});

test('an outcome is kept only for the keys it was about; the server\'s own Telegram token has its own mark', async () => {
  await withKey(async () => {
    const d = fakeDb();
    await saveSecret(d, 'telegram', TG_TOKEN);
    const mark = await channelKeyMark(d, 'telegram');
    assert.match(mark, /^box:/);
    await saveSecret(d, 'telegram', TG_TOKEN); // saved again while a send was out
    await noteChannelOutcome(d, 'telegram', { ok: true }, { test: true, mark });
    assert.equal(await channelOffered(d, 'telegram'), false, 'a stale outcome never turns the new keys on');

    const e = fakeDb();
    process.env.THIRTYDA_TG_TOKEN = TG_TOKEN;
    try {
      clearSettingsCache();
      const envMark = await channelKeyMark(e, 'telegram');
      assert.match(envMark, /^env:[a-f0-9]{12}$/);
      assert.ok(!envMark.includes(TG_TOKEN.slice(0, 12)));
      await deliverCode('telegram', '+85512345678', '1', { d: e, test: true, record: false, fetchImpl: fakeFetch(tgOk) });
      assert.equal(await channelOffered(e, 'telegram'), true);
      const doc = e.collection(SETTINGS_COLLECTION).docs.get('telegram');
      assert.equal(doc.box, undefined, 'only the state, no token saved');
    } finally {
      delete process.env.THIRTYDA_TG_TOKEN;
    }
  });
});

// ---------- the test-only fetch ----------

test('test fetch: only with the flag, a _dev database, and off Railway', () => {
  assert.equal(testFetchAllowed({ THIRTYDA_TEST_FETCH: '1', MONGO_DB: 'gk_newsroom_30da_dev' }), true);
  assert.equal(testFetchAllowed({ MONGO_DB: 'gk_newsroom_30da_dev' }), false, 'no flag');
  assert.equal(testFetchAllowed({ THIRTYDA_TEST_FETCH: '1', MONGO_DB: 'gk_newsroom_30da' }), false, 'not a dev database');
  assert.equal(testFetchAllowed({ THIRTYDA_TEST_FETCH: '1' }), false, 'no database named');
  assert.equal(testFetchAllowed({ THIRTYDA_TEST_FETCH: '1', MONGO_DB: 'x_dev', RAILWAY_ENVIRONMENT: 'production' }), false, 'never on Railway');
  assert.equal(testFetchAllowed({ THIRTYDA_TEST_FETCH: 'true', MONGO_DB: 'x_dev' }), false, 'exactly 1');
});

test('test fetch: answers only stored addresses, notes each call with secrets cut to their last 4, else the real fetch', async () => {
  const d = fakeDb();
  const real = fakeFetch({ status: 299, body: { real: true } });
  const f = makeTestFetch(async () => d, real);
  const key = `POST ${GOOGLE.tokenUrl}`;
  await d.collection(TEST_FETCH_COLLECTION).insertOne({ _id: key, reply: { status: 200, json: { access_token: TOKEN } } });
  const t = googleTokenRequest(G_KEYS, CODE, REDIRECT_G);
  const res = await f(t.url, t.init);
  assert.deepEqual(await res.json(), { access_token: TOKEN });
  const call = d.collection(TEST_FETCH_COLLECTION).docs.get(key).calls[0];
  assert.equal(call.body.client_secret, '…Ab12');
  assert.equal(call.body.code, `…${CODE.slice(-4)}`);
  assert.equal(call.body.grant_type, 'authorization_code');
  assert.ok(!JSON.stringify(call).includes(G_KEYS.secret) && !JSON.stringify(call).includes(CODE));
  const other = await f(googleUserinfoRequest(TOKEN).url, googleUserinfoRequest(TOKEN).init);
  assert.equal(other.status, 299, 'no answer stored → the real fetch');
  const r2 = redactCall(facebookMeRequest(FB_KEYS, TOKEN).url, facebookMeRequest(FB_KEYS, TOKEN).init);
  assert.equal(r2.query.access_token, '…TOKN');
  assert.equal(r2.query.appsecret_proof, appsecretProof(TOKEN, FB_KEYS.secret));
  const r3 = redactCall('https://gatewayapi.telegram.org/sendVerificationMessage', {
    method: 'POST', headers: { Authorization: `Bearer ${TG_TOKEN}` }, body: JSON.stringify({ phone_number: '+85512345678', code: '123456', ttl: 600 }),
  });
  assert.equal(r3.headers.authorization, 'Bearer …abcd');
  assert.equal(r3.body.code, '••••••');
  assert.ok(!JSON.stringify(r3).includes('12345678'));
});

// ---------- the native apps (owner 2026-10-13): only the web view that began a sign-in can finish it ----------

import {
  APP_SCHEME, APP_PACKAGE, APP_TICKETS, APP_TICKET_TTL_MS, APP_COOKIE, APP_ERRORS, newBinder, appCookie, readAppCookie,
  createAppTicket, takeAppTicket, appReturnQuery, appSchemeUrl, appIntentUrl, appPlatformOf, platformOf,
} from './thirtyda-signin.mjs';
import { appReturnPage as appReturnHtml } from './thirtyda-pages.mjs';

const appReturnPage = (opts) => khmerPlain(appReturnHtml(opts)); // the words without the Khmer marks (above)

const PERSON = { provider: 'google', id: '109876543210987654321', email: 'nary@example.com', name: 'Nary Secret-Name' };

test('app state: only the binder\'s hash + platform kept; the sheet needs no browser cookie; still single use, 10 minutes, this provider', async () => {
  const d = fakeDb();
  const now = Date.now();
  const binder = newBinder();
  assert.match(binder, /^[a-f0-9]{64}$/);
  const state = await createSigninState(d, 'google', { to: 'me', app: stateHash(binder), platform: 'ios', now });
  const [stored] = [...d.collection(SIGNIN_STATES).docs.values()];
  assert.equal(stored.app, stateHash(binder), 'the binder\'s SHA-256');
  assert.equal(stored.platform, 'ios');
  assert.equal(stored.to, 'me');
  assert.ok(!JSON.stringify(stored).includes(binder), 'never the binder itself');
  const first = await takeSigninState(d, 'google', state, null, now + 1000);
  assert.equal(first.ok, true, 'no thirtyda_oauth cookie in the sheet: the binder does that job at the claim');
  assert.deepEqual(await takeSigninState(d, 'google', state, null, now + 2000), { ok: false, rec: null }, 'single use');

  const late = await createSigninState(d, 'google', { app: stateHash(newBinder()), platform: 'android', now });
  assert.equal((await takeSigninState(d, 'google', late, null, now + STATE_TTL_MS + 1)).ok, false, 'past 10 minutes');
  const fb = await createSigninState(d, 'facebook', { app: stateHash(newBinder()), platform: 'android', now });
  assert.equal((await takeSigninState(d, 'google', fb, null, now)).ok, false, 'a Facebook state on the Google return');
});

test('app state: a web state still needs the browser cookie; a test state or a malformed binder hash is never an app state', async () => {
  const d = fakeDb();
  const now = Date.now();
  const web = await createSigninState(d, 'google', { now });
  assert.equal((await takeSigninState(d, 'google', web, null, now)).ok, false, 'web: no cookie, another browser');
  const tryState = await createSigninState(d, 'google', { test: true, adminHash: 'a'.repeat(64), app: stateHash(newBinder()), platform: 'ios', now });
  const tried = await takeSigninState(d, 'google', tryState, null, now);
  assert.equal(tried.ok, false, 'the admin try keeps its cookie check');
  assert.equal(tried.rec.app, undefined);
  const bad = await createSigninState(d, 'google', { app: 'not-a-hash', platform: 'ios', now });
  const r = await takeSigninState(d, 'google', bad, null, now);
  assert.equal(r.ok, false);
  assert.equal(r.rec.app, undefined, 'nothing kept');
  const odd = await createSigninState(d, 'google', { app: stateHash(newBinder()), platform: 'windows', now });
  assert.equal((await takeSigninState(d, 'google', odd, null, now)).rec.platform, 'android', 'an unknown platform gets the page, which works anywhere');
  assert.equal(platformOf('ios'), 'ios');
  assert.equal(platformOf('iOS'), null);
});

test('app ticket: kept by its SHA-256 only, 2 minutes, id + email (never the name or a token), to, the binder\'s hash', async () => {
  const d = fakeDb();
  const now = Date.now();
  const app = stateHash(newBinder());
  const ticket = await createAppTicket(d, 'google', PERSON, { to: 'me', app, now });
  assert.match(ticket, /^[a-f0-9]{64}$/);
  const all = [...d.collection(APP_TICKETS).docs.values()];
  assert.equal(all.length, 1);
  const [rec] = all;
  assert.equal(rec._id, stateHash(ticket));
  assert.ok(!JSON.stringify(rec).includes(ticket), 'never the ticket itself');
  assert.deepEqual(rec.person, { id: PERSON.id, email: PERSON.email });
  assert.ok(!JSON.stringify(rec).includes('Nary Secret-Name'), 'no name');
  assert.equal(rec.to, 'me');
  assert.equal(rec.app, app);
  assert.equal(new Date(rec.expires).getTime() - now, APP_TICKET_TTL_MS);
  assert.equal(APP_TICKET_TTL_MS, 120e3);
  const noEmail = await createAppTicket(d, 'tiktok', { id: 'open.id-1', email: null }, { app, now });
  assert.deepEqual(d.collection(APP_TICKETS).docs.get(stateHash(noEmail)).person, { id: 'open.id-1' });
  assert.equal(d.collection(APP_TICKETS).docs.get(stateHash(noEmail)).to, undefined, 'to only when "me"');
  await assert.rejects(createAppTicket(d, 'google', PERSON, { app: 'x', now }), 'a ticket needs the binder\'s hash');
  await assert.rejects(createAppTicket(d, 'myspace', PERSON, { app, now }));
});

test('app ticket: counts once, only with the binder its sign-in began with, only for 2 minutes', async () => {
  const d = fakeDb();
  const now = Date.now();
  const binder = newBinder();
  const mk = (n = now) => createAppTicket(d, 'google', PERSON, { to: 'me', app: stateHash(binder), now: n });

  const t1 = await mk();
  const good = await takeAppTicket(d, t1, binder, now + 1000);
  assert.equal(good.ok, true);
  assert.deepEqual(good.person, { provider: 'google', id: PERSON.id, email: PERSON.email });
  assert.equal(good.rec.to, 'me');
  assert.deepEqual(await takeAppTicket(d, t1, binder, now + 2000), { ok: false, rec: null }, 'replayed: gone');

  const t2 = await mk();
  const other = await takeAppTicket(d, t2, newBinder(), now);
  assert.equal(other.ok, false, 'another web view\'s binder: an attacker\'s ticket fired into someone else\'s app');
  assert.equal(other.person, undefined);
  assert.equal(d.collection(APP_TICKETS).docs.has(stateHash(t2)), false, '…and it is used up');

  const t3 = await mk();
  assert.equal((await takeAppTicket(d, t3, null, now)).ok, false, 'no binder cookie at all');
  const t4 = await mk();
  assert.equal((await takeAppTicket(d, t4, stateHash(binder), now)).ok, false, 'the stored hash itself is not the binder');
  const t5 = await mk(now - APP_TICKET_TTL_MS - 1);
  const late = await takeAppTicket(d, t5, binder, now);
  assert.equal(late.ok, false, 'past 2 minutes');
  assert.ok(late.rec, '…reported (the provider for the way back) and gone');
  assert.equal(d.collection(APP_TICKETS).docs.size, 0, 'every ticket that came back is used up');
  assert.deepEqual(await takeAppTicket(d, 'not-a-ticket', binder, now), { ok: false, rec: null });
  assert.deepEqual(await takeAppTicket(d, t1.toUpperCase(), binder, now), { ok: false, rec: null });
});

test('app claim with to=me: the account is ADDED to the profile signed in in the web view (never a switch)', async () => {
  const d = fakeDb();
  const now = Date.now();
  const binder = newBinder();
  const ticket = await createAppTicket(d, 'google', PERSON, { to: 'me', app: stateHash(binder), now });
  const { ok, rec, person } = await takeAppTicket(d, ticket, binder, now);
  assert.equal(ok, true);
  assert.equal(rec.to, 'me');
  const me = { _id: 'U-10500', phone: '+85512345678', verified: { phone: true } };
  const plan = planSignin({ provider: person.provider, person, user: null, me, session: { userId: me._id } });
  assert.equal(plan.kind, 'attach');
  assert.equal(plan.userId, 'U-10500');
  assert.deepEqual(plan.userSet, { 'signin.google': { id: PERSON.id, email: PERSON.email }, 'verified.gmail': true });
});

test('app return: the fixed scheme and package; t=<ticket>, or the callback\'s reason + provider (+ to=me)', () => {
  const ticket = 'ab'.repeat(32);
  assert.equal(APP_SCHEME, 'sg.ggmt.thirtyda');
  assert.equal(APP_PACKAGE, 'sg.ggmt.thirtyda');
  const q = appReturnQuery({ ticket });
  assert.equal(q, `t=${ticket}`);
  assert.equal(appSchemeUrl(q), `sg.ggmt.thirtyda://auth?t=${ticket}`);
  assert.equal(appIntentUrl(q), `intent://auth?t=${ticket}#Intent;scheme=sg.ggmt.thirtyda;package=sg.ggmt.thirtyda;end`);
  assert.throws(() => appReturnQuery({ ticket: 'https://evil.example/' }), 'a ticket is 64 hex, nothing else');
  assert.equal(appReturnQuery({ error: 'cancelled', provider: 'google', to: 'me' }), 'error=cancelled&p=google&to=me');
  assert.equal(appReturnQuery({ error: 'too_many', provider: 'tiktok' }), 'error=too_many&p=tiktok');
  assert.deepEqual(APP_ERRORS, ['cancelled', 'expired', 'unavailable', 'failed', 'too_many']);
  for (const reason of APP_ERRORS) assert.equal(appReturnQuery({ error: reason, provider: 'facebook' }), `error=${reason}&p=facebook`);
  assert.equal(appReturnQuery({ error: 'javascript:alert(1)', provider: 'evil', to: 'https://evil.example' }), 'error=failed',
    'an unknown reason is failed; an unknown provider or to is left out');
  assert.equal(appSchemeUrl(appReturnQuery({ error: 'expired', provider: 'google' })), 'sg.ggmt.thirtyda://auth?error=expired&p=google');
});

test('app binder cookie: HttpOnly, SameSite=Lax, only /30da/api/auth/app, 10 minutes, Secure on https; read back', () => {
  const b = 'c'.repeat(64);
  assert.equal(APP_COOKIE, 'thirtyda_app');
  assert.equal(appCookie(req('ecom.ggmt.sg'), b), `thirtyda_app=${b}; HttpOnly; SameSite=Lax; Path=/30da/api/auth/app; Max-Age=600; Secure`);
  assert.equal(appCookie(req('localhost:8096'), b), `thirtyda_app=${b}; HttpOnly; SameSite=Lax; Path=/30da/api/auth/app; Max-Age=600`);
  assert.equal(appCookie(req('ecom.ggmt.sg'), '', 0), 'thirtyda_app=; HttpOnly; SameSite=Lax; Path=/30da/api/auth/app; Max-Age=0; Secure');
  assert.equal(readAppCookie(req('x', `thirtyda_s=${'1'.repeat(64)}; thirtyda_app=${b}`)), b);
  assert.equal(readAppCookie(req('x', `thirtyda_app=${b}x`)), null);
  assert.equal(readAppCookie(req('x', `xthirtyda_app=${b}`)), null);
  assert.equal(readAppCookie(req('x', '')), null);
});

test('the app\'s web view by its user agent: "…30DA-iOS/<v>" / "…30DA-Android/<v>" as the last word, nothing else', () => {
  assert.equal(appPlatformOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 30DA-iOS/0.1'), 'ios');
  assert.equal(appPlatformOf('Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36 30DA-Android/0.1 '), 'android');
  assert.equal(appPlatformOf('Mozilla/5.0 (iPhone) Safari/604.1'), null, 'Safari, the sign-in sheet');
  assert.equal(appPlatformOf('30DA-iOS/0.1 Mozilla/5.0 Safari'), null, 'not the last word');
  assert.equal(appPlatformOf('Mozilla/5.0 X30DA-Android/0.1'), null);
  assert.equal(appPlatformOf(undefined), null);
});

test('Android return page: "Open 30+DA" is the intent link to the package, the plain link under it, one external script, 5 languages', () => {
  const ticket = 'de'.repeat(32);
  const q = appReturnQuery({ ticket });
  const html = appReturnPage({ ok: true, provider: 'google', intentUrl: appIntentUrl(q), schemeUrl: appSchemeUrl(q), lang: 'km' });
  assert.ok(html.includes(`<a class="doc-btn" data-app-open href="intent://auth?t=${ticket}#Intent;scheme=sg.ggmt.thirtyda;package=sg.ggmt.thirtyda;end">`));
  assert.ok(html.includes(`<a href="sg.ggmt.thirtyda://auth?t=${ticket}">`));
  assert.equal((html.match(/<script\b/g) || []).length, 1, 'one script');
  assert.ok(html.includes('<script src="/30da/app-return.js" defer></script>'), '…an external file (the CSP allows no inline script)');
  assert.ok(html.includes('<html lang="km">') && html.includes('<meta name="robots" content="noindex">'));
  for (const code of ['en', 'km', 'zh', 'ko', 'ja']) {
    assert.ok(html.includes(`id="${code}" lang="${code}"`), code);
    assert.ok(html.includes(PAGE_STRINGS[code].app_open) && html.includes(PAGE_STRINGS[code].app_title), code);
  }
  assert.ok(html.includes('Google sign-in done.'));
  const bad = appReturnPage({ ok: false, provider: 'facebook', intentUrl: appIntentUrl('error=cancelled&p=facebook'), schemeUrl: appSchemeUrl('error=cancelled&p=facebook'), lang: 'en' });
  assert.ok(bad.includes(PAGE_STRINGS.en.app_bad) && bad.includes('intent://auth?error=cancelled&amp;p=facebook#Intent;'), 'the reason, escaped');
  const js = readFileSync(new URL('../thirtyda-app/app-return.js', import.meta.url), 'utf8');
  assert.ok(js.includes("a[data-app-open]") && !/fetch|cookie|localStorage/.test(js), 'the auto-try only follows the link');
});
