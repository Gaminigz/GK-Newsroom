// Run: npm run 30da:test (or node --test src/lib/thirtyda-review.test.mjs)
// App review accounts (owner 2026-10-14, src/lib/thirtyda-review.mjs): the two worlds both ways, the review code only
// for a review account's mock number and only while the switch is ON, the PIN set exactly as the app sets one, turning a
// profile into a review account and back, what the admin page shows (never a real number in full), and the admin
// routes' sign-in / Origin gates. In-memory Mongo stand-in: no database, no network, no real key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.THIRTYDA_SECRET_KEY ||= crypto.randomBytes(32).toString('hex');

const {
  REVIEW, REVIEW_MAX, REVIEW_DEFAULTS, REVIEW_CODE, REVIEW_SWITCH, REVIEW_WRONG_MAX, isReview, sameWorld, worldFilter, pairsInWorld,
  maskTail, spacedPhone, waysOf, profileRow, reviewNotes, reviewSwitch, setReviewSwitch, newReviewCode, reviewCodeView, sameCode,
  tryCounter, reviewAccountFor, checkReviewCode, makeReviewAccount, stopReviewAccount, reviewPinOf, reviewView, ReviewError,
} = await import('./thirtyda-review.mjs');
const { verifyPin } = await import('./thirtyda-pin.mjs');
const { SETTINGS_COLLECTION, clearSettingsCache } = await import('./thirtyda-settings.mjs');
const { normalizePhone } = await import('./thirtyda-app.mjs');

// ---------------------------------------------------------------- an in-memory Mongo, just enough

const get = (doc, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc);
const val = (v) => (v instanceof Date ? v.getTime() : v);
const eq = (v, want) => (want === null ? v == null : Array.isArray(v) ? v.some((x) => val(x) === val(want)) : val(v) === val(want));
function matches(doc, q) {
  for (const [k, cond] of Object.entries(q || {})) {
    if (k === '$or') { if (!cond.some((c) => matches(doc, c))) return false; continue; }
    const v = get(doc, k);
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond) && Object.keys(cond).some((x) => x.startsWith('$'))) {
      for (const [op, want] of Object.entries(cond)) {
        if (op === '$exists' && (v !== undefined) !== want) return false;
        if (op === '$gte' && !(v != null && val(v) >= val(want))) return false;
        if (op === '$ne' && eq(v, want)) return false;
        if (op === '$in' && !want.some((w) => eq(v, w))) return false;
      }
    } else if (!eq(v, cond)) return false;
  }
  return true;
}
function setPath(doc, path, value) {
  const keys = path.split('.');
  let o = doc;
  for (const k of keys.slice(0, -1)) o = (o[k] ??= {});
  o[keys.at(-1)] = structuredClone(value);
}
function unsetPath(doc, path) {
  const keys = path.split('.');
  let o = doc;
  for (const k of keys.slice(0, -1)) { o = o?.[k]; if (o == null) return; }
  delete o[keys.at(-1)];
}
function apply(doc, u) {
  for (const [k, v] of Object.entries(u.$set || {})) setPath(doc, k, v);
  for (const k of Object.keys(u.$unset || {})) unsetPath(doc, k);
  for (const [k, v] of Object.entries(u.$inc || {})) setPath(doc, k, (Number(get(doc, k)) || 0) + v);
}
function fakeDb() {
  const cols = new Map();
  const collection = (name) => {
    if (!cols.has(name)) {
      const docs = new Map();
      const all = (q) => [...docs.values()].filter((x) => matches(x, q));
      const uniquePhone = (doc, id) => name === 'thirtyda_users' && doc.phone && [...docs.values()].some((x) => x._id !== id && x.phone === doc.phone);
      cols.set(name, {
        docs,
        async findOne(q) { const x = all(q)[0]; return x ? structuredClone(x) : null; },
        find(q) { return { async toArray() { return all(q).map((x) => structuredClone(x)); } }; },
        async countDocuments(q) { return all(q).length; },
        async insertOne(doc) { docs.set(doc._id, structuredClone(doc)); return { insertedId: doc._id }; },
        async updateOne(q, u, opts = {}) {
          const x = all(q)[0];
          if (!x && opts.upsert) {
            const d = { _id: q._id };
            apply(d, u);
            docs.set(d._id, d);
            return { matchedCount: 0, upsertedCount: 1 };
          }
          if (!x) return { matchedCount: 0, modifiedCount: 0 };
          const next = structuredClone(x);
          apply(next, u);
          if (uniquePhone(next, x._id)) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
          docs.set(x._id, next);
          return { matchedCount: 1, modifiedCount: 1 };
        },
        async replaceOne(q, doc, opts = {}) {
          const x = all(q)[0];
          if (!x && !opts.upsert) return { matchedCount: 0 };
          docs.set(doc._id ?? x._id, structuredClone(doc));
          return { matchedCount: x ? 1 : 0 };
        },
        async deleteMany(q) { const xs = all(q); xs.forEach((x) => docs.delete(x._id)); return { deletedCount: xs.length }; },
      });
    }
    return cols.get(name);
  };
  return { collection, docs: (name) => [...collection(name).docs.values()] };
}

const PIN_HASH_OLD = 'scrypt$16384$8$1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';
/** Dara (real number + PIN + Google, 3 photos, Level 3), Sophea (4 photos), Kk (no phone), Nn (blocked). */
async function world() {
  clearSettingsCache();
  const d = fakeDb();
  const users = d.collection('thirtyda_users');
  await users.insertOne({
    _id: 'U-10001', name: 'Dara', birthYear: 1985, level: 3, photos: ['a'.repeat(32), null, 'b'.repeat(32), 'c'.repeat(32)],
    phone: '+85512345678', phoneVia: 'telegram', verified: { phone: true, gmail: true }, signin: { google: { id: 'g1', email: 'dara@example.com' } },
    pinHash: PIN_HASH_OLD, pinAt: new Date('2026-10-01'), createdAt: new Date('2026-10-01'),
  });
  await users.insertOne({
    _id: 'U-10002', name: 'Sophea', birthYear: 1988, level: 3, photos: ['d'.repeat(32), 'e'.repeat(32), 'f'.repeat(32), '1'.repeat(32)],
    phone: '+85598765432', verified: { phone: true }, createdAt: new Date('2026-10-02'),
  });
  await users.insertOne({ _id: 'U-10003', name: 'kk', level: 1, photos: ['2'.repeat(32)], verified: {}, createdAt: new Date('2026-10-10') });
  await users.insertOne({ _id: 'U-10004', name: 'nn', level: 1, photos: [], verified: {}, blocked: true, createdAt: new Date('2026-10-11') });
  await d.collection('thirtyda_pairs').insertOne({ _id: 'P-1', members: ['U-10001', 'U-10002'], a: 'U-10001', b: 'U-10002', stage: 'l3_open', level: 3 });
  await d.collection('thirtyda_pairs').insertOne({ _id: 'P-2', members: ['U-10001', 'U-10003'], a: 'U-10001', b: 'U-10003', stage: 'l1', level: 1 });
  return d;
}
const [DARA_PHONE, SOPHEA_PHONE] = REVIEW_DEFAULTS.map((x) => x.phone);

// ---------------------------------------------------------------- the two worlds

test('worlds: review profiles see only review profiles; real people and guests never see them', () => {
  const real = { _id: 'U-1' };
  const review = { _id: 'U-2', demo: REVIEW };
  const other = { _id: 'U-3', demo: REVIEW };
  assert.equal(isReview(review), true);
  assert.equal(isReview(real), false);
  assert.equal(isReview(null), false, 'a guest is the real world');
  assert.equal(isReview({ demo: 'Review' }), false, 'only the exact mark');
  assert.equal(sameWorld(real, review), false, 'a real person never sees a review account');
  assert.equal(sameWorld(review, real), false, 'a review account never sees a real person');
  assert.equal(sameWorld(null, review), false, 'a guest never sees a review account');
  assert.equal(sameWorld(null, real), true);
  assert.equal(sameWorld(review, other), true, 'two review accounts see each other');
  assert.equal(sameWorld(real, { _id: 'U-4' }), true);
  assert.deepEqual(worldFilter(review), { demo: REVIEW });
  assert.deepEqual(worldFilter(real), { demo: { $ne: REVIEW } });
  assert.deepEqual(worldFilter(null), { demo: { $ne: REVIEW } }, 'a guest: real profiles only');
});

test('worlds: conversations are kept only inside one world (lists, heartbeat, pending count)', async () => {
  const d = await world();
  const dara = await d.collection('thirtyda_users').findOne({ _id: 'U-10001' });
  const pairs = d.docs('thirtyda_pairs');
  assert.deepEqual((await pairsInWorld(d, dara, pairs)).map((p) => p._id), ['P-1', 'P-2'], 'all real: both');
  await d.collection('thirtyda_users').updateOne({ _id: 'U-10002' }, { $set: { demo: REVIEW } });
  assert.deepEqual((await pairsInWorld(d, dara, pairs)).map((p) => p._id), ['P-2'], 'real Dara: the pair with review Sophea is gone');
  const sophea = await d.collection('thirtyda_users').findOne({ _id: 'U-10002' });
  assert.deepEqual((await pairsInWorld(d, sophea, pairs.filter((p) => p.members.includes('U-10002')))).map((p) => p._id), [], 'review Sophea: not with real Dara');
  await d.collection('thirtyda_users').updateOne({ _id: 'U-10001' }, { $set: { demo: REVIEW } });
  const dara2 = await d.collection('thirtyda_users').findOne({ _id: 'U-10001' });
  assert.deepEqual((await pairsInWorld(d, dara2, pairs)).map((p) => p._id), ['P-1'], 'both review: their pair works; the real one is gone');
  assert.deepEqual(await pairsInWorld(d, dara2, []), []);
});

test('the app checks the world in every route that shows or reaches a person (server-side, not only hiding)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./thirtyda-app.mjs', import.meta.url), 'utf8');
  const body = (name) => {
    const i = src.indexOf(`async function ${name}(`);
    assert.ok(i >= 0, name);
    return src.slice(i, src.indexOf('\n}\n', i));
  };
  assert.match(body('nearby'), /worldFilter\(me\)/, 'Nearby');
  assert.match(body('guestNearby'), /worldFilter\(me\)/, 'guest cards');
  assert.match(body('person'), /sameWorld\(me, u\)/, 'a profile');
  assert.match(body('getPhoto'), /sameWorld\(me, owner\)/, 'photos');
  assert.match(body('createPair'), /sameWorld\(me, other\)/, 'start a conversation');
  assert.match(body('pairFor'), /sameWorld\(me, other\)/, 'every conversation route (read and write)');
  for (const fn of ['listPairs', 'heartbeat', 'pendingCount']) assert.match(body(fn), /pairsInWorld\(d, me,/, fn);
  assert.match(body('signInWithPhone'), /if \(isReview\(user\)\) throw phoneInUse\(\)/, 'a review number never signs in by a code or Telegram');
  assert.match(body('sendCode'), /refuseReviewNumber\(d, phone\)/);
  assert.match(body('telegramStart'), /refuseReviewNumber\(d, phone\)/);
});

test('a signed-in review account adds or changes no way in: its number stays the admin\'s, no Google / Facebook / TikTok', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./thirtyda-app.mjs', import.meta.url), 'utf8');
  const body = (name) => {
    const i = src.indexOf(`async function ${name}(`);
    assert.ok(i >= 0, name);
    return src.slice(i, src.indexOf('\n}\n', i));
  };
  // Proving a number (verify-code, the Telegram bot's status) from a review account: refused before anything is written.
  const phone = body('signInWithPhone');
  assert.ok(phone.indexOf('if (isReview(me)) throw reviewFixed();') >= 0, 'signInWithPhone refuses a review account');
  assert.ok(phone.indexOf('if (isReview(me)) throw reviewFixed();') < phone.indexOf('users.updateOne('), '…before any write');
  for (const fn of ['sendCode', 'telegramStart', 'verifySocial']) assert.match(body(fn), /if \(isReview\((ctx\.)?me\)\) throw reviewFixed\(\);/, fn);
  assert.match(body('telegramStatus'), /err\?\.code !== "review_account"/, 'the bot path ends calmly (the check is used up)');
  // Google / Facebook / TikTok: never into a review account, never added to one (the switch and Stop would not stop it).
  const signin = body('completeSignin');
  assert.match(signin, /if \(isReview\(user\) \|\| \(isReview\(ctx\.me\) && !user\)\) return \{ existing: false, refused: "review" \};/);
  assert.ok(signin.indexOf('refused: "review"') < signin.indexOf('planSignin('), '…before any plan is carried out');
  assert.match(src, /const reviewFixed = \(\) => fail\(409, "review_account"/);
  // A renewed review session keeps its mark, so "Stop being a review account" still ends it.
  assert.match(body('startSession'), /if \(session\?\.reviewSignin && doc\.userId && doc\.userId === session\.userId\) doc\.reviewSignin = true;/);
  // The app words both in 5 languages.
  const cp = readFileSync(new URL('../thirtyda-app/screens/create-profile.js', import.meta.url), 'utf8');
  assert.equal((cp.match(/cp_review_fixed: '/g) || []).length, 5, 'cp_review_fixed in en / km / zh / ko / ja');
  for (const f of ['create-profile', 'my-profile', 'verify-chat']) {
    const js = readFileSync(new URL(`../thirtyda-app/screens/${f}.js`, import.meta.url), 'utf8');
    assert.match(js, /'review'\) return \{ ok: false, icon: [A-Z_]+\.review, text: t\('cp_review_fixed'\) \}/, f);
  }
});

// ---------------------------------------------------------------- the switch and the code

test('switch: off until the admin turns it on; read from the database every time', async () => {
  const d = await world();
  assert.deepEqual(await reviewSwitch(d), { on: false, updatedAt: null });
  assert.equal((await setReviewSwitch(d, true)).on, true);
  assert.equal((await reviewSwitch(d)).on, true);
  assert.equal((await setReviewSwitch(d, 'yes')).on, false, 'only a real true turns it on');
  assert.equal(d.docs(SETTINGS_COLLECTION).find((x) => x._id === REVIEW_SWITCH).on, false);
});

test('code: 6 digits, kept sealed (never in plain in the database), a new one replaces it and its wrong-try count', async () => {
  const d = await world();
  const code = await newReviewCode(d);
  assert.match(code, /^\d{6}$/);
  const doc = d.docs(SETTINGS_COLLECTION).find((x) => x._id === REVIEW_CODE);
  assert.ok(doc.box && !JSON.stringify(doc).includes(code), 'sealed');
  assert.equal('last4' in doc, false, 'not even its last 4 digits in plain (that would leave 100 guesses)');
  assert.equal((await reviewCodeView(d)).code, code);
  assert.deepEqual(await checkReviewCode(d, code), { ok: true });
  assert.deepEqual(await checkReviewCode(d, code === '000000' ? '111111' : '000000'), { ok: false, reason: 'wrong' });
  assert.equal((await reviewCodeView(d)).wrong, 1);
  const again = await newReviewCode(d);
  assert.equal((await reviewCodeView(d)).wrong, 0, 'a new code starts from 0');
  assert.equal((await checkReviewCode(d, code)).ok, code === again, 'the old code stops at once');
});

test('code: too many wrong tries in total → it stops working until a New code', async () => {
  const d = await world();
  const code = await newReviewCode(d);
  await d.collection(SETTINGS_COLLECTION).updateOne({ _id: REVIEW_CODE }, { $set: { wrong: REVIEW_WRONG_MAX } });
  assert.deepEqual(await checkReviewCode(d, code), { ok: false, reason: 'blocked' }, 'even the right code');
  assert.equal((await reviewCodeView(d)).blocked, true);
  await newReviewCode(d);
  assert.equal((await reviewCodeView(d)).blocked, false);
  const fresh = await world();
  assert.deepEqual(await checkReviewCode(fresh, '123456'), { ok: false, reason: 'no_code' }, 'no code made yet: nothing works');
});

test('code: compared timing-safe; the try counter counts before the check and gives a right one back', () => {
  assert.equal(sameCode('123456', '123456'), true);
  assert.equal(sameCode('123456', '123457'), false);
  assert.equal(sameCode('', ''), false);
  assert.equal(sameCode(undefined, '123456'), false);
  const c = tryCounter(60e3);
  for (let i = 0; i < 5; i++) assert.equal(c.take('+855', 5, 1000 + i), true);
  assert.equal(c.take('+855', 5, 2000), false, 'the 6th try in the window is refused');
  assert.equal(c.left('+855', 5, 2000), 0);
  c.giveBack('+855', 2000);
  assert.equal(c.take('+855', 5, 2000), true, 'a given-back try can be used again');
  assert.equal(c.take('+855', 5, 70_000), true, 'a new window');
  assert.equal(c.take('+856', 5, 2000), true, 'per number');
});

test('sign-in: the code is for a CURRENT review account mock number only, and only while ON', async () => {
  const d = await world();
  await makeReviewAccount(d, 'U-10001', REVIEW_DEFAULTS[0]);
  assert.equal(await reviewAccountFor(d, DARA_PHONE), null, 'OFF: no review account answers');
  await setReviewSwitch(d, true);
  assert.equal((await reviewAccountFor(d, DARA_PHONE))?._id, 'U-10001', 'ON + its mock number');
  assert.equal(await reviewAccountFor(d, '+85598765432'), null, "a real profile's number: never");
  assert.equal(await reviewAccountFor(d, '+85512345678'), null, "Dara's old real number: never");
  assert.equal(await reviewAccountFor(d, SOPHEA_PHONE), null, 'a number nobody has');
  assert.equal(await reviewAccountFor(d, null), null);
  await d.collection('thirtyda_users').updateOne({ _id: 'U-10001' }, { $set: { blocked: true } });
  assert.equal(await reviewAccountFor(d, DARA_PHONE), null, 'blocked: no');
  await d.collection('thirtyda_users').updateOne({ _id: 'U-10001' }, { $set: { blocked: false, deleting: { at: new Date() } } });
  assert.equal(await reviewAccountFor(d, DARA_PHONE), null, 'being deleted: no');
  await d.collection('thirtyda_users').updateOne({ _id: 'U-10001' }, { $unset: { deleting: '' } });
  await setReviewSwitch(d, false);
  assert.equal(await reviewAccountFor(d, DARA_PHONE), null, 'switched OFF: stops at once');
  // Only the number the admin set (phoneVia 'review'): a review account whose number came another way never takes the code.
  await d.collection('thirtyda_users').updateOne({ _id: 'U-10001' }, { $set: { phoneVia: 'telegram' } });
  assert.equal(await reviewAccountFor(d, DARA_PHONE), null, 'a number not set by the admin: no');
  await d.collection('thirtyda_users').updateOne({ _id: 'U-10001' }, { $set: { phoneVia: 'review' } });
  await setReviewSwitch(d, true);
  await stopReviewAccount(d, 'U-10001');
  assert.equal(await reviewAccountFor(d, DARA_PHONE), null, 'no longer a review account: no');
});

// ---------------------------------------------------------------- turning a profile into a review account and back

test('Use as review account: mock number verified (phoneVia review), the PIN set as the app sets it, the rest untouched', async () => {
  const d = await world();
  const before = await d.collection('thirtyda_users').findOne({ _id: 'U-10001' });
  const u = await makeReviewAccount(d, 'U-10001', { phone: normalizePhone('+855 10 000 1122'), pin: '1122' });
  assert.equal(u.demo, REVIEW);
  assert.equal(u.phone, '+855100001122');
  assert.equal(u.verified.phone, true);
  assert.equal(u.verified.gmail, true, 'other verified ways stay');
  assert.equal(u.phoneVia, 'review');
  assert.equal(await verifyPin('1122', u.pinHash), true, 'the PIN works on the lock screen');
  assert.equal(await verifyPin('2580', u.pinHash), false);
  assert.match(u.pinHash, /^scrypt2?\$16384\$8\$1\$/, "the app's own PIN hash");
  assert.equal(reviewPinOf(u), '1122', 'kept sealed for the review notes');
  assert.ok(!JSON.stringify(u).includes('"1122"'), 'never in plain on the profile');
  for (const k of ['photos', 'birthYear', 'level', 'name', 'signin', 'createdAt']) assert.deepEqual(u[k], before[k], `${k} untouched`);
  assert.deepEqual(d.docs('thirtyda_pairs').map((p) => p.stage), ['l3_open', 'l1'], 'conversations untouched');
  assert.deepEqual(u.reviewWas, { phone: '+85512345678', verifiedPhone: true, phoneVia: 'telegram', pinHash: PIN_HASH_OLD, pinAt: before.pinAt });
  // Saved again with another PIN: still the first reviewWas.
  const again = await makeReviewAccount(d, 'U-10001', { phone: '+855100001122', pin: '4826' });
  assert.equal(await verifyPin('4826', again.pinHash), true);
  assert.equal(again.reviewWas.phone, '+85512345678', 'what to put back is kept from the first time');
});

test('Use as review account: refusals (no profile, blocked, taken number, bad number, weak PIN, too many)', async () => {
  const d = await world();
  const code = async (p) => { try { await p; return 'ok'; } catch (err) { assert.ok(err instanceof ReviewError); return `${err.status} ${err.code}`; } };
  assert.equal(await code(makeReviewAccount(d, 'U-99999', REVIEW_DEFAULTS[0])), '404 not_found');
  assert.equal(await code(makeReviewAccount(d, 'U-10004', REVIEW_DEFAULTS[0])), '409 blocked');
  assert.equal(await code(makeReviewAccount(d, 'U-10001', { phone: '+85598765432', pin: '1122' })), '409 phone_in_use', "Sophea's number");
  assert.equal(await code(makeReviewAccount(d, 'U-10001', { phone: normalizePhone('12'), pin: '1122' })), '422 bad_phone', 'fails the app phone check');
  assert.equal(await code(makeReviewAccount(d, 'U-10001', { phone: DARA_PHONE, pin: '1111' })), '422 bad_pin');
  assert.equal(await code(makeReviewAccount(d, 'U-10001', { phone: DARA_PHONE, pin: '1234' })), '422 bad_pin');
  assert.equal(await code(makeReviewAccount(d, 'U-10001', { phone: DARA_PHONE, pin: '12' })), '422 bad_pin');
  assert.equal(await code(makeReviewAccount(d, 'U-10001', REVIEW_DEFAULTS[0])), 'ok');
  assert.equal(await code(makeReviewAccount(d, 'U-10002', REVIEW_DEFAULTS[0])), '409 phone_in_use', "Dara's mock number");
  assert.equal(await code(makeReviewAccount(d, 'U-10002', REVIEW_DEFAULTS[1])), 'ok');
  for (let i = 0; i < REVIEW_MAX; i++) {
    await d.collection('thirtyda_users').insertOne({ _id: `U-2000${i}`, name: `x${i}`, photos: [], verified: {} });
  }
  assert.equal(await code(makeReviewAccount(d, 'U-20000', { phone: '+855100003366', pin: '3366' })), 'ok');
  assert.equal(await code(makeReviewAccount(d, 'U-20001', { phone: '+855100004488', pin: '4488' })), 'ok');
  assert.equal(await code(makeReviewAccount(d, 'U-20002', { phone: '+855100005577', pin: '5577' })), `409 too_many`, `at most ${REVIEW_MAX}`);
  assert.equal(await code(makeReviewAccount(d, 'U-10001', { phone: DARA_PHONE, pin: '9182' })), 'ok', 'saving an existing one again is fine');
});

test('Stop being a review account: its own number, phoneVia and PIN come back; review sessions end, others stay', async () => {
  const d = await world();
  const sessions = d.collection('thirtyda_user_sessions');
  await sessions.insertOne({ _id: 's-own', userId: 'U-10001', created: new Date('2026-10-05') }); // the owner's phone, from before
  await makeReviewAccount(d, 'U-10001', REVIEW_DEFAULTS[0], { now: Date.parse('2026-10-14T01:00:00Z') });
  await sessions.insertOne({ _id: 's-review', userId: 'U-10001', reviewSignin: true, created: new Date('2026-10-14T02:00:00Z') });
  // A session renewed since (a sign-in step) that lost its mark: it started after the profile became a review account.
  await sessions.insertOne({ _id: 's-renewed', userId: 'U-10001', created: new Date('2026-10-14T03:00:00Z') });
  await sessions.insertOne({ _id: 's-other', userId: 'U-10002', reviewSignin: true });
  const { user, sessionsEnded } = await stopReviewAccount(d, 'U-10001');
  assert.equal(sessionsEnded, 2);
  assert.deepEqual(d.docs('thirtyda_user_sessions').map((s) => s._id).sort(), ['s-other', 's-own']);
  assert.equal(user.demo, undefined);
  assert.equal(user.phone, '+85512345678');
  assert.equal(user.phoneVia, 'telegram');
  assert.equal(user.verified.phone, true);
  assert.equal(user.pinHash, PIN_HASH_OLD);
  for (const k of ['reviewWas', 'reviewPinBox', 'reviewAt']) assert.equal(user[k], undefined, k);
  await assert.rejects(stopReviewAccount(d, 'U-10001'), (e) => e instanceof ReviewError && e.status === 404, 'not a review account any more');

  // A profile with no number / PIN of its own, and one whose number someone else took meanwhile.
  await makeReviewAccount(d, 'U-10003', REVIEW_DEFAULTS[0]);
  const kk = (await stopReviewAccount(d, 'U-10003')).user;
  assert.equal(kk.phone, undefined);
  assert.equal(kk.verified.phone, false);
  assert.equal(kk.pinHash, undefined, 'no PIN of its own: the app asks for one');
  await makeReviewAccount(d, 'U-10002', REVIEW_DEFAULTS[1]);
  await d.collection('thirtyda_users').updateOne({ _id: 'U-10003' }, { $set: { phone: '+85598765432', 'verified.phone': true } });
  const so = (await stopReviewAccount(d, 'U-10002')).user;
  assert.equal(so.phone, undefined, 'its old number has another profile now: not put back');
  assert.equal(so.verified.phone, false);
});

// ---------------------------------------------------------------- the admin page's data

test('page: real numbers masked to the last 3 digits, mock numbers in full, never an email', async () => {
  assert.equal(maskTail('+85512345678'), '•••••••••678');
  assert.equal(maskTail(''), null);
  assert.equal(spacedPhone('+855100001122'), '+855 10 000 1122');
  assert.equal(spacedPhone('+85512345678'), '+855 12 345 678');
  assert.equal(spacedPhone('+6591234567'), '+6591234567');
  const d = await world();
  await makeReviewAccount(d, 'U-10002', REVIEW_DEFAULTS[1]);
  const v = await reviewView(d);
  const raw = JSON.stringify(v.profiles);
  assert.ok(!raw.includes('12345678') && !raw.includes('dara@example.com'), 'no real number, no email');
  const dara = v.profiles.find((p) => p.id === 'U-10001');
  assert.deepEqual(dara, {
    id: 'U-10001', name: 'Dara', created: '2026-10-01T00:00:00.000Z', level: 3, photos: 3, photoMax: 4, birthYear: 1985,
    ways: { phone: '•••••••••678', google: true, facebook: false, tiktok: false }, review: false, blocked: false,
  });
  assert.equal(v.profiles.find((p) => p.id === 'U-10002').ways.phone, '+855 10 000 2244', 'a mock number is not real: shown in full');
  assert.deepEqual(waysOf({ verified: { phone: true } }).phone, null, 'no number: nothing');
  assert.equal(waysOf({ demo: REVIEW, phoneVia: 'telegram', phone: '+85512345678', verified: { phone: true } }).phone, '•••••••••678',
    'a review account whose number the admin did not set: masked like any real number');
  assert.equal(profileRow({ _id: 'U-1', photos: ['x', null, 'y', 'z', 'w'] }).photos, 3, 'slots, max 4');
});

test('page: review accounts with number + PIN + their conversations, and the notes text for the stores', async () => {
  const d = await world();
  await makeReviewAccount(d, 'U-10001', REVIEW_DEFAULTS[0]);
  await makeReviewAccount(d, 'U-10002', REVIEW_DEFAULTS[1]);
  const code = await newReviewCode(d);
  await setReviewSwitch(d, true);
  const v = await reviewView(d);
  assert.equal(v.on, true);
  assert.equal(v.code.code, code);
  assert.deepEqual(v.counts, { profiles: 4, review: 2, real: 2 });
  assert.deepEqual(v.accounts.map((a) => [a.id, a.phone, a.pin, a.photos, a.birthYear, a.level]), [
    ['U-10001', '+855100001122', '1122', 3, 1985, 3], ['U-10002', '+855100002244', '2244', 4, 1988, 3],
  ]);
  assert.deepEqual(v.accounts[0].talks, [{ pairId: 'P-1', with: 'U-10002', withName: 'Sophea', stage: 'l3_open', level: 3 }], 'only the talk with the other review account');
  for (const want of ['Dara', '+855 10 000 1122', 'PIN 1122', 'Sophea', '+855 10 000 2244', 'PIN 2244', `Review code (for every demo account): ${code}`,
    'pick a language', 'Set any 4-digit PIN (used only until you sign in)', 'tap Telegram', 'Enter the review code',
    "From then on the app unlocks with the demo account's PIN (1122 / 2244), not the one from step 2."]) {
    assert.ok(v.notes.includes(want), want);
  }
  assert.ok(!v.notes.includes('12345678'), 'never a real number');
  assert.ok(!v.notes.includes('only locks the app on this phone'), 'the step-2 PIN is not the one that unlocks after sign-in');
  assert.match(reviewNotes({ accounts: [], code: null }), /<no code yet/);
});

// ---------------------------------------------------------------- the admin routes: signed in + same origin only

const { handleThirtyDaAdmin } = await import('./thirtyda-admin.mjs');
async function admin(method, path, headers = {}, body = undefined) {
  const req = { method, url: path, headers: { host: 'ecom.ggmt.sg', ...headers }, resume() {}, on(ev, fn) {
    if (ev === 'data' && body !== undefined) fn(Buffer.from(JSON.stringify(body)));
    if (ev === 'end') setImmediate(fn);
  } };
  const res = { status: null, headers: null, body: undefined };
  res.writeHead = (s, h = {}) => { res.status = s; res.headers = h; return res; };
  res.end = (b) => { res.body = b === undefined ? undefined : String(b); return res; };
  await handleThirtyDaAdmin(req, res, new URL(path, 'https://ecom.ggmt.sg'));
  return res;
}
const JSON_HEADERS = { 'content-type': 'application/json', origin: 'https://ecom.ggmt.sg' };
const WRITES = ['/30da/admin/api/review/switch', '/30da/admin/api/review/code', '/30da/admin/api/review/accounts/U-10001',
  '/30da/admin/api/review/accounts/U-10001/stop', '/30da/admin/api/review/profiles/U-10001/remove'];

test('admin routes: another site, a non-JSON body or no admin session are refused (before any database)', async () => {
  for (const path of WRITES) {
    let r = await admin('POST', path, { ...JSON_HEADERS, origin: 'https://evil.example' }, { on: true });
    assert.equal(r.status, 403, `${path}: foreign Origin`);
    r = await admin('POST', path, { ...JSON_HEADERS, 'sec-fetch-site': 'cross-site' }, { on: true });
    assert.equal(r.status, 403, `${path}: cross-site fetch`);
    r = await admin('POST', path, { origin: 'https://ecom.ggmt.sg', 'content-type': 'text/plain' }, { on: true });
    assert.equal(r.status, 415, `${path}: a form post`);
    r = await admin('POST', path, JSON_HEADERS, { on: true, confirm: 'U-10001', phone: DARA_PHONE, pin: '1122' });
    assert.equal(r.status, 401, `${path}: not signed in`);
  }
  let r = await admin('GET', '/30da/admin/api/review');
  assert.equal(r.status, 401, 'the data: signed in only');
  r = await admin('GET', '/30da/admin/review');
  assert.equal(r.status, 302, 'the page: back to the sign-in');
  assert.equal(r.headers.Location, '/30da/admin');
});

test('admin page: in the sidebar of every admin page; the Code page itself is unchanged apart from that link', async () => {
  const { readFileSync } = await import('node:fs');
  for (const page of ['monitor', 'questions', 'connections', 'support', 'review']) {
    const html = readFileSync(new URL(`../thirtyda-admin/${page}.html`, import.meta.url), 'utf8');
    const nav = html.slice(html.indexOf('<nav class="sidenav"'), html.indexOf('</nav>'));
    assert.match(nav, /href="\/30da\/admin\/review"/, page);
    assert.match(nav, /App review/, page);
  }
  const js = readFileSync(new URL('../thirtyda-admin/review.js', import.meta.url), 'utf8');
  assert.ok(!/innerHTML/.test(js), 'everything from the server goes on the page as text');
  assert.match(js, /confirm\(`Remove \$\{p\.name/, 'Remove asks first, naming the profile');
});
