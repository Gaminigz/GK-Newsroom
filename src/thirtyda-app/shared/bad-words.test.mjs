// Run: node --test src/thirtyda-app/shared/
// The bad-word filter (store policy, owner 2026-10-14): ./bad-words.js lists, rules.js findBadWords and the checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BAD_WORDS, BAD_WORD_CATEGORIES, BAD_WORD_REASONS } from './bad-words.js';
import {
  findBadWords, findContactDetails, checkAppName, checkRealName, checkChatMessage, checkWrittenQuestion, checkWrittenAnswer,
  REAL_NAME_MIN, REAL_NAME_MAX, BAD_WORD_REASONS as REASONS_FROM_RULES,
} from './rules.js';

const LANGS = ['en', 'km', 'zh', 'ko', 'ja'];
const ZWSP = String.fromCodePoint(0x200b);
const CYRILLIC_ES = String.fromCodePoint(0x441); // с, looks like a Latin c

function assertCaught(text, category) {
  const r = findBadWords(text);
  assert.equal(r.ok, false, `should stop: ${JSON.stringify(text)}`);
  if (category) assert.equal(r.hits[0].category, category, `category for ${JSON.stringify(text)}: ${JSON.stringify(r.hits)}`);
  assert.equal(r.reason, BAD_WORD_REASONS[r.hits[0].category]);
  for (const h of r.hits) {
    assert.equal(h.type, 'word');
    assert.equal(text.slice(h.start, h.end), h.match, `start/end must point at the match in ${JSON.stringify(text)}`);
  }
  return r;
}

function assertClean(text) {
  const r = findBadWords(text);
  assert.deepEqual(r, { ok: true, hits: [], reason: null }, `should not stop: ${JSON.stringify(text)} → ${JSON.stringify(r.hits)}`);
}

test('four categories, each with words in all five languages; the admin reasons are plain English', () => {
  assert.deepEqual([...BAD_WORD_CATEGORIES], ['sexual', 'slur', 'harassment', 'money']);
  assert.deepEqual(REASONS_FROM_RULES, BAD_WORD_REASONS);
  assert.deepEqual(BAD_WORD_REASONS, {
    sexual: 'Sexual words', slur: 'Slur', harassment: 'Rude or threatening words', money: 'Money or escort words',
  });
  for (const c of BAD_WORD_CATEGORIES) {
    for (const lang of LANGS) assert.ok(BAD_WORDS[c][lang]?.length > 0, `${c} has ${lang} words`);
  }
});

test('every listed word is stopped when typed on its own, under its own category', () => {
  for (const c of BAD_WORD_CATEGORIES) {
    for (const lang of LANGS) {
      for (const entry of BAD_WORDS[c][lang]) {
        const word = (Array.isArray(entry) ? entry[0] : entry).replace(/^[*<]|\*$/g, '');
        const r = assertCaught(word);
        // A word listed under two categories (援交 is money in zh and ja) may report either; the hit covers it all.
        assert.equal(r.hits[0].match, word, `${c}/${lang}: ${word}`);
      }
    }
  }
});

test('English: inside a sentence, any case, plurals and run-on forms', () => {
  assertCaught('what the fuck is this', 'harassment');
  assertCaught('FUCKING hell', 'harassment');
  assertCaught('motherfucker', 'harassment');
  assertCaught('that is bullshit', 'harassment');
  assertCaught('you bitches', 'harassment');
  assertCaught('send nudes please', 'sexual');
  assertCaught('Do you like sex?', 'sexual');
  assertCaught('nice boobs', 'sexual');
  assertCaught('watch porno together', 'sexual');
  assertCaught('looking for a sugar daddy', 'money');
  assertCaught('sugardaddy wanted', 'money');
  assertCaught('sugar-daddy wanted', 'money');
  assertCaught('can you send me money', 'money');
  assertCaught('I invest in USDT', 'money');
  assertCaught('go kill yourself', 'harassment');
  assertCaught('go die', 'harassment');
  assertCaught('he is a rapist', 'harassment');
  assertCaught('stupid nigga', 'slur');
  // The longer phrase wins: "pay for sex" is a money word, not just "sex".
  assert.equal(findBadWords('I can pay for sex').hits[0].category, 'money');
});

test('look-alike spellings are read through: stand-ins, held letters, spaced letters, full-width, accents, look-alikes', () => {
  for (const text of ['f*ck', 'fuuuck', 'fuckkk', 'fvck', 'sh1t', 'sh!t', 'p0rn', 's3x', '$ex', 'b00bs', 'a$$hole', 'c*nt',
    'f u c k', 'f.u.c.k', 'f-u-c-k', 's e x', 'ｆｕｃｋ', 'ＳＥＸ', 'fück', `fu${CYRILLIC_ES}k`, `fu${ZWSP}ck`, 'phuck']) {
    assertCaught(text);
  }
  // The hit points at what was typed, not at the folded copy.
  const r = assertCaught('oh ｆｕｃｋ no');
  assert.equal(r.hits[0].match, 'ｆｕｃｋ');
  assert.equal(assertCaught(`you fu${ZWSP}ck`).hits[0].match, `fu${ZWSP}ck`);
});

test('English everyday words are never stopped', () => {
  for (const text of [
    'Sussex', 'Essex', 'unisex', 'sexist', 'sextant', 'Sexton', 'cocktail', 'cockpit', 'peacock', 'analysis', 'canal', 'cucumber',
    'cumin', 'circumstance', 'grape', 'grapes', 'scrape', 'therapist', 'Scunthorpe',
    'class', 'pass', 'grass', 'assume', 'massive', 'embassy', 'I use an A55', "A's 5 lines", 'shiitake', 'goodies',
    'goodie bag', 'Dickens', 'pussycat', 'titanic', 'niggle', 'fire retardant', 'Japan', 'Pakistan', 'specific', 'spice',
    'skunk', 'document', 'homework', 'poorness', 'rapping', 'I like rap music', 'escort you home', 'hook up the TV',
    'I send money to my parents', 'I work in cryptography', 'I have a dog', 'my crazy pig', 'you are stupid',
    'Do you like hiking?', 'What is your favourite food?', 'kinky hair', 'I am a bit anal about tidiness',
    'Fuk Wing', 'Lee Fuk', 'bok choy', 'Phuc', 'Van Dyke', 'hello there', 'Wanna meet for coffee?', 'basketball',
    'Hancock', 'Babcock', 'scrapbook', 'drape', 'skyscraper', 'titmouse', 'Matsushita', 'Shitara',
  ]) assertClean(text);
});

test('Khmer: words and syllable edges', () => {
  assertCaught('ចុយម្រាយ', 'harassment');
  assertCaught('ចង់រួមភេទទេ', 'sexual');
  assertCaught('អាខ្ទើយ', 'slur');
  assertCaught('ស្រីពេស្យា', 'money');
  assertCaught('ទៅងាប់ទៅ', 'harassment');
  for (const text of [
    'សួស្តី', 'អរគុណ', 'ខ្ញុំចូលចិត្តឆ្កែ', 'សាច់ជ្រូក', 'ចុះទៅផ្សារ', 'ចុងសប្តាហ៍', 'ភេទ', 'ប្រាប់ខ្ញុំអំពីគ្រួសារ',
    'ឪពុកខ្ញុំបានស្លាប់ទៅហើយ', 'ម្ដាយខ្ញុំផ្ញើលុយមក', 'ខ្ញុំរកស៊ីលក់ដូរ', 'សុផានី', 'ស្រីល័ក្ខ',
  ]) assertClean(text);
});

test('Chinese: simplified and traditional, spaced out, and the everyday words around them', () => {
  assertCaught('想做爱吗', 'sexual');
  assertCaught('想做 爱吗', 'sexual');
  assertCaught('做愛', 'sexual');
  assertCaught('你这个傻逼', 'harassment');
  assertCaught('他妈的', 'harassment');
  assertCaught('援交', 'money');
  assertCaught('给我打钱', 'money');
  assertCaught('看A片', 'sexual');
  for (const text of [
    '我爱你', '爱情', '你好', '上床睡觉', '我妈妈的生日', '你妈的身体好吗', '体操你喜欢吗', '以前在网吧包夜', '聊以自慰',
    '小姐你好', '我给父母寄钱', '我喜欢做饭', '王小美', 'data片段',
  ]) assertClean(text);
});

test('Korean: words, and the everyday words that look like them', () => {
  assertCaught('섹스 하자', 'sexual');
  assertCaught('씨발', 'harassment');
  assertCaught('씨발놈아', 'harassment');
  assertCaught('ㅅㅂ', 'harassment');
  assertCaught('병신', 'slur');
  assertCaught('조건만남 해요', 'money');
  assertCaught('돈 보내줘', 'money');
  assertCaught('돈보내줘', 'money');
  for (const text of [
    '보지 마', '자지 마', '민수씨발음이 좋네요', '시발점', '야 동네', '야동네 친구', '걸레로 닦다', '불이 꺼져 있다',
    '엄마한테 돈 보냈어', '친구가 돈 빌려줘서 고마웠다', '안녕하세요', '김민준', '배고파 죽겠어',
  ]) assertClean(text);
});

test('Japanese: katakana words stand alone; everyday words around them', () => {
  assertCaught('セックスしたい', 'sexual');
  assertCaught('セックスレス', 'sexual');
  assertCaught('エッチしたい', 'sexual');
  assertCaught('エロい', 'sexual');
  assertCaught('ﾌｪﾗ', 'sexual'); // half-width
  assertCaught('死ね', 'harassment');
  assertCaught('パパ活', 'money');
  assertCaught('お金貸してくれない？', 'money');
  for (const text of [
    'エッチング', 'フェラーリ', 'フェラガモ', 'ヌードル', 'ピエロ', 'スケッチ', 'キモチ', 'キモノ', '天カスうどん', 'まだ死ねない',
    '友達がお金を貸してくれた', '支那そば', 'こんにちは', 'さくら', 'ありがとう', 'バカだなあ', 'クソ暑い',
  ]) assertClean(text);
});

test('findBadWords: empty and blank text is fine', () => {
  for (const text of ['', '   ', null, undefined]) assertClean(text);
});

test('checkAppName: a bad word is refused (after a contact detail, before the length)', () => {
  const c = checkAppName('Sexy');
  assert.equal(c.ok, false);
  assert.equal(c.error, 'word');
  assert.equal(c.reason, 'Sexual words');
  assert.equal(c.hits[0].match, 'Sexy');
  assert.equal(checkAppName('Fuckboy99').error, 'word'); // too long too, but the word is what matters
  assert.equal(checkAppName('ចុយ').error, 'word');
  assert.equal(checkAppName('Telegram').error, 'contact');
  assert.equal(checkAppName('Sok Ny').ok, true);
  assert.equal(checkAppName('Dara').ok, true);
});

test('checkRealName: 2–60 characters, no bad word', () => {
  assert.deepEqual(checkRealName('  Sok   Dara '), { ok: true, name: 'Sok Dara', count: 8, error: null, hits: [], reason: null });
  assert.equal(REAL_NAME_MIN, 2);
  assert.equal(REAL_NAME_MAX, 60);
  assert.equal(checkRealName('').error, 'empty');
  assert.equal(checkRealName(undefined).error, 'empty');
  assert.equal(checkRealName('A').error, 'too_short');
  assert.equal(checkRealName('A'.repeat(60)).ok, true);
  assert.equal(checkRealName('A'.repeat(61)).error, 'too_long');
  const w = checkRealName('Pussy Cat');
  assert.equal(w.error, 'word');
  assert.equal(w.reason, 'Sexual words');
  for (const name of ['សុខ ដារ៉ា', '王小美', '김민준', '佐藤 さくら', 'Fuk Wing Lee', 'Nguyen Van Phuc']) assert.equal(checkRealName(name).ok, true, name);
});

test('checkChatMessage and the written lines: a bad word is error "word", a contact detail still comes first', () => {
  const r = checkChatMessage('you are such a bitch honestly');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'word');
  assert.equal(r.reason, 'Rude or threatening words');
  assert.equal(r.hits[0].match, 'bitch');
  assert.ok(r.count >= 20);
  // A short line with a bad word is still a bad-word stop (it is recorded, not just "too short").
  assert.equal(checkChatMessage('fuck').error, 'word');
  // Contact detail + bad word: the contact detail is reported (its own reason).
  const both = checkChatMessage('fuck it, my number 012887766');
  assert.equal(both.error, 'contact');
  assert.equal(findContactDetails('fuck it, my number 012887766').ok, false);
  assert.equal(checkChatMessage('I love hiking on weekends').ok, true);

  assert.equal(checkWrittenQuestion('Do you like sex?', 1).error, 'word');
  assert.equal(checkWrittenQuestion('Are you a sugar baby?', 2).reason, 'Money or escort words');
  assert.equal(checkWrittenQuestion('Do you like cocktails?', 1).ok, true);
  assert.equal(checkWrittenAnswer('nice boobs').error, 'word');
});
