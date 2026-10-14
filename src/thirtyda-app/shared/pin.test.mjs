// Run: node --test src/thirtyda-app/shared/
// The PIN rules the app and the server share (shared/pin.js): what a new PIN may be, typed digits in any of
// the scripts a phone keyboard gives, and no try limit for people.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as shared from './pin.js';

const { PIN_LENGTH, IDLE_COVER_MS, LOCK_IDLE_MS, INPUT_AGE_HEADER, checkNewPin, pinDigits } = shared;

test('the owner\'s numbers: 4 digits, 30 s cover, 2 min server lock', () => {
  assert.equal(PIN_LENGTH, 4);
  assert.equal(IDLE_COVER_MS, 30_000);
  assert.equal(LOCK_IDLE_MS, 120_000);
  assert.equal(INPUT_AGE_HEADER, 'X-30DA-Input-Age');
});

test('a good PIN is accepted as it is', () => {
  for (const pin of ['2580', '1357', '0192', '9001', '1235', '1212', '7890', '8901', '0987', '1243', '4826']) {
    assert.deepEqual(checkNewPin(pin), { ok: true, pin }, pin);
  }
});

test('one digit four times is refused (0000 … 9999)', () => {
  for (let d = 0; d <= 9; d++) assert.deepEqual(checkNewPin(String(d).repeat(4)), { ok: false, error: 'same' });
});

test('straight runs up and down are refused (0123 … 6789, 9876 … 3210)', () => {
  for (let s = 0; s <= 6; s++) {
    const up = [0, 1, 2, 3].map((i) => s + i).join('');
    const down = [3, 2, 1, 0].map((i) => s + i).join('');
    assert.deepEqual(checkNewPin(up), { ok: false, error: 'run' }, up);
    assert.deepEqual(checkNewPin(down), { ok: false, error: 'run' }, down);
  }
});

test('exactly 24 of the 10 000 PINs are refused', () => {
  let refused = 0;
  for (let n = 0; n < 10_000; n++) if (!checkNewPin(String(n).padStart(4, '0')).ok) refused++;
  assert.equal(refused, 10 + 7 + 7);
});

test('anything but 4 digits is a format error', () => {
  for (const bad of ['', '123', '12345', 'abcd', '12a4', '12 4', ' 2580', '2580 ', '25.8', null, undefined, {}, [2, 5, 8, 0], true]) {
    assert.deepEqual(checkNewPin(bad), { ok: false, error: 'format' }, JSON.stringify(bad));
  }
  assert.deepEqual(checkNewPin(2580), { ok: true, pin: '2580' }, 'a number is its digits');
  assert.deepEqual(checkNewPin(1234), { ok: false, error: 'run' });
});

test('typed digits: Khmer and full-width digits count, everything else is dropped', () => {
  assert.equal(pinDigits('២៥៨០'), '2580');
  assert.equal(pinDigits('０１９２'), '0192');
  assert.equal(pinDigits(' 2-5 8a0 '), '2580');
  assert.equal(pinDigits('٣'), '', 'other scripts are not guessed at');
  assert.equal(pinDigits(null), '');
  assert.equal(pinDigits(2580), '2580');
  assert.deepEqual(checkNewPin(pinDigits('១២៣៤')), { ok: false, error: 'run' }, 'the rules apply after normalising');
});

test('no try limit for people (owner 2026-10-14: "they can punch it 1000 times"): no tries count is shared any more', () => {
  assert.equal('PIN_TRIES' in shared, false);
  assert.equal('pinTriesLeft' in shared, false);
  // The app's lock screens never say how many tries are left, and never end anything after N wrong.
  const lock = readFileSync(new URL('../lock.js', import.meta.url), 'utf8');
  assert.doesNotMatch(lock, /triesLeft|PIN_TRIES|guestTries|pin_wrong_one/);
  const strings = lock.slice(lock.indexOf('registerStrings({'));
  const wrong = [...strings.matchAll(/pin_wrong: '([^']+)'/g)].map((m) => m[1]);
  assert.equal(wrong.length, 5, 'pin_wrong in en / km / zh / ko / ja');
  assert.ok(wrong.every((w) => !/\{n\}|\d/.test(w)), 'no count in "Wrong PIN. Try again."');
  assert.equal(wrong[0], 'Wrong PIN. Try again.');
  assert.equal([...strings.matchAll(/pin_too_many: '([^']+)'/g)].length, 5, 'the script brake (429) in 5 languages');
  const del = readFileSync(new URL('../screens/delete-account.js', import.meta.url), 'utf8');
  assert.doesNotMatch(del, /triesLeft|pin_tries|pinTriesOut|pin_wrong_one/, 'Delete my account: the same, no count, no sign-out');
});
