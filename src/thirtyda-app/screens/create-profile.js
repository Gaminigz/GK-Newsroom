// Screen 2 · Create profile — face photo, app name (shown, max 7 characters) + birth year (ages 30+ only)
// on one row, real name (not shown), I am, You are, and a phone (or Google / Facebook / TikTok) to verify — which is
// only needed to chat (owner 2026-10-13): Next works once the fields are filled. Then location, then Nearby.
import {
  screen, el, icon, t, go, api, toast, modal, state, setLang, setMe, registerStrings,
  resizeImage, updateLocation, roleLabel, LANGS, LANG_CODES, LANG_NATIVE, LANG_FLAG, ROLES, charCount,
  PHOTO_SLOT_LEVELS, NAME_MAX, NAME_RAW_MAX, checkAppName, clipChars, birthYearOptions, checkBirthYear,
} from '../core.js';
// The PIN chosen right after the language waits in this tab; it goes with the sign-in / the new profile (lock.js).
import { waitingPin, clearPinFlags, pinResetPending, leaveWithoutLock, backFromSheet } from '../lock.js';
import { takeAfterCreate } from '../guest.js';
// In the 30+DA app a sign-in runs in the app's own sheet (Google refuses web views): shell.js.
import { shellAuth, shellSignIn, onAppReturn } from '../shell.js';

// ---------------------------------------------------------------- app name + birth year (also used on #/me)

/** 'length' | 'contact' | null for a typed app name (empty → null: nothing to complain about yet). */
export function appNameProblem(value) {
  const c = checkAppName(value);
  if (c.ok || c.error === 'empty') return null;
  return c.error === 'contact' ? 'contact' : 'length';
}

// What each app-name box held, and where its cursor was, just before the edit in progress; and where a
// character was just refused (its marks, typed next, are refused with it).
const nameBefore = new WeakMap();
const nameHeld = new WeakMap();
const snapName = (input) => nameBefore.set(input, {
  value: input.value, start: input.selectionStart ?? input.value.length, end: input.selectionEnd ?? input.value.length,
});

/**
 * Wire an app-name box (once): remember its value and cursor before every edit, so clipNameInput can refuse
 * what does not fit the way maxlength does. While an IME composes, the state from before it started is kept.
 */
export function watchNameInput(input) {
  input.addEventListener('beforeinput', (e) => { if (!e.isComposing && !/Composition/.test(e.inputType)) snapName(input); });
  input.addEventListener('compositionstart', () => snapName(input));
  return input;
}

/**
 * Keep an app-name box at NAME_MAX characters as the server counts them (a Khmer cluster is one), like
 * maxlength: an edit that would pass the limit keeps only as much of the new text as fits (a keystroke:
 * none, so the name and the cursor stay as they were). The marks typed right after a refused character
 * go with it (the 8th Khmer stack typed key by key must not hang its coeng and vowel on the 7th). A name
 * with no record of the edit (a name saved before the rule) keeps its first NAME_MAX characters.
 * Never while an IME is composing.
 */
export function clipNameInput(input, e) {
  if (e?.isComposing) return;
  const value = input.value;
  const snap = nameBefore.get(input);
  if (!snap) {
    if (charCount(value) > NAME_MAX) input.value = clipChars(value, NAME_MAX);
    return;
  }
  const held = nameHeld.get(input);
  nameBefore.delete(input);
  nameHeld.delete(input);
  const head = snap.value.slice(0, snap.start);
  const tail = snap.value.slice(snap.end);
  const known = charCount(snap.value) <= NAME_MAX && value.length >= head.length + tail.length
    && value.startsWith(head) && value.endsWith(tail);
  const refuse = () => {
    input.value = snap.value;
    input.setSelectionRange(snap.start, snap.end);
    if (snap.start === snap.end) nameHeld.set(input, { value: snap.value, at: snap.start });
  };
  if (known && held && held.value === snap.value && held.at === snap.start && snap.start === snap.end
    && value.length > snap.value.length) return refuse();
  if (charCount(value) <= NAME_MAX) return;
  if (!known) {
    input.value = clipChars(value, NAME_MAX);
    return;
  }
  const added = [...value.slice(head.length, value.length - tail.length)];
  let k = added.length;
  while (k > 0 && charCount(head + added.slice(0, k).join('') + tail) > NAME_MAX) k--;
  if (!k) return refuse();
  const kept = head + added.slice(0, k).join('');
  input.value = kept + tail;
  input.setSelectionRange(kept.length, kept.length);
}

/** Birth year dropdown: only this year − 30 down to this year − 80 (30+DA is for people aged 30 and over). */
export function birthYearSelect({ id, value = '', onChange } = {}) {
  const sel = el('select', {
    class: ['select', 'year-select', 'truth-field', !value && 'placeholder'], id,
    on: { change: () => { sel.classList.toggle('placeholder', !sel.value); onChange?.(sel.value); } },
  },
  el('option', { value: '', disabled: true, selected: !value }, t('cp_year_ph')),
  birthYearOptions().map((y) => el('option', { value: String(y), selected: String(y) === String(value) }, String(y))));
  return sel;
}

/** "Tell the truth — at the end we will know." */
export const truthNote = () => el('p', { class: 'truth-note' }, icon('alert', 16), el('span', {}, t('cp_truth')));

const COUNTRY_CODES = [
  '+855', '+66', '+84', '+856', '+95', '+60', '+65', '+63', '+62', '+86', '+852', '+886', '+82', '+81',
  '+91', '+61', '+64', '+1', '+44', '+33', '+49',
];

// ---------------------------------------------------------------- photo slots

/**
 * Photos 2–4 on Create profile: small round "+" tiles that can be filled right away (all 4 slots can be
 * uploaded at any level, Gamini 2026-10-13); who SEES a photo still goes by its slot (2 → Level 2, 3–4 →
 * Level 3), so each tile says when it shows. They are held in the page and go up right after the profile is
 * made, each into its own slot. photos = [slot 2, slot 3, slot 4] (data URL or null); busy = the 0-based slot
 * being read; onPick(slot) / onRemove(slot) with the 0-based slot (1–3).
 */
function moreSlots(photos, { busy = -1, onPick, onRemove }) {
  return el('ul', { class: 'slot-minis' }, PHOTO_SLOT_LEVELS.slice(1).map((level, k) => {
    const slot = k + 1;
    const photo = photos[k];
    const vars = { slot: slot + 1, n: level };
    return el('li', { class: 'slot-mini' },
      el('span', { class: 'slot-mini-box' },
        el('button', {
          type: 'button', class: ['slot-mini-dot', photo && 'has-photo', busy === slot && 'busy'], 'data-slot': String(slot),
          'aria-label': t(photo ? 'cp_slot_change' : 'cp_slot_add', vars), on: { click: () => onPick(slot) },
        }, photo ? el('img', { src: photo, alt: '' }) : icon('plus', 18)),
        photo ? el('button', {
          type: 'button', class: 'slot-mini-x', 'aria-label': t('cp_slot_remove', vars), on: { click: () => onRemove(slot) },
        }, icon('close', 11)) : null),
      el('span', { class: 'slot-mini-tag', 'aria-hidden': 'true' }, t('cp_slot_shows', vars)));
  }));
}

// Photo examples under the photos: one good (a clear face), 2 bad for men (sunglasses, cap / hat) and 2 for
// women (side face, group photo). Drawn here as flat shapes in the app's palette — no photos of real people.
// Constant markup (never user text), 64×64 art shown through a 56×56 window.
const EXC = { ink: '#0b1c3f', face: '#efd8c3', neck: '#dcbfa6', bg: '#e9eef6', cap: '#5b6478', brim: '#3d475c' };
const exNeck = `<path fill="${EXC.neck}" d="M28 36h8v12h-8z"/>`;
const exBody = (top) => `<path fill="${top}" d="M9 64c0-11.5 9.6-17.6 23-17.6S55 52.5 55 64Z"/>`;
const exHead = `<ellipse cx="32" cy="28" rx="11" ry="13" fill="${EXC.face}"/>`;
const exEyes = `<circle cx="27.8" cy="29" r="1.4" fill="${EXC.ink}"/><circle cx="36.2" cy="29" r="1.4" fill="${EXC.ink}"/>`;
const exSmile = `<path d="M28.6 34.4q3.4 2.6 6.8 0" fill="none" stroke="${EXC.ink}" stroke-width="1.4" stroke-linecap="round"/>`;
// [behind the head, over the head]
const EX_HAIR = {
  man: ['', `<path fill="${EXC.ink}" d="M21.2 26.4c-1.4-9.2 4-14.6 10.8-14.6 7 0 12.2 5 10.8 14.6-.8-3.2-2.2-5.4-4.4-6.4-3.6 1.6-9.4 1.8-13.2-.6-2 1.4-3.4 3.8-4 7Z"/>`],
  woman: [`<path fill="${EXC.ink}" d="M19.6 29c-.9-11.2 5-17.2 12.4-17.2S45.3 17.8 44.4 29l1.8 17c-3.4 2-7.4 1.8-10-.6h-8.4c-2.6 2.4-6.6 2.6-10 .6Z"/>`,
    `<path fill="${EXC.ink}" d="M20.9 27c.4-8 4.8-11.6 11.1-11.6S42.7 19 43.1 27c-3.4-4.4-8.4-6.6-14.8-4.8-3 .9-5.4 2.4-7.4 4.8Z"/>`],
  neutral: [`<path fill="${EXC.ink}" d="M20 31.5c-1.4-12.4 4.6-18.6 12-18.6s13.4 6.2 12 18.6l-.4 5.6c-1.6.8-2.8.2-2.8-1.4V27c-2.4-4.6-5.6-6.6-8.8-6.6s-6.4 2-8.8 6.6v8.7c0 1.6-1.2 2.2-2.8 1.4Z"/>`, ''],
};
/** One person facing the camera; `extra` is drawn over the face (glasses, a cap). */
function exFront(hair, top, { eyes = true, hairFront = true, extra = '' } = {}) {
  const [back, front] = EX_HAIR[hair];
  return back + exNeck + exBody(top) + exHead + (eyes ? exEyes : '') + exSmile + (hairFront ? front : '') + extra;
}
const EX_ART = {
  clear: exFront('neutral', '#13285a'),
  clear_man: exFront('man', '#13285a'),
  clear_woman: exFront('woman', '#5b6478'),
  sunglasses: exFront('man', '#13285a', {
    eyes: false,
    extra: `<path d="M21 27.4l1.8-.6M43 27.4l-1.8-.6M31 27.6h2" stroke="${EXC.ink}" stroke-width="1.4" stroke-linecap="round"/>`
      + `<rect x="22.4" y="25.2" width="8.8" height="6.6" rx="2.8" fill="${EXC.ink}"/><rect x="32.8" y="25.2" width="8.8" height="6.6" rx="2.8" fill="${EXC.ink}"/>`
      + '<path d="M24.6 27.4l2.4-1M35 27.4l2.4-1" stroke="#fff" stroke-opacity=".55" stroke-width="1.1" stroke-linecap="round"/>',
  }),
  cap: exFront('man', '#13285a', {
    hairFront: false,
    extra: `<path fill="${EXC.ink}" fill-opacity=".2" d="M21 28.4h22l-.9 4.8H21.9Z"/>`
      + `<path fill="${EXC.cap}" d="M20.6 26c-.4-9.6 4.6-14.8 11.4-14.8S43.8 16.4 43.4 26Z"/>`
      + `<path d="M32 11.6V25M26.4 13.4c-1.6 3.6-2 7.6-1.8 12.2M37.6 13.4c1.6 3.6 2 7.6 1.8 12.2" fill="none" stroke="${EXC.brim}" stroke-width=".9" stroke-opacity=".7"/>`
      + `<circle cx="32" cy="11.6" r="1.5" fill="${EXC.brim}"/>`
      + `<path fill="${EXC.brim}" d="M18.6 26.4C23 24 41 24 45.4 26.4c1 2.6-.4 4.4-3.2 4.2-6.4-1.8-14-1.8-20.4 0-2.8.2-4.2-1.6-3.2-4.2Z"/>`,
  }),
  side: `<path fill="${EXC.neck}" d="M27 35h8.4l1 13h-9.4z"/>${exBody('#5b6478')}`
    + `<ellipse cx="33" cy="27.6" rx="10.4" ry="12.8" fill="${EXC.face}"/>`
    + `<path fill="${EXC.face}" d="M42.4 24.4 46.2 31c.5 1-.1 1.8-1.2 1.8h-2.8Z"/>`
    + `<circle cx="39.4" cy="28" r="1.4" fill="${EXC.ink}"/>`
    + `<path d="M39.4 35.4h3" stroke="${EXC.ink}" stroke-width="1.4" stroke-linecap="round"/>`
    + `<path fill="${EXC.ink}" d="M22.4 30.4c-1.6-11.6 4.4-17.6 11.4-17.6 6 0 10.2 3.6 10.4 9.2-3.8-2.8-8-3-11-.8-2.6 1.8-3.4 5.2-3.2 9.4.2 5.4 1.2 10.4.4 15.4-3.6 1.6-8 1.2-11.4-.8 2.6-4.6 4.2-9.2 3.4-14.8Z"/>`,
  group: [[-6.4, 25.4, 0.6, '#8a92a3'], [32.2, 25.4, 0.6, '#5b6478'], [10.9, 21.8, 0.66, '#13285a']]
    .map(([x, y, s, top]) => `<g transform="translate(${x} ${y}) scale(${s})">${exFront('woman', top)}</g>`).join(''),
};
const EX_BADGE = {
  good: '<circle cx="12" cy="12" r="10" fill="#1e9e57"/><path d="M7.2 12.4l3.2 3.2 6.4-6.6" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  bad: '<circle cx="12" cy="12" r="8.6" fill="#fff" stroke="#d92d20" stroke-width="2.8"/><path d="M6.2 17.8 17.8 6.2" stroke="#d92d20" stroke-width="2.8"/>',
};
function exSvg(markup, viewBox, cls) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [k, v] of Object.entries({ viewBox, 'aria-hidden': 'true', focusable: 'false', class: cls })) svg.setAttribute(k, v);
  svg.innerHTML = markup;
  return svg;
}
/** [art, caption key, good] for the gender picked so far: Male → the men's set, Female → the women's, else both. */
function exampleSet(gender) {
  const men = [['sunglasses', 'cp_ex_sunglasses'], ['cap', 'cp_ex_cap']];
  const women = [['side', 'cp_ex_side'], ['group', 'cp_ex_group']];
  if (gender === 'man') return [['clear_man', 'cp_ex_clear', true], ...men];
  if (gender === 'woman') return [['clear_woman', 'cp_ex_clear', true], ...women];
  return [['clear', 'cp_ex_clear', true], ...men, ...women];
}
/** The row of small examples under the photos: a green ✓ on the good one, a red circle-slash on the bad ones. */
function photoExamples(gender) {
  return el('ul', { class: 'photo-examples', 'aria-label': t('cp_ex_label'), 'data-set': gender === 'man' || gender === 'woman' ? gender : 'both' },
    exampleSet(gender).map(([art, cap, good]) => el('li', { class: ['ex', good ? 'ex-good' : 'ex-bad'], 'data-ex': art },
      el('span', { class: 'ex-pic' }, exSvg(`<rect width="64" height="64" fill="${EXC.bg}"/>${EX_ART[art]}`, '4 8 56 56', 'ex-art')),
      exSvg(EX_BADGE[good ? 'good' : 'bad'], '0 0 24 24', 'ex-badge'),
      el('span', { class: 'ex-cap', 'aria-hidden': 'true' }, t(cap)),
      el('span', { class: 'visually-hidden' }, t(good ? 'cp_ex_good' : 'cp_ex_bad', { what: t(cap) })))));
}

// ---------------------------------------------------------------- phone verifier (also used on #/me)

export const blankPhone = () => ({
  cc: '+855', phone: '', codeSent: false, code: '', devCode: null, resendAt: 0, sentTo: null, verified: false, verifiedPhone: null,
  // Where the code goes: the person picks (Telegram first). sentBy/live describe the last code sent.
  channel: 'telegram', sentBy: null, live: false, failed: [],
  // verifiedPhone: the number this session / profile proved; verified: the box still shows it (editing it away
  // drops the ✓ for this screen); verifiedBy: the app that proved it (its round button gets the ✓ and "Verified").
  verifiedBy: null,
});

// Which app proved the number comes from the server (MeView / the pending session: phoneVia, owner 2026-10-13):
// 'telegram' | 'whatsapp' get the ✓ on their round button; anything else (sms, not known) → no app ✓.
const viaApp = (via) => (['telegram', 'whatsapp'].includes(via) ? via : null);
const digitsOf = (p) => String(p ?? '').replace(/\D/g, '');

/**
 * A phone model showing a proved number (owner 2026-10-13): the box keeps the number, editable; the app that proved
 * it (`via`, the server's phoneVia) shows a ✓. `phone` is E.164 (+85512345678); the country code goes in the picker
 * when it is one of ours.
 */
export function verifiedPhoneModel(phone, model = blankPhone(), via = null) {
  const p = String(phone || '');
  const cc = COUNTRY_CODES.filter((c) => p.startsWith(c)).sort((a, b) => b.length - a.length)[0];
  return Object.assign(model, {
    cc: cc || model.cc, phone: cc ? p.slice(cc.length) : p, verified: Boolean(p), verifiedPhone: p || null,
    verifiedBy: viaApp(via), codeSent: false, code: '', devCode: null,
  });
}

// The ways in: two bring the code (Telegram, WhatsApp), three sign in (Facebook, Google, TikTok); waysRow sets the order.
// Brand names stay in Latin letters in every language.
const CODE_CHANNELS = [['telegram', 'Telegram'], ['whatsapp', 'WhatsApp']];
const SIGN_INS = [['facebook', 'facebook', 'Facebook'], ['google', 'gmail', 'Google'], ['tiktok', 'tiktok', 'TikTok']]; // [provider, verified key, name]
const channelName = (key) => CODE_CHANNELS.find((c) => c[0] === key)?.[1] ?? key;
const otherChannel = (key) => CODE_CHANNELS.find((c) => c[0] !== key)[0];
let verifierSeq = 0;

// Round brand marks in their own colours (constant markup, never user text). 24×24, the circle included.
const BRAND_SVG = {
  telegram: '<circle cx="12" cy="12" r="12" fill="#229ED9"/>'
    + '<path fill="#fff" d="M5.4 11.7 17.6 7c.6-.2 1.1.1.9.9l-2.1 9.8c-.2.7-.6.9-1.2.5l-3.2-2.4-1.5 1.5c-.2.2-.3.3-.7.3l.2-3.3 6-5.4c.3-.2-.1-.4-.4-.2l-7.4 4.7-3.2-1c-.7-.2-.7-.7.1-1Z"/>',
  whatsapp: '<circle cx="12" cy="12" r="12" fill="#25D366"/>'
    + '<path fill="none" stroke="#fff" stroke-width="1.5" stroke-linejoin="round" d="M12 5.4a6.5 6.5 0 0 0-5.6 9.8l-.9 3.3 3.4-.9A6.5 6.5 0 1 0 12 5.4Z"/>'
    + '<path fill="#fff" d="M9.7 8.6c.2-.2.5-.2.7 0l.8 1.4c.1.3.1.5-.1.7l-.4.5c.4.9 1.2 1.7 2.1 2.1l.5-.4c.2-.2.5-.2.7-.1l1.4.8c.3.2.3.5.1.7-.6.8-1.5 1.1-2.4.8-1.8-.6-3.2-2-3.8-3.8-.3-.9 0-1.8.4-2.4Z"/>',
  facebook: '<circle cx="12" cy="12" r="12" fill="#1877F2"/>'
    + '<path fill="#fff" d="M13.1 23.9v-8.4h2.8l.4-3.3h-3.2v-2c0-1 .3-1.6 1.7-1.6h1.7V5.7c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.3H7v3.3h2.8v8.3a12 12 0 0 0 3.3.1Z"/>',
  google: '<circle cx="12" cy="12" r="11.5" fill="#fff" stroke="#dadce0"/>'
    + '<svg x="5.5" y="5.5" width="13" height="13" viewBox="0 0 48 48">'
    + '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>'
    + '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>'
    + '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>'
    + '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>'
    + '</svg>',
  // TikTok: a black circle with a plain white music note (our own simple drawing: stem, round head, curled flag).
  tiktok: '<circle cx="12" cy="12" r="12" fill="#000"/>'
    + '<g fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round">'
    + '<path d="M13.2 5.8v9.3"/><circle cx="10.5" cy="15.2" r="2.7"/><path d="M13.2 5.8c.4 2 1.9 3.3 4 3.5"/>'
    + '</g>',
};
function brandMark(key) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: '52', height: '52', 'aria-hidden': 'true', focusable: 'false', class: 'way-mark' })) svg.setAttribute(k, v);
  svg.innerHTML = BRAND_SVG[key];
  return svg;
}

// Which of the buttons work right now (GET /auth/methods: { code:{ telegram, whatsapp }, signin:{ google, facebook },
// signinTest:{ google, facebook } }). signinTest = test mode's instant test sign-in; otherwise a working Google /
// Facebook button goes to the real sign-in (/30da/api/auth/<provider>/start) and comes back to this step.
// Kept a minute; unknown (the call failed) → every button stays on and the server answers for itself.
let methodsCache = null;
async function loadMethods() {
  if (methodsCache && Date.now() - methodsCache.at < 60e3) return methodsCache.value;
  try {
    const value = await api.get('/auth/methods', { redirect: false });
    methodsCache = { at: Date.now(), value };
    return value;
  } catch {
    return null;
  }
}

/** true only when GET /auth/methods said Google or Facebook sign-in works (unknown → false). */
export const signinWorks = (m) => SIGN_INS.some(([provider]) => m?.signin?.[provider] === true);

// What the user typed → E.164-ish ("+855" + digits, leading zeros dropped), or null when too short.
function fullPhone(model) {
  const raw = model.phone.trim();
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  const local = digits.replace(/^0+/, '');
  return local.length >= 6 && local.length <= 12 ? `${model.cc}${local}` : null;
}

/**
 * otherOn: the other code channel can still be offered (it works and has not failed here). When it cannot,
 * the words never name it ("…Please try again in a little while."), so nobody is sent round in a circle.
 */
function sendErrorText(err, channel, otherOn = true) {
  const names = { channel: channelName(channel), other: channelName(otherChannel(channel)) };
  const only = otherOn ? '' : '_only';
  if (err.code === 'channel_failed') return t(`${/^not_on_/.test(err.data?.reason || '') ? 'cp_ch_not_on' : 'cp_ch_failed'}${only}`, names);
  if (err.code === 'channel_unavailable') return t(`cp_ch_off${only}`, names);
  if (err.code === 'sms_unavailable') return t('cp_sms_off');
  if (err.code === 'too_soon') return t('cp_resend_in', { s: err.data?.resendIn ?? 30 });
  if (err.status === 429) return t('cp_too_many');
  if (err.status === 422 || err.status === 400) return t('cp_phone_invalid');
  return err.status === 0 ? t('err_network') : t('err_generic');
}

// The free Telegram bot (owner 2026-10-13): the phone step while it waits for "Share my number" in Telegram (the
// bot itself asks for it; this screen only says "Check Telegram for the next step.").
registerStrings({
  en: {
    cp_tg_not_open: 'Telegram did not open?',
    cp_tg_open_it: 'Open it',
    cp_tg_cancel: 'Cancel',
    cp_tg_mismatch: 'This Telegram is a different number. Use the Telegram of the number you typed, or change the number.',
    cp_tg_needs_app: 'Needs the Telegram app, signed in, on this phone. Not on Telegram? Use Google or Facebook.',
    cp_tg_privacy: 'Telegram opens on your phone. 30+DA cannot see your chats; only the number you share with GKVerify comes back.',
    cp_tg_expired: 'That took too long. Tap Telegram to try again.',
    cp_tg_match: 'Telegram shows the same sign:',
  },
  km: {
    cp_tg_not_open: 'Telegram មិនបានបើកទេ?',
    cp_tg_open_it: 'បើកវា',
    cp_tg_cancel: 'បោះបង់',
    cp_tg_mismatch: 'Telegram នេះជាលេខផ្សេង។ សូមប្រើ Telegram របស់លេខដែលអ្នកបានវាយ ឬប្ដូរលេខ។',
    cp_tg_needs_app: 'ត្រូវការកម្មវិធី Telegram ដែលបានចូលរួចនៅលើទូរស័ព្ទនេះ។ មិនប្រើ Telegram ទេ? សូមប្រើ Google ឬ Facebook។',
    cp_tg_privacy: 'Telegram បើកនៅលើទូរស័ព្ទរបស់អ្នក។ 30+DA មិនអាចមើលការជជែករបស់អ្នកបានទេ មានតែលេខដែលអ្នកចែករំលែកជាមួយ GKVerify ប៉ុណ្ណោះដែលត្រឡប់មកវិញ។',
    cp_tg_expired: 'ចំណាយពេលយូរពេក។ សូមចុច Telegram ដើម្បីសាកម្ដងទៀត។',
    cp_tg_match: 'Telegram បង្ហាញសញ្ញាដូចគ្នា៖',
  },
  zh: {
    cp_tg_not_open: 'Telegram 没打开？',
    cp_tg_open_it: '点此打开',
    cp_tg_cancel: '取消',
    cp_tg_mismatch: '这个 Telegram 是另一个号码。请用你输入的号码所登录的 Telegram，或者修改号码。',
    cp_tg_needs_app: '需要这部手机上已登录的 Telegram 应用。没有 Telegram？请用 Google 或 Facebook。',
    cp_tg_privacy: 'Telegram 会在你的手机上打开。30+DA 看不到你的聊天，只会收到你分享给 GKVerify 的号码。',
    cp_tg_expired: '时间太久了。请再点一次 Telegram。',
    cp_tg_match: 'Telegram 会显示同样的标记：',
  },
  ko: {
    cp_tg_not_open: 'Telegram이 열리지 않았나요?',
    cp_tg_open_it: '열기',
    cp_tg_cancel: '취소',
    cp_tg_mismatch: '이 Telegram은 다른 번호예요. 입력한 번호의 Telegram을 쓰거나 번호를 바꿔 주세요.',
    cp_tg_needs_app: '이 휴대폰에 로그인된 Telegram 앱이 필요해요. Telegram이 없나요? Google이나 Facebook을 쓰세요.',
    cp_tg_privacy: 'Telegram이 휴대폰에서 열려요. 30+DA는 채팅을 볼 수 없고, GKVerify에 공유한 번호만 돌아와요.',
    cp_tg_expired: '시간이 너무 지났어요. Telegram을 다시 눌러 주세요.',
    cp_tg_match: 'Telegram에도 같은 표시가 나와요:',
  },
  ja: {
    cp_tg_not_open: 'Telegram が開きませんか？',
    cp_tg_open_it: '開く',
    cp_tg_cancel: 'キャンセル',
    cp_tg_mismatch: 'この Telegram は別の番号です。入力した番号の Telegram を使うか、番号を変えてください。',
    cp_tg_needs_app: 'この電話でログイン済みの Telegram アプリが必要です。Telegram がない場合は Google か Facebook を使ってください。',
    cp_tg_privacy: 'Telegram はお使いの電話で開きます。30+DA はチャットを見られません。GKVerify に共有した番号だけが戻ってきます。',
    cp_tg_expired: '時間がかかりすぎました。もう一度 Telegram を押してください。',
    cp_tg_match: 'Telegram にも同じマークが出ます：',
  },
});

function verifyErrorText(err) {
  if (err.code === 'wrong_code' || err.code === 'invalid') return t('cp_code_wrong');
  if (err.code === 'code_expired') return t('cp_code_expired');
  if (err.code === 'code_sending') return t('cp_code_on_way');
  // "Verify to chat": verifying from a profile made without it — the number already has another profile.
  if (err.code === 'phone_in_use') return t('cp_phone_in_use');
  if (err.status === 429) return t('cp_too_many');
  return err.status === 0 ? t('err_network') : t('err_generic');
}

/**
 * One row of round brand buttons: Telegram · WhatsApp (where the code goes) · Facebook · Google · TikTok (sign in;
 * only when `signin` is given — Create profile) and the number box [+855 ⌄][12 345 678] (the whole row: no button
 * beside it). A TAP STARTS THAT WAY at once (owner 2026-10-13): Telegram / WhatsApp take the number typed (none yet:
 * "Type your phone number first.") — the free Telegram bot's check, or a 6-digit code with a resend countdown —
 * Google / Facebook / TikTok sign in. One short line under the buttons says what to do: "Tap the app you want to
 * verify with." before a tap, "Check Telegram for the next step." / "Check WhatsApp for your code." after one; then
 * green "Number verified ✓". On Create profile the number box comes FIRST, always there even while no code channel
 * works (the number is kept and saved on the profile unverified — see flagNumber).
 * A live channel really sends ("We sent a code to your Telegram");
 * test mode shows the code on screen. If the channel cannot deliver, the message offers the other one.
 * A button that does not work yet (GET /auth/methods) is dimmed with "Coming soon"; tapping it says why.
 * Facebook / Google say "Coming soon" until their keys are saved on the admin Code page; then a tap leaves for
 * Google / Facebook and comes back here (test mode without keys keeps its instant test sign-in).
 * `model` (see blankPhone) keeps the state across re-renders. onVerified(response) after a good code.
 * signin: { verified: () => ({ gmail, facebook }), onVerified(verified), beforeLeave(), to } — what the session has
 * proved; beforeLeave runs just before the page goes to Google / Facebook (to keep what was typed). to: 'me' — #/me
 * (owner 2026-10-13): the same 5 round buttons, a sign-in ADDS that account to the profile (never a switch) and comes
 * back to #/me; the rest keeps #/me's own layout (buttons, "Number verified ✓ · Change number", the number box).
 * notice: { text, ok, icon } shown once at the start, as a calm note (the way back from Google / Facebook:
 * "Verified with Google." or why not).
 * onMethods(methods) once GET /auth/methods has answered (not called when it failed), so the screen can word
 * its own notes from the same answer (see signinWorks).
 */
export function phoneVerifier(model, { onVerified, onChange, onMethods, signin = null, notice = null } = {}) {
  model.channel ||= 'telegram';
  model.failed ||= [];
  const uid = `pv${++verifierSeq}`;
  const node = el('div', { class: 'stack phone-box', style: { '--gap': '10px' } });
  const error = el('p', { class: 'field-error', role: 'alert', hidden: true });
  const note = el('p', { class: 'way-msg', role: 'status', hidden: true });
  let resendTimer = null;
  let sending = false;
  let checking = false;
  let signingIn = null;
  let codeEl = null;
  let methods = null; // null = not known (yet): every button on
  let methodsAsked = false; // GET /auth/methods answered (or failed): a Telegram tap waits for it (the bot or codes)
  let methodsReady = null; // that call (set at the end): a tap before it answered waits for it
  let numberFlagged = false; // the error shown is flagNumber's: it goes as soon as the number is edited
  let alive = true;

  // An optional action (e.g. "Send by WhatsApp") sits right after the message.
  const showError = (text, action = null) => {
    numberFlagged = false;
    const body = text ? el('span', {}, text, action ? ' ' : null, action
      ? el('button', { type: 'button', class: 'link err-action', on: { click: action.run } }, action.label) : null) : null;
    error.replaceChildren(...(text ? [icon('flag', 14), body] : []));
    error.hidden = !text;
    if (text) showNote(null);
  };
  // A calm note (not an error): "Coming soon", "Verified with Google".
  function showNote(text, iconName = 'clock') {
    note.replaceChildren(...(text ? [icon(iconName, 14), el('span', {}, text)] : []));
    note.hidden = !text;
  }

  const codeOn = (key) => methods?.code?.[key] !== false;
  const signinOn = (provider) => methods?.signin?.[provider] !== false;
  // Create profile / the "Verify to chat" sheet: the number first, one short line. #/me keeps its own layout.
  const cpLayout = Boolean(signin) && signin.to !== 'me';
  /**
   * Some code channel works (or it is not known yet). None → #/me: no phone box, "Codes by phone are coming
   * soon." instead; Create profile: the number box stays (saved unverified).
   */
  const anyCodeOn = () => CODE_CHANNELS.some(([key]) => codeOn(key));
  /** "Sign-in with Google is coming soon." — pointing at the phone only while a code channel works. */
  const signinSoonText = (name) => t(anyCodeOn() ? 'cp_signin_soon' : 'cp_signin_soon_only', { name });

  /** The other code channel can still be offered: it works and has not failed here already. */
  const otherWorks = (channel) => {
    const other = otherChannel(channel);
    return codeOn(other) && !model.failed.includes(other);
  };

  /** After a channel could not send: offer the other one, unless it failed too or does not work. */
  function offerOther(channel) {
    const other = otherChannel(channel);
    if (!otherWorks(channel)) return null;
    return {
      label: t('cp_ch_try', { channel: channelName(other) }),
      run: () => { model.channel = other; render(); send(); },
    };
  }

  /**
   * A tap on Telegram / WhatsApp starts that way at once (owner 2026-10-13: no Send code / Open Telegram button):
   * the free Telegram bot's check, or a code by that app. It needs the number typed first.
   */
  async function startChannel(key) {
    // `sending` covers a code on its way and Telegram's start; the bot's status check (tgPolling) never blocks a tap.
    if (sending || model.verified) return;
    if (!methodsAsked) await methodsReady; // which Telegram it is (the bot or codes): known in a moment
    if (!alive || sending) return;
    if (!codeOn(key)) {
      showError(null);
      showNote(t(otherWorks(key) ? 'cp_ch_off' : 'cp_ch_off_only', { channel: channelName(key), other: channelName(otherChannel(key)) }));
      return;
    }
    if (!fullPhone(model)) return askNumber();
    model.channel = key;
    // The free Telegram bot: the tap itself goes to Telegram (no code to wait for).
    if (key === 'telegram' && botMode()) return startTelegram();
    // That app's code is already on its way to this number: its box is right there.
    if (model.codeSent && model.sentBy === key && model.sentTo === fullPhone(model) && model.resendAt > Date.now()) return codeEl?.focus();
    // Another app now: the wait for Telegram's bot is over (one way, one line at a time).
    if (model.tg) endTelegram();
    return send();
  }

  /** No number yet (or not a real one): one plain line under the box, the cursor in it. */
  function askNumber() {
    if (model.phone.trim()) return flagNumber();
    showError(t('cp_number_first'));
    numberFlagged = true;
    node.querySelector('.phone-row input[type=tel]')?.focus();
  }

  async function signIn(provider, key, name) {
    if (signingIn || signin?.verified?.()[key]) return;
    showError(null);
    if (!signinOn(provider)) return showNote(signinSoonText(name));
    // One way at a time (owner): picking Google / Facebook / TikTok replaces a Telegram wait still on screen.
    if (model.tg) endTelegram();
    signingIn = provider;
    render();
    if (methods?.signinTest?.[provider] !== true) {
      // The real sign-in: the whole page goes to Google / Facebook and comes back to this step.
      try { signin?.beforeLeave?.(); } catch { /* keeping the draft is a nicety */ }
      const to = signin?.to === 'me' ? 'me' : null;
      // In the 30+DA app: the app's own sign-in sheet; when it signs in, the app loads the way back itself.
      if (shellAuth()) return signInByApp(provider, to);
      location.assign(`/30da/api/auth/${provider}/start${to ? '?to=me' : ''}`);
      return;
    }
    try {
      const r = await api.post('/auth/verify-social', { provider });
      signin.onVerified?.({ ...(r.verified || {}), [key]: true });
      showNote(t('cp_verified_with', { name }), 'check');
    } catch (err) {
      if (err.code === 'oauth_unavailable') showNote(signinSoonText(name));
      else showError(err.status === 0 ? t('err_network') : t('err_generic'));
    } finally {
      signingIn = null;
      render();
      onChange?.();
    }
  }

  /**
   * The sign-in in the 30+DA app's sheet (shell.js). Done → the app loads /30da/api/auth/app?… itself (the button
   * stays busy; free again after a while if that never came). Closed or failed → the button is free again at once.
   */
  async function signInByApp(provider, to) {
    let how = 'failed';
    try {
      how = await shellSignIn(api, provider, to);
    } catch (err) {
      showError(err?.status === 0 ? t('err_network') : t('err_generic'));
    }
    if (how === 'left') return;
    if (how === 'done') {
      setTimeout(() => { if (alive && signingIn === provider) { signingIn = null; render(); } }, 10e3);
      return;
    }
    backFromSheet({ touched: how === 'cancelled' });
    if (how === 'failed' && error.hidden) showError(t('err_generic'));
    if (!alive) return;
    signingIn = null;
    render();
  }

  async function send() {
    if (sending) return;
    if (model.channel === 'telegram' && botMode()) return startTelegram();
    const phone = fullPhone(model);
    if (!phone) return askNumber();
    const channel = model.channel;
    sending = true;
    showNote(null);
    render();
    let sent = false;
    try {
      const r = await api.post('/auth/send-code', { phone, channel });
      Object.assign(model, {
        codeSent: true, code: '', devCode: r.live ? null : r.devCode || null, sentTo: r.phone || phone,
        sentBy: r.channel || channel, live: Boolean(r.live), resendAt: Date.now() + (Number(r.resendIn) || 30) * 1000,
      });
      model.failed = model.failed.filter((c) => c !== channel);
      showError(null);
      sent = true;
    } catch (err) {
      if (err.code === 'too_soon' && model.codeSent) model.resendAt = Date.now() + (Number(err.data?.resendIn) || 30) * 1000;
      const channelProblem = err.code === 'channel_failed' || err.code === 'channel_unavailable';
      if (channelProblem && !model.failed.includes(channel)) model.failed.push(channel);
      showError(sendErrorText(err, channel, otherWorks(channel)), channelProblem ? offerOther(channel) : null);
    } finally {
      sending = false;
      render();
    }
    if (sent) codeEl?.focus();
  }

  // ---------- the free Telegram bot (GET /auth/methods → telegram: 'bot'; owner 2026-10-13) ----------
  // No code: the number typed here goes to POST /auth/telegram/start, Telegram opens on the 30+DA bot, the person
  // taps "Share my number" there, and GET /auth/telegram/status (every 2 s, and on coming back to this tab) signs
  // in this browser exactly like a good code. model.tg = { phone, link, until, opened, pin, match } while it waits.
  // match ("🍊 47") is shown here and repeated by the bot: a person sent someone else's link sees no such screen.
  function botMode() { return methods?.telegram === 'bot'; }
  model.tg ||= null;
  let tgTimer = null;
  let tgPolling = false; // a GET /auth/telegram/status is on its way (it never blocks a tap: see startChannel)
  let tgEl = null;
  const onTgVisible = () => { if (document.visibilityState === 'visible' && model.tg) pollTelegram(); };
  function stopTelegram() {
    clearTimeout(tgTimer);
    tgTimer = null;
    document.removeEventListener('visibilitychange', onTgVisible);
  }
  function endTelegram() {
    model.tg = null;
    stopTelegram();
  }
  function waitForTelegram(ms) {
    clearTimeout(tgTimer);
    document.removeEventListener('visibilitychange', onTgVisible);
    document.addEventListener('visibilitychange', onTgVisible);
    tgTimer = setTimeout(pollTelegram, ms);
  }
  const openTelegram = (link) => {
    try { window.open(link, '_blank', 'noopener'); } catch { /* blocked: the waiting box's "Telegram did not open? Open it" */ }
  };

  async function startTelegram() {
    if (sending) return;
    const phone = fullPhone(model);
    if (!phone) return askNumber();
    // The same number is already waiting: just open Telegram again.
    if (model.tg?.phone === phone && model.tg.until > Date.now()) return openTelegram(model.tg.link);
    endTelegram();
    sending = true;
    showError(null);
    showNote(null);
    render();
    try {
      const pin = waitingPin(); // a returning person's waiting PIN goes with the check (the server keeps it hashed)
      const r = await api.post('/auth/telegram/start', { phone, lang: state.lang, ...(pin ? { pin } : {}) });
      model.tg = { phone: r.phone || phone, link: r.link, until: Date.now() + (Number(r.expiresIn) || 600) * 1000, opened: false, pin: Boolean(pin), match: typeof r.match === 'string' ? r.match : null };
      // One way at a time: a WhatsApp code that was out is over (its box and countdown go). Only once Telegram's
      // check really started — if it could not, that code is still there to type.
      Object.assign(model, { codeSent: false, devCode: null, code: '', live: false, sentBy: null });
      openTelegram(r.link);
      waitForTelegram(Number(r.pollMs) || 2000);
    } catch (err) {
      const off = err.code === 'channel_unavailable';
      if (off && !model.failed.includes('telegram')) model.failed.push('telegram');
      showError(sendErrorText(err, 'telegram', otherWorks('telegram')), off ? offerOther('telegram') : null);
    } finally {
      sending = false;
      render();
    }
  }

  async function pollTelegram() {
    if (!alive || !model.tg || tgPolling) return;
    clearTimeout(tgTimer);
    tgPolling = true;
    const tg = model.tg; // the wait this answer is about (a tap may end it, or start a new one, meanwhile)
    let next = 2000;
    try {
      const r = await api.get('/auth/telegram/status', { redirect: false });
      if (model.tg !== tg) return; // cancelled (or another app tapped) meanwhile
      if (r.state === 'verified') {
        const { phone, pin } = model.tg;
        endTelegram();
        if (pin && r.user?.pinSet) clearPinFlags();
        Object.assign(model, { verified: true, verifiedPhone: r.user?.phone || phone, verifiedBy: 'telegram', codeSent: false, code: '', devCode: null, failed: [] });
        showError(null);
        render();
        onChange?.();
        onVerified?.(r);
        return;
      }
      if (r.state !== 'waiting') {
        // Over without a number: their own number was another one, or it took too long (calm, one line).
        endTelegram();
        // in_use ("Verify to chat"): Telegram proved a number that already has another profile.
        const said = { mismatch: 'cp_tg_mismatch', in_use: 'cp_phone_in_use' }[r.state] || 'cp_tg_expired';
        showNote(t(said), r.state === 'mismatch' || r.state === 'in_use' ? 'flag' : 'clock');
        render();
        return;
      }
      if (r.opened && !model.tg.opened) {
        model.tg.opened = true;
        render();
      }
    } catch (err) {
      next = err.status === 429 ? 10000 : 4000; // a hiccup: keep asking, a little slower
    } finally {
      tgPolling = false;
    }
    if (model.tg !== tg) return;
    // Past the server's verified grace (2 minutes after the 10) plus a little: only then give up on our own.
    if (Date.now() > model.tg.until + 150e3) {
      endTelegram();
      showNote(t('cp_tg_expired'));
      render();
      return;
    }
    waitForTelegram(next);
  }

  /**
   * While it waits: the number · the sign (🍊 47) · "Telegram did not open? Open it" · Cancel. No instruction of its
   * own and no big button (owner 2026-10-13): "Check Telegram for the next step." above says what to do, Telegram
   * itself says the rest. The small link is for a browser that blocked the automatic tab; it goes once Telegram
   * has opened (a tap on Telegram above opens it again too).
   */
  function tgWaitBox() {
    tgEl = null;
    if (!model.tg) return null;
    tgEl = el('div', { class: 'tg-wait', role: 'status', 'aria-live': 'polite' },
      el('div', { class: 'tg-wait-head' },
        el('span', { class: 'tg-wait-mark', 'aria-hidden': 'true' }, brandMark('telegram')),
        el('div', { class: 'tg-wait-text' },
          el('span', { class: 'tg-wait-num' }, model.tg.phone),
          model.tg.match ? el('span', { class: 'tg-wait-match' }, t('cp_tg_match'), ' ', el('b', {}, model.tg.match)) : null,
          // Owner saw his own Telegram flash open and read it as 30+DA seeing his account: say what really happens.
          el('span', { class: 'tg-wait-privacy' }, t('cp_tg_privacy')),
          // A phone with no Telegram signed in lands on Telegram's own "Your phone" screen: say what is needed.
          el('span', { class: 'tg-wait-privacy' }, t('cp_tg_needs_app')))),
      el('div', { class: 'tg-wait-actions' },
        model.tg.opened ? null : el('span', { class: 'tg-reopen' }, t('cp_tg_not_open'), ' ',
          el('a', { class: 'link tg-open', href: model.tg.link, target: '_blank', rel: 'noopener noreferrer' }, t('cp_tg_open_it'))),
        el('button', { type: 'button', class: 'link tg-cancel', on: { click: () => { endTelegram(); render(); } } }, t('cp_tg_cancel'))));
    return tgEl;
  }

  async function check(input) {
    if (checking) return;
    checking = true;
    input.readOnly = true;
    try {
      const pin = waitingPin(); // a returning person's waiting PIN becomes their PIN (they just proved who they are)
      const r = await api.post('/auth/verify-code', { phone: model.sentTo, code: model.code, ...(pin ? { pin } : {}) });
      if (pin && r.user?.pinSet) clearPinFlags();
      const via = model.sentBy || model.channel;
      Object.assign(model, { verified: true, verifiedPhone: r.user?.phone || model.sentTo, verifiedBy: via, codeSent: false, code: '', devCode: null, failed: [] });
      showError(null);
      render();
      onChange?.();
      onVerified?.(r);
    } catch (err) {
      model.code = '';
      input.value = '';
      input.readOnly = false;
      showError(verifyErrorText(err));
      if (err.code === 'code_expired' || err.status === 429) {
        model.resendAt = 0; // let them ask for a new one straight away
        render();
      } else {
        input.focus();
      }
    } finally {
      checking = false;
    }
  }

  function resendLine() {
    const line = el('span', { class: 'resend' });
    const paint = () => {
      const s = Math.ceil((model.resendAt - Date.now()) / 1000);
      if (s > 0) {
        line.textContent = t('cp_resend_in', { s });
        return;
      }
      clearInterval(resendTimer);
      resendTimer = null;
      // Resend by the app that sent this code (a tap on another app that could not start leaves model.channel there).
      line.replaceChildren(el('button', { type: 'button', class: 'link', on: { click: () => { if (model.sentBy) model.channel = model.sentBy; send(); } } }, t('cp_resend')));
    };
    paint();
    if (model.resendAt > Date.now()) resendTimer = setInterval(paint, 1000);
    return line;
  }

  /** Telegram / WhatsApp is under way for the number in the box: sending, its code out, or the bot waiting. */
  function underWay(key) {
    if (model.verified) return false;
    if (sending) return model.channel === key;
    return key === 'telegram' && model.tg ? true : Boolean(model.codeSent && model.sentBy === key);
  }

  /**
   * The one line under the buttons (owner 2026-10-13): "Tap the app you want to verify with." until a tap starts
   * one; then the app to look in — "Check Telegram for the next step." (the bot; Google / Facebook / TikTok while
   * they open) or "Check WhatsApp for your code.". Brand names stay in Latin letters. '' = no line (hidden).
   */
  function stepText() {
    const signinName = SIGN_INS.find(([provider]) => provider === signingIn)?.[2];
    if (signinName) return t('cp_check_next', { app: signinName });
    if (model.tg) return t('cp_check_next', { app: channelName('telegram') });
    if (sending) return t(model.channel === 'telegram' && botMode() ? 'cp_check_next' : 'cp_check_code', { app: channelName(model.channel) });
    if (model.codeSent) return t('cp_check_code', { app: channelName(model.sentBy || model.channel) });
    // Create profile: Google / Facebook / TikTok already proved this person (enough to chat) — nothing left to ask
    // for, so no line (the green ✓ on that app and "Verified with Google." say it). Telegram / WhatsApp still work.
    if (cpLayout && Object.values(signin?.verified?.() || {}).some(Boolean)) return '';
    return t('cp_tap_app');
  }

  /** One round button: brand mark, name under it, "Coming soon" under that while it does not work. */
  function wayButton({ key, name, on, pressed = null, done = false, busy = false, click }) {
    return el('button', {
      type: 'button', class: ['way', !on && 'is-off', done && 'is-done', busy && 'is-busy'],
      'aria-pressed': pressed == null ? null : String(pressed),
      'aria-disabled': on ? null : 'true',
      'aria-label': [name, done ? t('cp_verified') : null, on ? null : t('cp_soon')].filter(Boolean).join(' · '),
      on: { click },
    },
    el('span', { class: 'way-dot' }, brandMark(key),
      done ? el('span', { class: 'way-badge', 'aria-hidden': 'true' }, icon('check', 12)) : null),
    el('span', { class: 'way-name', 'aria-hidden': 'true' }, name),
    // The app that proved it: "Verified" under its name instead of its usual note.
    done ? el('span', { class: 'way-note is-ok', 'aria-hidden': 'true' }, t('cp_verified'))
      : on ? null : el('span', { class: 'way-note', 'aria-hidden': 'true' }, t('cp_soon')));
  }

  function waysRow() {
    const proved = signin?.verified?.() || {};
    // Telegram / WhatsApp: a tap starts it (startChannel); the navy ring marks the one under way.
    const codeBtn = ([key, name]) => wayButton({
      key, name, on: codeOn(key), pressed: underWay(key),
      done: Boolean(model.verified && model.verifiedBy === key), busy: sending && model.channel === key,
      click: () => startChannel(key),
    });
    const signinBtn = ([provider, key, name]) => wayButton({
      key: provider, name, on: signinOn(provider), done: Boolean(proved[key]), busy: signingIn === provider,
      click: () => signIn(provider, key, name),
    });
    const code = Object.fromEntries(CODE_CHANNELS.map((c) => [c[0], c]));
    const sign = Object.fromEntries(SIGN_INS.map((s) => [s[0], s]));
    // Owner's order (2026-10-13): TikTok, Telegram, Google, Facebook, WhatsApp — Create profile, the sheet and #/me.
    // Without sign-ins (no `signin` given): the two code apps.
    // Owner (2026-10-13): hide WhatsApp while it does not work (it comes back by itself once its test code goes through).
    const shown = (c) => c[0] !== 'whatsapp' || codeOn('whatsapp');
    const row = signin
      ? [signinBtn(sign.tiktok), codeBtn(code.telegram), signinBtn(sign.google), signinBtn(sign.facebook), shown(code.whatsapp) ? codeBtn(code.whatsapp) : null].filter(Boolean)
      : CODE_CHANNELS.filter(shown).map(codeBtn);
    return el('div', { class: ['ways', signin && 'with-signin'], role: 'group', 'aria-label': t('cp_ways'), style: { '--cols': String(row.length) } }, row);
  }

  function render() {
    if (!alive) return;
    clearInterval(resendTimer);
    resendTimer = null;
    codeEl = null;
    // Verified (owner 2026-10-13): the whole step stays — the number in its box (editable), the apps, a ✓ on the
    // one that proved it. Editing the number away from the proved one drops the ✓ for this screen (verify again).
    const proved = model.verified;
    const ccSel = el('select', { class: 'select', 'aria-label': t('cp_country_code'), on: { change: () => { model.cc = ccSel.value; reproved(); } } },
      COUNTRY_CODES.map((c) => el('option', { value: c, selected: c === model.cc }, c)));
    // No button beside the box (owner 2026-10-13): a tap on Telegram / WhatsApp sends (startChannel).
    const phoneInput = el('input', {
      class: ['input', proved && 'is-verified'], type: 'tel', inputmode: 'tel', autocomplete: 'tel-national', maxlength: '20',
      placeholder: t('cp_phone_ph'), 'aria-label': t('cp_phone'), 'aria-describedby': `${uid}-by`, value: model.phone,
      on: {
        input: () => {
          model.phone = phoneInput.value;
          const said = stepText();
          // Waiting for Telegram for another number: that wait is over (tap Telegram again for this one).
          if (model.tg && fullPhone(model) !== model.tg.phone) { endTelegram(); if (tgEl) tgEl.hidden = true; }
          if (model.codeSent && fullPhone(model) !== model.sentTo) Object.assign(model, { codeSent: false, devCode: null, code: '', live: false, sentBy: null });
          codeBox.hidden = !model.codeSent;
          // Nothing under way for this number any more: "Tap the app you want to verify with." again, no ring.
          if (step && stepText() !== said) {
            step.textContent = stepText();
            step.hidden = !step.textContent;
            node.querySelectorAll('.way[aria-pressed="true"]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
          }
          if (numberFlagged) showError(null); // "Enter a valid phone number." from Next goes as they fix it
          reproved();
        },
      },
    });
    // The one line under the buttons (stepText): "Tap the app you want to verify with." → "Check Telegram for the
    // next step." / "Check WhatsApp for your code.". Create profile and the sheet: "🔒 Only for verification — kept
    // safe and private." under it. Verified: "Number verified ✓" takes the line's place (#/me: with "Change number").
    const step = proved ? null : el('span', { class: 'way-step', hidden: !stepText() }, stepText());
    const hint = proved
      ? el('p', { class: 'way-hint way-watch way-verified', id: `${uid}-by`, role: 'status' },
        el('span', { class: 'verified-line' }, t('cp_phone_verified')),
        cpLayout ? el('span', { class: 'way-private' }, icon('lock', 12), t('cp_code_private'))
          : el('button', { type: 'button', class: 'link change-number', on: { click: changeNumber } }, t('cp_change_number')))
      : el('p', { class: ['way-hint', cpLayout && 'way-watch'], id: `${uid}-by`, role: 'status' }, step,
        // Owner: say the number is only for verification and stays private.
        cpLayout ? el('span', { class: 'way-private' }, icon('lock', 12), t('cp_code_private')) : null);
    // #/me with no code channel offered at all (and no code out): no phone box (a tap could only fail), one calm
    // line. Create profile keeps the box (the number is saved unverified).
    const phoneSoon = !cpLayout && !anyCodeOn() && !model.codeSent && !proved;

    const codeBox = el('div', { class: 'stack', style: { '--gap': '8px' }, hidden: !model.codeSent });
    if (model.codeSent) {
      const codeInput = el('input', {
        class: 'input code', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6',
        placeholder: t('cp_code_ph'), 'aria-label': t('cp_code_ph'), value: model.code,
        on: {
          input: () => {
            codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6);
            model.code = codeInput.value;
            if (model.code.length === 6) check(codeInput);
          },
        },
      });
      codeEl = codeInput;
      codeBox.append(
        el('div', { class: 'code-row' }, codeInput, resendLine()),
        el('p', { class: 'help' }, model.live && model.sentBy
          ? t('cp_code_sent_ch', { channel: channelName(model.sentBy), phone: model.sentTo })
          : t('cp_code_sent', { phone: model.sentTo })));
      if (model.devCode) codeBox.append(el('p', { class: 'dev-note' }, t('cp_test_code', { code: model.devCode })));
    }
    const phoneRow = el('div', { class: 'phone-row' }, ccSel, phoneInput);
    // While it waits for Telegram (the free bot): its box under "Check Telegram for the next step.".
    const tgBox = tgWaitBox();
    // Create profile: the number first (right under the label), then the round buttons, then the one line.
    if (cpLayout) node.replaceChildren(...[phoneRow, waysRow(), hint, note, codeBox, tgBox, error].filter(Boolean));
    else {
      // #/me and the "Verify to chat" sheet too (owner 2026-10-13): the number on top, the apps under it.
      node.replaceChildren(...[phoneSoon
        ? el('p', { class: 'way-hint way-soon', role: 'note' }, t('cp_phone_soon'))
        : phoneRow, waysRow(), phoneSoon ? null : hint, note, codeBox, tgBox, error].filter(Boolean));
    }
  }

  /** The box shows the proved number again (✓ back) or no longer (✓ gone): redraw, the cursor where it was. */
  function reproved() {
    if (!model.verifiedPhone) return;
    const p = fullPhone(model);
    const now = Boolean(p && digitsOf(p) === digitsOf(model.verifiedPhone));
    if (now === model.verified) return;
    model.verified = now;
    const input = node.querySelector('.phone-row input[type=tel]');
    const at = input && document.activeElement === input ? input.selectionStart : null;
    render();
    onChange?.();
    if (at != null) {
      const again = node.querySelector('.phone-row input[type=tel]');
      if (again) { again.focus(); try { again.setSelectionRange(at, at); } catch { /* type=tel */ } }
    }
  }
  /** #/me "Change number": an empty box to type the new one; it is verified like the first. */
  function changeNumber() {
    model.phone = '';
    model.verified = false;
    showError(null);
    render();
    onChange?.();
    node.querySelector('.phone-row input[type=tel]')?.focus();
  }

  render();
  // A calm note either way (never the red error): the way back from Google / Facebook.
  if (notice?.text) showNote(notice.text, notice.icon || (notice.ok ? 'check' : 'clock'));
  // Back from Google / Facebook with the browser's back button (page restored from memory): the button is free again.
  const onShow = (e) => { if (e.persisted && signingIn) { signingIn = null; render(); } };
  window.addEventListener('pageshow', onShow);
  // Back in the 30+DA app from its sign-in sheet (a Custom Tab trip has no unload, so no pageshow): free again.
  const stopReturn = onAppReturn(() => { if (alive && signingIn) { signingIn = null; render(); } });
  // Re-drawn while it waits for Telegram (a language switch): keep asking.
  if (model.tg) pollTelegram();
  methodsReady = loadMethods().then((m) => {
    if (!alive) return;
    methodsAsked = true;
    // The call failed: every button stays on, nothing changes (the server answers each tap for itself).
    if (!m) return;
    methods = m;
    onMethods?.(m);
    // The last channel does not work but the other one does: that one for a resend (unless a code is already out).
    if (!model.codeSent && !codeOn(model.channel) && codeOn(otherChannel(model.channel))) model.channel = otherChannel(model.channel);
    const focused = node.contains(document.activeElement) ? document.activeElement : null;
    const typed = focused?.matches?.('input') ? { value: focused.value, start: focused.selectionStart } : null;
    render();
    // Re-rendering replaces the inputs: put the cursor back where it was.
    if (typed) {
      const again = node.querySelector(focused.classList.contains('code') ? 'input.code' : '.phone-row input[type=tel]');
      if (again) { again.focus(); try { again.setSelectionRange(typed.start, typed.start); } catch { /* type=tel */ } }
    }
  });
  return {
    node,
    focusCode: () => codeEl?.focus(),
    /**
     * Create profile: the number typed but not verified, ready for POST /profile (saved there unverified), or
     * null when nothing is typed (or it is verified). A number that does not look right → flagged here
     * ("Enter a valid phone number.", the box focused) and { bad: true }.
     */
    typedNumber: () => {
      if (model.verified) return null;
      // The proved number was edited away (or cleared): verify the new one, or type the proved one back.
      if (model.verifiedPhone) {
        showError(t('cp_number_changed'));
        numberFlagged = true;
        node.querySelector('.phone-row input[type=tel]')?.focus();
        return { bad: true };
      }
      if (!model.phone.trim()) return null;
      const phone = fullPhone(model);
      if (phone) return { phone };
      flagNumber();
      return { bad: true };
    },
    flagNumber,
    destroy: () => { alive = false; clearInterval(resendTimer); stopTelegram(); window.removeEventListener('pageshow', onShow); stopReturn(); },
  };

  /** "Enter a valid phone number." under the box (it goes as soon as the number is edited), cursor in the box. */
  function flagNumber() {
    showError(t('cp_phone_invalid'));
    numberFlagged = true;
    node.querySelector('.phone-row input[type=tel]')?.focus();
  }
}

// ---------------------------------------------------------------- screen

const blankDraft = () => ({
  photo: null, name: '', birthYear: '', realName: '', gender: '', role: '', phone: blankPhone(), verified: { gmail: false, facebook: false, tiktok: false },
  extraPhotos: [null, null, null], // photos 2–4 (optional), uploaded right after the profile is made
});
// Survives a language switch (which re-renders this screen) but not a reload — except the trip to Google /
// Facebook and back: stashDraft keeps what was typed in this tab (sessionStorage) and the screen takes it back once.
let draft = blankDraft();
const DRAFT_KEY = '30da_cp_draft';

function stashDraft() {
  const { photo, name, birthYear, realName, gender, role, extraPhotos } = draft;
  const kept = { photo, name, birthYear, realName, gender, role, cc: draft.phone.cc, phone: draft.phone.phone };
  // Photos 2–4 too when they fit (the tab's storage is a few MB); without them when they do not.
  for (const value of [{ ...kept, extraPhotos }, kept]) {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(value));
      return;
    } catch { /* storage full or off: try smaller, else they type it again */ }
  }
}

function takeStashedDraft() {
  let saved = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null');
    sessionStorage.removeItem(DRAFT_KEY);
  } catch { /* nothing kept */ }
  if (!saved || typeof saved !== 'object') return;
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  if (typeof saved.photo === 'string' && saved.photo.startsWith('data:image/')) draft.photo = saved.photo;
  if (Array.isArray(saved.extraPhotos)) {
    const kept = draft.extraPhotos || [null, null, null];
    draft.extraPhotos = kept.map((p, i) => {
      const v = saved.extraPhotos[i];
      return typeof v === 'string' && v.startsWith('data:image/') ? v : p;
    });
  }
  draft.name = str(saved.name, NAME_RAW_MAX) || draft.name;
  draft.birthYear = str(String(saved.birthYear ?? ''), 4) || draft.birthYear;
  draft.realName = str(saved.realName, 60) || draft.realName;
  draft.gender = str(saved.gender, 10) || draft.gender;
  draft.role = str(saved.role, 40) || draft.role;
  if (str(saved.cc, 6)) draft.phone.cc = str(saved.cc, 6);
  if (str(saved.phone, 20) && !draft.phone.verified) draft.phone.phone = str(saved.phone, 20);
}

const SIGNIN_NAMES = { google: 'Google', facebook: 'Facebook', tiktok: 'TikTok' };
const SIGNIN_ERRORS = ['cancelled', 'expired', 'unavailable', 'failed', 'too_many'];
const SIGNIN_ERROR_ICON = { cancelled: 'question', expired: 'clock', too_many: 'clock', unavailable: 'refresh', failed: 'refresh' };

/** The way back from Google / Facebook (#/create?signin=google&ok=1 | &error=cancelled) → the phone step's notice. */
function signinNotice(query) {
  const name = SIGNIN_NAMES[query?.signin];
  if (!name) return null;
  if (query.ok === '1') return { ok: true, icon: 'check', text: t('cp_verified_with', { name }) };
  const reason = SIGNIN_ERRORS.includes(query.error) ? query.error : 'failed';
  return { ok: false, icon: SIGNIN_ERROR_ICON[reason], text: reason === 'too_many' ? t('cp_too_many') : t(`cp_signin_${reason}`, { name }) };
}

function nameProblem(value) {
  const problem = appNameProblem(value);
  return problem === 'contact' ? t('cp_name_contact') : problem === 'length' ? t('cp_name_length') : null;
}

const tag = (text, iconName, filled) =>
  el('span', { class: ['tag', filled ? 'tag-filled' : 'tag-outline'] }, iconName ? icon(iconName, 11) : null, text);

// Label row (+ optional tag) over its controls. forId ties a <label> to one input; labelId names a group.
function field(labelText, tagNode, { forId = null, labelId = null } = {}, ...controls) {
  const label = forId
    ? el('label', { class: 'label ink', for: forId }, labelText)
    : el('span', { class: 'label ink', id: labelId }, labelText);
  return el('div', { class: 'field' }, el('div', { class: 'field-head' }, label, tagNode), controls);
}

function languageSheet() {
  const sheet = modal(el('div', { class: 'sheet-body' },
    el('h2', { class: 'sheet-title' }, t('cp_choose_language')),
    el('div', { class: 'menu' }, LANGS.map((code) => el('button', {
      type: 'button',
      class: ['menu-item', code === state.lang && 'selected'],
      lang: code,
      'aria-pressed': String(code === state.lang),
      on: { click: () => { sheet.close(); setLang(code); } },
    }, el('span', {}, el('span', { class: 'flag', 'aria-hidden': 'true' }, LANG_FLAG[code]), LANG_NATIVE[code]), code === state.lang ? icon('check', 18) : null)))),
  { sheet: true, label: t('cp_choose_language') });
}

screen('/create', ({ root, query }) => {
  root.classList.add('create');
  // Back from Google / Facebook: what was typed before leaving, and a word on how it went (said once).
  takeStashedDraft();
  // After "Forgot PIN?" / 5 wrong PINs: a calm note at the top and by the sign-in buttons.
  const pinAgain = pinResetPending();
  const notice = signinNotice(query) || (pinAgain ? { ok: false, icon: 'lock', text: t('pin_signin_again') } : null);
  if (query?.signin) {
    try { history.replaceState(history.state, '', '#/create'); } catch { /* the address keeps its query */ }
  }
  // A session that already proved something (e.g. phone verified, then the tab was closed).
  const pending = state.pending;
  // The box shows that number (editable) with a ✓ on the app that proved it.
  if (pending?.phoneVerified && !draft.phone.verifiedPhone && pending.phone) verifiedPhoneModel(pending.phone, draft.phone, pending.phoneVia);
  if (pending?.verified) {
    draft.verified.gmail ||= Boolean(pending.verified.gmail);
    draft.verified.facebook ||= Boolean(pending.verified.facebook);
    draft.verified.tiktok ||= Boolean(pending.verified.tiktok);
  }
  let saving = false;
  // Google / Facebook known to work (GET /auth/methods, via the phone step): only then do the notes name them.
  let signinOk = false;

  root.append(
    el('header', { class: 'brandbar' },
      // A guest who came from the home screen (the PIN chosen, owner 2026-10-13) can go back to looking.
      waitingPin() && !pinAgain
        ? el('span', { class: 'brandbar-right' },
          el('button', { type: 'button', class: 'icon-btn', 'aria-label': t('core_back'), on: { click: () => go('/nearby', { replace: true }) } }, icon('back', 18)),
          el('span', { class: 'wordmark brand' }, '30+DA'))
        : el('span', { class: 'wordmark brand' }, '30+DA'),
      el('button', { type: 'button', class: 'globe-pill', 'aria-label': t('cp_choose_language'), on: { click: languageSheet } },
        icon('globe', 15), LANG_CODES[state.lang] || state.lang.toUpperCase())),
    el('h1', { class: 'title' }, t('cp_title')),
    // root.append is the browser's own (no null-skipping like el()): '' adds nothing visible, null would print "null".
    pinAgain ? el('p', { class: 'way-msg pin-again-note', role: 'status' }, icon('lock', 14), el('span', {}, t('pin_signin_again'))) : '');

  // --- photo
  // No `capture`: the phone offers camera OR its photo library (owner 2026-10-13: pick from the phone too).
  const file = el('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
  const pick = el('button', { type: 'button', class: 'photo-pick', on: { click: () => file.click() } });
  const photoErr = el('p', { class: 'field-error', role: 'alert', hidden: true });
  const paintPhoto = () => {
    pick.classList.toggle('has-photo', Boolean(draft.photo));
    pick.setAttribute('aria-label', t(draft.photo ? 'cp_photo_change' : 'cp_photo_add'));
    pick.replaceChildren(
      draft.photo ? el('img', { src: draft.photo, alt: '' }) : icon('camera', 30),
      el('span', { class: 'badge', 'aria-hidden': 'true' }, icon('plus', 16)));
  };
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    photoErr.hidden = true;
    pick.classList.add('busy');
    try {
      draft.photo = await resizeImage(f);
      paintPhoto();
    } catch {
      photoErr.textContent = t('cp_photo_error');
      photoErr.hidden = false;
    } finally {
      pick.classList.remove('busy');
      update();
    }
  });
  paintPhoto();

  // --- photos 2–4 (optional): filled here right away, sent right after the profile is made
  if (!Array.isArray(draft.extraPhotos)) draft.extraPhotos = [null, null, null];
  // From the library as well as the camera (no capture), unlike the face photo.
  const moreFile = el('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
  const minis = el('div', { class: 'slot-minis-wrap' });
  let moreTarget = 1;
  let moreBusy = -1;
  const paintMore = (focusSlot = 0) => {
    minis.replaceChildren(moreSlots(draft.extraPhotos, {
      busy: moreBusy,
      onPick: (slot) => {
        if (moreBusy >= 0) return;
        moreTarget = slot;
        moreFile.click();
      },
      onRemove: (slot) => {
        if (moreBusy >= 0) return;
        draft.extraPhotos[slot - 1] = null;
        paintMore(slot);
      },
    }));
    // Re-drawing replaces the buttons: keep the keyboard on the tile that was used.
    if (focusSlot) minis.querySelector(`.slot-mini-dot[data-slot="${focusSlot}"]`)?.focus();
  };
  let moreRead = null; // the tile photo still being read, so Next can wait for it
  moreFile.addEventListener('change', () => {
    const f = moreFile.files?.[0];
    moreFile.value = '';
    if (!f || moreBusy >= 0) return;
    moreRead = readMore(f, moreTarget).finally(() => { moreRead = null; });
  });
  async function readMore(f, slot) {
    photoErr.hidden = true;
    moreBusy = slot;
    paintMore();
    try {
      draft.extraPhotos[slot - 1] = await resizeImage(f);
    } catch {
      photoErr.textContent = t('cp_photo_error');
      photoErr.hidden = false;
    } finally {
      moreBusy = -1;
      paintMore(slot);
    }
  }
  /** Photos 2–4 as held now, after any one still being read (Next tapped right after picking). */
  async function heldExtras() {
    await moreRead;
    return [...(draft.extraPhotos || [])];
  }
  paintMore();

  /**
   * Photos 2–4 once the profile exists: PUT /me/photos/1..3, one at a time, each into its own slot (so each keeps
   * the level it shows at). A dropped connection gets one more try. → how many could not be added.
   */
  async function addExtraPhotos(extras) {
    let missed = 0;
    for (const [k, photo] of extras.entries()) {
      if (!photo) continue;
      let done = false;
      for (let tries = 0; tries < 2 && !done; tries++) {
        try {
          setMe((await api.put(`/me/photos/${k + 1}`, { photo }, { redirect: false })).user);
          done = true;
        } catch (err) {
          if (err.status !== 0) break;
        }
      }
      if (!done) missed++;
    }
    return missed;
  }

  // The examples under the photos follow "I am": Male → the men's set, Female → the women's, else both.
  const examples = el('div', { class: 'photo-examples-wrap' });
  const paintExamples = () => examples.replaceChildren(photoExamples(draft.gender));
  paintExamples();

  // --- names + birth year
  const nameErr = el('p', { class: 'field-error', role: 'alert', hidden: true });
  // Max 7 characters, held as typed (see clipNameInput). maxlength is only the raw cap: a code-unit count of 7
  // would cut Khmer stacks short, so it stays at NAME_RAW_MAX (64), the server's code-point cap.
  const onName = (e) => {
    clipNameInput(nameInput, e);
    draft.name = nameInput.value;
    paintName();
    update();
  };
  const nameInput = watchNameInput(el('input', {
    class: 'input name-input', id: 'cp-name', type: 'text', maxlength: String(NAME_RAW_MAX), autocomplete: 'nickname', enterkeyhint: 'next',
    placeholder: t('cp_app_name_ph'), value: draft.name, 'aria-describedby': 'cp-name-rule', 'data-max-chars': String(NAME_MAX),
    on: { input: onName, compositionend: onName },
  }));
  const yearErr = el('p', { class: 'field-error', role: 'alert', hidden: true });
  const yearSel = birthYearSelect({
    id: 'cp-year', value: draft.birthYear,
    onChange: (v) => { draft.birthYear = v; yearErr.hidden = true; yearSel.classList.remove('is-error'); update(); },
  });
  const paintName = () => {
    const problem = nameProblem(draft.name);
    nameErr.textContent = problem || '';
    nameErr.hidden = !problem;
    nameInput.classList.toggle('is-error', Boolean(problem));
    nameInput.setAttribute('aria-invalid', String(Boolean(problem)));
  };
  paintName();
  const realInput = el('input', {
    class: 'input truth-field', id: 'cp-real', type: 'text', maxlength: '60', autocomplete: 'name', enterkeyhint: 'next',
    placeholder: t('cp_real_name_ph'), value: draft.realName,
    on: { input: () => { draft.realName = realInput.value; update(); } },
  });

  // --- I am (gender) + You are (role)
  const GENDER_KEYS = ['man', 'woman', 'other']; // Male / Female / Other
  const genderBtns = GENDER_KEYS.map((g) => el('button', {
    type: 'button', 'aria-pressed': String(draft.gender === g),
    on: {
      click: () => {
        draft.gender = g;
        genderBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(GENDER_KEYS[i] === g)));
        paintExamples();
        update();
      },
    },
  }, t(`cp_gender_${g}`)));
  const roleSel = el('select', {
    class: ['select', 'truth-field', !draft.role && 'placeholder'], id: 'cp-role',
    on: { change: () => { draft.role = roleSel.value; roleSel.classList.toggle('placeholder', !draft.role); update(); } },
  },
  el('option', { value: '', disabled: true, selected: !draft.role }, t('cp_choose')),
  ROLES.map((r) => el('option', { value: r.key, selected: r.key === draft.role }, roleLabel(r.key))));

  // --- phone, or Facebook / Google / TikTok: one row of 5 round buttons (Telegram · WhatsApp · Facebook · Google · TikTok)
  const phone = phoneVerifier(draft.phone, {
    onChange: () => update(),
    onMethods: (m) => { signinOk = signinWorks(m); update(); },
    onVerified: (r) => {
      if (r.existing && r.user) {
        draft = blankDraft();
        setMe(r.user);
        toast(t('cp_welcome_back', { name: r.user.name }));
        go(takeAfterCreate() || '/nearby', { replace: true });
      }
    },
    signin: {
      verified: () => draft.verified,
      onVerified: (verified) => { draft.verified = { ...draft.verified, ...verified }; },
      beforeLeave: () => { stashDraft(); leaveWithoutLock(); }, // the trip to Google / Facebook is not "closing" the app
    },
    notice,
  });

  // --- next ("Next →": owner 2026-10-13 — there is nothing to continue yet)
  const contText = el('span', { class: 'btn-text' }, t('cp_next'));
  const cont = el('button', { type: 'button', class: 'btn btn-primary', on: { click: () => submit() } }, contText, icon('arrow', 18));
  const contNote = el('p', { class: 'help center' }, t('cp_need_all'));
  const fieldsReady = () => Boolean(draft.photo && checkAppName(draft.name).ok && checkBirthYear(draft.birthYear).ok
    && charCount(draft.realName.trim()) >= 2
    && draft.gender && draft.role);
  // "Verify to chat" (owner 2026-10-13): Next works as soon as the fields are filled — verifying is only needed to
  // chat. Verified here → the profile is made as before; not → { unverified: true } (screens/verify-chat.js asks later).
  const verifiedHere = () => Boolean(draft.phone.verified || draft.verified.gmail || draft.verified.facebook || draft.verified.tiktok);
  const ready = () => fieldsReady();
  function update() {
    const ok = ready();
    cont.disabled = !ok || saving;
    // A few words, only while Next is still off: "Fill in every field first."
    contNote.hidden = ok || saving;
    contNote.textContent = t('cp_need_all');
  }

  async function submit() {
    if (!ready() || saving) return;
    // A number typed but not verified by a code (signed in with Google / Facebook) goes on the profile as an
    // unverified number; one that does not look right is flagged in the phone box instead.
    const typed = phone.typedNumber();
    if (typed?.bad) return;
    saving = true;
    update();
    contText.textContent = t('cp_saving');
    try {
      const r = await api.post('/profile', {
        name: draft.name.trim().replace(/\s+/g, ' '), birthYear: Number(draft.birthYear), realName: draft.realName.trim(),
        role: draft.role, gender: draft.gender, lang: state.lang, photo: draft.photo,
        ...(typed?.phone ? { phone: typed.phone } : {}),
        ...(waitingPin() ? { pin: waitingPin() } : {}),
        ...(verifiedHere() ? {} : { unverified: true }),
      });
      if (r.user?.pinSet) clearPinFlags();
      const extras = await heldExtras();
      draft = blankDraft();
      setMe(r.user);
      // Photos 2–4 go up now that the profile exists; one that does not make it can be added on #/me.
      if (extras.some(Boolean)) {
        contText.textContent = t('cp_adding_photos');
        if (await addExtraPhotos(extras)) toast(t('cp_photos_missed'));
      }
      contText.textContent = t('cp_locating');
      // Don't hold the new user here if the location prompt is ignored; Nearby can ask again.
      const gaveUp = new Promise((resolve) => { setTimeout(resolve, 15000); });
      await Promise.race([updateLocation().catch(() => {}), gaveUp]);
      go(takeAfterCreate() || '/nearby', { replace: true }); // back home, or to the profile the guest tapped (guest.js)
    } catch (err) {
      saving = false;
      contText.textContent = t('cp_next');
      update();
      profileError(err);
    }
  }

  function profileError(err) {
    const fieldName = err.data?.field;
    if (err.code === 'too_young' || fieldName === 'birthYear') {
      yearErr.replaceChildren(icon('flag', 14), err.code === 'too_young' ? t('cp_too_young') : t('cp_year_needed'));
      yearErr.hidden = false;
      yearSel.classList.add('is-error');
      yearSel.focus();
    } else if (err.code === 'contact_detail' || fieldName === 'name') {
      nameErr.textContent = err.code === 'contact_detail' ? t('cp_name_contact') : t('cp_name_length');
      nameErr.hidden = false;
      nameInput.classList.add('is-error');
      nameInput.focus();
    } else if (err.code === 'photo_too_large' || fieldName === 'photo') {
      photoErr.textContent = t('cp_photo_error');
      photoErr.hidden = false;
    } else if (err.code === 'phone_in_use') {
      toast(t('cp_phone_in_use'));
    } else if (fieldName === 'phone') {
      phone.flagNumber(); // the unverified number typed: the server did not take it
    } else if (err.code === 'not_verified' || err.status === 401) {
      // The session expired: what it proved is gone, so verify again.
      Object.assign(draft.phone, blankPhone(), { phone: draft.phone.phone, cc: draft.phone.cc });
      draft.verified = { gmail: false, facebook: false, tiktok: false };
      state.pending = null;
      toast(t(signinOk ? 'cp_verify_again' : 'cp_verify_again_phone'));
      go('/create', { replace: true });
    } else if (err.code === 'profile_exists') {
      go('/nearby', { replace: true });
    } else if (err.code === 'too_many_profiles') {
      toast(t('cp_too_many_profiles'), 6000); // made without verifying: a few per connection per day
    } else {
      toast(err.status === 0 ? t('err_network') : t('err_generic'));
    }
  }

  root.append(
    el('div', { class: 'form' },
      field(t('cp_photo'), null, {},
        el('div', { class: 'photo-row' }, pick,
          el('div', { class: 'photo-side' },
            el('p', { class: 'photo-hint' }, t('cp_photo_hint')),
            minis)),
        examples, photoErr, file, moreFile),
      // App name (short) and birth year side by side, the warning under both.
      el('div', { class: 'name-year-group' },
        el('div', { class: 'name-year' },
          field(t('cp_app_name'), tag(t('cp_tag_shown'), 'eye', true), { forId: 'cp-name' }, nameInput),
          field(t('cp_birth_year'), null, { forId: 'cp-year' }, yearSel)),
        el('p', { class: 'visually-hidden', id: 'cp-name-rule' }, t('cp_name_length')),
        nameErr, yearErr, truthNote()),
      field(t('cp_real_name'), tag(t('cp_tag_not_shown'), 'eye-off', false), { forId: 'cp-real' }, realInput),
      field(t('cp_i_am'), null, { labelId: 'cp-gender-l' },
        el('div', { class: 'seg', role: 'group', 'aria-labelledby': 'cp-gender-l' }, genderBtns)),
      field(t('cp_you_are'), null, { forId: 'cp-role' }, roleSel),
      field(t('cp_phone'), tag(t('cp_tag_needed_chat'), 'chat', false), { labelId: 'cp-phone-l' }, phone.node)),
    el('div', { class: 'sticky-actions' }, cont, contNote));
  update();

  return () => phone.destroy();
});

registerStrings({
  en: {
    cp_title: 'Create profile',
    cp_choose_language: 'Choose language',
    cp_photo: 'Profile photos',
    cp_photo_hint: 'Add up to 4 photos. Photo 1 shows first; the others open at Level 2 and 3.',
    cp_photo_add: 'Add a photo of your face',
    cp_photo_change: 'Change photo',
    cp_photo_error: 'This photo could not be used. Try another one.',
    cp_slot_shows: 'Shows at Level\u00a0{n}', // "Level 2" never split over two lines
    cp_slot_add: 'Add photo {slot} (shows at Level {n})',
    cp_slot_change: 'Change photo {slot} (shows at Level {n})',
    cp_slot_remove: 'Remove photo {slot}',
    cp_adding_photos: 'Adding your photos…',
    cp_photos_missed: 'Some photos could not be added. Add them again in your profile.',
    cp_ex_label: 'Photo examples',
    cp_ex_good: 'Good: {what}',
    cp_ex_bad: 'Not this: {what}',
    cp_ex_clear: 'Clear face',
    cp_ex_sunglasses: 'Sunglasses',
    cp_ex_cap: 'Cap / hat',
    cp_ex_side: 'Side face',
    cp_ex_group: 'Group photo',
    cp_app_name: 'App name',
    cp_tag_shown: 'Shown',
    cp_app_name_ph: 'Name',
    cp_real_name: 'Real name',
    cp_tag_not_shown: 'Not shown',
    cp_real_name_ph: 'First and last name',
    cp_name_length: 'Use 2 to 7 characters.',
    cp_birth_year: 'Birth year',
    cp_year_ph: 'Year',
    cp_truth: 'Tell the truth — at the end we will know.',
    cp_too_young: '30+DA is for people aged 30 and over.',
    cp_year_needed: 'Choose your birth year from the list.',
    cp_name_contact: 'No phone numbers, emails or chat handles in your name.',
    cp_i_am: 'I am',
    cp_gender_woman: 'Female',
    cp_gender_man: 'Male',
    cp_gender_other: 'Other',
    cp_you_are: 'You are',
    cp_choose: 'Choose one',
    cp_phone: 'Phone number',
    cp_tag_needed_chat: 'Needed to chat',
    cp_country_code: 'Country code',
    cp_phone_ph: '12 345 678',
    cp_code_ph: '6-digit code',
    cp_code_sent: 'We sent a code to {phone}.',
    cp_resend_in: 'Resend in {s} s',
    cp_resend: 'Resend code',
    cp_test_code: 'Test code: {code}',
    cp_phone_verified: 'Number verified ✓',
    cp_number_changed: 'This is not the number you verified. Verify it with one of the apps, or type back the verified number.',
    cp_change_number: 'Change number',
    cp_phone_invalid: 'Enter a valid phone number.',
    cp_code_wrong: 'That code is not right. Try again.',
    cp_code_expired: 'That code has expired. Ask for a new one.',
    cp_code_on_way: 'A new code is on its way. Enter the new code when it arrives.',
    cp_too_many: 'Too many tries. Please wait a few minutes.',
    cp_sms_off: 'Text messages are not available yet. Verify with Google or Facebook for now.',
    cp_ways: 'How to verify',
    cp_soon: 'Coming soon',
    cp_signin_soon: 'Sign-in with {name} is coming soon. For now, get a code on your phone.',
    cp_signin_soon_only: 'Sign-in with {name} is coming soon.',
    cp_phone_soon: 'Codes by phone are coming soon.',
    cp_signin_cancelled: 'You stopped the {name} sign-in. Nothing was saved — pick a way to verify.',
    cp_signin_expired: 'The {name} sign-in took too long. Please try again.',
    cp_signin_unavailable: 'Sign-in with {name} is not working right now. Please try again later.',
    cp_signin_failed: '{name} sign-in did not work this time. Please try again.',
    cp_verified_with: 'Verified with {name}.',
    cp_code_sent_ch: 'We sent a code to your {channel} ({phone}).',
    cp_ch_not_on: 'We could not send a {channel} code to this number. Check the number, or get the code by {other}.',
    cp_ch_failed: '{channel} codes are not working right now. Try {other}.',
    cp_ch_off: 'Codes by {channel} are not available yet. Try {other}.',
    cp_ch_try: 'Send by {channel}',
    cp_ch_not_on_only: 'We could not send a {channel} code to this number. Check the number.',
    cp_ch_failed_only: '{channel} codes are not working right now. Please try again in a little while.',
    cp_ch_off_only: 'Codes by {channel} are not available yet.',
    cp_phone_in_use: 'This phone number already has a profile.',
    cp_verified: 'Verified',
    cp_tap_app: 'Tap the app you want to verify with.',
    cp_check_next: 'Check {app} for the next step.',
    cp_check_code: 'Check {app} for your code.',
    cp_number_first: 'Type your phone number first.',
    cp_code_private: 'Only for verification — kept safe and private.',
    cp_next: 'Next',
    cp_need_all: 'Fill in every field first.',
    cp_need_way: 'Now pick a way to verify.',
    cp_saving: 'Saving…',
    cp_locating: 'Finding people near you…',
    cp_verify_again: 'Please verify your phone, Google, Facebook or TikTok again.',
    cp_verify_again_phone: 'Please verify your phone again.',
    cp_welcome_back: 'Welcome back, {name}',
  },
  km: {
    cp_title: 'បង្កើតប្រវត្តិរូប',
    cp_choose_language: 'ជ្រើសរើសភាសា',
    cp_photo: 'រូបថតប្រវត្តិរូប',
    cp_photo_hint: 'បន្ថែមរូបថតបានដល់ទៅ 4 សន្លឹក។ រូបទី 1 បង្ហាញមុនគេ ឯរូបផ្សេងទៀតបើកនៅកម្រិត 2 និង 3។',
    cp_photo_add: 'បន្ថែមរូបថតមុខរបស់អ្នក',
    cp_photo_change: 'ប្ដូររូបថត',
    cp_photo_error: 'មិនអាចប្រើរូបថតនេះបានទេ។ សូមសាកល្បងរូបផ្សេង។',
    cp_slot_shows: 'បង្ហាញនៅ\u200bកម្រិត\u00a0{n}', // may break after "បង្ហាញនៅ", never inside "កម្រិត 2"
    cp_slot_add: 'បន្ថែមរូបថតទី {slot} (បង្ហាញនៅកម្រិត {n})',
    cp_slot_change: 'ប្ដូររូបថតទី {slot} (បង្ហាញនៅកម្រិត {n})',
    cp_slot_remove: 'ដករូបថតទី {slot} ចេញ',
    cp_adding_photos: 'កំពុងបន្ថែមរូបថត…',
    cp_photos_missed: 'រូបថតខ្លះមិនអាចបន្ថែមបានទេ។ សូមបន្ថែមវាម្ដងទៀតក្នុងប្រវត្តិរូបរបស់អ្នក។',
    cp_ex_label: 'ឧទាហរណ៍រូបថត',
    cp_ex_good: 'ល្អ៖ {what}',
    cp_ex_bad: 'កុំប្រើ៖ {what}',
    cp_ex_clear: 'មុខច្បាស់',
    cp_ex_sunglasses: 'វ៉ែនតាខ្មៅ',
    cp_ex_cap: 'មួក',
    cp_ex_side: 'មុខចំហៀង',
    cp_ex_group: 'រូបថតក្រុម',
    cp_app_name: 'ឈ្មោះក្នុងកម្មវិធី',
    cp_tag_shown: 'បង្ហាញ',
    cp_app_name_ph: 'ឈ្មោះ',
    cp_real_name: 'ឈ្មោះពិត',
    cp_tag_not_shown: 'មិនបង្ហាញ',
    cp_real_name_ph: 'នាមត្រកូល និងនាមខ្លួន',
    cp_name_length: 'សូមប្រើពី 2 ដល់ 7 តួអក្សរ។',
    cp_birth_year: 'ឆ្នាំកំណើត',
    cp_year_ph: 'ឆ្នាំ',
    cp_truth: 'សូមប្រាប់ការពិត — នៅទីបញ្ចប់ យើងនឹងដឹង។',
    cp_too_young: '30+DA សម្រាប់អ្នកដែលមានអាយុពី 30 ឆ្នាំឡើងទៅ។',
    cp_year_needed: 'សូមជ្រើសរើសឆ្នាំកំណើតរបស់អ្នកពីបញ្ជី។',
    cp_name_contact: 'កុំដាក់លេខទូរស័ព្ទ អ៊ីមែល ឬឈ្មោះគណនីជជែក ក្នុងឈ្មោះរបស់អ្នក។',
    cp_i_am: 'ខ្ញុំជា',
    cp_gender_woman: 'ស្រី',
    cp_gender_man: 'ប្រុស',
    cp_gender_other: 'ផ្សេងទៀត',
    cp_you_are: 'អ្នកជា',
    cp_choose: 'ជ្រើសរើសមួយ',
    cp_phone: 'លេខទូរស័ព្ទ',
    cp_tag_needed_chat: 'ត្រូវការដើម្បីជជែក',
    cp_country_code: 'លេខកូដប្រទេស',
    cp_phone_ph: '12 345 678',
    cp_code_ph: 'លេខកូដ 6 ខ្ទង់',
    cp_code_sent: 'យើងបានផ្ញើលេខកូដទៅ {phone}។',
    cp_resend_in: 'ផ្ញើម្ដងទៀតក្នុងរយៈពេល {s} វិនាទី',
    cp_resend: 'ផ្ញើលេខកូដម្ដងទៀត',
    cp_test_code: 'លេខកូដសាកល្បង៖ {code}',
    cp_phone_verified: 'បានផ្ទៀងផ្ទាត់លេខ ✓',
    cp_number_changed: 'នេះមិនមែនជាលេខដែលអ្នកបានផ្ទៀងផ្ទាត់ទេ។ សូមផ្ទៀងផ្ទាត់វាជាមួយកម្មវិធីមួយ ឬវាយលេខដែលបានផ្ទៀងផ្ទាត់វិញ។',
    cp_change_number: 'ប្ដូរលេខ',
    cp_phone_invalid: 'សូមបញ្ចូលលេខទូរស័ព្ទឲ្យបានត្រឹមត្រូវ។',
    cp_code_wrong: 'លេខកូដនោះមិនត្រឹមត្រូវទេ។ សូមព្យាយាមម្ដងទៀត។',
    cp_code_expired: 'លេខកូដនោះផុតកំណត់ហើយ។ សូមស្នើលេខកូដថ្មី។',
    cp_code_on_way: 'លេខកូដថ្មីកំពុងផ្ញើមក។ សូមបញ្ចូលលេខកូដថ្មីនៅពេលវាមកដល់។',
    cp_too_many: 'ព្យាយាមច្រើនដងពេក។ សូមរង់ចាំប៉ុន្មាននាទីសិន។',
    cp_sms_off: 'សារ SMS មិនទាន់អាចប្រើបាននៅឡើយទេ។ សូមផ្ទៀងផ្ទាត់ជាមួយ Google ឬ Facebook សិន។',
    cp_ways: 'របៀបផ្ទៀងផ្ទាត់',
    cp_soon: 'ឆាប់ៗនេះ',
    cp_signin_soon: 'ការចូលតាម {name} នឹងមានឆាប់ៗនេះ។ សម្រាប់ពេលនេះ សូមទទួលលេខកូដតាមទូរស័ព្ទរបស់អ្នក។',
    cp_signin_soon_only: 'ការចូលតាម {name} នឹងមានឆាប់ៗនេះ។',
    cp_phone_soon: 'លេខកូដតាមទូរស័ព្ទនឹងមានឆាប់ៗនេះ។',
    cp_signin_cancelled: 'អ្នកបានបញ្ឈប់ការចូលតាម {name}។ គ្មានអ្វីត្រូវបានរក្សាទុកទេ — សូមជ្រើសរើសវិធីផ្ទៀងផ្ទាត់មួយ។',
    cp_signin_expired: 'ការចូលតាម {name} ចំណាយពេលយូរពេក។ សូមព្យាយាមម្ដងទៀត។',
    cp_signin_unavailable: 'ការចូលតាម {name} មិនដំណើរការនៅពេលនេះទេ។ សូមព្យាយាមម្ដងទៀតនៅពេលក្រោយ។',
    cp_signin_failed: 'ការចូលតាម {name} មិនបានសម្រេចលើកនេះទេ។ សូមព្យាយាមម្ដងទៀត។',
    cp_verified_with: 'បានផ្ទៀងផ្ទាត់ជាមួយ {name}។',
    cp_code_sent_ch: 'យើងបានផ្ញើលេខកូដទៅ {channel} របស់អ្នក ({phone})។',
    cp_ch_not_on: 'យើងមិនអាចផ្ញើលេខកូដតាម {channel} ទៅលេខនេះបានទេ។ សូមពិនិត្យលេខ ឬទទួលលេខកូដតាម {other}។',
    cp_ch_failed: 'ការផ្ញើលេខកូដតាម {channel} មិនដំណើរការនៅពេលនេះទេ។ សូមសាកល្បង {other}។',
    cp_ch_off: 'លេខកូដតាម {channel} មិនទាន់អាចប្រើបាននៅឡើយទេ។ សូមសាកល្បង {other}។',
    cp_ch_try: 'ផ្ញើតាម {channel}',
    cp_ch_not_on_only: 'យើងមិនអាចផ្ញើលេខកូដតាម {channel} ទៅលេខនេះបានទេ។ សូមពិនិត្យលេខ។',
    cp_ch_failed_only: 'ការផ្ញើលេខកូដតាម {channel} មិនដំណើរការនៅពេលនេះទេ។ សូមព្យាយាមម្ដងទៀតក្នុងពេលបន្តិចទៀត។',
    cp_ch_off_only: 'លេខកូដតាម {channel} មិនទាន់អាចប្រើបាននៅឡើយទេ។',
    cp_phone_in_use: 'លេខទូរស័ព្ទនេះមានប្រវត្តិរូបរួចហើយ។',
    cp_verified: 'បានផ្ទៀងផ្ទាត់',
    cp_tap_app: 'ចុចកម្មវិធីដែលអ្នកចង់ប្រើដើម្បីផ្ទៀងផ្ទាត់។',
    cp_check_next: 'សូមពិនិត្យ {app} សម្រាប់ជំហានបន្ទាប់។',
    cp_check_code: 'សូមពិនិត្យ {app} ដើម្បីយកលេខកូដរបស់អ្នក។',
    cp_number_first: 'សូមវាយលេខទូរស័ព្ទរបស់អ្នកជាមុនសិន។',
    cp_code_private: 'សម្រាប់តែការផ្ទៀងផ្ទាត់ — រក្សាទុកដោយសុវត្ថិភាព និងជាការសម្ងាត់។',
    cp_next: 'បន្ទាប់',
    cp_need_all: 'សូមបំពេញគ្រប់ចន្លោះជាមុនសិន។',
    cp_need_way: 'ឥឡូវ សូមជ្រើសរើសវិធីផ្ទៀងផ្ទាត់។',
    cp_saving: 'កំពុងរក្សាទុក…',
    cp_locating: 'កំពុងស្វែងរកមនុស្សនៅជិតអ្នក…',
    cp_verify_again: 'សូមផ្ទៀងផ្ទាត់ទូរស័ព្ទ Google, Facebook ឬ TikTok ម្ដងទៀត។',
    cp_verify_again_phone: 'សូមផ្ទៀងផ្ទាត់ទូរស័ព្ទម្ដងទៀត។',
    cp_welcome_back: 'សូមស្វាគមន៍ការត្រឡប់មកវិញ {name}',
  },
  zh: {
    cp_title: '创建个人资料',
    cp_choose_language: '选择语言',
    cp_photo: '个人照片',
    cp_photo_hint: '最多可添加 4 张照片。第 1 张最先显示，其他照片在等级 2 和 3 开放。',
    cp_photo_add: '添加正脸照片',
    cp_photo_change: '更换照片',
    cp_photo_error: '这张照片无法使用，请换一张。',
    cp_slot_shows: '等级\u00a0{n}\u00a0可见',
    cp_slot_add: '添加第 {slot} 张照片（等级 {n} 可见）',
    cp_slot_change: '更换第 {slot} 张照片（等级 {n} 可见）',
    cp_slot_remove: '删除第 {slot} 张照片',
    cp_adding_photos: '正在添加照片…',
    cp_photos_missed: '部分照片未能添加，请在个人资料中重新添加。',
    cp_ex_label: '照片示例',
    cp_ex_good: '合格：{what}',
    cp_ex_bad: '不合格：{what}',
    cp_ex_clear: '正脸清晰',
    cp_ex_sunglasses: '墨镜',
    cp_ex_cap: '帽子',
    cp_ex_side: '侧脸',
    cp_ex_group: '合照',
    cp_app_name: '应用昵称',
    cp_tag_shown: '公开',
    cp_app_name_ph: '昵称',
    cp_real_name: '真实姓名',
    cp_tag_not_shown: '不公开',
    cp_real_name_ph: '姓和名',
    cp_name_length: '请使用 2 到 7 个字符。',
    cp_birth_year: '出生年份',
    cp_year_ph: '年份',
    cp_truth: '请如实填写——最后我们都会知道。',
    cp_too_young: '30+DA 仅供 30 岁及以上的人使用。',
    cp_year_needed: '请从列表中选择你的出生年份。',
    cp_name_contact: '名字中不能包含电话、邮箱或聊天账号。',
    cp_i_am: '我是',
    cp_gender_woman: '女',
    cp_gender_man: '男',
    cp_gender_other: '其他',
    cp_you_are: '你的身份',
    cp_choose: '请选择',
    cp_phone: '手机号码',
    cp_tag_needed_chat: '聊天必需',
    cp_country_code: '国家/地区代码',
    cp_phone_ph: '12 345 678',
    cp_code_ph: '6 位验证码',
    cp_code_sent: '验证码已发送至 {phone}。',
    cp_resend_in: '{s} 秒后可重新发送',
    cp_resend: '重新发送验证码',
    cp_test_code: '测试验证码：{code}',
    cp_phone_verified: '号码已验证 ✓',
    cp_number_changed: '这不是你验证过的号码。请用其中一个应用验证它，或改回已验证的号码。',
    cp_change_number: '更换号码',
    cp_phone_invalid: '请输入有效的手机号码。',
    cp_code_wrong: '验证码不正确，请重试。',
    cp_code_expired: '验证码已过期，请重新获取。',
    cp_code_on_way: '新验证码正在发送中，收到后请输入新的验证码。',
    cp_too_many: '尝试次数过多，请稍等几分钟。',
    cp_sms_off: '短信验证暂未开通，请先用 Google 或 Facebook 验证。',
    cp_ways: '验证方式',
    cp_soon: '即将推出',
    cp_signin_soon: '{name} 登录即将推出。现在请先用手机接收验证码。',
    cp_signin_soon_only: '{name} 登录即将推出。',
    cp_phone_soon: '手机验证码即将推出。',
    cp_signin_cancelled: '你已取消 {name} 登录，没有保存任何内容。请选择一种验证方式。',
    cp_signin_expired: '{name} 登录用时太久，请再试一次。',
    cp_signin_unavailable: '{name} 登录暂时无法使用，请稍后再试。',
    cp_signin_failed: '这次 {name} 登录没有成功，请再试一次。',
    cp_verified_with: '已通过 {name} 验证。',
    cp_code_sent_ch: '验证码已发送到你的 {channel}（{phone}）。',
    cp_ch_not_on: '无法通过 {channel} 向这个号码发送验证码。请检查号码，或改用 {other} 接收。',
    cp_ch_failed: '{channel} 验证码暂时无法发送，请改用 {other}。',
    cp_ch_off: '{channel} 验证码暂未开通，请改用 {other}。',
    cp_ch_try: '改用 {channel} 发送',
    cp_ch_not_on_only: '无法通过 {channel} 向这个号码发送验证码。请检查号码。',
    cp_ch_failed_only: '{channel} 验证码暂时无法发送，请稍后再试。',
    cp_ch_off_only: '{channel} 验证码暂未开通。',
    cp_phone_in_use: '这个手机号已经有资料了。',
    cp_verified: '已验证',
    cp_tap_app: '点选你想用来验证的应用。',
    cp_check_next: '请查看 {app}，进行下一步。',
    cp_check_code: '请查看 {app} 收到的验证码。',
    cp_number_first: '请先输入你的手机号码。',
    cp_code_private: '仅用于验证——安全保密。',
    cp_next: '下一步',
    cp_need_all: '请先填写所有信息。',
    cp_need_way: '现在请选择一种验证方式。',
    cp_saving: '保存中…',
    cp_locating: '正在寻找你附近的人…',
    cp_verify_again: '请重新验证手机、Google、Facebook 或 TikTok。',
    cp_verify_again_phone: '请重新验证手机号。',
    cp_welcome_back: '欢迎回来，{name}',
  },
  ko: {
    cp_title: '프로필 만들기',
    cp_choose_language: '언어 선택',
    cp_photo: '프로필 사진',
    cp_photo_hint: '사진은 4장까지 올릴 수 있어요. 1번 사진이 먼저 보이고, 나머지는 레벨 2와 3에서 열려요.',
    cp_photo_add: '얼굴 사진 추가',
    cp_photo_change: '사진 바꾸기',
    cp_photo_error: '이 사진은 사용할 수 없어요. 다른 사진을 골라 주세요.',
    cp_slot_shows: '레벨\u00a0{n}에서 보여요',
    cp_slot_add: '사진 {slot} 추가 (레벨 {n}에서 보여요)',
    cp_slot_change: '사진 {slot} 바꾸기 (레벨 {n}에서 보여요)',
    cp_slot_remove: '사진 {slot} 빼기',
    cp_adding_photos: '사진을 올리는 중…',
    cp_photos_missed: '일부 사진을 올리지 못했어요. 내 프로필에서 다시 올려 주세요.',
    cp_ex_label: '사진 예시',
    cp_ex_good: '좋은 예: {what}',
    cp_ex_bad: '안 되는 예: {what}',
    cp_ex_clear: '또렷한 얼굴',
    cp_ex_sunglasses: '선글라스',
    cp_ex_cap: '모자',
    cp_ex_side: '옆얼굴',
    cp_ex_group: '단체 사진',
    cp_app_name: '앱 이름',
    cp_tag_shown: '공개',
    cp_app_name_ph: '이름',
    cp_real_name: '실명',
    cp_tag_not_shown: '비공개',
    cp_real_name_ph: '성과 이름',
    cp_name_length: '2~7자로 입력해 주세요.',
    cp_birth_year: '출생 연도',
    cp_year_ph: '연도',
    cp_truth: '사실대로 알려 주세요. 결국 우리는 알게 돼요.',
    cp_too_young: '30+DA는 30세 이상만 이용할 수 있어요.',
    cp_year_needed: '목록에서 출생 연도를 선택해 주세요.',
    cp_name_contact: '이름에 전화번호, 이메일, 메신저 아이디를 넣을 수 없어요.',
    cp_i_am: '나는',
    cp_gender_woman: '여성',
    cp_gender_man: '남성',
    cp_gender_other: '기타',
    cp_you_are: '하는 일',
    cp_choose: '하나를 선택하세요',
    cp_phone: '전화번호',
    cp_tag_needed_chat: '채팅에 필요',
    cp_country_code: '국가 번호',
    cp_phone_ph: '12 345 678',
    cp_code_ph: '6자리 코드',
    cp_code_sent: '{phone}(으)로 코드를 보냈어요.',
    cp_resend_in: '{s}초 후 다시 보내기',
    cp_resend: '코드 다시 받기',
    cp_test_code: '테스트 코드: {code}',
    cp_phone_verified: '번호 인증 완료 ✓',
    cp_number_changed: '인증한 번호가 아니에요. 앱 중 하나로 인증하거나, 인증한 번호로 다시 입력하세요.',
    cp_change_number: '번호 변경',
    cp_phone_invalid: '올바른 전화번호를 입력해 주세요.',
    cp_code_wrong: '코드가 맞지 않아요. 다시 입력해 주세요.',
    cp_code_expired: '코드가 만료됐어요. 새 코드를 받아 주세요.',
    cp_code_on_way: '새 코드를 보내는 중이에요. 도착하면 새 코드를 입력해 주세요.',
    cp_too_many: '시도 횟수가 너무 많아요. 몇 분 뒤에 다시 해 주세요.',
    cp_sms_off: '아직 문자 인증을 쓸 수 없어요. 지금은 Google 또는 Facebook으로 인증해 주세요.',
    cp_ways: '인증 방법',
    cp_soon: '곧 제공',
    cp_signin_soon: '{name} 로그인은 곧 제공돼요. 지금은 휴대폰으로 코드를 받아 주세요.',
    cp_signin_soon_only: '{name} 로그인은 곧 제공돼요.',
    cp_phone_soon: '휴대폰 코드 인증은 곧 제공돼요.',
    cp_signin_cancelled: '{name} 로그인을 취소했어요. 저장된 것은 없어요. 인증 방법을 골라 주세요.',
    cp_signin_expired: '{name} 로그인 시간이 너무 오래 걸렸어요. 다시 시도해 주세요.',
    cp_signin_unavailable: '지금은 {name} 로그인을 사용할 수 없어요. 잠시 후 다시 시도해 주세요.',
    cp_signin_failed: '이번에는 {name} 로그인이 되지 않았어요. 다시 시도해 주세요.',
    cp_verified_with: '{name}(으)로 인증했어요.',
    cp_code_sent_ch: '{channel}({phone})(으)로 코드를 보냈어요.',
    cp_ch_not_on: '이 번호로는 {channel} 코드를 보낼 수 없어요. 번호를 확인하거나 {other}(으)로 받아 보세요.',
    cp_ch_failed: '지금은 {channel} 코드를 보낼 수 없어요. {other}(으)로 받아 보세요.',
    cp_ch_off: '{channel} 코드는 아직 쓸 수 없어요. {other}(으)로 받아 보세요.',
    cp_ch_try: '{channel}(으)로 받기',
    cp_ch_not_on_only: '이 번호로는 {channel} 코드를 보낼 수 없어요. 번호를 확인해 주세요.',
    cp_ch_failed_only: '지금은 {channel} 코드를 보낼 수 없어요. 잠시 후 다시 시도해 주세요.',
    cp_ch_off_only: '{channel} 코드는 아직 쓸 수 없어요.',
    cp_phone_in_use: '이 전화번호로 이미 만든 프로필이 있어요.',
    cp_verified: '인증됨',
    cp_tap_app: '인증할 앱을 누르세요.',
    cp_check_next: '{app}에서 다음 단계를 확인하세요.',
    cp_check_code: '{app}에서 코드를 확인하세요.',
    cp_number_first: '먼저 전화번호를 입력하세요.',
    cp_code_private: '인증에만 쓰여요 — 안전하게 비공개로 지켜요.',
    cp_next: '다음',
    cp_need_all: '먼저 모든 항목을 채워 주세요.',
    cp_need_way: '이제 인증 방법을 골라 주세요.',
    cp_saving: '저장 중…',
    cp_locating: '근처에 있는 사람을 찾는 중…',
    cp_verify_again: '전화번호, Google, Facebook 또는 TikTok으로 다시 인증해 주세요.',
    cp_verify_again_phone: '전화번호를 다시 인증해 주세요.',
    cp_welcome_back: '다시 오신 걸 환영해요, {name}님',
  },
  ja: {
    cp_title: 'プロフィール作成',
    cp_choose_language: '言語を選択',
    cp_photo: 'プロフィール写真',
    cp_photo_hint: '写真は4枚まで追加できます。1枚目が最初に表示され、ほかはレベル2と3で表示されます。',
    cp_photo_add: '顔写真を追加',
    cp_photo_change: '写真を変更',
    cp_photo_error: 'この写真は使えません。別の写真をお試しください。',
    cp_slot_shows: 'レベル{n}で表示',
    cp_slot_add: '写真{slot}を追加（レベル{n}で表示）',
    cp_slot_change: '写真{slot}を変更（レベル{n}で表示）',
    cp_slot_remove: '写真{slot}を外す',
    cp_adding_photos: '写真を追加しています…',
    cp_photos_missed: '一部の写真を追加できませんでした。プロフィールでもう一度追加してください。',
    cp_ex_label: '写真の例',
    cp_ex_good: '良い例：{what}',
    cp_ex_bad: 'ダメな例：{what}',
    cp_ex_clear: '正面の顔',
    cp_ex_sunglasses: 'サングラス',
    cp_ex_cap: '帽子',
    cp_ex_side: '横顔',
    cp_ex_group: '集合写真',
    cp_app_name: 'アプリ名',
    cp_tag_shown: '表示',
    cp_app_name_ph: '名前',
    cp_real_name: '本名',
    cp_tag_not_shown: '非表示',
    cp_real_name_ph: '姓と名',
    cp_name_length: '2〜7文字で入力してください。',
    cp_birth_year: '生まれ年',
    cp_year_ph: '年',
    cp_truth: '正直に選んでください。最後にはわかります。',
    cp_too_young: '30+DAは30歳以上の方のためのアプリです。',
    cp_year_needed: 'リストから生まれ年を選んでください。',
    cp_name_contact: '名前に電話番号・メール・チャットIDは入れられません。',
    cp_i_am: '性別',
    cp_gender_woman: '女性',
    cp_gender_man: '男性',
    cp_gender_other: 'その他',
    cp_you_are: 'お仕事・状況',
    cp_choose: '1つ選んでください',
    cp_phone: '電話番号',
    cp_tag_needed_chat: 'チャットに必要',
    cp_country_code: '国番号',
    cp_phone_ph: '12 345 678',
    cp_code_ph: '6桁のコード',
    cp_code_sent: '{phone} にコードを送りました。',
    cp_resend_in: '{s}秒後に再送信できます',
    cp_resend: 'コードを再送信',
    cp_test_code: 'テストコード：{code}',
    cp_phone_verified: '番号を確認しました ✓',
    cp_number_changed: '確認済みの番号ではありません。アプリのどれかで確認するか、確認済みの番号に戻してください。',
    cp_change_number: '番号を変更',
    cp_phone_invalid: '正しい電話番号を入力してください。',
    cp_code_wrong: 'コードが正しくありません。もう一度お試しください。',
    cp_code_expired: 'コードの有効期限が切れました。新しいコードを送信してください。',
    cp_code_on_way: '新しいコードを送信中です。届いたら新しいコードを入力してください。',
    cp_too_many: '試行回数が多すぎます。数分お待ちください。',
    cp_sms_off: 'SMSはまだ利用できません。今はGoogleまたはFacebookで確認してください。',
    cp_ways: '確認の方法',
    cp_soon: '近日公開',
    cp_signin_soon: '{name}でのログインは近日公開です。今は電話でコードを受け取ってください。',
    cp_signin_soon_only: '{name}でのログインは近日公開です。',
    cp_phone_soon: '電話でのコード確認は近日公開です。',
    cp_signin_cancelled: '{name}でのログインを中止しました。何も保存されていません。確認方法を選んでください。',
    cp_signin_expired: '{name}でのログインに時間がかかりすぎました。もう一度お試しください。',
    cp_signin_unavailable: '今は{name}でログインできません。しばらくしてからもう一度お試しください。',
    cp_signin_failed: '今回は{name}でログインできませんでした。もう一度お試しください。',
    cp_verified_with: '{name}で確認しました。',
    cp_code_sent_ch: 'あなたの{channel}（{phone}）にコードを送りました。',
    cp_ch_not_on: 'この番号には{channel}でコードを送れませんでした。番号を確認するか、{other}で受け取ってください。',
    cp_ch_failed: '現在{channel}でコードを送れません。{other}をお試しください。',
    cp_ch_off: '{channel}でのコード送信はまだ利用できません。{other}をお試しください。',
    cp_ch_try: '{channel}で送る',
    cp_ch_not_on_only: 'この番号には{channel}でコードを送れませんでした。番号を確認してください。',
    cp_ch_failed_only: '現在{channel}でコードを送れません。しばらくしてからもう一度お試しください。',
    cp_ch_off_only: '{channel}でのコード送信はまだ利用できません。',
    cp_phone_in_use: 'この電話番号のプロフィールはすでにあります。',
    cp_verified: '確認済み',
    cp_tap_app: '確認に使うアプリをタップしてください。',
    cp_check_next: '{app} で次の手順を確認してください。',
    cp_check_code: '{app} に届いたコードを確認してください。',
    cp_number_first: '先に電話番号を入力してください。',
    cp_code_private: '確認のためだけに使います — 安全に非公開で守ります。',
    cp_next: '次へ',
    cp_need_all: 'まずすべての項目を入力してください。',
    cp_need_way: 'あとは確認方法を選んでください。',
    cp_saving: '保存中…',
    cp_locating: '近くの人を探しています…',
    cp_verify_again: '電話番号・Google・Facebook・TikTokのいずれかでもう一度確認してください。',
    cp_verify_again_phone: '電話番号をもう一度確認してください。',
    cp_welcome_back: 'おかえりなさい、{name}さん',
  },
});
