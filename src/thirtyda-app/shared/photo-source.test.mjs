// Run: npm run 30da:test (or node --test src/thirtyda-app/shared/photo-source.test.mjs)
// Profile photos (owner 2026-10-14): a tap on a photo circle / tile — Create profile (face photo + photos 2–4) and
// #/me — opens a sheet "Take a selfie" (front camera: capture="user") / "Choose from photos" (no capture) / Cancel.
// Reads the client files as text (they need a browser to run).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LANGS } from './rules.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

/** { en: Set(keys), km: …, … } of the registerStrings({ … }) block of a file whose keys start with `prefix`. */
function stringKeys(src, prefix) {
  const out = {};
  const block = src.slice(src.lastIndexOf('registerStrings({'));
  const re = /^ {2}(\w{2}): \{\n([\s\S]*?)\n {2}\},?$/gm;
  for (const m of block.matchAll(re)) {
    out[m[1]] = new Set([...m[2].matchAll(new RegExp(`^ {4}(${prefix}\\w+):`, 'gm'))].map((k) => k[1]));
  }
  return out;
}

test('photo source sheet: the same 4 words in all 5 languages', () => {
  const keys = stringKeys(read('../photo-source.js'), 'ps_');
  assert.deepEqual(Object.keys(keys).sort(), [...LANGS].sort());
  assert.deepEqual([...keys.en].sort(), ['ps_cancel', 'ps_library', 'ps_selfie', 'ps_title']);
  for (const lang of LANGS) assert.deepEqual([...keys[lang]].sort(), [...keys.en].sort(), lang);
});

test('two hidden inputs: the selfie opens the FRONT camera, the library has no capture', () => {
  const src = read('../photo-source.js');
  assert.match(src, /hiddenInput\(\{ capture: 'user', 'data-picker': 'selfie' \}\)/);
  assert.match(src, /hiddenInput\(\{ 'data-picker': 'library' \}\)/);
  assert.match(src, /type: 'file', accept: 'image\/\*'/);
  // The sheet closes before the input is clicked (nothing inert), inside the same tap.
  assert.match(src, /dlg\.close\(\);\n\s*input\.click\(\);/);
  // The inputs go into the screen, not the sheet (lock.js sees their click / change / cancel).
  assert.match(src, /return \{ inputs: \[selfie, library\], open \};/);
});

test('Create profile (face + photos 2–4) and #/me open the sheet; no file input of their own', () => {
  const cp = read('../screens/create-profile.js');
  const me = read('../screens/my-profile.js');
  for (const [name, src] of [['create-profile.js', cp], ['my-profile.js', me]]) {
    assert.ok(src.includes("import { photoSource } from '../photo-source.js';"), name);
    assert.ok(!/type: 'file'/.test(src), `${name}: no file input of its own`);
    assert.ok(!/(file|moreFile)\.click\(\)/.test(src), `${name}: no photo input is clicked directly`);
  }
  assert.match(cp, /faceSource\.open\(/);
  assert.match(cp, /moreSource\.open\(/);
  assert.match(cp, /faceSource\.inputs, moreSource\.inputs/);
  assert.match(me, /file\.open\(/);
  assert.match(me, /file\.inputs\)/);
});

test('the sheet styles load in the app and the demo frame; the PIN lock still pauses for file pickers', () => {
  for (const page of ['../index.html', '../board/frame.html']) {
    assert.ok(read(page).includes('<link rel="stylesheet" href="/30da/photo-source.css">'), page);
  }
  assert.match(read('../photo-source.css'), /\.photo-source-choice/);
  const lock = read('../lock.js');
  assert.ok(lock.includes("e.target instanceof HTMLInputElement && e.target.type === 'file') lock.picker = Date.now()"));
});
