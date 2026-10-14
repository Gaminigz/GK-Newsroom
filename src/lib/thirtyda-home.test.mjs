// Run: npm run 30da:test (or node --test src/lib/thirtyda-home.test.mjs)
// GET /30da/home — the public home page (owner 2026-10-14: "what is it, how it works, and web login"; "Level 1 ask 5,
// then 3, then chat, and 5 languages, safe and calm"). The page (src/lib/thirtyda-pages.mjs homePage): 5 languages,
// the one big button to the web app, the 3 levels true to the code, safety lines, "coming soon" to the stores as plain
// text (no store link, no badge), the footer; no script, no inline style. The photo slots (src/lib/thirtyda-home.mjs):
// an <img> only when the file is there, else a placeholder; the image route: tight names, jpg / webp, cached a day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  homePage, PAGE_STRINGS, OPERATOR, CONTACT_EMAIL, HOME_SLOTS, HOME_PEOPLE, HOME_HERO, HOME_IMG_PATH, WEB_APP_PATH,
} from './thirtyda-pages.mjs';
import {
  homePhotos, sendHomeImage, HOME_IMG_RE, HOME_IMG_DIR, HOME_IMG_TYPES, HOME_IMG_CACHE,
} from './thirtyda-home.mjs';
import { handleThirtyDaApp } from './thirtyda-app.mjs';
import { LEVEL_RULES } from '../thirtyda-app/shared/questions.js';
import { PHOTO_SLOT_LEVELS, AGE_MIN } from '../thirtyda-app/shared/rules.js';

const LANGS = ['en', 'km', 'zh', 'ko', 'ja'];
const HOME_KEYS = Object.keys(PAGE_STRINGS.en).filter((k) => k.startsWith('home_'));
/** The words a reader sees (tags out), for "no technical words" style checks. */
const shown = (html) => html.replace(/<head>[\s\S]*?<\/head>/, '').replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

async function get(path, headers = {}, method = 'GET') {
  const req = { method, url: path, headers: { host: 'ecom.ggmt.sg', ...headers } };
  const res = { status: null, headers: null, body: undefined, headersSent: false };
  res.writeHead = (s, h = {}) => { res.status = s; res.headers = h; res.headersSent = true; return res; };
  res.end = (b) => { res.body = b === undefined ? undefined : Buffer.isBuffer(b) ? b : String(b); return res; };
  await handleThirtyDaApp(req, res, new URL(path, 'https://ecom.ggmt.sg'));
  return res;
}

// ---------------------------------------------------------------- the words

test('every home string is there in all 5 languages, reuses the app\'s own tagline and headline', () => {
  assert.ok(HOME_KEYS.length >= 30, `home keys: ${HOME_KEYS.length}`);
  for (const lang of LANGS) {
    for (const k of HOME_KEYS) {
      const s = PAGE_STRINGS[lang][k];
      assert.ok(typeof s === 'string' && s.trim(), `${lang}.${k}`);
      assert.ok(!/[<>]/.test(s), `${lang}.${k}: plain text`);
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
  assert.equal(PAGE_STRINGS.en.home_tagline, 'Safe and calm dating for 30+');
  assert.equal(PAGE_STRINGS.en.home_free, 'Free · nothing to pay · 5 languages');
  assert.equal(PAGE_STRINGS.en.home_soon, 'Coming soon to the App Store and Google Play.');
});

test('the levels say what the code does: Level 1 = 5 lines, Level 2 = 3 picked + 2 written, Level 3 = the chat', () => {
  // The rules the page describes (if these change, the page's words must change too).
  assert.deepEqual(LEVEL_RULES, { 1: { pick: 4, write: 1 }, 2: { pick: 3, write: 2 } });
  assert.deepEqual([...PHOTO_SLOT_LEVELS], [1, 2, 3, 3], 'photo 2 at Level 2, photos 3–4 at Level 3');
  assert.equal(AGE_MIN, 30);
  const en = PAGE_STRINGS.en;
  assert.match(en.home_l1, /5 short lines/);
  assert.match(en.home_l2, /3 picked \+ 2 of your own/);
  assert.match(en.home_l2_gets, /Photo 2/);
  assert.match(en.home_l3_gets, /Real names \+ photos 3–4/);
  assert.match(en.home_l3, /both choose/);
  assert.match(en.home_l3, /translated/);
  assert.match(en.home_verify, /Telegram, Google, Facebook or TikTok/);
  assert.match(en.home_safe_contact, /phone numbers, emails, @handles, chat-app names or links/);
  assert.match(en.home_safe_money, /never ask for money, bank or card details/);
  const html = homePage({ lang: 'en' });
  assert.ok(html.includes('<span class="hm-lv-num">5</span>'), 'Level 1: 5');
  assert.ok(html.includes('<span class="hm-lv-num">3<span class="hm-lv-plus">+</span>2</span>'), 'Level 2: 3 + 2');
  assert.equal((html.match(/<li class="hm-lv hm-lv\d">/g) || []).length, 3, 'three levels');
  for (const n of [1, 2, 3]) assert.ok(html.includes(`<span class="hm-lv-tag">Level ${n}</span>`));
  assert.equal((html.match(/<span class="hm-n" aria-hidden="true">\d<\/span>/g) || []).length, 3, 'three numbered start steps');
});

// ---------------------------------------------------------------- the page

test('page: every language, the right <html lang>, nothing missing, one big button to the web app', () => {
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
    // The one big button: Open 30+DA → /30da/ (the web app's sign-in); the second way in goes there too.
    assert.equal((html.match(/class="hm-btn"/g) || []).length, 1, 'one big button');
    assert.ok(html.includes(`<a class="hm-btn" href="/30da/">${t.app_open}<svg`), `${lang}: the button`);
    assert.ok(html.includes(`<a class="hm-btn2" href="/30da/"><span>${t.home_browser}</span>`), `${lang}: use it in the browser`);
    assert.equal(WEB_APP_PATH, '/30da/');
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
    // Not in the stores yet: plain words only — no store links, no badges, no outside images.
    assert.ok(!/apps\.apple\.com|itunes\.apple|play\.google|market:\/\/|itms-apps|badge/i.test(html), `${lang}: no store link`);
    assert.ok(!/<img[^>]+src="(?!\/30da\/home\/img\/)/.test(html), `${lang}: images only from our own folder`);
    const soon = html.match(/<p class="hm-soon">[\s\S]*?<\/p>/)?.[0] ?? '';
    assert.ok(soon.includes(t.home_soon) && !soon.includes('<a'), `${lang}: "coming soon" is plain text, not a link`);
    // Every href is ours: the app, this site's pages, or the email.
    for (const [, href] of html.matchAll(/href="([^"]*)"/g)) {
      assert.ok(/^\/30da\/|^mailto:gk\.smart@ggmt\.sg$|^https:\/\/fonts\.(googleapis|gstatic)\.com\b|^data:,$/.test(href), `${lang}: href ${href}`);
    }
  }
  assert.ok(homePage().includes('<html lang="en">'), 'no language → English');
  assert.ok(homePage({ lang: 'xx' }).includes('<html lang="en">'));
  assert.ok(!/OAuth|token|cookie|redirect/i.test(shown(homePage())), 'no technical words');
});

test('photos: a placeholder for every empty slot; an <img> (alt in the page language) only for a slot with a file', () => {
  const none = homePage({ lang: 'km' });
  assert.equal((none.match(/<img\b/g) || []).length, 0, 'no photo yet → no <img>');
  assert.equal((none.match(/<span class="hm-ph" aria-hidden="true"><span class="hm-ph-mark">30\+DA<\/span><\/span>/g) || []).length, HOME_SLOTS.length);
  assert.ok(none.includes('<ul class="hm-strip" aria-hidden="true">'), 'an empty strip is decoration');

  const photos = { [HOME_HERO]: ['jpg'], 'people-2': ['webp', 'jpg'], 'people-5': ['webp'], 'people-6': ['png'], 'people-9': ['jpg'] };
  for (const lang of LANGS) {
    const t = PAGE_STRINGS[lang];
    const html = homePage({ lang, photos });
    assert.ok(html.includes(`<img src="/30da/home/img/hero.jpg" alt="30+DA · ${t.home_tagline}" width="1600" height="900" fetchpriority="high" decoding="async">`), `${lang}: hero`);
    assert.ok(html.includes(`<picture><source type="image/webp" srcset="/30da/home/img/people-2.webp"><img src="/30da/home/img/people-2.jpg" alt="${t.home_photo.replace('{n}', 2)}" width="800" height="1000" loading="lazy" decoding="async"></picture>`), `${lang}: people-2 both kinds`);
    assert.ok(html.includes(`<img src="/30da/home/img/people-5.webp" alt="${t.home_photo.replace('{n}', 5)}"`), `${lang}: people-5 webp`);
    assert.equal((html.match(/<img\b/g) || []).length, 3, `${lang}: only real files (a png is not one; people-9 is not a slot)`);
    assert.equal((html.match(/class="hm-ph"/g) || []).length, HOME_SLOTS.length - 3);
    assert.ok(html.includes('<ul class="hm-strip">'), 'with a photo the strip is read');
  }
  assert.deepEqual(HOME_SLOTS, ['hero', 'people-1', 'people-2', 'people-3', 'people-4', 'people-5', 'people-6']);
  assert.equal(HOME_PEOPLE.length, 6);
  assert.equal(HOME_IMG_PATH, '/30da/home/img/');
});

test('homePhotos: reads which slots have a jpg / webp (files only, slots only); a missing folder → none', () => {
  const dir = mkdtempSync(join(tmpdir(), '30da-home-'));
  try {
    for (const f of ['hero.jpg', 'people-1.webp', 'people-1.jpg', 'people-3.png', 'people-9.jpg', 'README.md', 'Hero.JPG']) writeFileSync(join(dir, f), 'x');
    mkdirSync(join(dir, 'people-4.jpg')); // a folder, not a photo
    const url = pathToFileURL(`${dir}/`);
    assert.deepEqual(homePhotos({ dir: url }), { hero: ['jpg'], 'people-1': ['webp', 'jpg'] });
    assert.deepEqual(homePhotos({ dir: pathToFileURL(`${dir}/nope/`) }), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // The real folder: its README names every slot; whatever is there, only slots with jpg / webp come back.
  const readme = readFileSync(new URL('README.md', HOME_IMG_DIR), 'utf8');
  for (const name of ['hero.jpg', 'people-1.jpg', 'people-6.jpg', '16:9', '4:5']) assert.ok(readme.includes(name), `README: ${name}`);
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
  const css = readFileSync(new URL('../thirtyda-app/pages.css', import.meta.url), 'utf8');
  const at = css.indexOf('The home page (/30da/home');
  assert.ok(at > 0, 'the home block is marked');
  const block = css.slice(css.lastIndexOf('/*', at)).replace(/\/\*[\s\S]*?\*\//g, '');
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
