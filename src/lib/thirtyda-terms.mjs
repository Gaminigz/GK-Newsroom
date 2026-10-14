// 30+DA community rules on the server (store policy, owner 2026-10-14; the version and the agreement's shape are in
// src/thirtyda-app/shared/terms.js).
//  - users.terms { version, at }: the version a profile agreed to, and when (the tap on the phone, see readAgreement).
//    It arrives with POST /profile { terms }, the phone-code sign-in (POST /auth/verify-code { terms }) or POST /me/terms.
//  - A profile that has not agreed to TERMS_VERSION may only make the calls termsFree() lists — agree, the PIN, delete
//    the account, the passive "anything new?" check — and the calls that need no profile; every other call answers
//    403 terms_needed (src/lib/thirtyda-app.mjs handleApi), so the app shows the rules again first.
import { TERMS_VERSION, termsCurrent, readAgreement } from "../thirtyda-app/shared/terms.js";

export { TERMS_VERSION, termsCurrent, readAgreement };

// [method, path] a profile may call before agreeing to the current rules.
const FREE = [
  ["POST", /^\/me\/terms$/], // "I agree"
  ["POST", /^\/me\/unlock$/], // the PIN screen covers the app first
  ["POST", /^\/me\/pin$/], // a profile with no PIN sets one before anything else
  ["POST", /^\/me\/delete$/], // leaving is always possible, rules or not
  ["GET", /^\/me\/pending$/], // the locked app's "something new is waiting" (a count only)
];

/** true when `method sub` (the path after /30da/api) may run for a profile that has not agreed to the current rules. */
export const termsFree = (method, sub) => FREE.some(([m, re]) => m === method && re.test(String(sub ?? "")));

/** users.terms as its owner sees it (MeView.terms): { version, at: ISO time } or null. */
export function termsView(u) {
  const t = u?.terms;
  if (!t || typeof t.version !== "string") return null;
  const at = t.at instanceof Date ? t.at : new Date(t.at);
  return { version: t.version, at: Number.isFinite(at.getTime()) ? at.toISOString() : null };
}

/** What users.terms holds for an agreement from readAgreement(). */
export const termsDoc = (agreement) => ({ version: agreement.version, at: new Date(agreement.at) });

/**
 * Keep an agreement (readAgreement's) on a profile, unless it already agreed to this version (the first "I agree"
 * keeps its time). → the profile's users.terms afterwards.
 */
export async function saveTerms(users, user, agreement) {
  if (termsCurrent(user?.terms)) return user.terms;
  const terms = termsDoc(agreement);
  await users.updateOne({ _id: user._id, "terms.version": { $ne: terms.version } }, { $set: { terms } });
  return terms;
}

export const TERMS_NEEDED_MESSAGE = "Please agree to the 30+DA community rules first.";
