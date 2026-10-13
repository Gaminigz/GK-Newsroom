// 30+DA app lock (owner 2026-10-13, "Lock the app"): a 4-digit PIN, asked every time 30+DA opens on this phone,
// so nobody else can see the chats. The server enforces it (src/lib/thirtyda-pin.mjs); this is the app's half:
//  - Before the account exists, the PIN chosen right after the language (#/pin) waits in sessionStorage (this tab
//    only — never localStorage, never in a URL) and goes once with the first sign-in or Create profile.
//  - The PIN screen COVERS the app after 30 s with no touch / mouse / key / scroll, when the app is hidden or
//    closed, and whenever the server answers 423 (it locks by itself after 2 minutes without real use).
//    Covering takes the screen down (content removed, not blurred) and tells the server (POST /me/lock).
//  - 5 wrong PINs, or "Forgot PIN?": signed out, back to the sign-in step to sign in again and set a new PIN.
//  - A profile with no PIN yet sets one before anything else; #/me has "Change PIN".
import {
  state, bus, api, t, el, icon, go, toast, modal, setMe, registerStrings, errorText, coverScreen, uncoverScreen,
  activity, checkNewPin, pinDigits, PIN_LENGTH, IDLE_COVER_MS, LOCK_IDLE_MS, INPUT_AGE_HEADER, inputAge,
} from './core.js';

// ---------------------------------------------------------------- what waits in this tab

const WAIT_KEY = '30da_pin_wait'; // the PIN chosen before the account exists
const RESET_KEY = '30da_pin_reset'; // "Forgot PIN" / 5 wrong: after the next sign-in, set a new PIN
const BACK_KEY = '30da_back'; // the app left on purpose (a new version, the trip to Google / Facebook): no PIN on return
const BACK_MS = 10 * 60e3;

const tab = {
  get(key) { try { return sessionStorage.getItem(key); } catch { return null; } },
  set(key, v) { try { sessionStorage.setItem(key, v); } catch { /* storage off: the app asks again later */ } },
  del(key) { try { sessionStorage.removeItem(key); } catch { /* nothing kept */ } },
};

/** The PIN chosen on #/pin, waiting for the first sign-in / Create profile (null when none, or not a good one). */
export function waitingPin() {
  const v = tab.get(WAIT_KEY);
  return v && checkNewPin(v).ok ? v : null;
}
export const keepWaitingPin = (pin) => tab.set(WAIT_KEY, pin);
/** After "Forgot PIN" / 5 wrong PINs: the next sign-in is followed by "Set a new PIN". */
export const pinResetPending = () => tab.get(RESET_KEY) === '1';
const markPinReset = () => tab.set(RESET_KEY, '1');
/** A PIN was saved on the profile: nothing waits any more. */
export function clearPinFlags() {
  tab.del(WAIT_KEY);
  tab.del(RESET_KEY);
}

// ---------------------------------------------------------------- the 4 boxes

/**
 * Four big boxes that fill with dots. One real input sits on top of them (numeric keypad, Khmer and full-width
 * digits count), so typing moves from box to box by itself. onFull(pin) when the 4th digit is in.
 * light: the white version (Change PIN on #/me).
 */
export function pinPad({ onFull, light = false, show = false, step = null, label = t('pin_aria') } = {}) {
  let value = '';
  let busy = false;
  const input = el('input', {
    class: 'pin-input', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', autocorrect: 'off',
    autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done', dir: 'ltr', 'aria-label': label,
  });
  // show: the digits stay readable while setting a PIN (owner: people over 30 forget a PIN they never saw).
  const cells = Array.from({ length: PIN_LENGTH }, () => el('span', { class: 'pin-cell' }, el('i'), el('b')));
  const node = el('div', { class: ['pin-pad', light && 'light', show && 'show'] }, el('div', { class: 'pin-cells', 'aria-hidden': 'true' }, cells), input, step);
  const paint = () => {
    const focused = document.activeElement === input;
    cells.forEach((c, i) => {
      c.classList.toggle('filled', i < value.length);
      if (show) c.lastChild.textContent = value[i] ?? '';
      c.classList.toggle('current', focused && !busy && value.length < PIN_LENGTH && i === value.length);
    });
  };
  input.addEventListener('input', () => {
    if (busy) { input.value = value; return; }
    value = pinDigits(input.value).slice(0, PIN_LENGTH);
    input.value = value;
    paint();
    if (value.length === PIN_LENGTH) onFull?.(value);
  });
  input.addEventListener('focus', paint);
  input.addEventListener('blur', paint);
  // The boxes fill left to right: the caret always stays at the end.
  const toEnd = () => { try { input.setSelectionRange(value.length, value.length); } catch { /* not supported */ } };
  input.addEventListener('click', toEnd);
  input.addEventListener('keyup', toEnd);
  paint();
  return {
    node,
    input,
    focus() {
      try { input.focus({ preventScroll: true }); } catch { input.focus(); }
      toEnd();
      paint();
    },
    clear() { value = ''; input.value = ''; paint(); },
    setBusy(b) { busy = b; input.readOnly = b; node.classList.toggle('busy', b); paint(); },
    shake() {
      node.classList.remove('shake');
      void node.offsetWidth; // restart the animation
      node.classList.add('shake');
    },
  };
}

const ruleText = (error) => t(error === 'same' ? 'pin_same' : error === 'run' ? 'pin_run' : 'pin_aria');
const wrongText = (left) => (Number(left) === 1 ? t('pin_wrong_one') : t('pin_wrong', { n: left }));

/** The red line under the boxes; keeps its height so the screen never jumps. */
function errorLine(cls = 'pin-error') {
  const node = el('p', { class: cls, role: 'alert', 'aria-live': 'assertive' });
  return { node, show(text) { node.textContent = text || ''; } };
}

/**
 * Set a PIN: 4 digits, then the same 4 again. Refuses 0000-style and 1234 / 4321-style PINs with a plain line.
 * onDone(pin) → null when saved, or a line to show (the steps start again). onFirst() once the first 4 are in.
 * → { node, focus }.
 */
export function setPinSteps({ title, text, onDone, onFirst = null, light = false }) {
  let first = '';
  const titleEl = el('h1', { class: 'pin-title', id: 'pin-title' });
  const textEl = el('p', { class: 'pin-text' });
  const err = errorLine();
  // "1" then "2" beside the last box: the PIN is typed twice (owner 2026-10-13).
  const one = el('span', { class: 'pin-step-n' }, '1');
  const two = el('span', { class: 'pin-step-n' }, '2');
  const stepMark = el('span', { class: 'pin-step', 'aria-hidden': 'true' }, one, two);
  const pad = pinPad({ onFull, light, show: true, step: stepMark });
  const paint = () => {
    one.classList.toggle('on', !first);
    two.classList.toggle('on', Boolean(first));
    titleEl.textContent = first ? t('pin_again_title') : title;
    textEl.textContent = first ? t('pin_again_text') : text;
  };
  const restart = (line) => {
    first = '';
    err.show(line);
    pad.clear();
    pad.shake();
    paint();
    pad.focus();
  };
  async function onFull(pin) {
    if (!first) {
      const c = checkNewPin(pin);
      if (!c.ok) return restart(ruleText(c.error));
      first = pin;
      err.show('');
      pad.clear();
      paint();
      pad.focus();
      onFirst?.();
      return;
    }
    if (pin !== first) return restart(t('pin_mismatch'));
    pad.setBusy(true);
    let problem = null;
    try {
      problem = await onDone(pin);
    } catch (e) {
      problem = errorText(e);
    }
    if (!problem) return;
    pad.setBusy(false);
    restart(problem);
  }
  paint();
  // Owner (2026-10-13): say it under the 4 boxes — the app covers itself after 30 s without a touch or a move.
  const idle = el('p', { class: 'pin-idle-note' }, t('pin_idle_note'));
  return { node: el('div', { class: 'pin-body' }, titleEl, textEl, pad.node, err.node, idle), focus: () => pad.focus() };
}

// ---------------------------------------------------------------- the cover

const lock = {
  coverMs: IDLE_COVER_MS, // GET /me tells the real value (the demo board: 0 = never covers by itself)
  serverMs: LOCK_IDLE_MS,
  covered: false,
  mode: null, // 'enter' | 'signin' | 'set' | 'reset'
  node: null,
  focus: null,
  bootMode: null,
  leaving: false,
  picker: 0, // when a file picker / camera was opened from the app
  started: false,
};

/** GET /me (and every 423) carry { coverMs, idleMs }. */
export function applyLockInfo(info) {
  if (Number.isFinite(info?.coverMs) && info.coverMs >= 0) lock.coverMs = info.coverMs;
  if (Number.isFinite(info?.idleMs) && info.idleMs > 0) lock.serverMs = info.idleMs;
}

/** The app started on a locked session (GET /me answered 423): the PIN screen comes first. */
export function bootLock(data) {
  applyLockInfo(data?.lock);
  state.locked = true;
  lock.bootMode = data?.pin === false ? 'signin' : 'enter';
}

/**
 * The app is about to leave or reload on purpose (a new version, the trip to Google / Facebook sign-in): that
 * is not "closed", so no lock now and no PIN when it comes back (within 10 minutes, once).
 */
export function leaveWithoutLock() {
  lock.leaving = true;
  tab.set(BACK_KEY, String(Date.now()));
}

/** Coming back from leaveWithoutLock (used up). */
function cameBack() {
  const at = Number(tab.get(BACK_KEY));
  tab.del(BACK_KEY);
  return Number.isFinite(at) && at > 0 && Date.now() - at < BACK_MS;
}

const guarded = () => Boolean(state.me && state.me.pinSet && !lock.covered && lock.coverMs > 0);

function post(path) {
  try {
    fetch(`/30da/api${path}`, {
      method: 'POST', keepalive: true, credentials: 'same-origin', body: '{}',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', [INPUT_AGE_HEADER]: String(inputAge()) },
    }).catch(() => {});
  } catch { /* offline: the server locks by itself after 2 minutes */ }
}
const tellServer = () => post('/me/lock');
/** Setting a PIN is real use: the server hears it (a heartbeat right after a touch), so a slow chooser is not locked out. */
const stillHere = () => post('/me/heartbeat');

/** Cover now and tell the server (30 s idle, hidden, closed). */
function lockNow() {
  if (!guarded()) return;
  showCover('enter');
  tellServer();
}

function showCover(mode) {
  coverScreen();
  lock.covered = true;
  lock.mode = mode;
  if (!lock.node) {
    lock.node = el('div', { class: 'pin-cover', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pin-title' });
    document.body.append(lock.node);
  }
  document.body.classList.add('pin-locked');
  renderCover();
}

function hideCover() {
  lock.covered = false;
  lock.mode = null;
  lock.focus = null;
  lock.node?.remove();
  lock.node = null;
  document.body.classList.remove('pin-locked');
}

/** The PIN was right (or a PIN was just set): the app again, where it was. */
function opened(r) {
  activity.lastInputAt = Date.now();
  applyLockInfo(r?.lock);
  if (Array.isArray(r?.notices)) state.notices = r.notices;
  if (r?.user) setMe(r.user);
  hideCover();
  uncoverScreen();
  bus.dispatchEvent(new CustomEvent('unlocked'));
}

/** Signed out (5 wrong PINs, "Forgot PIN?", or a locked profile with no PIN): to the sign-in step with a calm note. */
async function signInAgain({ end = true } = {}) {
  markPinReset();
  if (end) {
    try { await api.post('/me/pin/forgot', {}, { redirect: false }); } catch { /* signed out either way */ }
  }
  Object.assign(state, { me: null, pending: null, actions: [], notices: [] });
  hideCover();
  state.locked = false;
  go('/create', { replace: true });
}

/** The PIN screen's frame: 30+DA, a lock, then the body, then the foot (also #/pin). */
export function pinFrame(body, foot = null) {
  return el('div', { class: 'pin-screen' },
    el('div', { class: 'pin-head' },
      el('span', { class: 'wordmark pin-mark', 'aria-hidden': 'true' }, '30+DA'),
      el('span', { class: 'pin-lock-icon', 'aria-hidden': 'true' }, icon('lock', 26))),
    body,
    foot ? el('div', { class: 'pin-foot' }, foot) : null);
}

function enterBody() {
  const err = errorLine();
  const pad = pinPad({ onFull });
  async function onFull(pin) {
    pad.setBusy(true);
    err.show('');
    try {
      opened(await api.post('/me/unlock', { pin }, { redirect: false }));
    } catch (e) {
      pad.setBusy(false);
      pad.clear();
      if (e.code === 'wrong_pin') {
        err.show(wrongText(e.data?.triesLeft));
        pad.shake();
        pad.focus();
      } else if (e.code === 'no_pin') {
        showCover('signin');
      } else if (e.status === 401) {
        signInAgain({ end: false }); // pin_tries: the server ended the session
      } else {
        err.show(errorText(e));
        pad.focus();
      }
    }
  }
  lock.focus = () => pad.focus();
  const forgot = el('button', { type: 'button', class: 'link pin-forgot', on: { click: () => signInAgain() } }, t('pin_forgot'));
  return pinFrame(el('div', { class: 'pin-body' },
    el('h1', { class: 'pin-title', id: 'pin-title' }, t('pin_enter_title')),
    el('p', { class: 'pin-text' }, t('pin_enter_text')),
    pad.node, err.node), forgot);
}

function signinBody() {
  lock.focus = null;
  return pinFrame(el('div', { class: 'pin-body' },
    el('h1', { class: 'pin-title', id: 'pin-title' }, t('pin_enter_title')),
    el('p', { class: 'pin-text' }, t('pin_no_pin_text'))),
  el('button', { type: 'button', class: 'btn btn-light', on: { click: () => signInAgain() } }, t('pin_signin_btn')));
}

/** First PIN ('set') or a new one after "Forgot PIN?" + sign-in ('reset'): POST /me/pin { pin }. */
function setBody(mode) {
  const steps = setPinSteps({
    title: t(mode === 'reset' ? 'pin_new_title' : 'pin_set_title'),
    text: t('pin_set_text'),
    onFirst: stillHere,
    async onDone(pin) {
      try {
        const r = await api.post('/me/pin', { pin }, { redirect: false });
        clearPinFlags();
        toast(t('pin_saved'));
        opened(r);
        return null;
      } catch (e) {
        if (e.status === 423) { showCover(e.data?.pin === false ? 'signin' : 'enter'); return null; }
        if (e.code === 'old_pin_needed' || e.status === 401) { signInAgain({ end: e.status !== 401 }); return null; }
        if (e.code === 'weak_pin') return ruleText(e.data?.reason);
        return errorText(e);
      }
    },
  });
  lock.focus = steps.focus;
  return pinFrame(steps.node);
}

function renderCover() {
  if (!lock.node) return;
  const mode = lock.mode;
  lock.node.replaceChildren(mode === 'enter' ? enterBody() : mode === 'signin' ? signinBody() : setBody(mode));
  lock.node.scrollTop = 0;
  // A tap brings the keyboard on phones; on a computer the boxes take the keys at once.
  lock.focus?.();
}

// ---------------------------------------------------------------- after every sign-in

let afterBusy = false;
/**
 * A person is signed in (boot, sign-in, Create profile, unlock): the PIN that waited goes now (Google / Facebook
 * came back to the app); after "Forgot PIN?" a new PIN is set; a profile with no PIN sets one before anything else.
 */
async function afterUser() {
  const me = state.me;
  if (!me || me.blocked || lock.covered || afterBusy) return;
  const wait = waitingPin();
  if (wait) {
    afterBusy = true;
    try {
      const r = await api.post('/me/pin', { pin: wait }, { redirect: false });
      clearPinFlags();
      setMe(r.user);
      toast(t('pin_saved'));
      return;
    } catch (e) {
      tab.del(WAIT_KEY); // used once: not a fresh sign-in any more, or refused
      if (e.status === 423) return; // the 'locked' event covers the app
      lockNow(); // refused: this was no fresh sign-in, so the PIN it already has comes first
      return;
    } finally {
      afterBusy = false;
    }
  }
  if (!state.me || lock.covered) return;
  if (pinResetPending()) showCover('reset');
  else if (!state.me.pinSet) showCover('set');
}

// ---------------------------------------------------------------- watching

function onHidden() {
  if (lock.leaving) return;
  // The app opened the photo picker / camera itself: that is not leaving the app.
  if (lock.picker && Date.now() - lock.picker < lock.serverMs) return;
  lockNow();
}

function onVisible() {
  if (lock.picker) {
    lock.picker = 0;
    activity.lastInputAt = Date.now();
  }
  if (lock.covered) lock.focus?.();
}

/** Start the lock (app.js, once the session is known): timers, visibility, and the first cover if needed. */
export function startLock() {
  if (lock.started) return;
  lock.started = true;
  bus.addEventListener('me', afterUser);
  bus.addEventListener('locked', (e) => {
    applyLockInfo(e.detail?.lock);
    const mode = e.detail?.pin === false ? 'signin' : 'enter';
    if (lock.covered && (lock.mode === mode || lock.mode === 'enter')) return;
    showCover(mode);
  });
  // 30 s without a touch → covered. A photo picker opened from the app pauses it (until the server's own limit).
  setInterval(() => {
    if (!guarded()) return;
    if (lock.picker && Date.now() - lock.picker < lock.serverMs) return;
    if (Date.now() - activity.lastInputAt >= lock.coverMs) lockNow();
  }, 1000);
  document.addEventListener('click', (e) => {
    if (e.target instanceof HTMLInputElement && e.target.type === 'file') lock.picker = Date.now();
  }, true);
  for (const type of ['change', 'cancel']) {
    document.addEventListener(type, (e) => {
      if (e.target instanceof HTMLInputElement && e.target.type === 'file') {
        lock.picker = 0;
        activity.lastInputAt = Date.now();
      }
    }, true);
  }
  window.addEventListener('focus', () => { if (lock.picker && !document.hidden) onVisible(); });
  document.addEventListener('visibilitychange', () => (document.hidden ? onHidden() : onVisible()));
  window.addEventListener('pagehide', onHidden);
  window.addEventListener('pageshow', () => { lock.leaving = false; });

  // Every time 30+DA opens, the PIN comes first: a reload or a new tab too (the server may not have had the
  // closing tab's lock yet). Not after the app's own reload or the trip to Google / Facebook (cameBack).
  const back = cameBack();
  if (lock.bootMode) {
    showCover(lock.bootMode);
    lock.bootMode = null;
  } else if (!back && !waitingPin() && !pinResetPending()) {
    lockNow();
  }
  afterUser();
}

// ---------------------------------------------------------------- #/me: Change PIN

/** "Change PIN" on #/me: the PIN now, then the new one twice. A wrong PIN counts like on the lock screen. */
export function changePinSheet() {
  let old = '';
  let first = '';
  const title = el('h2', { class: 'sheet-title', id: 'pin-change-title' });
  const text = el('p', { class: 'help' });
  const err = errorLine('field-error pin-sheet-error');
  const pad = pinPad({ onFull, light: true });
  const sheet = modal(el('div', { class: 'sheet-body pin-sheet', 'aria-labelledby': 'pin-change-title' }, title, text, pad.node, err.node),
    { sheet: true, label: t('pin_change') });
  const paint = () => {
    title.textContent = !old ? t('pin_old_title') : !first ? t('pin_new_title') : t('pin_again_title');
    text.textContent = !old ? t('pin_old_text') : !first ? t('pin_set_text_short') : t('pin_again_text');
  };
  const step = (line = '') => {
    err.show(line);
    pad.clear();
    paint();
    pad.focus();
  };
  async function onFull(pin) {
    if (!old) {
      // Check the PIN now first, so a wrong one is said at once (it counts as a try, like on the lock screen).
      pad.setBusy(true);
      try {
        await api.post('/me/unlock', { pin }, { redirect: false });
        old = pin;
        pad.setBusy(false);
        return step();
      } catch (e) {
        pad.setBusy(false);
        return failed(e);
      }
    }
    if (!first) {
      const c = checkNewPin(pin);
      if (!c.ok) { pad.shake(); return step(ruleText(c.error)); }
      first = pin;
      return step();
    }
    if (pin !== first) {
      first = '';
      pad.shake();
      return step(t('pin_mismatch'));
    }
    pad.setBusy(true);
    try {
      const r = await api.post('/me/pin', { old, pin }, { redirect: false });
      clearPinFlags();
      setMe(r.user);
      sheet.close();
      toast(t('pin_changed'));
    } catch (e) {
      pad.setBusy(false);
      first = '';
      if (e.code === 'wrong_pin') old = '';
      failed(e);
    }
  }
  function failed(e) {
    if (e.code === 'wrong_pin') { pad.shake(); return step(wrongText(e.data?.triesLeft)); }
    if (e.status === 401) { sheet.close(); return signInAgain({ end: false }); }
    if (e.status === 423) { sheet.close(); return showCover(e.data?.pin === false ? 'signin' : 'enter'); }
    if (e.code === 'weak_pin') return step(ruleText(e.data?.reason));
    return step(errorText(e));
  }
  paint();
  pad.focus();
  return sheet;
}

registerStrings({
  en: {
    pin_aria: 'PIN, 4 numbers',
    pin_set_title: 'Set your PIN',
    pin_new_title: 'Set a new PIN',
    pin_set_text: '4 numbers. You type them each time you open 30+DA, so nobody else can see your chats.',
    pin_set_text_short: '4 numbers you will remember.',
    pin_again_title: 'Type it again',
    pin_again_text: 'The same 4 numbers.',
    pin_same: 'Too easy to guess. Not 4 of the same number, like 1111.',
    pin_run: 'Too easy to guess. Not numbers in a row, like 1234.',
    pin_mismatch: 'Not the same. Start again.',
    pin_enter_title: 'Enter your PIN',
    pin_enter_text: '30+DA is locked.',
    pin_wrong: 'Wrong PIN. {n} tries left.',
    pin_wrong_one: 'Wrong PIN. 1 try left.',
    pin_forgot: 'Forgot PIN?',
    pin_signin_again: 'Sign in again to set a new PIN.',
    pin_signin_btn: 'Sign in again',
    pin_no_pin_text: 'Sign in again to open 30+DA.',
    pin_change: 'Change PIN',
    pin_old_title: 'Your PIN now',
    pin_old_text: 'Type the PIN you use now.',
    pin_changed: 'PIN changed',
    pin_saved: 'PIN saved',
    pin_idle_note: 'Locks after 30 seconds without touch or movement.',
  },
  km: {
    pin_aria: 'លេខ PIN 4 ខ្ទង់',
    pin_set_title: 'កំណត់លេខ PIN របស់អ្នក',
    pin_new_title: 'កំណត់លេខ PIN ថ្មី',
    pin_set_text: 'លេខ 4 ខ្ទង់។ អ្នកវាយវារាល់ពេលបើក 30+DA ដូច្នេះគ្មាននរណាផ្សេងអាចមើលការជជែករបស់អ្នកបានទេ។',
    pin_set_text_short: 'លេខ 4 ខ្ទង់ដែលអ្នកចាំបាន។',
    pin_again_title: 'វាយម្ដងទៀត',
    pin_again_text: 'លេខ 4 ខ្ទង់ដដែល។',
    pin_same: 'ងាយទាយពេក។ កុំប្រើលេខដូចគ្នាទាំង 4 ដូចជា 1111។',
    pin_run: 'ងាយទាយពេក។ កុំប្រើលេខរៀងតាមលំដាប់ ដូចជា 1234។',
    pin_mismatch: 'មិនដូចគ្នាទេ។ សូមចាប់ផ្ដើមម្ដងទៀត។',
    pin_enter_title: 'វាយលេខ PIN របស់អ្នក',
    pin_enter_text: '30+DA ត្រូវបានចាក់សោ។',
    pin_wrong: 'លេខ PIN ខុស។ នៅសល់ {n} ដងទៀត។',
    pin_wrong_one: 'លេខ PIN ខុស។ នៅសល់ 1 ដងទៀត។',
    pin_forgot: 'ភ្លេចលេខ PIN?',
    pin_signin_again: 'សូមចូលម្ដងទៀត ដើម្បីកំណត់លេខ PIN ថ្មី។',
    pin_signin_btn: 'ចូលម្ដងទៀត',
    pin_no_pin_text: 'សូមចូលម្ដងទៀត ដើម្បីបើក 30+DA។',
    pin_change: 'ប្ដូរលេខ PIN',
    pin_old_title: 'លេខ PIN បច្ចុប្បន្ន',
    pin_old_text: 'វាយលេខ PIN ដែលអ្នកកំពុងប្រើ។',
    pin_changed: 'បានប្ដូរលេខ PIN',
    pin_saved: 'បានរក្សាទុកលេខ PIN',
    pin_idle_note: 'ចាក់សោក្រោយ 30 វិនាទី បើគ្មានការប៉ះ ឬចលនា។',
  },
  zh: {
    pin_aria: 'PIN 码，4 位数字',
    pin_set_title: '设置你的 PIN 码',
    pin_new_title: '设置新的 PIN 码',
    pin_set_text: '4 位数字。每次打开 30+DA 都要输入，这样别人看不到你的聊天。',
    pin_set_text_short: '你记得住的 4 位数字。',
    pin_again_title: '再输入一次',
    pin_again_text: '同样的 4 位数字。',
    pin_same: '太容易猜到。不要用 4 个相同的数字，比如 1111。',
    pin_run: '太容易猜到。不要用连续的数字，比如 1234。',
    pin_mismatch: '两次不一样。请重新开始。',
    pin_enter_title: '输入你的 PIN 码',
    pin_enter_text: '30+DA 已锁定。',
    pin_wrong: 'PIN 码不对。还可以试 {n} 次。',
    pin_wrong_one: 'PIN 码不对。还可以试 1 次。',
    pin_forgot: '忘记 PIN 码？',
    pin_signin_again: '请重新登录，设置新的 PIN 码。',
    pin_signin_btn: '重新登录',
    pin_no_pin_text: '请重新登录以打开 30+DA。',
    pin_change: '更改 PIN 码',
    pin_old_title: '现在的 PIN 码',
    pin_old_text: '输入你现在用的 PIN 码。',
    pin_changed: 'PIN 码已更改',
    pin_saved: 'PIN 码已保存',
    pin_idle_note: '30 秒没有触摸或移动就会锁定。',
  },
  ko: {
    pin_aria: 'PIN, 숫자 4개',
    pin_set_title: 'PIN 설정',
    pin_new_title: '새 PIN 설정',
    pin_set_text: '숫자 4개. 30+DA를 열 때마다 입력해요. 그래서 다른 사람은 내 채팅을 볼 수 없어요.',
    pin_set_text_short: '기억할 수 있는 숫자 4개.',
    pin_again_title: '한 번 더 입력하세요',
    pin_again_text: '같은 숫자 4개.',
    pin_same: '너무 쉬워요. 1111처럼 같은 숫자 4개는 안 돼요.',
    pin_run: '너무 쉬워요. 1234처럼 이어지는 숫자는 안 돼요.',
    pin_mismatch: '서로 달라요. 처음부터 다시 해 주세요.',
    pin_enter_title: 'PIN을 입력하세요',
    pin_enter_text: '30+DA가 잠겨 있어요.',
    pin_wrong: 'PIN이 틀렸어요. {n}번 남았어요.',
    pin_wrong_one: 'PIN이 틀렸어요. 1번 남았어요.',
    pin_forgot: 'PIN을 잊으셨나요?',
    pin_signin_again: '다시 로그인해서 새 PIN을 설정하세요.',
    pin_signin_btn: '다시 로그인',
    pin_no_pin_text: '30+DA를 열려면 다시 로그인하세요.',
    pin_change: 'PIN 변경',
    pin_old_title: '지금 PIN',
    pin_old_text: '지금 쓰는 PIN을 입력하세요.',
    pin_changed: 'PIN을 바꿨어요',
    pin_saved: 'PIN을 저장했어요',
    pin_idle_note: '30초 동안 터치나 움직임이 없으면 잠겨요.',
  },
  ja: {
    pin_aria: 'PIN、数字4桁',
    pin_set_title: 'PINを設定',
    pin_new_title: '新しいPINを設定',
    pin_set_text: '数字4桁。30+DAを開くたびに入力するので、ほかの人にチャットを見られません。',
    pin_set_text_short: '覚えやすい数字4桁。',
    pin_again_title: 'もう一度入力',
    pin_again_text: '同じ数字4桁。',
    pin_same: '推測されやすいです。1111のような同じ数字4つは使えません。',
    pin_run: '推測されやすいです。1234のような連続した数字は使えません。',
    pin_mismatch: '一致しません。最初からやり直してください。',
    pin_enter_title: 'PINを入力',
    pin_enter_text: '30+DAはロックされています。',
    pin_wrong: 'PINが違います。あと{n}回。',
    pin_wrong_one: 'PINが違います。あと1回。',
    pin_forgot: 'PINを忘れた場合',
    pin_signin_again: 'もう一度ログインして、新しいPINを設定してください。',
    pin_signin_btn: 'もう一度ログイン',
    pin_no_pin_text: '30+DAを開くには、もう一度ログインしてください。',
    pin_change: 'PINを変更',
    pin_old_title: '今のPIN',
    pin_old_text: '今使っているPINを入力してください。',
    pin_changed: 'PINを変更しました',
    pin_saved: 'PINを保存しました',
    pin_idle_note: '30秒間タッチや操作がないとロックされます。',
  },
});
