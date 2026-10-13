// Run: npm run 30da:test (or node --test src/lib/thirtyda-connections.test.mjs)
// The admin Code page's multi-box settings (WhatsApp, Google, Facebook: several fields in one sealed box),
// WhatsApp code delivery (request shape, error mapping) and the sign-in key checks — with an in-memory
// collection and a fake fetch: no database, no network, no real key or token.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  saveFields, readFields, fieldsStatus, fieldsView, removeSecret, saveSecret, secretSaved, clearSettingsCache, openSecret,
  settingsKey, SettingsError, SETTINGS_COLLECTION, FIELD_SETTINGS,
} from './thirtyda-settings.mjs';
import {
  deliverCode, channelLive, codeChannelConfigured, testCodesAllowed, checkWhatsAppFields, whatsappRequest, whatsappConfig,
  classifyWhatsAppError, whatsappDetail, WHATSAPP_GRAPH_URL, WHATSAPP_DEFAULT_LANG,
} from './thirtyda-code-send.mjs';
import { checkSigninFields, signinRedirect, publicOrigin, signinKeysSaved, SIGNIN_WIRED } from './thirtyda-signin.mjs';

const KEY_HEX = crypto.randomBytes(32).toString('hex');
const OTHER_HEX = crypto.randomBytes(32).toString('hex');
const WA_TOKEN = 'EAAFAKEtestTOKEN0123456789abcdefghijklmnopQRSTuvwxyz_W9x8';
const WA = { token: WA_TOKEN, phoneNumberId: '106540352242922', templateName: 'login_code', templateLang: 'en_US' };
const G = { clientId: '1234567890-abcdefghij.apps.googleusercontent.com', clientSecret: 'GOCSPX-FAKEsecret0123456789_Ab12' };
const FB = { appId: '987654321012345', appSecret: 'f0a1b2c3d4e5f60718293a4b5c6dZz99' };

/** Just enough of a Mongo Db for thirtyda-settings: one collection of plain docs. */
function fakeDb() {
  const docs = new Map();
  const col = {
    async findOne(q) { const x = docs.get(q._id); return x ? structuredClone(x) : null; },
    async replaceOne(q, doc) { docs.set(q._id, structuredClone(doc)); return { acknowledged: true }; },
    async deleteOne(q) { return { deletedCount: docs.delete(q._id) ? 1 : 0 }; },
    async updateOne(q, u) {
      const x = docs.get(q._id);
      if (!x || (q.box?.$exists && !x.box)) return { matchedCount: 0 };
      Object.assign(x, u.$set);
      return { matchedCount: 1 };
    },
  };
  return { docs, collection(name) { assert.equal(name, SETTINGS_COLLECTION); return col; } };
}

/** Run `fn` with THIRTYDA_SECRET_KEY = hex (and no env Telegram token), then put the env back. */
async function withKey(hex, fn) {
  const prev = { key: process.env.THIRTYDA_SECRET_KEY, tg: process.env.THIRTYDA_TG_TOKEN };
  process.env.THIRTYDA_SECRET_KEY = hex;
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

function fakeFetch(reply) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (reply instanceof Error) throw reply;
    if (typeof reply === 'function') return reply(init);
    return { status: reply.status ?? 200, json: async () => reply.body };
  };
  fn.calls = calls;
  return fn;
}

// ---------- settings: several fields in one sealed box ----------

test('fields settings: whatsapp / google / facebook, each with its secret marked', () => {
  assert.deepEqual(Object.keys(FIELD_SETTINGS).sort(), ['facebook', 'google', 'whatsapp']);
  assert.equal(FIELD_SETTINGS.whatsapp.token.secret, true);
  assert.equal(FIELD_SETTINGS.google.clientSecret.secret, true);
  assert.equal(FIELD_SETTINGS.facebook.appSecret.secret, true);
  assert.ok(!FIELD_SETTINGS.whatsapp.phoneNumberId.secret && !FIELD_SETTINGS.google.clientId.secret && !FIELD_SETTINGS.facebook.appId.secret);
});

test('saveFields: every field sealed in one box; the view shows the plain fields + the secret\'s last 4 only', async () => {
  const d = fakeDb();
  await withKey(KEY_HEX, async () => {
    const view = await saveFields(d, 'whatsapp', { ...WA, extra: 'dropped' }, { by: 'superadmin' });
    assert.deepEqual(view.fields, { phoneNumberId: WA.phoneNumberId, templateName: 'login_code', templateLang: 'en_US' });
    assert.deepEqual(view.masks, { token: 'W9x8' });
    assert.equal(view.last4, 'W9x8');
    assert.equal(view.set, true);
    assert.equal(view.updatedBy, 'superadmin');
    assert.ok(!JSON.stringify(view).includes(WA_TOKEN) && !JSON.stringify(view).includes(WA_TOKEN.slice(0, -4)));

    const stored = d.docs.get('whatsapp');
    const raw = JSON.stringify(stored);
    assert.equal(stored.kind, 'fields');
    assert.equal(stored.box.alg, 'aes-256-gcm');
    assert.ok(!raw.includes(WA_TOKEN) && !raw.includes(WA_TOKEN.slice(0, -4)), 'the database never holds the plain token');
    assert.ok(!raw.includes('login_code') && !raw.includes(WA.phoneNumberId), 'the plain fields are sealed too');
    assert.deepEqual(JSON.parse(openSecret(stored.box, settingsKey(KEY_HEX), 'whatsapp')), WA, 'the box holds exactly the four fields');
    assert.throws(() => openSecret(stored.box, settingsKey(KEY_HEX), 'google'), 'sealed for whatsapp, cannot be read as google');

    assert.deepEqual(await readFields(d, 'whatsapp'), WA);
    const st = await fieldsStatus(d, 'whatsapp');
    assert.equal(st.readable, true);
    assert.deepEqual(st.fields, view.fields);
    assert.equal(st.lastSend, null);
    assert.ok(!JSON.stringify(st).includes(WA_TOKEN));

    // A second save: a fresh IV, the cache replaced at once.
    await saveFields(d, 'whatsapp', { ...WA, templateName: 'otp_v2' });
    assert.notEqual(d.docs.get('whatsapp').box.iv, stored.box.iv);
    assert.equal((await readFields(d, 'whatsapp')).templateName, 'otp_v2');

    const gone = await removeSecret(d, 'whatsapp');
    assert.equal(gone.removed, true);
    assert.equal(await readFields(d, 'whatsapp'), null, 'a removal clears the cache at once');
    assert.equal((await fieldsStatus(d, 'whatsapp')).set, false);
  });
});

test('saveFields refuses an empty field, an unknown setting and a missing key; nothing is stored', async () => {
  const d = fakeDb();
  await withKey(KEY_HEX, async () => {
    await assert.rejects(saveFields(d, 'whatsapp', { ...WA, templateName: '  ' }),
      (e) => e instanceof SettingsError && e.code === 'empty' && e.field === 'templateName');
    await assert.rejects(saveFields(d, 'telegram', { token: 'x' }), (e) => e.code === 'unknown', 'telegram is a single secret');
    await assert.rejects(saveSecret(d, 'whatsapp', 'x'), (e) => e.code === 'unknown', 'whatsapp is not a single secret');
    await assert.rejects(saveFields(d, 'google', G, { rawKey: 'nope' }), (e) => e.code === 'no_key');
    assert.equal(d.docs.size, 0);
  });
});

test('another server key: saved but not readable → no fields shown, not live, but it still counts as set up', async () => {
  const d = fakeDb();
  await withKey(KEY_HEX, () => saveFields(d, 'whatsapp', WA));
  const orig = console.error;
  console.error = () => {};
  try {
    await withKey(OTHER_HEX, async () => {
      const st = await fieldsStatus(d, 'whatsapp');
      assert.equal(st.set, true);
      assert.equal(st.readable, false);
      assert.equal(st.fields, null, 'the plain fields come from the box: unreadable → not shown');
      assert.deepEqual(st.masks, { token: 'W9x8' }, 'the last 4 is still shown');
      assert.equal(await readFields(d, 'whatsapp'), null);
      assert.equal(await channelLive(d, 'whatsapp'), false);
      assert.equal(await secretSaved(d, 'whatsapp'), true);
      assert.equal(await codeChannelConfigured(d), true);
      assert.equal(await testCodesAllowed(d, true), false, 'fail closed: no on-screen codes');
    });
  } finally {
    console.error = orig;
  }
});

test('fieldsView never carries a secret field', () => {
  const v = fieldsView('google', { box: {}, masks: { clientSecret: 'Ab12' }, last4: 'Ab12', updatedAt: new Date('2026-10-13T00:00:00Z') }, G);
  assert.deepEqual(v.fields, { clientId: G.clientId });
  assert.ok(!JSON.stringify(v).includes(G.clientSecret));
  assert.deepEqual(fieldsView('google', null), { set: false, last4: null, masks: {}, fields: null, updatedAt: null, updatedBy: null });
});

// ---------- WhatsApp boxes ----------

test('WhatsApp boxes: trimmed, en_US by default, an empty token keeps the saved one, plain-word errors', () => {
  const ok = checkWhatsAppFields({ token: ` ${WA_TOKEN}\n`, phoneNumberId: ' 1065 4035 2242 922 ', templateName: 'login_code', templateLang: '' });
  assert.deepEqual(ok, { ok: true, values: { ...WA, templateLang: WHATSAPP_DEFAULT_LANG } });
  assert.equal(WHATSAPP_DEFAULT_LANG, 'en_US');
  assert.equal(checkWhatsAppFields({ ...WA, token: '' }, { token: WA_TOKEN }).values.token, WA_TOKEN, 'empty token → the saved one');
  const cases = [
    [{ ...WA, token: '' }, 'token', /Paste the access token/],
    [{ ...WA, token: 'has a space 0123456789abcdef' }, 'token', /no spaces/],
    [{ ...WA, token: 'short' }, 'token', /does not look like/],
    [{ ...WA, phoneNumberId: '' }, 'phoneNumberId', /Phone number ID/],
    [{ ...WA, phoneNumberId: '+855 12 345 678' }, 'phoneNumberId', /only digits/],
    [{ ...WA, templateName: '' }, 'templateName', /template name/],
    [{ ...WA, templateName: 'Login Code' }, 'templateName', /small letters/],
    [{ ...WA, templateLang: 'English' }, 'templateLang', /en_US/],
  ];
  for (const [input, field, text] of cases) {
    const r = checkWhatsAppFields(input);
    assert.equal(r.ok, false, JSON.stringify(input));
    assert.equal(r.field, field);
    assert.match(r.error, text);
    assert.ok(!/THIRTYDA_|OAuth|Railway/.test(r.error), 'plain words');
  }
  for (const lang of ['en', 'en_US', 'zh_CN', 'pt_BR', 'km']) assert.equal(checkWhatsAppFields({ ...WA, templateLang: lang }).ok, true, lang);
});

test('WhatsApp request: POST graph v21.0/<phone number id>/messages, Bearer token, the authentication template with a copy-code button', () => {
  const { url, init } = whatsappRequest(WA, '+85512345678', '012345');
  assert.equal(url, `${WHATSAPP_GRAPH_URL}/106540352242922/messages`);
  assert.equal(WHATSAPP_GRAPH_URL, 'https://graph.facebook.com/v21.0');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, `Bearer ${WA_TOKEN}`);
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(init.body), {
    messaging_product: 'whatsapp',
    to: '85512345678',
    type: 'template',
    template: {
      name: 'login_code',
      language: { code: 'en_US' },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: '012345' }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '012345' }] },
      ],
    },
  });
  assert.ok(!init.body.includes(WA_TOKEN), 'the token only in the header');
});

test('WhatsApp delivery: a good answer → ok with the message id', async () => {
  const f = fakeFetch({ body: { messaging_product: 'whatsapp', contacts: [{ input: '85512345678', wa_id: '85512345678' }], messages: [{ id: 'wamid.HBgLFAKE' }] } });
  const r = await deliverCode('whatsapp', '+85512345678', '654321', { whatsapp: WA, fetchImpl: f, record: false });
  assert.deepEqual(r, { ok: true, channel: 'whatsapp', requestId: 'wamid.HBgLFAKE', cost: null, balance: null });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, 'https://graph.facebook.com/v21.0/106540352242922/messages');
  assert.equal(f.calls[0].body.to, '85512345678');
  assert.equal(f.calls[0].body.template.components[0].parameters[0].text, '654321');
  assert.equal(f.calls[0].body.template.components[1].parameters[0].text, '654321');
  assert.ok(f.calls[0].init.signal, 'a timeout signal');
});

test('WhatsApp failures in plain words with Meta\'s own message, never with the token or a phone number', async () => {
  const meta = (code, message, extra = {}) => ({ error: { message, type: 'OAuthException', code, fbtrace_id: 'AbC', ...extra } });
  const cases = [
    [{ status: 401, body: meta(190, 'Invalid OAuth access token - Cannot parse access token') }, 'bad_token', /did not accept the access token/, /Invalid access token - Cannot parse access token \(code 190\)/],
    [{ status: 400, body: meta(131030, 'Recipient phone number not in allowed list', { error_data: { details: 'Recipient phone number +85512345678 not in allowed list' } }) }, 'not_allowed', /still Meta's test number.*API setup.*'To' list/, /not in allowed list.*\(code 131030\)/],
    [{ status: 400, body: meta(131026, 'Message undeliverable') }, 'not_on_whatsapp', /may not be on WhatsApp/, /Message undeliverable/],
    [{ status: 404, body: meta(132001, 'Template name does not exist in the translation', { error_data: { details: 'template name (login_code) does not exist in en_US' } }) }, 'template', /template/, /does not exist in en_US/],
    [{ status: 400, body: meta(132015, 'Template is paused') }, 'template', /approved/, /paused/],
    [{ status: 400, body: meta(131042, 'Business eligibility payment issue') }, 'no_balance', /payment/, /payment issue/],
    [{ status: 400, body: meta(10, 'Application does not have permission for this action') }, 'bad_token', /access token/, /permission/],
    [{ status: 429, body: meta(130429, 'Rate limit hit') }, 'other', /WhatsApp refused the request \(Rate limit hit \(code 130429\)\)/, /Rate limit/],
    [{ status: 500, body: null }, 'other', /HTTP 500/, /HTTP 500/],
    [{ status: 200, body: { messaging_product: 'whatsapp' } }, 'other', /refused/, /HTTP 200/],
    [new TypeError('fetch failed'), 'other', /Could not reach WhatsApp/, /network/],
    [Object.assign(new Error('timed out'), { name: 'TimeoutError' }), 'other', /10 seconds/, /timeout/],
  ];
  for (const [reply, reason, message, detail] of cases) {
    const r = await deliverCode('whatsapp', '+85512345678', '123456', { whatsapp: WA, fetchImpl: fakeFetch(reply), record: false });
    const label = JSON.stringify(reply.body?.error?.code ?? reply.message ?? reply.status);
    assert.equal(r.ok, false, label);
    assert.equal(r.reason, reason, label);
    assert.match(r.message, message, label);
    assert.match(r.detail, detail, label);
    const all = JSON.stringify(r);
    assert.ok(!all.includes(WA_TOKEN) && !all.includes('85512345678') && !/OAuth/.test(all), `${label}: no token, no phone, plain words`);
  }
  // Meta echoing the token back is cut out too.
  assert.ok(!whatsappDetail({ message: `bad token ${WA_TOKEN}`, code: 190 }, WA_TOKEN, 401).includes(WA_TOKEN));
  assert.equal(classifyWhatsAppError({}, 401), 'bad_token');
  assert.equal(classifyWhatsAppError({}, 403), 'bad_token');
  assert.equal(classifyWhatsAppError({ code: 131000 }, 500), 'other');
});

test('WhatsApp timeout: a hanging Meta is cut off (10 s in use, 50 ms here)', async () => {
  const hang = (init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  const t0 = Date.now();
  const r = await deliverCode('whatsapp', '+85512345678', '123456', { whatsapp: WA, fetchImpl: fakeFetch(hang), timeoutMs: 50, record: false });
  assert.equal(r.reason, 'other');
  assert.equal(r.detail, 'timeout');
  assert.ok(Date.now() - t0 < 2000);
});

test('WhatsApp is live once all four boxes are saved; then test codes end; deliverCode notes the outcome for the card', async () => {
  const d = fakeDb();
  await withKey(KEY_HEX, async () => {
    assert.equal(await channelLive(d, 'whatsapp'), false);
    assert.equal(await whatsappConfig(d), null);
    assert.match((await deliverCode('whatsapp', '+85512345678', '123456', { d })).message, /WhatsApp is not set up yet/);
    assert.equal(await testCodesAllowed(d, true), true);

    await saveFields(d, 'whatsapp', WA);
    assert.equal(await channelLive(d, 'whatsapp'), true);
    assert.equal(await channelLive(d, 'telegram'), false);
    assert.deepEqual(await whatsappConfig(d), WA);
    assert.equal(await codeChannelConfigured(d), true);
    assert.equal(await testCodesAllowed(d, true), false, 'a live WhatsApp ends on-screen codes on every channel');

    const f = fakeFetch({ status: 401, body: { error: { message: 'Invalid OAuth access token - Cannot parse access token', code: 190 } } });
    const r = await deliverCode('whatsapp', '+85512345678', '123456', { d, fetchImpl: f });
    assert.equal(r.reason, 'bad_token');
    assert.equal(f.calls[0].init.headers.Authorization, `Bearer ${WA_TOKEN}`, 'the saved token is used');
    await new Promise((res) => setTimeout(res, 10));
    const st = await fieldsStatus(d, 'whatsapp');
    assert.equal(st.lastSend.ok, false);
    assert.equal(st.lastSend.reason, 'bad_token');
    assert.match(st.lastSend.detail, /code 190/);
    assert.ok(!JSON.stringify(d.docs.get('whatsapp')).includes('85512345678'), 'no phone number kept');

    await removeSecret(d, 'whatsapp');
    assert.equal(await channelLive(d, 'whatsapp'), false);
    assert.equal(await testCodesAllowed(d, true), true);
  });
});

// ---------- Google / Facebook sign-in keys ----------

test('sign-in keys: Google client ID + secret, Facebook app ID + secret; an empty secret keeps the saved one', () => {
  assert.deepEqual(checkSigninFields('google', { clientId: ` ${G.clientId} `, clientSecret: G.clientSecret }), { ok: true, values: G });
  assert.deepEqual(checkSigninFields('facebook', FB), { ok: true, values: FB });
  assert.equal(checkSigninFields('google', { clientId: G.clientId, clientSecret: '' }, G).values.clientSecret, G.clientSecret);
  assert.equal(checkSigninFields('facebook', { appId: FB.appId }, FB).values.appSecret, FB.appSecret);
  const bad = [
    ['google', { clientId: '', clientSecret: G.clientSecret }, 'clientId', /Paste the Client ID/],
    ['google', { clientId: 'my-app.example.com', clientSecret: G.clientSecret }, 'clientId', /apps\.googleusercontent\.com/],
    ['google', { clientId: G.clientId, clientSecret: '' }, 'clientSecret', /Paste the Client secret/],
    ['google', { clientId: G.clientId, clientSecret: 'has spaces in it ok' }, 'clientSecret', /does not look like/],
    ['facebook', { appId: 'abc', appSecret: FB.appSecret }, 'appId', /only digits/],
    ['facebook', { appId: FB.appId, appSecret: 'short' }, 'appSecret', /does not look like/],
  ];
  for (const [p, input, field, text] of bad) {
    const r = checkSigninFields(p, input);
    assert.equal(r.ok, false, `${p} ${JSON.stringify(input)}`);
    assert.equal(r.field, field);
    assert.match(r.error, text);
    assert.ok(!/THIRTYDA_|OAuth|Railway/.test(r.error), 'plain words');
  }
  assert.equal(checkSigninFields('twitter', {}).ok, false);
  assert.deepEqual(SIGNIN_WIRED, { google: true, facebook: true }, 'the sign-in is built: saved keys make the buttons work');
});

test('sign-in keys save sealed and masked; signinKeysSaved', async () => {
  const d = fakeDb();
  await withKey(KEY_HEX, async () => {
    assert.equal(await signinKeysSaved(d, 'google'), false);
    const g = await saveFields(d, 'google', G);
    assert.deepEqual(g.fields, { clientId: G.clientId });
    assert.deepEqual(g.masks, { clientSecret: 'Ab12' });
    const f = await saveFields(d, 'facebook', FB);
    assert.deepEqual(f.fields, { appId: FB.appId });
    assert.equal(f.last4, 'Zz99');
    const raw = JSON.stringify([...d.docs.values()]);
    assert.ok(!raw.includes(G.clientSecret) && !raw.includes(FB.appSecret) && !raw.includes(G.clientId));
    assert.equal(await signinKeysSaved(d, 'google'), true);
    assert.equal(await signinKeysSaved(d, 'facebook'), true);
    assert.equal(await codeChannelConfigured(d), false, 'sign-in keys are not a code channel');
    assert.equal(await testCodesAllowed(d, true), true);
  });
});

test('redirect addresses come from the request host: https on the web, http on this machine', () => {
  const req = (headers) => ({ headers });
  assert.equal(signinRedirect(req({ host: 'ecom.ggmt.sg' }), 'google'), 'https://ecom.ggmt.sg/30da/api/auth/google/callback');
  assert.equal(signinRedirect(req({ host: 'internal:8080', 'x-forwarded-host': 'ecom.ggmt.sg' }), 'facebook'), 'https://ecom.ggmt.sg/30da/api/auth/facebook/callback');
  assert.equal(publicOrigin(req({ host: 'localhost:8311' })), 'http://localhost:8311');
  assert.equal(publicOrigin(req({ host: '127.0.0.1:9000' })), 'http://127.0.0.1:9000');
  assert.equal(publicOrigin(req({ host: 'evil.example/<script>' })), 'https://ecom.ggmt.sg', 'a strange host falls back to the live address');
  assert.equal(publicOrigin(req({})), 'https://ecom.ggmt.sg');
});
