// 30+DA "Forgot PIN?" (owner 2026-10-15: "when click forgot pin it land on a new fresh profile page, supposed it should
// send a new login code to tiktok or fb or google or tg"): the ways that sign a profile back in, as NAMES only. Imported by
// the server (POST /me/pin/forgot answers them, src/lib/thirtyda-app.mjs) AND served to the browser unchanged (lock.js keeps
// them on the phone for "Sign in to set a new PIN", #/signin in screens/create-profile.js), so: plain ES module, no Node
// imports, no DOM, and no regex lookbehind (older iOS Safari cannot even parse it).
//
//  - The phone: the app that last proved the number (MeView.phoneVia) — 'telegram' (the free bot or the Gateway code) or
//    'whatsapp' — else 'phone' (an SMS code, or proved before phoneVia was kept). A code by either app to the SAME number
//    signs into the same profile (the server finds the profile by its number).
//  - An account kept on the profile (MeView.signins: Google, Facebook, TikTok, Apple): only those sign back into it — a
//    verified mark without the account's id (test mode's instant sign-in) would make a new profile instead.
//  - Never the number, an email or an account id: only these names leave the server.

/** The phone's ways: the app that proved it, or 'phone' (not known which: any code app to the same number). */
export const PHONE_WAYS = ['telegram', 'whatsapp', 'phone'];
/** The accounts a profile can keep (the server's ACCOUNT_PROVIDERS). Apple shows only inside the iPhone app. */
export const ACCOUNT_WAYS = ['google', 'facebook', 'tiktok', 'apple'];
/** Every way name, in the order they are answered and kept. */
export const SIGNIN_WAYS = [...PHONE_WAYS, ...ACCOUNT_WAYS];

/**
 * A profile as its owner sees it (MeView: verified, phone, phoneVia, signins, review) → the ways that sign it back in, in
 * SIGNIN_WAYS order. An App review demo account: none (it signs in by its PIN only, src/lib/thirtyda-review.mjs). A profile
 * made without verifying: none (nothing can bring it back). null / no profile → [].
 */
export function waysBackOf(me) {
  if (!me || typeof me !== 'object' || me.review === true) return [];
  const out = [];
  if (me.verified?.phone === true && me.phone) out.push(me.phoneVia === 'telegram' || me.phoneVia === 'whatsapp' ? me.phoneVia : 'phone');
  for (const way of ACCOUNT_WAYS) if (me.signins?.[way] === true) out.push(way);
  return out;
}

/** A list from the server's answer or the phone's storage → the known way names only, each once, in SIGNIN_WAYS order. */
export function cleanWays(list) {
  if (!Array.isArray(list)) return [];
  return SIGNIN_WAYS.filter((way) => list.includes(way));
}

/**
 * The round buttons of the sign-in step (screens/create-profile.js phoneVerifier) that are a way's own, best first. The
 * phone is the NUMBER: the app that proved it first, then the other code app to the same number (either may be off: the
 * Telegram button then shows "Coming soon" and says to use WhatsApp, a WhatsApp button is hidden) — 'phone' (not known
 * which) → both. An account → its own button.
 */
export function wayButtons(ways) {
  const out = [];
  for (const way of cleanWays(ways)) {
    const number = way === 'whatsapp' ? ['whatsapp', 'telegram'] : ['telegram', 'whatsapp']; // its app first, then the other
    const keys = PHONE_WAYS.includes(way) ? number : [way];
    for (const key of keys) if (!out.includes(key)) out.push(key);
  }
  return out;
}

/**
 * #/signin's row: `row` = the round buttons this phone shows (keys, in the usual order: Apple only in the iPhone app,
 * WhatsApp only while it works), `own` = the profile's own (wayButtons). → { show: the keys to show, in order; mine: the
 * ones to mark }: its own first and ALONE — or, once "Use another way" (`all`), with the rest after them. None of its own
 * on this row (nothing kept, or e.g. Apple on Android) → the row as it is, nothing marked: every way.
 */
export function pickWays(row, own, all = false) {
  const keys = Array.isArray(row) ? row : [];
  const mine = (Array.isArray(own) ? own : []).filter((key, i, list) => keys.includes(key) && list.indexOf(key) === i);
  if (!mine.length) return { show: [...keys], mine: [] };
  return { show: all ? [...mine, ...keys.filter((key) => !mine.includes(key))] : mine, mine };
}
