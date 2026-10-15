// Run: npm run 30da:test (or node --test src/lib/thirtyda-demo.test.mjs)
// "Create demo account" (owner 2026-10-14: "I need loaded 2 users with 4 photos each etc, login code 5566 7788 —
// 1 woman 1 man"; 2026-10-15: "code is 4455 and 6677", src/lib/thirtyda-demo.mjs): a NEW fully filled review account per preset, made with placeholders
// until the Media Director's files are in the folder, idempotent, photos approved and slot-aligned, its PIN works on the
// PIN-only way, it lives in the review world, and the notes list every demo account. In-memory Mongo stand-in and an
// in-memory photo store: no database, no network, no files written in the repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

process.env.THIRTYDA_SECRET_KEY ||= crypto.randomBytes(32).toString('hex');

const {
  DEMO_PRESETS, DEMO_PRESET_KEYS, DEMO_PHOTO_DIR, demoPhotoFile, demoPhotoFiles, placeholderPhoto, placeholderSvg, checkDemoFields,
  createDemoAccount, refreshDemoPhotos, demoView, demoAccountOf, isDemoPreset,
} = await import('./thirtyda-demo.mjs');
const {
  REVIEW, REVIEW_MAX, REVIEW_DEFAULTS, REVIEW_SPOTS, REVIEW_PLACE, isReview, sameWorld, worldFilter, makeReviewAccount, stopReviewAccount,
  setReviewSwitch, reviewPinCheck, reviewPinProbe, reviewAccountForPin, reviewView, reviewPinOf, tryCounter, ReviewError,
} = await import('./thirtyda-review.mjs');
const { verifyPin } = await import('./thirtyda-pin.mjs');
const { clearSettingsCache } = await import('./thirtyda-settings.mjs');
const { PHOTO_MAX } = await import('../thirtyda-app/shared/rules.js');
const { normalizePhoto } = await import('./thirtyda-photos.mjs');

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
        async insertOne(doc) {
          if (docs.has(doc._id) || uniquePhone(doc, doc._id)) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
          docs.set(doc._id, structuredClone(doc));
          return { insertedId: doc._id };
        },
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
        async findOneAndUpdate(q, u, opts = {}) {
          let x = all(q)[0];
          if (!x && opts.upsert) { x = { _id: q._id }; docs.set(x._id, x); }
          if (!x) return null;
          apply(x, u);
          return structuredClone(x);
        },
        async deleteMany(q) { const xs = all(q); xs.forEach((x) => docs.delete(x._id)); return { deletedCount: xs.length }; },
      });
    }
    return cols.get(name);
  };
  return { collection, docs: (name) => [...collection(name).docs.values()] };
}

/** An in-memory photo store with the same shape as thirtyda-photos.mjs (ids of 32 hex). */
function photoStore() {
  const files = new Map();
  return {
    files,
    async save(buf) { const id = crypto.randomBytes(16).toString('hex'); files.set(id, Buffer.from(buf)); return id; },
    async remove(id) { files.delete(id); },
  };
}

/** Dara and Sophea (review accounts 1122 / 3344, the owner's), Kk (a real profile with a pair to nobody demo). */
async function world({ review = true } = {}) {
  clearSettingsCache();
  const d = fakeDb();
  const users = d.collection('thirtyda_users');
  await users.insertOne({ _id: 'U-10001', name: 'Dara', gender: 'man', birthYear: 1985, level: 3, photos: ['a'.repeat(32)], verified: { phone: true }, phone: '+85512345678', createdAt: new Date('2026-10-01') });
  await users.insertOne({ _id: 'U-10002', name: 'Sophea', gender: 'woman', birthYear: 1988, level: 3, photos: ['b'.repeat(32)], verified: { phone: true }, phone: '+85598765432', createdAt: new Date('2026-10-02') });
  await users.insertOne({ _id: 'U-10003', name: 'kk', gender: 'man', level: 1, photos: ['c'.repeat(32)], verified: {}, createdAt: new Date('2026-10-10') });
  await d.collection('thirtyda_counters').updateOne({ _id: 'user' }, { $set: { seq: 10003 } }, { upsert: true });
  if (review) {
    await makeReviewAccount(d, 'U-10001', REVIEW_DEFAULTS[0], { now: Date.parse('2026-10-14T01:00:00Z') });
    await makeReviewAccount(d, 'U-10002', REVIEW_DEFAULTS[1], { now: Date.parse('2026-10-14T01:01:00Z') });
    await d.collection('thirtyda_pairs').insertOne({ _id: 'P-1', members: ['U-10001', 'U-10002'], a: 'U-10001', b: 'U-10002', stage: 'l3_open', level: 3 });
  }
  return d;
}

/** An empty folder (no Media Director files yet), or one with `slots` of a preset's files (distinct solid colours). */
async function folder(files = {}) {
  const dir = await mkdtemp(join(tmpdir(), '30da-demo-'));
  for (const [preset, slots] of Object.entries(files)) {
    for (const slot of slots) {
      const jpg = await sharp({ create: { width: 600, height: 800, channels: 3, background: { r: 40 * slot, g: preset === 'woman' ? 120 : 60, b: 90 } } }).jpeg().toBuffer();
      await writeFile(join(dir, demoPhotoFile(preset, slot)), jpg);
    }
  }
  return { dir, url: pathToFileURL(`${dir}/`), done: () => rm(dir, { recursive: true, force: true }) };
}

const isJpeg = (buf) => buf[0] === 0xff && buf[1] === 0xd8;

// ---------------------------------------------------------------- the presets and the placeholders

test('presets: 1 woman (Sreypov, PIN 4455, +855 10 000 4455) and 1 man (Samnang, PIN 6677, +855 10 000 6677), 30+, real jobs', () => {
  assert.deepEqual(DEMO_PRESET_KEYS, ['woman', 'man']);
  const w = DEMO_PRESETS.woman;
  const m = DEMO_PRESETS.man;
  assert.deepEqual([w.name, w.gender, w.birthYear, w.pin, w.phone], ['Sreypov', 'woman', 1991, '4455', '+855100004455']);
  assert.deepEqual([m.name, m.gender, m.birthYear, m.pin, m.phone], ['Samnang', 'man', 1988, '6677', '+855100006677']);
  for (const p of [w, m]) {
    const f = checkDemoFields(p.preset, {}, { now: Date.parse('2026-10-14T00:00:00Z') });
    assert.equal(f.name, p.name, 'the app\'s own name rules take it');
    assert.equal(f.realName.split(' ').length, 2, 'a first and last name (shown at Level 3)');
    assert.notEqual(f.name, 'Dara');
    assert.notEqual(f.name, 'Sophea');
  }
  // The Media Director's files: demo-w-1.jpg … demo-w-4.jpg, demo-m-1.jpg … demo-m-4.jpg, in src/thirtyda-admin/review/.
  assert.deepEqual([1, 2, 3, 4].map((i) => demoPhotoFile('woman', i)), ['demo-w-1.jpg', 'demo-w-2.jpg', 'demo-w-3.jpg', 'demo-w-4.jpg']);
  assert.deepEqual([1, 2, 3, 4].map((i) => demoPhotoFile('man', i)), ['demo-m-1.jpg', 'demo-m-2.jpg', 'demo-m-3.jpg', 'demo-m-4.jpg']);
  assert.ok(DEMO_PHOTO_DIR.pathname.endsWith('/src/thirtyda-admin/review/'));
});

test('placeholders: 4 different JPEG silhouettes per gender (navy / grey, no text, nothing real), 720×900', async () => {
  const seen = new Set();
  for (const g of ['woman', 'man']) {
    for (let slot = 1; slot <= PHOTO_MAX; slot++) {
      const svg = placeholderSvg(g, slot);
      assert.doesNotMatch(svg, /<text|<image|href=/, 'shapes only: no text, no embedded picture');
      const buf = await placeholderPhoto(g, slot);
      assert.ok(isJpeg(buf));
      const meta = await sharp(buf).metadata();
      assert.deepEqual([meta.format, meta.width, meta.height], ['jpeg', 720, 900]);
      seen.add(crypto.createHash('sha256').update(buf).digest('hex'));
    }
  }
  assert.equal(seen.size, 8, 'every slot and gender looks different');
});

// ---------------------------------------------------------------- create

test('C: Create demo woman with placeholders — a NEW fully filled review account, 4 photos approved + slot-aligned', async () => {
  const d = await world();
  const store = photoStore();
  const f = await folder();
  try {
    const { user: u, created } = await createDemoAccount(d, 'woman', {}, { ...store, dir: f.url, now: Date.parse('2026-10-14T05:00:00Z') });
    assert.equal(created, true);
    assert.equal(u._id, 'U-10004', 'the app\'s own id counter');
    assert.equal(u.id, u._id);
    assert.deepEqual([u.name, u.realName, u.gender, u.birthYear, u.role, u.lang, u.language], ['Sreypov', 'Heng Sreypov', 'woman', 1991, 'accountant', 'en', 'English']);
    // A review account: mock number verified (phoneVia review), the PIN hashed like the app's and sealed for the notes.
    assert.equal(u.demo, REVIEW);
    assert.equal(u.demoPreset, 'woman');
    assert.equal(u.phone, '+855100004455');
    assert.equal(u.verified.phone, true);
    assert.equal(u.phoneVia, 'review');
    assert.equal(await verifyPin('4455', u.pinHash), true);
    assert.equal(reviewPinOf(u), '4455');
    assert.equal(u.reviewWas, undefined, 'no profile of its own to go back to');
    // Pinned in Phnom Penh, on a spot no other review account has.
    assert.equal(u.area, REVIEW_PLACE.area);
    assert.ok(REVIEW_SPOTS.some((s) => s[0] === u.location.coordinates[0] && s[1] === u.location.coordinates[1]));
    const others = d.docs('thirtyda_users').filter((x) => x._id !== u._id && isReview(x)).map((x) => String(x.location.coordinates));
    assert.ok(!others.includes(String(u.location.coordinates)), 'its own spot');
    // 4 photos in the store, slot order, approved (no photoReview entry), all placeholders for now.
    assert.equal(u.photos.length, PHOTO_MAX);
    assert.ok(u.photos.every((id) => store.files.has(id) && isJpeg(store.files.get(id))));
    assert.equal(u.photoReview, undefined, 'approved: nothing waits for the Photos page');
    assert.deepEqual(u.demoPhotos, ['placeholder', 'placeholder', 'placeholder', 'placeholder']);
    for (let i = 0; i < PHOTO_MAX; i++) {
      assert.ok(store.files.get(u.photos[i]).equals(await placeholderPhoto('woman', i + 1)), `slot ${i + 1} = placeholder ${i + 1} (photo 1 = the face)`);
    }
    assert.equal(u.blocked, false);
    assert.equal(u.level, 1);
  } finally {
    await f.done();
  }
});

test('C: idempotent — Create demo woman twice updates the same account (fields, photos); old photos leave the store', async () => {
  const d = await world();
  const store = photoStore();
  const f = await folder();
  try {
    const first = (await createDemoAccount(d, 'woman', {}, { ...store, dir: f.url })).user;
    const again = await createDemoAccount(d, 'woman', { name: 'Pov', birthYear: '1990', role: 'manager', lang: 'km', pin: '5577' }, { ...store, dir: f.url });
    assert.equal(again.created, false);
    assert.equal(again.user._id, first._id, 'the same account');
    assert.equal(d.docs('thirtyda_users').filter((u) => u.demoPreset === 'woman').length, 1, 'never a second one');
    assert.deepEqual([again.user.name, again.user.birthYear, again.user.role, again.user.lang, again.user.language], ['Pov', 1990, 'manager', 'km', 'Khmer']);
    assert.equal(await verifyPin('5577', again.user.pinHash), true, 'the new PIN');
    assert.equal(reviewPinOf(again.user), '5577');
    assert.deepEqual(again.user.location, first.location, 'it keeps its spot');
    assert.equal(again.user.reviewAt.getTime?.() ?? new Date(again.user.reviewAt).getTime(), new Date(first.reviewAt).getTime(), 'its place in the notes');
    assert.equal(store.files.size, PHOTO_MAX, 'only the 4 new photos are left in the store');
    assert.ok(first.photos.every((id) => !store.files.has(id)));
    assert.ok(again.user.photos.every((id) => store.files.has(id)));
    // The man is a separate account; both counted once.
    const man = (await createDemoAccount(d, 'man', {}, { ...store, dir: f.url })).user;
    assert.notEqual(man._id, first._id);
    assert.equal(d.docs('thirtyda_users').filter((u) => u.demo === REVIEW).length, 4, 'Dara, Sophea, the woman, the man');
  } finally {
    await f.done();
  }
});

test('C: the Media Director\'s files are used slot by slot once they are in the folder; "Refresh photos" puts them in', async () => {
  const d = await world();
  const store = photoStore();
  const two = await folder({ woman: [1, 2] });
  try {
    const u = (await createDemoAccount(d, 'woman', {}, { ...store, dir: two.url })).user;
    assert.deepEqual(u.demoPhotos, ['real', 'real', 'placeholder', 'placeholder']);
    for (const slot of [1, 2]) {
      const file = await readFile(join(two.dir, demoPhotoFile('woman', slot)));
      assert.ok(store.files.get(u.photos[slot - 1]).equals(file), `slot ${slot} = demo-w-${slot}.jpg`);
    }
    assert.deepEqual((await demoPhotoFiles('woman', { dir: two.url })).real, [true, true, false, false]);
    assert.equal((await demoPhotoFiles('man', { dir: two.url })).count, 0);
    // All four arrive: the page says Refresh, and Refresh takes them (approved, slot-aligned, the old ones gone).
    for (const slot of [3, 4]) {
      await writeFile(join(two.dir, demoPhotoFile('woman', slot)), await sharp({ create: { width: 500, height: 700, channels: 3, background: '#a0a0a0' } }).jpeg().toBuffer());
    }
    let view = await demoView(d, { dir: two.url });
    const w = view.presets.find((p) => p.preset === 'woman');
    assert.equal(w.files.count, 4);
    assert.equal(w.account.refresh, true, 'files the account does not show yet');
    const before = u.photos;
    const r = await refreshDemoPhotos(d, u._id, { ...store, dir: two.url });
    assert.deepEqual(r.demoPhotos, ['real', 'real', 'real', 'real']);
    assert.equal(r.photoReview, undefined);
    for (let slot = 1; slot <= 4; slot++) {
      assert.ok(store.files.get(r.photos[slot - 1]).equals(await readFile(join(two.dir, demoPhotoFile('woman', slot)))), `slot ${slot}`);
    }
    assert.ok(before.every((id) => !store.files.has(id)), 'the placeholders left the store');
    view = await demoView(d, { dir: two.url });
    assert.equal(view.presets.find((p) => p.preset === 'woman').account.refresh, false);
    // Only a preset-made account: not Dara (a review account made from a real profile), not a real profile.
    await assert.rejects(refreshDemoPhotos(d, 'U-10001', { ...store, dir: two.url }), (e) => e instanceof ReviewError && e.status === 404);
    await assert.rejects(refreshDemoPhotos(d, 'U-10003', { ...store, dir: two.url }), (e) => e instanceof ReviewError && e.status === 404);
  } finally {
    await two.done();
  }
});

test('C: a file in the folder that is not a photo → 422 naming it, nothing saved', async () => {
  const d = await world();
  const store = photoStore();
  const f = await folder();
  try {
    await writeFile(join(f.dir, 'demo-m-2.jpg'), 'not a jpeg');
    // The store's own decode (normalizePhoto: PhotoError for anything that is not an image), then the in-memory save.
    const failing = { ...store, async save(buf) { await normalizePhoto(buf); return store.save(buf); } };
    await assert.rejects(createDemoAccount(d, 'man', {}, { ...failing, dir: f.url }), (e) => e instanceof ReviewError && e.status === 422 && /demo-m-2\.jpg/.test(e.message));
    assert.equal(store.files.size, 0, 'the photo saved before it was taken back');
    assert.equal(await demoAccountOf(d, 'man'), null);
  } finally {
    await f.done();
  }
});

// ---------------------------------------------------------------- refusals (nothing written)

test('C: refusals — bad fields (422), a taken number, a review name in use, REVIEW_MAX reached (409); nothing is written', async () => {
  const d = await world();
  const store = photoStore();
  const f = await folder();
  const opts = { ...store, dir: f.url, now: Date.parse('2026-10-14T05:00:00Z') };
  const count = () => d.docs('thirtyda_users').length;
  try {
    const n = count();
    const bad = async (input, field) => {
      await assert.rejects(createDemoAccount(d, 'woman', input, opts), (e) => e instanceof ReviewError && e.status === 422 && e.field === field, field);
    };
    await bad({ name: 'Sreypovvvv' }, 'name');
    await bad({ name: 'call 012345678' }, 'name');
    await bad({ realName: 'X' }, 'realName');
    await bad({ gender: 'robot' }, 'gender');
    await bad({ birthYear: 2000 }, 'birthYear'); // 26: too young
    await bad({ role: 'astronaut' }, 'role');
    await bad({ lang: 'fr' }, 'lang');
    await bad({ phone: '12' }, 'phone');
    await bad({ pin: '1111' }, 'pin');
    await bad({ pin: '12' }, 'pin');
    await assert.rejects(createDemoAccount(d, 'robot', {}, opts), (e) => e.status === 400);
    // A number another profile has (Dara's mock number), an app name another review account has.
    await assert.rejects(createDemoAccount(d, 'woman', { phone: '+855 10 000 1122' }, opts), (e) => e.status === 409 && e.code === 'phone_in_use');
    await assert.rejects(createDemoAccount(d, 'woman', { name: 'sophea' }, opts), (e) => e.status === 409 && e.code === 'name_in_use');
    assert.equal(count(), n);
    assert.equal(store.files.size, 0, 'no photo saved for a refusal');
    // REVIEW_MAX: with 4 review accounts a NEW one is refused; the existing one can still be saved again.
    await createDemoAccount(d, 'woman', {}, opts);
    await makeReviewAccount(d, 'U-10003', { phone: '+855100009900', pin: '9900' });
    assert.equal(d.docs('thirtyda_users').filter(isReview).length, REVIEW_MAX);
    await assert.rejects(createDemoAccount(d, 'man', {}, opts), (e) => e.status === 409 && e.code === 'too_many');
    assert.equal((await createDemoAccount(d, 'woman', {}, opts)).created, false, 'updating the existing one still works');
    // The id was never taken: a failure after the photos were saved puts them back.
    await stopReviewAccount(d, 'U-10003');
    await assert.rejects(createDemoAccount(d, 'man', {}, { ...opts, newId: async () => { throw new Error('counter down'); } }), /counter down/);
    assert.equal(await demoAccountOf(d, 'man'), null);
    assert.equal(store.files.size, PHOTO_MAX, 'only the woman\'s photos');
  } finally {
    await f.done();
  }
});

test('C: a PIN another review account has → 409 pin_in_use (Create and "Use as review account"); nothing is written', async () => {
  const d = await world(); // Dara 1122, Sophea 3344
  const store = photoStore();
  const f = await folder();
  const opts = { ...store, dir: f.url, now: Date.parse('2026-10-14T05:00:00Z') };
  const users = d.collection('thirtyda_users');
  const pinInUse = (e) => e instanceof ReviewError && e.status === 409 && e.code === 'pin_in_use' && e.field === 'pin';
  try {
    const w = (await createDemoAccount(d, 'woman', {}, opts)).user; // 4455
    const before = structuredClone(d.docs('thirtyda_users'));
    const stored = new Set(store.files.keys());
    // The finding: the demo man with the PIN field edited to Dara's 1122 (a typo) — and the woman's 4455, Sophea's 3344.
    for (const pin of ['1122', '3344', '4455']) {
      await assert.rejects(createDemoAccount(d, 'man', { pin }, opts), pinInUse, pin);
    }
    assert.deepEqual(d.docs('thirtyda_users'), before, 'no account made, none changed');
    assert.deepEqual(new Set(store.files.keys()), stored, 'no photo stored');
    assert.equal(await demoAccountOf(d, 'man'), null);
    // "Use as review account" and saving one again go through the same check (makeReviewAccount).
    await assert.rejects(makeReviewAccount(d, 'U-10003', { phone: '+855100009900', pin: '4455' }), pinInUse);
    assert.equal(isReview(await users.findOne({ _id: 'U-10003' })), false, 'still a real profile');
    await assert.rejects(makeReviewAccount(d, 'U-10002', { phone: '+855100003344', pin: '1122' }), pinInUse, 'Sophea → Dara\'s PIN');
    assert.equal(reviewPinOf(await users.findOne({ _id: 'U-10002' })), '3344');
    await makeReviewAccount(d, 'U-10002', { phone: '+855100003344', pin: '3344' }); // its own: fine
    // An account whose sealed PIN this server cannot open still counts (the hash the sign-in checks).
    await users.updateOne({ _id: 'U-10001' }, { $unset: { reviewPinBox: '' } });
    await assert.rejects(makeReviewAccount(d, 'U-10003', { phone: '+855100009900', pin: '1122' }), pinInUse, 'by the hash');
    // A review account being deleted no longer holds its PIN.
    await users.updateOne({ _id: 'U-10001' }, { $set: { deleting: true } });
    await makeReviewAccount(d, 'U-10003', { phone: '+855100009900', pin: '1122' });
    await stopReviewAccount(d, 'U-10003');
    await users.updateOne({ _id: 'U-10001' }, { $unset: { deleting: '' } });
    await makeReviewAccount(d, 'U-10001', REVIEW_DEFAULTS[0]); // Dara's PIN sealed again
    // The man with his own PIN; then saving him again with Dara's PIN is refused and he keeps 6677.
    const m = (await createDemoAccount(d, 'man', {}, opts)).user;
    const manBefore = await users.findOne({ _id: m._id });
    await assert.rejects(createDemoAccount(d, 'man', { pin: '1122' }, opts), pinInUse);
    assert.deepEqual(await users.findOne({ _id: m._id }), manBefore, 'unchanged');
    assert.equal(reviewPinOf(await users.findOne({ _id: m._id })), '6677');
    // Saving an account again with its OWN PIN is no clash.
    assert.equal((await createDemoAccount(d, 'man', { pin: '6677' }, opts)).created, false);
    // Every PIN signs into its own account, and the notes name each once.
    await setReviewSwitch(d, true);
    for (const [pin, id] of [['1122', 'U-10001'], ['3344', 'U-10002'], ['4455', w._id], ['6677', m._id]]) {
      assert.equal((await reviewAccountForPin(d, pin))?._id, id, pin);
    }
    const pins = (await reviewView(d)).accounts.map((a) => a.pin).filter(Boolean);
    assert.equal(new Set(pins).size, pins.length, 'no PIN twice in the notes');
  } finally {
    await f.done();
  }
});

test('C: only a real preset key — "constructor", "__proto__", "toString" … are 400 bad_preset, nothing written, no photo file', async () => {
  const d = await world();
  const store = photoStore();
  const f = await folder();
  const opts = { ...store, dir: f.url, now: Date.parse('2026-10-14T05:00:00Z') };
  const n = d.docs('thirtyda_users').length;
  try {
    assert.equal(isDemoPreset('woman'), true);
    assert.equal(isDemoPreset('man'), true);
    for (const preset of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf', '', undefined, null, 1]) {
      assert.equal(isDemoPreset(preset), false, String(preset));
      assert.throws(() => checkDemoFields(preset, { name: 'Proto' }), (e) => e instanceof ReviewError && e.status === 400 && e.code === 'bad_preset', String(preset));
      await assert.rejects(createDemoAccount(d, preset, { name: 'Proto', phone: '+855100009911', pin: '9911' }, opts), (e) => e.status === 400 && e.code === 'bad_preset');
      assert.equal(demoPhotoFile(preset, 1), 'demo-x-1.jpg', 'never a file named after an object key');
    }
    assert.equal(d.docs('thirtyda_users').length, n, 'no orphan review account');
    assert.equal(store.files.size, 0);
    // An account an older build left with such a preset: "Refresh photos" refuses it (404), nothing stored.
    await d.collection('thirtyda_users').insertOne({ _id: 'U-10009', name: 'Proto', demo: REVIEW, demoPreset: 'constructor', gender: 'woman', photos: [] });
    await assert.rejects(refreshDemoPhotos(d, 'U-10009', opts), (e) => e.status === 404 && e.code === 'not_found');
    assert.equal(store.files.size, 0);
  } finally {
    await f.done();
  }
});

test('C: "Stop being a review account" is refused for a demo made here (409 made_here) — Remove deletes it', async () => {
  const d = await world();
  const f = await folder();
  try {
    const u = (await createDemoAccount(d, 'man', {}, { ...photoStore(), dir: f.url })).user;
    await assert.rejects(stopReviewAccount(d, u._id), (e) => e instanceof ReviewError && e.status === 409 && e.code === 'made_here');
    assert.equal((await d.collection('thirtyda_users').findOne({ _id: u._id })).demo, REVIEW, 'still a review account');
  } finally {
    await f.done();
  }
  // The page offers Remove (the admin's one delete path), never Stop, for an account made here.
  const { readFileSync } = await import('node:fs');
  const js = readFileSync(new URL('../thirtyda-admin/review.js', import.meta.url), 'utf8');
  const made = js.slice(js.indexOf('const actions = a.made'), js.indexOf(': [', js.indexOf('const actions = a.made') + 30));
  assert.match(made, /onclick: \(\) => remove\(a\) \}, 'Remove'/);
  assert.doesNotMatch(made, /stop\(a\)/);
  assert.match(js, /async function remove\(p\) \{[\s\S]*window\.thirtydaDeleteProfile\(\{ id: p\.id, name: p\.name \}\)/);
});

// ---------------------------------------------------------------- it signs in and lives in the review world

test('C: the PIN works on the PIN-only way (POST /auth/review/pin): 1122 / 3344 / 4455 / 6677 → their own accounts, only while ON', async () => {
  const d = await world();
  const f = await folder();
  try {
    const w = (await createDemoAccount(d, 'woman', {}, { ...photoStore(), dir: f.url })).user;
    const m = (await createDemoAccount(d, 'man', {}, { ...photoStore(), dir: f.url })).user;
    const tries = tryCounter();
    await assert.rejects(reviewPinCheck(d, { pin: '4455', key: 'ip', tries }), (e) => e.status === 404, 'OFF: like an unknown route');
    assert.equal(await reviewAccountForPin(d, '4455'), null);
    await setReviewSwitch(d, true);
    assert.equal((await reviewPinCheck(d, { pin: '4455', key: 'ip', tries }))._id, w._id);
    assert.equal((await reviewPinCheck(d, { pin: '6677', key: 'ip', tries }))._id, m._id);
    assert.equal((await reviewPinCheck(d, { pin: '1122', key: 'ip', tries }))._id, 'U-10001');
    assert.equal((await reviewPinCheck(d, { pin: '3344', key: 'ip', tries }))._id, 'U-10002');
    assert.deepEqual(await reviewPinProbe(d, { pin: '4455', key: 'ip', tries }), { review: true, name: 'Sreypov' });
    assert.deepEqual(await reviewPinProbe(d, { pin: '6677', key: 'ip', tries }), { review: true, name: 'Samnang' });
    await assert.rejects(reviewPinCheck(d, { pin: '5577', key: 'ip', tries }), (e) => e.status === 400 && e.code === 'not_review');
    // The mock number works the review-code way too (it is the account's verified phone).
    const { reviewAccountFor } = await import('./thirtyda-review.mjs');
    assert.equal((await reviewAccountFor(d, '+855100004455'))._id, w._id);
  } finally {
    await f.done();
  }
});

test('C: the demo accounts join the review world — they see Dara, Sophea and each other; real people and guests never see them', async () => {
  const d = await world();
  const f = await folder();
  try {
    const w = (await createDemoAccount(d, 'woman', {}, { ...photoStore(), dir: f.url })).user;
    const m = (await createDemoAccount(d, 'man', {}, { ...photoStore(), dir: f.url })).user;
    const [dara, sophea, kk] = await Promise.all(['U-10001', 'U-10002', 'U-10003'].map((id) => d.collection('thirtyda_users').findOne({ _id: id })));
    for (const [a, b] of [[w, m], [m, w], [w, dara], [m, sophea], [dara, w]]) assert.equal(sameWorld(a, b), true, `${a.name} ↔ ${b.name}`);
    for (const x of [w, m]) {
      assert.equal(sameWorld(kk, x), false, 'a real person never sees a demo');
      assert.equal(sameWorld(x, kk), false, 'a demo never sees a real person');
      assert.equal(sameWorld(null, x), false, 'a guest never sees a demo');
    }
    // What Nearby asks Mongo for: the review world for a demo, never a demo for a real person.
    const nearbyOf = (me) => d.docs('thirtyda_users').filter((u) => u._id !== me._id && Object.entries(worldFilter(me)).every(([k, c]) => (c.$ne ? u[k] !== c.$ne : u[k] === c)));
    assert.deepEqual(nearbyOf(w).map((u) => u._id).sort(), ['U-10001', 'U-10002', m._id].sort());
    assert.ok(!nearbyOf(kk).some((u) => u._id === w._id || u._id === m._id));
    // Their Nearby card shows photo 1 (approved: no photoReview), within a few km of each other.
    const { haversineKm } = await import('./thirtyda-geo.mjs');
    assert.ok(haversineKm(w.location.coordinates, m.location.coordinates) < 5);
    const { publicPhotoId } = await import('./thirtyda-photo-review.mjs');
    assert.equal(publicPhotoId(w, 0), w.photos[0]);
    assert.equal(publicPhotoId(m, 0), m.photos[0]);
  } finally {
    await f.done();
  }
});

test('C: the notes list every demo account with its PIN (the made ones too); the page data has the Create panel', async () => {
  const d = await world();
  const f = await folder();
  try {
    await createDemoAccount(d, 'woman', {}, { ...photoStore(), dir: f.url });
    await createDemoAccount(d, 'man', {}, { ...photoStore(), dir: f.url });
    const v = await reviewView(d);
    assert.deepEqual(v.accounts.map((a) => [a.name, a.pin, a.made]), [['Dara', '1122', null], ['Sophea', '3344', null], ['Sreypov', '4455', 'woman'], ['Samnang', '6677', 'man']]);
    for (const want of [
      'Demo account 1: Dara (man) · PIN 1122 · phone +855 10 000 1122',
      'Demo account 2: Sophea (woman) · PIN 3344 · phone +855 10 000 3344',
      'Demo account 3: Sreypov (woman) · PIN 4455 · phone +855 10 000 4455',
      'Demo account 4: Samnang (man) · PIN 6677 · phone +855 10 000 6677',
      '3. On "Set your PIN" type a demo PIN (1122, 3344, 4455 or 6677): you are signed in to that demo account at once, in the language you picked.',
      '4. Nearby shows the other demo accounts with their photos. Dara and Sophea already have a conversation (Level 3 chat).',
      'unlock it with the same PIN (1122 / 3344 / 4455 / 6677)',
      'The demo accounts see only each other.',
    ]) assert.ok(v.notes.includes(want), want);
    assert.equal(v.counts.review, 4);
    const dm = await demoView(d, { dir: f.url });
    assert.deepEqual(dm.presets.map((p) => [p.preset, p.label, p.account?.pin, p.account?.photos, p.files.count]), [
      ['woman', 'Demo woman', '4455', 4, 0], ['man', 'Demo man', '6677', 4, 0],
    ]);
    assert.deepEqual(dm.presets[0].files.names, ['demo-w-1.jpg', 'demo-w-2.jpg', 'demo-w-3.jpg', 'demo-w-4.jpg']);
    assert.equal(dm.presets[0].account.phone, '+855100004455');
    assert.equal(dm.folder, 'src/thirtyda-admin/review/');
    assert.ok(dm.roles.some((r) => r.key === 'accountant' && r.text === 'Accountant'));
    assert.deepEqual(dm.langs.map((l) => l.key), ['en', 'km', 'zh', 'ko', 'ja']);
  } finally {
    await f.done();
  }
});

// ---------------------------------------------------------------- the admin page and its routes

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

test('admin routes: Create demo account and Refresh photos are signed-in, same-origin JSON only (before any database)', async () => {
  const JSON_HEADERS = { 'content-type': 'application/json', origin: 'https://ecom.ggmt.sg' };
  for (const path of ['/30da/admin/api/review/demo', '/30da/admin/api/review/demo/U-10004/photos']) {
    let r = await admin('POST', path, { ...JSON_HEADERS, origin: 'https://evil.example' }, { preset: 'woman' });
    assert.equal(r.status, 403, `${path}: foreign Origin`);
    r = await admin('POST', path, { origin: 'https://ecom.ggmt.sg', 'content-type': 'text/plain' }, { preset: 'woman' });
    assert.equal(r.status, 415, `${path}: a form post`);
    r = await admin('POST', path, JSON_HEADERS, { preset: 'woman' });
    assert.equal(r.status, 401, `${path}: not signed in`);
  }
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./thirtyda-admin.mjs', import.meta.url), 'utf8');
  assert.match(src, /await audit\(req, "review_demo_save", \{ user: r\.user\._id, preset, created: r\.created \}\);/, 'audited with ids only');
  assert.match(src, /await audit\(req, "review_demo_photos", \{ user: m\[2\] \}\);/);
});

test('admin page: the Create panel with both presets, the photo status line, and Refresh photos; everything as text', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../thirtyda-admin/review.html', import.meta.url), 'utf8');
  for (const id of ['demos', 'demo-dialog', 'demo-name', 'demo-real', 'demo-gender', 'demo-birth', 'demo-role', 'demo-lang', 'demo-phone', 'demo-pin', 'demo-save']) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.match(html, /<h2 id="demo-title">Create demo account<\/h2>/);
  const js = readFileSync(new URL('../thirtyda-admin/review.js', import.meta.url), 'utf8');
  assert.ok(!/innerHTML/.test(js));
  assert.match(js, /'Photos: placeholders — real demo photos not added yet'/);
  assert.match(js, /`\$\{p\.label\} \(PIN \$\{pin\}\)`/, '"Demo woman (PIN 4455)" / "Demo man (PIN 6677)"');
  assert.match(js, /act\(`demo\/\$\{a\.id\}\/photos`/, 'Refresh photos');
  assert.match(js, /act\('demo', \{\s*preset: demoEditing,/, 'Create sends the edited fields');
});
