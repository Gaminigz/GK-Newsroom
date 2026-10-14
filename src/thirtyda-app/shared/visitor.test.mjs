// Run: node --test src/thirtyda-app/shared/
// What stays on the visitor's phone and how rough the location it sends is (shared/visitor.js, owner 2026-10-14):
// the 48 hours and 30 days, the location rounded to about 1 km, a phone id's shape, and the time left for the banner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VERIFY_KEEP_MS, DEVICE_KEEP_MS, LOCATION_DECIMALS, approxPoint, deviceIdOk, timeLeft } from './visitor.js';

test('the owner\'s numbers: never verified → 48 hours; a phone id kept 30 days; 2 decimals', () => {
  assert.equal(VERIFY_KEEP_MS, 48 * 60 * 60 * 1000);
  assert.equal(DEVICE_KEEP_MS, 30 * 24 * 60 * 60 * 1000);
  assert.equal(LOCATION_DECIMALS, 2);
});

test('approxPoint: lat / lng rounded to 2 decimals (about 1 km), nothing finer leaves the phone', () => {
  assert.deepEqual(approxPoint({ lat: 11.551234, lng: 104.926789 }), { lat: 11.55, lng: 104.93 });
  assert.deepEqual(approxPoint({ lat: 11.5562, lng: 104.9249 }), { lat: 11.56, lng: 104.92 });
  assert.deepEqual(approxPoint({ lat: -33.868765, lng: 151.209321 }), { lat: -33.87, lng: 151.21 });
  assert.deepEqual(approxPoint({ lat: 90, lng: -180 }), { lat: 90, lng: -180 });
  // Never -0 (it would read as "-0" in a log), and the result is plain numbers only.
  const zero = approxPoint({ lat: -0.001, lng: -0.004 });
  assert.ok(Object.is(zero.lat, 0) && Object.is(zero.lng, 0), JSON.stringify(zero));
  assert.deepEqual(Object.keys(approxPoint({ lat: 1, lng: 2, accuracy: 5, altitude: 9 })), ['lat', 'lng'], 'nothing else rides along');
  // Every result has at most 2 decimals, whatever goes in.
  for (let i = 0; i < 500; i++) {
    const p = approxPoint({ lat: (Math.random() - 0.5) * 180, lng: (Math.random() - 0.5) * 360 });
    for (const v of [p.lat, p.lng]) assert.ok(/^-?\d+(\.\d{1,2})?$/.test(String(v)), `${v} has at most 2 decimals`);
  }
  // At Phnom Penh, rounding moves a point by at most ~0.8 km: distance bands stay right.
  const kmPerDeg = 111.32;
  const worst = Math.hypot(0.005 * kmPerDeg, 0.005 * kmPerDeg * Math.cos((11.55 * Math.PI) / 180));
  assert.ok(worst < 0.8, `${worst.toFixed(2)} km at most`);
});

test('approxPoint: not a real point → null (the app then says it could not find the location)', () => {
  for (const bad of [null, undefined, {}, { lat: 11.5 }, { lng: 104.9 }, { lat: '11.5', lng: '104.9' }, { lat: NaN, lng: 1 },
    { lat: 1, lng: Infinity }, { lat: 91, lng: 0 }, { lat: 0, lng: 180.5 }, { lat: null, lng: null }]) {
    assert.equal(approxPoint(bad), null, JSON.stringify(bad));
  }
});

test('deviceIdOk: the apps\' UUIDs and the website\'s own id; nothing that could carry anything else', () => {
  for (const ok of ['3F2504E0-4F89-41D3-9A0C-0305E82C3301', '3f2504e0-4f89-41d3-9a0c-0305e82c3301', 'a1b2c3d4e5f60718',
    '0123456789abcdef0123456789abcdef', 'x'.repeat(128)]) {
    assert.equal(deviceIdOk(ok), true, ok);
  }
  for (const bad of [null, undefined, 123, '', 'short', 'abc 1234567', '-abcdefgh', '<script>x</script>', 'a'.repeat(129),
    'abcdefgh\n', 'ab/cdefghij', { id: 'abcdefghij' }, ['abcdefghij']]) {
    assert.equal(deviceIdOk(bad), false, String(bad));
  }
});

test('timeLeft: whole hours, then minutes rounded up; gone at the deadline; not a time → null', () => {
  const now = Date.parse('2026-10-14T10:00:00Z');
  assert.deepEqual(timeLeft(now + VERIFY_KEEP_MS, now), { gone: false, hours: 48, minutes: 0 });
  assert.deepEqual(timeLeft(new Date(now + 21 * 3600e3 + 5 * 60e3).toISOString(), now), { gone: false, hours: 21, minutes: 5 });
  assert.deepEqual(timeLeft(now + 35 * 60e3 + 1, now), { gone: false, hours: 0, minutes: 36 }, 'rounded up');
  assert.deepEqual(timeLeft(now + 1000, now), { gone: false, hours: 0, minutes: 1 }, 'never "0 min" while time is left');
  assert.deepEqual(timeLeft(now, now), { gone: true, hours: 0, minutes: 0 });
  assert.deepEqual(timeLeft(now - 5 * 60e3, now), { gone: true, hours: 0, minutes: 0 });
  for (const bad of [null, undefined, '', 'soon', {}, NaN]) assert.equal(timeLeft(bad, now), null, String(bad));
});
