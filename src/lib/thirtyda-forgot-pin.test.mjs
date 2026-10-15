// Run: npm run 30da:test (or node --test src/lib/thirtyda-forgot-pin.test.mjs)
// The lock screen, owner 2026-10-15 (testing the live app with the App review accounts Sophea 1122, Dara 3344, Sopal 5566,
// Meng 7788, review sign-in ON):
//   A. "Test accounts switch by PIN": on a demo account's OWN lock screen, ANOTHER demo account's PIN signs the phone into
//      that account (POST /me/unlock { lockScreen }, decided by the server; the session replaced exactly like POST
//      /auth/review/pin). OFF, a real person's lock, a PIN that is nobody's: "Wrong PIN" as ever. "Forgot PIN?" on a demo
//      account: signed out, back to the visitor "Set your PIN" (#/pin) — its PIN never touched.
//   B. "Forgot PIN?" on a real profile: a SIGN-IN screen (#/signin), never the Create profile form — the profile's own
//      way first (the server answers its ways, names only), "Use another way" behind a link with a warning; signing in
//      the same way reaches the same profile, then "Set a new PIN".
// The routes run for real (pinHandlers from src/lib/thirtyda-app.mjs) on an in-memory Mongo stand-in; the app's side is
// checked in its source (lock.js, app.js, screens/create-profile.js) and its shared rules (shared/ways.js) run as they
// are. No database, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

const { pinHandlers, API_ROUTES } = await import('./thirtyda-app.mjs');
const { hashPin, verifyPin, whileLocked } = await import('./thirtyda-pin.mjs');
const { setReviewSwitch, REVIEW_PIN_TRIES } = await import('./thirtyda-review.mjs');
const { REVIEW_DEVICES } = await import('./thirtyda-review-world.mjs');
const { TERMS_VERSION } = await import('../thirtyda-app/shared/terms.js');
const { waysBackOf, cleanWays, wayButtons, pickWays, SIGNIN_WAYS, PHONE_WAYS, ACCOUNT_WAYS } = await import('../thirtyda-app/shared/ways.js');
const { unlockMe, forgotPin, verifyCode, setPin } = pinHandlers;

const read = (rel) => readFileSync(new URL(`../thirtyda-app/${rel}`, import.meta.url), 'utf8');
const APP_SRC = readFileSync(new URL('./thirtyda-app.mjs', import.meta.url), 'utf8');
const fnBody = (src, name) => {
  const at = src.indexOf(`async function ${name}(`);
  assert.ok(at >= 0, `${name} is there`);
  return src.slice(at, src.indexOf('\n}\n', at));
};

// ---------------------------------------------------------------- an in-memory Mongo, just enough for these routes

const get = (doc, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc);
const val = (v) => (v instanceof Date ? v.getTime() : v);
const same = (v, w) => (Array.isArray(v) ? v.some((x) => val(x) === val(w)) : val(v) === val(w));
function cond(v, want) {
  if (want && typeof want === 'object' && !(want instanceof Date) && !Array.isArray(want) && Object.keys(want).some((k) => k.startsWith('$'))) {
    return Object.entries(want).every(([op, w]) => {
      if (op === '$exists') return (v !== undefined) === w;
      if (op === '$ne') return w === null ? v != null : !same(v, w);
      if (op === '$in') return w.some((x) => same(v, x));
      if (op === '$gt') return v != null && val(v) > val(w);
      if (op === '$gte') return v != null && val(v) >= val(w);
      if (op === '$lt') return v != null && val(v) < val(w);
      if (op === '$lte') return v != null && val(v) <= val(w);
      throw new Error(`fake mongo: ${op}`);
    });
  }
  return want === null ? v == null : same(v, want);
}
const matches = (doc, q = {}) => Object.entries(q).every(([k, w]) => (k === '$or' ? w.some((c) => matches(doc, c)) : cond(get(doc, k), w)));
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
/** The few aggregation expressions an update pipeline here uses (the PIN guard's pinGuardUpdate). */
function expr(doc, x) {
  if (typeof x === 'string' && x.startsWith('$')) return get(doc, x.slice(1)) ?? null;
  if (x === null || typeof x !== 'object' || x instanceof Date || Array.isArray(x)) return x;
  const [[op, args]] = Object.entries(x);
  const a = args.map((y) => expr(doc, y));
  if (op === '$gt') return a[0] != null && val(a[0]) > val(a[1]);
  if (op === '$cond') return a[0] ? a[1] : a[2];
  if (op === '$add') return a[0] + a[1];
  if (op === '$ifNull') return a[0] ?? a[1];
  throw new Error(`fake mongo: ${op}`);
}
function apply(doc, u) {
  if (Array.isArray(u)) {
    for (const stage of u) {
      const out = Object.entries(stage.$set).map(([k, e]) => [k, expr(doc, e)]); // every field from the doc as it was
      for (const [k, v] of out) setPath(doc, k, v);
    }
    return;
  }
  for (const [k, v] of Object.entries(u.$set || {})) setPath(doc, k, v);
  for (const k of Object.keys(u.$unset || {})) unsetPath(doc, k);
  for (const [k, v] of Object.entries(u.$inc || {})) setPath(doc, k, (Number(get(doc, k)) || 0) + v);
  for (const [k, v] of Object.entries(u.$max || {})) if (get(doc, k) == null || val(v) > val(get(doc, k))) setPath(doc, k, v);
}
function fakeDb() {
  const cols = new Map();
  const collection = (name) => {
    if (!cols.has(name)) {
      const docs = new Map();
      const all = (q) => [...docs.values()].filter((x) => matches(x, q));
      cols.set(name, {
        docs,
        async findOne(q) { const x = all(q)[0]; return x ? structuredClone(x) : null; },
        find(q) { return { async toArray() { return all(q).map((x) => structuredClone(x)); } }; },
        async countDocuments(q) { return all(q).length; },
        async insertOne(doc) {
          if (docs.has(doc._id)) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
          docs.set(doc._id ?? crypto.randomUUID(), structuredClone(doc));
          return { insertedId: doc._id };
        },
        async updateOne(q, u, opts = {}) {
          const x = all(q)[0];
          if (!x) {
            if (!opts.upsert) return { matchedCount: 0, modifiedCount: 0 };
            const fresh = { _id: q._id };
            apply(fresh, u);
            docs.set(fresh._id, fresh);
            return { matchedCount: 0, upsertedCount: 1 };
          }
          apply(x, u);
          return { matchedCount: 1, modifiedCount: 1 };
        },
        async findOneAndUpdate(q, u) {
          const x = all(q)[0];
          if (!x) return null;
          apply(x, u);
          return structuredClone(x);
        },
        async deleteOne(q) { const x = all(q)[0]; if (x) docs.delete(x._id); return { deletedCount: x ? 1 : 0 }; },
        async deleteMany(q) { const xs = all(q); xs.forEach((x) => docs.delete(x._id)); return { deletedCount: xs.length }; },
      });
    }
    return cols.get(name);
  };
  return { collection, docs: (name) => [...collection(name).docs.values()] };
}

// ---------------------------------------------------------------- the world: the 4 test accounts and a real person

const USERS = 'thirtyda_users';
const SESSIONS = 'thirtyda_user_sessions';
const AUDIT = 'thirtyda_audit';
const PIN_OF = { 'U-1': '1122', 'U-2': '3344', 'U-3': '5566', 'U-4': '7788', 'U-9': '2580' };
const HASH = Object.fromEntries(await Promise.all(Object.entries(PIN_OF).map(async ([id, pin]) => [id, await hashPin(pin)])));
const AGREED = { version: TERMS_VERSION, at: new Date('2026-10-14T02:00:00Z') };

async function world({ on = true } = {}) {
  const d = fakeDb();
  const users = d.collection(USERS);
  const demo = (id, name, n, extra = {}) => ({
    _id: id, name, demo: 'review', phoneVia: 'review', phone: `+8551000${PIN_OF[id]}${n}`.slice(0, 13), verified: { phone: true },
    pinHash: HASH[id], pinAt: new Date('2026-10-14'), reviewAt: new Date(Date.parse('2026-10-14T01:00:00Z') + n * 60e3), level: 1, photos: [],
    ...extra,
  });
  await users.insertOne(demo('U-1', 'Sophea', 1, { terms: AGREED }));
  await users.insertOne(demo('U-2', 'Dara', 2, { terms: AGREED }));
  await users.insertOne(demo('U-3', 'Sopal', 3));
  await users.insertOne(demo('U-4', 'Meng', 4)); // never agreed to the rules yet (the switch carries the "I agree")
  // A real person: the number proved by the Telegram bot, a Google account kept on the profile, PIN 2580.
  await users.insertOne({
    _id: 'U-9', name: 'Nary', realName: 'Sok Nary', phone: '+85512345678', phoneVia: 'telegram', verified: { phone: true, gmail: true },
    signin: { google: { id: 'g-123456', email: 'nary@example.com' } }, pinHash: HASH['U-9'], pinAt: new Date('2026-10-01'), level: 2,
    photos: [], terms: AGREED,
  });
  await setReviewSwitch(d, on);
  return d;
}

/** A session of `userId` on this phone, LOCKED (the lock screen covers the app). */
async function sessionOf(d, userId, extra = {}) {
  const s = {
    _id: crypto.randomBytes(32).toString('hex'), userId, phone: null, phoneVerified: false, verified: { gmail: false, facebook: false, tiktok: false },
    pinOk: false, activeAt: new Date(), pinTries: 0, created: new Date(), expires: new Date(Date.now() + 864e5), ...extra,
  };
  await d.collection(SESSIONS).insertOne(s);
  return s;
}

let ipSeq = 0;
const nextIp = () => `203.0.113.${++ipSeq}`;
/** The router's ctx for one call (handleApi): this session + its profile, the body, from one address. */
async function ctxOf(d, s, body = {}, { ip = nextIp(), locked = true } = {}) {
  const me = s?.userId ? await d.collection(USERS).findOne({ _id: s.userId }) : null;
  return {
    d, headers: {}, session: s, me, body, locked,
    req: { method: 'POST', headers: { host: 'ecom.ggmt.sg', origin: 'https://ecom.ggmt.sg' }, socket: { remoteAddress: ip } },
  };
}
const sessionIds = (d) => d.docs(SESSIONS).map((x) => x._id).sort();
const isApi = (status, code) => (e) => e.status === status && e.code === code;

// ---------------------------------------------------------------- A. test accounts switch by PIN

test('A: a demo account\'s lock screen + review sign-in ON + ANOTHER demo PIN → this phone is that account now (replaced like POST /auth/review/pin)', async () => {
  const d = await world();
  const s = await sessionOf(d, 'U-1', { reviewSignin: true }); // Sophea, locked
  const ctx = await ctxOf(d, s, { pin: '7788', lockScreen: true });
  const r = await unlockMe(ctx);
  assert.equal(r.switched, true);
  assert.equal(r.ok, true);
  assert.equal(r.existing, true);
  assert.equal(r.user.id, 'U-4', 'Meng');
  assert.equal(r.locked, false, 'open: the PIN was just proven');
  assert.equal(typeof r.lock?.coverMs, 'number');
  // The session is REPLACED: the old one gone, a fresh one for Meng, open, no "new PIN without the old one".
  const left = d.docs(SESSIONS);
  assert.equal(left.length, 1);
  assert.notEqual(left[0]._id, s._id, 'a fresh token (no session fixation)');
  assert.equal(left[0].userId, 'U-4');
  assert.equal(left[0].reviewSignin, true, 'switching OFF ends it like any review sign-in');
  assert.equal(left[0].pinOk, true);
  assert.equal('pinResetUntil' in left[0], false);
  assert.match(String(ctx.headers['Set-Cookie']), new RegExp(`^thirtyda_s=${left[0]._id};`));
  // The "I agree" Sophea made is kept for Meng (no rules screen after the switch); no review PIN was written.
  const meng = await d.collection(USERS).findOne({ _id: 'U-4' });
  assert.equal(meng.terms.version, TERMS_VERSION);
  assert.equal(r.user.terms?.version, TERMS_VERSION, 'the answer says so too');
  for (const id of ['U-1', 'U-2', 'U-3', 'U-4']) assert.equal((await d.collection(USERS).findOne({ _id: id })).pinHash, HASH[id], `${id}'s PIN untouched`);
  // Audited like the demo sign-in (ids only).
  assert.deepEqual(d.docs(AUDIT).map(({ action, via, ok, userId }) => ({ action, via, ok, userId })), [{ action: 'review_signin', via: 'pin', ok: true, userId: 'U-4' }]);
  assert.ok(!JSON.stringify(d.docs(AUDIT)).includes('7788'), 'never the PIN');
  // And Meng's own lock now opens with Meng's PIN, as ever (typed on a Khmer keyboard too).
  const back = await unlockMe(await ctxOf(d, left[0], { pin: '៧៧៨៨', lockScreen: true }));
  assert.equal(back.switched, undefined);
  assert.equal(back.user.id, 'U-4');
});

test('A: the account\'s OWN PIN unlocks as ever (never a switch); Change PIN\'s check (no lockScreen) never switches', async () => {
  const d = await world();
  const s = await sessionOf(d, 'U-1');
  const r = await unlockMe(await ctxOf(d, s, { pin: '1122', lockScreen: true }));
  assert.equal(r.switched, undefined);
  assert.equal(r.user.id, 'U-1');
  assert.deepEqual(sessionIds(d), [s._id], 'the same session');
  assert.equal((await d.collection(SESSIONS).findOne({ _id: s._id })).pinOk, true, 'open again');
  // Change PIN's "Your PIN now" (#/me) posts { pin } only: another demo PIN there is just wrong.
  await assert.rejects(unlockMe(await ctxOf(d, s, { pin: '7788' })), isApi(400, 'wrong_pin'));
  await assert.rejects(unlockMe(await ctxOf(d, s, { pin: '7788', lockScreen: 'yes' })), isApi(400, 'wrong_pin'), 'only lockScreen: true');
  assert.deepEqual(sessionIds(d), [s._id]);
  assert.equal(d.docs(AUDIT).length, 0, 'no demo PIN was even compared');
});

test('A: review sign-in OFF → "Wrong PIN" (nothing compared, nothing replaced)', async () => {
  const d = await world({ on: false });
  const s = await sessionOf(d, 'U-1');
  const ctx = await ctxOf(d, s, { pin: '7788', lockScreen: true });
  await assert.rejects(unlockMe(ctx), isApi(400, 'wrong_pin'));
  assert.deepEqual(sessionIds(d), [s._id]);
  assert.equal(ctx.headers['Set-Cookie'], undefined);
  assert.equal(d.docs(AUDIT).length, 0);
  // Switched ON: the very same PIN switches.
  await setReviewSwitch(d, true);
  assert.equal((await unlockMe(await ctxOf(d, s, { pin: '7788', lockScreen: true }))).user.id, 'U-4');
});

test('A: a REAL person\'s lock screen never matches a demo PIN (a wrong PIN stays "Wrong PIN"); its own PIN opens it', async () => {
  const d = await world();
  const s = await sessionOf(d, 'U-9');
  for (const pin of ['7788', '1122', '3344', '5566']) {
    const ctx = await ctxOf(d, s, { pin, lockScreen: true });
    await assert.rejects(unlockMe(ctx), isApi(400, 'wrong_pin'), pin);
    assert.equal(ctx.headers['Set-Cookie'], undefined, pin);
  }
  assert.deepEqual(sessionIds(d), [s._id], 'still Nary\'s phone');
  assert.equal(d.docs(AUDIT).length, 0, 'never compared with a demo account (no review sign-in tried)');
  const r = await unlockMe(await ctxOf(d, s, { pin: '2580', lockScreen: true }));
  assert.equal(r.user.id, 'U-9');
  assert.equal(r.switched, undefined);
});

test('A: a PIN that is nobody\'s, on a demo account\'s lock → just "Wrong PIN" (never "not a review account")', async () => {
  const d = await world();
  const s = await sessionOf(d, 'U-2');
  const err = await unlockMe(await ctxOf(d, s, { pin: '9999', lockScreen: true })).catch((e) => e);
  assert.equal(err.status, 400);
  assert.equal(err.code, 'wrong_pin');
  assert.equal(err.message, 'That PIN is not right.', 'the lock screen\'s own words');
  assert.deepEqual(err.extra ?? {}, {}, 'no tries count, nothing about review accounts');
  assert.deepEqual(sessionIds(d), [s._id]);
  // Audited like a wrong demo sign-in (ids only) — but it does not use up the review budget (see below).
  assert.deepEqual(d.docs(AUDIT).map(({ ok, reason }) => ({ ok, reason })), [{ ok: false, reason: 'wrong' }]);
});

test('A: wrong PINs on a demo account\'s lock never use up the review budget — "Forgot PIN?" → #/pin, the demo PIN still signs in (never a quiet visitor PIN)', async () => {
  const d = await world();
  const s = await sessionOf(d, 'U-1');
  const ip = nextIp();
  const wrong = REVIEW_PIN_TRIES + 5; // more than the whole budget, still under the session's script guard (40 a minute)
  for (let i = 0; i < wrong; i++) {
    await assert.rejects(unlockMe(await ctxOf(d, s, { pin: '9999', lockScreen: true }, { ip })), isApi(400, 'wrong_pin'), `wrong #${i + 1}`);
  }
  assert.deepEqual(sessionIds(d), [s._id], 'not switched');
  assert.equal(d.docs(AUDIT).filter((x) => x.ok === false && x.reason === 'wrong').length, wrong, 'each one still audited');
  // The visitor "Set your PIN" after "Forgot PIN?" asks first (probe) from the same address: still answered, so 1122
  // signs into Sophea instead of the probe's 429 quietly making it a visitor PIN.
  assert.deepEqual(await pinHandlers.reviewPin(await ctxOf(d, null, { pin: '1122', probe: true }, { ip })), { review: true, name: 'Sophea' });
  assert.equal((await pinHandlers.reviewPin(await ctxOf(d, null, { pin: '1122' }, { ip }))).user.id, 'U-1');
  // And the lock's switch itself still works from that address.
  assert.equal((await unlockMe(await ctxOf(d, await sessionOf(d, 'U-2'), { pin: '7788', lockScreen: true }, { ip }))).user.id, 'U-4');
  // The source: only the lock screen's switch gives its wrong tries back (the visitor screens' count as before).
  const session = fnBody(APP_SRC, 'reviewPinSession');
  assert.match(session, /if \(wrong && !countWrong\) reviewPinTries\.giveBack\(ip, now\);/);
  assert.match(fnBody(APP_SRC, 'reviewLockSwitch'), /reviewPinSession\(ctx, \{ pin, agreement, deviceId: body\.deviceId, countWrong: false \}\)/);
  assert.doesNotMatch(fnBody(APP_SRC, 'reviewPin'), /countWrong/, 'POST /auth/review/pin counts as before');
});

test('A: the review sign-in\'s limits still apply to the switch — a budget used up on the visitor screens → 429 (15 minutes); its own PIN still opens', async () => {
  const d = await world();
  const s = await sessionOf(d, 'U-1');
  const ip = nextIp();
  for (let i = 0; i < REVIEW_PIN_TRIES; i++) {
    await assert.rejects(pinHandlers.reviewPin(await ctxOf(d, null, { pin: '9999', probe: true }, { ip })), isApi(400, 'not_review'), `probe #${i + 1}`);
  }
  const err = await unlockMe(await ctxOf(d, s, { pin: '7788', lockScreen: true }, { ip })).catch((e) => e);
  assert.equal(err.status, 429);
  assert.equal(err.code, 'too_many_attempts');
  assert.match(err.message, /15 minutes/);
  assert.deepEqual(sessionIds(d), [s._id], 'not switched');
  // Its own PIN comes first, so the limit never locks the reviewer out of the account the phone is on.
  assert.equal((await unlockMe(await ctxOf(d, s, { pin: '1122', lockScreen: true }, { ip }))).user.id, 'U-1');
  // Another address is not affected.
  assert.equal((await unlockMe(await ctxOf(d, s, { pin: '7788', lockScreen: true }))).user.id, 'U-4');
});

test('A: the decision is the server\'s, inside POST /me/unlock: its own PIN first, then only lockScreen + a demo account', () => {
  const unlock = fnBody(APP_SRC, 'unlockMe');
  assert.match(unlock, /try \{\s*await checkPinTry\(ctx, pin\);\s*\} catch \(err\) \{[^\n]*\n[^\n]*\n?\s*if \(err\?\.code === "wrong_pin" && body\.lockScreen === true && isReview\(me\)\) return reviewLockSwitch\(ctx, pin, err\);\s*throw err;\s*\}/);
  const sw = fnBody(APP_SRC, 'reviewLockSwitch');
  assert.ok(sw.indexOf('reviewSwitch(d)') < sw.indexOf('reviewPinSession('), 'OFF → "Wrong PIN" before anything is compared');
  assert.match(sw, /Object\.assign\(ctx, \{ lockedSession: session, session: null, me: null \}\);/, 'nothing of this session carries over');
  assert.match(sw, /if \(err\?\.code === "not_review" \|\| err\?\.code === "not_found"\) throw wrong;/, 'never "not a review account"');
  assert.doesNotMatch(sw, /pinHash|hashPin|savePin/, 'no review account\'s PIN is written');
  // No new route: the lock screen's own POST /me/unlock (open while locked, like before) and POST /me/pin/forgot.
  assert.deepEqual(API_ROUTES.filter((r) => /unlock|forgot/.test(String(r.re))).map((r) => `${r.method} ${r.re}`), ['POST /^\\/me\\/unlock$/', 'POST /^\\/me\\/pin\\/forgot$/']);
  assert.equal(whileLocked('POST', '/me/unlock'), 'open');
  assert.equal(whileLocked('POST', '/me/pin/forgot'), 'open');
  // The app: the lock screen sends lockScreen and follows a switched answer with the demo sign-in's fresh boot.
  const lock = read('lock.js');
  const body = lock.slice(lock.indexOf('\nasync function unlockBody('), lock.indexOf('\nfunction enterBody('));
  assert.match(body, /return \{ \.\.\.\(await reviewSignInBody\(pin\)\), lockScreen: true \};/);
  const enter = lock.slice(lock.indexOf('\nfunction enterBody('), lock.indexOf('\n// ----', lock.indexOf('\nfunction enterBody(')));
  assert.match(enter, /r = await api\.post\('\/me\/unlock', await unlockBody\(pin\), \{ redirect: false \}\);/);
  assert.match(enter, /if \(r\?\.switched === true\) return reviewSignedIn\(r\);\s*opened\(r\);/);
  // Change PIN's check of the PIN now never sends lockScreen.
  assert.match(lock, /await api\.post\('\/me\/unlock', \{ pin \}, \{ redirect: false \}\);\s*old = pin;/);
});

test('A: the lock screen always sends this phone\'s id and "I agree" — an app opened on a locked session (state.me null) too; only the demo switch reads them', async () => {
  // The app's own unlockBody + reviewSignInBody, run on stand-ins: a cold boot (GET /me answered 423) knows no profile.
  const lock = read('lock.js');
  const fnSrc = (name) => lock.slice(lock.indexOf(`\nasync function ${name}(`) + 1, lock.indexOf('\n}\n', lock.indexOf(`\nasync function ${name}(`)) + 2);
  assert.doesNotMatch(fnSrc('unlockBody'), /state\.me/, 'never decided by the profile in memory');
  const device = crypto.randomUUID();
  const agreement = { termsVersion: TERMS_VERSION, agreedAt: '2026-10-15T01:00:00.000Z' };
  const make = new Function('state', 'deviceId', 'termsBody', `${fnSrc('reviewSignInBody')}\n${fnSrc('unlockBody')}\nreturn unlockBody;`);
  const unlockBody = make({ me: null }, async () => device, () => ({ terms: agreement }));
  const body = await unlockBody('7788');
  assert.deepEqual(body, { pin: '7788', terms: agreement, deviceId: device, lockScreen: true });
  // The server: a demo account's lock switching with them marks this phone a review device (a hash, never the id) ...
  const d = await world();
  const r = await unlockMe(await ctxOf(d, await sessionOf(d, 'U-1'), body));
  assert.equal(r.switched, true);
  assert.equal(r.user.id, 'U-4');
  const marks = d.docs(REVIEW_DEVICES);
  assert.equal(marks.length, 1, 'this phone is a review device again');
  assert.ok(!JSON.stringify(marks).includes(device), 'kept as a hash only');
  // ... and a real person's lock ignores them: nothing marked, its terms untouched, the PIN alone decides.
  const d2 = await world();
  const before = (await d2.collection(USERS).findOne({ _id: 'U-9' })).terms;
  await assert.rejects(unlockMe(await ctxOf(d2, await sessionOf(d2, 'U-9'), { ...body, pin: '7788' })), isApi(400, 'wrong_pin'));
  const opened = await unlockMe(await ctxOf(d2, await sessionOf(d2, 'U-9'), { ...body, pin: '2580' }));
  assert.equal(opened.user.id, 'U-9');
  assert.equal(opened.switched, undefined);
  assert.equal(d2.docs(REVIEW_DEVICES).length, 0);
  assert.deepEqual((await d2.collection(USERS).findOne({ _id: 'U-9' })).terms, before);
});

// ---------------------------------------------------------------- "Forgot PIN?" on a demo account

test('Forgot PIN on a demo account: signed out, { review: true } (→ the visitor "Set your PIN"), its PIN never touched', async () => {
  const d = await world();
  const s = await sessionOf(d, 'U-1');
  const ctx = await ctxOf(d, s);
  assert.deepEqual(await forgotPin(ctx), { ok: true, signedOut: true, ways: [], review: true, agreed: true });
  assert.deepEqual(sessionIds(d), [], 'this phone is signed out');
  assert.match(String(ctx.headers['Set-Cookie']), /^thirtyda_s=; .*Max-Age=0/);
  assert.equal((await d.collection(USERS).findOne({ _id: 'U-1' })).pinHash, HASH['U-1'], 'its PIN stays (the admin page is its only writer)');
  // Meng never agreed to the rules: agreed false (the phone shows them first, like any visitor).
  assert.equal((await forgotPin(await ctxOf(d, await sessionOf(d, 'U-4')))).agreed, false);
  // Back on #/pin the demo PIN signs straight in again (POST /auth/review/pin, the same session rules).
  const again = await pinHandlers.reviewPin(await ctxOf(d, null, { pin: '1122' }));
  assert.equal(again.user.id, 'U-1');
  // The route never writes a profile.
  assert.doesNotMatch(fnBody(APP_SRC, 'forgotPin'), /collection\(C\.users\)|pinHash:|savePin|hashPin/);
});

test('Forgot PIN on a demo account, the app: clearPinFlags + #/pin — never the verify step, never a reset flag', () => {
  const lock = read('lock.js');
  const fn = (name) => lock.slice(lock.indexOf(`\nfunction ${name}(`) + 1, lock.indexOf('\n}\n', lock.indexOf(`\nfunction ${name}(`)) + 2);
  const demo = fn('demoForgot');
  assert.match(demo, /clearPinFlags\(\);\s*if \(agreed\) tab\.set\(REVIEW_BACK_KEY, '1'\);\s*go\('\/pin', \{ replace: true \}\);/);
  assert.doesNotMatch(demo, /markPinReset|\/signin|\/create|api\./);
  const again = lock.slice(lock.indexOf('\nasync function signInAgain('), lock.indexOf('\n}\n', lock.indexOf('\nasync function signInAgain(')));
  assert.match(again, /if \(here\?\.review !== true\) markPinReset\(forgot\);/, 'a demo account here: no "set a new PIN" waits');
  assert.match(again, /if \(r\?\.review === true \|\| \(!r && here\?\.review === true\)\) return demoForgot\(agreed\);/);
  assert.ok(again.indexOf('return demoForgot(') < again.indexOf("go('/signin'"), 'decided before the sign-in screen');
});

test('Forgot PIN on a demo account never makes up an "I agree" on this phone: #/pin skips the rules in this tab only, a visitor meets them next', () => {
  const lock = read('lock.js');
  // Only the rules screen's own "I agree" tap keeps one (screens/rules.js); lock.js never writes one.
  assert.doesNotMatch(lock, /keepAgreement|newAgreement|TERMS_KEY/);
  assert.match(lock, /const REVIEW_BACK_KEY = '30da_review_back';/);
  assert.match(lock, /export const reviewBackPending = \(\) => tab\.get\(REVIEW_BACK_KEY\) === '1';/, 'this tab only, never kept');
  assert.match(lock, /export function clearPinFlags\(\) \{[^}]*tab\.del\(REVIEW_BACK_KEY\);\s*\}/, 'gone with the demo sign-in (reviewSignedIn) or a PIN');
  // What Create profile / a sign-in send as the person's "I agree" is the phone's own agreement only (terms.js).
  const terms = read('terms.js');
  assert.match(terms, /export function termsBody\(\) \{\s*const a = agreedHere\(\);\s*return a \? \{ terms: a \} : \{\};\s*\}/);
  assert.doesNotMatch(terms, /review_back|REVIEW_BACK/);
  // Run app.js's own guard (with visitorRoute and its helpers) on stand-ins for the phone.
  const app = read('app.js');
  const open = app.slice(app.indexOf('const OPEN_PATHS'), app.indexOf('\n', app.indexOf('const OPEN_PATHS')));
  const src = app.slice(app.indexOf('function guard('), app.indexOf('\n}\n', app.indexOf('function visitorRoute(')) + 2);
  const make = new Function('state', 'waitingPin', 'pinResetPending', 'reviewBackPending', 'agreedHere', 'termsNeeded', 'location',
    `${open}\n${src}\nreturn guard;`);
  const guard = (path, { back = false, agreed = false, wait = null } = {}) =>
    make({ me: null, pending: null }, () => wait, () => false, () => back, () => agreed, () => false, { hash: `#${path}` })(path);
  // Right after "Forgot PIN?" on a demo account that agreed: "Set your PIN" opens (a demo PIN → that account, Nearby).
  assert.equal(guard('/pin', { back: true }), null);
  assert.equal(guard('/create', { back: true }), '/pin');
  // A PIN that is no demo account's makes a visitor: the very next screen is the rules — nothing was agreed for them.
  assert.equal(guard('/nearby', { back: true, wait: '1357' }), '/rules');
  assert.equal(guard('/pin', { back: true, wait: '1357' }), '/rules');
  assert.equal(guard('/create', { back: true, wait: '1357' }), '/rules');
  // Without it (another tab, a demo account that never agreed): the rules first, as for any visitor.
  assert.equal(guard('/pin'), '/rules');
  assert.equal(guard('/pin', { agreed: true }), null);
  assert.equal(guard('/opening', { back: true }), null);
});

// ---------------------------------------------------------------- B. "Forgot PIN?" on a real profile

test('Forgot PIN answers the profile\'s own ways back in — names only, never the number, an email, an id or a name', async () => {
  const d = await world();
  const ctx = await ctxOf(d, await sessionOf(d, 'U-9'));
  const r = await forgotPin(ctx);
  assert.deepEqual(r, { ok: true, signedOut: true, ways: ['telegram', 'google'], review: false });
  const said = JSON.stringify(r);
  for (const secret of ['+855', '12345678', 'nary@', 'g-123456', 'U-9', 'Nary', 'Sok']) assert.ok(!said.includes(secret), secret);
  assert.deepEqual(sessionIds(d), [], 'signed out');
  assert.equal((await d.collection(USERS).findOne({ _id: 'U-9' })).pinHash, HASH['U-9'], 'the PIN is not touched until a sign-in sets a new one');
  // Other profiles: an SMS-proved (or not known) number → 'phone'; every account kept; a verified mark without the
  // account's id (test mode) is no way back; a profile made without verifying has none.
  const users = d.collection(USERS);
  const cases = [
    [{ phoneVia: 'sms' }, ['phone', 'google']],
    [{ phoneVia: null }, ['phone', 'google']],
    [{ phoneVia: 'whatsapp', signin: { facebook: { id: 'f1' }, tiktok: { id: 't1' }, apple: { id: 'a1' } }, 'verified.facebook': true, 'verified.tiktok': true, 'verified.apple': true },
      ['whatsapp', 'facebook', 'tiktok', 'apple']],
    [{ 'verified.phone': false, signin: null }, []],
  ];
  for (const [set, want] of cases) {
    await users.updateOne({ _id: 'U-9' }, { $set: set });
    assert.deepEqual((await forgotPin(await ctxOf(d, await sessionOf(d, 'U-9')))).ways, want, JSON.stringify(set));
  }
  // No profile behind the session (a sign-in that never made one), or no session at all: nothing to name.
  assert.deepEqual(await forgotPin(await ctxOf(d, await sessionOf(d, null))), { ok: true, signedOut: true, ways: [], review: false });
  assert.deepEqual((await forgotPin(await ctxOf(d, null))).ways, []);
});

test('Forgot PIN → signing in the SAME way reaches the same profile, then "Set a new PIN" without the old one (once)', async () => {
  const d = await world();
  await forgotPin(await ctxOf(d, await sessionOf(d, 'U-9')));
  assert.deepEqual(sessionIds(d), []);
  // Telegram brings the sign-in code to the same number again (the verify step's own POST /auth/verify-code).
  const phone = '+85512345678';
  const code = '482913';
  await d.collection('thirtyda_otps').insertOne({
    _id: phone, codeHash: crypto.createHash('sha256').update(`${phone}:${code}`).digest('hex'), attempts: 0, channel: 'telegram',
    expires: new Date(Date.now() + 10 * 60e3), sentAt: new Date(),
  });
  const ctx = await ctxOf(d, null, { phone: '+855 12 345 678', code });
  const r = await verifyCode(ctx);
  assert.equal(r.existing, true);
  assert.equal(r.user.id, 'U-9', 'the same profile — never a new one');
  assert.equal(r.user.pinSet, true);
  const [s] = d.docs(SESSIONS);
  assert.equal(s.userId, 'U-9');
  assert.ok(s.pinResetUntil > Date.now(), 'a fresh sign-in may set a new PIN without the old one');
  // "Set a new PIN" (lock.js, after "Forgot PIN?"): no old PIN needed, right after the sign-in.
  Object.assign(ctx, { me: await d.collection(USERS).findOne({ _id: 'U-9' }), locked: false, body: { pin: '5793' } });
  const saved = await setPin(ctx);
  assert.equal(saved.ok, true);
  const after = await d.collection(USERS).findOne({ _id: 'U-9' });
  assert.equal(await verifyPin('5793', after.pinHash), true, 'the new PIN');
  assert.equal(await verifyPin('2580', after.pinHash), false, 'the forgotten one is gone');
  // Used up once: a second new PIN needs the old one.
  Object.assign(ctx, { me: after, session: await d.collection(SESSIONS).findOne({ _id: s._id }), body: { pin: '6824' } });
  await assert.rejects(setPin(ctx), isApi(403, 'old_pin_needed'));
});

test('ways (shared/ways.js): a profile → its ways; a kept list cleaned; the buttons; the #/signin row', () => {
  assert.deepEqual(SIGNIN_WAYS, [...PHONE_WAYS, ...ACCOUNT_WAYS]);
  const me = (o) => ({ verified: { phone: true }, phone: '+85512345678', phoneVia: 'telegram', signins: {}, review: false, ...o });
  assert.deepEqual(waysBackOf(me()), ['telegram']);
  assert.deepEqual(waysBackOf(me({ phoneVia: 'whatsapp' })), ['whatsapp']);
  assert.deepEqual(waysBackOf(me({ phoneVia: 'sms' })), ['phone']);
  assert.deepEqual(waysBackOf(me({ phoneVia: null, signins: { google: true, apple: true } })), ['phone', 'google', 'apple']);
  assert.deepEqual(waysBackOf(me({ verified: { phone: false }, signins: { tiktok: true, facebook: true } })), ['facebook', 'tiktok']);
  assert.deepEqual(waysBackOf(me({ phone: null })), [], 'a verified mark with no number');
  assert.deepEqual(waysBackOf(me({ review: true, signins: { google: true } })), [], 'a demo account signs in by its PIN only');
  assert.deepEqual(waysBackOf(null), []);
  // A list from the answer or the phone's storage: known names only, once each, in order.
  assert.deepEqual(cleanWays(['google', 'telegram', 'google', 'evil', 42, '+85512345678']), ['telegram', 'google']);
  assert.deepEqual(cleanWays('telegram'), []);
  assert.deepEqual(cleanWays(null), []);
  // The round buttons: the phone is the NUMBER (the app that proved it first, then the other code app to it).
  assert.deepEqual(wayButtons(['telegram']), ['telegram', 'whatsapp']);
  assert.deepEqual(wayButtons(['whatsapp']), ['whatsapp', 'telegram']);
  assert.deepEqual(wayButtons(['phone', 'google']), ['telegram', 'whatsapp', 'google']);
  assert.deepEqual(wayButtons(['tiktok', 'facebook']), ['facebook', 'tiktok']);
  assert.deepEqual(wayButtons([]), []);
  // The #/signin row: its own first and alone; "Use another way" → the rest after them; none of its own → every way.
  const row = ['tiktok', 'telegram', 'google', 'facebook', 'whatsapp']; // the usual row (website / Android)
  assert.deepEqual(pickWays(row, ['telegram']), { show: ['telegram'], mine: ['telegram'] });
  assert.deepEqual(pickWays(row, ['telegram'], true), { show: ['telegram', 'tiktok', 'google', 'facebook', 'whatsapp'], mine: ['telegram'] });
  assert.deepEqual(pickWays(row, ['google', 'telegram']), { show: ['google', 'telegram'], mine: ['google', 'telegram'] }, 'in their own order');
  assert.deepEqual(pickWays(row.filter((k) => k !== 'whatsapp'), wayButtons(['whatsapp'])), { show: ['telegram'], mine: ['telegram'] },
    'WhatsApp codes off: Telegram to the same number');
  // Proved by Telegram, Telegram codes off (its button "Coming soon", it says to use WhatsApp): WhatsApp to the same number
  // is right there, marked as its own — never only behind "Use another way" and its NEW-profile warning.
  assert.deepEqual(pickWays(row, wayButtons(['telegram'])), { show: ['telegram', 'whatsapp'], mine: ['telegram', 'whatsapp'] });
  assert.deepEqual(pickWays(row.filter((k) => k !== 'whatsapp'), wayButtons(['telegram'])), { show: ['telegram'], mine: ['telegram'] },
    'WhatsApp codes off too: nothing added');
  assert.deepEqual(pickWays(row, ['apple']), { show: row, mine: [] }, 'Apple outside the iPhone app: every way');
  assert.deepEqual(pickWays(row, []), { show: row, mine: [] }, 'nothing kept: every way');
  assert.deepEqual(pickWays(['apple', ...row], ['apple']), { show: ['apple'], mine: ['apple'] }, 'the iPhone app');
});

test('Forgot PIN, the app: signed out → #/signin with the ways kept (names only) — never the Create profile form', () => {
  const lock = read('lock.js');
  const again = lock.slice(lock.indexOf('\nasync function signInAgain('), lock.indexOf('\n}\n', lock.indexOf('\nasync function signInAgain(')));
  assert.match(again, /r = await api\.post\('\/me\/pin\/forgot', \{\}, \{ redirect: false \}\);/);
  assert.match(again, /const ways = Array\.isArray\(r\?\.ways\) && r\.ways\.length \? r\.ways : waysBackOf\(here\);/, 'the answer, else the profile this phone knows');
  assert.ok(again.indexOf('waysBackOf(here)') < again.indexOf('Object.assign(state, { me: null'), 'read before the profile is dropped');
  assert.match(again, /if \(cleanWays\(ways\)\.length\) keepPinWays\(ways\);[^\n]*\n\s*go\('\/signin', \{ replace: true \}\);/);
  assert.doesNotMatch(lock, /go\('\/create'/, 'lock.js never sends anyone to Create profile any more');
  // Kept on this phone like the "set a new PIN" flag (localStorage: the trip to Google & co., a closed app), names only.
  assert.match(lock, /const WAYS_KEY = '30da_pin_ways';/);
  assert.match(lock, /const keepPinWays = \(ways\) => kept\.set\(WAYS_KEY, JSON\.stringify\(cleanWays\(ways\)\)\);/);
  assert.match(lock, /export function clearPinFlags\(\) \{\s*kept\.del\(WAIT_KEY\);\s*kept\.del\(RESET_KEY\);\s*kept\.del\(WAYS_KEY\);\s*kept\.del\(FORGOT_KEY\);/, 'gone with the new PIN');
  assert.match(lock, /export function pinResetWays\(\) \{[\s\S]*?const ways = cleanWays\(list\);\s*return ways\.length \? ways : null;/);
  // Every caller of the old "back to the sign-in step" goes through it: Forgot PIN?, a locked profile with no PIN, a
  // session that ended elsewhere, a reset whose window ran out.
  assert.ok([...lock.matchAll(/signInAgain\(/g)].length >= 6);
});

test('#/signin says "Forgot your PIN?" only after that button — a session that ended elsewhere or a profile with no PIN gets the same line without it', () => {
  const lock = read('lock.js');
  // Only the lock screen's "Forgot PIN?" button passes forgot; every other way to #/signin does not.
  const calls = [...lock.matchAll(/signInAgain\(([^)]*)\)/g)].map((m) => m[1]).filter((args) => !args.startsWith('{ end = true'));
  assert.deepEqual(calls.filter((args) => args.includes('forgot')), ['{ forgot: true }']);
  assert.match(lock, /class: 'link pin-forgot', on: \{ click: \(\) => signInAgain\(\{ forgot: true \}\) \}/);
  assert.match(lock, /async function signInAgain\(\{ end = true, forgot = false \} = \{\}\)/);
  // Kept on this phone with the "set a new PIN" flag (the trip to Google & co., a closed app); the latest reason wins.
  const mark = lock.slice(lock.indexOf('\nfunction markPinReset('), lock.indexOf('\n}\n', lock.indexOf('\nfunction markPinReset(')) + 3);
  const forgotten = lock.match(/export const pinForgotten = [^\n]+/)[0].replace('export ', '');
  const run = new Function('kept', 'RESET_KEY', 'FORGOT_KEY', `${mark}\n${forgotten}\nreturn { markPinReset, pinForgotten };`);
  const store = new Map();
  const kept = { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v), del: (k) => store.delete(k) };
  const { markPinReset, pinForgotten } = run(kept, 'r', 'f');
  markPinReset(true);
  assert.equal(pinForgotten(), true);
  assert.equal(store.get('r'), '1');
  markPinReset(false); // then the session ended elsewhere
  assert.equal(pinForgotten(), false);
  assert.equal(store.get('r'), '1', 'still "sign in, then a new PIN"');
  // The screen picks its line by it.
  const cp = read('screens/create-profile.js');
  assert.match(cp, /t\(pinForgotten\(\) \? 'pin_forgot_text' : 'pin_signin_text'\)/);
});

test('#/signin "Sign in to set a new PIN": NO profile fields — only the title, one line and the sign-in buttons, the own way first', () => {
  const cp = read('screens/create-profile.js');
  const at = cp.indexOf("screen('/signin',");
  assert.ok(at > 0, 'the screen is there');
  const screenSrc = cp.slice(at, cp.indexOf('\n});\n', at));
  // No photos, app name, birth year, real name, gender, role; never POST /profile.
  assert.doesNotMatch(screenSrc, /photoSource|resizeImage|nameInput|watchNameInput|birthYearSelect|realInput|genderBtns|roleSel|cp_photo|cp_app_name|cp_birth_year|cp_real_name|cp_i_am|cp_you_are|cp_next|\/profile'/);
  assert.match(screenSrc, /el\('h1', \{ class: 'title' \}, t\('pin_forgot_title'\)\)/);
  assert.match(screenSrc, /t\(pinForgotten\(\) \? 'pin_forgot_text' : 'pin_signin_text'\)/);
  // The verify step's own sign-ins (phoneVerifier: Google / Facebook / TikTok, the Telegram bot or code, WhatsApp,
  // Apple in the iPhone app) — nothing of them copied here.
  assert.match(screenSrc, /const phone = phoneVerifier\(signinModel, \{/);
  assert.doesNotMatch(screenSrc, /\/auth\/|location\.assign|shellSignIn|shellAppleSignIn/, 'no provider flow of its own');
  // The profile's own way first, marked, alone; "Use another way" + its warning.
  assert.match(screenSrc, /const own = wayButtons\(pinResetWays\(\) \?\? \[\]\);/);
  // "Use another way" is kept beside the number (module level), so a language switch (a re-render) keeps the other ways.
  assert.match(cp, /let signinModel = blankPhone\(\);\s*let signinAll = false;/);
  assert.match(screenSrc, /const pick = \{\s*own,\s*all: signinAll,/);
  assert.match(screenSrc, /t\('pin_other_way'\)/);
  assert.match(screenSrc, /const showAll = \(\) => \{\s*signinAll = true;\s*phone\.showAll\(\);\s*\};/);
  assert.match(screenSrc, /on: \{ click: showAll \}/);
  assert.equal([...screenSrc.matchAll(/signinModel = blankPhone\(\);\s*signinAll = false;/g)].length, 2, 'reset with the number (signed in, or a new profile)');
  assert.match(screenSrc, /t\('pin_other_warn'\)/);
  assert.match(screenSrc, /other\.hidden = !marked \|\| pick\.all;\s*warn\.hidden = !marked;/, 'the link and its warning only beside the own ways');
  assert.match(screenSrc, /number\.hidden = !numberShown \|\| !mine\.some\(\(key\) => key === 'telegram' \|\| key === 'whatsapp'\);/,
    '"Type the same phone number" only when its own way is the number');
  // Signed back in: welcome back → Nearby, where lock.js asks for the new PIN; a way with no profile → Create profile.
  assert.match(screenSrc, /if \(r\.existing && r\.user\) \{\s*signinModel = blankPhone\(\);\s*signinAll = false;\s*welcomeBack\(r\.user\);\s*\} else newProfile\(\);/);
  assert.match(cp, /function welcomeBack\(user\) \{\s*draft = blankDraft\(\);\s*setMe\(user\);/);
  assert.match(cp, /if \(r\.existing && r\.user\) welcomeBack\(r\.user\);/, 'Create profile\'s own returning sign-in, the same function');
  // The row (phoneVerifier pick): shared/ways.js pickWays decides; no number box without a code app on the row.
  assert.match(cp, /const \{ show, mine \} = pickWays\(\[\.\.\.byKey\.keys\(\)\], pick\.own, pick\.all\);/);
  assert.match(cp, /for \(const key of mine\) byKey\.get\(key\)\.classList\.add\('is-yours'\);/);
  assert.match(cp, /if \(cpLayout\) node\.replaceChildren\(\.\.\.\[numberShown \? phoneRow : null, row, hint,/);
  assert.match(cp, /'data-way': key,/);
  // Without pick (Create profile, the "Verify to chat" sheet, #/me): the row exactly as before.
  assert.match(cp, /function pickRow\(full\) \{\s*if \(!pick\) return full;/);
  // Create profile after "Forgot PIN?" (only a way with no profile gets there): says it makes a NEW profile, and the way back.
  assert.match(cp, /t\('pin_new_profile'\)[\s\S]{0,200}go\('\/signin', \{ replace: true \}\)[\s\S]{0,40}t\('pin_back_signin'\)/);
  assert.doesNotMatch(cp, /pin_signin_again/);
  assert.match(read('app.css'), /\.way\.is-yours \{/, 'the own way is marked');
});

test('the router: during "Forgot PIN?" #/create goes to #/signin (its note too) unless the sign-in found NO profile; #/signin only then', () => {
  const app = read('app.js');
  assert.match(app, /const OPEN_PATHS = new Set\(\['\/opening', '\/rules', '\/pin', '\/create', '\/signin'\]\);/, 'signed in → Nearby, like the other open paths');
  // Run app.js's own visitorRoute (with its helpers) on stand-ins for the phone.
  const open = app.slice(app.indexOf('const OPEN_PATHS'), app.indexOf('\n', app.indexOf('const OPEN_PATHS')));
  const from = app.indexOf('const provedHere = ');
  const src = app.slice(from, app.indexOf('\n}\n', app.indexOf('function visitorRoute(', from)) + 2);
  const make = new Function('state', 'waitingPin', 'pinResetPending', 'location', `${open}\n${src}\nreturn visitorRoute;`);
  const route = (path, { reset = false, wait = null, pending = null, hash = `#${path}` } = {}) => make({ pending }, () => wait, () => reset, { hash })(path);
  // "Forgot PIN?": never the Create profile form while nothing was proved — the way back from Google & co. too.
  assert.equal(route('/create', { reset: true }), '/signin');
  assert.equal(route('/create', { reset: true, hash: '#/create?signin=google&error=cancelled' }), '/signin?signin=google&error=cancelled');
  assert.equal(route('/signin', { reset: true }), null, 'it stays');
  assert.equal(route('/create', { reset: true, pending: { verified: { gmail: false } } }), '/signin');
  // A way that found no profile (this session proved it): the NEW profile #/signin warned of.
  assert.equal(route('/create', { reset: true, pending: { phoneVerified: true, phone: '+85512345678' } }), null);
  assert.equal(route('/create', { reset: true, pending: { verified: { gmail: true } } }), null);
  // The back button (or an old link) while signing in again: back to #/signin, not the opening screen.
  assert.equal(route('/nearby', { reset: true }), '/signin');
  assert.equal(route('/me', { reset: true, pending: { verified: { tiktok: true } } }), '/create');
  // Not after "Forgot PIN?": #/signin is not a way in — the usual steps.
  assert.equal(route('/signin'), '/pin');
  assert.equal(route('/signin', { wait: '1357' }), '/create');
  assert.equal(route('/create'), '/pin', 'unchanged: a first-time visitor sets the PIN first');
  assert.equal(route('/create', { wait: '1357' }), null, 'unchanged: a first-time visitor\'s Create profile');
  // The rules screen never comes between "Forgot PIN?" and #/signin (that profile agreed already).
  assert.ok(app.includes("if (where !== '/opening' && where !== '/rules' && !agreedHere() && !pinResetPending()) return '/rules';"));
});

test('5 languages: every new word of "Forgot PIN?" and its sign-in screen in en / km / zh / ko / ja', () => {
  const lock = read('lock.js');
  const keys = ['pin_forgot_title', 'pin_forgot_text', 'pin_signin_text', 'pin_forgot_yours', 'pin_forgot_number', 'pin_other_way', 'pin_other_warn', 'pin_new_profile', 'pin_back_signin'];
  const tables = {};
  for (const lang of ['en', 'km', 'zh', 'ko', 'ja']) {
    const at = lock.indexOf(`  ${lang}: {`, lock.indexOf('registerStrings({'));
    const block = lock.slice(at, lock.indexOf('\n  },', at));
    tables[lang] = Object.fromEntries(keys.map((k) => [k, block.match(new RegExp(`\\n    ${k}: '([^']+)',`))?.[1]]));
    for (const k of keys) assert.ok(tables[lang][k], `${lang}.${k}`);
  }
  assert.equal(tables.en.pin_forgot_title, 'Sign in to set a new PIN');
  assert.equal(tables.en.pin_forgot_text, 'Forgot your PIN? Sign in again the way you signed up, then set a new PIN.');
  assert.equal(tables.en.pin_signin_text, 'Sign in again the way you signed up, then set a new PIN.');
  for (const lang of ['en', 'km', 'zh', 'ko', 'ja']) {
    assert.ok(tables[lang].pin_forgot_text.endsWith(tables[lang].pin_signin_text), `${lang}: the same line, without "Forgot your PIN?"`);
    assert.notEqual(tables[lang].pin_forgot_text, tables[lang].pin_signin_text, lang);
  }
  assert.equal(tables.en.pin_other_way, 'Use another way');
  assert.equal(tables.en.pin_other_warn, 'A different way may make a NEW profile.');
  for (const lang of ['km', 'zh', 'ko', 'ja']) {
    for (const k of keys) assert.notEqual(tables[lang][k], tables.en[k], `${lang}.${k} is translated`);
  }
  assert.ok(tables.km.pin_forgot_title.includes('PIN') && tables.zh.pin_forgot_title.includes('PIN'), 'PIN stays PIN');
  assert.doesNotMatch(lock, /pin_signin_again/, 'the old "Sign in again to set a new PIN." banner of Create profile is gone');
});
