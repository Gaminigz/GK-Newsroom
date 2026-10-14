// Run: npm run 30da:test (or node --test src/thirtyda-app/shared/safety.test.mjs)
// Block + report in the app (store policy, owner 2026-10-14): every word of the sheets is there in all 5 languages,
// every reason has its words, and the chat's own report offers "Underage" too. Reads the screen files as text (they
// need a browser to run).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LANGS } from './rules.js';
import { PERSON_REPORT_REASONS, CHAT_REPORT_REASONS } from './safety.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

/** { en: Set(keys), km: …, … } of the registerStrings({ … }) block of a screen file whose keys start with `prefix`. */
function stringKeys(src, prefix) {
  const out = {};
  const block = src.slice(src.lastIndexOf('registerStrings({'));
  const re = /^ {2}(\w{2}): \{\n([\s\S]*?)\n {2}\},?$/gm;
  for (const m of block.matchAll(re)) {
    out[m[1]] = new Set([...m[2].matchAll(new RegExp(`^ {4}(${prefix}\\w+):`, 'gm'))].map((k) => k[1]));
  }
  return out;
}

test('block + report sheets: the same words in all 5 languages, one for every reason', () => {
  const keys = stringKeys(read('../screens/safety.js'), 'sf_');
  assert.deepEqual(Object.keys(keys).sort(), [...LANGS].sort());
  const en = [...keys.en].sort();
  assert.ok(en.length >= 20);
  for (const lang of LANGS) assert.deepEqual([...keys[lang]].sort(), en, lang);
  for (const r of PERSON_REPORT_REASONS) assert.ok(keys.en.has(`sf_reason_${r}`), r);
  for (const k of ['sf_report_profile', 'sf_report_photo', 'sf_report_line', 'sf_block_title', 'sf_blocked_title', 'sf_unblock']) {
    assert.ok(keys.en.has(k), k);
  }
});

test('the chat report offers every chat reason ("Underage" too) in all 5 languages', () => {
  const src = read('../screens/chat.js');
  const keys = stringKeys(src, 'chat_report_');
  for (const lang of LANGS) {
    for (const r of CHAT_REPORT_REASONS) assert.ok(keys[lang]?.has(`chat_report_${r}`), `${lang}: chat_report_${r}`);
  }
  assert.match(src, /const REPORT_REASONS = CHAT_REPORT_REASONS;/, 'the chat sheet lists the shared reasons');
});
