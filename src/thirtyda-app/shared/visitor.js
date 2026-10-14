// 30+DA, what stays on the visitor's phone and how rough the location it sends is (owner 2026-10-14).
// Imported by the server AND served to the browser unchanged, so: plain ES module, no Node imports, no DOM,
// and no regex lookbehind (older iOS Safari cannot even parse it).
//
//  - A profile made without verifying is deleted VERIFY_KEEP_MS (48 hours) after it was made, unless it verifies first
//    (src/lib/thirtyda-delete.mjs expireUnverified); the app shows how long is left (timeLeft).
//  - One such profile per phone: the app sends this phone's id (deviceIdOk) with POST /profile { unverified: true }; the
//    server keeps only a one-way hash of it, for DEVICE_KEEP_MS (30 days) — src/lib/thirtyda-verify.mjs.
//  - The location the app sends is rounded to LOCATION_DECIMALS (about 1 km): distance bands need no more (approxPoint).

/** A profile with no verified way is deleted this long after it was made. */
export const VERIFY_KEEP_MS = 48 * 3600e3;
/** How long a phone's (hashed) id is kept after it made a profile without verifying. */
export const DEVICE_KEEP_MS = 30 * 864e5;

/** A phone id as the apps send it (a UUID) or as the website keeps one: letters, digits and - _ . :, 8–128 long. */
const DEVICE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/;
export const deviceIdOk = (v) => typeof v === 'string' && DEVICE_ID_RE.test(v);

/** Decimals of the latitude / longitude the app sends: 2 ≈ 1.1 km north–south. */
export const LOCATION_DECIMALS = 2;

/** { lat, lng } rounded to LOCATION_DECIMALS (about 1 km), or null when it is not a real point on Earth. */
export function approxPoint(pos) {
  const { lat, lng } = pos || {};
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const f = 10 ** LOCATION_DECIMALS;
  const round = (n) => Math.round(n * f) / f + 0; // + 0: never -0
  return { lat: round(lat), lng: round(lng) };
}

/**
 * Time left until `until` (an ISO time or ms since 1970) → { gone, hours, minutes }: whole hours, then the minutes
 * after them, rounded UP to the minute (never "0 min" while time is left). null when `until` is not a time.
 */
export function timeLeft(until, now = Date.now()) {
  const end = typeof until === 'number' ? until : Date.parse(String(until ?? ''));
  if (!Number.isFinite(end)) return null;
  const ms = end - now;
  if (!(ms > 0)) return { gone: true, hours: 0, minutes: 0 };
  const total = Math.ceil(ms / 60e3);
  return { gone: false, hours: Math.floor(total / 60), minutes: total % 60 };
}
