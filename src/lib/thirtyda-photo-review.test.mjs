// Run: npm run 30da:test (or node --test src/lib/thirtyda-photo-review.test.mjs)
// Photo review (store policy, owner 2026-10-14 "Yes, I approve photos"): src/lib/thirtyda-photo-review.mjs (pending
// photos, the admin's queue, approve / reject), MeView.photoPending, the admin's Photos routes (admin only, writes from
// the admin pages only) and the app's words in all 5 languages. In-memory collections: no database, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PHOTO_PENDING, PHOTO_REJECTED_TEXT, isPending, publicPhotoId, pendingFlags, pendingSet, reviewUnset, newProfileReview,
  pendingFilter, reviewTarget, queueRows, pendingQueue, pendingCount, pendingOwner, approvePhoto, rejectPhoto, photoNotice,
} from './thirtyda-photo-review.mjs';
import { meView } from './thirtyda-app.mjs';
import { handleThirtyDaAdmin } from './thirtyda-admin.mjs';
import { LANGS } from '../thirtyda-app/shared/rules.js';

const P = (c) => c.repeat(32); // a photo id: 32 hex characters
const [A1, A2, A3, B1, C1, C3] = ['a', 'b', 'c', 'd', 'e', 'f'].map(P);

// ---------------------------------------------------------------- a tiny collection (dotted paths, $or, $set/$unset/$push)

const get = (doc, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc);
function matches(doc, q) {
  return Object.entries(q || {}).every(([k, want]) => {
    if (k === '$or') return want.some((c) => matches(doc, c));
    const v = get(doc, k);
    return Array.isArray(v) && !Array.isArray(want) ? v.includes(want) : v === want;
  });
}
function setPath(doc, path, value) {
  const keys = path.split('.');
  let o = doc;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys.at(-1)] = value;
}
function unsetPath(doc, path) {
  const keys = path.split('.');
  const o = get(doc, keys.slice(0, -1).join('.')) ?? (keys.length === 1 ? doc : undefined);
  if (o && typeof o === 'object') delete o[keys.at(-1)];
}
function coll(rows = []) {
  const docs = new Map(rows.map((r) => [r._id, structuredClone(r)]));
  const all = (q) => [...docs.values()].filter((x) => matches(x, q));
  return {
    docs,
    find: (q) => ({ toArray: async () => all(q).map((x) => structuredClone(x)) }),
    findOne: async (q) => { const x = all(q)[0]; return x ? structuredClone(x) : null; },
    async updateOne(q, u) {
      const x = all(q)[0];
      if (!x) return { matchedCount: 0, modifiedCount: 0 };
      for (const [k, v] of Object.entries(u.$set || {})) setPath(x, k, v);
      for (const k of Object.keys(u.$unset || {})) unsetPath(x, k);
      for (const [k, v] of Object.entries(u.$push || {})) (x[k] ??= []).push(v);
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };
}

const people = () => coll([
  // Made before the rule: no photoReview at all → every photo counts as approved.
  { _id: 'U-10001', name: 'Old', photos: [A1, A2, A3] },
  // A new profile: photo 1 pending.
  { _id: 'U-10002', name: 'Nary', photos: [B1], ...newProfileReview('2026-10-14T03:00:00.000Z'), notices: [] },
  // Photo 1 approved long ago, photo 3 just replaced (pending), slot 2 empty.
  { _id: 'U-10003', name: 'Cy', photos: [C1, null, C3], photoReview: { 2: PHOTO_PENDING }, photoReviewAt: { 2: '2026-10-14T01:00:00.000Z' }, notices: [] },
]);

// ---------------------------------------------------------------- what is pending, who sees it

test('a photo with no review entry is approved: profiles made before the rule keep every photo public', () => {
  const old = { photos: [A1, A2, A3] };
  assert.deepEqual([0, 1, 2, 3].map((i) => isPending(old, i)), [false, false, false, false]);
  assert.equal(publicPhotoId(old, 0), A1);
  assert.equal(publicPhotoId(old, 2), A3);
  assert.equal(publicPhotoId(old, 3), null, 'an empty slot');
  assert.deepEqual(pendingFlags(old), [false, false, false]);
  assert.deepEqual(pendingFlags({}), []);
  assert.equal(publicPhotoId(null, 0), null);
});

test('a pending photo has no public id; slot-aligned flags for its owner (trailing empty slots left out)', () => {
  const u = { photos: [C1, null, C3, null], photoReview: { 2: PHOTO_PENDING } };
  assert.equal(isPending(u, 2), true);
  assert.equal(isPending(u, '2'), false, 'only a whole slot index');
  assert.equal(publicPhotoId(u, 2), null);
  assert.equal(publicPhotoId(u, 0), C1);
  assert.deepEqual(pendingFlags(u), [false, false, true]);
  // Stored from Mongo as an object with string keys, read with a number.
  assert.equal(isPending({ photos: [B1], photoReview: JSON.parse('{"0":"pending"}') }, 0), true);
  // Anything other than 'pending' is not pending.
  assert.equal(isPending({ photos: [B1], photoReview: { 0: 'approved' } }, 0), false);
});

test('the update pieces: a new profile, a new / replaced photo, a cleared slot', () => {
  assert.deepEqual(newProfileReview('t0'), { photoReview: { 0: 'pending' }, photoReviewAt: { 0: 't0' } });
  assert.deepEqual(pendingSet(3, 't1'), { 'photoReview.3': 'pending', 'photoReviewAt.3': 't1' });
  assert.deepEqual(reviewUnset(1), { 'photoReview.1': '', 'photoReviewAt.1': '' });
  assert.deepEqual(pendingFilter(), { $or: [0, 1, 2, 3].map((i) => ({ [`photoReview.${i}`]: 'pending' })) });
  assert.match(pendingSet(0)['photoReviewAt.0'], /^\d{4}-\d\d-\d\dT/);
});

test('MeView.photoPending: slot-aligned with photos, false for profiles made before the rule', () => {
  const base = { _id: 'U-10002', name: 'Nary', lang: 'km', verified: {} };
  assert.deepEqual(meView({ ...base, photos: [B1], ...newProfileReview('t') }).photoPending, [true]);
  const cy = meView({ ...base, photos: [C1, null, C3], photoReview: { 2: 'pending' } });
  assert.equal(cy.photos.length, 3);
  assert.deepEqual(cy.photoPending, [false, false, true]);
  assert.deepEqual(meView({ ...base, photos: [A1, A2] }).photoPending, [false, false]);
});

// ---------------------------------------------------------------- the admin's queue

test('queue: one row per pending photo — photo 1 first, then the oldest; nothing approved, nothing empty', () => {
  const rows = queueRows([
    { _id: 'U-1', name: 'Late main', photos: [A1], photoReview: { 0: 'pending' }, photoReviewAt: { 0: '2026-10-14T05:00:00Z' } },
    { _id: 'U-2', name: 'Old slot 3', photos: [B1, null, C3], photoReview: { 2: 'pending' }, photoReviewAt: { 2: '2026-10-13T05:00:00Z' } },
    { _id: 'U-3', name: 'Early main', photos: [C1, A2], photoReview: { 0: 'pending', 1: 'pending' }, photoReviewAt: { 0: '2026-10-14T01:00:00Z', 1: '2026-10-14T01:00:00Z' }, blocked: true },
    { _id: 'U-4', name: 'Gone photo', photos: [A3, null], photoReview: { 1: 'pending' } },
    { _id: 'U-5', name: 'Old', photos: [A3] },
  ]);
  assert.deepEqual(rows.map((r) => [r.user, r.slot]), [['U-3', 1], ['U-1', 1], ['U-3', 2], ['U-2', 3]]);
  assert.deepEqual(rows[0], {
    user: 'U-3', name: 'Early main', slot: 1, index: 0, photoId: C1, at: '2026-10-14T01:00:00Z', blocked: true, nonePublic: true,
  });
  assert.equal(rows.find((r) => r.user === 'U-1').nonePublic, true, 'nothing of theirs is public now');
  assert.equal(rows.find((r) => r.user === 'U-2').nonePublic, false, 'photo 1 is approved');
});

test('pendingQueue / pendingCount / pendingOwner read the users collection', async () => {
  const users = people();
  assert.deepEqual((await pendingQueue(users)).map((r) => [r.user, r.slot, r.photoId]), [['U-10002', 1, B1], ['U-10003', 3, C3]]);
  assert.equal(await pendingCount(users), 2);
  assert.equal((await pendingOwner(users, B1))?._id, 'U-10002');
  assert.equal(await pendingOwner(users, C1), null, 'approved: not served by the queue');
  assert.equal(await pendingOwner(users, A1), null);
  assert.equal(await pendingOwner(users, 'not-an-id'), null);
});

test('reviewTarget: a real user id, slot index 0–3 and a photo id, or nothing', () => {
  assert.deepEqual(reviewTarget('U-10002', '0', B1), { userId: 'U-10002', index: 0, photoId: B1 });
  assert.deepEqual(reviewTarget('U-10003', 2, C3), { userId: 'U-10003', index: 2, photoId: C3 });
  for (const bad of [['U-1', 4, B1], ['U-1', -1, B1], ['U-1', 1.5, B1], ['x', 0, B1], ['U-1', 0, 'nope'], ['U-1', 0, undefined], [null, 0, B1]]) {
    assert.equal(reviewTarget(...bad), null, JSON.stringify(bad));
  }
});

// ---------------------------------------------------------------- approve / reject

test('approve clears the review: everyone may see the photo now; only while THAT photo is still pending there', async () => {
  const users = people();
  assert.equal(await approvePhoto(users, { userId: 'U-10002', index: 0, photoId: A1 }), false, 'another photo id: refused');
  assert.equal(await approvePhoto(users, { userId: 'U-10001', index: 0, photoId: A1 }), false, 'not pending: refused');
  assert.equal(await approvePhoto(users, { userId: 'U-10002', index: 0, photoId: B1 }), true);
  const u = users.docs.get('U-10002');
  assert.equal(isPending(u, 0), false);
  assert.deepEqual(u.photoReview, {});
  assert.deepEqual(u.photoReviewAt, {});
  assert.deepEqual(u.photos, [B1]);
  assert.equal(await approvePhoto(users, { userId: 'U-10002', index: 0, photoId: B1 }), false, 'already checked');
});

test('reject empties the slot, clears its review and leaves a notice; a replaced photo is never rejected by mistake', async () => {
  const users = people();
  const notice = photoNotice({ id: 'N-1', slot: 3, at: 't9' });
  assert.deepEqual(notice, { id: 'N-1', kind: 'photo', slot: 3, text: PHOTO_REJECTED_TEXT, at: 't9', seenAt: null });
  assert.equal(PHOTO_REJECTED_TEXT, 'A photo was not accepted — please use a clear photo of your face.');
  assert.equal(await rejectPhoto(users, { userId: 'U-10003', index: 2, photoId: B1, notice }), false, 'a different photo is in slot 3 now');
  assert.equal(users.docs.get('U-10003').notices.length, 0);
  assert.equal(await rejectPhoto(users, { userId: 'U-10003', index: 0, photoId: C1, notice }), false, 'photo 1 is approved: not in the queue');
  assert.equal(await rejectPhoto(users, { userId: 'U-10003', index: 2, photoId: C3, notice }), true);
  const u = users.docs.get('U-10003');
  assert.deepEqual(u.photos, [C1, null, null]);
  assert.equal(isPending(u, 2), false);
  assert.deepEqual(u.notices, [notice]);
  assert.equal(await rejectPhoto(users, { userId: 'U-10003', index: 2, photoId: C3, notice }), false, 'once only');
  assert.equal(users.docs.get('U-10003').notices.length, 1);
});

// ---------------------------------------------------------------- the admin routes (no database needed for these)

function fakeReq({ method = 'GET', headers = {} } = {}) {
  return { method, headers: { host: 'localhost:8000', ...headers }, resume() {}, on() {} };
}
function fakeRes() {
  const r = { status: 0, headers: {}, body: '' };
  r.writeHead = (s, h) => { r.status = s; r.headers = h; };
  r.end = (b) => { r.body = String(b ?? ''); };
  return r;
}
const call = async (method, path, headers) => {
  const res = fakeRes();
  await handleThirtyDaAdmin(fakeReq({ method, headers }), res, new URL(`http://localhost:8000${path}`));
  return res;
};

test('admin Photos: approve / reject only from the admin pages (Origin, Sec-Fetch-Site, JSON), signed in only', async () => {
  for (const verb of ['approve', 'reject']) {
    const path = `/30da/admin/api/photos/U-10002/0/${verb}`;
    let r = await call('POST', path, { origin: 'https://evil.example', 'content-type': 'application/json' });
    assert.equal(r.status, 403, `${verb}: a foreign Origin`);
    r = await call('POST', path, { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' });
    assert.equal(r.status, 403, `${verb}: cross-site`);
    r = await call('POST', path, { origin: 'http://localhost:8000', 'content-type': 'text/plain' });
    assert.equal(r.status, 415, `${verb}: not JSON (a plain form)`);
    r = await call('POST', path, { origin: 'http://localhost:8000', 'content-type': 'application/json' });
    assert.equal(r.status, 401, `${verb}: no admin session`);
  }
  for (const path of ['/30da/admin/api/photos', '/30da/admin/api/photos/count', `/30da/admin/api/photos/${B1}`]) {
    assert.equal((await call('GET', path)).status, 401, path);
  }
  const page = await call('GET', '/30da/admin/photos');
  assert.equal(page.status, 302);
  assert.equal(page.headers.Location, '/30da/admin');
});

test('admin Photos: the page script and styles are served; every admin page links Photos with its badge', async () => {
  const js = await call('GET', '/30da/admin/photos.js');
  assert.equal(js.status, 200);
  assert.match(js.headers['Content-Type'], /javascript/);
  const css = await call('GET', '/30da/admin/photos.css');
  assert.equal(css.status, 200);
  assert.match(css.headers['Content-Type'], /text\/css/);
  const read = (f) => readFileSync(new URL(`../thirtyda-admin/${f}`, import.meta.url), 'utf8');
  for (const page of ['monitor.html', 'questions.html', 'connections.html', 'support.html', 'photos.html']) {
    const html = read(page);
    assert.ok(html.includes('href="/30da/admin/photos"'), `${page}: Photos in the sidebar`);
    assert.ok(html.includes('id="photos-badge"'), `${page}: the waiting count`);
    assert.ok(html.includes('<script src="/30da/admin/support-badge.js" defer></script>'), `${page}: the badge script`);
  }
  assert.match(read('support-badge.js'), /\/30da\/admin\/api\/photos\/count/);
  // Names go on the page as text, never as HTML.
  assert.ok(!/innerHTML/.test(read('photos.js')));
});

// ---------------------------------------------------------------- the app's words (5 languages)

function stringKeys(src, prefix) {
  const out = {};
  const block = src.slice(src.lastIndexOf('registerStrings({'));
  for (const m of block.matchAll(/^ {2}(\w{2}): \{\n([\s\S]*?)\n {2}\},?$/gm)) {
    out[m[1]] = new Set([...m[2].matchAll(new RegExp(`^ {4}(${prefix}):`, 'gm'))].map((k) => k[1]));
  }
  return out;
}

test('the app: "Waiting for approval" on Me, and the rejected-photo notice, in all 5 languages', () => {
  const read = (f) => readFileSync(new URL(`../thirtyda-app/${f}`, import.meta.url), 'utf8');
  const me = read('screens/my-profile.js');
  const app = read('app.js');
  for (const [src, key] of [[me, 'me_photo_waiting'], [me, 'me_waiting_note'], [app, 'app_notice_photo']]) {
    const keys = stringKeys(src, key);
    for (const lang of LANGS) assert.ok(keys[lang]?.has(key), `${key} in ${lang}`);
  }
  assert.ok(app.includes(`app_notice_photo: '${PHOTO_REJECTED_TEXT}'`), 'the English notice says what the server says');
  assert.match(app, /notice\.kind === 'photo' \? t\('app_notice_photo'\)/);
  assert.match(me, /state\.me\.photoPending\?\.\[i\]/);
});
