// Run: npm run 30da:test (or node --test src/lib/thirtyda-admin-photos.test.mjs)
// Users → Photos (owner 2026-10-15: "i still can not see the 4 photo preview and has function to manually view and
// appprove or disqualify"): the 4 slots of a profile on the admin (GET /30da/admin/api/users/:id/photos), each photo
// while THAT id is in that slot (…/photos/:index?id=, size=thumb ≤ 160 px), Approve (pending only) and Disqualify (any
// photo: the slot emptied exactly as Reject empties it, the stored photo deleted, the person told, block if asked; never
// an App review account's), the overview's ids + status summary, and the page (monitor.js / monitor.html / app.css).
// In-memory Mongo stand-in and photo store (src/lib/thirtyda-admin.mjs setAdminTestHooks): no database, no network.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import sharp from 'sharp';
import {
  PHOTO_REJECTED_TEXT, adminSlots, photoSummary, slotStatus, photoInSlot, disqualifyPhoto, photoNotice,
} from './thirtyda-photo-review.mjs';
import { THUMB_PX, thumbPhoto } from './thirtyda-photos.mjs';

const { handleThirtyDaAdmin, setAdminTestHooks } = await import('./thirtyda-admin.mjs');

// ---------------------------------------------------------------- an in-memory Mongo, just enough for these routes

const get = (doc, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc);
const val = (v) => (v instanceof Date ? v.getTime() : v);
const same = (v, want) => (want === null ? v == null : Array.isArray(v) && !Array.isArray(want) ? v.some((x) => val(x) === val(want)) : val(v) === val(want));
const TYPES = { array: Array.isArray, null: (v) => v === null, string: (v) => typeof v === 'string' };
function matches(doc, q) {
  return Object.entries(q || {}).every(([k, cond]) => {
    if (k === '$or') return cond.some((c) => matches(doc, c));
    const v = get(doc, k);
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && Object.keys(cond).some((x) => x.startsWith('$'))) {
      return Object.entries(cond).every(([op, want]) => {
        if (op === '$gt') return v != null && val(v) > val(want);
        if (op === '$ne') return !same(v, want);
        if (op === '$in') return want.some((w) => same(v, w));
        if (op === '$type') return TYPES[want](v);
        if (op === '$exists') return (v !== undefined) === want;
        throw new Error(`the fake has no ${op}`);
      });
    }
    return same(v, cond);
  });
}
function setPath(doc, path, value) {
  const keys = path.split('.');
  let o = doc;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys.at(-1)] = structuredClone(value);
}
function unsetPath(doc, path) {
  const keys = path.split('.');
  const o = keys.length === 1 ? doc : get(doc, keys.slice(0, -1).join('.'));
  if (o && typeof o === 'object') delete o[keys.at(-1)];
}
function apply(x, u) {
  if (Array.isArray(u)) {
    // The one pipeline update the admin sends (trimPhotoSlots): drop the empty slots at the end of photos.
    assert.ok(u[0]?.$set?.photos?.$reduce, 'only the trim of the empty slots at the end');
    const p = [...x.photos];
    while (p.length && p.at(-1) == null) p.pop();
    x.photos = p;
    return;
  }
  for (const [k, v] of Object.entries(u.$set || {})) setPath(x, k, v);
  for (const k of Object.keys(u.$unset || {})) unsetPath(x, k);
  for (const [k, v] of Object.entries(u.$push || {})) (x[k] ??= []).push(structuredClone(v));
  for (const [k, v] of Object.entries(u.$addToSet || {})) {
    const list = (x[k] ??= []);
    for (const item of v?.$each ?? [v]) if (!list.includes(item)) list.push(item);
  }
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
        find(q) {
          let rows = all(q);
          const cursor = {
            sort(by) { const [[k, dir]] = Object.entries(by); rows = [...rows].sort((a, b) => (val(a[k]) > val(b[k]) ? dir : -dir)); return cursor; },
            limit(n) { rows = rows.slice(0, n); return cursor; },
            async toArray() { return rows.map((x) => structuredClone(x)); },
          };
          return cursor;
        },
        async countDocuments(q) { return all(q).length; },
        async insertOne(doc) { const _id = doc._id ?? crypto.randomUUID(); docs.set(_id, structuredClone({ ...doc, _id })); return { insertedId: _id }; },
        async deleteOne(q) { const x = all(q)[0]; if (x) docs.delete(x._id); return { deletedCount: x ? 1 : 0 }; },
        async updateOne(q, u) {
          const x = all(q)[0];
          if (!x) return { matchedCount: 0, modifiedCount: 0 };
          apply(x, u);
          return { matchedCount: 1, modifiedCount: 1 };
        },
        async updateMany(q, u) {
          const xs = all(q);
          for (const x of xs) apply(x, u);
          return { matchedCount: xs.length, modifiedCount: xs.length };
        },
      });
    }
    return cols.get(name);
  };
  return { collection, docs: (name) => [...collection(name).docs.values()] };
}

// ---------------------------------------------------------------- people, photos, the admin

const P = (c) => c.repeat(32); // a photo id: 32 hex characters
const [A1, A2, A4, B1, C1, C2, C3, R1, R2, D1, D3, E1, E3] = ['a', 'b', 'c', 'd', 'e', 'f', '0', '1', '2', '3', '4', '5', '6'].map(P);
const T0 = '2026-10-15T01:00:00.000Z';
const TOKEN = 'a'.repeat(64);
const HOST = 'ecom.ggmt.sg';
const JSON_HEADERS = { 'content-type': 'application/json', origin: `https://${HOST}`, 'sec-fetch-site': 'same-origin' };
const API = '/30da/admin/api/users';

/** A JPEG as the store keeps them (600 × 800, one colour per photo). */
const jpeg = (n) => sharp({ create: { width: 600, height: 800, channels: 3, background: { r: (n * 37) % 256, g: 90, b: 160 } } }).jpeg().toBuffer();

let d = null;
let store = null; // photo id → bytes
let removed = [];

beforeEach(async () => {
  d = fakeDb();
  store = new Map();
  removed = [];
  const ids = [A1, A2, A4, B1, C1, C2, C3, R1, R2, D1, D3, E1, E3];
  for (const [i, id] of ids.entries()) store.set(id, await jpeg(i + 1));
  await d.collection('thirtyda_admin_sessions').insertOne({ _id: TOKEN, created: new Date(), expires: new Date(Date.now() + 3600e3) });
  await d.collection('thirtyda_admin_sessions').insertOne({ _id: 'b'.repeat(64), created: new Date(), expires: new Date(Date.now() - 1000) });
  const base = (id, name, extra) => ({ _id: id, id, name, level: 1, language: 'English', area: 'Phnom Penh', blocked: false, notices: [], ...extra });
  for (const u of [
    // Photo 1 and 4 approved, photo 2 just replaced (pending), photo 3 empty.
    base('U-10001', 'Dara', { photos: [A1, A2, null, A4], photoReview: { 1: 'pending' }, photoReviewAt: { 1: T0 } }),
    // A new profile: photo 1 pending.
    base('U-10002', 'Sophea', { photos: [B1], photoReview: { 0: 'pending' }, photoReviewAt: { 0: T0 } }),
    // Made before the rule: every photo approved.
    base('U-10004', 'Old', { photos: [C1, C2, C3] }),
    // An App review demo account (src/lib/thirtyda-review.mjs): its photos change on the App review page.
    base('U-10003', 'Review', { demo: 'review', photos: [R1, R2] }),
  ]) await d.collection('thirtyda_users').insertOne(u);
  setAdminTestHooks({
    db: d,
    photoStore: { read: async (id) => store.get(id) ?? null, remove: async (id) => { removed.push(id); store.delete(id); } },
  });
});

async function admin(method, path, { headers = {}, body, cookie = TOKEN } = {}) {
  const req = {
    method, url: path,
    headers: { host: HOST, ...(cookie ? { cookie: `thirtyda_admin=${cookie}` } : {}), ...headers },
    resume() {},
    on(ev, fn) {
      if (ev === 'data' && body !== undefined) fn(Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
      if (ev === 'end') setImmediate(fn);
    },
  };
  const res = { status: null, headers: null, body: undefined };
  res.writeHead = (s, h = {}) => { res.status = s; res.headers = h; return res; };
  res.end = (b) => { res.raw = b; res.body = b === undefined ? undefined : String(b); return res; };
  await handleThirtyDaAdmin(req, res, new URL(path, `https://${HOST}`));
  res.json = () => JSON.parse(res.body);
  return res;
}
const decide = (id, index, what, body, opts = {}) => admin('POST', `${API}/${id}/photos/${index}/${what}`, { headers: JSON_HEADERS, body, ...opts });
const userDoc = (id) => d.collection('thirtyda_users').docs.get(id);
const audits = (action) => d.docs('thirtyda_audit').filter((a) => a.action === action);
const keysOf = (o) => Object.keys(o).sort();

// ---------------------------------------------------------------- who may ask

test('Users → Photos: admin only — no session or an expired one → 401; writes only from the admin pages (Origin, Sec-Fetch-Site, JSON)', async () => {
  for (const cookie of [null, 'b'.repeat(64), 'c'.repeat(64)]) {
    assert.equal((await admin('GET', `${API}/U-10001/photos`, { cookie })).status, 401, `listing, ${cookie}`);
    assert.equal((await admin('GET', `${API}/U-10001/photos/0?id=${A1}`, { cookie })).status, 401, 'the photo');
    assert.equal((await admin('GET', `${API}/U-10001/photos/0?id=${A1}&size=thumb`, { cookie })).status, 401, 'the thumbnail');
    for (const what of ['approve', 'disqualify']) assert.equal((await decide('U-10001', 1, what, { photoId: A2 }, { cookie })).status, 401, what);
  }
  for (const what of ['approve', 'disqualify']) {
    const body = { photoId: A2 };
    assert.equal((await decide('U-10001', 1, what, body, { headers: { ...JSON_HEADERS, origin: 'https://evil.example' } })).status, 403, `${what}: a foreign Origin`);
    assert.equal((await decide('U-10001', 1, what, body, { headers: { ...JSON_HEADERS, origin: `https://x.${HOST}` } })).status, 403, `${what}: a sibling subdomain`);
    assert.equal((await decide('U-10001', 1, what, body, { headers: { ...JSON_HEADERS, 'sec-fetch-site': 'cross-site' } })).status, 403, `${what}: cross-site`);
    assert.equal((await decide('U-10001', 1, what, `photoId=${A2}`, { headers: { ...JSON_HEADERS, 'content-type': 'application/x-www-form-urlencoded' } })).status, 415, `${what}: a form post`);
  }
  assert.deepEqual(userDoc('U-10001').photos, [A1, A2, null, A4], 'nothing changed');
  assert.deepEqual(userDoc('U-10001').photoReview, { 1: 'pending' });
  assert.deepEqual(removed, []);
  // Anything else under …/photos is not a route.
  assert.equal((await admin('POST', `${API}/U-10001/photos`, { headers: JSON_HEADERS, body: {} })).status, 404);
  assert.equal((await admin('POST', `${API}/U-10001/photos/1/reject`, { headers: JSON_HEADERS, body: { photoId: A2 } })).status, 404, 'reject is the Photos page\'s');
  assert.equal((await admin('GET', `${API}/U-10001/photos/1/approve`)).status, 404, 'a GET never decides');
});

// ---------------------------------------------------------------- the 4 slots

test('listing: the 4 slots slot-aligned (empty ones too), status and since when; url / thumb carry the photo id; the opening audited with the id only', async () => {
  const r = await admin('GET', `${API}/U-10001/photos`);
  assert.equal(r.status, 200);
  assert.equal(r.headers['Cache-Control'], 'no-store');
  const v = r.json();
  assert.deepEqual(v.user, { id: 'U-10001', name: 'Dara', review: false, blocked: false });
  assert.equal(v.slots.length, 4);
  const src = (i, id) => `${API}/U-10001/photos/${i}?id=${id}`;
  assert.deepEqual(v.slots, [
    { index: 0, photoId: A1, status: 'approved', at: null, url: src(0, A1), thumb: `${src(0, A1)}&size=thumb` },
    { index: 1, photoId: A2, status: 'pending', at: T0, url: src(1, A2), thumb: `${src(1, A2)}&size=thumb` },
    { index: 2, photoId: null, status: null, at: null, url: null, thumb: null },
    { index: 3, photoId: A4, status: 'approved', at: null, url: src(3, A4), thumb: `${src(3, A4)}&size=thumb` },
  ]);
  const seen = audits('view_user_photos');
  assert.equal(seen.length, 1);
  assert.deepEqual(keysOf(seen[0]), ['_id', 'action', 'at', 'ip', 'user']);
  assert.equal(seen[0].user, 'U-10001');
  // An App review account: shown (view-only on the page).
  const rv = (await admin('GET', `${API}/U-10003/photos`)).json();
  assert.deepEqual(rv.user, { id: 'U-10003', name: 'Review', review: true, blocked: false });
  assert.deepEqual(rv.slots.map((s) => s.status), ['approved', 'approved', null, null]);
  // No such profile.
  const none = await admin('GET', `${API}/U-99999/photos`);
  assert.equal(none.status, 404);
  assert.equal(none.json().reason, 'not_found');
  assert.equal((await admin('GET', `${API}/x/photos`)).status, 404, 'not an id');
});

test('the photo: only while THAT id is in that slot (approved or pending), private and never cached; 404 for a replaced id, another slot, an empty slot', async () => {
  for (const [i, id] of [[0, A1], [1, A2], [3, A4]]) {
    const r = await admin('GET', `${API}/U-10001/photos/${i}?id=${id}`);
    assert.equal(r.status, 200, `slot ${i}`);
    assert.equal(r.headers['Content-Type'], 'image/jpeg');
    assert.equal(r.headers['Cache-Control'], 'private, no-store');
    assert.equal(r.headers['X-Content-Type-Options'], 'nosniff');
    assert.ok(Buffer.from(r.raw).equals(store.get(id)), 'the stored bytes');
  }
  const notFound = async (path, why) => {
    const r = await admin('GET', path);
    assert.equal(r.status, 404, why);
    assert.notEqual(r.headers['Content-Type'], 'image/jpeg', why);
  };
  await notFound(`${API}/U-10001/photos/0?id=${A2}`, 'that photo is in another slot');
  await notFound(`${API}/U-10001/photos/2?id=${A1}`, 'an empty slot');
  await notFound(`${API}/U-10002/photos/0?id=${A1}`, 'someone else\'s photo');
  await notFound(`${API}/U-10001/photos/0`, 'no id');
  await notFound(`${API}/U-10001/photos/0?id=nope`, 'not a photo id');
  await notFound(`${API}/U-99999/photos/0?id=${A1}`, 'no such profile');
  await notFound(`${API}/U-10001/photos/4?id=${A1}`, 'slot 5');
  // Replaced in the app meanwhile: the old id is never shown under that slot again (even while its bytes still exist).
  userDoc('U-10001').photos[0] = D1;
  await notFound(`${API}/U-10001/photos/0?id=${A1}`, 'replaced');
  assert.equal((await admin('GET', `${API}/U-10001/photos/0?id=${D1}`)).status, 200, 'the new one');
  // Gone from the store: 404, not a broken image.
  store.delete(A4);
  await notFound(`${API}/U-10001/photos/3?id=${A4}`, 'not in the store');
});

test('size=thumb: the photo re-encoded with sharp to a JPEG of at most 160 px, never cached', async () => {
  assert.equal(THUMB_PX, 160);
  const full = await admin('GET', `${API}/U-10001/photos/1?id=${A2}`);
  const r = await admin('GET', `${API}/U-10001/photos/1?id=${A2}&size=thumb`);
  assert.equal(r.status, 200);
  assert.equal(r.headers['Content-Type'], 'image/jpeg');
  assert.equal(r.headers['Cache-Control'], 'private, no-store');
  assert.equal(r.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(r.headers['Content-Length'], r.raw.length);
  const meta = await sharp(r.raw).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.deepEqual([meta.width, meta.height], [120, 160], '600 × 800 → 120 × 160');
  assert.ok(r.raw.length < full.raw.length, 'smaller than the photo');
  // The same rule as the photo: a replaced id is 404, thumbnail or not.
  assert.equal((await admin('GET', `${API}/U-10001/photos/0?id=${A2}&size=thumb`)).status, 404);
  // A file the store cannot decode: 404, never a 500 or the raw bytes.
  store.set(A4, Buffer.from('not a jpeg'));
  assert.equal((await admin('GET', `${API}/U-10001/photos/3?id=${A4}&size=thumb`)).status, 404);
});

test('an empty stored file (a write cut short): 404 for the photo and its thumbnail, never a 500 or an empty image', async () => {
  store.set(A4, Buffer.alloc(0));
  for (const q of ['', '&size=thumb']) {
    const r = await admin('GET', `${API}/U-10001/photos/3?id=${A4}${q}`);
    assert.equal(r.status, 404, q || 'the photo');
    assert.notEqual(r.headers['Content-Type'], 'image/jpeg', q || 'the photo');
  }
  // thumbPhoto itself: sharp throws an empty buffer in its constructor — it comes back as a rejection, never a throw.
  const p = thumbPhoto(Buffer.alloc(0));
  assert.ok(p instanceof Promise);
  await assert.rejects(p, /empty/i);
});

// ---------------------------------------------------------------- approve

test('approve: a pending photo only — then everyone may see it; 409 for an approved photo or a replaced id; the audit has ids only', async () => {
  let r = await decide('U-10001', 0, 'approve', { photoId: A1 });
  assert.equal(r.status, 409, 'already approved');
  assert.equal(r.json().reason, 'photo_changed');
  assert.equal(r.json().slots.length, 4, 'the fresh slots come with the refusal');
  r = await decide('U-10001', 1, 'approve', { photoId: A1 });
  assert.equal(r.status, 409, 'another photo is in that slot');
  assert.equal(userDoc('U-10001').photoReview[1], 'pending');
  for (const body of [{}, { photoId: 'nope' }, { photoId: 7 }]) assert.equal((await decide('U-10001', 1, 'approve', body)).status, 400, JSON.stringify(body));
  assert.equal((await decide('U-99999', 1, 'approve', { photoId: A2 })).status, 404);

  r = await decide('U-10001', 1, 'approve', { photoId: A2 });
  assert.equal(r.status, 200);
  const v = r.json();
  assert.equal(v.ok, true);
  assert.equal(v.slots[1].status, 'approved');
  assert.equal(v.slots[1].at, null);
  assert.equal(v.count, 1, 'photos still waiting (the sidebar badge): Sophea\'s');
  assert.deepEqual(userDoc('U-10001').photos, [A1, A2, null, A4], 'the photos stay where they are');
  assert.equal(1 in userDoc('U-10001').photoReview, false);
  assert.deepEqual(removed, []);
  const a = audits('photo_approve');
  assert.equal(a.length, 1);
  assert.deepEqual(keysOf(a[0]), ['_id', 'action', 'at', 'ip', 'photo', 'slot', 'user']);
  assert.deepEqual([a[0].user, a[0].slot, a[0].photo], ['U-10001', 2, A2]);
  assert.equal((await decide('U-10001', 1, 'approve', { photoId: A2 })).status, 409, 'once only');
});

// ---------------------------------------------------------------- disqualify

test('disqualify an APPROVED photo: the slot emptied, the stored photo deleted, the person told; the audit has ids only', async () => {
  const r = await decide('U-10001', 3, 'disqualify', { photoId: A4 });
  assert.equal(r.status, 200, r.body);
  const v = r.json();
  assert.equal(v.ok, true);
  assert.equal(v.blocked, false);
  assert.deepEqual(v.slots.map((s) => s.photoId), [A1, A2, null, null]);
  assert.equal(v.count, 2, 'Dara\'s photo 2 and Sophea\'s photo 1 still wait');
  const u = userDoc('U-10001');
  assert.deepEqual(u.photos, [A1, A2], 'photo 4 gone; the empty slots at the end dropped, as after a reject');
  assert.deepEqual(u.photoReview, { 1: 'pending' }, 'the other photo still waits');
  assert.deepEqual(removed, [A4]);
  assert.equal(store.has(A4), false, 'deleted from the store');
  assert.equal(u.notices.length, 1);
  const [n] = u.notices;
  assert.deepEqual({ ...n, id: 'x', at: 'x' }, { id: 'x', kind: 'photo', slot: 4, text: PHOTO_REJECTED_TEXT, at: 'x', seenAt: null }, 'the same notice as a reject');
  assert.match(n.id, /^N-[0-9a-f]{12}$/);
  const a = audits('photo_disqualified');
  assert.equal(a.length, 1);
  assert.deepEqual(keysOf(a[0]), ['_id', 'action', 'at', 'block', 'ip', 'photo', 'slot', 'user']);
  assert.deepEqual([a[0].user, a[0].slot, a[0].photo, a[0].block], ['U-10001', 4, A4, false]);
  assert.equal(JSON.stringify(a).includes('Dara'), false, 'never a name');
  // Again: no longer in that slot → 409, nothing more deleted, nobody told twice.
  const again = await decide('U-10001', 3, 'disqualify', { photoId: A4 });
  assert.equal(again.status, 409);
  assert.equal(again.json().reason, 'photo_changed');
  assert.deepEqual(removed, [A4]);
  assert.equal(userDoc('U-10001').notices.length, 1);
});

test('disqualify a PENDING photo: out of the Photos queue too, the waiting count goes down', async () => {
  let q = (await admin('GET', '/30da/admin/api/photos')).json();
  assert.deepEqual(q.photos.map((p) => [p.user, p.slot]), [['U-10002', 1], ['U-10001', 2]]);
  const r = await decide('U-10002', 0, 'disqualify', { photoId: B1 });
  assert.equal(r.status, 200);
  assert.equal(r.json().count, 1);
  assert.deepEqual(r.json().slots.map((s) => s.status), [null, null, null, null]);
  const u = userDoc('U-10002');
  assert.deepEqual(u.photos, []);
  assert.deepEqual(u.photoReview, {});
  assert.deepEqual(u.photoReviewAt, {});
  assert.equal(u.notices[0].slot, 1);
  assert.deepEqual(removed, [B1]);
  q = (await admin('GET', '/30da/admin/api/photos')).json();
  assert.deepEqual(q.photos.map((p) => p.user), ['U-10001']);
  assert.equal((await admin('GET', '/30da/admin/api/photos/count')).json().count, 1);
});

test('slot semantics: the other photos never slide down; exactly what Reject leaves for the same pending photo', async () => {
  // Photo 2 of 3: photo 3 stays photo 3.
  let r = await decide('U-10004', 1, 'disqualify', { photoId: C2 });
  assert.equal(r.status, 200);
  assert.deepEqual(userDoc('U-10004').photos, [C1, null, C3]);
  assert.deepEqual(r.json().slots.map((s) => s.photoId), [C1, null, C3, null]);
  // Photo 1 (main): emptied like a reject empties it — the others keep their slots.
  r = await decide('U-10004', 0, 'disqualify', { photoId: C1 });
  assert.equal(r.status, 200);
  assert.deepEqual(userDoc('U-10004').photos, [null, null, C3]);
  // The last one: the empty slots at the end go.
  r = await decide('U-10004', 2, 'disqualify', { photoId: C3 });
  assert.deepEqual(userDoc('U-10004').photos, []);
  assert.deepEqual(removed, [C2, C1, C3]);
  assert.deepEqual(userDoc('U-10004').notices.map((n) => n.slot), [2, 1, 3]);

  // Two profiles alike, photo 3 pending: Reject on the Photos page and Disqualify here leave the same profile.
  const twin = (id) => ({ _id: id, id, name: 'Twin', photos: [D1, null, D3], photoReview: { 2: 'pending' }, photoReviewAt: { 2: T0 }, notices: [] });
  await d.collection('thirtyda_users').insertOne(twin('U-20001'));
  await d.collection('thirtyda_users').insertOne({ ...twin('U-20002'), photos: [E1, null, E3] });
  r = await admin('POST', `/30da/admin/api/photos/U-20001/2/reject`, { headers: JSON_HEADERS, body: { photoId: D3 } });
  assert.equal(r.status, 200);
  r = await decide('U-20002', 2, 'disqualify', { photoId: E3 });
  assert.equal(r.status, 200);
  const shape = (u) => ({ photos: u.photos.map((x) => (x ? 'photo' : null)), photoReview: u.photoReview, photoReviewAt: u.photoReviewAt, notices: u.notices.map(({ id, at, ...n }) => n) });
  assert.deepEqual(shape(userDoc('U-20002')), shape(userDoc('U-20001')));
  assert.deepEqual(shape(userDoc('U-20002')).photos, ['photo'], 'photo 3 gone, the empty slots at the end dropped');
});

test('disqualify + block: blocked, their open flags settled; the audit says so (ids only)', async () => {
  await d.collection('thirtyda_flags').insertOne({ _id: 'f1', id: 'f1', from: 'U-10004', to: 'U-10001', status: 'open', at: T0, reason: 'x', key: 'k' });
  const r = await decide('U-10004', 0, 'disqualify', { photoId: C1, block: true });
  assert.equal(r.status, 200);
  assert.equal(r.json().blocked, true);
  assert.equal(r.json().user.blocked, true);
  const u = userDoc('U-10004');
  assert.equal(u.blocked, true);
  assert.deepEqual(u.blockResolved, ['f1']);
  assert.equal(d.collection('thirtyda_flags').docs.get('f1').status, 'blocked');
  assert.deepEqual(removed, [C1]);
  const [a] = audits('photo_disqualified');
  assert.deepEqual(keysOf(a), ['_id', 'action', 'alreadyBlocked', 'at', 'block', 'ip', 'photo', 'slot', 'user']);
  assert.deepEqual([a.block, a.alreadyBlocked], [true, false]);
  // block must be true itself: anything else does not block.
  const r2 = await decide('U-10001', 0, 'disqualify', { photoId: A1, block: 'yes' });
  assert.equal(r2.json().blocked, false);
  assert.equal(userDoc('U-10001').blocked, false);
});

test('an App review account: disqualify refused (409 review_account) — nothing deleted, nobody told, never blocked', async () => {
  for (const body of [{ photoId: R1 }, { photoId: R2, block: true }]) {
    const r = await decide('U-10003', body.photoId === R1 ? 0 : 1, 'disqualify', body);
    assert.equal(r.status, 409);
    assert.equal(r.json().reason, 'review_account');
    assert.match(r.json().error, /App review page/);
    assert.equal(r.json().user.review, true, 'the fresh slots come with it');
  }
  const u = userDoc('U-10003');
  assert.deepEqual(u.photos, [R1, R2]);
  assert.deepEqual(u.notices, []);
  assert.equal(u.blocked, false);
  assert.deepEqual(removed, []);
  assert.equal(audits('photo_disqualified').length, 0);
  // Its photos still show (view-only).
  assert.equal((await admin('GET', `${API}/U-10003/photos/0?id=${R1}&size=thumb`)).status, 200);
  // The update itself refuses a review account too (one made meanwhile is never touched).
  const users = d.collection('thirtyda_users');
  assert.equal(await disqualifyPhoto(users, { userId: 'U-10003', index: 0, photoId: R1, notice: photoNotice({ id: 'N-1', slot: 1 }) }), false);
  assert.equal(await disqualifyPhoto(users, { userId: 'U-10004', index: 0, photoId: C1, notice: photoNotice({ id: 'N-2', slot: 1 }) }), true);
});

// ---------------------------------------------------------------- the overview's summary

test('overview: every user row carries photos as 4 × { photoId, status } — ids and status only, no review fields', async () => {
  const r = await admin('GET', '/30da/admin/api/overview');
  assert.equal(r.status, 200);
  const rows = r.json().users;
  for (const u of rows) {
    assert.equal(u.photos.length, 4, u.id);
    for (const p of u.photos) assert.deepEqual(keysOf(p), ['photoId', 'status'], u.id);
    assert.equal('photoReview' in u || 'photoReviewAt' in u, false, `${u.id}: the summary only`);
  }
  const by = Object.fromEntries(rows.map((u) => [u.id, u.photos]));
  assert.deepEqual(by['U-10001'], [{ photoId: A1, status: 'approved' }, { photoId: A2, status: 'pending' }, { photoId: null, status: null }, { photoId: A4, status: 'approved' }]);
  assert.deepEqual(by['U-10002'], [{ photoId: B1, status: 'pending' }, ...Array(3).fill({ photoId: null, status: null })]);
  assert.deepEqual(by['U-10004'].map((p) => p.status), ['approved', 'approved', 'approved', null]);
  assert.equal(/\/api\/users\/U-\d+\/photos/.test(r.body), false, 'no urls: the page makes them from the ids');
});

test('photo-review helpers: slotStatus / photoInSlot / adminSlots / photoSummary', () => {
  const u = { photos: [A1, 'junk', null, A4, B1], photoReview: { 3: 'pending' }, photoReviewAt: { 3: T0 } };
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => slotStatus(u, i)), ['approved', null, null, 'pending', null], 'not a photo id = empty; 4 slots only');
  assert.equal(photoInSlot(u, 0, A1), true);
  assert.equal(photoInSlot(u, 3, A4), true, 'pending counts');
  assert.equal(photoInSlot(u, 1, A1), false);
  assert.equal(photoInSlot(u, 1, 'junk'), false);
  assert.equal(photoInSlot(u, 4, B1), false, 'a fifth entry is no slot');
  assert.deepEqual(adminSlots(u).map((s) => [s.index, s.photoId, s.status, s.at]), [[0, A1, 'approved', null], [1, null, null, null], [2, null, null, null], [3, A4, 'pending', T0]]);
  assert.deepEqual(photoSummary({}), Array(4).fill({ photoId: null, status: null }));
  assert.deepEqual(photoSummary({ photos: [A1] }), [{ photoId: A1, status: 'approved' }, ...Array(3).fill({ photoId: null, status: null })]);
});

// ---------------------------------------------------------------- the limit

test('approve / disqualify: at most 120 per admin session per 15 minutes, then 429', async () => {
  const other = 'e'.repeat(64);
  await d.collection('thirtyda_admin_sessions').insertOne({ _id: other, created: new Date(), expires: new Date(Date.now() + 3600e3) });
  for (let i = 0; i < 120; i++) {
    const r = await decide('U-10001', 0, 'approve', { photoId: A1 }, { cookie: other });
    assert.equal(r.status, 409, `try ${i + 1}`);
  }
  const r = await decide('U-10001', 1, 'disqualify', { photoId: A2 }, { cookie: other });
  assert.equal(r.status, 429);
  assert.deepEqual(removed, []);
  assert.equal((await decide('U-10001', 1, 'approve', { photoId: A2 })).status, 200, 'another session is not stopped');
});

// ---------------------------------------------------------------- the page

test('the page: a Photos column with 4 slot-aligned lazy thumbnails, a Photos row action, the dialog (Approve / Disqualify, the ask step, Esc, the focus)', async () => {
  const read = (f) => readFileSync(new URL(`../thirtyda-admin/${f}`, import.meta.url), 'utf8');
  const html = read('monitor.html');
  assert.match(html, /<th class="label">User<\/th><th class="label"[^>]*>Photos<\/th><th class="label">Level<\/th>/, 'right after User');
  const js = read('monitor.js');
  const rows = js.slice(js.indexOf('function renderUsers('), js.indexOf('function renderMonitor('));
  assert.ok(rows.includes('<td class="photos-cell" data-photos-cell="${esc(u.id)}"></td>'), 'the Photos cell, between User and Level');
  assert.ok(rows.includes('data-photos="${esc(u.id)}" aria-label="Photos of ${esc(u.name || u.id)}">Photos</button>'), 'the row action');
  const ui = js.slice(js.indexOf('// ---------- Users → Photos'), js.indexOf('// ---------- toast with undo'));
  assert.ok(ui.length > 1000);
  assert.equal(/innerHTML/.test(ui), false, 'built as elements: names as text, never HTML');
  for (const bit of [
    "loading: 'lazy'", '&size=thumb', "class: 'thumb empty'", "title: pending ? 'Waiting for approval'", "'data-slot': i",
    "'Photo 1 · main', 'Photo 2 · Level 2', 'Photo 3 · Level 3', 'Photo 4 · Level 3'",
    'pd.dlg.showModal()', "addEventListener('cancel'", "addEventListener('keydown', keepFocusInside)", "'aria-label': 'Close'",
    "'Approve'", "'Disqualify'", "'Yes, disqualify'", "'Also block this person'",
    '`The photo is deleted and ${who} is told to use a clear photo of their face.`',
    "'App review account — change its photos on the ', el('a', { href: '/30da/admin/review' }, 'App review page')",
    "'aria-label': `Approve ${name} of ${who}`", "'aria-label': `Disqualify ${name} of ${who}`",
    'setPhotosBadge(d.count)', 'refresh(); // the table',
  ]) assert.ok(ui.includes(bit), bit);
  // Approve only for a pending photo; nothing to press on an App review account.
  assert.match(ui, /pending \? el\('button', \{\n\s+type: 'button', class: 'btn-primary'/);
  assert.match(ui, /if \(s\.photoId && !v\.user\.review && pd\.asking === s\.index\)/);
  // The focus goes back to the thumbnail or the row's Photos once the dialog closes.
  assert.match(ui, /button\.thumb\[data-photos=/);
  assert.match(ui, /back\?\.focus\(\)/);
  // The click handler opens it from a thumbnail or the row action; no window.confirm anywhere.
  assert.match(js, /\} else if \(ds\.photos\) \{\n[^\n]*\n\s+openPhotos\(ds\.photos, \{ user: ds\.photos, slot: ds\.slot \?\? null \}\);/);
  assert.equal(/\bconfirm\(/.test(js), false);
  const css = read('app.css');
  for (const rule of ['.thumb.empty { background: none; border: 1.5px dashed', '.thumb.pending { box-shadow: 0 0 0 2px var(--amber); }',
    '.ad-dialog.pd-dialog { width: min(820px, calc(100vw - 32px));', '.table-wrap { overflow-x: auto; }']) assert.ok(css.includes(rule), rule);
  // The dialog's photo box: its one grid cell is the 3:4 box, not the photo's own height — a 9:16 photo is letterboxed
  // whole by object-fit: contain, never cut off at the bottom (an `auto` row grew to the photo and overflow hid the rest).
  const box = css.match(/^\.pd-img \{[^}]*\}/m)?.[0] ?? '';
  for (const bit of ['aspect-ratio: 3 / 4;', 'overflow: hidden;', 'display: grid;', 'grid-template: minmax(0, 1fr) / minmax(0, 1fr);']) {
    assert.ok(box.includes(bit), `.pd-img: ${bit}`);
  }
  assert.ok(css.includes('.pd-img img { display: block; width: 100%; height: 100%; object-fit: contain; }'));
  // The script is served as before.
  const r = await admin('GET', '/30da/admin/monitor.js', { cookie: null });
  assert.equal(r.status, 200);
  assert.match(r.headers['Content-Type'], /^text\/javascript/);
});

// ---------------------------------------------------------------- the page, run: monitor.js's Users → Photos part

/**
 * monitor.js from "Users → Photos" to the toast (plus its `el`), run on its own in a stand-in page: just enough DOM for
 * the thumbnails and the dialog (elements, attributes, events, [data-pd="…"] / tag lookups, focus). `api` answers when
 * the test says so (box.calls), so an answer can land after the dialog was closed and opened again.
 */
function photosBox() {
  const js = readFileSync(new URL('../thirtyda-admin/monitor.js', import.meta.url), 'utf8');
  const elFn = js.slice(js.indexOf('function el('), js.indexOf('const view = {'));
  const from = js.indexOf('// ---------- Users → Photos');
  const to = js.indexOf('// ---------- toast with undo');
  assert.ok(elFn.length > 100 && from > 0 && to > from);
  const doc = { activeElement: null, querySelector: () => null };
  const matches = (n, sel) => {
    const a = sel.match(/^\[([\w-]+)="([^"]*)"\]$/);
    return a ? n.attrs[a[1]] === a[2] : n.tagName === sel.toUpperCase();
  };
  class FakeNode {
    constructor(tag) {
      Object.assign(this, { tagName: tag.toUpperCase(), attrs: {}, kids: [], parent: null, listeners: [], className: '', text: '' });
      Object.assign(this, { hidden: false, disabled: false, checked: false, open: false });
    }
    setAttribute(k, v) {
      this.attrs[k] = v;
      if (['hidden', 'disabled', 'checked'].includes(k)) this[k] = true;
      if (k === 'id') this.id = v;
    }
    getAttribute(k) { return this.attrs[k] ?? null; }
    addEventListener(type, fn, opts) { this.listeners.push({ type, fn, once: Boolean(opts?.once) }); }
    dispatch(type) {
      const ev = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      for (const l of this.listeners.filter((x) => x.type === type)) {
        if (l.once) this.listeners.splice(this.listeners.indexOf(l), 1);
        l.fn(ev);
      }
      return ev;
    }
    append(...nodes) {
      for (const x of nodes) {
        const n = x instanceof FakeNode ? x : Object.assign(new FakeNode('#text'), { text: String(x) });
        n.remove();
        n.parent = this;
        this.kids.push(n);
      }
    }
    replaceChildren(...nodes) {
      for (const k of this.kids) k.parent = null;
      this.kids = [];
      this.text = '';
      this.append(...nodes);
    }
    remove() {
      if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this);
      this.parent = null;
    }
    get textContent() { return this.text + this.kids.map((k) => k.textContent).join(''); }
    set textContent(t) { this.replaceChildren(); this.text = String(t); }
    *walk() { for (const k of this.kids) { yield k; yield* k.walk(); } }
    querySelectorAll(sel) { return [...this.walk()].filter((n) => matches(n, sel)); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
    contains(n) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
    focus() { doc.activeElement = this; }
    getClientRects() { return [{}]; }
    showModal() { this.open = true; }
    close() { if (this.open) { this.open = false; this.dispatch('close'); } }
  }
  doc.createElement = (tag) => new FakeNode(tag);
  doc.body = new FakeNode('body');
  const box = { calls: [], refreshed: 0, badge: new FakeNode('span'), view: { data: { users: [] } } };
  const ctx = vm.createContext({
    document: doc, Node: FakeNode, CSS: { escape: String }, view: box.view, ago: () => 'just now',
    $: (id) => (id === 'photos-badge' ? box.badge : null),
    refresh: () => { box.refreshed += 1; },
    api: (path, body) => new Promise((resolve, reject) => { box.calls.push({ path, body, resolve, reject }); }),
  });
  box.ui = vm.runInContext(`${elFn}\n${js.slice(from, to)}\n;({ thumbImg, photoThumbs, openPhotos, pd })`, ctx);
  box.pd = (name) => box.ui.pd.dlg.querySelector(`[data-pd="${name}"]`);
  box.blockBox = (i) => box.ui.pd.dlg.querySelector(`[id="pd-block-${i}"]`);
  box.tick = () => new Promise(setImmediate);
  /** Opens a profile's dialog and answers its photos: ids per slot, the pending slots. */
  box.open = async (id, name, ids, pending = []) => {
    box.ui.openPhotos(id, { user: id, slot: null });
    box.calls.shift().resolve(photosView(id, name, ids, pending));
    await box.tick();
  };
  return box;
}
const photosView = (id, name, ids, pending = []) => ({
  user: { id, name, review: false, blocked: false },
  slots: [0, 1, 2, 3].map((index) => {
    const photoId = ids[index] ?? null;
    const status = photoId ? (pending.includes(index) ? 'pending' : 'approved') : null;
    const url = photoId ? `${API}/${id}/photos/${index}?id=${photoId}` : null;
    return { index, photoId, status, at: status === 'pending' ? T0 : null, url, thumb: url && `${url}&size=thumb` };
  }),
});

test('the table: a thumbnail that failed to load (a redeploy, the network) is drawn again by the next refresh — a new <img> that asks again', () => {
  const box = photosBox();
  const u = { id: 'U-10001', name: 'Dara', photos: [{ photoId: A1, status: 'approved' }, { photoId: A2, status: 'pending' }, { photoId: null, status: null }, { photoId: null, status: null }] };
  const imgOf = (row, i) => row.kids[i].kids[0];
  const first = box.ui.photoThumbs(u);
  const [img0, img1] = [imgOf(first, 0), imgOf(first, 1)];
  assert.equal(img0.getAttribute('src'), `${API}/U-10001/photos/0?id=${A1}&size=thumb`);
  assert.equal(first.kids[2].className, 'thumb empty');
  // A loaded one: the same <img> moved into the redrawn row (no-store: never asked for again).
  let again = box.ui.photoThumbs(u);
  assert.equal(imgOf(again, 0), img0);
  assert.equal(imgOf(again, 1), img1);
  // A failed one: dropped, so the next draw makes a fresh <img> for the same url; the others stay as they are.
  img1.dispatch('error');
  again = box.ui.photoThumbs(u);
  const fresh = imgOf(again, 1);
  assert.notEqual(fresh, img1, 'a new <img>');
  assert.equal(fresh.getAttribute('src'), img1.getAttribute('src'), 'the same photo');
  assert.equal(imgOf(again, 0), img0, 'the loaded one is kept');
  // And that one is kept while it loads.
  assert.equal(imgOf(box.ui.photoThumbs(u), 1), fresh);
});

test('the dialog: "Also block this person" stays ticked and can no longer be changed while the disqualify is on its way; each ask starts unticked', async () => {
  const box = photosBox();
  box.view.data.users = [{ id: 'U-10001', name: 'Dara' }];
  await box.open('U-10001', 'Dara', [A1, A2, null, A4], [1]);
  box.pd('disqualify-3').dispatch('click');
  let tick = box.blockBox(3);
  assert.deepEqual([tick.checked, tick.disabled], [false, false]);
  tick.checked = true;
  tick.dispatch('change');
  box.pd('yes-3').dispatch('click');
  const call = box.calls.shift();
  assert.deepEqual([call.path, { ...call.body }], [`${API}/U-10001/photos/3/disqualify`, { photoId: A4, block: true }]);
  // Drawn again for the busy state: as the admin left it, and not to change now.
  tick = box.blockBox(3);
  assert.deepEqual([tick.checked, tick.disabled], [true, true]);
  assert.equal(box.pd('yes-3').disabled, true);
  call.resolve({ ok: true, blocked: true, ...photosView('U-10001', 'Dara', [A1, A2], [1]), count: 1 });
  await box.tick();
  assert.equal(box.blockBox(3), null, 'the ask is closed');
  assert.equal(box.ui.pd.parts.done.textContent, 'Disqualified photo 4 and blocked Dara. They were told.');
  // The next ask starts unticked; so does one after a Cancel.
  box.pd('disqualify-0').dispatch('click');
  tick = box.blockBox(0);
  assert.deepEqual([tick.checked, tick.disabled], [false, false]);
  tick.checked = true;
  tick.dispatch('change');
  box.pd('cancel-0').dispatch('click');
  box.pd('disqualify-0').dispatch('click');
  assert.equal(box.blockBox(0).checked, false);
});

test('the dialog: an answer that lands after it was closed (Esc twice) and opened again changes nothing in the new opening; the badge and the table still take it', async () => {
  const box = photosBox();
  box.view.data.users = [{ id: 'U-10001', name: 'Dara' }, { id: 'U-10002', name: 'Sophea' }];
  const { pd } = box.ui;
  // Dara: disqualify photo 4, then Esc twice (the browser lets the second one close it) before the answer.
  await box.open('U-10001', 'Dara', [A1, A2, null, A4], [1]);
  box.pd('disqualify-3').dispatch('click');
  box.pd('yes-3').dispatch('click');
  const late = box.calls.shift();
  assert.equal(pd.busy, true);
  pd.dlg.close();
  // Sophea's photos opened, and her photo 1 being approved, when Dara's answer lands.
  await box.open('U-10002', 'Sophea', [B1], [0]);
  box.pd('approve-0').dispatch('click');
  const own = box.calls.shift();
  assert.equal(own.path, `${API}/U-10002/photos/0/approve`);
  late.resolve({ ok: true, blocked: false, ...photosView('U-10001', 'Dara', [A1, A2], [1]), count: 2 });
  await box.tick();
  assert.equal(pd.dlg.open, true);
  assert.equal(pd.parts.title.textContent, 'Photos · Sophea');
  assert.equal(pd.view.user.id, 'U-10002');
  assert.equal(pd.parts.done.textContent, '', 'no "Disqualified photo 4" under Sophea');
  assert.equal(pd.busy, true, 'her approve is still on its way');
  assert.equal(box.pd('approve-0').disabled, true);
  assert.deepEqual([box.badge.textContent, box.refreshed], ['2', 1], 'the sidebar badge and the table did take it');
  own.resolve({ ok: true, ...photosView('U-10002', 'Sophea', [B1]), count: 1 });
  await box.tick();
  assert.equal(pd.busy, false);
  assert.equal(pd.parts.done.textContent, 'Approved photo 1. Everyone can see it now.');
  assert.deepEqual([box.badge.textContent, box.refreshed], ['1', 2]);
  // The same profile opened again, and a refusal (409, fresh slots) for the old opening: not drawn into the new one.
  box.pd('disqualify-0').dispatch('click');
  box.pd('yes-0').dispatch('click');
  const refused = box.calls.shift();
  pd.dlg.close();
  await box.open('U-10002', 'Sophea', [B1]);
  box.pd('disqualify-0').dispatch('click');
  const err = Object.assign(new Error('This photo was changed or already checked.'), { status: 409, data: { ...photosView('U-10002', 'Sophea', []), count: 0 } });
  refused.reject(err);
  await box.tick();
  assert.equal(pd.parts.error.hidden, true, 'no error in the new opening');
  assert.equal(pd.view.slots[0].photoId, B1, 'its own view');
  assert.equal(pd.asking, 0, 'its open "Yes, disqualify" left alone');
  assert.ok(box.blockBox(0));
  assert.deepEqual([box.badge.textContent, box.refreshed], ['0', 3]);
});
