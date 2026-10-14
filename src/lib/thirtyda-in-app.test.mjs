// Run: npm run 30da:test (or node --test src/lib/thirtyda-in-app.test.mjs)
// The app inside the iOS / Android shells and for the store reviewers (owner 2026-10-14, the iOS session's live audit):
// source checks on the browser modules (they need a DOM, so they are read, not run).
//   - no "browser" words in the apps: location / microphone / notifications are the app's own settings (in-app.js);
//   - "Remind me" uses the app's own reminders (ThirtyDaShell) where it has them, and hides only where nothing works;
//   - every field at least 16px (iOS zooms into smaller ones on focus), the viewport still zoomable;
//   - links never open the long-press sheet; inside the shells the page is not selectable, its fields are;
//   - no window.confirm / alert / prompt anywhere in the app: its own modal();
//   - a demo account's My profile says one calm line and turns its controls off; review_account is never "went wrong";
//   - a guest can report a card (POST /guest/report).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const APP_DIR = new URL('../thirtyda-app/', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, APP_DIR), 'utf8');
const LANGS = ['en', 'km', 'zh', 'ko', 'ja'];

/** The keys + texts of one language in a module's registerStrings({ en: {…}, km: {…}, … }). */
function stringsOf(src, lang) {
  const reg = src.slice(src.lastIndexOf('registerStrings({'));
  const at = reg.indexOf(`\n  ${lang}: {\n`);
  assert.ok(at >= 0, `${lang} block`);
  const block = reg.slice(at, reg.indexOf('\n  },', at));
  return Object.fromEntries([...block.matchAll(/^ {4}(\w+): '((?:[^'\\]|\\.)*)',/gm)].map((m) => [m[1], m[2]]));
}

/** Every .js module the app serves (the app, its screens, its shared rules). */
function appModules() {
  const out = [];
  for (const dir of ['', 'screens/', 'shared/']) {
    for (const f of readdirSync(new URL(dir, APP_DIR))) if (/\.js$/.test(f)) out.push(`${dir}${f}`);
  }
  return out;
}

// ---------------------------------------------------------------- the app's own settings, never "your browser"

test('in-app.js: the app\'s line for location / microphone / notifications, iOS and Android, in all 5 languages', () => {
  const src = read('in-app.js');
  const keys = ['location', 'mic', 'notify'].flatMap((k) => [`ia_${k}_ios`, `ia_${k}_android`]).concat(['ia_open_settings', 'ia_ok']);
  for (const lang of LANGS) {
    const s = stringsOf(src, lang);
    for (const k of keys) assert.ok(s[k], `${lang}.${k}`);
    for (const k of keys) assert.doesNotMatch(s[k], /browser|រុករក|浏览器|브라우저|ブラウザ/i, `${lang}.${k}: no browser`);
    for (const k of ['location', 'mic', 'notify']) {
      assert.match(s[`ia_${k}_ios`], /› 30\+DA ›/, `${lang} iOS: Settings › 30+DA › …`);
      assert.match(s[`ia_${k}_android`], /› [^›]+ › 30\+DA ›/, `${lang} Android: Settings › Apps › 30+DA › …`);
    }
  }
  const en = stringsOf(src, 'en');
  assert.equal(en.ia_location_ios, 'Location is off for 30+DA. Turn it on in Settings › 30+DA › Location.');
  assert.equal(en.ia_location_android, 'Location is off for 30+DA. Turn it on in Settings › Apps › 30+DA › Permissions.');
  // The website keeps its own words (settingsLine → null); iOS gets "Open Settings" (the app's own page in Settings).
  assert.match(src, /const p = shellPlatform\(\);\n\s*return p && KINDS\.includes\(kind\) \? t\(`ia_\$\{kind\}_\$\{p\}`\) : null;/);
  assert.match(src, /if \(shellPlatform\(\) !== 'ios'\) \{\n\s*toast\(line, 5000\);/);
  assert.match(src, /location\.href = 'app-settings:';/);
});

test('the screens say a blocked location / microphone / notification through in-app.js (the web keeps its words)', () => {
  const nearby = read('screens/nearby.js');
  assert.match(nearby, /if \(shellPlatform\(\) && \(err\?\.code === 'denied' \|\| err\?\.code === 'unsupported'\)\) permissionOff\('location'\);\n\s*else toast\(locationErrorText\(err\)\);/);
  assert.match(nearby, /if \(!silent && alive\) sayLocationError\(err\);/);
  assert.doesNotMatch(nearby, /toast\(locationErrorText\(err\)\);\n\s*\} finally/, 'no direct browser toast left in refreshGps');
  const chat = read('screens/chat.js');
  assert.match(chat, /permissionOff\('mic', t\('chat_mic_denied'\)\)/);
  assert.doesNotMatch(chat, /toast\(t\('chat_mic_denied'\)\)/);
  const conv = read('screens/conversation.js');
  assert.match(conv, /permissionOff\('notify', t\('cv_notify_off'\)\)/);
  assert.doesNotMatch(conv, /toast\(t\('cv_notify_off'\)\)/);
  // The "browser" strings are only ever shown through those web paths.
  for (const [file, key] of [['screens/nearby.js', 'nb_loc_denied'], ['screens/chat.js', 'chat_mic_denied'], ['screens/conversation.js', 'cv_notify_off']]) {
    const uses = [...read(file).matchAll(new RegExp(`t\\('${key}'\\)`, 'g'))].length;
    assert.equal(uses, 1, `${file}: ${key} used once, on the web path`);
  }
});

// ---------------------------------------------------------------- "Remind me"

test('"Remind me": the app\'s own reminders when ThirtyDaShell has them (same id replaces), else the browser; hidden where neither', () => {
  const conv = read('screens/conversation.js');
  assert.match(conv, /\['notifyStatus', 'notifyPermission', 'remind', 'cancelRemind'\]\.every\(\(k\) => typeof p\[k\] === 'function'\)/);
  assert.match(conv, /const canRemind = \(\) => Boolean\(shellReminders\(\)\) \|\| notificationState\(\) !== 'unsupported';/);
  assert.match(conv, /chatMode \|\| !canRemind\(\) \? null : remindButton\(level, until\)/);
  assert.match(conv, /if \(\(await shell\.notifyStatus\(\)\)\?\.granted === true\) return true;\n\s*return \(await shell\.notifyPermission\(\)\)\?\.granted === true;/);
  assert.match(conv, /await shell\.remind\(\{\n\s*id, at: ms\(until\), title: '30\+DA', body: t\('cv_remind_note', \{ n: level, name: name\(\) \}\),/);
  assert.match(conv, /await shell\.cancelRemind\(\{ id \}\)/);
  assert.match(conv, /const reminderId = \(pairId\) => `pair-\$\{pairId\}`;/, 'one id per conversation: a new reminder replaces the old');
  // The browser's question still runs inside the tap (before any await).
  assert.match(conv, /: want \? askNotifications\(\) : Promise\.resolve\(notificationState\(\)\);/);
  for (const lang of LANGS) assert.ok(stringsOf(conv, lang).cv_remind_note, `${lang}.cv_remind_note`);
});

// ---------------------------------------------------------------- iOS WebKit: fields, links, selection

test('every field is at least 16px (iOS zooms into a smaller one on focus) and the page stays zoomable', () => {
  const css = ['app.css', 'pin.css', 'photo-source.css'].map((f) => [f, read(f)]);
  for (const [file, src] of css) {
    for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1].trim();
      if (!/(^|[\s,])(input|select|textarea)\b|\.(input|select|textarea|composer-input|pin-input)\b/.test(sel)) continue;
      if (/::placeholder/.test(sel)) continue; // a placeholder's size is not what iOS zooms by
      const size = m[2].match(/font-size:\s*([\d.]+)px/);
      if (size) assert.ok(Number(size[1]) >= 16, `${file} ${sel}: font-size ${size[1]}px`);
    }
  }
  const app = read('app.css');
  for (const sel of ['.input {', '.textarea {', '.select {', '.composer-input {']) {
    const at = app.indexOf(`\n${sel}`);
    assert.ok(at >= 0, sel);
    assert.match(app.slice(at, app.indexOf('}', at)), /font-size: 16px;/, sel);
  }
  assert.match(app, /\.phone-row \.select \{[^}]*font-size: 16px;/);
  const html = read('index.html');
  assert.doesNotMatch(html, /user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/, 'never block the person\'s own zoom');
});

test('links never open the long-press sheet; inside the shells the page is not selectable, its fields are', () => {
  const app = read('app.css');
  assert.match(app, /\na \{ color: inherit; -webkit-touch-callout: none; \}/);
  assert.match(app, /html\[data-shell\] body \{ -webkit-user-select: none; user-select: none; \}/);
  assert.match(app, /html\[data-shell\] input, html\[data-shell\] textarea, html\[data-shell\] \[contenteditable\] \{ -webkit-user-select: text; user-select: text; \}/);
  const entry = read('app.js');
  assert.match(entry, /const shell = shellPlatform\(\);\n\s*if \(shell\) document\.documentElement\.dataset\.shell = shell;/);
});

test('no window.confirm / alert / prompt left in the app: its own modal()', () => {
  for (const f of appModules()) {
    const src = read(f).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(src, /\b(window\.)?(confirm|alert|prompt)\s*\(/, f);
  }
  const nearby = read('screens/nearby.js');
  assert.match(nearby, /if \(!\(await confirmSignOut\(t\(/);
  for (const lang of LANGS) assert.ok(stringsOf(nearby, lang).nb_cancel, `${lang}.nb_cancel`);
});

// ---------------------------------------------------------------- the demo account (App review)

test('review_account is never "Something went wrong": one calm line, in 5 languages', () => {
  const core = read('core.js');
  assert.match(core, /if \(err\?\.code === 'review_account'\) return t\('err_review'\);/);
  for (const lang of LANGS) assert.ok(stringsOf(core, lang).err_review, `${lang}.err_review`);
  assert.equal(stringsOf(core, 'en').err_review, 'Demo account: photos, name and PIN stay as they are.');
  const me = read('screens/my-profile.js');
  assert.match(me, /err\.code === 'review_account' \? t\('err_review'\)/, 'My profile\'s own error words too');
});

test('My profile on a demo account: the line at the top, photos / name / gender / role / ways / PIN off — language and delete on', () => {
  const me = read('screens/my-profile.js');
  assert.match(me, /const demo = me\?\.review === true;/);
  assert.match(me, /\.\.\.\(demo \? \[el\('p', \{ class: 'demo-note', role: 'note' \}, icon\('lock', 14\), el\('span', \{\}, t\('err_review'\)\)\)\] : \[\]\),/);
  assert.match(me, /node\.inert = true;/);
  assert.match(me, /off\(el\('section', \{ class: 'section' \},\n\s*el\('div', \{ class: 'section-head' \}, el\('span', \{ class: 'label ink' \}, t\('me_photos'\)\)/);
  assert.match(me, /off\(el\('section', \{ class: 'section' \},\n\s*el\('div', \{ class: 'me-id-row' \},/);
  assert.match(me, /off\(section\(t\('me_verified_with'\), phoneBlock\)\)/);
  assert.match(me, /me\.pinSet \? off\(changePin\) : null/);
  assert.match(me, /section\(t\('me_language'\), el\('div', \{ class: 'lang-grid' \}, langBtns\)/, 'the language is not turned off');
  assert.doesNotMatch(me, /off\(accountFoot\(\)\)|off\(signOut\)/, 'Sign out and Delete my account stay on');
  // Delete my account finishes like a real one: the sheet's success path is the real one (the server keeps the profile).
  const del = read('screens/delete-account.js');
  assert.match(del, /await api\.post\('\/me\/delete', hasPin \? \{ pin \} : \{\}, \{ redirect: false \}\);\n\s*close\(\);\n\s*gone\(\);/);
});

// ---------------------------------------------------------------- a guest's report

test('a guest can report a card: "Report this profile" on the profile-first sheet → POST /guest/report', () => {
  const guest = read('guest.js');
  assert.match(guest, /submit: \(reason\) => api\.post\('\/guest\/report', \{ id: person\.id, reason \}, \{ redirect: false \}\)/);
  assert.match(guest, /person\?\.id \? el\('button', \{\n\s*type: 'button', class: 'link vc-later gf-report',/);
  for (const lang of LANGS) assert.ok(stringsOf(guest, lang).gf_report, `${lang}.gf_report`);
  const nearby = read('screens/nearby.js');
  assert.match(nearby, /profileFirst\(`\/person\/\$\{p\.id\}`, \{ id: p\.id, name: p\.name \}\)/);
});
