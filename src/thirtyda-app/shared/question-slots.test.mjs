// Run: node --test src/thirtyda-app/shared/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SYSTEM_QUESTIONS, LEVEL_RULES } from './questions.js';
import { LANGS } from './rules.js';
import {
  QUESTION_CHOICES, CHOICE_LIMITS, TITLE_LIMITS, dealSlots, flattenSlots, defaultSlots, defaultTitles, checkQuestionChoice, checkQuestionSlots,
  checkQuestionTitle, checkQuestionTitles, hasTitle, fillSlots,
} from './question-slots.js';

const tx = (en, extra = {}) => ({ en, km: `${en} ខ្មែរ`, zh: `${en} 中文`, ko: `${en} 한국어`, ja: `${en} 日本語`, ...extra });
const copy = (slots) => JSON.parse(JSON.stringify(slots));

test('dealSlots deals in order: choice j of slot i is list[j * slots + i]', () => {
  const list = Array.from({ length: 20 }, (_, i) => i);
  const slots = dealSlots(list, 4);
  assert.deepEqual(slots, [[0, 4, 8, 12, 16], [1, 5, 9, 13, 17], [2, 6, 10, 14, 18], [3, 7, 11, 15, 19]]);
  assert.deepEqual(dealSlots(Array.from({ length: 19 }, (_, i) => i), 2), [[0, 2, 4, 6, 8], [1, 3, 5, 7, 9]]); // extras left out
  assert.deepEqual(dealSlots([0, 1, 2], 2), [[0, 2], [1]]); // a short list gives short slots
  assert.deepEqual(dealSlots(null, 2), [[], []]);
  assert.deepEqual(dealSlots(list, 0), []);
});

test('flattenSlots undoes dealSlots (choice 1 of every slot first)', () => {
  const list = Array.from({ length: 20 }, (_, i) => `q${i}`);
  assert.deepEqual(flattenSlots(dealSlots(list, 4)), list);
  assert.deepEqual(flattenSlots([[1, 3, 5], [2, 4]]), [1, 2, 3, 4, 5]);
  assert.deepEqual(flattenSlots(null), []);
  // So the first `pick` entries of a flat list are one per slot (old clients that pick system[0..pick-1]).
  for (const level of [1, 2]) {
    const slots = defaultSlots(level);
    const flat = flattenSlots(slots);
    flat.slice(0, LEVEL_RULES[level].pick).forEach((q, i) => assert.equal(q.key, slots[i][0].key));
  }
});

test('defaultSlots: Level 1 = 4 × 5 from the whole bank, Level 2 = 3 × 5 from its first 15', () => {
  const l1 = defaultSlots(1);
  const l2 = defaultSlots(2);
  assert.equal(l1.length, LEVEL_RULES[1].pick);
  assert.equal(l2.length, LEVEL_RULES[2].pick);
  for (const slots of [l1, l2]) for (const slot of slots) assert.equal(slot.length, QUESTION_CHOICES);
  assert.deepEqual(l1.flat().map((q) => q.key).sort(), SYSTEM_QUESTIONS[1].slice(0, 20).map((q) => q.key).sort());
  assert.deepEqual(l2.flat().map((q) => q.key).sort(), SYSTEM_QUESTIONS[2].slice(0, 15).map((q) => q.key).sort());
  // The design's examples are choice 1 of each slot, so the ask screen opens exactly like the design.
  assert.deepEqual(l1.map((s) => s[0].text.en), [
    'Is it raining where you are?', 'Is it busy around you right now?', 'Are you outside right now?', 'Is it a quiet day for you?',
  ]);
  // Level 2 = the owner's lists, each list whole: Intentions, Time of Comfort, Venue Vibe.
  assert.deepEqual(l2.map((s) => s[0].text.en), ['Meeting in person is better.', 'After work fits best.', 'A coffee shop works well.']);
  assert.deepEqual(l2.map((s) => s.map((q) => q.key)), ['inten', 'time', 'venue'].map((p) => [1, 2, 3, 4, 5].map((j) => `${p}_${j}`)));
  // Bank keys are kept, so sets already in the database still resolve.
  assert.equal(l1[0][0].key, 'l1_rain');
  assert.equal(l2[1][0].key, 'time_1');
  for (const q of [...l1.flat(), ...l2.flat()]) assert.deepEqual(Object.keys(q.text).sort(), [...LANGS].sort());
  assert.deepEqual(defaultSlots(3), []);
});

test('defaultTitles: Level 2 lists carry the owner\'s topics, Level 1 none; valid as the admin saves them', () => {
  assert.deepEqual(defaultTitles(1), [null, null, null, null]);
  assert.deepEqual(defaultTitles(2).map((t) => t.en), ['Intentions', 'Time of Comfort', 'Venue Vibe']);
  assert.deepEqual(checkQuestionTitles(defaultTitles(2), 2), { ok: true, problems: [] });
  assert.deepEqual(defaultTitles(3), []);
  const a = defaultTitles(2);
  a[0].en = 'changed';
  assert.equal(defaultTitles(2)[0].en, 'Intentions'); // fresh copies
});

test('defaultSlots returns fresh copies (editing them never touches the bank)', () => {
  const a = defaultSlots(1);
  a[0][0].text.en = 'changed';
  a[0].pop();
  const b = defaultSlots(1);
  assert.equal(b[0][0].text.en, 'Is it raining where you are?');
  assert.equal(b[0].length, 5);
  assert.equal(SYSTEM_QUESTIONS[1][0].text.en, 'Is it raining where you are?');
});

test('checkQuestionChoice: 4–100 characters, never a contact detail', () => {
  assert.deepEqual(CHOICE_LIMITS, [4, 100]);
  assert.equal(checkQuestionChoice('Is it raining where you are?').ok, true);
  assert.equal(checkQuestionChoice('តើនៅកន្លែងអ្នកកំពុងភ្លៀងទេ?').ok, true);
  assert.equal(checkQuestionChoice('下雨吗？').ok, true); // 4 characters
  assert.equal(checkQuestionChoice('').error, 'empty');
  assert.equal(checkQuestionChoice('   ').error, 'empty');
  assert.equal(checkQuestionChoice(undefined).error, 'empty');
  assert.equal(checkQuestionChoice(42).error, 'empty');
  assert.equal(checkQuestionChoice('Hi?').error, 'too_short');
  assert.equal(checkQuestionChoice('a'.repeat(100)).ok, true);
  const long = checkQuestionChoice('a'.repeat(101));
  assert.equal(long.error, 'too_long');
  assert.equal(long.count, 101);
  const tg = checkQuestionChoice('Can you add me on Telegram?');
  assert.equal(tg.error, 'contact');
  assert.ok(tg.hits.length > 0 && tg.reason);
  assert.equal(checkQuestionChoice('Is 012 345 678 your number?').error, 'contact');
});

test('checkQuestionSlots: the built-in choices pass', () => {
  for (const level of [1, 2]) assert.deepEqual(checkQuestionSlots(defaultSlots(level), level), { ok: true, problems: [] });
});

test('checkQuestionSlots: shape', () => {
  assert.equal(checkQuestionSlots(defaultSlots(1).slice(0, 3), 1).problems[0].error, 'shape');
  assert.equal(checkQuestionSlots(defaultSlots(1), 2).problems[0].error, 'shape');
  assert.equal(checkQuestionSlots(null, 1).problems[0].error, 'shape');
  assert.equal(checkQuestionSlots(defaultSlots(1), 3).problems[0].error, 'level');
  const short = defaultSlots(2);
  short[1].pop();
  assert.deepEqual(checkQuestionSlots(short, 2).problems.map((p) => [p.slot, p.choice, p.error]), [[2, null, 'shape']]);
});

test('checkQuestionSlots: every language, contact details, length', () => {
  const slots = defaultSlots(1);
  slots[0][3].text.km = '';
  slots[2][1].text.zh = '加我微信好吗？';
  slots[3][4].text.ja = 'あ';
  delete slots[1][2].text.ko;
  slots[1][0] = { key: 'x', text: null };
  const { ok, problems } = checkQuestionSlots(slots, 1);
  assert.equal(ok, false);
  const at = (s, c, l) => problems.find((p) => p.slot === s && p.choice === c && p.lang === l);
  assert.equal(at(1, 4, 'km').error, 'empty');
  assert.match(at(1, 4, 'km').message, /Khmer text is missing/);
  assert.equal(at(3, 2, 'zh').error, 'contact');
  assert.ok(at(3, 2, 'zh').reason);
  assert.equal(at(4, 5, 'ja').error, 'too_short');
  assert.equal(at(2, 3, 'ko').error, 'empty');
  for (const lang of LANGS) assert.equal(at(2, 1, lang).error, 'empty'); // text: null → all five missing
});

test('checkQuestionSlots: no duplicates within a level (case, spaces and ? ignored)', () => {
  const slots = copy(defaultSlots(1));
  slots[2][3].text = tx('  is it RAINING where you are ');
  const { problems } = checkQuestionSlots(slots, 1);
  const dup = problems.find((p) => p.error === 'duplicate');
  assert.deepEqual([dup.slot, dup.choice, dup.lang, dup.dupOf], [3, 4, 'en', { slot: 1, choice: 1 }]);
  assert.match(dup.message, /Question 1 · choice 1/);
  // Different levels may share a text: each level is checked on its own.
  const l2 = defaultSlots(2);
  l2[0][4].text = tx('Is it raining where you are?');
  assert.equal(checkQuestionSlots(l2, 2).ok, true);
});

test('checkQuestionChoice: a broken character (U+FFFD from a bad UTF-8 decode) is refused', () => {
  const r = checkQuestionChoice('តើអ្នកចូលចិត្ត\uFFFD\uFFFD\uFFFD្កាឈូកទេ?');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'garbled');
  const slots = defaultSlots(1);
  slots[0][0].text.km = 'តើ\uFFFDនៅកន្លែងអ្នកកំពុងភ្លៀងទេ?';
  const p = checkQuestionSlots(slots, 1).problems.find((x) => x.slot === 1 && x.choice === 1 && x.lang === 'km');
  assert.equal(p.error, 'garbled');
  assert.match(p.message, /^Khmer: has a broken character/);
});

test('question topics: optional, all five languages once started, 2–40 characters, no contact details', () => {
  assert.deepEqual(TITLE_LIMITS, [2, 40]);
  assert.equal(checkQuestionTitle('生活').ok, true);
  assert.equal(checkQuestionTitle('A').error, 'too_short');
  assert.equal(checkQuestionTitle('a'.repeat(41)).error, 'too_long');
  assert.equal(checkQuestionTitle('Telegram').error, 'contact');
  assert.equal(hasTitle(null), false);
  assert.equal(hasTitle({ en: '  ', km: '' }), false);
  assert.equal(hasTitle({ en: 'Communication' }), true);
  // No topics at all, or every topic blank: fine.
  assert.deepEqual(checkQuestionTitles(undefined, 1), { ok: true, problems: [] });
  assert.deepEqual(checkQuestionTitles([null, null, null, null], 1), { ok: true, problems: [] });
  assert.equal(checkQuestionTitles([{ en: '', km: '', zh: '', ko: '', ja: '' }, null, null], 2).ok, true);
  // A topic in all five languages.
  const comm = tx('Communication');
  assert.equal(checkQuestionTitles([comm, null, null, null], 1).ok, true);
  // Started but not finished: each missing language is a problem on that question's topic.
  const { ok, problems } = checkQuestionTitles([null, { en: 'Lifestyle', km: 'របៀបរស់នៅ' }, null, null], 1);
  assert.equal(ok, false);
  assert.deepEqual(problems.map((p) => [p.slot, p.choice, p.field, p.lang, p.error]), [
    [2, null, 'title', 'zh', 'empty'], [2, null, 'title', 'ko', 'empty'], [2, null, 'title', 'ja', 'empty'],
  ]);
  assert.match(problems[0].message, /^Topic · Chinese text is missing/);
  assert.equal(checkQuestionTitles([tx('Add me on Telegram'), null, null], 2).problems[0].error, 'contact');
  assert.equal(checkQuestionTitles([null, null], 2).problems[0].error, 'shape'); // Level 2 has 3 lists now
  // Shape: one entry per picked question.
  assert.equal(checkQuestionTitles([comm], 1).problems[0].error, 'shape');
  assert.equal(checkQuestionTitles('Communication', 1).problems[0].error, 'shape');
  assert.equal(checkQuestionTitles([], 3).problems[0].error, 'level');
});

test('fillSlots: a Level 2 saved with 2 lists gets a third from built-in choices nobody uses yet', () => {
  // The admin's own two lists, as saved when Level 2 picked 2.
  const mine = [
    [tx('What is on your desk?'), tx('What did you eat today?'), tx('What is your street like?'), tx('Which song is stuck in your head?'), tx('What made you smile today?')]
      .map((text, j) => ({ key: `q2_aa${j}`, text })),
    defaultSlots(2)[1].map((c) => ({ key: c.key, text: { ...c.text } })), // list 2 = the built-in list 2
  ];
  const filled = fillSlots(mine, 2);
  assert.equal(filled.length, LEVEL_RULES[2].pick);
  assert.deepEqual(filled.slice(0, 2), mine); // the stored lists stay exactly as they are
  assert.equal(filled[2].length, QUESTION_CHOICES);
  const used = new Set([...mine[0], ...mine[1]].map((c) => c.key));
  for (const c of filled[2]) assert.ok(!used.has(c.key), `${c.key} is new`);
  assert.equal(new Set(filled.flat().map((c) => c.key)).size, 15); // no key twice
  assert.equal(checkQuestionSlots(filled, 2).ok, true);
  // Built-in list 3 comes first when it is free.
  assert.deepEqual(filled[2].map((c) => c.key), defaultSlots(2)[2].map((c) => c.key));
  // A choice whose text is already used (any language) is skipped.
  const clash = [mine[0], mine[1].map((c, j) => (j === 0 ? { key: 'q2_x', text: { ...defaultSlots(2)[2][0].text } } : c))];
  assert.ok(!fillSlots(clash, 2)[2].some((c) => c.text.en === defaultSlots(2)[2][0].text.en));
  // Already complete, or Level 1: unchanged (fresh copies).
  const full = defaultSlots(2);
  const same = fillSlots(full, 2);
  assert.deepEqual(same, full);
  assert.notEqual(same[0], full[0]);
  assert.deepEqual(fillSlots(defaultSlots(1), 1), defaultSlots(1));
});
