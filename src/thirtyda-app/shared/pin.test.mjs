// Run: node --test src/thirtyda-app/shared/
// The PIN rules the app and the server share (shared/pin.js): what a new PIN may be, typed digits in any of
// the scripts a phone keyboard gives, and the tries count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PIN_LENGTH, PIN_TRIES, IDLE_COVER_MS, LOCK_IDLE_MS, INPUT_AGE_HEADER, checkNewPin, pinDigits, pinTriesLeft,
} from './pin.js';

test('the owner\'s numbers: 4 digits, 5 tries, 30 s cover, 2 min server lock', () => {
  assert.equal(PIN_LENGTH, 4);
  assert.equal(PIN_TRIES, 5);
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

test('tries left: the larger count decides, never below 0', () => {
  assert.equal(pinTriesLeft(0, 0), 5);
  assert.equal(pinTriesLeft(1, 3), 2);
  assert.equal(pinTriesLeft(4, 0), 1);
  assert.equal(pinTriesLeft(5, 0), 0);
  assert.equal(pinTriesLeft(2, 9), 0);
  assert.equal(pinTriesLeft(), 5);
});
