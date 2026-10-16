// Level 3 meetings (owner 2026-10-14): in an open chat either person can suggest a place and a time; the other person
// accepts or declines, and both see the place as a link that opens Google Maps. The rules both sides run, written once:
// the server (src/lib/thirtyda-meet.mjs), the app (screens/meet.js) and the board demo (board/demo.js) import this file.
//
// Times are Phnom Penh time (fixed UTC+7, Cambodia has no daylight saving) whatever the phone's own clock or time zone
// says: the date and time boxes are read as Phnom Penh wall time, the meeting is stored as one instant (ISO, UTC), and
// every card shows it in Phnom Penh time again.
//
// A meeting is a chat message { kind: 'meet', meet: { at, place, status, by, updatedAt, note } }:
//   status  'proposed' → 'accepted' | 'declined' (the other person) | 'cancelled' (the proposer; or note 'replaced' when
//           a newer suggestion took its place — one open suggestion per pair at a time).

export const PP_OFFSET_MS = 7 * 3600e3;
export const MEET_MAX_DAYS = 60;
const DAY_MS = 864e5;

export const PLACE_NAME_MIN = 2;
export const PLACE_NAME_MAX = 80;
export const PLACE_ADDRESS_MAX = 140;
export const PLACE_QUERY_MIN = 2;
export const PLACE_QUERY_MAX = 80;

export const MEET_STATUSES = Object.freeze(['proposed', 'accepted', 'declined', 'cancelled']);
export const MEET_ACTIONS = Object.freeze(['accept', 'decline', 'cancel']);

/** Suggestions (stopped tries count too) one person may make in one conversation per hour, and in all per day. */
export const MEET_PER_PAIR_HOUR = 6;
export const MEET_PER_DAY = 20;
/**
 * Place searches per person per minute. The box searches only when asked (Enter or the Search button), never as you
 * type: OpenStreetMap's Nominatim usage policy forbids auto-complete searches (src/lib/thirtyda-places.mjs).
 */
export const PLACE_SEARCHES_PER_MINUTE = 10;

/**
 * The places people meet at most, one tap each (owner 2026-10-16: "small text tags to click Browns, Tube Coffee,
 * Starbucks, Koi, Aeon Mall, Park Cafe, Pasta Corner … once user click it will show up most nearest of that pick then
 * confirm"): the sheet's chips under the search box. GET /places?brand=<id> searches `q` (the server's own words, never
 * typed), keeps only places whose name has every `match` word (a word start: "koi" → "KOI Thé"), nearest first, each
 * with its distance. Brand names are the same in every language.
 */
export const MEET_BRANDS = Object.freeze([
  { id: 'brown', label: 'Brown Coffee', q: 'brown', match: ['brown'] },
  { id: 'tube', label: 'Tube Coffee', q: 'tube coffee', match: ['tube'] },
  { id: 'starbucks', label: 'Starbucks', q: 'starbucks', match: ['starbucks'] },
  { id: 'koi', label: 'KOI Thé', q: 'koi', match: ['koi'] },
  { id: 'aeon', label: 'AEON Mall', q: 'aeon mall', match: ['aeon', 'mall'] },
  { id: 'parkcafe', label: 'Park Café', q: 'park cafe', match: ['park', 'cafe'] },
  { id: 'pasta', label: 'Pasta Corner', q: 'pasta corner', match: ['pasta', 'corner'] },
].map((b) => Object.freeze({ ...b, match: Object.freeze(b.match) })));

export const brandById = (id) => MEET_BRANDS.find((b) => b.id === id) || null;

/** Does a place name belong to the brand: every `match` word starts a word of the name (case and accents aside)? */
export function brandMatches(name, brand) {
  const words = String(name ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return Boolean(brand) && brand.match.every((m) => words.some((w) => w.startsWith(m)));
}

/** Cambodia, roughly (lat / lng): a map point outside it is not kept, and a search centre outside it is Phnom Penh. */
export const KH_BOX = Object.freeze({ minLat: 9.5, maxLat: 14.8, minLng: 102.2, maxLng: 107.8 });

const pad2 = (n) => String(n).padStart(2, '0');

/** Phnom Penh wall-clock parts of an instant (ms): { year, month 1–12, day, hour, minute, weekday 0 = Sunday }. */
export function ppParts(ms) {
  const d = new Date(Number(ms) + PP_OFFSET_MS);
  return {
    year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
    hour: d.getUTCHours(), minute: d.getUTCMinutes(), weekday: d.getUTCDay(),
  };
}

/** "2026-10-20": the value of an <input type="date"> for this instant in Phnom Penh. */
export function ppDateValue(ms) {
  const p = ppParts(ms);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** "18:30": the value of an <input type="time"> for this instant in Phnom Penh. */
export function ppTimeValue(ms) {
  const p = ppParts(ms);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** The instant (ms) of a Phnom Penh date "YYYY-MM-DD" + time "HH:MM" (seconds ignored); NaN when either is not real. */
export function ppInstant(date, time) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? '').trim());
  const tm = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d{1,3})?)?$/.exec(String(time ?? '').trim());
  if (!dm || !tm) return NaN;
  const [y, mo, d] = dm.slice(1).map(Number);
  const [h, mi] = tm.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59) return NaN;
  const ms = Date.UTC(y, mo - 1, d, h, mi) - PP_OFFSET_MS;
  const back = ppParts(ms);
  if (back.year !== y || back.month !== mo || back.day !== d) return NaN; // 2026-02-30 and the like
  return ms;
}

// An instant with its zone written out: "…Z" or "…+07:00". A bare "2026-10-20T18:30" would be read in the server's
// own zone, so it is refused.
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * When a meeting may be: a real instant with its zone, in the future, at most 60 days ahead. Rounded down to the
 * minute. → { ok: true, at: ISO } | { ok: false, error: 'bad_time' | 'past' | 'too_far' }.
 */
export function checkMeetTime(at, now = Date.now()) {
  const ms = typeof at === 'string' && ISO_RE.test(at.trim()) ? Date.parse(at.trim()) : NaN;
  if (!Number.isFinite(ms)) return { ok: false, error: 'bad_time' };
  const minute = Math.floor(ms / 60e3) * 60e3;
  if (minute <= now) return { ok: false, error: 'past' };
  if (minute > now + MEET_MAX_DAYS * DAY_MS) return { ok: false, error: 'too_far' };
  return { ok: true, at: new Date(minute).toISOString() };
}

const charLen = (s) => Array.from(s).length;

/** One line of place text: control characters and line breaks become spaces, zero-width ones go, single spaces, trimmed. */
export function cleanLine(v) {
  return String(v ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `s` cut to at most `max` characters (whole characters, no half emoji), trimmed. */
export function cutLine(s, max) {
  const chars = Array.from(String(s ?? ''));
  return chars.length <= max ? String(s ?? '') : chars.slice(0, max).join('').trim();
}

const round6 = (n) => Math.round(n * 1e6) / 1e6;

/**
 * A place as sent: { name, address?, lat?, lng? }. The name is what was picked or typed (2–80 characters), the address a
 * short line (≤ 140), the point both or neither (numbers, rounded to 6 decimals). → { ok: true, place } | { ok: false,
 * error: 'place', field: 'name' | 'address' | 'point' }.
 */
export function checkPlace(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'place', field: 'name' };
  const name = cleanLine(raw.name);
  const address = cleanLine(raw.address);
  if (charLen(name) < PLACE_NAME_MIN || charLen(name) > PLACE_NAME_MAX) return { ok: false, error: 'place', field: 'name' };
  if (charLen(address) > PLACE_ADDRESS_MAX) return { ok: false, error: 'place', field: 'address' };
  const hasLat = raw.lat != null;
  const hasLng = raw.lng != null;
  if (hasLat !== hasLng) return { ok: false, error: 'place', field: 'point' };
  let lat = null;
  let lng = null;
  if (hasLat) {
    if (typeof raw.lat !== 'number' || typeof raw.lng !== 'number') return { ok: false, error: 'place', field: 'point' };
    if (!Number.isFinite(raw.lat) || !Number.isFinite(raw.lng) || Math.abs(raw.lat) > 90 || Math.abs(raw.lng) > 180) {
      return { ok: false, error: 'place', field: 'point' };
    }
    lat = round6(raw.lat);
    lng = round6(raw.lng);
  }
  return { ok: true, place: { name, address: address || null, lat, lng } };
}

/** true when lat / lng are numbers inside Cambodia (KH_BOX). */
export function inCambodia(lat, lng) {
  return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= KH_BOX.minLat && lat <= KH_BOX.maxLat && lng >= KH_BOX.minLng && lng <= KH_BOX.maxLng;
}

/** The same place (as checkPlace gives it): name, address and point all equal. */
export function samePlace(a, b) {
  if (!a || !b) return false;
  return a.name === b.name && (a.address || null) === (b.address || null) && (a.lat ?? null) === (b.lat ?? null)
    && (a.lng ?? null) === (b.lng ?? null);
}

/**
 * What is kept of a place someone sent (POST /pairs/:id/meet). The address and the map point are kept only when the
 * server itself suggested that place (`known`: a signed /places suggestion, or a place already in this conversation,
 * as "Suggest another time" sends it back) — so the card can never name a café while its map opens somewhere else, and
 * a typed place is its name alone (Google Maps searches the name). A point outside Cambodia is never kept.
 */
export function keptPlace(place, known) {
  if (!place) return null;
  if (!known) return { name: place.name, address: null, lat: null, lng: null };
  return inCambodia(place.lat, place.lng) ? { ...place } : { ...place, lat: null, lng: null };
}

/** The texts of a place the contact-detail and bad-word checks read: [name, address] (address null when none). */
export const placeTexts = (place) => [place?.name ?? '', place?.address || null];

/** One line for the chat log (what the admin reads): "Brown Coffee · Russian Federation Blvd, Toul Kork". */
export const placeLine = (place) => [place?.name, place?.address].filter(Boolean).join(' · ');

/**
 * The Google Maps link of a place (opens the Maps app or the website; no key needed): the point when there is one,
 * else the name. https://developers.google.com/maps/documentation/urls/get-started#search-action
 */
export function mapsUrl(place) {
  const point = Number.isFinite(place?.lat) && Number.isFinite(place?.lng);
  const q = point ? `${place.lat},${place.lng}` : cleanLine(place?.name);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/**
 * May `meId` do `action` to this meeting now? Accept / decline: only the other person, only while it is proposed.
 * Cancel: only the person who suggested it, while proposed or accepted. Never once its time has passed. Doing again
 * what is already done (a double tap) is fine: { status, same: true }.
 * → { status } (the new status) | { error: 'invalid' | 'not_yours' | 'not_open' | 'past' }.
 */
export function meetActionCheck(meet, meId, action, now = Date.now()) {
  if (!MEET_ACTIONS.includes(action)) return { error: 'invalid' };
  const mine = meet?.by === meId;
  const status = { accept: 'accepted', decline: 'declined', cancel: 'cancelled' }[action];
  if (action === 'cancel' ? !mine : mine) return { error: 'not_yours' };
  if (meet?.status === status && meet?.doneBy === meId) return { status, same: true };
  const from = action === 'cancel' ? ['proposed', 'accepted'] : ['proposed'];
  if (!from.includes(meet?.status)) return { error: 'not_open' };
  if (!(Date.parse(meet?.at) > now)) return { error: 'past' };
  return { status };
}

/** How many suggestions (stopped tries too) `meId` made in this conversation in the last hour. */
export function meetsLastHour(messages, meId, now = Date.now()) {
  return (messages || []).filter((m) => m?.kind === 'meet' && m.from === meId && now - Date.parse(m.at) < 3600e3).length;
}

/** The open suggestion of a conversation (status 'proposed'), the newest one, or null. */
export function openMeet(messages) {
  const open = (messages || []).filter((m) => m?.kind === 'meet' && !m.stopped && m.meet?.status === 'proposed');
  return open.length ? open[open.length - 1] : null;
}

/** A meeting message as `meId` sees it (GET /pairs/:id/messages, the answers of the meet routes). */
export function meetView(m, meId) {
  const x = m?.meet || {};
  const place = x.place || { name: '', address: null, lat: null, lng: null };
  return {
    id: m.id,
    kind: 'meet',
    mine: m.from === meId,
    at: m.at,
    meet: {
      at: x.at,
      place,
      status: MEET_STATUSES.includes(x.status) ? x.status : 'cancelled',
      note: x.note === 'replaced' ? 'replaced' : null,
      updatedAt: x.updatedAt || m.at,
      mapsUrl: mapsUrl(place),
    },
  };
}

/**
 * The status line's key for the card (each viewer in their own language): 'waiting_them' (mine, waiting for them),
 * 'waiting_you' (theirs, waiting for me), 'accepted', 'declined', 'cancelled', 'replaced', 'passed' (still proposed
 * but its time has gone).
 */
export function meetStatusKey(view, now = Date.now()) {
  const x = view?.meet || {};
  if (x.status === 'proposed') {
    if (!(Date.parse(x.at) > now)) return 'passed';
    return view.mine ? 'waiting_them' : 'waiting_you';
  }
  if (x.status === 'cancelled' && x.note === 'replaced') return 'replaced';
  return MEET_STATUSES.includes(x.status) ? x.status : 'cancelled';
}

/** What the card offers this viewer now: { accept, decline, suggest, cancel } (booleans). */
export function meetChoices(view, now = Date.now()) {
  const x = view?.meet || {};
  const future = Date.parse(x.at) > now;
  const open = x.status === 'proposed' && future;
  return {
    accept: open && !view.mine,
    decline: open && !view.mine,
    suggest: open && !view.mine,
    cancel: future && view.mine && (x.status === 'proposed' || x.status === 'accepted'),
  };
}
