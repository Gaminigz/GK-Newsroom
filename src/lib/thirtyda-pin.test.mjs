// Run: npm run 30da:test (or node --test src/lib/thirtyda-pin.test.mjs)
// The PIN lock's server rules (src/lib/thirtyda-pin.mjs): the salted scrypt hash, when a session is locked
// (sign-in / PIN, the sliding 2-minute window, background calls that never count), what stays open while
// locked (checked against EVERY real route of src/lib/thirtyda-app.mjs), setting / changing a PIN, and no try
// limit for people (only the script guard). No database, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as pinModule from './thirtyda-pin.mjs';
import {
  SERVER_IDLE_MS, COVER_MS, PIN_RESET_MS, lockInfo, hashPin, verifyPin, lockState, freshSigninFields,
  legacyLockFields, activityAt, backgroundCall, passiveCall, nextActiveAt, whileLocked, pinSetPlan,
  PIN_GUARD_TRIES, PIN_GUARD_MS, nextPinGuard, pinGuardUpdate, pinGuardStop,
  pinHashStale, pepperFrom, PEPPER_MIN,
} from './thirtyda-pin.mjs';
import { API_ROUTES } from './thirtyda-app.mjs';

const MIN = 60e3;

// ---------------------------------------------------------------- hash

const NO_PEPPER = { pepper: null };
const PEPPER = { pepper: 'test-pepper-0123456789abcdef' };

test('hashPin: salted scrypt, never the PIN itself, a new salt every time', async () => {
  const a = await hashPin('2580', NO_PEPPER);
  const b = await hashPin('2580', NO_PEPPER);
  assert.match(a, /^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b, 'same PIN, different salt → different hash');
  assert.ok(!a.includes('2580'));
  await assert.rejects(hashPin('123'), /4 digits/);
  await assert.rejects(hashPin(2580), /4 digits/);
});

test('verifyPin: right / wrong / Khmer digits / damaged or foreign hashes', async () => {
  const h = await hashPin('2580', NO_PEPPER);
  assert.equal(await verifyPin('2580', h), true);
  assert.equal(await verifyPin('២៥៨០', h), true, 'typed on a Khmer keyboard');
  assert.equal(await verifyPin('2581', h), false);
  assert.equal(await verifyPin('0852', h), false);
  assert.equal(await verifyPin('258', h), false);
  assert.equal(await verifyPin('25800', h), false);
  assert.equal(await verifyPin('', h), false);
  assert.equal(await verifyPin('2580', null), false);
  assert.equal(await verifyPin('2580', ''), false);
  assert.equal(await verifyPin('2580', 'plain2580'), false);
  assert.equal(await verifyPin('2580', h.replace('$16384$', '$1048576$')), false, 'a planted huge N is refused, not computed');
  const [pre, , , , salt, key] = h.split('$');
  const otherKey = Buffer.from(key, 'base64url').map((x) => x ^ 1).toString('base64url');
  assert.equal(await verifyPin('2580', [pre, 16384, 8, 1, salt, otherKey].join('$')), false);
});

test('the server pepper: "scrypt2" hashes need THIRTYDA_PIN_PEPPER; a copy of the database alone is not enough', async () => {
  assert.equal(PEPPER_MIN, 16);
  assert.equal(pepperFrom(undefined), null);
  assert.equal(pepperFrom('short'), null, 'under 16 characters: not used');
  assert.equal(pepperFrom('  ' + 'p'.repeat(16) + '  '), 'p'.repeat(16));
  const h = await hashPin('2580', PEPPER);
  assert.match(h, /^scrypt2\$16384\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
  assert.ok(!h.includes(PEPPER.pepper) && !h.includes('2580'), 'neither the pepper nor the PIN is in it');
  assert.notEqual(h, await hashPin('2580', PEPPER), 'a new salt every time');
  assert.equal(await verifyPin('2580', h, PEPPER), true);
  assert.equal(await verifyPin('២៥៨០', h, PEPPER), true, 'typed on a Khmer keyboard');
  assert.equal(await verifyPin('2581', h, PEPPER), false);
  assert.equal(await verifyPin('2580', h, NO_PEPPER), false, 'without the pepper (a database copy): never matches');
  assert.equal(await verifyPin('2580', h, { pepper: 'another-pepper-0123456789' }), false, 'another pepper: never matches');
  // Trying all 10,000 PINs on the stored hash alone (no pepper) finds nothing: the key is not scrypt(PIN, salt).
  const [, , , , salt, key] = h.split('$');
  const crypto = await import('node:crypto');
  const plain = crypto.scryptSync('2580', Buffer.from(salt, 'base64url'), 32, { N: 16384, r: 8, p: 1 }).toString('base64url');
  assert.notEqual(plain, key, 'the right PIN without the pepper gives another key');
  // The same salt + key under the old tag is not accepted as an unpeppered hash either.
  assert.equal(await verifyPin('2580', h.replace(/^scrypt2\$/, 'scrypt$'), NO_PEPPER), false);
});

test('older hashes (no pepper) still open, and are made again with the pepper after the next right PIN', async () => {
  const old = await hashPin('2580', NO_PEPPER);
  assert.match(old, /^scrypt\$/);
  assert.equal(await verifyPin('2580', old, PEPPER), true, 'a server that now has a pepper still opens the old hash');
  assert.equal(pinHashStale(old, PEPPER), true, '→ hashed again with the pepper');
  assert.equal(pinHashStale(old, NO_PEPPER), false, 'no pepper on this server: nothing to do');
  assert.equal(pinHashStale(await hashPin('2580', PEPPER), PEPPER), false);
  assert.equal(pinHashStale(null, PEPPER), false);
  assert.equal(pinHashStale('', PEPPER), false);
});

// ---------------------------------------------------------------- lock state

test('lockState: open only after a sign-in / the PIN, and only inside the idle window', () => {
  const now = Date.parse('2026-10-13T10:00:00Z');
  assert.deepEqual(lockState(null, now), { locked: true, why: 'locked' });
  assert.deepEqual(lockState({}, now), { locked: true, why: 'locked' });
  assert.deepEqual(lockState({ pinOk: false, activeAt: new Date(now) }, now), { locked: true, why: 'locked' });
  assert.deepEqual(lockState({ pinOk: 'yes', activeAt: new Date(now) }, now), { locked: true, why: 'locked' }, 'only true opens');
  assert.deepEqual(lockState({ pinOk: true }, now), { locked: true, why: 'idle' }, 'no activity time → locked');
  assert.deepEqual(lockState({ pinOk: true, activeAt: new Date(now - 2 * MIN) }, now, 2 * MIN), { locked: false, why: null }, 'exactly 2 minutes: still open');
  assert.deepEqual(lockState({ pinOk: true, activeAt: new Date(now - 2 * MIN - 1) }, now, 2 * MIN), { locked: true, why: 'idle' });
  assert.deepEqual(lockState({ pinOk: true, activeAt: new Date(now - 5e3) }, now, 2 * MIN), { locked: false, why: null });
  assert.deepEqual(lockState({ pinOk: true, activeAt: (now - 5e3) }, now, 2 * MIN), { locked: false, why: null }, 'a number works too');
});

test('a fresh sign-in is open, active now, with no tries and a 15-minute window to set a new PIN', () => {
  const now = Date.parse('2026-10-13T10:00:00Z');
  const f = freshSigninFields(now);
  assert.deepEqual(f, { pinOk: true, activeAt: new Date(now), pinTries: 0, pinResetUntil: new Date(now + 15 * MIN) });
  assert.equal(PIN_RESET_MS, 15 * MIN);
  assert.equal(lockState(f, now + 2 * MIN).locked, false);
  assert.equal(lockState(f, now + 2 * MIN + 1).locked, true);
});

test('a session from before the lock: open without a PIN (Set PIN comes next), locked with one', () => {
  const now = 1_000_000;
  assert.deepEqual(legacyLockFields(false, now), { pinOk: true, activeAt: new Date(now), pinTries: 0 });
  assert.deepEqual(legacyLockFields(true, now), { pinOk: false, activeAt: new Date(now), pinTries: 0 });
});

test('activityAt: the app\'s input age decides; the heartbeat alone never counts', () => {
  const now = 10_000_000;
  assert.equal(activityAt(undefined, now), now, 'an API call without the header is activity now');
  assert.equal(activityAt(undefined, now, { background: true }), null, 'a heartbeat without the header is not');
  assert.equal(activityAt('', now, { background: true }), null);
  assert.equal(activityAt('0', now, { background: true }), now, 'a heartbeat right after a touch counts');
  assert.equal(activityAt('45', now), now - 45e3, 'polling 45 s after the last touch counts as 45 s ago');
  assert.equal(activityAt('1.5', now), now - 1500);
  assert.equal(activityAt(['12', '0'], now), now - 12e3, 'the first value of a repeated header');
  assert.equal(activityAt('abc', now), null, 'nonsense is not activity');
  assert.equal(activityAt('-5', now), null);
  assert.ok(Number.isFinite(activityAt('1e30', now)), 'a huge age is clamped, never NaN');
});

test('background calls: the heartbeat and photo loads never count as use without the header', () => {
  const now = 7_000_000;
  assert.equal(backgroundCall('POST', '/me/heartbeat'), true);
  assert.equal(backgroundCall('GET', `/photos/${'a'.repeat(32)}`), true);
  assert.equal(backgroundCall('GET', '/nearby'), false);
  assert.equal(backgroundCall('GET', '/pairs/P-1/conversation'), false, 'polling the conversation carries the header (the app)');
  assert.equal(backgroundCall('POST', '/me/photos'), false, 'an upload is the person acting');
  assert.equal(activityAt(undefined, now, { background: backgroundCall('GET', `/photos/${'b'.repeat(32)}`) }), null);
});

test('GET /me/pending ("something new is waiting") is never use, header or not', () => {
  assert.equal(passiveCall('GET', '/me/pending'), true);
  assert.equal(passiveCall('POST', '/me/pending'), false);
  assert.equal(passiveCall('GET', '/me/pending/x'), false);
  assert.equal(passiveCall('GET', '/me/heartbeat'), false);
  assert.equal(passiveCall('GET', '/nearby'), false);
  assert.equal(passiveCall('GET', undefined), false);
  // A hidden, locked app asks every 5 minutes: the server's window is not moved, so it stays locked.
  const t0 = 90_000_000;
  let session = { ...freshSigninFields(t0) };
  for (let s = 0; s <= 600; s += 30) {
    const at = t0 + s * 1000;
    if (!passiveCall('GET', '/me/pending')) {
      const next = nextActiveAt(session, activityAt('0', at), 2 * MIN);
      if (next) session = { ...session, activeAt: next };
    }
  }
  assert.equal(lockState(session, t0 + 600e3, 2 * MIN).locked, true, 'never kept open by it');
});

test('nextActiveAt: never moves back, writes at most every 5 s (a tenth of a short window)', () => {
  const t0 = 50_000_000;
  const s = { activeAt: new Date(t0) };
  assert.equal(nextActiveAt(s, null), null);
  assert.equal(nextActiveAt(s, t0 - 1000), null, 'an older touch never moves it back');
  assert.equal(nextActiveAt(s, t0 + 5_000, 2 * MIN), null, 'inside 5 s: no write');
  assert.deepEqual(nextActiveAt(s, t0 + 5_001, 2 * MIN), new Date(t0 + 5_001));
  assert.deepEqual(nextActiveAt(s, t0 + 301, 3000), new Date(t0 + 301), 'a 3 s test window writes every 0.3 s');
  assert.deepEqual(nextActiveAt({}, t0), new Date(t0), 'nothing stored yet');
});

test('timeline: an open phone left alone is locked within 2 minutes even though its heartbeat keeps going', () => {
  const t0 = 90_000_000;
  let session = { ...freshSigninFields(t0) };
  const call = (at, header, background = false) => {
    if (lockState(session, at, 2 * MIN).locked) return 423;
    const next = nextActiveAt(session, activityAt(header, at, { background }), 2 * MIN);
    if (next) session = { ...session, activeAt: next };
    return 200;
  };
  // The person uses the app for 50 s (a call every second), then puts the phone down at t0+50 s.
  for (let s = 0; s <= 50; s++) assert.equal(call(t0 + s * 1000, '0'), 200);
  // Heartbeat every 30 s and polling every 5 s carry the growing input age: open for 115 s at least …
  for (let s = 55; s <= 165; s += 5) assert.equal(call(t0 + s * 1000, String(s - 50), s % 30 === 0), 200, `t+${s}s still open`);
  // … and locked no later than 2 minutes after the last touch.
  assert.equal(call(t0 + 170_001, '120', true), 423, '2 minutes after the last touch: locked');
  assert.equal(call(t0 + 172_000, '0'), 423, 'a touch after that does not reopen it: only the PIN does');
});

test('timeline: a person who keeps using the app is never locked by the server', () => {
  const t0 = 90_000_000;
  let session = { ...freshSigninFields(t0) };
  for (let s = 1; s <= 600; s++) {
    const at = t0 + s * 1000;
    assert.equal(lockState(session, at, 2 * MIN).locked, false, `t+${s}s`);
    const next = nextActiveAt(session, activityAt(s % 7 ? '3' : '0', at, { background: s % 30 === 0 }), 2 * MIN);
    if (next) session = { ...session, activeAt: next };
  }
});

// ---------------------------------------------------------------- the 423 gate

// One concrete request per route of the real router, and what a LOCKED session gets for it.
const SAMPLES = [
  ['GET', '/auth/methods', 'open'],
  ['POST', '/auth/send-code', 'signin'],
  ['POST', '/auth/verify-code', 'signin'],
  ['POST', '/auth/verify-social', 'signin'],
  ['POST', '/auth/telegram/start', 'signin'],
  ['GET', '/auth/telegram/status', 'signin'],
  ['POST', '/auth/app/begin', 'signin'], // the native apps: begin a sign-in for the app's sheet
  ['GET', '/auth/app', 'signin'], // …and claim it (the web callback's own lock rule)
  ['GET', '/auth/apple/nonce', 'open'], // Sign in with Apple: a nonce for this web view (signs nobody in)
  ['POST', '/auth/apple', 'signin'], // …the Apple token signs in (the web callback's own lock rule)
  ['POST', '/auth/review/check', 'open'], // App review: does this number use the review code (yes / no only)
  ['POST', '/auth/review/verify', 'signin'], // …the review code signs in like a code (as if signed out)
  ['POST', '/auth/review/pin', 'signin'], // …or "App review": the review account's PIN alone signs in (as if signed out)
  ['POST', '/auth/signout', 'open'],
  ['POST', '/profile', null],
  ['GET', '/me', null],
  ['PATCH', '/me', null],
  ['POST', '/me/terms', null], // "I agree" to the community rules (store policy, owner 2026-10-14): after the PIN
  ['POST', '/me/photos', null],
  ['PUT', '/me/photos/1', null],
  ['DELETE', '/me/photos/2', null],
  ['POST', '/me/location', null],
  ['POST', '/me/heartbeat', null],
  ['GET', '/me/pending', 'open'],
  ['POST', '/me/lock', 'open'],
  ['POST', '/me/unlock', 'open'],
  ['POST', '/me/pin', 'open'],
  ['POST', '/me/pin/forgot', 'open'],
  ['POST', '/me/delete', null], // "Delete my account": only while unlocked (src/lib/thirtyda-delete.mjs)
  ['POST', '/notices/n-1/seen', null],
  ['GET', `/photos/${'a'.repeat(32)}`, null],
  ['GET', '/nearby', null],
  ['POST', '/guest/nearby', null], // a guest has no profile, so never a lock; a locked profile waits like /nearby
  ['POST', '/guest/report', null], // a guest's report on a card: no profile, so never a lock; a locked profile waits
  ['GET', '/people/U-10231', null],
  ['POST', '/pairs', null],
  ['GET', '/pairs', null],
  ['GET', '/pairs/P-1', null],
  ['GET', '/pairs/P-1/conversation', null],
  ['PUT', '/pairs/P-1/replies', null],
  ['GET', '/questions', null],
  ['POST', '/pairs/P-1/sets', null],
  ['GET', '/pairs/P-1/incoming', null],
  ['GET', '/pairs/P-1/outgoing', null],
  ['POST', '/pairs/P-1/answers', null],
  ['POST', '/pairs/P-1/decide', null],
  ['POST', '/pairs/P-1/remind', null],
  ['GET', '/pairs/P-1/messages', null],
  ['POST', '/pairs/P-1/messages', null],
  ['POST', '/pairs/P-1/messages/M-1/report', null],
  // Meetings in the Level 3 chat (owner 2026-10-14, src/lib/thirtyda-meet.mjs): data routes, so locked like the chat.
  ['GET', '/places', null],
  ['POST', '/pairs/P-1/meet', null],
  ['POST', '/pairs/P-1/meet/M-1', null],
  // Block + report a person (store policy, owner 2026-10-14): data routes, so locked like the rest.
  ['GET', '/me/blocks', null],
  ['POST', '/people/U-10231/block', null],
  ['DELETE', '/people/U-10231/block', null],
  ['POST', '/people/U-10231/report', null],
];

test('423 gate: every route of the real router is listed, and only sign-in + PIN routes stay open', () => {
  for (const { method, re } of API_ROUTES) {
    assert.ok(SAMPLES.some(([m, p]) => m === method && re.test(p)), `route ${method} ${re} has a sample (a new route must say what it does while locked)`);
  }
  for (const [method, path, want] of SAMPLES) {
    assert.ok(API_ROUTES.some((r) => r.method === method && r.re.test(path)), `${method} ${path} is a real route`);
    assert.equal(whileLocked(method, path), want, `${method} ${path} while locked`);
  }
});

test('423 gate: wrong methods and look-alike paths are not let through', () => {
  assert.equal(whileLocked('GET', '/me/unlock'), null);
  assert.equal(whileLocked('GET', '/me/pin'), null);
  assert.equal(whileLocked('POST', '/me/pins'), null);
  assert.equal(whileLocked('POST', '/me/pin/forgot/x'), null);
  assert.equal(whileLocked('POST', '/me/unlock/../nearby'), null);
  assert.equal(whileLocked('POST', '/me/pending'), null, 'only GET /me/pending, and it is a number only');
  assert.equal(whileLocked('GET', '/me/pending?x=1'), null);
  assert.equal(whileLocked('GET', '/auth/send-code'), 'open', 'not a real route (404 anyway), and not a sign-in');
  assert.equal(whileLocked('POST', ''), null);
  assert.equal(whileLocked('POST', undefined), null);
  assert.equal(whileLocked('GET', '/auth/review/verify'), 'open', 'not a real route (404 anyway), and not a sign-in');
  assert.equal(whileLocked('POST', '/auth/review/verify/x'), 'open', 'not a real route (404 anyway), and not a sign-in');
  assert.equal(whileLocked('GET', '/auth/review/pin'), 'open', 'not a real route (404 anyway), and not a sign-in');
  assert.equal(whileLocked('POST', '/auth/review/pins'), 'open', 'not a real route (404 anyway), and not a sign-in');
});

// ---------------------------------------------------------------- set / change

test('pinSetPlan: first PIN, change with the old one, once after a sign-in, refused otherwise', () => {
  const now = 1_000_000;
  const soon = new Date(now + 60e3);
  const gone = new Date(now - 1);
  assert.deepEqual(pinSetPlan({ hasPin: false, locked: false, hasOld: false, now }), { kind: 'first' });
  assert.deepEqual(pinSetPlan({ hasPin: false, locked: true, hasOld: false, now }), { refuse: { status: 423, code: 'locked' } }, 'a locked phone with no PIN signs in again');
  assert.deepEqual(pinSetPlan({ hasPin: false, locked: true, hasOld: true, now }), { refuse: { status: 423, code: 'locked' } });
  assert.deepEqual(pinSetPlan({ hasPin: true, locked: false, hasOld: true, now }), { kind: 'old' });
  assert.deepEqual(pinSetPlan({ hasPin: true, locked: true, hasOld: true, now }), { kind: 'old' }, 'the old PIN proves it even on the lock screen');
  assert.deepEqual(pinSetPlan({ hasPin: true, locked: false, hasOld: false, resetUntil: soon, now }), { kind: 'fresh' });
  assert.deepEqual(pinSetPlan({ hasPin: true, locked: true, hasOld: false, resetUntil: soon, now }), { refuse: { status: 423, code: 'locked' } });
  assert.deepEqual(pinSetPlan({ hasPin: true, locked: false, hasOld: false, resetUntil: gone, now }), { refuse: { status: 403, code: 'old_pin_needed' } });
  assert.deepEqual(pinSetPlan({ hasPin: true, locked: false, hasOld: false, now }), { refuse: { status: 403, code: 'old_pin_needed' } });
});

// ---------------------------------------------------------------- tries

test('no try limit for people (owner 2026-10-14: "they can punch it 1000 times, we do not care")', () => {
  for (const gone of ['PIN_TRIES', 'pinTriesLeft', 'afterWrongPin']) assert.equal(gone in pinModule, false, `${gone} is gone`);
  assert.equal('tries' in lockInfo(), false, 'the app is never told a tries count');
  // A person punching wrong PINs as fast as a thumb can, 1000 times: one every 2 s (about 33 minutes), and even one
  // every 1.5 s — never stopped.
  const t0 = 50_000_000;
  for (const every of [25_000, 2_000, 1_500]) {
    let session = { ...freshSigninFields(t0) };
    for (let i = 1; i <= 1000; i++) {
      const at = t0 + i * every;
      session = { ...session, ...nextPinGuard(session, at) };
      assert.equal(pinGuardStop(session, at), null, `one PIN every ${every} ms: wrong PIN #${i}`);
    }
  }
  // The same through Mongo's own update (pinGuardUpdate), one every 2 s for 1000 PINs: never stopped.
  let doc = { ...freshSigninFields(t0) };
  for (let i = 1; i <= 1000; i++) {
    const at = t0 + i * 2_000;
    doc = runPipeline(doc, pinGuardUpdate(at));
    assert.equal(pinGuardStop(doc, at), null, `Mongo, one PIN every 2 s: wrong PIN #${i}`);
  }
  // Even 40 wrong in a row, one a second (a person hammering the boxes): still asked again.
  let session = { ...freshSigninFields(t0) };
  for (let i = 1; i <= PIN_GUARD_TRIES; i++) {
    session = { ...session, ...nextPinGuard(session, t0 + i * 1000) };
    assert.equal(pinGuardStop(session, t0 + i * 1000), null, `fast wrong PIN #${i}`);
  }
});

test('the one guard against scripts: the 41st PIN check on a session inside a minute → stop (429) until that minute ends', () => {
  assert.equal(PIN_GUARD_TRIES, 40);
  assert.equal(PIN_GUARD_MS, 60e3);
  const t0 = 70_000_000;
  let s = {};
  for (let i = 0; i < PIN_GUARD_TRIES; i++) s = { ...s, ...nextPinGuard(s, t0 + i) };
  assert.deepEqual(s, { pinTries: 40, pinTriesFrom: new Date(t0) }, 'the window starts at the first check');
  s = { ...s, ...nextPinGuard(s, t0 + 10e3) };
  assert.deepEqual(pinGuardStop(s, t0 + 10e3), { retryIn: 50 }, 'the 41st: stopped until the minute ends (50 s later)');
  s = { ...s, ...nextPinGuard(s, t0 + PIN_GUARD_MS - 1) };
  assert.equal(pinGuardStop(s, t0 + PIN_GUARD_MS - 1)?.retryIn, 1, 'never a 0 s wait');
  s = { ...s, ...nextPinGuard(s, t0 + PIN_GUARD_MS) };
  assert.deepEqual(s, { pinTries: 1, pinTriesFrom: new Date(t0 + PIN_GUARD_MS) }, 'a minute on: a new window');
  assert.equal(pinGuardStop(s, t0 + PIN_GUARD_MS), null);
  // A fresh sign-in (pinTries 0) or a session from before the guard (no window): counting starts again at 1.
  assert.deepEqual(nextPinGuard(freshSigninFields(t0), t0), { pinTries: 1, pinTriesFrom: new Date(t0) });
  assert.deepEqual(nextPinGuard({ pinTries: 4 }, t0), { pinTries: 1, pinTriesFrom: new Date(t0) }, 'an old 5-try count is not carried over');
  assert.equal(pinGuardStop(null), null);
  // A script still gets at most 40 a minute: all 10,000 PINs take over 4 hours on one session.
  let script = {};
  let checked = 0;
  for (let at = t0; at < t0 + 60 * 60e3; at += 50) {
    script = { ...script, ...nextPinGuard(script, at) };
    if (!pinGuardStop(script, at)) checked++;
  }
  assert.ok(checked <= 60 * PIN_GUARD_TRIES, `${checked} PINs compared in an hour`);
});

test('the guard\'s 429 says "Too many tries. Wait a minute." — so the wait is never longer than a minute', () => {
  const t0 = 90_000_000;
  // Whatever is stored (a window from before this version, a planted far-future start), the wait is ≤ 60 s.
  const stored = [
    { pinTries: 41, pinTriesFrom: new Date(t0) },
    { pinTries: 999, pinTriesFrom: new Date(t0 - 59_999) },
    { pinTries: 41, pinTriesFrom: new Date(t0 - 60e3 + 1) },
    { pinTries: 50, pinTriesFrom: new Date(t0 + 60 * 60e3) }, // ahead of the clock (a server clock set back)
    { pinTries: 50 }, // no start at all
  ];
  for (const g of stored) {
    const stop = pinGuardStop(g, t0);
    assert.ok(stop && stop.retryIn >= 1 && stop.retryIn <= 60, JSON.stringify({ g, stop }));
  }
  // A session the old 10-minute guard had stopped (window 2 minutes old): the next check starts a new window.
  const old = { pinTries: 31, pinTriesFrom: new Date(t0 - 2 * 60e3) };
  assert.deepEqual(nextPinGuard(old, t0), { pinTries: 1, pinTriesFrom: new Date(t0) }, 'an old 10-minute window is over at once');
  assert.ok(PIN_GUARD_MS <= 60e3, 'the copy says "a minute"');
});

/** Just enough of Mongo's expression language to run pinGuardUpdate's pipeline on one document. */
function runPipeline(doc, pipeline) {
  const ev = (x) => {
    if (typeof x === 'string' && x.startsWith('$')) return doc[x.slice(1)] ?? null;
    if (x instanceof Date || x === null || typeof x !== 'object' || Array.isArray(x)) return x;
    const [[op, args]] = Object.entries(x);
    const v = args.map(ev);
    const ms = (y) => (y instanceof Date ? y.getTime() : y);
    if (op === '$gt') return v[0] != null && ms(v[0]) > ms(v[1]); // null / missing sorts below a date
    if (op === '$cond') return v[0] ? v[1] : v[2];
    if (op === '$add') return v[0] + v[1];
    if (op === '$ifNull') return v[0] ?? v[1];
    throw new Error(`no ${op}`);
  };
  assert.equal(pipeline.length, 1);
  const [stage] = pipeline;
  assert.deepEqual(Object.keys(stage), ['$set']);
  const out = Object.fromEntries(Object.entries(stage.$set).map(([k, e]) => [k, ev(e)])); // every field from the input doc
  return { ...doc, ...out };
}

test('pinGuardUpdate: the same rule as nextPinGuard, inside Mongo (atomic: parallel checks each count)', () => {
  const t0 = 80_000_000;
  const cases = [
    {}, { pinTries: 0 }, { pinTries: 7 }, { pinTries: 3, pinTriesFrom: new Date(t0 - 60e3) }, { pinTries: 30, pinTriesFrom: new Date(t0 - 1) },
    { pinTries: 30, pinTriesFrom: new Date(t0 - PIN_GUARD_MS) }, { pinTries: 12, pinTriesFrom: new Date(t0 - PIN_GUARD_MS - 5) },
  ];
  for (const doc of cases) {
    const got = runPipeline(doc, pinGuardUpdate(t0));
    const want = nextPinGuard(doc, t0);
    assert.equal(got.pinTries, want.pinTries, JSON.stringify(doc));
    assert.equal(got.pinTriesFrom.getTime(), want.pinTriesFrom.getTime(), JSON.stringify(doc));
  }
});

test('checkPinTry (src/lib/thirtyda-app.mjs): counted on the guard before comparing; wrong → 400 asking again, never a sign-out', () => {
  const app = readFileSync(new URL('./thirtyda-app.mjs', import.meta.url), 'utf8');
  const i = app.indexOf('async function checkPinTry(');
  const body = app.slice(i, app.indexOf('\n}\n', i));
  assert.ok(body.indexOf('pinGuardUpdate(now)') > 0 && body.indexOf('pinGuardUpdate(now)') < body.indexOf('verifyPin('), 'counted before the compare');
  assert.match(body, /if \(stop\) throw fail\(429, "too_many_tries", "Too many tries\. Wait a minute\.", \{ retryIn: stop\.retryIn \}\);/);
  assert.match(body, /throw fail\(400, "wrong_pin", "That PIN is not right\."\);\s*$/, 'a wrong PIN: 400, no tries count');
  assert.match(body, /\$set: \{ pinTries: 0 \}, \$unset: \{ pinTriesFrom: "" \}/, 'a right PIN clears the guard');
  assert.doesNotMatch(body, /pin_tries|deleteMany|deleteOne|triesLeft|Set-Cookie/, 'never signs anyone out');
  assert.deepEqual([...body.matchAll(/fail\((\d+), "(\w+)"/g)].map((m) => `${m[1]} ${m[2]}`), ['401 signed_out', '429 too_many_tries', '400 wrong_pin'],
    'the only 401 is a session that is already gone');
  assert.doesNotMatch(app, /endForTries|afterWrongPin|"pin_tries"/, 'the 5-wrong rule is gone everywhere');
});
// ---------------------------------------------------------------- times

test('defaults: the app covers after 30 s, the server locks after 2 minutes', () => {
  if (process.env.THIRTYDA_LOCK_IDLE_MS || process.env.THIRTYDA_IDLE_COVER_MS) return; // a shortened test run
  assert.equal(SERVER_IDLE_MS, 2 * MIN);
  assert.equal(COVER_MS, 30e3);
  assert.deepEqual(lockInfo(), { coverMs: 30e3, idleMs: 2 * MIN });
});

test('the test overrides can only make the times SHORTER (a typo never switches the lock off)', () => {
  const read = (env) => JSON.parse(execFileSync(process.execPath, [
    '--input-type=module', '-e',
    "const m = await import('./src/lib/thirtyda-pin.mjs'); console.log(JSON.stringify([m.SERVER_IDLE_MS, m.COVER_MS]));",
  ], { cwd: new URL('../../', import.meta.url), env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' }));
  assert.deepEqual(read({}), [120000, 30000]);
  assert.deepEqual(read({ THIRTYDA_LOCK_IDLE_MS: '4000', THIRTYDA_IDLE_COVER_MS: '2500' }), [4000, 2500]);
  assert.deepEqual(read({ THIRTYDA_LOCK_IDLE_MS: '99999999', THIRTYDA_IDLE_COVER_MS: '600000' }), [120000, 30000]);
  assert.deepEqual(read({ THIRTYDA_LOCK_IDLE_MS: '0', THIRTYDA_IDLE_COVER_MS: 'soon' }), [120000, 30000], 'nonsense or under 1 s: the defaults');
});
