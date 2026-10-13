// Run: npm run 30da:test (or node --test src/lib/thirtyda-signin.test.mjs)
// Real Google / Facebook sign-in (src/lib/thirtyda-signin.mjs): the state (single use, 10 minutes, same browser),
// the exact requests to Google and Facebook with a fake fetch (incl. appsecret_proof), who signed in, why not,
// what a good sign-in writes (returning person / new person), that no token is ever kept or returned — plus
// the honest code channels (src/lib/thirtyda-code-send.mjs: offered only after a test code went through) and the
// test-only fetch switch (src/lib/thirtyda-test-fetch.mjs). No database, no network, no real key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
import { tryResultPage, privacyPage, deleteDataPage, esc } from './thirtyda-pages.mjs';

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

// ---------- the admin's try page ----------

test('try page: "Works ✓ — Google said: name (email)", escaped; failures in plain words; nothing technical', () => {
  const ok = tryResultPage({ provider: 'google', ok: true, person: { name: '<b>Nary</b>', email: 'nary@gmail.com' } });
  assert.match(ok, /Works/);
  assert.ok(ok.includes('Google said: &lt;b&gt;Nary&lt;/b&gt; (nary@gmail.com)'), 'escaped');
  assert.ok(!ok.includes('<b>Nary'));
  for (const reason of ['cancelled', 'bad_keys', 'redirect', 'not_live', 'expired', 'provider_error', 'timeout', 'network', 'no_keys', 'admin_gone', 'too_many', 'other']) {
    const html = tryResultPage({ provider: 'facebook', ok: false, reason, detail: '<script>x</script>' });
    assert.match(html, /Did not work/);
    assert.ok(!html.includes('<script>x'), `${reason}: detail escaped`);
    assert.ok(!/THIRTYDA_|Railway/.test(html), `${reason}: plain words`);
  }
  assert.match(tryResultPage({ provider: 'google', ok: false, reason: 'redirect' }), /redirect address is not added in Google/);
  assert.match(tryResultPage({ provider: 'facebook', ok: false, reason: 'bad_keys' }), /did not accept the App ID or App secret/);
  assert.equal(esc(`<a href="x">'`), '&lt;a href=&quot;x&quot;&gt;&#39;');

  // A good try proves the keys + redirect address only: the owner gets in even while the app is in Testing / Development.
  assert.ok(ok.includes('Your Client ID, Client secret and the redirect address work.'));
  assert.ok(ok.includes('still in Testing') && ok.includes('Publish app'), 'Google: say who can sign in until it is published');
  assert.ok(!/People can (now )?sign in/.test(ok), 'never claims everyone can sign in');
  const fbOk = tryResultPage({ provider: 'facebook', ok: true, person: { name: 'Dara', email: null } });
  assert.ok(fbOk.includes('App ID, App secret and the redirect address work') && fbOk.includes('Development mode') && fbOk.includes('Live'));
  assert.ok(fbOk.includes('Facebook said: Dara (no email shared)'));
  // Their side / our side, worded as such; nothing after "said:" unless they said it.
  const down = tryResultPage({ provider: 'google', ok: false, reason: 'provider_error', detail: null });
  assert.match(down, /Google did not answer properly/);
  assert.match(down, /not with your keys/);
  assert.ok(!down.includes('said:'), 'no detail → no "Google said:" line');
  assert.match(tryResultPage({ provider: 'facebook', ok: false, reason: 'network' }), /could not reach Facebook/);
  assert.match(privacyPage(), /gk\.smart@ggmt\.sg/);
  assert.match(deleteDataPage(), /Delete my 30\+DA account/);
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
