// Level 3 meetings (owner 2026-10-14, pointing at the chat composer: "add a small calendar icon to set an appointment;
// above it a Google-Maps-like location search to pick the place (e.g. Brown Coffee TK), then set the date and time, the
// other party accepts; the other party can see the location; clicking the location opens Google Maps").
//
// chat.js puts meetButton() next to the mic and draws every 'meet' message with meetRow(). The sheet searches places
// through our own server (GET /places → OpenStreetMap, the free search: no Google key, no Google script — the page CSP
// allows neither), or takes the typed name as it is. Date and time are native inputs read as Phnom Penh time (UTC+7)
// whatever the phone's clock says; the card shows them in Phnom Penh time again. The place itself is the link: Google
// Maps, outside the app (target=_blank). The rules both sides run: shared/meet.js; the server: src/lib/thirtyda-meet.mjs.
import {
  el, icon, t, api, toast, modal, state, registerStrings, errorText, SPEECH_LOCALE, findContactDetails, findBadWords,
} from '../core.js';
import {
  MEET_MAX_DAYS, PLACE_NAME_MAX, PLACE_QUERY_MIN, ppParts, ppDateValue, ppTimeValue, ppInstant, checkMeetTime, checkPlace,
  cleanLine, mapsUrl, meetStatusKey, meetChoices,
} from '../shared/meet.js';

const SEARCH_DELAY_MS = 450; // after the last key
const DAY_MS = 864e5;
const PP_ZONE = 'Asia/Phnom_Penh';

// ---------------------------------------------------------------- local styles (CSSOM: the CSP allows no inline <style>)

const RULES = [
  '.composer .meet-btn { flex: none; }',
  '.meet-card { display: flex; flex-direction: column; gap: 8px; width: min(300px, 88%); padding: 12px 14px; border: 1.5px solid var(--line); border-radius: var(--radius-lg); background: #fff; color: var(--ink); font-size: 14px; line-height: 1.4; }',
  '.meet-card.mine { border-color: var(--navy); }',
  '.meet-card.busy { opacity: 0.65; }',
  '.meet-head { display: flex; align-items: flex-start; gap: 8px; font-size: 14.5px; font-weight: 800; line-height: 1.3; }',
  '.meet-head > .icon { flex: none; margin-top: 1px; color: var(--navy); }',
  '.meet-tz { font-size: 12px; color: var(--muted); }',
  '.meet-card > .meet-tz { margin: -6px 0 0 26px; }',
  '.meet-place { display: flex; align-items: flex-start; gap: 8px; padding: 10px; border-radius: var(--radius); background: var(--bubble); color: var(--ink); text-decoration: none; }',
  '.meet-place:active { background: #e1e7f1; }',
  '.meet-place > .icon { flex: none; margin-top: 1px; color: var(--red); }',
  '.meet-place-text, .meet-result-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }',
  '.meet-place-name, .meet-result-name { font-weight: 700; overflow-wrap: anywhere; }',
  '.meet-place-addr, .meet-result-addr { font-size: 12.5px; color: var(--muted); overflow-wrap: anywhere; }',
  '.meet-maps { display: inline-flex; align-items: center; gap: 4px; margin-top: 2px; font-size: 12px; font-weight: 700; color: var(--navy); text-decoration: underline; text-underline-offset: 3px; }',
  '.meet-status { font-size: 12.5px; font-weight: 700; color: var(--muted); }',
  '.meet-status.ok { color: var(--green); }',
  '.meet-status.no { color: var(--red); }',
  '.meet-actions { display: flex; gap: 8px; }',
  '.meet-actions .btn { flex: 1 1 0; width: auto; min-width: 0; min-height: 40px; padding: 0 10px; font-size: 14px; }',
  '.meet-more { align-self: flex-start; font-size: 13px; }',
  '.meet-safety { display: flex; align-items: flex-start; gap: 6px; padding-top: 8px; border-top: 1px solid var(--line-soft); font-size: 11.5px; line-height: 1.4; color: var(--muted); }',
  '.meet-safety > .icon { flex: none; margin-top: 1px; }',
  // The sheet: tall, so the search box sits high and its suggestions stay above an on-screen keyboard.
  'dialog.meet-sheet { min-height: min(600px, calc(100dvh - 32px)); overflow-y: auto; overscroll-behavior: contain; }',
  '.meet-sheet .sheet-body { gap: 16px; }',
  '.meet-sub { font-size: 13.5px; color: var(--muted); }',
  '.meet-q-wrap { position: relative; }',
  '.meet-q-wrap > .icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--muted); pointer-events: none; }',
  '.meet-q-wrap > .input { padding-left: 38px; font-size: 16px; }', // under 16px iOS Safari zooms the page on focus
  '.meet-note { font-size: 12.5px; color: var(--muted); }',
  '.meet-note:empty { display: none; }',
  '.meet-results { display: flex; flex-direction: column; }',
  '.meet-result { display: flex; align-items: flex-start; gap: 10px; width: 100%; padding: 10px 4px; border-bottom: 1px solid var(--line-soft); text-align: left; }',
  '.meet-result:last-child { border-bottom: 0; }',
  '.meet-result > .icon { flex: none; margin-top: 2px; color: var(--navy); }',
  '.meet-result.typed .meet-result-name { font-weight: 600; }',
  '.meet-picked { display: flex; align-items: flex-start; gap: 10px; padding: 12px; border-radius: var(--radius); border: 1.5px solid var(--navy); }',
  '.meet-picked > .icon { flex: none; margin-top: 2px; color: var(--red); }',
  '.meet-picked > .link { flex: none; font-size: 13px; }',
  '.meet-when-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; }',
  '.meet-pick { display: flex; flex-direction: column; gap: 6px; min-width: 0; }',
  '.meet-pick > span { font-size: 12.5px; font-weight: 600; color: var(--muted); }',
  '.meet-pick > .input { min-width: 0; font-size: 16px; }',
  '.meet-pick > .input::-webkit-date-and-time-value { text-align: left; }',
  '.meet-sheet .field-error:empty { display: none; }',
];

let styled = false;
export function ensureMeetStyles() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(RULES.join('\n'));
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  } catch {
    const own = [...document.styleSheets].find((s) => String(s.href || '').endsWith('/30da/app.css'));
    for (const rule of own ? RULES : []) {
      try { own.insertRule(rule, own.cssRules.length); } catch { /* skip a rule this engine cannot parse */ }
    }
  }
}

// ---------------------------------------------------------------- icons (24×24 strokes, like core.js icon())

const PATHS = {
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><path d="M7.5 13.5h2M11 13.5h2M14.5 13.5h2M7.5 17h2M11 17h2"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
};

function ownIcon(name, size = 18) {
  const svg = icon('clock', size);
  svg.innerHTML = PATHS[name]; // constant markup, never user text
  svg.setAttribute('class', `icon icon-${name}`);
  return svg;
}

// ---------------------------------------------------------------- Phnom Penh time on the card

const KM_DAYS = ['អាទិត្យ', 'ច័ន្ទ', 'អង្គារ', 'ពុធ', 'ព្រហស្បតិ៍', 'សុក្រ', 'សៅរ៍'];
const KM_MONTHS = ['មករា', 'កុម្ភៈ', 'មីនា', 'មេសា', 'ឧសភា', 'មិថុនា', 'កក្កដា', 'សីហា', 'កញ្ញា', 'តុលា', 'វិច្ឆិកា', 'ធ្នូ'];
const EN_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n) => String(n).padStart(2, '0');

let intlKhmer = null;
function hasIntlKhmer() {
  if (intlKhmer == null) {
    try { intlKhmer = Intl.DateTimeFormat.supportedLocalesOf(['km']).length > 0; } catch { intlKhmer = false; }
  }
  return intlKhmer;
}

/** "Tue, 20 Oct, 6:30 PM" — the meeting in Phnom Penh time, in the app language (the year only when it is not this one). */
export function fmtMeetWhen(iso, lang = state.lang) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const p = ppParts(ms);
  const otherYear = p.year !== ppParts(Date.now()).year;
  if (!(lang === 'km' && !hasIntlKhmer())) {
    try {
      const opts = { timeZone: PP_ZONE, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' };
      if (otherYear) opts.year = 'numeric';
      return new Intl.DateTimeFormat(SPEECH_LOCALE[lang] || 'en-US', opts).format(new Date(ms));
    } catch { /* no time-zone data in this browser: written out below */ }
  }
  const year = otherYear ? ` ${p.year}` : '';
  if (lang === 'km') return `${KM_DAYS[p.weekday]} ${p.day} ${KM_MONTHS[p.month - 1]}${year} · ${pad2(p.hour)}:${pad2(p.minute)}`;
  return `${EN_DAYS[p.weekday]} ${p.day} ${EN_MONTHS[p.month - 1]}${year} · ${pad2(p.hour)}:${pad2(p.minute)}`;
}

// ---------------------------------------------------------------- the composer button

/**
 * The calendar button next to the mic. ctx (from chat.js): { base: '/pairs/P-1', name: their app name,
 * onMessages(list): merge into the chat, fmtTime(iso), closed(): true when the chat no longer takes anything }.
 */
export function meetButton(ctx) {
  ensureMeetStyles();
  return el('button', {
    type: 'button', class: 'round-btn outline meet-btn', 'aria-label': t('meet_button'), title: t('meet_button'),
    on: { click: () => openMeetSheet(ctx) },
  }, ownIcon('calendar', 18));
}

/** The error line for a refused meeting call, in the UI language. */
function meetErrorText(err) {
  switch (err?.code) {
    case 'contact_detail': return t('meet_err_contact');
    case 'bad_word': case 'word': return t('meet_err_word');
    case 'past': return t('meet_err_past');
    case 'too_far': return t('meet_err_far', { days: MEET_MAX_DAYS });
    case 'bad_time': return t('meet_err_time');
    case 'invalid': return err?.data?.field === 'at' ? t('meet_err_time') : t('meet_err_place');
    case 'rate_limited': return t('meet_err_many');
    case 'not_open': case 'not_yours': return t('meet_err_answered');
    case 'chat_closed': case 'other_blocked': return t('meet_closed');
    default: return errorText(err);
  }
}

// ---------------------------------------------------------------- the sheet: place, date and time, send

/** "Set a meeting" (or, with `prefill` { place, at } from a card, "Suggest another time"). */
export function openMeetSheet(ctx, prefill = null) {
  ensureMeetStyles();
  if (ctx.closed?.()) return;
  const now = Date.now();
  let chosen = prefill?.place?.name
    ? { name: prefill.place.name, address: prefill.place.address ?? null, lat: prefill.place.lat ?? null, lng: prefill.place.lng ?? null }
    : null;
  let seq = 0;
  let timer = null;
  let sending = false;
  let stoppedKey = null; // the place the server already stopped (not sent twice)
  let tried = false; // Send was tapped: say what is missing

  const query = el('input', {
    type: 'search', class: 'input fill', placeholder: t('meet_search_ph'), 'aria-label': t('meet_search_label'),
    autocomplete: 'off', autocapitalize: 'words', enterkeyhint: 'search', spellcheck: 'false', maxlength: PLACE_NAME_MAX, lang: state.lang,
  });
  const note = el('p', { class: 'meet-note', 'aria-live': 'polite' });
  const results = el('div', { class: 'meet-results' });
  const searchBox = el('div', { class: 'meet-search stack' }, el('div', { class: 'meet-q-wrap' }, icon('pin', 18), query), note, results);
  const picked = el('div', { class: 'meet-picked', hidden: true });
  const placeError = el('p', { class: 'field-error', role: 'alert' });
  const pickedKey = () => (chosen ? JSON.stringify([chosen.name, chosen.address]) : null);

  const date = el('input', {
    type: 'date', class: 'input fill', min: ppDateValue(now), max: ppDateValue(now + MEET_MAX_DAYS * DAY_MS),
    value: prefill?.at ? ppDateValue(Date.parse(prefill.at)) : '',
  });
  const time = el('input', { type: 'time', class: 'input fill', value: prefill?.at ? ppTimeValue(Date.parse(prefill.at)) : '' });
  const timeError = el('p', { class: 'field-error', role: 'alert' });
  const sendError = el('p', { class: 'field-error', role: 'alert' });
  const send = el('button', { type: 'button', class: 'btn btn-primary', on: { click: submit } },
    ownIcon('calendar', 18), el('span', { class: 'btn-text' }, t('meet_send')));

  const dlg = modal(el('div', { class: 'sheet-body' },
    el('h2', { class: 'sheet-title' }, t(prefill ? 'meet_title_other' : 'meet_title')),
    el('p', { class: 'meet-sub' }, t('meet_sub', { name: ctx.name })),
    el('div', { class: 'field' }, el('span', { class: 'label ink' }, t('meet_place')), searchBox, picked, placeError),
    el('div', { class: 'field' },
      el('span', { class: 'label ink' }, t('meet_when')),
      el('div', { class: 'meet-when-row' },
        el('label', { class: 'meet-pick' }, el('span', {}, t('meet_date')), date),
        el('label', { class: 'meet-pick' }, el('span', {}, t('meet_time')), time)),
      el('p', { class: 'meet-tz' }, t('meet_pp_note')),
      timeError),
    sendError,
    el('div', { class: 'dialog-actions' }, send,
      el('button', { type: 'button', class: 'btn btn-secondary', on: { click: () => dlg.close() } }, t('meet_close')))),
  { sheet: true, label: t(prefill ? 'meet_title_other' : 'meet_title'), className: 'meet-sheet' });
  dlg.node.addEventListener('close', () => { clearTimeout(timer); seq++; });

  // --- place: search as you type, pick a suggestion, or take the typed name as it is
  function placeButton(p, typed = false) {
    return el('button', { type: 'button', class: ['meet-result', typed ? 'typed' : ''], on: { click: () => choose(p) } },
      icon(typed ? 'plus' : 'pin', 16),
      el('span', { class: 'meet-result-text' },
        el('span', { class: 'meet-result-name' }, typed ? t('meet_use_typed', { text: p.name }) : p.name),
        typed ? el('span', { class: 'meet-result-addr' }, t('meet_use_typed_note'))
          : p.address ? el('span', { class: 'meet-result-addr' }, p.address) : null));
  }

  function typedPlace() {
    const name = cleanLine(query.value);
    return Array.from(name).length >= PLACE_QUERY_MIN ? { name, address: null, lat: null, lng: null } : null;
  }

  // The list changes only when an answer comes (the typed name included, at its end), never while a search runs: so
  // nothing moves under a finger that is about to tap.
  function show(list, { busy = false, unavailable = false, searching = false } = {}) {
    const typed = searching ? null : typedPlace();
    note.textContent = searching ? t('meet_searching') : busy ? t('meet_busy') : unavailable ? t('meet_unavailable')
      : typed && list && !list.length ? t('meet_none') : '';
    results.replaceChildren(...(searching ? [] : list || []).map((p) => placeButton(p)), typed && list ? placeButton(typed, true) : '');
  }

  async function search(q) {
    const mine = ++seq;
    let r;
    try {
      r = await api.get(`/places?q=${encodeURIComponent(q)}`);
    } catch (err) {
      r = { places: [], busy: err?.code === 'rate_limited', unavailable: err?.code !== 'rate_limited' };
    }
    if (mine !== seq || chosen) return;
    show(Array.isArray(r?.places) ? r.places : [], { busy: Boolean(r?.busy), unavailable: Boolean(r?.unavailable) });
  }

  query.addEventListener('input', () => {
    clearTimeout(timer);
    seq++;
    const q = cleanLine(query.value);
    if (Array.from(q).length < PLACE_QUERY_MIN) { show(null); return; }
    show(null, { searching: true });
    timer = setTimeout(() => search(q), SEARCH_DELAY_MS);
  });
  query.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    e.preventDefault(); // Enter searches now
    clearTimeout(timer);
    const q = cleanLine(query.value);
    if (Array.from(q).length >= PLACE_QUERY_MIN) search(q);
  });

  function choose(p) {
    chosen = { name: p.name, address: p.address ?? null, lat: p.lat ?? null, lng: p.lng ?? null };
    clearTimeout(timer);
    seq++;
    renderPlace();
    update();
  }

  function renderPlace() {
    searchBox.hidden = Boolean(chosen);
    picked.hidden = !chosen;
    if (!chosen) return;
    picked.replaceChildren(
      icon('pin', 18),
      el('span', { class: 'grow meet-place-text' },
        el('span', { class: 'meet-place-name' }, chosen.name),
        chosen.address ? el('span', { class: 'meet-place-addr' }, chosen.address) : null),
      el('button', {
        type: 'button', class: 'link', on: {
          click: () => {
            query.value = chosen?.name || query.value;
            chosen = null;
            renderPlace();
            show(null);
            update();
            query.focus();
          },
        },
      }, t('meet_change')));
  }

  // --- what may be sent now
  function verdict() {
    const place = chosen ? checkPlace(chosen) : { ok: false };
    let placeMsg = null;
    if (chosen) {
      const texts = [chosen.name, chosen.address].filter(Boolean);
      if (texts.some((x) => !findContactDetails(x).ok)) placeMsg = t('meet_err_contact');
      else if (texts.some((x) => !findBadWords(x).ok)) placeMsg = t('meet_err_word');
      else if (!place.ok) placeMsg = t('meet_err_place');
    } else if (tried) placeMsg = t('meet_err_place');
    const ms = ppInstant(date.value, time.value);
    const when = Number.isFinite(ms) ? checkMeetTime(new Date(ms).toISOString(), Date.now()) : { ok: false, error: 'bad_time' };
    let timeMsg = null;
    if (!when.ok && (tried || (date.value && time.value))) {
      timeMsg = when.error === 'past' ? t('meet_err_past') : when.error === 'too_far' ? t('meet_err_far', { days: MEET_MAX_DAYS }) : t('meet_err_time');
    }
    // A contact detail or a bad word still goes to the server once (it keeps the stopped try for the admin, like a chat
    // line); the same place is not sent twice.
    return { place, when, placeMsg, timeMsg, ready: place.ok && when.ok && pickedKey() !== stoppedKey };
  }

  function update() {
    const v = verdict();
    placeError.textContent = v.placeMsg || '';
    timeError.textContent = v.timeMsg || '';
    send.disabled = sending || pickedKey() === stoppedKey;
    return v;
  }

  date.addEventListener('change', update);
  date.addEventListener('input', update);
  time.addEventListener('change', update);
  time.addEventListener('input', update);

  async function submit() {
    if (sending) return;
    tried = true;
    sendError.textContent = '';
    const v = update();
    if (!v.ready) return;
    sending = true;
    send.classList.add('busy');
    send.disabled = true;
    const key = pickedKey();
    try {
      const res = await api.post(`${ctx.base}/meet`, { place: v.place.place, at: v.when.at });
      ctx.onMessages([res.message, ...(res.replaced || [])].filter(Boolean));
      dlg.close();
      toast(t('meet_sent', { name: ctx.name }));
    } catch (err) {
      if (err?.code === 'verify_needed' || err?.status === 401 || err?.code === 'blocked') return; // already handled
      if (['chat_closed', 'other_blocked', 'not_found', 'phone_needed'].includes(err?.code)) {
        dlg.close();
        toast(t('meet_closed'));
        ctx.onClosed?.(err);
        return;
      }
      if (err?.code === 'contact_detail' || err?.code === 'bad_word') {
        stoppedKey = key; // stopped and kept for the admin once; the same place is not sent again
        toast(t('meet_stopped'));
        placeError.textContent = meetErrorText(err);
      } else if (['past', 'too_far', 'bad_time'].includes(err?.code) || err?.data?.field === 'at') {
        timeError.textContent = meetErrorText(err);
      } else if (err?.code === 'invalid') {
        placeError.textContent = meetErrorText(err);
      } else {
        sendError.textContent = meetErrorText(err);
      }
    } finally {
      sending = false;
      send.classList.remove('busy');
      if (dlg.node.isConnected) send.disabled = pickedKey() === stoppedKey;
    }
  }

  renderPlace();
  show(null);
  update();
  if (!chosen) requestAnimationFrame(() => { try { query.focus({ preventScroll: true }); } catch { /* old engine */ } });
  return dlg;
}

// ---------------------------------------------------------------- the card in the chat

/**
 * A meeting in the chat, both sides, each in their own language: the calendar, "Meeting · <when>" (Phnom Penh time),
 * the place as the Google Maps link, the status, the other person's Accept · Decline · Suggest another time (the
 * proposer's Cancel), and the safety line. → the row chat.js keeps ({ row, bubble, time, tag, meta }) + update(m).
 */
export function meetRow(m, ctx) {
  ensureMeetStyles();
  let cur = m;
  let busy = false;
  const card = el('div', { class: ['meet-card', m.mine ? 'mine' : 'theirs'] });
  const time = el('time', { class: 'bubble-time', datetime: m.at }, ctx.fmtTime(m.at));
  const tag = el('span', { hidden: true });
  const meta = el('div', { class: 'chat-meta' }, time, tag);
  const row = el('div', { class: ['chat-msg', 'meet-msg', m.mine ? 'mine' : 'theirs'] }, card, meta);

  function statusText(key) {
    if (key === 'waiting_them') return t('meet_wait_them', { name: ctx.name });
    return t(`meet_${{ waiting_you: 'wait_you' }[key] || key}`);
  }

  async function act(action) {
    if (busy || ctx.closed?.()) return;
    busy = true;
    fill();
    try {
      const res = await api.post(`${ctx.base}/meet/${encodeURIComponent(cur.id)}`, { action });
      if (res?.message) ctx.onMessages([res.message]);
      toast(t(`meet_done_${action}`));
    } catch (err) {
      if (err?.data?.message) ctx.onMessages([err.data.message]);
      if (err?.code !== 'verify_needed' && err?.status !== 401 && err?.code !== 'blocked') toast(meetErrorText(err));
    } finally {
      busy = false;
      fill();
    }
  }

  function confirmCancel() {
    const dlg = modal(el('div', { class: 'dialog-body' },
      el('h2', { class: 'dialog-title' }, t('meet_cancel_title')),
      el('p', { class: 'conv-dialog-text' }, t('meet_cancel_text', { name: ctx.name })),
      el('div', { class: 'dialog-actions' },
        el('button', { type: 'button', class: 'btn btn-danger', on: { click: () => { dlg.close(); act('cancel'); } } }, t('meet_cancel_yes')),
        el('button', { type: 'button', class: 'btn btn-secondary', autofocus: true, on: { click: () => dlg.close() } }, t('meet_keep')))),
    { label: t('meet_cancel_title') });
  }

  function fill() {
    const x = cur.meet || {};
    const key = meetStatusKey(cur);
    const can = ctx.closed?.() ? {} : meetChoices(cur);
    const place = x.place || {};
    const nodes = [
      el('p', { class: 'meet-head' }, ownIcon('calendar', 18), el('span', {}, t('meet_card_title', { when: fmtMeetWhen(x.at) }))),
      el('p', { class: 'meet-tz' }, t('meet_pp_time')),
      el('a', {
        class: 'meet-place', href: x.mapsUrl || mapsUrl(place), target: '_blank', rel: 'noopener noreferrer',
        'aria-label': `${place.name || ''}${place.address ? `, ${place.address}` : ''}. ${t('meet_open_maps')}`,
      },
      icon('pin', 18),
      el('span', { class: 'meet-place-text' },
        el('span', { class: 'meet-place-name' }, place.name || ''),
        place.address ? el('span', { class: 'meet-place-addr' }, place.address) : null,
        el('span', { class: 'meet-maps' }, t('meet_open_maps'), ownIcon('external', 12)))),
      el('p', { class: ['meet-status', key === 'accepted' ? 'ok' : key === 'declined' ? 'no' : ''] }, statusText(key)),
    ];
    if (can.accept) {
      nodes.push(el('div', { class: 'meet-actions' },
        el('button', { type: 'button', class: 'btn btn-primary', disabled: busy, on: { click: () => act('accept') } }, t('meet_accept')),
        el('button', { type: 'button', class: 'btn btn-secondary', disabled: busy, on: { click: () => act('decline') } }, t('meet_decline'))));
    }
    if (can.suggest) {
      nodes.push(el('button', {
        type: 'button', class: 'link meet-more', disabled: busy, on: { click: () => openMeetSheet(ctx, { place, at: x.at }) },
      }, t('meet_suggest')));
    }
    if (can.cancel) {
      nodes.push(el('button', { type: 'button', class: 'link meet-more', disabled: busy, on: { click: confirmCancel } }, t('meet_cancel')));
    }
    nodes.push(el('p', { class: 'meet-safety' }, icon('shield', 13), el('span', {}, t('meet_safety'))));
    card.classList.toggle('busy', busy);
    card.replaceChildren(...nodes);
  }

  fill();
  return {
    row, bubble: card, time, tag, meta,
    update(next) {
      cur = next;
      fill();
    },
  };
}

/** true for a meeting message (GET /pairs/:id/messages carries them with the chat lines). */
export const isMeet = (m) => m?.kind === 'meet' && Boolean(m.meet);

/** When a meeting last changed (ms): a newer state replaces the card, an older one (a poll that crossed a tap) does not. */
export const meetChangedAt = (m) => Math.max(Date.parse(m?.at) || 0, Date.parse(m?.meet?.updatedAt) || 0);

// ---------------------------------------------------------------- strings

registerStrings({
  en: {
    meet_button: 'Set a meeting',
    meet_title: 'Set a meeting',
    meet_title_other: 'Suggest another time',
    meet_sub: 'Pick a place and a time. {name} can accept or decline.',
    meet_place: 'Place',
    meet_search_ph: 'Search a place, e.g. Brown Coffee',
    meet_search_label: 'Search a place',
    meet_searching: 'Searching…',
    meet_none: 'No places found. You can use what you typed.',
    meet_busy: 'Search is busy. Try again in a moment.',
    meet_unavailable: 'Search is not available right now. You can use what you typed.',
    meet_use_typed: 'Use “{text}”',
    meet_use_typed_note: 'No map pin: Google Maps searches the name.',
    meet_change: 'Change',
    meet_when: 'Date and time',
    meet_date: 'Date',
    meet_time: 'Time',
    meet_pp_note: 'Phnom Penh time',
    meet_send: 'Send',
    meet_close: 'Cancel',
    meet_sent: 'Sent to {name}.',
    meet_err_place: 'Pick a place.',
    meet_err_time: 'Pick a date and a time.',
    meet_err_past: 'Pick a time that is still to come.',
    meet_err_far: 'Pick a day within {days} days.',
    meet_err_contact: 'Contact details are not allowed in a place.',
    meet_err_word: 'Rude, sexual or money words are not allowed.',
    meet_stopped: 'Stopped. Contact details and rude words are never allowed.',
    meet_err_many: 'Too many meeting suggestions. Try again later.',
    meet_err_answered: 'This meeting was already answered.',
    meet_closed: 'This conversation is closed.',
    meet_card_title: 'Meeting · {when}',
    meet_pp_time: '(Phnom Penh time)',
    meet_open_maps: 'Open in Google Maps',
    meet_wait_them: 'Waiting for {name}',
    meet_wait_you: 'Waiting for your answer',
    meet_accepted: 'Accepted ✓',
    meet_declined: 'Declined',
    meet_cancelled: 'Cancelled',
    meet_replaced: 'Replaced by a new suggestion',
    meet_passed: 'This time has passed',
    meet_accept: 'Accept',
    meet_decline: 'Decline',
    meet_suggest: 'Suggest another time',
    meet_cancel: 'Cancel meeting',
    meet_cancel_title: 'Cancel this meeting?',
    meet_cancel_text: '{name} will see that it is cancelled.',
    meet_cancel_yes: 'Yes, cancel it',
    meet_keep: 'Keep it',
    meet_done_accept: 'Accepted. Have a good meeting!',
    meet_done_decline: 'Declined.',
    meet_done_cancel: 'Meeting cancelled.',
    meet_safety: 'Meet in a public place. Tell a friend where you go.',
  },
  km: {
    meet_button: 'កំណត់ការជួប',
    meet_title: 'កំណត់ការជួប',
    meet_title_other: 'ស្នើពេលវេលាផ្សេង',
    meet_sub: 'ជ្រើសរើសទីកន្លែង និងពេលវេលា។ {name} អាចយល់ព្រម ឬបដិសេធ។',
    meet_place: 'ទីកន្លែង',
    meet_search_ph: 'ស្វែងរកទីកន្លែង ឧ. Brown Coffee',
    meet_search_label: 'ស្វែងរកទីកន្លែង',
    meet_searching: 'កំពុងស្វែងរក…',
    meet_none: 'រកមិនឃើញទីកន្លែងទេ។ អ្នកអាចប្រើអ្វីដែលអ្នកបានវាយ។',
    meet_busy: 'ការស្វែងរកកំពុងរវល់។ សូមព្យាយាមម្ដងទៀតបន្តិចទៀត។',
    meet_unavailable: 'ការស្វែងរកមិនអាចប្រើបានឥឡូវនេះទេ។ អ្នកអាចប្រើអ្វីដែលអ្នកបានវាយ។',
    meet_use_typed: 'ប្រើ “{text}”',
    meet_use_typed_note: 'គ្មានចំណុចលើផែនទីទេ៖ Google Maps នឹងស្វែងរកតាមឈ្មោះ។',
    meet_change: 'ប្ដូរ',
    meet_when: 'កាលបរិច្ឆេទ និងម៉ោង',
    meet_date: 'កាលបរិច្ឆេទ',
    meet_time: 'ម៉ោង',
    meet_pp_note: 'ម៉ោងភ្នំពេញ',
    meet_send: 'ផ្ញើ',
    meet_close: 'បោះបង់',
    meet_sent: 'បានផ្ញើទៅ {name} ហើយ។',
    meet_err_place: 'សូមជ្រើសរើសទីកន្លែង។',
    meet_err_time: 'សូមជ្រើសរើសកាលបរិច្ឆេទ និងម៉ោង។',
    meet_err_past: 'សូមជ្រើសរើសពេលវេលាដែលមិនទាន់កន្លងផុត។',
    meet_err_far: 'សូមជ្រើសរើសថ្ងៃក្នុងរយៈពេល {days} ថ្ងៃ។',
    meet_err_contact: 'មិនអនុញ្ញាតឲ្យដាក់ព័ត៌មានទំនាក់ទំនងក្នុងទីកន្លែងទេ។',
    meet_err_word: 'មិនអនុញ្ញាតឲ្យប្រើពាក្យអសុរស ពាក្យផ្លូវភេទ ឬពាក្យទាក់ទងនឹងលុយទេ។',
    meet_stopped: 'ត្រូវបានបញ្ឈប់។ ព័ត៌មានទំនាក់ទំនង និងពាក្យអសុរស មិនត្រូវបានអនុញ្ញាតឡើយ។',
    meet_err_many: 'អ្នកបានស្នើការជួបច្រើនពេក។ សូមព្យាយាមម្ដងទៀតនៅពេលក្រោយ។',
    meet_err_answered: 'ការជួបនេះត្រូវបានឆ្លើយរួចហើយ។',
    meet_closed: 'ការសន្ទនានេះត្រូវបានបិទ។',
    meet_card_title: 'ការជួប · {when}',
    meet_pp_time: '(ម៉ោងភ្នំពេញ)',
    meet_open_maps: 'បើកក្នុង Google Maps',
    meet_wait_them: 'កំពុងរង់ចាំ {name}',
    meet_wait_you: 'កំពុងរង់ចាំចម្លើយរបស់អ្នក',
    meet_accepted: 'បានយល់ព្រម ✓',
    meet_declined: 'បានបដិសេធ',
    meet_cancelled: 'បានលុបចោល',
    meet_replaced: 'ត្រូវបានជំនួសដោយសំណើថ្មី',
    meet_passed: 'ពេលវេលានេះបានកន្លងផុតហើយ',
    meet_accept: 'យល់ព្រម',
    meet_decline: 'បដិសេធ',
    meet_suggest: 'ស្នើពេលវេលាផ្សេង',
    meet_cancel: 'លុបចោលការជួប',
    meet_cancel_title: 'លុបចោលការជួបនេះ?',
    meet_cancel_text: '{name} នឹងឃើញថាការជួបនេះត្រូវបានលុបចោល។',
    meet_cancel_yes: 'បាទ/ចាស លុបចោល',
    meet_keep: 'រក្សាទុក',
    meet_done_accept: 'បានយល់ព្រមហើយ។ សូមឲ្យការជួបបានល្អ!',
    meet_done_decline: 'បានបដិសេធហើយ។',
    meet_done_cancel: 'ការជួបត្រូវបានលុបចោល។',
    meet_safety: 'សូមជួបគ្នានៅទីសាធារណៈ។ ប្រាប់មិត្តភក្តិថាអ្នកទៅណា។',
  },
  zh: {
    meet_button: '约见面',
    meet_title: '约见面',
    meet_title_other: '换个时间',
    meet_sub: '选好地点和时间。{name} 可以接受或拒绝。',
    meet_place: '地点',
    meet_search_ph: '搜索地点，例如 Brown Coffee',
    meet_search_label: '搜索地点',
    meet_searching: '正在搜索…',
    meet_none: '没有找到地点。你可以直接使用输入的内容。',
    meet_busy: '搜索繁忙，请稍后再试。',
    meet_unavailable: '搜索暂时不可用。你可以直接使用输入的内容。',
    meet_use_typed: '使用“{text}”',
    meet_use_typed_note: '没有地图定位：Google 地图会按名称搜索。',
    meet_change: '更改',
    meet_when: '日期和时间',
    meet_date: '日期',
    meet_time: '时间',
    meet_pp_note: '金边时间',
    meet_send: '发送',
    meet_close: '取消',
    meet_sent: '已发送给 {name}。',
    meet_err_place: '请选择地点。',
    meet_err_time: '请选择日期和时间。',
    meet_err_past: '请选择一个还没到的时间。',
    meet_err_far: '请选择 {days} 天以内的日期。',
    meet_err_contact: '地点中不能包含联系方式。',
    meet_err_word: '不能使用粗俗、色情或涉及金钱的词语。',
    meet_stopped: '已被拦截。不允许联系方式和粗俗词语。',
    meet_err_many: '见面邀请发得太多了，请稍后再试。',
    meet_err_answered: '这次见面已经有回复了。',
    meet_closed: '此对话已关闭。',
    meet_card_title: '见面 · {when}',
    meet_pp_time: '（金边时间）',
    meet_open_maps: '在 Google 地图中打开',
    meet_wait_them: '等待 {name} 回复',
    meet_wait_you: '等待你的回复',
    meet_accepted: '已接受 ✓',
    meet_declined: '已拒绝',
    meet_cancelled: '已取消',
    meet_replaced: '已被新的提议取代',
    meet_passed: '这个时间已经过了',
    meet_accept: '接受',
    meet_decline: '拒绝',
    meet_suggest: '换个时间',
    meet_cancel: '取消见面',
    meet_cancel_title: '取消这次见面？',
    meet_cancel_text: '{name} 会看到见面已取消。',
    meet_cancel_yes: '是的，取消',
    meet_keep: '保留',
    meet_done_accept: '已接受。祝见面愉快！',
    meet_done_decline: '已拒绝。',
    meet_done_cancel: '见面已取消。',
    meet_safety: '请在公共场所见面，并告诉朋友你去哪里。',
  },
  ko: {
    meet_button: '만남 약속 잡기',
    meet_title: '만남 약속 잡기',
    meet_title_other: '다른 시간 제안',
    meet_sub: '장소와 시간을 골라 주세요. {name}님이 수락하거나 거절할 수 있어요.',
    meet_place: '장소',
    meet_search_ph: '장소 검색 (예: Brown Coffee)',
    meet_search_label: '장소 검색',
    meet_searching: '검색 중…',
    meet_none: '장소를 찾지 못했어요. 입력한 그대로 쓸 수 있어요.',
    meet_busy: '검색이 많아요. 잠시 후 다시 해 보세요.',
    meet_unavailable: '지금은 검색을 쓸 수 없어요. 입력한 그대로 쓸 수 있어요.',
    meet_use_typed: '“{text}” 사용',
    meet_use_typed_note: '지도 위치 없음: Google 지도가 이름으로 찾아요.',
    meet_change: '변경',
    meet_when: '날짜와 시간',
    meet_date: '날짜',
    meet_time: '시간',
    meet_pp_note: '프놈펜 시간',
    meet_send: '보내기',
    meet_close: '취소',
    meet_sent: '{name}님에게 보냈어요.',
    meet_err_place: '장소를 골라 주세요.',
    meet_err_time: '날짜와 시간을 골라 주세요.',
    meet_err_past: '아직 지나지 않은 시간을 골라 주세요.',
    meet_err_far: '{days}일 이내의 날짜를 골라 주세요.',
    meet_err_contact: '장소에 연락처를 넣을 수 없어요.',
    meet_err_word: '욕설, 성적인 말, 돈 관련 말은 쓸 수 없어요.',
    meet_stopped: '차단됐어요. 연락처와 욕설은 절대 쓸 수 없어요.',
    meet_err_many: '만남 제안을 너무 많이 보냈어요. 나중에 다시 해 보세요.',
    meet_err_answered: '이미 답한 만남이에요.',
    meet_closed: '이 대화는 종료되었어요.',
    meet_card_title: '만남 · {when}',
    meet_pp_time: '(프놈펜 시간)',
    meet_open_maps: 'Google 지도에서 열기',
    meet_wait_them: '{name}님의 답을 기다리는 중',
    meet_wait_you: '내 답을 기다리는 중',
    meet_accepted: '수락됨 ✓',
    meet_declined: '거절됨',
    meet_cancelled: '취소됨',
    meet_replaced: '새 제안으로 바뀌었어요',
    meet_passed: '이 시간은 지났어요',
    meet_accept: '수락',
    meet_decline: '거절',
    meet_suggest: '다른 시간 제안',
    meet_cancel: '만남 취소',
    meet_cancel_title: '이 만남을 취소할까요?',
    meet_cancel_text: '{name}님에게 취소되었다고 보여요.',
    meet_cancel_yes: '네, 취소할게요',
    meet_keep: '그대로 두기',
    meet_done_accept: '수락했어요. 즐거운 만남 되세요!',
    meet_done_decline: '거절했어요.',
    meet_done_cancel: '만남을 취소했어요.',
    meet_safety: '공공장소에서 만나고, 어디 가는지 친구에게 알려 주세요.',
  },
  ja: {
    meet_button: '会う約束をする',
    meet_title: '会う約束をする',
    meet_title_other: '別の日時を提案',
    meet_sub: '場所と日時を選んでください。{name}さんは承諾または辞退できます。',
    meet_place: '場所',
    meet_search_ph: '場所を検索（例：Brown Coffee）',
    meet_search_label: '場所を検索',
    meet_searching: '検索中…',
    meet_none: '場所が見つかりません。入力したままでも使えます。',
    meet_busy: '検索が混み合っています。少ししてからもう一度お試しください。',
    meet_unavailable: '今は検索を使えません。入力したままでも使えます。',
    meet_use_typed: '「{text}」を使う',
    meet_use_typed_note: '地図のピンなし：Google マップが名前で検索します。',
    meet_change: '変更',
    meet_when: '日付と時間',
    meet_date: '日付',
    meet_time: '時間',
    meet_pp_note: 'プノンペン時間',
    meet_send: '送信',
    meet_close: 'キャンセル',
    meet_sent: '{name}さんに送りました。',
    meet_err_place: '場所を選んでください。',
    meet_err_time: '日付と時間を選んでください。',
    meet_err_past: 'これからの時間を選んでください。',
    meet_err_far: '{days}日以内の日付を選んでください。',
    meet_err_contact: '場所に連絡先は入れられません。',
    meet_err_word: '乱暴な言葉・性的な言葉・お金に関する言葉は使えません。',
    meet_stopped: '停止されました。連絡先や乱暴な言葉は使えません。',
    meet_err_many: '会う約束の提案が多すぎます。しばらくしてからお試しください。',
    meet_err_answered: 'この約束にはすでに返事があります。',
    meet_closed: 'この会話は終了しました。',
    meet_card_title: '待ち合わせ · {when}',
    meet_pp_time: '（プノンペン時間）',
    meet_open_maps: 'Google マップで開く',
    meet_wait_them: '{name}さんの返事待ち',
    meet_wait_you: 'あなたの返事待ち',
    meet_accepted: '承諾済み ✓',
    meet_declined: '辞退',
    meet_cancelled: 'キャンセル済み',
    meet_replaced: '新しい提案に置き換えられました',
    meet_passed: 'この日時は過ぎました',
    meet_accept: '承諾する',
    meet_decline: '辞退する',
    meet_suggest: '別の日時を提案',
    meet_cancel: '約束をキャンセル',
    meet_cancel_title: 'この約束をキャンセルしますか？',
    meet_cancel_text: '{name}さんにキャンセルしたことが表示されます。',
    meet_cancel_yes: 'はい、キャンセルする',
    meet_keep: 'そのままにする',
    meet_done_accept: '承諾しました。楽しい時間を！',
    meet_done_decline: '辞退しました。',
    meet_done_cancel: '約束をキャンセルしました。',
    meet_safety: '人の多い場所で会いましょう。行き先を友だちに伝えてください。',
  },
});
