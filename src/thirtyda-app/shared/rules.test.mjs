// Run: node --test src/thirtyda-app/shared/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LANGS, LANG_CODES, LANG_NATIVE, LANG_ENGLISH, SPEECH_LOCALE,
  findContactDetails, findContactDetailsAcross, CHAT_MIN, CHAT_MAX, charCount, checkChatMessage, checkWrittenQuestion,
  checkWrittenAnswer,
} from './rules.js';

const REASON = {
  phone: 'Phone number shared',
  email: 'Email address shared',
  handle: 'Chat handle shared',
  app: 'Chat app named',
  link: 'Link shared',
};

function assertCaught(text, type) {
  const r = findContactDetails(text);
  assert.equal(r.ok, false, `should flag: ${JSON.stringify(text)}`);
  assert.ok(r.hits.length > 0, `hits for ${JSON.stringify(text)}`);
  assert.equal(r.hits[0].type, type, `type for ${JSON.stringify(text)}: ${JSON.stringify(r.hits)}`);
  assert.equal(r.reason, REASON[type], `reason for ${JSON.stringify(text)}`);
  for (const h of r.hits) {
    assert.equal(text.slice(h.start, h.end), h.match, `start/end must point at the match in ${JSON.stringify(text)}`);
    assert.ok(h.match.trim().length > 0);
  }
  return r;
}

function assertClean(text) {
  const r = findContactDetails(text);
  assert.deepEqual(r, { ok: true, hits: [], reason: null }, `should not flag: ${JSON.stringify(text)} → ${JSON.stringify(r.hits)}`);
}

test('language tables cover all five languages', () => {
  assert.deepEqual(LANGS, ['en', 'km', 'zh', 'ko', 'ja']);
  for (const table of [LANG_CODES, LANG_NATIVE, LANG_ENGLISH, SPEECH_LOCALE]) {
    assert.deepEqual(Object.keys(table).sort(), [...LANGS].sort());
    for (const l of LANGS) assert.ok(table[l]);
  }
  assert.equal(LANG_CODES.km, 'KM');
  assert.equal(LANG_NATIVE.km, 'ខ្មែរ');
  assert.equal(LANG_ENGLISH.zh, 'Chinese');
  assert.equal(SPEECH_LOCALE.km, 'km-KH');
});

test('catches phone numbers in every spelling the contract lists', () => {
  for (const t of [
    '012 88 77 66',
    '+855 12 345 678',
    '012-887-766',
    '0 1 2 8 8 7 7 6 6',
    '០១២ ៨៨ ៧៧ ៦៦',
    '０１２８８７７６６',
    'zero one two eight eight seven seven',
  ]) assertCaught(t, 'phone');
});

test('catches harder phone numbers', () => {
  for (const t of [
    '(012) 345 678',
    '012.345.678',
    '012,345,678',
    '+855-12-345-678',
    '０１２－８８７－７６６',
    'Call 0 1 2 - 8 8 7 - 7 6 6',
    'O12 887 766', // letter O for zero
    '0l2 887 766', // letter l for one
    'zero one two double eight double seven',
    'zero1two888seven766',
    'oh one two, eight eight seven, seven six six',
    'Zero One Two Eight Eight Seven Seven',
    '零一二八八七七六六', // Chinese
    '零一二 888 七七六六', // mixed scripts
    'សូន្យ មួយ ពីរ ប្រាំបី ប្រាំបី ប្រាំពីរ ប្រាំពីរ', // Khmer words
    '공일이 팔팔 칠칠 육육', // Korean
    'ぜろいちにはちはちななななろくろく', // Japanese kana
    '0\ufe0f\u20e31\ufe0f\u20e32\ufe0f\u20e38\ufe0f\u20e38\ufe0f\u20e37\ufe0f\u20e37\ufe0f\u20e36\ufe0f\u20e36\ufe0f\u20e3', // keycap emoji
    '①②③④⑤⑥⑦⑧', // circled
    '0\u200b1\u200b2 887 766', // zero-width spaces
    'my number is 887 766', // 6 digits right after a phone word
    'ទូរស័ព្ទ ០១២ ៣៤៥ ៦៧៨',
    '電話 012 345 678',
  ]) assertCaught(t, 'phone');
});

test('catches phone numbers split by any separator or by filler words', () => {
  for (const t of [
    '012;887;766', '012:887:766', '012x887x766', '012=887=766', '012#887#766', '012&887&766', '012 🙂 887 🙂 766',
    '012 and 887 and 766', '012 then 887 then 766', '855;12;345;678', '០១២:៨៨៧:៧៦៦', '零一二:八八七:七六六',
    'zero one two; eight eight seven; seven six six', 'Is 012;887;766 still your number?', 'ring 012;887;766 after work',
    '012:887:766 is my mobile ok', 'text 012 then 887 then 766', 'Nita 012;887;766',
    'My number starts 012, ok? Next part is 887, got it? And it ends 766, yes?',
  ]) assertCaught(t, 'phone');
  for (const t of [
    '10:30 - 11:45', '9:00-12:00 and 13:00-17:00', 'I was in 1980 and 2015', 'Sizes 1,000 and 2,000 riel', '1920x1080',
    'I have 3 kids aged 5, 8 and 12, I am 46', 'Coffee 0.50, tea 0.75, cake 1.25', 'Open 8:00 to 17:00 and 19:00 to 22:00',
    'I work 9 to 5, Monday to Friday', 'Score was 3:2, then 1:0', 'Building 05, floor 12, room 1203', '007 is my favourite movie',
    'I sleep at 23:00 and wake at 06:30', 'ខ្ញុំមានកូន ៣ នាក់ អាយុ ៥ ៨ និង ១២ ឆ្នាំ', 'My favourite cafe is on St 240 near 51',
  ]) assertClean(t);
});

test('catches look-alike app names, spelled-out mail providers and dotless short links', () => {
  for (const t of ['teleqram', 'te1egram', 'tel3gram', 'telegr@m', 'Telegrann', 'vvhatsapp', 'whatsaap', 'wechaat',
    'ᴛᴇʟᴇɢʀᴀᴍ', 'add me on we chat', '1nstagram', 'faceb00k']) assertCaught(t, 'app');
  for (const t of ['find me on teleqram probea88', 'probea88 on te1egram, okay?', 'Nita teleqram nita88']) assertCaught(t, 'handle');
  for (const t of ['my gmail is tomk88', 'tomk88 at outlook', 'tomk88 at yahoo', 'visal88 gmail', 'my gmail is probea88 ok?',
    'email: probeb dot k88']) assertCaught(t, 'email');
  assertCaught('t me visal88', 'link');
  for (const t of ['we chat every day', 'tender meat', 'I humbly discard the twister', 'My email is great', 'I use gmail at work',
    'I have 2 gmail accounts', 'let me visal88', 'on telegraph hill', 'Facebooking is fun?']) assertClean(t);
});

test('contact details split over several texts are caught together', () => {
  let r = findContactDetailsAcross(['My number starts 012, ok?', 'Next part is 887, got it?', 'And it ends 766, yes?']);
  assert.equal(r.ok, false);
  assert.deepEqual([r.reason, r.hits[0].index, r.hits[0].lastIndex], ['Phone number shared', 0, 2]);
  assert.equal(r.text.slice(r.hits[0].start, r.hits[0].end), r.hits[0].match);
  r = findContactDetailsAcross(['mine is zero one two', 'then nine nine nine', 'then four four four', 'nice day', 'at the market']);
  assert.equal(r.reason, 'Phone number shared');
  r = findContactDetailsAcross(['I walked by the river today.', 'my number begins with 012 ok', 'next three are 887 then 766']);
  assert.deepEqual([r.ok, r.hits[0].index, r.hits[0].lastIndex], [false, 1, 2]);
  for (const texts of [
    ['I like the river', 'I wake at 06:30', 'I have 2 kids aged 5 and 8', 'I live on St 240 near 51', 'I came in 2015'],
    ['Trees and a quiet road', 'Sunny and hot', 'Rice and fish', 'At an office in BKK1', 'Calm old songs'],
    ['Bus 07 is mine', 'Street 240 is close', 'Room 120 and floor 12', 'I am 46', 'ok'],
  ]) assert.equal(findContactDetailsAcross(texts).ok, true, JSON.stringify(texts));
});

test('phone hit points at what was typed, incl. Khmer and full-width digits', () => {
  let r = assertCaught('Can I call you? 012 88 77 66', 'phone');
  assert.equal(r.hits[0].match, '012 88 77 66');
  assert.equal(r.hits[0].start, 16);
  assert.equal(r.hits[0].end, 28);
  r = assertCaught('លេខខ្ញុំ ០១២ ៨៨ ៧៧ ៦៦ ណា', 'phone');
  assert.equal(r.hits[0].match, '០១២ ៨៨ ៧៧ ៦៦');
  r = assertCaught('番号は０１２８８７７６６です', 'phone');
  assert.equal(r.hits[0].match, '０１２８８７７６６');
  r = assertCaught('+855 12 345 678', 'phone');
  assert.equal(r.hits[0].match, '+855 12 345 678');
});

test('catches emails, plain and spelled out', () => {
  let r = assertCaught('tom.k88@mail.com', 'email');
  assert.equal(r.hits[0].match, 'tom.k88@mail.com');
  r = assertCaught('Email me at tom.k88@mail.com', 'email');
  assert.equal(r.hits[0].match, 'tom.k88@mail.com');
  r = assertCaught('tom at mail dot com', 'email');
  assert.equal(r.hits[0].match, 'tom at mail dot com');
  for (const t of [
    'tom (at) gmail (dot) com',
    'tom[at]gmail[dot]com',
    'tom @ gmail.com',
    'tom @ gmail . com',
    'tom.k88 at gmail dot com',
    'tom.k88 at gmail.com',
    'tom at gmail',
    'tom@gmail',
    'tom艾特qq点com',
    'ｔｏｍ＠ｍａｉｌ．ｃｏｍ',
    'write to tom@gmail.com.',
  ]) assertCaught(t, 'email');
});

test('catches @handles and ids', () => {
  let r = assertCaught('@visal88', 'handle');
  assert.equal(r.hits[0].match, '@visal88');
  for (const t of ['my tg is @visal_88', '@ visal88', 'id: visal_88', 'username is tom_k', 'ID是 abc12345', '아이디는 tom88']) {
    assertCaught(t, 'handle');
  }
});

test('an app name next to a handle or number reads as one detail', () => {
  // Same as the admin sample data: hit "Telegram @visal88", reason "Chat handle shared".
  let r = assertCaught('បន្ថែមខ្ញុំនៅ Telegram @visal88', 'handle');
  assert.equal(r.hits.length, 1);
  assert.equal(r.hits[0].match, 'Telegram @visal88');
  r = assertCaught('LINE: tomk88', 'handle');
  assert.equal(r.hits[0].match, 'LINE: tomk88');
  r = assertCaught('my wechat is sophea_pp', 'handle');
  assert.equal(r.hits[0].match, 'wechat is sophea_pp');
  r = assertCaught('visal88 on telegram', 'handle');
  assert.equal(r.hits[0].match, 'visal88 on telegram');
  r = assertCaught('WhatsApp +855 12 345 678', 'phone');
  assert.equal(r.hits[0].match, 'WhatsApp +855 12 345 678');
  for (const t of ['IG: visal88', 'My IG is visal88', '@visal88 on TG', 'Telegram: visal88', '카톡 아이디는 tom88',
    'LINEのIDはtom88', '微信号是abc123', '加v tom88']) assertCaught(t, 'handle');
});

test('catches chat app names in all five languages', () => {
  for (const t of [
    'Telegram', 'telegram', 'TG', 'WhatsApp', 'whats app', "what's app", 'LINE id', 'LINE', 'WeChat', '微信', 'wechat号',
    'Viber', 'Signal', 'Messenger', 'Instagram', 'IG', 'Snapchat', 'KakaoTalk', '카카오톡', '카톡', 'Zalo', 'TikTok',
    'テレグラム', 'ライン', 'តេឡេក្រាម',
    // more spellings
    'add me on line', 'line me', 'i use line app', '加我line', 'LINEやってる？', 'Add me on Messenger', 'find me on signal',
    'I use Signal', 'follow me on ig', 'add me on wa', 'Message me on WhatsApp', 'tg me', 'Facebook', 'fb', 'insta', 'tele',
    't e l e g r a m', 'w.h.a.t.s.a.p.p', 't\u0435l\u0435gram' /* Cyrillic e */, 'ｔｅｌｅｇｒａｍ', 'télégram', 'tele gram',
    '电报', '纸飞机', '抖音', 'QQ', '인스타 해요?', '페북 있어요?', '텔레그램', '위챗', 'ワッツアップある？', 'インスタやってる？',
    'ហ្វេសប៊ុក', 'វីឆាត', 'សួស្តី តេឡេក្រាម ខ្ញុំ',
  ]) assertCaught(t, 'app');
});

test('catches links', () => {
  for (const t of [
    'https://…', 'https://example.com/abc', 'http://bit.ly/x', 'www.…', 'www.example.com', 't.me/…', 't.me/visal88',
    'wa.me/85512345678', 't . me / visal88', 't dot me slash visal88', 'facebook.com/visal', 'fb.com/visal',
    'instagram.com/visal', 'bit.ly/abc', 'visal.kh', 'mysite dot com', 'line.me/ti/p/abc',
  ]) assertCaught(t, 'link');
  const r = assertCaught('see https://example.com/abc).', 'link');
  assert.equal(r.hits[0].match, 'https://example.com/abc');
});

test('does not flag normal sentences', () => {
  for (const t of [
    // from the contract
    'I like 3 coffees', 'I am 46', 'Level 3', 'line up', 'a fine line', 'BKK1', 'at 7 pm', '2024',
    // line / signal / messenger as plain words
    'I waited in line for an hour', 'The line is long', 'This text in line with the rules', 'call me on line 3', 'the bottom line is yes', 'I like line dancing', 'on line 3',
    'Online now', 'The signal is weak here', 'My signal is bad here', 'Signal is weak here', 'use the signal',
    'Messenger bag', 'a messenger of good news', 'send me a message', 'we chat every day', 'what app do you use?',
    // numbers that are not phone numbers
    'I am 46 and you?', 'Me too, every day. I am 46.', 'I have 3 kids aged 5, 8 and 12', 'Room 1203 floor 12',
    'I was born in 1980 and moved here in 2015', '2023-2024', '12/10/2024', '12.10.2024', '2024-10-12',
    'Open 8.30-17.30', '10:30 - 11:45', 'from 9 to 5', '1,000,000 riel', '1 000 000 riel', 'I paid 40,000 riel',
    'Coffee costs 2.50 USD', 'He is tall, around 1.80 m', 'My house is No. 23, St 360', 'I have two kids and one dog',
    'someone often', 'I won 1st prize',
    // @, dots and "at"
    'meet @ 7pm', 'see you @ the cafe', 'I am at home @home', 'look at the stars', 'I saw it at home.', 'e.g. tea',
    'Mr.Kim', 'Ok.so what now', 'I am at work.Tomorrow free', 'my id card is at home', 'id love to', 'info desk',
    // other languages
    'BKK1, Phnom Penh', '你太老了，不适合用这个应用。', '喜欢，我每天早上都喝。', '我在金边工作', '三三两两', '一五一十',
    '2024年10月12日', '二〇二四年十月', 'ខ្ញុំក៏ដូចគ្នា រាល់ថ្ងៃ។ ខ្ញុំអាយុ ៤៦ ឆ្នាំ។', 'ខ្ញុំចូលចិត្តដើរលេងតាមមាត់ទន្លេ។',
    'ខ្ញុំធ្វើការនៅបឹងកេងកង', 'ខ្ញុំមានកូនពីរនាក់', 'សំឡេងនេះពីរោះណាស់', '오늘 날씨가 좋아요', '이 사이에 오이 구이',
    '오늘 점심은 김치찌개였어요', '今日はいちごを食べました', '近所のカフェが好きです', '今日は一日中家にいました',
    'オンラインで会いましょう', 'ガイドラインを読んだ', '合格ライン', 'インスタントラーメン', 'カカオ70%のチョコ',
    '', '   ', null, undefined,
  ]) assertClean(t);
});

test('the first hit decides the reason, and every hit is reported', () => {
  const text = 'Call 012 88 77 66 or mail tom@mail.com, I am on Telegram';
  const r = findContactDetails(text);
  assert.equal(r.ok, false);
  assert.deepEqual(r.hits.map((h) => h.type), ['phone', 'email', 'app']);
  assert.equal(r.reason, 'Phone number shared');
  for (const h of r.hits) assert.equal(text.slice(h.start, h.end), h.match);
  assert.ok(r.hits[0].end <= r.hits[1].start && r.hits[1].end <= r.hits[2].start);
});

test('stays fast on long input', () => {
  const long = 'Do you like coffee? I walk by the river at 7 pm. '.repeat(400);
  const t0 = Date.now();
  assert.equal(findContactDetails(long).ok, true);
  assert.ok(Date.now() - t0 < 1000);
});

test('charCount counts characters the way a person would', () => {
  assert.equal(charCount(''), 0);
  assert.equal(charCount(null), 0);
  assert.equal(charCount(undefined), 0);
  assert.equal(charCount('  hello  '), 5);
  assert.equal(charCount('hi    there'), 8); // runs of spaces count once
  assert.equal(charCount('你好吗'), 3);
  assert.equal(charCount('一二三四五六七八九十一二三四五六七八九十'), 20);
  assert.equal(charCount('こんにちは'), 5);
  assert.equal(charCount('안녕하세요'), 5);
  assert.equal(charCount('កា'), 1); // consonant + vowel sign
  assert.equal(charCount('ខ្ញុំ'), 1); // a subscript (coeng + consonant) joins its cluster
  assert.equal(charCount('ស្ត្រី'), 1);
  assert.equal(charCount('ក្ ក'), 3); // a space breaks the join
  assert.equal(charCount('កខគឃងចឆជឈញ'), 10);
  assert.equal(charCount('👍🏽'), 1);
  assert.equal(charCount('👨\u200d👩\u200d👧'), 1);
  assert.equal(charCount('🇰🇭'), 1);
  assert.equal(charCount('e\u0301'), 1); // e + combining accent
});

// The client counter and the server must agree on the 20-30 boundary, so the count may not
// depend on the ICU version a browser ships.
test('charCount does not depend on Intl.Segmenter', async () => {
  const saved = Intl.Segmenter;
  let fallback;
  try {
    delete Intl.Segmenter;
    ({ charCount: fallback } = await import('./rules.js?no-segmenter'));
  } finally {
    Intl.Segmenter = saved;
  }
  for (const s of ['hello there', '你好吗', 'ខ្ញុំចូលចិត្តដើរលេងតាមមាត់ទន្លេ។', 'កា', '👍🏽 ok', '👨\u200d👩\u200d👧', '🇰🇭🇯🇵', 'e\u0301', 'はいはい']) {
    assert.equal(fallback(s), charCount(s), s);
  }
});

const repeat = (s, n) => s.repeat(n);

test('chat: 20–30 characters', () => {
  assert.equal(CHAT_MIN, 20);
  assert.equal(CHAT_MAX, 30);
  let r = checkChatMessage('Do you like coffee?'); // 19
  assert.equal(r.count, 19);
  assert.deepEqual([r.ok, r.error], [false, 'too_short']);
  r = checkChatMessage('Do you like coffee??'); // 20
  assert.deepEqual([r.ok, r.error, r.count], [true, null, 20]);
  assert.deepEqual(r.hits, []);
  assert.equal(r.reason, null);
  r = checkChatMessage('Yes, I drink it every morning.'); // 30
  assert.deepEqual([r.ok, r.error, r.count], [true, null, 30]);
  r = checkChatMessage('Yes, I drink it every morning!!'); // 31
  assert.deepEqual([r.ok, r.error, r.count], [false, 'too_long', 31]);
  assert.equal(checkChatMessage('').error, 'too_short');
  assert.equal(checkChatMessage('   hello            ').error, 'too_short'); // blanks do not pad
});

test('chat: CJK and Khmer are counted by character', () => {
  let r = checkChatMessage('我每天早上都喝咖啡，你呢？我喜欢在河边散步。'); // 22
  assert.deepEqual([r.ok, r.count], [true, 22]);
  r = checkChatMessage(repeat('我喜欢在河边散步', 4)); // 32
  assert.deepEqual([r.error, r.count], ['too_long', 32]);
  r = checkChatMessage('週末は川沿いを散歩するのが好きです。あなたは？'); // 23
  assert.deepEqual([r.ok, r.count], [true, 23]);
  r = checkChatMessage('주말에는 강가를 산책하는 것을 좋아해요. 당신은요?'); // 28
  assert.deepEqual([r.ok, r.count], [true, 28]);
  // Khmer: one character per cluster; vowel signs and subscripts ride along.
  const km = 'ខ្ញុំចូលចិត្តដើរលេងតាមមាត់ទន្លេ។';
  assert.equal(charCount(km), 16);
  assert.equal(checkChatMessage(km).error, 'too_short');
  const km2 = 'ខ្ញុំចូលចិត្តដើរលេងតាមមាត់ទន្លេរាល់ល្ងាច។'; // + "every evening"
  assert.equal(charCount(km2), 20);
  assert.deepEqual([checkChatMessage(km2).ok, checkChatMessage(km2).count], [true, 20]);
});

test('chat: trivial messages are blocked in every language', () => {
  for (const t of [
    'ok ok ok ok ok ok ok ok', 'hi hello bye yes ok lol', 'yes yes yes yes yes yes!!', 'Okay okay okay okay okay',
    'hahahaha hehehe lololol', 'hiiii hellooooo byeeeee', 'k k k k k k k k k k k k', 'yeah yeah yeah ok bye ya',
    'OK!!! OK!!! OK!!! OK!!! OK!!!', '😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀', '👍 👍 👍 👍 👍 👍 👍 👍 👍 👍 👍',
    'បាទបាទបាទបាទបាទបាទបាទបាទបាទបាទ', 'ចាស ចាស ចាស ចាស ចាស ចាស ចាស', 'អូខេ អូខេ អូខេ អូខេ អូខេ អូខេ អូខេ',
    '好好好好好好好好好好好好好好好好好好好好', '好的好的好的好的好的好的好的好的好的好的', '是 是 是 好 好 好 嗨 嗨 再见 再见 拜拜',
    '哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈',
    '네네네네네네네네네네네네네네네네네네네네', '응 응 응 응 응 안녕 안녕 안녕 안녕', 'ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ',
    'はいはいはいはいはいはいはいはいはいはい', 'うん うん うん うん はい はい バイ バイ', 'wwwwwwwwwwwwwwwwwwwwwwww',
  ]) {
    const r = checkChatMessage(t);
    assert.ok(r.count >= CHAT_MIN && r.count <= CHAT_MAX, `${t} is ${r.count} long`);
    assert.equal(r.error, 'trivial', t);
    assert.equal(r.ok, false);
  }
  for (const t of ['Yes, I drink it every morning.', 'Hello! How was your day today?', 'ok, see you at the market',
    'I know now what you mean.', 'Haha that is a funny story!']) {
    assert.equal(checkChatMessage(t).ok, true, t);
  }
});

test('chat: contact details win over every other rule', () => {
  let r = checkChatMessage('012 88 77 66'); // also too short
  assert.deepEqual([r.ok, r.error, r.reason], [false, 'contact', 'Phone number shared']);
  assert.equal(r.hits[0].match, '012 88 77 66');
  r = checkChatMessage('Add me on Telegram @visal88 ok');
  assert.deepEqual([r.error, r.reason, r.hits[0].match], ['contact', 'Chat handle shared', 'Telegram @visal88']);
  r = checkChatMessage('telegram telegram telegram ok');
  assert.equal(r.error, 'contact');
  r = checkChatMessage('Email me at tom.k88@mail.com please, thank you');
  assert.deepEqual([r.error, r.reason], ['contact', 'Email address shared']);
});

test('written questions: Level 1 4–80, Level 2 4–100', () => {
  assert.equal(checkWrittenQuestion('', 1).error, 'empty');
  assert.equal(checkWrittenQuestion('   ', 1).error, 'empty');
  assert.equal(checkWrittenQuestion(null, 2).error, 'empty');
  assert.equal(checkWrittenQuestion('????', 1).error, 'empty');
  assert.equal(checkWrittenQuestion('Hot', 1).error, 'empty');
  let r = checkWrittenQuestion('Hot?', 1);
  assert.deepEqual([r.ok, r.error, r.hits, r.reason], [true, null, [], null]);
  assert.equal(checkWrittenQuestion(`Is ${repeat('a', 76)}?`, 1).ok, true); // 80
  assert.equal(checkWrittenQuestion(`Is ${repeat('a', 77)}?`, 1).error, 'too_long'); // 81
  assert.equal(checkWrittenQuestion(`Is ${repeat('a', 77)}?`, 2).ok, true);
  assert.equal(checkWrittenQuestion(`Is ${repeat('a', 96)}?`, 2).ok, true); // 100
  assert.equal(checkWrittenQuestion(`Is ${repeat('a', 97)}?`, 2).error, 'too_long'); // 101
  assert.equal(checkWrittenQuestion('下雨了吗？', 1).ok, true);
  r = checkWrittenQuestion('Do you use Telegram?', 1);
  assert.deepEqual([r.ok, r.error, r.reason], [false, 'contact', 'Chat app named']);
  assert.equal(r.hits[0].match, 'Telegram');
  r = checkWrittenQuestion('Can I have your number 012 345 678?', 2);
  assert.deepEqual([r.error, r.reason], ['contact', 'Phone number shared']);
});

test('written answers: 2–120 characters', () => {
  assert.equal(checkWrittenAnswer('').error, 'empty');
  assert.equal(checkWrittenAnswer('a').error, 'empty');
  assert.equal(checkWrittenAnswer('Ok').ok, true);
  assert.equal(checkWrittenAnswer('雨').error, 'empty');
  assert.equal(checkWrittenAnswer('下雨').ok, true);
  assert.equal(checkWrittenAnswer(repeat('a', 120)).ok, true);
  assert.equal(checkWrittenAnswer(repeat('a', 121)).error, 'too_long');
  const r = checkWrittenAnswer('The river. Find me on IG: visal88');
  assert.deepEqual([r.ok, r.error, r.reason], [false, 'contact', 'Chat handle shared']);
  assert.equal(r.hits[0].match, 'IG: visal88');
});
