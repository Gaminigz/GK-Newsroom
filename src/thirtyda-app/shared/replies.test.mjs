// node --test src/thirtyda-app/shared/replies.test.mjs
// Typed replies to Level 1 / Level 2 lines (owner 2026-10-14: "all questions answering method change to 10 characters
// max" — "so no more yes no not really maybe"; and "same rule — can not write numbers like a phone or a TG handle, or
// imply them by words, even if they write them vertically or horizontally"): 1–10 characters as a person counts them,
// one reply's own contact-detail check, and the check over the same person's texts read together.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REPLY_MIN, REPLY_MAX, REPLY_RAW_MAX, SPLIT_DIGITS, cleanReply, cleanText, stripBidi, checkReply, checkAppName, checkRealName,
  checkChatMessage, findContactDetails, findReplyContactDetails, findSplitContactDetails, charCount, CONTACT_REASONS,
} from './rules.js';
import {
  ownTexts, replyOrders, writtenOrders, chatOrders, typedReply, withReply, allReplied, repliedCount, levelComplete, nextStep,
} from './conversation.js';
import { answerText } from './questions.js';

const ME = 'U-1';
const THEM = 'U-2';
const at = (min) => new Date(Date.UTC(2026, 9, 14, 10, min)).toISOString();

// ---------------------------------------------------------------- one reply: 1–10 characters

test('a reply is 1–10 characters as a person counts them, trimmed, one line', () => {
  assert.equal(REPLY_MIN, 1);
  assert.equal(REPLY_MAX, 10);
  for (const ok of ['y', 'Yes', 'Not today', 'abcdefghij', '👍', 'ចាស', 'ខ្ញុំនៅផ្ទះ', '好的', '好的好的好的好的好的', '네, 지금요', 'はい、少し', '10:30', '2 or 3']) {
    const r = checkReply(ok);
    assert.equal(r.ok, true, `${ok}: ${r.error} ${JSON.stringify(r.hits)}`);
    assert.ok(r.count >= 1 && r.count <= 10, ok);
  }
  // Khmer and CJK are counted fairly: a Khmer stack is one character, a Chinese character is one.
  assert.equal(charCount('ខ្ញុំ'), 1);
  assert.equal(checkReply('ខ្ញុំ').count, 1);
  assert.equal(checkReply('ខ្ញុំនៅផ្ទះ').count, 3);
  assert.equal(checkReply('好的好的好的好的好的').count, 10);
  assert.deepEqual([checkReply('好的好的好的好的好的好').error, checkReply('好的好的好的好的好的好').count], ['too_long', 11]);
  assert.deepEqual([checkReply('abcdefghijk').error, checkReply('abcdefghijk').count], ['too_long', 11]);
  assert.equal(checkReply('안녕하세요반가워요오늘').error, 'too_long');
  // Empty: nothing, spaces, invisible characters, marks on nothing.
  for (const empty of ['', '   ', '\n\t', '​', '​‍', '́', null, undefined]) {
    assert.equal(checkReply(empty).error, 'empty', JSON.stringify(empty));
  }
  // One line: line breaks and runs of spaces become one space; the ends are trimmed.
  assert.equal(cleanReply('  Not\n\ntoday  '), 'Not today');
  assert.equal(checkReply('  Not\n\ntoday  ').text, 'Not today');
  // Raw caps: marks stacked onto one letter count as one character but are still too long.
  assert.equal(checkReply(`a${'́'.repeat(40)}`).error, 'too_long');
  assert.equal(checkReply('👩🏽‍❤️‍💋‍👨🏻').ok, true); // one emoji, ten code points
});

test('a bad word in a reply is refused (and reported as a word, after a contact detail)', () => {
  const r = checkReply('fuck off');
  assert.equal(r.error, 'word');
  assert.ok(r.hits.length && r.reason);
  assert.equal(checkReply('tg fuck').error, 'contact'); // a contact detail is reported first
});

// ---------------------------------------------------------------- one reply: no phone number or handle, in any form

test('single-reply tricks are stopped: spaced digits, tg:x, @ab, number words in all five languages', () => {
  const stopped = {
    phone: [
      '0 1 2 8 8', '012 887', '0128877', '0-1-2-8-8', '0a1b2c8d8', // digits, spaced, dashed, glued between letters
      '០១២៨៨', '０１２８８', // Khmer and full-width digits
      'oh 1 2 3 4', 'zero1two34', 'one two three four', // English number words (and mixed)
      'សូន្យមួយពីរបីបួន', // Khmer number words
      '零一二八八', '〇一二八八', // Chinese
      '공일이팔팔', // Korean digit syllables (a run of 4+)
      'ぜろいちはちはち', // Japanese
    ],
    handle: ['@ab', '@a', '@x_1', 'me@ab'],
    app: ['tg:x', 'tg', 'TG dara', 'tele', 'insta', 'IG', 'fb', 'viber', 'wechat', '微信', '카톡', 'テレグラム', 'តេឡេក្រាម'],
  };
  for (const [type, list] of Object.entries(stopped)) {
    for (const text of list) {
      const c = findReplyContactDetails(text);
      assert.equal(c.ok, false, `${text} is stopped`);
      assert.equal(c.hits[0].type, type, `${text}: ${c.hits[0].type}`);
      assert.equal(c.reason, CONTACT_REASONS[type]);
      assert.equal(checkReply(text).error, 'contact', text);
    }
  }
  // Ordinary short replies with a number or an "at" in them pass.
  for (const fine of ['Yes', 'yes 2 kids', '5pm', 'at 7', '10:30', '1990', '2 or 3', '@home', '@5pm', '十一点半', '二十一点',
    '일이 많아요', '오늘 이일', 'いちばん', 'ダラさん、はい', 'oh no', 'no one', 'Not really', 'មិនសូវទេ', 'អត់ទេ']) {
    const c = findReplyContactDetails(fine);
    assert.equal(c.ok, true, `${fine}: ${JSON.stringify(c.hits)}`);
  }
});

// ---------------------------------------------------------------- read together: down the screen and as typed

/** One order, the last text (or `fresh`) the new one. */
const order = (texts, fresh = texts.length - 1) => [texts.map((text, i) => ({ text, fresh: i === fresh }))];
const split = (texts, fresh) => findSplitContactDetails(order(texts, fresh));

test('a phone number written down several replies is stopped: digits and number words in en / km / zh / ko / ja', () => {
  const vertical = [
    ['012', '887', '766'],
    ['0', '1', '2', '8', '8', '7', '7', '6', '6', '5'], // one digit per reply
    ['887', '766', '123'],
    ['Yes 012', 'ok 887', '766 lol'], // words around the pieces
    ['zero', 'one', 'two', 'eight', 'eight', 'seven', 'seven', 'six', 'six', 'five'],
    ['zero one', 'two eight', 'eight seven', 'seven six', 'six five'],
    ['សូន្យ', 'មួយ', 'ពីរ', 'ប្រាំបី', 'ប្រាំបី', 'ប្រាំពីរ', 'ប្រាំពីរ', 'ប្រាំមួយ', 'ប្រាំមួយ', 'ប្រាំ'],
    ['零一', '二八', '八七', '七六', '六五'],
    ['零一二', '八八七', '七六六', '五'],
    ['공일', '이팔', '팔칠', '칠육', '육오'],
    ['ぜろいち', 'にはち', 'はちなな', 'ななろく', 'ろくご'],
    ['០១២', '៨៨៧', '៧៦៦'],
  ];
  for (const texts of vertical) {
    const c = split(texts);
    assert.equal(c.ok, false, `${JSON.stringify(texts)} is stopped`);
    assert.equal(c.hits[0].type, 'phone', JSON.stringify(texts));
    assert.equal(c.reason, CONTACT_REASONS.phone);
    // What the admin sees: the pieces as they were written, one per line, and the hit inside it.
    assert.ok(c.text.split('\n').length >= 2, c.text);
    assert.ok(c.text.includes(c.hits[0].match), `${c.text} has ${c.hits[0].match}`);
    assert.ok(c.items.some((x) => x.fresh));
  }
  // Each piece alone passes the one-reply check (that is the trick).
  for (const piece of ['012', '887', '766', 'zero', 'សូន្យ', '零一', '공일', 'ぜろいち']) assert.equal(findReplyContactDetails(piece).ok, true, piece);
});

test('an app name or a handle split in two replies is stopped', () => {
  const pairs = [
    ['tele', 'gram'], ['we', 'chat'], ['whats', 'app'], ['what', 'sapp'], ['insta', 'gram'], ['kakao', 'talk'], ['tik', 'tok'],
    ['face', 'book'], ['vi', 'ber'], ['za', 'lo'], ['t', 'g'], ['te', 'le', 'gr', 'am'],
    ['微', '信'], ['카', '톡'], ['テレ', 'グラム'], ['តេឡេ', 'ក្រាម'],
    ['@', 'dara'], ['@', 'ab'], ['tg', 'dara88'], ['dara88', 'gmail'], ['dara', '@gmail.com'],
    ['t', 'e', 'l', 'e', 'g', 'r', 'a', 'm'],
  ];
  for (const texts of pairs) {
    const c = split(texts);
    assert.equal(c.ok, false, `${JSON.stringify(texts)} is stopped`);
    assert.ok(['app', 'handle', 'email'].includes(c.hits[0].type), `${JSON.stringify(texts)}: ${c.hits[0].type}`);
    // The new piece may come first too (a reply changed higher up the screen).
    assert.equal(split(texts, 0).ok, false, `${JSON.stringify(texts)} with the first one new`);
  }
});

test('only what reaches into the new text counts; ordinary replies read together pass', () => {
  // The pieces were let through before and the new reply is not part of them.
  assert.equal(split(['we', 'chat', 'ok']).ok, true);
  assert.equal(split(['hi', 'we', 'chat', 'ok'], 0).ok, true);
  assert.equal(split(['012', '887']).ok, true); // 6 digits is not a number yet
  for (const texts of [
    ['Yes', 'Not today', 'Maybe', 'A bit', 'Sure'],
    ['yes 2 kids', '5pm', 'at 7', '35', 'no', 'yes 3'],
    ['Hot today', 'Yes', 'Cafe', 'no', 'On a bus'],
    ['បាទ', 'អត់ទេ', 'ប្រហែលជា', 'បន្តិច', 'ចាស'],
    ['是的', '还没', '可能吧', '有一点', '好的'],
    ['네', '아니요', '아마도요', '조금요', '좋아요'],
    ['はい', 'いいえ', 'たぶん', '少し', 'いいね'],
  ]) {
    assert.equal(split(texts).ok, true, JSON.stringify(texts));
  }
  assert.equal(findSplitContactDetails([]).ok, true);
  assert.equal(findSplitContactDetails([[{ text: '012', fresh: true }]]).ok, true); // one text: the one-reply check's job
});

// ---------------------------------------------------------------- the orders, from the stored sets

/** A set as stored. */
function storedSet({ level, from, to, written = [], answers = [], sentAt = at(0) }) {
  const pick = level === 1 ? 4 : 3;
  const questions = [
    ...Array.from({ length: pick }, (_, i) => ({ n: i + 1, source: 'system', key: `k${i}`, text: 'Picked line.' })),
    ...written.map((text, j) => ({ n: pick + j + 1, source: 'written', key: null, text })),
  ];
  return { level, from, to, sentAt, questions, answers, completedAt: null };
}
const typed = (n, text, min) => ({ n, key: null, text, lang: 'en', translations: { en: text }, at: at(min) });
const tap = (n, key, min) => ({ n, key, text: null, lang: 'en', translations: {}, at: at(min) });

test('ownTexts: my written lines and my TYPED replies in this pair, oldest first; old taps and their texts left out', () => {
  const sets = [
    storedSet({ level: 1, from: THEM, to: ME, written: ['Do you like tea?'], answers: [typed(2, '012', 3), tap(1, 'yes', 2), typed(3, '887', 4)] }),
    storedSet({ level: 1, from: ME, to: THEM, written: ['Coffee or tea?'], sentAt: at(1), answers: [typed(1, 'Tea', 5)] }),
  ];
  assert.deepEqual(ownTexts(sets, ME).map((x) => [x.kind, x.n, x.text]), [['line', 5, 'Coffee or tea?'], ['reply', 2, '012'], ['reply', 3, '887']]);
  assert.deepEqual(ownTexts(sets, THEM).map((x) => x.text), ['Do you like tea?', 'Tea']);
  assert.equal(typedReply(tap(1, 'yes', 0)), false);
  assert.equal(typedReply(typed(1, 'Yes', 0)), true);
  assert.equal(typedReply({ n: 1, key: null, text: '' }), false);
});

test('replyOrders: down the screen (Level 1 then 2, line by line) and as typed; the reply being changed is left out', () => {
  const sets = [
    storedSet({ level: 1, from: THEM, to: ME, answers: [typed(3, '766', 1), typed(1, '012', 2)] }),
    storedSet({ level: 2, from: THEM, to: ME, answers: [typed(1, 'ok', 3)] }),
    storedSet({ level: 1, from: ME, to: THEM, written: ['Coffee?'], sentAt: at(0) }),
  ];
  const [down, typedOrder] = replyOrders({ sets, me: ME, reply: { level: 1, n: 2, text: '887' } });
  assert.deepEqual(down, [{ text: '012', fresh: false }, { text: '887', fresh: true }, { text: '766', fresh: false }, { text: 'ok', fresh: false }]);
  assert.deepEqual(typedOrder.map((x) => x.text), ['Coffee?', '766', '012', 'ok', '887']);
  assert.equal(typedOrder.at(-1).fresh, true);
  // Down the screen 012 / 887 / 766 is a number, whatever order they were typed in.
  const c = findSplitContactDetails(replyOrders({ sets, me: ME, reply: { level: 1, n: 2, text: '887' } }));
  assert.equal(c.ok, false);
  assert.equal(c.hits[0].type, 'phone');
  assert.equal(c.text, '012\n887\n766');
  // Changing line 2 to something else passes; changing line 1 (012 → 'Yes') drops the old 012 from the reading.
  assert.equal(findSplitContactDetails(replyOrders({ sets, me: ME, reply: { level: 1, n: 2, text: 'Not now' } })).ok, true);
  // A reply that finishes what my own written line began is stopped as typed.
  const begun = [
    storedSet({ level: 1, from: ME, to: THEM, written: ['My number starts with 012'], sentAt: at(0) }),
    storedSet({ level: 1, from: THEM, to: ME, answers: [typed(1, '887', 5)] }),
  ];
  const g = findSplitContactDetails(replyOrders({ sets: begun, me: ME, reply: { level: 1, n: 2, text: '766' } }));
  assert.equal(g.ok, false);
  assert.equal(g.hits[0].type, 'phone');
  assert.equal(g.text, 'My number starts with 012\n887\n766');
  // My last chat lines are read too (as typed).
  const withChat = replyOrders({ sets: [], me: ME, reply: { level: 1, n: 1, text: 'chat' }, chat: [{ text: 'we', at: at(9) }] });
  assert.equal(findSplitContactDetails(withChat).ok, false);
  // The other person's texts never count against me.
  const theirs = [storedSet({ level: 1, from: ME, to: THEM, answers: [typed(1, '012', 1), typed(2, '887', 2)] })];
  assert.equal(findSplitContactDetails(replyOrders({ sets: theirs, me: ME, reply: { level: 1, n: 3, text: '766' } })).ok, true);
});

test('writtenOrders: a new set\'s written lines are read after my earlier replies ("012", "887", then a line "766 …")', () => {
  const sets = [storedSet({ level: 1, from: THEM, to: ME, answers: [typed(1, '012', 1), typed(2, '887', 2)] })];
  const orders = writtenOrders({ sets, me: ME, written: [null, null, null, null, '766 is my lucky number'] });
  const c = findSplitContactDetails(orders);
  assert.equal(c.ok, false);
  assert.equal(c.hits[0].type, 'phone');
  assert.equal(c.items.find((x) => x.fresh).id, 4, 'the 422 points at line 5');
  assert.deepEqual(writtenOrders({ sets: [], me: ME, written: ['hi'] }), [], 'nothing before: nothing to read together');
  assert.equal(findSplitContactDetails(writtenOrders({ sets, me: ME, written: [null, null, null, null, 'Do you like tea?'] })).ok, true);
});

// ---------------------------------------------------------------- levels with typed replies, and old taps beside them

test('a level opens at 5/5 with typed replies (and with old taps mixed in)', () => {
  const s = storedSet({ level: 1, from: THEM, to: ME, written: ['Tea?'] });
  let answers = [];
  for (const [n, text] of [[1, 'Yes'], [2, 'Not today'], [3, 'ខ្ញុំ'], [4, '好的']]) {
    answers = withReply(answers, typed(n, text, n));
    assert.equal(allReplied({ ...s, answers }), false);
  }
  answers = withReply(answers, typed(2, 'Maybe', 9)); // changing one keeps 4 of 5
  assert.equal(repliedCount({ ...s, answers }), 4);
  answers = withReply(answers, tap(5, 'yes', 10)); // an old app's tap still counts
  assert.equal(allReplied({ ...s, answers }), true);
  const done = { ...s, answers, completedAt: at(10) };
  assert.equal(levelComplete(done, { ...done, from: ME, to: THEM }), true);
  assert.equal(nextStep({ stage: 'l1', mine: { ...done }, theirs: { ...done } }), 'wait_them');
  // Old taps still read back as words in every language.
  assert.equal(answerText('not_really', 'km'), 'មិនសូវទេ');
  assert.equal(answerText('ok', 'ja'), 'まあまあ');
});

// ---------------------------------------------------------------- review 2026-10-14: what still got through

const FAM = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}'; // 👨‍👩‍👧‍👦, one character of 7 code points

/** A person replying line by line to Level 1 then Level 2 (texts[0..4] → L1 lines 1–5, texts[5..9] → L2), as the server
 * reads each new reply (replyOrders + findSplitContactDetails, after the one-reply check). → { stopped: index|null, c } */
function typeReplies(texts, order = texts.map((_, i) => i)) {
  const sets = [
    storedSet({ level: 1, from: THEM, to: ME, written: ['Tea?'], sentAt: at(0) }),
    storedSet({ level: 2, from: THEM, to: ME, written: ['Cafe?', 'Rain?'], sentAt: at(1) }),
  ];
  let min = 2;
  for (const i of order) {
    const text = texts[i];
    if (text == null) continue;
    const level = i < 5 ? 1 : 2, n = (i % 5) + 1;
    const one = checkReply(text);
    assert.equal(one.ok, true, `${JSON.stringify(text)} passes alone: ${one.error}`);
    const c = findSplitContactDetails(replyOrders({ sets, me: ME, reply: { level, n, text } }));
    if (!c.ok) return { stopped: i, c };
    sets[level - 1].answers = withReply(sets[level - 1].answers, typed(n, text, min++));
  }
  return { stopped: null, c: null };
}

test('a phone number down the replies is stopped whatever sits between the pieces (digits and number words added up)', () => {
  assert.equal(SPLIT_DIGITS, 8);
  const F = 'abcdefghij';
  const numbers = [
    // Within Level 1, ordinary replies between the pieces, the first piece a lone 0.
    ['0', 'ថ្ងៃនេះខ្ញុំរវល់ណាស់', '1288', 'ខ្ញុំចូលចិត្តកាហ្វេ', '7766'],
    ['0', FAM.repeat(5), '1288', FAM.repeat(5), '7766'],
    ['0', 'Not really', '1288', 'Yes I do', '7766'],
    ['零', '今天有点忙不过来啊', '一二八八', '我很喜欢喝咖啡呢', '七七六六'], // Chinese number words
    // Across Level 1 and Level 2.
    ['0', 'Yes I do', 'Not really', '12', 'Coffee pls', 'Sunday', '887', 'Maybe', 'Hot today', '766'],
    ['01', 'Yes I do', 'Not really', 'Sure', '2887', 'Coffee pls', 'Sunday', 'Maybe', '766', 'ok'],
    ['1381', 'Yes', 'No', '2345', 'Maybe', 'Sure', '678'], // a Chinese mobile (no 0 or 855 to start it)
    ['1288', F, F, F, F, '7766'], // a Cambodian number without its 0
    // Spaced number words, one level to the next.
    ['zero one', F, 'two eight', F, 'eight 7', F, 'seven six', F, 'six five'],
    ['សូន្យមួយ', F, 'ពីរប្រាំបី', F, 'ប្រាំបីប្រាំពីរ', F, 'ប្រាំពីរប្រាំមួយ', F, 'ប្រាំមួយប្រាំ'],
    ['零', F, F, '一二', F, F, '八八七', F, F, '七六六'],
    ['ぜろいち', F, 'にはち', F, 'はちなな', F, 'ななろく'],
  ];
  for (const texts of numbers) {
    const { stopped, c } = typeReplies(texts);
    assert.notEqual(stopped, null, `${JSON.stringify(texts)} is stopped`);
    assert.equal(c.hits[0].type, 'phone', JSON.stringify(texts));
    assert.equal(c.reason, CONTACT_REASONS.phone);
    // The admin sees the pieces, one per line, the new one among them, and the hit inside the text.
    assert.ok(c.text.includes(c.hits[0].match), `${c.text} has ${c.hits[0].match}`);
    assert.ok(c.items.some((x) => x.fresh));
    assert.ok(c.text.split('\n').length >= 2, c.text);
  }
  // Typed out of screen order, the same.
  assert.notEqual(typeReplies(['0', F, F, '12', F, F, '887', F, F, '766'], [0, 3, 6, 9, 1, 2, 4, 5, 7, 8]).stopped, null);
  // The pieces as the admin sees them: only the replies that carry the digits.
  assert.equal(typeReplies(['0', 'Not really', '1288', 'Yes I do', '7766']).c.text.includes('1288'), true);
  assert.equal(split(['0', 'ថ្ងៃនេះខ្ញុំរវល់ណាស់', '1288', 'ខ្ញុំចូលចិត្តកាហ្វេ', '7766']).text, '0\n1288\n7766');
});

test('short replies with a few numbers in them still pass, read together (under 8 digits; number words that are words)', () => {
  const F = 'abcdefghij';
  for (const texts of [
    ['Yes', 'Not today', 'Oh', 'no one', 'one sec', 'Sure', 'Maybe', 'oh no', 'a bit', 'Yes!'],
    ['35', 'yes 2 kids', 'At 6pm', 'Sure', 'No', 'Maybe'], // 2 + 1 + 1
    ['012', F, F, F, F, '887'], // 6 digits is not a number yet
    ['012', F, '8877'], // nor 7
    ['一点点', '有一点', '一般般', '十分好', '不一定', '两个人', '一起吧', '左拐就是', '下午三点', '好的'], // 一 十 两 拐 in words
    ['ダラさん', 'いちばん', '一緒に', '十分です', 'たぶん', 'はい'],
    ['일이 많아요', '오늘 이일', '빵 좋아해요', '네', '아니요', '사실 조금'],
    ['មួយភ្លែត', 'បាទ', 'មានកូនពីរ', 'អត់ទេ', 'ប្រហែលជា'],
  ]) {
    assert.equal(typeReplies(texts).stopped, null, JSON.stringify(texts));
  }
});

test('a number begun in the replies is not finished in the chat (Level 3 reads my replies and written lines too)', () => {
  const sets = [
    storedSet({ level: 2, from: THEM, to: ME, answers: [typed(1, 'Sure', 1), typed(2, '012', 2), typed(3, '887', 3)] }),
    storedSet({ level: 2, from: ME, to: THEM, written: ['Coffee or tea?', 'Rain or sun?'], sentAt: at(0) }),
  ];
  const c = findSplitContactDetails(chatOrders({ sets, me: ME, text: '766 is my lucky number' }));
  assert.equal(c.ok, false);
  assert.equal(c.hits[0].type, 'phone');
  assert.ok(c.text.endsWith('766 is my lucky number'), c.text);
  assert.ok(c.text.includes('012') && c.text.includes('887'), c.text);
  assert.equal(c.items.at(-1).fresh, true, 'the chat line is the last piece');
  // Spelt out in the chat too; and in Khmer digits.
  assert.equal(findSplitContactDetails(chatOrders({ sets, me: ME, text: 'seven six six is my lucky one' })).ok, false);
  assert.equal(findSplitContactDetails(chatOrders({ sets, me: ME, text: 'លេខសំណាងខ្ញុំគឺ ៧៦៦ ណា' })).ok, false);
  // Recent chat lines count as before; an ordinary chat line after ordinary replies passes.
  const plain = [storedSet({ level: 2, from: THEM, to: ME, answers: [typed(1, '35', 1), typed(2, 'Yes', 2), typed(3, 'At 6pm', 3)] })];
  for (const text of ['I moved here in 2015, you?', 'My son is 7 and my girl is 5', 'Let us meet at 10:30 on Sat']) {
    assert.equal(findSplitContactDetails(chatOrders({ sets: plain, me: ME, text, chat: [{ text: 'I work 9 to 5 on weekdays', at: at(30) }] })).ok, true, text);
  }
  // A "time" that is no time on a clock is digits.
  assert.equal(findSplitContactDetails(chatOrders({ sets, me: ME, text: 'see you at 7:66 then ok?' })).ok, false);
  // Nothing written before: nothing to read together (the chat's own checks still run).
  assert.deepEqual(chatOrders({ sets: [], me: ME, text: '766 is my lucky number' }), []);
});

test('direction controls are taken out of what is kept: "‮margelet" cannot show as "telegram"', () => {
  const controls = ['‎', '‏', '‪', '‫', '‬', '‭', '‮', '⁦', '⁧', '⁨', '⁩', '؜'];
  for (const x of controls) {
    assert.equal(stripBidi(`${x}ab${x}c`), 'abc', `U+${x.codePointAt(0).toString(16)}`);
    assert.equal(cleanReply(` ${x}Yes `), 'Yes');
    assert.equal(cleanText(` ${x}Coffee or tea? `), 'Coffee or tea?');
  }
  // What is kept reads forwards, as it was checked: no override left to turn it around on screen.
  for (const raw of ['‮margelet', '‮88arad@', '⁧margelet⁩']) {
    const r = checkReply(raw);
    assert.ok(!/[‎‏‪-‮⁦-⁩؜]/.test(r.text), JSON.stringify(r.text));
    assert.equal(r.text, stripBidi(raw).trim());
  }
  assert.equal(checkAppName('‮margelet').name, 'margelet');
  assert.equal(checkRealName('‮Dara Sok').name, 'Dara Sok');
  assert.equal(checkChatMessage(cleanText('‮I like coffee and long walks')).ok, true);
  // Zero-width joiners stay: emoji and Khmer need them.
  assert.equal(cleanReply(FAM), FAM);
});

test('"@ dara", "ig dara88", "ig @ dara", "ig.dara88", "dara88 ig" are stopped; "@ my place" and "big 2" are not', () => {
  for (const text of ['@ dara', '@  ab', 'me @ x_1', 'ig dara88', 'ig @ dara', 'ig.dara88', 'dara88 ig', 'IG dara', 'ig:dara88']) {
    const c = findReplyContactDetails(text);
    assert.equal(c.ok, false, `${text} is stopped`);
    assert.ok(['handle', 'app'].includes(c.hits[0].type), `${text}: ${c.hits[0].type}`);
    assert.equal(checkReply(text).error, 'contact', text);
  }
  for (const text of ['@ my place', '@ home', '@ 5pm', '@ least', 'big 2', 'ig 2024', 'fig 88']) {
    assert.equal(findReplyContactDetails(text).ok, true, `${text}: ${JSON.stringify(findReplyContactDetails(text).hits)}`);
  }
  // The same in a chat line or a written line.
  for (const text of ['find me on ig dara88 ok', 'my ig is dara88 add me', 'dara88 ig add me please']) {
    assert.equal(findContactDetails(text).ok, false, text);
  }
  assert.equal(findContactDetails('I like big dogs and long walks').ok, true);
  // Down two replies, too.
  assert.equal(split(['ig', 'dara88']).ok, false);
});

test('Chinese and Korean phone-reading digits: 两/兩 2, 洞 0, 拐 7, 勾 9, 빵 0', () => {
  for (const text of ['零幺两八八', '洞幺两八八', '幺两三四五', '两两两两两', '兩兩兩兩兩', '洞拐勾洞拐', '빵일이삼사', '빵빵빵빵빵']) {
    const c = findReplyContactDetails(text);
    assert.equal(c.ok, false, `${text} is stopped`);
    assert.equal(c.hits[0].type, 'phone', text);
  }
  assert.equal(split(['零幺两', '八八七', '七六六']).ok, false);
  assert.equal(split(['洞幺', '两八', '八拐', '拐六', '六勾']).ok, false);
  assert.equal(split(['빵일', '이팔', '팔칠', '칠육', '육오']).ok, false);
  for (const text of ['两个人', '一两天', '左拐就是', '打勾了', '빵 좋아해요', '빵집']) assert.equal(findReplyContactDetails(text).ok, true, text);
});

test('an app name spelt down the replies with other replies between the pieces is stopped', () => {
  const F = 'abcdefghij';
  for (const texts of [
    ['we', 'ok', 'chat'], ['wh', 'ok', 'atsapp'], ['tel', 'Yes', 'eg', 'Yes', 'ram'], ['微', '好', '信'], ['t', 'ok', 'g'],
    ['te', F, F, F, F, F, 'le', 'gr', 'am'], ['face', 'Yes', 'No', 'book'], ['카', '네', '톡'], ['テレ', 'はい', 'グラム'],
    ['តេឡេ', 'បាទ', 'ក្រាម'], ['in', 'Yes', 'sta'],
  ]) {
    const c = split(texts);
    assert.equal(c.ok, false, `${JSON.stringify(texts)} is stopped`);
    assert.equal(c.hits[0].type, 'app', JSON.stringify(texts));
    assert.ok(c.items.some((x) => x.fresh));
    assert.equal(split(texts, 0).ok, false, `${JSON.stringify(texts)} with the first one new`);
  }
  // The new reply must be one of the pieces; ordinary replies that are no app's pieces pass.
  assert.equal(split(['we', 'ok', 'chat', 'Sure']).ok, true);
  assert.equal(split(['Yes', 'chat', 'ok', 'talk', 'Sure']).ok, true);
  assert.equal(split(['face', 'Yes']).ok, true);
});

test('ten characters of any width fit a reply: ten family emoji are 10/10, not "too long"', () => {
  assert.equal(REPLY_RAW_MAX, 120);
  const ten = checkReply(FAM.repeat(10));
  assert.deepEqual([ten.ok, ten.count], [true, 10]);
  const couple = '\u{1F469}\u{1F3FD}‍❤️‍\u{1F48B}‍\u{1F468}\u{1F3FB}'; // 10 code points, one character
  assert.deepEqual([checkReply(couple.repeat(10)).ok, checkReply(couple.repeat(10)).count], [true, 10]);
  assert.deepEqual([checkReply(FAM.repeat(11)).error, checkReply(FAM.repeat(11)).count], ['too_long', 11]);
  assert.ok(couple.repeat(10).length <= 2 * REPLY_RAW_MAX, 'the reply box (2 × REPLY_RAW_MAX code units) takes it');
  // Marks stacked on one letter are still too long.
  assert.equal(checkReply(`a${'́'.repeat(40)}`).error, 'too_long');
});
