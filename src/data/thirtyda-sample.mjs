// Demo data for 30+DA: 21 people around BKK1, Phnom Penh, plus the A2 design's
// sample conversations and flags, with the pairs and question sets behind them.
// Only `npm run 30da:seed` reads this (and it refuses a non-dev database):
// the live app and the admin never create fake users.

import { LANGS, LANG_ENGLISH, stageOpenLevel, currentYear } from "../thirtyda-app/shared/rules.js";
import { SYSTEM_QUESTIONS, questionText, answerText } from "../thirtyda-app/shared/questions.js";

const CENTER = { lat: 11.549, lng: 104.928 }; // BKK1
const KM_LAT = 1 / 110.574;
const KM_LNG = 1 / (111.32 * Math.cos((CENTER.lat * Math.PI) / 180));

// [id, name, realName, gender, lang, role, area, red, orange, [km north, km east], seen, verified, level, blocked]
// verified: p = phone, g = Gmail, f = Facebook. `level` is only the design's hint: buildDemo() sets each
// person's level from the demo pairs (the highest level opened with anyone), as the app does.
const PEOPLE = [
  ['U-10231', 'Sophea', 'Chan Sophea', 'woman', 'km', 'sales', 'BKK1', 128, 34, [0.4, 0.1], 'online', 'pg', 3],
  ['U-10232', 'Dara', 'Lim Dara', 'man', 'en', 'own_business', 'Toul Kork', 56, 12, [2.6, -1.6], 'online', 'pf', 3],
  ['U-10418', 'Visal', 'Keo Visal', 'man', 'km', 'accountant', 'Chamkar Mon', 41, 6, [-1.0, 0.6], 'online', 'p', 2],
  ['U-10644', 'Mei', 'Wang Mei', 'woman', 'zh', 'own_business', 'BKK3', 92, 27, [-0.5, -0.6], 'offline', 'pg', 2],
  ['U-10507', 'Tom', 'Tom Kelly', 'man', 'en', 'sales', 'Daun Penh', 18, 3, [2.4, 0.9], 'idle', 'p', 1],
  ['U-10702', 'Anna', 'Anna Berg', 'woman', 'en', 'time_off', 'Russey Keo', 213, 61, [4.2, -0.3], 'online', 'pgf', 1],
  ['U-10611', 'Chen', 'Chen Wei', 'man', 'zh', 'accountant', 'Sen Sok', 64, 22, [4.0, -3.8], 'online', 'p', 3],
  ['U-10735', 'Lina', 'Sok Lina', 'woman', 'km', 'family_home', '7 Makara', 77, 19, [0.9, -1.6], 'online', 'pf', 3],
  ['U-10790', 'Ji-ho', 'Park Ji-ho', 'man', 'ko', 'own_business', 'BKK1', 33, 9, [-0.2, 0.3], 'online', 'pg', 2],
  ['U-10812', 'Yuki', 'Tanaka Yuki', 'woman', 'ja', 'time_off', 'Tonle Bassac', 58, 14, [-0.6, 1.2], 'idle', 'p', 1],
  ['U-10377', 'Rotha', 'Meas Rotha', 'man', 'km', 'sales', 'Mean Chey', 12, 2, [-3.2, 0.4], 'offline', 'p', 1, true],
  ['U-10233', 'Rithy', 'Ouk Rithy', 'man', 'km', 'accountant', 'BKK2', 37, 15, [-0.3, 0.8], 'idle', 'pg', 1],
  ['U-10240', 'Bopha', 'Heng Bopha', 'woman', 'km', 'family_home', 'Toul Tom Poung', 84, 21, [-1.6, -0.9], 'online', 'p', 1],
  ['U-10241', 'Leak', 'Chea Sreyleak', 'woman', 'km', 'sales', 'Phsar Thmei 1', 45, 11, [1.9, 0.6], 'offline', 'pf', 1],
  ['U-10242', 'Kanha', 'Nhem Kanha', 'woman', 'km', 'accountant', 'Boeng Trabaek', 61, 17, [-2.4, 0.2], 'online', 'p', 1],
  ['U-10243', 'Min-jun', 'Kim Min-jun', 'man', 'ko', 'sales', 'BKK1', 29, 7, [0.1, -0.4], 'idle', 'pg', 1],
  ['U-10244', 'Haruto', 'Sato Haruto', 'man', 'ja', 'own_business', 'Daun Penh', 22, 5, [2.8, 1.3], 'offline', 'p', 1],
  ['U-10245', 'Ling', 'Zhang Ling', 'woman', 'zh', 'own_business', 'BKK2', 103, 29, [-0.1, 1.0], 'online', 'pgf', 1],
  ['U-10246', 'Sakura', 'Ito Sakura', 'woman', 'ja', 'family_home', 'Tonle Bassac', 39, 10, [-1.1, 1.6], 'idle', 'p', 1],
  ['U-10247', 'James', 'James Moore', 'man', 'en', 'time_off', 'BKK1', 15, 4, [0.6, -0.2], 'online', 'pf', 1],
  ['U-10248', 'Chenda', 'Pich Chenda', 'woman', 'km', 'sales', 'Veal Vong', 70, 16, [1.5, -1.0], 'offline', 'p', 1],
];

// Each demo person's age (30–65; Lina tells Chen she is 46). Stored as a birth year from this year,
// as the app asks for it at sign-up. App names are all 2–7 characters, like the app's rule.
const AGES = {
  'U-10231': 34, 'U-10232': 41, 'U-10418': 38, 'U-10644': 36, 'U-10507': 44, 'U-10702': 39, 'U-10611': 47,
  'U-10735': 46, 'U-10790': 35, 'U-10812': 42, 'U-10377': 51, 'U-10233': 33, 'U-10240': 45, 'U-10241': 31,
  'U-10242': 37, 'U-10243': 40, 'U-10244': 49, 'U-10245': 43, 'U-10246': 32, 'U-10247': 58, 'U-10248': 52,
};

// The design's example questions, looked up by their English text.
const L1_EXAMPLES = [
  'Is it raining where you are?', 'Is it busy around you right now?', 'Are you outside right now?', 'Is it a quiet day for you?',
];
const L2_EXAMPLES = ['What can you see from your window?', 'What is the weather like there?'];
const keyOf = (level, en, i) => (SYSTEM_QUESTIONS[level].find((q) => q.text.en === en) ?? SYSTEM_QUESTIONS[level][i]).key;

// Hand-written lines: { <writer lang>: original, en, <reader lang> }.
const T = {
  meiCoffee: { zh: '你喜欢喝咖啡吗？', en: 'Do you like coffee?', km: 'តើអ្នកចូលចិត្តផឹកកាហ្វេទេ?' },
  meiWeekend: { zh: '你周末喜欢做什么？', en: 'What do you like to do at the weekend?', km: 'តើអ្នកចូលចិត្តធ្វើអ្វីនៅចុងសប្តាហ៍?' },
  meiYears: { zh: '你在金边住了多久？', en: 'How long have you lived in Phnom Penh?', km: 'តើអ្នករស់នៅភ្នំពេញបានប៉ុន្មានឆ្នាំហើយ?' },
  meiFood: { zh: '你最喜欢哪家餐厅？', en: 'Which restaurant do you like best?', km: 'តើអ្នកចូលចិត្តភោជនីយដ្ឋានណាជាងគេ?' },
  visalRiver: { km: 'ខ្ញុំចូលចិត្តដើរលេងតាមមាត់ទន្លេ។', en: 'I like walking by the river.', zh: '我喜欢在河边散步。' },
  tomNew: { en: 'Hi Anna, are you new in Phnom Penh too?' },
  linaWalks: { km: 'តើអ្នកចូលចិត្តដើរលេងទេ?', en: 'Do you like going for walks?', zh: '你喜欢散步吗？' },
  linaWork: { km: 'តើអ្នកធ្វើការនៅឯណា?', en: 'Where do you work?', zh: '你在哪里工作？' },
  linaFood: { km: 'តើអ្នកចូលចិត្តម្ហូបអ្វីជាងគេ?', en: 'What food do you like best?', zh: '你最喜欢吃什么？' },
  linaCame: { km: 'តើអ្នកមកនៅភ្នំពេញតាំងពីពេលណា?', en: 'When did you come to Phnom Penh?', zh: '你什么时候来金边的？' },
  chenWindow: { zh: '我能看到河和很多树。', en: 'I can see the river and many trees.', km: 'ខ្ញុំឃើញទន្លេ និងដើមឈើច្រើន។' },
  chenWeather: { zh: '今天很热，下午可能下雨。', en: 'Very hot today, maybe rain this afternoon.', km: 'ថ្ងៃនេះក្តៅណាស់ ប្រហែលជាភ្លៀងនៅពេលរសៀល។' },
  chenWork: { zh: '在BKK1的一家贸易公司。', en: 'At a trading company in BKK1.', km: 'នៅក្រុមហ៊ុនពាណិជ្ជកម្មមួយនៅ BKK1។' },
  chenFood: { zh: '我最喜欢高棉鱼汤。', en: 'Khmer fish soup is my favourite.', km: 'ខ្ញុំចូលចិត្តសម្លម្ជូរត្រីខ្មែរជាងគេ។' },
  chenCame: { zh: '三年前来的。', en: 'Three years ago.', km: 'កាលពីបីឆ្នាំមុន។' },
  chenWeekend: { zh: '你周末喜欢去哪里？', en: 'Where do you like to go at the weekend?', km: 'តើអ្នកចូលចិត្តទៅណានៅចុងសប្តាហ៍?' },
  chenMusic: { zh: '你喜欢什么音乐？', en: 'What music do you like?', km: 'តើអ្នកចូលចិត្តតន្ត្រីបែបណា?' },
  chenMorning: { zh: '你早上通常做什么？', en: 'What do you usually do in the morning?', km: 'តើអ្នកធ្វើអ្វីជាធម្មតានៅពេលព្រឹក?' },
  linaWindow: { km: 'ខ្ញុំឃើញដើមឈើ និងផ្លូវតូចមួយ។', en: 'I see trees and a small street.', zh: '我看到树和一条小街。' },
  linaWeather: { km: 'ក្តៅបន្តិច ប៉ុន្តែមានខ្យល់។', en: 'A bit hot, but windy.', zh: '有点热，但是有风。' },
  linaWeekend: { km: 'មាត់ទន្លេ ឬផ្សាររាត្រី។', en: 'The riverside or the night market.', zh: '河边或者夜市。' },
  linaMusic: { km: 'តន្ត្រីខ្មែរបុរាណ និងចម្រៀងស្ងាត់ៗ។', en: 'Old Khmer music and quiet songs.', zh: '高棉老歌和安静的歌。' },
  linaMorning: { km: 'ខ្ញុំដើរលេង ហើយផឹកកាហ្វេ។', en: 'I go for a walk and drink coffee.', zh: '我去散步，然后喝咖啡。' },
  sopheaDogs: { km: 'តើអ្នកចូលចិត្តសត្វឆ្កែទេ?', en: 'Do you like dogs?' },
  sopheaCook: { km: 'តើអ្នកចូលចិត្តធ្វើម្ហូបអ្វី?', en: 'What do you like to cook?' },
  sopheaPlace: { km: 'តើកន្លែងណាដែលអ្នកចូលចិត្តជាងគេនៅភ្នំពេញ?', en: 'What is your favourite place in Phnom Penh?' },
  sopheaEvening: { km: 'តើអ្នកធ្វើអ្វីនៅល្ងាចនេះ?', en: 'What are you doing this evening?' },
  daraWindow: { en: 'A quiet street and a big mango tree.', km: 'ផ្លូវស្ងាត់មួយ និងដើមស្វាយធំមួយ។' },
  daraWeather: { en: 'Hot and sunny, with a little breeze.', km: 'ក្តៅ និងមានពន្លឺថ្ងៃ មានខ្យល់បន្តិច។' },
  daraCook: { en: 'Fried rice and a simple curry.', km: 'បាយឆា និងការីធម្មតាមួយ។' },
  daraPlace: { en: 'Wat Phnom park early in the morning.', km: 'សួនវត្តភ្នំនៅពេលព្រឹកព្រលឹម។' },
  daraEvening: { en: 'Dinner with my sister, then reading.', km: 'ញ៉ាំអាហារពេលល្ងាចជាមួយប្អូនស្រី រួចអានសៀវភៅ។' },
  daraRelax: { en: 'What do you do to relax after work?', km: 'តើអ្នកធ្វើអ្វីដើម្បីសម្រាកក្រោយម៉ោងធ្វើការ?' },
  daraSeason: { en: 'Which season do you like most?', km: 'តើអ្នកចូលចិត្តរដូវណាជាងគេ?' },
  daraTrip: { en: 'What was the best trip you have taken?', km: 'តើដំណើរកម្សាន្តណាដែលល្អបំផុតសម្រាប់អ្នក?' },
  sopheaWindow: { km: 'ខ្ញុំឃើញដំបូលផ្ទះ និងមេឃ។', en: 'I see rooftops and the sky.' },
  sopheaWeather: { km: 'ថ្ងៃនេះមានពពក ហើយមិនសូវក្តៅទេ។', en: 'Cloudy today and not too hot.' },
  sopheaRelax: { km: 'ខ្ញុំស្តាប់តន្ត្រី ហើយធ្វើម្ហូប។', en: 'I listen to music and cook.' },
  sopheaSeason: { km: 'រដូវត្រជាក់ នៅខែធ្នូ។', en: 'The cool season, in December.' },
  sopheaTrip: { km: 'ទៅកែប ហើយញ៉ាំក្តាម។', en: 'Going to Kep and eating crab.' },
  // A2 chat lines.
  linaCoffee: { km: 'តើអ្នកចូលចិត្តកាហ្វេដែរទេ?', en: 'Do you like coffee too?', zh: '你也喜欢咖啡吗？' },
  chenMornings: { zh: '喜欢，我每天早上都喝。', en: 'Yes, I drink it every morning.', km: 'ចូលចិត្ត ខ្ញុំផឹករាល់ព្រឹក។' },
  linaAge: { km: 'ខ្ញុំក៏ដូចគ្នា រាល់ថ្ងៃ។ ខ្ញុំអាយុ ៤៦ ឆ្នាំ។', en: 'Me too, every day. I am 46.', zh: '我也是，每天都喝。我46岁。' },
  chenRude: { zh: '你太老了，不适合用这个应用。', en: 'You are too old to use this app.', km: 'អ្នកចាស់ពេកហើយសម្រាប់កម្មវិធីនេះ។' },
};

const all = (map) => Object.fromEntries(LANGS.map((l) => [l, map[l] ?? null]));
const location = ([north, east]) => ({
  type: 'Point',
  coordinates: [+(CENTER.lng + east * KM_LNG).toFixed(4), +(CENTER.lat + north * KM_LAT).toFixed(4)],
});

export function buildDemo(now = Date.now()) {
  const ago = (min) => new Date(now - min * 60000).toISOString();
  const users = PEOPLE.map(([id, name, realName, gender, lang, role, area, red, orange, km, seen, ver, level, blocked = false], i) => ({
    _id: id, id, name, realName, birthYear: currentYear(now) - AGES[id], role, gender, lang, language: LANG_ENGLISH[lang],
    phone: `+855100001${String(i + 1).padStart(2, '0')}`,
    verified: { phone: ver.includes('p'), gmail: ver.includes('g'), facebook: ver.includes('f') },
    photos: [], location: location(km), area, city: 'Phnom Penh', hearts: { red, orange }, level,
    // No lastSeenAt: the admin shows the design's stored presence until someone really signs in as them.
    presence: seen, lastSeenAt: null, blocked, blockResolved: [], notices: [],
    createdAt: new Date(now - (30 + i) * 864e5),
  }));
  const langOf = (id) => users.find((u) => u._id === id).lang;

  let setSeq = 0;
  let msgSeq = 0;
  const sets = [];
  const sysQ = (level, key, n, lang) => ({
    n, source: 'system', key, text: questionText(level, key, lang), lang,
    translations: Object.fromEntries(LANGS.map((l) => [l, questionText(level, key, l)])),
  });
  const writtenQ = (map, n, lang) => ({ n, source: 'written', key: null, text: map[lang], lang, translations: all(map) });

  function addSet({ pairId, level, from, to, written, answers = null, sentMin, doneMin = null }) {
    const lang = langOf(from);
    const answerLang = langOf(to);
    const sys = level === 1 ? L1_EXAMPLES.map((en, i) => keyOf(1, en, i)) : L2_EXAMPLES.map((en, i) => keyOf(2, en, i));
    const questions = [...sys.map((k, i) => sysQ(level, k, i + 1, lang)), ...written.map((m, i) => writtenQ(m, sys.length + i + 1, lang))];
    const id = `S-${++setSeq}`;
    sets.push({
      _id: id, id, pairId, level, from, to, questions,
      answers: (answers || []).map((a, i) => (level === 1
        ? { n: i + 1, key: a, text: null, lang: answerLang, translations: Object.fromEntries(LANGS.map((l) => [l, answerText(a, l)])), at: ago(doneMin) }
        : { n: i + 1, key: null, text: a[answerLang], lang: answerLang, translations: all(a), at: ago(doneMin) })),
      sentAt: ago(sentMin), completedAt: answers ? ago(doneMin) : null,
    });
  }

  // P-1 Mei → Visal: Level 1 done, Level 2 open; Visal tried to share his Telegram.
  addSet({ pairId: 'P-1', level: 1, from: 'U-10644', to: 'U-10418', written: [T.meiCoffee], answers: ['no', 'yes', 'yes', 'maybe', 'yes'], sentMin: 3000, doneMin: 2900 });
  addSet({ pairId: 'P-1', level: 2, from: 'U-10644', to: 'U-10418', written: [T.meiWeekend, T.meiYears, T.meiFood], sentMin: 10 });
  // P-2 Tom → Anna: Level 1 questions waiting for Anna.
  addSet({ pairId: 'P-2', level: 1, from: 'U-10507', to: 'U-10702', written: [T.tomNew], sentMin: 16 });
  // P-3 Lina ↔ Chen: Level 3 chat; Lina reported Chen.
  addSet({ pairId: 'P-3', level: 1, from: 'U-10735', to: 'U-10611', written: [T.linaWalks], answers: ['yes', 'ok', 'no', 'yes', 'yes'], sentMin: 7200, doneMin: 7100 });
  addSet({ pairId: 'P-3', level: 2, from: 'U-10735', to: 'U-10611', written: [T.linaWork, T.linaFood, T.linaCame], answers: [T.chenWindow, T.chenWeather, T.chenWork, T.chenFood, T.chenCame], sentMin: 5600, doneMin: 5300 });
  addSet({ pairId: 'P-3', level: 2, from: 'U-10611', to: 'U-10735', written: [T.chenWeekend, T.chenMusic, T.chenMorning], answers: [T.linaWindow, T.linaWeather, T.linaWeekend, T.linaMusic, T.linaMorning], sentMin: 5550, doneMin: 4400 });
  // P-5 Sophea ↔ Dara: Level 3 open, nothing said yet.
  addSet({ pairId: 'P-5', level: 1, from: 'U-10231', to: 'U-10232', written: [T.sopheaDogs], answers: ['yes', 'not_really', 'yes', 'ok', 'yes'], sentMin: 8000, doneMin: 7900 });
  addSet({ pairId: 'P-5', level: 2, from: 'U-10231', to: 'U-10232', written: [T.sopheaCook, T.sopheaPlace, T.sopheaEvening], answers: [T.daraWindow, T.daraWeather, T.daraCook, T.daraPlace, T.daraEvening], sentMin: 6400, doneMin: 6000 });
  addSet({ pairId: 'P-5', level: 2, from: 'U-10232', to: 'U-10231', written: [T.daraRelax, T.daraSeason, T.daraTrip], answers: [T.sopheaWindow, T.sopheaWeather, T.sopheaRelax, T.sopheaSeason, T.sopheaTrip], sentMin: 6300, doneMin: 5900 });

  const pair = (id, a, b, stage, level, { l2 = null, l3 = null, updated, created, lastChat = null }) => ({
    _id: id, id, key: [a, b].sort().join('|'), a, b, members: [a, b], level, stage,
    l2OpensAt: l2 === null ? null : ago(l2), l3OpensAt: l3 === null ? null : ago(l3),
    remind: {}, lastChat, createdAt: ago(created), updatedAt: ago(updated),
  });
  const pairs = [
    pair('P-1', 'U-10644', 'U-10418', 'l2_open', 2, { l2: 1460, updated: 2, created: 3010 }),
    pair('P-2', 'U-10507', 'U-10702', 'l1_answer', 1, { updated: 14, created: 20 }),
    pair('P-3', 'U-10735', 'U-10611', 'l3_open', 3, { l2: 5660, l3: 2960, updated: 25, created: 7300, lastChat: { from: 'U-10611', at: ago(25) } }),
    pair('P-4', 'U-10507', 'U-10812', 'l1_ask', 1, { updated: 41, created: 45 }),
    pair('P-5', 'U-10231', 'U-10232', 'l3_open', 3, { l2: 6460, l3: 4460, updated: 4460, created: 8100 }),
  ];
  // users.level follows the pairs exactly: l2_open / l3_wait → 2, l3_open → 3, else 1 (photo slots unlock by it).
  for (const u of users) {
    u.level = pairs.filter((p) => p.members.includes(u._id)).reduce((m, p) => Math.max(m, stageOpenLevel(p.stage)), 1);
  }

  // Chat log lines: [from, minutesAgo, kind, level, line, hit?, flagId?]. A hit means the app stopped it.
  const line = ([from, min, kind, level, t, hit = null, flagId = null]) => {
    const lang = langOf(from);
    const text = typeof t === 'string' ? t : t[lang];
    return {
      id: `M-${++msgSeq}`, from, at: ago(min), kind, level, text, lang,
      english: lang === 'en' ? null : (typeof t === 'string' ? null : t.en ?? null),
      translations: typeof t === 'string' ? { [lang]: t } : all(t),
      hit, flagId, stopped: Boolean(hit), // a reported line was delivered; only rule hits are stopped
    };
  };
  const chat = (id, level, rows) => {
    const p = pairs.find((x) => x._id === id);
    return { _id: id, id, a: p.a, b: p.b, level, messages: rows.map(line) };
  };
  const chats = [
    chat('P-1', 2, [
      ['U-10644', 9, 'question', 2, T.meiWeekend],
      ['U-10418', 4, 'answer', 2, T.visalRiver],
      ['U-10418', 2, 'answer', 2, { km: 'បន្ថែមខ្ញុំនៅ Telegram @visal88', en: 'Add me on Telegram @visal88' }, 'Telegram @visal88', 'f1'],
    ]),
    chat('P-2', 1, [
      ['U-10507', 16, 'question', 1, T.tomNew],
      ['U-10507', 14, 'question', 1, 'Can I call you? 012 88 77 66', '012 88 77 66', 'f2'],
    ]),
    chat('P-3', 3, [
      ['U-10735', 40, 'chat', 3, T.linaCoffee],
      ['U-10611', 38, 'chat', 3, T.chenMornings],
      ['U-10735', 30, 'chat', 3, T.linaAge],
      ['U-10611', 25, 'chat', 3, T.chenRude, null, 'f3'],
    ]),
    chat('P-4', 1, [
      ['U-10507', 41, 'question', 1, 'Email me at tom.k88@mail.com', 'tom.k88@mail.com', 'f4'],
    ]),
    chat('P-5', 3, []),
  ];

  // kind: 'stopped' = the app caught it before sending; 'reported' = delivered, then reported.
  const flag = (id, chatId, from, to, min, reason, kind) => ({
    _id: id, id, chatId, from, to, at: ago(min), reason, kind, status: 'open', warned: false,
  });
  const flags = [
    flag('f1', 'P-1', 'U-10418', 'U-10644', 2, 'Chat handle shared', 'stopped'),
    flag('f2', 'P-2', 'U-10507', 'U-10702', 14, 'Phone number shared', 'stopped'),
    flag('f3', 'P-3', 'U-10611', 'U-10735', 25, 'Reported by Lina · rude message', 'reported'),
    flag('f4', 'P-4', 'U-10507', 'U-10812', 41, 'Email address shared', 'stopped'),
  ];

  const maxNum = (ids, re) => Math.max(0, ...ids.map((x) => Number(String(x).match(re)?.[1] ?? 0)));
  const counters = [
    { _id: 'user', seq: maxNum(users.map((u) => u._id), /^U-(\d+)$/) },
    { _id: 'pair', seq: pairs.length },
    { _id: 'set', seq: setSeq },
    { _id: 'msg', seq: msgSeq },
    { _id: 'flag', seq: flags.length },
  ];

  return { users, pairs, sets, chats, flags, counters };
}

/** Short notes printed next to each dev login. */
export const DEMO_NOTES = {
  'U-10231': 'Level 3 chat open with Dara',
  'U-10232': 'Level 3 chat open with Sophea',
  'U-10418': 'Level 2 open with Mei: answer her 5 + ask 5',
  'U-10644': 'Level 2 open with Visal: ask him 5',
  'U-10702': 'Tom asked you 5 (Level 1)',
  'U-10507': 'waiting for Anna; draft to Yuki',
  'U-10611': 'Level 3 chat with Lina (reported)',
  'U-10735': 'Level 3 chat with Chen',
  'U-10377': 'BLOCKED',
};
