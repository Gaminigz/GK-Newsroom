// Run: node --test src/thirtyda-app/shared/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SYSTEM_QUESTIONS, LEVEL_RULES, L1_ANSWERS, ROLES, questionText, answerText, replyOptions, l1Answers } from './questions.js';
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

test('the bank has at least 14 questions per level, with unique keys', () => {
  assert.ok(SYSTEM_QUESTIONS[1].length >= 14);
  assert.ok(SYSTEM_QUESTIONS[2].length >= 14);
  const keys = [...SYSTEM_QUESTIONS[1], ...SYSTEM_QUESTIONS[2]].map((x) => x.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const x of SYSTEM_QUESTIONS[1]) assert.match(x.key, /^l1_[a-z0-9_]+$/);
  for (const x of SYSTEM_QUESTIONS[2]) assert.match(x.key, /^l2_[a-z0-9_]+$/);
});

test('every question, answer and role has all five languages', () => {
  for (const level of [1, 2]) SYSTEM_QUESTIONS[level].forEach((x) => assertAllLanguages(x, `L${level} ${x.key}`));
  L1_ANSWERS.forEach((x) => assertAllLanguages(x, `answer ${x.key}`));
  ROLES.forEach((x) => assertAllLanguages(x, `role ${x.key}`));
});

test('the design examples are in the bank word for word', () => {
  const en = (level) => SYSTEM_QUESTIONS[level].map((x) => x.text.en);
  for (const s of ['Is it raining where you are?', 'Is it busy around you right now?', 'Are you outside right now?',
    'Is it a quiet day for you?']) assert.ok(en(1).includes(s), s);
  for (const s of ['What can you see from your window?', 'What is the weather like there?']) assert.ok(en(2).includes(s), s);
});

test('Level 1 questions are yes/no, Level 2 questions are open', () => {
  for (const x of SYSTEM_QUESTIONS[1]) {
    assert.match(x.text.en, /^(Is|Are|Do|Does|Can|Has|Have)\b.*\?$/, x.key);
  }
  for (const x of SYSTEM_QUESTIONS[2]) {
    assert.match(x.text.en, /^(What|How|Where|Which|Who|When|Why)\b.*\?$/, x.key);
  }
  for (const level of [1, 2]) {
    for (const x of SYSTEM_QUESTIONS[level]) {
      for (const lang of LANGS) assert.match(x.text[lang], /[?？]$/, `${x.key}.${lang} ends with a question mark`);
    }
  }
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
