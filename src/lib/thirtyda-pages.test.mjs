// Run: npm run 30da:test (or node --test src/lib/thirtyda-pages.test.mjs)
// The store-policy pages (owner 2026-10-14; src/lib/thirtyda-pages.mjs), true to the code:
//   GET /30da/privacy        the whole policy: who runs it + the privacy contact, every item kept and why, who sees what
//                            (guests, members, moderators), every outside service by name, how long (and what a delete
//                            keeps), the person's choices (withdraw consent)
//   GET /30da/delete-data    the developer's name as on Google Play, the in-app steps (the app's own button words), the
//                            email way, what goes / what stays / how long (src/lib/thirtyda-delete.mjs)
//   GET /30da/child-safety   NEW: zero tolerance for CSAE, the in-app report path (the app's own words), CSAM removed and
//                            reported, the child-safety contact
//   GET /30da/support        Help & contact, with Telegram @GKSmartbiz (optional); GET /30da/help is the same page
// and the Level 3 chat for any verified way (chatGate → canTalk; Apple 4.2.3: no Telegram needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PAGE_STRINGS, OPERATOR, CONTACT_EMAIL, privacyPage as privacyHtml, deleteDataPage as deleteDataHtml, supportPage as supportHtml,
  childSafetyPage as childSafetyHtml, termsPage as termsHtml, homePage, backPage, appReturnPage, pageWords, PRIVACY_DATA,
  PRIVACY_SEES, PRIVACY_CHOICES, PROCESSORS, TRANSLATE_HOST, CHILD_SAFETY_POINTS, CHILD_SAFETY_SUBJECT, SUPPORT_TELEGRAM,
  SUPPORT_TELEGRAM_NAME,
} from './thirtyda-pages.mjs';
import { handleThirtyDaApp } from './thirtyda-app.mjs';
import { canTalk, VERIFIED_WAYS } from './thirtyda-verify.mjs';
import { COVERAGE, FLAGS } from './thirtyda-delete.mjs';
import { SUPPORT_CHATS } from './thirtyda-support.mjs';
import { DEVICE_KEEP_MS, VERIFY_KEEP_MS } from '../thirtyda-app/shared/visitor.js';
import { PERSON_REPORT_REASONS, CHAT_REPORT_REASONS } from '../thirtyda-app/shared/safety.js';
import { khmerKeep, khmerPlain, WORD_JOINER } from '../thirtyda-app/shared/khmer.js';

const LANGS = ['en', 'km', 'zh', 'ko', 'ja'];
// The pages keep each Khmer phrase whole with invisible marks (shared/khmer.js khmerKeep): the words are
// compared without them (the joiners themselves: the Khmer test at the end).
const privacyPage = (opts) => khmerPlain(privacyHtml(opts));
const deleteDataPage = (opts) => khmerPlain(deleteDataHtml(opts));
const supportPage = (opts) => khmerPlain(supportHtml(opts));
const childSafetyPage = (opts) => khmerPlain(childSafetyHtml(opts));
const shown = (html) => html.replace(/<(head|nav)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const flagsOf = (html) => html.match(/<nav class="langs"[\s\S]*?<\/nav>/)?.[0] || '';
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

/** One app screen's words, per language: { en: { key: text }, km: … } from its registerStrings({ … }) block. */
function appStrings(rel) {
  const src = read(rel);
  const block = src.slice(src.indexOf('registerStrings({'));
  const out = {};
  for (const lang of LANGS) {
    const start = block.indexOf(`\n  ${lang}: {`);
    const end = block.indexOf('\n  },', start);
    const body = block.slice(start, end);
    out[lang] = Object.fromEntries([...body.matchAll(/^\s+(\w+): '((?:[^'\\]|\\.)*)',?$/gm)].map((m) => [m[1], m[2].replace(/\\'/g, "'")]));
  }
  return out;
}

async function get(path, headers = {}) {
  const req = { method: 'GET', url: path, headers: { host: 'ecom.ggmt.sg', ...headers } };
  const res = { status: null, headers: null, body: undefined, headersSent: false };
  res.writeHead = (s, h = {}) => { res.status = s; res.headers = h; res.headersSent = true; return res; };
  res.end = (b) => { res.body = b === undefined ? undefined : String(b); return res; };
  await handleThirtyDaApp(req, res, new URL(path, 'https://ecom.ggmt.sg'));
  return res;
}

function commonChecks(name, html, lang) {
  assert.ok(html.includes(`<html lang="${lang}">`), `${name} ${lang}: html lang`);
  assert.ok(!/<script|style=|undefined|\{\w+\}/.test(html), `${name} ${lang}: no script, no inline style, nothing unfilled`);
  const flags = flagsOf(html);
  for (const code of LANGS) assert.ok(flags.includes(`href="/30da/${name}?lang=${code}"`), `${name} ${lang}: flag ${code}`);
  assert.ok(flags.includes(`hreflang="${lang}" lang="${lang}" aria-current="true"`), `${name} ${lang}: current flag`);
  assert.ok(html.includes(`<b>${OPERATOR}</b>`), `${name} ${lang}: the operator`);
  assert.ok(html.includes(`<a class="doc-btn" href="/30da/#/me">${PAGE_STRINGS[lang].back_app}</a>`), `${name} ${lang}: back to the app`);
}

// ---------------------------------------------------------------- privacy (plan item 8)

test('privacy: the operator and the privacy contact; every item kept and why, as one line each, in all 5 languages', () => {
  assert.equal(OPERATOR, 'GGMT PTE. LTD.');
  assert.equal(CONTACT_EMAIL, 'gk.smart@ggmt.sg');
  for (const lang of LANGS) {
    const t = PAGE_STRINGS[lang];
    const p = privacyPage({ lang });
    commonChecks('privacy', p, lang);
    assert.ok(p.includes(`<p>${t.priv_operator.replace('{operator}', `<b>${OPERATOR}</b>`).replace('{mail}', `<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>`)}</p>`),
      `${lang}: who runs it, privacy questions to the email`);
    for (const h of ['priv_data_h', 'priv_see_h', 'priv_proc_h', 'priv_long_h', 'priv_choice_h']) assert.ok(p.includes(`<h2>${t[h]}</h2>`), `${lang}: heading ${h}`);
    for (const k of [...PRIVACY_DATA, ...PRIVACY_SEES, ...PRIVACY_CHOICES, 'priv_keep', 'priv_why', 'kept', 'kept_long']) {
      assert.ok(p.includes(`<li><b>${t[`${k}_k`]}</b> ${t[k]}</li>`), `${lang}: ${k}`);
    }
    assert.ok(p.includes(`<b>${t.priv_device_k}</b> ${t.priv_device}`), `${lang}: the device id`);
    assert.ok(p.includes(`<li><b>${t.priv_long_k}</b> ${t.priv_long} <a href="/30da/delete-data?lang=${lang}">${t.priv_how_delete}</a></li>`), `${lang}: how long + how to delete`);
    assert.ok(p.includes(`<li>${t.priv_never}</li>`), `${lang}: never sold`);
  }
  // Every data item the stores ask about is named (English words checked; the other languages carry the same keys).
  const en = shown(privacyPage({ lang: 'en' }));
  for (const w of ['app name', 'Real name', 'Birth year', 'gender', 'job', 'Phone number', 'email', 'photos', 'approximate location',
    'Lines and chat', 'translations', 'Reports and blocks', 'Support', 'PIN', 'Phone ID']) {
    assert.ok(en.includes(w), `privacy names "${w}"`);
  }
  assert.match(PAGE_STRINGS.en.priv_pin, /scrambled/, 'the PIN only hashed');
  assert.match(PAGE_STRINGS.en.priv_birth, /30/, 'birth year: the age check');
});

test('privacy: who sees what — guests see app name, gender, job, hearts, a distance band, photo 1; moderators may read conversations', () => {
  const en = PAGE_STRINGS.en;
  for (const w of ['app name', 'gender', 'job', 'hearts', 'distance band', 'photo 1']) assert.ok(en.priv_guests.includes(w), `guests: ${w}`);
  assert.match(en.priv_who, /Photo 2 at Level 2/);
  assert.match(en.priv_who, /real name at Level 3/);
  assert.match(en.priv_team, /may read conversations/);
  assert.match(en.priv_team, /photo/, 'the team checks new photos (src/lib/thirtyda-photo-review.mjs)');
  for (const lang of LANGS) assert.ok(PAGE_STRINGS[lang].priv_guests.includes('2'), `${lang}: the band example (≤ 2 km)`);
});

test('privacy: every outside service by name — Railway, MongoDB Atlas, Nominatim, our translation server, Google Fonts, Telegram, WhatsApp/Meta, Google/Facebook/TikTok/Apple', () => {
  assert.equal(TRANSLATE_HOST, 'llm.ggmt.sg');
  assert.deepEqual(PROCESSORS.map(([, k]) => k), ['proc_railway', 'proc_atlas', 'proc_osm', 'proc_translate', 'proc_fonts', 'priv_codes', 'proc_signin', 'proc_dictation']);
  const colon = { en: ':', km: '៖', zh: '：', ko: ':', ja: '：' };
  for (const lang of LANGS) {
    const t = PAGE_STRINGS[lang];
    const p = privacyPage({ lang });
    for (const [name, k] of PROCESSORS) {
      const label = name ? `${name}${colon[lang]}` : t[`${k}_k`];
      assert.ok(p.includes(`<li><b>${label}</b> ${t[k]}`), `${lang}: ${name || k}`);
    }
    const text = shown(p);
    for (const w of ['Railway', 'MongoDB Atlas', 'OpenStreetMap Nominatim', 'llm.ggmt.sg', 'Google Fonts', 'Telegram', 'WhatsApp', 'Meta',
      'Google', 'Facebook', 'TikTok', 'Apple']) assert.ok(text.includes(w), `${lang}: names ${w}`);
  }
  // The code really uses them (so the list is not made up).
  assert.match(read('./thirtyda-geo.mjs'), /nominatim\.openstreetmap\.org/);
  assert.match(read('./thirtyda-translate.mjs'), /llm\.ggmt\.sg/);
  assert.match(PAGE_STRINGS.en.proc_translate, /No outside AI company/);
});

test('privacy: how long, what a delete keeps (true to thirtyda-delete.mjs), and how to withdraw consent', () => {
  const en = PAGE_STRINGS.en;
  assert.match(en.priv_long, /until you delete your account/);
  assert.equal(VERIFY_KEEP_MS, 48 * 3600e3);
  assert.match(en.priv_long, /48 hours/);
  // What stays after a delete: a bare note of reports / of the delete, and the Telegram support chat, unlinked.
  assert.match(COVERAGE[FLAGS], /only ids, reason \(no names\), time/);
  assert.match(en.kept, /member numbers, reason and time; no names, words or photos/);
  assert.match(COVERAGE[SUPPORT_CHATS], /link to the profile: dropped/);
  assert.match(en.kept, /no longer linked to your profile/);
  assert.equal(DEVICE_KEEP_MS, 30 * 864e5);
  assert.match(en.kept_long, /30 days/);
  for (const lang of LANGS) assert.ok(PAGE_STRINGS[lang].kept_long.includes('30'), `${lang}: the phone ID, 30 days`);
  // Withdraw consent: delete in the app, or email.
  assert.match(en.priv_withdraw, /Delete my account/);
  assert.match(en.priv_withdraw, /email/);
});

// ---------------------------------------------------------------- delete-data (plan item 9)

test('delete-data: the developer exactly as on Google Play, the in-app steps in the app\'s own words, email, what goes / stays / how long', () => {
  const delWords = appStrings('../thirtyda-app/screens/delete-account.js');
  const meWords = appStrings('../thirtyda-app/screens/my-profile.js');
  for (const lang of LANGS) {
    const t = PAGE_STRINGS[lang];
    const d = deleteDataPage({ lang });
    commonChecks('delete-data', d, lang);
    assert.ok(d.includes(`<p>${t.del_for.replace('{operator}', '<b>GGMT PTE. LTD.</b>')}</p>`), `${lang}: for the 30+DA app by GGMT PTE. LTD.`);
    assert.ok(t.del_for.includes('30+DA'), `${lang}: names the app`);
    // In page order: in the app, step by step, or by email; then what goes, what stays, how long.
    const order = [`<li><b>${t.del_app_k}</b> ${t.del_app}</li>`, `<li><b>${t.del_steps_k}</b> ${t.del_steps}</li>`, `<b>${t.del_mail_k}</b>`,
      `<li><b>${t.del_goes_k}</b> ${t.del_goes}</li>`, `<li><b>${t.kept_k}</b> ${t.kept}</li>`, `<li><b>${t.kept_long_k}</b> ${t.kept_long}</li>`,
      t.del_others, t.del_signout];
    let at = -1;
    for (const part of order) {
      const i = d.indexOf(part);
      assert.ok(i > at, `${lang}: in order: ${part.slice(0, 60)}`);
      at = i;
    }
    // The steps use the app's own words: My profile → Delete my account → Continue → PIN → Delete forever.
    const w = delWords[lang];
    for (const label of [meWords[lang].me_title, w.da_delete, w.da_continue, w.da_forever]) {
      assert.ok(label && t.del_steps.includes(label), `${lang}: del_steps says "${label}"`);
    }
    assert.ok(t.del_app.includes(meWords[lang].me_title) && t.del_app.includes(w.da_delete), `${lang}: del_app in the app's words`);
  }
  assert.doesNotMatch(PAGE_STRINGS.en.del_lede, /everything/i, 'never "everything": a bare note stays');
  assert.match(PAGE_STRINGS.en.del_step3, /within 30 days/);
});

// ---------------------------------------------------------------- child safety (plan item 10)

test('child-safety: 30+DA and GGMT PTE. LTD., zero tolerance for CSAE, the in-app report path, CSAM removed + reported, the contact', () => {
  const safety = appStrings('../thirtyda-app/screens/safety.js');
  assert.ok(PERSON_REPORT_REASONS.includes('underage') && CHAT_REPORT_REASONS.includes('underage'), 'the app has an Underage reason');
  assert.equal(CHILD_SAFETY_SUBJECT, '30+DA child safety');
  for (const lang of LANGS) {
    const t = PAGE_STRINGS[lang];
    const c = childSafetyPage({ lang });
    commonChecks('child-safety', c, lang);
    assert.ok(c.includes(`<h1>${t.cs_title}</h1>`));
    assert.ok(c.includes(t.cs_lede.replace('{operator}', `<b>${OPERATOR}</b>`)) && t.cs_lede.includes('30+DA') && t.cs_lede.includes('CSAE'), `${lang}: names the app, the developer, CSAE`);
    for (const k of CHILD_SAFETY_POINTS) {
      const line = t[k].replace('{mail}', `<a href="mailto:${CONTACT_EMAIL}?subject=30%2BDA%20child%20safety">${CONTACT_EMAIL}</a>`);
      assert.ok(c.includes(`<li><b>${t[`${k}_k`]}</b> ${line}</li>`), `${lang}: ${k}`);
    }
    assert.ok(t.cs_csam.includes('NCMEC') && t.cs_csam_k.includes('CSAM'), `${lang}: CSAM reported (NCMEC / the police)`);
    // The report path in the app's own words: Underage (a profile), Report photo (a photo).
    assert.ok(t.cs_report.includes(safety[lang].sf_reason_underage), `${lang}: "${safety[lang].sf_reason_underage}"`);
    assert.ok(t.cs_report.includes(safety[lang].sf_report_photo_btn), `${lang}: "${safety[lang].sf_report_photo_btn}"`);
    assert.ok(c.includes(`<p class="doc-alert" role="note">${t.cs_danger}</p>`), `${lang}: a child in danger → the police`);
    assert.ok(t.cs_act.includes('24'), `${lang}: checked within 24 hours`);
  }
  assert.match(PAGE_STRINGS.en.cs_lede, /zero tolerance for child sexual abuse and exploitation/);
  assert.match(PAGE_STRINGS.en.cs_csam, /removed at once/);
});

// ---------------------------------------------------------------- help & contact (plan item 11)

test('support: who runs it, the email, Telegram @GKSmartbiz (optional), report, child safety, delete — and links in the same language', () => {
  assert.equal(SUPPORT_TELEGRAM, 'https://t.me/GKSmartbiz');
  assert.equal(SUPPORT_TELEGRAM_NAME, '@GKSmartbiz');
  for (const lang of LANGS) {
    const t = PAGE_STRINGS[lang];
    const s = supportPage({ lang });
    commonChecks('support', s, lang);
    assert.ok(s.includes('href="mailto:gk.smart@ggmt.sg?subject=30%2BDA%20support"'), `${lang}: email`);
    assert.ok(s.includes(`<li><b>${t.support_tg_k}</b> ${t.support_tg.replace('{bot}', '<a href="https://t.me/GKSmartbiz" target="_blank" rel="noopener">@GKSmartbiz</a>')}</li>`), `${lang}: Telegram`);
    assert.ok(t.support_tg_k.includes('Telegram') && t.support_tg.includes('Telegram'), `${lang}: optional, never needed`);
    for (const path of ['child-safety', 'delete-data', 'privacy', 'terms']) assert.ok(s.includes(`href="/30da/${path}?lang=${lang}"`), `${lang}: → ${path}`);
    assert.ok(s.includes(`<b>${t.support_who_k}</b> ${t.support_who.replace('{operator}', `<b>${OPERATOR}</b>`)}`), `${lang}: who runs it`);
  }
  assert.match(PAGE_STRINGS.en.support_tg, /never need Telegram/);
});

// ---------------------------------------------------------------- the routes

test('GET /30da/child-safety, /30da/support and /30da/help: 200, the doc pages\' strict CSP, language by ?lang / Accept-Language', async () => {
  const privacy = await get('/30da/privacy');
  for (const path of ['/30da/child-safety', '/30da/support', '/30da/help']) {
    const res = await get(path);
    assert.equal(res.status, 200, path);
    assert.match(res.headers['Content-Type'], /^text\/html; charset=utf-8$/);
    assert.equal(res.headers['Content-Security-Policy'], privacy.headers['Content-Security-Policy'], `${path}: the same CSP`);
    assert.equal(res.headers['X-Frame-Options'], 'DENY');
    assert.equal(res.headers.Vary, 'Accept-Language');
    assert.ok(res.body.includes('<html lang="en">'), path);
    const km = await get(`${path}?lang=km`);
    assert.ok(km.body.includes('<html lang="km">'), `${path}?lang=km`);
    const ja = await get(path, { 'accept-language': 'ja-JP' });
    assert.ok(ja.body.includes('<html lang="ja">'), `${path}: a Japanese browser`);
  }
  assert.equal((await get('/30da/help?lang=ko')).body, (await get('/30da/support?lang=ko')).body, '/help is the same page as /support');
  assert.ok((await get('/30da/child-safety')).body.includes('<h1>Child safety</h1>'));
});

// ---------------------------------------------------------------- the Level 3 chat without Telegram (plan item 16)

test('the Level 3 chat takes any verified way (phone, Google, Facebook, TikTok, Apple), not only a phone number', () => {
  for (const way of ['phone', 'gmail', 'facebook', 'tiktok', 'apple']) {
    assert.ok(VERIFIED_WAYS.includes(way), way);
    assert.equal(canTalk({ verified: { [way]: true } }), true, way);
  }
  const app = read('./thirtyda-app.mjs');
  const gate = app.slice(app.indexOf('function chatGate('), app.indexOf('async function listMessages('));
  assert.match(gate, /!canTalk\(ctx\.me\)/, 'chatGate asks canTalk');
  assert.doesNotMatch(gate, /verified\?\.phone/, 'never only the phone');
  assert.match(app, /phoneNeeded: !canTalk\(me\)/, 'the conversation says the same (chat.phoneNeeded)');
  // The app: the profile's lock note and the Me page's note follow the same rule.
  const vc = read('../thirtyda-app/screens/verify-chat.js');
  assert.match(vc, /export const CHAT_WAYS = Object\.freeze\(\['phone', 'gmail', 'facebook', 'tiktok', 'apple'\]\)/);
  assert.match(read('../thirtyda-app/screens/profile.js'), /pair\?\.next === 'chat' && !canChat\(state\.me\)/);
  assert.match(read('../thirtyda-app/screens/my-profile.js'), /CHAT_WAYS\.some\(\(k\) => v\[k\] === true\)/);
  // The design board's stand-in server too.
  const demo = read('../thirtyda-app/board/demo.js');
  assert.match(demo, /if \(!canTalk\(u\)\) throw fail\(403, 'phone_needed'/);
});

// ---------------------------------------------------------------- photos not saveable by a long press

test('app.css: members\' photos cannot be saved with a long press (iOS) or dragged out', () => {
  const css = read('../thirtyda-app/app.css');
  const rule = css.match(/\nimg \{[^}]*-webkit-touch-callout: none;[^}]*\}/)?.[0] || '';
  assert.ok(rule, 'img { -webkit-touch-callout: none }');
  assert.match(rule, /-webkit-user-drag: none/);
});

test('Khmer on the pages: every phrase kept whole (a word joiner between its clusters), so a line breaks only at a space; <head> plain', () => {
  const pages = {
    privacy: privacyHtml, terms: termsHtml, 'delete-data': deleteDataHtml, support: supportHtml, 'child-safety': childSafetyHtml,
    home: homePage, back: backPage,
    'app-return': (o) => appReturnPage({ ...o, ok: true, provider: 'google', intentUrl: 'intent://auth#Intent;end', schemeUrl: 'sg.ggmt.thirtyda://auth' }),
  };
  for (const [name, build] of Object.entries(pages)) {
    for (const lang of LANGS) {
      const html = build({ lang });
      const head = html.match(/<head>[\s\S]*?<\/head>/)[0];
      assert.ok(!head.includes(WORD_JOINER), `${name} ${lang}: the title, description and share card stay plain`);
      // Every Khmer run between two tags is already what khmerKeep makes of it (the flag row and the hashtags aside:
      // one-word links, and a hashtag must copy as typed).
      const body = html.slice(html.indexOf('<body')).replace(/<nav class="langs"[\s\S]*?<\/nav>/g, '').replace(/<p class="hm-tags">[\s\S]*?<\/p>/, '');
      const texts = [...body.matchAll(/>([^<]+)</g)].map((m) => m[1]).filter((x) => /[ក-៿]/.test(x));
      if (lang === 'km') assert.ok(texts.length >= 3 && body.includes(WORD_JOINER), `${name}: Khmer, kept whole`);
      for (const x of texts) assert.equal(khmerKeep(x), x, `${name} ${lang}: "${khmerPlain(x).slice(0, 40)}" kept whole`);
    }
  }
  // The words themselves never change: pageWords is PAGE_STRINGS with joiners only.
  for (const lang of LANGS) {
    for (const [k, v] of Object.entries(PAGE_STRINGS[lang])) {
      assert.equal(pageWords(lang)[k], khmerKeep(v), `${lang}.${k}`);
      assert.equal(khmerPlain(pageWords(lang)[k]), khmerPlain(v), `${lang}.${k}: the same words`);
    }
  }
  assert.equal(pageWords('en').priv_title, PAGE_STRINGS.en.priv_title, 'no Khmer: the very same string');
});
