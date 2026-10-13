// The 30+DA iOS / Android app (owner 2026-10-13): a Capacitor shell around this site. Google refuses sign-in inside
// a web view, so in the app a Google / Facebook / TikTok sign-in runs in the app's own sheet instead
// (ThirtyDaShell.openAuth: iOS ASWebAuthenticationSession, Android Chrome Custom Tab). The server half, and why only
// this web view can finish what its sheet started, is in src/lib/thirtyda-signin.mjs (POST /auth/app/begin, then the
// app itself loads /30da/api/auth/app?… when the sheet is done). No UI of its own: create-profile.js uses it.

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
