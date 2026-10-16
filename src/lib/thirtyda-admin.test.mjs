// Run: npm run 30da:test (or node --test src/lib/thirtyda-admin.test.mjs)
// The admin's Delete (owner 2026-10-14: "add a delete button to admin the right way"): POST
// /30da/admin/api/users/:id/delete { confirm: id } — signed in, same Origin, JSON, the confirm equal to the id, 404 for an
// unknown id, then the app's own full delete (deleteAccount) and an audit line with the id only. Users → Delete
// (monitor.js) and App review → Remove (review.js) both go through it: one delete path, one dialog (delete-profile.js).
// In-memory Mongo stand-in and a stand-in deleteAccount (src/lib/thirtyda-admin.mjs setAdminTestHooks): no database.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

const { handleThirtyDaAdmin, setAdminTestHooks } = await import('./thirtyda-admin.mjs');

// ---------------------------------------------------------------- an in-memory Mongo, just enough for these routes

const val = (v) => (v instanceof Date ? v.getTime() : v);
function matches(doc, q) {
  for (const [k, cond] of Object.entries(q || {})) {
    const v = doc[k];
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && Object.keys(cond).some((x) => x.startsWith('$'))) {
      for (const [op, want] of Object.entries(cond)) {
        if (op === '$gt' && !(v != null && val(v) > val(want))) return false;
        if (op === '$lt' && !(v != null && val(v) < val(want))) return false;
        if (op === '$lte' && !(v != null && val(v) <= val(want))) return false;
        if (op === '$ne' && (want === null ? v == null : val(v) === val(want))) return false; // { $ne: null }: set, not null or missing
        if (op === '$in' && !want.some((w) => val(w) === val(v))) return false;
      }
    } else if (val(v) !== val(cond)) return false;
  }
  return true;
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
        // The Code page's tower 11 (Wan) lists its last jobs: sort + limit, and counts.
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
        async deleteMany(q) { const xs = all(q); for (const x of xs) docs.delete(x._id); return { deletedCount: xs.length }; },
        async insertOne(doc) { const _id = doc._id ?? crypto.randomUUID(); docs.set(_id, structuredClone({ ...doc, _id })); return { insertedId: _id }; },
        async deleteOne(q) { const x = all(q)[0]; if (x) docs.delete(x._id); return { deletedCount: x ? 1 : 0 }; },
        // The Code page's settings (Sign in with Apple's key below): a save replaces, a try notes its outcome.
        async replaceOne(q, doc, opts = {}) { const x = all(q)[0]; if (!x && !opts.upsert) return { matchedCount: 0 }; docs.set(doc._id ?? x._id, structuredClone(doc)); return { matchedCount: x ? 1 : 0 }; },
        async updateOne(q, u) {
          const x = [...docs.values()].find((y) => y._id === q._id && (!q.box?.$exists || y.box));
          if (!x) return { matchedCount: 0 };
          Object.assign(x, structuredClone(u.$set || {}));
          return { matchedCount: 1 };
        },
      });
    }
    return cols.get(name);
  };
  return { collection, docs: (name) => [...collection(name).docs.values()] };
}

const TOKEN = 'a'.repeat(64);
const HOST = 'ecom.ggmt.sg';
let d = null;
let calls = [];

beforeEach(async () => {
  d = fakeDb();
  calls = [];
  await d.collection('thirtyda_admin_sessions').insertOne({ _id: TOKEN, created: new Date(), expires: new Date(Date.now() + 3600e3) });
  await d.collection('thirtyda_admin_sessions').insertOne({ _id: 'b'.repeat(64), created: new Date(), expires: new Date(Date.now() - 1000) });
  for (const [id, name] of [['U-10001', 'Dara'], ['U-10002', 'Sophea']]) {
    await d.collection('thirtyda_users').insertOne({ _id: id, id, name, level: 1, language: 'English', area: 'Phnom Penh', blocked: false });
  }
  // The stand-in records the call and deletes the profile, as the real one does (its own tests: thirtyda-delete.test.mjs).
  setAdminTestHooks({
    db: d,
    deleteAccount: async (db, id) => { calls.push([db, id]); db.collection('thirtyda_users').docs.delete(id); return { ok: true, already: false }; },
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
  res.end = (b) => { res.raw = b; res.body = b === undefined ? undefined : String(b); return res; }; // raw: an image's bytes
  await handleThirtyDaAdmin(req, res, new URL(path, `https://${HOST}`));
  res.json = () => JSON.parse(res.body);
  return res;
}
const JSON_HEADERS = { 'content-type': 'application/json', origin: `https://${HOST}`, 'sec-fetch-site': 'same-origin' };
const del = (id, body, opts = {}) => admin('POST', `/30da/admin/api/users/${id}/delete`, { headers: JSON_HEADERS, body, ...opts });
const userIds = () => d.docs('thirtyda_users').map((u) => u._id).sort();

// ---------------------------------------------------------------- the route

test('delete: another site, a cross-site fetch or a non-JSON body → refused, nothing deleted', async () => {
  let r = await del('U-10001', { confirm: 'U-10001' }, { headers: { ...JSON_HEADERS, origin: 'https://evil.example' } });
  assert.equal(r.status, 403, 'foreign Origin');
  r = await del('U-10001', { confirm: 'U-10001' }, { headers: { ...JSON_HEADERS, origin: `https://x.${HOST}` } });
  assert.equal(r.status, 403, 'a sibling subdomain');
  r = await del('U-10001', { confirm: 'U-10001' }, { headers: { ...JSON_HEADERS, 'sec-fetch-site': 'cross-site' } });
  assert.equal(r.status, 403, 'cross-site fetch');
  r = await del('U-10001', 'confirm=U-10001', { headers: { ...JSON_HEADERS, 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(r.status, 415, 'an HTML form post');
  assert.equal(calls.length, 0);
  assert.deepEqual(userIds(), ['U-10001', 'U-10002']);
});

test('delete: admin only — no session, or an expired one → 401, nothing deleted', async () => {
  let r = await del('U-10001', { confirm: 'U-10001' }, { cookie: null });
  assert.equal(r.status, 401);
  r = await del('U-10001', { confirm: 'U-10001' }, { cookie: 'b'.repeat(64) });
  assert.equal(r.status, 401, 'expired');
  r = await del('U-10001', { confirm: 'U-10001' }, { cookie: 'c'.repeat(64) });
  assert.equal(r.status, 401, 'unknown');
  assert.equal(calls.length, 0);
  assert.deepEqual(userIds(), ['U-10001', 'U-10002']);
});

test('delete: the confirm must be the id itself → 400, nothing deleted', async () => {
  for (const body of [{ confirm: 'U-10002' }, { confirm: 'u-10001' }, { confirm: ' U-10001' }, { confirm: 10001 }, {}, { id: 'U-10001' }]) {
    const r = await del('U-10001', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json().reason, 'confirm');
    assert.match(r.json().error, /U-10001/);
  }
  assert.equal((await del('U-10001', 'not json')).status, 400, 'not JSON');
  assert.equal(calls.length, 0);
  assert.deepEqual(userIds(), ['U-10001', 'U-10002']);
});

test('delete: an unknown id → 404, nothing deleted', async () => {
  const r = await del('U-99999', { confirm: 'U-99999' });
  assert.equal(r.status, 404);
  assert.equal(r.json().reason, 'not_found');
  assert.equal(calls.length, 0);
  assert.equal((await admin('POST', '/30da/admin/api/users/x/delete', { headers: JSON_HEADERS, body: { confirm: 'x' } })).status, 404, 'not an id');
});

test('delete: the app\'s own full delete (deleteAccount) for that id, then the fresh overview; the audit has the id only', async () => {
  const r = await del('U-10001', { confirm: 'U-10001' });
  assert.equal(r.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], d, 'the admin database');
  assert.equal(calls[0][1], 'U-10001');
  const data = r.json();
  assert.equal(data.deleted, 'U-10001');
  assert.deepEqual(data.users.map((u) => u.id), ['U-10002'], 'the row is gone');
  assert.equal(typeof data.stats.online, 'number', 'the counts come fresh with it');
  const audit = d.docs('thirtyda_audit').filter((a) => a.action === 'delete_user');
  assert.equal(audit.length, 1);
  assert.deepEqual(Object.keys(audit[0]).sort(), ['_id', 'action', 'at', 'ip', 'user']);
  assert.equal(audit[0].user, 'U-10001');
  assert.equal((await del('U-10001', { confirm: 'U-10001' })).status, 404, 'a second time: gone already');
  assert.equal(calls.length, 1);
});

test('delete: one path — the App review page has no delete route of its own any more', async () => {
  const r = await admin('POST', '/30da/admin/api/review/profiles/U-10001/remove', { headers: JSON_HEADERS, body: { confirm: 'U-10001' } });
  assert.equal(r.status, 404);
  assert.equal(calls.length, 0);
  const src = readFileSync(new URL('./thirtyda-admin.mjs', import.meta.url), 'utf8');
  assert.equal((src.match(/deleteAccount\)\(d, id\)|deleteAccount\(d, /g) || []).length, 1, 'deleteAccount is called in one place');
});

// ---------------------------------------------------------------- the pages

test('Users list: a red Delete next to Block / Unblock on every row, through the admin dialog (not window.confirm)', async () => {
  const js = readFileSync(new URL('../thirtyda-admin/monitor.js', import.meta.url), 'utf8');
  const rows = js.slice(js.indexOf('function renderUsers('), js.indexOf('function renderMonitor('));
  const actions = rows.slice(rows.indexOf('<span class="row-actions">'), rows.indexOf('</span></td>', rows.indexOf('<span class="row-actions">')));
  assert.match(actions, /: `<button type="button" class="link danger" data-block="\$\{esc\(u\.id\)\}">Block<\/button>`\}\n\s+<button type="button" class="link danger" data-delete="\$\{esc\(u\.id\)\}">Delete<\/button>/,
    'after the Block / Unblock choice: on every row, red');
  const handler = js.slice(js.indexOf('} else if (ds.delete) {'), js.indexOf('} else if (ds.unblock) {'));
  assert.match(handler, /window\.thirtydaDeleteProfile\(\{ id, name: /);
  assert.match(handler, /view\.data = data;[\s\S]*render\(\);/, 'the row disappears, the counts refresh (the answer is the overview)');
  assert.ok(!/\bconfirm\(/.test(js), 'no window.confirm');
  const html = readFileSync(new URL('../thirtyda-admin/monitor.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('/30da/admin/delete-profile.js') > 0 && html.indexOf('/30da/admin/delete-profile.js') < html.indexOf('/30da/admin/monitor.js'));

  const dlg = readFileSync(new URL('../thirtyda-admin/delete-profile.js', import.meta.url), 'utf8');
  assert.ok(dlg.includes('`Delete ${label} (${id})? The profile, photos and messages are deleted for good.`'), 'names the profile');
  assert.match(dlg, /'Cancel'/);
  assert.match(dlg, /'btn block ad-dialog-danger', 'Delete'/, 'a red Delete');
  assert.ok(dlg.includes('`/30da/admin/api/users/${encodeURIComponent(id)}/delete`') && dlg.includes('JSON.stringify({ confirm: id })'));
  assert.match(dlg, /'Content-Type': 'application\/json'/);
  assert.ok(!/innerHTML|\bconfirm\(/.test(dlg.replace('{ confirm: id }', '')), 'text only, no window.confirm');
  assert.match(dlg, /showModal\(\)/);
  const css = readFileSync(new URL('../thirtyda-admin/app.css', import.meta.url), 'utf8');
  assert.match(css, /\.ad-dialog \{/);

  const r = await admin('GET', '/30da/admin/delete-profile.js', { cookie: null });
  assert.equal(r.status, 200);
  assert.match(r.headers['Content-Type'], /^text\/javascript/);
});

test('overview: Sign in with Apple\'s sealed refresh token never leaves the server — not on the profile, not in a started delete (its Apple id only)', async () => {
  const SUB = '001234.fake0a1b2c3d4e5f60718293a4b5c6d7e8f.0800';
  const box = { v: 1, alg: 'aes-256-gcm', iv: 'IV-fake', tag: 'TAG-fake', data: 'SEALED-fake' };
  const users = d.collection('thirtyda_users').docs;
  Object.assign(users.get('U-10001'), { signin: { apple: { id: SUB } }, verified: { apple: true }, appleRefresh: box });
  Object.assign(users.get('U-10002'), { deleting: { at: new Date(), phones: [], signins: [{ provider: 'apple', id: SUB }], photos: [], apple: { sub: SUB, box } } });
  const r = await admin('GET', '/30da/admin/api/overview');
  assert.equal(r.status, 200);
  assert.equal(/appleRefresh|"box"|SEALED-fake|TAG-fake|IV-fake/.test(r.body), false, 'no sealed token, no box, in the answer');
  const [dara, sophea] = ['U-10001', 'U-10002'].map((id) => r.json().users.find((u) => u.id === id));
  assert.equal(dara.signin.apple.id, SUB, 'the rest of the row as before');
  assert.equal('appleRefresh' in dara, false);
  assert.deepEqual(sophea.deleting.apple, { sub: SUB }, 'a started delete: what it wrote down, the Apple id without its token');
  assert.deepEqual(sophea.deleting.signins, [{ provider: 'apple', id: SUB }]);
  assert.equal('deleting' in dara, false, 'no delete started: no deleting');
  // The delete's answer (and every other route that answers with the overview) goes through the same overview().
  const src = readFileSync(new URL('./thirtyda-admin.mjs', import.meta.url), 'utf8');
  assert.match(src, /return json\(res, 200, \{ \.\.\.\(await overview\(\)\), deleted: id/);
});

// ---------------------------------------------------------------- the Code page, tower 10: Sign in with Apple's key

/** An Apple-style .p8 (PKCS #8, EC P-256). */
function p8() {
  const pem = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'pem', type: 'pkcs8' });
  return { pem, body: pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '') };
}
async function withSecretKey(fn) {
  const { clearSettingsCache } = await import('./thirtyda-settings.mjs');
  const prev = process.env.THIRTYDA_SECRET_KEY;
  process.env.THIRTYDA_SECRET_KEY = crypto.randomBytes(32).toString('hex');
  clearSettingsCache();
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.THIRTYDA_SECRET_KEY; else process.env.THIRTYDA_SECRET_KEY = prev;
    clearSettingsCache();
  }
}
const appleOf = (data) => data.connections.find((c) => c.id === 'apple');

test('Code page, Apple: the sign-in works with no key (said so); Save checks the boxes, keeps the .p8 sealed, shows only its last 4', async () => withSecretKey(async () => {
  const C = '/30da/admin/api/connections';
  let r = await admin('GET', C);
  assert.equal(r.status, 200);
  let apple = appleOf(r.json());
  assert.equal(apple.signinWorks, true, 'Sign in with Apple needs no key');
  assert.equal(apple.set, false);
  assert.equal(apple.live, false, 'Live only once a key passes Try');
  assert.equal(apple.bundleId, 'sg.ggmt.thirtyda');
  assert.equal(apple.teamIdDefault, '4KX4774V2U');
  // "Try the key" with nothing saved: says what to do, calls nobody.
  r = await admin('POST', `${C}/apple/try`, { headers: JSON_HEADERS, body: {} });
  assert.equal(r.status, 400);
  assert.equal(r.json().reason, 'no_key');
  assert.match(r.json().error, /Save the Team ID, Key ID and private key first/);
  // Bad boxes: plain words, the box named, nothing saved.
  const key = p8();
  for (const [body, field] of [[{ teamId: 'nope', keyId: 'ABC123DEFG', privateKey: key.pem }, 'teamId'], [{ teamId: '4KX4774V2U', keyId: 'x', privateKey: key.pem }, 'keyId'],
    [{ teamId: '4KX4774V2U', keyId: 'ABC123DEFG', privateKey: 'not a key' }, 'privateKey'], [{ teamId: '4KX4774V2U', keyId: 'ABC123DEFG' }, 'privateKey']]) {
    r = await admin('PUT', `${C}/apple`, { headers: JSON_HEADERS, body });
    assert.equal(r.status, 422, JSON.stringify(body).slice(0, 60));
    assert.equal(r.json().field, field);
  }
  assert.equal(d.docs('thirtyda_settings').length, 0);
  // Saved: sealed; the page gets the Team ID, the Key ID and the key's last 4 — never the key.
  r = await admin('PUT', `${C}/apple`, { headers: JSON_HEADERS, body: { teamId: '4kx4774v2u', keyId: 'abc123defg', privateKey: key.pem } });
  assert.equal(r.status, 200, r.body);
  apple = appleOf(r.json());
  assert.equal(apple.set, true);
  assert.deepEqual(apple.fields, { teamId: '4KX4774V2U', keyId: 'ABC123DEFG' });
  assert.deepEqual(apple.masks, { privateKey: key.body.slice(-4) });
  assert.equal(apple.keyOk, true);
  assert.equal(apple.live, false, 'saved, not tried');
  const everything = JSON.stringify([r.body, d.docs('thirtyda_settings'), d.docs('thirtyda_audit')]);
  assert.equal(everything.includes(key.body.slice(0, 40)), false, 'the key never in an answer, the settings (sealed) or the audit');
  const saved = d.docs('thirtyda_audit').find((a) => a.action === 'connection_save' && a.connection === 'apple');
  assert.deepEqual(saved.masks, { privateKey: key.body.slice(-4) });
  // An empty key box keeps the saved key (a new Key ID alone).
  r = await admin('PUT', `${C}/apple`, { headers: JSON_HEADERS, body: { teamId: '4KX4774V2U', keyId: 'ZZZ999YYYY', privateKey: '' } });
  assert.equal(r.status, 200);
  assert.deepEqual(appleOf(r.json()).masks, { privateKey: key.body.slice(-4) });
  assert.equal(appleOf(r.json()).fields.keyId, 'ZZZ999YYYY');
  // Remove: gone; the sign-in still works.
  r = await admin('DELETE', `${C}/apple`, { headers: JSON_HEADERS, body: {} });
  assert.equal(r.status, 200);
  assert.equal(appleOf(r.json()).set, false);
  assert.equal(appleOf(r.json()).signinWorks, true);
}));

test('Code page, Apple: the tower draws the key card (not "Later"), says the sign-in works without the key, and tries the key', () => {
  const js = readFileSync(new URL('../thirtyda-admin/connections.js', import.meta.url), 'utf8');
  assert.match(js, /function appleTower\(byId, data\) \{\n  return byId\.apple \? appleCard\(byId\.apple, data\) : laterTower\('apple'\);/);
  assert.match(js, /Sign-in works; add the key for token revoke on delete\./);
  assert.match(js, /call\('POST', `\$\{API\}\/apple\/try`, \{\}\)/);
  assert.match(js, /key: 'teamId', label: 'Team ID'[^\n]*fallback: '4KX4774V2U'/);
  assert.match(js, /key: 'privateKey', label: 'Private key \(\.p8\)', secret: true/);
  assert.match(js, /if \(c\.live\) return \{ pill: 'live', text: 'Live' \};/);
  assert.ok(js.includes("apple: () => 'Remove the Apple key?"), 'Remove has its own words');
  // The tower keeps its place: tenth, after YouTube (Wan 11, Places 12 and Translate 13 come after it).
  const order = [...js.slice(js.indexOf('const TOWERS = ['), js.indexOf('const towerNumber')).matchAll(/(?:signinTower|laterOne)\('([a-z-]+)'|key: '([a-z-]+)'/g)].map((m) => m[1] || m[2]);
  assert.deepEqual(order, ['tiktok', 'telegram-bot', 'telegram-gateway', 'facebook', 'google', 'whatsapp', 'wechat', 'alipay', 'youtube', 'apple', 'wan', 'places', 'translate', 'desk']);
});

test('Code page, Wan: "clips kept" counts the done jobs that still have their clip ({ $ne: null }), not the swept ones', async () => {
  const jobs = d.collection('thirtyda_hub_wan_jobs');
  const at = new Date();
  for (const [i, clip] of [[1, { key: 'k1', bytes: 10, type: 'video/mp4' }], [2, { key: 'k2', bytes: 10, type: 'video/mp4' }], [3, null]]) {
    await jobs.insertOne({ _id: String(i).repeat(32), status: 'done', source: 'client', client: 'x', clip, bytes: 0, createdAt: at });
  }
  const r = await admin('GET', '/30da/admin/api/connections');
  assert.equal(r.status, 200, r.body);
  assert.equal(r.json().wan.queue.clips, 2);
  // The fake itself, as Mongo: { $ne: null } keeps set values, drops null and missing.
  assert.deepEqual((await jobs.find({ clip: { $ne: null } }).toArray()).map((j) => j._id).sort(), ['1'.repeat(32), '2'.repeat(32)]);
});

// ---------------------------------------------------------------- the brand (owner 2026-10-15: "i still can not see the
// GK SMART Logo and the GK API HUB + 30DA name"): the logo, "GK API Hub · 30+DA" and the Super admin pill in the header
// of every admin page and on the sign-in panel; the tab icon on every page.

const ADMIN_PAGES = { monitor: 'Live overview', photos: 'Photos', questions: 'Questions', review: 'App review', support: 'Support', connections: 'Code', signin: 'Sign in' };
/** A PNG's width × height, from its IHDR. */
const pngSize = (buf) => {
  assert.ok(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'a PNG');
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
};

test('brand: every admin page and the sign-in panel show the GK SMART logo, then "GK API Hub · 30+DA", then the pill; the tab icon too', () => {
  for (const [page, name] of Object.entries(ADMIN_PAGES)) {
    const html = readFileSync(new URL(`../thirtyda-admin/${page}.html`, import.meta.url), 'utf8');
    const row = html.slice(html.indexOf('<div class="brand-row">'), html.indexOf('</div>', html.indexOf('<div class="brand-row">')));
    const logo = row.indexOf('<img class="brand-logo" src="/30da/admin/gk-smart-logo.png" width="36" height="36" alt="GK SMART">');
    const words = row.indexOf('<span class="brand-name"><span class="wordmark hub">GK API Hub</span><span class="brand-sep" aria-hidden="true">·</span><span class="wordmark">30+DA</span></span>');
    const pill = row.indexOf('<span class="pill">Super admin</span>');
    assert.ok(logo > 0 && words > logo && pill > words, `${page}: logo, then the name, then the pill`);
    if (page === 'signin') assert.ok(html.indexOf('<section class="signin-brand">') < html.indexOf('<div class="brand-row">'), 'on the brand panel');
    else assert.ok(html.indexOf('<header class="topbar">') < html.indexOf('<div class="brand-row">'), `${page}: in the top bar`);
    assert.ok(html.includes(`<title>${name} · GK API Hub · 30+DA Super admin</title>`), `${page}: the page's name first`);
    assert.match(html, /<link rel="icon" type="image\/png" sizes="32x32" href="\/30da\/admin\/gk-smart-favicon\.png">/, `${page}: the tab icon`);
    assert.equal(/style=|<script>/.test(html), false, `${page}: no inline style or script (the CSP)`);
  }
  // A phone (360 px): the name stacks, the search takes its own line, the pill stays (no longer hidden under 480 px).
  const css = readFileSync(new URL('../thirtyda-admin/app.css', import.meta.url), 'utf8');
  for (const rule of ['.brand-logo {', '.brand-name {', '.signin-brand .brand-name {', '.topbar .brand-name {', '.topbar .search { order: 3; flex: 1 0 100%; }']) assert.ok(css.includes(rule), rule);
  assert.equal(/\.topbar \.pill \{ display: none; \}/.test(css), false);
});

test('brand: on a tablet (761–915 px, iPad portrait) the fixed brand row squeezes the search, never Sign out ("Sign" over "out")', () => {
  const css = readFileSync(new URL('../thirtyda-admin/app.css', import.meta.url), 'utf8');
  const rule = (sel) => {
    const at = css.indexOf(`\n${sel} {`);
    assert.ok(at >= 0, sel);
    return css.slice(at, css.indexOf('}', at));
  };
  // The brand row (logo, one-line name, pill) does not shrink above 760 px; the search is the one that gives way.
  assert.match(rule('.topbar .brand-row'), /flex: none;/);
  assert.match(rule('.search'), /flex: 0 1 380px;/);
  // Sign out keeps its width and its one line.
  const signout = rule('.topbar .signout');
  assert.match(signout, /flex: none;/);
  assert.match(signout, /white-space: nowrap;/);
  assert.match(signout, /margin-left: auto;/);
});

test('brand: the logo (96 px) and the tab icon (32 px) are served as PNG, signed in or not; only those two names', async () => {
  for (const [file, px, max] of [['gk-smart-logo.png', 96, 20_000], ['gk-smart-favicon.png', 32, 4_000]]) {
    const onDisk = readFileSync(new URL(`../thirtyda-admin/${file}`, import.meta.url));
    assert.deepEqual(pngSize(onDisk), [px, px], file);
    assert.ok(onDisk.length < max, `${file}: small (${onDisk.length} bytes)`);
    for (const cookie of [null, TOKEN]) {
      const r = await admin('GET', `/30da/admin/${file}`, { cookie });
      assert.equal(r.status, 200, file);
      assert.equal(r.headers['Content-Type'], 'image/png');
      assert.equal(r.headers['X-Content-Type-Options'], 'nosniff');
      assert.ok(Buffer.from(r.raw).equals(onDisk), `${file}: the file's own bytes`);
    }
  }
  // The CSP lets the page show its own images (img-src falls back to default-src 'self').
  const page = await admin('GET', '/30da/admin', { cookie: null });
  assert.equal(page.status, 200);
  assert.ok(page.body.includes('src="/30da/admin/gk-smart-logo.png"'));
  assert.match(page.headers['Content-Security-Policy'], /default-src 'self'/);
  assert.equal(/img-src/.test(page.headers['Content-Security-Policy']), false);
  // Any other name is not a file: the admin's 404 (or the sign-in redirect for a page), never an image.
  for (const p of ['/30da/admin/gk-smart-logo.jpg', '/30da/admin/gk-smart-logo.png.bak', '/30da/admin/review/demo-w-1.jpg', '/30da/admin/x/gk-smart-logo.png', '/30da/admin/%2e%2e/lib/thirtyda-admin.mjs']) {
    const r = await admin('GET', p, { cookie: null });
    assert.notEqual(r.status, 200, p);
    assert.notEqual(r.headers['Content-Type'], 'image/png', p);
  }
});
