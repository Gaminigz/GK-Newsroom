// Run: npm run 30da:test (or node --test src/lib/thirtyda-verify.test.mjs)
// "Verify to chat" (owner 2026-10-13, src/lib/thirtyda-verify.mjs): which profiles may talk, which routes talk to
// another person (checked against EVERY real route of src/lib/thirtyda-app.mjs), the per-address limit on profiles
// made without a verification, and the way back from Google / Facebook / TikTok. No database, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VERIFIED_WAYS, canTalk, TALK_ROUTES, OPEN_WRITES, talksToSomeone, UNVERIFIED_PER_DAY, ppDay, signupKey, claimSignup,
  releaseSignup, verifyBackPath, VERIFY_BACK_REASONS, ATTACH_FROM, PHONE_VIAS, phoneViaOf, withPhoneVia, signinsOf,
} from './thirtyda-verify.mjs';
import { API_ROUTES, meView } from './thirtyda-app.mjs';

// ---------------------------------------------------------------- who may talk

test('canTalk: any one verified way (phone, Google, Facebook, TikTok) — nothing else', () => {
  assert.deepEqual(VERIFIED_WAYS, ['phone', 'gmail', 'facebook', 'tiktok']);
  for (const way of VERIFIED_WAYS) assert.equal(canTalk({ verified: { [way]: true } }), true, way);
  assert.equal(canTalk({ verified: { phone: false, gmail: false, facebook: false, tiktok: false } }), false, 'a profile made without verifying');
  assert.equal(canTalk({ verified: {} }), false);
  assert.equal(canTalk({}), false);
  assert.equal(canTalk(null), false);
  assert.equal(canTalk(undefined), false);
  assert.equal(canTalk({ verified: { phone: 'true' } }), false, 'only a real true counts');
  assert.equal(canTalk({ verified: { email: true } }), false, 'not a way the app has');
  assert.equal(canTalk({ phone: '+85512345678', phoneUnverified: '+85512345678', verified: { phone: false } }), false, 'a number typed without a code is not a way');
});

// ---------------------------------------------------------------- the gate list

// One sample per real route: [method, path, talks to another person].
const SAMPLES = [
  ['GET', '/auth/methods', false], ['POST', '/auth/send-code', false], ['POST', '/auth/verify-code', false],
  ['POST', '/auth/verify-social', false], ['POST', '/auth/telegram/start', false], ['GET', '/auth/telegram/status', false],
  ['POST', '/auth/signout', false], ['POST', '/profile', false], ['GET', '/me', false], ['PATCH', '/me', false],
  ['POST', '/me/photos', false], ['PUT', '/me/photos/1', false], ['DELETE', '/me/photos/2', false],
  ['POST', '/me/location', false], ['POST', '/me/heartbeat', false], ['GET', '/me/pending', false],
  ['POST', '/me/lock', false], ['POST', '/me/unlock', false],
  ['POST', '/me/pin', false], ['POST', '/me/pin/forgot', false], ['POST', '/notices/n-1/seen', false],
  ['GET', '/photos/0123456789abcdef0123456789abcdef', false],
  // Looking around: Nearby, a profile, my conversations, the questions — never gated.
  ['GET', '/nearby', false], ['POST', '/guest/nearby', false], ['GET', '/people/U-10231', false], ['GET', '/pairs', false], ['GET', '/pairs/P-1', false],
  ['GET', '/pairs/P-1/conversation', false], ['GET', '/questions', false], ['GET', '/pairs/P-1/incoming', false],
  ['GET', '/pairs/P-1/outgoing', false], ['GET', '/pairs/P-1/messages', false],
  // Talking to someone: gated until the profile has a verified way.
  ['POST', '/pairs', true], ['POST', '/pairs/P-1/sets', true], ['PUT', '/pairs/P-1/replies', true],
  ['POST', '/pairs/P-1/answers', true], ['POST', '/pairs/P-1/decide', true], ['POST', '/pairs/P-1/messages', true],
  // Writes that do not reach the other person: my own reminder, a report to the admin (always open).
  ['POST', '/pairs/P-1/remind', false], ['POST', '/pairs/P-1/messages/M-1/report', false],
];

test('gate: every route of the real router has a sample, and only the 6 that talk to someone are gated', () => {
  for (const { method, re } of API_ROUTES) {
    assert.ok(SAMPLES.some(([m, p]) => m === method && re.test(p)), `route ${method} ${re} has a sample (a new route must say whether it talks to someone)`);
  }
  for (const [method, path, want] of SAMPLES) {
    assert.ok(API_ROUTES.some((r) => r.method === method && r.re.test(path)), `${method} ${path} is a real route`);
    assert.equal(talksToSomeone(method, path), want, `${method} ${path}`);
  }
  assert.equal(SAMPLES.filter(([, , talks]) => talks).length, TALK_ROUTES.length);
});

test('gate: every write under /pairs is either gated or knowingly open (remind, report)', () => {
  const writes = API_ROUTES.filter((r) => r.method !== 'GET' && /pairs/.test(String(r.re)));
  assert.ok(writes.length >= 8);
  for (const r of writes) {
    const sample = SAMPLES.find(([m, p]) => m === r.method && r.re.test(p));
    const gated = TALK_ROUTES.some(([m, re]) => m === r.method && String(re) === String(r.re));
    const open = OPEN_WRITES.some(([m, re]) => m === r.method && String(re) === String(r.re));
    assert.ok(gated !== open, `${r.method} ${r.re}: in exactly one list`);
    assert.equal(talksToSomeone(sample[0], sample[1]), gated);
  }
});

test('gate: methods and look-alike paths are not confused', () => {
  assert.equal(talksToSomeone('GET', '/pairs'), false, 'listing my conversations');
  assert.equal(talksToSomeone('GET', '/pairs/P-1/messages'), false, 'reading the chat');
  assert.equal(talksToSomeone('PUT', '/pairs/P-1/sets'), false);
  assert.equal(talksToSomeone('POST', '/pairs/P-1/replies'), false, 'replies are PUT');
  assert.equal(talksToSomeone('POST', '/pairs/P-1/messages/M-9/report'), false);
  assert.equal(talksToSomeone('POST', '/pairs/P-1/messages/x'), false);
  assert.equal(talksToSomeone('POST', '/pairs/P-1/sets/extra'), false, 'not a real route (404 anyway)');
  assert.equal(talksToSomeone('POST', '/pairsx'), false);
  assert.equal(talksToSomeone('POST', ''), false);
  assert.equal(talksToSomeone('POST', undefined), false);
});

// ---------------------------------------------------------------- per-address limit

/** A tiny stand-in for a Mongo collection: atomic findOneAndUpdate ($inc / $setOnInsert / upsert) and updateOne. */
function fakeCollection() {
  const docs = new Map();
  const tick = () => new Promise((r) => setImmediate(r));
  const matches = (doc, filter) => Object.entries(filter).every(([k, v]) => {
    if (v && typeof v === 'object' && '$gt' in v) return (doc?.[k] ?? 0) > v.$gt;
    return doc?.[k] === v;
  });
  return {
    docs,
    async findOneAndUpdate(filter, update, opts) {
      await tick();
      let doc = docs.get(filter._id);
      if (!doc) {
        if (!opts.upsert) return null;
        doc = { _id: filter._id, ...(update.$setOnInsert || {}) };
        docs.set(doc._id, doc);
      }
      for (const [k, v] of Object.entries(update.$inc || {})) doc[k] = (doc[k] ?? 0) + v;
      return { ...doc };
    },
    async updateOne(filter, update) {
      await tick();
      const doc = docs.get(filter._id);
      if (!doc || !matches(doc, filter)) return { matchedCount: 0 };
      for (const [k, v] of Object.entries(update.$inc || {})) doc[k] = (doc[k] ?? 0) + v;
      return { matchedCount: 1 };
    },
  };
}

const NOON = Date.parse('2026-10-13T05:00:00Z'); // 12:00 in Phnom Penh

test(`claimSignup: ${UNVERIFIED_PER_DAY} per address per day, then refused; a refused try leaves nothing behind`, async () => {
  assert.equal(UNVERIFIED_PER_DAY, 3);
  const coll = fakeCollection();
  for (let i = 1; i <= 3; i++) assert.equal((await claimSignup(coll, '203.0.113.7', { now: NOON + i })).ok, true, `#${i}`);
  const fourth = await claimSignup(coll, '203.0.113.7', { now: NOON + 10 });
  assert.deepEqual(fourth, { ok: false, key: null });
  assert.equal(coll.docs.get(signupKey('203.0.113.7', NOON)).n, 3, 'the refused one is not counted');
  assert.equal((await claimSignup(coll, '203.0.113.8', { now: NOON })).ok, true, 'another address has its own 3');
  assert.equal((await claimSignup(coll, '2001:db8::1', { now: NOON })).ok, true, 'IPv6 too');
});

test('claimSignup: parallel tries never pass the limit', async () => {
  const coll = fakeCollection();
  const results = await Promise.all(Array.from({ length: 12 }, () => claimSignup(coll, '198.51.100.20', { now: NOON })));
  assert.equal(results.filter((r) => r.ok).length, 3);
  assert.equal(coll.docs.get(signupKey('198.51.100.20', NOON)).n, 3);
});

test('releaseSignup: a profile that was not made gives its place back (never below 0)', async () => {
  const coll = fakeCollection();
  const a = await claimSignup(coll, '198.51.100.30', { now: NOON });
  await claimSignup(coll, '198.51.100.30', { now: NOON });
  await claimSignup(coll, '198.51.100.30', { now: NOON });
  assert.equal((await claimSignup(coll, '198.51.100.30', { now: NOON })).ok, false);
  await releaseSignup(coll, a.key);
  assert.equal((await claimSignup(coll, '198.51.100.30', { now: NOON })).ok, true, 'one place came back');
  await releaseSignup(coll, null); // nothing claimed (a verified sign-up): nothing to give back
  const key = signupKey('198.51.100.31', NOON);
  coll.docs.set(key, { _id: key, n: 0 });
  await releaseSignup(coll, key);
  assert.equal(coll.docs.get(key).n, 0);
});

test('the day is Phnom Penh\'s: a new day at 00:00 UTC+7 brings 3 new places; the counter goes 2 days later', async () => {
  assert.equal(ppDay(Date.parse('2026-10-13T16:59:59Z')), '2026-10-13');
  assert.equal(ppDay(Date.parse('2026-10-13T17:00:00Z')), '2026-10-14');
  const coll = fakeCollection();
  const late = Date.parse('2026-10-13T16:30:00Z');
  for (let i = 0; i < 3; i++) await claimSignup(coll, '192.0.2.5', { now: late });
  assert.equal((await claimSignup(coll, '192.0.2.5', { now: late })).ok, false);
  const nextDay = Date.parse('2026-10-13T17:05:00Z');
  assert.equal((await claimSignup(coll, '192.0.2.5', { now: nextDay })).ok, true);
  const doc = coll.docs.get(signupKey('192.0.2.5', late));
  assert.equal(doc.purgeAt.getTime(), late + 2 * 864e5);
});

test('signupKey: a hash of day + address, never the address itself', () => {
  const k = signupKey('203.0.113.7', NOON);
  assert.match(k, /^[a-f0-9]{64}$/);
  assert.ok(!k.includes('203'));
  assert.notEqual(k, signupKey('203.0.113.8', NOON));
  assert.notEqual(k, signupKey('203.0.113.7', NOON + 864e5));
  assert.equal(k, signupKey('203.0.113.7', NOON + 3600e3), 'same day, same counter');
});

// ---------------------------------------------------------------- the way back

test('verifyBackPath: #/verified with ok=1 or a reason the app knows', () => {
  assert.equal(verifyBackPath('google', { ok: true }), '/30da/#/verified?signin=google&ok=1');
  assert.equal(verifyBackPath('tiktok', { reason: 'in_use' }), '/30da/#/verified?signin=tiktok&error=in_use');
  for (const reason of VERIFY_BACK_REASONS) assert.equal(verifyBackPath('facebook', { reason }), `/30da/#/verified?signin=facebook&error=${reason}`);
  assert.equal(verifyBackPath('google', { reason: 'bad_keys' }), '/30da/#/verified?signin=google&error=failed', 'anything else is "failed"');
  assert.equal(verifyBackPath('google'), '/30da/#/verified?signin=google&error=failed');
});

// ---------------------------------------------------------------- #/me: the 5 ways (owner 2026-10-13)

test('verifyBackPath to: me — a sign-in started on #/me comes back to #/me; anything else still #/verified', () => {
  assert.deepEqual(ATTACH_FROM, ['me']);
  assert.equal(verifyBackPath('google', { ok: true, to: 'me' }), '/30da/#/me?signin=google&ok=1');
  assert.equal(verifyBackPath('tiktok', { reason: 'in_use', to: 'me' }), '/30da/#/me?signin=tiktok&error=in_use');
  assert.equal(verifyBackPath('facebook', { reason: 'nope', to: 'me' }), '/30da/#/me?signin=facebook&error=failed');
  assert.equal(verifyBackPath('google', { ok: true, to: 'nearby' }), '/30da/#/verified?signin=google&ok=1', 'only screens on the list');
  assert.equal(verifyBackPath('google', { ok: true, to: null }), '/30da/#/verified?signin=google&ok=1');
});

/** Apply a Mongo-style { $set, $unset } to a plain object (enough for withPhoneVia). */
function applyUpdate(doc, update) {
  const out = { ...doc };
  for (const [k, v] of Object.entries(update.$set || {})) out[k] = v;
  for (const k of Object.keys(update.$unset || {})) delete out[k];
  return out;
}

test('phoneVia: only telegram / whatsapp / sms are kept', () => {
  assert.deepEqual(PHONE_VIAS, ['telegram', 'whatsapp', 'sms']);
  for (const v of PHONE_VIAS) assert.equal(phoneViaOf(v), v);
  for (const v of [null, undefined, '', 'Telegram', 'email', 1, {}]) assert.equal(phoneViaOf(v), null, String(v));
});

test('phoneVia is set by a verify, REPLACED by the next one, cleared when the way is not known', () => {
  let u = { _id: 'U-1', phone: '+85512345678', verified: { phone: false } };
  // The Telegram bot proved it.
  u = applyUpdate(u, withPhoneVia({ $set: { 'verified.phone': true } }, 'telegram'));
  assert.equal(u.phoneVia, 'telegram');
  assert.equal(u['verified.phone'], true, 'the rest of the update is kept');
  // A code by WhatsApp later: replaces it.
  u = applyUpdate(u, withPhoneVia({ $set: { 'verified.phone': true } }, 'whatsapp'));
  assert.equal(u.phoneVia, 'whatsapp');
  // A code whose channel is not known (an old code): the last way goes — never a stale ✓.
  u = applyUpdate(u, withPhoneVia({ $set: { 'verified.phone': true } }, null));
  assert.equal('phoneVia' in u, false);
  // Merges with an update that already unsets something (a number change drops phoneUnverified).
  const up = withPhoneVia({ $set: { phone: '+85599999999' }, $unset: { phoneUnverified: '' } }, 'sms');
  assert.deepEqual(up, { $set: { phone: '+85599999999', phoneVia: 'sms' }, $unset: { phoneUnverified: '' } });
  assert.deepEqual(withPhoneVia({ $unset: { phoneUnverified: '' } }, 'bad'), { $unset: { phoneUnverified: '', phoneVia: '' } });
  assert.deepEqual(withPhoneVia(), { $unset: { phoneVia: '' } });
});

test('signinsOf: which sign-ins are on the profile, booleans only (never the ids)', () => {
  assert.deepEqual(signinsOf(null), { google: false, facebook: false, tiktok: false });
  assert.deepEqual(signinsOf({ signin: { google: { id: 'g-123', email: 'a@b.c' }, tiktok: { id: 't-9' } } }), { google: true, facebook: false, tiktok: true });
  assert.deepEqual(signinsOf({ signin: { facebook: {} } }), { google: false, facebook: false, tiktok: false }, 'no id: not on the profile');
});

test('meView: phoneVia (owner only, only for a verified number) and the sign-ins as booleans — no ids, no emails', () => {
  const base = {
    _id: 'U-7', name: 'Dara', phone: '+85512345678', photos: [], hearts: { red: 0, orange: 0 },
    verified: { phone: true, gmail: true, facebook: false, tiktok: true },
    signin: { google: { id: 'google-sub-123', email: 'dara@example.com' }, tiktok: { id: 'tt-open-456' } },
  };
  const v = meView({ ...base, phoneVia: 'whatsapp' });
  assert.equal(v.phoneVia, 'whatsapp');
  assert.deepEqual(v.signins, { google: true, facebook: false, tiktok: true });
  assert.deepEqual(v.verified, { phone: true, gmail: true, facebook: false, tiktok: true });
  const json = JSON.stringify(v);
  for (const secret of ['google-sub-123', 'tt-open-456', 'dara@example.com']) assert.equal(json.includes(secret), false, secret);
  assert.equal('signin' in v, false);
  // Verified before phoneVia was kept: not known (no app ✓; "Number verified ✓" still shows from verified.phone).
  assert.equal(meView(base).phoneVia, null);
  assert.equal(meView({ ...base, phoneVia: 'carrier-pigeon' }).phoneVia, null);
  // A number that is not verified (or none) never carries a way.
  assert.equal(meView({ ...base, phoneVia: 'telegram', verified: { phone: false } }).phoneVia, null);
  assert.equal(meView({ ...base, phone: null, phoneVia: 'telegram' }).phoneVia, null);
  assert.deepEqual(meView({ _id: 'U-8', name: 'X', photos: [] }).signins, { google: false, facebook: false, tiktok: false });
});
