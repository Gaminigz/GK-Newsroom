// Run: npm run 30da:test (or node --test src/thirtyda-app/shared/meet.test.mjs)
// Meetings in the Level 3 chat (owner 2026-10-14): Phnom Penh time whatever the device clock, future-only within 60 days,
// the place as sent, the Google Maps link, who may accept / decline / cancel, the status line each side sees, the
// per-conversation limit — and the app's words in all 5 languages, the Meet button (the calendar and the word) next to the mic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LANGS } from './rules.js';
import {
  PP_OFFSET_MS, MEET_MAX_DAYS, PLACE_NAME_MAX, PLACE_ADDRESS_MAX, MEET_PER_PAIR_HOUR, ppParts, ppDateValue, ppTimeValue,
  ppInstant, checkMeetTime, checkPlace, cleanLine, cutLine, mapsUrl, placeTexts, placeLine, meetActionCheck, meetsLastHour,
  openMeet, meetView, meetStatusKey, meetChoices, KH_BOX, inCambodia, samePlace, keptPlace,
} from './meet.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const DAY = 864e5;
const NOW = Date.UTC(2026, 9, 14, 5, 0); // 14 Oct 2026 12:00 in Phnom Penh

// ---------------------------------------------------------------- Phnom Penh time

test('Phnom Penh time: UTC+7 wall clock, whatever zone this machine runs in', () => {
  assert.equal(PP_OFFSET_MS, 7 * 3600e3);
  // 17:30 UTC on 14 Oct is 00:30 on 15 Oct in Phnom Penh (a Thursday).
  const p = ppParts(Date.UTC(2026, 9, 14, 17, 30));
  assert.deepEqual(p, { year: 2026, month: 10, day: 15, hour: 0, minute: 30, weekday: 4 });
  assert.equal(ppDateValue(Date.UTC(2026, 9, 14, 17, 30)), '2026-10-15');
  assert.equal(ppTimeValue(Date.UTC(2026, 9, 14, 17, 30)), '00:30');
  // The boxes "2026-10-20" + "18:30" mean 18:30 in Phnom Penh = 11:30 UTC, never the phone's own zone.
  assert.equal(new Date(ppInstant('2026-10-20', '18:30')).toISOString(), '2026-10-20T11:30:00.000Z');
  assert.equal(new Date(ppInstant('2026-10-20', '06:05:00')).toISOString(), '2026-10-19T23:05:00.000Z', 'seconds ignored; the day before in UTC');
  // Round trip.
  const ms = ppInstant('2026-12-31', '23:59');
  assert.equal(ppDateValue(ms), '2026-12-31');
  assert.equal(ppTimeValue(ms), '23:59');
});

test('Phnom Penh time: boxes that are not a real date or time → NaN', () => {
  for (const [d, t] of [['2026-02-30', '10:00'], ['2026-13-01', '10:00'], ['2026-10-00', '10:00'], ['2026-10-20', '24:00'],
    ['2026-10-20', '18:60'], ['', '18:30'], ['2026-10-20', ''], ['20/10/2026', '18:30'], ['2026-10-20', '6pm'], [null, undefined]]) {
    assert.ok(Number.isNaN(ppInstant(d, t)), `${d} ${t}`);
  }
});

test('when: in the future, within 60 days, an instant with its zone; rounded down to the minute', () => {
  const ok = checkMeetTime('2026-10-20T11:30:45.123Z', NOW);
  assert.deepEqual(ok, { ok: true, at: '2026-10-20T11:30:00.000Z' });
  assert.deepEqual(checkMeetTime('2026-10-20T18:30:00+07:00', NOW), { ok: true, at: '2026-10-20T11:30:00.000Z' }, 'an offset is fine');
  assert.equal(checkMeetTime(new Date(NOW - 60e3).toISOString(), NOW).error, 'past');
  assert.equal(checkMeetTime(new Date(NOW).toISOString(), NOW).error, 'past', 'now is not the future');
  assert.equal(checkMeetTime(new Date(NOW + 60e3).toISOString(), NOW).ok, true, 'a minute from now is');
  assert.equal(checkMeetTime(new Date(NOW + MEET_MAX_DAYS * DAY).toISOString(), NOW).ok, true, 'day 60');
  assert.equal(checkMeetTime(new Date(NOW + MEET_MAX_DAYS * DAY + 60e3).toISOString(), NOW).error, 'too_far');
  for (const bad of ['2026-10-20T18:30', '2026-10-20', 'tomorrow', '', null, 1792000000000, {}, '2026-10-20T18:30:00+7']) {
    assert.equal(checkMeetTime(bad, NOW).error, 'bad_time', String(bad));
  }
});

// ---------------------------------------------------------------- the place

test('place: a name of 2–80 characters, a short address, the point both or neither (rounded)', () => {
  assert.deepEqual(checkPlace({ name: '  Brown   Coffee TK ', address: 'Russian Federation Blvd,\nToul Kork', lat: 11.572812345, lng: 104.89991234 }), {
    ok: true, place: { name: 'Brown Coffee TK', address: 'Russian Federation Blvd, Toul Kork', lat: 11.572812, lng: 104.899912 },
  });
  assert.deepEqual(checkPlace({ name: 'Brown Coffee TK' }), { ok: true, place: { name: 'Brown Coffee TK', address: null, lat: null, lng: null } }, 'typed: no point');
  assert.equal(checkPlace({ name: 'B' }).field, 'name');
  assert.equal(checkPlace({ name: 'x'.repeat(PLACE_NAME_MAX + 1) }).field, 'name');
  assert.equal(checkPlace({ name: 'ឈ'.repeat(PLACE_NAME_MAX) }).ok, true, 'counted in characters');
  assert.equal(checkPlace({ name: 'Cafe', address: 'y'.repeat(PLACE_ADDRESS_MAX + 1) }).field, 'address');
  assert.equal(checkPlace({ name: 'Cafe', lat: 11.5 }).field, 'point', 'both or neither');
  assert.equal(checkPlace({ name: 'Cafe', lat: '11.5', lng: '104.9' }).field, 'point', 'numbers only');
  assert.equal(checkPlace({ name: 'Cafe', lat: 91, lng: 104 }).field, 'point');
  assert.equal(checkPlace({ name: 'Cafe', lat: 11, lng: Infinity }).field, 'point');
  for (const bad of [null, 'Brown Coffee', ['Brown Coffee'], 42]) assert.equal(checkPlace(bad).ok, false);
  assert.equal(cleanLine('a\u200bb\u202ec\u0007d'), 'abc d', 'zero-width and direction marks go; a control character is a space');
  assert.equal(cutLine('😀'.repeat(5), 3), '😀😀😀', 'whole characters');
  assert.deepEqual(placeTexts({ name: 'Cafe', address: null }), ['Cafe', null]);
  assert.equal(placeLine({ name: 'Brown Coffee', address: 'Toul Kork' }), 'Brown Coffee · Toul Kork');
});

test('what is kept of a sent place: address and point only for a place the server knows; never a point outside Cambodia', () => {
  const brown = { name: 'Brown Coffee TK', address: 'Russian Federation Blvd, Toul Kork', lat: 11.5728, lng: 104.8999 };
  assert.deepEqual(keptPlace(brown, true), brown);
  assert.deepEqual(keptPlace(brown, false), { name: 'Brown Coffee TK', address: null, lat: null, lng: null }, 'typed: the name alone');
  assert.deepEqual(keptPlace({ ...brown, lat: 1.29, lng: 103.85 }, true), { ...brown, lat: null, lng: null }, 'Singapore: no point');
  assert.equal(keptPlace(null, true), null);
  assert.equal(inCambodia(11.5728, 104.8999), true);
  assert.equal(inCambodia(13.36, 103.86), true, 'Siem Reap');
  assert.equal(inCambodia(10.6, 104.17), true, 'Kampot');
  for (const [lat, lng] of [[1.29, 103.85], [13.75, 100.5], [null, null], ['11.5', '104.9'], [NaN, 104.9]]) {
    assert.equal(inCambodia(lat, lng), false, `${lat},${lng}`);
  }
  assert.ok(KH_BOX.minLat < 11.56 && KH_BOX.maxLat > 11.56 && KH_BOX.minLng < 104.93 && KH_BOX.maxLng > 104.93);
  assert.equal(samePlace(brown, { ...brown }), true);
  assert.equal(samePlace(brown, { ...brown, lat: 11.48 }), false);
  assert.equal(samePlace(brown, { ...brown, address: null }), false);
  assert.equal(samePlace({ name: 'Cafe', address: null, lat: null, lng: null }, { name: 'Cafe' }), true, 'missing = null');
  assert.equal(samePlace(brown, null), false);
});

test('the Google Maps link: the point when there is one, else the name (no key, opens the app or the site)', () => {
  assert.equal(mapsUrl({ name: 'Brown Coffee TK', lat: 11.5728, lng: 104.8999 }), 'https://www.google.com/maps/search/?api=1&query=11.5728%2C104.8999');
  assert.equal(mapsUrl({ name: 'Brown Coffee TK', lat: null, lng: null }), 'https://www.google.com/maps/search/?api=1&query=Brown%20Coffee%20TK');
  assert.equal(mapsUrl({ name: 'ហាងកាហ្វេ & Tea' }), `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('ហាងកាហ្វេ & Tea')}`);
  assert.equal(mapsUrl({ name: 'x', lat: -1.5, lng: -0.25 }), 'https://www.google.com/maps/search/?api=1&query=-1.5%2C-0.25');
  assert.ok(mapsUrl({ name: '"><script>' }).startsWith('https://www.google.com/maps/search/?api=1&query=%22%3E%3Cscript%3E'));
});

// ---------------------------------------------------------------- who may do what

const proposed = (by = 'U-1', at = NOW + DAY) => ({ at: new Date(at).toISOString(), status: 'proposed', by });

test('accept / decline: only the other person, only while proposed and still to come', () => {
  assert.deepEqual(meetActionCheck(proposed('U-1'), 'U-2', 'accept', NOW), { status: 'accepted' });
  assert.deepEqual(meetActionCheck(proposed('U-1'), 'U-2', 'decline', NOW), { status: 'declined' });
  assert.deepEqual(meetActionCheck(proposed('U-1'), 'U-1', 'accept', NOW), { error: 'not_yours' }, 'not my own suggestion');
  assert.deepEqual(meetActionCheck(proposed('U-1'), 'U-1', 'decline', NOW), { error: 'not_yours' });
  assert.deepEqual(meetActionCheck({ ...proposed('U-1'), status: 'cancelled', doneBy: 'U-1' }, 'U-2', 'accept', NOW), { error: 'not_open' });
  assert.deepEqual(meetActionCheck({ ...proposed('U-1'), status: 'declined', doneBy: 'U-2' }, 'U-2', 'accept', NOW), { error: 'not_open' });
  assert.deepEqual(meetActionCheck(proposed('U-1', NOW - 60e3), 'U-2', 'accept', NOW), { error: 'past' });
  assert.deepEqual(meetActionCheck({ ...proposed('U-1'), status: 'accepted', doneBy: 'U-2' }, 'U-2', 'accept', NOW), { status: 'accepted', same: true }, 'a double tap');
  assert.deepEqual(meetActionCheck(proposed('U-1'), 'U-2', 'maybe', NOW), { error: 'invalid' });
});

test('cancel: only the proposer, while proposed or accepted and still to come', () => {
  assert.deepEqual(meetActionCheck(proposed('U-1'), 'U-1', 'cancel', NOW), { status: 'cancelled' });
  assert.deepEqual(meetActionCheck({ ...proposed('U-1'), status: 'accepted', doneBy: 'U-2' }, 'U-1', 'cancel', NOW), { status: 'cancelled' });
  assert.deepEqual(meetActionCheck(proposed('U-1'), 'U-2', 'cancel', NOW), { error: 'not_yours' }, 'the other person declines instead');
  assert.deepEqual(meetActionCheck({ ...proposed('U-1'), status: 'declined', doneBy: 'U-2' }, 'U-1', 'cancel', NOW), { error: 'not_open' });
  assert.deepEqual(meetActionCheck({ ...proposed('U-1', NOW - 1), status: 'accepted' }, 'U-1', 'cancel', NOW), { error: 'past' });
  assert.deepEqual(meetActionCheck({ ...proposed('U-1'), status: 'cancelled', doneBy: 'U-1' }, 'U-1', 'cancel', NOW), { status: 'cancelled', same: true });
});

test('the card: each side its own status line and buttons', () => {
  const msg = (from, meet) => ({ id: 'M-9', from, at: new Date(NOW - 60e3).toISOString(), kind: 'meet', meet });
  const open = msg('U-1', { ...proposed('U-1'), place: { name: 'Brown Coffee TK', address: null, lat: 11.57, lng: 104.9 }, updatedAt: null });
  const mine = meetView(open, 'U-1');
  const theirs = meetView(open, 'U-2');
  assert.equal(mine.kind, 'meet');
  assert.equal(mine.mine, true);
  assert.equal(theirs.mine, false);
  assert.equal(theirs.meet.mapsUrl, 'https://www.google.com/maps/search/?api=1&query=11.57%2C104.9');
  assert.equal(theirs.meet.updatedAt, open.at, 'never changed: its own time');
  assert.equal('by' in theirs.meet || 'doneBy' in theirs.meet, false, 'no user ids on the card');
  assert.equal(meetStatusKey(mine, NOW), 'waiting_them');
  assert.equal(meetStatusKey(theirs, NOW), 'waiting_you');
  assert.deepEqual(meetChoices(theirs, NOW), { accept: true, decline: true, suggest: true, cancel: false });
  assert.deepEqual(meetChoices(mine, NOW), { accept: false, decline: false, suggest: false, cancel: true });
  const accepted = meetView({ ...open, meet: { ...open.meet, status: 'accepted' } }, 'U-2');
  assert.equal(meetStatusKey(accepted, NOW), 'accepted');
  assert.deepEqual(meetChoices(accepted, NOW), { accept: false, decline: false, suggest: false, cancel: false });
  assert.equal(meetChoices(meetView({ ...open, meet: { ...open.meet, status: 'accepted' } }, 'U-1'), NOW).cancel, true, 'the proposer can still cancel');
  assert.equal(meetStatusKey(meetView({ ...open, meet: { ...open.meet, status: 'cancelled', note: 'replaced' } }, 'U-2'), NOW), 'replaced');
  assert.equal(meetStatusKey(meetView({ ...open, meet: { ...open.meet, status: 'cancelled' } }, 'U-2'), NOW), 'cancelled');
  assert.equal(meetStatusKey(meetView({ ...open, meet: { ...open.meet, status: 'declined' } }, 'U-1'), NOW), 'declined');
  assert.equal(meetStatusKey(theirs, NOW + 2 * DAY), 'passed', 'its time has gone: no buttons');
  assert.deepEqual(meetChoices(theirs, NOW + 2 * DAY), { accept: false, decline: false, suggest: false, cancel: false });
  assert.equal(meetView({ ...open, meet: { ...open.meet, status: 'weird' } }, 'U-1').meet.status, 'cancelled');
});

test('one open suggestion; 6 an hour per conversation (stopped tries count)', () => {
  const m = (id, from, at, status, stopped = false) => ({ id, from, at: new Date(at).toISOString(), kind: 'meet', stopped, meet: { status } });
  const log = [
    m('M-1', 'U-1', NOW - 50 * 60e3, 'cancelled'), m('M-2', 'U-2', NOW - 40 * 60e3, 'proposed'),
    { id: 'M-3', from: 'U-1', at: new Date(NOW - 30 * 60e3).toISOString(), kind: 'chat' }, m('M-4', 'U-1', NOW - 20 * 60e3, null, true),
    m('M-5', 'U-1', NOW - 2 * 3600e3, 'declined'),
  ];
  assert.equal(openMeet(log).id, 'M-2');
  assert.equal(openMeet([]), null);
  assert.equal(meetsLastHour(log, 'U-1', NOW), 2, 'M-1 and the stopped M-4; not the chat line, not 2 hours ago');
  assert.equal(meetsLastHour(log, 'U-2', NOW), 1);
  assert.equal(MEET_PER_PAIR_HOUR, 6);
});

// ---------------------------------------------------------------- the app: words and hooks

/** { en: Set(keys), … } of the registerStrings({ … }) block of a screen file whose keys start with `prefix`. */
function stringKeys(src, prefix) {
  const out = {};
  const block = src.slice(src.lastIndexOf('registerStrings({'));
  for (const m of block.matchAll(/^ {2}(\w{2}): \{\n([\s\S]*?)\n {2}\},?$/gm)) {
    out[m[1]] = new Set([...m[2].matchAll(new RegExp(`^ {4}(${prefix}\\w+):`, 'gm'))].map((k) => k[1]));
  }
  return out;
}

test('the meeting sheet and card: the same words in all 5 languages, every key the code asks for', () => {
  const src = read('../screens/meet.js');
  const keys = stringKeys(src, 'meet_');
  assert.deepEqual(Object.keys(keys).sort(), [...LANGS].sort());
  const en = [...keys.en].sort();
  for (const lang of LANGS) assert.deepEqual([...keys[lang]].sort(), en, lang);
  const code = src.slice(0, src.lastIndexOf('registerStrings({'));
  const used = new Set([...code.matchAll(/t\('(meet_\w+)'/g)].map((m) => m[1]));
  for (const k of used) assert.ok(keys.en.has(k), `${k} has words`);
  for (const status of ['wait_them', 'wait_you', 'accepted', 'declined', 'cancelled', 'replaced', 'passed']) assert.ok(keys.en.has(`meet_${status}`), status);
  for (const action of ['accept', 'decline', 'cancel']) assert.ok(keys.en.has(`meet_done_${action}`), action);
  assert.match(src, /meet_safety: 'Meet in a public place\. Tell a friend where you go\.'/);
  assert.match(src, /meet_pp_time: '\(Phnom Penh time\)'/);
});

test('the card opens Google Maps outside the app; no Google script anywhere (the CSP allows none)', () => {
  const src = read('../screens/meet.js');
  assert.match(src, /target: '_blank', rel: 'noopener noreferrer'/);
  assert.doesNotMatch(src, /maps\.googleapis|<script|innerHTML = [^P]/, 'only the constant icon paths go through innerHTML');
  assert.match(src, /api\.get\(`\/places\?q=\$\{encodeURIComponent\(q\)\}`\)/, 'the search goes through our server');
  assert.match(src, /timeZone: PP_ZONE/);
  assert.match(src, /const PP_ZONE = 'Asia\/Phnom_Penh'/);
});

test('the place search asks only on Enter or the Search button, never as you type (the Nominatim usage policy)', () => {
  const src = read('../screens/meet.js');
  const sheet = src.slice(src.indexOf('export function openMeetSheet('), src.indexOf('// ---------------------------------------------------------------- the card'));
  const onInput = sheet.slice(sheet.indexOf("query.addEventListener('input'"), sheet.indexOf("query.addEventListener('keydown'"));
  assert.ok(onInput.length > 0);
  assert.doesNotMatch(onInput, /search\(|runSearch|setTimeout/, 'typing never searches');
  assert.doesNotMatch(src, /SEARCH_DELAY_MS|setTimeout\(\(\) => search/);
  assert.match(sheet, /class: 'btn btn-secondary meet-q-go', disabled: true, on: \{ click: runSearch \}/, 'the Search button');
  assert.match(sheet, /if \(e\.key !== 'Enter' \|\| e\.isComposing \|\| e\.keyCode === 229\) return;\n {4}e\.preventDefault\(\); \/\/ Enter searches now\n {4}runSearch\(\);/);
  assert.match(sheet, /const place = chosen\?\.ref \? \{ \.\.\.v\.place\.place, ref: chosen\.ref \} : v\.place\.place;/, 'a suggestion goes back with its ref');
});

test('the chat: the calendar button sits left of the mic, meetings draw their own card and update in place', () => {
  const chat = read('../screens/chat.js');
  assert.match(chat, /import \{ meetButton, meetRow, isMeet, meetChangedAt \} from '\.\/meet\.js';/);
  assert.match(chat, /el\('div', \{ class: 'composer' \}, meetBtn, mic, input, sendBtn\)/);
  assert.match(chat, /if \(isMeet\(m\)\) \{\n {6}\/\/ [^\n]+\n {6}const meetR = meetRow\(m, meetCtx\);\n {6}if \(reported\.has\(m\.id\)\) markReported\(meetR\);/);
  assert.match(chat, /report: \(quote\) => openReport\(quote\)/, 'their card reports through the chat\'s own sheet');
  const meet = read('../screens/meet.js');
  assert.match(meet, /if \(!cur\.mine && ctx\.report\) \{/, 'only their card has Report');
  assert.match(meet, /ctx\.report\(\{ id: cur\.id, text: quote \}\)/);
  assert.match(chat, /rows\.get\(m\.id\)\?\.update\?\.\(known\)/);
  assert.match(chat, /lastAt = Math\.max\(lastAt, ms\(m\.at\), isMeet\(m\) \? meetChangedAt\(m\) : 0\);/);
});

test('the composer button says "Meet" in the app language (owner 2026-10-15), its spoken name starts with it, and it stays compact', () => {
  const meet = read('../screens/meet.js');
  const reg = meet.slice(meet.lastIndexOf('registerStrings({'));
  const value = (lang, key) => {
    const block = reg.slice(reg.indexOf(`  ${lang}: {`), reg.indexOf('\n  },', reg.indexOf(`  ${lang}: {`)));
    return new RegExp(`^ {4}${key}: '([^']*)',$`, 'm').exec(block)?.[1];
  };
  const WORD = { en: 'Meet', km: 'ជួបគ្នា', zh: '见面', ko: '만나기', ja: '会う' };
  for (const lang of LANGS) {
    assert.equal(value(lang, 'meet_button'), WORD[lang], lang);
    const label = value(lang, 'meet_button_label');
    assert.ok(label.startsWith(WORD[lang]) && label.includes('{name}'), `${lang}: the spoken name starts with the word (${label})`);
  }
  assert.equal(value('en', 'meet_title'), 'Set a meeting', 'the sheet keeps its title');
  // The word through t() (Khmer too: khmerKeep), never written into the code.
  const code = meet.slice(0, meet.lastIndexOf('registerStrings({'));
  assert.match(code, /'aria-label': t\('meet_button_label', \{ name: ctx\.name \}\), title: t\('meet_title'\),/);
  assert.match(code, /\}, ownIcon\('calendar', 18\), el\('span', \{ class: 'meet-btn-text' \}, t\('meet_button'\)\)\);/);
  for (const w of Object.values(WORD).slice(1)) assert.ok(!code.includes(w), `${w} only in the strings`);
  // A pill as tall as the round buttons beside it, one line; tighter on a phone under 390 px (measured at 360 px: the
  // message box keeps 141–149 px in all 5 languages, the mic and send stay 44 px, nothing wraps).
  assert.match(code, /'\.composer \.meet-btn \{ flex: none; display: inline-flex; align-items: center; justify-content: center; gap: 5px; width: auto; min-width: 44px; padding: 0 13px 0 11px; border-radius: 999px; font-size: 14px; font-weight: 700; line-height: 1; white-space: nowrap; \}'/);
  assert.match(code, /'@media \(max-width: 389px\) \{ \.composer \.meet-btn \{ gap: 3px; padding: 0 10px 0 8px; font-size: 13px; \}/);
  const chat = read('../screens/chat.js');
  assert.match(chat, /'@media \(max-width: 389px\) \{ \.chat \.composer \{ gap: 6px; \} \}'/);
  assert.match(chat, /el\('div', \{ class: 'composer' \}, meetBtn, mic, input, sendBtn\)/, 'still left of the mic');
});

test('a 320 px phone: Meet keeps its word, a step tighter than at 360 px, so the message box keeps ~115 px or more', () => {
  // Measured in headless Chromium (app.css + both RULES, the mic shown, 280 px composer): the message box 116–123 px in
  // all 5 languages (101–109 before this step), the mic and send 44 px, nothing overflows; at 360 px still 141–149 px.
  const meet = read('../screens/meet.js');
  const code = meet.slice(0, meet.lastIndexOf('registerStrings({'));
  const at389 = code.indexOf("'@media (max-width: 389px) { .composer .meet-btn {");
  const at349 = code.indexOf("'@media (max-width: 349px) { .composer .meet-btn { gap: 2px; padding: 0 7px 0 6px; font-size: 12px; } }'");
  assert.ok(at389 > 0 && at349 > at389, 'after the 360 px step, so it wins');
  assert.match(code, /':lang\(km\) \.composer \.meet-btn \{ font-size: 13\.5px;/, 'Khmer keeps its own size');
  const chat = read('../screens/chat.js');
  const gap389 = chat.indexOf("'@media (max-width: 389px) { .chat .composer { gap: 6px; } }'");
  const gap349 = chat.indexOf("'@media (max-width: 349px) { .chat .composer { gap: 4px; } }'");
  assert.ok(gap389 > 0 && gap349 > gap389);
});
