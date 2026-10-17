// Run: npm run 30da:test (or node --test src/lib/thirtyda-hub-ai.test.mjs)
// GK API Hub, tower 15 · Local AI (src/lib/thirtyda-hub-ai.mjs, contract v1): the M1 gateway's pull — GET /config (every
// app token as a SHA-256, never a token; ETag / 304) and POST /heartbeat (its health, its counts once per batch) — the
// per-app and per-service rules and caps, 30+DA never on the Gemini Worker or Claude, and the tower's view (counts only,
// never a token or a hash). An in-memory Mongo stand-in: no database, no network.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { handleThirtyDaHub } from './thirtyda-hub-wan.mjs';
import {
  setHubAiTestHooks, newAiToken, revokeAiToken, saveAiService, saveAiApp, aiAdminView, aiConfig, dayOf, AI_COUNTS, AI_APPS, APP_IDS,
  SERVICE_IDS, LIVE_MS,
} from './thirtyda-hub-ai.mjs';
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
        if (op === '$gte' && !(v != null && val(v) >= val(want))) return false;
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
          const fresh = { _id: q._id, ...structuredClone(u.$setOnInsert || {}) };
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
const B = '/30da/hub/ai';
let d;
let clock;
let gw;

async function hub(method, path, { token, body, headers = {} } = {}) {
  const raw = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const req = {
    method, url: path,
    headers: { host: HOST, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(raw ? { 'content-type': 'application/json', 'content-length': String(raw.length) } : {}), ...headers },
    resume() {},
    on(ev, fn) {
      if (ev === 'data' && raw) setImmediate(() => fn(raw));
      if (ev === 'end') setImmediate(() => setImmediate(fn));
    },
  };
  const res = { status: null, headers: null, body: undefined };
  res.writeHead = (s, h = {}) => { res.status = s; res.headers = h; return res; };
  res.end = (b) => { res.body = b === undefined ? undefined : String(b); return res; };
  await handleThirtyDaHub(req, res, new URL(path, `https://${HOST}`));
  res.json = () => JSON.parse(res.body);
  return res;
}
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const beat = (body) => hub('POST', `${B}/heartbeat`, { token: gw, body });

beforeEach(async () => {
  d = fakeDb();
  clock = { t: Date.UTC(2026, 9, 17, 5, 0, 0) }; // 12:00 in Phnom Penh
  setHubAiTestHooks({ db: d, now: () => clock.t });
  gw = (await newAiToken(d, 'gateway')).token;
});

test('tokens: the gateway\'s and one per app (the prefix says which); only the gateway calls the hub', async () => {
  assert.deepEqual(APP_IDS, ['yai', 'iews', 'iews_ba', 'thirtyda', 'newsroom', 'media', 'mobile']);
  assert.equal(TOKEN_SETTINGS.ai_gateway, 'aigw_');
  for (const id of APP_IDS) assert.equal(TOKEN_SETTINGS[AI_APPS[id].setting], AI_APPS[id].prefix, id);
  assert.ok(gw.startsWith('aigw_'));
  const yai = (await newAiToken(d, 'yai')).token;
  assert.ok(yai.startsWith('aiyai_'));
  assert.equal((await hub('GET', `${B}/config`)).status, 401);
  assert.equal((await hub('GET', `${B}/config`, { token: yai })).status, 401, 'an app token: the gateway checks it, the hub never takes it');
  assert.equal((await hub('GET', `${B}/config`, { token: gw })).status, 200);
  assert.equal((await hub('POST', `${B}/config`, { token: gw, body: {} })).status, 405);
  assert.equal((await hub('GET', `${B}/nope`, { token: gw })).status, 404);
  await revokeAiToken(d, 'gateway');
  assert.equal((await hub('GET', `${B}/config`, { token: gw })).status, 401, 'revoked: stops at once');
});

test('GET /config: the rules and every app token as a SHA-256 (never a token); an ETag, 304 until something changes', async () => {
  const media = (await newAiToken(d, 'media')).token;
  const r = await hub('GET', `${B}/config`, { token: gw });
  const c = r.json();
  assert.deepEqual(Object.keys(c.services), SERVICE_IDS);
  assert.deepEqual(Object.keys(c.apps), APP_IDS);
  assert.deepEqual(c.apps.media, { name: 'Media teams', enabled: true, token_sha256: sha(media), token_last4: media.slice(-4), allowed: ['places', 'desk_khmer', 'desk_maps', 'desk_images'], daily_cap: 5000 }, 'in the services\' order');
  assert.deepEqual([c.apps.yai.token_sha256, c.apps.yai.token_last4], [null, null], 'no token made yet');
  assert.deepEqual(c.apps.thirtyda.allowed, ['translate']);
  assert.deepEqual(c.services.claude, { enabled: true, daily_cap: 200 });
  assert.equal(c.poll_seconds, 60);
  assert.equal(r.body.includes(media), false, 'never a token');
  assert.equal(r.headers.ETag, `"${c.version}"`);
  const same = await hub('GET', `${B}/config`, { token: gw, headers: { 'if-none-match': `"${c.version}"` } });
  assert.deepEqual([same.status, same.body], [304, undefined]);
  await saveAiApp(d, 'newsroom', { dailyCap: 100 });
  const changed = await hub('GET', `${B}/config`, { token: gw, headers: { 'if-none-match': `"${c.version}"` } });
  assert.equal(changed.status, 200, 'a rule changed: a new version');
  assert.equal(changed.json().apps.newsroom.daily_cap, 100);
  const v2 = changed.json().version;
  await newAiToken(d, 'media');
  assert.notEqual((await hub('GET', `${B}/config`, { token: gw })).json().version, v2, 'a new token: a new version');
});

test('the rules: services On / Off and daily caps; apps On / Off, allowed services, caps; 30+DA never the Gemini Worker or Claude', async () => {
  assert.deepEqual((await saveAiService(d, 'claude', { enabled: false, dailyCap: 50 })).config.services.claude, { enabled: false, dailyCap: 50 });
  for (const [id, input, field] of [['claude', { enabled: 'no' }, 'enabled'], ['claude', { dailyCap: -1 }, 'dailyCap'], ['claude', { dailyCap: 1.5 }, 'dailyCap'], ['video', {}, 'service']]) {
    assert.equal((await saveAiService(d, id, input)).field, field, `${id} ${JSON.stringify(input)}`);
  }
  const r = await saveAiApp(d, 'thirtyda', { allowed: ['translate', 'claude'] });
  assert.equal(r.ok, false);
  assert.match(r.error, /30\+DA never uses Claude: its chats are private/);
  assert.equal((await saveAiApp(d, 'thirtyda', { allowed: ['translate', 'desk_khmer'] })).field, 'allowed');
  assert.equal((await saveAiApp(d, 'iews', { allowed: ['chat', 'video'] })).field, 'allowed');
  const ok = await saveAiApp(d, 'mobile', { enabled: false, allowed: ['translate', 'chat'], dailyCap: 300 });
  assert.deepEqual(ok.config.apps.mobile, { enabled: false, allowed: ['chat', 'translate'], dailyCap: 300 }, 'in the services\' order');
  assert.equal((await saveAiApp(d, 'nobody', {})).field, 'app');
  // A stored list that somehow names Claude for 30+DA is still never handed to the gateway.
  await d.collection('thirtyda_settings').replaceOne({ _id: 'ai_config' }, { _id: 'ai_config', apps: { thirtyda: { allowed: ['translate', 'claude', 'desk_maps'] } } });
  assert.deepEqual((await aiConfig(d)).apps.thirtyda.allowed, ['translate']);
});

test('POST /heartbeat: the M1\'s health kept short; counts added to today once per batch; bad counts refused', async () => {
  const body = {
    gateway: 'M1 Local AI', version: '2.0.0', uptime_s: 3600,
    models: [{ id: 'qwen2.5-7b-instruct', loaded: true, kind: 'chat' }, { id: 'hy-mt2-1.8b', loaded: false, kind: 'translate' }],
    ram: { free_mb: 6144, total_mb: 16384 }, desk: { text: 'ready', image: 'signed_out', maps: 'busy', bogus: 'x' },
    counts: { batch_id: 'batch-0001', by: [{ app: 'yai', service: 'chat', calls: 10, ok: 9, failed: 1, ms_total: 18000 }, { app: 'thirtyda', service: 'translate', calls: 40, ok: 40, failed: 0, ms_total: 32000 }] },
  };
  const r = await beat(body);
  assert.equal(r.status, 200, r.body);
  assert.deepEqual([r.json().ok, r.json().counted, typeof r.json().config_version], [true, true, 'string']);
  assert.equal((await beat(body)).json().counted, false, 'the same batch again: counted once');
  const day = dayOf(clock.t);
  assert.equal(day, '2026-10-17');
  const rows = d.docs(AI_COUNTS);
  assert.deepEqual(rows.map((x) => [x._id, x.calls, x.ok, x.failed]).sort(), [[`${day}|thirtyda|translate`, 40, 40, 0], [`${day}|yai|chat`, 10, 9, 1]]);
  await beat({ ...body, counts: { batch_id: 'batch-0002', by: [{ app: 'yai', service: 'chat', calls: 5, ok: 5, failed: 0 }] } });
  assert.equal(d.docs(AI_COUNTS).find((x) => x.app === 'yai').calls, 15, 'a new batch adds up');
  for (const [bad, field] of [
    [{ counts: { batch_id: 'x', by: [] } }, 'counts'],
    [{ counts: { batch_id: 'batch-0003', by: [{ app: 'other', service: 'chat', calls: 1 }] } }, 'counts'],
    [{ counts: { batch_id: 'batch-0003', by: [{ app: 'yai', service: 'video', calls: 1 }] } }, 'counts'],
    [{ counts: { batch_id: 'batch-0003', by: [{ app: 'yai', service: 'chat', calls: -1 }] } }, 'calls'],
    [{ models: 'qwen' }, 'models'], [{ gateway: 5 }, 'gateway'], [{ ram: { free_mb: 'lots' } }, 'ram.free_mb'],
  ]) {
    const x = await beat(bad);
    assert.deepEqual([x.status, x.json().field], [400, field], JSON.stringify(bad));
  }
  // 91 days later the old day goes.
  clock.t += 91 * 864e5;
  await beat({ gateway: 'M1 Local AI' });
  assert.equal(d.docs(AI_COUNTS).length, 0);
});

test('the tower: Not set → Waiting → Live; the M1\'s models, memory and windows; counts per app and service; never a token or a hash', async () => {
  const req = { headers: { host: HOST } };
  await revokeAiToken(d, 'gateway');
  assert.equal((await aiAdminView(d, req)).status, 'not_set');
  gw = (await newAiToken(d, 'gateway')).token;
  const yai = (await newAiToken(d, 'yai')).token;
  let v = await aiAdminView(d, req);
  assert.deepEqual([v.status, v.gateway, v.endpoint, v.contract], ['waiting', null, `https://${HOST}${B}`, 'v1']);
  await beat({
    gateway: 'M1 Local AI', version: '2.0.0', models: [{ id: 'qwen2.5-7b-instruct' }], ram: { free_mb: 6144, total_mb: 16384 }, desk: { text: 'ready' },
    counts: { batch_id: 'batch-0001', by: [{ app: 'yai', service: 'chat', calls: 10, ok: 8, failed: 2, ms_total: 16000 }] },
  });
  v = await aiAdminView(d, req);
  assert.equal(v.status, 'live');
  assert.deepEqual([v.gateway.name, v.gateway.version, v.gateway.models, v.gateway.ram, v.gateway.desk],
    ['M1 Local AI', '2.0.0', [{ id: 'qwen2.5-7b-instruct', loaded: true, kind: 'other' }], { freeMb: 6144, totalMb: 16384 }, { text: 'ready' }]);
  const yaiRow = v.apps.find((a) => a.id === 'yai');
  assert.deepEqual([yaiRow.today.calls, yaiRow.today.failed, yaiRow.today.avgMs, yaiRow.week.calls], [10, 2, 2000, 10]);
  assert.deepEqual(v.apps.find((a) => a.id === 'thirtyda').never, ['desk_khmer', 'desk_maps', 'desk_images', 'claude']);
  assert.equal(v.services.find((s) => s.id === 'chat').today.calls, 10);
  const json = JSON.stringify(v);
  for (const t of [gw, yai, sha(yai)]) assert.equal(json.includes(t), false, 'never a token or a hash');
  assert.equal(v.tokens.apps.yai.last4, yai.slice(-4));
  clock.t += LIVE_MS + 1000;
  assert.equal((await aiAdminView(d, req)).status, 'waiting');
  clock.t += 864e5;
  const later = (await aiAdminView(d, req)).apps.find((a) => a.id === 'yai');
  assert.deepEqual([later.today.calls, later.week.calls], [0, 10], 'yesterday is in the 7 days, not today');
});

test('the apps never call this hub: nothing in the 30+DA app, its screens or its routes loads it', () => {
  const hits = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.(m?js|ts|html)$/.test(e.name) && !/\.test\.mjs$/.test(e.name)) {
        const src = readFileSync(p, 'utf8');
        if (src.includes('thirtyda-hub-ai') || src.includes('/hub/ai')) hits.push(p.replace(/^.*?src\//, 'src/'));
      }
    }
  };
  walk(fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, ''));
  assert.deepEqual(hits.sort(), ['src/lib/thirtyda-admin.mjs', 'src/lib/thirtyda-delete.mjs', 'src/lib/thirtyda-hub-ai.mjs', 'src/lib/thirtyda-hub-wan.mjs', 'src/lib/thirtyda-settings.mjs', 'src/thirtyda-admin/connections.js']);
});

test('Code page: tower 15 "Local AI" after Agent Desk; its words and rules; the routes; no inline style', () => {
  const js = readFileSync(new URL('../thirtyda-admin/connections.js', import.meta.url), 'utf8');
  const towers = js.slice(js.indexOf('const TOWERS = ['), js.indexOf('const towerNumber'));
  assert.match(towers, /key: 'desk'[\s\S]*key: 'ai', name: 'Local AI', kind: 'AI gateway', has: \(byId, data\) => Boolean\(data\?\.ai\)/);
  assert.match(js, /\n {2}ai: '<rect /, 'our own drawing in LOGOS');
  for (const words of ['llm.ggmt.sg/v2 on the M1 · one token per app', '30+DA: translate only, never the Gemini Worker or Claude',
    'Counts only, never a prompt or an answer', 'Waiting for the M1', '— never (private chats)', 'Save services', 'Calls a day at most', 'Shown once. ']) {
    assert.ok(js.includes(words), words);
  }
  assert.ok(js.includes('`${API}/ai/tokens/${who}`') && js.includes('`${API}/ai/${path}`'));
  assert.equal((js.match(/innerHTML/g) || []).length, 1, 'only the logo template');
  assert.equal(/style=|\.style\.(?!setProperty)|setAttribute\('style'/.test(js), false, 'no inline style');
  const admin = readFileSync(new URL('./thirtyda-admin.mjs', import.meta.url), 'utf8');
  assert.match(admin, /ai: await aiAdminView\(d, req\)\.catch\(/);
  assert.match(admin, /if \(m\) return aiRoute\(req, res, m\);/);
  const css = readFileSync(new URL('../thirtyda-admin/app.css', import.meta.url), 'utf8');
  for (const rule of ['.cx-logo.ai', '.cx-tower[data-tower="ai"]', '.cx-checks']) assert.ok(css.includes(rule), rule);
});
