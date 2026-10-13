// Run: npm run 30da:test (or node --test src/lib/thirtyda-support.test.mjs)
// Support through the 30+DA Telegram bot (src/lib/thirtyda-support.mjs) and the owner's "hide the number" rules for
// the bot (src/lib/thirtyda-telegram-bot.mjs): a shared contact is deleted from the chat, no reply ever carries a
// phone number, a support message is stored and thanked once a day, the hourly limit, the admin reply's call shape,
// and the bot's profile words. In-memory Mongo stand-in + a fake Bot API: no database, no network, no real key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { clearSettingsCache } from './thirtyda-settings.mjs';
import {
  BOT_TEXT, BOT_LANGS, SECRET_HEADER, TG_LINKS, saveBot, tryBot, startCheck, newBrowserKey, parseUpdate, processUpdate,
  botReply, askVars, handleTelegramHook, looksLikePhone, windowLimiter,
} from './thirtyda-telegram-bot.mjs';
import {
  SUPPORT, SUPPORT_CHATS, SUPPORT_PER_HOUR, recordSupport, listSupportChats, supportThread, sendSupportReply,
  supportUnread, describeBot, guessLang, phnomPenhDay, supportText, BOT_DESCRIPTION, BOT_SHORT_DESCRIPTION,
} from './thirtyda-support.mjs';

const KEY_HEX = crypto.randomBytes(32).toString('hex');
const BOT_KEY = '7012345678:AAFakeSupportKeyABCDEFGHIJKLMNOPQRSTUV9';
const PHONE = '+85512345678';

// ---------------------------------------------------------------- an in-memory Mongo, just enough
const get = (doc, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc);
const val = (v) => (v instanceof Date ? v.getTime() : v);
function matches(doc, q) {
  for (const [k, cond] of Object.entries(q || {})) {
    if (k === '$or') { if (!cond.some((c) => matches(doc, c))) return false; continue; }
    const v = get(doc, k);
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && Object.keys(cond).some((x) => x.startsWith('$'))) {
      for (const [op, want] of Object.entries(cond)) {
        if (op === '$exists' && (v !== undefined) !== want) return false;
        if (op === '$gt' && !(v != null && val(v) > val(want))) return false;
        if (op === '$ne' && v === want) return false;
        if (op === '$in' && !want.includes(v)) return false;
      }
    } else if (val(v) !== val(cond)) return false;
  }
  return true;
}
function apply(doc, u, inserting) {
  for (const [k, v] of Object.entries(u.$set || {})) doc[k] = structuredClone(v);
  if (inserting) for (const [k, v] of Object.entries(u.$setOnInsert || {})) doc[k] = structuredClone(v);
  for (const k of Object.keys(u.$unset || {})) delete doc[k];
  for (const [k, v] of Object.entries(u.$inc || {})) doc[k] = (doc[k] || 0) + v;
  for (const [k, v] of Object.entries(u.$max || {})) if (doc[k] == null || val(v) > val(doc[k])) doc[k] = v;
}
function fakeDb() {
  const cols = new Map();
  let seq = 0;
  const collection = (name) => {
    if (!cols.has(name)) {
      const docs = new Map();
      const sorted = (q, sort) => {
        const list = [...docs.values()].filter((x) => matches(x, q));
        const [[field, dir] = []] = Object.entries(sort || {});
        if (field) list.sort((a, b) => dir * (val(get(a, field) ?? 0) - val(get(b, field) ?? 0)));
        return list;
      };
      const upsertDoc = (q) => { const d = { _id: q._id }; docs.set(q._id, d); return d; };
      cols.set(name, {
        docs,
        async createIndex() { return 'ok'; },
        async replaceOne(q, doc) { docs.set(q._id, structuredClone(doc)); return { acknowledged: true }; },
        async deleteOne(q) { const x = sorted(q)[0]; return { deletedCount: x && docs.delete(x._id) ? 1 : 0 }; },
        async findOne(q, opts = {}) { const x = sorted(q, opts.sort)[0]; return x ? structuredClone(x) : null; },
        find(q) {
          let sort = null; let limit = Infinity;
          const cur = { sort(s) { sort = s; return cur; }, limit(n) { limit = n; return cur; }, async toArray() { return sorted(q, sort).slice(0, limit).map((x) => structuredClone(x)); } };
          return cur;
        },
        async insertOne(doc) {
          const id = doc._id ?? `oid${++seq}`;
          if (docs.has(id)) throw Object.assign(new Error('dup'), { code: 11000 });
          docs.set(id, structuredClone({ ...doc, _id: id }));
          return { insertedId: id };
        },
        async updateOne(q, u, opts = {}) {
          let x = sorted(q)[0];
          if (!x && opts.upsert) { x = upsertDoc(q); apply(x, u, true); return { matchedCount: 0, upsertedCount: 1 }; }
          if (!x) return { matchedCount: 0 };
          apply(x, u, false);
          return { matchedCount: 1 };
        },
        async updateMany(q, u) { const xs = sorted(q); xs.forEach((x) => apply(x, u, false)); return { matchedCount: xs.length }; },
        async deleteMany(q) { const xs = sorted(q); xs.forEach((x) => docs.delete(x._id)); return { deletedCount: xs.length }; },
        async findOneAndUpdate(q, u, opts = {}) {
          const x = sorted(q)[0];
          if (!x) { if (opts.upsert) apply(upsertDoc(q), u, true); return null; }
          const before = structuredClone(x);
          apply(x, u, false);
          return opts.returnDocument === 'after' ? structuredClone(x) : before;
        },
      });
    }
    return cols.get(name);
  };
  return { collection, cols };
}

// ---------------------------------------------------------------- a fake Bot API
function fakeBotApi(opts = {}) {
  const calls = [];
  const fn = async (url, init) => {
    const m = String(url).match(/^https:\/\/api\.telegram\.org\/bot([^/]+)\/(\w+)$/);
    const body = JSON.parse(init.body || '{}');
    calls.push({ method: m?.[2], body });
    const reply = (status, json) => ({ status, json: async () => json });
    const o = opts.override?.[m?.[2]];
    if (o) return reply(o.status ?? 200, o.body);
    switch (m?.[2]) {
      case 'getMe': return reply(200, { ok: true, result: { id: 7012345678, is_bot: true, username: 'ThirtyDA_bot' } });
      case 'setWebhook': fn.hook = body; return reply(200, { ok: true, result: true });
      case 'getWebhookInfo': return reply(200, { ok: true, result: { url: fn.hook?.url ?? '' } });
      case 'sendMessage': return reply(200, { ok: true, result: { message_id: 900 + calls.length } });
      case 'deleteMessage': case 'setMyDescription': case 'setMyShortDescription': return reply(200, { ok: true, result: true });
      default: return reply(404, { ok: false, error_code: 404, description: 'Not Found' });
    }
  };
  fn.calls = calls;
  fn.of = (method) => calls.filter((c) => c.method === method);
  return fn;
}

async function withKey(fn) {
  const prev = process.env.THIRTYDA_SECRET_KEY;
  process.env.THIRTYDA_SECRET_KEY = KEY_HEX;
  clearSettingsCache();
  try { return await fn(); } finally {
    if (prev === undefined) delete process.env.THIRTYDA_SECRET_KEY; else process.env.THIRTYDA_SECRET_KEY = prev;
    clearSettingsCache();
  }
}
async function readyBot() {
  const d = fakeDb();
  const api = fakeBotApi();
  assert.equal((await saveBot(d, BOT_KEY, { origin: 'https://ggmt.sg', fetchImpl: api })).ok, true);
  assert.equal((await tryBot(d, { fetchImpl: api })).ok, true);
  return { d, api, secret: api.hook.secret_token };
}
let updateId = 1;
let messageId = 100;
const person = (id, lang = 'en') => ({ id, is_bot: false, first_name: 'Sokha', username: 'sokha_pp', language_code: lang });
const msg = (from, extra, lang) => ({ update_id: updateId++, message: { message_id: ++messageId, from: person(from, lang), chat: { id: from, type: 'private' }, date: 1, ...extra } });
function hookReq(secret, body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = 'POST';
  req.headers = { [SECRET_HEADER]: secret };
  return req;
}
const hookRes = () => { const r = { status: null, headersSent: false }; r.writeHead = (s) => { r.status = s; r.headersSent = true; }; r.end = () => {}; return r; };
const hook = async (ctx, update, now) => {
  const res = hookRes();
  await handleTelegramHook(hookReq(ctx.secret, update), res, { db: async () => ctx.d, fetchImpl: ctx.api, now });
  return res.status;
};
const sentTexts = (api) => api.of('sendMessage').map((c) => c.body.text);

// ---------------------------------------------------------------- the shared contact never stays in the chat

test('a shared contact is deleted from the chat (verified, mismatch, someone else\'s, no check) and the reply still goes', async () => {
  await withKey(async () => {
    const ctx = await readyBot();
    const { token } = await startCheck(ctx.d, { phone: PHONE, browser: newBrowserKey() });
    await hook(ctx, msg(111, { text: `/start ${token}` }));
    const cases = [
      [{ user_id: 999, phone_number: '85512345678' }, BOT_TEXT.en.not_own],
      [{ user_id: 111, phone_number: '85512345678' }, BOT_TEXT.en.done],
      [{ user_id: 111, phone_number: '85512345678' }, BOT_TEXT.en.help], // the check is over: help, still deleted
    ];
    for (const [contact, said] of cases) {
      const u = msg(111, { contact: { first_name: 'S', ...contact } });
      assert.equal(await hook(ctx, u), 200);
      assert.deepEqual(ctx.api.of('deleteMessage').at(-1).body, { chat_id: 111, message_id: u.message.message_id }, 'chat_id + message_id');
      assert.equal(sentTexts(ctx.api).at(-1), said);
    }
    assert.equal(BOT_TEXT.en.done, 'Number verified ✓ You are now logged in to the 30+DA app. Go back to it.\nWe never ask for bank, card or payment details — there is nothing to pay in this app.');
    // A mismatch: deleted too, and the reply says how to type it (never the number).
    const { token: t2 } = await startCheck(ctx.d, { phone: PHONE, browser: newBrowserKey() });
    await hook(ctx, msg(222, { text: `/start ${t2}` }));
    const mm = msg(222, { contact: { user_id: 222, phone_number: '85599999999' } });
    await hook(ctx, mm);
    assert.equal(ctx.api.of('deleteMessage').at(-1).body.message_id, mm.message.message_id);
    assert.match(sentTexts(ctx.api).at(-1), /country code/);
    // A delete Telegram refuses changes nothing else: 200 and the reply goes.
    const failing = fakeBotApi({ override: { deleteMessage: { status: 400, body: { ok: false, error_code: 400, description: 'Bad Request: message can\'t be deleted' } } } });
    const before = failing.calls.length;
    assert.equal(await hook({ ...ctx, api: failing }, msg(333, { contact: { user_id: 333, phone_number: '1' } })), 200);
    assert.deepEqual(failing.calls.slice(before).map((c) => c.method), ['deleteMessage', 'sendMessage']);
    // Texts are never deleted.
    const n = ctx.api.of('deleteMessage').length;
    await hook(ctx, msg(444, { text: 'hello' }));
    assert.equal(ctx.api.of('deleteMessage').length, n);
  });
});

test('no bot reply carries a phone number, in any language (not even masked)', async () => {
  await withKey(async () => {
    const vars = askVars({ phone: PHONE, created: Date.UTC(2026, 9, 13, 7, 5), match: '🍊 47' });
    assert.deepEqual(Object.keys(vars).sort(), ['mark', 'time']);
    for (const lang of BOT_LANGS) {
      for (const kind of Object.keys(BOT_TEXT[lang])) {
        const text = botReply(kind, lang, 1, vars).text;
        assert.ok(!/\d{3,}/.test(text) && !text.includes('•') && !text.includes('{'), `${lang}.${kind}: ${text}`);
      }
      // A whole check in that language through the webhook: every text that went out.
      const ctx = await readyBot();
      const from = 5000 + BOT_LANGS.indexOf(lang);
      const { token } = await startCheck(ctx.d, { phone: PHONE, lang, browser: newBrowserKey() });
      await hook(ctx, msg(from, { text: `/start ${token}` }, lang));
      await hook(ctx, msg(from, { text: '012 345 678' }, lang));
      await hook(ctx, msg(from, { contact: { user_id: 1, phone_number: '85512345678' } }, lang));
      await hook(ctx, msg(from, { contact: { user_id: from, phone_number: '85512345678' } }, lang));
      await hook(ctx, msg(from, { text: '/help' }, lang));
      await hook(ctx, msg(from, { text: 'my number is +855 12 345 678, help?' }, lang));
      const all = sentTexts(ctx.api);
      assert.ok(all.length >= 6, lang);
      for (const text of all) assert.ok(!/\d{3,}/.test(text) && !text.includes('•') && !text.includes('12345678'), `${lang}: ${text}`);
    }
    assert.match(BOT_TEXT.en.help, /ask us anything here/);
  });
});

// ---------------------------------------------------------------- support in

test('a support message is stored (name + @username, never a phone), thanked once per Phnom Penh day', async () => {
  await withKey(async () => {
    const ctx = await readyBot();
    const t0 = Date.UTC(2026, 9, 13, 3, 0); // 10:00 in Phnom Penh
    assert.equal(await hook(ctx, msg(777, { text: '  How do I change my photo?  ' }), t0), 200);
    const stored = [...ctx.d.collection(SUPPORT).docs.values()];
    assert.equal(stored.length, 1);
    const s = stored[0];
    assert.deepEqual([s.chatId, s.dir, s.from, s.text, s.lang, s.profileId, s.read], [777, 'in', { name: 'Sokha', username: '@sokha_pp' }, 'How do I change my photo?', 'en', null, false]);
    assert.equal(new Date(s.at).getTime(), t0);
    assert.ok(!JSON.stringify(s).includes('phone_number'));
    assert.equal(sentTexts(ctx.api).at(-1), BOT_TEXT.en.support_ack);
    assert.equal(ctx.api.of('sendMessage').at(-1).body.reply_markup, undefined, 'the thanks leaves the keyboard alone');
    // Same day: stored, nothing said. A photo's caption counts.
    const n = ctx.api.of('sendMessage').length;
    await hook(ctx, msg(777, { photo: [{ file_id: 'x' }], caption: 'this one' }), t0 + 3600e3);
    assert.equal(ctx.api.of('sendMessage').length, n, 'once a day');
    assert.equal(ctx.d.collection(SUPPORT).docs.size, 2);
    // The next Phnom Penh day (00:30 there): thanked again, in the language it is written in.
    const next = Date.UTC(2026, 9, 13, 17, 30);
    assert.equal(phnomPenhDay(next), '2026-10-14');
    await hook(ctx, msg(777, { text: 'សួស្តី តើខ្ញុំអាចប្តូររូបថតបានទេ?' }), next);
    assert.equal(sentTexts(ctx.api).at(-1), BOT_TEXT.km.support_ack);
    const chat = await ctx.d.collection(SUPPORT_CHATS).findOne({ _id: 777 });
    assert.deepEqual([chat.unread, chat.count, chat.lang, chat.ackDay], [3, 3, 'km', '2026-10-14']);
    // Telegram sending the same update again (a slow answer) keeps it once.
    const again = msg(777, { text: 'twice?' });
    await hook(ctx, again, next + 1000);
    await hook(ctx, again, next + 2000);
    assert.equal([...ctx.d.collection(SUPPORT).docs.values()].filter((x) => x.text === 'twice?').length, 1);
    // A number typed as text is never a support message; /help is the help line.
    assert.equal(looksLikePhone('+855 12-345 678'), true);
    assert.equal(looksLikePhone('call me at 012 345 678'), false);
    const size = ctx.d.collection(SUPPORT).docs.size;
    await hook(ctx, msg(888, { text: '012 345 678' }));
    await hook(ctx, msg(888, { text: '/help' }));
    assert.equal(ctx.d.collection(SUPPORT).docs.size, size);
    assert.equal(sentTexts(ctx.api).at(-1), BOT_TEXT.en.help);
  });
});

test('support during a live check: words go to support (the share button stays), a number gets the button again', async () => {
  await withKey(async () => {
    const ctx = await readyBot();
    const { token } = await startCheck(ctx.d, { phone: PHONE, lang: 'ko', browser: newBrowserKey() });
    await hook(ctx, msg(321, { text: `/start ${token}` }));
    await hook(ctx, msg(321, { text: 'the button does not work' }));
    const last = ctx.api.of('sendMessage').at(-1).body;
    assert.equal(last.text, BOT_TEXT.ko.support_ack, 'the check\'s language');
    assert.equal(last.reply_markup, undefined);
    await hook(ctx, msg(321, { text: '012345678' }));
    assert.equal(ctx.api.of('sendMessage').at(-1).body.reply_markup.keyboard[0][0].request_contact, true);
  });
});

test('a Telegram user who verified a number with the bot: their support message names their 30+DA profile', async () => {
  await withKey(async () => {
    const ctx = await readyBot();
    await ctx.d.collection('thirtyda_users').insertOne({ _id: 'U-10042', name: 'Dara', phone: PHONE });
    const { token } = await startCheck(ctx.d, { phone: PHONE, browser: newBrowserKey() });
    await hook(ctx, msg(4242, { text: `/start ${token}` }));
    await hook(ctx, msg(4242, { contact: { user_id: 4242, phone_number: '85512345678' } }));
    const link = await ctx.d.collection(TG_LINKS).findOne({ _id: 4242 });
    assert.equal(link?.phone, PHONE);
    await hook(ctx, msg(4242, { text: 'hi team' }));
    const s = [...ctx.d.collection(SUPPORT).docs.values()].find((x) => x.chatId === 4242);
    assert.equal(s.profileId, 'U-10042');
    const { chats } = await listSupportChats(ctx.d);
    assert.deepEqual([chats[0].profileId, chats[0].profileName], ['U-10042', 'Dara']);
  });
});

test('the hourly limit: at most 20 messages per chat are taken, quietly; an hour later again', async () => {
  const d = fakeDb();
  const limiter = windowLimiter(60 * 60e3);
  const t0 = Date.UTC(2026, 9, 13, 5);
  const u = (i) => ({ kind: 'other', chatId: 99, fromId: 99, messageId: i, firstName: 'R', username: null, langCode: 'en', text: `m${i}` });
  const out = [];
  for (let i = 0; i < 25; i++) out.push(await recordSupport(d, u(i), { now: t0 + i * 1000, limiter }));
  assert.equal(out.filter((r) => r.stored).length, SUPPORT_PER_HOUR);
  assert.equal(out.filter((r) => r.ack).length, 1);
  assert.ok(out.slice(SUPPORT_PER_HOUR).every((r) => r.reason === 'rate' && !r.ack));
  assert.equal(d.collection(SUPPORT).docs.size, 20);
  assert.equal((await recordSupport(d, u(30), { now: t0 + 3601e3, limiter })).stored, true);
});

test('words: language guess by script, text cleaned and capped at 2000', () => {
  assert.equal(guessLang('សួស្តី'), 'km');
  assert.equal(guessLang('こんにちは、写真'), 'ja');
  assert.equal(guessLang('안녕하세요'), 'ko');
  assert.equal(guessLang('你好'), 'zh');
  assert.equal(guessLang('hello', 'km'), 'km', 'Latin → the person\'s own language');
  assert.equal(guessLang('hello', 'xx'), 'en');
  assert.equal(supportText(`a\u0000b‮\r\nc`), 'ab\nc');
  assert.equal(supportText('x'.repeat(3000)).length, 2000);
});

// ---------------------------------------------------------------- support out (the admin)

test('admin: list newest first with unread counts; opening marks read; the reply is sendMessage { chat_id, text } only', async () => {
  await withKey(async () => {
    const ctx = await readyBot();
    const t0 = Date.UTC(2026, 9, 13, 3);
    await hook(ctx, msg(1001, { text: 'first person' }), t0);
    await hook(ctx, msg(1002, { text: 'second person' }), t0 + 60e3);
    await hook(ctx, msg(1002, { text: 'still there?' }), t0 + 120e3);
    let list = await listSupportChats(ctx.d);
    assert.deepEqual(list.chats.map((c) => [c.chatId, c.unread, c.lastText]), [[1002, 2, 'still there?'], [1001, 1, 'first person']]);
    assert.equal(list.unread, 3);
    const th = await supportThread(ctx.d, 1002);
    assert.deepEqual(th.messages.map((m) => [m.dir, m.text]), [['in', 'second person'], ['in', 'still there?']]);
    assert.equal(await supportUnread(ctx.d), 1);
    assert.equal(await supportThread(ctx.d, 5555), null);

    const r = await sendSupportReply(ctx.d, 1002, '  Yes — we are here.\nWhat do you need?  ', { fetchImpl: ctx.api, now: t0 + 180e3 });
    assert.equal(r.ok, true);
    assert.deepEqual(ctx.api.of('sendMessage').at(-1).body, { chat_id: 1002, text: 'Yes — we are here.\nWhat do you need?' }, 'plain text: no parse_mode, no keyboard');
    assert.deepEqual([r.message.dir, r.message.by, r.message.text], ['out', 'team', 'Yes — we are here.\nWhat do you need?']);
    list = await listSupportChats(ctx.d);
    assert.deepEqual([list.chats[0].lastDir, list.chats[0].count], ['out', 3]);
    // Refusals in plain words, nothing sent.
    const n = ctx.api.calls.length;
    assert.equal((await sendSupportReply(ctx.d, 1002, '   ', { fetchImpl: ctx.api })).reason, 'empty');
    assert.equal((await sendSupportReply(ctx.d, 1002, 'x'.repeat(2001), { fetchImpl: ctx.api })).status, 422);
    assert.equal((await sendSupportReply(ctx.d, 424242, 'hi', { fetchImpl: ctx.api })).status, 404, 'only chats that wrote to the bot');
    assert.equal(ctx.api.calls.length, n);
    // They blocked the bot: Telegram 403 → said plainly, the chat marked.
    const blocked = fakeBotApi({ override: { sendMessage: { status: 403, body: { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' } } } });
    const b = await sendSupportReply(ctx.d, 1001, 'hello?', { fetchImpl: blocked });
    assert.deepEqual([b.ok, b.reason], [false, 'blocked']);
    assert.match(b.error, /blocked the bot/);
    assert.equal((await listSupportChats(ctx.d)).chats.find((c) => c.chatId === 1001).blocked, true);
    assert.equal([...ctx.d.collection(SUPPORT).docs.values()].filter((x) => x.dir === 'out').length, 1, 'a refused reply is not kept');
    // Writing again reopens it.
    await hook(ctx, msg(1001, { text: 'sorry, back' }), t0 + 300e3);
    assert.equal((await listSupportChats(ctx.d)).chats.find((c) => c.chatId === 1001).blocked, false);
  });
});

test('the bot\'s profile words: setMyDescription + setMyShortDescription in 5 languages (English is the default)', async () => {
  await withKey(async () => {
    const { d, api } = await readyBot();
    const r = await describeBot(d, { fetchImpl: api });
    assert.deepEqual(r, { ok: 10, failed: 0 });
    assert.deepEqual(api.of('setMyDescription').map((c) => c.body.language_code).sort(), ['', 'ja', 'km', 'ko', 'zh']);
    assert.deepEqual(api.of('setMyShortDescription').map((c) => c.body.language_code).sort(), ['', 'ja', 'km', 'ko', 'zh']);
    assert.equal(api.of('setMyDescription').find((c) => c.body.language_code === '').body.description,
      "GKVerify — GK SMART's number check for 30+DA and other GK apps. Verify your number here, or ask us anything.");
    for (const lang of BOT_LANGS) {
      assert.ok(BOT_DESCRIPTION[lang].length <= 512 && BOT_SHORT_DESCRIPTION[lang].length <= 120, lang);
    }
    clearSettingsCache(); // settings are cached per process: a fresh database has no bot
    assert.deepEqual(await describeBot(fakeDb(), { fetchImpl: api }), { ok: 0, failed: 0 }, 'no bot: nothing');
  });
});
