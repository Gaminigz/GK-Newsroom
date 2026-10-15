// 30+DA app lock (owner 2026-10-13, "Lock the app"): a 4-digit PIN, asked every time 30+DA opens on this phone,
// so nobody else can see the chats. The server enforces it (src/lib/thirtyda-pin.mjs); this is the app's half:
//  - Before the account exists, the PIN chosen right after the language (#/pin) waits on this phone (localStorage —
//    owner 2026-10-14: the language and the PIN survive closing the app; never in a URL) and goes once with the first
//    sign-in or Create profile; then it is removed. A visitor who chose one gets "Enter your PIN" each time the app opens
//    again, checked here on the phone against the waiting PIN (there is no account yet), then the home screen.
//  - The PIN screen COVERS the app after 30 s with no touch / mouse / key / scroll, when the app is hidden or
//    closed, and whenever the server answers 423 (it locks by itself after 2 minutes without real use).
//    Covering takes the screen down (content removed, not blurred) and tells the server (POST /me/lock).
//  - No try limit (owner 2026-10-14: "they can punch it 1000 times, we do not care"): a wrong PIN says "Wrong PIN. Try
//    again." and asks again, never "n tries left", never a sign-out. (The server's only brake is for scripts: 429.)
//  - "Forgot PIN?" (owner 2026-10-15): signed out, then "Sign in to set a new PIN" (#/signin, screens/create-profile.js) —
//    only the sign-in buttons, the profile's own way first — never the Create profile form; signed back in, a new PIN.
//    An App review demo account: signed out, back to the visitor "Set your PIN" (#/pin), where a demo PIN signs in.
//  - A profile with no PIN yet sets one before anything else; #/me has "Change PIN".
import {
  state, bus, api, t, el, icon, go, toast, modal, setMe, setLang, registerStrings, errorText, coverScreen, uncoverScreen,
  activity, checkNewPin, pinDigits, PIN_LENGTH, IDLE_COVER_MS, LOCK_IDLE_MS, INPUT_AGE_HEADER, inputAge, termsCurrent,
} from './core.js';
import { onAppReturn, deviceId } from './shell.js';
import { termsBody } from './terms.js';
// "Forgot PIN?": the ways that sign the profile back in, names only (the server's answer, or the profile on this phone).
import { cleanWays, waysBackOf } from './shared/ways.js';

// ---------------------------------------------------------------- what waits on this phone

const WAIT_KEY = '30da_pin_wait'; // the PIN chosen before the account exists
const RESET_KEY = '30da_pin_reset'; // "Forgot PIN": after the next sign-in, set a new PIN
const WAYS_KEY = '30da_pin_ways'; // "Forgot PIN": the profile's own ways back in (names only), for #/signin
const FORGOT_KEY = '30da_pin_forgot'; // #/signin came from the "Forgot PIN?" button (not a session that ended, no PIN)
const REVIEW_BACK_KEY = '30da_review_back'; // "Forgot PIN?" on a demo account that agreed: #/pin before the rules (this tab)
const BACK_KEY = '30da_back'; // the app left on purpose (a new version, the trip to Google / Facebook): no PIN on return
const BACK_MS = 10 * 60e3;

const storageOf = (area) => ({
  get(key) { try { return area().getItem(key); } catch { return null; } },
  set(key, v) { try { area().setItem(key, v); } catch { /* storage off: the app asks again later */ } },
  del(key) { try { area().removeItem(key); } catch { /* nothing kept */ } },
});
/** This tab only: the way back from our own reload / the sign-in trip (a closed app must ask for the PIN again). */
const tab = storageOf(() => sessionStorage);
/** Kept on this phone when the app closes (owner 2026-10-14): the waiting PIN and the "set a new PIN" flag. */
const kept = storageOf(() => localStorage);
// An older version kept them in this tab only: moved once (a reload for a new version keeps the tab).
for (const key of [WAIT_KEY, RESET_KEY]) {
  const v = tab.get(key);
  if (v == null) continue;
  if (kept.get(key) == null) kept.set(key, v);
  tab.del(key);
}
// An older version kept the demo PINs answered "No, this is my own PIN" (that question is gone, owner 2026-10-14).
kept.del('30da_review_no');

/** The PIN chosen on #/pin, waiting for the first sign-in / Create profile (null when none, or not a good one). */
export function waitingPin() {
  const v = kept.get(WAIT_KEY);
  return v && checkNewPin(v).ok ? v : null;
}
export const keepWaitingPin = (pin) => kept.set(WAIT_KEY, pin);
/** After "Forgot PIN": the next sign-in is followed by "Set a new PIN". */
export const pinResetPending = () => kept.get(RESET_KEY) === '1';
/** forgot: the "Forgot PIN?" button itself (#/signin then says "Forgot your PIN?"), not a session that ended or no PIN. */
function markPinReset(forgot) {
  kept.set(RESET_KEY, '1');
  if (forgot) kept.set(FORGOT_KEY, '1');
  else kept.del(FORGOT_KEY);
}
/** #/signin came from "Forgot PIN?" (else: signed out elsewhere, or a profile with no PIN — no "Forgot your PIN?"). */
export const pinForgotten = () => kept.get(FORGOT_KEY) === '1';
/**
 * "Forgot PIN?" on an App review demo account that had agreed to the current rules (demoForgot): "Set your PIN" (#/pin)
 * may open before the rules, in this tab only (app.js guard), so a demo PIN goes straight back in — that account's own
 * agreement takes it to Nearby. Never an "I agree" on this phone: termsBody never carries it, and anyone who goes on as a
 * visitor meets the rules on the next screen (the guard honours it for #/pin only). Gone with clearPinFlags.
 */
export const reviewBackPending = () => tab.get(REVIEW_BACK_KEY) === '1';
/**
 * After "Forgot PIN": the profile's own ways back in ('telegram', 'google'…: names only, shared/ways.js), kept on this phone
 * like the "set a new PIN" flag so #/signin offers them first — also after the trip to Google & co. or a closed app. null:
 * nothing kept (an older phone, cleared storage, a profile with none): #/signin offers every way.
 */
export function pinResetWays() {
  let list = null;
  try { list = JSON.parse(kept.get(WAYS_KEY) ?? 'null'); } catch { return null; }
  const ways = cleanWays(list);
  return ways.length ? ways : null;
}
const keepPinWays = (ways) => kept.set(WAYS_KEY, JSON.stringify(cleanWays(ways)));
/** A PIN was saved on the profile: nothing waits any more. */
export function clearPinFlags() {
  kept.del(WAIT_KEY);
  kept.del(RESET_KEY);
  kept.del(WAYS_KEY);
  kept.del(FORGOT_KEY);
  tab.del(REVIEW_BACK_KEY);
}

// ---------------------------------------------------------------- the 4 boxes

/**
 * Four big boxes that fill with dots. One real input sits on top of them (numeric keypad, Khmer and full-width
 * digits count), so typing moves from box to box by itself. onFull(pin) when the 4th digit is in; onDigit() on
 * every change (typing is a touch, also on phone keyboards that send no key events).
 * light: the white version (Change PIN on #/me).
 */
export function pinPad({ onFull, onDigit = null, light = false, show = false, step = null, label = t('pin_aria') } = {}) {
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
    activity.lastInputAt = Date.now();
    paint();
    onDigit?.();
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
/**
 * A PIN check that failed: "Wrong PIN. Try again." (no count, ever), or the server's script brake (429 too_many_tries,
 * which never lasts more than a minute: "Too many tries. Wait a minute.").
 */
const pinFailText = (e) => (e?.code === 'wrong_pin' ? t('pin_wrong') : e?.code === 'too_many_tries' ? t('pin_too_many') : errorText(e));
/**
 * The review sign-in failed (POST /auth/review/pin): not a demo PIN, or one of its 15-minute limits per address
 * (too_many_attempts: too many wrong review PINs; rate_limited: verify-code's address limit) → "Wait 15 minutes".
 */
const reviewFailText = (e) => (e?.code === 'not_review' ? t('review_wrong')
  : e?.code === 'too_many_attempts' || e?.code === 'rate_limited' ? t('review_too_many')
    : pinFailText(e));

/** The red line under the boxes; keeps its height so the screen never jumps. */
function errorLine(cls = 'pin-error') {
  const node = el('p', { class: cls, role: 'alert', 'aria-live': 'assertive' });
  return { node, show(text) { node.textContent = text || ''; } };
}

/**
 * Set a PIN: 4 digits, then the same 4 again. Refuses 0000-style and 1234 / 4321-style PINs with a plain line.
 * onDone(pin) → null when saved, or a line to show (the steps start again). onFirst() once the first 4 are in;
 * onDigit() on every digit typed. checkFirst(pin) (#/pin: reviewPinSignIn) is asked about the first 4 before "Type it
 * again": true → it took over (the demo account is signing in), anything else → the steps go on. → { node, focus }.
 */
export function setPinSteps({ title, text, onDone, onFirst = null, onDigit = null, checkFirst = null, light = false }) {
  let first = '';
  const titleEl = el('h1', { class: 'pin-title', id: 'pin-title' });
  const textEl = el('p', { class: 'pin-text' });
  const err = errorLine();
  // "1" then "2" beside the last box: the PIN is typed twice (owner 2026-10-13).
  const one = el('span', { class: 'pin-step-n' }, '1');
  const two = el('span', { class: 'pin-step-n' }, '2');
  const stepMark = el('span', { class: 'pin-step', 'aria-hidden': 'true' }, one, two);
  const pad = pinPad({ onFull, onDigit, light, show: true, step: stepMark });
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
      if (checkFirst) {
        pad.setBusy(true);
        const took = await Promise.resolve().then(() => checkFirst(pin)).catch(() => false);
        pad.setBusy(false);
        if (took === true) return;
      }
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
  mode: null, // 'enter' | 'signin' | 'set' | 'reset' | 'guest' (a visitor's waiting PIN, checked on the phone)
  node: null,
  focus: null,
  bootMode: null,
  leaving: false,
  leavingAt: 0, // leaving counts for BACK_MS at most (leavingNow)
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
  lock.leavingAt = Date.now();
  tab.set(BACK_KEY, String(lock.leavingAt));
}

/** Left on purpose, and not longer ago than BACK_MS (10 minutes, like the way back): no lock on hiding meanwhile. */
const leavingNow = () => lock.leaving && Date.now() - lock.leavingAt < BACK_MS;

/** How long "back from the app's sign-in sheet" waits before leaving ends (the app's own load of the sign-in's end may follow). */
const RETURN_GRACE_MS = 3000;
let returnTimer = 0;

/**
 * The 30+DA app's sign-in sheet (shell.js) is closed, or the person is back in the app: a Custom Tab trip has no
 * unload, so pageshow never ends `leaving` and hiding the app would never lock it again. Ended here — after a short
 * wait, because when the sheet DID sign in, the app loads /30da/api/auth/app?… right away, and that unload must not
 * lock the session (the claim would then be refused). Still here after the wait: no sign-in followed, so the way back
 * is used up too (the next open asks for the PIN). touched: the person closed the sheet themselves (a tap, like
 * choosing a photo), so the 30 s without a touch starts again.
 */
export function backFromSheet({ touched = false } = {}) {
  if (touched) activity.lastInputAt = Date.now();
  if (!lock.leaving) return;
  clearTimeout(returnTimer);
  const at = lock.leavingAt;
  returnTimer = setTimeout(() => {
    if (lock.leavingAt !== at || document.hidden) return;
    lock.leaving = false;
    tab.del(BACK_KEY);
  }, RETURN_GRACE_MS);
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
/**
 * Setting a PIN is real use: the server hears it (a heartbeat right after a touch), so a person who is typing is
 * never locked out by the server's 2-minute window. At most every 5 s (sooner when the window is shortened).
 */
let stillAt = 0;
function stillHere() {
  const now = Date.now();
  if (now - stillAt < Math.min(5e3, lock.serverMs / 4)) return;
  stillAt = now;
  post('/me/heartbeat');
}

/** Cover now and tell the server (30 s idle, hidden, closed). */
function lockNow() {
  // Away on purpose (the sign-in sheet, our own reload): not "closed" — until leaving ends or runs out (10 minutes).
  if (!guarded() || leavingNow()) return;
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

/**
 * Signed out ("Forgot PIN?", a locked profile with no PIN, or the session ended elsewhere) → "Sign in to set a new PIN"
 * (#/signin, owner 2026-10-15): only the sign-in buttons, never the Create profile form. The profile's own ways go along
 * (pinResetWays): the server's answer to POST /me/pin/forgot (names only), else the profile this phone still knows (the
 * lock covered a running app), else none (every way). "Set a new PIN" follows the sign-in (afterUser).
 * An App review demo account (the answer's review, or the profile here): its PIN never changes in the app, so there is
 * nothing to reset — demoForgot.
 * forgot: the "Forgot PIN?" button itself — only then does #/signin say "Forgot your PIN?" (pinForgotten).
 */
async function signInAgain({ end = true, forgot = false } = {}) {
  const here = state.me;
  if (here?.review !== true) markPinReset(forgot); // first: a closed app still comes back to "sign in, then a new PIN"
  let r = null;
  if (end) {
    try { r = await api.post('/me/pin/forgot', {}, { redirect: false }); } catch { /* signed out either way */ }
  }
  const ways = Array.isArray(r?.ways) && r.ways.length ? r.ways : waysBackOf(here);
  const agreed = r?.agreed === true || termsCurrent(here?.terms);
  Object.assign(state, { me: null, pending: null, actions: [], notices: [] });
  hideCover();
  state.locked = false;
  if (r?.review === true || (!r && here?.review === true)) return demoForgot(agreed);
  markPinReset(forgot); // (again: the profile here may have stopped being a demo account meanwhile)
  if (cleanWays(ways).length) keepPinWays(ways); // nothing known now: what an earlier "Forgot PIN?" kept stays
  go('/signin', { replace: true });
}

/**
 * "Forgot PIN?" on an App review demo account (owner 2026-10-15): signed out of this phone and back to the visitor "Set
 * your PIN" (#/pin), where a demo PIN signs straight in (reviewPinSignIn) — never the verify step, and the demo account's
 * PIN stays as it is (only the admin's page writes it). Nothing waits for a new PIN. agreed (the demo account had agreed
 * to the current rules): #/pin opens before the rules, in this tab only (reviewBackPending) — never an "I agree" made up
 * on this phone: nobody tapped it, and Create profile / a sign-in would send it as that person's (termsBody).
 */
function demoForgot(agreed) {
  clearPinFlags();
  if (agreed) tab.set(REVIEW_BACK_KEY, '1');
  go('/pin', { replace: true });
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

/**
 * What the lock screen sends with the PIN (POST /me/unlock): lockScreen — this screen's own check (Change PIN's check of
 * the PIN now sends none), so on an App review demo account the server may answer another demo account's PIN by
 * switching this phone to it (owner 2026-10-15). It always carries what the demo sign-in carries (reviewSignInBody: the
 * "I agree" on this phone, this phone's id): an app opened on a locked session knows no profile here (GET /me answered
 * 423, state.me null), so this screen cannot tell a demo account from a real one. The server reads them only inside
 * that switch (reviewLockSwitch, after isReview); a real profile's unlock ignores them.
 */
async function unlockBody(pin) {
  return { ...(await reviewSignInBody(pin)), lockScreen: true };
}

function enterBody() {
  const err = errorLine();
  const pad = pinPad({ onFull });
  async function onFull(pin) {
    pad.setBusy(true);
    err.show('');
    let r;
    try {
      r = await api.post('/me/unlock', await unlockBody(pin), { redirect: false });
    } catch (e) {
      pad.setBusy(false);
      pad.clear();
      if (e.code === 'wrong_pin') {
        err.show(pinFailText(e)); // "Wrong PIN. Try again." — as often as it takes
        pad.shake();
        pad.focus();
      } else if (e.code === 'no_pin') {
        showCover('signin');
      } else if (e.status === 401) {
        signInAgain({ end: false }); // the session ended elsewhere (signed out on another phone, deleted)
      } else {
        // (A demo account's switch can meet the review sign-in's own 15-minute limits: reviewFailText says so.)
        err.show(reviewFailText(e));
        pad.focus();
      }
      return;
    }
    // App review (owner 2026-10-15): the server took this PIN as ANOTHER demo account's — this phone is that account now,
    // signed in like the demo sign-in (same language, Nearby, a fresh boot).
    if (r?.switched === true) return reviewSignedIn(r);
    opened(r);
  }
  lock.focus = () => pad.focus();
  const forgot = el('button', { type: 'button', class: 'link pin-forgot', on: { click: () => signInAgain({ forgot: true }) } }, t('pin_forgot'));
  return pinFrame(el('div', { class: 'pin-body' },
    el('h1', { class: 'pin-title', id: 'pin-title' }, t('pin_enter_title')),
    el('p', { class: 'pin-text' }, t('pin_enter_text')),
    pad.node, err.node), forgot);
}

// ---------------------------------------------------------------- "App review" (owner 2026-10-14)

// Store reviewers sign in with the demo account's PIN ONLY, and only while GET /auth/methods says review:true (the
// admin's "Review sign-in" switch). Two ways, both on the VISITOR PIN screens only — "Set your PIN" (#/pin) and a
// visitor's "Enter your PIN" (guestBody), i.e. a phone with no profile; never on the lock of a signed-in profile, where
// it would swap a real person's profile for a demo one:
//  - a small outlined "App review sign-in" button (reviewLink → reviewSheet: type the demo PIN);
//  - typing a demo PIN (owner 2026-10-14: "it should be right now only 1122 and 3344 in the system") SIGNS STRAIGHT IN
//    (reviewPinSignIn): the server is asked first whether it is a demo PIN (probe: never signs in, never counts as a
//    wrong sign-in), and on yes the normal sign-in follows at once — no question, no sheet. Switch OFF: nothing is asked
//    and the screen goes on as before.
// Never a global PIN match: the server compares review accounts' PINs only (POST /auth/review/pin,
// src/lib/thirtyda-review.mjs), so a real person's own PIN only ever reaches a demo account while the switch is ON.
// One exception on a signed-in lock (owner 2026-10-15, "test accounts switch by PIN"): a demo account's OWN lock screen —
// there another demo account's PIN switches this phone to that account. The server decides it inside POST /me/unlock
// { lockScreen } (its own PIN first; a real profile's lock never compares a demo PIN); this screen asks nothing itself and
// only follows the answer (enterBody: switched → reviewSignedIn).
let reviewOn = null; // { at, value } — GET /auth/methods, kept a minute
async function reviewShown() {
  if (reviewOn && Date.now() - reviewOn.at < 60e3) return reviewOn.value;
  try {
    const m = await api.get('/auth/methods', { redirect: false });
    reviewOn = { at: Date.now(), value: m?.review === true };
  } catch {
    reviewOn = null;
    return false;
  }
  return reviewOn.value;
}

/** "App review sign-in": a small outlined button in an empty slot that fills only when review sign-in is on. → the node. */
export function reviewLink() {
  const slot = el('div', { class: 'pin-review' });
  reviewShown().then((on) => {
    if (!on) return;
    slot.append(el('button', { type: 'button', class: 'btn btn-ghost-light btn-sm btn-auto pin-review-btn', on: { click: reviewSheet } }, t('review_link')));
  });
  return slot;
}

// A demo sign-in whose language could not be saved on the account (PATCH /me failed twice): { id, lang } kept in THIS
// tab across our own reload, read once by the boot (keepReviewLang), so the reviewer still lands in the picked language.
const REVIEW_LANG_KEY = '30da_review_lang';

/** PATCH /me { lang } on the demo account just signed in: one retry (a blip). → the account as saved, or null. */
async function saveReviewLang(lang) {
  for (let i = 0; i < 2; i += 1) {
    try {
      return (await api.patch('/me', { lang }, { redirect: false }))?.user ?? null;
    } catch { /* once more, then the boot keeps it (keepReviewLang) */ }
  }
  return null;
}

/**
 * The boot (app.js, right after setMe) after a demo sign-in whose language could not be saved: the picked language
 * again, for that same account only, and one more try to save it (the account's own would come back with the next
 * answer that carries it). Read once: the flag goes whatever it says.
 */
export function keepReviewLang(user) {
  const raw = tab.get(REVIEW_LANG_KEY);
  if (raw == null) return;
  tab.del(REVIEW_LANG_KEY);
  let v = null;
  try { v = JSON.parse(raw); } catch { return; }
  if (!user || v?.id !== user.id || typeof v.lang !== 'string' || v.lang === user.lang) return;
  setLang(v.lang, { rerender: false });
  state.me = { ...state.me, lang: v.lang };
  api.patch('/me', { lang: v.lang }, { redirect: false })
    .then((saved) => { if (saved?.user && state.me?.id === saved.user.id) state.me = { ...state.me, lang: saved.user.lang }; })
    .catch(() => { /* this boot keeps it; nothing more to do */ });
}

/**
 * The demo sign-in's body (POST /auth/review/pin): the PIN, the "I agree" kept on this phone, and this phone's id — while
 * review sign-in is ON that phone may make fresh profiles to try Delete my account (src/lib/thirtyda-review-world.mjs).
 */
async function reviewSignInBody(pin) {
  const device = await deviceId().catch(() => null);
  return { pin, ...termsBody(), ...(device ? { deviceId: device } : {}) };
}

/**
 * Signed in as the demo account (POST /auth/review/pin answered, or POST /me/unlock switched a demo account's lock screen
 * to another demo account): nothing waits on this phone any more (the demo account
 * keeps its own PIN). The demo account takes the language picked on the opening screen (iOS session 2026-10-14, owner
 * agreed: a reviewer who picked English never lands in Khmer) — saved on it (PATCH /me { lang }: a language-only change
 * is the one a demo account allows; one retry) BEFORE the fresh boot, which reads it back. Not saved even then: the
 * fresh boot reads it from this tab instead (REVIEW_LANG_KEY → keepReviewLang), since GET /me brings back the account's
 * own. Then a fresh boot on Nearby (Android 2026-10-14: Nearby kept the guest's empty list until a reload). Our own
 * reload: no PIN lock on the way back.
 */
async function reviewSignedIn(r) {
  clearPinFlags();
  const lang = state.lang; // the language picked on the opening screen (setMe below would switch to the account's)
  let user = r?.user ?? null;
  if (user && user.lang !== lang) {
    const saved = await saveReviewLang(lang);
    if (saved) user = saved;
    else {
      tab.set(REVIEW_LANG_KEY, JSON.stringify({ id: user.id, lang })); // the boot after the reload keeps it
      user = { ...user, lang };
    }
  }
  if (lock.covered) opened({ ...r, user });
  else {
    applyLockInfo(r?.lock);
    if (Array.isArray(r?.notices)) state.notices = r.notices;
    setMe(user);
  }
  activity.lastInputAt = Date.now();
  go('/nearby', { replace: true });
  leaveWithoutLock();
  history.replaceState(null, '', '/30da/#/nearby');
  location.reload();
}

/** "Sign in for app review": the app's 4 boxes, Cancel. Right PIN → signed in and OPEN (no second PIN) → Nearby. */
function reviewSheet() {
  const err = errorLine('field-error pin-sheet-error');
  const pad = pinPad({ onFull, light: true, label: t('review_title') });
  const cancel = el('button', { type: 'button', class: 'btn btn-secondary pin-review-cancel', on: { click: () => sheet.close() } }, t('review_cancel'));
  const sheet = modal(el('div', { class: 'sheet-body pin-sheet', 'aria-labelledby': 'review-title' },
    el('h2', { class: 'sheet-title', id: 'review-title' }, t('review_title')),
    el('p', { class: 'help' }, t('review_text')),
    pad.node, err.node, cancel), { sheet: true, label: t('review_title') });
  async function onFull(pin) {
    pad.setBusy(true);
    err.show('');
    let r;
    try {
      r = await api.post('/auth/review/pin', await reviewSignInBody(pin), { redirect: false });
    } catch (e) {
      pad.setBusy(false);
      pad.clear();
      pad.shake();
      if (e.status === 404) { reviewOn = null; sheet.close(); return; } // switched off meanwhile
      err.show(reviewFailText(e));
      pad.focus();
      return;
    }
    sheet.close();
    await reviewSignedIn(r);
  }
  pad.focus();
}

/**
 * A PIN typed on a visitor PIN screen ("Set your PIN", or "Enter your PIN" — a wrong one, and the visitor's own one
 * too: a phone that already chose 1122 must still reach the demo): while review sign-in is on, ask the server whether
 * it is a demo account's PIN (POST /auth/review/pin { pin, probe: true } — never signs in, never a session) and, if it
 * is, SIGN STRAIGHT IN with it (the normal sign-in + the fresh boot; owner 2026-10-14: no confirm sheet). Off, not a
 * demo PIN, no answer, or the sign-in refused → false (the screen goes on as before; a refusal says why). Signed in →
 * true (the app reloads as the demo account).
 * within (ms): give up on the question after that long → false (the visitor's own right PIN never waits on the network).
 * onRefused(text): a demo PIN whose sign-in was refused (e.g. verify-code's address limit behind a reviewer's shared
 * address) — the reason, for a screen that shows it itself. A visitor's "Enter your PIN" is a COVER, and a cover hides
 * every toast (pin.css), so it must not end as a toast there (it would read as "Wrong PIN"). Without it: a toast
 * ("Set your PIN" is a route, the toast shows).
 */
export async function reviewPinSignIn(pin, { within = 0, onRefused = null } = {}) {
  const ask = (async () => {
    if (!(await reviewShown())) return false; // switched off: nothing is asked
    try {
      const probe = await api.post('/auth/review/pin', { pin, probe: true }, { redirect: false });
      return probe?.review === true;
    } catch (e) {
      if (e.status === 404) reviewOn = null; // switched off meanwhile
      return false; // not a demo PIN (400 not_review), too many (429), offline: as before
    }
  })();
  const demo = await (within > 0 ? Promise.race([ask, new Promise((r) => { setTimeout(() => r(false), within); })]) : ask);
  if (demo !== true) return false;
  let r;
  try {
    r = await api.post('/auth/review/pin', await reviewSignInBody(pin), { redirect: false });
  } catch (e) {
    if (e.status === 404) reviewOn = null; // switched off meanwhile: as before
    else if (onRefused) onRefused(reviewFailText(e));
    else toast(reviewFailText(e));
    return false;
  }
  await reviewSignedIn(r);
  return true;
}

// A visitor with a waiting PIN and no profile yet (owner 2026-10-14): the app opens again on "Enter your PIN", checked
// here against the PIN kept on this phone, then the home screen. A wrong one just asks again (no limit); "Forgot PIN?":
// that PIN is forgotten and a new one is set (#/pin) — nothing stands behind it yet but the home screen.
// While review sign-in is on, a demo PIN typed here signs straight into the demo account — a wrong one AND the
// visitor's own (owner 2026-10-14: his iPhone already had visitor PIN 1122 and kept "landing on a fresh profile").

/** How long the visitor's own right PIN waits for "is this a demo PIN?" before the home screen opens anyway. */
const GUEST_ASK_MS = 4000;

/** The right waiting PIN: the home screen. */
function guestOpened() {
  activity.lastInputAt = Date.now();
  hideCover();
  go('/nearby', { replace: true }); // still covered: this only sets the address …
  uncoverScreen(); // … and the home screen draws now
}

/** "Forgot PIN?": the waiting PIN goes, the visitor sets a new one. */
function forgetGuestPin() {
  clearPinFlags();
  hideCover();
  go('/pin', { replace: true });
  uncoverScreen();
}

function guestBody() {
  const err = errorLine();
  const pad = pinPad({ onFull });
  async function onFull(pin) {
    const want = waitingPin();
    if (!want) return forgetGuestPin();
    pad.setBusy(true);
    err.show('');
    if (pin === want) {
      // This phone's own PIN, and maybe a demo PIN too (a reviewer, or a phone that chose 1122 before): while review
      // sign-in is on it signs into the demo; not a demo PIN, no answer in time or switched off → the home screen.
      let refused = '';
      const took = await reviewPinSignIn(pin, { within: GUEST_ASK_MS, onRefused: (text) => { refused = text; } }).catch(() => false);
      if (took) return;
      guestOpened();
      if (refused) toast(refused); // a demo PIN whose sign-in was refused: said once the cover is gone (it hides toasts)
      return;
    }
    // Not this phone's PIN: maybe a store reviewer typing the demo PIN (signs straight in while review sign-in is on).
    // A demo PIN whose sign-in was refused says why in this screen's own line (a cover hides toasts), not "Wrong PIN".
    let refused = '';
    const took = await reviewPinSignIn(pin, { onRefused: (text) => { refused = text; } }).catch(() => false);
    if (took) return;
    pad.setBusy(false);
    pad.clear();
    err.show(refused || t('pin_wrong')); // "Wrong PIN. Try again." — as often as it takes
    pad.shake();
    pad.focus();
  }
  lock.focus = () => pad.focus();
  const forgot = el('button', { type: 'button', class: 'link pin-forgot', on: { click: () => forgetGuestPin() } }, t('pin_forgot'));
  // App review (owner 2026-10-14): also here — a phone with NO profile — while review sign-in is on.
  return pinFrame(el('div', { class: 'pin-body' },
    el('h1', { class: 'pin-title', id: 'pin-title' }, t('pin_enter_title')),
    el('p', { class: 'pin-text' }, t('pin_enter_text')),
    pad.node, err.node), [forgot, reviewLink()]);
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
    onDigit: stillHere,
    async onDone(pin) {
      try {
        const r = await api.post('/me/pin', { pin }, { redirect: false });
        clearPinFlags();
        toast(t('pin_saved'));
        opened(r);
        return null;
      } catch (e) {
        // The server's window ran out while the new PIN was being chosen. After "Forgot PIN?" the old PIN is the
        // one they do not know: sign in again (the calm note), never "Enter your PIN".
        if (e.status === 423 && mode === 'reset') { signInAgain(); return null; }
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
  lock.node.replaceChildren(mode === 'enter' ? enterBody() : mode === 'guest' ? guestBody() : mode === 'signin' ? signinBody() : setBody(mode));
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
      kept.del(WAIT_KEY); // used once: not a fresh sign-in any more, or refused
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

/**
 * The app opened the photo picker / camera itself: that is not leaving the app — for as long as the app may be
 * left alone anyway (the 30 s cover time). Only choosing or cancelling (the file input's change / cancel) is a
 * touch; coming back is not, so a long time away with the picker open still ends on the PIN screen.
 */
const pickerOpen = () => Boolean(lock.picker) && Date.now() - lock.picker < lock.coverMs;

function onHidden() {
  if (leavingNow()) return;
  if (pickerOpen()) return;
  lockNow();
}

function onVisible() {
  if (lock.picker && !pickerOpen()) lock.picker = 0;
  // Back after longer than the cover time without a touch (the picker was open): covered before anything shows.
  if (!lock.picker && guarded() && Date.now() - activity.lastInputAt >= lock.coverMs) lockNow();
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
  // 30 s without a touch → covered. A photo picker opened from the app pauses it (for the same 30 s at most).
  setInterval(() => {
    if (!guarded()) return;
    if (pickerOpen()) return;
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
  // Back in the app after its sign-in sheet (no unload, so no pageshow): leaving ends (see backFromSheet).
  onAppReturn(() => backFromSheet());

  // Every time 30+DA opens, the PIN comes first: a reload or a new tab too (the server may not have had the
  // closing tab's lock yet). Not after the app's own reload or the trip to Google / Facebook (cameBack).
  // A visitor with a waiting PIN and no profile yet: "Enter your PIN" too, checked on the phone (guestBody).
  const back = cameBack();
  if (lock.bootMode) {
    showCover(lock.bootMode);
    lock.bootMode = null;
  } else if (!back && !state.me && waitingPin()) {
    showCover('guest');
  } else if (!back && !waitingPin() && !pinResetPending()) {
    lockNow();
  }
  afterUser();
}

// ---------------------------------------------------------------- #/me: Change PIN

/** "Change PIN" on #/me: the PIN now, then the new one twice. A wrong PIN just asks again, like on the lock screen. */
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
      // Check the PIN now first, so a wrong one is said at once (no limit, like on the lock screen).
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
    if (e.code === 'wrong_pin') { pad.shake(); return step(pinFailText(e)); } // "Wrong PIN. Try again."
    if (e.status === 401) { sheet.close(); return signInAgain({ end: false }); }
    if (e.status === 423) { sheet.close(); return showCover(e.data?.pin === false ? 'signin' : 'enter'); }
    if (e.code === 'weak_pin') return step(ruleText(e.data?.reason));
    return step(pinFailText(e));
  }
  paint();
  pad.focus();
  return sheet;
}

registerStrings({
  en: {
    review_link: 'App review sign-in',
    review_title: 'Sign in for app review',
    review_text: 'Type the demo account\'s 4-digit PIN.',
    review_wrong: 'That PIN is not a review account.',
    review_too_many: 'Too many tries. Wait 15 minutes.',
    review_cancel: 'Cancel',
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
    pin_wrong: 'Wrong PIN. Try again.',
    pin_too_many: 'Too many tries. Wait a minute.',
    pin_forgot: 'Forgot PIN?',
    pin_forgot_title: 'Sign in to set a new PIN',
    pin_forgot_text: 'Forgot your PIN? Sign in again the way you signed up, then set a new PIN.',
    pin_signin_text: 'Sign in again the way you signed up, then set a new PIN.',
    pin_forgot_yours: 'You signed up with',
    pin_forgot_number: 'Type the same phone number, then tap the app.',
    pin_other_way: 'Use another way',
    pin_other_warn: 'A different way may make a NEW profile.',
    pin_new_profile: 'No profile uses this way yet, so this makes a NEW profile. Not you?',
    pin_back_signin: 'Sign in the way you signed up',
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
    review_link: 'ចូលសម្រាប់ការពិនិត្យកម្មវិធី',
    review_title: 'ចូលសម្រាប់ការពិនិត្យកម្មវិធី',
    review_text: 'វាយលេខ PIN 4 ខ្ទង់ របស់គណនីសាកល្បង។',
    review_wrong: 'លេខ PIN នេះមិនមែនជាគណនីសម្រាប់ពិនិត្យទេ។',
    review_too_many: 'ព្យាយាមច្រើនដងពេក។ សូមរង់ចាំ 15 នាទី។',
    review_cancel: 'បោះបង់',
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
    pin_wrong: 'លេខ PIN ខុស។ សូមព្យាយាមម្ដងទៀត។',
    pin_too_many: 'ព្យាយាមច្រើនដងពេក។ សូមរង់ចាំមួយនាទី។',
    pin_forgot: 'ភ្លេចលេខ PIN?',
    pin_forgot_title: 'ចូលដើម្បីកំណត់លេខ PIN ថ្មី',
    pin_forgot_text: 'ភ្លេចលេខ PIN? សូមចូលម្ដងទៀតតាមវិធីដែលអ្នកបានចុះឈ្មោះ រួចកំណត់លេខ PIN ថ្មី។',
    pin_signin_text: 'សូមចូលម្ដងទៀតតាមវិធីដែលអ្នកបានចុះឈ្មោះ រួចកំណត់លេខ PIN ថ្មី។',
    pin_forgot_yours: 'អ្នកបានចុះឈ្មោះដោយប្រើ',
    pin_forgot_number: 'វាយលេខទូរស័ព្ទដដែល រួចចុចកម្មវិធី។',
    pin_other_way: 'ប្រើវិធីផ្សេង',
    pin_other_warn: 'វិធីផ្សេងអាចបង្កើតប្រវត្តិរូបថ្មី។',
    pin_new_profile: 'មិនទាន់មានប្រវត្តិរូបណាប្រើវិធីនេះទេ ដូច្នេះវានឹងបង្កើតប្រវត្តិរូបថ្មី។ មិនមែនអ្នកទេ?',
    pin_back_signin: 'ចូលតាមវិធីដែលអ្នកបានចុះឈ្មោះ',
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
    review_link: '应用审核登录',
    review_title: '应用审核登录',
    review_text: '输入演示账号的 4 位 PIN 码。',
    review_wrong: '这个 PIN 码不是审核账号。',
    review_too_many: '尝试次数太多。请等 15 分钟。',
    review_cancel: '取消',
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
    pin_wrong: 'PIN 码不对。请再试一次。',
    pin_too_many: '尝试次数太多。请等一分钟。',
    pin_forgot: '忘记 PIN 码？',
    pin_forgot_title: '登录以设置新的 PIN 码',
    pin_forgot_text: '忘记 PIN 码？请用注册时的方式重新登录，然后设置新的 PIN 码。',
    pin_signin_text: '请用注册时的方式重新登录，然后设置新的 PIN 码。',
    pin_forgot_yours: '你注册时用的是',
    pin_forgot_number: '输入同一个手机号码，然后点应用。',
    pin_other_way: '用其他方式',
    pin_other_warn: '用其他方式可能会创建一个新的资料。',
    pin_new_profile: '还没有资料使用这个方式，所以会创建一个新的资料。不是你想要的？',
    pin_back_signin: '用注册时的方式登录',
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
    review_link: '앱 심사용 로그인',
    review_title: '앱 심사용 로그인',
    review_text: '데모 계정의 4자리 PIN을 입력하세요.',
    review_wrong: '이 PIN은 심사용 계정이 아니에요.',
    review_too_many: '시도가 너무 많아요. 15분 기다려 주세요.',
    review_cancel: '취소',
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
    pin_wrong: 'PIN이 틀렸어요. 다시 해 보세요.',
    pin_too_many: '시도가 너무 많아요. 1분만 기다려 주세요.',
    pin_forgot: 'PIN을 잊으셨나요?',
    pin_forgot_title: '로그인하고 새 PIN 설정',
    pin_forgot_text: 'PIN을 잊으셨나요? 가입할 때 쓴 방법으로 다시 로그인한 뒤 새 PIN을 설정하세요.',
    pin_signin_text: '가입할 때 쓴 방법으로 다시 로그인한 뒤 새 PIN을 설정하세요.',
    pin_forgot_yours: '가입할 때 쓴 방법',
    pin_forgot_number: '같은 전화번호를 입력하고 앱을 누르세요.',
    pin_other_way: '다른 방법 사용',
    pin_other_warn: '다른 방법을 쓰면 새 프로필이 만들어질 수 있어요.',
    pin_new_profile: '이 방법을 쓰는 프로필이 아직 없어서 새 프로필이 만들어져요. 원하신 게 아닌가요?',
    pin_back_signin: '가입할 때 쓴 방법으로 로그인',
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
    review_link: 'アプリ審査用ログイン',
    review_title: 'アプリ審査用ログイン',
    review_text: 'デモアカウントの4桁のPINを入力してください。',
    review_wrong: 'このPINは審査用アカウントではありません。',
    review_too_many: '試行回数が多すぎます。15分待ってください。',
    review_cancel: 'キャンセル',
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
    pin_wrong: 'PINが違います。もう一度入力してください。',
    pin_too_many: '試行回数が多すぎます。1分ほどお待ちください。',
    pin_forgot: 'PINを忘れた場合',
    pin_forgot_title: 'ログインして新しいPINを設定',
    pin_forgot_text: 'PINを忘れた場合は、登録したときと同じ方法でもう一度ログインし、新しいPINを設定してください。',
    pin_signin_text: '登録したときと同じ方法でもう一度ログインし、新しいPINを設定してください。',
    pin_forgot_yours: '登録した方法',
    pin_forgot_number: '同じ電話番号を入力して、アプリを押してください。',
    pin_other_way: '別の方法を使う',
    pin_other_warn: '別の方法では、新しいプロフィールが作られることがあります。',
    pin_new_profile: 'この方法を使うプロフィールはまだないため、新しいプロフィールが作られます。違いますか？',
    pin_back_signin: '登録した方法でログイン',
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
