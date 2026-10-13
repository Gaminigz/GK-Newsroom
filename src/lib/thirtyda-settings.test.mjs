// Run: npm run 30da:test (or node --test src/lib/thirtyda-settings.test.mjs)
// Settings secrets (AES-256-GCM under THIRTYDA_SECRET_KEY) and Telegram code delivery, with an in-memory
// collection and a fake fetch: no database, no network, no real key or token.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  settingsKey, keyReady, sealSecret, openSecret, secretView, saveSecret, removeSecret, readSecret, secretStatus,
  noteSecretUse, clearSettingsCache, secretSaved, SettingsError, SETTINGS_COLLECTION,
} from './thirtyda-settings.mjs';
import {
  deliverCode, classifyTelegramError, checkTelegramToken, channelLive, telegramToken, TELEGRAM_SEND_URL, CODE_TTL_S,
  codeChannelConfigured, testCodesAllowed,
} from './thirtyda-code-send.mjs';

const KEY_HEX = crypto.randomBytes(32).toString('hex');
const OTHER_HEX = crypto.randomBytes(32).toString('hex');
const KEY = Buffer.from(KEY_HEX, 'hex');
const TOKEN = 'FAKE_TEST_TOKEN_0123456789abcdefA1b2';

/** Just enough of a Mongo Db for thirtyda-settings: one collection of plain docs. */
function fakeDb() {
  const docs = new Map();
  const reads = { n: 0 };
  const col = {
    async findOne(q) { reads.n++; const x = docs.get(q._id); return x ? structuredClone(x) : null; },
    async replaceOne(q, doc) { docs.set(q._id, structuredClone(doc)); return { acknowledged: true }; },
    async deleteOne(q) { return { deletedCount: docs.delete(q._id) ? 1 : 0 }; },
    async updateOne(q, u) {
      const x = docs.get(q._id);
      if (!x || (q.box?.$exists && !x.box)) return { matchedCount: 0 };
      Object.assign(x, u.$set);
      return { matchedCount: 1 };
    },
  };
  return {
    docs, reads,
    collection(name) { assert.equal(name, SETTINGS_COLLECTION); return col; },
  };
}

test('key: 64 hex characters only', () => {
  assert.equal(settingsKey(KEY_HEX).length, 32);
  assert.equal(keyReady(KEY_HEX), true);
  for (const bad of [undefined, '', 'abc', KEY_HEX.slice(2), `${KEY_HEX}00`, `${KEY_HEX.slice(1)}g`]) {
    assert.equal(keyReady(bad), false, String(bad));
    assert.throws(() => settingsKey(bad), (e) => e instanceof SettingsError && e.code === 'no_key' && /THIRTYDA_SECRET_KEY/.test(e.message));
  }
});

test('seal/open round-trip; a fresh IV every time; the tag, key and name all bind', () => {
  const a = sealSecret(TOKEN, KEY, 'telegram');
  const b = sealSecret(TOKEN, KEY, 'telegram');
  assert.equal(a.alg, 'aes-256-gcm');
  assert.equal(Buffer.from(a.iv, 'base64').length, 12);
  assert.equal(Buffer.from(a.tag, 'base64').length, 16);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.data, b.data);
  assert.ok(!JSON.stringify(a).includes(TOKEN), 'the box never carries the plain value');
  assert.equal(openSecret(a, KEY, 'telegram'), TOKEN);
  assert.equal(openSecret(b, KEY, 'telegram'), TOKEN);
  assert.equal(openSecret(sealSecret('ünï ក ✓', KEY, 'telegram'), KEY, 'telegram'), 'ünï ក ✓');

  const flip = (s) => { const x = Buffer.from(s, 'base64'); x[0] ^= 1; return x.toString('base64'); };
  assert.throws(() => openSecret({ ...a, data: flip(a.data) }, KEY, 'telegram'));
  assert.throws(() => openSecret({ ...a, tag: flip(a.tag) }, KEY, 'telegram'));
  assert.throws(() => openSecret({ ...a, iv: flip(a.iv) }, KEY, 'telegram'));
  assert.throws(() => openSecret(a, settingsKey(OTHER_HEX), 'telegram'), 'another key cannot open it');
  assert.throws(() => openSecret(a, KEY, 'whatsapp'), 'sealed for telegram, cannot be read as another setting');
  assert.throws(() => openSecret({ ...a, v: 2 }, KEY, 'telegram'), SettingsError);
});

test('views are masked: { set, last4, updatedAt, updatedBy } only', () => {
  assert.deepEqual(secretView(null), { set: false, last4: null, updatedAt: null, updatedBy: null });
  const v = secretView({ _id: 'telegram', box: sealSecret(TOKEN, KEY, 'telegram'), last4: 'A1b2', updatedAt: new Date('2026-10-13T03:04:05Z'), updatedBy: 'superadmin' });
  assert.deepEqual(v, { set: true, last4: 'A1b2', updatedAt: '2026-10-13T03:04:05.000Z', updatedBy: 'superadmin' });
});

test('save → stored sealed, masked view, readable; remove → not set', async () => {
  clearSettingsCache();
  const d = fakeDb();
  const view = await saveSecret(d, 'telegram', TOKEN, { by: 'superadmin', rawKey: KEY_HEX });
  assert.deepEqual(Object.keys(view).sort(), ['last4', 'set', 'updatedAt', 'updatedBy']);
  assert.equal(view.set, true);
  assert.equal(view.last4, 'A1b2');
  assert.equal(view.updatedBy, 'superadmin');
  assert.ok(!JSON.stringify(view).includes(TOKEN));

  const stored = d.docs.get('telegram');
  assert.ok(!JSON.stringify(stored).includes(TOKEN), 'the database never holds the plain token');
  assert.ok(!JSON.stringify(stored).includes(TOKEN.slice(0, -4)), '…nor more than its last 4 characters');
  assert.equal(stored.last4, 'A1b2');

  assert.equal(await readSecret(d, 'telegram', { rawKey: KEY_HEX }), TOKEN);
  const st = await secretStatus(d, 'telegram', { rawKey: KEY_HEX });
  assert.equal(st.readable, true);
  assert.equal(st.set, true);
  assert.ok(!JSON.stringify(st).includes(TOKEN));

  const gone = await removeSecret(d, 'telegram');
  assert.equal(gone.set, false);
  assert.equal(gone.removed, true);
  assert.equal(await readSecret(d, 'telegram', { rawKey: KEY_HEX }), null, 'a removal clears the cache at once');
  assert.equal((await removeSecret(d, 'telegram')).removed, false);
});

test('reads are cached; a save replaces the cached value at once', async () => {
  clearSettingsCache();
  const d = fakeDb();
  await saveSecret(d, 'telegram', TOKEN, { rawKey: KEY_HEX });
  const before = d.reads.n;
  assert.equal(await readSecret(d, 'telegram', { rawKey: KEY_HEX }), TOKEN);
  assert.equal(await readSecret(d, 'telegram', { rawKey: KEY_HEX }), TOKEN);
  assert.equal(d.reads.n, before + 1, 'second read served from memory');
  const next = 'FAKE_SECOND_TOKEN_abcdefghijklmnopZ9y8';
  await saveSecret(d, 'telegram', next, { rawKey: KEY_HEX });
  assert.equal(await readSecret(d, 'telegram', { rawKey: KEY_HEX }), next);
});

test('no key → nothing saved; another key → not readable (and so not set for sending)', async () => {
  clearSettingsCache();
  const d = fakeDb();
  await assert.rejects(saveSecret(d, 'telegram', TOKEN, { rawKey: '' }), (e) => e instanceof SettingsError && e.code === 'no_key');
  await assert.rejects(saveSecret(d, 'telegram', TOKEN, { rawKey: 'not-hex' }), (e) => e.code === 'no_key');
  assert.equal(d.docs.size, 0);

  await saveSecret(d, 'telegram', TOKEN, { rawKey: KEY_HEX });
  clearSettingsCache();
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try {
    assert.equal(await readSecret(d, 'telegram', { rawKey: OTHER_HEX }), null);
  } finally {
    console.error = orig;
  }
  assert.ok(errors.length === 1 && !errors[0].includes(TOKEN), 'one warning, without the token');
  const st = await secretStatus(d, 'telegram', { rawKey: OTHER_HEX });
  assert.equal(st.set, true);
  assert.equal(st.readable, false);
  await assert.rejects(saveSecret(d, 'nope', TOKEN, { rawKey: KEY_HEX }), (e) => e.code === 'unknown');
});

test('noteSecretUse keeps the last outcome on the saved setting only', async () => {
  clearSettingsCache();
  const d = fakeDb();
  await noteSecretUse(d, 'telegram', { ok: false, reason: 'bad_token', detail: 'ACCESS_TOKEN_INVALID' });
  assert.equal(d.docs.size, 0, 'nothing saved → nothing noted');
  await saveSecret(d, 'telegram', TOKEN, { rawKey: KEY_HEX });
  await noteSecretUse(d, 'telegram', { ok: false, reason: 'bad_token', detail: 'ACCESS_TOKEN_INVALID' });
  const st = await secretStatus(d, 'telegram', { rawKey: KEY_HEX });
  assert.equal(st.lastSend.ok, false);
  assert.equal(st.lastSend.reason, 'bad_token');
  assert.match(st.lastSend.at, /^\d{4}-\d\d-\d\dT/);
});

// ---------- Telegram delivery ----------

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

test('token format check', () => {
  assert.equal(checkTelegramToken(`  ${TOKEN}\n`).token, TOKEN);
  for (const bad of ['', '   ', 'short', 'has space in it 0123456789', 'a'.repeat(300), 'bad/char/0123456789abcdefgh']) {
    assert.equal(checkTelegramToken(bad).ok, false, bad);
  }
});

test('Telegram: request shape (Bearer header, our 6 digits, ttl 600) and a good answer', async () => {
  const f = fakeFetch({ body: { ok: true, result: { request_id: 'req-42', phone_number: '+85512345678', request_cost: 0.01, remaining_balance: 4.99 } } });
  const r = await deliverCode('telegram', '+85512345678', '012345', { token: TOKEN, fetchImpl: f, record: false });
  assert.deepEqual(r, { ok: true, channel: 'telegram', requestId: 'req-42', cost: 0.01, balance: 4.99 });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, TELEGRAM_SEND_URL);
  assert.equal(f.calls[0].init.method, 'POST');
  assert.equal(f.calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(f.calls[0].body, { phone_number: '+85512345678', code: '012345', ttl: CODE_TTL_S });
  assert.equal(CODE_TTL_S, 600);
  assert.ok(f.calls[0].init.signal, 'a timeout signal');
});

test('Telegram failures in plain words, never with the token', async () => {
  const cases = [
    [{ status: 401, body: { ok: false, error: 'ACCESS_TOKEN_INVALID' } }, 'bad_token', /did not accept the token/],
    [{ body: { ok: false, error: 'BALANCE_NOT_ENOUGH' } }, 'no_balance', /no balance/],
    [{ body: { ok: false, error: 'PHONE_NUMBER_INVALID' } }, 'not_on_telegram', /may not be on Telegram/],
    [{ body: { ok: false, error: 'FLOOD_WAIT_30' } }, 'other', /FLOOD_WAIT_30/],
    [{ status: 502, body: null }, 'other', /HTTP_502/],
    [new TypeError('fetch failed'), 'other', /Could not reach Telegram/],
    [Object.assign(new Error('timed out'), { name: 'TimeoutError' }), 'other', /10 seconds/],
  ];
  for (const [reply, reason, text] of cases) {
    const r = await deliverCode('telegram', '+85512345678', '123456', { token: TOKEN, fetchImpl: fakeFetch(reply), record: false });
    assert.equal(r.ok, false);
    assert.equal(r.reason, reason, JSON.stringify(reply.body ?? reply.message));
    assert.match(r.message, text);
    assert.ok(!JSON.stringify(r).includes(TOKEN));
  }
  assert.equal(classifyTelegramError('ACCESS_TOKEN_REQUIRED'), 'bad_token');
  assert.equal(classifyTelegramError('', 403), 'bad_token');
});

test('timeout: a hanging Telegram is cut off (10 s in use, 50 ms here)', async () => {
  const hang = (init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  const t0 = Date.now();
  const r = await deliverCode('telegram', '+85512345678', '123456', { token: TOKEN, fetchImpl: fakeFetch(hang), timeoutMs: 50, record: false });
  assert.equal(r.reason, 'other');
  assert.equal(r.detail, 'timeout');
  assert.ok(Date.now() - t0 < 2000);
});

test('channels: Telegram is live with a saved token (or THIRTYDA_TG_TOKEN); WhatsApp is not yet', async () => {
  clearSettingsCache();
  const d = fakeDb();
  const prev = { key: process.env.THIRTYDA_SECRET_KEY, tg: process.env.THIRTYDA_TG_TOKEN };
  process.env.THIRTYDA_SECRET_KEY = KEY_HEX;
  delete process.env.THIRTYDA_TG_TOKEN;
  try {
    assert.equal(await channelLive(d, 'telegram'), false);
    assert.equal(await telegramToken(d, { THIRTYDA_TG_TOKEN: ' ENV_FAKE_TOKEN_0123456789 ' }), 'ENV_FAKE_TOKEN_0123456789');
    await saveSecret(d, 'telegram', TOKEN);
    assert.equal(await channelLive(d, 'telegram'), true);
    assert.equal(await telegramToken(d, { THIRTYDA_TG_TOKEN: 'ENV_FAKE_TOKEN_0123456789' }), TOKEN, 'the saved token wins');
    assert.equal(await channelLive(d, 'whatsapp'), false);
    const w = await deliverCode('whatsapp', '+85512345678', '123456', { d });
    assert.equal(w.ok, false);
    assert.match(w.message, /WhatsApp is not set up yet/);

    // deliverCode reads the saved token and notes the outcome for the admin card.
    const f = fakeFetch({ status: 401, body: { ok: false, error: 'ACCESS_TOKEN_INVALID' } });
    const r = await deliverCode('telegram', '+85512345678', '123456', { d, fetchImpl: f });
    assert.equal(r.reason, 'bad_token');
    assert.equal(f.calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
    await new Promise((res) => setTimeout(res, 10));
    assert.equal(d.docs.get('telegram').lastSend.reason, 'bad_token');
  } finally {
    if (prev.key === undefined) delete process.env.THIRTYDA_SECRET_KEY; else process.env.THIRTYDA_SECRET_KEY = prev.key;
    if (prev.tg !== undefined) process.env.THIRTYDA_TG_TOKEN = prev.tg;
    clearSettingsCache();
  }
});

test('on-screen test codes: only in test mode AND with no code channel set up (saved-but-unreadable counts as set up)', async () => {
  clearSettingsCache();
  const d = fakeDb();
  const prev = { key: process.env.THIRTYDA_SECRET_KEY, tg: process.env.THIRTYDA_TG_TOKEN };
  process.env.THIRTYDA_SECRET_KEY = KEY_HEX;
  delete process.env.THIRTYDA_TG_TOKEN;
  try {
    assert.equal(await testCodesAllowed(d, false), false, 'never without THIRTYDA_DEV_AUTH=1');
    assert.equal(await secretSaved(d, 'telegram'), false);
    assert.equal(await codeChannelConfigured(d), false);
    assert.equal(await testCodesAllowed(d, true), true, 'test mode, nothing set up → test codes');

    // Telegram saved → live → no channel shows a code any more (WhatsApp included: it is not live either).
    await saveSecret(d, 'telegram', TOKEN);
    assert.equal(await channelLive(d, 'whatsapp'), false);
    assert.equal(await codeChannelConfigured(d), true);
    assert.equal(await testCodesAllowed(d, true), false, 'a live channel ends test codes everywhere');

    // THIRTYDA_SECRET_KEY changed since the save: Telegram cannot send, but it does not fall back to test codes.
    clearSettingsCache();
    process.env.THIRTYDA_SECRET_KEY = OTHER_HEX;
    const orig = console.error;
    console.error = () => {};
    try {
      assert.equal(await channelLive(d, 'telegram'), false, 'unreadable → not live');
      assert.equal(await secretSaved(d, 'telegram'), true, 'but still saved');
      assert.equal(await testCodesAllowed(d, true), false, 'fail closed: no on-screen codes');
    } finally {
      console.error = orig;
    }

    // Removed → test codes again (test mode only); THIRTYDA_TG_TOKEN alone also counts as set up.
    await removeSecret(d, 'telegram');
    assert.equal(await secretSaved(d, 'telegram'), false);
    assert.equal(await testCodesAllowed(d, true), true);
    process.env.THIRTYDA_TG_TOKEN = 'ENV_FAKE_TOKEN_0123456789';
    assert.equal(await testCodesAllowed(d, true), false, 'the env token makes Telegram live too');
  } finally {
    if (prev.key === undefined) delete process.env.THIRTYDA_SECRET_KEY; else process.env.THIRTYDA_SECRET_KEY = prev.key;
    if (prev.tg === undefined) delete process.env.THIRTYDA_TG_TOKEN; else process.env.THIRTYDA_TG_TOKEN = prev.tg;
    clearSettingsCache();
  }
});
