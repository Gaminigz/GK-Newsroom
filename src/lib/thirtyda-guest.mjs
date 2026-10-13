/**
 * 30+DA guest look (owner 2026-10-13: "Language → PIN → the home screen"). Before a profile exists, the home screen
 * shows who is on 30+DA: the same card a stranger sees (app name, role, distance, hearts, photo 1) and nothing more —
 * never the real name, phone, other photos or a location. Opening a profile, hearts and talking wait for a profile.
 *
 * Pure helpers for POST /guest/nearby (src/lib/thirtyda-app.mjs), tested in thirtyda-guest.test.mjs:
 *   - guestLimiter: reads per IP in a sliding window (no writes anywhere; the map is pruned).
 *   - guestPoint: where to measure from — the device's position if the guest shared it (rounded to ~1 km, used for
 *     this one answer and never stored), else Phnom Penh centre.
 *   - kmBand: the distance as a band (≤ 1 / 2 / 5 / 10 / 20 / 50 km): a guest can ask from any point, so an exact
 *     distance would let them close in on someone.
 *   - guestCard: one row → the card, built field by field (nothing else can slip through).
 */

export const GUEST_READS = 60; // looks per IP …
export const GUEST_WINDOW_MS = 10 * 60e3; // … per 10 minutes
export const GUEST_LIMIT = 60; // cards per answer
export const PHNOM_PENH = Object.freeze({ lat: 11.5564, lng: 104.9282 }); // Independence Monument, roughly
export const KM_BANDS = Object.freeze([1, 2, 5, 10, 20, 50]);

/** → { take(ip, now) → boolean, size() }: true (and counted) while the IP has a read left in the window. */
export function guestLimiter({ max = GUEST_READS, windowMs = GUEST_WINDOW_MS } = {}) {
  const hits = new Map(); // ip -> [timestamps]
  let swept = 0;
  const sweep = (now) => {
    if (now - swept < windowMs) return;
    swept = now;
    for (const [key, list] of hits) if (!list.some((t) => now - t < windowMs)) hits.delete(key);
  };
  return {
    take(ip, now = Date.now()) {
      sweep(now);
      const key = String(ip || "unknown");
      const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
      if (list.length >= max) {
        hits.set(key, list);
        return false;
      }
      list.push(now);
      hits.set(key, list);
      return true;
    },
    size: () => hits.size,
  };
}

const round2 = (n) => Math.round(n * 100) / 100;

/** body { lat, lng } → { point: [lng, lat], device }: the device's position (~1 km), or Phnom Penh centre. */
export function guestPoint(body = {}) {
  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  const given = body?.lat != null && body?.lng != null && body.lat !== "" && body.lng !== "";
  if (given && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    return { point: [round2(lng), round2(lat)], device: true };
  }
  return { point: [PHNOM_PENH.lng, PHNOM_PENH.lat], device: false };
}

/** km → the smallest band it fits in (≤ 1, 2, 5, 10, 20, 50); past 50 stays 50. */
export function kmBand(km) {
  const v = Number(km);
  if (!Number.isFinite(v) || v < 0) return KM_BANDS[KM_BANDS.length - 1];
  return KM_BANDS.find((b) => v <= b) ?? KM_BANDS[KM_BANDS.length - 1];
}

/** One $geoNear row (dist in metres, photo = slot 1's id) → the card a guest may see. */
export function guestCard(u, { photoUrl = () => null } = {}) {
  return {
    id: String(u._id),
    name: typeof u.name === "string" ? u.name : "",
    gender: u.gender ?? null,
    role: u.role ?? null,
    km: kmBand((Number(u.dist) || 0) / 1000),
    hearts: { red: u?.hearts?.red ?? 0, orange: u?.hearts?.orange ?? 0 },
    photo: photoUrl(u.photo) ?? null,
  };
}
