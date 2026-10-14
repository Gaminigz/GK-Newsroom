// Run: npm run 30da:test (or node --test src/lib/thirtyda-home.test.mjs)
// GET /30da/home — the public home page (owner 2026-10-14: "explain how the app works: Level 1 ask 5, then 3, then chat,
// and 5 languages, safe and calm"; then on the first draft: "it's not had orange — follow the app colours", "it's not
// a business app, it's a date app", "numbers for what?"). The page (src/lib/thirtyda-pages.mjs homePage): 5 languages,
// the night hero with the one button to the web app, the teaser's photo sequence on the red string, the 3 levels in
// words (one count only, true to the code), safe and calm in plain lines, "coming soon" to the stores as plain text,
// the footer; only the app's colours; no script, no inline style. The photo slots (src/lib/thirtyda-home.mjs): an
// <img> only when the file is there, else a night-city placeholder; the image route: tight names, jpg / webp, a day.
// And the app's own way there: "Home page" above "Privacy policy · Terms · Help" (screens/delete-account.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  homePage, PAGE_STRINGS, OPERATOR, CONTACT_EMAIL, HOME_SLOTS, HOME_PEOPLE, HOME_HERO, HOME_PORTRAIT, HOME_SEQUENCE,
  HOME_IMG_PATH, WEB_APP_PATH,
} from './thirtyda-pages.mjs';
import {
  homePhotos, sendHomeImage, HOME_IMG_RE, HOME_IMG_DIR, HOME_IMG_TYPES, HOME_IMG_CACHE,
} from './thirtyda-home.mjs';
import { handleThirtyDaApp } from './thirtyda-app.mjs';
import { LEVEL_RULES, SYSTEM_QUESTIONS, replyOptions } from '../thirtyda-app/shared/questions.js';
import { PHOTO_SLOT_LEVELS, AGE_MIN } from '../thirtyda-app/shared/rules.js';

const LANGS = ['en', 'km', 'zh', 'ko', 'ja'];
const HOME_KEYS = Object.keys(PAGE_STRINGS.en).filter((k) => k.startsWith('home_'));
/** The words a reader sees (tags out), for "no technical words" style checks. */
const shown = (html) => html.replace(/<head>[\s\S]*?<\/head>/, '').replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
/** The home page's block of pages.css (from its banner to the end). */
const homeCss = () => {
  const css = readFileSync(new URL('../thirtyda-app/pages.css', import.meta.url), 'utf8');
  const at = css.indexOf('The home page (/30da/home');
  return { css, at, block: css.slice(css.lastIndexOf('/*', at)) };
};

async function get(path, headers = {}, method = 'GET') {
  const req = { method, url: path, headers: { host: 'ecom.ggmt.sg', ...headers } };
  const res = { status: null, headers: null, body: undefined, headersSent: false };
  res.writeHead = (s, h = {}) => { res.status = s; res.headers = h; res.headersSent = true; return res; };
  res.end = (b) => { res.body = b === undefined ? undefined : Buffer.isBuffer(b) ? b : String(b); return res; };
  await handleThirtyDaApp(req, res, new URL(path, 'https://ecom.ggmt.sg'));
  return res;
}

// ---------------------------------------------------------------- the words

test('every home string is there in all 5 languages, short, plain; the app\'s own tagline and headline', () => {
  assert.ok(HOME_KEYS.length >= 25, `home keys: ${HOME_KEYS.length}`);
  for (const lang of LANGS) {
    assert.deepEqual(Object.keys(PAGE_STRINGS[lang]).filter((k) => k.startsWith('home_')).sort(), [...HOME_KEYS].sort(), `${lang}: the same keys`);
    for (const k of HOME_KEYS) {
      const s = PAGE_STRINGS[lang][k];
      assert.ok(typeof s === 'string' && s.trim(), `${lang}.${k}`);
      assert.ok(!/[<>]/.test(s), `${lang}.${k}: plain text`);
      // Every line short (the owner hates walls of text); the meta description is the one longer line.
      if (k !== 'home_desc') assert.ok([...s].length <= 80, `${lang}.${k}: short (${[...s].length})`);
    }
  }
  // The opening screen's own words (src/thirtyda-app/screens/opening.js op_tagline / op_headline).
  const opening = readFileSync(new URL('../thirtyda-app/screens/opening.js', import.meta.url), 'utf8');
  for (const lang of LANGS) {
    const block = opening.slice(opening.indexOf(`  ${lang}: {`));
    for (const [home, op] of [['home_tagline', 'op_tagline'], ['home_headline', 'op_headline']]) {
      const want = block.match(new RegExp(`${op}: '([^']*)'`))?.[1];
      assert.equal(PAGE_STRINGS[lang][home], want, `${lang}.${home} = the app's ${op}`);
    }
  }
  const en = PAGE_STRINGS.en;
  assert.equal(en.home_tagline, 'Safe and calm dating for 30+');
  assert.equal(en.home_free, 'Free · 5 languages');
  assert.equal(en.home_soon, 'Coming soon to the App Store and Google Play.');
  assert.match(en.home_string, /red string/);
  // A dating page, not a business one.
  const words = HOME_KEYS.map((k) => en[k]).join(' ');
  assert.ok(!/feature|platform|solution|business|customer|users\b|get the app/i.test(words), 'no business words');
});

test('the levels in words, true to the code — and ONE count only ("5 easy questions"); no 2027, no launch date', () => {
  // The rules the page describes (if these change, the page's words must change too).
  assert.deepEqual(LEVEL_RULES, { 1: { pick: 4, write: 1 }, 2: { pick: 3, write: 2 } });
  assert.equal(LEVEL_RULES[1].pick + LEVEL_RULES[1].write, 5, 'Level 1: 5 lines');
  assert.ok(SYSTEM_QUESTIONS[1].every((x) => /\?$/.test(x.text.en)), 'Level 1 lines are questions');
  assert.ok(replyOptions('picked').length > 1 && replyOptions('written').length > 1, 'answered with one tap');
  assert.ok(LEVEL_RULES[2].write > 0, 'Level 2: some lines in your own words');
  assert.equal(PHOTO_SLOT_LEVELS[1], 2, 'another photo (photo 2) opens at Level 2');
  assert.equal(AGE_MIN, 30);
  const en = PAGE_STRINGS.en;
  assert.deepEqual([en.home_l1_h, en.home_l2_h, en.home_l3_h], ['Say hello', 'Go deeper', 'Chat']);
  assert.equal(en.home_l1, '5 easy questions. One tap to answer.');
  assert.match(en.home_l2, /in your own words\. Another photo opens\./);
  assert.match(en.home_l3, /^Every message translated into your language\. Real names/);
  for (const lang of LANGS) {
    const t = PAGE_STRINGS[lang];
    // The one count on the page's level lines: Level 1's 5 questions. Nothing else carries a digit.
    assert.ok(/5/.test(t.home_l1), `${lang}: Level 1 says 5`);
    for (const k of ['home_l1_h', 'home_l2_h', 'home_l2', 'home_l3_h', 'home_l3', 'home_how_lede', 'home_line', 'home_string',
      'home_frame_2', 'home_frame_3', 'home_frame_4', 'home_headline']) {
      assert.ok(!/\d/.test(t[k]), `${lang}.${k}: no numbers`);
    }
    assert.ok(!/2027|2026|launch/i.test(Object.entries(t).filter(([k]) => k.startsWith('home_')).map(([, v]) => v).join(' ')), `${lang}: no year, no launch date`);
  }
});

// ---------------------------------------------------------------- the page

test('page: every language, the right <html lang>, nothing missing, the button to the web app (top and end)', () => {
  for (const lang of LANGS) {
    const t = PAGE_STRINGS[lang];
    const html = homePage({ lang });
    assert.ok(html.startsWith('<!doctype html>') && html.includes(`<html lang="${lang}">`), `${lang}: html lang`);
    assert.ok(!/undefined|null|\{\w+\}|NaN/.test(html), `${lang}: nothing unfilled`);
    assert.ok(html.includes('<meta name="robots" content="index">'), `${lang}: indexed`);
    assert.ok(html.includes(`<title>30+DA · ${t.home_tagline}</title>`), `${lang}: title`);
    assert.ok(html.includes(`<meta name="description" content="${t.home_desc}">`), `${lang}: description`);
    assert.ok(html.includes('<body class="page-home">'));
    assert.ok(html.includes('<link rel="stylesheet" href="/30da/pages.css">'));
    // Every home string is on the page (the photo alt only when a photo is there: below).
    for (const k of HOME_KEYS.filter((x) => !['home_photo', 'home_desc', 'home_level'].includes(x))) {
      assert.ok(html.includes(t[k]), `${lang}: ${k}`);
    }
    // The hero: the wordmark, the one warm line, the promise as the h1, Open 30+DA → /30da/ (the web app's sign-in).
    const hero = html.match(/<header class="hm-hero">[\s\S]*?<\/header>/)?.[0] ?? '';
    assert.ok(hero.includes('<p class="hm-mark" role="img" aria-label="30+DA">'), `${lang}: wordmark`);
    assert.ok(hero.includes(`<p class="hm-line">${t.home_line}</p>`), `${lang}: the warm line`);
    assert.ok(hero.includes(`<h1 class="hm-h1">${t.home_tagline}</h1>`), `${lang}: the promise`);
    assert.ok(hero.includes(`<a class="hm-btn" href="/30da/">${t.app_open}<svg`), `${lang}: the button (white on navy)`);
    assert.ok(hero.includes(`<p class="hm-free">${t.home_free}</p>`));
    // The same button at the end (navy on the light section), after the app's own headline.
    assert.ok(html.includes(`<p class="hm-end-line">${t.home_headline}</p>`), `${lang}: the headline at the end`);
    assert.ok(html.includes(`<a class="hm-btn hm-btn-navy" href="/30da/">${t.app_open}<svg`), `${lang}: the end button`);
    assert.equal((html.match(/class="hm-btn[ "]/g) || []).length, 2, 'two buttons, both to the web app');
    assert.equal(WEB_APP_PATH, '/30da/');
    // The order: hero → the photo sequence → how it works → safe and calm → footer.
    const at = (s) => html.indexOf(s);
    assert.ok(at('class="hm-hero"') < at('class="hm-seq"') && at('class="hm-seq"') < at('id="hm-how-h"')
      && at('id="hm-how-h"') < at('id="hm-safe-h"') && at('id="hm-safe-h"') < at('class="hm-foot"'), `${lang}: the order`);
    // The levels: a path in words — Level n, a name, one line. No numerals in circles, no big numbers.
    for (const n of [1, 2, 3]) {
      assert.ok(html.includes(`<p class="hm-lv-tag">${t.home_level.replace('{n}', n)}</p>\n            <h3>${t[`home_l${n}_h`]}</h3>\n            <p class="hm-lv-text">${t[`home_l${n}`]}</p>`), `${lang}: level ${n}`);
    }
    assert.equal((html.match(/<li class="hm-block hm-knot hm-lv">/g) || []).length, 3, 'three levels');
    // The flag row: 5 links to this page in each language, this one marked.
    const flags = html.match(/<nav class="langs"[\s\S]*?<\/nav>/)?.[0] || '';
    for (const code of LANGS) assert.ok(flags.includes(`href="/30da/home?lang=${code}"`), `${lang}: flag ${code}`);
    assert.ok(flags.includes(`hreflang="${lang}" lang="${lang}" aria-current="true"`));
    // Footer: who runs it, the email, the small pages in the same language.
    assert.ok(html.includes(`${t.run_by} <b>${OPERATOR}</b>`), `${lang}: operator`);
    assert.ok(html.includes(`<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>`), `${lang}: mailto`);
    for (const [path, label] of [['privacy', t.priv_title], ['terms', t.home_terms], ['support', t.home_help], ['delete-data', t.del_title]]) {
      assert.ok(html.includes(`<a href="/30da/${path}?lang=${lang}">${label}</a>`), `${lang}: footer ${path}`);
    }
    // CSP-safe: no script at all, no inline style, no handlers, no javascript: links.
    assert.ok(!/<script\b/i.test(html), `${lang}: no script`);
    assert.ok(!/\sstyle=|<style\b/i.test(html), `${lang}: no inline style`);
    assert.ok(!/\son[a-z]+=|javascript:/i.test(html), `${lang}: no handlers`);
    // Not in the stores yet: one quiet plain line — no store links, no badges, no outside images.
    assert.ok(!/apps\.apple\.com|itunes\.apple|play\.google|market:\/\/|itms-apps|badge/i.test(html), `${lang}: no store link`);
    assert.ok(!/<img[^>]+src="(?!\/30da\/home\/img\/)/.test(html), `${lang}: images only from our own folder`);
    assert.ok(html.includes(`<p class="hm-soon">${t.home_soon}</p>`), `${lang}: "coming soon" is plain text, not a link`);
    // Every href is ours: the app, this site's pages, or the email.
    for (const [, href] of html.matchAll(/href="([^"]*)"/g)) {
      assert.ok(/^\/30da\/|^mailto:gk\.smart@ggmt\.sg$|^https:\/\/fonts\.(googleapis|gstatic)\.com\b|^data:,$/.test(href), `${lang}: href ${href}`);
    }
  }
  assert.ok(homePage().includes('<html lang="en">'), 'no language → English');
  assert.ok(homePage({ lang: 'xx' }).includes('<html lang="en">'));
  assert.ok(!/OAuth|token|cookie|redirect/i.test(shown(homePage())), 'no technical words');
});

test('no numbers for show: no big-number badges, no numbered circles, no feature cards or icon tiles', () => {
  for (const lang of LANGS) {
    const html = homePage({ lang });
    // The old draft's markup is gone.
    for (const cls of ['hm-lv-num', 'hm-lv-plus', 'hm-n', 'hm-age', 'hm-ico', 'hm-points', 'hm-steps', 'hm-get', 'hm-btn2', 'hm-lvbar', 'hm-verify']) {
      assert.ok(!new RegExp(`class="[^"]*\\b${cls}\\b`).test(html), `${lang}: no .${cls}`);
    }
    // No element holds a bare number ("5", "3+2", "30+") — the wordmark's letters aside.
    const body = html.replace(/<head>[\s\S]*?<\/head>/, '').replace(/<p class="hm-mark"[\s\S]*?<\/p>/, '');
    assert.ok(!/>\s*\d+\s*(?:\+\s*\d*\s*)?</.test(body), `${lang}: no bare number in any element`);
    // The only icon left is the button's arrow; everything else that is an SVG is the red thread.
    const svgs = html.match(/<svg class="[^"]*"/g) || [];
    assert.ok(svgs.every((s) => /hm-thread|hm-i"/.test(s)), `${lang}: ${svgs.join(' ')}`);
    assert.equal(svgs.filter((s) => /hm-i"/.test(s)).length, 2, `${lang}: the two buttons' arrows`);
  }
});

test('photos: hero, people-1 and the sequence people-2 → 3 → 4 together in order; a night placeholder for every empty slot', () => {
  assert.deepEqual(HOME_SLOTS, ['hero', 'people-1', 'people-2', 'people-3', 'people-4']);
  assert.equal(HOME_HERO, 'hero');
  assert.equal(HOME_PORTRAIT, 'people-1');
  assert.deepEqual(HOME_SEQUENCE, ['people-2', 'people-3', 'people-4']);
  assert.deepEqual(HOME_PEOPLE, ['people-1', 'people-2', 'people-3', 'people-4']);
  assert.equal(HOME_IMG_PATH, '/30da/home/img/');

  const none = homePage({ lang: 'km' });
  assert.equal((none.match(/<img\b/g) || []).length, 0, 'no photo yet → no <img>');
  for (const slot of HOME_SLOTS) {
    assert.equal((none.match(new RegExp(`<span class="hm-ph hm-ph-${slot}" aria-hidden="true">`, 'g')) || []).length, 1, `placeholder ${slot}`);
  }
  // Every tall placeholder carries its fine red thread; the hero's thread is drawn over the hero itself.
  for (const slot of HOME_PEOPLE) {
    assert.match(none, new RegExp(`<span class="hm-ph hm-ph-${slot}" aria-hidden="true"><svg class="hm-thread hm-ph-thread"[^>]*>(<path[^>]*/>)+</svg></span>`), `${slot}: the thread`);
  }
  assert.match(none, /<svg class="hm-thread hm-thread-hero"/);
  assert.ok(none.includes('<header class="hm-hero">'), 'no hero photo: the placeholder fills the hero');
  // The sequence: ONE list, the three frames in order, each with its line.
  const seq = none.match(/<ol class="hm-seq">[\s\S]*?<\/ol>/)?.[0] ?? '';
  assert.deepEqual([...seq.matchAll(/hm-ph-(people-\d)/g)].map((m) => m[1]), ['people-2', 'people-3', 'people-4']);
  assert.deepEqual([...seq.matchAll(/<p class="hm-cap">([^<]*)<\/p>/g)].map((m) => m[1]),
    ['home_frame_2', 'home_frame_3', 'home_frame_4'].map((k) => PAGE_STRINGS.km[k]));
  assert.match(seq, /class="hm-thread hm-seq-line hm-on-phone"/);
  assert.match(seq, /class="hm-thread hm-seq-string hm-on-wide"/);

  const photos = { [HOME_HERO]: ['jpg'], 'people-2': ['webp', 'jpg'], 'people-3': ['webp'], 'people-4': ['png'], 'people-9': ['jpg'] };
  for (const lang of LANGS) {
    const t = PAGE_STRINGS[lang];
    const html = homePage({ lang, photos });
    assert.ok(html.includes(`<div class="hm-hero-bg"><img src="/30da/home/img/hero.jpg" alt="30+DA · ${t.home_tagline}" width="1600" height="900" fetchpriority="high" decoding="async"></div>`), `${lang}: hero`);
    assert.ok(html.includes(`<picture><source type="image/webp" srcset="/30da/home/img/people-2.webp"><img src="/30da/home/img/people-2.jpg" alt="${t.home_photo.replace('{n}', 2)}" width="893" height="1600" loading="lazy" decoding="async"></picture>`), `${lang}: people-2 both kinds`);
    assert.ok(html.includes(`<img src="/30da/home/img/people-3.webp" alt="${t.home_photo.replace('{n}', 3)}" width="893" height="1600"`), `${lang}: people-3 webp`);
    assert.equal((html.match(/<img\b/g) || []).length, 3, `${lang}: only real files (a png is not one; people-9 is not a slot)`);
    assert.equal((html.match(/class="hm-ph /g) || []).length, HOME_SLOTS.length - 3, `${lang}: the rest are placeholders`);
    assert.ok(html.includes('<span class="hm-ph hm-ph-people-4" aria-hidden="true">'));
    assert.ok(html.includes('<header class="hm-hero has-photo">'), `${lang}: the hero photo (phones show it under the words)`);
  }
});

test('homePhotos: reads which slots have a jpg / webp (files only, slots only); a missing folder → none', () => {
  const dir = mkdtempSync(join(tmpdir(), '30da-home-'));
  try {
    for (const f of ['hero.jpg', 'people-1.webp', 'people-1.jpg', 'people-3.png', 'people-5.jpg', 'people-9.jpg', 'README.md', 'Hero.JPG']) writeFileSync(join(dir, f), 'x');
    mkdirSync(join(dir, 'people-4.jpg')); // a folder, not a photo
    const url = pathToFileURL(`${dir}/`);
    assert.deepEqual(homePhotos({ dir: url }), { hero: ['jpg'], 'people-1': ['webp', 'jpg'] });
    assert.deepEqual(homePhotos({ dir: pathToFileURL(`${dir}/nope/`) }), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // The real folder: its README names every slot and the sequence; whatever is there, only slots with jpg / webp come back.
  const readme = readFileSync(new URL('README.md', HOME_IMG_DIR), 'utf8');
  for (const name of ['hero.jpg', 'people-1.jpg', 'people-2.jpg', 'people-3.jpg', 'people-4.jpg', '1600 × 900', '893 × 1600', 'ONE sequence']) {
    assert.ok(readme.includes(name), `README: ${name}`);
  }
  assert.ok(!/people-[5-9]/.test(readme), 'README: no old slots');
  const real = homePhotos();
  for (const [slot, exts] of Object.entries(real)) {
    assert.ok(HOME_SLOTS.includes(slot) && exts.every((x) => ['webp', 'jpg'].includes(x)), slot);
  }
});
// ---------------------------------------------------------------- the routes

test('GET /30da/home and /30da/home/: 200, the strict page CSP like the other doc pages, language by ?lang / Accept-Language', async () => {
  const privacy = await get('/30da/privacy');
  for (const path of ['/30da/home', '/30da/home/']) {
    const res = await get(path);
    assert.equal(res.status, 200, path);
    const h = res.headers;
    assert.match(h['Content-Type'], /^text\/html; charset=utf-8$/);
    assert.equal(h['Content-Security-Policy'], privacy.headers['Content-Security-Policy'], 'the same CSP as the other doc pages');
    const csp = h['Content-Security-Policy'];
    assert.match(csp, /default-src 'self'/);
    assert.ok(!/unsafe-inline|unsafe-eval|\*/.test(csp), `no inline script or style: ${csp}`);
    assert.match(csp, /img-src 'self'/, 'photos from our own folder');
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(h['X-Frame-Options'], 'DENY');
    assert.equal(h['X-Content-Type-Options'], 'nosniff');
    assert.equal(h['Cache-Control'], privacy.headers['Cache-Control'], 'cached like the other doc pages');
    assert.equal(h.Vary, 'Accept-Language');
    assert.ok(res.body.includes('<html lang="en">') && res.body.includes('<a class="hm-btn" href="/30da/">'));
    assert.equal((res.body.match(/<img\b/g) || []).length, Object.keys(homePhotos()).length, 'an <img> only for a slot whose file is there');
  }
  assert.ok((await get('/30da/home?lang=km')).body.includes('<html lang="km">'));
  assert.ok((await get('/30da/home/?lang=ja')).body.includes('<html lang="ja">'));
  assert.ok((await get('/30da/home', { 'accept-language': 'ko-KR,ko;q=0.9,en;q=0.5' })).body.includes('<html lang="ko">'));
  assert.ok((await get('/30da/home?lang=zh', { 'accept-language': 'ja' })).body.includes('<html lang="zh">'), '?lang wins');
  const head = await get('/30da/home', {}, 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body, undefined, 'HEAD: no body');
  // Nothing else under /30da/home is a page.
  for (const path of ['/30da/homes', '/30da/home/x', '/30da/home/img', '/30da/home/img/']) assert.equal((await get(path)).status, 404, path);
});

test('GET /30da/home/img/<name>.jpg|webp: tight names and kinds; a missing photo is a plain 404', async () => {
  assert.deepEqual('/30da/home/img/hero.jpg'.match(HOME_IMG_RE)?.slice(1), ['hero', 'jpg']);
  assert.deepEqual('/30da/home/img/people-3.webp'.match(HOME_IMG_RE)?.slice(1), ['people-3', 'webp']);
  for (const bad of [
    '/30da/home/img/Hero.jpg', '/30da/home/img/hero.JPG', '/30da/home/img/hero.png', '/30da/home/img/hero.jpeg',
    '/30da/home/img/README.md', '/30da/home/img/..%2Fapp.js', '/30da/home/img/a/b.jpg',
    '/30da/home/img/.jpg', '/30da/home/img/-x.jpg', '/30da/home/img/hero.jpg.jpg', '/30da/home/img/hero_1.jpg',
    `/30da/home/img/${'a'.repeat(65)}.jpg`, '/30da/home/img/%68ero.jpg',
  ]) {
    assert.equal(HOME_IMG_RE.test(bad), false, bad);
    assert.equal((await get(bad)).status, 404, bad);
  }
  // The route answers from the real folder: 200 for a slot whose file is there, a plain 404 for one that is not.
  const real = homePhotos();
  for (const slot of HOME_SLOTS) {
    for (const ext of ['jpg', 'webp']) {
      const res = await get(`/30da/home/img/${slot}.${ext}`);
      if (real[slot]?.includes(ext)) {
        assert.equal(res.status, 200, `${slot}.${ext}`);
        assert.equal(res.headers['Content-Type'], HOME_IMG_TYPES[ext]);
      } else {
        assert.equal(res.status, 404, `${slot}.${ext}`);
        assert.match(res.headers['Content-Type'], /^text\/plain/);
        assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
      }
    }
  }
});

test('sendHomeImage: the right Content-Type, cached a day, HEAD without a body, 304 on a matching ETag', async () => {
  const dir = mkdtempSync(join(tmpdir(), '30da-home-img-'));
  try {
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
    const webp = Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'binary');
    writeFileSync(join(dir, 'hero.jpg'), jpg);
    writeFileSync(join(dir, 'people-1.webp'), webp);
    const url = pathToFileURL(`${dir}/`);
    const send = async (name, ext, { method = 'GET', headers = {} } = {}) => {
      const res = { status: null, headers: null, body: undefined };
      res.writeHead = (s, h = {}) => { res.status = s; res.headers = h; return res; };
      res.end = (b) => { res.body = b; return res; };
      await sendHomeImage({ method, headers }, res, name, ext, { dir: url, headers: { 'X-Content-Type-Options': 'nosniff' } });
      return res;
    };
    const a = await send('hero', 'jpg');
    assert.equal(a.status, 200);
    assert.equal(a.headers['Content-Type'], 'image/jpeg');
    assert.equal(a.headers['Cache-Control'], 'public, max-age=86400');
    assert.equal(HOME_IMG_CACHE, 'public, max-age=86400');
    assert.equal(a.headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(a.headers['Content-Length'], jpg.length);
    assert.ok(Buffer.compare(a.body, jpg) === 0, 'the file itself');
    const w = await send('people-1', 'webp');
    assert.deepEqual([w.status, w.headers['Content-Type']], [200, 'image/webp']);
    const h = await send('hero', 'jpg', { method: 'HEAD' });
    assert.deepEqual([h.status, h.body], [200, undefined]);
    const again = await send('hero', 'jpg', { headers: { 'if-none-match': a.headers.ETag } });
    assert.deepEqual([again.status, again.body], [304, undefined]);
    // Missing, the wrong kind, or a name that is not ours: a plain 404 (checked here too, whatever the caller matched).
    for (const [name, ext] of [['hero', 'webp'], ['people-1', 'jpg'], ['hero', 'png'], ['../hero', 'jpg'], ['Hero', 'jpg'], ['hero', 'constructor']]) {
      const r = await send(name, ext);
      assert.equal(r.status, 404, `${name}.${ext}`);
      assert.equal(r.body, 'Not found');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


// ---------------------------------------------------------------- the look

test('pages.css: the home page\'s rules are all under .page-home (the other pages do not change); phones first', () => {
  const { css, at, block: raw } = homeCss();
  assert.ok(at > 0, 'the home block is marked');
  const block = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  // Every selector list outside @keyframes starts with .page-home.
  const noFrames = block.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
  const selectors = [...noFrames.matchAll(/(?:^|[;{}])\s*([^{}@;\s][^{}]*?)\s*\{/g)].map((m) => m[1].trim()).filter(Boolean);
  assert.ok(selectors.length > 60, `found ${selectors.length} rules`);
  for (const list of selectors) {
    for (const sel of list.split(',')) assert.match(sel.trim(), /^\.page-home\b/, `scoped: ${sel.trim()}`);
  }
  for (const name of [...block.matchAll(/@keyframes ([\w-]+)/g)].map((m) => m[1])) assert.match(name, /^hm-/, `keyframes ${name}`);
  assert.ok(!/url\(/.test(block), 'no outside images: the placeholders are gradients');
  assert.match(block, /prefers-reduced-motion: reduce/);
  // The big button is big.
  const btn = block.match(/\.page-home \.hm-btn \{([^}]*)\}/)?.[1] ?? '';
  assert.ok(Number(btn.match(/min-height: (\d+)px/)?.[1]) >= 56, 'a big target');
  // The earlier pages keep their own rules (the flag row's narrow-phone rule is still the first of its kind).
  assert.ok(css.indexOf('@media (max-width: 379px)') < at);
});

test('pages.css: only the app\'s colours — navy, white, the soft greys, the red as the thread; no orange anywhere', () => {
  const { block: raw } = homeCss();
  const block = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  // The draft's warm colours are gone, by name and by value.
  assert.ok(!/#f08c00|#ff8a00|#ffb02e|#ff6b4a|#ffc556|#8a4b00|#fff5e3|#ffeee8|amber|orange|--warm|--coral|255 107 74/i.test(block), 'no orange / amber');
  // Every colour is one of the app's tokens (src/thirtyda-app/app.css :root), or white / navy / greys with some see-through.
  const HEX = new Set(['#0b1c3f', '#13285a', '#ffffff', '#fff', '#eef1f6', '#e9eef6', '#eef2f8', '#cfd6e2', '#e4e8ef', '#d92d20', '#5b6478', '#aab4cf', '#d8def0']);
  for (const [hex] of block.matchAll(/#[0-9a-f]{3,8}\b/gi)) assert.ok(HEX.has(hex.toLowerCase()), `colour ${hex}`);
  const RGB = new Set(['11 28 63', '19 40 90', '255 255 255', '216 222 240', '170 180 207', '217 45 32', '238 241 246']);
  for (const [, rgb] of block.matchAll(/rgb\(\s*(\d+ \d+ \d+)/g)) assert.ok(RGB.has(rgb), `colour rgb(${rgb})`);
  const app = readFileSync(new URL('../thirtyda-app/app.css', import.meta.url), 'utf8');
  for (const token of ['--navy: #0b1c3f', '--navy-2: #13285a', '--red: #d92d20', '--desk: #eef1f6', '--on-dark-muted: #aab4cf', '--on-dark-soft: #d8def0']) {
    assert.ok(app.includes(token), `app.css still has ${token}`);
  }
  // The red is only the thread: its lines, its knots, the rule under the wordmark.
  const redRules = [...block.matchAll(/([^{}]+)\{([^}]*var\(--red\)[^}]*)\}/g)].map((m) => m[1].trim());
  for (const sel of redRules) assert.match(sel, /hm-thread|hm-knot|hm-sec::before|hm-safe-thread::before|hm-end::before|hm-rule/, `red only on the thread: ${sel}`);
  // The buttons: navy on white on the dark hero, white on navy on the light end.
  assert.match(block, /\.page-home \.hm-btn \{[^}]*color: var\(--navy\);[^}]*background: #fff;/);
  assert.match(block, /\.page-home \.hm-btn-navy \{[^}]*color: #fff;[^}]*background: var\(--navy\);/);
});

// ---------------------------------------------------------------- the app's way there

test('the app: "Home page" on its own line above "Privacy policy · Terms · Help" (opening screen and Me), no PIN on the way out', () => {
  const src = readFileSync(new URL('../thirtyda-app/screens/delete-account.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('export function legalLinks()'), src.indexOf('export function accountFoot()'));
  // Its own line (a <p> of its own), first, then the legal line; both in one block.
  const home = fn.indexOf("el('a', { href: `/30da/home?lang=${lang}`, on: { click: away } }, t('da_home'))");
  const privacy = fn.indexOf("el('a', { href: `/30da/privacy?lang=${lang}`, on: { click: away } }, t('da_privacy'))");
  assert.ok(home > 0 && privacy > home, 'the home link, then the privacy link');
  assert.match(fn, /const home = el\('p', \{ class: 'legal-links legal-home' \},\s*el\('a', \{ href: `\/30da\/home\?lang=\$\{lang\}`/);
  assert.match(fn, /return el\('div', \{ class: 'legal-block' \}, home, el\('p', \{ class: 'legal-links' \},/);
  // The same "away" as the other links: leaving to read a page does not lock the app.
  assert.match(fn, /const away = \(\) => \{ if \(state\.me\) leaveWithoutLock\(\); \};/);
  assert.equal((fn.match(/on: \{ click: away \}/g) || []).length, 4, 'all four links leave the same way');
  assert.match(src, /'\.legal-block \{ display: flex; flex-direction: column; align-items: center;/);
  // Shown wherever the legal links are: the opening screen and the Me page's foot.
  const opening = readFileSync(new URL('../thirtyda-app/screens/opening.js', import.meta.url), 'utf8');
  assert.match(opening, /legalLinks\(\)/);
  assert.match(src, /return el\('div', \{ class: 'account-foot' \}, legalLinks\(\),/);
  // da_home in all 5 languages, natural words.
  const want = { en: 'Home page', km: 'ទំព័រដើម', zh: '主页', ko: '홈페이지', ja: 'ホームページ' };
  const strings = src.slice(src.indexOf('registerStrings({'));
  for (const [lang, word] of Object.entries(want)) {
    const block = strings.slice(strings.indexOf(`  ${lang}: {`));
    assert.equal(block.match(/da_home: '([^']*)'/)?.[1], word, `${lang}.da_home`);
  }
  // The page it opens is the home page, in that language.
  for (const lang of LANGS) assert.ok(homePage({ lang }).includes(`<html lang="${lang}">`));
});
