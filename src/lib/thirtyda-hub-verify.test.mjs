import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verificationRequest, verificationAdminAction } from './thirtyda-hub-verify.mjs';
import { saveFields, clearSettingsCache } from './thirtyda-settings.mjs';
import { processUpdate, botReply, backReply, TG_CHECKS, CHECK_TTL_MS } from './thirtyda-telegram-bot.mjs';

// Isolated database double. No network calls, production users, or Telegram messages.
const matches = (doc, query) => Object.entries(query).every(([k, value]) => {
  if (k === '$or') return value.some(q => matches(doc, q));
  if (value && typeof value === 'object' && !(value instanceof Date)) return Object.entries(value).every(([op, v]) =>
    op === '$gt' ? doc[k] > v : op === '$exists' ? (doc[k] !== undefined) === v : false);
  return doc[k] === value;
});
function fakeDb() {
  const collections = new Map();
  return { collections, collection(name) {
    if (!collections.has(name)) collections.set(name, new Map());
    const rows = collections.get(name);
    return {
      async findOne(q, options = {}) {
        const entries = [...rows.values()].filter(doc => matches(doc, q));
        const sort = Object.entries(options.sort || {})[0];
        if (sort) entries.sort((a, b) => (a[sort[0]] - b[sort[0]]) * sort[1]);
        return structuredClone(entries[0] || null);
      },
      async insertOne(doc) {
        if (rows.has(doc._id)) throw Object.assign(new Error('duplicate'), { code: 11000 });
        rows.set(doc._id, structuredClone(doc)); return { insertedId: doc._id };
      },
      async replaceOne(q, doc) { rows.set(doc._id, structuredClone(doc)); return {}; },
      async updateOne(q, u, options = {}) {
        let doc = [...rows.values()].find(doc => matches(doc, q));
        if (!doc && options.upsert) { doc = { _id: q._id }; rows.set(doc._id, doc); }
        if (!doc) return { matchedCount: 0 };
        Object.assign(doc, structuredClone(u.$set || {}));
        for (const [k, v] of Object.entries(u.$max || {})) if (!doc[k] || doc[k] < v) doc[k] = v;
        return { matchedCount: 1 };
      },
      async deleteOne(q) { const doc = [...rows.values()].find(doc => matches(doc, q)); return { deletedCount: doc ? Number(rows.delete(doc._id)) : 0 }; },
    };
  } };
}

async function fixture(run) {
  const before = process.env.THIRTYDA_SECRET_KEY;
  process.env.THIRTYDA_SECRET_KEY = crypto.randomBytes(32).toString('hex');
  clearSettingsCache();
  try {
    const d = fakeDb();
    await saveFields(d, 'telegram_bot', { token: '7012345678:AAFakeE2EkeyABCDEFGHIJKLMNOPQRSTUVwx9',
      hookSecret: 'fake-hook-secret', username: 'FakeGKVerifyBot', botId: '7012345678', hookUrl: 'https://ecom.ggmt.sg/30da/api/telegram/hook' });
    const settings = d.collection('thirtyda_settings');
    const doc = await settings.findOne({ _id: 'telegram_bot' });
    await settings.updateOne({ _id: doc._id }, { $set: { offer: { on: true, mark: `box:${doc.box.iv}`, at: new Date() } } });
    await verificationAdminAction(d, 'PUT', { returnUrl: 'https://iews.example/verify-phone' });
    const { token } = await verificationAdminAction(d, 'POST', {});
    await run({ d, token, now: Date.now(), reference: crypto.randomUUID(), phone: '+85512345678' });
  } finally {
    if (before === undefined) delete process.env.THIRTYDA_SECRET_KEY; else process.env.THIRTYDA_SECRET_KEY = before;
    clearSettingsCache();
  }
}

test('IEWS check requires own Telegram contact; collection is isolated, expiring and retryable', () => fixture(async ({ d, token, now, reference, phone }) => {
  const check = await verificationRequest(d, 'POST', '/requests', { phone, reference }, token, now);
  const again = await verificationRequest(d, 'POST', '/requests', { phone, reference }, token, now);
  assert.equal(check.telegram_url, again.telegram_url);
  const linkToken = new URL(check.telegram_url).searchParams.get('start');
  const path = `/requests/${check.request_id}`;
  const context = await processUpdate(d, { kind: 'start', token: linkToken, fromId: 33 }, now);
  assert.equal(context.context.appName, 'IEWS');
  assert.match(botReply('ask', 'en', 33, context.vars, context.context).text, /IEWS/);
  assert.equal(backReply('en', 33, undefined, context.context).reply_markup.inline_keyboard[0][0].url, 'https://iews.example/verify-phone');
  const other = await processUpdate(d, { kind: 'start', token: linkToken, fromId: 99 }, now);
  assert.equal(other.kind, 'expired');
  const badContact = await processUpdate(d, { kind: 'contact', fromId: 33, contact: { userId: 99, phone } }, now);
  assert.equal(badContact.kind, 'not_own');
  await assert.rejects(verificationRequest(d, 'POST', `${path}/consume`, {}, token, now), { code: 'not_verified' });
  const done = await processUpdate(d, { kind: 'contact', fromId: 33, contact: { userId: 33, phone } }, now);
  assert.equal(done.kind, 'done');
  assert.doesNotMatch(botReply('done', 'en', 33, null, done.context).text, /logged in|30\+DA/);
  assert.equal(d.collections.get('thirtyda_tg_links'), undefined);
  assert.equal((await verificationRequest(d, 'GET', path, {}, token, now)).status, 'verified');
  const proof = await verificationRequest(d, 'POST', `${path}/consume`, {}, token, now);
  assert.equal(proof.phone, phone); assert.equal(proof.reference, reference); assert.equal(proof.app, 'iews');
  assert.deepEqual(await verificationRequest(d, 'POST', `${path}/consume`, {}, token, now), proof);
  assert.equal(d.collections.get('thirtyda_users'), undefined);
  const stored = [...d.collections.get(TG_CHECKS).values()][0];
  assert.equal(stored.browser, undefined); assert.ok(!JSON.stringify(stored).includes(linkToken));
  await assert.rejects(verificationRequest(d, 'POST', `${path}/consume`, {}, token, now + CHECK_TTL_MS + 1), { code: 'expired' });
}));

test('wrong number, reused reference, revoked key and rotated key cannot grant verification', () => fixture(async ({ d, token, now, phone, reference }) => {
  const check = await verificationRequest(d, 'POST', '/requests', { phone, reference }, token, now);
  await assert.rejects(verificationRequest(d, 'POST', '/requests', { phone: '+85598765432', reference }, token, now), { code: 'reference_conflict' });
  const startToken = new URL(check.telegram_url).searchParams.get('start');
  await processUpdate(d, { kind: 'start', token: startToken, fromId: 77 }, now);
  assert.equal((await processUpdate(d, { kind: 'contact', fromId: 77, contact: { userId: 77, phone: '+85598765432' } }, now)).kind, 'mismatch');
  await assert.rejects(verificationRequest(d, 'POST', `/requests/${check.request_id}/consume`, {}, token, now), { code: 'not_verified' });
  await verificationAdminAction(d, 'DELETE', {});
  await assert.rejects(verificationRequest(d, 'GET', `/requests/${check.request_id}`, {}, token, now), { code: 'unauthorized' });
  const replacement = await verificationAdminAction(d, 'POST', {});
  await assert.rejects(verificationRequest(d, 'GET', `/requests/${check.request_id}`, {}, replacement.token, now), { code: 'not_found' });
}));

test('server controls the return target and rejects malformed inputs', () => fixture(async ({ d, token, now, phone, reference }) => {
  for (const returnUrl of ['http://iews.example/verify', 'https://user:pass@iews.example/verify', 'https://iews.example/verify?proof=true']) {
    await assert.rejects(verificationAdminAction(d, 'PUT', { returnUrl }), { code: 'invalid' });
  }
  await assert.rejects(verificationRequest(d, 'POST', '/requests', { phone: '012345678', reference }, token, now), { code: 'invalid_phone' });
  await assert.rejects(verificationRequest(d, 'POST', '/requests', { phone, reference: 'user-1' }, token, now), { code: 'invalid_reference' });
  await assert.rejects(verificationRequest(d, 'POST', '/requests', { phone, reference }, 'fake', now), { code: 'unauthorized' });
}));
