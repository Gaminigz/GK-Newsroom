/**
 * 30+DA sign-in with Google / Facebook — the keys the super admin saves on the admin Code page.
 *
 * Stored now, wired next: the keys are kept sealed in thirtyda_settings (src/lib/thirtyda-settings.mjs,
 * FIELD_SETTINGS.google / .facebook) and shown back masked; the app's buttons say "Coming soon" until the
 * sign-in itself is built (then the redirect addresses below are where Google / Facebook send people back).
 *
 *   google   { clientId, clientSecret }   Google Cloud → APIs & Services → Credentials → a Web application client
 *   facebook { appId, appSecret }         Meta for Developers → your app → App settings → Basic
 *
 * Pure apart from the `d` (Mongo Db) handed in, so the unit tests run without a database.
 */

import { readFields } from "./thirtyda-settings.mjs";

export const SIGNIN_PROVIDERS = ["google", "facebook"];
export const SIGNIN_NAMES = { google: "Google", facebook: "Facebook" };
/** false until the sign-in is built: the app shows "Coming soon" (test mode keeps its test buttons). */
export const SIGNIN_WIRED = { google: false, facebook: false };

const RULES = {
  google: {
    clientId: {
      re: /^[A-Za-z0-9][A-Za-z0-9._-]{4,200}\.apps\.googleusercontent\.com$/,
      empty: "Paste the Client ID first.",
      bad: "A Google Client ID ends with .apps.googleusercontent.com. Copy it again from Google Cloud → APIs & Services → Credentials.",
    },
    clientSecret: {
      secret: true,
      re: /^[A-Za-z0-9_-]{10,200}$/,
      empty: "Paste the Client secret first.",
      bad: "That does not look like a Google Client secret (letters, digits, - and _, no spaces). Copy it again from the same page.",
    },
  },
  facebook: {
    appId: {
      re: /^\d{5,25}$/,
      empty: "Write the App ID first.",
      bad: "The App ID is only digits. Copy it from Meta for Developers → your app → App settings → Basic.",
    },
    appSecret: {
      secret: true,
      re: /^[A-Za-z0-9]{16,128}$/,
      empty: "Paste the App secret first.",
      bad: "That does not look like a Facebook App secret (letters and digits, no spaces). Copy it again from App settings → Basic (press Show).",
    },
  },
};

/**
 * Check what the admin typed for `provider`. A secret left empty keeps the saved one (`current`, when
 * readable). → { ok:true, values } | { ok:false, field, error } (plain words).
 */
export function checkSigninFields(provider, input = {}, current = null) {
  const rules = RULES[provider];
  if (!rules) return { ok: false, field: null, error: "No such sign-in." };
  const values = {};
  for (const [field, rule] of Object.entries(rules)) {
    let v = String(input?.[field] ?? "").trim();
    if (!v && rule.secret && current?.[field]) v = current[field];
    if (!v) return { ok: false, field, error: rule.empty };
    if (!rule.re.test(v)) return { ok: false, field, error: rule.bad };
    values[field] = v;
  }
  return { ok: true, values };
}

/** true when both keys of `provider` are saved and readable. */
export async function signinKeysSaved(d, provider) {
  if (!SIGNIN_PROVIDERS.includes(provider) || !d) return false;
  const f = await readFields(d, provider);
  return Boolean(f && checkSigninFields(provider, f).ok);
}

/** "https://ecom.ggmt.sg" from the request (http only on this machine), for the addresses the admin copies. */
export function publicOrigin(req) {
  const raw = String(req?.headers?.["x-forwarded-host"] || req?.headers?.host || "").split(",")[0].trim().toLowerCase();
  const host = /^[a-z0-9.-]+(?::\d{1,5})?$/.test(raw) || /^\[[0-9a-f:]+\](?::\d{1,5})?$/.test(raw) ? raw : "ecom.ggmt.sg";
  const name = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  const local = name === "localhost" || name === "127.0.0.1" || name === "::1" || name.endsWith(".localhost");
  return `${local ? "http" : "https"}://${host}`;
}

/** Where Google / Facebook send people back after they sign in (to paste into their consoles). */
export function signinRedirect(req, provider) {
  return `${publicOrigin(req)}/30da/api/auth/${provider}/callback`;
}
