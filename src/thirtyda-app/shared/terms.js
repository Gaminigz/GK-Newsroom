// 30+DA community rules: the "I agree" (store policy, owner 2026-10-14 — Apple 1.2 / Google Play UGC: every user agrees
// to the rules before using the app, and again when they change). Imported by the server AND served to the browser
// unchanged, so: plain ES module, no Node imports, no DOM, and no regex lookbehind (older iOS Safari cannot parse it).
//
//  - The rules screen (#/rules) comes right after the language, before the PIN. A visitor's "I agree" waits on the phone
//    (localStorage TERMS_KEY: { termsVersion, agreedAt }) and goes with POST /profile, the phone-code sign-in, or
//    POST /me/terms right after any other sign-in; the server keeps it as users.terms { version, at }.
//  - TERMS_VERSION is the day the rules last changed (the terms page shows it). A new value asks every profile again
//    before anything else: the API answers 403 terms_needed (src/lib/thirtyda-terms.mjs) until POST /me/terms.

/** The day the community rules and terms last changed (YYYY-MM-DD). A new value asks everyone to agree again. */
export const TERMS_VERSION = '2026-10-14';
/** Where a visitor's "I agree" waits on the phone (localStorage) until the first sign-in / Create profile takes it. */
export const TERMS_KEY = '30da_terms';
/** A phone's agreement time is kept only when it lies in the past this long; otherwise the server's time is used. */
const PAST_MS = 400 * 864e5;

/** true when a profile's terms ({ version, at }) are the current version. */
export const termsCurrent = (terms) => Boolean(terms) && typeof terms === 'object' && terms.version === TERMS_VERSION;

/** A fresh "I agree", the way the app keeps it and sends it. */
export const newAgreement = (now = Date.now()) => ({ termsVersion: TERMS_VERSION, agreedAt: new Date(now).toISOString() });

/**
 * An agreement as the app sends it ({ termsVersion, agreedAt }) → { version, at } (at: ms since 1970) for the current
 * version, else null (an older version, or not an agreement at all). The time is the phone's when it is a real time in
 * the past 400 days (a visitor may look around for a while before signing up); otherwise `now`.
 */
export function readAgreement(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object' || raw.termsVersion !== TERMS_VERSION) return null;
  const v = raw.agreedAt;
  const at = typeof v === 'number' ? v : typeof v === 'string' && v.length <= 40 ? Date.parse(v) : NaN;
  return { version: TERMS_VERSION, at: Number.isFinite(at) && at <= now && at >= now - PAST_MS ? at : now };
}
