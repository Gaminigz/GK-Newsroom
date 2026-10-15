// Run: npm run 30da:test (or node --test src/lib/thirtyda-admin-upload.test.mjs)
// Users → Photos → Upload (owner 2026-10-15, the 4 App review test users Dara, Sophea, Sopal, Meng: "its take 1 hours to
// make 4 test users damn"): POST /30da/admin/api/users/:id/photos/:index/upload — the photo itself as the body, into
// that slot of an App REVIEW account only (never a real person's profile), re-encoded by the photo store, approved at
// once, slot-aligned, the old photo deleted only after the swap (a profile's own kept: "Stop being a review account"
// takes the uploads out and puts it back), 409 when the slot changed meanwhile; and the dialog's "Upload 4 photos" /
// Upload / Replace / drop (monitor.js), run in a stand-in page.
// In-memory Mongo stand-in and photo store (src/lib/thirtyda-admin.mjs setAdminTestHooks): no database, no network.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import sharp from 'sharp';
import { adminSlots, pendingFlags, putReviewPhoto } from './thirtyda-photo-review.mjs';
import { normalizePhoto } from './thirtyda-photos.mjs';
import { demoView, DEMO_UPLOADED } from './thirtyda-demo.mjs';
import { stopReviewAccount, ReviewError } from './thirtyda-review.mjs';

const { handleThirtyDaAdmin, setAdminTestHooks } = await import('./thirtyda-admin.mjs');

// ---------------------------------------------------------------- an in-memory Mongo, just enough for these routes

const get = (doc, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc);
const val = (v) => (v instanceof Date ? v.getTime() : v);
// An array asked for matches that exact array (Mongo: same length, same order), as Stop asks for the photo list it read.
const same = (v, want) => (want === null ? v == null
  : Array.isArray(want) ? Array.isArray(v) && v.length === want.length && v.every((x, i) => same(x, want[i]))
    : Array.isArray(v) ? v.some((x) => val(x) === val(want)) : val(v) === val(want));
const TYPES = { array: Array.isArray, null: (v) => v === null, string: (v) => typeof v === 'string' };
const isOps = (c) => c && typeof c === 'object' && !(c instanceof Date) && !Array.isArray(c) && Object.keys(c).some((x) => x.startsWith('$'));
function holds(v, cond) {
  if (!isOps(cond)) return same(v, cond);
  return Object.entries(cond).every(([op, want]) => {
    if (op === '$gt') return v != null && val(v) > val(want);
    if (op === '$ne') return !same(v, want);
    if (op === '$in') return want.some((w) => same(v, w));
    if (op === '$type') return TYPES[want](v);
    if (op === '$exists') return (v !== undefined) === want;
    if (op === '$not') return !holds(v, want);
    throw new Error(`the fake has no ${op}`);
  });
}
const matches = (doc, q) => Object.entries(q || {}).every(([k, cond]) => (k === '$or' ? cond.some((c) => matches(doc, c)) : holds(get(doc, k), cond)));
function setPath(doc, path, value) {
  const keys = path.split('.');
  let o = doc;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  const last = keys.at(-1);
  // Like Mongo: an index past the end of an array pads the elements between with null.
  if (Array.isArray(o) && /^\d+$/.test(last)) while (o.length < Number(last)) o.push(null);
  o[last] = structuredClone(value);
}
function unsetPath(doc, path) {
  const keys = path.split('.');
  const o = keys.length === 1 ? doc : get(doc, keys.slice(0, -1).join('.'));
  if (o && typeof o === 'object') delete o[keys.at(-1)];
}
function apply(x, u) {
  assert.ok(!Array.isArray(u), 'no pipeline update on this path');
  for (const [k, v] of Object.entries(u.$set || {})) setPath(x, k, v);
  for (const k of Object.keys(u.$unset || {})) unsetPath(x, k);
  for (const [k, v] of Object.entries(u.$push || {})) (x[k] ??= []).push(structuredClone(v));
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
          const rows = all(q);
          return { async toArray() { return rows.map((x) => structuredClone(x)); } };
        },
        async countDocuments(q) { return all(q).length; },
        async insertOne(doc) { const _id = doc._id ?? crypto.randomUUID(); docs.set(_id, structuredClone({ ...doc, _id })); return { insertedId: _id }; },
        async updateOne(q, u) {
          const x = all(q)[0];
          if (!x) return { matchedCount: 0, modifiedCount: 0 };
          apply(x, u);
          return { matchedCount: 1, modifiedCount: 1 };
        },
        async deleteMany(q) { const xs = all(q); xs.forEach((x) => docs.delete(x._id)); return { deletedCount: xs.length }; },
      });
    }
    return cols.get(name);
  };
  return { collection, docs: (name) => [...collection(name).docs.values()] };
}

// ---------------------------------------------------------------- people, photos, the admin

const P = (c) => c.repeat(32); // a photo id: 32 hex characters
const [D0, S0, W1, W2, W3, W4, C1, Q1] = ['a', 'b', 'c', 'd', 'e', 'f', '0', '1'].map(P);
const T0 = '2026-10-15T01:00:00.000Z';
const TOKEN = 'a'.repeat(64);
const HOST = 'ecom.ggmt.sg';
const API = '/30da/admin/api/users';
const UP = { origin: `https://${HOST}`, 'sec-fetch-site': 'same-origin' };
const MB10 = 10 * 1024 * 1024;

/** A photo file as the Media Director sends it: w × h, one colour, JPEG (or PNG / WebP). */
const image = (n, { width = 600, height = 800, format = 'jpeg' } = {}) => sharp({
  create: { width, height, channels: 3, background: { r: (n * 37) % 256, g: 90, b: 160 } },
})[format]().toBuffer();

let d = null;
let store = null; // photo id → bytes
let saved = []; // ids the store made
let removed = []; // ids the store deleted, with the slot as it was then: { id, photos }
let onSave = null; // a test's hook: runs after the file is stored, before the route's swap (the race)
/** The photo store's delete (the admin's hook, and Stop's in the tests that call it): noted with who still had it. */
async function removeStored(id) {
  const owner = d.docs('thirtyda_users').find((u) => (u.photos || []).includes(id));
  removed.push({ id, still: owner ? owner._id : null });
  store.delete(id);
}

beforeEach(async () => {
  d = fakeDb();
  store = new Map();
  saved = [];
  removed = [];
  onSave = null;
  for (const [i, id] of [D0, S0, W1, W2, W3, W4, C1, Q1].entries()) store.set(id, await image(i + 1));
  await d.collection('thirtyda_admin_sessions').insertOne({ _id: TOKEN, created: new Date(), expires: new Date(Date.now() + 3600e3) });
  await d.collection('thirtyda_admin_sessions').insertOne({ _id: 'b'.repeat(64), created: new Date(), expires: new Date(Date.now() - 1000) });
  const base = (id, name, extra) => ({ _id: id, id, name, level: 1, language: 'English', area: 'Phnom Penh', blocked: false, notices: [], ...extra });
  for (const u of [
    // The owner's review accounts (made from profiles): 1 cartoon placeholder each, 3 empty slots.
    base('U-10001', 'Dara', { demo: 'review', photos: [D0] }),
    base('U-10002', 'Sophea', { demo: 'review', photos: [S0] }),
    // "Create demo account" (Sopal): 4 placeholders, users.demoPhotos says so.
    base('U-10005', 'Sopal', { demo: 'review', demoPreset: 'woman', demoPhotos: Array(4).fill('placeholder'), photos: [W1, W2, W3, W4] }),
    // A real person: never.
    base('U-10004', 'Real', { photos: [C1] }),
    // Made a review account while its own photo 1 still waited for approval.
    base('U-10006', 'Waiting', { demo: 'review', photos: [Q1], photoReview: { 0: 'pending' }, photoReviewAt: { 0: T0 } }),
    // An older review profile with no photo list at all.
    base('U-10007', 'Bare', { demo: 'review' }),
  ]) await d.collection('thirtyda_users').insertOne(u);
  setAdminTestHooks({
    db: d,
    photoStore: {
      read: async (id) => store.get(id) ?? null,
      remove: removeStored,
      // The real re-encode (sharp: JPEG ≤ 720 px, EXIF dropped, PhotoError for anything else), kept in memory.
      save: async (buf) => {
        const jpeg = await normalizePhoto(buf);
        const id = crypto.randomBytes(16).toString('hex');
        store.set(id, jpeg);
        saved.push(id);
        await onSave?.(id);
        return id;
      },
    },
  });
});

/**
 * One admin request. `body`: a Buffer (sent in `chunks` pieces, one per tick, so an early answer can be seen) or JSON.
 * res.at = how many pieces had arrived when the answer was written.
 */
async function admin(method, path, { headers = {}, body, cookie = TOKEN, chunks = 1 } = {}) {
  const buf = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const size = buf ? Math.ceil(buf.length / chunks) : 0;
  const pieces = buf ? Array.from({ length: chunks }, (_, i) => buf.subarray(i * size, (i + 1) * size)) : [];
  let arrived = 0;
  const req = {
    method, url: path,
    headers: { host: HOST, ...(cookie ? { cookie: `thirtyda_admin=${cookie}` } : {}), ...headers },
    resume() {},
    on(ev, fn) {
      if (ev === 'data') {
        const next = (i) => setImmediate(() => {
          if (i >= pieces.length) return;
          arrived += 1;
          fn(pieces[i]);
          next(i + 1);
        });
        next(0);
      }
      if (ev === 'end') {
        const wait = () => setImmediate(() => (arrived < pieces.length ? wait() : fn()));
        wait();
      }
    },
  };
  const res = { status: null, headers: null, body: undefined };
  res.writeHead = (s, h = {}) => { res.status = s; res.headers = h; res.at = arrived; return res; };
  res.end = (b) => { res.raw = b; res.body = b === undefined ? undefined : String(b); return res; };
  await handleThirtyDaAdmin(req, res, new URL(path, `https://${HOST}`));
  res.json = () => JSON.parse(res.body);
  return res;
}
const upload = (id, index, body, { type = 'image/jpeg', headers = {}, ...opts } = {}) =>
  admin('POST', `${API}/${id}/photos/${index}/upload`, { headers: { ...UP, 'content-type': type, ...headers }, body, ...opts });
const userDoc = (id) => d.collection('thirtyda_users').docs.get(id);
const audits = (action) => d.docs('thirtyda_audit').filter((a) => a.action === action);
const keysOf = (o) => Object.keys(o).sort();
const view = async (id) => (await admin('GET', `${API}/${id}/photos`)).json();

// ---------------------------------------------------------------- who may send

test('upload: admin only (401), from the admin pages only (Origin, Sec-Fetch-Site → 403), a JPEG / PNG / WebP body only (415) — nothing stored', async () => {
  const jpg = await image(9);
  for (const cookie of [null, 'b'.repeat(64), 'c'.repeat(64)]) assert.equal((await upload('U-10001', 1, jpg, { cookie })).status, 401, `cookie ${cookie}`);
  for (const [headers, why] of [
    [{ origin: 'https://evil.example' }, 'a foreign Origin'],
    [{ origin: `https://x.${HOST}` }, 'a sibling subdomain'],
    [{ origin: 'null' }, 'an opaque Origin'],
    [{ 'sec-fetch-site': 'cross-site' }, 'cross-site'],
    [{ 'sec-fetch-site': 'same-site' }, 'same-site'],
  ]) assert.equal((await upload('U-10001', 1, jpg, { headers })).status, 403, why);
  for (const type of ['application/json', 'text/plain', 'multipart/form-data', 'application/x-www-form-urlencoded', 'image/gif', 'image/heic', '']) {
    const r = await upload('U-10001', 1, jpg, { type });
    assert.equal(r.status, 415, type || 'no type');
    assert.match(r.json().error, /JPEG, PNG or WebP/);
  }
  // The other routes stay JSON-only: an image body does not get in through them.
  assert.equal((await admin('POST', `${API}/U-10001/photos/0/approve`, { headers: { ...UP, 'content-type': 'image/jpeg' }, body: jpg })).status, 415);
  // Slot 5 is no slot (and so no upload route: JSON-only, refused before anything); a GET never writes.
  assert.equal((await upload('U-10001', 4, jpg)).status, 415);
  assert.equal((await admin('GET', `${API}/U-10001/photos/1/upload`)).status, 404);
  assert.deepEqual(saved, []);
  assert.deepEqual(userDoc('U-10001').photos, [D0]);
  assert.equal(audits('review_photo_upload').length, 0);
  // The type may carry parameters; PNG and WebP go in too (and come out as JPEG).
  assert.equal((await upload('U-10001', 1, jpg, { type: 'image/jpeg; foo=bar' })).status, 200);
  assert.equal((await upload('U-10001', 2, await image(2, { format: 'png' }), { type: 'image/png' })).status, 200);
  assert.equal((await upload('U-10001', 3, await image(3, { format: 'webp' }), { type: 'image/webp' })).status, 200);
  for (const id of userDoc('U-10001').photos.slice(1)) assert.equal((await sharp(store.get(id)).metadata()).format, 'jpeg');
});

// ---------------------------------------------------------------- into an empty slot, over a photo, past the end

test('into an EMPTY slot: approved at once, slot-aligned; the answer is the slots view (as GET …/photos) + count; the audit has ids only', async () => {
  const file = await image(7, { width: 1600, height: 2000 });
  const r = await upload('U-10001', 1, file);
  assert.equal(r.status, 200, r.body);
  assert.equal(r.headers['Cache-Control'], 'no-store');
  const v = r.json();
  const [id] = saved;
  assert.deepEqual(userDoc('U-10001').photos, [D0, id], 'photo 2');
  assert.equal(userDoc('U-10001').photoReview, undefined, 'no review entry: approved');
  assert.equal(userDoc('U-10001').demoPhotos, undefined, 'not a preset-made account: nothing to mark');
  // The answer: exactly what GET …/photos says now, + ok + the photos waiting.
  const { ok, count, ...slotsView } = v;
  assert.equal(ok, true);
  assert.equal(count, 1, 'only the Waiting account\'s photo waits');
  assert.deepEqual(slotsView, await view('U-10001'));
  assert.deepEqual(v.slots.map((s) => [s.photoId, s.status]), [[D0, 'approved'], [id, 'approved'], [null, null], [null, null]]);
  assert.equal(v.slots[1].url, `${API}/U-10001/photos/1?id=${id}`);
  // The photo store's copy: re-encoded (JPEG, ≤ 720 px), never the bytes sent; served at once.
  const meta = await sharp(store.get(id)).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ['jpeg', 576, 720]);
  assert.equal(store.get(id).equals(file), false);
  assert.equal((await admin('GET', `${API}/U-10001/photos/1?id=${id}&size=thumb`)).status, 200);
  assert.deepEqual(removed, [], 'nothing was there to delete');
  const [a] = audits('review_photo_upload');
  assert.deepEqual(keysOf(a), ['_id', 'action', 'at', 'ip', 'photo', 'slot', 'user']);
  assert.deepEqual([a.user, a.slot, a.photo], ['U-10001', 2, id]);
  assert.equal(audits('review_photo_upload').length, 1);
});

test('REPLACE on a preset-made account (Sopal): the new photo is in the slot, then the old one is deleted (never before); the audit names both ids', async () => {
  const r = await upload('U-10005', 0, await image(5));
  assert.equal(r.status, 200, r.body);
  const [id] = saved;
  assert.deepEqual(userDoc('U-10005').photos, [id, W2, W3, W4]);
  assert.deepEqual(removed, [{ id: W1, still: null }], 'deleted once no profile had it any more');
  assert.equal(store.has(W1), false);
  assert.deepEqual(r.json().slots[0].photoId, id);
  const [a] = audits('review_photo_upload');
  assert.deepEqual(keysOf(a), ['_id', 'action', 'at', 'ip', 'photo', 'replaced', 'slot', 'user']);
  assert.deepEqual([a.slot, a.photo, a.replaced], [1, id, W1]);
  assert.equal(JSON.stringify(audits('review_photo_upload')).includes('Sopal'), false, 'never a name');
  assert.equal(userDoc('U-10005').reviewUploads, undefined, 'never stopped (Remove deletes it): users.demoPhotos marks it');
});

test('REPLACE on a review account made from a profile (Dara): its own photo is KEPT for Stop (reviewWas.photos), the upload recorded (reviewUploads); replacing the team\'s upload deletes that one, never the kept one', async () => {
  let r = await upload('U-10001', 0, await image(5));
  assert.equal(r.status, 200, r.body);
  const [first] = saved;
  assert.deepEqual(userDoc('U-10001').photos, [first]);
  assert.deepEqual(userDoc('U-10001').reviewUploads, { 0: first });
  assert.deepEqual(userDoc('U-10001').reviewWas.photos, { 0: { id: D0, pendingAt: null } });
  assert.deepEqual(removed, [], 'its own photo stays in the store');
  assert.equal(store.has(D0), true);
  const [a] = audits('review_photo_upload');
  assert.deepEqual(keysOf(a), ['_id', 'action', 'at', 'ip', 'kept', 'photo', 'slot', 'user']);
  assert.deepEqual([a.slot, a.photo, a.kept], [1, first, D0]);
  assert.equal(JSON.stringify(audits('review_photo_upload')).includes('Dara'), false, 'never a name');
  // Replace the team's own upload: that one is deleted; the kept photo stays kept.
  r = await upload('U-10001', 0, await image(6));
  assert.equal(r.status, 200, r.body);
  const second = saved[1];
  assert.deepEqual(userDoc('U-10001').photos, [second]);
  assert.deepEqual(userDoc('U-10001').reviewUploads, { 0: second });
  assert.deepEqual(userDoc('U-10001').reviewWas.photos, { 0: { id: D0, pendingAt: null } });
  assert.deepEqual(removed, [{ id: first, still: null }]);
  assert.equal(audits('review_photo_upload')[1].replaced, first);
  // Into an empty slot: recorded, nothing to keep.
  assert.equal((await upload('U-10001', 2, await image(7))).status, 200);
  assert.deepEqual(userDoc('U-10001').reviewUploads, { 0: second, 2: saved[2] });
  assert.deepEqual(Object.keys(userDoc('U-10001').reviewWas.photos), ['0']);
});

test('PAST THE END: the slots between are null (the app\'s empty slot), photo 4 stays photo 4; the app and the admin read it so', async () => {
  let r = await upload('U-10002', 3, await image(4));
  assert.equal(r.status, 200, r.body);
  const [p4] = saved;
  assert.deepEqual(userDoc('U-10002').photos, [S0, null, null, p4]);
  assert.deepEqual(r.json().slots.map((s) => s.status), ['approved', null, null, 'approved']);
  // The app's helpers: slot-aligned, nothing pending; the admin's slots the same.
  assert.deepEqual(pendingFlags(userDoc('U-10002')), [false, false, false, false]);
  assert.deepEqual(adminSlots(userDoc('U-10002')).map((s) => s.photoId), [S0, null, null, p4]);
  // The overview's summary (the table's thumbnails) too.
  const row = (await admin('GET', '/30da/admin/api/overview')).json().users.find((u) => u.id === 'U-10002');
  assert.deepEqual(row.photos.map((p) => p.photoId), [S0, null, null, p4]);
  // An empty slot between fills in place.
  r = await upload('U-10002', 1, await image(2));
  assert.equal(r.status, 200);
  assert.deepEqual(userDoc('U-10002').photos, [S0, saved[1], null, p4]);
  // A profile with no photo list at all: one is made, then the slot.
  r = await upload('U-10007', 2, await image(3));
  assert.equal(r.status, 200, r.body);
  assert.deepEqual(userDoc('U-10007').photos, [null, null, saved[2]]);
  assert.deepEqual(removed, []);
});

test('"Upload 4 photos" (4 requests, one after the other): Dara\'s cartoon replaced (kept for Stop), 4 approved photos, slot-aligned', async () => {
  for (let i = 0; i < 4; i++) assert.equal((await upload('U-10001', i, await image(20 + i))).status, 200, `photo ${i + 1}`);
  assert.deepEqual(userDoc('U-10001').photos, saved);
  assert.equal(saved.length, 4);
  assert.deepEqual(removed, []);
  assert.deepEqual(userDoc('U-10001').reviewUploads, { 0: saved[0], 1: saved[1], 2: saved[2], 3: saved[3] });
  assert.deepEqual(userDoc('U-10001').reviewWas.photos, { 0: { id: D0, pendingAt: null } });
  const v = await view('U-10001');
  assert.deepEqual(v.slots.map((s) => s.status), ['approved', 'approved', 'approved', 'approved']);
  assert.deepEqual(v.slots.map((s) => s.photoId), saved);
});

// ---------------------------------------------------------------- never a real person; approved at once; demo marks

test('a REAL profile → 409 not_review_account (the fresh slots come with it): nothing read, stored, changed or audited; no such profile → 404', async () => {
  const r = await upload('U-10004', 1, await image(1));
  assert.equal(r.status, 409);
  const v = r.json();
  assert.equal(v.reason, 'not_review_account');
  assert.match(v.error, /App review account/);
  assert.equal(v.user.review, false);
  assert.equal(v.slots.length, 4);
  assert.deepEqual(saved, []);
  assert.deepEqual(userDoc('U-10004').photos, [C1]);
  assert.deepEqual(removed, []);
  assert.equal(audits('review_photo_upload').length, 0);
  // Into its first slot too, and with a body too big to read: refused just the same.
  assert.equal((await upload('U-10004', 0, Buffer.alloc(16), { headers: { 'content-length': String(MB10 + 1) } })).json().reason, 'not_review_account');
  const none = await upload('U-99999', 0, await image(1));
  assert.equal(none.status, 404);
  assert.equal(none.json().reason, 'not_found');
  // A profile whose delete has started: as gone.
  userDoc('U-10002').deleting = { at: new Date() };
  assert.equal((await upload('U-10002', 1, await image(1))).status, 404);
  assert.deepEqual(saved, []);
  // The update itself refuses a real profile (one that stopped being a review account meanwhile is never touched).
  const users = d.collection('thirtyda_users');
  assert.equal(await putReviewPhoto(users, { userId: 'U-10004', index: 1, oldId: null, photoId: P('9') }), false);
  assert.equal(await putReviewPhoto(users, { userId: 'U-10004', index: 0, oldId: C1, photoId: P('9') }), false);
  assert.deepEqual(userDoc('U-10004').photos, [C1]);
});

test('approved at once: over a photo still WAITING, its review entry goes; the waiting count and the Photos queue drop it', async () => {
  assert.equal((await admin('GET', '/30da/admin/api/photos/count')).json().count, 1);
  const r = await upload('U-10006', 0, await image(6));
  assert.equal(r.status, 200, r.body);
  assert.equal(r.json().count, 0, 'the sidebar badge');
  assert.equal(r.json().slots[0].status, 'approved');
  assert.deepEqual(userDoc('U-10006').photoReview, {});
  assert.deepEqual(userDoc('U-10006').photoReviewAt, {});
  assert.deepEqual((await admin('GET', '/30da/admin/api/photos')).json().photos, []);
  // Its own photo is kept for Stop, still marked as waiting (it was never checked).
  assert.deepEqual(removed, []);
  assert.deepEqual(userDoc('U-10006').reviewWas.photos, { 0: { id: Q1, pendingAt: T0 } });
});

test('a preset-made account (Sopal): users.demoPhotos marks the slot "uploaded" — the App review page counts it real and does not ask for Refresh', async () => {
  const r = await upload('U-10005', 2, await image(8));
  assert.equal(r.status, 200, r.body);
  const u = userDoc('U-10005');
  assert.deepEqual(u.photos, [W1, W2, saved[0], W4]);
  assert.deepEqual(u.demoPhotos, ['placeholder', 'placeholder', DEMO_UPLOADED, 'placeholder']);
  assert.deepEqual(removed.map((x) => x.id), [W3]);
  const panel = await demoView(d, { dir: new URL('file:///nonexistent-30da-photo-folder/') });
  const sopal = panel.presets.find((p) => p.preset === 'woman').account;
  assert.deepEqual([sopal.photos, sopal.realPhotos, sopal.refresh], [4, 1, false]);
  for (const i of [0, 1, 3]) assert.equal((await upload('U-10005', i, await image(30 + i))).status, 200);
  assert.deepEqual(userDoc('U-10005').demoPhotos, Array(4).fill(DEMO_UPLOADED));
  assert.equal((await demoView(d, { dir: new URL('file:///nonexistent-30da-photo-folder/') })).presets.find((p) => p.preset === 'woman').account.realPhotos, 4);
});

// ---------------------------------------------------------------- what is not a photo, what is too big

test('not a photo → 400 bad_photo (the store\'s own check): nothing kept, the slot as it was; an empty body too', async () => {
  for (const body of [Buffer.from('this is not a jpeg at all'), Buffer.from('%PDF-1.4\n%\xe2\xe3\n'), crypto.randomBytes(4096)]) {
    const r = await upload('U-10001', 0, body);
    assert.equal(r.status, 400);
    assert.equal(r.json().reason, 'bad_photo');
    assert.equal(r.json().error, 'That file is not a photo we can read.');
  }
  const empty = await upload('U-10001', 0, Buffer.alloc(0));
  assert.equal(empty.status, 400);
  assert.equal(empty.json().reason, 'bad_photo');
  assert.deepEqual(saved, []);
  assert.deepEqual(userDoc('U-10001').photos, [D0]);
  assert.deepEqual(removed, []);
  assert.equal(audits('review_photo_upload').length, 0);
});

test('past 10 MB → 413: a Content-Length over it before anything is read; a body that grows over it answered at once, before its end', async () => {
  let r = await upload('U-10001', 1, Buffer.alloc(16), { headers: { 'content-length': String(MB10 + 1) } });
  assert.equal(r.status, 413);
  assert.equal(r.json().reason, 'too_large');
  assert.equal(r.headers.Connection, 'close');
  assert.equal(r.at, 0, 'nothing read');
  // No Content-Length (sent in pieces): answered with the piece that crosses the limit, not after the rest.
  r = await upload('U-10001', 1, Buffer.alloc(5 * 4 * 1024 * 1024), { chunks: 5 });
  assert.equal(r.status, 413);
  assert.equal(r.at, 3, '4 MB + 4 MB + 4 MB > 10 MB: the 4th and 5th piece never waited for');
  // Exactly 10 MB is read (and then is no photo).
  r = await upload('U-10001', 1, Buffer.alloc(MB10), { chunks: 4 });
  assert.equal(r.status, 400);
  assert.equal(r.json().reason, 'bad_photo');
  assert.deepEqual(saved, []);
  assert.deepEqual(userDoc('U-10001').photos, [D0]);
});

test('EXIF and GPS never reach the store: the photo is re-encoded (orientation applied first)', async () => {
  const file = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#7799bb' } })
    .withExif({ IFD0: { Artist: 'Media Director' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '11/1 33/1 0/1' } })
    .withMetadata({ orientation: 6 })
    .jpeg().toBuffer();
  const before = await sharp(file).metadata();
  assert.ok(before.exif.toString('latin1').includes('Media Director'), 'the file has EXIF');
  assert.equal(before.orientation, 6);
  assert.equal((await upload('U-10001', 1, file)).status, 200);
  const meta = await sharp(store.get(saved[0])).metadata();
  assert.deepEqual([meta.exif, meta.orientation], [undefined, undefined]);
  assert.deepEqual([meta.width, meta.height], [540, 720], 'turned upright by its orientation, then the tag dropped');
});

// ---------------------------------------------------------------- the race

test('409 photo_changed: the slot changed while the photo was stored — the new file is removed, the photo there now stays', async () => {
  const other = P('7');
  store.set(other, await image(70));
  // Another upload into the same slot lands first.
  onSave = async () => { userDoc('U-10001').photos[0] = other; };
  let r = await upload('U-10001', 0, await image(1));
  assert.equal(r.status, 409);
  assert.equal(r.json().reason, 'photo_changed');
  assert.deepEqual(r.json().slots[0].photoId, other, 'the fresh slots come with it');
  const [lost] = saved;
  assert.equal(store.has(lost), false, 'the new file is removed');
  assert.deepEqual(removed.map((x) => x.id), [lost], 'nothing else deleted: not D0 (the other upload\'s to delete), not the one there now');
  assert.deepEqual(userDoc('U-10001').photos, [other]);
  // An empty slot filled meanwhile: the same.
  onSave = async () => { userDoc('U-10001').photos[2] = other; };
  r = await upload('U-10001', 2, await image(2));
  assert.equal(r.status, 409);
  assert.equal(r.json().reason, 'photo_changed');
  assert.equal(store.has(saved[1]), false);
  // Stopped being a review account meanwhile: refused as a real profile, the new file removed.
  onSave = async () => { delete userDoc('U-10002').demo; };
  r = await upload('U-10002', 1, await image(3));
  assert.equal(r.status, 409);
  assert.equal(r.json().reason, 'not_review_account');
  assert.equal(store.has(saved[2]), false);
  assert.deepEqual(userDoc('U-10002').photos, [S0]);
  // A delete started meanwhile: as gone, the new file removed.
  onSave = async () => { userDoc('U-10005').deleting = { at: new Date() }; };
  r = await upload('U-10005', 0, await image(4));
  assert.equal(r.status, 404);
  assert.equal(store.has(saved[3]), false);
  assert.deepEqual(userDoc('U-10005').photos, [W1, W2, W3, W4]);
  assert.equal(audits('review_photo_upload').length, 0);
});

// ---------------------------------------------------------------- Stop being a review account

/** As "Use as review account" left it (src/lib/thirtyda-review.mjs makeReviewAccount): its own number / PIN / place. */
const madeFromProfile = (id) => Object.assign(userDoc(id), {
  reviewAt: new Date('2026-10-14T01:00:00Z'),
  reviewWas: { phone: null, verifiedPhone: false, phoneVia: null, pinHash: null, pinAt: null, location: null, area: 'Phnom Penh', city: 'Phnom Penh' },
});

test('"Stop being a review account" after uploads (Dara): the uploads leave the slots and the store, its own photo comes back — no made-up face reaches real people', async () => {
  madeFromProfile('U-10001');
  for (let i = 0; i < 4; i++) assert.equal((await upload('U-10001', i, await image(40 + i))).status, 200);
  const ups = [...saved];
  const r = await stopReviewAccount(d, 'U-10001', { remove: removeStored });
  const u = userDoc('U-10001');
  assert.deepEqual(u.photos, [D0], 'its own photo 1 back; the slots it never had are gone again');
  assert.deepEqual([u.demo, u.reviewUploads, u.reviewWas], [undefined, undefined, undefined]);
  assert.deepEqual(adminSlots(u).map((x) => [x.photoId, x.status]), [[D0, 'approved'], [null, null], [null, null], [null, null]]);
  assert.deepEqual(removed.map((x) => x.id).sort(), [...ups].sort(), 'every upload deleted, nothing else');
  assert.ok(removed.every((x) => x.still === null), 'deleted once no profile had it');
  assert.equal(store.has(D0), true);
  assert.equal(r.photosDeleted, 4);
  // A real profile again: the team cannot upload to it any more.
  assert.equal((await upload('U-10001', 1, await image(1))).json().reason, 'not_review_account');
});

test('Stop: its own photo that was still WAITING comes back waiting (the Photos queue has it again); an empty slot it had stays empty', async () => {
  madeFromProfile('U-10006');
  assert.equal((await upload('U-10006', 0, await image(1))).status, 200);
  assert.equal((await upload('U-10006', 2, await image(2))).status, 200);
  assert.equal((await admin('GET', '/30da/admin/api/photos/count')).json().count, 0);
  await stopReviewAccount(d, 'U-10006', { remove: removeStored });
  const u = userDoc('U-10006');
  assert.deepEqual(u.photos, [Q1]);
  assert.deepEqual([u.photoReview, u.photoReviewAt], [{ 0: 'pending' }, { 0: T0 }]);
  assert.deepEqual(pendingFlags(u), [true]);
  assert.equal((await admin('GET', '/30da/admin/api/photos/count')).json().count, 1);
  assert.deepEqual(removed.map((x) => x.id).sort(), [...saved].sort());
});

test('Stop while an upload lands → 409 photos_changed, nothing changed or deleted; Stop again takes that upload out too', async () => {
  madeFromProfile('U-10002');
  assert.equal((await upload('U-10002', 0, await image(1))).status, 200);
  const users = d.collection('thirtyda_users');
  const real = users.updateOne;
  const late = P('5');
  store.set(late, await image(55));
  // Between Stop's read and its write, another upload puts photo 2 in (what the upload route writes).
  users.updateOne = async (q, upd) => {
    users.updateOne = real;
    Object.assign(userDoc('U-10002'), { photos: [...userDoc('U-10002').photos, late] });
    userDoc('U-10002').reviewUploads[1] = late;
    return real.call(users, q, upd);
  };
  await assert.rejects(stopReviewAccount(d, 'U-10002', { remove: removeStored }), (e) => e instanceof ReviewError && e.status === 409 && e.code === 'photos_changed');
  assert.equal(userDoc('U-10002').demo, 'review', 'still a review account');
  assert.deepEqual(userDoc('U-10002').photos, [saved[0], late]);
  assert.deepEqual(removed, []);
  await stopReviewAccount(d, 'U-10002', { remove: removeStored });
  assert.deepEqual(userDoc('U-10002').photos, [S0]);
  assert.deepEqual(removed.map((x) => x.id).sort(), [saved[0], late].sort());
  // The route hands Stop the same photo store.
  const src = readFileSync(new URL('./thirtyda-admin.mjs', import.meta.url), 'utf8');
  assert.match(src, /await stopReviewAccount\(d, m\[2\], \{ remove: \(x\) => photoStore\(\)\.remove\(x\) \}\);/);
});

test('a deleted review account takes the photos of its own kept for Stop with it (thirtyda-delete.mjs handlesOf)', async () => {
  const { handlesOf } = await import('./thirtyda-delete.mjs');
  assert.equal((await upload('U-10001', 0, await image(1))).status, 200);
  assert.deepEqual(handlesOf(userDoc('U-10001')).photos.sort(), [saved[0], D0].sort());
});

// ---------------------------------------------------------------- the database refuses

test('the database refuses the swap (a failover, a write error): the stored file is removed, the slot as it was, the error goes up', async () => {
  const users = d.collection('thirtyda_users');
  const real = users.updateOne;
  users.updateOne = async (q, upd) => {
    if (upd.$set?.['photos.1']) throw Object.assign(new Error('not primary'), { code: 10107 });
    return real.call(users, q, upd);
  };
  try {
    await assert.rejects(upload('U-10001', 1, await image(1)), /not primary/);
  } finally {
    users.updateOne = real;
  }
  const [lost] = saved;
  assert.equal(store.has(lost), false, 'no file left behind');
  assert.deepEqual(removed.map((x) => x.id), [lost]);
  assert.deepEqual(userDoc('U-10001').photos, [D0]);
  assert.equal(audits('review_photo_upload').length, 0);
});

// ---------------------------------------------------------------- the limit

test('upload counts toward the same photo limit as approve / disqualify (120 per admin session per 15 minutes), then 429', async () => {
  const other = 'e'.repeat(64);
  await d.collection('thirtyda_admin_sessions').insertOne({ _id: other, created: new Date(), expires: new Date(Date.now() + 3600e3) });
  for (let i = 0; i < 120; i++) {
    const r = await admin('POST', `${API}/U-10004/photos/0/approve`, { headers: { ...UP, 'content-type': 'application/json' }, body: { photoId: C1 }, cookie: other });
    assert.equal(r.status, 409, `try ${i + 1}`);
  }
  const r = await upload('U-10001', 1, await image(1), { cookie: other });
  assert.equal(r.status, 429);
  assert.deepEqual(saved, []);
  assert.equal((await upload('U-10001', 1, await image(1))).status, 200, 'another session is not stopped');
});

// ---------------------------------------------------------------- the page, run: monitor.js's Users → Photos part

/**
 * monitor.js from "Users → Photos" to the toast (plus its `el`), run on its own in a stand-in page (as in
 * thirtyda-admin-photos.test.mjs), with what Upload needs too: file inputs (files, click), drag and drop. `api` and
 * `apiUpload` answer when the test says so (box.calls), so the test sees each request while it is on its way.
 */
function photosBox() {
  const js = readFileSync(new URL('../thirtyda-admin/monitor.js', import.meta.url), 'utf8');
  const elFn = js.slice(js.indexOf('function el('), js.indexOf('const view = {'));
  const from = js.indexOf('// ---------- Users → Photos');
  const to = js.indexOf('// ---------- toast with undo');
  assert.ok(elFn.length > 100 && from > 0 && to > from);
  const doc = { activeElement: null, querySelector: () => null };
  const matchesSel = (n, sel) => {
    const a = sel.match(/^\[([\w-]+)="([^"]*)"\]$/);
    const has = sel.match(/^\[([\w-]+)\]$/);
    return a ? n.attrs[a[1]] === a[2] : has ? has[1] in n.attrs : n.tagName === sel.toUpperCase();
  };
  class FakeNode {
    constructor(tag) {
      Object.assign(this, { tagName: tag.toUpperCase(), attrs: {}, kids: [], parent: null, listeners: [], className: '', text: '' });
      Object.assign(this, { hidden: false, disabled: false, checked: false, multiple: false, open: false, clicks: 0, files: [], value: '' });
    }
    setAttribute(k, v) {
      this.attrs[k] = v;
      if (['hidden', 'disabled', 'checked', 'multiple'].includes(k)) this[k] = true;
      if (k === 'id') this.id = v;
    }
    getAttribute(k) { return this.attrs[k] ?? null; }
    addEventListener(type, fn, opts) { this.listeners.push({ type, fn, once: Boolean(opts?.once) }); }
    dispatch(type, extra = {}) {
      const ev = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
      for (const l of this.listeners.filter((x) => x.type === type)) {
        if (l.once) this.listeners.splice(this.listeners.indexOf(l), 1);
        l.fn(ev);
      }
      return ev;
    }
    click() { this.clicks += 1; }
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
    querySelectorAll(sel) { return [...this.walk()].filter((n) => matchesSel(n, sel)); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
    contains(n) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
    closest(sel) { for (let x = this; x; x = x.parent) if (matchesSel(x, sel)) return x; return null; }
    focus() { doc.activeElement = this; }
    getClientRects() { return this.hidden ? [] : [{}]; }
    showModal() { this.open = true; }
    close() { if (this.open) { this.open = false; this.dispatch('close'); } }
  }
  doc.createElement = (tag) => new FakeNode(tag);
  doc.body = new FakeNode('body');
  const box = { calls: [], refreshed: 0, badge: new FakeNode('span'), view: { data: { users: [] } } };
  const call = (path, body, type) => new Promise((resolve, reject) => { box.calls.push({ path, body, type, resolve, reject }); });
  const ctx = vm.createContext({
    document: doc, Node: FakeNode, CSS: { escape: String }, view: box.view, ago: () => 'just now',
    $: (id) => (id === 'photos-badge' ? box.badge : null),
    refresh: () => { box.refreshed += 1; },
    api: (path, body) => call(path, body),
    apiUpload: (path, file, type) => call(path, file, type),
  });
  box.ui = vm.runInContext(`${elFn}\n${js.slice(from, to)}\n;({ openPhotos, pd })`, ctx);
  box.doc = doc;
  box.pd = (name) => box.ui.pd.dlg.querySelector(`[data-pd="${name}"]`);
  box.tick = () => new Promise(setImmediate);
  box.open = async (id, name, ids, { review = true } = {}) => {
    box.ui.openPhotos(id, { user: id, slot: null });
    box.calls.shift().resolve(slotsView(id, name, ids, review));
    await box.tick();
  };
  /** The upload on its way answers with these slots (and the badge count). */
  box.answer = async (id, name, ids, count = 0) => {
    box.calls.shift().resolve({ ok: true, ...slotsView(id, name, ids), count });
    await box.tick();
  };
  return box;
}
const slotsView = (id, name, ids, review = true) => ({
  user: { id, name, review, blocked: false },
  slots: [0, 1, 2, 3].map((index) => {
    const photoId = ids[index] ?? null;
    const url = photoId ? `${API}/${id}/photos/${index}?id=${photoId}` : null;
    return { index, photoId, status: photoId ? 'approved' : null, at: null, url, thumb: url && `${url}&size=thumb` };
  }),
});
const file = (name, { type = 'image/jpeg', size = 2e6 } = {}) => ({ name, type, size });
const [N1, N2, N3, N4] = ['1', '2', '3', '4'].map((c) => c.repeat(32));

test('the page: an App review account gets "Upload 4 photos", the approved-at-once line, Upload / Replace under each slot — no Approve, no Disqualify', async () => {
  const box = photosBox();
  box.view.data.users = [{ id: 'U-10001', name: 'Dara' }];
  await box.open('U-10001', 'Dara', [D0]);
  const { pd } = box.ui;
  assert.equal(pd.parts.upload.hidden, false);
  assert.match(pd.parts.upload.textContent, /^Upload 4 photosApp review account — photos you upload are approved at once\./);
  const many = box.pd('files');
  assert.deepEqual([many.attrs.type, many.attrs.accept, many.multiple, many.hidden], ['file', 'image/jpeg,image/png,image/webp', true, true]);
  assert.equal(box.pd('file').multiple, false, 'a slot\'s picker takes one file');
  assert.deepEqual([0, 1, 2, 3].map((i) => box.pd(`upload-${i}`).textContent), ['Replace', 'Upload', 'Upload', 'Upload']);
  assert.equal(box.pd('upload-0').attrs['aria-label'], 'Replace Photo 1 · main of Dara');
  assert.equal(box.pd('approve-0') ?? box.pd('disqualify-0'), null);
  assert.equal(box.ui.pd.dlg.textContent.includes('change its photos on the'), false, 'the view-only note is gone');
  // A real profile: no upload at all.
  pd.dlg.close();
  await box.open('U-10004', 'Real', [C1], { review: false });
  assert.equal(pd.parts.upload.hidden, true);
  assert.equal(box.pd('upload-0'), null);
  assert.ok(box.pd('disqualify-0'));
});

test('"Upload 4 photos": the files by name (demo-w-1 … demo-w-4, 2 before 10) into Photo 1–4, one request at a time, a progress line; the badge and the table after', async () => {
  const box = photosBox();
  box.view.data.users = [{ id: 'U-10001', name: 'Dara' }];
  await box.open('U-10001', 'Dara', [D0]);
  const { pd } = box.ui;
  box.pd('upload-all').dispatch('click');
  assert.equal(box.pd('files').clicks, 1, 'the picker opens');
  const many = box.pd('files');
  many.files = [file('demo-w-10.jpg'), file('demo-w-2.png', { type: 'image/png' }), file('demo-w-1.jpg'), file('demo-w-3.webp', { type: 'image/webp' })];
  many.dispatch('change');
  const order = [];
  for (const [i, ids] of [[N1], [N1, N2], [N1, N2, N3], [N1, N2, N3, N4]].entries()) {
    assert.equal(box.calls.length, 1, `one at a time (${i + 1})`);
    const c = box.calls[0];
    order.push([c.path, c.body.name, c.type]);
    assert.equal(pd.parts.progress.textContent, `Uploading ${i + 1} of 4…`);
    assert.equal(pd.busy, true);
    assert.equal(box.pd('upload-all').disabled, true);
    assert.equal(box.pd(`upload-${i}`).disabled, true);
    await box.answer('U-10001', 'Dara', ids, 1);
    if (i < 3) assert.equal(pd.view.slots[i].photoId, ids[i], 'drawn after each');
  }
  assert.deepEqual(order, [
    [`${API}/U-10001/photos/0/upload`, 'demo-w-1.jpg', 'image/jpeg'],
    [`${API}/U-10001/photos/1/upload`, 'demo-w-2.png', 'image/png'],
    [`${API}/U-10001/photos/2/upload`, 'demo-w-3.webp', 'image/webp'],
    [`${API}/U-10001/photos/3/upload`, 'demo-w-10.jpg', 'image/jpeg'],
  ]);
  assert.equal(pd.busy, false);
  assert.equal(pd.parts.progress.textContent, '');
  assert.equal(pd.parts.done.textContent, 'Uploaded photos 1–4. Approved: the app shows them now.');
  assert.deepEqual(pd.view.slots.map((s) => s.photoId), [N1, N2, N3, N4]);
  assert.deepEqual([box.pd(`upload-0`).textContent, box.pd('upload-3').textContent], ['Replace', 'Replace']);
  assert.deepEqual([box.badge.textContent, box.refreshed], ['1', 1], 'the badge, then the table (once)');
  assert.equal(many.value, '', 'the same files can be picked again');
});

test('fewer than 4 fill from Photo 1; more than 4: the first 4 by name, the rest said; the first refusal stops the rest with its message', async () => {
  const box = photosBox();
  box.view.data.users = [{ id: 'U-10002', name: 'Sophea' }];
  await box.open('U-10002', 'Sophea', [S0]);
  const { pd } = box.ui;
  box.pd('files').files = [file('b.jpg'), file('a.jpg')];
  box.pd('files').dispatch('change');
  assert.equal(box.calls[0].path, `${API}/U-10002/photos/0/upload`);
  assert.equal(box.calls[0].body.name, 'a.jpg');
  await box.answer('U-10002', 'Sophea', [N1]);
  assert.equal(box.calls[0].path, `${API}/U-10002/photos/1/upload`);
  await box.answer('U-10002', 'Sophea', [N1, N2]);
  assert.equal(box.calls.length, 0);
  assert.equal(pd.parts.done.textContent, 'Uploaded photos 1–2. Approved: the app shows them now.');

  // 5 files: 4 sent; the second refused (not a photo) → the 3rd and 4th never go, the message names the file.
  box.pd('files').files = ['e', 'd', 'c', 'b', 'a'].map((x) => file(`${x}.jpg`));
  box.pd('files').dispatch('change');
  await box.answer('U-10002', 'Sophea', [N3, N2]);
  const second = box.calls.shift();
  assert.equal(second.body.name, 'b.jpg');
  assert.equal(pd.parts.progress.textContent, 'Uploading 2 of 4…');
  second.reject(Object.assign(new Error('That file is not a photo we can read.'), { status: 400, data: { reason: 'bad_photo' } }));
  await box.tick();
  assert.equal(box.calls.length, 0, 'stopped');
  assert.equal(pd.parts.error.hidden, false);
  assert.equal(pd.parts.error.textContent, 'b.jpg: That file is not a photo we can read.');
  assert.equal(pd.parts.done.textContent, 'Uploaded photo 1 (1 of 4). Approved: the app shows it now. 1 more file was left out: 4 photos at most.'
    + ' Upload the rest with each photo\'s own Upload / Replace.');
  assert.equal(pd.busy, false);
  assert.equal(box.refreshed, 2);

  // A refusal with the fresh slots (409 photo_changed): drawn, the badge too.
  box.pd('files').files = [file('x.jpg')];
  box.pd('files').dispatch('change');
  box.calls.shift().reject(Object.assign(new Error('This photo was changed meanwhile.'), { status: 409, data: { ...slotsView('U-10002', 'Sophea', [N4]), count: 3 } }));
  await box.tick();
  assert.equal(pd.view.slots[0].photoId, N4);
  assert.equal(box.badge.textContent, '3');
  assert.equal(pd.parts.error.textContent, 'x.jpg: This photo was changed meanwhile.');
});

test('the page checks before sending: not a JPEG / PNG / WebP (a .heic), or over 10 MB → its message, no request; a file with no type goes by its name', async () => {
  const box = photosBox();
  box.view.data.users = [{ id: 'U-10001', name: 'Dara' }];
  await box.open('U-10001', 'Dara', [D0]);
  const { pd } = box.ui;
  box.pd('files').files = [file('IMG_1.HEIC', { type: 'image/heic' })];
  box.pd('files').dispatch('change');
  await box.tick();
  assert.equal(box.calls.length, 0);
  assert.equal(pd.parts.error.textContent, 'IMG_1.HEIC: Not a JPEG, PNG or WebP photo.');
  box.pd('files').files = [file('big.jpg', { size: 10 * 1024 * 1024 + 1 })];
  box.pd('files').dispatch('change');
  await box.tick();
  assert.equal(box.calls.length, 0);
  assert.equal(pd.parts.error.textContent, 'big.jpg: That photo is too big: 10 MB at most.');
  box.pd('files').files = [file('demo-m-1.JPG', { type: '' })];
  box.pd('files').dispatch('change');
  assert.equal(box.calls[0].type, 'image/jpeg');
  await box.answer('U-10001', 'Dara', [N1]);
  assert.equal(pd.parts.error.hidden, true, 'the old message goes with the next try');
});

test('a slot\'s Upload / Replace: one file into THAT slot; the focus comes back to it', async () => {
  const box = photosBox();
  box.view.data.users = [{ id: 'U-10001', name: 'Dara' }];
  await box.open('U-10001', 'Dara', [D0]);
  const { pd } = box.ui;
  box.pd('upload-2').dispatch('click');
  assert.equal(box.pd('file').clicks, 1);
  assert.equal(pd.pick, 2);
  box.pd('file').files = [file('demo-dara-3.jpg')];
  box.pd('file').dispatch('change');
  assert.equal(box.calls[0].path, `${API}/U-10001/photos/2/upload`);
  assert.equal(pd.parts.progress.textContent, 'Uploading photo 3…');
  await box.answer('U-10001', 'Dara', [D0, null, N3]);
  assert.equal(pd.parts.done.textContent, 'Uploaded photo 3. Approved: the app shows it now.');
  assert.equal(box.pd('upload-2').textContent, 'Replace');
  assert.equal(box.doc.activeElement, box.pd('upload-2'), 'the focus is back on that slot\'s button');
  // Replace photo 1.
  box.pd('upload-0').dispatch('click');
  box.pd('file').files = [file('demo-dara-1.jpg')];
  box.pd('file').dispatch('change');
  assert.equal(box.calls[0].path, `${API}/U-10001/photos/0/upload`);
  await box.answer('U-10001', 'Dara', [N1, null, N3]);
  assert.equal(pd.parts.done.textContent, 'Uploaded photo 1. Approved: the app shows it now.');
  // Nothing is sent while another upload is on its way.
  box.pd('upload-1').dispatch('click');
  box.pd('file').files = [file('a.jpg')];
  box.pd('file').dispatch('change');
  box.pd('files').files = [file('b.jpg')];
  box.pd('files').dispatch('change');
  assert.equal(box.calls.length, 1);
});

test('files dropped on the dialog: the same as "Upload 4 photos" — for an App review account only; never the browser opening the file', async () => {
  const box = photosBox();
  box.view.data.users = [{ id: 'U-10005', name: 'Sopal' }];
  await box.open('U-10005', 'Sopal', [W1, W2, W3, W4]);
  const { pd } = box.ui;
  const drag = (type, files = []) => pd.dlg.dispatch(type, { dataTransfer: { types: ['Files'], files, dropEffect: 'none' }, relatedTarget: null });
  const over = drag('dragover');
  assert.equal(over.defaultPrevented, true);
  assert.equal(over.dataTransfer.dropEffect, 'copy');
  assert.equal(pd.dlg.className, 'ad-dialog pd-dialog is-drop');
  drag('dragleave');
  assert.equal(pd.dlg.className, 'ad-dialog pd-dialog');
  const drop = drag('drop', ['demo-w-4.jpg', 'demo-w-3.jpg', 'demo-w-2.jpg', 'demo-w-1.jpg'].map((n) => file(n)));
  assert.equal(drop.defaultPrevented, true);
  assert.equal(box.calls[0].path, `${API}/U-10005/photos/0/upload`);
  assert.equal(box.calls[0].body.name, 'demo-w-1.jpg');
  // While it goes: no drop accepted.
  assert.equal(drag('dragover').dataTransfer.dropEffect, 'none');
  // Text dragged over (not files) is left alone.
  assert.equal(pd.dlg.dispatch('dragover', { dataTransfer: { types: ['text/plain'] } }).defaultPrevented, false);
  // A real profile: the drop is swallowed (the page stays), nothing sent.
  box.calls.length = 0;
  pd.busy = false;
  pd.dlg.close();
  await box.open('U-10004', 'Real', [C1], { review: false });
  assert.equal(drag('dragover').dataTransfer.dropEffect, 'none');
  assert.equal(drag('drop', [file('x.jpg')]).defaultPrevented, true);
  await box.tick();
  assert.equal(box.calls.length, 0);
});

test('files go where their names say (-1 … -4): sending only demo-w-3 and demo-w-4 again fills Photo 3 and 4, never Photo 1; one file dropped on a photo goes into THAT photo', async () => {
  const box = photosBox();
  box.view.data.users = [{ id: 'U-10005', name: 'Sopal' }];
  await box.open('U-10005', 'Sopal', [N1, N2, W3, W4]);
  const { pd } = box.ui;
  // The rest of a run that stopped at demo-w-3, picked again.
  box.pd('files').files = [file('demo-w-4.jpg'), file('demo-w-3.jpg')];
  box.pd('files').dispatch('change');
  assert.deepEqual([box.calls[0].path, box.calls[0].body.name], [`${API}/U-10005/photos/2/upload`, 'demo-w-3.jpg']);
  await box.answer('U-10005', 'Sopal', [N1, N2, N3, W4]);
  assert.deepEqual([box.calls[0].path, box.calls[0].body.name], [`${API}/U-10005/photos/3/upload`, 'demo-w-4.jpg']);
  await box.answer('U-10005', 'Sopal', [N1, N2, N3, N4]);
  assert.equal(pd.parts.done.textContent, 'Uploaded photos 3–4. Approved: the app shows them now.');
  // Photo 2 and photo 4: said so.
  box.pd('files').files = [file('demo-w-4.jpg'), file('demo-w-2.jpg')];
  box.pd('files').dispatch('change');
  assert.equal(box.calls[0].path, `${API}/U-10005/photos/1/upload`);
  await box.answer('U-10005', 'Sopal', [N1, N2, N3, N4]);
  assert.equal(box.calls[0].path, `${API}/U-10005/photos/3/upload`);
  await box.answer('U-10005', 'Sopal', [N1, N2, N3, N4]);
  assert.equal(pd.parts.done.textContent, 'Uploaded photos 2 and 4. Approved: the app shows them now.');
  // A number twice, or a name without one: by name from Photo 1, as before.
  for (const names of [['demo-w-2.jpg', 'demo-x-2.jpg'], ['demo-w-3.jpg', 'face.jpg']]) {
    box.pd('files').files = names.map((n) => file(n));
    box.pd('files').dispatch('change');
    assert.deepEqual([box.calls[0].path, box.calls[0].body.name], [`${API}/U-10005/photos/0/upload`, names[0]], names.join(' + '));
    await box.answer('U-10005', 'Sopal', [N1, N2, N3, N4]);
    assert.equal(box.calls[0].path, `${API}/U-10005/photos/1/upload`);
    await box.answer('U-10005', 'Sopal', [N1, N2, N3, N4]);
  }
  // Dropped: one file on Photo 3's card → photo 3, whatever its name.
  const drop = (target, files) => pd.dlg.dispatch('drop', { target, dataTransfer: { types: ['Files'], files }, relatedTarget: null });
  const card = pd.parts.grid.kids[2];
  assert.equal(card.getAttribute('data-pd-slot'), '2');
  assert.equal(drop(card.kids[0], [file('portrait.jpg')]).defaultPrevented, true);
  assert.equal(box.calls[0].path, `${API}/U-10005/photos/2/upload`);
  await box.answer('U-10005', 'Sopal', [N1, N2, N3, N4]);
  assert.equal(pd.parts.done.textContent, 'Uploaded photo 3. Approved: the app shows it now.');
  // One file named …-2 dropped anywhere else → photo 2, never over the main photo.
  drop(pd.dlg, [file('demo-sophea-2.jpg')]);
  assert.equal(box.calls[0].path, `${API}/U-10005/photos/1/upload`);
  await box.answer('U-10005', 'Sopal', [N1, N2, N3, N4]);
  // Several dropped on a card: as "Upload 4 photos" (their names say where).
  drop(pd.parts.grid.kids[2].kids[0], [file('demo-w-4.jpg'), file('demo-w-1.jpg')]);
  assert.deepEqual([box.calls[0].path, box.calls[0].body.name], [`${API}/U-10005/photos/0/upload`, 'demo-w-1.jpg']);
});

test('closed while uploading (Esc twice) and opened again: the rest is not sent, and the late answer changes nothing in the new opening', async () => {
  const box = photosBox();
  box.view.data.users = [{ id: 'U-10001', name: 'Dara' }, { id: 'U-10002', name: 'Sophea' }];
  await box.open('U-10001', 'Dara', [D0]);
  const { pd } = box.ui;
  box.pd('files').files = ['1', '2', '3'].map((n) => file(`${n}.jpg`));
  box.pd('files').dispatch('change');
  const late = box.calls.shift();
  pd.dlg.close();
  await box.open('U-10002', 'Sophea', [S0]);
  late.resolve({ ok: true, ...slotsView('U-10001', 'Dara', [N1]), count: 2 });
  await box.tick();
  assert.equal(box.calls.length, 0, 'photos 2 and 3 not sent');
  assert.equal(pd.view.user.id, 'U-10002');
  assert.equal(pd.parts.done.textContent, '');
  assert.equal(pd.parts.progress.textContent, '');
  assert.equal(pd.busy, false);
  assert.deepEqual([box.badge.textContent, box.refreshed], ['2', 1], 'the badge and the table did take it');
});

test('the code: the raw upload goes with the file\'s own type; the App review page links each review account to its Photos', () => {
  const js = readFileSync(new URL('../thirtyda-admin/monitor.js', import.meta.url), 'utf8');
  assert.match(js, /async function apiUpload\(path, file, type\) \{\n\s+const res = await fetch\(path, \{ method: 'POST', headers: \{ 'Content-Type': type \}, body: file \}\);/);
  assert.match(js, /new Intl\.Collator\('en', \{ numeric: true, sensitivity: 'base' \}\)/);
  assert.match(js, /const photosFor = \/\^#photos=\(U-\\d\+\)\$\/\.exec\(location\.hash\)/, '#photos=<id> opens that profile\'s Photos');
  const ui = js.slice(js.indexOf('// ---------- Users → Photos'), js.indexOf('// ---------- toast with undo'));
  assert.equal(/innerHTML/.test(ui), false, 'built as elements: file names as text, never HTML');
  const css = readFileSync(new URL('../thirtyda-admin/app.css', import.meta.url), 'utf8');
  for (const rule of ['.pd-upload {', '.ad-dialog.pd-dialog.is-drop {']) assert.ok(css.includes(rule), rule);
  // The progress line is a live region: kept in the page while empty (only out of sight), so its first message is read out.
  assert.ok(css.includes('.pd-progress:empty { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }'));
  assert.equal(/\.pd-progress[^{]*\{[^}]*display:\s*none/.test(css), false);
  const review = readFileSync(new URL('../thirtyda-admin/review.js', import.meta.url), 'utf8');
  assert.match(review, /const photosLink = \(id\) => `\/30da\/admin\/monitor#photos=\$\{encodeURIComponent\(id\)\}`;/);
  assert.equal((review.match(/el\('a', \{ class: 'link', href: photosLink\(a\.id\) \}, 'Upload photos'\)/g) || []).length, 2, 'made here and made from a profile');
  assert.ok(review.includes("'After Create, upload its 4 photos on '"));
  assert.ok(!/innerHTML/.test(review));
});
