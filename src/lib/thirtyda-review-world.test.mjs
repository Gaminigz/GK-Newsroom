// Run: npm run 30da:test (or node --test src/lib/thirtyda-review-world.test.mjs)
// The App review reviewers' side (owner 2026-10-14, the iOS session's live audit; src/lib/thirtyda-review-world.mjs):
// review devices (a fresh profile from a phone that signed in to a demo account, while Review sign-in is ON), a clean
// demo world (blocks + open flags between demo accounts cleared on ON / New code), the admin never blocking a demo
// account, MeView.review, and a guest's report (POST /guest/report). In-memory Mongo stand-in: no database, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';

process.env.THIRTYDA_SECRET_KEY ||= crypto.randomBytes(32).toString('hex');

const {
  REVIEW_DEVICES, REVIEW_DEVICE_KEEP_MS, markReviewDevice, isReviewDevice, forgetReviewDevices, clearReviewWorld,
  REVIEW_DEVICE_PER_DAY, REVIEW_ADDRESS_PER_DAY, claimReviewSignup, releaseReviewSignup,
} = await import('./thirtyda-review-world.mjs');
const { REVIEW, REVIEW_SWITCH } = await import('./thirtyda-review.mjs');
const { SETTINGS_COLLECTION, clearSettingsCache } = await import('./thirtyda-settings.mjs');
const { BLOCKS, blockId, blockFlag, reportFlag, guestReportFlag, guestReporter, guestReportKey } = await import('./thirtyda-blocks.mjs');
const { deviceKey, signupKey, UNVERIFIED_PER_DAY } = await import('./thirtyda-verify.mjs');
const { API_ROUTES, meView } = await import('./thirtyda-app.mjs');
const { whileLocked } = await import('./thirtyda-pin.mjs');
const { talksToSomeone } = await import('./thirtyda-verify.mjs');
const { termsFree } = await import('./thirtyda-terms.mjs');
const { PERSON_REPORT_REASONS } = await import('../thirtyda-app/shared/safety.js');

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const APP = read('./thirtyda-app.mjs');
const ADMIN = read('./thirtyda-admin.mjs');
/** The source of `async function name(` up to its closing brace at column 0. */
const fnBody = (src, name) => {
  const at = src.indexOf(`async function ${name}(`);
  assert.ok(at >= 0, `${name} is there`);
  return src.slice(at, src.indexOf('\n}\n', at));
};

// ---------------------------------------------------------------- an in-memory Mongo, just enough

const get = (doc, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc);
const eq = (v, want) => (want === null ? v == null : Array.isArray(v) ? v.includes(want) : v === want);
function matches(doc, q) {
  for (const [k, cond] of Object.entries(q || {})) {
    const v = get(doc, k);
    if (cond && typeof cond === 'object' && !Array.isArray(cond) && Object.keys(cond).some((x) => x.startsWith('$'))) {
      for (const [op, want] of Object.entries(cond)) {
        if (op === '$in' && !want.some((w) => eq(v, w))) return false;
        if (op === '$ne' && eq(v, want)) return false;
        if (op === '$exists' && (v !== undefined) !== want) return false;
      }
    } else if (!eq(v, cond)) return false;
  }
  return true;
}
function apply(doc, u) {
  for (const [k, v] of Object.entries(u.$set || {})) doc[k] = structuredClone(v);
  for (const k of Object.keys(u.$unset || {})) delete doc[k];
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
        async insertOne(doc) { docs.set(doc._id, structuredClone(doc)); return { insertedId: doc._id }; },
        async updateOne(q, u, opts = {}) {
          const x = all(q)[0];
          if (!x && opts.upsert) { const d = { _id: q._id }; apply(d, u); docs.set(d._id, d); return { upsertedCount: 1 }; }
          if (x) apply(x, u);
          return { matchedCount: x ? 1 : 0 };
        },
        async updateMany(q, u) { const xs = all(q); xs.forEach((x) => apply(x, u)); return { matchedCount: xs.length }; },
        async deleteMany(q) { const xs = all(q); xs.forEach((x) => docs.delete(x._id)); return { deletedCount: xs.length }; },
      });
    }
    return cols.get(name);
  };
  return { collection, docs: (name) => [...collection(name).docs.values()] };
}

const switchTo = (d, on) => d.collection(SETTINGS_COLLECTION).updateOne({ _id: REVIEW_SWITCH }, { $set: { on } }, { upsert: true });
const PHONE_ID = '2f1c9a6e-4b7d-4c1e-9a3b-5d6e7f8a9b0c'; // the app's ThirtyDaShell.info().deviceId shape
const WEB_ID = 'a'.repeat(32); // the website's own kept id

// ---------------------------------------------------------------- review devices

test('review devices: a phone that signed in to a demo account counts only while Review sign-in is ON; OFF forgets it', async () => {
  clearSettingsCache();
  const d = fakeDb();
  assert.equal(await markReviewDevice(d, 'not an id'), false, 'a bad id is never kept');
  assert.equal(await markReviewDevice(d, undefined), false);
  assert.equal(d.docs(REVIEW_DEVICES).length, 0);

  const now = Date.parse('2026-10-14T10:00:00Z');
  assert.equal(await markReviewDevice(d, PHONE_ID, { now }), true);
  assert.equal(await markReviewDevice(d, WEB_ID, { now }), true);
  const kept = d.docs(REVIEW_DEVICES);
  assert.deepEqual(kept.map((x) => x._id).sort(), [deviceKey(PHONE_ID), deviceKey(WEB_ID)].sort());
  assert.ok(!JSON.stringify(kept).includes(PHONE_ID) && !JSON.stringify(kept).includes(WEB_ID), 'only a one-way hash of the id');
  assert.equal(kept[0].purgeAt.getTime(), now + REVIEW_DEVICE_KEEP_MS, 'a TTL backstop');

  assert.equal(await isReviewDevice(d, PHONE_ID), false, 'the switch is OFF: no pass');
  await switchTo(d, true);
  assert.equal(await isReviewDevice(d, PHONE_ID), true);
  assert.equal(await isReviewDevice(d, PHONE_ID.toUpperCase()), true, 'the same phone, whatever the case');
  assert.equal(await isReviewDevice(d, '3f1c9a6e-4b7d-4c1e-9a3b-5d6e7f8a9b0c'), false, 'another phone');
  assert.equal(await isReviewDevice(d, null), false);

  assert.equal(await forgetReviewDevices(d), 2);
  assert.equal(await isReviewDevice(d, PHONE_ID), false, 'forgotten when the switch goes OFF');
});

/** A counter collection (SIGNUP_LIMITS) for claimSignup: atomic $inc / $setOnInsert / upsert, and the give-back. */
function counterCollection() {
  const docs = new Map();
  return {
    docs,
    async findOneAndUpdate(filter, update, opts) {
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
      const doc = docs.get(filter._id);
      if (!doc || (filter.n?.$gt !== undefined && !((doc.n ?? 0) > filter.n.$gt))) return { matchedCount: 0 };
      for (const [k, v] of Object.entries(update.$inc || {})) doc[k] = (doc[k] ?? 0) + v;
      return { matchedCount: 1 };
    },
  };
}

test(`review devices have a ceiling: ${REVIEW_DEVICE_PER_DAY} fresh profiles per phone and ${REVIEW_ADDRESS_PER_DAY} per address a day`, async () => {
  assert.ok(REVIEW_DEVICE_PER_DAY >= 2 && REVIEW_DEVICE_PER_DAY <= 10, 'a reviewer can try Delete more than once');
  assert.ok(REVIEW_ADDRESS_PER_DAY > UNVERIFIED_PER_DAY, 'looser than the ordinary address limit: reviewers share addresses');
  const coll = counterCollection();
  const noon = Date.parse('2026-10-14T05:00:00Z'); // 12:00 in Phnom Penh
  // One review device (the demo PIN is no secret: anyone can make one) keeps making fresh profiles.
  for (let i = 1; i <= REVIEW_DEVICE_PER_DAY; i++) {
    assert.equal((await claimReviewSignup(coll, PHONE_ID, '203.0.113.7', { now: noon + i })).ok, true, `#${i}`);
  }
  assert.deepEqual(await claimReviewSignup(coll, PHONE_ID, '203.0.113.7', { now: noon + 99 }), { ok: false, keys: [] }, `#${REVIEW_DEVICE_PER_DAY + 1} refused`);
  assert.equal((await claimReviewSignup(coll, PHONE_ID, '198.51.100.9', { now: noon + 99 })).ok, false, 'the same id from another address: refused too');
  assert.equal((await claimReviewSignup(coll, PHONE_ID.toUpperCase(), '198.51.100.9', { now: noon + 99 })).ok, false, 'whatever the case');
  assert.equal(coll.docs.get(signupKey(`review-ip|198.51.100.9`, noon)), undefined, 'a refused phone takes nothing from the address');
  assert.equal(coll.docs.get(signupKey(`review-ip|203.0.113.7`, noon)).n, REVIEW_DEVICE_PER_DAY, 'the refused ones are not counted');
  assert.equal(coll.docs.get(signupKey('203.0.113.7', noon)), undefined, 'the ordinary address count is left alone');
  assert.ok(!JSON.stringify([...coll.docs.values()]).includes(PHONE_ID) && !JSON.stringify([...coll.docs.keys()]).includes('203.0.113'), 'hashes only');

  // New ids from the same address (signing in with the demo PIN again and again): the address's ceiling.
  let made = REVIEW_DEVICE_PER_DAY;
  let n = 0;
  while (made < REVIEW_ADDRESS_PER_DAY) {
    const id = `${String(++n).padStart(8, '0')}-4b7d-4c1e-9a3b-5d6e7f8a9b0c`;
    assert.equal((await claimReviewSignup(coll, id, '203.0.113.7', { now: noon })).ok, true, `address #${made + 1}`);
    made++;
  }
  const fresh = '99999999-4b7d-4c1e-9a3b-5d6e7f8a9b0c';
  assert.equal((await claimReviewSignup(coll, fresh, '203.0.113.7', { now: noon })).ok, false, `address #${REVIEW_ADDRESS_PER_DAY + 1} refused`);
  assert.equal(coll.docs.get(signupKey(`review-device|${deviceKey(fresh)}`, noon)).n, 0, 'the phone\'s place is given back');
  assert.equal((await claimReviewSignup(coll, fresh, '198.51.100.9', { now: noon })).ok, true, 'that phone at another address');

  // A profile not made after all gives both places back; a new Phnom Penh day starts again.
  const other = '88888888-4b7d-4c1e-9a3b-5d6e7f8a9b0c';
  const slot = await claimReviewSignup(coll, other, '192.0.2.5', { now: noon });
  assert.equal(slot.keys.length, 2);
  await releaseReviewSignup(coll, slot.keys);
  assert.deepEqual(slot.keys.map((k) => coll.docs.get(k).n), [0, 0]);
  await releaseReviewSignup(coll, undefined); // an ordinary slot has no keys
  assert.equal((await claimReviewSignup(coll, PHONE_ID, '203.0.113.7', { now: noon + 864e5 })).ok, true, 'tomorrow');
  assert.equal((await claimReviewSignup(coll, 'not an id', '192.0.2.5', { now: noon })).ok, false, 'never without a good id');
});

test('createProfile: a review device skips "one per phone" and the address day limit for its own ceiling — nothing else changes', () => {
  const body = fnBody(APP, 'createProfile');
  assert.match(body, /const reviewDevice = unverified && \(await isReviewDevice\(d, body\.deviceId\)/);
  assert.match(body, /const deviceAt = unverified && !reviewDevice \? deviceKey\(body\.deviceId\) : null;/);
  assert.match(body, /slot = unverified && !reviewDevice \? await claimSignup\(limits, clientIp\(ctx\.req\)\) : null;/);
  // Never limitless (anyone can type the demo PIN): the review device's own ceiling, refused like the address limit.
  assert.match(body, /if \(reviewDevice\) slot = await claimReviewSignup\(limits, body\.deviceId, clientIp\(ctx\.req\)\);/);
  assert.match(body, /await releaseReviewSignup\(limits, slot\?\.keys\);/);
  assert.ok(body.indexOf('claimReviewSignup(') < body.indexOf('if (slot && !slot.ok)'), 'refused (429 too_many_profiles) before the photo is kept');
  assert.ok(body.indexOf('if (slot && !slot.ok)') < body.indexOf('storePhoto('));
  assert.ok(body.indexOf('reviewDevice') < body.indexOf('claimDevice('), 'decided before the phone is claimed');
  // The sign-ins that make a review device: both review ways, only after a right PIN / code (after the session starts).
  for (const name of ['reviewPin', 'reviewVerify']) {
    const fn = fnBody(APP, name);
    assert.match(fn, /markReviewDevice\(d, body\.deviceId\)/, name);
    assert.ok(fn.indexOf('markReviewDevice') > fn.indexOf('await startSession('), `${name}: only after a right PIN / code`);
  }
  assert.match(APP, /d\.collection\(REVIEW_DEVICES\)\.createIndex\(\{ purgeAt: 1 \}, \{ expireAfterSeconds: 0 \}\)/);
});

test('the app sends this phone\'s id with both review sign-ins', () => {
  const lock = read('../thirtyda-app/lock.js');
  assert.match(lock, /import \{ onAppReturn, deviceId \} from '\.\/shell\.js';/);
  assert.match(lock, /return \{ pin, \.\.\.termsBody\(\), \.\.\.\(device \? \{ deviceId: device \} : \{\}\) \};/);
  // Every demo sign-in (the "App review" sheet and the demo-PIN offer) sends it; the probe never signs in, so it never does.
  const posts = [...lock.matchAll(/api\.post\('\/auth\/review\/pin', ([^\n]*?), \{ redirect: false \}\)/g)].map((m) => m[1]);
  assert.ok(posts.length >= 2, `${posts.length} calls`);
  for (const body of posts) assert.ok(body === 'await reviewSignInBody(pin)' || body === '{ pin, probe: true }', body);
  const create = read('../thirtyda-app/screens/create-profile.js');
  assert.match(create, /api\.post\('\/auth\/review\/verify', \{ phone, code: input\.value, \.\.\.\(device \? \{ deviceId: device \} : \{\}\) \}/);
});

// ---------------------------------------------------------------- a clean demo world

test('clearReviewWorld: blocks and open flags BETWEEN demo accounts go; anything that touches a real person stays', async () => {
  const d = fakeDb();
  const users = d.collection('thirtyda_users');
  for (const u of [{ _id: 'U-1', demo: REVIEW }, { _id: 'U-2', demo: REVIEW }, { _id: 'U-3' }, { _id: 'U-4' }]) await users.insertOne(u);
  const blocks = d.collection(BLOCKS);
  for (const [by, who] of [['U-1', 'U-2'], ['U-2', 'U-1'], ['U-1', 'U-3'], ['U-3', 'U-4']]) {
    await blocks.insertOne({ _id: blockId(by, who), by, who, at: 't' });
  }
  const flags = d.collection('thirtyda_flags');
  await flags.insertOne(blockFlag({ id: 'f1', by: 'U-1', who: 'U-2', at: 't' }));
  await flags.insertOne(reportFlag({ id: 'f2', by: 'U-2', byName: 'Sophea', who: 'U-1', at: 't', label: 'rude', target: 'profile' }));
  await flags.insertOne(blockFlag({ id: 'f3', by: 'U-1', who: 'U-3', at: 't' })); // a demo account and a real person
  await flags.insertOne({ ...blockFlag({ id: 'f4', by: 'U-2', who: 'U-1', at: 't' }), status: 'dismissed' }); // already closed
  await flags.insertOne(guestReportFlag({ id: 'f5', by: 'h', who: 'U-3', at: 't', label: 'rude' }));

  const r = await clearReviewWorld(d, { at: '2026-10-14T10:00:00.000Z' });
  assert.deepEqual(r.blocks.sort(), ['U-1|U-2', 'U-2|U-1']);
  assert.deepEqual(r.flags.sort(), ['f1', 'f2']);
  assert.deepEqual(d.docs(BLOCKS).map((b) => b._id).sort(), ['U-1|U-3', 'U-3|U-4'], 'a real person\'s blocks stay');
  const byId = new Map(d.docs('thirtyda_flags').map((f) => [f._id, f]));
  for (const id of ['f1', 'f2']) {
    assert.equal(byId.get(id).status, 'dismissed');
    assert.equal(byId.get(id).resolvedAction, 'review_reset');
    assert.equal(byId.get(id).resolvedAt, '2026-10-14T10:00:00.000Z');
    assert.equal('key' in byId.get(id), false, 'its open-flag key goes');
  }
  assert.equal(byId.get('f3').status, 'open');
  assert.equal(byId.get('f4').status, 'dismissed');
  assert.equal(byId.get('f4').resolvedAction, undefined, 'a closed flag is not touched');
  assert.equal(byId.get('f5').status, 'open');
  assert.deepEqual(await clearReviewWorld(d), { blocks: [], flags: [] }, 'nothing left: nothing to audit');

  const solo = fakeDb();
  await solo.collection('thirtyda_users').insertOne({ _id: 'U-1', demo: REVIEW });
  await solo.collection(BLOCKS).insertOne({ _id: blockId('U-1', 'U-9'), by: 'U-1', who: 'U-9' });
  assert.deepEqual(await clearReviewWorld(solo), { blocks: [], flags: [] }, 'one demo account: nothing between demo accounts');
});

test('admin: Review sign-in ON and New code clear the demo world (audited, ids only); OFF forgets review devices', () => {
  const route = fnBody(ADMIN, 'reviewRoute');
  const sw = route.slice(route.indexOf('if (m[1] === "switch")'), route.indexOf('} else if (m[1] === "code")'));
  assert.match(sw, /const devicesForgotten = v\.on \? 0 : await forgetReviewDevices\(d\);/);
  assert.match(sw, /if \(v\.on\) await freshReviewWorld\(req, d\);/);
  const code = route.slice(route.indexOf('} else if (m[1] === "code")'), route.indexOf('} else if (m[2] && m[3])'));
  assert.match(code, /await newReviewCode\(d\);[\s\S]*await freshReviewWorld\(req, d\);/);
  const fresh = ADMIN.slice(ADMIN.indexOf('async function freshReviewWorld('), ADMIN.indexOf('\n}\n', ADMIN.indexOf('async function freshReviewWorld(')));
  assert.match(fresh, /const r = await clearReviewWorld\(d\);/);
  assert.match(fresh, /audit\(req, "review_world_reset", \{ blocks: r\.blocks, flags: r\.flags \}\)/, 'ids only');
});

test('admin: "Block" never blocks a demo account (a plain 409 line); Reject + block leaves it unblocked too', () => {
  const at = ADMIN.indexOf('m = sub.match(/^\\/api\\/users\\/(U-\\d+)\\/(block|unblock)$/);');
  assert.ok(at > 0);
  const route = ADMIN.slice(at, ADMIN.indexOf('return json(res, 200, { ...(await overview()), alreadyBlocked });', at));
  assert.match(route, /if \(m\[2\] === "block" && isReview\(u\)\) \{\n\s*return json\(res, 409, \{ error: "This is an App review demo account, so it is not blocked\. Stop it on the App review page first\.", reason: "review_account" \}\);/);
  assert.ok(route.indexOf('isReview(u)') < route.indexOf('await blockUser(d, u)'), 'refused before anything is written');
  assert.match(ADMIN, /if \(u && !isReview\(u\)\) blocked = await blockUser\(d, u\);/);
});

// ---------------------------------------------------------------- MeView.review and the demo delete route

test('MeView.review: true only for a demo account', () => {
  const base = { _id: 'U-1', name: 'Dara', photos: [], verified: {} };
  assert.equal(meView({ ...base, demo: REVIEW }).review, true);
  assert.equal(meView(base).review, false);
  assert.equal(meView({ ...base, demo: 'other' }).review, false);
  assert.match(APP, /\["POST", \/\^\\\/me\\\/delete\$\/, \(ctx\) => deleteMe\(ctx, \{ fail, checkPinTry, signedOutCookie: \(req\) => cookieFor\(req, "", 0\), demo: isReview\(ctx\.me\) \}\), \{ blockedOk: true \}\]/);
});

// ---------------------------------------------------------------- a guest's report

test('guest report flag: about the person, "Reported by a guest", no name, no address — one open flag per address + person', () => {
  const by = guestReporter('203.0.113.7');
  assert.match(by, /^[0-9a-f]{24}$/);
  assert.equal(guestReporter('203.0.113.7'), by, 'the same address, the same key');
  assert.notEqual(guestReporter('203.0.113.8'), by);
  // Keyed (an HMAC under the server's key), so the address cannot be found by hashing all 2^32 of them offline.
  const plain = crypto.createHash('sha256').update('30da-guest-report|203.0.113.7').digest('hex').slice(0, 24);
  assert.notEqual(by, plain, 'never a plain hash of the address');
  const serverKey = Buffer.from(process.env.THIRTYDA_SECRET_KEY, 'hex');
  assert.equal(by, crypto.createHmac('sha256', serverKey).update('30da-guest-report|203.0.113.7').digest('hex').slice(0, 24));
  assert.notEqual(guestReporter('203.0.113.7', crypto.randomBytes(32)), by, 'another key, another value');
  const f = guestReportFlag({ id: 'f9', by, who: 'U-5', at: '2026-10-14T10:00:00.000Z', label: 'fake profile' });
  assert.deepEqual(f, {
    _id: 'f9', id: 'f9', chatId: null, from: 'U-5', to: null, guest: true, at: '2026-10-14T10:00:00.000Z',
    reason: 'Reported by a guest · fake profile', kind: 'reported', status: 'open', warned: false, target: 'profile',
    key: guestReportKey(by, 'U-5'),
  });
  assert.ok(!JSON.stringify(f).includes('203.0.113'), 'never the address itself');
});

test('POST /guest/report: a real route, open to a guest (no lock, no "I agree", not a talk), rate-limited first', () => {
  assert.ok(API_ROUTES.some((r) => r.method === 'POST' && r.re.test('/guest/report')));
  assert.ok(!API_ROUTES.some((r) => r.method === 'GET' && r.re.test('/guest/report')), 'POST only');
  assert.match(APP, /\["POST", \/\^\\\/guest\\\/report\$\/, guestReport, \{ auth: "none" \}\]/);
  assert.equal(whileLocked('POST', '/guest/report'), null, 'a locked profile waits like any data route');
  assert.equal(talksToSomeone('POST', '/guest/report'), false);
  assert.equal(termsFree('POST', '/guest/report'), false, 'auth "none": the gate is for profiles only, never reached');
  const body = fnBody(APP, 'guestReport');
  const limit = body.indexOf('guestReports.over(clientIp(req), GUEST_REPORTS)');
  assert.ok(limit > 0 && limit < body.indexOf('await '), 'counted before any await');
  assert.match(body, /PERSON_REPORT_REASONS\.includes\(reason\)/);
  assert.match(body, /\/\^U-\\d\{1,12\}\$\/\.test\(id\)/);
  assert.match(body, /if \(!u \|\| u\.blocked \|\| u\.deleting \|\| u\._id === me\?\._id \|\| !sameWorld\(me, u\)\) throw fail\(404/, 'never a demo account, never someone gone');
  assert.match(body, /guestReportFlag\(\{ id: flagId, by: guestReporter\(clientIp\(req\)\), who: u\._id/);
  assert.match(body, /err\?\.code === 11000\) return \{ ok: true, already: true \}/);
  assert.deepEqual([...PERSON_REPORT_REASONS], ['rude', 'sexual', 'scam', 'underage', 'fake', 'other'], 'the member report\'s reasons');
});

test('report sheet at the limit (429 rate_limited): its own short line in all 5 languages, never "Something went wrong"', () => {
  const safety = read('../thirtyda-app/screens/safety.js');
  assert.match(safety, /fail\.textContent = err\?\.status === 429 \? t\('sf_too_many'\) : errorText\(err\);/);
  const lines = [...safety.matchAll(/^ {4}sf_too_many: '([^']+)',$/gm)].map((m) => m[1]);
  assert.equal(lines.length, 5, 'en / km / zh / ko / ja');
  assert.ok(lines.every((x) => x.length <= 60), 'short');
  assert.match(lines[0], /15 minutes/);
  assert.match(APP, /throw fail\(429, "rate_limited", "Too many reports\. Try again in 15 minutes\."\)/);
});

test('admin queue: a guest\'s report reads "A guest", with no chat to open', () => {
  assert.match(ADMIN, /toName: f\.guest \? "A guest" : byId\.get\(f\.to\)\?\.name \?\? f\.to,/);
  const monitor = read('../thirtyda-admin/monitor.js');
  assert.match(monitor, /f\.guest \? `A guest \(no profile yet\) reported it\$\{target\}`/);
  assert.match(monitor, /\$\{f\.field \|\| f\.guest \? '' : `<button type="button" class="link" data-chat-flag=/);
});
