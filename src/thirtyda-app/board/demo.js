/* 30+DA design board — an in-browser demo backend for ONE app screen (board/frame.html?s=1..12).
 *
 * frame.html loads this classic script BEFORE /30da/app.js. It answers every fetch('/30da/api/…')
 * from an in-memory world built for one scenario, copying the response shapes and the level state
 * machine of src/lib/thirtyda-app.mjs, and it uses the real shared modules (/30da/shared/rules.js,
 * questions.js, question-slots.js, conversation.js) for every check, line, state and translation. Nothing reaches
 * the server: no sign-up, no heartbeat, no location. localStorage is a per-frame memory copy, so the
 * twelve frames on the board never share a language or a filter. Every load starts the scenario fresh.
 *
 *   ?s=N     scenario 1–12 (SCENARIOS below)
 *   ?fast=1  the 24-hour waits last 10 seconds
 *
 * Screens 5–12 are the ONE conversation screen (#/c/P-1) in different states: Level 1 and Level 2 run both
 * ways (each person sends their own 5 and replies to the other's line by line, one tap each), after Level 2
 * each chooses "Open the chat" or "Forget it", and Level 3 is the chat with everything before it above and
 * the real names in the header. The other person is simulated: after you act they reply one line at a time,
 * send their own 5 when they have not yet, and choose to open the chat after you do.
 *
 * Photos: no real images. Single photo fields (Nearby faces, the big profile photo, PairView) are null
 * so the app draws its grey silhouette; photo LISTS (my slots, the profile strip, the chat header) are
 * silhouette drawings as data: URLs, so the 1 / 2 / 4 photo-slot rule stays visible. Picking a photo
 * (Create profile, My profile) uses a drawn demo picture instead of opening the file chooser.
 */
(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  const S = Math.min(12, Math.max(1, Number.parseInt(params.get('s'), 10) || 1));
  const FAST = params.get('fast') === '1';
  const API = '/30da/api';
  const DAY = 864e5;
  const WAIT_MS = FAST ? 10e3 : DAY - 4e3; // a wait that starts now shows ~23:59:5x
  const BOT_MS = FAST ? 1200 : 3000; // how long the other (simulated) person takes to act
  const realFetch = window.fetch.bind(window);

  const SOPHEA = 'U-10231';
  const DARA = 'U-10232';
  const PAIR = 'P-1';

  // me: whose phone this is · lang: its UI language · stage: the pair Dara ⇄ Sophea (none = no pair) ·
  // sets: what is already in the conversation, `${level}${from}` (d = Dara, s = Sophea) → how many replies it
  // has (5 = complete). Screens 5–12 all live on the conversation screen #/c/P-1.
  const CONV = `/c/${PAIR}`;
  const L1_DONE = { '1d': 5, '1s': 5 };
  const SCENARIOS = {
    1: { hash: '/opening', lang: 'en', me: null, session: false },
    2: { hash: '/create', lang: 'en', me: null, session: true },
    3: { hash: '/nearby', lang: 'en', me: DARA },
    4: { hash: `/person/${SOPHEA}`, lang: 'en', me: DARA },
    5: { hash: CONV, lang: 'en', me: DARA, stage: 'l1', sets: {} },
    6: { hash: CONV, lang: 'en', me: SOPHEA, stage: 'l1', sets: { '1d': 2 } },
    7: { hash: CONV, lang: 'en', me: DARA, stage: 'l2_wait', sets: L1_DONE, opensIn: DAY - 27e3 },
    8: { hash: CONV, lang: 'en', me: DARA, stage: 'l2_open', sets: { ...L1_DONE, '2s': 0 } },
    9: { hash: CONV, lang: 'en', me: SOPHEA, stage: 'l2_open', sets: { ...L1_DONE, '2d': 2, '2s': 3 } },
    10: { hash: CONV, lang: 'en', me: DARA, stage: 'l3_decide', sets: { ...L1_DONE, '2d': 5, '2s': 5 } },
    11: { hash: CONV, lang: 'en', me: DARA, stage: 'l3_open', sets: { ...L1_DONE, '2d': 5, '2s': 5 } },
    12: { hash: CONV, lang: 'km', me: SOPHEA, stage: 'l3_open', sets: { ...L1_DONE, '2d': 5, '2s': 5 } },
  };
  const SC = SCENARIOS[S];

  // ------------------------------------------------------------------ browser stubs (before app.js)

  // Per-frame storage: the board runs 12 copies of the app on one origin, and they must not share it.
  function memoryStorage(seed) {
    const map = new Map(Object.entries(seed));
    return {
      get length() { return map.size; },
      key: (i) => [...map.keys()][i] ?? null,
      getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
      setItem: (k, v) => { map.set(String(k), String(v)); },
      removeItem: (k) => { map.delete(String(k)); },
      clear: () => map.clear(),
    };
  }
  const seed = { thirtyda_lang: JSON.stringify(SC.lang) };
  try {
    Object.defineProperty(window, 'localStorage', { value: memoryStorage(seed), configurable: true });
  } catch {
    try { window.localStorage.setItem('thirtyda_lang', seed.thirtyda_lang); } catch { /* storage blocked: the app falls back to en */ }
  }

  // Per-frame history: the twelve frames on the board share the board tab's session history, so a real
  // pushState / back() in one phone would step a different phone back (and fill the tab's Back button).
  // In a frame, each copy keeps its own in-memory stack and only ever replaces its one history entry.
  // core.js keeps working unchanged: go() pushes { idx }, back() checks history.state.idx > 0.
  // Opened on its own (▷ Play), the real browser history stays (its Back button is that app's back).
  if (window.top !== window) {
    const replace = History.prototype.replaceState;
    const past = []; // [{ state, href }] before the current entry
    const ahead = []; // after it, for forward()
    const here = () => ({ state: history.state, href: location.href });
    /** Move n entries (negative = back) within this frame's own stack, then fire the events a real traversal fires. */
    const travel = (n) => {
      const [from, to] = n < 0 ? [past, ahead] : [ahead, past];
      if (!n || Math.abs(n) > from.length) return; // out of range: a real history does nothing either
      const oldURL = location.href;
      for (let i = 0; i < Math.abs(n); i++) {
        const entry = from.pop();
        to.push(here());
        replace.call(history, entry.state, '', entry.href);
      }
      // Asynchronous like the real one: popstate first, hashchange only when the hash moved.
      setTimeout(() => {
        window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
        if (new URL(oldURL).hash !== location.hash) {
          window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL, newURL: location.href }));
        }
      }, 0);
    };
    const own = {
      pushState(state, title, url) {
        past.push(here());
        ahead.length = 0;
        return replace.call(history, state, title, url);
      },
      back() { travel(-1); },
      forward() { travel(1); },
      go(delta = 0) {
        const n = Math.trunc(Number(delta)) || 0;
        if (n) travel(n);
        else location.reload();
      },
    };
    for (const [name, fn] of Object.entries(own)) {
      try { Object.defineProperty(history, name, { value: fn, configurable: true, writable: true }); } catch { /* keep the real one */ }
    }
  }

  // Each load starts the scenario on its own screen.
  history.replaceState(null, '', `${location.pathname}${location.search}#${SC.hash}`);

  // GPS: always BKK1, Phnom Penh, and always allowed (nothing is sent anywhere).
  const BKK1 = { latitude: 11.549, longitude: 104.928 };
  const fakeGeo = {
    getCurrentPosition(ok) {
      setTimeout(() => ok({
        coords: { ...BKK1, accuracy: 25, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
        timestamp: Date.now(),
      }), 300);
    },
    watchPosition(ok) { this.getCurrentPosition(ok); return 1; },
    clearWatch() {},
  };
  try { Object.defineProperty(navigator, 'geolocation', { value: fakeGeo, configurable: true }); } catch { /* keep the real one */ }
  const perms = navigator.permissions;
  if (perms && typeof perms.query === 'function') {
    const query = perms.query.bind(perms);
    const granted = { name: 'geolocation', state: 'granted', onchange: null, addEventListener() {}, removeEventListener() {} };
    try {
      Object.defineProperty(perms, 'query', {
        value: (d) => (d && d.name === 'geolocation' ? Promise.resolve(granted) : query(d)), configurable: true,
      });
    } catch { /* keep the real one */ }
  }

  // Photo pickers get a drawn demo picture instead of the file chooser.
  let photoCount = 0;
  function demoPhotoFile() {
    const c = document.createElement('canvas');
    c.width = 480;
    c.height = 480;
    const g = c.getContext('2d');
    const hue = [214, 262, 160, 28][photoCount++ % 4];
    const grad = g.createLinearGradient(0, 0, 0, 480);
    grad.addColorStop(0, `hsl(${hue}, 45%, 89%)`);
    grad.addColorStop(1, `hsl(${hue}, 35%, 73%)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 480, 480);
    g.fillStyle = `hsl(${hue}, 28%, 47%)`;
    g.beginPath();
    g.arc(240, 194, 88, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(60, 480);
    g.bezierCurveTo(78, 350, 150, 304, 240, 304);
    g.bezierCurveTo(330, 304, 402, 350, 420, 480);
    g.closePath();
    g.fill();
    return new Promise((resolve, reject) => c.toBlob(
      (b) => (b ? resolve(new File([b], 'demo-photo.jpg', { type: 'image/jpeg' })) : reject(new Error('no image'))),
      'image/jpeg', 0.9,
    ));
  }
  const nativeClick = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function click() {
    if (this.type !== 'file') return nativeClick.call(this);
    const input = this;
    demoPhotoFile().then((file) => {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }).catch(() => nativeClick.call(input));
    return undefined;
  };

  // ------------------------------------------------------------------ shared modules (the real ones)

  let R = null;
  const ready = Promise.all([
    import('/30da/shared/rules.js'), import('/30da/shared/questions.js'),
    import('/30da/shared/question-slots.js'), import('/30da/shared/conversation.js'),
  ]).then(([rules, questions, slots, conversation]) => {
    R = { ...rules, ...questions, ...slots, ...conversation };
    build();
  });

  // ------------------------------------------------------------------ people (design hearts)

  // [id, name, gender, lang, km from BKK1, red, orange, photos, verified (p g f), role]
  const PEOPLE = [
    [SOPHEA, 'Sophea', 'woman', 'km', 0.4, 128, 34, 4, 'pg', 'accountant'],
    [DARA, 'Dara', 'man', 'en', 0.6, 56, 12, 4, 'pf', 'own_business'],
    ['U-10233', 'Mei', 'woman', 'zh', 0.9, 92, 27, 3, 'p', 'sales'],
    ['U-10234', 'Visal', 'man', 'km', 1.2, 41, 6, 2, 'pg', 'sales'],
    ['U-10235', 'Anna', 'woman', 'en', 1.5, 213, 61, 4, 'pgf', 'time_off'],
    ['U-10236', 'Rithy', 'man', 'km', 1.9, 37, 15, 1, 'p', 'own_business'],
    ['U-10237', 'Sokha', 'man', 'km', 2.3, 64, 18, 2, 'pf', 'accountant'],
    ['U-10238', 'Chenda', 'woman', 'km', 2.6, 147, 40, 3, 'pg', 'family_home'],
    ['U-10239', 'Kosal', 'man', 'km', 3.0, 22, 9, 1, 'p', 'sales'],
    ['U-10240', 'Malis', 'woman', 'km', 3.4, 88, 25, 2, 'pf', 'own_business'],
    ['U-10241', 'Minji', 'woman', 'ko', 3.9, 175, 52, 4, 'pg', 'time_off'],
    ['U-10242', 'Piseth', 'man', 'km', 4.3, 49, 11, 1, 'p', 'accountant'],
    ['U-10243', 'Neang', 'woman', 'km', 4.8, 103, 31, 2, 'pgf', 'family_home'],
    ['U-10244', 'Vibol', 'man', 'km', 5.4, 30, 8, 1, 'pf', 'sales'],
    ['U-10245', 'Yuki', 'woman', 'ja', 5.9, 121, 38, 3, 'pg', 'own_business'],
    ['U-10246', 'Lina', 'woman', 'km', 6.5, 76, 20, 2, 'p', 'accountant'],
    ['U-10247', 'Narith', 'man', 'km', 7.2, 18, 5, 1, 'pf', 'time_off'],
    ['U-10248', 'Kanika', 'woman', 'km', 7.9, 96, 29, 2, 'pg', 'sales'],
    ['U-10249', 'Tola', 'man', 'km', 8.8, 44, 13, 1, 'p', 'own_business'],
    ['U-10250', 'Sambath', 'man', 'km', 11.8, 27, 7, 1, 'pf', 'sales'],
    ['U-10251', 'Davy', 'woman', 'km', 14.6, 69, 22, 2, 'pg', 'family_home'],
  ];
  const REAL_NAMES = { [SOPHEA]: 'Sophea Chan', [DARA]: 'Dara Sok' };
  // Ages 30–65 (stored as a birth year from Phnom Penh's year, like the seed). App names are 2–7 characters.
  const AGES = [34, 41, 36, 38, 39, 33, 44, 37, 47, 42, 35, 49, 31, 52, 40, 45, 58, 32, 43, 61, 48];
  const PHONES = { [SOPHEA]: '+85512880002', [DARA]: '+85512880001' };

  const TINTS = [['#dfe3ea', '#a9b1bf'], ['#e5e1eb', '#ada5bd'], ['#dde7e2', '#9db2a8'], ['#ece5dc', '#baa894']];
  function silhouette(i) {
    const [bg, fg] = TINTS[i % TINTS.length];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="${bg}"/>`
      + `<circle cx="20" cy="15.5" r="7" fill="${fg}"/><path d="M6 41c1.4-8.6 6.8-13 14-13s12.6 4.4 14 13z" fill="${fg}"/></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }

  // ------------------------------------------------------------------ texts written by Dara and Sophea

  // Written lines (original + translation; the bank covers the picked ones in all 5 languages).
  // Level 1: 4 picked + 1 written; Level 2: 3 picked + 2 written. Every reply is one tap: a picked line
  // Yes / No / Not really / Maybe, a written line Yes / No. Picked line k is one of list k's 5 choices.
  const Q_NOISY = 'l1_noisy'; // Dara's own Level 1 line reads exactly like this bank line
  const SOPHEA_L1 = { km: 'តើអ្នកចូលចិត្តផឹកកាហ្វេទេ?', en: 'Do you like coffee?' };
  const DARA_L2 = [
    { en: 'Do you like early mornings?', km: 'តើអ្នកចូលចិត្តពេលព្រឹកព្រលឹមទេ?' },
    { en: 'Will you go out this evening?', km: 'តើល្ងាចនេះអ្នកនឹងចេញទៅក្រៅទេ?' },
  ];
  const SOPHEA_L2 = [
    { km: 'តើអ្នកចូលចិត្តភ្លៀងទេ?', en: 'Do you like the rain?' },
    { km: 'តើអ្នកចូលចិត្តអានសៀវភៅទេ?', en: 'Do you like reading books?' },
  ];
  const TAP_REPLIES = ['yes', 'not_really', 'no', 'maybe', 'yes'];

  // The design's Level 3 conversation (original + translation), and what each side replies when you write.
  const CHAT = [
    { from: SOPHEA, ago: 26, lang: 'km', text: 'សួស្តី Dara! រីករាយដែលបានជជែក។', en: 'Hi Dara! Nice to finally chat.' },
    { from: DARA, ago: 25, lang: 'en', text: 'Glad we made it to Level 3!', km: 'រីករាយណាស់ដែលយើងបានដល់កម្រិត 3!' },
    { from: SOPHEA, ago: 24, lang: 'km', text: 'តើនៅកន្លែងរបស់អ្នកឥឡូវនេះនៅតែភ្លៀងទៀតទេ?', en: 'Is it still raining where you are now?' },
    { from: DARA, ago: 23, lang: 'en', text: 'It stopped. Nice and cool now.', km: 'ឈប់ហើយ។ ត្រជាក់ស្រួលណាស់។' },
  ];
  // Replies keep the real 20–30 rule (a Khmer syllable cluster counts as one character).
  const KM_LINES = [
    { km: 'ល្អណាស់! ថ្ងៃនេះអ្នកបានធ្វើអ្វីខ្លះនៅកន្លែងធ្វើការ?', en: 'Nice! What did you do at work today?' },
    { km: 'ខ្ញុំទើបតែញ៉ាំបាយល្ងាចជាមួយម្ដាយ និងប្អូនស្រីរួច។', en: 'I just had dinner with my mum and sister.' },
    { km: 'ចុងសប្ដាហ៍នេះ តើអ្នកមានគម្រោងទៅណាលេងទេ?', en: 'Any plans to go somewhere this weekend?' },
    { km: 'អរគុណដែលបានសួរ។ ថ្ងៃនេះខ្ញុំសុខសប្បាយណាស់!', en: 'Thanks for asking. I am very well today!' },
  ];
  const EN_LINES = [
    { en: 'That sounds lovely to me!', km: 'ស្តាប់ទៅល្អណាស់សម្រាប់ខ្ញុំ!' },
    { en: 'I just had dinner with family.', km: 'ខ្ញុំទើបតែញ៉ាំបាយល្ងាចជាមួយគ្រួសារ។' },
    { en: 'Any plans for this weekend?', km: 'ចុងសប្ដាហ៍នេះអ្នកមានគម្រោងអ្វីទេ?' },
    { en: 'Have a calm and easy evening.', km: 'សូមឲ្យល្ងាចនេះស្ងប់ និងស្រួល។' },
  ];

  // ------------------------------------------------------------------ the world

  const REPORT_REASONS = { rude: 'rude message', scam: 'scam or money', sexual: 'sexual message', other: 'other' };
  const ERROR_TEXT = {
    empty: 'Write something first.',
    too_short: 'Write 20 to 30 characters.',
    too_long: 'That is too long.',
    trivial: 'Say a little more than yes, ok, hi or bye.',
  };

  const W = {
    users: new Map(), session: null, pairs: [], sets: [], chats: new Map(), flags: [], otps: new Map(),
    seq: { user: 10251, pair: 0, set: 0, msg: 0, flag: 0 },
  };
  const nextId = (kind, prefix) => `${prefix}${++W.seq[kind]}`;
  const iso = (ms) => new Date(ms).toISOString();
  const nowIso = () => iso(Date.now());
  const bankTr = (fn) => Object.fromEntries(R.LANGS.map((l) => [l, fn(l) ?? null]));
  const fullTr = (tr) => Object.fromEntries(R.LANGS.map((l) => [l, tr[l] ?? null]));
  const sophLang = () => (SC.me === SOPHEA ? SC.lang : 'km');

  function seedUser([id, name, gender, lang, km, red, orange, photos, v, role], i) {
    return {
      id, name, realName: REAL_NAMES[id] || name, birthYear: R.currentYear() - AGES[i % AGES.length], role, gender, lang, phone: PHONES[id] || null,
      verified: { phone: v.includes('p'), gmail: v.includes('g'), facebook: v.includes('f') },
      photos: Array.from({ length: photos }, (_, i) => silhouette(i)), seeded: true,
      location: { lat: BKK1.latitude, lng: BKK1.longitude }, km, area: 'BKK1', city: 'Phnom Penh',
      hearts: { red, orange }, level: 1, blocked: false, notices: [],
    };
  }

  const bankQ = (level, key, n, lang) => ({
    n, source: 'system', key, slot: n, text: R.questionText(level, key, lang), lang,
    translations: bankTr((l) => R.questionText(level, key, l)),
  });
  const writtenQ = (n, tr, lang) => ({ n, source: 'written', key: null, text: tr[lang] ?? tr.en, lang, translations: fullTr(tr) });
  const tapAnswer = (n, key, lang, at) => ({ n, key, text: null, lang, translations: bankTr((l) => R.answerText(key, l)), at });

  function newSet(pairId, level, from, to, questions, sentAt) {
    const set = { id: nextId('set', 'S-'), pairId, level, from, to, questions, answers: [], sentAt, completedAt: null };
    W.sets.push(set);
    return set;
  }

  /** The admin's lists for a level (the built-in ones in the demo): [[{ key, text }] × pick]. */
  const slotsFor = (level) => R.defaultSlots(level);

  /**
   * The 5 lines a person sends at a level: Dara picks choice 1 of each list; Sophea choice 3 at Level 1
   * (choice 2 of list 1 reads like Dara's own written line) and choice 2 at Level 2.
   */
  function linesOf(user, level) {
    const lang = user.lang === 'km' ? 'km' : 'en';
    const choice = user.id === DARA ? 0 : level === 1 ? 2 : 1;
    const picks = slotsFor(level).map((list) => list[choice].key);
    const written = level === 1
      ? [user.id === DARA ? bankTr((l) => R.questionText(1, Q_NOISY, l)) : SOPHEA_L1]
      : (user.id === DARA ? DARA_L2 : SOPHEA_L2);
    return [...picks.map((k, i) => bankQ(level, k, i + 1, lang)), ...written.map((w, j) => writtenQ(picks.length + j + 1, w, lang))];
  }

  /** `user`'s tap reply to line `q` (the i-th) of a set: a written line gets Yes / No only. */
  function botReply(set, q, i, user, at) {
    const key = q.source === 'written' ? (i % 2 ? 'no' : 'yes') : TAP_REPLIES[i % TAP_REPLIES.length];
    return tapAnswer(q.n, key, user.lang, at);
  }

  /** The first `count` lines of a set get `user`'s replies; all 5 = complete. */
  function replySet(set, user, count, at) {
    set.answers = set.questions.slice(0, count).map((q, i) => botReply(set, q, i, user, at));
    if (count >= set.questions.length) set.completedAt = at;
  }

  function build() {
    PEOPLE.forEach((row, i) => W.users.set(row[0], seedUser(row, i)));
    W.users.get(SOPHEA).lang = sophLang();
    const now = Date.now();

    if (SC.stage) {
      const st = SC.stage;
      const created = now - 3 * DAY;
      const sets = SC.sets || {};
      const pair = {
        id: PAIR, key: [DARA, SOPHEA].sort().join('|'), a: DARA, b: SOPHEA, members: [DARA, SOPHEA],
        level: R.stageOpenLevel(st), stage: st, startedAt: null,
        l2OpensAt: null, l3OpensAt: null, remind: {}, opened: { [DARA]: iso(created) }, lastChat: null,
        createdAt: iso(created), updatedAt: iso(created),
      };
      W.pairs.push(pair);
      W.seq.pair = 1;
      W.chats.set(PAIR, []);

      // Level 1, then Level 2: each person's set, sent and replied to as the scenario says. Times run
      // forward from three days ago; a wait that is on now ends `opensIn` after it began.
      let t = created + 3600e3;
      const add = (level, from, to) => {
        const n = sets[`${level}${from === DARA ? 'd' : 's'}`];
        if (n === undefined) return null;
        const set = newSet(PAIR, level, from, to, linesOf(W.users.get(from), level), iso(t));
        t += 1800e3;
        if (n > 0) replySet(set, W.users.get(to), n, iso(t));
        t += 1800e3;
        pair.startedAt ??= set.sentAt;
        pair.updatedAt = iso(t);
        return set;
      };
      add(1, DARA, SOPHEA);
      add(1, SOPHEA, DARA);
      const waitEnd = (doneAt) => (SC.opensIn && FAST ? iso(now + 10e3) : iso(doneAt + DAY));
      if (st !== 'l1') {
        // Level 1 done: the wait for Level 2 began 27 s ago (screen 7), or two days ago.
        const done = st === 'l2_wait' ? now - (DAY - SC.opensIn) : now - 2 * DAY;
        pair.l2OpensAt = st === 'l2_wait' ? waitEnd(done) : iso(done + DAY);
        t = done + DAY + 3600e3;
      }
      add(2, SOPHEA, DARA);
      add(2, DARA, SOPHEA);
      if (st === 'l3_decide' || st === 'l3_open') {
        // Level 2 done 161 s ago (screen 10: both still to choose), or a day ago and both chose the chat.
        const done = st === 'l3_decide' ? now - 161e3 : now - DAY - 2 * 3600e3;
        pair.decisions = {};
        if (st === 'l3_open') {
          pair.decisions = { [SOPHEA]: { open: true, at: iso(done + 600e3) }, [DARA]: { open: true, at: iso(done + 900e3) } };
          pair.l3OpensAt = iso(done + 900e3);
        }
        pair.updatedAt = iso(done);
      }
      if (st === 'l3_open') {
        const log = W.chats.get(PAIR);
        for (const m of CHAT) {
          const tr = fullTr({ [m.lang]: m.text, en: m.en ?? (m.lang === 'en' ? m.text : null), km: m.km ?? (m.lang === 'km' ? m.text : null) });
          log.push({ id: nextId('msg', 'M-'), from: m.from, at: iso(now - m.ago * 60e3), kind: 'chat', level: 3, text: m.text, lang: m.lang, translations: tr, flagId: null, stopped: false });
        }
        const last = log[log.length - 1];
        pair.lastChat = { from: last.from, at: last.at };
        pair.updatedAt = last.at;
      }
    }

    if (SC.me) {
      const me = W.users.get(SC.me);
      me.lang = SC.lang;
      W.session = { userId: me.id, phone: me.phone, phoneVerified: true, verified: { gmail: me.verified.gmail, facebook: me.verified.facebook } };
      syncLevel(me);
      // My own photos: as many as my level allows (1 → 1, 2 → 2, 3 → 4).
      me.photos = Array.from({ length: R.photoSlotsFor(me.level) }, (_, i) => silhouette(i));
    } else if (SC.session) {
      W.session = { userId: null, phone: null, phoneVerified: false, verified: { gmail: false, facebook: false } };
    }
  }

  // ------------------------------------------------------------------ helpers copied from the server

  class Fail extends Error {
    constructor(status, code, message, extra = {}) {
      super(message);
      this.status = status;
      this.code = code;
      this.extra = extra;
    }
  }
  const fail = (status, code, message, extra) => new Fail(status, code, message, extra);
  const notYourTurn = () => fail(409, 'not_your_turn', 'It is not your turn yet.');
  const invalid = (message, extra = {}) => fail(422, 'invalid', message, extra);

  const heartsOf = (u) => ({ red: u?.hearts?.red ?? 0, orange: u?.hearts?.orange ?? 0 });
  /** Single photo fields: null for the demo people (the app draws its silhouette); a picked photo shows. */
  const mainPhoto = (u) => (u && !u.seeded ? u.photos?.[0] ?? null : null);
  const me = () => (W.session?.userId ? W.users.get(W.session.userId) ?? null : null);

  // Photo slots, as on the server: photos[i] is slot i+1 or null for an empty slot. Slots never move, so
  // removing a photo empties its slot (slot 1 = main photo, slot 2 = Level 2, slots 3–4 = Level 3).
  const slotsOf = (u) => (Array.isArray(u?.photos) ? u.photos.slice(0, R.PHOTO_MAX) : []);
  const filledCount = (u) => slotsOf(u).filter(Boolean).length;
  /** The lowest empty slot index below `limit`, or -1. */
  function emptySlot(photos, limit) {
    for (let i = 0; i < Math.min(limit, R.PHOTO_MAX); i++) if (!photos[i]) return i;
    return -1;
  }
  /** Slot-aligned urls ([url|null]) without trailing empty slots. */
  function slotUrls(u) {
    const urls = Array.from(slotsOf(u), (x) => x ?? null);
    while (urls.length && !urls.at(-1)) urls.pop();
    return urls;
  }

  function meView(u) {
    return {
      id: u.id,
      name: u.name,
      realName: u.realName ?? '',
      role: u.role ?? null,
      gender: u.gender ?? null,
      lang: u.lang ?? 'en',
      phone: u.phone ?? null,
      birthYear: Number.isInteger(u.birthYear) ? u.birthYear : null,
      verified: { phone: Boolean(u.verified?.phone), gmail: Boolean(u.verified?.gmail), facebook: Boolean(u.verified?.facebook) },
      photos: slotUrls(u),
      photoSlots: { max: R.PHOTO_MAX, allowed: R.PHOTO_MAX, levels: [...R.PHOTO_SLOT_LEVELS], filled: filledCount(u) },
      area: u.area ?? '',
      city: u.city ?? '',
      hearts: heartsOf(u),
      level: u.level ?? 1,
      blocked: Boolean(u.blocked),
    };
  }

  /** What one viewer may see of the owner's photos (slot order, empty slots skipped) and what is still locked. */
  function photosFor(owner, { isOwner = false, openLevel = 1 } = {}) {
    const photos = [];
    const lockedPhotos = [];
    if (!isOwner && owner?.blocked) return { photos, lockedPhotos };
    slotsOf(owner).forEach((url, i) => {
      if (!url) return;
      if (isOwner || R.photoVisible(i, openLevel)) photos.push(url);
      else lockedPhotos.push({ slot: i + 1, level: R.photoSlotLevel(i) });
    });
    return { photos, lockedPhotos };
  }

  const otherIdOf = (pair, u) => (pair.a === u.id ? pair.b : pair.a);
  const setsOf = (pair) => W.sets.filter((s) => s.pairId === pair.id);
  const findSet = (pair, level, from) => W.sets.find((s) => s.pairId === pair.id && s.level === level && s.from === from) ?? null;
  /** A pair nobody has sent anything in yet: only its opener sees it. */
  const isDraft = (pair) => R.convStage(pair.stage) === 'l1' && !pair.startedAt;

  function pairView(pair, u) {
    settle(pair);
    const draft = isDraft(pair);
    const role = draft || pair.a === u.id ? 'a' : 'b';
    const otherId = otherIdOf(pair, u);
    const other = W.users.get(otherId);
    const stage = R.convStage(pair.stage);
    const frozen = !other || Boolean(other.blocked);
    const lvl = R.openSetLevel(stage);
    const cur = R.currentSetLevel(stage);
    const decided = R.decisionOf(pair.decisions, u.id);
    const next = R.nextStep({ stage, mine: lvl ? findSet(pair, lvl, u.id) : null, theirs: lvl ? findSet(pair, lvl, otherId) : null, frozen, decided });
    const lastFrom = pair.lastChat ? (pair.lastChat.from === u.id ? 'me' : 'them') : null;
    const mine = cur ? findSet(pair, cur, u.id) : null;
    const theirs = cur ? findSet(pair, cur, otherId) : null;
    const replies = (level) => setsOf(pair).filter((s) => s.level === level).reduce((n, s) => n + R.repliedCount(s), 0);
    return {
      id: pair.id,
      stage,
      level: pair.level ?? R.stageOpenLevel(stage),
      role,
      other: other
        ? { id: other.id, name: other.name, gender: other.gender ?? null, lang: other.lang ?? 'en', photo: mainPhoto(other) }
        : { id: otherId, name: '', gender: null, lang: 'en', photo: null },
      l2OpensAt: pair.l2OpensAt ?? null,
      l3OpensAt: pair.l3OpensAt ?? null,
      decision: stage === 'l3_decide' || stage === 'l3_open' || stage === 'ended' ? decided : null,
      endedAt: stage === 'ended' ? pair.endedAt ?? null : null,
      remind: Boolean(pair.remind?.[u.id]),
      next,
      turn: !frozen && R.isMyTurn(next, lastFrom),
      myOutgoing: cur ? { level: cur, sent: Boolean(mine), answered: Boolean(mine?.completedAt), replied: R.repliedCount(mine), total: 5 } : null,
      myIncoming: cur ? { level: cur, received: Boolean(theirs), answered: Boolean(theirs?.completedAt), replied: R.repliedCount(theirs), total: 5 } : null,
      recap: { l1: { answered: replies(1), total: 10 }, l2: { answered: replies(2), total: 10 } },
      lastFrom,
      updatedAt: draft ? pair.opened?.[u.id] ?? pair.createdAt : pair.updatedAt,
    };
  }

  const hiddenFrom = (pair, u) => isDraft(pair) && pair.a !== u.id && !pair.opened?.[u.id];

  /** l2_wait → l2_open once its time has come (lazily, like the server); an old l3_wait → l3_decide. */
  function settle(pair) {
    const now = Date.now();
    if (pair.stage === 'l2_wait' && Date.parse(pair.l2OpensAt) <= now) {
      Object.assign(pair, { stage: 'l2_open', level: 2, updatedAt: pair.l2OpensAt });
    }
    if (pair.stage === 'l3_wait') Object.assign(pair, { stage: 'l3_decide', level: 2 });
    return pair;
  }

  /** users.level = the highest level `u` has OPENED with anyone (l2_open / l3_decide → 2, l3_open → 3, ended → 2). */
  function syncLevel(u) {
    const mine = W.pairs.filter((p) => p.members.includes(u.id)).map(settle);
    u.level = mine.reduce((m, p) => Math.max(m, p.stage === 'ended' ? 2 : R.stageOpenLevel(p.stage)), 1);
    return u;
  }

  function pairFor(u, id, { write = false } = {}) {
    const pair = W.pairs.find((p) => p.id === id && p.members.includes(u.id));
    if (!pair || hiddenFrom(pair, u)) throw fail(404, 'not_found', 'No such conversation.');
    settle(pair);
    const other = W.users.get(otherIdOf(pair, u)) ?? null;
    if (write && (!other || other.blocked)) throw fail(409, 'other_blocked', 'This conversation is closed.');
    return { pair, other };
  }

  const chatLog = (pair) => {
    if (!W.chats.has(pair.id)) W.chats.set(pair.id, []);
    return W.chats.get(pair.id);
  };

  /** A refused text: kept in the chat log as stopped (never shown) plus an open flag, like the server. */
  function recordStopped(u, pair, other, { text, level, kind, hits, reason }) {
    const flagId = nextId('flag', 'f');
    const h = hits?.[0];
    const at = nowIso();
    chatLog(pair).push({
      id: nextId('msg', 'M-'), from: u.id, at, kind, level, text, lang: u.lang, translations: { [u.lang]: text },
      hit: h ? (text.includes(h.match) ? h.match : text.slice(h.start, h.end)) : null, flagId, stopped: true,
    });
    W.flags.push({ id: flagId, chatId: pair.id, from: u.id, to: other.id, at, reason: reason || 'Contact details shared', kind: 'stopped', status: 'open' });
  }

  const plainHits = (hits) => hits.map(({ type, match, start, end }) => ({ type, match, start, end }));

  function stopContactDetails(u, pair, other, texts, opts) {
    for (let i = 0; i < texts.length; i++) {
      if (texts[i] == null) continue;
      const text = String(texts[i]).trim();
      const c = R.findContactDetails(text);
      if (c.ok) continue;
      recordStopped(u, pair, other, { text, ...opts, hits: c.hits, reason: c.reason });
      throw fail(422, 'contact_detail', c.reason || 'Contact details are not allowed.', { index: i, hits: c.hits, reason: c.reason });
    }
  }

  function stopSplitContactDetails(u, pair, other, texts, opts) {
    const used = texts.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
    if (used.length < 2) return;
    const c = R.findContactDetailsAcross(used.map((i) => texts[i]));
    if (c.ok) return;
    recordStopped(u, pair, other, { text: c.text, ...opts, hits: c.hits, reason: c.reason });
    throw fail(422, 'contact_detail', c.reason || 'Contact details are not allowed.', {
      index: used[c.hits[0].index], hits: plainHits(c.hits), reason: c.reason,
    });
  }

  function stopSplitChat(u, pair, other, text) {
    if (!text) return;
    const since = Date.now() - 10 * 60e3;
    const recent = chatLog(pair)
      .filter((m) => m.kind === 'chat' && m.from === u.id && !m.stopped && Date.parse(m.at) >= since)
      .slice(-3)
      .map((m) => m.text);
    if (!recent.length) return;
    const c = R.findContactDetailsAcross([...recent, text]);
    const offset = c.text.length - text.length;
    const hits = c.hits.filter((h) => h.lastIndex === recent.length).map((h) => {
      const start = Math.max(0, h.start - offset);
      return { type: h.type, match: text.slice(start, h.end - offset), start, end: h.end - offset };
    });
    if (!hits.length) return;
    const reason = R.CONTACT_REASONS[hits[0].type] ?? c.reason;
    recordStopped(u, pair, other, { text, level: 3, kind: 'chat', hits, reason });
    throw fail(422, 'contact_detail', reason || 'Contact details are not allowed.', { hits, reason, count: R.charCount(text) });
  }

  const KM_DIGITS = { '០': 0, '១': 1, '២': 2, '៣': 3, '៤': 4, '៥': 5, '៦': 6, '៧': 7, '៨': 8, '៩': 9 };
  function normalizePhone(raw) {
    let s = String(raw ?? '')
      .replace(/[០-៩]/g, (c) => String(KM_DIGITS[c]))
      .replace(/[０-９＋]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[\s().-]/g, '');
    if (s.startsWith('00')) s = `+${s.slice(2)}`;
    else if (s.startsWith('0')) s = `+855${s.slice(1)}`;
    else if (!s.startsWith('+')) s = s.startsWith('855') && s.length >= 11 ? `+${s}` : `+855${s}`;
    if (!/^\+[1-9]\d{7,14}$/.test(s)) return null;
    if (s.startsWith('+855') && !/^\+855[1-9]\d{7,8}$/.test(s)) return null;
    return s;
  }

  function checkName(raw) {
    const c = R.checkAppName(raw);
    if (c.error === 'contact') throw fail(422, 'contact_detail', c.reason, { field: 'name', hits: c.hits, reason: c.reason });
    if (!c.ok) throw invalid(`Your app name needs ${R.NAME_MIN} to ${R.NAME_MAX} characters.`, { field: 'name', min: R.NAME_MIN, max: R.NAME_MAX });
    return c.name;
  }
  function checkBirth(raw) {
    const c = R.checkBirthYear(raw);
    if (c.error === 'too_young') throw fail(422, 'too_young', `30+DA is for people aged ${R.AGE_MIN} and over.`, { field: 'birthYear', minAge: R.AGE_MIN });
    if (c.error === 'missing') throw invalid('Choose your birth year.', { field: 'birthYear' });
    if (!c.ok) throw invalid('Choose your birth year from the list.', { field: 'birthYear', minAge: R.AGE_MIN, maxAge: R.AGE_MAX });
    return c.year;
  }
  const checkLang = (lang) => {
    if (!R.LANGS.includes(lang)) throw invalid('Choose one of the five languages.', { field: 'lang' });
    return lang;
  };
  const checkRole = (role) => {
    if (!R.ROLES.some((r) => r.key === role)) throw invalid('Choose what you do.', { field: 'role' });
    return role;
  };
  /** The picked photo stays in this frame as its data: URL (≤ 600 KB, like the server's limit). */
  function checkPhoto(dataUrl) {
    const m = String(dataUrl ?? '').match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/);
    if (!m) throw invalid('Add a photo (JPEG, PNG or WebP).', { field: 'photo' });
    if (Math.floor((m[2].length * 3) / 4) > 600 * 1024) throw fail(413, 'photo_too_large', 'That photo is too big. Try a smaller one.', { field: 'photo' });
    return dataUrl;
  }
  const levelParam = (v) => {
    const level = Number(v);
    if (level !== 1 && level !== 2) throw invalid('Level must be 1 or 2.', { field: 'level' });
    return level;
  };

  // ------------------------------------------------------------------ the other person (simulated)

  const later = (fn, ms) => setTimeout(() => { try { fn(); } catch (e) { console.warn('[30da demo]', e); } }, ms);

  /** A set got its last reply: when both sets of its level are complete, Level 2 waits, or (after Level 2) both choose. */
  function onSetComplete(pair, set) {
    const back = findSet(pair, set.level, set.to);
    if (!R.levelComplete(set, back)) return;
    const at = set.completedAt;
    if (set.level === 1 && R.convStage(pair.stage) === 'l1') {
      Object.assign(pair, { stage: 'l2_wait', l2OpensAt: iso(Date.now() + WAIT_MS), updatedAt: at });
    } else if (set.level === 2 && pair.stage === 'l2_open') {
      Object.assign(pair, { stage: 'l3_decide', decisions: {}, updatedAt: at });
    }
  }

  /** One reply saved into a set (replacing that line's reply); the 5th completes it. */
  function putReply(pair, set, reply) {
    set.answers = R.withReply(set.answers, reply);
    pair.updatedAt = reply.at;
    if (!set.completedAt && R.allReplied(set)) {
      set.completedAt = reply.at;
      onSetComplete(pair, set);
    }
  }

  /**
   * The other (simulated) person, one step at a time after I act: reply to the next line of my set, or
   * send their own 5 for the open level when they have not yet (after a couple of replies, so the
   * screen shows "Sophea replied 2 of 5" first).
   */
  const botTimers = new Map(); // pairId → timer
  function botTick(pair, u) {
    if (botTimers.has(pair.id)) return;
    const other = W.users.get(otherIdOf(pair, u));
    if (!other) return;
    botTimers.set(pair.id, setTimeout(() => {
      botTimers.delete(pair.id);
      try {
        settle(pair);
        // After Level 2 the other person chooses to open the chat once I have chosen it (the screen shows
        // "waiting for …" first); a "Forget it" has already ended it.
        if (pair.stage === 'l3_decide') {
          if (R.decisionOf(pair.decisions, u.id) === true) decideFor(pair, other, true);
          return;
        }
        const lvl = R.openSetLevel(pair.stage);
        if (!lvl) return;
        const mine = findSet(pair, lvl, u.id);
        const theirs = findSet(pair, lvl, other.id);
        const replied = R.repliedCount(mine);
        const at = nowIso();
        if (!theirs && (!mine || replied >= 2 || mine.completedAt)) {
          newSet(pair.id, lvl, other.id, u.id, linesOf(other, lvl), at);
          pair.updatedAt = at;
        } else if (mine && !mine.completedAt) {
          const i = mine.questions.findIndex((q) => !mine.answers.some((a) => a.n === q.n));
          if (i >= 0) putReply(pair, mine, botReply(mine, mine.questions[i], i, other, at));
        } else {
          return;
        }
        botTick(pair, u); // more to do: keep going
      } catch (e) {
        console.warn('[30da demo]', e);
      }
    }, BOT_MS));
  }

  const replies = new Map(); // pairId → how many replies so far
  function botChat(pair, u) {
    const other = W.users.get(otherIdOf(pair, u));
    if (!other) return;
    later(() => {
      if (pair.stage !== 'l3_open') return;
      const n = replies.get(pair.id) || 0;
      replies.set(pair.id, n + 1);
      const km = other.lang === 'km';
      const line = (km ? KM_LINES : EN_LINES)[n % 4];
      const lang = km ? 'km' : 'en';
      const at = nowIso();
      chatLog(pair).push({
        id: nextId('msg', 'M-'), from: other.id, at, kind: 'chat', level: 3, text: line[lang], lang,
        translations: fullTr(line), flagId: null, stopped: false,
      });
      Object.assign(pair, { updatedAt: at, lastChat: { from: other.id, at } });
    }, BOT_MS + 800);
  }

  // ------------------------------------------------------------------ handlers

  function getMe({ url }) {
    const u = me();
    if (!W.session) {
      if (url.searchParams.get('probe') === '1') return { user: null, notices: [], session: null };
      throw fail(401, 'signed_out', 'Please sign in.');
    }
    if (!u) {
      const s = W.session;
      return { user: null, notices: [], session: { phone: s.phone ?? null, phoneVerified: Boolean(s.phoneVerified), verified: s.verified ?? { gmail: false, facebook: false } } };
    }
    syncLevel(u);
    return { user: meView(u), notices: [] };
  }

  function startSession(fields) {
    const s = W.session;
    W.session = {
      userId: s?.userId ?? null,
      phone: s?.phone ?? null,
      phoneVerified: Boolean(s?.phoneVerified),
      verified: { gmail: Boolean(s?.verified?.gmail), facebook: Boolean(s?.verified?.facebook) },
      ...fields,
    };
  }

  // The server's channels (src/lib/thirtyda-code-send.mjs). The demo never delivers: every channel is
  // "not live", so it answers like the server's test mode (devCode for the "Test code" note).
  const CODE_CHANNELS = ['telegram', 'whatsapp'];

  function sendCode({ body }) {
    const phone = normalizePhone(body.phone);
    if (!phone) throw invalid('That phone number does not look right.', { field: 'phone' });
    const channel = body.channel == null || body.channel === '' ? 'telegram' : body.channel;
    if (!CODE_CHANNELS.includes(channel)) throw invalid('Choose Telegram or WhatsApp.', { field: 'channel' });
    const now = Date.now();
    const prev = W.otps.get(phone);
    if (prev && now - prev.sentAt < 30e3) {
      const resendIn = Math.max(1, Math.ceil((prev.sentAt + 30e3 - now) / 1000));
      throw fail(429, 'too_soon', `Wait ${resendIn} s before asking for a new code.`, { resendIn });
    }
    const sends = (prev?.sends || []).filter((t) => now - t < 15 * 60e3);
    if (sends.length >= 3) {
      throw fail(429, 'rate_limited', 'Too many codes for this number. Try again later.', { retryIn: Math.ceil((sends[0] + 15 * 60e3 - now) / 1000) });
    }
    const code = String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
    W.otps.set(phone, { code, sentAt: now, expires: now + 15 * 60e3, attempts: 0, sends: [...sends, now] });
    return { ok: true, phone, channel, live: false, resendIn: 30, devCode: code };
  }

  function verifyCode({ body }) {
    const phone = normalizePhone(body.phone);
    const code = String(body.code ?? '').replace(/\D/g, '');
    if (!phone || code.length !== 6) throw invalid('Enter the 6-digit code.', { field: 'code' });
    const otp = W.otps.get(phone);
    if (!otp || otp.expires <= Date.now()) throw fail(400, 'code_expired', 'That code has expired. Ask for a new one.');
    if (otp.attempts >= 5) throw fail(429, 'too_many_attempts', 'Too many tries. Ask for a new code.');
    otp.attempts += 1;
    if (otp.code !== code) throw fail(400, 'wrong_code', 'That code is not right.', { attemptsLeft: Math.max(0, 5 - otp.attempts) });
    W.otps.delete(phone);
    const current = me();
    let user = [...W.users.values()].find((x) => x.phone === phone) ?? null;
    if (!user && current) {
      current.phone = phone;
      current.verified.phone = true;
      user = current;
    } else if (user && !user.verified?.phone) {
      user.verified.phone = true;
    }
    startSession({ userId: user?.id ?? null, phone, phoneVerified: true });
    return { ok: true, existing: Boolean(user), user: user ? meView(syncLevel(user)) : null };
  }

  function verifySocial({ body }) {
    const key = { google: 'gmail', facebook: 'facebook' }[body.provider];
    if (!key) throw invalid('Choose Google or Facebook.', { field: 'provider' });
    const s = W.session;
    const verified = { gmail: Boolean(s?.verified?.gmail), facebook: Boolean(s?.verified?.facebook), [key]: true };
    const current = me();
    startSession({ verified });
    if (current) current.verified[key] = true;
    return { ok: true, verified };
  }

  function signout() {
    W.session = null;
    return { ok: true };
  }

  function createProfile({ body }) {
    if (me()) throw fail(409, 'profile_exists', 'You already have a profile.');
    const s = W.session;
    if (!s.phoneVerified && !s.verified?.gmail && !s.verified?.facebook) throw fail(403, 'not_verified', 'Verify your phone, Google or Facebook first.');
    const name = checkName(body.name);
    const birthYear = checkBirth(body.birthYear);
    const realName = String(body.realName ?? '').trim().replace(/\s+/g, ' ');
    if (R.charCount(realName) < 2 || R.charCount(realName) > 60) throw invalid('Write your first and last name.', { field: 'realName' });
    const role = checkRole(body.role);
    if (!['man', 'woman', 'other'].includes(body.gender)) throw invalid('Choose male, female or other.', { field: 'gender' });
    const lang = checkLang(body.lang);
    const phone = s.phoneVerified ? s.phone : null;
    if (phone && [...W.users.values()].some((x) => x.phone === phone)) throw fail(409, 'phone_in_use', 'This phone number already has a profile.');
    const photo = checkPhoto(body.photo);
    const id = nextId('user', 'U-');
    const user = {
      id, name, realName, birthYear, role, gender: body.gender, lang, phone,
      verified: { phone: Boolean(phone), gmail: Boolean(s.verified?.gmail), facebook: Boolean(s.verified?.facebook) },
      photos: [photo], seeded: false, location: null, km: 0, area: '', city: '', hearts: { red: 0, orange: 0 },
      level: 1, blocked: false, notices: [],
    };
    W.users.set(id, user);
    s.userId = id;
    return { user: meView(user) };
  }

  function patchMe({ body }) {
    const u = me();
    const set = {};
    if (body.name !== undefined) set.name = checkName(body.name);
    if (body.lang !== undefined) set.lang = checkLang(body.lang);
    if (body.role !== undefined) set.role = checkRole(body.role);
    if (body.gender !== undefined) {
      if (!['man', 'woman', 'other'].includes(body.gender)) throw invalid('Choose male, female or other.', { field: 'gender' });
      set.gender = body.gender;
    }
    // Set once: at sign-up, or once on #/me for a profile made before it was asked.
    if (body.birthYear !== undefined) {
      if (Number.isInteger(u.birthYear)) throw fail(409, 'birth_year_set', 'Your birth year is already set.', { field: 'birthYear' });
      set.birthYear = checkBirth(body.birthYear);
    }
    if (!Object.keys(set).length) throw invalid('Nothing to change.');
    Object.assign(u, set);
    return { user: meView(u) };
  }

  /** Why a photo cannot go in slot `index` (default: the lowest empty slot): all 4 used (409) or still locked (403). */
  function photoRefusal(u, index = emptySlot(slotsOf(u), R.PHOTO_MAX)) {
    if (index < 0) return fail(409, 'too_many_photos', `You can have ${R.PHOTO_MAX} photos.`, { max: R.PHOTO_MAX });
    const needLevel = R.photoSlotLevel(index);
    return fail(403, 'photo_locked', `Photo ${index + 1} unlocks at Level ${needLevel}.`, {
      needLevel, slot: index + 1, allowed: R.photoSlotsFor(u?.level ?? 1),
    });
  }

  /** Puts `photo` in slot `index`, padding any empty slots before it with null (never a sparse array). */
  function setSlot(u, index, photo) {
    if (!Array.isArray(u.photos)) u.photos = [];
    while (u.photos.length < index) u.photos.push(null);
    u.photos[index] = photo;
  }

  /** POST /me/photos — into the lowest empty slot this person's level has unlocked. */
  function addPhoto({ body }) {
    const u = syncLevel(me());
    const slot = emptySlot(slotsOf(u), R.PHOTO_MAX);
    if (slot < 0) throw photoRefusal(u);
    setSlot(u, slot, checkPhoto(body.photo));
    return { user: meView(u) };
  }

  /** PUT /me/photos/:index — fill that slot or replace the photo in it (how the main photo changes). */
  function putPhoto({ body, params }) {
    const u = syncLevel(me());
    const index = Number(params[0]);
    if (index >= R.PHOTO_MAX) throw photoRefusal(u, index);
    if (index > 0 && !slotsOf(u)[0]) throw fail(409, 'main_first', 'Add your main photo first.');
    setSlot(u, index, checkPhoto(body.photo));
    return { user: meView(u) };
  }

  /** DELETE /me/photos/:index — empties that slot; later photos stay in their slots. Main is replaced, never removed. */
  function removePhoto({ params }) {
    const u = me();
    const index = Number(params[0]);
    const photos = slotsOf(u);
    if (!photos[index]) throw fail(404, 'not_found', 'No such photo.');
    if (index === 0) {
      throw filledCount(u) > 1
        ? fail(409, 'main_photo', 'Your main photo can be replaced, not removed.')
        : fail(409, 'last_photo', 'Keep at least one photo of your face.');
    }
    if (!photos[0]) throw fail(409, 'last_photo', 'Keep at least one photo of your face.');
    u.photos[index] = null;
    while (u.photos.length && !u.photos.at(-1)) u.photos.pop();
    return { user: meView(u) };
  }

  function setLocation({ body }) {
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw invalid('That location does not look right.', { field: 'location' });
    }
    const u = me();
    const moved = !u.location;
    Object.assign(u, { location: { lat, lng }, area: 'BKK1', city: 'Phnom Penh' });
    return { area: u.area, city: u.city, moved };
  }

  const visiblePairs = (u) => W.pairs.filter((p) => p.members.includes(u.id) && !hiddenFrom(p, u));

  function heartbeat() {
    const u = me();
    const views = visiblePairs(u).map((p) => pairView(p, u)).sort((x, y) => String(y.updatedAt).localeCompare(String(x.updatedAt)));
    const actions = views.filter((v) => v.turn);
    return { actions, notices: [] };
  }

  function nearby({ url }) {
    const u = me();
    const km = Math.min(50, Math.max(1, Number(url.searchParams.get('km')) || 10));
    const show = url.searchParams.get('show');
    const gender = show === 'women' ? 'woman' : show === 'men' ? 'man' : null;
    const base = { area: u.area ?? '', city: u.city ?? '' };
    if (!u.location) return { ...base, gps: false, count: 0, people: [] };
    const people = [...W.users.values()]
      .filter((x) => x.id !== u.id && !x.blocked && x.location && x.km <= km && (!gender || x.gender === gender))
      .sort((x, y) => x.km - y.km)
      .map((x) => ({ id: x.id, name: x.name, gender: x.gender ?? null, km: Math.max(0.1, x.km), hearts: heartsOf(x), photo: mainPhoto(x) }));
    return { ...base, gps: true, count: people.length, people };
  }

  function person({ params }) {
    const u = me();
    const x = W.users.get(params[0]);
    if (!x || (x.blocked && x.id !== u.id)) throw fail(404, 'not_found', 'This person is not here any more.');
    let pair = W.pairs.find((p) => p.members.includes(u.id) && p.members.includes(x.id)) ?? null;
    if (pair && hiddenFrom(pair, u)) pair = null;
    const view = pair && x.id !== u.id ? pairView(pair, u) : null;
    const { photos, lockedPhotos } = photosFor(x, { isOwner: x.id === u.id, openLevel: R.stageOpenLevel(view?.stage) });
    const real = view ? realNameFor(x, view.stage) : null;
    return {
      person: {
        id: x.id,
        name: x.name,
        ...(real ? { realName: real } : {}),
        gender: x.gender ?? null,
        role: x.role ?? null,
        lang: x.lang ?? 'en',
        km: x.id === u.id || !u.location || !x.location ? null : Math.max(0.1, x.km),
        area: x.area ?? '',
        hearts: heartsOf(x),
        verified: { phone: Boolean(x.verified?.phone), gmail: Boolean(x.verified?.gmail), facebook: Boolean(x.verified?.facebook) },
        photo: mainPhoto(x),
        photos,
        lockedPhotos,
      },
      pair: view,
    };
  }

  function createPair({ body }) {
    const u = me();
    const to = String(body.to ?? '');
    if (!/^U-\d+$/.test(to) || to === u.id) throw invalid('Choose someone to talk to.', { field: 'to' });
    const other = W.users.get(to);
    if (!other || other.blocked) throw fail(404, 'not_found', 'This person is not here any more.');
    const key = [u.id, to].sort().join('|');
    let pair = W.pairs.find((p) => p.key === key);
    if (!pair) {
      const at = nowIso();
      pair = {
        id: nextId('pair', 'P-'), key, a: u.id, b: to, members: [u.id, to], level: 1, stage: 'l1', startedAt: null,
        l2OpensAt: null, l3OpensAt: null, remind: {}, opened: { [u.id]: at }, lastChat: null, createdAt: at, updatedAt: at,
      };
      W.pairs.push(pair);
    }
    if (hiddenFrom(pair, u)) pair.opened[u.id] = nowIso();
    return { pair: pairView(pair, u) };
  }

  function listPairs() {
    const u = me();
    const views = visiblePairs(u).map((p) => pairView(p, u));
    views.sort((x, y) => String(y.updatedAt).localeCompare(String(x.updatedAt)));
    return { pairs: views };
  }

  function getPair({ params }) {
    const u = me();
    return { pair: pairView(pairFor(u, params[0]).pair, u) };
  }

  /** [{ n, title, options:[{ key, text }] }] in `lang`: the lists people pick from (built-in, with their topics). */
  const slotsView = (level, lang) => {
    const titles = R.defaultTitles(level);
    return slotsFor(level).map((list, i) => ({
      n: i + 1, title: titles[i] ? titles[i][lang] || titles[i].en : null,
      options: list.map((c) => ({ key: c.key, text: c.text[lang] || c.text.en })),
    }));
  };

  function questions({ url }) {
    const level = levelParam(url.searchParams.get('level'));
    const lang = me().lang ?? 'en';
    const { pick, write } = R.LEVEL_RULES[level];
    const slots = slotsView(level, lang);
    return { level, pick, write, slots, system: R.flattenSlots(slots.map((x) => x.options)) };
  }

  function sendSet(ctx) {
    const { body, params } = ctx;
    const u = me();
    const level = levelParam(body.level);
    const { pair, other } = pairFor(u, params[0], { write: true });
    // Either person sends ONE set per level, while that level is open, in any order.
    if (R.openSetLevel(pair.stage) !== level || findSet(pair, level, u.id)) throw notYourTurn();

    const list = Array.isArray(body.questions) ? body.questions : [];
    const written = list.map((q) => (q?.source === 'written' ? String(q.text ?? '').trim() : null));
    stopContactDetails(u, pair, other, written, { level, kind: 'question' });
    stopSplitContactDetails(u, pair, other, written, { level, kind: 'question' });

    const { pick, write } = R.LEVEL_RULES[level];
    if (list.length !== pick + write) throw invalid(`Send exactly ${pick + write} lines.`, { index: Math.min(list.length, pick + write - 1) });
    const slots = slotsFor(level);
    let picked = 0;
    list.forEach((q, i) => {
      if (q?.source === 'system') {
        if (picked >= pick) throw invalid(`Pick ${pick} and write ${write}.`, { index: i });
        if (!slots[picked].some((c) => c.key === q.key)) throw invalid(`Pick line ${picked + 1} from its own list.`, { index: i, slot: picked + 1 });
        picked++;
      } else if (q?.source === 'written') {
        const r = R.checkWrittenQuestion(String(q.text ?? '').trim(), level);
        if (!r.ok) throw invalid(ERROR_TEXT[r.error] || 'Check this line.', { index: i, reason: r.error });
      } else {
        throw invalid('Unknown line.', { index: i });
      }
    });
    if (picked !== pick) throw invalid(`Pick ${pick} and write ${write}.`, { index: 0 });

    const lang = u.lang ?? 'en';
    let k = 0;
    const qs = list.map((q, i) => (q.source === 'system'
      ? { ...bankQ(level, q.key, i + 1, lang), slot: ++k }
      : writtenQ(i + 1, { [lang]: String(q.text).trim() }, lang)));
    const at = nowIso();
    newSet(pair.id, level, u.id, other.id, qs, at);
    if (!pair.startedAt) Object.assign(pair, { stage: 'l1', startedAt: at, a: u.id, b: other.id, members: [u.id, other.id] });
    pair.updatedAt = at;
    botTick(pair, u);
    ctx.status = 201;
    return { pair: pairView(pair, u), conversation: conversationOf(pair, u) };
  }

  function questionView(q, level, lang) {
    if (q.source === 'system') {
      return {
        n: q.n, source: 'system', key: q.key, text: R.questionText(level, q.key, lang) ?? q.text,
        original: q.text, originalLang: q.lang, translated: q.lang !== lang,
      };
    }
    const tr = q.lang === lang ? null : q.translations?.[lang] ?? null;
    return { n: q.n, source: 'written', key: null, text: tr ?? q.text, original: q.text, originalLang: q.lang, translated: Boolean(tr) };
  }

  function answerView(a, level, lang) {
    if (level === 1 || a.key) {
      return { n: a.n, key: a.key, text: R.answerText(a.key, lang), original: R.answerText(a.key, a.lang), originalLang: a.lang };
    }
    const tr = a.lang === lang ? null : a.translations?.[lang] ?? null;
    return { n: a.n, key: null, text: tr ?? a.text, original: a.text, originalLang: a.lang, translated: Boolean(tr) };
  }

  function setFor({ url, params }, direction) {
    const u = me();
    const { pair, other } = pairFor(u, params[0]);
    const level = url.searchParams.has('level') ? levelParam(url.searchParams.get('level')) : R.currentSetLevel(pair.stage) ?? 2;
    const set = W.sets.find((s) => s.pairId === pair.id && s.level === level && (direction === 'in' ? s.to === u.id : s.from === u.id));
    if (!set) throw fail(404, 'no_set', direction === 'in' ? 'Nothing for you to reply to yet.' : 'You have not started this conversation yet.');
    const lang = u.lang ?? 'en';
    const who = (x) => (x ? { id: x.id, name: x.name, gender: x.gender ?? null } : null);
    const [from, to] = direction === 'in' ? [other, u] : [u, other];
    const answered = Boolean(set.completedAt);
    return {
      set: {
        id: set.id,
        level,
        from: who(from),
        to: who(to),
        questions: set.questions.map((q) => questionView(q, level, lang)),
        answered,
        sentAt: set.sentAt,
        completedAt: set.completedAt,
        ...(answered ? { answers: set.answers.map((a) => answerView(a, level, lang)) } : {}),
      },
    };
  }

  /** The set sent to `u` at `level` that `u` may still reply to (the level open, the set not complete). */
  function replyableSet(pair, u, level) {
    if (R.openSetLevel(pair.stage) !== level) throw notYourTurn();
    const set = W.sets.find((s) => s.pairId === pair.id && s.level === level && s.to === u.id);
    if (!set) throw fail(409, 'not_your_turn', 'There is nothing to reply to yet.');
    if (set.completedAt) throw fail(409, 'not_your_turn', 'Your replies to these lines are already sent.');
    return set;
  }

  /** POST /pairs/:id/answers — all replies at once (older screens). */
  function sendAnswers({ body, params }) {
    const u = me();
    const level = levelParam(body.level);
    const { pair, other } = pairFor(u, params[0], { write: true });
    const set = replyableSet(pair, u, level);
    const list = Array.isArray(body.answers) ? body.answers : [];
    if (list.length !== set.questions.length) throw invalid(`Reply to all ${set.questions.length}.`, { index: list.length });
    const seen = new Set();
    list.forEach((a, i) => {
      const n = Number(a?.n);
      if (!set.questions.some((q) => q.n === n) || seen.has(n)) throw invalid('Reply to each line once.', { index: i });
      seen.add(n);
      const source = set.questions.find((q) => q.n === n)?.source;
      if (!R.replyOptions(source).some((x) => x.key === a.key)) {
        throw invalid(source === 'written' ? 'Reply to the written line with Yes or No.' : 'Pick one of the replies.', { index: i });
      }
    });
    const lang = u.lang ?? 'en';
    const at = nowIso();
    for (const a of [...list].sort((x, y) => Number(x.n) - Number(y.n))) putReply(pair, set, tapAnswer(Number(a.n), a.key, lang, at));
    botTick(pair, u);
    return { pair: pairView(pair, u), conversation: conversationOf(pair, u) };
  }

  // ---------------------------------------------------------------- the conversation (as the server builds it)

  function replyView(a, level, lang) {
    if (!a) return null;
    if (level === 1 || a.key) {
      return { key: a.key ?? null, text: R.answerText(a.key, lang) ?? '', original: R.answerText(a.key, a.lang) ?? '', translated: a.lang !== lang, at: a.at ?? null };
    }
    const tr = a.lang === lang ? null : a.translations?.[lang] ?? null;
    return { key: null, text: tr ?? a.text, original: a.text, translated: Boolean(tr), at: a.at ?? null };
  }

  function setView(set, u, lang, open) {
    const level = set.level;
    const from = set.from === u.id ? 'me' : 'them';
    const lines = [...set.questions].sort((x, y) => x.n - y.n).map((q) => {
      const v = questionView(q, level, lang);
      const line = {
        n: v.n, source: v.source, topic: null, text: v.text, original: v.original, originalLang: v.originalLang, translated: v.translated,
        reply: replyView(set.answers.find((a) => a.n === q.n), level, lang),
      };
      if (from === 'them') line.options = R.replyOptions(q.source).map((o) => ({ key: o.key, text: o.text[lang] || o.text.en }));
      return line;
    });
    return {
      id: set.id, level, from, sentAt: set.sentAt, completedAt: set.completedAt ?? null,
      replied: R.repliedCount(set), total: lines.length, canReply: from === 'them' && open && !set.completedAt, lines,
    };
  }

  function conversationOf(pair, u) {
    settle(pair);
    const lang = u.lang ?? 'en';
    const otherId = otherIdOf(pair, u);
    const other = W.users.get(otherId) ?? null;
    const stage = R.convStage(pair.stage);
    const frozen = !other || Boolean(other.blocked);
    const levels = [1, 2].map((level) => {
      const state = R.levelState(level, stage);
      const view = (s) => (s ? setView(s, u, lang, state === 'open' && !frozen) : null);
      return {
        level, state, opensAt: level === 2 ? pair.l2OpensAt ?? null : null, rules: R.setRules(level),
        mine: view(findSet(pair, level, u.id)), theirs: view(findSet(pair, level, otherId)),
      };
    });
    const lvl = R.openSetLevel(stage);
    const canSend = !frozen && lvl && !findSet(pair, lvl, u.id) ? { level: lvl, ...R.setRules(lvl), slots: slotsView(lvl, lang) } : null;
    const view = pairView(pair, u);
    const seen = other ? photosFor(other, { openLevel: R.stageOpenLevel(stage) }) : { photos: [], lockedPhotos: [] };
    const real = realNameFor(other, stage);
    return {
      pair: view,
      other: other
        ? {
          id: other.id, name: other.name, gender: other.gender ?? null, lang: other.lang ?? 'en', photos: seen.photos, lockedPhotos: seen.lockedPhotos,
          ...(real ? { realName: real } : {}),
        }
        : { id: otherId, name: '', gender: null, lang: 'en', photos: [], lockedPhotos: [] },
      levels,
      canSend,
      chat: { open: stage === 'l3_open', opensAt: null, phoneNeeded: !u.verified?.phone },
      decision: { canDecide: stage === 'l3_decide' && !frozen && view.decision === null, mine: view.decision, ended: stage === 'ended', endedAt: view.endedAt },
      next: view.next,
    };
  }

  /** The other person's real name: only once the chat (Level 3) is open, never for a blocked person. */
  const realNameFor = (other, stage) => (other && !other.blocked && R.convStage(stage) === 'l3_open' && other.realName ? other.realName : null);

  /** One person's choice after Level 2 (as POST /decide on the server): both open → the chat; one forget → ended. */
  function decideFor(pair, u, open) {
    const at = nowIso();
    pair.decisions = { ...(pair.decisions || {}), [u.id]: { open, at } };
    pair.updatedAt = at;
    chatLog(pair).push({
      id: nextId('msg', 'M-'), from: u.id, at, kind: 'decision', level: 2, open,
      text: open ? 'Chose to open the chat (Level 3)' : 'Chose to forget it: the conversation ended for both', lang: 'en', flagId: null, stopped: false,
    });
    const to = R.afterDecisions(pair.decisions, pair.members);
    if (to === 'ended') Object.assign(pair, { stage: 'ended', endedAt: at, endedBy: u.id });
    else if (to === 'l3_open') Object.assign(pair, { stage: 'l3_open', level: 3, l3OpensAt: at });
  }

  /** POST /pairs/:id/decide { open } — idempotent; "open" may still turn into "forget it" while the other has not chosen. */
  function decide({ body, params }) {
    const u = me();
    if (typeof body.open !== 'boolean') throw invalid('Choose to open the chat or forget it.', { field: 'open' });
    const { pair } = pairFor(u, params[0], { write: true });
    const stage = R.convStage(pair.stage);
    const mine = R.decisionOf(pair.decisions, u.id);
    if (mine === body.open && ['l3_decide', 'l3_open', 'ended'].includes(stage)) return { conversation: conversationOf(pair, u) };
    if (stage === 'ended') throw fail(409, 'conversation_ended', 'This conversation has ended.');
    if (stage !== 'l3_decide') throw notYourTurn();
    decideFor(pair, u, body.open);
    if (body.open) botTick(pair, u);
    return { conversation: conversationOf(pair, u) };
  }

  function getConversation({ params }) {
    const u = me();
    return conversationOf(pairFor(u, params[0]).pair, u);
  }

  /** PUT /pairs/:id/replies { level, n, key } — one tap reply (both levels), changeable until all 5 are in. */
  function saveReply({ body, params }) {
    const u = me();
    const level = levelParam(body.level);
    const { pair, other } = pairFor(u, params[0], { write: true });
    const set = replyableSet(pair, u, level);
    const n = Number(body.n);
    const q = set.questions.find((x) => x.n === n);
    if (!q) throw invalid('Reply to one of the lines.', { field: 'n', n: body.n ?? null });
    if (body.key === undefined && body.text !== undefined) throw invalid('Reply with one tap.', { field: 'key', n, reason: 'taps_only' });
    if (!R.replyOptions(q.source).some((x) => x.key === body.key)) {
      throw invalid(q.source === 'written' ? 'Reply to this line with Yes or No.' : 'Pick one of the replies.', { field: 'key', n });
    }
    putReply(pair, set, tapAnswer(n, body.key, u.lang ?? 'en', nowIso()));
    botTick(pair, u);
    return { conversation: conversationOf(pair, u) };
  }

  function remind({ body, params }) {
    const u = me();
    const { pair } = pairFor(u, params[0], { write: true });
    pair.remind[u.id] = Boolean(body.on);
    return { pair: pairView(pair, u) };
  }

  function chatGate(u, pair) {
    if (pair.stage !== 'l3_open') throw fail(409, 'chat_closed', 'The chat opens at Level 3.');
    if (!u.verified?.phone) throw fail(403, 'phone_needed', 'Verify your phone number to chat.');
  }

  function listMessages({ url, params }) {
    const u = me();
    const { pair, other } = pairFor(u, params[0]);
    chatGate(u, pair);
    const after = Date.parse(url.searchParams.get('after') || '');
    const lang = u.lang ?? 'en';
    const msgs = chatLog(pair).filter((m) => m.kind === 'chat' && !m.stopped && (Number.isNaN(after) || Date.parse(m.at) > after));
    return {
      other: other
        ? {
          id: other.id, name: other.name, lang: other.lang ?? 'en', photos: photosFor(other, { openLevel: R.stageOpenLevel(pair.stage) }).photos,
          ...(realNameFor(other, pair.stage) ? { realName: realNameFor(other, pair.stage) } : {}),
        }
        : null,
      messages: msgs.map((m) => ({
        id: m.id, mine: m.from === u.id, at: m.at, text: m.text, lang: m.lang,
        translated: m.lang === lang ? null : m.translations?.[lang] ?? null,
      })),
    };
  }

  function postMessage(ctx) {
    const { body, params } = ctx;
    const u = me();
    const { pair, other } = pairFor(u, params[0], { write: true });
    chatGate(u, pair);
    const text = String(body.text ?? '').trim();
    stopContactDetails(u, pair, other, [text], { level: 3, kind: 'chat' });
    stopSplitChat(u, pair, other, text);
    const r = R.checkChatMessage(text);
    if (!r.ok) throw fail(422, r.error, ERROR_TEXT[r.error] || 'Check your message.', { hits: r.hits ?? [], reason: r.reason ?? null, count: r.count });
    const lang = u.lang ?? 'en';
    const id = nextId('msg', 'M-');
    const at = nowIso();
    chatLog(pair).push({ id, from: u.id, at, kind: 'chat', level: 3, text, lang, translations: { [lang]: text }, flagId: null, stopped: false });
    Object.assign(pair, { updatedAt: at, lastChat: { from: u.id, at } });
    botChat(pair, u);
    ctx.status = 201;
    return { message: { id, mine: true, at, text, lang, translated: null } };
  }

  function report({ body, params }) {
    const u = me();
    const label = REPORT_REASONS[body.reason];
    if (!label) throw invalid('Choose a reason.', { field: 'reason' });
    const { pair, other } = pairFor(u, params[0], { write: true });
    const m = chatLog(pair).find((x) => x.id === params[1]);
    if (!m || m.kind !== 'chat' || m.stopped || m.from !== other?.id) throw fail(404, 'not_found', 'No such message.');
    if (m.flagId) return { ok: true, already: true };
    m.flagId = nextId('flag', 'f');
    W.flags.push({ id: m.flagId, chatId: pair.id, from: other.id, to: u.id, at: nowIso(), reason: `Reported by ${u.name} · ${label}`, kind: 'reported', status: 'open' });
    return { ok: true };
  }

  // ------------------------------------------------------------------ router (same table as the server)

  const ROUTES = [
    ['POST', /^\/auth\/send-code$/, sendCode, { auth: 'none' }],
    ['POST', /^\/auth\/verify-code$/, verifyCode, { auth: 'none' }],
    ['POST', /^\/auth\/verify-social$/, verifySocial, { auth: 'none' }],
    ['POST', /^\/auth\/signout$/, signout, { auth: 'none' }],
    ['POST', /^\/profile$/, createProfile, { auth: 'session' }],
    ['GET', /^\/me$/, getMe, { auth: 'none' }],
    ['PATCH', /^\/me$/, patchMe],
    ['POST', /^\/me\/photos$/, addPhoto],
    ['PUT', /^\/me\/photos\/([0-3])$/, putPhoto],
    ['DELETE', /^\/me\/photos\/([0-3])$/, removePhoto],
    ['POST', /^\/me\/location$/, setLocation],
    ['POST', /^\/me\/heartbeat$/, heartbeat],
    ['POST', /^\/notices\/([\w-]{1,64})\/seen$/, () => ({ ok: true })],
    ['GET', /^\/nearby$/, nearby],
    ['GET', /^\/people\/(U-\d+)$/, person],
    ['POST', /^\/pairs$/, createPair],
    ['GET', /^\/pairs$/, listPairs],
    ['GET', /^\/pairs\/(P-\d+)$/, getPair],
    ['GET', /^\/pairs\/(P-\d+)\/conversation$/, getConversation],
    ['PUT', /^\/pairs\/(P-\d+)\/replies$/, saveReply],
    ['GET', /^\/questions$/, questions],
    ['POST', /^\/pairs\/(P-\d+)\/sets$/, sendSet],
    ['GET', /^\/pairs\/(P-\d+)\/incoming$/, (ctx) => setFor(ctx, 'in')],
    ['GET', /^\/pairs\/(P-\d+)\/outgoing$/, (ctx) => setFor(ctx, 'out')],
    ['POST', /^\/pairs\/(P-\d+)\/answers$/, sendAnswers],
    ['POST', /^\/pairs\/(P-\d+)\/decide$/, decide],
    ['POST', /^\/pairs\/(P-\d+)\/remind$/, remind],
    ['GET', /^\/pairs\/(P-\d+)\/messages$/, listMessages],
    ['POST', /^\/pairs\/(P-\d+)\/messages$/, postMessage],
    ['POST', /^\/pairs\/(P-\d+)\/messages\/(M-\d+)\/report$/, report],
  ];

  function route(method, url, body) {
    const sub = url.pathname.slice(API.length) || '/';
    const ctx = { url, body, status: 200, params: [] };
    let found = null;
    for (const [m, re, fn, opts = {}] of ROUTES) {
      const hit = method === m && sub.match(re);
      if (hit) { found = { fn, opts }; ctx.params = hit.slice(1); break; }
    }
    if (!found) throw fail(404, 'not_found', 'No such endpoint.');
    const auth = found.opts.auth ?? 'user';
    if (auth !== 'none' && !W.session) throw fail(401, 'signed_out', 'Please sign in.');
    if (auth === 'user' && !me()) throw fail(401, 'no_profile', 'Create your profile first.');
    const out = found.fn(ctx);
    return { status: ctx.status, out };
  }

  const json = (status, obj) => new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
  const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

  async function answer(method, url, rawBody) {
    await ready;
    let body = {};
    if (typeof rawBody === 'string' && rawBody.trim()) {
      try {
        const v = JSON.parse(rawBody);
        body = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
      } catch {
        return json(400, { error: 'bad_json', message: 'The request was not valid JSON.' });
      }
    }
    await sleep(80 + Math.random() * 140); // a phone on 4G, roughly
    try {
      const { status, out } = route(method, url, body);
      return json(status, out);
    } catch (err) {
      if (err instanceof Fail) return json(err.status, { error: err.code, message: err.message, ...err.extra });
      console.warn('[30da demo]', method, url.pathname, err);
      return json(500, { error: 'server_error', message: 'Something went wrong. Try again.' });
    }
  }

  window.fetch = function demoFetch(input, init = {}) {
    let url;
    try {
      url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.href);
    } catch {
      return realFetch(input, init);
    }
    if (url.origin !== location.origin || !(url.pathname === API || url.pathname.startsWith(`${API}/`))) return realFetch(input, init);
    const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    return answer(method, url, init.body);
  };

  // ------------------------------------------------------------------ design state: text already typed

  // Screen 5 shows Dara's own Level 1 line typed in; screen 8 his two Level 2 lines (the composer of the
  // conversation screen). Screen 9's replies so far are part of the world itself.
  const PREFILL = {
    5: { hash: `#${CONV}`, selector: '.conv-compose .qlist input.input', values: ['Is it noisy where you are?'] },
    8: { hash: `#${CONV}`, selector: '.conv-compose .qlist input.input', values: [DARA_L2[0].en, DARA_L2[1].en] },
  };
  const pre = PREFILL[S];
  if (pre) {
    const tryFill = () => {
      if (location.hash !== pre.hash) return false;
      const boxes = [...document.querySelectorAll(pre.selector)];
      if (boxes.length < pre.values.length) return false;
      pre.values.forEach((v, i) => {
        if (boxes[i].value) return;
        boxes[i].value = v;
        boxes[i].dispatchEvent(new Event('input', { bubbles: true }));
      });
      return true;
    };
    const obs = new MutationObserver(() => { if (tryFill()) obs.disconnect(); });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), 20e3); // never watch longer than the first screen
  }

  // Opened on its own (▷ Play): a small note that this is the demo, in the empty space LEFT of the 430 px
  // app column. It wraps to fit that space and is hidden when the space is too narrow, so it never covers
  // the app (a Send button, a hint) at any width.
  if (window.top === window) {
    const NOTE_GAP = 16; // from the window edge, and again from the app column
    const NOTE_MIN = 140; // narrower than this it would be a tall stack of words: hide it instead
    window.addEventListener('DOMContentLoaded', () => {
      const app = document.getElementById('app');
      if (!app) return;
      const note = document.createElement('a');
      note.href = '/30da/board/';
      // Lines break only between the · parts (no-break spaces inside each part).
      note.textContent = ['30+DA demo', `screen ${S}`, 'nothing is saved', '← all screens'].map((x) => x.replace(/ /g, '\u00a0')).join(' · ');
      note.style.cssText = `position:fixed;left:${NOTE_GAP}px;bottom:${NOTE_GAP}px;z-index:5;box-sizing:border-box;`
        + 'padding:7px 12px;border-radius:14px;background:#0b1c3f;color:#fff;'
        + 'font:600 11px/1.35 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.04em;'
        + 'text-decoration:none;opacity:.85;overflow-wrap:break-word';
      document.body.append(note);
      const place = () => {
        const room = Math.floor(app.getBoundingClientRect().left) - 2 * NOTE_GAP;
        note.style.maxWidth = `${Math.max(0, room)}px`;
        note.style.display = 'block';
        // Hidden when the gutter is too narrow, or when anything still reaches into the column.
        if (room < NOTE_MIN || note.getBoundingClientRect().right > app.getBoundingClientRect().left - NOTE_GAP) note.style.display = 'none';
      };
      place();
      window.addEventListener('resize', place);
      document.fonts?.ready.then(place, () => {});
    });
  }
})();
