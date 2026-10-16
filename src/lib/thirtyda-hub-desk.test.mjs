// Run: npm run 30da:test (or node --test src/lib/thirtyda-hub-desk.test.mjs)
// GK API Hub, tower 14 · Agent Desk (src/lib/thirtyda-hub-desk.mjs, contract v1): one token per app and one for the
// Gemini Worker; text, image and maps jobs end to end (post, claim, progress, done / fail, read back); an app sees only
// its own jobs; each type On / Off; the caps (queue, per app and hour, pictures kept); leases that run out; answers gone
// 48 h after done; the tower's view (never a token, a text prompt or a picture); the Try; and 30+DA's own code never
// calling this hub. An in-memory Mongo stand-in and an in-memory picture store: no database, no network.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { handleThirtyDaHub } from './thirtyda-hub-wan.mjs';
import {
  setHubDeskTestHooks, deskMemoryStore, newDeskToken, revokeDeskToken, saveDeskOptions, deskAdminView, queueDeskTry, deskTryFile,
  DESK_JOBS, DESK_LIMITS, DESK_APPS, LEASE_MS, KEEP_MS, DESK_TRIES,
} from './thirtyda-hub-desk.mjs';
import { TOKEN_SETTINGS } from './thirtyda-settings.mjs';

// ---------------------------------------------------------------- an in-memory Mongo, just enough for the desk

const val = (v) => (v instanceof Date ? v.getTime() : v);
function matches(doc, q) {
  for (const [k, cond] of Object.entries(q || {})) {
    const v = doc[k];
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && Object.keys(cond).some((x) => x.startsWith('$'))) {
      for (const [op, want] of Object.entries(cond)) {
        if (op === '$gt' && !(v != null && val(v) > val(want))) return false;
        if (op === '$lt' && !(v != null && val(v) < val(want))) return false;
        if (op === '$lte' && !(v != null && val(v) <= val(want))) return false;
        if (op === '$in' && !want.some((w) => val(w) === val(v))) return false;
      }
    } else if (cond === null ? v != null : val(v) !== val(cond)) return false;
  }
  return true;
}
function fakeDb() {
  const cols = new Map();
  const collection = (name) => {
    if (cols.has(name)) return cols.get(name);
    const docs = new Map();
    const all = (q) => [...docs.values()].filter((x) => matches(x, q));
    const apply = (x, u) => {
      Object.assign(x, structuredClone(u.$set || {}));
      for (const [k, n] of Object.entries(u.$inc || {})) x[k] = (x[k] ?? 0) + n;
    };
    const col = {
      docs,
      async findOne(q, opts = {}) {
        let rows = all(q);
        if (opts.sort) { const [[k, dir]] = Object.entries(opts.sort); rows = rows.sort((a, b) => (val(a[k]) > val(b[k]) ? dir : -dir)); }
        return rows[0] ? structuredClone(rows[0]) : null;
      },
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
      async insertOne(doc) { docs.set(doc._id, structuredClone(doc)); return { insertedId: doc._id }; },
      async updateOne(q, u, opts = {}) {
        const x = all(q)[0];
        if (!x) {
          if (!opts.upsert) return { matchedCount: 0 };
          const fresh = { _id: q._id };
          apply(fresh, u);
          docs.set(q._id, fresh);
          return { matchedCount: 0, upsertedCount: 1 };
        }
        apply(x, u);
        return { matchedCount: 1 };
      },
      async replaceOne(q, doc) { docs.set(q._id, structuredClone({ ...doc, _id: q._id })); return { matchedCount: 1 }; },
      async deleteOne(q) { const x = all(q)[0]; if (x) docs.delete(x._id); return { deletedCount: x ? 1 : 0 }; },
      async deleteMany(q) { const xs = all(q); for (const x of xs) docs.delete(x._id); return { deletedCount: xs.length }; },
      async findOneAndUpdate(q, u, opts = {}) {
        let rows = all(q);
        if (opts.sort) { const [[k, dir]] = Object.entries(opts.sort); rows = rows.sort((a, b) => (val(a[k]) > val(b[k]) ? dir : -dir)); }
        const x = rows[0];
        if (!x) return null;
        apply(x, u);
        return structuredClone(x);
      },
    };
    cols.set(name, col);
    return col;
  };
  return { collection, docs: (name) => [...collection(name).docs.values()] };
}

const HOST = 'ecom.ggmt.sg';
const B = '/30da/hub/desk';
let d;
let store;
let clock;
let tokens;

/** One request to the hub as serve-web hands it on: a stand-in req / res. */
async function hub(method, path, { token, body, type = 'application/json', headers = {} } = {}) {
  const raw = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  const req = {
    method, url: path,
    headers: { host: HOST, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(raw ? { 'content-type': type, 'content-length': String(raw.length) } : {}), ...headers },
    resume() {},
    on(ev, fn) {
      if (ev === 'data' && raw) setImmediate(() => fn(raw));
      if (ev === 'end') setImmediate(() => setImmediate(fn));
    },
  };
  const res = { status: null, headers: null, body: undefined };
  res.writeHead = (s, h = {}) => { res.status = s; res.headers = h; return res; };
  res.end = (b) => { res.raw = b; res.body = b === undefined ? undefined : String(b); return res; };
  await handleThirtyDaHub(req, res, new URL(path, `https://${HOST}`));
  res.json = () => JSON.parse(res.body);
  return res;
}
const post = (token, body) => hub('POST', `${B}/jobs`, { token, body });
const claim = (body = { worker: 'M1 Agent Desk' }) => hub('POST', `${B}/worker/claim`, { token: tokens.worker, body });
const lease = (job) => ({ 'x-desk-lease': job.lease_id });
const PNG = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#88aacc' } }).png().toBuffer();

beforeEach(async () => {
  d = fakeDb();
  store = deskMemoryStore();
  clock = { t: 1_800_000_000_000 };
  setHubDeskTestHooks({ db: d, store, now: () => clock.t });
  tokens = {};
  for (const who of ['media', 'm1', 'm2', 'worker']) tokens[who] = (await newDeskToken(d, who)).token;
});

// ---------------------------------------------------------------- tokens

test('tokens: one per app (its prefix says which) and one for the worker; each only on its own side; another app\'s job is no job', async () => {
  assert.deepEqual([TOKEN_SETTINGS.desk_media, TOKEN_SETTINGS.desk_m1, TOKEN_SETTINGS.desk_m2, TOKEN_SETTINGS.desk_worker], ['deskm_', 'desk1_', 'desk2_', 'deskw_']);
  assert.ok(tokens.media.startsWith('deskm_') && tokens.m1.startsWith('desk1_') && tokens.worker.startsWith('deskw_'));
  assert.deepEqual(Object.keys(DESK_APPS), ['media', 'm1', 'm2']);
  assert.equal((await post(null, { type: 'text', input: { prompt: 'hi' } })).status, 401);
  assert.equal((await post(tokens.worker, { type: 'text', input: { prompt: 'hi' } })).status, 401, 'the worker token sends no jobs');
  assert.equal((await hub('POST', `${B}/worker/claim`, { token: tokens.media, body: {} })).status, 401, 'an app token takes no jobs');
  const r = await post(tokens.media, { type: 'text', input: { prompt: 'Translate "hello" into Khmer.', task: 'translate' } });
  assert.equal(r.status, 202, r.body);
  const { job_id: id } = r.json();
  assert.deepEqual(r.json(), { job_id: id, type: 'text', status: 'pending' });
  assert.equal((await hub('GET', `${B}/jobs/${id}`, { token: tokens.m1 })).status, 404, 'the M1 apps cannot read the media app\'s job');
  assert.equal((await hub('GET', `${B}/jobs/${id}`, { token: tokens.media })).json().status, 'pending');
  await revokeDeskToken(d, 'media');
  assert.equal((await hub('GET', `${B}/jobs/${id}`, { token: tokens.media })).status, 401, 'revoked: stops at once');
});

// ---------------------------------------------------------------- the three types end to end

test('text: post → claim (the input, a lease) → progress → done → the app reads the answer; the input is dropped once done', async () => {
  const id = (await post(tokens.m1, { type: 'text', input: { prompt: 'Is "សួស្តី" polite Khmer?', task: 'check' } })).json().job_id;
  const c = await claim({ worker: 'M1 Agent Desk', types: ['text', 'maps'], windows: { text: 'ready', image: 'signed_out', maps: 'busy' }, info: { chrome: '141', version: '1.0' } });
  assert.equal(c.status, 200, c.body);
  const job = c.json().job;
  assert.deepEqual([job.job_id, job.type, job.input], [id, 'text', { prompt: 'Is "សួស្តី" polite Khmer?', task: 'check' }]);
  assert.match(job.lease_id, /^[a-f0-9]{32}$/);
  assert.equal(d.docs(DESK_JOBS)[0].leaseUntil.getTime?.() ?? new Date(d.docs(DESK_JOBS)[0].leaseUntil).getTime(), clock.t + LEASE_MS.text);
  assert.equal((await claim()).status, 204, 'nothing else to do');
  assert.equal((await hub('POST', `${B}/worker/jobs/${id}/progress`, { token: tokens.worker, body: { progress: 0.5 } })).status, 409, 'no lease header: not yours');
  const p = await hub('POST', `${B}/worker/jobs/${id}/progress`, { token: tokens.worker, body: { progress: 0.5 }, headers: lease(job) });
  assert.equal(p.status, 200, p.body);
  assert.equal((await hub('GET', `${B}/jobs/${id}`, { token: tokens.m1 })).json().progress, 0.5);
  clock.t += 3000;
  const done = await hub('POST', `${B}/worker/jobs/${id}/done`, { token: tokens.worker, body: { text: 'Yes, it is a polite hello.' }, headers: lease(job) });
  assert.equal(done.status, 200, done.body);
  const r = (await hub('GET', `${B}/jobs/${id}`, { token: tokens.m1 })).json();
  assert.deepEqual([r.status, r.result, r.progress], ['done', { text: 'Yes, it is a polite hello.' }, 1]);
  assert.equal(r.expires_at, new Date(clock.t + KEEP_MS).toISOString());
  const kept = d.docs(DESK_JOBS)[0];
  assert.deepEqual([kept.input, kept.ms], [null, 3000], 'the app\'s words are not kept past the answer');
  // A second /done with the old lease: not yours.
  assert.equal((await hub('POST', `${B}/worker/jobs/${id}/done`, { token: tokens.worker, body: { text: 'again' }, headers: lease(job) })).status, 409);
});

test('maps: the places go back to the app that asked, at most 20 and 48 KB; checked input', async () => {
  for (const [input, field] of [[{}, 'query'], [{ query: 'x'.repeat(301) }, 'query'], [{ query: 'cafe', lat: 11.5 }, 'lat'], [{ query: 'cafe', near: 'x'.repeat(121) }, 'near']]) {
    const r = await post(tokens.m2, { type: 'maps', input });
    assert.deepEqual([r.status, r.json().field], [400, field], JSON.stringify(input));
  }
  assert.equal((await post(tokens.m2, { type: 'video', input: {} })).json().field, 'type');
  const id = (await post(tokens.m2, { type: 'maps', input: { query: 'Tube Coffee', near: 'BKK1', lat: 11.553321, lng: 104.92482 } })).json().job_id;
  const job = (await claim()).json().job;
  assert.deepEqual(job.input, { query: 'Tube Coffee', near: 'BKK1', lat: 11.55332, lng: 104.92482 });
  const tooMany = Array.from({ length: 21 }, (_, i) => ({ name: `Tube Coffee ${i}` }));
  assert.equal((await hub('POST', `${B}/worker/jobs/${id}/done`, { token: tokens.worker, body: { places: tooMany }, headers: lease(job) })).status, 400);
  const places = [{ name: 'Tube Coffee BKK1', address: 'St 278', lat: 11.55, lng: 104.92, rating: 4.4 }];
  assert.equal((await hub('POST', `${B}/worker/jobs/${id}/done`, { token: tokens.worker, body: { places }, headers: lease(job) })).status, 200);
  assert.deepEqual((await hub('GET', `${B}/jobs/${id}`, { token: tokens.m2 })).json().result, { places });
});

test('image: a picture to edit goes to the worker as a JPEG; the answer is a file only that app can fetch; gone 48 h later', async () => {
  const r = await post(tokens.media, { type: 'image', input: { prompt: 'Make the sky orange.', image: PNG.toString('base64'), aspect: '16:9' } });
  assert.equal(r.status, 202, r.body);
  const id = r.json().job_id;
  assert.equal(store.files.size, 1, 'the picture to edit, kept until the job ends');
  const job = (await claim()).json().job;
  assert.equal(job.type, 'image');
  assert.equal(Buffer.from(job.input.image, 'base64').subarray(0, 3).toString('hex'), 'ffd8ff', 'a JPEG');
  assert.equal(new Date(d.docs(DESK_JOBS)[0].leaseUntil).getTime(), clock.t + LEASE_MS.image, '20 minutes for a picture');
  assert.equal((await hub('POST', `${B}/worker/jobs/${id}/done`, { token: tokens.worker, body: Buffer.from('not a picture'), type: 'image/png', headers: lease(job) })).status, 400);
  assert.equal((await hub('POST', `${B}/worker/jobs/${id}/done`, { token: tokens.worker, body: PNG, type: 'text/plain', headers: lease(job) })).status, 400);
  const done = await hub('POST', `${B}/worker/jobs/${id}/done`, { token: tokens.worker, body: PNG, type: 'image/png', headers: lease(job) });
  assert.equal(done.status, 200, done.body);
  assert.equal(store.files.size, 1, 'the input went; the answer stays');
  const s = (await hub('GET', `${B}/jobs/${id}`, { token: tokens.media })).json();
  assert.equal(s.url, `https://${HOST}${B}/files/${id}`);
  const f = await hub('GET', `${B}/files/${id}`, { token: tokens.media });
  assert.deepEqual([f.status, f.headers['Content-Type'], Buffer.compare(f.raw, PNG)], [200, 'image/png', 0]);
  assert.equal((await hub('GET', `${B}/files/${id}`, { token: tokens.m1 })).status, 404, 'another app: no such job');
  clock.t += KEEP_MS + 60e3;
  assert.equal((await hub('GET', `${B}/files/${id}`, { token: tokens.media })).status, 410);
  const later = (await hub('GET', `${B}/jobs/${id}`, { token: tokens.media })).json();
  assert.deepEqual([later.status, later.expired, later.url], ['done', true, undefined]);
  assert.equal(store.files.size, 0, 'swept');
});

test('fail, and leases that run out: back once, then failed "worker_lost"', async () => {
  const a = (await post(tokens.m1, { type: 'text', input: { prompt: 'one' } })).json().job_id;
  const j1 = (await claim()).json().job;
  const f = await hub('POST', `${B}/worker/jobs/${a}/fail`, { token: tokens.worker, body: { error: 'Gemini window signed out\n' }, headers: lease(j1) });
  assert.equal(f.status, 200);
  assert.equal((await hub('GET', `${B}/jobs/${a}`, { token: tokens.m1 })).json().error, 'Gemini window signed out');
  const b = (await post(tokens.m1, { type: 'maps', input: { query: 'BreadTalk' } })).json().job_id;
  (await claim()).json();
  clock.t += LEASE_MS.maps + 1000;
  assert.equal((await hub('GET', `${B}/jobs/${b}`, { token: tokens.m1 })).json().status, 'pending', 'back once');
  (await claim()).json();
  clock.t += LEASE_MS.maps + 1000;
  const lost = (await hub('GET', `${B}/jobs/${b}`, { token: tokens.m1 })).json();
  assert.deepEqual([lost.status, lost.error], ['failed', 'worker_lost']);
});

// ---------------------------------------------------------------- On / Off and the caps

test('each type On / Off: an app gets 503 type_off, the worker is not handed it', async () => {
  const id = (await post(tokens.media, { type: 'image', input: { prompt: 'A lotus.' } })).json().job_id;
  assert.deepEqual((await saveDeskOptions(d, { types: { image: false } })).options.types, { text: true, image: false, maps: true });
  const r = await post(tokens.media, { type: 'image', input: { prompt: 'Another lotus.' } });
  assert.deepEqual([r.status, r.json().error], [503, 'type_off']);
  assert.equal((await claim()).status, 204, 'the queued image job waits while image is off');
  await saveDeskOptions(d, { types: { image: true } });
  assert.equal((await claim()).json().job.job_id, id);
  assert.equal((await saveDeskOptions(d, { types: { video: true } })).field, 'types');
  assert.equal((await saveDeskOptions(d, { types: { text: 'yes' } })).field, 'types');
  // A worker that says it can do only maps is handed only maps.
  await post(tokens.media, { type: 'text', input: { prompt: 'hello' } });
  assert.equal((await claim({ worker: 'M1', types: ['maps'] })).status, 204);
});

test('caps: 20 jobs waiting, per app and hour per type, 40 MB of pictures', async () => {
  assert.deepEqual([DESK_LIMITS.queue, DESK_LIMITS.perHour, DESK_LIMITS.storage], [20, { text: 120, image: 20, maps: 120 }, 40 * 1024 * 1024]);
  const jobs = d.collection(DESK_JOBS);
  // 20 image jobs this hour from the media app (done already): the 21st is refused, the M1 apps still may.
  for (let i = 0; i < 20; i += 1) {
    await jobs.insertOne({ _id: `${'a'.repeat(30)}${String(i).padStart(2, '0')}`, type: 'image', app: 'media', source: 'client', status: 'done', bytes: 0, createdAt: new Date(clock.t - 60e3) });
  }
  assert.equal((await post(tokens.media, { type: 'image', input: { prompt: 'x' } })).json().error, 'rate_limited');
  assert.equal((await post(tokens.m1, { type: 'image', input: { prompt: 'x' } })).status, 202);
  clock.t += 3600e3;
  assert.equal((await post(tokens.media, { type: 'image', input: { prompt: 'x' } })).status, 202, 'an hour later');
  // Pictures kept: over 40 MB → storage_full for a job that brings one.
  await jobs.insertOne({ _id: 'b'.repeat(32), type: 'image', app: 'm2', source: 'client', status: 'done', bytes: 40 * 1024 * 1024, createdAt: new Date(0) });
  assert.equal((await post(tokens.m2, { type: 'image', input: { prompt: 'edit', image: PNG.toString('base64') } })).json().error, 'storage_full');
  // 20 waiting: the next is refused.
  for (let i = 0; i < 18; i += 1) await post(tokens.m2, { type: 'text', input: { prompt: `line ${i}` } });
  assert.equal((await post(tokens.m2, { type: 'text', input: { prompt: 'one more' } })).json().error, 'queue_full');
});

// ---------------------------------------------------------------- the tower

test('the tower: Not set → Waiting → Live; the windows; the last jobs without a text prompt; never a token or a hash', async () => {
  const fresh = fakeDb();
  setHubDeskTestHooks({ db: fresh, store, now: () => clock.t });
  const req = { headers: { host: HOST } };
  assert.equal((await deskAdminView(fresh, req)).status, 'not_set');
  setHubDeskTestHooks({ db: d, store, now: () => clock.t });
  let v = await deskAdminView(d, req);
  assert.deepEqual([v.status, v.endpoint, v.contract, v.worker], ['waiting', `https://${HOST}${B}`, 'v1', null]);
  await post(tokens.m1, { type: 'text', input: { prompt: 'A SECRET LINE nobody should see on the tower' } });
  clock.t += 1000;
  await post(tokens.m2, { type: 'maps', input: { query: 'Pasta Corner' } });
  await claim({ worker: 'M1 Agent Desk', windows: { text: 'ready', image: 'signed_out', maps: 'busy', bogus: 'x' }, info: { chrome: '141' } });
  v = await deskAdminView(d, req);
  assert.equal(v.status, 'live');
  assert.deepEqual(v.worker.windows, { text: 'ready', image: 'signed_out', maps: 'busy' });
  assert.deepEqual([v.worker.name, v.worker.info], ['M1 Agent Desk', { chrome: '141' }]);
  assert.deepEqual([v.queue.pending, v.queue.running], [1, 1]);
  assert.deepEqual(v.jobs.map((j) => [j.type, j.app, j.status]), [['maps', 'm2', 'pending'], ['text', 'm1', 'running']]);
  const json = JSON.stringify(v);
  assert.equal(json.includes('SECRET LINE'), false, 'never a text prompt');
  for (const t of Object.values(tokens)) assert.equal(json.includes(t), false, 'never a token');
  assert.equal(/"hash"/.test(json), false, 'never a hash');
  assert.deepEqual(Object.keys(v.tokens.apps), ['media', 'm1', 'm2']);
  assert.equal(v.tokens.apps.media.name, 'Yai Media Director');
  clock.t += 3 * 60e3;
  assert.equal((await deskAdminView(d, req)).status, 'waiting', 'not seen for 2 minutes');
  await saveDeskOptions(d, { types: { text: false, image: false, maps: false } });
  assert.equal((await deskAdminView(d, req)).status, 'off');
});

test('Try: a fixed, harmless job per type; its answer shows on the tower; a Try picture only through the admin', async () => {
  const req = { headers: { host: HOST } };
  assert.match(DESK_TRIES.text.prompt, /Good morning/);
  const t = await queueDeskTry(d, 'text');
  assert.equal(t.ok, true);
  const job = (await claim()).json().job;
  assert.deepEqual(job.input, { prompt: DESK_TRIES.text.prompt, task: 'translate' });
  await hub('POST', `${B}/worker/jobs/${t.job_id}/done`, { token: tokens.worker, body: { text: 'អរុណសួស្តី …' }, headers: lease(job) });
  const v = await deskAdminView(d, req);
  assert.deepEqual([v.tries.text.status, v.tries.text.answer], ['done', { text: 'អរុណសួស្តី …' }]);
  assert.equal(v.tries.image, null);
  assert.equal((await hub('GET', `${B}/jobs/${t.job_id}`, { token: tokens.media })).status, 404, 'no app sees a Try');
  const img = await queueDeskTry(d, 'image');
  const ij = (await claim()).json().job;
  await hub('POST', `${B}/worker/jobs/${img.job_id}/done`, { token: tokens.worker, body: PNG, type: 'image/png', headers: lease(ij) });
  assert.equal((await deskAdminView(d, req)).tries.image.answer.url, `/30da/admin/api/connections/desk/files/${img.job_id}`);
  assert.equal(Buffer.compare((await deskTryFile(d, img.job_id)).buf, PNG), 0);
  assert.equal(await deskTryFile(d, t.job_id), null, 'not a picture');
  await saveDeskOptions(d, { types: { maps: false } });
  assert.deepEqual([(await queueDeskTry(d, 'maps')).reason, (await queueDeskTry(d, 'video')).reason], ['type_off', 'invalid']);
});

// ---------------------------------------------------------------- the rules

test('30+DA\'s own code never calls the Agent Desk: only the hub router and the admin load it', () => {
  const hits = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.(m?js|ts|html)$/.test(e.name) && !/\.test\.mjs$/.test(e.name)) {
        const src = readFileSync(p, 'utf8');
        if (src.includes('thirtyda-hub-desk') || src.includes('/hub/desk')) hits.push(p.replace(/^.*?src\//, 'src/'));
      }
    }
  };
  walk(fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, ''));
  // thirtyda-settings.mjs names the desk's tokens and thirtyda-delete.mjs its collections ("no person"): comments and a
  // list. Nothing in the 30+DA app, its screens or its routes.
  assert.deepEqual(hits.sort(), [
    'src/lib/thirtyda-admin.mjs', 'src/lib/thirtyda-delete.mjs', 'src/lib/thirtyda-hub-desk.mjs', 'src/lib/thirtyda-hub-wan.mjs',
    'src/lib/thirtyda-settings.mjs', 'src/thirtyda-admin/connections.js',
  ]);
  const desk = readFileSync(new URL('./thirtyda-hub-desk.mjs', import.meta.url), 'utf8');
  assert.equal(/from "\.\/thirtyda-places|collection\("thirtyda_places/.test(desk), false, 'maps answers never reach our place list');
  assert.match(desk, /NO 30\+DA user data in any job/);
});

test('Code page: tower 14 "Agent Desk" after Translate, its words and rules; the routes; no inline style', () => {
  const js = readFileSync(new URL('../thirtyda-admin/connections.js', import.meta.url), 'utf8');
  const towers = js.slice(js.indexOf('const TOWERS = ['), js.indexOf('const towerNumber'));
  assert.match(towers, /key: 'translate'[\s\S]*key: 'desk', name: 'Agent Desk', kind: 'Agents', has: \(byId, data\) => Boolean\(data\?\.desk\)/);
  assert.match(js, /\n {2}desk: '<rect /, 'our own drawing in LOGOS');
  for (const words of ['Gemini text, images and Google Maps on the M1 · for our other apps', 'No 30+DA user data in any job',
    'can get the Google account suspended', 'Waiting for the M1', 'Shown once. ', '`Try ${t}`', 'Last jobs', 'Yai Media Director', 'M1 apps', 'M2 apps']) {
    assert.ok(js.includes(words), words);
  }
  assert.ok(js.includes('`${API}/desk/tokens/${who}`') && js.includes('`${API}/desk/options`') && js.includes('`${API}/desk/try`'));
  assert.equal((js.match(/innerHTML/g) || []).length, 1, 'only the logo template');
  assert.equal(/style=|\.style\.(?!setProperty)|setAttribute\('style'/.test(js), false, 'no inline style');
  assert.equal(/localStorage\.setItem\([^)]*desk/i.test(js), false, 'a token is never stored in the browser');
  const admin = readFileSync(new URL('./thirtyda-admin.mjs', import.meta.url), 'utf8');
  assert.match(admin, /m = sub\.match\(\/\^\\\/api\\\/connections\\\/desk\\\/\(tokens\\\/\(media\|m1\|m2\|worker\)\|options\|try\|files\\\/\(\[a-f0-9\]\{32\}\)\)\$\/\);/);
  assert.match(admin, /desk: await deskAdminView\(d, req\)\.catch\(/);
  const css = readFileSync(new URL('../thirtyda-admin/app.css', import.meta.url), 'utf8');
  for (const rule of ['.cx-logo.desk', '.cx-tower[data-tower="desk"]']) assert.ok(css.includes(rule), rule);
});
