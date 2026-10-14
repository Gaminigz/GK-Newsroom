// Run: npm run 30da:test (or node --test src/lib/thirtyda-hub-wan.test.mjs)
// The GK API Hub, tower 11 · Wan (owner 2026-10-14: image to video on our M5 for Yai Media Director,
// src/lib/thirtyda-hub-wan.mjs, contract v1): the bearer tokens (hash + last 4 only, shown once), every check and 4xx of
// the contract, the caps that guard the M0, the picture re-encoded, the whole round trip client → M5 → client, the 45-minute
// lease (back once, then "worker_lost"; 409 not_yours for a stale lease), the 48 h sweep, the tower's options, the admin
// Code page's tower 11, and the serve-web mount. In-memory Mongo stand-in, in-memory byte store and a test clock: no
// database, no network, no files written.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { Readable } from 'node:stream';
import vm from 'node:vm';
import sharp from 'sharp';

const {
  handleThirtyDaHub, setHubWanTestHooks, memoryStore, gridStore, normalizeWanImage, newWanToken, revokeWanToken, saveWanOptions,
  queueWanTry, wanAdminView, wanStatus, sweepWan, WAN_LIMITS, WAN_JOBS, WAN_BUCKET, LEASE_MS, CLIP_KEEP_MS, RENDERS_AT_ONCE,
} = await import('./thirtyda-hub-wan.mjs');
const { tokenHash, tokenStatus, checkToken, makeToken, TOKEN_SETTINGS, SETTINGS_COLLECTION } = await import('./thirtyda-settings.mjs');
const { handleThirtyDaAdmin, setAdminTestHooks } = await import('./thirtyda-admin.mjs');

// ---------------------------------------------------------------- an in-memory Mongo, just enough

const get = (doc, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc);
const val = (v) => (v instanceof Date ? v.getTime() : v);
const eq = (v, want) => (want === null ? v == null : val(v) === val(want));
function matches(doc, q) {
  for (const [k, cond] of Object.entries(q || {})) {
    const v = get(doc, k);
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond) && Object.keys(cond).some((x) => x.startsWith('$'))) {
      for (const [op, want] of Object.entries(cond)) {
        if (op === '$exists' && (v !== undefined) !== want) return false;
        if (op === '$gt' && !(v != null && val(v) > val(want))) return false;
        if (op === '$gte' && !(v != null && val(v) >= val(want))) return false;
        if (op === '$lt' && !(v != null && val(v) < val(want))) return false;
        if (op === '$lte' && !(v != null && val(v) <= val(want))) return false;
        if (op === '$ne' && eq(v, want)) return false;
        if (op === '$in' && !want.some((w) => eq(v, w))) return false;
      }
    } else if (!eq(v, cond)) return false;
  }
  return true;
}
function apply(doc, u) {
  for (const [k, v] of Object.entries(u.$set || {})) doc[k] = structuredClone(v);
  for (const [k, v] of Object.entries(u.$inc || {})) doc[k] = (doc[k] ?? 0) + v;
  for (const k of Object.keys(u.$unset || {})) delete doc[k];
}
const sorter = (by) => {
  const [[k, dir]] = Object.entries(by);
  return (a, b) => (val(a[k]) > val(b[k]) ? dir : val(a[k]) < val(b[k]) ? -dir : 0);
};
function fakeDb() {
  const cols = new Map();
  const collection = (name) => {
    if (!cols.has(name)) {
      const docs = new Map();
      const all = (q) => [...docs.values()].filter((x) => matches(x, q));
      const plainFields = (q) => Object.fromEntries(Object.entries(q || {}).filter(([k, v]) => !k.includes('.') && !(v && typeof v === 'object' && !(v instanceof Date))));
      cols.set(name, {
        docs,
        async createIndex() { return 'ok'; },
        async findOne(q, opts = {}) {
          let rows = all(q);
          if (opts.sort) rows = rows.sort(sorter(opts.sort));
          return rows[0] ? structuredClone(rows[0]) : null;
        },
        find(q) {
          let rows = all(q);
          const cursor = {
            sort(by) { rows = [...rows].sort(sorter(by)); return cursor; },
            limit(n) { rows = rows.slice(0, n); return cursor; },
            async toArray() { return rows.map((x) => structuredClone(x)); },
          };
          return cursor;
        },
        async countDocuments(q) { return all(q).length; },
        async insertOne(doc) {
          const _id = doc._id ?? crypto.randomUUID();
          if (docs.has(_id)) throw new Error('duplicate key');
          docs.set(_id, structuredClone({ ...doc, _id }));
          return { insertedId: _id };
        },
        async replaceOne(q, doc, opts = {}) {
          const x = all(q)[0];
          if (!x && !opts.upsert) return { matchedCount: 0 };
          docs.set(doc._id ?? x._id, structuredClone(doc));
          return { matchedCount: x ? 1 : 0 };
        },
        async updateOne(q, u, opts = {}) {
          const x = all(q)[0];
          if (!x) {
            if (!opts.upsert) return { matchedCount: 0 };
            const fresh = { ...plainFields(q) };
            apply(fresh, u);
            docs.set(fresh._id ?? crypto.randomUUID(), fresh);
            return { matchedCount: 0, upsertedCount: 1 };
          }
          apply(x, u);
          return { matchedCount: 1 };
        },
        async updateMany(q, u) { const xs = all(q); for (const x of xs) apply(x, u); return { matchedCount: xs.length }; },
        async findOneAndUpdate(q, u, opts = {}) {
          let rows = all(q);
          if (opts.sort) rows = rows.sort(sorter(opts.sort));
          const x = rows[0];
          if (!x) return null;
          const before = structuredClone(x);
          apply(x, u);
          return structuredClone(opts.returnDocument === 'after' ? x : before);
        },
        async deleteOne(q) { const x = all(q)[0]; if (x) docs.delete(x._id); return { deletedCount: x ? 1 : 0 }; },
        async deleteMany(q) { const xs = all(q); for (const x of xs) docs.delete(x._id); return { deletedCount: xs.length }; },
      });
    }
    return cols.get(name);
  };
  return { collection, docs: (name) => [...collection(name).docs.values()] };
}

// ---------------------------------------------------------------- requests

const HOST = 'ecom.ggmt.sg';
const START = Date.parse('2026-10-14T03:00:00Z');
let T = START;
let d = null;
let store = null;

beforeEach(() => {
  T = START;
  d = fakeDb();
  store = memoryStore();
  setHubWanTestHooks({ db: d, store, now: () => T });
});

/** A request whose body arrives as a stream (chunks: an array of Buffers, or a generator). */
function fakeReq(method, path, { headers = {}, chunks = [] } = {}) {
  const req = Readable.from(chunks);
  return Object.assign(req, { method, url: path, headers: { host: HOST, ...headers }, socket: { remoteAddress: '127.0.0.1' } });
}
function fakeRes() {
  const res = { status: null, headers: null, body: undefined, headersSent: false };
  res.writeHead = (s, h = {}) => { res.status = s; res.headers = h; res.headersSent = true; return res; };
  res.end = (b) => { res.body = b === undefined ? undefined : Buffer.isBuffer(b) ? b : Buffer.from(String(b)); return res; };
  res.json = () => JSON.parse(res.body.toString('utf8'));
  return res;
}

/** One call to the hub. body: an object (sent as JSON), a string or a Buffer (sent as is). */
async function hub(method, path, { token, lease, headers = {}, body, chunks } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (lease) h['x-wan-lease'] = lease;
  let parts = chunks;
  if (!parts && body !== undefined) {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    parts = [buf];
    h['content-type'] ??= 'application/json';
    h['content-length'] ??= String(buf.length);
  }
  const req = fakeReq(method, path, { headers: h, chunks: parts || [] });
  const res = fakeRes();
  await handleThirtyDaHub(req, res, new URL(path, `https://${HOST}`));
  return res;
}
const W = '/30da/hub/wan';
const jobs = () => d.docs(WAN_JOBS);
const jobOf = (id) => d.collection(WAN_JOBS).docs.get(id);

// ---------------------------------------------------------------- pictures and clips

const pngOf = (width = 640, height = 960) => sharp({ create: { width, height, channels: 3, background: '#b0485a' } }).png().toBuffer();
let PNG = null;
const png = async () => (PNG ??= await pngOf());
const mp4 = (n = 2048) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom', 'latin1'), crypto.randomBytes(n)]);
const webp = (n = 512) => Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBPVP8 ', 'latin1'), crypto.randomBytes(n)]);

async function tokens() {
  const client = (await newWanToken(d, 'client')).token;
  const worker = (await newWanToken(d, 'worker')).token;
  return { client, worker };
}
async function renderBody(over = {}) {
  return { image: (await png()).toString('base64'), prompt: 'She turns and smiles.', ...over };
}
async function queued(t, over = {}) {
  const r = await hub('POST', `${W}/render`, { token: t.client, body: await renderBody(over) });
  assert.equal(r.status, 202, r.body?.toString());
  return r.json().job_id;
}
async function claimed(t, body = { worker: 'M5' }) {
  const r = await hub('POST', `${W}/worker/claim`, { token: t.worker, body });
  assert.equal(r.status, 200, r.body?.toString());
  return r.json().job;
}
const done = (t, job, clip = mp4(), type = 'video/mp4') => hub('POST', `${W}/worker/jobs/${job.job_id}/done`, {
  token: t.worker, lease: job.lease_id, body: clip, headers: { 'content-type': type },
});
/** Seed job records straight into the store (caps and rates without 30 real renders). */
function seed(n, fields) {
  for (let i = 0; i < n; i += 1) {
    const id = crypto.randomBytes(16).toString('hex');
    d.collection(WAN_JOBS).docs.set(id, { _id: id, status: 'done', source: 'client', client: 'x', bytes: 0, createdAt: new Date(T), ...fields });
  }
}

// ---------------------------------------------------------------- tokens

test('tokens: 32 random bytes behind wanc_ / wanw_, kept as SHA-256 + last 4 + made-at only; checked by hash', async () => {
  assert.deepEqual(TOKEN_SETTINGS, { wan_client: 'wanc_', wan_worker: 'wanw_' });
  const { token, view } = await makeToken(d, 'wan_client');
  assert.match(token, /^wanc_[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(token.slice(5), 'base64url').length, 32);
  assert.deepEqual(Object.keys(view).sort(), ['last4', 'madeAt', 'madeBy', 'set']);
  assert.equal(view.last4, token.slice(-4));
  const [doc] = d.docs(SETTINGS_COLLECTION);
  assert.deepEqual(Object.keys(doc).sort(), ['_id', 'hash', 'kind', 'last4', 'madeAt', 'madeBy']);
  assert.equal(doc.hash, tokenHash(token));
  assert.equal(JSON.stringify(doc).includes(token.slice(5, -4)), false, 'the token is kept nowhere');
  assert.deepEqual(await checkToken(d, 'wan_client', token), { hash: doc.hash });
  assert.equal(await checkToken(d, 'wan_client', `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`), null);
  assert.equal(await checkToken(d, 'wan_worker', token), null, 'a client token is not a worker token');
  assert.equal(await checkToken(d, 'wan_client', token.replace('wanc_', 'wanw_')), null);
  for (const junk of ['', 'wanc_', 'wanc_short', `${token} `, null]) assert.equal(await checkToken(d, 'wan_client', junk), null);
  const src = readFileSync(new URL('./thirtyda-settings.mjs', import.meta.url), 'utf8');
  assert.match(src, /crypto\.timingSafeEqual\(want, got\)/, 'the digests are compared in constant time');
  await assert.rejects(makeToken(d, 'telegram'), /No such setting/);
});

test('auth: no token, a wrong one, a revoked one, or the other kind\'s → 401 unauthorized (the client\'s and the worker\'s routes)', async () => {
  const t = await tokens();
  const routes = [
    ['POST', `${W}/render`, 'client'], ['GET', `${W}/render/${'a'.repeat(32)}`, 'client'], ['GET', `${W}/clips/${'a'.repeat(32)}`, 'client'],
    ['POST', `${W}/worker/claim`, 'worker'], ['POST', `${W}/worker/jobs/${'a'.repeat(32)}/progress`, 'worker'],
    ['POST', `${W}/worker/jobs/${'a'.repeat(32)}/done`, 'worker'], ['POST', `${W}/worker/jobs/${'a'.repeat(32)}/fail`, 'worker'],
  ];
  for (const [method, path, kind] of routes) {
    const other = kind === 'client' ? t.worker : t.client;
    for (const token of [undefined, 'nope', `wanc_${'A'.repeat(43)}`, `wanw_${'A'.repeat(43)}`, other]) {
      const r = await hub(method, path, { token, body: method === 'POST' ? {} : undefined });
      assert.equal(r.status, 401, `${method} ${path} ${String(token).slice(0, 8)}`);
      assert.equal(r.json().error, 'unauthorized');
      assert.match(r.headers['WWW-Authenticate'], /^Bearer/);
    }
  }
  // Basic or a token in another header is not a bearer token.
  assert.equal((await hub('POST', `${W}/worker/claim`, { headers: { authorization: `Basic ${t.worker}` }, body: {} })).status, 401);
  // Revoked: stops at once.
  assert.equal((await hub('POST', `${W}/worker/claim`, { token: t.worker, body: {} })).status, 204);
  assert.equal((await revokeWanToken(d, 'worker')).removed, true);
  assert.equal((await hub('POST', `${W}/worker/claim`, { token: t.worker, body: {} })).status, 401);
  // A new client token: the old one stops.
  const fresh = (await newWanToken(d, 'client')).token;
  assert.equal((await hub('GET', `${W}/render/${'a'.repeat(32)}`, { token: t.client })).status, 401);
  assert.equal((await hub('GET', `${W}/render/${'a'.repeat(32)}`, { token: fresh })).status, 404);
});

// ---------------------------------------------------------------- POST /render: checks

test('render: every field checked → 400 invalid {field}; nothing queued, nothing stored', async () => {
  const t = await tokens();
  const cases = [
    [{ prompt: undefined }, 'prompt'], [{ prompt: '   ' }, 'prompt'], [{ prompt: 7 }, 'prompt'], [{ prompt: 'x'.repeat(1001) }, 'prompt'],
    [{ negative_prompt: 'x'.repeat(1001) }, 'negative_prompt'], [{ negative_prompt: ['blur'] }, 'negative_prompt'],
    [{ seconds: 0 }, 'seconds'], [{ seconds: 0.5 }, 'seconds'], [{ seconds: 11 }, 'seconds'], [{ seconds: 10.5 }, 'seconds'],
    [{ seconds: '5' }, 'seconds'], [{ size: '1080p' }, 'size'], [{ size: 480 }, 'size'], [{ aspect: '4:3' }, 'aspect'],
    [{ seed: 1.5 }, 'seed'], [{ seed: -1.5 }, 'seed'], [{ seed: 'x' }, 'seed'], [{ seed: 2 ** 60 }, 'seed'],
    [{ image: undefined }, 'image'], [{ image: '' }, 'image'], [{ image: 'not base64!!' }, 'image'], [{ image: 42 }, 'image'],
    [{ image: Buffer.from('just some text, not a picture').toString('base64') }, 'image'],
    [{ image: (await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } }).gif().toBuffer()).toString('base64') }, 'image'],
  ];
  for (const [over, field] of cases) {
    const r = await hub('POST', `${W}/render`, { token: t.client, body: await renderBody(over) });
    assert.equal(r.status, 400, `${JSON.stringify(over).slice(0, 50)} → ${r.body}`);
    assert.deepEqual([r.json().error, r.json().field], ['invalid', field]);
    assert.equal(typeof r.json().message, 'string');
  }
  for (const body of ['not json', '[1,2]', '"text"']) {
    const r = await hub('POST', `${W}/render`, { token: t.client, body });
    assert.equal(r.status, 400, body);
    assert.equal(r.json().field, 'body');
  }
  assert.equal(jobs().length, 0);
  assert.equal(store.files.size, 0);
  // The defaults: 5 s, 480p, 9:16, a seed of our own.
  const id = await queued(t);
  const j = jobOf(id);
  assert.deepEqual([j.seconds, j.size, j.aspect, j.negativePrompt, j.status, j.source], [5, '480p', '9:16', '', 'pending', 'client']);
  assert.ok(Number.isSafeInteger(j.seed) && j.seed >= 0);
  // A data: URL is taken too; an explicit seed is kept.
  const id2 = await queued(t, { image: `data:image/png;base64,${(await png()).toString('base64')}`, seed: 1234, aspect: '1:1', seconds: 10 });
  assert.deepEqual([jobOf(id2).seed, jobOf(id2).aspect, jobOf(id2).seconds], [1234, '1:1', 10]);
});

test('render: what contract v1 says goes — seconds 1–10 with a fraction (2.5), seed any integer (-1 = a random one, never sent on to the M5)', async () => {
  const t = await tokens();
  const id = await queued(t, { seconds: 2.5, seed: -1 });
  assert.equal(jobOf(id).seconds, 2.5);
  assert.ok(Number.isSafeInteger(jobOf(id).seed) && jobOf(id).seed >= 0, `seed ${jobOf(id).seed}`);
  const job = await claimed(t);
  assert.deepEqual([job.seconds, job.seed >= 0], [2.5, true], 'the worker gets the fraction, and no negative seed');
  for (const seed of [-7, -(2 ** 40)]) assert.ok(jobOf(await queued(t, { seed })).seed >= 0);
  assert.equal(jobOf(await queued(t, { seconds: 1, seed: 0 })).seed, 0, '0 is a seed, kept');
  assert.equal(jobOf(await queued(t, { seconds: 7.25 })).seconds, 7.25);
});

test('render: 413 too_large — over 14 MB declared (nothing read), over 14 MB streamed (answered early), over 10 MB decoded', async () => {
  const t = await tokens();
  // Declared too big: refused before a byte is read.
  let pulled = 0;
  // 1 MB at a time, one chunk per turn of the event loop (as it comes off a socket).
  async function* lots(n) {
    for (let i = 0; i < n; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      pulled += 1;
      yield Buffer.alloc(1024 * 1024, 0x41);
    }
  }
  let r = await hub('POST', `${W}/render`, {
    token: t.client, chunks: lots(60), headers: { 'content-type': 'application/json', 'content-length': String(60 * 1024 * 1024) },
  });
  assert.equal(r.status, 413);
  assert.equal(r.json().error, 'too_large');
  assert.equal(pulled, 0, 'not read at all');
  assert.equal(r.headers.Connection, 'close', 'the rest is never read');
  // No length given: answered as soon as it passes 14 MB.
  pulled = 0;
  let pulledAtAnswer = null;
  const req = fakeReq('POST', `${W}/render`, { headers: { authorization: `Bearer ${t.client}`, 'content-type': 'application/json' }, chunks: lots(60) });
  const res = fakeRes();
  const writeHead = res.writeHead;
  res.writeHead = (s, h) => { pulledAtAnswer = pulled; return writeHead(s, h); };
  await handleThirtyDaHub(req, res, new URL(`${W}/render`, `https://${HOST}`));
  assert.equal(res.status, 413);
  assert.ok(pulledAtAnswer <= 16, `answered after ${pulledAtAnswer} MB, not 60`);
  // A body under 14 MB whose picture decodes to over 10 MB.
  const big = crypto.randomBytes(WAN_LIMITS.image + 100 * 1024).toString('base64');
  r = await hub('POST', `${W}/render`, { token: t.client, body: { prompt: 'x', image: big } });
  assert.equal(r.status, 413);
  assert.deepEqual([r.json().error, r.json().field], ['too_large', 'image']);
  assert.equal(jobs().length, 0);
});

test('render: the picture is re-encoded — JPEG, ≤ 1280 px on the long side, EXIF dropped; what the worker gets is that JPEG', async () => {
  const t = await tokens();
  const tagged = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#2a6' } })
    .jpeg().withExif({ IFD0: { Copyright: 'WAN-EXIF-MARK', Artist: 'Someone' } }).toBuffer();
  assert.ok((await sharp(tagged).metadata()).exif, 'the test picture carries EXIF');
  const id = await queued(t, { image: tagged.toString('base64') });
  const stored = await store.get(jobOf(id).input.key);
  const meta = await sharp(stored).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.deepEqual([meta.width, meta.height], [1280, 853]);
  assert.equal(meta.exif, undefined, 'no EXIF');
  assert.equal(stored.includes(Buffer.from('WAN-EXIF-MARK')), false);
  assert.equal(jobOf(id).input.bytes, stored.length);
  assert.equal(jobOf(id).bytes, stored.length, 'counted for the storage cap');
  // A small PNG and a WebP stay their size, as JPEG.
  const small = await normalizeWanImage(await pngOf(300, 200));
  assert.deepEqual([(await sharp(small).metadata()).format, (await sharp(small).metadata()).width], ['jpeg', 300]);
  const fromWebp = await normalizeWanImage(await sharp(await pngOf(200, 400)).webp().toBuffer());
  assert.equal((await sharp(fromWebp).metadata()).height, 400);
  const job = await claimed(t);
  assert.deepEqual(Buffer.from(job.image, 'base64'), stored, 'the worker gets exactly the re-encoded JPEG');
});

test('render: the tower\'s options — 503 tower_off, 422 size_off (720p off by default), 400 invalid for seconds over the most', async () => {
  const t = await tokens();
  let r = await hub('POST', `${W}/render`, { token: t.client, body: await renderBody({ size: '720p' }) });
  assert.equal(r.status, 422);
  assert.deepEqual([r.json().error, r.json().field, r.json().sizes], ['size_off', 'size', ['480p']]);
  assert.equal((await saveWanOptions(d, { sizes: { '720p': true } })).ok, true);
  await queued(t, { size: '720p' });
  assert.equal((await saveWanOptions(d, { maxSeconds: 4 })).ok, true);
  r = await hub('POST', `${W}/render`, { token: t.client, body: await renderBody({ seconds: 5 }) });
  assert.equal(r.status, 400);
  assert.deepEqual([r.json().error, r.json().field], ['invalid', 'seconds']);
  const id = await queued(t);
  assert.equal(jobOf(id).seconds, 4, 'the default 5 s is cut to the most');
  assert.equal((await saveWanOptions(d, { enabled: false })).ok, true);
  r = await hub('POST', `${W}/render`, { token: t.client, body: await renderBody() });
  assert.equal(r.status, 503);
  assert.equal(r.json().error, 'tower_off');
  assert.equal(r.headers.Connection, undefined, 'refused before the picture is read, on a connection that stays open');
  // Off stops new renders only: the M5 still takes what was queued.
  assert.equal((await hub('POST', `${W}/worker/claim`, { token: t.worker, body: {} })).status, 200);
  // Bad options are refused with the box named; nothing changes.
  for (const [body, field] of [[{ enabled: 'yes' }, 'enabled'], [{ sizes: { '480p': false, '720p': false } }, 'sizes'], [{ sizes: { '720p': 1 } }, 'sizes'],
    [{ maxSeconds: 0 }, 'maxSeconds'], [{ maxSeconds: 11 }, 'maxSeconds'], [{ maxSeconds: 2.5 }, 'maxSeconds']]) {
    const x = await saveWanOptions(d, body);
    assert.deepEqual([x.ok, x.field], [false, field], JSON.stringify(body));
  }
  const o = (await saveWanOptions(d, {})).options;
  assert.deepEqual([o.enabled, o.sizes, o.maxSeconds], [false, { '480p': true, '720p': true }, 4]);
});

test('caps: 429 queue_full at 10 pending + running, storage_full at 150 MB kept, rate_limited at 30 renders an hour', async () => {
  const t = await tokens();
  seed(9, { status: 'pending' });
  seed(1, { status: 'running' });
  let r = await hub('POST', `${W}/render`, { token: t.client, body: await renderBody() });
  assert.equal(r.status, 429);
  assert.equal(r.json().error, 'queue_full');
  d.collection(WAN_JOBS).docs.clear();

  seed(1, { bytes: WAN_LIMITS.storage }); // a done clip that fills the hub
  r = await hub('POST', `${W}/render`, { token: t.client, body: await renderBody() });
  assert.equal(r.status, 429);
  assert.equal(r.json().error, 'storage_full');
  d.collection(WAN_JOBS).docs.clear();
  seed(1, { bytes: WAN_LIMITS.storage - 100 }); // room, but not for this picture
  r = await hub('POST', `${W}/render`, { token: t.client, body: await renderBody() });
  assert.equal(r.status, 429);
  assert.equal(r.json().error, 'storage_full');
  assert.equal(store.files.size, 0, 'nothing stored');
  d.collection(WAN_JOBS).docs.clear();

  const client = tokenHash(t.client).slice(0, 16);
  seed(29, { client, createdAt: new Date(T - 30 * 60e3) });
  await queued(t); // the 30th
  r = await hub('POST', `${W}/render`, { token: t.client, body: await renderBody() });
  assert.equal(r.status, 429);
  assert.equal(r.json().error, 'rate_limited');
  T += 31 * 60e3; // the 29 are over an hour old now
  await queued(t);

  // Try renders have a rate of their own: the client at its 30 does not stop the admin's Try …
  d.collection(WAN_JOBS).docs.clear();
  seed(30, { client, createdAt: new Date(T - 10 * 60e3) });
  assert.equal((await hub('POST', `${W}/render`, { token: t.client, body: await renderBody() })).json().error, 'rate_limited');
  const x = await queueWanTry(d);
  assert.equal(x.ok, true, JSON.stringify(x));
  assert.equal(jobOf(x.job_id).client, 'try');
  // … and 30 Tries this hour stop the Try, not the client.
  d.collection(WAN_JOBS).docs.clear();
  seed(30, { source: 'try', client: 'try', createdAt: new Date(T - 10 * 60e3) });
  assert.deepEqual(await queueWanTry(d), { ok: false, status: 429, reason: 'rate_limited', error: `At most ${WAN_LIMITS.perHour} renders an hour. Try again later.` });
  await queued(t);
  assert.equal(await d.collection(WAN_JOBS).countDocuments({ client }), 1, 'the client\'s own count');
});

// ---------------------------------------------------------------- the round trip

test('round trip: client POST → worker claim → progress → done → client GET done + url → GET the clip (and its byte ranges)', async () => {
  const t = await tokens();
  const id = await queued(t, { prompt: 'Waves roll in.', negative_prompt: 'blur', seconds: 6, aspect: '16:9', seed: 77 });
  assert.match(id, /^[a-f0-9]{32}$/);
  let r = await hub('GET', `${W}/render/${id}`, { token: t.client });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json(), { job_id: id, status: 'pending', created_at: new Date(START).toISOString() });

  T += 5e3;
  const job = await claimed(t, { worker: 'M5', info: { gpu: 'Apple M5 32 GB', comfy_version: '0.3.60', extra: 'dropped' } });
  assert.deepEqual(Object.keys(job).sort(), ['aspect', 'image', 'job_id', 'lease_id', 'negative_prompt', 'prompt', 'seconds', 'seed', 'size']);
  assert.deepEqual([job.job_id, job.prompt, job.negative_prompt, job.seconds, job.size, job.aspect, job.seed], [id, 'Waves roll in.', 'blur', 6, '480p', '16:9', 77]);
  assert.match(job.lease_id, /^[a-f0-9]{32}$/);
  assert.equal(jobOf(id).attempts, 1);
  assert.equal(jobOf(id).leaseUntil.getTime(), T + LEASE_MS, 'leased for 45 minutes');
  const seen = d.collection(SETTINGS_COLLECTION).docs.get('wan_worker_seen');
  assert.deepEqual([seen.at.getTime(), seen.worker, seen.info], [T, 'M5', { gpu: 'Apple M5 32 GB', comfy_version: '0.3.60' }], 'the claim is a heartbeat');
  assert.equal((await hub('POST', `${W}/worker/claim`, { token: t.worker, body: { worker: 'M5' } })).status, 204, 'nothing else to do');

  r = await hub('GET', `${W}/render/${id}`, { token: t.client });
  assert.deepEqual([r.json().status, r.json().progress, r.json().started_at], ['running', 0, new Date(T).toISOString()]);

  T += 10 * 60e3;
  r = await hub('POST', `${W}/worker/jobs/${id}/progress`, { token: t.worker, lease: job.lease_id, body: { progress: 0.4 } });
  assert.equal(r.status, 200);
  assert.equal(r.json().lease_until, new Date(T + LEASE_MS).toISOString(), 'the lease runs 45 min from now again');
  assert.equal(jobOf(id).leaseUntil.getTime(), T + LEASE_MS);
  for (const progress of [-0.1, 1.5, '0.5', null]) {
    const x = await hub('POST', `${W}/worker/jobs/${id}/progress`, { token: t.worker, lease: job.lease_id, body: { progress } });
    assert.deepEqual([x.status, x.json().field], [400, 'progress'], String(progress));
  }
  r = await hub('GET', `${W}/render/${id}`, { token: t.client });
  assert.equal(r.json().progress, 0.4);

  T += 60e3;
  const clip = mp4(4096);
  const inputKey = jobOf(id).input.key;
  assert.ok(store.files.has(inputKey));
  r = await done(t, job, clip);
  assert.equal(r.status, 200, r.body?.toString());
  assert.equal(store.files.has(inputKey), false, 'the picture is deleted once the clip is in');
  assert.equal(jobOf(id).input, null);
  assert.equal(jobOf(id).bytes, clip.length);

  r = await hub('GET', `${W}/render/${id}`, { token: t.client });
  assert.deepEqual(r.json(), {
    job_id: id, status: 'done', progress: 1, url: `https://${HOST}/30da/hub/wan/clips/${id}`,
    created_at: new Date(START).toISOString(), started_at: new Date(START + 5e3).toISOString(),
    finished_at: new Date(T).toISOString(), expires_at: new Date(T + CLIP_KEEP_MS).toISOString(),
  });

  r = await hub('GET', `${W}/clips/${id}`, { token: t.client });
  assert.equal(r.status, 200);
  assert.equal(r.headers['Content-Type'], 'video/mp4');
  assert.equal(r.headers['Content-Length'], clip.length);
  assert.equal(r.headers['Accept-Ranges'], 'bytes');
  assert.match(r.headers['Cache-Control'], /no-store/);
  assert.deepEqual(r.body, clip);
  r = await hub('GET', `${W}/clips/${id}`, { token: t.client, headers: { range: 'bytes=100-199' } });
  assert.equal(r.status, 206);
  assert.equal(r.headers['Content-Range'], `bytes 100-199/${clip.length}`);
  assert.deepEqual(r.body, clip.subarray(100, 200));
  r = await hub('GET', `${W}/clips/${id}`, { token: t.client, headers: { range: 'bytes=-10' } });
  assert.deepEqual(r.body, clip.subarray(-10));
  r = await hub('GET', `${W}/clips/${id}`, { token: t.client, headers: { range: `bytes=${clip.length}-` } });
  assert.equal(r.status, 416);
  // The worker token cannot fetch clips; a late call on the finished job is not_yours.
  assert.equal((await hub('GET', `${W}/clips/${id}`, { token: t.worker })).status, 401);
  assert.equal((await hub('POST', `${W}/worker/jobs/${id}/progress`, { token: t.worker, lease: job.lease_id, body: { progress: 1 } })).status, 409);
});

test('done: video/mp4 or image/webp only, the real thing, ≤ 40 MB; webp is kept as webp', async () => {
  const t = await tokens();
  const id = await queued(t);
  const job = await claimed(t);
  let r = await done(t, job, mp4(), 'application/octet-stream');
  assert.deepEqual([r.status, r.json().error, r.json().field], [400, 'invalid', 'content_type']);
  r = await done(t, job, Buffer.from('not a video at all, just text'), 'video/mp4');
  assert.deepEqual([r.status, r.json().field], [400, 'clip']);
  r = await done(t, job, Buffer.alloc(0), 'video/mp4');
  assert.deepEqual([r.status, r.json().field], [400, 'clip']);
  r = await hub('POST', `${W}/worker/jobs/${id}/done`, {
    token: t.worker, lease: job.lease_id, chunks: [Buffer.alloc(10)], headers: { 'content-type': 'video/mp4', 'content-length': String(WAN_LIMITS.clip + 1) },
  });
  assert.deepEqual([r.status, r.json().error], [413, 'too_large']);
  assert.equal(jobOf(id).status, 'running', 'still leased: the worker can send it again');
  const w = webp();
  r = await done(t, job, w, 'image/webp; charset=binary');
  assert.equal(r.status, 200, r.body?.toString());
  r = await hub('GET', `${W}/clips/${id}`, { token: t.client });
  assert.equal(r.headers['Content-Type'], 'image/webp');
  assert.deepEqual(r.body, w);
});

test('fail: { error } → failed with that short text (cut to 200), its picture deleted; final — never back in the queue', async () => {
  const t = await tokens();
  const id = await queued(t);
  const job = await claimed(t);
  let r = await hub('POST', `${W}/worker/jobs/${id}/fail`, { token: t.worker, lease: job.lease_id, body: {} });
  assert.deepEqual([r.status, r.json().field], [400, 'error']);
  const key = jobOf(id).input.key;
  r = await hub('POST', `${W}/worker/jobs/${id}/fail`, { token: t.worker, lease: job.lease_id, body: { error: `out of memory\n${'x'.repeat(300)}` } });
  assert.equal(r.status, 200);
  assert.equal(store.files.has(key), false);
  r = await hub('GET', `${W}/render/${id}`, { token: t.client });
  assert.equal(r.json().status, 'failed');
  assert.equal(r.json().error.length, 200);
  assert.match(r.json().error, /^out of memory x/);
  assert.equal('url' in r.json(), false);
  assert.equal((await hub('POST', `${W}/worker/claim`, { token: t.worker, body: {} })).status, 204);
  assert.equal((await hub('GET', `${W}/clips/${id}`, { token: t.client })).status, 404);
});

// ---------------------------------------------------------------- the lease

test('lease: runs out → back to pending once (a stale lease gets 409 not_yours), the second time failed "worker_lost"', async () => {
  const t = await tokens();
  const id = await queued(t);
  const first = await claimed(t);
  T += LEASE_MS - 1000;
  assert.equal((await hub('GET', `${W}/render/${id}`, { token: t.client })).json().status, 'running', 'not run out yet');
  T += 2000;
  // The client's GET sees it: back in the queue.
  let r = await hub('GET', `${W}/render/${id}`, { token: t.client });
  assert.equal(r.json().status, 'pending');
  assert.equal('started_at' in r.json(), false);
  assert.equal(jobOf(id).attempts, 1);
  // A stale lease from the first claim: 409 on every call.
  for (const what of ['progress', 'fail']) {
    const x = await hub('POST', `${W}/worker/jobs/${id}/${what}`, { token: t.worker, lease: first.lease_id, body: { progress: 0.5, error: 'x' } });
    assert.deepEqual([x.status, x.json().error], [409, 'not_yours'], what);
  }
  const second = await claimed(t, { worker: 'M5-b' });
  assert.notEqual(second.lease_id, first.lease_id);
  assert.equal(jobOf(id).attempts, 2);
  r = await done(t, first);
  assert.deepEqual([r.status, r.json().error], [409, 'not_yours'], 'the old lease cannot finish it');
  assert.equal([...store.files.keys()].some((k) => k.includes('.clip.')), false, 'nothing kept from it');
  for (const lease of [undefined, '', 'f'.repeat(32)]) {
    const x = await hub('POST', `${W}/worker/jobs/${id}/progress`, { token: t.worker, lease, body: { progress: 0.1 } });
    assert.equal(x.status, 409, String(lease));
  }
  // The second lease runs out too: the next claim finds it failed.
  T += LEASE_MS + 1000;
  const key = jobOf(id).input.key;
  assert.equal((await hub('POST', `${W}/worker/claim`, { token: t.worker, body: {} })).status, 204);
  r = await hub('GET', `${W}/render/${id}`, { token: t.client });
  assert.deepEqual([r.json().status, r.json().error], ['failed', 'worker_lost']);
  assert.equal(store.files.has(key), false, 'its picture is deleted');
  assert.equal(jobOf(id).bytes, 0);
  // An unknown job is a 404, not a 409.
  assert.equal((await hub('POST', `${W}/worker/jobs/${'b'.repeat(32)}/progress`, { token: t.worker, lease: 'x', body: { progress: 0 } })).status, 404);
});

test('lease: a worker that reports progress in time keeps its job; the oldest pending job goes first', async () => {
  const t = await tokens();
  const a = await queued(t);
  T += 1000;
  const b = await queued(t);
  const job = await claimed(t);
  assert.equal(job.job_id, a, 'oldest first');
  for (let i = 0; i < 3; i += 1) {
    T += LEASE_MS - 60e3;
    const r = await hub('POST', `${W}/worker/jobs/${a}/progress`, { token: t.worker, lease: job.lease_id, body: { progress: 0.2 * (i + 1) } });
    assert.equal(r.status, 200);
    assert.equal((await hub('GET', `${W}/render/${a}`, { token: t.client })).json().status, 'running');
  }
  assert.equal(jobOf(a).attempts, 1);
  assert.equal((await claimed(t)).job_id, b);
});

// ---------------------------------------------------------------- the sweep

test('sweep: a clip goes 48 h after done (410 expired; the record stays done), records go after 30 days; at most once a minute', async () => {
  const t = await tokens();
  const id = await queued(t);
  const job = await claimed(t);
  assert.equal((await done(t, job)).status, 200);
  const key = jobOf(id).clip.key;
  T += CLIP_KEEP_MS - 60e3;
  assert.equal((await hub('GET', `${W}/clips/${id}`, { token: t.client })).status, 200);
  T += 2 * 60e3;
  // Any request runs the sweep (here the M5's idle claim).
  assert.equal((await hub('POST', `${W}/worker/claim`, { token: t.worker, body: {} })).status, 204);
  assert.equal(store.files.has(key), false, 'the clip is deleted');
  assert.deepEqual([jobOf(id).clip, jobOf(id).bytes], [null, 0]);
  let r = await hub('GET', `${W}/clips/${id}`, { token: t.client });
  assert.deepEqual([r.status, r.json().error], [410, 'expired']);
  r = await hub('GET', `${W}/render/${id}`, { token: t.client });
  assert.equal(r.json().status, 'done');
  // Once a minute: a sweep runs 10 s before the second clip expires; 30 s later (expired, but within the minute) it is
  // still there; past the minute the next request sweeps it.
  const id2 = await queued(t);
  const job2 = await claimed(t);
  await done(t, job2);
  const key2 = jobOf(id2).clip.key;
  T = jobOf(id2).expiresAt.getTime() - 10e3;
  await hub('POST', `${W}/worker/claim`, { token: t.worker, body: {} }); // this request sweeps (nothing due yet)
  assert.ok(store.files.has(key2));
  T += 30e3;
  await hub('POST', `${W}/worker/claim`, { token: t.worker, body: {} });
  assert.ok(store.files.has(key2), 'expired, but the last sweep was 30 s ago: not swept again yet');
  assert.notEqual(jobOf(id2).clip, null);
  assert.equal((await hub('GET', `${W}/clips/${id2}`, { token: t.client })).status, 200);
  T += 31e3;
  await hub('POST', `${W}/worker/claim`, { token: t.worker, body: {} });
  assert.equal(store.files.has(key2), false, '61 s after the last sweep: swept');
  assert.equal(jobOf(id2).clip, null);
  // The record itself goes 30 days after it finished.
  T += 30 * 24 * 3600e3;
  const r2 = await sweepWan(d, store, T);
  assert.equal(r2.jobs, 2);
  assert.equal(jobs().length, 0);
});

test('storage: a clip that would take the hub over 150 MB fails its job "storage_full" (the worker gets 200)', async () => {
  const t = await tokens();
  const id = await queued(t);
  const job = await claimed(t);
  seed(1, { bytes: WAN_LIMITS.storage - 1000 });
  const r = await done(t, job, mp4(4096));
  assert.equal(r.status, 200);
  assert.deepEqual([r.json().status, r.json().error], ['failed', 'storage_full']);
  const x = await hub('GET', `${W}/render/${id}`, { token: t.client });
  assert.deepEqual([x.json().status, x.json().error], ['failed', 'storage_full']);
  assert.equal(store.files.size, 0, 'neither the clip nor the picture is kept');
});

test('routes: unknown job 404, unknown path 404, wrong method 405, /30da/hub itself 404; JSON errors like the app\'s', async () => {
  const t = await tokens();
  let r = await hub('GET', `${W}/render/${'c'.repeat(32)}`, { token: t.client });
  assert.deepEqual([r.status, r.json().error], [404, 'not_found']);
  assert.match(r.headers['Content-Type'], /^application\/json/);
  assert.equal((await hub('GET', `${W}/render/not-an-id`, { token: t.client })).status, 404);
  assert.equal((await hub('GET', `${W}/nope`, { token: t.client })).status, 404);
  assert.equal((await hub('GET', '/30da/hub', {})).status, 404);
  assert.equal((await hub('GET', '/30da/hub/other', {})).status, 404);
  r = await hub('GET', `${W}/render`, { token: t.client });
  assert.deepEqual([r.status, r.json().error], [405, 'method_not_allowed']);
  // A job still waiting has no clip yet.
  const id = await queued(t);
  r = await hub('GET', `${W}/clips/${id}`, { token: t.client });
  assert.deepEqual([r.status, r.json().error], [404, 'not_found']);
  // No cookie is ever set, no CORS is offered.
  assert.equal(Object.keys(r.headers).some((k) => /set-cookie|access-control/i.test(k)), false);
});

// ---------------------------------------------------------------- the admin's tower 11

const ADMIN = 'a'.repeat(64);
const JSON_HEADERS = { 'content-type': 'application/json', origin: `https://${HOST}`, 'sec-fetch-site': 'same-origin' };
async function admin(method, path, { headers = {}, body, cookie = ADMIN } = {}) {
  const req = fakeReq(method, path, {
    headers: { ...(cookie ? { cookie: `thirtyda_admin=${cookie}` } : {}), ...headers },
    chunks: body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))],
  });
  const res = fakeRes();
  await handleThirtyDaAdmin(req, res, new URL(path, `https://${HOST}`));
  return res;
}
async function signedInAdmin() {
  setAdminTestHooks({ db: d });
  await d.collection('thirtyda_admin_sessions').insertOne({ _id: ADMIN, created: new Date(), expires: new Date(Date.now() + 3600e3) });
}
const C = '/30da/admin/api/connections';

test('admin: New token shows the token ONCE; afterwards only its last 4 — never the token or its hash in the page\'s data or the audit', async () => {
  await signedInAdmin();
  let r = await admin('GET', C);
  assert.equal(r.status, 200);
  let wan = r.json().wan;
  assert.equal(wan.status, 'not_set');
  assert.deepEqual(wan.tokens, {
    client: { set: false, last4: null, madeAt: null, madeBy: null }, worker: { set: false, last4: null, madeAt: null, madeBy: null },
  });
  assert.equal(wan.endpoint, `https://${HOST}/30da/hub/wan`);
  assert.deepEqual([wan.options.enabled, wan.options.sizes, wan.options.maxSeconds], [false, { '480p': true, '720p': false }, 10], 'off until a client token exists');

  r = await admin('POST', `${C}/wan/tokens/client`, { headers: JSON_HEADERS, body: {} });
  assert.equal(r.status, 200);
  const client = r.json().token;
  assert.match(client, /^wanc_/);
  assert.equal(r.json().kind, 'client');
  assert.equal(r.json().view.wan.tokens.client.last4, client.slice(-4));
  assert.equal(JSON.stringify(r.json().view).includes(client), false, 'the page\'s data in that answer has no token either');
  r = await admin('POST', `${C}/wan/tokens/worker`, { headers: JSON_HEADERS, body: {} });
  const worker = r.json().token;
  assert.match(worker, /^wanw_/);

  r = await admin('GET', C);
  wan = r.json().wan;
  assert.equal(wan.status, 'waiting', 'both tokens, on (by default once a client token exists), the M5 not seen yet');
  assert.equal(wan.options.enabled, true);
  const hashes = d.docs(SETTINGS_COLLECTION).filter((x) => x.hash).map((x) => x.hash);
  assert.equal(hashes.length, 2);
  const everything = JSON.stringify([r.body.toString(), d.docs('thirtyda_audit')]);
  for (const secret of [client, worker, client.slice(5, -4), worker.slice(5, -4), ...hashes]) {
    assert.equal(everything.includes(secret), false, 'no token, no hash in the page\'s data or the audit');
  }
  assert.equal(r.body.toString().includes('"hash"'), false);
  const made = d.docs('thirtyda_audit').filter((a) => a.action === 'wan_token_new');
  assert.deepEqual(made.map((a) => [a.kind, a.last4]), [['client', client.slice(-4)], ['worker', worker.slice(-4)]]);

  // The tokens work on the hub.
  assert.equal((await hub('POST', `${W}/worker/claim`, { token: worker, body: { worker: 'M5' } })).status, 204);
  wan = (await admin('GET', C)).json().wan;
  assert.equal(wan.status, 'live');
  assert.deepEqual([wan.worker.name, wan.worker.seenAgoS], ['M5', 0]);
  T += 3 * 60e3;
  assert.equal((await admin('GET', C)).json().wan.status, 'waiting', 'not seen for 2 minutes');
  assert.equal((await admin('GET', C)).json().wan.worker.seenAgoS, 180);

  // New token again: the old one stops. Revoke: gone.
  r = await admin('POST', `${C}/wan/tokens/client`, { headers: JSON_HEADERS, body: {} });
  assert.notEqual(r.json().token, client);
  assert.equal((await hub('GET', `${W}/render/${'a'.repeat(32)}`, { token: client })).status, 401);
  r = await admin('DELETE', `${C}/wan/tokens/worker`, { headers: JSON_HEADERS, body: {} });
  assert.equal(r.status, 200);
  assert.equal(r.json().wan.tokens.worker.set, false);
  assert.equal(r.json().wan.status, 'not_set');
  assert.equal((await hub('POST', `${W}/worker/claim`, { token: worker, body: {} })).status, 401);
  assert.equal(d.docs('thirtyda_audit').filter((a) => a.action === 'wan_token_revoke').length, 1);
});

test('admin: the same guards as the other Code page writes — signed in, same origin, JSON; unknown kinds 404', async () => {
  await signedInAdmin();
  let r = await admin('POST', `${C}/wan/tokens/client`, { headers: JSON_HEADERS, body: {}, cookie: null });
  assert.equal(r.status, 401);
  r = await admin('POST', `${C}/wan/tokens/client`, { headers: { ...JSON_HEADERS, origin: 'https://evil.example' }, body: {} });
  assert.equal(r.status, 403);
  r = await admin('POST', `${C}/wan/tokens/client`, { headers: { ...JSON_HEADERS, 'sec-fetch-site': 'cross-site' }, body: {} });
  assert.equal(r.status, 403);
  r = await admin('POST', `${C}/wan/tokens/client`, { headers: { ...JSON_HEADERS, 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(r.status, 415);
  assert.equal((await admin('POST', `${C}/wan/tokens/admin`, { headers: JSON_HEADERS, body: {} })).status, 404);
  assert.equal((await admin('GET', `${C}/wan/tokens/client`)).status, 404);
  assert.equal(d.docs(SETTINGS_COLLECTION).length, 0, 'nothing made');
  assert.equal((await admin('GET', C, { cookie: null })).status, 401);
});

test('admin: options (On / Off, sizes, most seconds) and the status pill; bad boxes → 422 with the box named', async () => {
  await signedInAdmin();
  const t = await tokens();
  let r = await admin('PUT', `${C}/wan/options`, { headers: JSON_HEADERS, body: { enabled: false } });
  assert.equal(r.status, 200);
  assert.equal(r.json().wan.status, 'off');
  assert.equal(r.json().wan.options.enabledSaved, true);
  assert.equal((await hub('POST', `${W}/render`, { token: t.client, body: await renderBody() })).status, 503);
  r = await admin('PUT', `${C}/wan/options`, { headers: JSON_HEADERS, body: { enabled: true, sizes: { '480p': true, '720p': true }, maxSeconds: 6 } });
  assert.deepEqual([r.json().wan.options.sizes['720p'], r.json().wan.options.maxSeconds, r.json().wan.status], [true, 6, 'waiting']);
  r = await admin('PUT', `${C}/wan/options`, { headers: JSON_HEADERS, body: { sizes: { '480p': false, '720p': false } } });
  assert.deepEqual([r.status, r.json().field], [422, 'sizes']);
  r = await admin('PUT', `${C}/wan/options`, { headers: JSON_HEADERS, body: { maxSeconds: 30 } });
  assert.deepEqual([r.status, r.json().field], [422, 'maxSeconds']);
  r = await admin('PUT', `${C}/wan/options`, { headers: JSON_HEADERS, body: 'nope' });
  assert.equal(r.status, 400);
  const saved = d.docs('thirtyda_audit').filter((a) => a.action === 'wan_options');
  assert.equal(saved.length, 2);
  assert.deepEqual(saved[1].sizes, { '480p': true, '720p': true });
  assert.equal(wanStatus({ clientSet: true, workerSet: true, enabled: true, seenAt: new Date(T - 119e3), now: T }), 'live');
  assert.equal(wanStatus({ clientSet: true, workerSet: true, enabled: true, seenAt: new Date(T - 121e3), now: T }), 'waiting');
  assert.equal(wanStatus({ clientSet: true, workerSet: false, enabled: true, seenAt: new Date(T), now: T }), 'not_set');
  assert.equal(wanStatus({ clientSet: true, workerSet: true, enabled: false, seenAt: new Date(T), now: T }), 'off');
});

test('admin: Try queues the home picture (source "try", the same caps), the M5 renders it, only the admin plays it back', async () => {
  await signedInAdmin();
  const t = await tokens();
  let r = await admin('POST', `${C}/wan/try`, { headers: JSON_HEADERS, body: {} });
  assert.equal(r.status, 200, r.body?.toString());
  const id = r.json().job_id;
  let wan = r.json().view.wan;
  assert.deepEqual([wan.lastTry.id, wan.lastTry.status, wan.lastTry.source, wan.lastTry.size, wan.lastTry.seconds], [id, 'pending', 'try', '480p', 3]);
  assert.equal(wan.queue.pending, 1);
  assert.equal((await hub('GET', `${W}/render/${id}`, { token: t.client })).status, 404, 'a Try is not the client\'s');
  const job = await claimed(t);
  assert.equal(job.job_id, id);
  const pic = await sharp(Buffer.from(job.image, 'base64')).metadata();
  assert.equal(pic.format, 'jpeg');
  assert.ok(Math.max(pic.width, pic.height) <= 1280);
  const clip = mp4(1000);
  assert.equal((await done(t, job, clip)).status, 200);
  wan = (await admin('GET', C)).json().wan;
  assert.equal(wan.lastTry.status, 'done');
  assert.equal(wan.lastTry.clipUrl, `${C}/wan/clips/${id}`);
  // The jobs list: no prompt, no picture, no lease, no client key.
  const listed = JSON.stringify(wan.jobs);
  assert.equal(/prompt|image|lease|client"|input/.test(listed), false, listed);
  assert.deepEqual(Object.keys(wan.jobs[0]).sort(), ['aspect', 'attempts', 'clipType', 'clipUrl', 'createdAt', 'error', 'expiresAt', 'finishedAt', 'id', 'progress', 'seconds', 'size', 'source', 'startedAt', 'status']);
  r = await admin('GET', `${C}/wan/clips/${id}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers['Content-Type'], 'video/mp4');
  assert.deepEqual(r.body, clip);
  assert.match(r.headers['Content-Security-Policy'], /default-src 'self'/);
  r = await admin('GET', `${C}/wan/clips/${id}`, { headers: { range: 'bytes=0-9' } });
  assert.equal(r.status, 206);
  assert.equal((await admin('GET', `${C}/wan/clips/${id}`, { cookie: null })).status, 401, 'admin only');
  assert.equal((await hub('GET', `${W}/clips/${id}`, { token: t.client })).status, 404, 'not through the client route');
  // A client's clip is never the admin's to play.
  const cid = await queued(t);
  await done(t, await claimed(t));
  assert.equal((await admin('GET', `${C}/wan/clips/${cid}`)).status, 404);
  assert.equal(d.docs('thirtyda_audit').filter((a) => a.action === 'wan_try').length, 1);
  // The caps hold for Try too: off → refused with plain words.
  await saveWanOptions(d, { enabled: false });
  r = await admin('POST', `${C}/wan/try`, { headers: JSON_HEADERS, body: {} });
  assert.deepEqual([r.status, r.json().reason, r.json().ok], [503, 'tower_off', false]);
  await saveWanOptions(d, { enabled: true });
  seed(10, { status: 'pending', source: 'try', client: 'try' });
  r = await admin('POST', `${C}/wan/try`, { headers: JSON_HEADERS, body: {} });
  assert.deepEqual([r.status, r.json().reason], [429, 'queue_full']);
});

test('admin view: tokens, queue counts, the last 8 jobs; the wan block carries no token, hash or prompt', async () => {
  const t = await tokens();
  for (let i = 0; i < 10; i += 1) {
    T += 1000;
    await queued(t, { prompt: `SECRET-PROMPT-${i}` });
  }
  const job = await claimed(t, { worker: 'M5', info: { gpu: 'M5' } });
  await hub('POST', `${W}/worker/jobs/${job.job_id}/progress`, { token: t.worker, lease: job.lease_id, body: { progress: 0.5 } });
  // Clips kept: done jobs whose clip is still there (2), not the swept one (clip null).
  seed(2, { status: 'done', clip: { key: 'x', bytes: 1, type: 'video/mp4' }, createdAt: new Date(START) });
  seed(1, { status: 'done', clip: null, createdAt: new Date(START) });
  const wan = await wanAdminView(d, { headers: { host: HOST } });
  assert.deepEqual([wan.queue.pending, wan.queue.running, wan.queue.max, wan.queue.storageMax], [9, 1, 10, WAN_LIMITS.storage]);
  assert.equal(wan.queue.clips, 2);
  assert.ok(wan.queue.storedBytes > 0);
  assert.equal(wan.jobs.length, 8, 'the last 8');
  assert.equal(wan.jobs[0].createdAt, new Date(T).toISOString(), 'newest first');
  assert.equal(wan.lastTry, null);
  assert.equal(wan.status, 'live');
  const text = JSON.stringify(wan);
  for (const secret of [t.client, t.worker, tokenHash(t.client), tokenHash(t.worker), tokenHash(t.client).slice(0, 16), 'SECRET-PROMPT', job.lease_id]) {
    assert.equal(text.includes(secret), false, secret.slice(0, 12));
  }
  assert.equal((await tokenStatus(d, 'wan_client')).last4, t.client.slice(-4));
});

// ---------------------------------------------------------------- the review's fixes (2026-10-14)

test('clip url: made from the CLIENT\'s own request when it reads the job — a worker\'s Host / X-Forwarded-Host never picks where the client token goes', async () => {
  const t = await tokens();
  const id = await queued(t);
  const job = await claimed(t);
  // A worker token (the M5's config) names another host on its /done.
  const r = await hub('POST', `${W}/worker/jobs/${id}/done`, {
    token: t.worker, lease: job.lease_id, body: mp4(), headers: { 'content-type': 'video/mp4', host: '0jldbsxh.up.railway.app', 'x-forwarded-host': 'attacker.example' },
  });
  assert.equal(r.status, 200);
  assert.equal('url' in jobOf(id), false, 'no url kept on the job');
  let s = await hub('GET', `${W}/render/${id}`, { token: t.client });
  assert.equal(s.json().url, `https://${HOST}/30da/hub/wan/clips/${id}`, 'the host the client itself asked');
  assert.equal(s.body.toString().includes('attacker'), false);
  assert.equal(s.body.toString().includes('railway'), false);
  s = await hub('GET', `${W}/render/${id}`, { token: t.client, headers: { host: 'localhost:8080' } });
  assert.equal(s.json().url, `http://localhost:8080/30da/hub/wan/clips/${id}`, 'always the client\'s own');
});

/** Just enough of a Mongo Db for the driver's GridFSBucket: a chunks insert can fail; {files_id, n} is unique, as in Atlas. */
function gridDb({ failChunkAt = 0 } = {}) {
  const cols = new Map();
  let chunkInserts = 0;
  const same = (q) => (x) => Object.entries(q).every(([k, v]) => String(x[k]) === String(v));
  const collection = (name) => {
    if (!cols.has(name)) {
      const docs = [];
      cols.set(name, {
        docs,
        failFindOne: null,
        async findOne(q) {
          if (this.failFindOne) throw this.failFindOne;
          return docs.find(same(q)) ?? null;
        },
        listIndexes() { return { toArray: async () => [] }; },
        async createIndex() { return 'ok'; },
        async insertOne(doc) {
          if (name.endsWith('.chunks')) {
            chunkInserts += 1;
            if (chunkInserts === failChunkAt) {
              await new Promise((resolve) => setImmediate(resolve));
              throw Object.assign(new Error('you are over your space quota, using 513 MB of 512 MB'), { code: 8000 });
            }
            if (docs.some((x) => x.files_id === doc.files_id && x.n === doc.n)) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
          }
          docs.push(doc);
          return { insertedId: doc._id };
        },
        async deleteOne(q) {
          const i = docs.findIndex(same(q));
          if (i >= 0) docs.splice(i, 1);
          return { deletedCount: i >= 0 ? 1 : 0 };
        },
        async deleteMany(q) {
          const n = docs.length;
          for (let i = docs.length - 1; i >= 0; i -= 1) if (same(q)(docs[i])) docs.splice(i, 1);
          return { deletedCount: n - docs.length };
        },
        find(q) {
          const rows = docs.filter(same(q)).sort((a, b) => a.n - b.n);
          let i = 0;
          const cursor = {
            sort: () => cursor, withReadPreference: () => cursor, limit(n) { if (n > 0) rows.length = Math.min(rows.length, n); return cursor; }, // 0 = no limit, as in Mongo
            async next() { return rows[i++] ?? null; }, async close() {},
          };
          return cursor;
        },
      });
    }
    return cols.get(name);
  };
  return { collection, chunks: () => collection(`${WAN_BUCKET}.chunks`), files: () => collection(`${WAN_BUCKET}.files`) };
}

test('GridFS store: an upload that fails half way deletes the chunks it wrote, and the same key then uploads cleanly (no E11000)', async () => {
  const g = gridDb({ failChunkAt: 3 });
  const grid = gridStore(async () => g);
  const key = `${'a'.repeat(32)}-0123abcd-89abcdef.clip.mp4`;
  const clip = mp4(1024 * 1024); // 5 chunks of 255 KB
  await assert.rejects(grid.put(key, clip), /space quota/);
  assert.equal(g.chunks().docs.length, 0, 'no orphan chunks left (nothing would ever count or sweep them)');
  assert.equal(g.files().docs.length, 0);
  await grid.put(key, clip);
  assert.equal(g.chunks().docs.length, 5);
  assert.ok((await grid.get(key)).equals(clip), 'reads back whole');
  await grid.remove(key);
  assert.equal(g.chunks().docs.length, 0);
});

test('GridFS store: get → null only when the file is gone; a read that FAILS is thrown (never taken for "gone")', async () => {
  const g = gridDb();
  const grid = gridStore(async () => g);
  const key = `${'b'.repeat(32)}.in.jpg`;
  assert.equal(await grid.get(key), null, 'no such file');
  await grid.put(key, Buffer.from('a picture'));
  assert.deepEqual(await grid.get(key), Buffer.from('a picture'));
  g.files().failFindOne = Object.assign(new Error('connection 3 to atlas reset'), { name: 'MongoNetworkError' });
  await assert.rejects(grid.get(key), /reset/);
  g.files().failFindOne = null;
  // Its chunks broken (the first of two missing): gone for good → null.
  const big = `${'c'.repeat(32)}.in.jpg`;
  await grid.put(big, crypto.randomBytes(300 * 1024));
  g.chunks().docs.splice(g.chunks().docs.findIndex((c) => c.files_id === big && c.n === 0), 1);
  assert.equal(await grid.get(big), null);
});

test('claim: a picture that could not be READ puts the job back as it was (500, the M5 asks again) — never "input_lost"; a gone one fails and what is left of it is removed', async () => {
  const t = await tokens();
  const id = await queued(t);
  const key = jobOf(id).input.key;
  const get = store.get;
  store.get = async () => { throw Object.assign(new Error('connection reset'), { name: 'MongoNetworkError' }); };
  let r = await hub('POST', `${W}/worker/claim`, { token: t.worker, body: { worker: 'M5' } });
  assert.equal(r.status, 500);
  assert.deepEqual([jobOf(id).status, jobOf(id).attempts, jobOf(id).leaseId, jobOf(id).error, jobOf(id).startedAt], ['pending', 0, null, null, null]);
  assert.ok(store.files.has(key), 'its picture is still there');
  store.get = get;
  const job = await claimed(t);
  assert.deepEqual([job.job_id, jobOf(id).attempts], [id, 1], 'the next claim gets it, as its first attempt');
  // Gone (here: broken, the store answers null although bytes are left): failed "input_lost", its leftovers removed.
  const id2 = await queued(t);
  const key2 = jobOf(id2).input.key;
  store.get = async (k) => (k === key2 ? null : get(k));
  r = await hub('POST', `${W}/worker/claim`, { token: t.worker, body: { worker: 'M5' } });
  store.get = get;
  assert.equal(r.status, 204);
  assert.deepEqual([jobOf(id2).status, jobOf(id2).error, jobOf(id2).bytes], ['failed', 'input_lost', 0]);
  assert.equal(store.files.has(key2), false, 'nothing left uncounted in the store');
});

test('done: an upload that fails half way leaves no clip behind and the retry on the same lease goes through; an update that fails drops the clip', async () => {
  const t = await tokens();
  const id = await queued(t);
  const job = await claimed(t);
  const put = store.put;
  store.put = async (key, buf) => { await put(key, buf.subarray(0, 100)); throw new Error('over your space quota'); };
  let r = await done(t, job);
  assert.equal(r.status, 500);
  assert.equal([...store.files.keys()].some((k) => k.includes('.clip.')), false, 'the half clip is deleted');
  assert.equal(jobOf(id).status, 'running', 'still leased: the M5 sends it again');
  store.put = put;
  const clip = mp4();
  r = await done(t, job, clip);
  assert.equal(r.status, 200, r.body?.toString());
  assert.deepEqual((await hub('GET', `${W}/clips/${id}`, { token: t.client })).body, clip);
  // The upload went in, the job's update failed (Mongo refusing writes): the clip goes too.
  const id2 = await queued(t);
  const job2 = await claimed(t);
  const col = d.collection(WAN_JOBS);
  const updateOne = col.updateOne;
  col.updateOne = async () => { throw new Error('over your space quota'); };
  r = await done(t, job2);
  col.updateOne = updateOne;
  assert.equal(r.status, 500);
  assert.deepEqual([...store.files.keys()].filter((k) => k.startsWith(id2) && k.includes('.clip.')), []);
  // The update landed but its answer was lost: the clip the job points to stays, the job is done as usual.
  const input2 = jobOf(id2).input.key;
  col.updateOne = async (...a) => { await updateOne(...a); throw new Error('socket closed'); };
  r = await done(t, job2);
  col.updateOne = updateOne;
  assert.deepEqual([r.status, r.json().status], [200, 'done']);
  assert.ok(store.files.has(jobOf(id2).clip.key), 'kept: the job points to it');
  assert.equal(store.files.has(input2), false, 'its picture deleted, as on any done');
});

test('done: two /done on the same lease at once — one wins, the other gets 409 and removes only its OWN upload (the winner\'s clip plays)', async () => {
  const t = await tokens();
  const id = await queued(t);
  const job = await claimed(t);
  const put = store.put;
  const parked = [];
  // Both uploads are in before either job update runs.
  store.put = async (key, buf) => {
    await put(key, buf);
    await new Promise((resolve) => { parked.push(resolve); if (parked.length === 2) parked.forEach((go) => go()); });
  };
  const a = mp4(3000);
  const b = mp4(3000);
  const rs = await Promise.all([done(t, job, a), done(t, job, b)]);
  store.put = put;
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
  const won = rs[0].status === 200 ? a : b;
  const clips = [...store.files.keys()].filter((k) => k.includes('.clip.'));
  assert.deepEqual(clips, [jobOf(id).clip.key], 'one clip kept: the one the job points to');
  const r = await hub('GET', `${W}/clips/${id}`, { token: t.client });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, won);
});

test(`render: at most ${RENDERS_AT_ONCE} renders read / decoded at once — the next is a 429 rate_limited before a byte of it is read; every place is given back`, async () => {
  const t = await tokens();
  const body = Buffer.from(JSON.stringify(await renderBody()));
  const settle = async () => { for (let i = 0; i < 30; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
  const send = (chunks) => hub('POST', `${W}/render`, { token: t.client, chunks, headers: { 'content-type': 'application/json' } });
  async function holdThree() {
    let open;
    const gate = new Promise((resolve) => { open = resolve; });
    async function* held() { await gate; yield body; }
    const slow = Array.from({ length: RENDERS_AT_ONCE }, () => send(held()));
    await settle();
    // One more while those three are still uploading: refused at once, its body not read before the answer.
    let pulled = 0;
    async function* counted() { pulled += 1; yield body; }
    const req = fakeReq('POST', `${W}/render`, { headers: { authorization: `Bearer ${t.client}`, 'content-type': 'application/json' }, chunks: counted() });
    const res = fakeRes();
    let pulledAtAnswer = null;
    const writeHead = res.writeHead;
    res.writeHead = (s, h) => { pulledAtAnswer = pulled; return writeHead(s, h); };
    await handleThirtyDaHub(req, res, new URL(`${W}/render`, `https://${HOST}`));
    assert.deepEqual([res.status, res.json().error, pulledAtAnswer], [429, 'rate_limited', 0]);
    assert.equal(res.headers.Connection, undefined, 'kept open: its body is read to the end and dropped');
    open();
    for (const r of await Promise.all(slow)) assert.equal(r.status, 202, r.body?.toString());
  }
  await holdThree();
  assert.equal(jobs().length, RENDERS_AT_ONCE);
  // Refused renders give their place back too (a leak would make the next three a 429).
  for (const over of [{ prompt: '' }, { seconds: 99 }, { image: 'nope' }]) {
    assert.equal((await hub('POST', `${W}/render`, { token: t.client, body: await renderBody(over) })).status, 400);
  }
  await holdThree();
  assert.equal(jobs().length, 2 * RENDERS_AT_ONCE);
});

test('render: the hourly cap is checked again when the job is written (a render that passed the gate while uploading is refused once the 30th went in), and a picture upload that fails leaves nothing', async () => {
  const t = await tokens();
  const client = tokenHash(t.client).slice(0, 16);
  seed(29, { client, createdAt: new Date(T - 10 * 60e3) });
  const body = Buffer.from(JSON.stringify(await renderBody()));
  let open;
  const gate = new Promise((resolve) => { open = resolve; });
  async function* held() { await gate; yield body; }
  const slow = hub('POST', `${W}/render`, { token: t.client, chunks: held(), headers: { 'content-type': 'application/json' } });
  for (let i = 0; i < 30; i += 1) await new Promise((resolve) => setImmediate(resolve)); // past the gate (29 this hour), now uploading
  await queued(t); // the 30th
  open();
  const r = await slow;
  assert.deepEqual([r.status, r.json().error], [429, 'rate_limited']);
  assert.equal(await d.collection(WAN_JOBS).countDocuments({ client }), 30);
  // The picture's upload fails half way: the job is not queued and nothing is left in the store.
  d.collection(WAN_JOBS).docs.clear();
  store.files.clear();
  const put = store.put;
  store.put = async (key, buf) => { await put(key, buf.subarray(0, 100)); throw new Error('over your space quota'); };
  const x = await hub('POST', `${W}/render`, { token: t.client, body: await renderBody() });
  store.put = put;
  assert.equal(x.status, 500);
  assert.deepEqual([jobs().length, store.files.size], [0, 0]);
});

test('refusals reach the client over a real socket — 503 tower_off on a 12 MB render, 409 not_yours on an 8 MB clip — not a reset', async () => {
  const t = await tokens();
  const id = await queued(t);
  await claimed(t);
  await saveWanOptions(d, { enabled: false });
  const server = http.createServer((req, res) => handleThirtyDaHub(req, res, new URL(req.url, `http://${req.headers.host}`)));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}${W}`;
  try {
    const picture = Buffer.from(JSON.stringify({ prompt: 'x', image: crypto.randomBytes(9 * 1024 * 1024).toString('base64') }));
    assert.ok(picture.length > 12 * 1024 * 1024 && picture.length < WAN_LIMITS.renderBody);
    const clip = mp4(8 * 1024 * 1024);
    for (let i = 0; i < 4; i += 1) {
      let r = await fetch(`${base}/render`, { method: 'POST', headers: { authorization: `Bearer ${t.client}`, 'content-type': 'application/json' }, body: picture });
      assert.deepEqual([r.status, (await r.json()).error], [503, 'tower_off']);
      r = await fetch(`${base}/worker/jobs/${id}/done`, {
        method: 'POST', headers: { authorization: `Bearer ${t.worker}`, 'x-wan-lease': 'f'.repeat(32), 'content-type': 'video/mp4' }, body: clip,
      });
      assert.deepEqual([r.status, (await r.json()).error], [409, 'not_yours']);
      r = await fetch(`${base}/render`, { method: 'POST', headers: { authorization: 'Bearer nope', 'content-type': 'application/json' }, body: picture });
      assert.equal(r.status, 401);
      await r.arrayBuffer();
    }
  } finally {
    server.close();
    server.closeAllConnections();
  }
});

test('heartbeat: progress, done and fail count too — the tower stays Live through a long render (a busy M5 never claims)', async () => {
  const t = await tokens();
  const id = await queued(t);
  const job = await claimed(t, { worker: 'M5', info: { gpu: 'Apple M5 32 GB' } });
  const view = () => wanAdminView(d, { headers: { host: HOST } });
  for (let i = 1; i <= 3; i += 1) {
    T += 5 * 60e3;
    assert.equal((await hub('POST', `${W}/worker/jobs/${id}/progress`, { token: t.worker, lease: job.lease_id, body: { progress: i / 4 } })).status, 200);
    const w = await view();
    assert.equal(w.status, 'live', `${i * 5} min into the render`);
    assert.deepEqual([w.worker.seenAgoS, w.worker.name, w.worker.info], [0, 'M5', { gpu: 'Apple M5 32 GB' }], 'the claim\'s info is kept');
  }
  T += 3 * 60e3;
  assert.equal((await view()).status, 'waiting', 'silent for 3 minutes');
  assert.equal((await done(t, job)).status, 200);
  assert.equal((await view()).status, 'live', 'done is a heartbeat');
  const id2 = await queued(t);
  const job2 = await claimed(t);
  T += 3 * 60e3;
  assert.equal((await hub('POST', `${W}/worker/jobs/${id2}/fail`, { token: t.worker, lease: job2.lease_id, body: { error: 'oom' } })).status, 200);
  assert.equal((await view()).status, 'live', 'fail is a heartbeat');
  // A stale lease is not.
  T += 3 * 60e3;
  assert.equal((await hub('POST', `${W}/worker/jobs/${id2}/progress`, { token: t.worker, lease: job2.lease_id, body: { progress: 0.1 } })).status, 409);
  assert.equal((await view()).status, 'waiting');
});

test('lease: a progress that lands between the lapsed-lease read and its write keeps the job (the write re-checks leaseUntil) — both the "back once" and the "worker_lost" write', async () => {
  const t = await tokens();
  const id = await queued(t);
  const job = await claimed(t);
  const col = d.collection(WAN_JOBS);
  const find = col.find;
  for (const attempts of [1, 2]) {
    col.docs.get(id).attempts = attempts;
    T += LEASE_MS + 1000; // run out
    col.find = (q) => {
      const cursor = find(q);
      // The M5, back from sleep, reports progress right after requeueLapsed read the lapsed lease.
      if (q.status === 'running' && q.leaseUntil) col.docs.get(id).leaseUntil = new Date(T + LEASE_MS);
      return cursor;
    };
    const r = await hub('GET', `${W}/render/${id}`, { token: t.client });
    col.find = find;
    assert.equal(r.json().status, 'running', `attempt ${attempts}`);
    assert.deepEqual([jobOf(id).leaseId, jobOf(id).attempts], [job.lease_id, attempts]);
    assert.ok(store.files.has(jobOf(id).input.key), 'its picture kept');
    assert.equal((await hub('POST', `${W}/worker/jobs/${id}/progress`, { token: t.worker, lease: job.lease_id, body: { progress: 0.5 } })).status, 200, 'the worker keeps its job');
  }
});

test('admin: a Wan write that fails (the M0 over quota) never takes the Code page down; a Wan block that cannot be read leaves the other ten', async () => {
  await signedInAdmin();
  const t = await tokens();
  await queued(t);
  await claimed(t);
  T += LEASE_MS + 1000; // the M5 slept mid-render: the page's view finds a lapsed lease and tries a write
  const col = d.collection(WAN_JOBS);
  col.updateOne = async () => { throw Object.assign(new Error('you are over your space quota, using 513 MB of 512 MB'), { code: 8000 }); };
  let r = await admin('GET', C);
  assert.equal(r.status, 200, r.body?.toString());
  assert.ok(r.json().connections.length >= 6);
  assert.deepEqual([r.json().wan.queue.running, r.json().wan.status], [1, 'waiting'], 'tower 11 still shows; the job waits for the next write');
  col.countDocuments = async () => { throw new Error('connection reset'); };
  r = await admin('GET', C);
  assert.equal(r.status, 200);
  assert.equal(r.json().wan, null, 'tower 11 left out');
  assert.ok(r.json().connections.length >= 6, 'the other towers still there');
});

/** The Code page's Try poll (connections.js), run on its own with a stand-in page: what it asks, what it re-draws. */
function wanPollBox() {
  const js = readFileSync(new URL('../thirtyda-admin/connections.js', import.meta.url), 'utf8');
  const from = js.indexOf('const WAN_ASK_MS');
  const to = js.indexOf('// ---------- the hub: eleven towers');
  assert.ok(from > 0 && to > from);
  const box = {
    now: 0, timers: [], calls: 0, answer: null, drawn: [], full: 0,
    state: { busy: false, wanTryError: null, data: null },
    document: { hidden: false, activeElement: null },
  };
  const ctx = vm.createContext({
    API: '/api', state: box.state, document: box.document,
    Date: { now: () => box.now },
    setTimeout: (fn) => { box.timers.push(fn); return box.timers.length; },
    clearTimeout: () => { box.timers.length = 0; },
    call: async () => { box.calls += 1; return box.answer; },
    renderWan: (data) => { box.drawn.push(data); box.api.noteWan(data.wan); box.state.data = data; box.api.pollWan(data); },
    render: () => { box.full += 1; },
  });
  box.api = vm.runInContext(`${js.slice(from, to)}\n;({ wanAsk, noteWan, pollWan, askWan, checkWanAgain })`, ctx);
  box.tick = async () => { const fn = box.timers.shift(); assert.ok(fn, 'a timer is set'); await fn(); };
  return box;
}

test('Code page poll: re-draws the Wan tower only, only on a change; holds while a Wan box is typed in; stops after 10 quiet minutes ("Check again")', async () => {
  const box = wanPollBox();
  const wan = (status, progress = 0) => ({ status: 'live', queue: { pending: 1 }, jobs: [], lastTry: { id: 'x', status, progress } });
  const data = (w) => ({ connections: [], wan: w });
  box.state.data = data(wan('pending'));
  box.api.noteWan(box.state.data.wan);
  box.api.pollWan(box.state.data);
  assert.equal(box.timers.length, 1);
  // Nothing changed: asked, nothing re-drawn, asked again.
  box.answer = { ok: true, data: data(wan('pending')) };
  box.now += 5000;
  await box.tick();
  assert.deepEqual([box.calls, box.drawn.length, box.full, box.timers.length], [1, 0, 0, 1]);
  // A box in the Wan tower has the focus: no asking (nothing pulled from under the cursor), but still waiting to.
  box.document.activeElement = { matches: () => true, closest: (s) => (s === '#tower-wan' ? {} : null) };
  await box.tick();
  assert.deepEqual([box.calls, box.timers.length], [1, 1]);
  box.document.activeElement = null;
  // A change: the Wan tower only (never the full render), and the asking goes on.
  box.answer = { ok: true, data: data(wan('running', 0.4)) };
  await box.tick();
  assert.deepEqual([box.calls, box.drawn.length, box.full, box.timers.length], [2, 1, 0, 1]);
  // Ten minutes with nothing new: stops, re-drawn once to show "Check again", no timer left.
  box.now += 10 * 60e3;
  await box.tick();
  assert.deepEqual([box.api.wanAsk.stopped, box.drawn.length, box.timers.length], [true, 2, 0]);
  // "Check again": asks at once, counts as news, and the asking starts over.
  await box.api.checkWanAgain();
  assert.deepEqual([box.calls, box.api.wanAsk.stopped, box.drawn.length, box.timers.length], [4, false, 3, 1]);
  // Done: no more asking.
  box.answer = { ok: true, data: data(wan('done', 1)) };
  await box.tick();
  assert.equal(box.timers.length, 0);
  assert.equal(box.full, 0, 'the other ten towers were never re-drawn');
});

test('Code page: a refused Try ("Not queued") shows NEXT TO the last Try\'s status and clears once the tower changes; ← → leave the Try player alone', () => {
  const box = wanPollBox();
  const w = { status: 'off', queue: { pending: 0 }, jobs: [], lastTry: { id: 'x', status: 'done' } };
  box.api.noteWan(w);
  box.state.wanTryError = 'The Wan tower is off.';
  box.api.noteWan({ ...w }); // the same tower again (the answer itself, a focus refresh): the message stays
  assert.equal(box.state.wanTryError, 'The Wan tower is off.');
  box.api.noteWan({ ...w, status: 'waiting' }); // turned on
  assert.equal(box.state.wanTryError, null);
  const js = readFileSync(new URL('../thirtyda-admin/connections.js', import.meta.url), 'utf8');
  const block = js.slice(js.indexOf('function wanTryBlock'), js.indexOf('/** The last 8 renders'));
  assert.match(block, /const refused = state\.wanTryError/);
  assert.doesNotMatch(block, /if \(state\.wanTryError\)/, 'never in place of the last Try');
  assert.match(block, /\n {4}btn,\n {4}refused,\n {4}result\);/);
  assert.match(js, /function tryWan\(\)[\s\S]*?noteWan\(data\.wan\);\n {2}state\.wanTryError = r\.ok/);
  assert.match(js, /function render\(data, \{ fresh = null \} = \{\}\) \{\n {2}noteWan\(data\.wan\);/);
  // The arrow keys: a focused <video> / <audio> keeps them (they seek there).
  assert.match(js, /el\.closest\('input, textarea, select, video, audio, \[contenteditable\]/);
});

// ---------------------------------------------------------------- the mount, the page

test('serve-web: /30da/hub has its own branch, ahead of the 30+DA app, and reaches handleThirtyDaHub', () => {
  const src = readFileSync(new URL('../scripts/serve-web.mjs', import.meta.url), 'utf8');
  assert.match(src, /import \{ handleThirtyDaHub \} from "\.\.\/lib\/thirtyda-hub-wan\.mjs";/);
  const hubAt = src.indexOf('if (path === "/30da/hub" || path.startsWith("/30da/hub/")) {\n      await handleThirtyDaHub(req, res, url);\n      return;\n    }');
  const appAt = src.indexOf('if (path === "/30da" || path.startsWith("/30da/")) {');
  assert.ok(hubAt > 0, 'the hub branch');
  assert.ok(hubAt < appAt, 'ahead of the app, so its PIN / verify / terms guards never see the hub');
  // The app's own router is untouched: no hub route in it.
  const app = readFileSync(new URL('./thirtyda-app.mjs', import.meta.url), 'utf8');
  assert.equal(app.includes('/hub/'), false);
});

test('Code page: tower 11 "Wan" (Video), its words, its own icon; tokens shown once; no inline style, no innerHTML with data', () => {
  const js = readFileSync(new URL('../thirtyda-admin/connections.js', import.meta.url), 'utf8');
  const towers = js.slice(js.indexOf('const TOWERS = ['), js.indexOf('const towerNumber'));
  assert.match(towers, /key: 'wan', name: 'Wan', kind: 'Video'/);
  assert.match(js, /'Image to video on our M5 · for Yai Media Director'/);
  assert.match(js, /eleven towers/);
  assert.match(js, /11 Wan/);
  assert.match(js, /\n {2}wan: '<rect /, 'our own drawing in LOGOS');
  for (const words of ['Not set', 'Off', 'Waiting for the M5', 'Live', 'Shown once. ', 'Done, I copied it', 'Try a render',
    '720p — the M5’s 32 GB runs out of memory at 720p', 'Most seconds per clip', 'Turn off', 'New token', 'Revoke']) {
    assert.ok(js.includes(words), words);
  }
  assert.ok(js.includes('`${API}/wan/tokens/${kind}`') && js.includes('`${API}/wan/options`') && js.includes('`${API}/wan/try`'));
  assert.match(js, /h\('video', \{ class: 'cx-video', src: t\.clipUrl, controls: true/);
  assert.match(js, /seen \$\{ago\(seenAgoS\)\} ago/);
  assert.equal((js.match(/innerHTML/g) || []).length, 1, 'only the logo template (our own constant drawings)');
  assert.equal(/style=|\.style\.(?!setProperty)|setAttribute\('style'/.test(js), false, 'no inline style');
  assert.equal(/localStorage\.setItem\([^)]*wan/i.test(js), false, 'a token is never stored in the browser');
  const css = readFileSync(new URL('../thirtyda-admin/app.css', import.meta.url), 'utf8');
  for (const rule of ['.cx-pill.wait', '.cx-dot.wait', '.cx-logo.wan', '.cx-tower[data-tower="wan"]', '.cx-video']) assert.ok(css.includes(rule), rule);
  const html = readFileSync(new URL('../thirtyda-admin/connections.html', import.meta.url), 'utf8');
  assert.match(html, /eleven towers/);
});
