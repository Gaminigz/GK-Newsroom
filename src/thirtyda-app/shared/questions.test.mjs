// Run: node --test src/thirtyda-app/shared/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SYSTEM_QUESTIONS, SYSTEM_TOPICS, RETIRED_QUESTIONS, LEVEL_RULES, L1_ANSWERS, ROLES, questionText, answerText, replyOptions, l1Answers,
} from './questions.js';
import { LANGS, findContactDetails, checkWrittenQuestion } from './rules.js';

// A real translation is written in its own script, not a copy of the English.
const SCRIPT = {
  km: /[\u1780-\u17ff]/,
  zh: /[\u4e00-\u9fff]/,
  ko: /[\uac00-\ud7a3]/,
  ja: /[\u3040-\u30ff\u4e00-\u9fff]/,
};

function assertAllLanguages(item, where) {
  assert.equal(typeof item.key, 'string', where);
  assert.ok(item.key.length > 0, where);
  assert.deepEqual(Object.keys(item.text).sort(), [...LANGS].sort(), `${where} languages`);
  for (const lang of LANGS) {
    const s = item.text[lang];
    assert.equal(typeof s, 'string', `${where}.${lang}`);
    assert.ok(s.trim().length > 0, `${where}.${lang} is empty`);
    assert.ok(!/TODO|TBD|\.\.\.|…|\?\?\?/.test(s), `${where}.${lang} looks like a placeholder: ${s}`);
    if (lang !== 'en') {
      assert.notEqual(s, item.text.en, `${where}.${lang} is untranslated`);
      assert.ok(SCRIPT[lang].test(s), `${where}.${lang} is not in its script: ${s}`);
    }
  }
}

test('the bank: Level 1 at least 14 questions, Level 2 the owner’s 3 lists of 5, unique keys (retired ones too)', () => {
  assert.ok(SYSTEM_QUESTIONS[1].length >= 14);
  assert.equal(SYSTEM_QUESTIONS[2].length, 15);
  const keys = [...SYSTEM_QUESTIONS[1], ...SYSTEM_QUESTIONS[2], ...RETIRED_QUESTIONS[2]].map((x) => x.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const x of SYSTEM_QUESTIONS[1]) assert.match(x.key, /^l1_[a-z0-9_]+$/);
  for (const x of SYSTEM_QUESTIONS[2]) assert.match(x.key, /^(inten|time|venue)_[1-5]$/);
  for (const x of RETIRED_QUESTIONS[2]) assert.match(x.key, /^l2_[a-z0-9_]+$/);
});

test('every question, answer and role has all five languages', () => {
  for (const level of [1, 2]) SYSTEM_QUESTIONS[level].forEach((x) => assertAllLanguages(x, `L${level} ${x.key}`));
  RETIRED_QUESTIONS[2].forEach((x) => assertAllLanguages(x, `retired L2 ${x.key}`));
  SYSTEM_TOPICS[2].forEach((text, i) => assertAllLanguages({ key: `topic${i + 1}`, text }, `L2 topic ${i + 1}`));
  L1_ANSWERS.forEach((x) => assertAllLanguages(x, `answer ${x.key}`));
  ROLES.forEach((x) => assertAllLanguages(x, `role ${x.key}`));
});

test('the design examples are in the bank word for word', () => {
  const en = (level) => SYSTEM_QUESTIONS[level].map((x) => x.text.en);
  for (const s of ['Is it raining where you are?', 'Is it busy around you right now?', 'Are you outside right now?',
    'Is it a quiet day for you?']) assert.ok(en(1).includes(s), s);
  for (const s of ['Meeting in person is better.', 'After work fits best.', 'A coffee shop works well.']) assert.ok(en(2).includes(s), s);
});

test('Level 2 is the owner\'s lists: Intentions, Time of Comfort, Venue Vibe (topics in all five languages)', () => {
  assert.deepEqual(SYSTEM_TOPICS[1], []);
  assert.deepEqual(SYSTEM_TOPICS[2].map((x) => x.en), ['Intentions', 'Time of Comfort', 'Venue Vibe']);
  // Dealt in order: choice j of list i is item j × 3 + i.
  assert.deepEqual(SYSTEM_QUESTIONS[2].slice(0, 3).map((x) => x.key), ['inten_1', 'time_1', 'venue_1']);
  assert.deepEqual(SYSTEM_QUESTIONS[2].filter((_, i) => i % 3 === 0).map((x) => x.key), ['inten_1', 'inten_2', 'inten_3', 'inten_4', 'inten_5']);
});

test('Level 1 lines are yes/no questions; Level 2 lines are statements a tap answers, never open questions', () => {
  for (const x of SYSTEM_QUESTIONS[1]) {
    assert.match(x.text.en, /^(Is|Are|Do|Does|Can|Has|Have)\b.*\?$/, x.key);
    for (const lang of LANGS) assert.match(x.text[lang], /[?？]$/, `${x.key}.${lang} ends with a question mark`);
  }
  // Yes / No / Not really / Maybe has to make sense under every Level 2 line (Gamini 2026-10-13: replies are taps).
  for (const x of SYSTEM_QUESTIONS[2]) {
    assert.doesNotMatch(x.text.en, /^(What|How|Where|Which|Who|When|Why)\b/, x.key);
    for (const lang of LANGS) {
      assert.doesNotMatch(x.text[lang], /[?？]$/, `${x.key}.${lang} is not a question`);
      assert.match(x.text[lang], /[.。។]$/, `${x.key}.${lang} ends like a sentence`);
    }
  }
  // The retired open lines still read back for sets sent with them.
  for (const x of RETIRED_QUESTIONS[2]) assert.match(x.text.en, /^(What|How|Where|Which|Who|When|Why)\b.*\?$/, x.key);
  assert.equal(questionText(2, 'l2_window', 'en'), 'What can you see from your window?');
  assert.equal(questionText(2, 'l2_window', 'km'), 'តើអ្នកឃើញអ្វីខ្លះពីបង្អួចរបស់អ្នក?');
  assert.equal(questionText(2, 'venue_1', 'ja'), 'カフェがいいです。');
  assert.equal(questionText(1, 'l2_window', 'en'), null); // a retired key only on its own level
});

test('the bank itself passes the rules it enforces', () => {
  for (const level of [1, 2]) {
    for (const x of SYSTEM_QUESTIONS[level]) {
      for (const lang of LANGS) {
        const r = checkWrittenQuestion(x.text[lang], level);
        assert.equal(r.ok, true, `${x.key}.${lang}: ${r.error} ${JSON.stringify(r.hits)}`);
      }
    }
  }
  for (const x of [...L1_ANSWERS, ...ROLES]) {
    for (const lang of LANGS) assert.equal(findContactDetails(x.text[lang]).ok, true, `${x.key}.${lang}`);
  }
});

test('level rules: always 5 questions', () => {
  // Level 2 = 3 picked + 2 written (Gamini 2026-10-13: "3 system given + 2 text").
  assert.deepEqual(LEVEL_RULES, { 1: { pick: 4, write: 1 }, 2: { pick: 3, write: 2 } });
  for (const level of [1, 2]) {
    assert.equal(LEVEL_RULES[level].pick + LEVEL_RULES[level].write, 5);
    assert.ok(SYSTEM_QUESTIONS[level].length >= LEVEL_RULES[level].pick);
  }
});

test('replies are taps at both levels: a picked line 4 options, a written line Yes / No', () => {
  assert.deepEqual(replyOptions('system').map((x) => x.key), ['yes', 'no', 'not_really', 'maybe']);
  assert.deepEqual(replyOptions('written').map((x) => x.key), ['yes', 'no']);
  assert.equal(l1Answers, replyOptions); // the older name
  // A Level 2 reply in words from before the taps has no key: answerText gives null, the words read back.
  assert.equal(answerText(null, 'en'), null);
});

test('Level 1 answers and roles match the contract', () => {
  assert.deepEqual(L1_ANSWERS.map((x) => [x.key, x.text.en]), [
    ['yes', 'Yes'], ['no', 'No'], ['not_really', 'Not really'], ['maybe', 'Maybe'],
  ]);
  assert.deepEqual(ROLES.map((x) => [x.key, x.text.en]), [
    ['sales', 'Sales'], ['accountant', 'Accountant'], ['hr', 'HR'], ['administration', 'Administration'],
    ['manager', 'Manager'], ['director', 'Director'], ['doctor', 'Doctor'], ['nurse', 'Nurse'],
    ['civil_engineering', 'Civil engineering'], ['airport_staff', 'Airport staff'], ['government', 'Government'],
    ['operations', 'Operations'], ['logistics', 'Logistics'], ['shop_staff', 'Shop staff'], ['farm', 'Farm'],
    ['own_business', 'Own business'], ['stay_home', 'Stay home'], ['time_off', 'Taking some time off'],
    ['family_home', 'Family time or Home business'],
  ]);
  for (const list of [L1_ANSWERS, ROLES]) {
    for (const lang of LANGS) {
      const texts = list.map((x) => x.text[lang]);
      assert.equal(new Set(texts).size, texts.length, `distinct ${lang} labels`);
    }
  }
});

test('questionText and answerText', () => {
  assert.equal(questionText(1, 'l1_rain', 'en'), 'Is it raining where you are?');
  assert.equal(questionText(1, 'l1_rain', 'km'), 'តើនៅកន្លែងអ្នកកំពុងភ្លៀងទេ?');
  assert.equal(questionText(2, 'l2_window', 'zh'), '从你的窗户能看到什么？');
  assert.equal(questionText('2', 'l2_weather', 'ja'), 'そちらの天気はどうですか？');
  assert.equal(questionText(1, 'l1_rain', 'fr'), 'Is it raining where you are?'); // unknown language → English
  assert.equal(questionText(2, 'l1_rain', 'en'), null); // wrong level
  assert.equal(questionText(1, 'nope', 'en'), null);
  assert.equal(questionText(3, 'l1_rain', 'en'), null);
  assert.equal(answerText('yes', 'ko'), '네');
  assert.equal(answerText('not_really', 'en'), 'Not really');
  assert.equal(answerText('maybe', 'xx'), 'Maybe');
  assert.equal(answerText('nope', 'en'), null);
  for (const level of [1, 2]) {
    for (const x of SYSTEM_QUESTIONS[level]) for (const lang of LANGS) assert.equal(questionText(level, x.key, lang), x.text[lang]);
  }
});
