// The 30+DA iOS / Android app (owner 2026-10-13): a Capacitor shell around this site. Google refuses sign-in inside
// a web view, so in the app a Google / Facebook / TikTok sign-in runs in the app's own sheet instead
// (ThirtyDaShell.openAuth: iOS ASWebAuthenticationSession, Android Chrome Custom Tab). The server half, and why only
// this web view can finish what its sheet started, is in src/lib/thirtyda-signin.mjs (POST /auth/app/begin, then the
// app itself loads /30da/api/auth/app?… when the sheet is done). No UI of its own: create-profile.js uses it.
// Sign in with Apple (owner 2026-10-14): the iPhone app only (ThirtyDaShell.signInWithApple, Apple's own sheet) —
// GET /auth/apple/nonce, the sheet, POST /auth/apple (src/lib/thirtyda-apple.mjs), then the page loads where the server
// says, exactly like the way back from Google.
import { deviceIdOk } from './shared/visitor.js';

/** 'ios' | 'android' inside the app — its user agent ends "30DA-iOS/<v>" | "30DA-Android/<v>", or Capacitor says so — else null. */
export function shellPlatform() {
  const m = String(navigator.userAgent || '').trim().match(/(?:^|\s)30DA-(iOS|Android)\/[\w.+-]{0,32}$/);
  if (m) return m[1] === 'iOS' ? 'ios' : 'android';
  const cap = window.Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  const p = cap.getPlatform?.();
  return p === 'ios' || p === 'android' ? p : null;
}

/** The app's sign-in sheet, or null: the website, or an app without it (then the web sign-in as before). */
export function shellAuth() {
  const plugin = window.Capacitor?.Plugins?.ThirtyDaShell;
  return shellPlatform() && typeof plugin?.openAuth === 'function' ? plugin : null;
}

/**
 * A sign-in in the app's sheet: POST /auth/app/begin (the provider's address + a binder cookie for this web view),
 * then openAuth({ url }). → 'done' (the sheet finished: the app loads /30da/api/auth/app?… now), 'cancelled' (closed,
 * nothing changed), 'failed' (the sheet could not open) or 'left' (begin was refused — too many, keys not saved — and
 * the page went where the web sign-in would have gone). A network error is thrown, like any api call.
 */
export async function shellSignIn(api, provider, to = null) {
  const shell = shellAuth();
  if (!shell) return 'failed';
  let begun;
  try {
    begun = await api.post('/auth/app/begin', { provider, platform: shellPlatform(), ...(to ? { to } : {}) }, { redirect: false });
  } catch (err) {
    if (typeof err?.data?.back === 'string' && err.data.back.startsWith('/30da/')) {
      location.assign(err.data.back);
      return 'left';
    }
    throw err;
  }
  try {
    const out = await shell.openAuth({ url: begun.url });
    return out?.done ? 'done' : 'cancelled';
  } catch {
    return 'failed';
  }
}

/**
 * Sign in with Apple's plugin, or null. ONLY inside the 30+DA iPhone app (its user agent / Capacitor says iOS) and only
 * when the app has the plugin method: never on the website, never on Android (Apple's sign-in is the iPhone app's own).
 */
export function shellApple() {
  const plugin = window.Capacitor?.Plugins?.ThirtyDaShell;
  return shellPlatform() === 'ios' && typeof plugin?.signInWithApple === 'function' ? plugin : null;
}

/** SHA-256 of `text` as 64 hex digits (Apple puts the hash of the server's nonce into the identity token). */
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 16 random bytes as hex (the plugin's `state`, checked when it comes back). */
function randomHex() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Load `next` (a /30da/ address the server gave) afresh, like the redirect at the end of a Google sign-in: the new session
 * is read from the start. Only ever this site's /30da/; a hash-only change still reloads (replaceState, then reload).
 */
export function loadFresh(next) {
  let url;
  try { url = new URL(String(next || ''), location.href); } catch { url = null; }
  if (!url || url.origin !== location.origin || !url.pathname.startsWith('/30da/')) url = new URL('/30da/', location.href);
  if (url.pathname === location.pathname && url.search === location.search) {
    try { history.replaceState(history.state, '', url.href); } catch { location.hash = url.hash; }
    location.reload();
  } else {
    location.assign(url.href);
  }
}

/**
 * Sign in with Apple in the iPhone app: GET /auth/apple/nonce, the app's Apple sheet with sha256(nonce) (+ a state it
 * checks), POST /auth/apple with what came back (the name only the first time), then the page loads where the server
 * says (loadFresh) — signed in exactly like the way back from Google. → 'done' (loading the way back), 'cancelled'
 * (closed: nothing changed), 'failed' (no plugin, the sheet or the token did not work) or 'left' (the server refused
 * and the page went where the Google sign-in would have gone for that reason). A network error is thrown, like any api call.
 */
export async function shellAppleSignIn(api, to = null) {
  const plugin = shellApple();
  if (!plugin) return 'failed';
  const { nonce } = await api.get('/auth/apple/nonce', { redirect: false });
  if (typeof nonce !== 'string' || !nonce) return 'failed';
  let hashed;
  let state;
  try {
    hashed = await sha256Hex(nonce);
    state = randomHex();
  } catch {
    return 'failed'; // no Web Crypto here
  }
  let out;
  try {
    out = await plugin.signInWithApple({ nonce: hashed, state });
  } catch (err) {
    return /cancel/i.test(String(err?.code ?? err?.message ?? err ?? '')) ? 'cancelled' : 'failed';
  }
  if (!out || out.cancelled) return 'cancelled';
  if (typeof out.identityToken !== 'string' || !out.identityToken || (out.state != null && out.state !== state)) return 'failed';
  const str = (v) => (typeof v === 'string' && v ? v : undefined);
  let r;
  try {
    r = await api.post('/auth/apple', {
      identityToken: out.identityToken, authorizationCode: str(out.authorizationCode), nonce,
      givenName: str(out.givenName), familyName: str(out.familyName), email: str(out.email), ...(to ? { to } : {}),
    }, { redirect: false });
  } catch (err) {
    if (typeof err?.data?.back === 'string' && err.data.back.startsWith('/30da/')) {
      loadFresh(err.data.back);
      return 'left';
    }
    throw err;
  }
  loadFresh(typeof r?.next === 'string' ? r.next : '/30da/');
  return 'done';
}

/**
 * fn() whenever the person is back in this page without it reloading: it became visible again, or the app resumed
 * (Capacitor's App plugin, when the app has it). A Custom Tab trip has no unload, so pageshow never says so.
 * → stop listening.
 */
export function onAppReturn(fn) {
  const onVisible = () => { if (!document.hidden) fn(); };
  document.addEventListener('visibilitychange', onVisible);
  let handle = null;
  let stopped = false;
  try {
    const p = window.Capacitor?.Plugins?.App?.addListener?.('resume', () => fn());
    Promise.resolve(p).then((h) => { handle = h; if (stopped) h?.remove?.(); }).catch(() => {});
  } catch { /* no App plugin: visibility alone */ }
  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', onVisible);
    try { handle?.remove?.(); } catch { /* gone */ }
  };
}

const DEVICE_KEY = '30da_device'; // the website's own id for this phone (kept on it; never in a URL)

/** A random id: a UUID where the browser has one, else 32 random hex digits. */
function randomId() {
  try {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/**
 * The 30+DA app's own dictation (Android 1.0.1+: ThirtyDaShell.dictate — Google speech, Khmer included; the WebView has the
 * Web Speech constructor, but it never works there). info().dictate is true only when the phone has a recognizer; an older app has no key → false.
 */
export async function shellCanDictate() {
  const plugin = window.Capacitor?.Plugins?.ThirtyDaShell;
  if (!shellPlatform() || typeof plugin?.dictate !== 'function' || typeof plugin?.info !== 'function') return false;
  try {
    const info = await Promise.race([plugin.info(), new Promise((resolve) => { setTimeout(() => resolve(null), 1500); })]);
    return info?.dictate === true;
  } catch {
    return false;
  }
}

/** → { text } | { cancelled: true }; rejects (code 'UNAVAILABLE') only when the phone has no recognizer. */
export function shellDictate(lang) {
  return window.Capacitor.Plugins.ThirtyDaShell.dictate({ lang });
}

/**
 * This phone's id, for "one profile without verifying per phone" (owner 2026-10-14; the server keeps only a hash of it,
 * 30 days): in the 30+DA app its own id (ThirtyDaShell.info().deviceId), else a random id kept on this phone
 * (localStorage). → the id, or null (storage off and no app id: the server then only counts per address).
 */
export async function deviceId() {
  const plugin = window.Capacitor?.Plugins?.ThirtyDaShell;
  if (shellPlatform() && typeof plugin?.info === 'function') {
    try {
      const info = await Promise.race([plugin.info(), new Promise((resolve) => { setTimeout(() => resolve(null), 1500); })]);
      const id = typeof info?.deviceId === 'string' ? info.deviceId.trim() : '';
      if (deviceIdOk(id)) return id;
    } catch { /* an app without it: the kept id */ }
  }
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!deviceIdOk(id)) {
      id = randomId();
      if (!deviceIdOk(id)) return null;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}
