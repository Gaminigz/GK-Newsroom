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
        if (op === '$ne' && val(v) === val(want)) return false;
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
        find(q) { return { async toArray() { return all(q).map((x) => structuredClone(x)); } }; },
        async insertOne(doc) { const _id = doc._id ?? crypto.randomUUID(); docs.set(_id, structuredClone({ ...doc, _id })); return { insertedId: _id }; },
        async deleteOne(q) { const x = all(q)[0]; if (x) docs.delete(x._id); return { deletedCount: x ? 1 : 0 }; },
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
  res.end = (b) => { res.body = b === undefined ? undefined : String(b); return res; };
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
