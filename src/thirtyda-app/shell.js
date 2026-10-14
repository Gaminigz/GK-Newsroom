// The 30+DA iOS / Android app (owner 2026-10-13): a Capacitor shell around this site. Google refuses sign-in inside
// a web view, so in the app a Google / Facebook / TikTok sign-in runs in the app's own sheet instead
// (ThirtyDaShell.openAuth: iOS ASWebAuthenticationSession, Android Chrome Custom Tab). The server half, and why only
// this web view can finish what its sheet started, is in src/lib/thirtyda-signin.mjs (POST /auth/app/begin, then the
// app itself loads /30da/api/auth/app?… when the sheet is done). No UI of its own: create-profile.js uses it.
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
