// Run: npm run 30da:test (or node --test src/lib/thirtyda-home.test.mjs)
// GET /30da/home — the public home page, laid out like the owner's template (ggmt.sg/newsfeed/3una5aha, 2026-10-14: "I give
// you the example of what MUST be on the home page" … "and windows"), in the app's colours ("it's not had orange"), no
// numbers for show ("no numbers — it's 30+ year olds' dating life"). The page (src/lib/thirtyda-pages.mjs homePage): the top
// bar (wordmark, flags, store icons), the phone-shaped card (people-1, the store icons, "30+DA App", the sign-in pills), the
// words (eyebrow, red-string knot + headline, the Khmer line, lead, Open 30+DA, ⚠️ Reminder, how it works in words, Support & Contact,
// hashtags), the teaser's strip on one red thread, the footer; SEO + JSON-LD; 5 languages; no script but the JSON-LD data
// block, no inline style. App Store / Google Play: "coming soon", no link; Windows: the web app. The photo slots
// (src/lib/thirtyda-home.mjs): an <img> only when the file is there, else a night-city placeholder; the image route: tight
// names, jpg / webp, a day. And the app's own way there: "Home page" above "Privacy policy · Terms · Help".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  homePage, homeText, pageWords, PAGE_STRINGS, OPERATOR, CONTACT_EMAIL, HOME_SLOTS, HOME_PEOPLE, HOME_HERO, HOME_PORTRAIT, HOME_SEQUENCE,
  HOME_IMG_PATH, WEB_APP_PATH, HOME_URL, HOME_SHARE_IMG, SUPPORT_TELEGRAM, SUPPORT_WHATSAPP, HOME_TAGS, HOME_SIGNINS, PLAY_COLOURS,
} from './thirtyda-pages.mjs';
import {
  homePhotos, sendHomeImage, HOME_IMG_RE, HOME_IMG_DIR, HOME_IMG_TYPES, HOME_IMG_CACHE,
} from './thirtyda-home.mjs';
import { handleThirtyDaApp } from './thirtyda-app.mjs';
import { LEVEL_RULES, SYSTEM_QUESTIONS } from '../thirtyda-app/shared/questions.js';
import { PHOTO_SLOT_LEVELS, AGE_MIN, REPLY_MAX } from '../thirtyda-app/shared/rules.js';
import { khmerKeep, khmerPlain } from '../thirtyda-app/shared/khmer.js';

const LANGS = ['en', 'km', 'zh', 'ko', 'ja'];
const HOME_KEYS = Object.keys(PAGE_STRINGS.en).filter((k) => k.startsWith('home_'));
const plain = (s) => s.replaceAll('|', '');
/** The words a reader sees (tags, SVGs and the <head> out). */
const shown = (html) => html.replace(/<head>[\s\S]*?<\/head>/, '').replace(/<svg[\s\S]*?<\/svg>/g, '')
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
/** One element by its opening tag's start (up to its matching close of the same tag name; no nesting of that tag). */
const block = (html, start, tag) => {
  const at = html.indexOf(start);
  return at < 0 ? '' : html.slice(at, html.indexOf(`</${tag}>`, at) + tag.length + 3);
};
/** The home page's block of pages.css (from its banner to the end). */
const homeCss = () => {
  const css = readFileSync(new URL('../thirtyda-app/pages.css', import.meta.url), 'utf8');
  const at = css.indexOf('The home page (/30da/home');
  return { css, at, block: css.slice(css.lastIndexOf('/*', at)) };
};
/** Orange / amber / yellow: a warm hue (15°–70°) with real colour in it. */
function warm([r, g, b]) {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B); const min = Math.min(R, G, B); const l = (max + min) / 2; const d = max - min;
  if (d < 0.08) return false;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h = (h * 60 + 360) % 360;
  return s > 0.3 && h >= 15 && h <= 70;
}
const hexRgb = (hex) => {
  const x = hex.slice(1);
  const full = x.length <= 4 ? [...x.slice(0, 3)].map((c) => c + c).join('') : x.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};
const PEOPLE_PHOTOS = { [HOME_HERO]: ['jpg'], 'people-1': ['jpg'], 'people-2': ['jpg'], 'people-3': ['jpg'], 'people-4': ['jpg'],
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`life-${i + 1}`, ['jpg']])) };

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
      // Every line short (the owner hates walls of text); the meta description and the reminder are the longer two.
      if (!['home_desc', 'home_remind'].includes(k)) assert.ok([...plain(s)].length <= 80, `${lang}.${k}: short (${[...plain(s)].length})`);
      // The break marks are for Chinese and Japanese only.
      if (!['zh', 'ja'].includes(lang)) assert.ok(!s.includes('|'), `${lang}.${k}: no break marks`);
    }
  }
  // The opening screen's own words (src/thirtyda-app/screens/opening.js op_tagline / op_headline).
  const opening = readFileSync(new URL('../thirtyda-app/screens/opening.js', import.meta.url), 'utf8');
  for (const lang of LANGS) {
    const at = opening.slice(opening.indexOf(`  ${lang}: {`));
    for (const [home, op] of [['home_tagline', 'op_tagline'], ['home_headline', 'op_headline']]) {
      const want = at.match(new RegExp(`${op}: '([^']*)'`))?.[1];
      assert.equal(plain(PAGE_STRINGS[lang][home]), want, `${lang}.${home} = the app's ${op}`);
    }
  }
  const en = PAGE_STRINGS.en;
  assert.equal(en.home_headline, 'Don’t make the same mistake again.');
  assert.equal(en.home_remind, '30+DA is free — there is nothing to pay. We never ask for money, bank or card details. Never send money to someone you met online.');
  assert.equal(en.home_soon, 'coming soon');
  assert.equal(en.home_win, 'Windows PC — open 30+DA in your browser');
  assert.equal(en.home_contact_h, 'Support & Contact');
  assert.match(en.home_string, /red string/);
  // A dating page, not a business one.
  const words = HOME_KEYS.map((k) => en[k]).join(' ');
  assert.ok(!/feature|platform|solution|business|customer|users\b|get the app/i.test(words), 'no business words');
});

test('no numbers: the levels in words, true to the code; only the brand (30+DA, 30+) carries digits; no year or launch date', () => {
  // The rules the page describes (if these change, the page's words must change too).
  assert.deepEqual(LEVEL_RULES, { 1: { pick: 4, write: 1 }, 2: { pick: 3, write: 2 } });
  assert.ok(SYSTEM_QUESTIONS[1].every((x) => /\?$/.test(x.text.en)), 'Level 1 lines are questions');
  assert.ok(REPLY_MAX > 0 && REPLY_MAX <= 10, 'each answered with a short reply (owner 2026-10-14: 10 characters max)');
  assert.ok(LEVEL_RULES[2].pick > 0 && LEVEL_RULES[2].write > 1, 'Level 2: a few more, a couple you write yourself');
  assert.equal(PHOTO_SLOT_LEVELS[1], 2, 'another photo (photo 2) opens at Level 2');
  assert.equal(AGE_MIN, 30);
  const en = PAGE_STRINGS.en;
  assert.deepEqual([en.home_l1_h, en.home_l2_h, en.home_l3_h], ['Say hello', 'Go deeper', 'Chat']);
  assert.equal(en.home_l1, 'A few easy questions. A short reply to each.');
  for (const lang of LANGS) assert.ok(!/tap|ワンタップ|点一下|한 번 눌러|ចុចតែម្ដង/i.test(PAGE_STRINGS[lang].home_l1), `${lang}.home_l1: no taps any more`);
  // The owner's "then 3" (3 picked + 2 written), in words: a few more, a couple you write yourself — not "all in your own words".
  assert.equal(en.home_l2, 'Then a few more — a couple you write yourself. Another photo opens.');
  assert.match(en.home_l3, /^Every message translated into your language\. Real names/);
  assert.match(en.home_verify, /Verify your number only when you want to chat/);
  for (const lang of LANGS) {
    const t = PAGE_STRINGS[lang];
    for (const k of HOME_KEYS.filter((x) => x !== 'home_desc')) {
      assert.ok(!/\d/.test(t[k].replace(/30\+/g, '')), `${lang}.${k}: no numbers but 30+ — ${t[k]}`);
    }
    assert.ok(!/2027|2026|launch/i.test(HOME_KEYS.map((k) => t[k]).join(' ')), `${lang}: no year, no launch date`);
  }
});

// ---------------------------------------------------------------- the page

test('page: every language, the right <html lang>, SEO in the <head>, every string on the page, the order of the template', () => {
  for (const lang of LANGS) {
    const t = PAGE_STRINGS[lang];
    const html = homePage({ lang, photos: PEOPLE_PHOTOS });
    assert.ok(html.startsWith('<!doctype html>') && html.includes(`<html lang="${lang}">`), `${lang}: html lang`);
    assert.ok(!/undefined|null|\{\w+\}|NaN|\|/.test(html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, '')), `${lang}: nothing unfilled, no break mark left`);
    assert.ok(html.includes('<body class="page-home">'));
    assert.ok(html.includes('<link rel="stylesheet" href="/30da/pages.css">'));
    // SEO like the template: title, description, keywords, the address, the share card (an absolute https image).
    const title = `30+DA · ${plain(t.home_tagline)}`;
    assert.ok(html.includes(`<title>${title}</title>`), `${lang}: title`);
    assert.ok(html.includes('<meta name="robots" content="index">'), `${lang}: indexed`);
    assert.ok(html.includes(`<meta name="description" content="${plain(t.home_desc)}">`), `${lang}: description`);
    assert.match(html, /<meta name="keywords" content="30\+DA, dating for 30\+, [^"]*Phnom Penh[^"]*ការណាត់ជួប[^"]*">/);
    assert.ok(html.includes(`<link rel="canonical" href="https://ecom.ggmt.sg/30da/home">`), `${lang}: canonical`);
    assert.equal(HOME_URL, 'https://ecom.ggmt.sg/30da/home');
    assert.equal(HOME_SHARE_IMG, 'https://ecom.ggmt.sg/30da/home/img/hero.jpg');
    for (const tag of [
      '<meta property="og:url" content="https://ecom.ggmt.sg/30da/home">',
      '<meta property="og:image" content="https://ecom.ggmt.sg/30da/home/img/hero.jpg">',
      `<meta property="og:title" content="${title}">`,
      '<meta name="twitter:card" content="summary_large_image">',
      '<meta name="twitter:image" content="https://ecom.ggmt.sg/30da/home/img/hero.jpg">',
      `<meta name="twitter:title" content="${title}">`,
    ]) assert.ok(html.includes(tag), `${lang}: ${tag}`);
    // Every home string is on the page (the description and the labels in attributes: above / below).
    for (const k of HOME_KEYS.filter((x) => !['home_desc', 'home_soon', 'home_win', 'home_signin', 'home_alt'].includes(x))) {
      assert.ok(html.includes(homeText(t[k])), `${lang}: ${k}`);
    }
    // The template's order: top bar → card → the words → the strip → footer.
    const at = (s) => html.indexOf(s);
    const order = ['class="hm-top"', 'class="hm-card"', 'class="hm-eyebrow"', 'class="hm-h1"', 'class="hm-lead"', 'class="hm-btn"',
      'class="hm-remind"', 'class="hm-how"', 'class="hm-contact"', 'class="hm-tags"', 'class="hm-story"', 'class="hm-foot"'];
    for (let i = 1; i < order.length; i++) assert.ok(at(order[i - 1]) > 0 && at(order[i - 1]) < at(order[i]), `${lang}: ${order[i - 1]} before ${order[i]}`);
    // The flag row: 5 links to this page in each language, this one marked.
    const flags = html.match(/<nav class="langs"[\s\S]*?<\/nav>/)?.[0] || '';
    for (const code of LANGS) assert.ok(flags.includes(`href="/30da/home?lang=${code}"`), `${lang}: flag ${code}`);
    assert.ok(flags.includes(`hreflang="${lang}" lang="${lang}" aria-current="true"`));
  }
  assert.ok(homePage().includes('<html lang="en">'), 'no language → English');
  assert.ok(homePage({ lang: 'xx' }).includes('<html lang="en">'));
  assert.ok(!/OAuth|token|cookie|redirect/i.test(shown(homePage())), 'no technical words');
});

test('store icons (the template\'s + Windows): App Store and Google Play "coming soon" with no link; Windows opens the web app — in the top bar next to the flags AND on the card', () => {
  for (const lang of LANGS) {
    const t = PAGE_STRINGS[lang];
    const html = homePage({ lang });
    const soon = plain(t.home_soon);
    const win = plain(t.home_win);
    const top = block(html, '<header class="hm-top">', 'header');
    const card = block(html, '<div class="hm-card">', 'nav'); // the card up to its pills
    for (const [where, part] of [['top bar', top], ['card', card]]) {
      const row = part.match(/<div class="hm-stores hm-stores-(top|card)">[\s\S]*?<\/a><\/div>/)?.[0] ?? '';
      assert.ok(row, `${lang} ${where}: the icon row`);
      // Apple: a dark square with the white Apple logo; Google Play: a white square with its logo. Neither is a link.
      assert.ok(row.includes(`<span class="hm-store hm-store-apple" role="img" aria-label="App Store — ${soon}" title="App Store — ${soon}"><svg`), `${lang} ${where}: App Store coming soon`);
      assert.ok(row.includes(`<span class="hm-store hm-store-play" role="img" aria-label="Google Play — ${soon}" title="Google Play — ${soon}"><svg`), `${lang} ${where}: Google Play coming soon`);
      // Windows = 30+DA on a PC: the web app.
      assert.ok(row.includes(`<a class="hm-store hm-store-windows" href="/30da/" aria-label="${win}" title="${win}"><svg`), `${lang} ${where}: Windows → /30da/`);
      assert.equal((row.match(/<a\b/g) || []).length, 1, `${lang} ${where}: only Windows is a link`);
      assert.deepEqual([...row.matchAll(/hm-store-(\w+)"/g)].map((m) => m[1]), ['apple', 'play', 'windows'], `${lang} ${where}: the order`);
    }
    // The top bar: the wordmark, the flags, then the icons right next to them.
    assert.ok(top.indexOf('<nav class="langs"') > top.indexOf('class="hm-logo"') && top.indexOf('class="hm-stores hm-stores-top"') > top.indexOf('<nav class="langs"'), `${lang}: flags, then the icons`);
    assert.equal((html.match(/class="hm-stores /g) || []).length, 2, `${lang}: the icons in both places`);
    // Not in the stores yet: no store link anywhere.
    assert.ok(!/apps\.apple\.com|itunes\.apple|play\.google|market:\/\/|itms-apps/i.test(html), `${lang}: no store link`);
  }
  assert.ok(homePage({ lang: 'en' }).includes('aria-label="Windows PC — open 30+DA in your browser"'));
  // The marks: well-known shapes — Apple and the 4-pane Windows logo in white (currentColor), Play in its own 4 colours.
  const html = homePage();
  const play = html.match(/<span class="hm-store hm-store-play"[^>]*>(<svg[\s\S]*?<\/svg>)/)[1];
  assert.deepEqual([...play.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]), [...PLAY_COLOURS], 'Play: blue, yellow, red, green');
  const windows = html.match(/<a class="hm-store hm-store-windows"[^>]*>(<svg[\s\S]*?<\/svg>)/)[1];
  assert.equal((windows.match(/ d="([^"]*)"/)?.[1].match(/[Mm]/g) || []).length, 4, 'Windows: four panes');
  assert.match(windows, /fill="currentColor"/);
  assert.match(html.match(/<span class="hm-store hm-store-apple"[^>]*>(<svg[\s\S]*?<\/svg>)/)[1], /fill="currentColor"/);
});

test('the card: people-1 fills it, "30+DA App" + the tagline + two lines, and the sign-in pills (TikTok · Telegram · Google · Facebook · 👀 Guest) → the web app', () => {
  assert.deepEqual(HOME_SIGNINS.map(([, name]) => name), ['TikTok', 'Telegram', 'Google', 'Facebook']);
  for (const lang of LANGS) {
    const t = PAGE_STRINGS[lang];
    const html = homePage({ lang, photos: PEOPLE_PHOTOS });
    const card = html.slice(html.indexOf('<div class="hm-card">'), html.indexOf('<div class="hm-text">'));
    assert.ok(card.includes(`<img src="/30da/home/img/people-1.jpg" alt="${plain(t.home_alt)}" width="768" height="1376" fetchpriority="high" decoding="async">`), `${lang}: the photo`);
    assert.ok(card.includes('<p class="hm-card-h">30+DA App</p>'), `${lang}: name`);
    assert.ok(card.includes(`<p class="hm-card-sub">${homeText(t.home_tagline)}</p>`), `${lang}: subtitle`);
    assert.ok(card.includes(`<p class="hm-card-desc">${homeText(t.home_card)}</p>`), `${lang}: description`);
    const pills = card.match(/<nav class="hm-pills" aria-label="([^"]*)">([\s\S]*?)<\/nav>/);
    assert.equal(pills?.[1], plain(t.home_signin), `${lang}: the pills' label`);
    const links = [...pills[2].matchAll(/<a class="(hm-pill[^"]*)" href="([^"]*)">([\s\S]*?)<\/a>/g)];
    assert.equal(links.length, 5, `${lang}: five pills`);
    assert.ok(links.every(([, , href]) => href === WEB_APP_PATH), `${lang}: every pill → /30da/ (the web app's sign-in)`);
    assert.deepEqual(links.map(([, , , inner]) => shown(inner)), ['TikTok', 'Telegram', 'Google', 'Facebook', `👀 ${homeText(t.home_guest)}`], `${lang}: the pills`);
    assert.equal(links[4][1], 'hm-pill hm-pill-guest');
  }
  assert.equal(WEB_APP_PATH, '/30da/');
});

test('the words: eyebrow, red-string knot + headline (h1), the Khmer line on the other 4 languages, the lead, Open 30+DA, the ⚠️ Reminder, how it works in words', () => {
  const km = PAGE_STRINGS.km;
  for (const lang of LANGS) {
    const t = PAGE_STRINGS[lang];
    const html = homePage({ lang });
    assert.ok(html.includes(`<p class="hm-eyebrow">30+DA · ${homeText(t.home_place)}</p>`), `${lang}: eyebrow`);
    assert.ok(html.includes(`<h1 class="hm-h1"><svg class="hm-knot" viewBox="0 0 48 32" aria-hidden="true" focusable="false"><path d="M0 22C10 22 14 8 24 8c8 0 10 12 2 14s-6-10 4-10 12 6 18 4"/></svg> ${homeText(t.home_headline)}</h1>`) && !html.includes('💞'), `${lang}: h1 with the red-string knot, no 💞`);
    assert.equal((html.match(/<h1\b/g) || []).length, 1, `${lang}: one h1`);
    // The local language under it (the template has Sinhala): Khmer, unless the page is Khmer already.
    const khmer = `<p class="hm-km" lang="km">${homeText(km.home_headline)}<span>${homeText(km.home_tagline)}</span></p>`;
    assert.equal(html.includes(khmer), lang !== 'km', `${lang}: the Khmer line`);
    assert.ok(html.includes(`<p class="hm-lead">${homeText(t.home_line)}`) && html.includes(`${homeText(t.home_lead)}</p>`), `${lang}: lead`);
    assert.ok(html.includes(`<p class="hm-cta"><a class="hm-btn" href="/30da/">${pageWords(lang).app_open}<svg`), `${lang}: the big button`);
    assert.equal((html.match(/class="hm-btn"/g) || []).length, 1, `${lang}: one big button`);
    // ⚠️ Reminder: free, never money / bank / card, never send money (+ the Khmer line on the other languages).
    const remind = block(html, '<div class="hm-remind" role="note">', 'div');
    assert.ok(remind.includes(`<p class="hm-remind-h"><span aria-hidden="true">⚠️</span> ${homeText(t.home_remind_h)}</p>`), `${lang}: reminder title`);
    assert.ok(remind.includes(`<p class="hm-remind-text">${homeText(t.home_remind)}</p>`), `${lang}: reminder`);
    assert.equal(remind.includes(`<p class="hm-remind-km" lang="km">${homeText(km.home_remind)}</p>`), lang !== 'km', `${lang}: reminder in Khmer`);
    // How it works, in words: Say hello → Go deeper → Chat, then "verify only to chat". No numbered circles.
    const how = block(html, '<div class="hm-how">', 'div');
    assert.ok(how.includes(`<h2 class="hm-how-h">${homeText(t.home_how_h)}</h2>`));
    for (const n of [1, 2, 3]) assert.ok(how.includes(`<li><b>${homeText(t[`home_l${n}_h`])}</b> ${homeText(t[`home_l${n}`])}</li>`), `${lang}: level ${n}`);
    assert.ok(how.includes(`<p class="hm-how-fine">${homeText(t.home_verify)}</p>`), `${lang}: verify only to chat`);
  }
  // Korean: "nothing to pay" (결제할 것이 없어요, as the app says it) — never 낼 돈이 없어요 ("I have no money to pay").
  assert.ok(PAGE_STRINGS.ko.home_remind.includes('결제할 것이 없어요') && !PAGE_STRINGS.ko.home_remind.includes('낼 돈'), 'ko: nothing to pay');
  // "30+" never hangs alone on a line: a no-break space before it.
  assert.ok(homePage({ lang: 'en' }).includes('Safe and calm dating for 30+'));
  assert.ok(homePage({ lang: 'ja' }).includes(homeText('សម្រាប់វ័យ 30+')) && homeText('សម្រាប់វ័យ 30+').endsWith('យ 30+'));
});

test('Support & Contact (the template\'s three), the hashtags, the footer', () => {
  assert.equal(SUPPORT_TELEGRAM, 'https://t.me/GKSmartbiz');
  assert.equal(SUPPORT_WHATSAPP, 'https://wa.me/6585565977');
  assert.deepEqual(HOME_TAGS, ['#30DA', '#DatingFor30Plus', '#SafeDating', '#CalmDating', '#PhnomPenh', '#Cambodia', '#MeetSomeone', '#SecondChance', '#ការណាត់ជួប']);
  for (const lang of LANGS) {
    const t = PAGE_STRINGS[lang];
    const html = homePage({ lang });
    const contact = block(html, '<div class="hm-contact">', 'div');
    assert.ok(contact.includes(`<h2 class="hm-contact-h">${homeText(t.home_contact_h)}</h2>`), `${lang}: title`);
    const links = [...contact.matchAll(/<a href="([^"]*)"([^>]*)>([\s\S]*?)<\/a>/g)].map(([, href, attrs, inner]) => [href, attrs.trim(), shown(inner)]);
    assert.deepEqual(links, [
      ['mailto:gk.smart@ggmt.sg?subject=30%2BDA%20support', '', '✉️ gk.smart@ggmt.sg'],
      ['https://t.me/GKSmartbiz', 'target="_blank" rel="noopener"', '✈️ Telegram · @GKSmartbiz'],
      ['https://wa.me/6585565977', 'target="_blank" rel="noopener"', '💬 WhatsApp · +65 8556 5977'],
    ], `${lang}: the three ways in`);
    assert.equal(CONTACT_EMAIL, 'gk.smart@ggmt.sg');
    const tags = html.match(/<p class="hm-tags">([\s\S]*?)<\/p>/)?.[1] ?? '';
    assert.equal(khmerPlain(shown(tags)), HOME_TAGS.join(' '), `${lang}: hashtags`);
    // The Khmer tag marked Khmer, and kept whole on a line (Chrome broke it "#ការ ‖ ណាត់ជួប" at 412 px).
    assert.ok(tags.includes(`<span lang="km">${khmerKeep('#ការណាត់ជួប')}</span>`), `${lang}: the Khmer tag marked Khmer`);
    assert.notEqual(khmerKeep('#ការណាត់ជួប'), '#ការណាត់ជួប');
    // Footer: the template's small line, who runs it, the small pages in the same language.
    const foot = block(html, '<footer class="hm-foot">', 'footer');
    assert.ok(foot.includes('<p class="hm-foot-brand">30+DA · GK Newsroom · ggmt.sg</p>'), `${lang}: brand line`);
    const w = pageWords(lang); // as shown: Khmer phrases kept whole (shared/khmer.js)
    assert.ok(foot.includes(`<p class="hm-foot-run">${w.run_by} <b>${OPERATOR}</b></p>`), `${lang}: operator`);
    assert.equal(OPERATOR, 'GGMT PTE. LTD.');
    for (const [path, label] of [['privacy', w.priv_title], ['terms', w.home_terms], ['support', w.home_help], ['delete-data', w.del_title]]) {
      assert.ok(foot.includes(`<a href="/30da/${path}?lang=${lang}">${label}</a>`), `${lang}: footer ${path}`);
    }
  }
});

test('JSON-LD: a MobileApplication (30+DA, Lifestyle / dating, iOS + Android, free, GGMT) that parses; it is the only <script>', () => {
  for (const lang of LANGS) {
    const html = homePage({ lang });
    const scripts = html.match(/<script\b[^>]*>/g) || [];
    assert.deepEqual(scripts, ['<script type="application/ld+json">'], `${lang}: the only script is the JSON-LD data block`);
    const raw = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
    assert.ok(!raw.includes('<'), 'nothing in it can close the element');
    const ld = JSON.parse(raw);
    assert.equal(ld['@context'], 'https://schema.org');
    assert.equal(ld['@type'], 'MobileApplication');
    assert.equal(ld.name, '30+DA');
    assert.equal(ld.applicationCategory, 'LifestyleApplication');
    assert.equal(ld.applicationSubCategory, 'Dating');
    assert.equal(ld.operatingSystem, 'iOS, Android');
    assert.deepEqual(ld.offers, { '@type': 'Offer', price: '0', priceCurrency: 'USD' });
    assert.deepEqual(ld.publisher, { '@type': 'Organization', name: 'GGMT PTE. LTD.', email: 'gk.smart@ggmt.sg' });
    assert.equal(ld.url, 'https://ecom.ggmt.sg/30da/home');
    assert.equal(ld.image, 'https://ecom.ggmt.sg/30da/home/img/hero.jpg');
    assert.equal(ld.description, plain(PAGE_STRINGS[lang].home_desc));
    assert.deepEqual(ld.inLanguage, LANGS);
    assert.equal(ld.audience?.suggestedMinAge, 30);
    assert.ok(!('downloadUrl' in ld) && !('installUrl' in ld), 'not in the stores yet: no download address');
    // CSP-safe otherwise: no inline style, no handlers, no javascript: links.
    assert.ok(!/\sstyle=|<style\b/i.test(html), `${lang}: no inline style`);
    assert.ok(!/\son[a-z]+=|javascript:/i.test(html), `${lang}: no handlers`);
    // Every href is ours, or the support contacts, or the canonical address.
    for (const [, href] of html.matchAll(/href="([^"]*)"/g)) {
      assert.ok(/^\/30da\/|^mailto:gk\.smart@ggmt\.sg\?subject=30%2BDA%20support$|^https:\/\/t\.me\/GKSmartbiz$|^https:\/\/wa\.me\/6585565977$|^https:\/\/ecom\.ggmt\.sg\/30da\/home$|^https:\/\/fonts\.(googleapis|gstatic)\.com\b|^data:,$/.test(href), `${lang}: href ${href}`);
    }
    assert.ok(!/<img[^>]+src="(?!\/30da\/home\/img\/)/.test(homePage({ lang, photos: PEOPLE_PHOTOS })), `${lang}: images only from our own folder`);
  }
});

test('no numbers for show: the only digits a reader sees are 30+DA / 30+, the two hashtags with 30 in them, and the WhatsApp number', () => {
  for (const lang of LANGS) {
    const text = shown(homePage({ lang, photos: PEOPLE_PHOTOS }));
    const rest = text.replace(/#DatingFor30Plus|#30DA|\+65 8556 5977/g, '').replace(/30\+(DA)?/g, '');
    assert.ok(!/[\d០-៩]/.test(rest), `${lang}: a stray number in "${rest.match(/.{0,30}[\d០-៩].{0,30}/)?.[0]}"`);
    assert.ok(text.includes('+65 8556 5977') && text.includes('gk.smart@ggmt.sg'));
    // The old drafts' number markup is gone.
    const html = homePage({ lang });
    for (const cls of ['hm-lv-num', 'hm-lv-tag', 'hm-lv-plus', 'hm-n', 'hm-age', 'hm-ico', 'hm-points', 'hm-steps', 'hm-get', 'hm-free', 'hm-soon', 'hm-hero']) {
      assert.ok(!new RegExp(`class="[^"]*\\b${cls}\\b`).test(html), `${lang}: no .${cls}`);
    }
  }
});

test('Chinese and Japanese break only between phrases: the "|" marks become <wbr>, and the CSS keeps words whole', () => {
  for (const lang of ['zh', 'ja']) {
    const t = PAGE_STRINGS[lang];
    // The headline (the old hero line that broke mid-word) and every longer line carry break marks.
    for (const k of HOME_KEYS.filter((x) => !['home_desc', 'home_alt', 'home_win', 'home_tagline'].includes(x))) {
      if ([...t[k]].length > 9 && !/[ 、，。]/.test(t[k])) assert.ok(t[k].includes('|'), `${lang}.${k}: a long line needs break marks`);
    }
    assert.ok(t.home_headline.includes('|'), `${lang}: the headline has a break mark`);
    const html = homePage({ lang });
    assert.ok(html.includes(homeText(t.home_headline)) && homeText(t.home_headline).includes('<wbr>'), `${lang}: <wbr> in the h1`);
    // The marks never reach the title, the description, the labels or the JSON-LD.
    const head = html.match(/<head>[\s\S]*?<\/head>/)[0];
    assert.ok(!head.includes('|') && !head.includes('<wbr>'), `${lang}: a clean <head>`);
    assert.ok(![...html.matchAll(/(?:aria-label|title|alt)="([^"]*)"/g)].some(([, v]) => /\||wbr/.test(v)), `${lang}: clean labels`);
  }
  const { block: css } = homeCss();
  assert.match(css, /\.page-home:lang\(zh\), \.page-home:lang\(ja\), \.page-home:lang\(ko\) \{ word-break: keep-all; line-break: strict; overflow-wrap: break-word; \}/);
  assert.match(css, /\.page-home \[lang="km"\] \{ word-break: normal;/, 'Khmer lines inside them break as Khmer');
  // The strip's captions on phones: a frame is ~99 px wide at 320 px, so at 12 px every phrase (≤ 8 characters) fits
  // whole — no word split, no 。 alone on a line.
  assert.match(css, /@media \(max-width: 399px\) \{\s*\.page-home:lang\(zh\) \.hm-fr figcaption, \.page-home:lang\(ja\) \.hm-fr figcaption \{ margin-inline: -5px; font-size: 12px;/);
  for (const lang of ['zh', 'ja']) {
    for (const n of [2, 3, 4]) {
      for (const phrase of PAGE_STRINGS[lang][`home_frame_${n}`].split('|')) assert.ok([...phrase].length <= 8, `${lang}.home_frame_${n}: "${phrase}" fits a narrow frame`);
    }
  }
});

test('photos: people-1 on the card, the sequence people-2 → 3 → 4 together in order on the strip; hero = the share picture; placeholders when missing', () => {
  assert.deepEqual(HOME_SLOTS, ['hero', 'people-1', 'people-2', 'people-3', 'people-4', 'life-1', 'life-2', 'life-3', 'life-4', 'life-5', 'life-6', 'life-7', 'life-8', 'life-9', 'life-10']);
  assert.equal(HOME_HERO, 'hero');
  assert.equal(HOME_PORTRAIT, 'people-1');
  assert.deepEqual(HOME_SEQUENCE, ['people-2', 'people-3', 'people-4']);
  assert.deepEqual(HOME_PEOPLE, ['people-1', 'people-2', 'people-3', 'people-4']);
  assert.equal(HOME_IMG_PATH, '/30da/home/img/');

  const none = homePage({ lang: 'km' });
  assert.equal((none.match(/<img\b/g) || []).length, 0, 'no photo yet → no <img>');
  for (const slot of HOME_PEOPLE) {
    assert.equal((none.match(new RegExp(`<span class="hm-ph hm-ph-${slot}" aria-hidden="true"></span>`, 'g')) || []).length, 1, `placeholder ${slot}`);
  }
  // The strip: ONE list, the three frames in order, each with its line, each frame's box on the same straight thread.
  const seq = none.match(/<ol class="hm-seq">[\s\S]*?<\/ol>/)?.[0] ?? '';
  assert.deepEqual([...seq.matchAll(/hm-ph-(people-\d)/g)].map((m) => m[1]), ['people-2', 'people-3', 'people-4']);
  assert.deepEqual([...seq.matchAll(/<figcaption>([^<]*)<\/figcaption>/g)].map((m) => m[1]),
    ['home_frame_2', 'home_frame_3', 'home_frame_4'].map((k) => homeText(PAGE_STRINGS.km[k])));
  assert.equal((seq.match(/<div class="hm-fr-box">/g) || []).length, 3);
  assert.ok(!/<svg/.test(seq), 'no loose squiggles: the thread is one straight line (CSS), not drawn per frame');
  const { block: css } = homeCss();
  assert.match(css, /\.page-home \.hm-fr-box::before \{ content: ""; position: absolute; top: 50%;[^}]*background: var\(--red\); \}/);
  assert.match(css, /\.page-home \.hm-story \{ overflow: hidden;/, 'the thread runs to the edges without a sideways scroll');

  const photos = { [HOME_HERO]: ['jpg'], 'people-2': ['webp', 'jpg'], 'people-3': ['webp'], 'people-4': ['png'], 'people-9': ['jpg'] };
  for (const lang of LANGS) {
    const html = homePage({ lang, photos });
    assert.ok(html.includes('<picture><source type="image/webp" srcset="/30da/home/img/people-2.webp"><img src="/30da/home/img/people-2.jpg" alt="" width="768" height="1376" loading="lazy" decoding="async"></picture>'), `${lang}: people-2 both kinds`);
    assert.ok(html.includes('<img src="/30da/home/img/people-3.webp" alt="" width="768" height="1376"'), `${lang}: people-3 webp`);
    assert.equal((html.match(/<img\b/g) || []).length, 2, `${lang}: only real files (a png is not one; people-9 is not a slot; the hero is the share picture)`);
    assert.equal((html.match(/class="hm-ph /g) || []).length, 2, `${lang}: people-1 and people-4 are placeholders`);
    assert.ok(!html.includes('<img src="/30da/home/img/hero'), `${lang}: the hero is not on the page`);
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
  // The real folder: its README names every slot, where it sits and the sequence; only slots with jpg / webp come back.
  const readme = readFileSync(new URL('README.md', HOME_IMG_DIR), 'utf8');
  for (const name of ['hero.jpg', 'people-1.jpg', 'people-2.jpg', 'people-3.jpg', 'people-4.jpg', '768 × 432', '768 × 1376', 'ONE sequence', 'phone-shaped card', 'AI-generated']) {
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
    assert.equal(h.Vary, 'Accept-Language, User-Agent'); // the app gets the page without store icons
    assert.ok(res.body.includes('<html lang="en">') && res.body.includes('<a class="hm-btn" href="/30da/">'));
    const onPage = Object.keys(homePhotos()).filter((slot) => slot !== HOME_HERO).length;
    assert.equal((res.body.match(/<img\b/g) || []).length, onPage, 'an <img> only for a slot whose file is there');
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
  // The share picture the page names is really there.
  assert.ok(real[HOME_HERO]?.includes('jpg'), 'hero.jpg is in the folder (og:image / JSON-LD)');
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

test('pages.css: the home page\'s rules are all under .page-home (the other pages do not change); PC two columns; taps ≥ 44 px', () => {
  const { css, at, block: raw } = homeCss();
  assert.ok(at > 0, 'the home block is marked');
  const block = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  const noFrames = block.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
  const selectors = [...noFrames.matchAll(/(?:^|[;{}])\s*([^{}@;\s][^{}]*?)\s*\{/g)].map((m) => m[1].trim()).filter(Boolean);
  assert.ok(selectors.length > 60, `found ${selectors.length} rules`);
  for (const list of selectors) {
    // …or the canvas behind the home page only (navy, so overscroll never shows the grey desk).
    for (const sel of list.split(',')) assert.match(sel.trim(), /^(\.page-home\b|:root:has\(> body\.page-home\)$)/, `scoped: ${sel.trim()}`);
  }
  assert.ok(!/url\(/.test(block), 'no outside images: the placeholders are gradients');
  assert.match(block, /prefers-reduced-motion: reduce/);
  // PC like the template: the card left (it stays in view), the words right; phones: the card first.
  assert.match(block, /@media \(min-width: 900px\) \{\s*\.page-home \.hm-main \{[^}]*\}\s*\.page-home \.hm-cols \{ flex-direction: row;/);
  assert.match(block, /\.page-home \.hm-left \{ flex: 0 0 380px; \}/);
  // …sticky only when the screen is tall enough to hold the whole card (a 1366 × 768 laptop would cut its foot off).
  assert.match(block, /@media \(min-width: 900px\) and \(min-height: 740px\) \{\s*\.page-home \.hm-left \{ position: sticky; top: 24px; \}/);
  assert.equal((block.match(/position: sticky/g) || []).length, 1, 'sticky in that one place only');
  assert.match(block, /:root:has\(> body\.page-home\) \{ background: var\(--navy\); \}/);
  // The flag row inside the 16 px gutters fits 320 px phones (five links in 288 px): tighter links under 380 px.
  assert.match(block, /@media \(max-width: 379px\) \{\s*\.page-home \.langs a \{ padding: 0 2px; gap: 2px; \}/);
  assert.match(block, /\.page-home \.hm-card \{[^}]*aspect-ratio: 9 \/ 16; border-radius: 24px; overflow: hidden;/);
  // Big enough to tap: the button, the pills, the store icons, the contact links, the footer links, the flags.
  const px = (sel, prop) => Number(block.match(new RegExp(`${sel.replace(/[.[\]()]/g, '\\$&')} \\{[^}]*\\b${prop}: (\\d+)px`))?.[1]);
  assert.ok(px('.page-home .hm-btn', 'min-height') >= 56, 'the big button');
  assert.ok(px('.page-home .hm-pill', 'min-height') >= 44, 'pills');
  assert.ok(px('.page-home .hm-store', 'width') >= 44 && px('.page-home .hm-store', 'height') >= 44, 'store icons');
  assert.ok(px('.page-home .hm-contact a', 'min-height') >= 44, 'contact links');
  assert.ok(px('.page-home .hm-foot-links a', 'min-height') >= 44 && px('.page-home .hm-foot-links a', 'min-width') >= 44, 'footer links');
  assert.ok(px('.page-home .langs a', 'min-height') >= 44 && px('.page-home .langs a', 'min-width') >= 44, 'flags (tall and wide, even with the tighter padding under 380 px)');
  // The earlier pages keep their own rules (the flag row's narrow-phone rule is still the first of its kind).
  assert.ok(css.indexOf('@media (max-width: 379px)') < at);
});

test('only the app\'s colours — navy, white, the soft greys, the red as the thin thread; no orange / amber / yellow except in the Google Play logo itself', () => {
  const { block: raw } = homeCss();
  const block = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/amber|orange|gold|--warm|--coral|#e3b341|#f5c453|#3a2a0d|#6b4e12|#e8d3a0/i.test(block), 'not the template\'s gold');
  const HEX = new Set(['#0b1c3f', '#13285a', '#ffffff', '#fff', '#eef1f6', '#cfd6e2', '#e4e8ef', '#d92d20', '#5b6478', '#aab4cf', '#d8def0']);
  for (const [hex] of block.matchAll(/#[0-9a-f]{3,8}\b/gi)) assert.ok(HEX.has(hex.toLowerCase()), `colour ${hex}`);
  const RGB = new Set(['11 28 63', '255 255 255', '216 222 240', '170 180 207', '0 0 0']);
  for (const [, rgb] of block.matchAll(/rgb\(\s*(\d+ \d+ \d+)/g)) assert.ok(RGB.has(rgb), `colour rgb(${rgb})`);
  for (const [hex] of block.matchAll(/#[0-9a-f]{3,8}\b/gi)) assert.ok(!warm(hexRgb(hex)), `warm ${hex}`);
  const app = readFileSync(new URL('../thirtyda-app/app.css', import.meta.url), 'utf8');
  for (const token of ['--navy: #0b1c3f', '--navy-2: #13285a', '--red: #d92d20', '--desk: #eef1f6', '--on-dark-muted: #aab4cf', '--on-dark-soft: #d8def0']) {
    assert.ok(app.includes(token), `app.css still has ${token}`);
  }
  // The red is only the thread: the strip's line, and the line + knots of how it works.
  const redRules = [...block.matchAll(/([^{}]+)\{([^}]*var\(--red\)[^}]*)\}/g)].map((m) => m[1].trim());
  assert.ok(redRules.length >= 3);
  for (const sel of redRules) assert.match(sel, /hm-fr-box::before|hm-path::before|hm-path li::before|hm-thread path|hm-knot path/, `red only on the thread: ${sel}`);
  // The button: navy on white, like the app's light button on the dark screen.
  assert.match(block, /\.page-home \.hm-btn \{[^}]*background: #fff; color: var\(--navy\);/);
  // The page itself: no warm colour anywhere outside the Play logo (which keeps its own four).
  for (const lang of LANGS) {
    const html = homePage({ lang, photos: PEOPLE_PHOTOS });
    const plays = html.match(/<span class="hm-store hm-store-play"[^>]*><svg[\s\S]*?<\/svg>/g) || [];
    assert.equal(plays.length, 2);
    let rest = html;
    for (const p of plays) rest = rest.replace(p, '');
    for (const [hex] of rest.matchAll(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b(?![0-9a-z])/gi)) {
      assert.ok(!warm(hexRgb(hex)), `${lang}: warm colour ${hex} outside the Play logo`);
    }
    assert.ok(!PLAY_COLOURS.some((c) => rest.includes(c)), `${lang}: the Play colours only in the Play logo`);
  }
  assert.ok(warm(hexRgb('#ffc400')) && warm(hexRgb('#e3b341')) && !warm(hexRgb('#d92d20')) && !warm(hexRgb('#0b1c3f')), 'the warm check itself');
});

// ---------------------------------------------------------------- the app's way there

test('the app: "Home page" on its own line above "Privacy policy · Terms · Help" (opening screen and Me), no PIN on the way out', () => {
  const src = readFileSync(new URL('../thirtyda-app/screens/delete-account.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('export function legalLinks()'), src.indexOf('export function accountFoot()'));
  const home = fn.indexOf("el('a', { href: `/30da/home?lang=${lang}`, on: { click: away } }, t('da_home'))");
  const privacy = fn.indexOf("el('a', { href: `/30da/privacy?lang=${lang}`, on: { click: away } }, t('da_privacy'))");
  assert.ok(home > 0 && privacy > home, 'the home link, then the privacy link');
  // Its own line (a <p> of its own), then the legal line; both in one block.
  assert.match(fn, /const home = el\('p', \{ class: 'legal-links' \}, el\('a', \{ href: `\/30da\/home\?lang=\$\{lang\}`/);
  assert.match(fn, /return el\('div', \{ class: 'legal-block' \}, home, links\);/);
  // The same "away" as the other links: leaving to read a page does not lock the app.
  assert.match(fn, /const away = \(\) => \{ if \(state\.me\) leaveWithoutLock\(\); \};/);
  assert.equal((fn.match(/on: \{ click: away \}/g) || []).length, 4, 'all four links leave the same way');
  // Shown wherever the legal links are: the opening screen and the Me page's foot.
  const opening = readFileSync(new URL('../thirtyda-app/screens/opening.js', import.meta.url), 'utf8');
  assert.match(opening, /legalLinks\(\)/);
  assert.match(src, /return el\('div', \{ class: 'account-foot' \}, legalLinks\(\),/);
  // da_home in all 5 languages.
  const strings = src.slice(src.indexOf('registerStrings({'));
  for (const lang of LANGS) {
    const at = strings.slice(strings.indexOf(`  ${lang}: {`));
    assert.ok(at.match(/da_home: '([^']+)'/)?.[1], `${lang}.da_home`);
  }
  // The page it opens is the home page, in that language.
  for (const lang of LANGS) assert.ok(homePage({ lang }).includes(`<html lang="${lang}">`));
});

test('in the 30+DA app (iOS / Android user agent): no store icons at all (Apple 2.3.10), the rest of the page the same', async () => {
  for (const inApp of ['ios', 'android']) {
    const html = homePage({ lang: 'en', photos: PEOPLE_PHOTOS, inApp });
    assert.ok(!html.includes('hm-stores') && !html.includes('Google Play') && !html.includes('App Store'), inApp);
    assert.ok(html.includes('class="hm-btn"') && html.includes('hm-lives'), `${inApp}: the rest stays`);
  }
  assert.ok(homePage({ lang: 'en', photos: PEOPLE_PHOTOS }).includes('hm-stores'), 'the web keeps them');
  const app = await get('/30da/home', { 'user-agent': 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 30DA-iOS/1.0' });
  assert.equal(app.status, 200);
  assert.ok(!String(app.body).includes('hm-stores'), 'route: in the app, no store icons');
  assert.match(String(app.headers.Vary ?? app.headers.vary), /User-Agent/);
  const web = await get('/30da/home', { 'user-agent': 'Mozilla/5.0 (Macintosh) Safari/605.1.15' });
  assert.ok(String(web.body).includes('hm-stores'), 'route: on the web, the store icons');
});
