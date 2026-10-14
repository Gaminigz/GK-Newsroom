// Screens 11 + 12 · Level 3 text chat. It runs at the bottom of the conversation screen (#/c/:pairId,
// screens/conversation.js), under the Level 1 and Level 2 history; the old #/chat/:pairId route only
// redirects there. Both phones run this same module: each person reads the thread in their own UI
// language, the other person's words as original / translation. The 20–30 character rule and the
// contact-detail check run live here (shared/rules.js) and again on the server, which also keeps every
// stopped attempt for the admin.
import {
  screen, el, icon, t, go, api, toast, modal, state, topBar, avatar, langPair, errorText,
  registerStrings, checkChatMessage, CHAT_MIN, CHAT_MAX, SPEECH_LOCALE, PHOTO_MAX, CHAT_REPORT_REASONS,
} from '../core.js';
// Inside the iOS / Android app a blocked microphone is the app's own setting, never "your browser settings" (Apple 4.2).
import { permissionOff } from '../in-app.js';
import { shellPlatform, shellCanDictate, shellDictate } from '../shell.js';
// Meetings (owner 2026-10-14): the calendar button next to the mic and the meeting cards in the thread (screens/meet.js).
import { meetButton, meetRow, isMeet, meetChangedAt } from './meet.js';

const POLL_MS = 3000;
const POLL_MAX_MS = 20000; // back-off ceiling while offline
const CURSOR_OVERLAP_MS = 15000; // re-ask a little history so a message saved a moment late is never skipped
const METER_SCALE = 40; // the track runs 0–40 so "too long" still has room to show
const NEAR_BOTTOM_PX = 96;
const GROUP_MS = 5 * 60e3; // same sender within 5 min → one time stamp under the run
const LONG_PRESS_MS = 480;
const REPORT_REASONS = CHAT_REPORT_REASONS; // rude, scam, sexual, underage, other (shared/safety.js)
const CONTACT_TYPES = ['phone', 'email', 'handle', 'app', 'link'];
const NO_SPACE_LANGS = new Set(['zh', 'ja']); // dictation appends without a space
const DICTATION_MAX_MS = 30e3; // owner 2026-10-14: one short message, never a long voice talk

const SpeechRec = typeof window === 'undefined'
  ? null
  : window.SpeechRecognition || window.webkitSpeechRecognition || null;

// ---------------------------------------------------------------- local styles

// Chat-only layout that app.css does not cover. A constructed stylesheet is CSSOM, which the page
// CSP (no inline <style>) allows.
const RULES = [
  '.screen.chat { height: 100dvh; min-height: 0; padding-bottom: 0; overflow: hidden; }',
  '.chat > .topbar { flex: none; gap: 10px; margin-bottom: 10px; }',
  '.chat-photos { display: flex; flex: none; }',
  '.chat-photo { display: block; flex: none; width: 34px; height: 34px; border-radius: 10px; overflow: hidden; }',
  '.chat-photo > .avatar { width: 100%; }',
  // Two or more photos: one overlapping stack (photo 1 in front), one tap opens them all, so the name
  // keeps its room (4 photos take 76px, not 129px).
  '.chat-stack { position: relative; display: flex; flex: none; padding: 0; border-radius: 10px; }',
  '.chat-stack > .chat-photo { position: relative; box-shadow: 0 0 0 2px #fff; }',
  '.chat-stack > .chat-photo + .chat-photo { margin-left: -20px; }',
  '.chat-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
  // Level 3: the real name, small under the app name. It wraps (up to 3 lines) rather than cutting a two- or
  // three-part name short next to 4 photos ("Chan / Sokunthea / Sreypov" in ~92px); only a very long one ends in
  // "…" (the whole name is its title, and the profile view shows it in full).
  '.chat-real { min-width: 0; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; overflow-wrap: anywhere; font-size: 12.5px; font-weight: 600; line-height: 1.25; color: var(--muted); }',
  '.chat-lang { gap: 5px; padding: 0 10px; font-family: var(--mono); font-size: 11px; letter-spacing: 0.04em; white-space: nowrap; }',
  '.chat > .banner { flex: none; }',
  '.chat-body { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; margin: 0 calc(var(--gutter) * -1); }',
  '.chat-scroll { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 14px var(--gutter) 18px; }',
  '.chat-scroll > .thread { min-height: 100%; }',
  '.chat-msg { display: flex; flex-direction: column; gap: 3px; }',
  '.chat-msg.mine { align-items: flex-end; }',
  '.chat-msg.theirs { align-items: flex-start; }',
  '.chat-msg.same { margin-top: -4px; }',
  '.chat-meta { display: flex; align-items: center; gap: 6px; padding: 0 6px; }',
  '.chat-flagged { display: inline-flex; align-items: center; gap: 3px; font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--red); }',
  '.bubble.can-report { cursor: pointer; -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }',
  '.bubble.can-report:active { background: #e1e7f1; }',
  '.bubble .trans-note { display: block; margin-top: 4px; font-size: 11.5px; font-style: italic; color: var(--muted-2); }',
  '.bubble.mine .trans-note { color: rgb(255 255 255 / 0.55); }',
  '.chat-empty { margin: auto 0; }',
  '.chat-empty .gate-title { font-size: 16px; font-weight: 800; color: var(--ink); }',
  '.chat-jump { position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 14px; border-radius: 999px; background: var(--navy); color: #fff; font-size: 12.5px; font-weight: 700; box-shadow: 0 6px 18px rgb(11 28 63 / 0.25); }',
  '.chat-foot { flex: none; display: flex; flex-direction: column; gap: 8px; margin: 0 calc(var(--gutter) * -1); padding: 10px var(--gutter) calc(12px + env(safe-area-inset-bottom)); border-top: 1px solid var(--line-soft); background: #fff; }',
  '.chat .round-btn[aria-disabled="true"] { background: var(--disabled-bg); border-color: var(--disabled-bg); color: var(--disabled-ink); cursor: default; }',
  '.chat .round-btn.busy { opacity: 0.6; cursor: progress; }',
  '.chat .composer-input { font-size: 16px; }', // under 16px iOS Safari zooms the page on focus
  '.chat-meter { display: flex; align-items: center; gap: 10px; }',
  '.chat-meter > .meter { flex: 1; }',
  '.chat-meter > .counter { min-width: 48px; text-align: right; }',
  '.chat-hint { font-size: 12px; line-height: 1.4; color: var(--muted); }',
  '.chat-status { font-size: 12px; text-align: center; color: var(--muted); }',
  '.chat-closed { justify-content: center; min-height: 44px; }',
  '.report-quote { max-width: 100%; }',
  '.chat-viewer-thumbs { display: flex; justify-content: center; gap: 8px; }',
  '.chat-viewer-thumbs .thumb { width: 56px; height: 56px; }',
  '.chat-viewer-thumbs .thumb[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--navy); }',
  '@media (prefers-reduced-motion: reduce) { .chat .round-btn.listening { animation: none; } }',
];

let styled = false;
export function ensureStyles() {
  if (styled) return;
  styled = true;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(RULES.join('\n'));
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  } catch {
    // No constructable stylesheets: add the rules to app.css's sheet (same origin) instead.
    const own = [...document.styleSheets].find((s) => String(s.href || '').endsWith('/30da/app.css'));
    for (const rule of own ? RULES : []) {
      try { own.insertRule(rule, own.cssRules.length); } catch { /* skip a rule this engine cannot parse */ }
    }
  }
}

// ---------------------------------------------------------------- small helpers

const localeOf = () => SPEECH_LOCALE[state.lang] || 'en-US';
const ms = (iso) => Date.parse(iso) || 0;
const byTime = (x, y) => ms(x.at) - ms(y.at);
const errText = (code) => t(`chat_err_${code}`, { min: CHAT_MIN, max: CHAT_MAX });

// Some browsers ship ICU without Khmer date names (Chrome desktop prints "Sun 11 Oct"), so Khmer
// dates and times are written out here when Intl cannot.
const KM_DAYS = ['អាទិត្យ', 'ច័ន្ទ', 'អង្គារ', 'ពុធ', 'ព្រហស្បតិ៍', 'សុក្រ', 'សៅរ៍'];
const KM_MONTHS = ['មករា', 'កុម្ភៈ', 'មីនា', 'មេសា', 'ឧសភា', 'មិថុនា', 'កក្កដា', 'សីហា', 'កញ្ញា', 'តុលា', 'វិច្ឆិកា', 'ធ្នូ'];
let intlKhmer = null;
function hasIntlKhmer() {
  if (intlKhmer == null) {
    try { intlKhmer = Intl.DateTimeFormat.supportedLocalesOf(['km']).length > 0; } catch { intlKhmer = false; }
  }
  return intlKhmer;
}

const pad2 = (n) => String(n).padStart(2, '0');

function fmtDate(date, opts) {
  if (state.lang === 'km' && !hasIntlKhmer()) {
    if (opts.hour) return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
    return [KM_DAYS[date.getDay()], date.getDate(), KM_MONTHS[date.getMonth()], opts.year ? date.getFullYear() : null]
      .filter((x) => x != null).join(' ');
  }
  try {
    return new Intl.DateTimeFormat(localeOf(), opts).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function dayKey(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** "Today", "Yesterday", or a short local date ("Mon, 12 Oct"). */
export function dayLabel(iso) {
  const d = new Date(iso);
  const now = new Date();
  if (dayKey(d) === dayKey(now)) return t('chat_today');
  if (dayKey(d) === dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return t('chat_yesterday');
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return fmtDate(d, opts);
}

export const fmtTime = (iso) => fmtDate(new Date(iso), { hour: 'numeric', minute: '2-digit' });

/** Localised reason for a contact-detail verdict (the client check or the server's 422 data). */
function contactText(r) {
  const type = r?.hits?.[0]?.type;
  return CONTACT_TYPES.includes(type) ? t(`chat_err_${type}`) : t('chat_err_contact');
}

const reduceMotion = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/** Full-size view of the partner's photos, with thumbnails to switch between them. */
/** reportPhoto(n): "Report photo" under the shown one (n = its place among the photos I can see, 1-based). */
function viewPhotos(urls, start, name, reportPhoto = null) {
  const label = (i) => t('chat_photo_n', { name, n: i + 1 });
  let shown = start;
  const img = el('img', { src: urls[start], alt: label(start) });
  const thumbs = urls.map((url, i) => el('button', {
    type: 'button', class: 'thumb', 'aria-label': label(i), 'aria-pressed': String(i === start),
    on: { click: () => show(i) },
  }, el('img', { src: url, alt: '' })));
  function show(i) {
    shown = i;
    img.src = urls[i];
    img.alt = label(i);
    thumbs.forEach((b, k) => b.setAttribute('aria-pressed', String(k === i)));
  }
  const report = reportPhoto
    ? el('button', {
      type: 'button', class: 'link report-photo', on: { click: () => { dlg.close(); reportPhoto(shown + 1); } },
    }, icon('flag', 14), el('span', {}, t('chat_report_photo')))
    : null;
  const dlg = modal(el('div', { class: 'dialog-body viewer' },
    img,
    urls.length > 1 ? el('div', { class: 'chat-viewer-thumbs' }, thumbs) : null,
    el('button', { type: 'button', class: 'btn btn-secondary', on: { click: () => dlg.close() } }, t('core_close')),
    report),
  { label: name });
}

/**
 * Web Speech dictation into the input: words land as text and are sent as text, never as voice.
 * Returns stop(), which drops a running recognition without touching the input.
 */
function dictation(button, input, onChange) {
  let rec = null;
  let cap = null; // stops the browser's recognition after DICTATION_MAX_MS
  const setOn = (on) => {
    button.classList.toggle('listening', on);
    button.setAttribute('aria-pressed', String(on));
    button.setAttribute('aria-label', t(on ? 'chat_mic_stop' : 'chat_mic'));
  };

  function start() {
    let r;
    try { r = new SpeechRec(); } catch { toast(t('chat_mic_failed')); return; }
    const lang = state.lang;
    r.lang = SPEECH_LOCALE[lang] || 'en-US';
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    const before = input.value.trim();
    const sep = before && !NO_SPACE_LANGS.has(lang) ? ' ' : '';
    r.onresult = (e) => {
      let said = '';
      for (let i = 0; i < e.results.length; i++) said += e.results[i][0]?.transcript || '';
      said = said.trim();
      input.value = said ? before + sep + said : before;
      onChange();
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') permissionOff('mic', t('chat_mic_denied'));
      else if (e.error === 'no-speech') toast(t('chat_mic_nothing'));
      else if (e.error !== 'aborted') toast(t('chat_mic_failed'));
    };
    r.onend = () => {
      clearTimeout(cap);
      if (rec !== r) return;
      rec = null;
      setOn(false);
    };
    try {
      r.start();
      rec = r;
      setOn(true);
      clearTimeout(cap);
      cap = setTimeout(() => { if (rec === r) { try { r.stop(); } catch { /* already stopping */ } } }, DICTATION_MAX_MS);
    } catch {
      toast(t('chat_mic_failed'));
    }
  }

  /** The Android app's own dictation (Google's listening sheet over the app): → text in the box, never sent by itself. */
  async function startNative() {
    const lang = state.lang;
    const before = input.value.trim();
    const sep = before && !NO_SPACE_LANGS.has(lang) ? ' ' : '';
    const run = {};
    rec = run;
    setOn(true);
    try {
      const r = await shellDictate(SPEECH_LOCALE[lang] || 'en-US');
      if (rec !== run) return; // the screen went away meanwhile
      const said = typeof r?.text === 'string' ? r.text.trim() : '';
      if (said) {
        input.value = before + sep + said;
        onChange();
      }
    } catch (e) {
      if (rec !== run) return;
      if (e?.code === 'UNAVAILABLE') button.hidden = true;
      else toast(t('chat_mic_failed'));
    } finally {
      if (rec === run) {
        rec = null;
        setOn(false);
      }
    }
  }

  button.addEventListener('click', () => {
    if (button.dataset.native === '1') {
      if (!rec) startNative();
      return;
    }
    if (!rec) return start();
    try { rec.stop(); } catch { /* already stopping */ }
  });

  return () => {
    const r = rec;
    rec = null;
    clearTimeout(cap);
    setOn(false);
    if (!r || typeof r.abort !== 'function') return;
    r.onresult = null;
    r.onerror = null;
    r.onend = null;
    try { r.abort(); } catch { /* already stopped */ }
  };
}

function square(url) {
  const a = avatar(url, 34);
  a.classList.add('square');
  return a;
}

/**
 * Header row of a conversation: back, the partner's photos (only the ones I may see; a tap opens them),
 * app name, their real name under it (`realName`: only at Level 3, the server sends it then), `sub` (text
 * or a node), and the translation chip (EN⇄KM; a tap says who writes in what).
 */
/**
 * The conversation / chat header. Store policy (owner 2026-10-14): `menu` (a node, the ⋯ of screens/safety.js) sits
 * right of the language chip; reportPhoto(n) adds "Report photo" to the photo viewer.
 */
export function partnerHeader({ name = '', photos = [], myLang = 'en', theirLang = 'en', sub = null, realName = '', menu = null, reportPhoto = null }) {
  let photoBtns;
  if (photos.length > 1) {
    photoBtns = [el('button', {
      type: 'button', class: 'chat-stack', 'aria-label': t('chat_photos_of', { name, n: photos.length }),
      on: { click: () => viewPhotos(photos, 0, name, reportPhoto) },
    }, photos.map((url, i) => el('span', { class: 'chat-photo', style: { zIndex: String(photos.length - i) } }, square(url))))];
  } else {
    photoBtns = photos.length
      ? [el('button', {
        type: 'button', class: 'chat-photo', 'aria-label': t('chat_photo_n', { name, n: 1 }),
        on: { click: () => viewPhotos(photos, 0, name, reportPhoto) },
      }, square(photos[0]))]
      : [el('span', { class: 'chat-photo' }, square(null))];
  }
  const langNote = () => {
    const mine = t(`chat_lang_${myLang}`);
    if (myLang === theirLang) return t('chat_lang_same', { name, mine });
    return t('chat_lang_note', { name, mine, theirs: t(`chat_lang_${theirLang}`) });
  };
  const pairCode = langPair(myLang, theirLang);
  const chip = el('button', {
    type: 'button', class: 'chip chip-sm chip-outline chat-lang', 'aria-label': t('chat_lang_aria', { pair: pairCode }),
    on: { click: () => toast(langNote()) },
  }, icon('translate', 14), pairCode);
  const right = menu ? el('span', { class: 'chat-actions' }, chip, menu) : chip;
  const bar = topBar({ left: 'back', title: el('span', { class: 'chat-name' }, name), sub, right });
  bar.insertBefore(el('div', { class: 'chat-photos' }, photoBtns), bar.querySelector('.topbar-title'));
  if (realName) {
    bar.querySelector('.topbar-h')?.after(el('div', { class: 'chat-real', title: realName },
      el('span', { class: 'visually-hidden' }, `${t('chat_real_name')}: `), realName));
  }
  return bar;
}

// ---------------------------------------------------------------- the chat

/**
 * Mount the Level 3 chat into `root` (a <main class="screen chat">). `history` (optional) is shown in the
 * same scroll area above the messages (the conversation's Level 1 and 2); `header` replaces the default
 * header row. Returns the cleanup fn.
 */
export function mountChat(root, { pair, data, gate, history = null, header: headerNode = null }) {
  const pid = pair.id;
  const base = `/pairs/${encodeURIComponent(pid)}`;
  const other = { ...pair.other, ...(data?.other || {}) };
  const name = other.name || '';
  const myLang = state.me?.lang || state.lang;
  const theirLang = other.lang || 'en';
  // The server sends only the photos I may see (all of them at Level 3): up to 4.
  const photos = (data?.other?.photos?.length ? data.other.photos : [pair.other?.photo]).filter(Boolean).slice(0, PHOTO_MAX);

  const msgs = []; // sorted by `at`
  const byId = new Map();
  const rows = new Map(); // id → { row, bubble, time, tag, meta }
  const reported = new Set();
  let lastDay = null;
  let prev = null; // last rendered row, for grouping
  let lastAt = 0; // newest server time seen → the poll cursor
  let alive = true;
  let mode = null; // null (chat) | 'phone' (needs a verified phone) | 'closed' (frozen or gone)
  let timer = null;
  let polling = false;
  let fails = 0;
  let sending = false;
  let nudged = false; // tapped Send while too short → say so until it is long enough
  let stoppedText = null; // the contact-detail text the server already stopped (not sent twice)
  let serverError = null; // { text, contact, msg } — the server's verdict for this exact text
  let reportOpen = false;

  // --- header: back, the partner's photos, name + LEVEL 3, translation chip
  const header = () => partnerHeader({ name, photos, myLang, theirLang, sub: t('chat_level3'), realName: other.realName || '' });

  // --- thread
  const thread = el('div', { class: 'thread', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions' });
  const scroller = el('div', { class: 'chat-scroll' }, history, thread);
  const jump = el('button', { type: 'button', class: 'chat-jump', hidden: true, on: { click: () => toBottom(true) } },
    icon('chevron', 14), el('span', {}, t('chat_new_messages')));
  const body = el('div', { class: 'chat-body' }, scroller, jump);
  scroller.addEventListener('scroll', () => { if (!jump.hidden && nearBottom()) jump.hidden = true; }, { passive: true });

  const nearBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < NEAR_BOTTOM_PX;

  function toBottom(smooth = false) {
    jump.hidden = true;
    requestAnimationFrame(() => {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth && !reduceMotion() ? 'smooth' : 'auto' });
    });
  }

  function emptyNode() {
    return el('div', { class: 'empty chat-empty' },
      el('span', { class: 'icon-circle', 'aria-hidden': 'true' }, icon('chat', 22)),
      el('p', {}, t('chat_empty', { name, min: CHAT_MIN, max: CHAT_MAX })));
  }

  function phoneGate() {
    return el('div', { class: 'empty chat-empty' },
      el('span', { class: 'icon-circle', 'aria-hidden': 'true' }, icon('lock', 22)),
      el('p', { class: 'gate-title' }, t('chat_phone_title')),
      el('p', {}, t('chat_phone_text')),
      el('button', { type: 'button', class: 'btn btn-primary btn-auto', on: { click: () => go('/me') } },
        el('span', {}, t('chat_verify_phone')), icon('arrow', 18)));
  }

  function bubbleText(m) {
    const parts = [el('span', { class: 'orig', lang: m.lang || null }, m.text)];
    if (m.translated && m.translated.trim() !== String(m.text).trim()) {
      parts.push(el('span', { class: 'trans', lang: myLang }, m.translated));
    } else if (!m.translated && m.lang && m.lang !== myLang) {
      parts.push(el('span', { class: 'trans-note' }, t('chat_no_translation')));
    }
    return parts;
  }

  const syncMeta = (r) => { r.meta.hidden = r.time.hidden && r.tag.hidden; };

  function markReported(r) {
    r.bubble.classList.add('reported');
    r.tag.hidden = false;
    syncMeta(r);
  }

  /** Received bubbles: tap, long-press, right-click or Enter opens the report menu. */
  function reportable(m, bubble) {
    bubble.classList.add('can-report');
    bubble.tabIndex = 0;
    bubble.setAttribute('role', 'button');
    bubble.setAttribute('aria-haspopup', 'dialog');
    let press = null;
    let longPressed = false;
    const cancel = () => { clearTimeout(press); press = null; };
    bubble.addEventListener('pointerdown', (e) => {
      if (e.button) return;
      longPressed = false;
      cancel();
      press = setTimeout(() => { longPressed = true; openReport(m); }, LONG_PRESS_MS);
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) bubble.addEventListener(ev, cancel);
    bubble.addEventListener('click', () => {
      if (longPressed) { longPressed = false; return; } // the long press already opened it
      openReport(m);
    });
    bubble.addEventListener('contextmenu', (e) => { e.preventDefault(); openReport(m); });
    bubble.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      openReport(m);
    });
  }

  function msgRow(m) {
    if (isMeet(m)) return meetRow(m, meetCtx);
    const mine = Boolean(m.mine);
    const bubble = el('div', { class: ['bubble', mine ? 'mine' : 'theirs'] }, bubbleText(m));
    const time = el('time', { class: 'bubble-time', datetime: m.at }, fmtTime(m.at));
    const tag = el('span', { class: 'chat-flagged', hidden: true }, icon('flag', 11), t('chat_reported_tag'));
    const meta = el('div', { class: 'chat-meta' }, time, tag);
    const r = { row: el('div', { class: ['chat-msg', mine ? 'mine' : 'theirs'] }, bubble, meta), bubble, time, tag, meta };
    if (!mine) reportable(m, bubble);
    if (reported.has(m.id)) markReported(r);
    return r;
  }

  function appendRow(m) {
    if (!rows.size && !lastDay) thread.replaceChildren(); // drop the empty state
    const day = dayKey(m.at);
    if (day !== lastDay) {
      thread.append(el('div', { class: 'day-divider' }, el('span', { class: 'label' }, dayLabel(m.at))));
      lastDay = day;
      prev = null;
    }
    const r = msgRow(m);
    if (prev && !isMeet(m) && !isMeet(prev.m) && Boolean(prev.m.mine) === Boolean(m.mine) && ms(m.at) - ms(prev.m.at) < GROUP_MS) {
      prev.time.hidden = true;
      syncMeta(prev);
      r.row.classList.add('same');
    }
    thread.append(r.row);
    rows.set(m.id, r);
    prev = { m, ...r };
  }

  function renderThread() {
    thread.replaceChildren();
    rows.clear();
    lastDay = null;
    prev = null;
    if (!msgs.length) thread.append(emptyNode());
    else msgs.forEach(appendRow);
  }

  /** Merge messages from a poll or a send: dedupe by id, keep time order, follow the bottom. */
  function addMessages(list) {
    const wasNear = nearBottom();
    let mineNew = false;
    let theirsNew = false;
    let reorder = false;
    for (const m of list || []) {
      if (!m?.id) continue;
      lastAt = Math.max(lastAt, ms(m.at), isMeet(m) ? meetChangedAt(m) : 0);
      const known = byId.get(m.id);
      if (known && isMeet(m)) {
        // A meeting that changed (accepted, declined, cancelled, replaced) comes again: the card follows the newest state.
        if (meetChangedAt(m) >= meetChangedAt(known) && JSON.stringify(m.meet) !== JSON.stringify(known.meet)) {
          Object.assign(known, m);
          rows.get(m.id)?.update?.(known);
        }
        continue;
      }
      if (known) {
        // The overlap re-reads recent messages: pick up a translation the server filled in late.
        if (!known.translated && m.translated) {
          known.translated = m.translated;
          rows.get(m.id)?.bubble.replaceChildren(...bubbleText(known));
        }
        continue;
      }
      byId.set(m.id, m);
      const last = msgs[msgs.length - 1];
      msgs.push(m);
      if (last && ms(m.at) < ms(last.at)) reorder = true;
      else if (!reorder) appendRow(m);
      if (m.mine) mineNew = true;
      else theirsNew = true;
    }
    if (reorder) {
      msgs.sort(byTime);
      renderThread();
    }
    if (mineNew || (theirsNew && wasNear)) toBottom(true);
    else if (theirsNew) jump.hidden = false;
  }

  // --- report menu (bottom sheet)
  function openReport(m) {
    if (reportOpen || !alive) return;
    if (reported.has(m.id)) { toast(t('chat_already_reported')); return; }
    reportOpen = true;
    const fail = el('p', { class: 'field-error', role: 'alert', hidden: true });
    const items = REPORT_REASONS.map((reason) => el('button', {
      type: 'button', class: 'menu-item', on: { click: () => submit(reason) },
    }, el('span', {}, t(`chat_report_${reason}`)), icon('flag', 16)));
    const dlg = modal(el('div', { class: 'sheet-body' },
      el('h2', { class: 'sheet-title' }, t('chat_report_title')),
      el('div', { class: 'bubble theirs report-quote' }, bubbleText(m)),
      el('p', { class: 'label' }, t('chat_report_why')),
      el('div', { class: 'menu' }, items),
      fail,
      // Focus lands on Cancel, so a stray Enter never files a report.
      el('button', { type: 'button', class: 'btn btn-secondary', autofocus: true, on: { click: () => dlg.close() } }, t('chat_cancel'))),
    { sheet: true, label: t('chat_report_title') });
    dlg.node.addEventListener('close', () => { reportOpen = false; });

    async function submit(reason) {
      items.forEach((b) => { b.disabled = true; });
      fail.hidden = true;
      try {
        const r = await api.post(`${base}/messages/${encodeURIComponent(m.id)}/report`, { reason });
        reported.add(m.id);
        const row = rows.get(m.id);
        if (row) markReported(row);
        reportOpen = false;
        dlg.close();
        toast(r?.already ? t('chat_already_reported') : t('chat_reported'));
      } catch (err) {
        if (err.status === 401 || err.code === 'blocked') return; // core already moved on
        items.forEach((b) => { b.disabled = false; });
        fail.textContent = errorText(err);
        fail.hidden = false;
      }
    }
  }

  // --- composer: mic, pill input, send; the 20–30 track, counter and hint
  const input = el('input', {
    type: 'text', class: 'composer-input', placeholder: t('chat_placeholder', { name }), 'aria-label': t('chat_input_label'),
    'aria-describedby': 'chat-hint chat-error', autocomplete: 'off', autocapitalize: 'sentences', enterkeyhint: 'send',
    spellcheck: 'true', maxlength: 200, lang: myLang,
  });
  const sendBtn = el('button', { type: 'button', class: 'round-btn', 'aria-label': t('chat_send'), 'aria-disabled': 'true' }, icon('send', 18));
  // Dictation, only where it really works: the browser's own speech (laptops, phone browsers, the iPhone app — but Apple
  // has no Khmer recognizer, so not in Khmer there); in the Android app only its own (ThirtyDaShell.dictate, Khmer included).
  // The Android app's WebView HAS the Web Speech constructor but it never works there (no RECORD_AUDIO; Android
  // 2026-10-14): never use it in the Android app — only the app's own ThirtyDaShell.dictate (1.0.1+), else no mic.
  const webMic = Boolean(SpeechRec) && shellPlatform() !== 'android' && !(shellPlatform() === 'ios' && state.lang === 'km');
  const mic = el('button', { type: 'button', class: 'round-btn outline', 'aria-label': t('chat_mic'), 'aria-pressed': 'false' }, icon('mic', 18));
  if (!webMic) {
    mic.hidden = true;
    shellCanDictate().then((ok) => {
      if (!ok || !alive) return;
      mic.dataset.native = '1';
      mic.hidden = false;
    });
  }
  // Set a meeting (screens/meet.js): the same round outline button, left of the mic.
  const meetCtx = {
    base, name, fmtTime, onMessages: (list) => addMessages(list), closed: () => !alive || Boolean(mode),
    onClosed: (err) => sendFailed(err, ''),
  };
  const meetBtn = meetButton(meetCtx);
  const marker = el('span', { class: 'meter-marker', style: { left: '0%' } });
  const meter = el('div', { class: 'meter', 'aria-hidden': 'true' },
    el('span', {
      class: 'meter-window',
      style: { left: `${(CHAT_MIN / METER_SCALE) * 100}%`, width: `${((CHAT_MAX - CHAT_MIN) / METER_SCALE) * 100}%` },
    }),
    marker);
  const counter = el('span', { class: 'counter' }, `0 / ${CHAT_MAX}`);
  const hint = el('p', { class: 'chat-hint', id: 'chat-hint' }, t('chat_hint', { min: CHAT_MIN, max: CHAT_MAX }));
  const errorLine = el('span', {});
  const error = el('p', { class: 'field-error', id: 'chat-error', role: 'alert', hidden: true }, icon('shield', 14), errorLine);
  const status = el('p', { class: 'chat-status', role: 'status', hidden: true }, t('chat_reconnecting'));
  const composerNodes = [
    status,
    el('div', { class: 'composer' }, meetBtn, mic, input, sendBtn),
    el('div', { class: 'chat-meter' }, el('span', { class: 'label' }, t('chat_range', { min: CHAT_MIN, max: CHAT_MAX })), meter, counter),
    hint,
    error,
  ];
  const foot = el('div', { class: 'chat-foot' });

  function showError(msg) {
    error.hidden = !msg;
    hint.hidden = Boolean(msg);
    // Only touch the alert when the reason changes, so a screen reader is not re-told on every key.
    if (errorLine.textContent !== (msg || '')) errorLine.textContent = msg || '';
  }

  function update() {
    const text = input.value;
    const r = checkChatMessage(text);
    const n = r.count;
    marker.style.left = `${(Math.min(n, METER_SCALE) / METER_SCALE) * 100}%`;
    for (const node of [meter, counter]) {
      node.classList.toggle('ok', r.ok);
      node.classList.toggle('over', n > CHAT_MAX);
    }
    counter.textContent = `${n} / ${CHAT_MAX}`;
    const server = serverError && serverError.text === text.trim() ? serverError : null;
    // A contact detail or a bad word (store policy, owner 2026-10-14): the two the server stops and records.
    const contact = r.error === 'contact' || r.error === 'word' || Boolean(server?.contact);
    input.classList.toggle('is-error', contact);
    input.setAttribute('aria-invalid', String(contact));
    let msg = null;
    if (r.error === 'contact') msg = contactText(r);
    else if (r.error === 'word') msg = t('chat_err_word');
    else if (server) msg = server.msg;
    else if (r.error === 'trivial' || r.error === 'too_long') msg = errText(r.error);
    else if (r.error === 'too_short' && nudged && n > 0) msg = errText('too_short');
    showError(msg);
    sendBtn.setAttribute('aria-disabled', String(!(r.ok && !server && !sending)));
  }

  async function trySend() {
    if (sending || mode) return;
    const text = input.value.trim();
    const r = checkChatMessage(text);
    const server = serverError && serverError.text === text ? serverError : null;
    const stops = r.error === 'contact' || r.error === 'word';
    if ((!r.ok && !stops) || (server && !server.contact)) {
      nudged = true;
      update();
      input.focus();
      return;
    }
    // A contact detail or a bad word still goes to the server, which records the stopped attempt for the admin;
    // the same stopped text is not sent twice.
    if (stops && text === stoppedText) {
      toast(t(r.error === 'word' ? 'chat_stopped_word' : 'chat_stopped'));
      return;
    }
    sending = true;
    sendBtn.classList.add('busy');
    update();
    try {
      const res = await api.post(`${base}/messages`, { text });
      if (!alive) return;
      input.value = '';
      nudged = false;
      serverError = null;
      stoppedText = null;
      addMessages([res.message]);
    } catch (err) {
      if (alive) sendFailed(err, text);
    } finally {
      sending = false;
      sendBtn.classList.remove('busy');
      if (alive) update();
    }
  }

  function sendFailed(err, text) {
    switch (err?.code) {
      case 'contact_detail':
        stoppedText = text;
        serverError = { text, contact: true, msg: contactText(err.data) };
        toast(t('chat_stopped'));
        return;
      case 'bad_word':
      case 'word':
        stoppedText = text;
        serverError = { text, contact: true, msg: t('chat_err_word') };
        toast(t('chat_stopped_word'));
        return;
      case 'too_short':
      case 'too_long':
      case 'trivial':
        serverError = { text, contact: false, msg: errText(err.code) };
        return;
      case 'other_blocked':
      case 'not_found':
        setMode('closed');
        return;
      case 'phone_needed':
        setMode('phone');
        return;
      case 'chat_closed':
        toWait();
        return;
      case 'verify_needed': // the "Verify to chat" sheet already said why; the line stays in the box
        return;
      default:
        if (err?.status !== 401 && err?.code !== 'blocked') toast(errorText(err));
    }
  }

  input.addEventListener('input', update);
  input.addEventListener('keydown', (e) => {
    // isComposing / 229: Enter that confirms a Chinese, Japanese or Korean IME word is not "send".
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    trySend();
  });
  sendBtn.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus (and the keyboard) in the input
  sendBtn.addEventListener('click', trySend);
  const stopDictation = mic ? dictation(mic, input, update) : () => {};

  // --- gates: phone needed, conversation closed
  function setMode(next) {
    mode = next;
    if (mode) {
      clearTimeout(timer);
      timer = null;
      stopDictation();
    }
    if (mode === 'phone') {
      thread.replaceChildren(phoneGate());
      foot.hidden = true;
    } else if (mode === 'closed') {
      foot.hidden = false;
      foot.replaceChildren(el('p', { class: 'lock-note chat-closed', role: 'status' }, icon('lock', 14), el('span', {}, t('chat_closed'))));
    } else {
      foot.hidden = false;
      foot.replaceChildren(...composerNodes);
      update();
    }
  }

  // The server says the chat is not open (yet): show the conversation as it is now.
  function toWait() {
    if (alive) go(`/c/${encodeURIComponent(pid)}`, { replace: true });
  }

  // --- polling: every 3 s while visible, `after=` the newest message seen (with a little overlap)
  function schedule(delay = POLL_MS) {
    clearTimeout(timer);
    timer = null;
    if (!alive || mode || document.hidden) return;
    timer = setTimeout(poll, delay);
  }

  /** false when polling must stop. */
  function pollFailed(err) {
    if (err?.status === 401 || err?.code === 'blocked') return false; // core already moved on
    if (err?.code === 'chat_closed') { toWait(); return false; }
    if (err?.code === 'phone_needed') { setMode('phone'); return false; }
    if (err?.status === 404) { setMode('closed'); return false; }
    return true;
  }

  async function poll() {
    timer = null;
    if (!alive || mode || polling) return;
    polling = true;
    const after = lastAt ? `?after=${encodeURIComponent(new Date(lastAt - CURSOR_OVERLAP_MS).toISOString())}` : '';
    let keepGoing = true;
    try {
      const r = await api.get(`${base}/messages${after}`);
      fails = 0;
      if (alive) {
        status.hidden = true;
        addMessages(r.messages);
      }
    } catch (err) {
      keepGoing = alive && pollFailed(err);
      if (keepGoing && ++fails >= 2) status.hidden = false;
    } finally {
      polling = false;
    }
    if (keepGoing) schedule(fails ? Math.min(POLL_MAX_MS, POLL_MS * 2 ** fails) : POLL_MS);
  }

  const onVisibility = () => {
    if (document.hidden) {
      clearTimeout(timer);
      timer = null;
    } else if (!timer && !polling) {
      poll();
    }
  };

  // --- keyboard: keep the composer above an on-screen keyboard that only shrinks the visual viewport
  function fitViewport() {
    const vv = window.visualViewport;
    if (!vv) return () => {};
    const fit = () => {
      if (Math.abs(vv.scale - 1) > 0.01) return; // pinch zoom: leave the layout alone
      const keyboard = window.innerHeight - vv.height > 80;
      const stick = nearBottom();
      root.style.height = keyboard ? `${Math.round(vv.height)}px` : '';
      if (keyboard) window.scrollTo(0, 0);
      if (stick) toBottom(false);
    };
    vv.addEventListener('resize', fit);
    return () => vv.removeEventListener('resize', fit);
  }

  // --- mount
  for (const m of [...(data?.messages || [])].sort(byTime)) {
    lastAt = Math.max(lastAt, ms(m.at), isMeet(m) ? meetChangedAt(m) : 0);
    if (byId.has(m.id)) continue;
    byId.set(m.id, m);
    msgs.push(m);
  }
  renderThread();
  // With history above, the "text only" note sits in it (under LEVEL 3) instead of under the header.
  root.replaceChildren(...[
    headerNode || header(),
    history ? null : el('div', { class: 'banner', role: 'note' }, icon('shield', 16), el('span', {}, t('chat_text_only'))),
    body,
    foot,
  ].filter(Boolean));
  setMode(gate);
  if (!mode) {
    toBottom(false);
    schedule();
  }
  document.addEventListener('visibilitychange', onVisibility);
  const stopViewport = fitViewport();

  return () => {
    alive = false;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibility);
    stopViewport();
    stopDictation();
  };
}

// The chat lives at the bottom of the conversation screen now.
screen('/chat/:pairId', ({ params }) => {
  go(`/c/${encodeURIComponent(params.pairId)}`, { replace: true });
});

// ---------------------------------------------------------------- strings

registerStrings({
  en: {
    chat_level3: 'Level 3',
    chat_real_name: 'Real name',
    chat_text_only: 'Text only. No photos, voice or video.',
    chat_today: 'Today',
    chat_yesterday: 'Yesterday',
    chat_placeholder: 'Message {name}',
    chat_input_label: 'Your message',
    chat_send: 'Send',
    chat_mic: 'Speak instead of typing',
    chat_mic_stop: 'Stop listening',
    chat_mic_denied: 'Microphone access is off. Allow it in your browser settings.',
    chat_mic_nothing: 'We did not hear anything. Try again.',
    chat_mic_failed: 'Voice typing is not available right now.',
    chat_range: '{min}–{max}',
    chat_hint: '{min}–{max} characters. Not just “yes”, “ok”, “hi” or “bye”.',
    chat_err_too_short: 'Write at least {min} characters.',
    chat_err_too_long: 'Keep it to {max} characters or fewer.',
    chat_err_trivial: 'Say a little more than “yes”, “ok”, “hi” or “bye”.',
    chat_err_phone: 'Phone numbers are not allowed.',
    chat_err_email: 'Email addresses are not allowed.',
    chat_err_handle: 'Chat handles are not allowed.',
    chat_err_app: 'Chat app names are not allowed.',
    chat_err_link: 'Links are not allowed.',
    chat_err_contact: 'Contact details are not allowed.',
    chat_stopped: 'Message stopped. Contact details are never allowed.',
    chat_err_word: 'Rude, sexual or money words are not allowed.',
    chat_stopped_word: 'Message stopped. Rude, sexual or money words are never allowed.',
    chat_no_translation: 'Translation not available yet',
    chat_new_messages: 'New messages',
    chat_empty: 'Level 3 is open. Write your first message to {name}: {min} to {max} characters.',
    chat_closed: 'This conversation is closed.',
    chat_phone_title: 'Verify your phone to chat',
    chat_phone_text: 'Level 3 chat needs a verified phone number. Nobody else ever sees it.',
    chat_verify_phone: 'Verify phone',
    chat_reconnecting: 'No connection. Trying again…',
    chat_report_title: 'Report message',
    chat_report_why: 'Why are you reporting it?',
    chat_report_rude: 'Rude',
    chat_report_scam: 'Scam or money',
    chat_report_sexual: 'Sexual',
    chat_report_underage: 'Underage',
    chat_report_photo: 'Report photo',
    chat_report_other: 'Other',
    chat_reported: 'Reported. Thank you.',
    chat_already_reported: 'You already reported this message.',
    chat_reported_tag: 'Reported',
    chat_cancel: 'Cancel',
    chat_photo_n: 'Photo {n} of {name}',
    chat_photos_of: '{name}’s photos ({n})',
    chat_lang_aria: 'Translation {pair}',
    chat_lang_note: 'You write in {mine}, {name} in {theirs}. We translate for you.',
    chat_lang_same: 'You and {name} both write in {mine}.',
    chat_lang_en: 'English',
    chat_lang_km: 'Khmer',
    chat_lang_zh: 'Chinese',
    chat_lang_ko: 'Korean',
    chat_lang_ja: 'Japanese',
  },
  km: {
    chat_level3: 'កម្រិត 3',
    chat_real_name: 'ឈ្មោះពិត',
    chat_text_only: 'អក្សរតែប៉ុណ្ណោះ។ គ្មានរូបថត សំឡេង ឬវីដេអូទេ។',
    chat_today: 'ថ្ងៃនេះ',
    chat_yesterday: 'ម្សិលមិញ',
    chat_placeholder: 'សារទៅ {name}',
    chat_input_label: 'សាររបស់អ្នក',
    chat_send: 'ផ្ញើ',
    chat_mic: 'និយាយជំនួសការវាយ',
    chat_mic_stop: 'ឈប់ស្ដាប់',
    chat_mic_denied: 'មីក្រូហ្វូនត្រូវបានបិទ។ សូមអនុញ្ញាតនៅក្នុងការកំណត់កម្មវិធីរុករក។',
    chat_mic_nothing: 'យើងមិនបានឮអ្វីទេ។ សូមព្យាយាមម្ដងទៀត។',
    chat_mic_failed: 'ការវាយដោយសំឡេងមិនអាចប្រើបានឥឡូវនេះទេ។',
    chat_range: '{min}–{max}',
    chat_hint: '{min}–{max} តួអក្សរ។ មិនមែនត្រឹមតែ “បាទ/ចាស”, “អូខេ”, “សួស្ដី” ឬ “លាហើយ” ទេ។',
    chat_err_too_short: 'សូមសរសេរយ៉ាងតិច {min} តួអក្សរ។',
    chat_err_too_long: 'សូមសរសេរមិនឲ្យលើស {max} តួអក្សរ។',
    chat_err_trivial: 'សូមសរសេរឲ្យច្រើនជាង “បាទ/ចាស”, “អូខេ”, “សួស្ដី” ឬ “លាហើយ”។',
    chat_err_phone: 'មិនអនុញ្ញាតឲ្យដាក់លេខទូរស័ព្ទទេ។',
    chat_err_email: 'មិនអនុញ្ញាតឲ្យដាក់អាសយដ្ឋានអ៊ីមែលទេ។',
    chat_err_handle: 'មិនអនុញ្ញាតឲ្យដាក់ឈ្មោះគណនីជជែកទេ។',
    chat_err_app: 'មិនអនុញ្ញាតឲ្យដាក់ឈ្មោះកម្មវិធីជជែកទេ។',
    chat_err_link: 'មិនអនុញ្ញាតឲ្យដាក់តំណភ្ជាប់ទេ។',
    chat_err_contact: 'មិនអនុញ្ញាតឲ្យដាក់ព័ត៌មានទំនាក់ទំនងទេ។',
    chat_stopped: 'សារត្រូវបានបញ្ឈប់។ ព័ត៌មានទំនាក់ទំនងមិនត្រូវបានអនុញ្ញាតឡើយ។',
    chat_err_word: 'មិនអនុញ្ញាតឲ្យប្រើពាក្យអសុរស ពាក្យផ្លូវភេទ ឬពាក្យទាក់ទងនឹងលុយទេ។',
    chat_stopped_word: 'សារត្រូវបានបញ្ឈប់។ ពាក្យអសុរស ពាក្យផ្លូវភេទ ឬពាក្យទាក់ទងនឹងលុយ មិនត្រូវបានអនុញ្ញាតឡើយ។',
    chat_no_translation: 'មិនទាន់មានការបកប្រែនៅឡើយ',
    chat_new_messages: 'សារថ្មី',
    chat_empty: 'កម្រិត 3 បានបើកហើយ។ សរសេរសារដំបូងទៅ {name}៖ ពី {min} ដល់ {max} តួអក្សរ។',
    chat_closed: 'ការសន្ទនានេះត្រូវបានបិទ។',
    chat_phone_title: 'ផ្ទៀងផ្ទាត់លេខទូរស័ព្ទ ដើម្បីជជែក',
    chat_phone_text: 'ការជជែកកម្រិត 3 ត្រូវការលេខទូរស័ព្ទដែលបានផ្ទៀងផ្ទាត់។ គ្មាននរណាម្នាក់ផ្សេងឃើញលេខនេះទេ។',
    chat_verify_phone: 'ផ្ទៀងផ្ទាត់លេខទូរស័ព្ទ',
    chat_reconnecting: 'គ្មានការតភ្ជាប់។ កំពុងព្យាយាមម្ដងទៀត…',
    chat_report_title: 'រាយការណ៍សារ',
    chat_report_why: 'ហេតុអ្វីបានជាអ្នករាយការណ៍សារនេះ?',
    chat_report_rude: 'មិនគួរសម',
    chat_report_scam: 'ការបោកប្រាស់ ឬរឿងលុយកាក់',
    chat_report_sexual: 'ផ្លូវភេទ',
    chat_report_underage: 'អាយុមិនទាន់គ្រប់',
    chat_report_photo: 'រាយការណ៍រូបថត',
    chat_report_other: 'ផ្សេងៗ',
    chat_reported: 'បានរាយការណ៍ហើយ។ សូមអរគុណ។',
    chat_already_reported: 'អ្នកបានរាយការណ៍សារនេះរួចហើយ។',
    chat_reported_tag: 'បានរាយការណ៍',
    chat_cancel: 'បោះបង់',
    chat_photo_n: 'រូបថតទី {n} របស់ {name}',
    chat_photos_of: 'រូបថតរបស់ {name} ({n})',
    chat_lang_aria: 'ការបកប្រែ {pair}',
    chat_lang_note: 'អ្នកសរសេរជាភាសា{mine} ហើយ {name} សរសេរជាភាសា{theirs}។ យើងនឹងបកប្រែជូនអ្នក។',
    chat_lang_same: 'អ្នក និង {name} សរសេរជាភាសា{mine} ដូចគ្នា។',
    chat_lang_en: 'អង់គ្លេស',
    chat_lang_km: 'ខ្មែរ',
    chat_lang_zh: 'ចិន',
    chat_lang_ko: 'កូរ៉េ',
    chat_lang_ja: 'ជប៉ុន',
  },
  zh: {
    chat_level3: '等级 3',
    chat_real_name: '真实姓名',
    chat_text_only: '仅限文字。不能发照片、语音或视频。',
    chat_today: '今天',
    chat_yesterday: '昨天',
    chat_placeholder: '发消息给 {name}',
    chat_input_label: '你的消息',
    chat_send: '发送',
    chat_mic: '用语音输入文字',
    chat_mic_stop: '停止听写',
    chat_mic_denied: '麦克风权限已关闭，请在浏览器设置中允许。',
    chat_mic_nothing: '没有听到声音，请再试一次。',
    chat_mic_failed: '语音输入暂时不可用。',
    chat_range: '{min}–{max}',
    chat_hint: '{min}–{max} 个字。不要只写“是”“好”“嗨”或“再见”。',
    chat_err_too_short: '请至少写 {min} 个字。',
    chat_err_too_long: '请不要超过 {max} 个字。',
    chat_err_trivial: '多写一点，不要只说“是”“好”“嗨”或“再见”。',
    chat_err_phone: '不能发送电话号码。',
    chat_err_email: '不能发送邮箱地址。',
    chat_err_handle: '不能发送聊天账号。',
    chat_err_app: '不能提及聊天软件。',
    chat_err_link: '不能发送链接。',
    chat_err_contact: '不能发送联系方式。',
    chat_stopped: '消息已被拦截。任何联系方式都不允许分享。',
    chat_err_word: '不能使用粗俗、色情或涉及金钱的词语。',
    chat_stopped_word: '消息已被拦截。不允许粗俗、色情或涉及金钱的词语。',
    chat_no_translation: '暂无翻译',
    chat_new_messages: '新消息',
    chat_empty: '等级 3 已开启。给 {name} 写第一条消息吧：{min} 到 {max} 个字。',
    chat_closed: '此对话已关闭。',
    chat_phone_title: '验证手机号后即可聊天',
    chat_phone_text: '等级 3 聊天需要已验证的手机号。其他人永远看不到它。',
    chat_verify_phone: '验证手机号',
    chat_reconnecting: '网络未连接，正在重试…',
    chat_report_title: '举报消息',
    chat_report_why: '举报原因是什么？',
    chat_report_rude: '粗鲁无礼',
    chat_report_scam: '诈骗或要钱',
    chat_report_sexual: '色情内容',
    chat_report_underage: '未成年',
    chat_report_photo: '举报照片',
    chat_report_other: '其他',
    chat_reported: '已举报，谢谢你。',
    chat_already_reported: '你已经举报过这条消息。',
    chat_reported_tag: '已举报',
    chat_cancel: '取消',
    chat_photo_n: '{name} 的第 {n} 张照片',
    chat_photos_of: '{name} 的照片（{n} 张）',
    chat_lang_aria: '翻译 {pair}',
    chat_lang_note: '你用{mine}，{name} 用{theirs}。我们会为你翻译。',
    chat_lang_same: '你和 {name} 都用{mine}。',
    chat_lang_en: '英语',
    chat_lang_km: '高棉语',
    chat_lang_zh: '中文',
    chat_lang_ko: '韩语',
    chat_lang_ja: '日语',
  },
  ko: {
    chat_level3: '레벨 3',
    chat_real_name: '실명',
    chat_text_only: '텍스트만 가능해요. 사진, 음성, 영상은 보낼 수 없어요.',
    chat_today: '오늘',
    chat_yesterday: '어제',
    chat_placeholder: '{name}님에게 메시지',
    chat_input_label: '내 메시지',
    chat_send: '보내기',
    chat_mic: '말로 입력하기',
    chat_mic_stop: '듣기 멈추기',
    chat_mic_denied: '마이크 권한이 꺼져 있어요. 브라우저 설정에서 허용해 주세요.',
    chat_mic_nothing: '아무 소리도 들리지 않았어요. 다시 해 보세요.',
    chat_mic_failed: '지금은 음성 입력을 쓸 수 없어요.',
    chat_range: '{min}–{max}',
    chat_hint: '{min}–{max}자. “네”, “오케이”, “안녕”, “잘 가”만으로는 보낼 수 없어요.',
    chat_err_too_short: '최소 {min}자 이상 써 주세요.',
    chat_err_too_long: '{max}자 이내로 써 주세요.',
    chat_err_trivial: '“네”, “오케이”, “안녕”, “잘 가”보다 조금 더 말해 주세요.',
    chat_err_phone: '전화번호는 보낼 수 없어요.',
    chat_err_email: '이메일 주소는 보낼 수 없어요.',
    chat_err_handle: '메신저 아이디는 보낼 수 없어요.',
    chat_err_app: '메신저 앱 이름은 쓸 수 없어요.',
    chat_err_link: '링크는 보낼 수 없어요.',
    chat_err_contact: '연락처는 보낼 수 없어요.',
    chat_stopped: '메시지가 차단됐어요. 연락처는 절대 보낼 수 없어요.',
    chat_err_word: '욕설, 성적인 말, 돈 관련 말은 쓸 수 없어요.',
    chat_stopped_word: '메시지가 차단됐어요. 욕설, 성적인 말, 돈 관련 말은 쓸 수 없어요.',
    chat_no_translation: '아직 번역이 없어요',
    chat_new_messages: '새 메시지',
    chat_empty: '레벨 3이 열렸어요. {name}님에게 첫 메시지를 보내 보세요: {min}~{max}자.',
    chat_closed: '이 대화는 종료되었어요.',
    chat_phone_title: '채팅하려면 전화번호를 인증하세요',
    chat_phone_text: '레벨 3 채팅에는 인증된 전화번호가 필요해요. 다른 사람에게는 절대 보이지 않아요.',
    chat_verify_phone: '전화번호 인증',
    chat_reconnecting: '연결이 끊겼어요. 다시 연결하는 중…',
    chat_report_title: '메시지 신고',
    chat_report_why: '신고하는 이유를 골라 주세요.',
    chat_report_rude: '무례함',
    chat_report_scam: '사기 또는 돈 요구',
    chat_report_sexual: '성적인 내용',
    chat_report_underage: '미성년자',
    chat_report_photo: '사진 신고',
    chat_report_other: '기타',
    chat_reported: '신고했어요. 감사합니다.',
    chat_already_reported: '이미 신고한 메시지예요.',
    chat_reported_tag: '신고됨',
    chat_cancel: '취소',
    chat_photo_n: '{name}님의 사진 {n}',
    chat_photos_of: '{name}님의 사진 ({n}장)',
    chat_lang_aria: '번역 {pair}',
    chat_lang_note: '나는 {mine}, {name}님은 {theirs}로 써요. 번역은 저희가 해 드려요.',
    chat_lang_same: '나와 {name}님 모두 {mine}로 써요.',
    chat_lang_en: '영어',
    chat_lang_km: '크메르어',
    chat_lang_zh: '중국어',
    chat_lang_ko: '한국어',
    chat_lang_ja: '일본어',
  },
  ja: {
    chat_level3: 'レベル 3',
    chat_real_name: '本名',
    chat_text_only: 'テキストのみ。写真・音声・動画は送れません。',
    chat_today: '今日',
    chat_yesterday: '昨日',
    chat_placeholder: '{name}さんへメッセージ',
    chat_input_label: 'あなたのメッセージ',
    chat_send: '送信',
    chat_mic: '音声で入力',
    chat_mic_stop: '音声入力を止める',
    chat_mic_denied: 'マイクがオフになっています。ブラウザの設定で許可してください。',
    chat_mic_nothing: '何も聞こえませんでした。もう一度お試しください。',
    chat_mic_failed: '今は音声入力を使えません。',
    chat_range: '{min}–{max}',
    chat_hint: '{min}〜{max}文字。「はい」「OK」「やあ」「バイ」だけでは送れません。',
    chat_err_too_short: '{min}文字以上書いてください。',
    chat_err_too_long: '{max}文字以内にしてください。',
    chat_err_trivial: '「はい」「OK」「やあ」「バイ」より、もう少しだけ書いてください。',
    chat_err_phone: '電話番号は送れません。',
    chat_err_email: 'メールアドレスは送れません。',
    chat_err_handle: 'チャットのIDは送れません。',
    chat_err_app: 'チャットアプリの名前は書けません。',
    chat_err_link: 'リンクは送れません。',
    chat_err_contact: '連絡先は送れません。',
    chat_stopped: 'メッセージは停止されました。連絡先は一切送れません。',
    chat_err_word: '乱暴な言葉・性的な言葉・お金に関する言葉は使えません。',
    chat_stopped_word: 'メッセージは停止されました。乱暴な言葉・性的な言葉・お金に関する言葉は使えません。',
    chat_no_translation: '翻訳はまだありません',
    chat_new_messages: '新着メッセージ',
    chat_empty: 'レベル3が開きました。{name}さんへ最初のメッセージを：{min}〜{max}文字で。',
    chat_closed: 'この会話は終了しました。',
    chat_phone_title: 'チャットには電話番号の確認が必要です',
    chat_phone_text: 'レベル3のチャットには確認済みの電話番号が必要です。ほかの人に見えることはありません。',
    chat_verify_phone: '電話番号を確認',
    chat_reconnecting: '接続できません。再試行中…',
    chat_report_title: 'メッセージを報告',
    chat_report_why: '報告する理由を選んでください。',
    chat_report_rude: '失礼な内容',
    chat_report_scam: '詐欺・お金の話',
    chat_report_sexual: '性的な内容',
    chat_report_underage: '未成年',
    chat_report_photo: '写真を報告',
    chat_report_other: 'その他',
    chat_reported: '報告しました。ありがとうございます。',
    chat_already_reported: 'このメッセージはすでに報告済みです。',
    chat_reported_tag: '報告済み',
    chat_cancel: 'キャンセル',
    chat_photo_n: '{name}さんの写真 {n}',
    chat_photos_of: '{name}さんの写真（{n}枚）',
    chat_lang_aria: '翻訳 {pair}',
    chat_lang_note: 'あなたは{mine}、{name}さんは{theirs}で書きます。翻訳はおまかせください。',
    chat_lang_same: 'あなたと{name}さんはどちらも{mine}です。',
    chat_lang_en: '英語',
    chat_lang_km: 'クメール語',
    chat_lang_zh: '中国語',
    chat_lang_ko: '韓国語',
    chat_lang_ja: '日本語',
  },
});
