// 30+DA question bank, Level 1 answer options and roles, in all five languages.
// Imported by the server AND served to the browser unchanged: plain ES module, no imports.
// System questions never need the translation provider; every language is written out here.

const q = (key, en, km, zh, ko, ja) => ({ key, text: { en, km, zh, ko, ja } });

// Level 2 (Gamini 2026-10-13): three lists of 5 short statements, one topic each — "Intentions", "Time of
// Comfort", "Venue Vibe" (SYSTEM_TOPICS) — that the other person answers with one tap (Yes / No / Not really
// / Maybe). Keys are the ones the owner's admin lists use. The open questions before them: RETIRED_QUESTIONS.
const L2_LISTS = [
  // Intentions
  [
    q('inten_1', 'Meeting in person is better.',
      'ជួបផ្ទាល់គឺល្អជាង។', '当面见面更好。', '직접 만나는 게 더 좋아요.', '直接会うほうがいいです。'),
    q('inten_2', 'Prefer chatting a bit first.',
      'ចង់ជជែកគ្នាបន្តិចសិន។', '我更想先聊一聊。', '먼저 조금 대화하고 싶어요.', 'まずは少し話したいです。'),
    q('inten_3', 'Just meeting naturally first.',
      'ជួបគ្នាតាមធម្មជាតិសិន។', '先自然地见个面就好。', '먼저 자연스럽게 만나요.', 'まずは自然に会いましょう。'),
    q('inten_4', 'Taking things step by step.',
      'ធ្វើអ្វីៗម្ដងមួយជំហាន។', '一步一步慢慢来。', '한 걸음씩 천천히 가요.', '一歩ずつ進みたいです。'),
    q('inten_5', 'Going with the flow today.',
      'ថ្ងៃនេះទុកឲ្យវាទៅតាមធម្មជាតិ។', '今天就顺其自然吧。', '오늘은 흐름에 맡겨요.', '今日は流れに任せます。'),
  ],
  // Time of Comfort
  [
    q('time_1', 'After work fits best.',
      'ក្រោយម៉ោងធ្វើការស្រួលជាងគេ។', '下班后最合适。', '퇴근 후가 제일 좋아요.', '仕事の後がいちばんいいです。'),
    q('time_2', 'Weekends take planning.',
      'ចុងសប្តាហ៍ត្រូវរៀបចំទុកមុន។', '周末需要提前安排。', '주말은 미리 계획해야 해요.', '週末は予定を立てる必要があります。'),
    q('time_3', 'Schedule updates are good.',
      'ប្រាប់កាលវិភាគជាមុនគឺល្អ។', '提前说一下时间安排很好。', '일정을 알려 주면 좋아요.', '予定を知らせてくれると助かります。'),
    q('time_4', 'Let me know your availability.',
      'ប្រាប់ខ្ញុំពីពេលដែលអ្នកទំនេរ។', '告诉我你什么时候有空。', '언제 시간이 되는지 알려 주세요.', '空いている時間を教えてください。'),
    q('time_5', 'Busy schedule these days.',
      'ថ្ងៃនេះៗរវល់ច្រើន។', '最近比较忙。', '요즘 일정이 바빠요.', '最近は予定が詰まっています。'),
  ],
  // Venue Vibe
  [
    q('venue_1', 'A coffee shop works well.',
      'ហាងកាហ្វេគឺល្អ។', '咖啡店就很好。', '카페가 좋아요.', 'カフェがいいです。'),
    q('venue_2', 'Lunch or dinner is fine.',
      'អាហារថ្ងៃត្រង់ ឬល្ងាចក៏បាន។', '午饭或晚饭都可以。', '점심이나 저녁 다 괜찮아요.', 'ランチでもディナーでもいいです。'),
    q('venue_3', 'Shopping malls are easy.',
      'ផ្សារទំនើបងាយស្រួល។', '商场比较方便。', '쇼핑몰이 편해요.', 'ショッピングモールが便利です。'),
    q('venue_4', 'Let me know your spot first.',
      'ប្រាប់ខ្ញុំពីកន្លែងរបស់អ្នកសិន។', '先告诉我你想去哪里。', '먼저 원하는 장소를 알려 주세요.', 'まず行きたい場所を教えてください。'),
    q('venue_5', 'Somewhere nearby is best.',
      'កន្លែងជិតៗគឺល្អបំផុត។', '附近的地方最好。', '가까운 곳이 제일 좋아요.', '近くの場所がいちばんです。'),
  ],
];

export const SYSTEM_QUESTIONS = {
  // Level 1: yes/no questions about what is going on AROUND the other person right now.
  1: [
    q('l1_rain', 'Is it raining where you are?',
      'តើនៅកន្លែងអ្នកកំពុងភ្លៀងទេ?', '你那边在下雨吗？', '지금 있는 곳에 비가 오나요?', 'そちらは雨が降っていますか？'),
    q('l1_busy', 'Is it busy around you right now?',
      'តើឥឡូវនេះនៅជុំវិញអ្នកមមាញឹកទេ?', '你周围现在很热闹吗？', '지금 주변이 붐비나요?', '今、周りは混んでいますか？'),
    q('l1_outside', 'Are you outside right now?',
      'តើឥឡូវនេះអ្នកនៅខាងក្រៅទេ?', '你现在在外面吗？', '지금 밖에 있나요?', '今、外にいますか？'),
    q('l1_quiet_day', 'Is it a quiet day for you?',
      'តើថ្ងៃនេះជាថ្ងៃស្ងប់ស្ងាត់សម្រាប់អ្នកទេ?', '今天对你来说是平静的一天吗？', '오늘은 조용한 하루인가요?', '今日は落ち着いた一日ですか？'),
    q('l1_noisy', 'Is it noisy where you are?',
      'តើនៅកន្លែងអ្នកមានសំឡេងអ៊ូអរទេ?', '你那边吵吗？', '지금 있는 곳이 시끄럽나요?', 'そちらは騒がしいですか？'),
    q('l1_hot', 'Is it hot where you are today?',
      'តើថ្ងៃនេះនៅកន្លែងអ្នកក្តៅទេ?', '你那边今天热吗？', '오늘 그곳은 덥나요?', '今日はそちらは暑いですか？'),
    q('l1_at_work', 'Are you at work right now?',
      'តើឥឡូវនេះអ្នកកំពុងធ្វើការទេ?', '你现在在上班吗？', '지금 일하는 중인가요?', '今、仕事中ですか？'),
    q('l1_traffic', 'Is there a lot of traffic near you?',
      'តើនៅជិតអ្នកកំពុងស្ទះចរាចរណ៍ទេ?', '你附近现在堵车吗？', '근처에 차가 많이 막히나요?', '近くは渋滞していますか？'),
    q('l1_windy', 'Is it windy where you are?',
      'តើនៅកន្លែងអ្នកមានខ្យល់បក់ខ្លាំងទេ?', '你那边风大吗？', '그곳은 바람이 많이 부나요?', 'そちらは風が強いですか？'),
    q('l1_music', 'Can you hear music right now?',
      'តើឥឡូវនេះអ្នកឮសំឡេងតន្ត្រីទេ?', '你现在能听到音乐吗？', '지금 음악 소리가 들리나요?', '今、音楽が聞こえますか？'),
    q('l1_eating', 'Are you eating right now?',
      'តើឥឡូវនេះអ្នកកំពុងញ៉ាំអាហារទេ?', '你现在在吃东西吗？', '지금 뭔가 먹고 있나요?', '今、何か食べていますか？'),
    q('l1_sunny', 'Is the sun out where you are?',
      'តើនៅកន្លែងអ្នកមានថ្ងៃចាំងទេ?', '你那边出太阳了吗？', '그곳은 햇빛이 비치나요?', 'そちらは日が差していますか？'),
    q('l1_home', 'Are you at home right now?',
      'តើឥឡូវនេះអ្នកនៅផ្ទះទេ?', '你现在在家吗？', '지금 집에 있나요?', '今、家にいますか？'),
    q('l1_drink', 'Do you have a coffee or tea with you right now?',
      'តើឥឡូវនេះអ្នកមានកាហ្វេ ឬតែនៅជិតខ្លួនទេ?', '你现在手边有咖啡或茶吗？', '지금 곁에 커피나 차가 있나요?', '今、手元にコーヒーかお茶がありますか？'),
    q('l1_company', 'Are there other people with you right now?',
      'តើឥឡូវនេះមានអ្នកផ្សេងនៅជាមួយអ្នកទេ?', '你现在身边有其他人吗？', '지금 다른 사람과 함께 있나요?', '今、誰かと一緒にいますか？'),
    q('l1_aircon', 'Is the air conditioning on where you are?',
      'តើនៅកន្លែងអ្នកកំពុងបើកម៉ាស៊ីនត្រជាក់ទេ?', '你那边开着空调吗？', '지금 있는 곳에 에어컨이 켜져 있나요?', 'そちらはエアコンがついていますか？'),
    q('l1_relaxing', 'Are you relaxing right now?',
      'តើឥឡូវនេះអ្នកកំពុងសម្រាកទេ?', '你现在在休息吗？', '지금 쉬고 있나요?', '今、くつろいでいますか？'),
    q('l1_on_the_move', 'Are you on the move right now?',
      'តើឥឡូវនេះអ្នកកំពុងធ្វើដំណើរទេ?', '你现在在路上吗？', '지금 이동 중인가요?', '今、移動中ですか？'),
    q('l1_cooking', 'Can you smell food cooking nearby?',
      'តើអ្នកធុំក្លិនគេចម្អិនម្ហូបនៅក្បែរនោះទេ?', '你能闻到附近做饭的香味吗？', '근처에서 음식 냄새가 나나요?', '近くから料理のにおいがしますか？'),
    q('l1_window', 'Is there a window near you?',
      'តើនៅជិតអ្នកមានបង្អួចទេ?', '你附近有窗户吗？', '가까이에 창문이 있나요?', '近くに窓がありますか？'),
  ],
  // Level 2: the three lists above, dealt in order (list 1 Intentions, 2 Time of Comfort, 3 Venue Vibe).
  2: dealOrder(L2_LISTS),
};

// defaultSlots deals a flat bank as "choice j of list i = item j × lists + i": interleave so list i stays list i.
function dealOrder(lists) {
  return lists[0].flatMap((_, j) => lists.map((list) => list[j]));
}

const topic = (en, km, zh, ko, ja) => ({ en, km, zh, ko, ja });

// The topic of each built-in list ("Line 6 · Intentions"); Level 1's built-in lists have none.
export const SYSTEM_TOPICS = {
  1: [],
  2: [
    topic('Intentions', 'គោលបំណង', '意向', '의향', '気持ち'),
    topic('Time of Comfort', 'ពេលវេលាដែលស្រួល', '方便的时间', '편한 시간', '都合のいい時間'),
    topic('Venue Vibe', 'កន្លែងជួប', '见面地点', '만남 장소', '会う場所'),
  ],
};

// The built-in Level 2 lines before 2026-10-13: open questions ("What can you see from your window?"), no
// longer offered. Sets already sent with them keep their own text; these only read back an old key.
export const RETIRED_QUESTIONS = {
  2: [
    q('l2_window', 'What can you see from your window?',
      'តើអ្នកឃើញអ្វីខ្លះពីបង្អួចរបស់អ្នក?', '从你的窗户能看到什么？', '창밖으로 무엇이 보이나요?', '窓から何が見えますか？'),
    q('l2_weather', 'What is the weather like there?',
      'តើអាកាសធាតុនៅទីនោះយ៉ាងម៉េចដែរ?', '你那边天气怎么样？', '그곳 날씨는 어때요?', 'そちらの天気はどうですか？'),
    q('l2_fav_place', 'What is your favourite place near you?',
      'តើកន្លែងណានៅជិតអ្នកដែលអ្នកចូលចិត្តជាងគេ?', '你附近最喜欢的地方是哪里？', '근처에서 가장 좋아하는 곳은 어디인가요?', '近所でいちばん好きな場所はどこですか？'),
    q('l2_morning', 'How did your morning start today?',
      'តើព្រឹកនេះអ្នកចាប់ផ្ដើមថ្ងៃយ៉ាងដូចម្ដេចដែរ?', '你今天早上是怎么开始的？', '오늘 아침은 어떻게 시작했나요?', '今朝はどんなふうに始まりましたか？'),
    q('l2_evening', 'What are your plans for this evening?',
      'តើល្ងាចនេះអ្នកមានគម្រោងធ្វើអ្វីខ្លះ?', '你今晚有什么打算？', '오늘 저녁에는 무엇을 할 계획인가요?', '今夜は何をする予定ですか？'),
    q('l2_fav_food', 'What is your favourite food?',
      'តើម្ហូបអ្វីដែលអ្នកចូលចិត្តជាងគេ?', '你最喜欢吃什么？', '가장 좋아하는 음식은 무엇인가요?', 'いちばん好きな食べ物は何ですか？'),
    q('l2_weekend', 'How do you like to spend your weekend?',
      'តើអ្នកចូលចិត្តចំណាយពេលចុងសប្ដាហ៍យ៉ាងដូចម្ដេច?', '你周末喜欢怎么过？', '주말은 어떻게 보내는 걸 좋아하나요?', '週末はどう過ごすのが好きですか？'),
    q('l2_best_today', 'What was the best part of your day so far?',
      'តើរឿងអ្វីដែលល្អបំផុតក្នុងថ្ងៃនេះសម្រាប់អ្នករហូតមកដល់ពេលនេះ?', '今天到目前为止，最让你开心的是什么？',
      '오늘 지금까지 가장 좋았던 순간은 언제였나요?', '今日これまでで、いちばん良かったことは何ですか？'),
    q('l2_morning_drink', 'What do you like to drink in the morning?',
      'តើពេលព្រឹកអ្នកចូលចិត្តផឹកអ្វី?', '你早上喜欢喝什么？', '아침에는 무엇을 마시는 걸 좋아하나요?', '朝は何を飲むのが好きですか？'),
    q('l2_music', 'What music do you listen to these days?',
      'តើសព្វថ្ងៃនេះអ្នកស្ដាប់តន្ត្រីបែបណា?', '你最近在听什么音乐？', '요즘 어떤 음악을 듣나요?', '最近はどんな音楽を聴いていますか？'),
    q('l2_unwind', 'What helps you relax after a long day?',
      'តើអ្វីដែលជួយឱ្យអ្នកសម្រាកលំហែបន្ទាប់ពីថ្ងៃដ៏នឿយហត់?', '忙了一整天之后，什么能让你放松下来？',
      '긴 하루를 보낸 뒤에는 무엇이 휴식에 도움이 되나요?', '長い一日のあと、どうやってリラックスしますか？'),
    q('l2_travel', 'Where would you like to travel next?',
      'តើលើកក្រោយអ្នកចង់ទៅដើរលេងនៅកន្លែងណា?', '你下一次最想去哪里旅行？', '다음에는 어디로 여행 가고 싶나요?', '次はどこへ旅行したいですか？'),
    q('l2_free_time', 'What do you enjoy doing in your free time?',
      'តើអ្នកចូលចិត្តធ្វើអ្វីនៅពេលទំនេរ?', '你空闲的时候喜欢做什么？', '여가 시간에는 무엇을 즐겨 하나요?', '自由な時間には何をするのが好きですか？'),
    q('l2_sounds', 'What sounds can you hear right now?',
      'តើឥឡូវនេះអ្នកឮសំឡេងអ្វីខ្លះ?', '你现在能听到哪些声音？', '지금 어떤 소리가 들리나요?', '今、どんな音が聞こえますか？'),
    q('l2_cook', 'What is a dish you cook well?',
      'តើម្ហូបអ្វីដែលអ្នកចម្អិនបានឆ្ងាញ់ជាងគេ?', '你最拿手的菜是什么？', '자신 있게 만들 수 있는 요리는 무엇인가요?', '得意な料理は何ですか？'),
    q('l2_childhood', 'What did you love doing as a child?',
      'តើកាលនៅក្មេង អ្នកចូលចិត្តធ្វើអ្វីជាងគេ?', '你小时候最喜欢做什么？', '어릴 때 무엇을 하는 걸 가장 좋아했나요?', '子どもの頃、何をするのが大好きでしたか？'),
    q('l2_smile', 'What small thing made you smile this week?',
      'តើរឿងតូចតាចអ្វីដែលធ្វើឱ្យអ្នកញញឹមក្នុងសប្ដាហ៍នេះ?', '这周有什么小事让你笑了？', '이번 주에 어떤 작은 일로 미소 지었나요?', '今週、どんな小さなことで笑顔になりましたか？'),
    q('l2_lunch', 'What did you have for lunch today?',
      'តើថ្ងៃនេះអ្នកញ៉ាំអ្វីជាអាហារថ្ងៃត្រង់?', '你今天午饭吃了什么？', '오늘 점심으로 무엇을 먹었나요?', '今日のお昼は何を食べましたか？'),
    q('l2_season', 'Which season do you like most, and why?',
      'តើអ្នកចូលចិត្តរដូវណាជាងគេ ហើយហេតុអ្វី?', '你最喜欢哪个季节？为什么？', '가장 좋아하는 계절은 언제이고, 왜 그런가요?', 'いちばん好きな季節はいつですか？それはなぜですか？'),
  ],
};

// Every set has 5 lines: Level 1 pick 4 + write 1, Level 2 pick 3 + write 2 (Gamini 2026-10-13: "3 system
// given + 2 text"). Level 2 sets sent earlier with pick 2 + write 3 keep their own lines and still read back.
export const LEVEL_RULES = { 1: { pick: 4, write: 1 }, 2: { pick: 3, write: 2 } };

// One tap per line, at Level 1 and Level 2 (Gamini 2026-10-13: "Level 2 replies are taps, like Level 1").
export const L1_ANSWERS = [
  q('yes', 'Yes', 'បាទ/ចាស', '是的', '네', 'はい'),
  q('no', 'No', 'ទេ', '不是', '아니요', 'いいえ'),
  q('not_really', 'Not really', 'មិនសូវទេ', '不太是', '별로요', 'そうでもない'),
  q('maybe', 'Maybe', 'ប្រហែលជា', '可能吧', '아마도요', 'たぶん'),
];

/**
 * The taps that reply to one line, at Level 1 and Level 2: a picked line gets Yes / No / Not really / Maybe,
 * the sender's own written line gets Yes / No only.
 */
export function replyOptions(source) {
  return source === 'written' ? L1_ANSWERS.filter((a) => a.key === 'yes' || a.key === 'no') : L1_ANSWERS;
}

/** The same taps under their older name (Level 1 had them first). */
export const l1Answers = replyOptions;

// "YOU ARE" on the profile.
export const ROLES = [
  q('sales', 'Sales', 'ផ្នែកលក់', '销售', '영업', '営業'),
  q('accountant', 'Accountant', 'គណនេយ្យករ', '会计', '회계사', '会計士'),
  q('hr', 'HR', 'ធនធានមនុស្ស', '人力资源', '인사', '人事'),
  q('administration', 'Administration', 'រដ្ឋបាល', '行政', '행정', '総務'),
  q('manager', 'Manager', 'អ្នកគ្រប់គ្រង', '经理', '매니저', 'マネージャー'),
  q('director', 'Director', 'នាយក', '总监', '이사', 'ディレクター'),
  q('doctor', 'Doctor', 'វេជ្ជបណ្ឌិត', '医生', '의사', '医師'),
  q('nurse', 'Nurse', 'គិលានុបដ្ឋាក', '护士', '간호사', '看護師'),
  q('civil_engineering', 'Civil engineering', 'វិស្វកម្មសំណង់ស៊ីវិល', '土木工程', '토목 공학', '土木工学'),
  q('airport_staff', 'Airport staff', 'បុគ្គលិកអាកាសយានដ្ឋាន', '机场工作人员', '공항 직원', '空港スタッフ'),
  q('government', 'Government', 'ស្ថាប័នរដ្ឋ', '政府部门', '정부 기관', '官公庁'),
  q('operations', 'Operations', 'ប្រតិបត្តិការ', '运营', '운영', '運営'),
  q('logistics', 'Logistics', 'ភស្តុភារ', '物流', '물류', '物流'),
  q('shop_staff', 'Shop staff', 'បុគ្គលិកហាង', '店员', '매장 직원', '店舗スタッフ'),
  q('farm', 'Farm', 'កសិកម្ម', '务农', '농업', '農業'),
  q('own_business', 'Own business', 'អាជីវកម្មផ្ទាល់ខ្លួន', '自己做生意', '자영업', '自営業'),
  q('stay_home', 'Stay home', 'នៅផ្ទះ', '居家', '집에서 지내요', '家にいます'),
  q('time_off', 'Taking some time off', 'កំពុងសម្រាកពីការងារមួយរយៈ', '暂时休息中', '잠시 쉬는 중', '少しお休み中'),
  q('family_home', 'Family time or Home business', 'ពេលវេលាជាមួយគ្រួសារ ឬអាជីវកម្មនៅផ្ទះ', '陪伴家人或居家生意',
    '가족과의 시간 또는 재택 사업', '家族との時間・在宅ビジネス'),
];

const pickLang = (text, lang) => text[lang] || text.en;

// Localized text of a system question (a retired one too, for sets sent with it), or null for an unknown
// level/key (unknown lang → English).
export function questionText(level, key, lang) {
  const found = [...(SYSTEM_QUESTIONS[level] || []), ...(RETIRED_QUESTIONS[level] || [])].find((item) => item.key === key);
  return found ? pickLang(found.text, lang) : null;
}

// Localized text of a Level 1 answer option, or null for an unknown key.
// No longer offered (Gamini 2026-10-13), but answers already given with it still read back.
const RETIRED_L1_ANSWERS = [q('ok', 'OK', 'ធម្មតា', '还好', '괜찮아요', 'まあまあ')];

export function answerText(key, lang) {
  const found = [...L1_ANSWERS, ...RETIRED_L1_ANSWERS].find((item) => item.key === key);
  return found ? pickLang(found.text, lang) : null;
}
