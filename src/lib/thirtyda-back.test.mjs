// Run: npm run 30da:test (or node --test src/lib/thirtyda-back.test.mjs)
// GET /30da/back — where GKVerify's big "⬅️ Back to 30+DA" Telegram button lands (owner 2026-10-14: the "◀ 30+DA"
// corner link iOS draws in Telegram is far too small for 30+ users). The page (src/lib/thirtyda-pages.mjs backPage):
// the big button's link chosen by User-Agent (iPhone / iPad → the app's scheme, Android → Chrome's intent:// link with
// the web app as fallback, else the web app), the small "Open 30+DA in the browser" link, 5 languages, one external
// script (/30da/back.js) and no inline one; the route (src/lib/thirtyda-app.mjs): always 200, a strict CSP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { backPage as backHtml, backPlatform, backHref, WEB_APP_PATH, PAGE_STRINGS, esc } from './thirtyda-pages.mjs';
import { khmerPlain } from '../thirtyda-app/shared/khmer.js';

// The pages keep each Khmer phrase whole with invisible marks (shared/khmer.js khmerKeep): the words are
// compared without them (the joiners themselves: thirtyda-pages.test.mjs).
const backPage = (opts) => khmerPlain(backHtml(opts));
import { handleThirtyDaApp } from './thirtyda-app.mjs';

const LANGS = ['en', 'km', 'zh', 'ko', 'ja'];
const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iphoneTelegram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  androidTelegram: 'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36 Telegram-Android/11.2.3 (Samsung SM-A546E; Android 14; SDK 34; AVERAGE)',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
  linux: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
};
const IOS_HREF = 'sg.ggmt.thirtyda://open';
const ANDROID_HREF = 'intent://open#Intent;scheme=sg.ggmt.thirtyda;package=sg.ggmt.thirtyda;S.browser_fallback_url=https%3A%2F%2Fecom.ggmt.sg%2F30da%2F;end';

// ---------------------------------------------------------------- which way back

test('platform by User-Agent: iPhone / iPad / iPod → ios, Android (Chrome or Telegram\'s own browser) → android, the rest → web', () => {
  for (const k of ['iphone', 'iphoneTelegram', 'ipad']) assert.equal(backPlatform(UA[k]), 'ios', k);
  assert.equal(backPlatform('Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X)'), 'ios');
  for (const k of ['android', 'androidTelegram']) assert.equal(backPlatform(UA[k]), 'android', k);
  for (const k of ['mac', 'windows', 'linux']) assert.equal(backPlatform(UA[k]), 'web', k);
  for (const none of [undefined, null, '', 'curl/8.7.1', 'TelegramBot (like TwitterBot)']) assert.equal(backPlatform(none), 'web', String(none));
  assert.equal(backPlatform('Mozilla/5.0 (Linux; U; MyAndroidish 1.0)'), 'web', 'a whole word only');
});

test('the big button\'s link: the app\'s scheme on iOS, Chrome\'s intent:// link (web app fallback) on Android, else /30da/', () => {
  assert.equal(backHref('ios', 'https://ecom.ggmt.sg'), IOS_HREF);
  assert.equal(backHref('android', 'https://ecom.ggmt.sg'), ANDROID_HREF);
  assert.equal(backHref('android', 'https://ggmt.sg'), ANDROID_HREF.replace('ecom.ggmt.sg', 'ggmt.sg'), 'the site\'s own web app');
  assert.equal(decodeURIComponent(ANDROID_HREF.match(/S\.browser_fallback_url=([^;]+);/)[1]), 'https://ecom.ggmt.sg/30da/');
  assert.equal(backHref('web', 'https://ecom.ggmt.sg'), '/30da/');
  assert.equal(backHref('anything', 'https://ecom.ggmt.sg'), '/30da/');
  assert.equal(WEB_APP_PATH, '/30da/');
});

// ---------------------------------------------------------------- the page

test('page: one big button (the chosen link) + the small "Open 30+DA in the browser" link, 5 languages, one external script, nothing inline', () => {
  for (const href of [IOS_HREF, ANDROID_HREF, '/30da/']) {
    for (const lang of LANGS) {
      const html = backPage({ href, lang });
      assert.ok(html.startsWith('<!doctype html>') && html.includes(`<html lang="${lang}">`), `${lang}: html lang`);
      assert.ok(html.includes('<meta name="robots" content="noindex">'));
      assert.ok(html.includes(`<title>${PAGE_STRINGS[lang].app_title}</title>`));
      // The one script is our own file: the CSP allows no inline script, and nothing inline is there.
      assert.deepEqual(html.match(/<script\b[^>]*>/g), ['<script src="/30da/back.js" defer>'], 'one external script');
      assert.ok(html.includes('<script src="/30da/back.js" defer></script>'));
      assert.ok(!/<script>|style=|\son\w+=|javascript:/i.test(html), `${lang}: no inline script, style or handler`);
      assert.ok(!/undefined|\{\w+\}/.test(html), `${lang}: nothing unfilled`);
      // All 5 languages in the page (the flags switch with #links: no reload, the auto-try does not run again).
      for (const code of LANGS) {
        const t = PAGE_STRINGS[code];
        assert.ok(html.includes(`id="${code}" lang="${code}"`), `${lang}/${code}: column`);
        assert.ok(html.includes(`<a class="doc-btn doc-btn-big" data-back-open href="${esc(href)}">${t.app_open}</a>`), `${lang}/${code}: the big button`);
        assert.ok(html.includes(`<p class="doc-web"><a href="/30da/">${t.back_web}</a></p>`), `${lang}/${code}: the browser link under it`);
        assert.ok(html.includes(t.back_lede) && html.includes(`<h1>${t.app_title}</h1>`), `${lang}/${code}: the words`);
        assert.ok(html.includes(`<a href="#${code}" hreflang="${code}"`), `${lang}: flag #${code}`);
      }
      assert.equal((html.match(/data-back-open/g) || []).length, 5, 'one big button per language');
      assert.equal((html.match(/href="([^"]*)"[^>]*>[^<]*<\/a><\/p>\n\s*<p class="doc-web">/g) || []).length, 5);
      assert.ok(html.includes(`<div class="tr on" id="${lang}" lang="${lang}">`), `${lang} is shown first`);
      assert.ok(html.indexOf(`id="${lang}"`) > html.lastIndexOf('<div class="tr" id='), 'the first-shown language is last in the page (pages.css :target)');
    }
  }
  assert.equal(PAGE_STRINGS.en.back_web, 'Open 30+DA in the browser');
  assert.equal(PAGE_STRINGS.en.app_open, 'Open 30+DA');
  assert.ok(backPage().includes('data-back-open href="/30da/"'), 'no link given → the web app');
  assert.ok(backPage({ lang: 'xx' }).includes('<html lang="en">'), 'an unknown language → English');
  // Escaped, even though the link is never from the request.
  assert.ok(backPage({ href: '/30da/?a=1&b="2"' }).includes('href="/30da/?a=1&amp;b=&quot;2&quot;"'));
});

test('back.js: follows the big button\'s link once and does nothing else; pages.css draws the button big', () => {
  const js = readFileSync(new URL('../thirtyda-app/back.js', import.meta.url), 'utf8');
  assert.doesNotThrow(() => new vm.Script(js), 'a valid classic script');
  assert.ok(js.includes("a[data-back-open]"));
  assert.ok(!/fetch|cookie|localStorage|sessionStorage|innerHTML|eval|setInterval|import\b/.test(js), 'only follows the link');
  // Run it against a stand-in page: the link is followed once (replace for the web app, so Back does not bounce).
  for (const [href, how] of [[IOS_HREF, 'href'], [ANDROID_HREF, 'href'], ['https://ecom.ggmt.sg/30da/', 'replace']]) {
    const went = [];
    const location = { replace: (u) => went.push(['replace', u]) };
    Object.defineProperty(location, 'href', { set: (u) => went.push(['href', u]), get: () => 'https://ecom.ggmt.sg/30da/back' });
    const document = { querySelector: (sel) => (sel === 'a[data-back-open]' ? { href } : null) };
    vm.runInNewContext(js, { document, window: { location } });
    assert.deepEqual(went, [[how, href]], href);
  }
  const none = [];
  vm.runInNewContext(js, { document: { querySelector: () => null }, window: { location: { replace: (u) => none.push(u) } } });
  assert.deepEqual(none, [], 'no button, nothing happens');
  const css = readFileSync(new URL('../thirtyda-app/pages.css', import.meta.url), 'utf8');
  const big = css.match(/\.doc-btn-big \{([^}]*)\}/)?.[1] ?? '';
  assert.match(big, /width: 100%/);
  assert.match(big, /min-height: (\d+)px/);
  assert.ok(Number(big.match(/min-height: (\d+)px/)[1]) >= 64, 'a big target');
  assert.ok(Number(big.match(/font-size: (\d+)px/)[1]) >= 22, 'big words');
  assert.match(css, /\.doc-web \{/);
});

// ---------------------------------------------------------------- the route

async function get(path, headers = {}, method = 'GET') {
  const req = { method, url: path, headers: { host: 'ecom.ggmt.sg', ...headers } };
  const res = { status: null, headers: null, body: undefined, headersSent: false };
  res.writeHead = (s, h = {}) => { res.status = s; res.headers = h; res.headersSent = true; return res; };
  res.end = (b) => { res.body = b === undefined ? undefined : String(b); return res; };
  await handleThirtyDaApp(req, res, new URL(path, 'https://ecom.ggmt.sg'));
  return res;
}

test('GET /30da/back: always 200, the link by User-Agent, the language by ?lang / Accept-Language, a strict CSP', async () => {
  const cases = [
    [UA.iphone, IOS_HREF], [UA.iphoneTelegram, IOS_HREF], [UA.ipad, IOS_HREF],
    [UA.android, ANDROID_HREF], [UA.androidTelegram, ANDROID_HREF],
    [UA.mac, '/30da/'], [UA.windows, '/30da/'], [UA.linux, '/30da/'], [undefined, '/30da/'],
  ];
  for (const [ua, href] of cases) {
    const res = await get('/30da/back', ua ? { 'user-agent': ua } : {});
    assert.equal(res.status, 200, String(ua));
    assert.ok(res.body.includes(`data-back-open href="${href}"`), `${ua}: ${href}`);
    assert.ok(res.body.includes('<a href="/30da/">Open 30+DA in the browser</a>'));
    const h = res.headers;
    assert.match(h['Content-Type'], /^text\/html/);
    const csp = h['Content-Security-Policy'];
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src 'self'(;|$)/, 'scripts: our own files only');
    assert.ok(!/unsafe-inline|unsafe-eval|\*/.test(csp), `no inline script or style allowed: ${csp}`);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(h['X-Frame-Options'], 'DENY');
    assert.equal(h['Cache-Control'], 'no-store', 'it differs by User-Agent: nothing keeps a copy');
    assert.match(h.Vary, /User-Agent/);
    assert.match(h.Vary, /Accept-Language/);
    assert.equal(h['Referrer-Policy'], 'no-referrer');
    assert.equal(h['X-Robots-Tag'], 'noindex');
  }
  // The Android fallback is the site's own web app (its host, checked), never a stranger's.
  assert.ok((await get('/30da/back', { 'user-agent': UA.android, host: 'ggmt.sg' })).body.includes('S.browser_fallback_url=https%3A%2F%2Fggmt.sg%2F30da%2F;end'));
  assert.ok((await get('/30da/back', { 'user-agent': UA.android, host: 'evil"<x>' })).body.includes(ANDROID_HREF), 'a bad Host → the live site');
  // Language: ?lang first, else Accept-Language, else English; anything else still 200.
  assert.ok((await get('/30da/back?lang=ja', { 'accept-language': 'km-KH' })).body.includes('<html lang="ja">'));
  assert.ok((await get('/30da/back', { 'accept-language': 'km-KH,km;q=0.9' })).body.includes('<html lang="km">'));
  for (const q of ['?lang=xx', '?lang=', '?x=<script>', '?lang=ko&lang=zh']) {
    const res = await get(`/30da/back${q}`, { 'user-agent': UA.iphone });
    assert.equal(res.status, 200, q);
    assert.ok(!res.body.includes('<script>'), q);
  }
  const head = await get('/30da/back', { 'user-agent': UA.iphone }, 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body, undefined, 'HEAD: no body');
});

test('GET /30da/back.js is served like app-return.js (our own file, JavaScript)', async () => {
  const res = await get('/30da/back.js');
  assert.equal(res.status, 200);
  assert.match(res.headers['Content-Type'], /^text\/javascript/);
  assert.ok(res.body.includes('a[data-back-open]'));
});
