// Run: npm run 30da:test (or node --test src/lib/thirtyda-terms.test.mjs)
// The community rules' "I agree" (store policy, owner 2026-10-14 — src/thirtyda-app/shared/terms.js +
// src/lib/thirtyda-terms.mjs): the agreement's shape and version, which calls a profile may make before agreeing
// (checked against EVERY real route of src/lib/thirtyda-app.mjs), what MeView says, the rewritten terms page, and the
// app's rules screen (5 languages, wired between the language and the PIN). No database, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TERMS_VERSION, TERMS_KEY, termsCurrent, newAgreement, readAgreement,
} from '../thirtyda-app/shared/terms.js';
import { termsFree, termsView, termsDoc, saveTerms, TERMS_NEEDED_MESSAGE } from './thirtyda-terms.mjs';
import { API_ROUTES, meView } from './thirtyda-app.mjs';
import { termsPage, privacyPage, PAGE_STRINGS, TERMS_POINTS, policyDate } from './thirtyda-pages.mjs';

const LANGS = ['en', 'km', 'zh', 'ko', 'ja'];
const NOW = Date.parse('2026-10-20T08:00:00Z');
const DAY = 864e5;
const appFile = (rel) => readFileSync(new URL(`../thirtyda-app/${rel}`, import.meta.url), 'utf8');

// ---------------------------------------------------------------- the agreement

test('version: a YYYY-MM-DD day; the phone keeps the agreement under one key', () => {
  assert.match(TERMS_VERSION, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Number.isFinite(Date.parse(`${TERMS_VERSION}T00:00:00Z`)));
  assert.equal(TERMS_KEY, '30da_terms');
});

test('termsCurrent: only the current version counts', () => {
  assert.equal(termsCurrent({ version: TERMS_VERSION, at: new Date() }), true);
  assert.equal(termsCurrent({ version: '2020-01-01', at: new Date() }), false, 'an older version: agree again');
  for (const bad of [null, undefined, {}, 'yes', TERMS_VERSION, { version: null }]) assert.equal(termsCurrent(bad), false, JSON.stringify(bad));
});

test('newAgreement: { termsVersion, agreedAt } — what the app keeps and sends', () => {
  const a = newAgreement(NOW);
  assert.deepEqual(a, { termsVersion: TERMS_VERSION, agreedAt: new Date(NOW).toISOString() });
  assert.deepEqual(Object.keys(newAgreement()).sort(), ['agreedAt', 'termsVersion']);
});

test('readAgreement: the current version only; the phone\'s time when it is a real past time, else now', () => {
  assert.deepEqual(readAgreement(newAgreement(NOW - 3 * DAY), NOW), { version: TERMS_VERSION, at: NOW - 3 * DAY }, 'a visitor agreed 3 days ago');
  assert.deepEqual(readAgreement({ termsVersion: TERMS_VERSION, agreedAt: NOW - 60e3 }, NOW), { version: TERMS_VERSION, at: NOW - 60e3 }, 'a number time');
  assert.equal(readAgreement({ termsVersion: '2020-01-01', agreedAt: new Date(NOW).toISOString() }, NOW), null, 'an older version');
  for (const bad of [null, undefined, 'I agree', true, 1, [], {}, { version: TERMS_VERSION }, { termsVersion: ` ${TERMS_VERSION}` }]) {
    assert.equal(readAgreement(bad, NOW), null, JSON.stringify(bad));
  }
  // A phone clock ahead, a broken time, a very old time, a huge string: the server's time instead (never refused).
  for (const agreedAt of [new Date(NOW + 3600e3).toISOString(), 'not a time', null, undefined, NOW - 500 * DAY, 'x'.repeat(5000), Infinity, {}]) {
    assert.deepEqual(readAgreement({ termsVersion: TERMS_VERSION, agreedAt }, NOW), { version: TERMS_VERSION, at: NOW }, String(agreedAt).slice(0, 40));
  }
});

// ---------------------------------------------------------------- the 403 terms_needed gate

// One concrete request per route of the real router, and whether a profile that has not agreed may make it.
// "none"/"session" routes (sign-in, GET /me, a guest's look, a photo) never need a profile, so the gate never applies.
const SAMPLES = [
  ['GET', '/auth/methods', true], ['POST', '/auth/send-code', true], ['POST', '/auth/verify-code', true],
  ['POST', '/auth/verify-social', true], ['POST', '/auth/telegram/start', true], ['GET', '/auth/telegram/status', true],
  // App review sign-in (src/lib/thirtyda-review.mjs): like the other sign-in routes, open before any profile agrees.
  ['POST', '/auth/review/check', true], ['POST', '/auth/review/verify', true], ['POST', '/auth/review/pin', true],
  ['POST', '/auth/app/begin', true], ['GET', '/auth/app', true], ['POST', '/auth/signout', true], ['POST', '/profile', true],
  ['GET', '/auth/apple/nonce', true], ['POST', '/auth/apple', true], // Sign in with Apple: a sign-in route, like the rest
  ['GET', '/me', true], ['POST', '/me/lock', true], ['POST', '/me/pin/forgot', true], ['POST', '/guest/nearby', true],
  ['POST', '/guest/report', true], // a guest's report on a card (no profile: the gate is for profiles only)
  ['GET', `/photos/${'a'.repeat(32)}`, true],
  // Before agreeing: agree, the PIN, delete the account, the locked app's count.
  ['POST', '/me/terms', true], ['POST', '/me/unlock', true], ['POST', '/me/pin', true], ['POST', '/me/delete', true], ['GET', '/me/pending', true],
  // Everything else waits for "I agree".
  ['PATCH', '/me', false], ['POST', '/me/photos', false], ['PUT', '/me/photos/1', false], ['DELETE', '/me/photos/2', false],
  ['POST', '/me/location', false], ['POST', '/me/heartbeat', false], ['POST', '/notices/n-1/seen', false],
  ['GET', '/nearby', false], ['GET', '/people/U-10231', false], ['POST', '/pairs', false], ['GET', '/pairs', false],
  ['GET', '/pairs/P-1', false], ['GET', '/pairs/P-1/conversation', false], ['PUT', '/pairs/P-1/replies', false],
  ['GET', '/questions', false], ['POST', '/pairs/P-1/sets', false], ['GET', '/pairs/P-1/incoming', false],
  ['GET', '/pairs/P-1/outgoing', false], ['POST', '/pairs/P-1/answers', false], ['POST', '/pairs/P-1/decide', false],
  ['POST', '/pairs/P-1/remind', false], ['GET', '/pairs/P-1/messages', false], ['POST', '/pairs/P-1/messages', false],
  ['POST', '/pairs/P-1/messages/M-1/report', false], ['GET', '/me/blocks', false], ['POST', '/people/U-10231/block', false],
  ['DELETE', '/people/U-10231/block', false], ['POST', '/people/U-10231/report', false],
  // Meetings in the Level 3 chat (owner 2026-10-14): wait for "I agree" like the chat.
  ['GET', '/places', false], ['POST', '/pairs/P-1/meet', false], ['POST', '/pairs/P-1/meet/M-1', false],
];
// The routes that need no profile (their `auth` in the router): the gate is for profiles only.
const NO_PROFILE = new Set(['GET /auth/methods', 'POST /auth/send-code', 'POST /auth/verify-code', 'POST /auth/verify-social',
  'POST /auth/review/check', 'POST /auth/review/verify', 'POST /auth/review/pin',
  'POST /auth/telegram/start', 'GET /auth/telegram/status', 'POST /auth/app/begin', 'GET /auth/app', 'POST /auth/signout',
  'GET /auth/apple/nonce', 'POST /auth/apple',
  'POST /profile', 'GET /me', 'POST /me/lock', 'POST /me/pin/forgot', 'POST /guest/nearby', 'POST /guest/report',
  `GET /photos/${'a'.repeat(32)}`]);

test('gate: every route of the real router is listed; before agreeing only agree / PIN / delete / the count stay open', () => {
  for (const { method, re } of API_ROUTES) {
    assert.ok(SAMPLES.some(([m, p]) => m === method && re.test(p)), `route ${method} ${re} has a sample (a new route must say whether it waits for "I agree")`);
  }
  for (const [method, path, open] of SAMPLES) {
    assert.ok(API_ROUTES.some((r) => r.method === method && r.re.test(path)), `${method} ${path} is a real route`);
    const free = NO_PROFILE.has(`${method} ${path}`) || termsFree(method, path);
    assert.equal(free, open, `${method} ${path}`);
  }
  assert.equal(termsFree('GET', '/me/terms'), false, 'POST only');
  assert.equal(termsFree('POST', '/me/terms/x'), false);
  assert.equal(termsFree('POST', undefined), false);
  assert.match(TERMS_NEEDED_MESSAGE, /community rules/);
});

test('the router: POST /me/terms exists and the gate runs after the blocked check, before "verify to chat"', () => {
  const src = readFileSync(new URL('./thirtyda-app.mjs', import.meta.url), 'utf8');
  assert.ok(API_ROUTES.some((r) => r.method === 'POST' && r.re.test('/me/terms')));
  const blocked = src.indexOf('throw fail(403, "blocked"');
  const gate = src.indexOf('throw fail(403, "terms_needed"');
  const verify = src.indexOf('throw fail(403, "verify_needed"');
  assert.ok(blocked > 0 && gate > blocked && verify > gate, 'blocked → terms_needed → verify_needed');
  assert.ok(src.includes('auth === "user" && ctx.me && !termsCurrent(ctx.me.terms) && !termsFree(req.method, sub)'));
  assert.ok(src.includes('const agreement = readAgreement(body.terms);'), 'POST /profile and verify-code read { terms }');
  assert.ok(src.includes('...(agreement ? { terms: termsDoc(agreement) } : {}),'), 'a new profile keeps it');
});

// ---------------------------------------------------------------- what is kept, what the owner sees

test('termsDoc / termsView: users.terms { version, at: Date } → MeView.terms { version, at: ISO } (null when none)', () => {
  const doc = termsDoc({ version: TERMS_VERSION, at: NOW });
  assert.deepEqual(doc, { version: TERMS_VERSION, at: new Date(NOW) });
  assert.deepEqual(termsView({ terms: doc }), { version: TERMS_VERSION, at: new Date(NOW).toISOString() });
  assert.deepEqual(termsView({ terms: { version: '2020-01-01', at: '2020-01-01T00:00:00.000Z' } }), { version: '2020-01-01', at: '2020-01-01T00:00:00.000Z' });
  for (const u of [{}, null, { terms: null }, { terms: { at: new Date() } }]) assert.equal(termsView(u), null);
  assert.deepEqual(termsView({ terms: { version: TERMS_VERSION, at: 'broken' } }), { version: TERMS_VERSION, at: null });
});

test('meView carries terms (null for a profile that never agreed)', () => {
  const base = { _id: 'U-1', name: 'Ann', photos: [], verified: {} };
  assert.equal(meView(base).terms, null);
  assert.deepEqual(meView({ ...base, terms: termsDoc({ version: TERMS_VERSION, at: NOW }) }).terms, { version: TERMS_VERSION, at: new Date(NOW).toISOString() });
});

test('saveTerms: keeps the first "I agree" of a version; an older one is replaced', async () => {
  const calls = [];
  const users = { updateOne: async (filter, update) => { calls.push({ filter, update }); return { matchedCount: 1 }; } };
  const already = { _id: 'U-1', terms: { version: TERMS_VERSION, at: new Date(NOW - DAY) } };
  assert.equal(await saveTerms(users, already, { version: TERMS_VERSION, at: NOW }), already.terms);
  assert.equal(calls.length, 0, 'already agreed to this version: nothing written');
  const old = { _id: 'U-2', terms: { version: '2020-01-01', at: new Date(0) } };
  const saved = await saveTerms(users, old, { version: TERMS_VERSION, at: NOW });
  assert.deepEqual(saved, { version: TERMS_VERSION, at: new Date(NOW) });
  assert.deepEqual(calls[0], { filter: { _id: 'U-2', 'terms.version': { $ne: TERMS_VERSION } }, update: { $set: { terms: saved } } });
  await saveTerms(users, { _id: 'U-3' }, { version: TERMS_VERSION, at: NOW });
  assert.equal(calls[1].filter._id, 'U-3', 'never agreed: written');
});

// ---------------------------------------------------------------- the terms page

test('terms page: zero tolerance, what is never allowed, 24-hour reports, moderators, removal — 5 languages, dated TERMS_VERSION', () => {
  assert.deepEqual([...TERMS_POINTS], ['terms_age', 'terms_honest', 'terms_respect', 'terms_banned', 'terms_contact', 'terms_reports', 'terms_mods', 'terms_zero']);
  for (const lang of LANGS) {
    const t = PAGE_STRINGS[lang];
    const html = termsPage({ lang });
    for (const k of TERMS_POINTS) {
      assert.ok(t[k] && t[`${k}_k`], `${lang}.${k}`);
      assert.ok(html.includes(`<li><b>${t[`${k}_k`]}</b> ${t[k]}</li>`), `${lang}: ${k} on the page`);
    }
    assert.ok(html.includes(policyDate(lang, TERMS_VERSION)), `${lang}: dated ${TERMS_VERSION}`);
    assert.ok(/24/.test(t.terms_reports), `${lang}: reports within 24 hours`);
    assert.ok(!('terms_team' in t), `${lang}: the old "Our team" line is gone (now zero tolerance)`);
  }
  const en = PAGE_STRINGS.en;
  assert.match(en.terms_lede, /zero tolerance/);
  for (const w of ['nudity', 'sexual', 'asking for sex', 'escorts', 'sugar dating', 'gifts for dates', 'trafficking', 'minors', 'scams']) {
    assert.ok(en.terms_banned.includes(w), `never allowed: ${w}`);
  }
  for (const w of ['hate', 'harassment']) assert.ok(en.terms_respect.includes(w), `respect: ${w}`);
  assert.match(en.terms_reports, /within 24 hours/);
  assert.match(en.terms_mods, /moderators may read conversations/);
  assert.match(en.terms_zero, /remove anyone/);
});

test('?from=rules: the terms and privacy pages go back to the rules screen; anything else goes back to #/me', () => {
  for (const lang of LANGS) {
    const back = PAGE_STRINGS[lang].back_app;
    for (const page of [termsPage, privacyPage]) {
      assert.ok(page({ lang, from: 'rules' }).includes(`<a class="doc-btn" href="/30da/#/rules">${back}</a>`), `${lang}: back to #/rules`);
      for (const from of [null, undefined, 'me', 'rules"><script>', 'RULES']) {
        const html = page({ lang, from });
        assert.ok(html.includes(`<a class="doc-btn" href="/30da/#/me">${back}</a>`) && !html.includes('#/rules') && !html.includes('<script>'), `${lang}: ${from}`);
      }
    }
    const fromRules = termsPage({ lang, from: 'rules' });
    assert.ok(fromRules.includes(`href="/30da/privacy?lang=${lang}&amp;from=rules"`), `${lang}: the privacy link keeps the way back`);
    for (const c of LANGS) assert.ok(fromRules.includes(`href="/30da/terms?lang=${c}&amp;from=rules"`), `${lang}: flag ${c} keeps the way back`);
  }
});

// ---------------------------------------------------------------- the app's rules screen

test('rules screen: 6 one-line rules + Terms / Privacy + "I agree", the same keys in 5 languages', () => {
  const src = appFile('screens/rules.js');
  const keys = ['cr_title', 'cr_lede', 'cr_changed', 'cr_r_age', 'cr_r_respect', 'cr_r_sexual', 'cr_r_money', 'cr_r_reports', 'cr_r_mods',
    'cr_terms', 'cr_privacy', 'cr_agree', 'cr_saving', 'cr_signout', 'cr_delete'];
  for (const k of keys) assert.equal((src.match(new RegExp(`\\n    ${k}: '`, 'g')) || []).length, 5, `${k} × 5`);
  assert.equal((src.match(/\['cr_r_\w+', '\w+'\]/g) || []).length, 6, 'six rules');
  assert.ok(src.includes("screen('/rules'"));
  assert.ok(src.includes('/30da/terms?lang=${lang}&from=rules') && src.includes('/30da/privacy?lang=${lang}&from=rules'));
  assert.ok(src.includes('keepAgreement()') && src.includes('syncTerms()'), 'a visitor keeps it; a profile sends it');
  const en = src.slice(src.indexOf('  en: {'), src.indexOf('  km: {'));
  for (const w of ['30+ only', 'No hate, harassment', 'No nudity or sexual content', 'escorts or sugar dating', 'No scams', 'within 24 hours', 'Moderators may read chats']) {
    assert.ok(en.includes(w), `en: ${w}`);
  }
  for (const lang of LANGS) {
    const block = src.slice(src.indexOf(`  ${lang}: {`));
    assert.ok(/cr_r_reports: '[^']*24/.test(block), `${lang}: 24 hours`);
  }
});

test('the app: language → rules → PIN; nothing past the language before "I agree"; a profile without the rules sees them first', () => {
  const app = appFile('app.js');
  assert.ok(app.includes("['rules', () => import('./screens/rules.js')]"));
  assert.ok(app.includes("if (where !== '/opening' && where !== '/rules' && !agreedHere() && !pinResetPending()) return '/rules';"));
  assert.ok(app.includes("if (termsNeeded()) return path === '/rules' ? null : '/rules';"));
  assert.ok(app.includes("if (path === '/pin' && waitingPin()) return '/nearby';"), 'the waiting PIN still skips #/pin');
  assert.ok(appFile('screens/opening.js').includes("go('/rules');"), 'the language goes to the rules');
  assert.ok(appFile('screens/pin.js').includes("go('/rules', { replace: true })"), 'back from the PIN: the rules');
  const core = appFile('core.js');
  assert.ok(core.includes("err.code === 'terms_needed'") && core.includes("export * from './shared/terms.js';"));
  const terms = appFile('terms.js');
  assert.ok(terms.includes("api.post('/me/terms', a)") && terms.includes('store.set(TERMS_KEY, a)'));
  const cp = appFile('screens/create-profile.js');
  assert.equal((cp.match(/\.\.\.termsBody\(\)/g) || []).length, 2, 'POST /profile and verify-code carry it');
});
