// Run: npm run 30da:test (or node --test src/lib/thirtyda-telegram-bot.test.mjs)
// The free 30+DA Telegram bot (src/lib/thirtyda-telegram-bot.mjs): the bot key (save / try / remove, sealed and
// masked), the check (token hash, expiry, single use, browser binding, status → sign-in), the webhook's secret header,
// the own-contact rule and the digit match — with an in-memory Mongo stand-in and a fake Bot API: no database, no
// network, no real key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { clearSettingsCache, SETTINGS_COLLECTION, fieldsStatus } from './thirtyda-settings.mjs';
import { codeChannelConfigured, testCodesAllowed } from './thirtyda-code-send.mjs';
import {
  BOT_SETTING, TG_CHECKS, CHECK_TTL_MS, HOOK_PATH, BOT_TEXT, BOT_LANGS, SECRET_HEADER,
  CHECK_COOKIE_MAX_AGE_S, VERIFIED_GRACE_MS, MATCH_RE, maskPhone, phnomPenhTime, askVars,
  checkBotToken, saveBot, tryBot, removeBot, botOffer, botOffered, botView, botConfig, startCheck, pollCheck, checkId,
  newBrowserKey, readCheckCookie, checkCookie, hookSecretOk, parseUpdate, contactVerdict, phoneDigits, processUpdate,
  botReply, handleTelegramHook, startLink, cleanDescription, windowLimiter,
} from './thirtyda-telegram-bot.mjs';

const KEY_HEX = crypto.randomBytes(32).toString('hex');
const BOT_KEY = '7012345678:AAFakeE2EkeyABCDEFGHIJKLMNOPQRSTUVwx9';
const OTHER_KEY = '7099999999:AAOtherFakeKeyABCDEFGHIJKLMNOPQRSTU1234';
const ORIGIN = 'https://ggmt.sg';
const PHONE = '+85512345678';

// ---------------------------------------------------------------- an in-memory Mongo, just enough

const get = (doc, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc);
const cmp = (a, b) => (a instanceof Date ? a.getTime() : a) - (b instanceof Date ? b.getTime() : b);
function matches(doc, q) {
  for (const [k, cond] of Object.entries(q || {})) {
    if (k === '$or') { if (!cond.some((c) => matches(doc, c))) return false; continue; }
    const v = get(doc, k);
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && Object.keys(cond).some((x) => x.startsWith('$'))) {
      for (const [op, want] of Object.entries(cond)) {
        if (op === '$exists' && (v !== undefined) !== want) return false;
        if (op === '$gt' && !(v != null && cmp(v, want) > 0)) return false;
        if (op === '$ne' && v === want) return false;
        if (op === '$in' && !want.includes(v)) return false;
      }
    } else if (cond instanceof Date ? !(v instanceof Date && v.getTime() === cond.getTime()) : v !== cond) return false;
  }
  return true;
}
function apply(doc, u) {
  for (const [k, v] of Object.entries(u.$set || {})) doc[k] = structuredClone(v);
  for (const k of Object.keys(u.$unset || {})) delete doc[k];
  for (const [k, v] of Object.entries(u.$max || {})) if (doc[k] == null || cmp(v, doc[k]) > 0) doc[k] = v;
}
function fakeDb() {
  const cols = new Map();
  const collection = (name) => {
    if (!cols.has(name)) {
      const docs = new Map();
      const sorted = (q, sort) => {
        const list = [...docs.values()].filter((x) => matches(x, q));
        const [[field, dir] = []] = Object.entries(sort || {});
        if (field) list.sort((a, b) => dir * cmp(get(a, field) ?? 0, get(b, field) ?? 0));
        return list;
      };
      cols.set(name, {
        docs,
        async findOne(q, opts = {}) { const x = sorted(q, opts.sort)[0]; return x ? structuredClone(x) : null; },
        async insertOne(doc) { if (docs.has(doc._id)) throw Object.assign(new Error('dup'), { code: 11000 }); docs.set(doc._id, structuredClone(doc)); },
        async replaceOne(q, doc) { docs.set(q._id, structuredClone(doc)); return { acknowledged: true }; },
        async updateOne(q, u) { const x = sorted(q)[0]; if (!x) return { matchedCount: 0 }; apply(x, u); return { matchedCount: 1 }; },
        async updateMany(q, u) { const xs = sorted(q); xs.forEach((x) => apply(x, u)); return { matchedCount: xs.length }; },
        async deleteOne(q) { const x = sorted(q)[0]; return { deletedCount: x && docs.delete(x._id) ? 1 : 0 }; },
        async deleteMany(q) { const xs = sorted(q); xs.forEach((x) => docs.delete(x._id)); return { deletedCount: xs.length }; },
        async findOneAndUpdate(q, u) { const x = sorted(q)[0]; if (!x) return null; const before = structuredClone(x); apply(x, u); return before; },
      });
    }
    return cols.get(name);
  };
  return { collection, cols };
}

// ---------------------------------------------------------------- a fake Bot API

/** Answers getMe / setWebhook / getWebhookInfo / deleteWebhook / sendMessage like Telegram. opts.override[method] → { status, body }. */
function fakeBotApi(opts = {}) {
  const calls = [];
  const state = { hook: null, sent: [] };
  const fn = async (url, init) => {
    const m = String(url).match(/^https:\/\/api\.telegram\.org\/bot([^/]+)\/(\w+)$/);
    const body = JSON.parse(init.body || '{}');
    calls.push({ token: m?.[1], method: m?.[2], body });
    const reply = (status, json) => ({ status, json: async () => json });
    if (opts.network) throw new TypeError('fetch failed');
    const o = opts.override?.[m?.[2]];
    if (o) return reply(o.status ?? 200, o.body);
    if ((opts.revoked || []).includes(m?.[1])) return reply(401, { ok: false, error_code: 401, description: 'Unauthorized' });
    const id = Number(String(m?.[1]).split(':')[0]);
    switch (m?.[2]) {
      case 'getMe': return reply(200, { ok: true, result: { id, is_bot: true, first_name: '30+DA', username: id === 7012345678 ? 'ThirtyDA_bot' : 'Other_bot' } });
      case 'setWebhook': state.hook = { url: body.url, secret: body.secret_token, id }; return reply(200, { ok: true, result: true });
      case 'deleteWebhook': state.hook = null; return reply(200, { ok: true, result: true });
      case 'getWebhookInfo': return reply(200, { ok: true, result: { url: state.hook?.url ?? '', pending_update_count: 0, ...(opts.lastError ? { last_error_date: Math.floor(opts.lastError.at / 1000), last_error_message: opts.lastError.message } : {}) } });
      case 'sendMessage': state.sent.push(body); return reply(200, { ok: true, result: { message_id: 1 } });
      default: return reply(404, { ok: false, error_code: 404, description: 'Not Found' });
    }
  };
  fn.calls = calls;
  fn.state = state;
  return fn;
}

async function withKey(fn) {
  const prev = process.env.THIRTYDA_SECRET_KEY;
  process.env.THIRTYDA_SECRET_KEY = KEY_HEX;
  clearSettingsCache();
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.THIRTYDA_SECRET_KEY; else process.env.THIRTYDA_SECRET_KEY = prev;
    clearSettingsCache();
  }
}

/** A saved AND tried bot on a fresh fake db. */
async function readyBot() {
  const d = fakeDb();
  const api = fakeBotApi();
  const saved = await saveBot(d, BOT_KEY, { origin: ORIGIN, fetchImpl: api });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  const tried = await tryBot(d, { fetchImpl: api });
  assert.equal(tried.ok, true, JSON.stringify(tried));
  return { d, api, hookSecret: api.state.hook.secret };
}

// ---------------------------------------------------------------- the bot key

test('bot key: format check in plain words', () => {
  assert.deepEqual(checkBotToken(`  ${BOT_KEY}\n`), { ok: true, token: BOT_KEY });
  for (const bad of ['', 'abc', '12345:short', 'no-colon-AAFakeE2EkeyABCDEFGHIJKLMNOPQRSTUVwx9', `${BOT_KEY} x`, `${BOT_KEY}/`]) {
    const c = checkBotToken(bad);
    assert.equal(c.ok, false, bad);
    assert.match(c.error, /bot key|BotFather/);
  }
});

test('save: getMe → setWebhook (our address, a fresh random secret, only messages) → sealed; the view is masked', async () => {
  await withKey(async () => {
    const d = fakeDb();
    const api = fakeBotApi();
    const r = await saveBot(d, BOT_KEY, { origin: ORIGIN, fetchImpl: api });
    assert.deepEqual(r, { ok: true, username: 'ThirtyDA_bot', last4: 'wx9'.padStart(4, 'V') });
    assert.deepEqual(api.calls.map((c) => c.method), ['getMe', 'setWebhook']);
    const set = api.calls[1].body;
    assert.equal(set.url, `${ORIGIN}${HOOK_PATH}`);
    assert.deepEqual(set.allowed_updates, ['message']);
    assert.match(set.secret_token, /^[A-Za-z0-9_-]{43}$/, 'Telegram allows A-Z a-z 0-9 _ - (1–256)');
    const view = await botView(d);
    assert.equal(view.set, true);
    assert.equal(view.username, 'ThirtyDA_bot');
    assert.equal(view.link, 'https://t.me/ThirtyDA_bot');
    assert.equal(view.last4, BOT_KEY.slice(-4));
    assert.equal(view.offer.state, 'untested', 'a save starts not tried');
    const shown = JSON.stringify(view) + JSON.stringify(await fieldsStatus(d, BOT_SETTING));
    assert.ok(!shown.includes(BOT_KEY) && !shown.includes(BOT_KEY.slice(0, -4)), 'never the key');
    assert.ok(!shown.includes(set.secret_token) && !shown.includes(set.secret_token.slice(-4)), 'never the webhook secret, not even its last 4');
    const stored = JSON.stringify([...d.collection(SETTINGS_COLLECTION).docs.values()]);
    assert.ok(!stored.includes(BOT_KEY) && !stored.includes(set.secret_token), 'stored sealed');
    // A second save makes a new secret.
    await saveBot(d, BOT_KEY, { origin: ORIGIN, fetchImpl: api });
    assert.notEqual(api.calls.at(-1).body.secret_token, set.secret_token);
  });
});

test('save: Telegram refusals come back in plain words and nothing is saved', async () => {
  await withKey(async () => {
    const d = fakeDb();
    let r = await saveBot(d, BOT_KEY, { origin: ORIGIN, fetchImpl: fakeBotApi({ revoked: [BOT_KEY] }) });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'bad_token');
    assert.match(r.error, /did not accept this bot key/);
    r = await saveBot(d, BOT_KEY, {
      origin: 'http://localhost:8096',
      fetchImpl: fakeBotApi({ override: { setWebhook: { status: 400, body: { ok: false, error_code: 400, description: 'Bad Request: bad webhook: An HTTPS URL must be provided for webhook' } } } }),
    });
    assert.equal(r.reason, 'bad_webhook');
    assert.match(r.error, /https address/);
    r = await saveBot(d, BOT_KEY, { origin: ORIGIN, fetchImpl: fakeBotApi({ network: true }) });
    assert.equal(r.reason, 'network');
    r = await saveBot(d, 'nonsense', { origin: ORIGIN, fetchImpl: fakeBotApi() });
    assert.equal(r.reason, 'format');
    assert.equal((await botView(d)).set, false);
    assert.equal(await botConfig(d), null);
  });
});

test('save without the lock key: refused before Telegram is called', async () => {
  const prev = process.env.THIRTYDA_SECRET_KEY;
  delete process.env.THIRTYDA_SECRET_KEY;
  try {
    const api = fakeBotApi();
    await assert.rejects(saveBot(fakeDb(), BOT_KEY, { origin: ORIGIN, fetchImpl: api }), (e) => e.code === 'no_key');
    assert.equal(api.calls.length, 0);
  } finally {
    if (prev !== undefined) process.env.THIRTYDA_SECRET_KEY = prev;
  }
});

test('try: offered only after getMe + getWebhookInfo pass; a moved webhook or a delivery error stops it; a new save starts over', async () => {
  await withKey(async () => {
    const d = fakeDb();
    const api = fakeBotApi();
    assert.equal((await tryBot(d, { fetchImpl: api })).reason, 'not_set');
    await saveBot(d, BOT_KEY, { origin: ORIGIN, fetchImpl: api });
    assert.equal(await botOffered(d), false, 'saved is not offered');
    let r = await tryBot(d, { fetchImpl: api });
    assert.equal(r.ok, true);
    assert.equal(await botOffered(d), true);
    assert.equal((await botView(d)).lastTry.ok, true);
    // Somebody pointed the bot elsewhere (another copy of the app with the same key).
    api.state.hook.url = 'https://elsewhere.example/hook';
    r = await tryBot(d, { fetchImpl: api });
    assert.equal(r.reason, 'moved');
    assert.match(r.error, /elsewhere\.example/);
    assert.deepEqual([(await botOffer(d)).state, await botOffered(d)], ['stopped', false]);
    // Save again → untested; try → on.
    await saveBot(d, BOT_KEY, { origin: ORIGIN, fetchImpl: api });
    assert.equal((await botOffer(d)).state, 'untested');
    assert.equal((await tryBot(d, { fetchImpl: api })).ok, true);
    // A delivery error since the save.
    const failing = fakeBotApi({ lastError: { at: Date.now() + 1000, message: 'Wrong response from the webhook: 401 Unauthorized' } });
    failing.state.hook = { url: `${ORIGIN}${HOOK_PATH}` };
    r = await tryBot(d, { fetchImpl: failing });
    assert.equal(r.reason, 'hook_error');
    assert.match(r.detail, /401 Unauthorized/);
    assert.equal(await botOffered(d), false);
    // A key Telegram no longer takes.
    r = await tryBot(d, { fetchImpl: fakeBotApi({ revoked: [BOT_KEY] }) });
    assert.equal(r.reason, 'bad_token');
  });
});

test('a saved bot ends on-screen test codes (like a saved code channel); remove brings them back', async () => {
  await withKey(async () => {
    const d = fakeDb();
    const api = fakeBotApi();
    assert.equal(await testCodesAllowed(d, true), true);
    await saveBot(d, BOT_KEY, { origin: ORIGIN, fetchImpl: api });
    assert.equal(await codeChannelConfigured(d), true);
    assert.equal(await testCodesAllowed(d, true), false);
    await startCheck(d, { phone: PHONE, browser: newBrowserKey() });
    const r = await removeBot(d, { fetchImpl: api });
    assert.deepEqual(r, { removed: true, webhookDeleted: true });
    assert.equal(api.calls.at(-1).method, 'deleteWebhook');
    assert.equal(await testCodesAllowed(d, true), true);
    assert.equal(d.collection(TG_CHECKS).docs.size, 0, 'open checks end with the bot');
  });
});

test('replacing the bot with another one: the old bot stops sending here', async () => {
  await withKey(async () => {
    const d = fakeDb();
    const api = fakeBotApi();
    await saveBot(d, BOT_KEY, { origin: ORIGIN, fetchImpl: api });
    await saveBot(d, OTHER_KEY, { origin: ORIGIN, fetchImpl: api });
    const del = api.calls.find((c) => c.method === 'deleteWebhook');
    assert.equal(del?.token, BOT_KEY);
    assert.equal((await botView(d)).username, 'Other_bot');
  });
});

// ---------------------------------------------------------------- the check

test('check: only the token hash is stored, 10 minutes, bound to the browser, one per browser', async () => {
  const d = fakeDb();
  const browser = newBrowserKey();
  const now = Date.now();
  const { token, expiresAt } = await startCheck(d, { phone: PHONE, lang: 'km', browser, now });
  assert.match(token, /^[A-Za-z0-9_-]{32}$/, 'fits a t.me start parameter');
  assert.equal(expiresAt, now + CHECK_TTL_MS);
  const docs = [...d.collection(TG_CHECKS).docs.values()];
  assert.equal(docs.length, 1);
  assert.equal(docs[0]._id, crypto.createHash('sha256').update(token).digest('hex'));
  assert.ok(!JSON.stringify(docs).includes(token), 'never the token itself');
  assert.ok(!JSON.stringify(docs).includes(browser), 'never the cookie itself');
  assert.equal(docs[0].lang, 'km');
  assert.equal(startLink('ThirtyDA_bot', token), `https://t.me/ThirtyDA_bot?start=${token}`);
  // A new start from the same browser (it sends its old cookie) ends the old check.
  const next = newBrowserKey();
  await startCheck(d, { phone: PHONE, browser: next, previousBrowser: browser, now });
  assert.equal(d.collection(TG_CHECKS).docs.size, 1);
  assert.deepEqual(await pollCheck(d, browser, { now }), { state: 'none' });
  assert.equal((await pollCheck(d, next, { now })).state, 'waiting');
  assert.deepEqual(await pollCheck(d, 'not-a-key', { now }), { state: 'none' });
  assert.equal(await startCheck(d, { phone: PHONE, browser: 'x' }).catch((e) => e.message), 'A check needs a browser key.');
});

test('check cookie: HttpOnly, SameSite=Lax, only for /30da/api/auth/telegram, Secure on https', () => {
  const v = newBrowserKey();
  const https = checkCookie({ headers: { host: 'ggmt.sg' } }, v);
  assert.match(https, new RegExp(`^thirtyda_tg=${v}; HttpOnly; SameSite=Lax; Path=/30da/api/auth/telegram; Max-Age=720; Secure$`));
  // The cookie outlives every check the server may still hand over: the 10 minutes + the verified grace.
  const maxAge = Number(https.match(/Max-Age=(\d+)/)[1]);
  assert.ok(maxAge >= (CHECK_TTL_MS + VERIFIED_GRACE_MS) / 1000, `Max-Age ${maxAge}`);
  assert.equal(CHECK_COOKIE_MAX_AGE_S, maxAge);
  assert.match(checkCookie({ headers: { host: 'ggmt.sg' } }, '', 0), /; Max-Age=0; Secure$/, 'clearing it');
  assert.ok(!checkCookie({ headers: { host: 'localhost:8096' } }, v).includes('Secure'));
  assert.equal(readCheckCookie({ headers: { cookie: `a=1; thirtyda_tg=${v}; b=2` } }), v);
  assert.equal(readCheckCookie({ headers: { cookie: 'thirtyda_tg=zzz' } }), null);
});

test('status: waiting → expired after 10 minutes (said once, then gone)', async () => {
  const d = fakeDb();
  const browser = newBrowserKey();
  const t0 = Date.now();
  await startCheck(d, { phone: PHONE, browser, now: t0 });
  const w = await pollCheck(d, browser, { now: t0 + 1000 });
  assert.deepEqual(w, { state: 'waiting', opened: false, expiresIn: 599 });
  assert.deepEqual(await pollCheck(d, browser, { now: t0 + CHECK_TTL_MS + 1 }), { state: 'expired' });
  assert.deepEqual(await pollCheck(d, browser, { now: t0 + CHECK_TTL_MS + 2 }), { state: 'none' });
});

test('status → sign-in: a verified check signs in ONCE (single use), its PIN hash goes with it and is dropped', async () => {
  const d = fakeDb();
  const browser = newBrowserKey();
  const now = Date.now();
  const { token } = await startCheck(d, { phone: PHONE, browser, pinHash: 'scrypt$fake', now });
  await processUpdate(d, parseUpdate(startUpdate(token, 111)), now);
  await processUpdate(d, parseUpdate(contactUpdate(111, { user_id: 111, phone_number: '85512345678' })), now);
  const signedIn = [];
  const onVerified = async (check) => { signedIn.push(check); return { ok: true, existing: false, user: null }; };
  const [a, b] = await Promise.all([pollCheck(d, browser, { onVerified, now }), pollCheck(d, browser, { onVerified, now })]);
  assert.deepEqual([a.state, b.state].sort(), ['none', 'verified'], 'two polls at once: one signs in');
  assert.equal(signedIn.length, 1);
  assert.equal(signedIn[0].phone, PHONE);
  assert.equal(signedIn[0].pinHash, 'scrypt$fake');
  const verified = a.state === 'verified' ? a : b;
  assert.deepEqual(verified, { ok: true, existing: false, user: null, state: 'verified' });
  assert.deepEqual(await pollCheck(d, browser, { onVerified, now }), { state: 'none' });
  const left = [...d.collection(TG_CHECKS).docs.values()][0];
  assert.equal(left.state, 'used');
  assert.ok(!('pinHash' in left), 'the PIN hash does not stay');
  assert.equal(left.tgUserId, 111, 'the Telegram user id is kept');
  // Another browser never gets it.
  assert.deepEqual(await pollCheck(d, newBrowserKey(), { onVerified, now }), { state: 'none' });
});

test('verified in the last minutes: still collected after the 10 minutes (the grace), and the cookie lasts that long', async () => {
  const d = fakeDb();
  const browser = newBrowserKey();
  const t0 = Date.now();
  const { token } = await startCheck(d, { phone: PHONE, browser, now: t0 });
  const sharedAt = t0 + 9.5 * 60e3; // shared at 9:30
  await processUpdate(d, parseUpdate(startUpdate(token, 111)), sharedAt);
  assert.equal(kl(await processUpdate(d, parseUpdate(contactUpdate(111, { user_id: 111, phone_number: '85512345678' })), sharedAt)).kind, 'done');
  const pollAt = t0 + 11 * 60e3; // the next poll comes at 11:00 (back from Telegram late, or a hidden tab)
  assert.ok(pollAt < t0 + CHECK_COOKIE_MAX_AGE_S * 1000, 'the browser still has its cookie then');
  const signed = [];
  const r = await pollCheck(d, browser, { now: pollAt, onVerified: async (c) => { signed.push(c.phone); return { ok: true }; } });
  assert.deepEqual(r, { ok: true, state: 'verified' });
  assert.deepEqual(signed, [PHONE]);
  // Past the grace, a verified check that nobody collected reads expired.
  const b2 = newBrowserKey();
  const { token: t2 } = await startCheck(d, { phone: PHONE, browser: b2, now: t0 });
  await processUpdate(d, parseUpdate(startUpdate(t2, 222)), sharedAt);
  await processUpdate(d, parseUpdate(contactUpdate(222, { user_id: 222, phone_number: '85512345678' })), sharedAt);
  assert.deepEqual(await pollCheck(d, b2, { now: sharedAt + VERIFIED_GRACE_MS + 1 }), { state: 'expired' });
  assert.ok(CHECK_COOKIE_MAX_AGE_S * 1000 >= 9.99 * 60e3 + VERIFIED_GRACE_MS, 'a share in the last second is still collectable');
});

// ---------------------------------------------------------------- the webhook

/** A plan's kind + language (an ask's vars are checked on their own). */
const kl = (plan) => (plan ? { kind: plan.kind, lang: plan.lang } : plan);
let updateId = 1;
const person = (id, lang = 'en') => ({ id, is_bot: false, first_name: 'P', language_code: lang });
const startUpdate = (token, from, lang) => ({ update_id: updateId++, message: { message_id: 1, from: person(from, lang), chat: { id: from, type: 'private' }, date: 1, text: `/start ${token}` } });
const contactUpdate = (from, contact) => ({ update_id: updateId++, message: { message_id: 2, from: person(from), chat: { id: from, type: 'private' }, date: 1, contact: { first_name: 'P', ...contact } } });
const textUpdate = (from, text) => ({ update_id: updateId++, message: { message_id: 3, from: person(from), chat: { id: from, type: 'private' }, date: 1, text } });

test('secret header: only the saved secret matches', () => {
  const s = crypto.randomBytes(32).toString('base64url');
  assert.equal(hookSecretOk(s, s), true);
  for (const bad of [undefined, '', `${s}x`, s.slice(1), 'x', s.toUpperCase()]) assert.equal(hookSecretOk(bad, s), false, String(bad));
  assert.equal(hookSecretOk(s, ''), false);
  assert.equal(hookSecretOk(s, undefined), false);
});

test('updates: /start <token>, contacts, text; groups, channels, bots and edits are ignored', () => {
  const tok = 'A'.repeat(32);
  // [support] messageId (to delete a shared contact), firstName + username (who wrote, for the Support page).
  assert.deepEqual(parseUpdate(startUpdate(tok, 5, 'km')), { fromId: 5, chatId: 5, langCode: 'km', messageId: 1, firstName: 'P', username: null, kind: 'start', token: tok, hadParam: true });
  assert.equal(parseUpdate(textUpdate(5, `/start@ThirtyDA_bot ${tok}`)).token, tok);
  assert.deepEqual(parseUpdate(textUpdate(5, '/start')), { fromId: 5, chatId: 5, langCode: 'en', messageId: 3, firstName: 'P', username: null, kind: 'start', token: null, hadParam: false });
  assert.equal(parseUpdate(textUpdate(5, '/start not-a-token')).token, null);
  assert.equal(parseUpdate(textUpdate(5, '+855 12 345 678')).kind, 'other');
  assert.deepEqual(parseUpdate(contactUpdate(5, { user_id: 5, phone_number: '85512345678' })).contact, { userId: 5, phone: '85512345678' });
  assert.equal(parseUpdate({ message: { from: person(5), chat: { id: -100, type: 'group' }, text: `/start ${tok}` } }).kind, 'ignore');
  assert.equal(parseUpdate({ message: { from: { id: 9, is_bot: true }, chat: { id: 9, type: 'private' }, text: 'x' } }).kind, 'ignore');
  assert.equal(parseUpdate({ edited_message: { from: person(5), chat: { id: 5, type: 'private' }, text: 'x' } }).kind, 'ignore');
  assert.equal(parseUpdate(null).kind, 'ignore');
});

test('own-contact rule + digit match', () => {
  assert.equal(contactVerdict({ userId: 42, phone: '85512345678' }, 42, '+85512345678'), 'ok');
  assert.equal(contactVerdict({ userId: 42, phone: '+855 12-345 678' }, 42, '+85512345678'), 'ok', 'only the digits count');
  assert.equal(contactVerdict({ userId: 43, phone: '85512345678' }, 42, '+85512345678'), 'not_own', 'someone else\'s contact, even with the right number');
  assert.equal(contactVerdict({ userId: null, phone: '85512345678' }, 42, '+85512345678'), 'not_own', 'a contact Telegram does not tie to an account');
  assert.equal(contactVerdict({ userId: '42', phone: '85512345678' }, 42, '+85512345678'), 'not_own', 'ids are numbers');
  assert.equal(contactVerdict({ userId: 42, phone: '85512345679' }, 42, '+85512345678'), 'mismatch');
  assert.equal(contactVerdict({ userId: 42, phone: '8551234567' }, 42, '+85512345678'), 'mismatch', 'a digit short');
  assert.equal(contactVerdict({ userId: 42, phone: '' }, 42, '+85512345678'), 'mismatch');
  assert.equal(phoneDigits('+855 (12) 345-678'), '85512345678');
});

test('bot: /start binds the check to the FIRST Telegram user; a typed number is never believed; someone else\'s contact is refused', async () => {
  const d = fakeDb();
  const browser = newBrowserKey();
  const now = Date.now();
  const { token } = await startCheck(d, { phone: PHONE, lang: 'ko', browser, now });
  assert.deepEqual(kl(await processUpdate(d, parseUpdate(startUpdate(token, 111, 'en')), now)), { kind: 'ask', lang: 'ko' }, 'the check\'s language wins');
  assert.equal((await pollCheck(d, browser, { now })).opened, true);
  assert.deepEqual(kl(await processUpdate(d, parseUpdate(startUpdate(token, 222)), now)), { kind: 'expired', lang: 'ko' }, 'a second Telegram user cannot take the link');
  assert.deepEqual(kl(await processUpdate(d, parseUpdate(startUpdate(token, 111)), now)), { kind: 'ask', lang: 'ko' }, 'the same person may open it again');
  assert.deepEqual(kl(await processUpdate(d, parseUpdate(textUpdate(111, '85512345678')), now)), { kind: 'ask', lang: 'ko' }, 'text → the button again');
  assert.deepEqual(kl(await processUpdate(d, parseUpdate(contactUpdate(111, { user_id: 999, phone_number: '85512345678' })), now)), { kind: 'not_own', lang: 'ko' });
  assert.deepEqual(kl(await processUpdate(d, parseUpdate(contactUpdate(222, { user_id: 222, phone_number: '85512345678' })), now)), { kind: 'help', lang: 'en' }, 'not bound to 222');
  assert.equal((await pollCheck(d, browser, { now })).state, 'waiting', 'still waiting after all that');
  assert.deepEqual(kl(await processUpdate(d, parseUpdate(contactUpdate(111, { user_id: 111, phone_number: '+85512345678' })), now)), { kind: 'done', lang: 'ko' });
  assert.equal((await d.collection(TG_CHECKS).findOne({ _id: checkId(token) })).state, 'verified');
  // Late or repeated updates change nothing.
  assert.deepEqual(kl(await processUpdate(d, parseUpdate(contactUpdate(111, { user_id: 111, phone_number: '85599999999' })), now)), { kind: 'help', lang: 'en' });
  assert.deepEqual(kl(await processUpdate(d, parseUpdate(startUpdate(token, 111)), now)), { kind: 'expired', lang: 'ko' });
  assert.equal((await d.collection(TG_CHECKS).findOne({ _id: checkId(token) })).state, 'verified');
});

test('bot: their own number but not the typed one → mismatch (said once to the app); expired and unknown links', async () => {
  const d = fakeDb();
  const browser = newBrowserKey();
  const now = Date.now();
  const { token } = await startCheck(d, { phone: PHONE, browser, now });
  await processUpdate(d, parseUpdate(startUpdate(token, 111)), now);
  assert.deepEqual(kl(await processUpdate(d, parseUpdate(contactUpdate(111, { user_id: 111, phone_number: '85587654321' })), now)), { kind: 'mismatch', lang: 'en' });
  assert.deepEqual(await pollCheck(d, browser, { now }), { state: 'mismatch' });
  assert.deepEqual(await pollCheck(d, browser, { now }), { state: 'none' });
  // Expired: /start after 10 minutes.
  const b2 = newBrowserKey();
  const { token: t2 } = await startCheck(d, { phone: PHONE, browser: b2, now });
  assert.deepEqual(kl(await processUpdate(d, parseUpdate(startUpdate(t2, 111, 'ja')), now + CHECK_TTL_MS + 1)), { kind: 'expired', lang: 'en' });
  // A link that never existed, or no token: calm words in the person's Telegram language.
  assert.deepEqual(kl(await processUpdate(d, parseUpdate(startUpdate('B'.repeat(32), 5, 'zh-hans')), now)), { kind: 'expired', lang: 'zh' });
  assert.deepEqual(kl(await processUpdate(d, parseUpdate(textUpdate(5, '/start')), now)), { kind: 'help', lang: 'en' });
  assert.equal(await processUpdate(d, { kind: 'ignore' }, now), null);
});

test('bot replies: the one-button keyboard asks for the contact; done / mismatch remove it; 5 languages', () => {
  const vars = { phone: '+855 ••••• 678', time: '14:05', mark: '🍊 47' };
  const ask = botReply('ask', 'km', 77, vars);
  assert.equal(ask.chat_id, 77);
  assert.equal(ask.text, BOT_TEXT.km.ask.replace('{phone}', vars.phone).replace('{time}', vars.time).replace('{mark}', vars.mark));
  assert.deepEqual(ask.reply_markup, { keyboard: [[{ text: BOT_TEXT.km.button, request_contact: true }]], one_time_keyboard: true, resize_keyboard: true });
  assert.ok(botReply('not_own', 'en', 1).reply_markup.keyboard[0][0].request_contact);
  for (const k of ['done', 'mismatch', 'expired', 'help']) assert.deepEqual(botReply(k, 'en', 1).reply_markup, { remove_keyboard: true }, k);
  assert.equal(BOT_TEXT.en.done, 'Number verified ✓ Go back to 30+DA.');
  assert.equal(BOT_TEXT.en.mismatch, 'That number is not the one you typed in 30+DA. In 30+DA, type the same number your Telegram uses, with its country code, then tap Telegram again.');
  assert.equal(BOT_TEXT.en.button, 'Share my number');
  for (const lang of BOT_LANGS) {
    for (const k of Object.keys(BOT_TEXT.en)) assert.ok(BOT_TEXT[lang][k]?.length > 1, `${lang}.${k}`);
    assert.ok(BOT_TEXT[lang].done.includes('✓') && BOT_TEXT[lang].done.includes('30+DA'), lang);
  }
  assert.equal(botReply('ask', 'xx', 1, vars).text, botReply('ask', 'en', 1, vars).text, 'an unknown language → English');
  assert.ok(!/[{}]/.test(botReply('ask', 'en', 1).text), 'never a raw {placeholder}, even without vars');
});

test('a forwarded link is caught: the ask names the Phnom Penh time and the sign the app shows (never the number); it warns', async () => {
  const d = fakeDb();
  const browser = newBrowserKey();
  const t0 = Date.UTC(2026, 9, 13, 7, 5); // 14:05 in Phnom Penh (UTC+7), whatever the server's own zone
  const { token, match } = await startCheck(d, { phone: PHONE, lang: 'en', browser, now: t0 });
  assert.match(match, MATCH_RE, 'a sign + 2 digits, e.g. "🍊 47"');
  assert.equal((await d.collection(TG_CHECKS).findOne({ _id: checkId(token) })).match, match, 'kept on the check (not a secret)');
  const marks = new Set();
  for (let i = 0; i < 40; i++) marks.add((await startCheck(fakeDb(), { phone: PHONE, browser: newBrowserKey(), now: t0 })).match);
  assert.ok(marks.size > 20, `signs vary (${marks.size}/40 different)`);
  assert.equal(maskPhone(PHONE), '+855 ••••• 678');
  assert.equal(maskPhone('+12'), '•••');
  assert.equal(phnomPenhTime(t0), '14:05');
  assert.equal(phnomPenhTime(Date.UTC(2026, 9, 13, 20, 30)), '03:30', 'past midnight in Phnom Penh');
  const plan = await processUpdate(d, parseUpdate(startUpdate(token, 111)), t0 + 60e3);
  assert.equal(plan.kind, 'ask');
  // [support] owner 2026-10-13: "I do not want it to show my number" — the ask names the time and the sign only.
  assert.deepEqual(plan.vars, { time: '14:05', mark: match });
  assert.deepEqual(askVars(null), { time: '—', mark: '—' });
  const text = botReply(plan.kind, plan.lang, 111, plan.vars).text;
  assert.equal(text, `GKVerify — confirm your number for 30+DA (14:05, Phnom Penh time).\nCheck that your 30+DA screen shows ${match}, then tap the button to share your number.\nIf someone sent you this link, do not tap.`);
  assert.ok(!text.includes(PHONE) && !text.includes('678') && !text.includes('•'), 'never the number, not even masked');
  // A number typed as text gets the same ask again (words that are not a number go to support instead).
  const again = await processUpdate(d, parseUpdate(textUpdate(111, '012 345 678')), t0 + 61e3);
  assert.deepEqual(again.vars, plan.vars);
  // Every language names the time and the sign, never a {phone}, and warns (a link someone sent: do not tap).
  const warn = { en: 'If someone sent you this link', km: 'នរណាម្នាក់ផ្ញើតំណនេះ', zh: '别人发给你的', ko: '누군가 이 링크를', ja: '誰かからこのリンク' };
  for (const lang of BOT_LANGS) {
    for (const k of ['{time}', '{mark}']) assert.ok(BOT_TEXT[lang].ask.includes(k), `${lang}.ask has ${k}`);
    assert.ok(!BOT_TEXT[lang].ask.includes('{phone}'), `${lang}.ask has no {phone}`);
    const filled = botReply('ask', lang, 1, plan.vars).text;
    assert.ok(filled.includes(match) && !filled.includes('•') && filled.includes('14:05') && filled.includes(warn[lang]) && !/[{}]/.test(filled), lang);
  }
});

// ---------------------------------------------------------------- the webhook over HTTP

function hookReq(headers, body) {
  // A real stream: the body waits until the handler reads it (after its own awaits).
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = 'POST';
  req.headers = headers;
  return req;
}
function hookRes() {
  const res = { status: null, headersSent: false };
  res.writeHead = (s) => { res.status = s; res.headersSent = true; return res; };
  res.end = () => {};
  return res;
}

test('webhook: a wrong or missing secret header → 401, nothing read, nothing sent; the right one → the reply in the check\'s language', async () => {
  await withKey(async () => {
    const { d, api, hookSecret } = await readyBot();
    const browser = newBrowserKey();
    const { token } = await startCheck(d, { phone: PHONE, lang: 'km', browser });
    const sentBefore = api.state.sent.length;
    for (const headers of [{}, { [SECRET_HEADER]: 'wrong' }, { [SECRET_HEADER]: `${hookSecret}x` }]) {
      const res = hookRes();
      await handleTelegramHook(hookReq(headers, startUpdate(token, 111)), res, { db: async () => d, fetchImpl: api });
      assert.equal(res.status, 401);
    }
    assert.equal(api.state.sent.length, sentBefore, 'no reply to a forged update');
    assert.equal((await pollCheck(d, browser)).opened, false, 'and the check was not touched');
    const res = hookRes();
    await handleTelegramHook(hookReq({ [SECRET_HEADER]: hookSecret }, startUpdate(token, 111)), res, { db: async () => d, fetchImpl: api });
    assert.equal(res.status, 200);
    const check = await d.collection(TG_CHECKS).findOne({ _id: checkId(token) });
    assert.equal(api.state.sent.at(-1).text, botReply('ask', 'km', 111, askVars(check)).text);
    assert.ok(api.state.sent.at(-1).text.includes(check.match), 'the sign the app shows');
    assert.equal(api.state.sent.at(-1).reply_markup.keyboard[0][0].request_contact, true);
    // Someone else's contact: refused, still waiting.
    await handleTelegramHook(hookReq({ [SECRET_HEADER]: hookSecret }, contactUpdate(111, { user_id: 5, phone_number: '85512345678' })), hookRes(), { db: async () => d, fetchImpl: api });
    assert.equal(api.state.sent.at(-1).text, BOT_TEXT.km.not_own);
    assert.equal((await pollCheck(d, browser)).state, 'waiting');
    // Their own: done.
    await handleTelegramHook(hookReq({ [SECRET_HEADER]: hookSecret }, contactUpdate(111, { user_id: 111, phone_number: '85512345678' })), hookRes(), { db: async () => d, fetchImpl: api });
    assert.equal(api.state.sent.at(-1).text, BOT_TEXT.km.done);
    assert.deepEqual(api.state.sent.at(-1).reply_markup, { remove_keyboard: true });
    // With no bot saved every update is refused.
    await removeBot(d, { fetchImpl: api });
    const gone = hookRes();
    await handleTelegramHook(hookReq({ [SECRET_HEADER]: hookSecret }, textUpdate(111, 'hi')), gone, { db: async () => d, fetchImpl: api });
    assert.equal(gone.status, 401);
  });
});

test('webhook: a reply Telegram refuses with 401 (key revoked) stops the bot in the app', async () => {
  await withKey(async () => {
    const { d, hookSecret } = await readyBot();
    assert.equal(await botOffered(d), true);
    const revoked = fakeBotApi({ revoked: [BOT_KEY] });
    await handleTelegramHook(hookReq({ [SECRET_HEADER]: hookSecret }, textUpdate(5, 'hello')), hookRes(), { db: async () => d, fetchImpl: revoked });
    const o = await botOffer(d);
    assert.deepEqual([o.state, o.reason], ['stopped', 'bad_token']);
  });
});

test('Telegram\'s words never carry the key; limits count per key', () => {
  assert.equal(cleanDescription(`Not Found: bot${BOT_KEY} gone`, BOT_KEY), 'Not Found: bot… gone');
  assert.equal(cleanDescription('a\nb'), 'a b');
  const lim = windowLimiter(1000);
  assert.equal(lim.over('k', 2, 0), false);
  assert.equal(lim.over('k', 2, 1), false);
  assert.equal(lim.over('k', 2, 2), true);
  assert.equal(lim.over('j', 2, 2), false);
  assert.equal(lim.over('k', 2, 1500), false, 'the window slides');
});
