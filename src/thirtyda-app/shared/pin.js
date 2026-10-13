// 30+DA shared PIN rules (owner 2026-10-13, "Lock the app"): a 4-digit PIN locks the app on this phone.
// Imported by the server AND served to the browser unchanged, so: plain ES module, no Node imports, no DOM.

export const PIN_LENGTH = 4;
/** Wrong PINs before the session is ended (counted per session AND per person, on the server). */
export const PIN_TRIES = 5;
/** No touch / mouse / key / scroll for this long → the app is covered by the PIN screen (client). */
export const IDLE_COVER_MS = 30e3;
/** No real activity for this long → the server treats the session as locked (backstop). */
export const LOCK_IDLE_MS = 2 * 60e3;
/** The header the app puts on every API call: whole seconds since the person last touched the app. */
export const INPUT_AGE_HEADER = 'X-30DA-Input-Age';

const KHMER_DIGITS = '០១២៣៤៥៦៧៨៩';

/**
 * What was typed → ASCII digits only. Khmer digits (០–៩) and full-width digits (０–９) count as digits,
 * so a Khmer keyboard works; anything else is dropped.
 */
export function pinDigits(raw) {
  let out = '';
  for (const ch of String(raw ?? '')) {
    if (ch >= '0' && ch <= '9') out += ch;
    else if (KHMER_DIGITS.includes(ch)) out += String(KHMER_DIGITS.indexOf(ch));
    else if (ch >= '０' && ch <= '９') out += String(ch.charCodeAt(0) - 0xff10);
  }
  return out;
}

/**
 * A new PIN: exactly 4 digits, not one digit four times (0000, 7777) and not a straight run up or down
 * (1234, 6789, 4321, 9876). → { ok: true, pin } | { ok: false, error: 'format' | 'same' | 'run' }.
 * Only for SETTING a PIN; an entered PIN is just compared.
 */
export function checkNewPin(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return { ok: false, error: 'format' };
  const pin = String(raw);
  if (!/^\d{4}$/.test(pin)) return { ok: false, error: 'format' };
  const d = [...pin].map(Number);
  if (d.every((x) => x === d[0])) return { ok: false, error: 'same' };
  const steps = d.slice(1).map((x, i) => x - d[i]);
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return { ok: false, error: 'run' };
  return { ok: true, pin };
}

/** Tries left before the session ends: the larger of the two counts decides. */
export function pinTriesLeft(sessionTries = 0, userTries = 0) {
  return Math.max(0, PIN_TRIES - Math.max(Number(sessionTries) || 0, Number(userTries) || 0));
}
