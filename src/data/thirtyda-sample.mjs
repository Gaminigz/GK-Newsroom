// Demo data for 30+DA: 21 people around BKK1, Phnom Penh, plus the A2 design's
// sample conversations and flags, with the pairs and question sets behind them.
// Only `npm run 30da:seed` reads this (and it refuses a non-dev database):
// the live app and the admin never create fake users.

import { LANGS, LANG_ENGLISH, stageOpenLevel, currentYear } from "../thirtyda-app/shared/rules.js";
import { SYSTEM_QUESTIONS, SYSTEM_TOPICS, RETIRED_QUESTIONS, questionText, answerText } from "../thirtyda-app/shared/questions.js";

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

// The design's example lines (choice 1 of each list), looked up by their English text.
const L1_EXAMPLES = [
  'Is it raining where you are?', 'Is it busy around you right now?', 'Are you outside right now?', 'Is it a quiet day for you?',
];
// Level 2: choice 1 of each list (Intentions, Time of Comfort, Venue Vibe).
const L2_EXAMPLES = ['Meeting in person is better.', 'After work fits best.', 'A coffee shop works well.'];
// Choice 2 of each Level 2 list, so the two people in a pair do not send the very same lines.
const L2_SECOND = ['Prefer chatting a bit first.', 'Weekends take planning.', 'Lunch or dinner is fine.'];
// Level 2 sets sent before 2026-10-13 were picked from the older open lines (RETIRED_QUESTIONS) and replied to
// in words; P-5 keeps them, and P-3 the shape before that (2 picked + 3 written). All of it still reads back.
const L2_OLD = ['What can you see from your window?', 'What is the weather like there?', 'What is your favourite place near you?'];
const L2_OLD_SECOND = ['How did your morning start today?', 'What are your plans for this evening?', 'What is your favourite food?'];
const L2_OLDER = L2_OLD.slice(0, 2);
const keyOf = (level, en, i) => {
  const bank = [...SYSTEM_QUESTIONS[level], ...(RETIRED_QUESTIONS[level] ?? [])];
  return (bank.find((q) => q.text.en === en) ?? SYSTEM_QUESTIONS[level][i]).key;
};
// The topic a picked line was sent with (as POST /sets stores it): its built-in list's topic, none for retired lines.
const topicOf = (level, key, n) => (SYSTEM_QUESTIONS[level].some((q) => q.key === key) ? SYSTEM_TOPICS[level]?.[n - 1] ?? null : null);

// Hand-written lines: { <writer lang>: original, en, <reader lang> }.
const T = {
  meiCoffee: { zh: '你喜欢喝咖啡吗？', en: 'Do you like coffee?', km: 'តើអ្នកចូលចិត្តផឹកកាហ្វេទេ?' },
  meiWeekend: { zh: '你周末常出去玩吗？', en: 'Do you often go out at the weekend?', km: 'តើអ្នកតែងចេញទៅលេងនៅចុងសប្តាហ៍ទេ?' },
  meiYears: { zh: '你在金边住很久了吗？', en: 'Have you lived in Phnom Penh long?', km: 'តើអ្នករស់នៅភ្នំពេញយូរហើយឬនៅ?' },
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
  // Level 1 + 2 both ways (owner's model 2026-10-13): each person sends their own 5 and replies to the other's.
  visalRice: { km: 'តើអ្នកចូលចិត្តបាយឆាទេ?', en: 'Do you like fried rice?', zh: '你喜欢吃炒饭吗？' },
  visalWindow: { km: 'ខ្ញុំឃើញផ្លូវ និងហាងកាហ្វេមួយ។', en: 'I see the road and a café.', zh: '我看到马路和一家咖啡店。' },
  visalWeather: { km: 'ក្តៅ ហើយមានពពកបន្តិច។', en: 'Hot, with a few clouds.', zh: '很热，有一点云。' },
  daraTea: { en: 'Do you drink tea in the morning?', km: 'តើអ្នកផឹកតែនៅពេលព្រឹកទេ?' },
  sopheaMorning: { km: 'ខ្ញុំក្រោកពីព្រលឹម ហើយធ្វើបាយ។', en: 'I woke up early and made breakfast.' },
  sopheaNight: { km: 'ញ៉ាំបាយជាមួយគ្រួសារ។', en: 'Dinner with my family.' },
  sopheaFood: { km: 'សម្លម្ជូរ និងបាយក្តៅៗ។', en: 'Sour soup and hot rice.' },
  jihoFood: { ko: '한국 음식 좋아하세요?', en: 'Do you like Korean food?', zh: '你喜欢韩国菜吗？' },
  lingTea: { zh: '你喜欢喝茶吗？', en: 'Do you like tea?', ko: '차 좋아하세요?' },
  rithyMarket: { km: 'តើអ្នកចូលចិត្តទៅផ្សាររាត្រីទេ?', en: 'Do you like going to the night market?' },
  bophaBike: { km: 'តើអ្នកជិះកង់ទេ?', en: 'Do you ride a bicycle?' },
  minjunCoffee: { ko: '커피 좋아하세요?', en: 'Do you like coffee?', km: 'តើអ្នកចូលចិត្តកាហ្វេទេ?' },
  kanhaRain: { km: 'តើអ្នកចូលចិត្តភ្លៀងទេ?', en: 'Do you like the rain?', ko: '비 좋아하세요?' },
  minjunWork: { ko: '요즘 일이 바빠요?', en: 'Is work busy these days?', km: 'ថ្មីៗនេះការងាររវល់ទេ?' },
  minjunSunday: { ko: '일요일에는 보통 쉬어요?', en: 'Do you usually rest on Sundays?', km: 'ជាធម្មតាអ្នកសម្រាកនៅថ្ងៃអាទិត្យទេ?' },
  kanhaWindow: { km: 'ខ្ញុំឃើញដើមដូង និងផ្ទះអ្នកជិតខាង។', en: 'A coconut tree and my neighbour’s house.', ko: '야자나무와 이웃집이 보여요.' },
  kanhaWeather: { km: 'ភ្លៀងតិចៗពេលល្ងាច។', en: 'Light rain in the evening.', ko: '저녁에 비가 조금 와요.' },
  kanhaPlace: { km: 'ផ្សាររុស្ស៊ីនៅព្រឹកថ្ងៃអាទិត្យ។', en: 'The Russian Market on Sunday morning.', ko: '일요일 아침의 러시안 마켓이요.' },
  kanhaWork: { km: 'រវល់ ប៉ុន្តែល្អ។', en: 'Busy, but good.', ko: '바쁘지만 좋아요.' },
  kanhaSunday: { km: 'ទៅលេងម្ដាយខ្ញុំ។', en: 'I visit my mother.', ko: '어머니를 뵈러 가요.' },
  kanhaAmok: { km: 'តើអ្នកធ្លាប់ញ៉ាំអាម៉ុកទេ?', en: 'Have you tried amok?', ko: '아목 먹어 봤어요?' },
  kanhaHome: { km: 'តើអ្នកនឹកស្រុកកំណើតទេ?', en: 'Do you miss your home town?', ko: '고향이 그리워요?' },
  minjunMorning: { ko: '운동하고 커피를 마셨어요.', en: 'I worked out and had coffee.', km: 'ខ្ញុំហាត់ប្រាណ ហើយផឹកកាហ្វេ។' },
  minjunEvening: { ko: '친구들과 저녁을 먹을 거예요.', en: 'Dinner with friends.', km: 'ញ៉ាំអាហារពេលល្ងាចជាមួយមិត្តភក្តិ។' },
  minjunFood: { ko: '김치찌개가 제일 좋아요.', en: 'Kimchi stew is my favourite.', km: 'ស៊ុបគីមឈីជាម្ហូបដែលខ្ញុំចូលចិត្តជាងគេ។' },
  minjunAmok: { ko: '네, 정말 맛있었어요.', en: 'Yes, it was really good.', km: 'បាទ វាឆ្ងាញ់ណាស់។' },
  minjunHome: { ko: '가끔요, 특히 겨울에요.', en: 'Sometimes, mostly in winter.', km: 'ពេលខ្លះ ជាពិសេសនៅរដូវរងា។' },
  sakuraWalk: { ja: '散歩は好きですか？', en: 'Do you like walking?' },
  jamesCats: { en: 'Do you like cats?', ja: '猫は好きですか？' },
  sakuraBook: { ja: '本を読むのは好きですか？', en: 'Do you enjoy reading?' },
  sakuraHome: { ja: 'プノンペンの出身ですか？', en: 'Are you from Phnom Penh?' },
  jamesWindow: { en: 'A busy street and a pagoda roof.', ja: 'にぎやかな通りとお寺の屋根です。' },
  jamesWeekend: { en: 'Are you free this weekend?', ja: '今週末は空いていますか？' },
  jamesKhmer: { en: 'Are you learning any Khmer?', ja: 'クメール語を勉強していますか？' },
  sakuraMorning: { ja: 'ヨガをしてからコーヒーを飲みました。', en: 'Yoga, then coffee.' },
  sakuraEvening: { ja: '友だちと夕ご飯を食べます。', en: 'Dinner with a friend.' },
  sakuraFood: { ja: 'お寿司とクメールカレーです。', en: 'Sushi and Khmer curry.' },
  sakuraWeekend: { ja: '川沿いを散歩するつもりです。', en: 'A walk by the river, I think.' },
  harutoSpicy: { ja: '辛い料理は好きですか？', en: 'Do you like spicy food?', km: 'តើអ្នកចូលចិត្តម្ហូបហឹរទេ?' },
  // P-11 (ended): replied to with taps, written to be answered Yes / No.
  yukiTea: { ja: '緑茶は好きですか？', en: 'Do you like green tea?', ko: '녹차 좋아하세요?', km: 'តើអ្នកចូលចិត្តតែបៃតងទេ?' },
  jihoHike: { ko: '등산 좋아하세요?', en: 'Do you like hiking?', ja: '山登りは好きですか？', km: 'តើអ្នកចូលចិត្តឡើងភ្នំទេ?' },
  yukiCook: { ja: '料理をするのは好きですか？', en: 'Do you like to cook?', ko: '요리하는 거 좋아하세요?', km: 'តើអ្នកចូលចិត្តធ្វើម្ហូបទេ?' },
  yukiSea: { ja: '海の近くに住みたいですか？', en: 'Would you like to live near the sea?', ko: '바다 근처에 살고 싶어요?', km: 'តើអ្នកចង់រស់នៅជិតសមុទ្រទេ?' },
  jihoBooks: { ko: '책 읽는 거 좋아하세요?', en: 'Do you like reading books?', ja: '本を読むのは好きですか？', km: 'តើអ្នកចូលចិត្តអានសៀវភៅទេ?' },
  jihoMorning: { ko: '아침형 인간이에요?', en: 'Are you a morning person?', ja: '朝型ですか？', km: 'តើអ្នកចូលចិត្តក្រោកពីព្រលឹមទេ?' },
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
  const sets = [];
  const sysQ = (level, key, n, lang) => ({
    n, source: 'system', key, slot: n, text: questionText(level, key, lang), lang,
    translations: Object.fromEntries(LANGS.map((l) => [l, questionText(level, key, l)])),
    ...(topicOf(level, key, n) ? { topic: { ...topicOf(level, key, n) } } : {}),
  });
  const writtenQ = (map, n, lang) => ({ n, source: 'written', key: null, text: map[lang] ?? map.en, lang, translations: all(map) });
  const l1Reply = (n, key, lang, at) => ({
    n, key, text: null, lang, translations: Object.fromEntries(LANGS.map((l) => [l, answerText(key, l)])), at,
  });
  const l2Reply = (n, map, lang, at) => ({ n, key: null, text: map[lang] ?? map.en, lang, translations: all(map), at });

  /**
   * One set of 5 lines from `from` to `to`, sent `sentMin` minutes ago. `sys` = the picked lines by their
   * English text (default: the design's examples); `replies` = the receiver's replies to lines 1, 2, … in
   * order — taps (option keys) at both levels; a Level 2 set from before the taps (2026-10-13) has texts —
   * one minute apart, the last one `replyMin` minutes ago. All 5 replies = complete (completedAt = the last
   * reply); fewer = still replying.
   */
  function addSet({ pairId, level, from, to, sys, written, replies = [], sentMin, replyMin = null }) {
    const lang = langOf(from);
    const replyLang = langOf(to);
    const picks = (sys ?? (level === 1 ? L1_EXAMPLES : L2_EXAMPLES)).map((en, i) => keyOf(level, en, i));
    const questions = [...picks.map((k, i) => sysQ(level, k, i + 1, lang)), ...written.map((m, i) => writtenQ(m, picks.length + i + 1, lang))];
    const answers = replies.map((r, i) => {
      const at = ago(replyMin + (replies.length - 1 - i));
      return typeof r === 'string' ? l1Reply(i + 1, r, replyLang, at) : l2Reply(i + 1, r, replyLang, at);
    });
    const id = `S-${++setSeq}`;
    sets.push({
      _id: id, id, pairId, level, from, to, questions, answers, sentAt: ago(sentMin),
      completedAt: answers.length >= questions.length ? ago(replyMin) : null,
    });
  }

  // P-1 Mei ⇄ Visal · Level 2 open: Level 1 done both ways; Mei sent her Level 2 and Visal has tapped 2 of 5
  // replies; Visal has not sent his yet (earlier he tried to send a line with his Telegram).
  addSet({ pairId: 'P-1', level: 1, from: 'U-10644', to: 'U-10418', written: [T.meiCoffee], replies: ['no', 'yes', 'yes', 'maybe', 'yes'], sentMin: 3000, replyMin: 2950 });
  addSet({ pairId: 'P-1', level: 1, from: 'U-10418', to: 'U-10644', written: [T.visalRice], replies: ['yes', 'not_really', 'no', 'yes', 'yes'], sentMin: 2990, replyMin: 2900 });
  addSet({ pairId: 'P-1', level: 2, from: 'U-10644', to: 'U-10418', written: [T.meiWeekend, T.meiYears], replies: ['yes', 'maybe'], sentMin: 10, replyMin: 5 });
  // P-2 Tom → Anna · Level 1: Tom sent his 5; Anna can reply and send her own.
  addSet({ pairId: 'P-2', level: 1, from: 'U-10507', to: 'U-10702', written: [T.tomNew], sentMin: 16 });
  // P-3 Lina ⇄ Chen · Level 3 chat (Lina reported Chen). An older pair: Level 1 went one way only, and its
  // Level 2 sets have the old shape (2 picked + 3 written) and replies in words. All of it still reads back.
  addSet({ pairId: 'P-3', level: 1, from: 'U-10735', to: 'U-10611', written: [T.linaWalks], replies: ['yes', 'ok', 'no', 'yes', 'yes'], sentMin: 7200, replyMin: 7100 });
  addSet({ pairId: 'P-3', level: 2, from: 'U-10735', to: 'U-10611', sys: L2_OLDER, written: [T.linaWork, T.linaFood, T.linaCame], replies: [T.chenWindow, T.chenWeather, T.chenWork, T.chenFood, T.chenCame], sentMin: 5600, replyMin: 5300 });
  addSet({ pairId: 'P-3', level: 2, from: 'U-10611', to: 'U-10735', sys: L2_OLDER, written: [T.chenWeekend, T.chenMusic, T.chenMorning], replies: [T.linaWindow, T.linaWeather, T.linaWeekend, T.linaMusic, T.linaMorning], sentMin: 5550, replyMin: 4400 });
  // P-5 Sophea ⇄ Dara · Level 3 open, nothing said yet; Level 1 and Level 2 both ways above it (their Level 2
  // was replied to in words, before the taps: it reads back as it was).
  addSet({ pairId: 'P-5', level: 1, from: 'U-10231', to: 'U-10232', written: [T.sopheaDogs], replies: ['yes', 'not_really', 'yes', 'maybe', 'yes'], sentMin: 8000, replyMin: 7950 });
  addSet({ pairId: 'P-5', level: 1, from: 'U-10232', to: 'U-10231', written: [T.daraTea], replies: ['no', 'yes', 'maybe', 'yes', 'no'], sentMin: 7990, replyMin: 7900 });
  addSet({ pairId: 'P-5', level: 2, from: 'U-10231', to: 'U-10232', sys: L2_OLD, written: [T.sopheaCook, T.sopheaEvening], replies: [T.daraWindow, T.daraWeather, T.daraPlace, T.daraCook, T.daraEvening], sentMin: 6400, replyMin: 6000 });
  addSet({ pairId: 'P-5', level: 2, from: 'U-10232', to: 'U-10231', sys: L2_OLD_SECOND, written: [T.daraRelax, T.daraTrip], replies: [T.sopheaMorning, T.sopheaNight, T.sopheaFood, T.sopheaRelax, T.sopheaTrip], sentMin: 6300, replyMin: 5900 });
  // P-6 Ji-ho ⇄ Ling · Level 1 done both ways; Level 2 opens in about 20 hours.
  addSet({ pairId: 'P-6', level: 1, from: 'U-10790', to: 'U-10245', written: [T.jihoFood], replies: ['yes', 'no', 'yes', 'not_really', 'yes'], sentMin: 390, replyMin: 300 });
  addSet({ pairId: 'P-6', level: 1, from: 'U-10245', to: 'U-10790', written: [T.lingTea], replies: ['maybe', 'yes', 'no', 'yes', 'no'], sentMin: 380, replyMin: 240 });
  // P-7 Rithy ⇄ Bopha · Level 1 both sent: Rithy replied to all of Bopha's, Bopha has 2 replies left.
  addSet({ pairId: 'P-7', level: 1, from: 'U-10233', to: 'U-10240', written: [T.rithyMarket], replies: ['yes', 'no', 'maybe'], sentMin: 180, replyMin: 30 });
  addSet({ pairId: 'P-7', level: 1, from: 'U-10240', to: 'U-10233', written: [T.bophaBike], replies: ['no', 'yes', 'yes', 'not_really', 'no'], sentMin: 150, replyMin: 60 });
  // P-8 Min-jun ⇄ Kanha · Level 1 and 2 done both ways (taps): Min-jun chose to open the chat; Kanha has to choose.
  addSet({ pairId: 'P-8', level: 1, from: 'U-10243', to: 'U-10242', written: [T.minjunCoffee], replies: ['yes', 'yes', 'no', 'maybe', 'yes'], sentMin: 4900, replyMin: 4800 });
  addSet({ pairId: 'P-8', level: 1, from: 'U-10242', to: 'U-10243', written: [T.kanhaRain], replies: ['not_really', 'yes', 'yes', 'no', 'yes'], sentMin: 4850, replyMin: 4700 });
  addSet({ pairId: 'P-8', level: 2, from: 'U-10243', to: 'U-10242', written: [T.minjunWork, T.minjunSunday], replies: ['yes', 'maybe', 'yes', 'yes', 'no'], sentMin: 3200, replyMin: 2000 });
  addSet({ pairId: 'P-8', level: 2, from: 'U-10242', to: 'U-10243', sys: L2_SECOND, written: [T.kanhaAmok, T.kanhaHome], replies: ['yes', 'not_really', 'yes', 'yes', 'yes'], sentMin: 3100, replyMin: 180 });
  // P-9 Sakura ⇄ James · Level 2 open, both sets sent, both still tapping replies (James 1 of 5, Sakura 4 of 5).
  addSet({ pairId: 'P-9', level: 1, from: 'U-10246', to: 'U-10247', written: [T.sakuraWalk], replies: ['yes', 'yes', 'no', 'maybe', 'yes'], sentMin: 3400, replyMin: 3300 });
  addSet({ pairId: 'P-9', level: 1, from: 'U-10247', to: 'U-10246', written: [T.jamesCats], replies: ['yes', 'not_really', 'yes', 'yes', 'yes'], sentMin: 3350, replyMin: 3000 });
  addSet({ pairId: 'P-9', level: 2, from: 'U-10246', to: 'U-10247', written: [T.sakuraBook, T.sakuraHome], replies: ['yes'], sentMin: 600, replyMin: 500 });
  addSet({ pairId: 'P-9', level: 2, from: 'U-10247', to: 'U-10246', sys: L2_SECOND, written: [T.jamesWeekend, T.jamesKhmer], replies: ['maybe', 'yes', 'no', 'yes'], sentMin: 550, replyMin: 20 });
  // P-10 Haruto → Chenda · an older one-way Level 1 pair ('l1_answer'): Chenda can reply and send hers now.
  addSet({ pairId: 'P-10', level: 1, from: 'U-10244', to: 'U-10248', written: [T.harutoSpicy], sentMin: 80 });
  // P-11 Yuki ⇄ Ji-ho · ended: Level 1 and 2 done both ways; Yuki chose to open the chat, Ji-ho chose "Forget it".
  addSet({ pairId: 'P-11', level: 1, from: 'U-10812', to: 'U-10790', written: [T.yukiTea], replies: ['yes', 'no', 'yes', 'maybe', 'yes'], sentMin: 4300, replyMin: 4250 });
  addSet({ pairId: 'P-11', level: 1, from: 'U-10790', to: 'U-10812', written: [T.jihoHike], replies: ['no', 'yes', 'not_really', 'yes', 'no'], sentMin: 4280, replyMin: 4200 });
  addSet({ pairId: 'P-11', level: 2, from: 'U-10812', to: 'U-10790', sys: L2_SECOND, written: [T.yukiCook, T.yukiSea], replies: ['yes', 'maybe', 'no', 'yes', 'no'], sentMin: 2700, replyMin: 2500 });
  addSet({ pairId: 'P-11', level: 2, from: 'U-10790', to: 'U-10812', written: [T.jihoBooks, T.jihoMorning], replies: ['yes', 'yes', 'maybe', 'yes', 'yes'], sentMin: 2650, replyMin: 2400 });

  // Minutes ago (a negative number = still to come). `started` = the first set sent (null: a draft that only
  // its opener sees); `legacy` keeps an older pair exactly as it was stored (no startedAt field).
  // After Level 2: `decisions` = { [id]: [open, minutesAgo] } (the choice to open the chat or forget it);
  // `ended` = minutes ago someone chose "Forget it" (that person: `endedBy`).
  const pair = (id, a, b, stage, {
    l2 = null, l3 = null, updated, created, started = null, lastChat = null, legacy = false, decisions = null, ended = null, endedBy = null,
  }) => ({
    _id: id, id, key: [a, b].sort().join('|'), a, b, members: [a, b], level: stage === 'ended' ? 2 : stageOpenLevel(stage), stage,
    ...(legacy ? {} : { startedAt: started === null ? null : ago(started) }),
    l2OpensAt: l2 === null ? null : ago(l2), l3OpensAt: l3 === null ? null : ago(l3),
    ...(decisions ? { decisions: Object.fromEntries(Object.entries(decisions).map(([u, [open, min]]) => [u, { open, at: ago(min) }])) } : {}),
    ...(ended === null ? {} : { endedAt: ago(ended), endedBy }),
    remind: {}, opened: { [a]: ago(created) }, lastChat, createdAt: ago(created), updatedAt: ago(updated),
  });
  const pairs = [
    pair('P-1', 'U-10644', 'U-10418', 'l2_open', { l2: 1460, updated: 5, created: 3010, started: 3000 }),
    pair('P-2', 'U-10507', 'U-10702', 'l1', { updated: 16, created: 20, started: 16 }),
    pair('P-3', 'U-10735', 'U-10611', 'l3_open', { l2: 5660, l3: 2960, updated: 25, created: 7300, started: 7200, lastChat: { from: 'U-10611', at: ago(25) } }),
    pair('P-4', 'U-10507', 'U-10812', 'l1', { updated: 45, created: 45 }),
    pair('P-5', 'U-10231', 'U-10232', 'l3_open', { l2: 6460, l3: 4460, updated: 4460, created: 8100, started: 8000 }),
    pair('P-6', 'U-10790', 'U-10245', 'l2_wait', { l2: 240 - 1440, updated: 240, created: 400, started: 390 }),
    pair('P-7', 'U-10233', 'U-10240', 'l1', { updated: 30, created: 200, started: 180 }),
    pair('P-8', 'U-10243', 'U-10242', 'l3_decide', { l2: 3260, updated: 150, created: 5000, started: 4900, decisions: { 'U-10243': [true, 150] } }),
    pair('P-9', 'U-10246', 'U-10247', 'l2_open', { l2: 1560, updated: 20, created: 3500, started: 3400 }),
    pair('P-10', 'U-10244', 'U-10248', 'l1_answer', { updated: 80, created: 90, legacy: true }),
    pair('P-11', 'U-10812', 'U-10790', 'ended', {
      l2: 2800, updated: 2300, created: 4400, started: 4300, decisions: { 'U-10812': [true, 2350], 'U-10790': [false, 2300] }, ended: 2300, endedBy: 'U-10790',
    }),
  ];
  // users.level follows the pairs exactly: l2_open / l3_decide → 2, l3_open → 3, an ended one the level it
  // reached (2), else 1 (as the app's syncLevel does).
  for (const u of users) {
    u.level = pairs.filter((p) => p.members.includes(u._id)).reduce((m, p) => Math.max(m, p.stage === 'ended' ? p.level : stageOpenLevel(p.stage)), 1);
  }

  // The admin's chat log, as the app writes it: a set's 5 lines when it is sent and its 5 replies once all 5
  // are in, plus the rows below — [from, minutesAgo, kind, level, line, hit?, flagId?]; a hit = stopped by the app.
  const EXTRA = {
    'P-1': [['U-10418', 3, 'question', 2, { km: 'បន្ថែមខ្ញុំនៅ Telegram @visal88', en: 'Add me on Telegram @visal88' }, 'Telegram @visal88', 'f1']],
    'P-2': [['U-10507', 14, 'question', 1, 'Can I call you? 012 88 77 66', '012 88 77 66', 'f2']],
    'P-3': [
      ['U-10735', 40, 'chat', 3, T.linaCoffee],
      ['U-10611', 38, 'chat', 3, T.chenMornings],
      ['U-10735', 30, 'chat', 3, T.linaAge],
      ['U-10611', 25, 'chat', 3, T.chenRude, null, 'f3'],
    ],
    'P-4': [['U-10507', 41, 'question', 1, 'Email me at tom.k88@mail.com', 'tom.k88@mail.com', 'f4']],
    // The choice after Level 2, as POST /decide logs it.
    'P-8': [['U-10243', 150, 'decision', 2, 'Chose to open the chat (Level 3)']],
    'P-11': [
      ['U-10812', 2350, 'decision', 2, 'Chose to open the chat (Level 3)'],
      ['U-10790', 2300, 'decision', 2, 'Chose to forget it: the conversation ended for both'],
    ],
  };
  const row = ({ from, at, kind, level, n = null, text, lang, translations, hit = null, flagId = null }) => ({
    from, at, kind, level, ...(n ? { n } : {}), text, lang, english: lang === 'en' ? null : translations?.en ?? null,
    translations, hit, flagId, stopped: Boolean(hit), // a reported line was delivered; only rule hits are stopped
  });
  const rowsOf = (pairId) => {
    const rows = [];
    for (const s of sets.filter((x) => x.pairId === pairId)) {
      for (const q of s.questions) rows.push(row({ from: s.from, at: s.sentAt, kind: 'question', level: s.level, n: q.n, text: q.text, lang: q.lang, translations: q.translations }));
      if (!s.completedAt) continue;
      for (const a of s.answers) {
        rows.push(row({
          from: s.to, at: s.completedAt, kind: 'answer', level: s.level, n: a.n,
          text: a.key ? answerText(a.key, a.lang) : a.text, lang: a.lang, translations: a.translations,
        }));
      }
    }
    for (const [from, min, kind, level, t, hit = null, flagId = null] of EXTRA[pairId] || []) {
      const lang = langOf(from);
      const text = typeof t === 'string' ? t : t[lang];
      rows.push(row({ from, at: ago(min), kind, level, text, lang, translations: typeof t === 'string' ? { [lang]: t } : all(t), hit, flagId }));
    }
    return rows.sort((x, y) => x.at.localeCompare(y.at)); // stable: a set's lines keep their order
  };
  let msgSeq = 0;
  const chats = pairs.map((p) => ({
    _id: p._id, id: p._id, a: p.a, b: p.b, level: p.level, ...(p.endedAt ? { endedAt: p.endedAt } : {}),
    messages: rowsOf(p._id).map((m) => ({ id: `M-${++msgSeq}`, ...m })),
  }));

  // kind: 'stopped' = the app caught it before sending; 'reported' = delivered, then reported.
  const flag = (id, chatId, from, to, min, reason, kind) => ({
    _id: id, id, chatId, from, to, at: ago(min), reason, kind, status: 'open', warned: false,
  });
  const flags = [
    flag('f1', 'P-1', 'U-10418', 'U-10644', 3, 'Chat handle shared', 'stopped'),
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
  'U-10231': 'Level 3 chat with Dara (Level 1 + 2 above it, both ways)',
  'U-10232': 'Level 3 chat with Sophea (Level 1 + 2 above it, both ways)',
  'U-10418': 'Level 2 with Mei: reply to her 5 (2 done) + send yours',
  'U-10644': 'Level 2 with Visal: he replied 2 of 5',
  'U-10702': 'Tom sent you 5 (Level 1): reply + send yours',
  'U-10507': 'waiting for Anna; draft to Yuki',
  'U-10812': 'conversation with Ji-ho ended (he chose "Forget it")',
  'U-10611': 'Level 3 chat with Lina (reported; older one-way Level 1)',
  'U-10735': 'Level 3 chat with Chen',
  'U-10790': 'Level 2 with Ling opens in ~20 h; chose "Forget it" with Yuki (ended)',
  'U-10245': 'Level 2 with Ji-ho opens in ~20 h',
  'U-10233': 'Level 1 with Bopha: waiting for her last 2 replies',
  'U-10240': 'Level 1 with Rithy: 2 replies left',
  'U-10243': 'Level 2 with Kanha done: you chose to open the chat, waiting for her',
  'U-10242': 'Level 2 with Min-jun done: open the chat or forget it',
  'U-10246': 'Level 2 with James: both replying (you: 1 left)',
  'U-10247': 'Level 2 with Sakura: both replying (you: 4 left)',
  'U-10248': 'Haruto sent you 5 (older one-way pair): reply + send yours',
  'U-10244': 'waiting for Chenda',
  'U-10377': 'BLOCKED',
};
