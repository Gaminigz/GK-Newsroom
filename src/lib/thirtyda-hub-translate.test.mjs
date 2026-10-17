// Run: npm run 30da:test (or node --test src/lib/thirtyda-hub-translate.test.mjs)
// GK API Hub, Tower 13 · Translate (src/lib/thirtyda-hub-translate.mjs) and the translation client it sets
// (src/lib/thirtyda-translate.mjs): the Hy-MT prompt (no system prompt, the model card's instruction in the user turn),
// the boxes' checks, the tower's settings winning over the env, Off until turned on, the wait, the pause after a failure,
// the numbers, the Try — and never the token in what the page gets. A fake fetch and an in-memory settings collection:
// these tests reach neither the M1 nor Mongo.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { saveFields, clearSettingsCache, SETTINGS_COLLECTION } from './thirtyda-settings.mjs';
import {
  translate, translateAll, translateEnabled, translateConfig, translateRequest, translateStats, setTranslateTestHooks, endpointOf,
  styleOfModel, cleanTranslation, COOL_OFF_MS, TIMEOUT_DEFAULT_S,
} from './thirtyda-translate.mjs';
import { checkTranslateFields, translateAdminView, saveTranslateOptions, translateTry } from './thirtyda-hub-translate.mjs';

const TOKEN = 'm1tok_FAKE0123456789abcdefWXYZ';
const TOWER = { url: 'https://llm.ggmt.sg', model: 'hy-mt2-1.8b', token: TOKEN, style: 'hy-mt' };
const ENV_KEYS = ['THIRTYDA_TRANSLATE_URL', 'THIRTYDA_TRANSLATE_KEY', 'THIRTYDA_TRANSLATE_MODEL', 'THIRTYDA_TRANSLATE_STYLE', 'THIRTYDA_SECRET_KEY'];
let saved = {};

function fakeDb() {
  const docs = new Map();
  const col = {
    async findOne(q) { const x = docs.get(q._id); return x ? structuredClone(x) : null; },
    async replaceOne(q, doc) { docs.set(q._id, structuredClone({ ...doc, _id: q._id })); return { acknowledged: true }; },
    async deleteOne(q) { return { deletedCount: docs.delete(q._id) ? 1 : 0 }; },
    async updateOne(q, u) {
      const x = docs.get(q._id);
      if (!x || (q.box?.$exists && !x.box)) return { matchedCount: 0 };
      Object.assign(x, structuredClone(u.$set));
      return { matchedCount: 1 };
    },
  };
  return { docs, collection(name) { assert.equal(name, SETTINGS_COLLECTION); return col; } };
}

/** The M1 as LM Studio answers: { choices: [{ message: { content } }] }; `reply(body)` → the content, or a Response. */
function m1Fetch(reply = (body) => `[${body.messages.at(-1).content.split('\n\n').pop()}]`) {
  const calls = [];
  const fn = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, init, body });
    const out = await reply(body, init);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: out } }] }), { status: 200 });
  };
  fn.calls = calls;
  return fn;
}

let d;
let clock;
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.THIRTYDA_SECRET_KEY = crypto.randomBytes(32).toString('hex');
  clearSettingsCache();
  d = fakeDb();
  clock = { t: 1_800_000_000_000 };
});
afterEach(() => {
  for (const k of ENV_KEYS) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  clearSettingsCache();
  setTranslateTestHooks({});
});
const hooks = (fetchImpl) => setTranslateTestHooks({ db: d, fetchImpl, now: () => clock.t });
const turnOn = () => saveTranslateOptions(d, { enabled: true });

// ---------------------------------------------------------------- the request

test('Hy-MT: no system prompt — the model card\'s instruction in the user turn (Chinese when Chinese is in it), its sampling', () => {
  const km = translateRequest({ text: 'See you at 7?', from: 'en', to: 'km', model: 'hy-mt2-1.8b', style: 'hy-mt' });
  assert.deepEqual(km.messages, [{ role: 'user', content: 'Translate the following segment into Khmer, without additional explanation.\n\nSee you at 7?' }]);
  assert.equal(km.model, 'hy-mt2-1.8b');
  assert.deepEqual([km.temperature, km.top_p, km.top_k, km.repeat_penalty, km.stream], [0.7, 0.6, 20, 1.05, false]);
  assert.ok(!km.messages.some((m) => m.role === 'system'));
  const zh = translateRequest({ text: 'See you at 7?', from: 'en', to: 'zh', style: 'hy-mt' });
  assert.equal(zh.messages[0].content, '把下面的文本翻译成中文，不要额外解释。\n\nSee you at 7?');
  assert.equal('model' in zh, false, 'no model: the one loaded');
  assert.equal(translateRequest({ text: '你好', from: 'zh', to: 'ko', style: 'hy-mt' }).messages[0].content, '把下面的文本翻译成韩语，不要额外解释。\n\n你好');
  assert.match(translateRequest({ text: 'hi', from: 'en', to: 'ja', style: 'hy-mt' }).messages[0].content, /^Translate the following segment into Japanese,/);
  // A chat model: the system prompt as before.
  const chat = translateRequest({ text: 'hi', from: 'en', to: 'km', model: 'qwen2.5-7b-instruct', style: 'chat' });
  assert.equal(chat.messages[0].role, 'system');
  assert.match(chat.messages[0].content, /from English to Khmer/);
  assert.deepEqual(chat.messages[1], { role: 'user', content: 'hi' });
  assert.equal(chat.temperature, 0.2);
});

test('the address, the style from a model name, a reply cleaned', () => {
  assert.equal(endpointOf('https://llm.ggmt.sg/'), 'https://llm.ggmt.sg/v1/chat/completions');
  assert.equal(endpointOf('https://llm.ggmt.sg/v1'), 'https://llm.ggmt.sg/v1/chat/completions');
  assert.equal(endpointOf('https://x.test/v1/chat/completions'), 'https://x.test/v1/chat/completions');
  assert.equal(endpointOf(''), null);
  for (const m of ['hy-mt2-1.8b', 'Tencent/HY-MT1.5-1.8B-GGUF', 'hunyuan-mt-7b']) assert.equal(styleOfModel(m), 'hy-mt', m);
  for (const m of ['qwen2.5-7b-instruct', '', null]) assert.equal(styleOfModel(m), 'chat');
  assert.equal(cleanTranslation('<think>hmm</think>  “ជួបគ្នាម៉ោង ៧?” '), 'ជួបគ្នាម៉ោង ៧?');
});

// ---------------------------------------------------------------- the boxes

test('the boxes: https only (http on this machine), just an address, a model name, the token kept when left empty', () => {
  assert.deepEqual(checkTranslateFields(TOWER), { ok: true, values: TOWER });
  assert.equal(checkTranslateFields({ ...TOWER, url: 'https://llm.ggmt.sg/' }).values.url, 'https://llm.ggmt.sg');
  assert.equal(checkTranslateFields({ ...TOWER, url: 'http://localhost:1234/v1' }).ok, true, 'LM Studio on this machine');
  for (const [url, field] of [['', 'url'], ['llm.ggmt.sg', 'url'], ['http://llm.ggmt.sg', 'url'], ['https://u:p@llm.ggmt.sg', 'url'], ['https://llm.ggmt.sg/?key=1', 'url']]) {
    assert.equal(checkTranslateFields({ ...TOWER, url }).field, field, url);
  }
  assert.equal(checkTranslateFields({ ...TOWER, model: '' }).field, 'model');
  assert.equal(checkTranslateFields({ ...TOWER, model: 'a b' }).field, 'model');
  assert.equal(checkTranslateFields({ ...TOWER, token: '' }).field, 'token');
  assert.equal(checkTranslateFields({ ...TOWER, token: 'two words' }).field, 'token');
  assert.equal(checkTranslateFields({ ...TOWER, token: '' }, { token: TOKEN }).values.token, TOKEN, 'empty keeps the saved one');
  assert.equal(checkTranslateFields({ ...TOWER, style: '' }).values.style, 'hy-mt', 'from the model name');
  assert.equal(checkTranslateFields({ ...TOWER, model: 'qwen2.5-7b-instruct', style: '' }).values.style, 'chat');
  assert.equal(checkTranslateFields({ ...TOWER, style: 'magic' }).field, 'style');
});

// ---------------------------------------------------------------- where translations go

test('the tower\'s keys win over the env; they stay Off until turned on (the env\'s are on, as before); 15 s', async () => {
  hooks(m1Fetch());
  assert.equal(await translateConfig({ fresh: true }), null, 'nothing set');
  assert.equal(await translateEnabled(), false);
  process.env.THIRTYDA_TRANSLATE_URL = 'https://env.example/v1';
  process.env.THIRTYDA_TRANSLATE_MODEL = 'Hunyuan-MT-7B';
  const env = await translateConfig({ fresh: true });
  assert.deepEqual([env.source, env.url, env.style, env.enabled, env.timeoutMs, env.token], ['env', 'https://env.example/v1/chat/completions', 'hy-mt', true, TIMEOUT_DEFAULT_S * 1000, null]);
  assert.equal(TIMEOUT_DEFAULT_S, 15);
  await saveFields(d, 'translate', TOWER);
  const tower = await translateConfig({ fresh: true });
  assert.deepEqual([tower.source, tower.url, tower.model, tower.token, tower.style, tower.enabled], ['tower', 'https://llm.ggmt.sg/v1/chat/completions', 'hy-mt2-1.8b', TOKEN, 'hy-mt', false]);
  assert.equal(await translate('hello', 'en', 'km'), null, 'Off: nothing asked');
  await turnOn();
  assert.equal(await translateEnabled(), true);
  await saveTranslateOptions(d, { timeoutS: 20 });
  assert.equal((await translateConfig()).timeoutMs, 20000);
});

test('a translation: our address, the Bearer token, the wait; cached; one failure pauses it a minute; the numbers', async () => {
  const fetchImpl = m1Fetch();
  hooks(fetchImpl);
  await saveFields(d, 'translate', TOWER);
  await turnOn();
  assert.equal(await translate('See you at 7?', 'en', 'km'), '[See you at 7?]');
  const { url, init, body } = fetchImpl.calls[0];
  assert.equal(url, 'https://llm.ggmt.sg/v1/chat/completions');
  assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.ok(init.signal instanceof AbortSignal);
  assert.equal(body.messages[0].role, 'user');
  assert.equal(await translate('See you at 7?', 'en', 'km'), '[See you at 7?]');
  assert.equal(fetchImpl.calls.length, 1, 'the second from memory');
  const all = await translateAll('Coffee?', 'en');
  assert.deepEqual(Object.keys(all.translations), ['en', 'km', 'zh', 'ko', 'ja']);
  assert.equal(all.translations.en, 'Coffee?');
  let s = translateStats();
  assert.deepEqual([s.calls, s.ok, s.failed, s.cached, s.pausedUntil], [5, 5, 0, 1, null]);
  assert.equal(JSON.stringify(s).includes('Coffee'), false, 'never a line of text');

  const down = m1Fetch(() => new Response(JSON.stringify({ detail: 'bad token' }), { status: 401 }));
  hooks(down);
  await saveFields(d, 'translate', TOWER);
  await turnOn();
  assert.equal(await translate('hello', 'en', 'km'), null);
  s = translateStats();
  assert.deepEqual([s.failed, s.lastError.message], [1, 'HTTP 401 (bad token)']);
  assert.equal(s.pausedUntil, new Date(clock.t + COOL_OFF_MS).toISOString());
  assert.equal(await translateEnabled(), false, 'paused');
  assert.equal(await translate('hello again', 'en', 'km'), null);
  assert.equal(down.calls.length, 1, 'not asked while paused');
  clock.t += COOL_OFF_MS;
  assert.equal(await translateEnabled(), true);
  assert.equal(JSON.stringify(translateStats()).includes(TOKEN), false);
});

test('a slow M1: cut off at the wait, said in plain words', async () => {
  hooks(m1Fetch((body, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })));
  })));
  await saveFields(d, 'translate', TOWER);
  await turnOn();
  await saveTranslateOptions(d, { timeoutS: 5 });
  const c = await translateConfig();
  assert.equal(c.timeoutMs, 5000);
  // A 5 s wait is too long for a test: the same path with the signal aborted at once.
  const quick = { ...c, timeoutMs: 1 };
  const { tryTranslate } = await import('./thirtyda-translate.mjs');
  const r = await tryTranslate(quick, { text: 'hi', from: 'en', to: 'km' });
  assert.deepEqual([r.ok, r.error], [false, 'no answer in 0 s']);
});

// ---------------------------------------------------------------- the tower

test('the tower\'s view: Not set → Off (saved, not on) → Live → Failing; never the token; ours or not', async () => {
  hooks(m1Fetch());
  let v = await translateAdminView(d);
  assert.deepEqual([v.status, v.host, v.set, v.options.enabled], ['not_set', null, false, false]);
  await saveFields(d, 'translate', TOWER);
  v = await translateAdminView(d);
  assert.deepEqual([v.status, v.host, v.model, v.style, v.source, v.ours, v.masks.token], ['off', 'llm.ggmt.sg', 'hy-mt2-1.8b', 'hy-mt', 'tower', true, 'WXYZ']);
  assert.deepEqual(v.fields, { url: 'https://llm.ggmt.sg', model: 'hy-mt2-1.8b', style: 'hy-mt' }, 'the plain boxes, not the token');
  assert.equal(JSON.stringify(v).includes(TOKEN), false, 'never the token');
  await turnOn();
  assert.equal((await translateAdminView(d)).status, 'saved');
  await translate('hi', 'en', 'km');
  assert.equal((await translateAdminView(d)).status, 'live');
  hooks(m1Fetch(() => new Response('{}', { status: 502 })));
  await translate('hello', 'en', 'km');
  v = await translateAdminView(d);
  assert.equal(v.status, 'failing');
  assert.equal(v.stats.lastError.message, 'HTTP 502');
  await saveFields(d, 'translate', { ...TOWER, url: 'https://api.example.com' });
  assert.equal((await translateAdminView(d)).ours, false, 'not on the privacy page');
  await saveTranslateOptions(d, { enabled: false });
  assert.equal((await translateAdminView(d)).status, 'off');
});

test('On / Off and the wait: checked; a change ends a pause', async () => {
  for (const [input, field] of [[{ enabled: 'yes' }, 'enabled'], [{ timeoutS: 4 }, 'timeoutS'], [{ timeoutS: 31 }, 'timeoutS'], [{ timeoutS: 7.5 }, 'timeoutS']]) {
    assert.equal((await saveTranslateOptions(d, input)).field, field, JSON.stringify(input));
  }
  const r = await saveTranslateOptions(d, { enabled: true, timeoutS: 12 });
  assert.deepEqual([r.ok, r.options.enabled, r.options.timeoutS], [true, true, 12]);
  assert.deepEqual((await saveTranslateOptions(d, { timeoutS: 30 })).options.enabled, true, 'what is left out stays');
});

test('Try: one line or all four, one after the other, even while Off; noted on the card without the line; bad input refused', async () => {
  const fetchImpl = m1Fetch();
  hooks(fetchImpl);
  assert.equal((await translateTry(d, { text: 'hi', from: 'en', to: 'km' })).reason, 'not_set');
  await saveFields(d, 'translate', TOWER);
  const one = await translateTry(d, { text: 'Coffee on Saturday?', from: 'en', to: 'km' });
  assert.equal(one.ok, true);
  assert.equal(one.enabled, false, 'tried while Off');
  assert.deepEqual(one.results.map((x) => [x.to, x.ok, x.text]), [['km', true, '[Coffee on Saturday?]']]);
  const all = await translateTry(d, { text: 'សួស្តី', from: 'km', to: 'all' });
  assert.deepEqual(all.results.map((x) => x.to), ['en', 'zh', 'ko', 'ja']);
  assert.equal(fetchImpl.calls.length, 5);
  assert.equal(translateStats().calls, 0, 'not the app\'s numbers');
  const doc = await d.collection(SETTINGS_COLLECTION).findOne({ _id: 'translate' });
  assert.deepEqual([doc.lastSend.ok, doc.lastSend.kind], [true, 'try']);
  assert.equal(JSON.stringify(doc.lastSend).includes('សួស្តី'), false);
  for (const [input, field] of [
    [{ text: '', from: 'en', to: 'km' }, 'text'], [{ text: 'x'.repeat(501), from: 'en', to: 'km' }, 'text'],
    [{ text: 'hi', from: 'xx', to: 'km' }, 'from'], [{ text: 'hi', from: 'en', to: 'en' }, 'to'],
  ]) assert.equal((await translateTry(d, input)).field, field);
  hooks(m1Fetch(() => new Response('{}', { status: 404 })));
  const bad = await translateTry(d, { text: 'hi', from: 'en', to: 'ja' });
  assert.deepEqual([bad.ok, bad.results[0].error], [false, 'HTTP 404']);
  assert.equal((await translateAdminView(d)).lastTry.ok, false);
});

test('the app hands its database to the translator; the two read-time fills wait for translateEnabled()', () => {
  const app = readFileSync(new URL('./thirtyda-app.mjs', import.meta.url), 'utf8');
  assert.match(app, /async function db\(\) \{\n {2}const d = await getDb\(\);\n {2}useTranslateDb\(d\);/);
  assert.equal((app.match(/if \(!\(await translateEnabled\(\)\)\) return;/g) || []).length, 2);
  assert.equal(/if \(!translateEnabled\(\)\)/.test(app), false);
});

// ---------------------------------------------------------------- the Code page

test('Code page: tower 13 "Translate" (Language) after Places, its boxes and words; the routes; no token in the page', () => {
  const js = readFileSync(new URL('../thirtyda-admin/connections.js', import.meta.url), 'utf8');
  const towers = js.slice(js.indexOf('const TOWERS = ['), js.indexOf('const towerNumber'));
  assert.match(towers, /key: 'places'[\s\S]*key: 'translate', name: 'Translate', kind: 'Language', has: \(byId, data\) => Boolean\(data\?\.translate\)/);
  assert.match(js, /\n {2}translate: '<path /, 'our own drawing in LOGOS');
  assert.match(js, /key: 'url', label: 'Address', placeholder: 'https:\/\/llm\.ggmt\.sg', fallback: 'https:\/\/llm\.ggmt\.sg'/);
  assert.match(js, /key: 'token', label: 'Token', secret: true/);
  assert.match(js, /choices: \[\['hy-mt', 'Hy-MT: no system prompt'\], \['chat', 'Chat model: a system prompt'\]\]/);
  for (const words of ['Chat lines in 5 languages · our own model on the M1', 'Tencent Hy-MT2-1.8B', 'Turn on', 'Most seconds to wait per line',
    'All four', 'Works ✓ ', 'Saved, not tried', 'Failing', 'Remove the Translate keys?']) {
    assert.ok(js.includes(words), words);
  }
  assert.ok(js.includes('`${API}/translate/options`') && js.includes('`${API}/translate/try`'));
  assert.equal((js.match(/innerHTML/g) || []).length, 1, 'only the logo template');
  assert.equal(/style=|\.style\.(?!setProperty)|setAttribute\('style'/.test(js), false, 'no inline style');
  const css = readFileSync(new URL('../thirtyda-admin/app.css', import.meta.url), 'utf8');
  for (const rule of ['.cx-logo.translate', '.cx-tower[data-tower="translate"]', 'textarea.input.cx-area']) assert.ok(css.includes(rule), rule);
  const admin = readFileSync(new URL('./thirtyda-admin.mjs', import.meta.url), 'utf8');
  assert.match(admin, /translate: "Translate",/);
  assert.match(admin, /translate: \(input, current\) => checkTranslateFields\(input, current\),/);
  assert.match(admin, /m = sub\.match\(\/\^\\\/api\\\/connections\\\/translate\\\/\(options\|try\)\$\/\);\n {2}if \(m\) return translateRoute\(req, res, m\);/);
  assert.match(admin, /translate: await translateAdminView\(d\)\.catch\(/, 'a Translate failure never takes the page down');
  assert.match(admin, /await audit\(req, "translate_try", \{ ok: r\.ok, from: r\.from, to: r\.results\.map\(\(x\) => x\.to\), model: r\.model \}\);/, 'never the line');
});
