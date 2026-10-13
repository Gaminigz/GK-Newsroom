// Run: npm run 30da:test (or node --test src/lib/thirtyda-guest.test.mjs)
// The guest look (owner 2026-10-13, src/lib/thirtyda-guest.mjs): before a profile exists the home screen shows cards
// only — no private field can reach a guest, distances are bands, the device position is coarse and optional, and
// reads are limited per IP. Plus: the route is real and open without a session. No database, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  guestLimiter, guestPoint, kmBand, guestCard, GUEST_READS, GUEST_WINDOW_MS, GUEST_LIMIT, PHNOM_PENH, KM_BANDS,
} from './thirtyda-guest.mjs';
import { API_ROUTES } from './thirtyda-app.mjs';

const CARD_KEYS = ['gender', 'hearts', 'id', 'km', 'name', 'photo', 'role'];

// A $geoNear row as Mongo could return it if a projection ever slipped: every private field filled in.
const LEAKY = {
  _id: 'U-10231', name: 'Sophea', gender: 'woman', role: 'teacher', hearts: { red: 3, orange: 1, secret: 9 }, dist: 3400,
  photo: 'a'.repeat(32), photos: ['a'.repeat(32), 'b'.repeat(32), 'c'.repeat(32)], realName: 'Sophea Chan',
  phone: '+85512345678', phoneUnverified: '+85512345678', email: 'x@example.com', birthYear: 1990,
  location: { type: 'Point', coordinates: [104.92, 11.55] }, locOffset: [0.3, 0.2], area: 'BKK1', city: 'Phnom Penh',
  verified: { phone: true }, pinHash: 'scrypt$…', lang: 'km', level: 3, blocked: false,
};

test('guestCard: the stranger card only — app name, role, gender, a distance band, hearts, photo 1', () => {
  const card = guestCard(LEAKY, { photoUrl: (id) => (id ? `/30da/api/photos/${id}` : null) });
  assert.deepEqual(Object.keys(card).sort(), CARD_KEYS);
  assert.deepEqual(card, {
    id: 'U-10231', name: 'Sophea', gender: 'woman', role: 'teacher', km: 5,
    hearts: { red: 3, orange: 1 }, photo: `/30da/api/photos/${'a'.repeat(32)}`,
  });
  const text = JSON.stringify(card);
  for (const leak of ['Sophea Chan', '+855', 'example.com', '1990', 'BKK1', 'b'.repeat(32), 'c'.repeat(32), '104.9', 'scrypt', 'secret']) {
    assert.ok(!text.includes(leak), `no ${leak} on a guest card`);
  }
});

test('guestCard: missing fields stay empty, never undefined; no photo → null', () => {
  const card = guestCard({ _id: 'U-1', dist: 0 });
  assert.deepEqual(Object.keys(card).sort(), CARD_KEYS);
  assert.deepEqual(card, { id: 'U-1', name: '', gender: null, role: null, km: 1, hearts: { red: 0, orange: 0 }, photo: null });
});

test('kmBand: ≤ 1 / 2 / 5 / 10 / 20 / 50 km, never an exact distance', () => {
  assert.deepEqual(KM_BANDS, [1, 2, 5, 10, 20, 50]);
  const cases = [[0, 1], [0.04, 1], [1, 1], [1.01, 2], [2, 2], [3.4, 5], [7.9, 10], [10.2, 20], [19.99, 20], [33, 50], [50, 50], [80, 50], [-1, 50], [NaN, 50]];
  for (const [km, band] of cases) assert.equal(kmBand(km), band, `${km} km`);
});

test('guestPoint: the device position rounded to ~1 km, else Phnom Penh centre', () => {
  assert.deepEqual(guestPoint({ lat: 11.567891, lng: 104.912345 }), { point: [104.91, 11.57], device: true });
  assert.deepEqual(guestPoint({ lat: '11.5', lng: '104.9' }), { point: [104.9, 11.5], device: true });
  const centre = { point: [PHNOM_PENH.lng, PHNOM_PENH.lat], device: false };
  for (const body of [{}, undefined, null, { lat: 11.5 }, { lat: 'x', lng: 104 }, { lat: 91, lng: 0 }, { lat: 0, lng: 181 }, { lat: '', lng: '' }, { lat: null, lng: null }]) {
    assert.deepEqual(guestPoint(body), centre, JSON.stringify(body));
  }
  assert.ok(Math.abs(PHNOM_PENH.lat - 11.55) < 0.05 && Math.abs(PHNOM_PENH.lng - 104.92) < 0.05, 'Phnom Penh, not somewhere else');
});

test('guestLimiter: GUEST_READS per IP per window, separate per IP, free again after the window', () => {
  assert.equal(GUEST_READS, 60);
  assert.equal(GUEST_WINDOW_MS, 10 * 60e3);
  assert.ok(GUEST_LIMIT <= 60, 'a page of cards, not the whole city');
  const lim = guestLimiter({ max: 3, windowMs: 1000 });
  const t0 = 1_000_000;
  assert.equal(lim.take('1.1.1.1', t0), true);
  assert.equal(lim.take('1.1.1.1', t0 + 1), true);
  assert.equal(lim.take('1.1.1.1', t0 + 2), true);
  assert.equal(lim.take('1.1.1.1', t0 + 3), false, 'the 4th in the window is refused');
  assert.equal(lim.take('1.1.1.1', t0 + 500), false, 'refusals do not reset it');
  assert.equal(lim.take('2.2.2.2', t0 + 4), true, 'another IP has its own count');
  assert.equal(lim.take('1.1.1.1', t0 + 1001), true, 'the oldest left the window');
  assert.equal(lim.take(undefined, t0), true, 'no IP → one shared "unknown" bucket');
  // Keys with nothing left in the window are dropped, so the map cannot grow without end.
  const many = guestLimiter({ max: 1, windowMs: 1000 });
  for (let i = 0; i < 50; i += 1) many.take(`10.0.0.${i}`, t0);
  assert.equal(many.size(), 50);
  many.take('10.0.1.1', t0 + 5000);
  assert.equal(many.size(), 1);
});

test('route: POST /guest/nearby is real (and GET /nearby still needs a profile: not touched)', () => {
  assert.ok(API_ROUTES.some((r) => r.method === 'POST' && r.re.test('/guest/nearby')));
  assert.ok(!API_ROUTES.some((r) => r.method === 'GET' && r.re.test('/guest/nearby')), 'POST only: the position stays out of URLs');
  assert.ok(API_ROUTES.some((r) => r.method === 'GET' && r.re.test('/nearby')));
});
