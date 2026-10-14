// Run: npm run 30da:test (or node --test src/lib/thirtyda-tiktok.test.mjs)
// Real TikTok sign-in (owner 2026-10-13; src/lib/thirtyda-signin.mjs, Login Kit for Web v2): the exact requests with a
// fake fetch (authorize address, token POST, user/info GET), the optional PKCE kept with the state, who signed in
// (open_id only — TikTok gives no email), why not in plain reasons, that no token is ever kept or returned, what a good
// sign-in writes, the dev-only stand-in, and the small pages (try result, terms of service). No database, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  SIGNIN_PROVIDERS, SIGNIN_NAMES, VERIFIED_KEY, KEY_FIELDS, TIKTOK, SIGNIN_STATES, authorizeUrl, pkcePair, createSigninState,
  takeSigninState, tiktokTokenRequest, tiktokUserInfoRequest, tiktokPerson, classifyTiktokError, signinPerson, callbackError,
  checkSigninFields, signinKeys, signinRedirect, planSignin, signinUserFilter,
} from './thirtyda-signin.mjs';
import { saveFields, clearSettingsCache, FIELD_SETTINGS } from './thirtyda-settings.mjs';
import { redactCall, makeTestFetch, TEST_FETCH_COLLECTION } from './thirtyda-test-fetch.mjs';
import { tryResultPage, termsPage, privacyPage, deleteDataPage, PAGE_STRINGS } from './thirtyda-pages.mjs';

const KEYS = { id: 'awq7e2etest1234ab', secret: 'Tk3xFAKEsecret0123456789abcdefZz' };
const REDIRECT = 'https://ecom.ggmt.sg/30da/api/auth/tiktok/callback';
const CODE = 'Fake*TikTok!code_0123456789-abcdef';
const TOKEN = 'act.FAKE-tiktok-access-0123456789abcdefTOKN';
const REFRESH = 'rft.FAKE-tiktok-refresh-0123456789abcdREFR';
const OPEN_ID = '-000FAKEopenIdAbC123_xyz';
const tokenOk = { status: 200, body: { access_token: TOKEN, refresh_token: REFRESH, open_id: OPEN_ID, scope: 'user.info.basic', expires_in: 86400, refresh_expires_in: 31536000, token_type: 'Bearer' } };
const infoOk = {
  status: 200,
  body: { data: { user: { open_id: OPEN_ID, union_id: 'u-FAKE-union-0001', display_name: ' Nary  ‮Sok ', avatar_url: 'https://p16.tiktokcdn.com/fake.jpeg' } }, error: { code: 'ok', message: '', log_id: '20261013123456789ABCDEF' } },
};

/** A fake fetch: replies in order (the last one repeats); every call kept as { url, init }. */
function fakeFetch(...replies) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (r === 'hang') return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
    if (r === 'network') throw new TypeError('fetch failed');
    return { status: r.status ?? 200, json: async () => { if (r.body === undefined) throw new SyntaxError('not JSON'); return r.body; } };
  };
  fn.calls = calls;
  return fn;
}

/** The few Mongo calls the sign-in state and the settings make, in memory. */
function fakeDb() {
  const cols = new Map();
  return {
    collection(name) {
      if (!cols.has(name)) {
        const docs = new Map();
        cols.set(name, {
          docs,
          async insertOne(doc) { docs.set(doc._id, structuredClone(doc)); return { acknowledged: true }; },
          async findOne(q) { const x = docs.get(q._id); return x ? structuredClone(x) : null; },
          async findOneAndDelete(q) { const x = docs.get(q._id); docs.delete(q._id); return x ? structuredClone(x) : null; },
          async replaceOne(q, doc) { docs.set(q._id, structuredClone(doc)); return { matchedCount: 1 }; },
          async deleteOne(q) { return { deletedCount: docs.delete(q._id) ? 1 : 0 }; },
          async updateOne(q, u, opts = {}) {
            let x = docs.get(q._id);
            if (!x && !opts.upsert) return { matchedCount: 0 };
            x ??= { _id: q._id };
            for (const [k, v] of Object.entries(u.$push || {})) x[k] = [...(x[k] || []), ...(v.$each || [v])].slice(v.$slice ?? -Infinity);
            docs.set(q._id, x);
            return { matchedCount: 1 };
          },
        });
      }
      return cols.get(name);
    },
  };
}

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

const noSecrets = (v) => {
  const all = JSON.stringify(v);
  return ![KEYS.secret, CODE, TOKEN, REFRESH, KEYS.secret.slice(0, -4), TOKEN.slice(0, -4)].some((x) => all.includes(x));
};

// ---------- wiring ----------

test('TikTok is the third sign-in: name, verified key, its two boxes (secret sealed and masked)', () => {
  assert.deepEqual(SIGNIN_PROVIDERS, ['google', 'facebook', 'tiktok']);
  assert.equal(SIGNIN_NAMES.tiktok, 'TikTok');
  assert.equal(VERIFIED_KEY.tiktok, 'tiktok');
  assert.deepEqual(KEY_FIELDS.tiktok, ['clientKey', 'clientSecret']);
  assert.deepEqual(FIELD_SETTINGS.tiktok, { clientKey: {}, clientSecret: { secret: true } });
  assert.equal(signinRedirect({ headers: { host: 'ecom.ggmt.sg' } }, 'tiktok'), REDIRECT);
  assert.equal(signinRedirect({ headers: { host: 'evil.example"><x' } }, 'tiktok'), REDIRECT, 'a bad host falls back to the live site');
  assert.equal(signinRedirect({ headers: { host: 'localhost:8600' } }, 'tiktok'), 'http://localhost:8600/30da/api/auth/tiktok/callback');
});

test('the Code page boxes: Client key + Client secret checked in plain words; an empty secret keeps the saved one', () => {
  assert.deepEqual(checkSigninFields('tiktok', { clientKey: ` ${KEYS.id} `, clientSecret: KEYS.secret }), { ok: true, values: { clientKey: KEYS.id, clientSecret: KEYS.secret } });
  assert.deepEqual(checkSigninFields('tiktok', { clientKey: '', clientSecret: KEYS.secret }), { ok: false, field: 'clientKey', error: 'Paste the Client key first.' });
  const bad = checkSigninFields('tiktok', { clientKey: 'aw 123', clientSecret: KEYS.secret });
  assert.equal(bad.field, 'clientKey');
  assert.match(bad.error, /developers\.tiktok\.com/);
  assert.equal(checkSigninFields('tiktok', { clientKey: KEYS.id, clientSecret: '' }).field, 'clientSecret', 'nothing saved yet: the secret is needed');
  assert.equal(checkSigninFields('tiktok', { clientKey: KEYS.id, clientSecret: 'short' }).field, 'clientSecret');
  const kept = checkSigninFields('tiktok', { clientKey: KEYS.id, clientSecret: '' }, { clientKey: KEYS.id, clientSecret: KEYS.secret });
  assert.deepEqual(kept.values, { clientKey: KEYS.id, clientSecret: KEYS.secret });
  for (const r of [bad, checkSigninFields('tiktok', {})]) assert.ok(!/THIRTYDA_|OAuth|undefined/.test(r.error));
});

test('signinKeys: the saved Client key + secret as { id, secret }, or null', async () => {
  await withKey(async () => {
    const d = fakeDb();
    assert.equal(await signinKeys(d, 'tiktok'), null);
    const view = await saveFields(d, 'tiktok', { clientKey: KEYS.id, clientSecret: KEYS.secret });
    assert.deepEqual(view.masks, { clientSecret: KEYS.secret.slice(-4) });
    assert.deepEqual(view.fields, { clientKey: KEYS.id }, 'the key shows as saved, the secret never');
    assert.deepEqual(await signinKeys(d, 'tiktok'), KEYS);
    const stored = JSON.stringify([...d.collection('thirtyda_settings').docs.values()]);
    assert.ok(!stored.includes(KEYS.secret) && !stored.includes(KEYS.id), 'sealed: neither the key nor the secret in plain');
  });
});

// ---------- the requests ----------

test('authorize address: client_key, response_type=code, scope user.info.basic, redirect_uri, state — never the secret', () => {
  const state = 's'.repeat(64);
  const u = new URL(authorizeUrl('tiktok', { clientId: KEYS.id, redirectUri: REDIRECT, state }));
  assert.equal(`${u.origin}${u.pathname}`, 'https://www.tiktok.com/v2/auth/authorize/');
  assert.deepEqual(Object.fromEntries(u.searchParams), {
    client_key: KEYS.id, response_type: 'code', scope: 'user.info.basic', redirect_uri: REDIRECT, state,
  });
  assert.ok(!u.href.includes(KEYS.secret));
  const p = new URL(authorizeUrl('tiktok', { clientId: KEYS.id, redirectUri: REDIRECT, state, codeChallenge: 'abc_-123' }));
  assert.equal(p.searchParams.get('code_challenge'), 'abc_-123');
  assert.equal(p.searchParams.get('code_challenge_method'), 'S256');
});

test('PKCE: off for TikTok web by default; when on, the verifier stays with the state and only the S256 challenge goes out', async () => {
  assert.equal(TIKTOK.pkce, false, 'TikTok documents code_verifier for mobile / desktop only');
  assert.equal(pkcePair('tiktok'), null);
  assert.equal(pkcePair('google'), null);
  const p = pkcePair('tiktok', true);
  assert.match(p.verifier, /^[A-Za-z0-9_-]{43,128}$/, 'RFC 7636: 43–128 unreserved characters');
  assert.equal(p.challenge, crypto.createHash('sha256').update(p.verifier).digest('base64url'));
  assert.notEqual(pkcePair('tiktok', true).verifier, p.verifier, 'fresh every time');

  const d = fakeDb();
  const state = await createSigninState(d, 'tiktok', { verifier: p.verifier });
  const [stored] = [...d.collection(SIGNIN_STATES).docs.values()];
  assert.equal(stored.provider, 'tiktok');
  assert.equal(stored.verifier, p.verifier, 'kept server side with the state (single use, 10 minutes)');
  const u = new URL(authorizeUrl('tiktok', { clientId: KEYS.id, redirectUri: REDIRECT, state, codeChallenge: p.challenge }));
  assert.ok(!u.href.includes(p.verifier), 'the verifier never goes to the browser');
  const back = await takeSigninState(d, 'tiktok', state, state);
  assert.equal(back.ok, true);
  assert.equal(back.rec.verifier, p.verifier);
  const plain = await createSigninState(d, 'tiktok');
  assert.equal((await takeSigninState(d, 'tiktok', plain, plain)).rec.verifier, undefined, 'without PKCE nothing extra is kept');
});

test('token POST (form body: client_key, client_secret, code, grant_type, redirect_uri; code_verifier only with PKCE) and user/info GET (Bearer, fields)', () => {
  const t = tiktokTokenRequest(KEYS, CODE, REDIRECT);
  assert.equal(t.url, 'https://open.tiktokapis.com/v2/oauth/token/');
  assert.equal(t.init.method, 'POST');
  assert.equal(t.init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(t.init.body)), {
    client_key: KEYS.id, client_secret: KEYS.secret, code: CODE, grant_type: 'authorization_code', redirect_uri: REDIRECT,
  });
  assert.equal(new URLSearchParams(tiktokTokenRequest(KEYS, CODE, REDIRECT, 'v'.repeat(64)).init.body).get('code_verifier'), 'v'.repeat(64));
  const i = tiktokUserInfoRequest(TOKEN);
  const u = new URL(i.url);
  assert.equal(`${u.origin}${u.pathname}`, 'https://open.tiktokapis.com/v2/user/info/');
  assert.equal(u.searchParams.get('fields'), 'open_id,union_id,display_name,avatar_url');
  assert.equal(i.init.method, 'GET');
  assert.equal(i.init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.ok(!i.url.includes(TOKEN), 'the token only in the header');
});

// ---------- who signed in ----------

test('user/info → person: open_id is the id, no email (TikTok gives none), display name cleaned; union_id / avatar never kept', () => {
  assert.deepEqual(tiktokPerson(infoOk.body), { provider: 'tiktok', id: OPEN_ID, email: null, name: 'Nary Sok' });
  assert.equal(tiktokPerson({ data: { user: { open_id: '723f24d7-e717-40f8-a2b6-cb8464cd23b4' } } }).name, null);
  assert.equal(tiktokPerson({ data: { user: { display_name: 'x' } } }), null, 'no open_id → nobody');
  assert.equal(tiktokPerson({ data: { user: { open_id: 'bad id <x>' } } }), null);
  assert.equal(tiktokPerson({ data: { user: { open_id: 12345 } } }), null);
  assert.equal(tiktokPerson({}), null);
  assert.ok(!JSON.stringify(tiktokPerson(infoOk.body)).includes('union') && !JSON.stringify(tiktokPerson(infoOk.body)).includes('tiktokcdn'));
});

test('TikTok sign-in end to end with a fake fetch: token, then user/info; tokens stay inside; 10 s timeouts', async () => {
  const f = fakeFetch(tokenOk, infoOk);
  const r = await signinPerson('tiktok', KEYS, CODE, REDIRECT, { fetchImpl: f });
  assert.deepEqual(r, { ok: true, person: { provider: 'tiktok', id: OPEN_ID, email: null, name: 'Nary Sok' } });
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].url, TIKTOK.tokenUrl);
  assert.equal(new URLSearchParams(f.calls[0].init.body).get('client_secret'), KEYS.secret);
  assert.equal(new URLSearchParams(f.calls[0].init.body).get('code_verifier'), null, 'no PKCE by default');
  assert.ok(f.calls[1].url.startsWith(TIKTOK.userInfoUrl));
  assert.equal(f.calls[1].init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.ok(f.calls.every((c) => c.init.signal instanceof AbortSignal), 'every request has a timeout');
  assert.ok(noSecrets(r), 'no token, refresh token, code or secret in the result');

  const withPkce = fakeFetch(tokenOk, infoOk);
  await signinPerson('tiktok', KEYS, CODE, REDIRECT, { fetchImpl: withPkce, verifier: 'w'.repeat(64) });
  assert.equal(new URLSearchParams(withPkce.calls[0].init.body).get('code_verifier'), 'w'.repeat(64));

  // user/info must answer for the person the token was issued to.
  const other = { status: 200, body: { data: { user: { open_id: 'someone-else-0001' } }, error: { code: 'ok' } } };
  assert.deepEqual(await signinPerson('tiktok', KEYS, CODE, REDIRECT, { fetchImpl: fakeFetch(tokenOk, other) }), { ok: false, reason: 'other', detail: null });
  // A token answer without open_id is fine: user/info says who it is.
  const noOpen = { status: 200, body: { access_token: TOKEN } };
  assert.equal((await signinPerson('tiktok', KEYS, CODE, REDIRECT, { fetchImpl: fakeFetch(noOpen, infoOk) })).ok, true);
});

test('why not, in plain reasons — TikTok\'s own words as the detail, never the secret, code, token or log_id', async () => {
  const oauth = (status, error, description) => ({ status, body: { error, error_description: description, log_id: '202610131234567890ABCDEF' } });
  const cases = [
    // [replies, reason, detail]
    [[oauth(401, 'invalid_client', 'Client key or secret is incorrect.')], 'bad_keys', 'invalid_client: Client key or secret is incorrect.'],
    [[oauth(400, 'invalid_grant', 'Authorization code is expired.')], 'expired', 'invalid_grant: Authorization code is expired.'],
    [[oauth(400, 'invalid_request', 'redirect_uri does not match the registered one')], 'redirect', 'invalid_request: redirect_uri does not match the registered one'],
    [[oauth(400, 'invalid_scope', 'scope user.info.basic is not authorized for this app')], 'not_live', 'invalid_scope: scope user.info.basic is not authorized for this app'],
    [[oauth(200, 'invalid_request', `Bad secret ${KEYS.secret} for code ${CODE}`)], 'other', null],
    [[oauth(500, 'server_error', 'Internal error')], 'provider_error', 'server_error: Internal error'],
    [[{ status: 503 }], 'provider_error', null], // an HTML page: TikTok said nothing we can quote
    [[{ status: 400, body: {} }], 'other', null],
    [[{ status: 200, body: { access_token: '' } }], 'other', null],
    [[tokenOk, { status: 429, body: { data: {}, error: { code: 'rate_limit_exceeded', message: 'Rate limit exceeded', log_id: '2026101312345678' } } }], 'provider_error', 'rate_limit_exceeded: Rate limit exceeded'],
    [[tokenOk, { status: 401, body: { data: {}, error: { code: 'scope_not_authorized', message: 'The user did not authorize the scope required for completing this request.' } } }], 'cancelled', 'scope_not_authorized: The user did not authorize the scope required for completing this request.'],
    [[tokenOk, { status: 401, body: { data: {}, error: { code: 'access_token_invalid', message: `The access token ${TOKEN} is invalid` } } }], 'other', null],
    [[tokenOk, { status: 500, body: { data: {}, error: { code: 'internal_error', message: 'Something went wrong' } } }], 'provider_error', 'internal_error: Something went wrong'],
    [[tokenOk, { status: 502 }], 'provider_error', null],
    [[tokenOk, { status: 200, body: { data: { user: {} }, error: { code: 'ok' } } }], 'other', null],
  ];
  for (const [replies, reason, detail] of cases) {
    const r = await signinPerson('tiktok', KEYS, CODE, REDIRECT, { fetchImpl: fakeFetch(...replies) });
    const label = JSON.stringify(replies.map((x) => x.body?.error ?? x.status));
    assert.equal(r.ok, false, label);
    assert.equal(r.reason, reason, label);
    if (detail !== null) assert.equal(r.detail, detail, label);
    assert.ok(noSecrets(r), `${label}: nothing secret in the reason`);
    assert.ok(!/log_id|202610131234|OAuth/.test(JSON.stringify(r)), `${label}: no log id, plain words`);
  }
  const hidden = await signinPerson('tiktok', KEYS, CODE, REDIRECT, { fetchImpl: fakeFetch(oauth(200, 'invalid_request', `Bad secret ${KEYS.secret} for code ${CODE}`)) });
  assert.ok(hidden.detail.includes('…') && !hidden.detail.includes(KEYS.secret) && !hidden.detail.includes(CODE), 'their words, with the secret and code cut out');

  const slow = await signinPerson('tiktok', KEYS, CODE, REDIRECT, { fetchImpl: fakeFetch('hang'), timeoutMs: 40 });
  assert.deepEqual(slow, { ok: false, reason: 'timeout', detail: null });
  const slowInfo = await signinPerson('tiktok', KEYS, CODE, REDIRECT, { fetchImpl: fakeFetch(tokenOk, 'hang'), timeoutMs: 40 });
  assert.deepEqual(slowInfo, { ok: false, reason: 'timeout', detail: null }, 'user/info never answered');
  assert.deepEqual(await signinPerson('tiktok', KEYS, CODE, REDIRECT, { fetchImpl: fakeFetch('network') }), { ok: false, reason: 'network', detail: null });
  assert.deepEqual(await signinPerson('tiktok', { id: KEYS.id }, CODE, REDIRECT, { fetchImpl: fakeFetch(tokenOk) }), { ok: false, reason: 'bad_keys', detail: null });

  // The callback's own ?error= (the person pressed Cancel, or TikTok refused before any code).
  assert.equal(callbackError('tiktok', new URLSearchParams('error=access_denied&error_description=User+cancelled&state=x')), 'cancelled');
  assert.equal(callbackError('tiktok', new URLSearchParams('error=invalid_request&error_description=redirect_uri+mismatch')), 'redirect');
  assert.equal(callbackError('tiktok', new URLSearchParams('error=unauthorized_client')), 'bad_keys');
  assert.equal(callbackError('tiktok', new URLSearchParams('code=abc&scopes=user.info.basic&state=x')), null);
  assert.equal(classifyTiktokError('invalid_request', 400, 'The app has not been approved yet'), 'not_live');
  assert.equal(classifyTiktokError('temporarily_unavailable'), 'provider_error');
  assert.equal(classifyTiktokError('something_new'), 'other');
});

// ---------- what a good sign-in writes ----------

test('a good TikTok sign-in keeps only the open_id: new person, returning person, a profile adding it', () => {
  assert.deepEqual(signinUserFilter('tiktok', OPEN_ID), { 'signin.tiktok.id': OPEN_ID });
  const person = { provider: 'tiktok', id: OPEN_ID, email: null, name: 'Nary' };
  const fresh = planSignin({ provider: 'tiktok', person, session: null });
  assert.equal(fresh.kind, 'new');
  assert.deepEqual(fresh.session, { verified: { gmail: false, facebook: false, tiktok: true }, signin: { tiktok: { id: OPEN_ID } } });
  assert.ok(!JSON.stringify(fresh).includes('Nary'), 'the display name is not kept');

  const user = { _id: 'U-10500', phone: '+85512345678', verified: { phone: true, gmail: false, facebook: true, tiktok: true }, signin: { tiktok: { id: OPEN_ID } } };
  const back = planSignin({ provider: 'tiktok', person, user });
  assert.equal(back.kind, 'returning');
  assert.deepEqual(back.userSet, { 'verified.tiktok': true }, 'no email to note');
  assert.deepEqual(back.session.verified, { gmail: false, facebook: true, tiktok: true });

  const me = { _id: 'U-10001', verified: { phone: true, gmail: true, facebook: false } };
  const add = planSignin({ provider: 'tiktok', person, me });
  assert.equal(add.kind, 'attach');
  assert.deepEqual(add.userSet, { 'signin.tiktok': { id: OPEN_ID }, 'verified.tiktok': true });
  assert.deepEqual(add.session, { verified: { gmail: true, facebook: false, tiktok: true } });

  const linked = { _id: 'U-10002', verified: { tiktok: true }, signin: { tiktok: { id: 'another-open-id' } } };
  const sw = planSignin({ provider: 'tiktok', person, me: linked });
  assert.equal(sw.kind, 'new');
  assert.equal(sw.switched, true);
  assert.deepEqual(sw.session.signin, { tiktok: { id: OPEN_ID } });
  // A Google sign-in of someone who proved TikTok before keeps that proof.
  assert.deepEqual(planSignin({ provider: 'google', person: { id: '7' }, session: { verified: { tiktok: true } } }).session.verified,
    { gmail: true, facebook: false, tiktok: true });
});

// ---------- the dev-only stand-in ----------

test('the test stand-in answers open.tiktokapis.com and notes the call with the secret, code and verifier cut to their last 4', async () => {
  const t = tiktokTokenRequest(KEYS, CODE, REDIRECT, 'v'.repeat(60) + 'VVVV');
  const call = redactCall(t.url, t.init);
  assert.equal(call.url, 'https://open.tiktokapis.com/v2/oauth/token/');
  assert.equal(call.body.client_key, KEYS.id, 'the client key is public');
  assert.equal(call.body.client_secret, `…${KEYS.secret.slice(-4)}`);
  assert.equal(call.body.code, `…${CODE.slice(-4)}`);
  assert.equal(call.body.code_verifier, '…VVVV');
  const i = tiktokUserInfoRequest(TOKEN);
  const icall = redactCall(i.url, i.init);
  assert.equal(icall.headers.authorization, `Bearer …${TOKEN.slice(-4)}`);
  assert.equal(icall.query.fields, TIKTOK.fields);

  const d = fakeDb();
  const col = d.collection(TEST_FETCH_COLLECTION);
  await col.insertOne({ _id: 'POST https://open.tiktokapis.com/v2/oauth/token/', reply: { status: 200, json: tokenOk.body }, calls: [] });
  await col.insertOne({ _id: 'GET https://open.tiktokapis.com/v2/user/info/', reply: { status: 200, json: infoOk.body }, calls: [] });
  const real = async () => { throw new Error('the real network must not be used'); };
  const r = await signinPerson('tiktok', KEYS, CODE, REDIRECT, { fetchImpl: makeTestFetch(async () => d, real) });
  assert.deepEqual(r, { ok: true, person: { provider: 'tiktok', id: OPEN_ID, email: null, name: 'Nary Sok' } });
  const noted = JSON.stringify([...col.docs.values()].map((x) => x.calls));
  assert.ok(noted.includes('…') && !noted.includes(KEYS.secret) && !noted.includes(TOKEN) && !noted.includes(CODE), 'the stand-in keeps no whole secret');
});

// ---------- the small pages ----------

test('try page for TikTok: "TikTok: name (no email shared)", others once TikTok approves; failures say what to fix (5 languages)', () => {
  const ok = tryResultPage({ provider: 'tiktok', ok: true, person: { name: '<b>Nary</b>', email: null } });
  assert.ok(ok.includes('TikTok: &lt;b&gt;Nary&lt;/b&gt; (no email shared)'));
  assert.ok(ok.includes('Others can sign in once TikTok approves the app.'));
  assert.ok(ok.includes('<title>TikTok sign-in works · 30+DA</title>'));
  assert.ok(tryResultPage({ provider: 'tiktok', ok: false, reason: 'bad_keys' }).includes('TikTok did not accept the Client key or Client secret.'));
  assert.ok(tryResultPage({ provider: 'tiktok', ok: false, reason: 'not_live' }).includes('Submit the app for review in TikTok'));
  assert.ok(tryResultPage({ provider: 'tiktok', ok: false, reason: 'redirect' }).includes('Add the Redirect address from the Code page in TikTok.'));
  for (const lang of ['en', 'km', 'zh', 'ko', 'ja']) {
    for (const k of ['try_others_tiktok', 'fix_not_live_tiktok']) assert.ok(PAGE_STRINGS[lang][k]?.includes('TikTok'), `${lang}.${k}`);
    const km = tryResultPage({ provider: 'tiktok', ok: false, reason: 'not_live', lang });
    assert.ok(!/undefined|\{\w+\}/.test(km), `${lang}: all filled`);
  }
});

test('terms of service: short, plain, 5 languages, flag row, honest about what the app does; privacy + delete pages name TikTok', () => {
  const shown = (html) => html.replace(/<(head|nav)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  for (const lang of ['en', 'km', 'zh', 'ko', 'ja']) {
    const t = PAGE_STRINGS[lang];
    const html = termsPage({ lang });
    assert.ok(html.includes(`<html lang="${lang}">`) && html.includes(`<h1>${t.terms_title}</h1>`), `${lang}: title`);
    // Store policy (owner 2026-10-14): the community rules — zero tolerance, what is never allowed, 24-hour reports, moderators.
    for (const k of ['terms_age', 'terms_honest', 'terms_respect', 'terms_banned', 'terms_contact', 'terms_reports', 'terms_mods', 'terms_zero']) {
      assert.ok(html.includes(`<li><b>${t[`${k}_k`]}</b> ${t[k]}</li>`), `${lang}: ${k}`);
    }
    assert.ok(html.includes(`href="/30da/privacy?lang=${lang}"`) && html.includes('mailto:gk.smart@ggmt.sg'), `${lang}: privacy link + contact`);
    const flags = html.match(/<nav class="langs"[\s\S]*?<\/nav>/)?.[0] || '';
    for (const c of ['en', 'km', 'zh', 'ko', 'ja']) assert.ok(flags.includes(`href="/30da/terms?lang=${c}"`), `${lang}: flag ${c}`);
    assert.ok(flags.includes(`lang="${lang}" aria-current="true"`));
    assert.ok(!/<script|style=|undefined|\{\w+\}/.test(html), `${lang}: no script, nothing unfilled`);
    assert.ok(!/OAuth|token|redirect|cookie/i.test(shown(html)), `${lang}: no technical words`);
    assert.ok(t.priv_social_k.includes('TikTok') && t.del_step2.includes('TikTok'), `${lang}: privacy + delete-data name TikTok`);
  }
  assert.match(PAGE_STRINGS.en.terms_age, /30 and over/);
  assert.ok(termsPage().includes('<html lang="en">') && termsPage({ lang: 'xx' }).includes('<html lang="en">'));
  // Longer since the store-policy rules (what is never allowed, reports, moderators), still one screen of plain lines.
  assert.ok(shown(termsPage()).length < 1000, `terms (en) stays short: ${shown(termsPage()).length} characters`);
  assert.ok(privacyPage().includes('From Google, Facebook or TikTok:') && deleteDataPage().includes('(phone, Google, Facebook or TikTok)'));
});
