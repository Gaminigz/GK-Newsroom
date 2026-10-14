// The community rules' "I agree" on this phone (store policy, owner 2026-10-14; the version and its shape are in
// shared/terms.js, the screen in screens/rules.js, the server in src/lib/thirtyda-terms.mjs):
//  - A visitor's "I agree" waits in localStorage (TERMS_KEY: { termsVersion, agreedAt }) — kept when the app closes,
//    like the waiting PIN — until a sign-in or Create profile takes it: POST /profile and the phone-code sign-in carry
//    it (termsBody), and after any other sign-in (Google, Facebook, TikTok, Telegram, the apps' sheet) syncTerms()
//    sends it with POST /me/terms. Once the profile has the current version it is removed from this phone, so the next
//    person who signs in here agrees for themselves.
//  - A profile without the current version sees the rules screen before anything else (app.js guard; the API answers
//    403 terms_needed meanwhile).
import { state, api, setMe, store, TERMS_KEY, TERMS_VERSION, termsCurrent, newAgreement } from './core.js';

/** This phone's "I agree" to the current rules ({ termsVersion, agreedAt }), or null. */
export function agreedHere() {
  const a = store.get(TERMS_KEY);
  return a && typeof a === 'object' && a.termsVersion === TERMS_VERSION && typeof a.agreedAt === 'string' ? a : null;
}

/** "I agree" tapped now: kept on this phone (until a profile has it). → the agreement. */
export function keepAgreement() {
  const a = newAgreement();
  store.set(TERMS_KEY, a);
  return a;
}

/** The profile has it now (or it is out of date): nothing waits on this phone any more. */
export function clearAgreement() {
  try { localStorage.removeItem(TERMS_KEY); } catch { /* storage off: nothing was kept */ }
}

/** What POST /profile and the phone-code sign-in carry: { terms } when this phone agreed, else nothing. */
export function termsBody() {
  const a = agreedHere();
  return a ? { terms: a } : {};
}

/** Signed in, and the profile has not agreed to the current rules yet. */
export const termsNeeded = () => Boolean(state.me) && !state.me.blocked && !termsCurrent(state.me.terms);

let sending = null;
/**
 * A profile without the current rules, and this phone already agreed (before the sign-in): POST /me/terms with that
 * agreement, once at a time. → Promise<true> when the profile has the current rules now (or already had them).
 */
export function syncTerms() {
  if (!state.me || state.me.blocked) return Promise.resolve(false);
  if (termsCurrent(state.me.terms)) {
    clearAgreement();
    return Promise.resolve(true);
  }
  const a = agreedHere();
  if (!a || state.locked) return Promise.resolve(false); // locked: again once the PIN opens the app
  sending ||= (async () => {
    try {
      const r = await api.post('/me/terms', a);
      clearAgreement();
      setMe(r.user);
      return true;
    } catch (err) {
      if (err.code === 'terms_version') clearAgreement(); // agreed to an older version: read them again
      return false;
    } finally {
      sending = null;
    }
  })();
  return sending;
}
