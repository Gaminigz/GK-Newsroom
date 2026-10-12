// Screens 7 + 10 · Wait for Level 2 / Level 3 — navy top half with the three level steps and a live
// countdown to the server's l2OpensAt / l3OpensAt; white bottom with the Level 1 recap (or what
// changes at Level 3), the answers that came back, and "Remind me". At zero the level opens in place.
import {
  screen, el, icon, t, go, api, toast, state, countdown, pairRoute, errorText, registerStrings,
} from '../core.js';
import { enc, personPath, levelParam, redirected, myLang } from './level-ask.js';

const RETRY_MS = [1500, 2000, 3000, 5000, 10000]; // server not open yet at zero (clock skew): ask again

/** 'waiting' (countdown), 'open' (the level just opened) or null (this screen does not apply). */
function phaseOf(pair, level) {
  if (!pair || pair.next === 'frozen') return null;
  if (pair.stage === (level === 2 ? 'l2_wait' : 'l3_wait')) return 'waiting';
  if (level === 2 && pair.stage === 'l2_open' && !pair.myOutgoing?.sent) return 'open';
  if (level === 3 && pair.stage === 'l3_open') return 'open';
  return null;
}

const opensAt = (pair, level) => (level === 2 ? pair.l2OpensAt : pair.l3OpensAt);

function notificationState() {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

// Must run inside the tap (user activation), before any await. Older Safari takes a callback
// and returns nothing, so the answer is always re-read from Notification.permission.
function askNotifications() {
  if (notificationState() !== 'default') return Promise.resolve(notificationState());
  return new Promise((resolve) => {
    const finish = () => resolve(notificationState());
    try {
      const p = Notification.requestPermission(finish);
      if (p && typeof p.then === 'function') p.then(finish, finish);
    } catch {
      finish();
    }
  });
}

function steps(level, phase) {
  const step = (cls, iconName, caption) => el('li', { class: ['step', cls] },
    el('span', { class: 'step-dot', 'aria-hidden': 'true' }, icon(iconName, 18)),
    el('span', { class: 'label' }, caption));
  const open = phase === 'open';
  const current = step('next', open ? (level === 3 ? 'chat' : 'question') : 'clock',
    t(open ? 'lw_step_open' : 'lw_step_next', { n: level }));
  return el('ol', { class: 'steps', style: { marginTop: '24px' } },
    step('done', 'check', t('lw_step_done', { n: 1 })),
    level === 2 ? current : step('done', 'check', t('lw_step_done', { n: 2 })),
    level === 2 ? step('', 'lock', t('lw_step', { n: 3 })) : current);
}

/** Written in another language and no translation stored yet (provider down): show the original with a note. */
const untranslated = (x) => Boolean(!x.translated && x.originalLang && x.originalLang !== myLang());
const noTranslation = () => el('span', { class: 'trans' }, t('lw_no_translation'));

/** One answer: an L1 option chip, or L2 words as "original / translation". */
function answerNode(a, level) {
  if (level === 1) return el('span', { class: 'chip chip-sm chip-navy', style: { alignSelf: 'flex-start' } }, a.text || a.original || '');
  const translated = a.translated && a.original && a.original !== a.text;
  return el('div', { class: 'bubble theirs' },
    el('span', { class: 'orig', lang: a.originalLang || null }, translated ? a.original : a.text),
    translated ? el('span', { class: 'trans' }, a.text) : untranslated(a) ? noTranslation() : null);
}

/** "See the answers" link + the folded list of questions with their answers. */
function answersFold(set, caption) {
  if (!set?.answers?.length) return null;
  const byN = new Map(set.answers.map((a) => [a.n, a]));
  const list = el('div', { class: 'stack', style: { '--gap': '14px', marginTop: '14px' }, hidden: true },
    el('span', { class: 'label ink' }, caption),
    el('ol', { class: 'stack', style: { '--gap': '14px' } }, [...set.questions].sort((x, y) => x.n - y.n).map((q) => {
      const a = byN.get(q.n);
      const raw = q.source === 'written' && untranslated(q);
      return el('li', { class: 'stack', style: { '--gap': '6px' } },
        el('span', { class: 'qorig' }, `${q.n} · `, el('span', { lang: raw ? q.originalLang : null }, q.text)),
        raw ? el('span', { class: 'qorig' }, t('lw_no_translation')) : null,
        a ? answerNode(a, set.level) : null);
    })));
  const toggle = el('button', { type: 'button', class: 'link', 'aria-expanded': 'false', style: { fontSize: '13.5px' } }, t('lw_see_answers'));
  toggle.addEventListener('click', () => {
    list.hidden = !list.hidden;
    toggle.setAttribute('aria-expanded', String(!list.hidden));
    toggle.textContent = t(list.hidden ? 'lw_see_answers' : 'lw_hide_answers');
  });
  return el('div', { style: { marginTop: '12px' } }, toggle, list);
}

screen('/wait/:pairId/:level', async ({ params, root }) => {
  const level = levelParam(params.level, [2, 3]);
  if (!level) {
    go('/nearby', { replace: true });
    return;
  }
  root.classList.add('level', 'level-wait');
  root.append(el('p', { class: 'loading' }, t('core_loading')));

  let { pair } = await api.get(`/pairs/${enc(params.pairId)}`);
  if (!root.isConnected) return;
  let phase = phaseOf(pair, level);
  if (!phase) {
    go(pair.next === 'wait_timer' ? pairRoute(pair) : personPath(pair), { replace: true });
    return;
  }

  // The answers that came back: L1 for whoever asked (or my own answers), my L2 questions at Level 3.
  const recapPath = level === 2
    ? `/pairs/${enc(pair.id)}/${pair.role === 'a' ? 'outgoing' : 'incoming'}?level=1`
    : `/pairs/${enc(pair.id)}/outgoing?level=2`;
  const recap = await api.get(recapPath, { redirect: false }).then((r) => r.set, () => null);
  if (!root.isConnected) return;

  const name = pair.other.name;
  const timers = new Set();
  let stopClock = null;
  let dead = false;
  let remindBusy = false;
  let permission = notificationState();

  const later = (fn, ms) => {
    const id = setTimeout(() => { timers.delete(id); if (!dead) fn(); }, ms);
    timers.add(id);
  };

  const clock = el('div', { class: 'countdown', role: 'timer', 'aria-live': 'off' }, '--:--:--');
  const top = el('section', { class: 'panel-dark dark' });
  const action = el('div', { class: 'stack', style: { '--gap': '10px' } });
  const remindBtn = el('button', { type: 'button', class: 'btn btn-secondary', on: { click: () => toggleRemind() } });

  function paintTop() {
    const open = phase === 'open';
    top.replaceChildren(
      el('header', { class: 'brandbar' },
        el('div', { class: 'row', style: { '--gap': '12px' } },
          el('button', { type: 'button', class: 'icon-btn', 'aria-label': t('core_close'), on: { click: () => go(personPath(pair)) } }, icon('close', 18)),
          el('span', { class: 'wordmark brand' }, '30+DA')),
        el('span', { class: 'label ink' }, t('lw_done', { n: level - 1 }))),
      steps(level, phase),
      el('div', { class: 'stack', style: { '--gap': '10px', alignItems: 'center', textAlign: 'center', marginTop: '30px' } },
        open
          ? el('h1', { class: 'display', style: { fontSize: '34px' } }, t(`lw_is_open_${level}`))
          : [el('span', { class: 'label' }, t('lw_opens_in', { n: level })), clock]),
      el('p', { class: 'muted', style: { marginTop: '18px', textAlign: 'center', lineHeight: '1.55' } }, t(`lw_text_${level}`, { name })));
  }

  function remindLabel() {
    const hours = Math.round((Date.parse(opensAt(pair, level)) - Date.now()) / 36e5);
    if (hours >= 2) return t('lw_remind_hours', { n: hours });
    if (hours === 1) return t('lw_remind_hour');
    return t('lw_remind_soon');
  }

  function paintAction() {
    if (phase === 'open') {
      const start = el('button', { type: 'button', class: 'btn btn-primary', on: { click: openNext } },
        el('span', { class: 'btn-text' }, t(level === 2 ? 'lw_start_2' : 'lw_open_chat')), icon('arrow', 18));
      const phoneNote = level === 3 && !state.me?.verified?.phone
        ? el('p', { class: 'lock-note' }, icon('lock', 14), el('span', {}, t('lw_phone_needed')),
          el('button', { type: 'button', class: 'link', on: { click: () => go('/me') } }, t('lw_verify')))
        : null;
      action.replaceChildren(...[start, phoneNote].filter(Boolean));
      return;
    }
    // The same button node is kept so keyboard focus survives the toggle.
    const on = Boolean(pair.remind);
    remindBtn.disabled = remindBusy;
    remindBtn.setAttribute('aria-pressed', String(on));
    remindBtn.replaceChildren(icon(on ? 'check' : 'bell', 18), el('span', { class: 'btn-text' }, on ? t('lw_remind_on') : remindLabel()));
    const notes = on
      ? [t(`lw_remind_note_${level}`), permission === 'granted' ? null : t('lw_notify_off')].filter(Boolean)
      : [];
    action.replaceChildren(remindBtn, ...notes.map((n) => el('p', { class: 'help', style: { textAlign: 'center' } }, n)));
  }

  function toggleRemind() {
    if (remindBusy) return;
    const on = !pair.remind;
    remindBusy = true;
    paintAction();
    const asked = on ? askNotifications() : Promise.resolve(permission);
    asked.then(async (p) => {
      permission = p;
      try {
        const r = await api.post(`/pairs/${enc(pair.id)}/remind`, { on });
        pair.remind = Boolean(r.pair?.remind);
      } catch (err) {
        if (!redirected(err)) toast(errorText(err));
      }
      remindBusy = false;
      if (root.isConnected) paintAction();
    });
  }

  function openNext() {
    if (level === 3) go(`/chat/${enc(pair.id)}`);
    else go(pair.next === 'wait_timer' ? `/ask/${enc(pair.id)}/2` : pairRoute(pair));
  }

  function notifyOpen() {
    if (!pair.remind || !document.hidden || notificationState() !== 'granted') return;
    try {
      // Same tag as app.js uses for this pair, so the two never stack.
      const n = new Notification('30+DA', { body: t(`lw_notify_${level}`, { name }), tag: `30da-${pair.id}` });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch { /* some browsers only allow notifications from a service worker */ }
  }

  function paint() {
    paintTop();
    paintAction();
  }

  function startClock() {
    stopClock?.();
    stopClock = countdown(clock, opensAt(pair, level), () => check(0));
  }

  // At zero the server opens the level on its next read; until it agrees, keep asking.
  async function check(attempt) {
    if (dead) return;
    try {
      const r = await api.get(`/pairs/${enc(pair.id)}`);
      if (dead || !root.isConnected) return;
      pair = r.pair;
      const now = phaseOf(pair, level);
      if (now === 'open') {
        phase = 'open';
        paint();
        notifyOpen();
        return;
      }
      if (now !== 'waiting') {
        go(personPath(pair), { replace: true });
        return;
      }
      if (Date.parse(opensAt(pair, level)) - Date.now() > 2000) {
        startClock(); // the opening time moved
        return;
      }
    } catch (err) {
      if (redirected(err) || err.status === 404) return;
    }
    later(() => check(attempt + 1), RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]);
  }

  // --- bottom half
  const recapCard = level === 2
    ? (() => {
      const { answered = 0, total = 5 } = pair.recap?.l1 || {};
      return el('section', { class: 'card' },
        el('div', { class: 'card-row' },
          el('div', { class: 'stack', style: { '--gap': '4px' } },
            el('span', { class: 'label' }, t('lw_recap_1')),
            el('strong', { style: { fontSize: '16px' } }, answered >= total ? t('lw_all_answered') : t('lw_some_answered', { a: answered, total }))),
          el('span', { class: 'pill pill-navy' }, icon('check', 14), `${answered}/${total}`)),
        answersFold(recap, pair.role === 'a' ? t('lw_their_answers', { name }) : t('lw_your_answers', { name })));
    })()
    : el('section', { class: 'card' },
      el('span', { class: 'label' }, t('lw_changes')),
      el('ul', { class: 'check-list', style: { marginTop: '12px' } },
        el('li', { class: 'yes' }, icon('check', 18), el('span', {}, t('lw_change_chat', { name }))),
        el('li', { class: 'no' }, icon('close', 18), el('span', {}, t('lw_change_contact'))),
        el('li', { class: 'no' }, icon('close', 18), el('span', {}, t('lw_change_media')))));

  const l2Answers = level === 3 && recap?.answers?.length
    ? el('section', { class: 'card fill' },
      el('span', { class: 'label' }, t('lw_level2_answers')),
      answersFold(recap, t('lw_their_answers', { name })))
    : null;

  root.replaceChildren(...[
    top,
    el('div', { class: 'stack', style: { '--gap': '14px', marginTop: '22px' } }, ...[recapCard, action, l2Answers].filter(Boolean)),
  ]);
  paint();
  if (phase === 'waiting') startClock();

  return () => {
    dead = true;
    stopClock?.();
    timers.forEach(clearTimeout);
  };
});

registerStrings({
  en: {
    lw_done: 'Level {n} done',
    lw_step_done: 'Level {n} · Done',
    lw_step_next: 'Level {n} · Next',
    lw_step_open: 'Level {n} · Open',
    lw_step: 'Level {n}',
    lw_opens_in: 'Level {n} opens in',
    lw_is_open_2: 'Level 2 is open',
    lw_is_open_3: 'Level 3 is open',
    lw_text_2: 'You and {name} finished Level 1. In Level 2 you each pick 2 questions, write 3 of your own, and answer in your own words.',
    lw_text_3: 'You and {name} answered all 5 Level 2 questions. Next, your chat opens.',
    lw_recap_1: 'Level 1 recap',
    lw_all_answered: 'All 5 questions answered',
    lw_some_answered: '{a} of {total} questions answered',
    lw_changes: 'What changes at Level 3',
    lw_change_chat: 'Text chat with {name} opens',
    lw_change_contact: 'Phone numbers and chat handles are still not allowed',
    lw_change_media: 'No photos, voice or video. We strongly advise keeping it to text.',
    lw_level2_answers: 'Level 2 answers',
    lw_remind_hours: 'Remind me in {n} hours',
    lw_remind_hour: 'Remind me in 1 hour',
    lw_remind_soon: 'Remind me when it opens',
    lw_remind_on: 'Reminder on',
    lw_remind_note_2: 'We will remind you when Level 2 opens.',
    lw_remind_note_3: 'We will remind you when your chat opens.',
    lw_notify_off: 'Notifications are off in this browser, so you will see it here in the app.',
    lw_start_2: 'Start Level 2',
    lw_open_chat: 'Open chat',
    lw_see_answers: 'See the answers',
    lw_hide_answers: 'Hide the answers',
    lw_no_translation: 'Translation not available yet.',
    lw_their_answers: '{name}’s answers',
    lw_your_answers: 'Your answers to {name}',
    lw_notify_2: 'Level 2 with {name} is open.',
    lw_notify_3: 'Your chat with {name} is open.',
    lw_phone_needed: 'Verify your phone number to chat.',
    lw_verify: 'Verify now',
  },
  km: {
    lw_done: 'កម្រិត {n} រួចរាល់',
    lw_step_done: 'កម្រិត {n} · រួចរាល់',
    lw_step_next: 'កម្រិត {n} · បន្ទាប់',
    lw_step_open: 'កម្រិត {n} · បានបើក',
    lw_step: 'កម្រិត {n}',
    lw_opens_in: 'កម្រិត {n} នឹងបើកក្នុងរយៈពេល',
    lw_is_open_2: 'កម្រិត 2 បានបើកហើយ',
    lw_is_open_3: 'កម្រិត 3 បានបើកហើយ',
    lw_text_2: 'អ្នក និង {name} បានបញ្ចប់កម្រិត 1។ នៅកម្រិត 2 អ្នកម្នាក់ៗជ្រើសសំណួរ 2 សរសេរសំណួរផ្ទាល់ខ្លួន 3 ហើយឆ្លើយតាមពាក្យរបស់អ្នកផ្ទាល់។',
    lw_text_3: 'អ្នក និង {name} បានឆ្លើយសំណួរកម្រិត 2 ទាំង 5 រួចហើយ។ បន្ទាប់មក ការជជែករបស់អ្នកនឹងបើក។',
    lw_recap_1: 'សង្ខេបកម្រិត 1',
    lw_all_answered: 'បានឆ្លើយសំណួរទាំង 5',
    lw_some_answered: 'បានឆ្លើយ {a} ក្នុងចំណោម {total} សំណួរ',
    lw_changes: 'អ្វីដែលផ្លាស់ប្ដូរនៅកម្រិត 3',
    lw_change_chat: 'ការជជែកជាអក្សរជាមួយ {name} នឹងបើក',
    lw_change_contact: 'លេខទូរស័ព្ទ និងឈ្មោះគណនីជជែក នៅតែមិនត្រូវបានអនុញ្ញាត',
    lw_change_media: 'គ្មានរូបថត សំឡេង ឬវីដេអូទេ។ យើងសូមណែនាំយ៉ាងមុតមាំឲ្យប្រើតែអក្សរប៉ុណ្ណោះ។',
    lw_level2_answers: 'ចម្លើយកម្រិត 2',
    lw_remind_hours: 'រំលឹកខ្ញុំក្នុងរយៈពេល {n} ម៉ោង',
    lw_remind_hour: 'រំលឹកខ្ញុំក្នុងរយៈពេល 1 ម៉ោង',
    lw_remind_soon: 'រំលឹកខ្ញុំនៅពេលវាបើក',
    lw_remind_on: 'ការរំលឹកបានបើក',
    lw_remind_note_2: 'យើងនឹងរំលឹកអ្នក នៅពេលកម្រិត 2 បើក។',
    lw_remind_note_3: 'យើងនឹងរំលឹកអ្នក នៅពេលការជជែករបស់អ្នកបើក។',
    lw_notify_off: 'ការជូនដំណឹងត្រូវបានបិទនៅក្នុងកម្មវិធីរុករកនេះ ដូច្នេះអ្នកនឹងឃើញវានៅទីនេះក្នុងកម្មវិធី។',
    lw_start_2: 'ចាប់ផ្ដើមកម្រិត 2',
    lw_open_chat: 'បើកការជជែក',
    lw_see_answers: 'មើលចម្លើយ',
    lw_hide_answers: 'លាក់ចម្លើយ',
    lw_no_translation: 'មិនទាន់មានការបកប្រែនៅឡើយទេ។',
    lw_their_answers: 'ចម្លើយរបស់ {name}',
    lw_your_answers: 'ចម្លើយរបស់អ្នកទៅ {name}',
    lw_notify_2: 'កម្រិត 2 ជាមួយ {name} បានបើកហើយ។',
    lw_notify_3: 'ការជជែករបស់អ្នកជាមួយ {name} បានបើកហើយ។',
    lw_phone_needed: 'សូមផ្ទៀងផ្ទាត់លេខទូរស័ព្ទ ដើម្បីជជែក។',
    lw_verify: 'ផ្ទៀងផ្ទាត់ឥឡូវនេះ',
  },
  zh: {
    lw_done: '等级 {n} 完成',
    lw_step_done: '等级 {n} · 完成',
    lw_step_next: '等级 {n} · 下一步',
    lw_step_open: '等级 {n} · 已开启',
    lw_step: '等级 {n}',
    lw_opens_in: '距离等级 {n} 开启还有',
    lw_is_open_2: '等级 2 已开启',
    lw_is_open_3: '等级 3 已开启',
    lw_text_2: '你和 {name} 完成了等级 1。在等级 2，你们各自选 2 个问题、自己写 3 个问题，并用自己的话回答。',
    lw_text_3: '你和 {name} 已回答完等级 2 的全部 5 个问题。接下来，你们的聊天将会开启。',
    lw_recap_1: '等级 1 回顾',
    lw_all_answered: '5 个问题全部已回答',
    lw_some_answered: '已回答 {a}/{total} 个问题',
    lw_changes: '等级 3 有什么不同',
    lw_change_chat: '开启和 {name} 的文字聊天',
    lw_change_contact: '仍然不能留电话号码或聊天账号',
    lw_change_media: '不能发照片、语音或视频。我们强烈建议只用文字交流。',
    lw_level2_answers: '等级 2 的回答',
    lw_remind_hours: '{n} 小时后提醒我',
    lw_remind_hour: '1 小时后提醒我',
    lw_remind_soon: '开启时提醒我',
    lw_remind_on: '提醒已开启',
    lw_remind_note_2: '等级 2 开启时我们会提醒你。',
    lw_remind_note_3: '聊天开启时我们会提醒你。',
    lw_notify_off: '此浏览器已关闭通知，你可以在应用里看到提醒。',
    lw_start_2: '开始等级 2',
    lw_open_chat: '打开聊天',
    lw_see_answers: '查看回答',
    lw_hide_answers: '收起回答',
    lw_no_translation: '暂时还没有翻译。',
    lw_their_answers: '{name} 的回答',
    lw_your_answers: '你给 {name} 的回答',
    lw_notify_2: '你和 {name} 的等级 2 已开启。',
    lw_notify_3: '你和 {name} 的聊天已开启。',
    lw_phone_needed: '请先验证手机号才能聊天。',
    lw_verify: '立即验证',
  },
  ko: {
    lw_done: '레벨 {n} 완료',
    lw_step_done: '레벨 {n} · 완료',
    lw_step_next: '레벨 {n} · 다음',
    lw_step_open: '레벨 {n} · 열림',
    lw_step: '레벨 {n}',
    lw_opens_in: '레벨 {n}까지 남은 시간',
    lw_is_open_2: '레벨 2가 열렸어요',
    lw_is_open_3: '레벨 3이 열렸어요',
    lw_text_2: '{name}님과 레벨 1을 마쳤어요. 레벨 2에서는 각자 질문 2개를 고르고, 3개를 직접 쓰고, 자기 말로 답해요.',
    lw_text_3: '{name}님과 레벨 2 질문 5개에 모두 답했어요. 다음은 채팅이 열려요.',
    lw_recap_1: '레벨 1 돌아보기',
    lw_all_answered: '질문 5개에 모두 답했어요',
    lw_some_answered: '질문 {total}개 중 {a}개에 답했어요',
    lw_changes: '레벨 3에서 달라지는 점',
    lw_change_chat: '{name}님과 텍스트 채팅이 열려요',
    lw_change_contact: '전화번호와 채팅 아이디는 여전히 안 돼요',
    lw_change_media: '사진, 음성, 영상은 안 돼요. 텍스트로만 대화하기를 강력히 권해요.',
    lw_level2_answers: '레벨 2 답변',
    lw_remind_hours: '{n}시간 후에 알려 주세요',
    lw_remind_hour: '1시간 후에 알려 주세요',
    lw_remind_soon: '열리면 알려 주세요',
    lw_remind_on: '알림 켜짐',
    lw_remind_note_2: '레벨 2가 열리면 알려 드릴게요.',
    lw_remind_note_3: '채팅이 열리면 알려 드릴게요.',
    lw_notify_off: '이 브라우저는 알림이 꺼져 있어서 앱 안에서 알려 드려요.',
    lw_start_2: '레벨 2 시작하기',
    lw_open_chat: '채팅 열기',
    lw_see_answers: '답 보기',
    lw_hide_answers: '답 숨기기',
    lw_no_translation: '아직 번역이 없어요.',
    lw_their_answers: '{name}님의 답',
    lw_your_answers: '{name}님에게 한 내 답',
    lw_notify_2: '{name}님과의 레벨 2가 열렸어요.',
    lw_notify_3: '{name}님과의 채팅이 열렸어요.',
    lw_phone_needed: '채팅하려면 전화번호를 인증해 주세요.',
    lw_verify: '지금 인증',
  },
  ja: {
    lw_done: 'レベル{n}完了',
    lw_step_done: 'レベル{n} · 完了',
    lw_step_next: 'レベル{n} · 次',
    lw_step_open: 'レベル{n} · オープン',
    lw_step: 'レベル{n}',
    lw_opens_in: 'レベル{n}まであと',
    lw_is_open_2: 'レベル2が開きました',
    lw_is_open_3: 'レベル3が開きました',
    lw_text_2: '{name}さんとレベル1を終えました。レベル2では、それぞれ質問を2つ選び、3つを自分で書いて、自分の言葉で答えます。',
    lw_text_3: '{name}さんとレベル2の質問5つにすべて答えました。次はチャットが開きます。',
    lw_recap_1: 'レベル1のふりかえり',
    lw_all_answered: '5つの質問すべてに回答済み',
    lw_some_answered: '{total}問中{a}問に回答済み',
    lw_changes: 'レベル3で変わること',
    lw_change_chat: '{name}さんとのテキストチャットが開きます',
    lw_change_contact: '電話番号やチャットIDは引き続き禁止です',
    lw_change_media: '写真・音声・ビデオは使えません。テキストだけでのやりとりを強くおすすめします。',
    lw_level2_answers: 'レベル2の回答',
    lw_remind_hours: '{n}時間後に知らせる',
    lw_remind_hour: '1時間後に知らせる',
    lw_remind_soon: '開いたら知らせる',
    lw_remind_on: 'リマインダーON',
    lw_remind_note_2: 'レベル2が開いたらお知らせします。',
    lw_remind_note_3: 'チャットが開いたらお知らせします。',
    lw_notify_off: 'このブラウザでは通知がオフのため、アプリ内でお知らせします。',
    lw_start_2: 'レベル2を始める',
    lw_open_chat: 'チャットを開く',
    lw_see_answers: '回答を見る',
    lw_hide_answers: '回答を閉じる',
    lw_no_translation: '翻訳はまだありません。',
    lw_their_answers: '{name}さんの回答',
    lw_your_answers: '{name}さんへのあなたの回答',
    lw_notify_2: '{name}さんとのレベル2が開きました。',
    lw_notify_3: '{name}さんとのチャットが開きました。',
    lw_phone_needed: 'チャットするには電話番号の確認が必要です。',
    lw_verify: '今すぐ確認',
  },
});
