// Run: node --test src/thirtyda-app/shared/
// Profile rules (owner 2026-10-13): app name 2–7 characters; birth year from ages 30–80 only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NAME_MIN, NAME_MAX, AGE_MIN, AGE_MAX, currentYear, birthYearOptions, checkBirthYear, checkAppName, clipChars, charCount,
} from './rules.js';

// 2026-10-13 12:00 in Phnom Penh.
const NOW = Date.UTC(2026, 9, 13, 5, 0);

test('limits are the owner rule', () => {
  assert.equal(NAME_MIN, 2);
  assert.equal(NAME_MAX, 7);
  assert.equal(AGE_MIN, 30);
  assert.equal(AGE_MAX, 80);
});

test('currentYear is Phnom Penh\'s (UTC+7), whatever the host clock', () => {
  assert.equal(currentYear(NOW), 2026);
  assert.equal(currentYear(new Date(NOW)), 2026);
  // 31 Dec 23:30 UTC is already 1 Jan 06:30 in Phnom Penh; 16:59 UTC is still 23:59 on 31 Dec.
  assert.equal(currentYear(Date.UTC(2026, 11, 31, 23, 30)), 2027);
  assert.equal(currentYear(Date.UTC(2026, 11, 31, 16, 59)), 2026);
  assert.equal(currentYear(Date.UTC(2026, 11, 31, 17, 0)), 2027);
  assert.equal(typeof currentYear(), 'number');
});

test('birthYearOptions: this year − 30 down to this year − 80, newest first', () => {
  const years = birthYearOptions(NOW);
  assert.equal(years.length, 51);
  assert.equal(years[0], 1996);
  assert.equal(years.at(-1), 1946);
  for (let i = 1; i < years.length; i++) assert.equal(years[i], years[i - 1] - 1);
  for (const y of years) assert.equal(checkBirthYear(y, NOW).ok, true, `listed ${y} must pass the check`);
});

test('checkBirthYear: missing, too young, implausible, ok', () => {
  for (const v of [undefined, null, '', '   ']) assert.deepEqual(checkBirthYear(v, NOW), { ok: false, year: null, error: 'missing' });
  // Aged 30 this year is in; 29 is not.
  assert.deepEqual(checkBirthYear(1996, NOW), { ok: true, year: 1996, error: null });
  assert.deepEqual(checkBirthYear('1996', NOW), { ok: true, year: 1996, error: null });
  assert.deepEqual(checkBirthYear(' 1980 ', NOW), { ok: true, year: 1980, error: null });
  assert.deepEqual(checkBirthYear(1997, NOW), { ok: false, year: 1997, error: 'too_young' });
  assert.deepEqual(checkBirthYear(2010, NOW), { ok: false, year: 2010, error: 'too_young' });
  assert.deepEqual(checkBirthYear(2026, NOW), { ok: false, year: 2026, error: 'too_young' });
  // Not a year, in the future, or off the list at the old end.
  assert.equal(checkBirthYear(2027, NOW).error, 'invalid');
  assert.equal(checkBirthYear(1945, NOW).error, 'invalid');
  assert.equal(checkBirthYear(1946, NOW).ok, true);
  for (const v of [1990.5, '1990.0', '19x0', 'abc', '01990', '199', true, {}, [], NaN, Infinity]) {
    assert.equal(checkBirthYear(v, NOW).error, 'invalid', `invalid: ${String(v)}`);
  }
  // The year moves with the clock: in 2027 a 1997 birth year is in.
  assert.equal(checkBirthYear(1997, Date.UTC(2027, 0, 1, 0, 0)).ok, true);
});

test('checkAppName: 2–7 characters, contact details first', () => {
  assert.deepEqual(checkAppName('Tomas'), { ok: true, name: 'Tomas', count: 5, error: null, hits: [], reason: null });
  assert.equal(checkAppName('  Sok   Ny ').name, 'Sok Ny');
  assert.equal(checkAppName('Abcdefg').ok, true);
  assert.equal(checkAppName('Abcdefgh').error, 'too_long');
  assert.equal(checkAppName('A').error, 'too_short');
  assert.equal(checkAppName('   ').error, 'empty');
  assert.equal(checkAppName(undefined).error, 'empty');
  // Characters as a person counts them: Khmer clusters, CJK.
  assert.equal(checkAppName('សុផានី').ok, true);
  assert.equal(checkAppName('ស្រីល័ក្ខ').ok, true);
  assert.equal(checkAppName('さくら').ok, true);
  assert.equal(checkAppName('김민준').ok, true);
  assert.equal(checkAppName('王小美').ok, true);
  // Long AND a contact detail: the contact detail decides (the admin keeps its reason).
  const c = checkAppName('Call 012 88 77 66');
  assert.equal(c.error, 'contact');
  assert.equal(c.reason, 'Phone number shared');
  assert.equal(checkAppName('@visal').error, 'contact');
  assert.equal(checkAppName('Telegram').error, 'contact');
});

test('clipChars keeps whole characters up to the limit', () => {
  assert.equal(clipChars('Abcdefghij', 7), 'Abcdefg');
  assert.equal(clipChars('Tomas', 7), 'Tomas');
  assert.equal(clipChars('', 7), '');
  const km = 'ខ្ញុំខ្ញុំខ្ញុំខ្ញុំខ្ញុំខ្ញុំខ្ញុំខ្ញុំ'; // 8 × "ខ្ញុំ"
  const clipped = clipChars(km, 7);
  assert.equal(charCount(clipped), 7);
  assert.equal(clipped, 'ខ្ញុំ'.repeat(7)); // never cut inside a cluster
  assert.equal(clipChars('👍🏽👍🏽👍🏽👍🏽👍🏽👍🏽👍🏽👍🏽', 7), '👍🏽'.repeat(7));
  for (const s of ['Sreyneang', 'សុផានីរ័ត្នាស្រីល័ក្ខ', '山田花子さん太郎']) assert.ok(charCount(clipChars(s, 7)) <= 7);
});
