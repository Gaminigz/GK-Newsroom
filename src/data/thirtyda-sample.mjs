// Sample data for the 30+DA super admin web (design A2 · "SAMPLE DATA").
// Seeded into the thirtyda_* collections on first use, until the real app writes there.

const USERS = [
  ['U-10231', 'Sophea', 3, 'Khmer', 'BKK1', 'online'],
  ['U-10232', 'Dara', 3, 'English', 'Toul Kork', 'online'],
  ['U-10418', 'Visal', 2, 'Khmer', 'Chamkar Mon', 'online'],
  ['U-10644', 'Mei', 2, 'Chinese', 'BKK3', 'offline'],
  ['U-10507', 'Tom', 1, 'English', 'Daun Penh', 'idle'],
  ['U-10702', 'Anna', 1, 'English', 'Russey Keo', 'online'],
  ['U-10611', 'Chen', 3, 'Chinese', 'Sen Sok', 'online'],
  ['U-10735', 'Lina', 3, 'Khmer', '7 Makara', 'online'],
  ['U-10790', 'Ji-ho', 2, 'Korean', 'BKK1', 'online'],
  ['U-10812', 'Yuki', 1, 'Japanese', 'Tonle Bassac', 'idle'],
  ['U-10377', 'Rotha', 1, 'Khmer', 'Mean Chey', 'offline', true],
];

// Levels: 1 = question, 2 = answer, 3 = chat.
const LEVEL_NAMES = { 1: 'question', 2: 'answer', 3: 'chat' };

// A message: [fromId, minutesAgo, original, english?, hit?]
// `hit` is the part the rule caught — shown in red.
const CHATS = [
  {
    id: 'c1', a: 'U-10644', b: 'U-10418', level: 2,
    messages: [
      ['U-10644', 9, '你周末喜欢做什么？', 'What do you like to do at the weekend?'],
      ['U-10418', 4, 'ខ្ញុំចូលចិត្តដើរលេងតាមមាត់ទន្លេ។', 'I like walking by the river.'],
      ['U-10418', 2, 'បន្ថែមខ្ញុំនៅ Telegram @visal88', 'Add me on Telegram @visal88', 'Telegram @visal88', 'f1'],
    ],
  },
  {
    id: 'c2', a: 'U-10507', b: 'U-10702', level: 1,
    messages: [
      ['U-10507', 16, 'Hi Anna, are you new in Phnom Penh too?'],
      ['U-10507', 14, 'Can I call you? 012 88 77 66', null, '012 88 77 66', 'f2'],
    ],
  },
  {
    id: 'c3', a: 'U-10735', b: 'U-10611', level: 3,
    messages: [
      // Level 3 lines are 20–30 characters, as the app enforces.
      ['U-10735', 40, 'តើអ្នកចូលចិត្តកាហ្វេដែរទេ?', 'Do you like coffee too?'],
      ['U-10611', 38, '喜欢，我每天早上都喝。', 'Yes, I drink it every morning.'],
      ['U-10735', 30, 'ខ្ញុំក៏ដូចគ្នា រាល់ថ្ងៃ។ ខ្ញុំអាយុ ៤៦ ឆ្នាំ។', 'Me too, every day. I am 46.'],
      ['U-10611', 25, '你太老了，不适合用这个应用。', 'You are too old to use this app.', '你太老了，不适合用这个应用。', 'f3'],
    ],
  },
  {
    id: 'c4', a: 'U-10507', b: 'U-10812', level: 1,
    messages: [
      ['U-10507', 41, 'Email me at tom.k88@mail.com', null, 'tom.k88@mail.com', 'f4'],
    ],
  },
  { id: 'c5', a: 'U-10231', b: 'U-10232', level: 3, messages: [] },
];

// kind: 'stopped' = the app caught it before sending; 'reported' = delivered, then the other user reported it.
const FLAGS = [
  { id: 'f1', chatId: 'c1', from: 'U-10418', to: 'U-10644', minutesAgo: 2, reason: 'Chat handle shared', kind: 'stopped' },
  { id: 'f2', chatId: 'c2', from: 'U-10507', to: 'U-10702', minutesAgo: 14, reason: 'Phone number shared', kind: 'stopped' },
  { id: 'f3', chatId: 'c3', from: 'U-10611', to: 'U-10735', minutesAgo: 25, reason: 'Reported by Lina · rude message', kind: 'reported' },
  { id: 'f4', chatId: 'c4', from: 'U-10507', to: 'U-10812', minutesAgo: 41, reason: 'Email address shared', kind: 'stopped' },
];

export function makeState(now = Date.now()) {
  const ago = (m) => new Date(now - m * 60000).toISOString();
  return {
    levelNames: LEVEL_NAMES,
    users: USERS.map(([id, name, level, language, area, presence, blocked = false]) => ({
      id, name, level, language, area, presence, blocked, blockResolved: [],
    })),
    chats: CHATS.map((c) => ({
      ...c,
      messages: c.messages.map(([from, m, text, english = null, hit = null, flagId = null]) => ({
        from, at: ago(m), text, english, hit, flagId,
      })),
    })),
    flags: FLAGS.map(({ minutesAgo, ...f }) => ({ ...f, at: ago(minutesAgo), status: 'open', warned: false })),
  };
}
