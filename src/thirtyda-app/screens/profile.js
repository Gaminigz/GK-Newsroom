// Screen 4 · Profile view — verified chips, big photo, hearts, "You and Sophea · Level n/3" and one
// primary action driven by pair.next (ask / answer / wait / chat). Level 3 also shows the extra photos.
import {
  screen, el, icon, t, go, api, toast, modal, state, topBar, levelBar, avatar, countdown, pronoun, fmtKm,
  pairRoute, stageLevel, registerStrings,
} from '../core.js';

function viewPhoto(url, name) {
  const dlg = modal(el('div', { class: 'dialog-body viewer' },
    el('img', { src: url, alt: name }),
    el('button', { type: 'button', class: 'btn btn-secondary', on: { click: () => dlg.close() } }, t('core_close'))),
  { label: name });
}

function verifiedChips(v = {}) {
  const items = [['phone', t('pf_v_phone')], ['gmail', 'Gmail'], ['facebook', 'Facebook']];
  return el('div', { class: 'vchips' }, items.map(([key, label]) => {
    const on = Boolean(v[key]);
    return el('span', { class: ['vchip', on ? 'on' : 'off'] },
      on ? icon('check', 13) : null, label,
      el('span', { class: 'visually-hidden' }, on ? t('pf_verified') : t('pf_not_verified')));
  }));
}

const heartCard = (kind, count, label) => el('div', { class: ['heart-card', kind] },
  icon('heart', 22), el('span', { class: 'big' }, String(count ?? 0)), el('span', { class: 'label' }, label));

function pairError(err) {
  if (err.code === 'other_blocked' || err.code === 'not_found') return t('pf_frozen');
  return err.status === 0 ? t('err_network') : t('err_generic');
}

/** The one primary action for this pair state. `stops` collects countdown stop fns. */
function actionButton(person, pair, { reload, stops }) {
  const name = person.name;
  const pr = pronoun(person.gender);
  const primary = (label, iconName, onClick) => el('button', { type: 'button', class: 'btn btn-primary', on: { click: onClick } },
    iconName ? icon(iconName, 18) : null, el('span', {}, label), icon('arrow', 18));
  const disabled = (label, iconName) => el('button', { type: 'button', class: 'btn btn-primary', disabled: true },
    icon(iconName, 18), el('span', {}, label));
  const open = () => go(pairRoute(pair));

  if (!pair) {
    const b = el('button', { type: 'button', class: 'btn btn-primary' }, icon('question', 18), el('span', {}, t(`pf_ask_${pr}`, { name })));
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        const r = await api.post('/pairs', { to: person.id });
        go(r.pair.next === 'ask' ? `/ask/${encodeURIComponent(r.pair.id)}/1` : pairRoute(r.pair));
      } catch (err) {
        b.disabled = false;
        if (err.status !== 401 && err.code !== 'blocked') toast(pairError(err));
      }
    });
    return b;
  }

  switch (pair.next) {
    case 'ask':
      return primary(t(`pf_ask5_${pr}`, { name }), 'question', open);
    case 'answer':
      return primary(t('pf_answer', { name }), null, open);
    case 'ask_answer':
      return primary(pair.myOutgoing?.sent ? t('pf_answer', { name }) : t(`pf_ask5_${pr}`, { name }), 'question', open);
    case 'wait_them':
      return disabled(t('pf_waiting_for', { name }), 'clock');
    case 'wait_timer': {
      const lvl = stageLevel(pair);
      const until = lvl === 3 ? pair.l3OpensAt : pair.l2OpensAt;
      const [before, after = ''] = t('pf_opens_in', { n: lvl }).split('{time}');
      const time = el('span', { class: 'tabular' });
      // Re-read the pair when the timer ends, but never loop on a time that is already past.
      const future = Date.parse(until) > Date.now();
      stops.push(countdown(time, until, future ? () => setTimeout(reload, 800) : null));
      return el('button', { type: 'button', class: 'btn btn-primary', on: { click: open } },
        icon('clock', 18), el('span', {}, before, time, after));
    }
    case 'chat':
      return primary(t('pf_chat_with', { name }), 'chat', open);
    default:
      return disabled(t('pf_frozen'), 'lock');
  }
}

screen('/person/:id', async ({ params, root }) => {
  root.classList.add('profile');
  if (params.id === state.me?.id) {
    go('/me', { replace: true });
    return;
  }
  const stops = [];
  // PROFILE opens my own profile (language, photos, sign out).
  const mine = el('button', { type: 'button', class: 'label ink topbar-link', on: { click: () => go('/me') } }, t('pf_title'));
  root.append(topBar({ left: 'back', right: mine }));
  const body = el('div', { class: 'profile-body' }, el('p', { class: 'loading' }, t('core_loading')));
  root.append(body);

  let data;
  try {
    data = await api.get(`/people/${encodeURIComponent(params.id)}`);
  } catch (err) {
    if (err.status !== 404) throw err;
    body.replaceChildren(el('div', { class: 'empty' },
      el('span', { class: 'icon-circle', 'aria-hidden': 'true' }, icon('user', 22)),
      el('p', {}, t('pf_gone')),
      el('button', { type: 'button', class: 'btn btn-secondary btn-auto', on: { click: () => go('/nearby') } }, t('pf_back_nearby'))));
    return;
  }

  const { person, pair } = data;
  const name = person.name;
  const level = pair?.level || 1;
  const chatOpen = pair?.stage === 'l3_open';
  const extra = (person.photos || []).slice(1);
  const reload = () => go(`/person/${encodeURIComponent(person.id)}`, { replace: true });

  // Native replaceChildren() would print "null", so optional parts are filtered out.
  body.replaceChildren(...[
    el('div', { class: 'section' }, el('span', { class: 'label' }, t('pf_verified_with')), verifiedChips(person.verified)),
    el('div', { class: 'profile-photo' },
      person.photo
        ? el('button', { type: 'button', 'aria-label': t('pf_view_photo'), on: { click: () => viewPhoto(person.photo, name) } }, avatar(person.photo, 170))
        : avatar(null, 170)),
    el('h1', { class: 'display profile-name' }, name),
    person.km != null ? el('p', { class: 'profile-km' }, t('pf_km_away', { km: fmtKm(person.km) })) : null,
    extra.length
      ? el('div', { class: 'thumbs' }, extra.map((url) => el('button', {
        type: 'button', class: 'thumb', 'aria-label': t('pf_view_photo'), on: { click: () => viewPhoto(url, name) },
      }, el('img', { src: url, alt: '' }))))
      : null,
    el('div', { class: 'heart-cards' },
      heartCard('red', person.hearts?.red, t('pf_red_hearts')),
      heartCard('orange', person.hearts?.orange, t('pf_orange_hearts'))),
    el('div', { class: 'level-row' },
      el('span', { class: 'label ink' }, t('pf_you_and', { name, n: level })),
      levelBar(level)),
    el('div', { class: 'profile-actions' },
      actionButton(person, pair, { reload, stops }),
      chatOpen ? null : el('div', { class: 'btn btn-dashed', role: 'note' }, icon('lock', 16), el('span', {}, t('pf_chat_opens'))),
      pair?.next === 'chat' && !state.me?.verified?.phone
        ? el('p', { class: 'lock-note' }, icon('lock', 14), el('span', {}, t('pf_phone_needed')),
          el('button', { type: 'button', class: 'link', on: { click: () => go('/me') } }, t('pf_verify_phone')))
        : null),
  ].filter(Boolean));

  return () => stops.forEach((stop) => stop());
});

registerStrings({
  en: {
    pf_title: 'Profile',
    pf_verified_with: 'Verified with',
    pf_v_phone: 'Phone',
    pf_verified: 'verified',
    pf_not_verified: 'not verified',
    pf_view_photo: 'View photo',
    pf_km_away: '{km} away',
    pf_red_hearts: 'Red hearts',
    pf_orange_hearts: 'Orange hearts',
    pf_you_and: 'You and {name} · Level {n}/3',
    pf_ask_her: 'Ask her',
    pf_ask_him: 'Ask him',
    pf_ask5_her: 'Ask her 5 questions',
    pf_ask5_him: 'Ask him 5 questions',
    pf_answer: 'Answer {name}’s 5 questions',
    pf_waiting_for: 'Waiting for {name}',
    pf_opens_in: 'Level {n} opens in {time}',
    pf_chat_with: 'Chat with {name}',
    pf_chat_opens: 'Chat opens at Level 3',
    pf_frozen: 'This conversation is closed',
    pf_phone_needed: 'Verify your phone number to chat.',
    pf_verify_phone: 'Verify now',
    pf_gone: 'This person is not here any more.',
    pf_back_nearby: 'Back to Nearby',
  },
  km: {
    pf_title: 'ប្រវត្តិរូប',
    pf_verified_with: 'បានផ្ទៀងផ្ទាត់ជាមួយ',
    pf_v_phone: 'ទូរស័ព្ទ',
    pf_verified: 'បានផ្ទៀងផ្ទាត់',
    pf_not_verified: 'មិនទាន់ផ្ទៀងផ្ទាត់',
    pf_view_photo: 'មើលរូបថត',
    pf_km_away: 'ចម្ងាយ {km}',
    pf_red_hearts: 'បេះដូងក្រហម',
    pf_orange_hearts: 'បេះដូងទឹកក្រូច',
    pf_you_and: 'អ្នក និង {name} · កម្រិត {n}/3',
    pf_ask_her: 'សួរនាង',
    pf_ask_him: 'សួរគាត់',
    pf_ask5_her: 'សួរនាង 5 សំណួរ',
    pf_ask5_him: 'សួរគាត់ 5 សំណួរ',
    pf_answer: 'ឆ្លើយសំណួរទាំង 5 របស់ {name}',
    pf_waiting_for: 'កំពុងរង់ចាំ {name}',
    pf_opens_in: 'កម្រិត {n} បើកក្នុងរយៈពេល {time}',
    pf_chat_with: 'ជជែកជាមួយ {name}',
    pf_chat_opens: 'ការជជែកបើកនៅកម្រិត 3',
    pf_frozen: 'ការសន្ទនានេះត្រូវបានបិទ',
    pf_phone_needed: 'សូមផ្ទៀងផ្ទាត់លេខទូរស័ព្ទ ដើម្បីជជែក។',
    pf_verify_phone: 'ផ្ទៀងផ្ទាត់ឥឡូវនេះ',
    pf_gone: 'មនុស្សនេះលែងនៅទីនេះទៀតហើយ។',
    pf_back_nearby: 'ត្រឡប់ទៅនៅជិត',
  },
  zh: {
    pf_title: '资料',
    pf_verified_with: '已验证方式',
    pf_v_phone: '手机',
    pf_verified: '已验证',
    pf_not_verified: '未验证',
    pf_view_photo: '查看照片',
    pf_km_away: '距离 {km}',
    pf_red_hearts: '红心',
    pf_orange_hearts: '橙心',
    pf_you_and: '你和 {name} · 等级 {n}/3',
    pf_ask_her: '问问她',
    pf_ask_him: '问问他',
    pf_ask5_her: '问她 5 个问题',
    pf_ask5_him: '问他 5 个问题',
    pf_answer: '回答 {name} 的 5 个问题',
    pf_waiting_for: '等待 {name} 回应',
    pf_opens_in: '等级 {n} 将在 {time} 后开启',
    pf_chat_with: '和 {name} 聊天',
    pf_chat_opens: '等级 3 开放聊天',
    pf_frozen: '此对话已关闭',
    pf_phone_needed: '请先验证手机号才能聊天。',
    pf_verify_phone: '立即验证',
    pf_gone: '这个人已经不在这里了。',
    pf_back_nearby: '返回附近',
  },
  ko: {
    pf_title: '프로필',
    pf_verified_with: '인증 수단',
    pf_v_phone: '전화',
    pf_verified: '인증됨',
    pf_not_verified: '인증 안 됨',
    pf_view_photo: '사진 보기',
    pf_km_away: '{km} 거리',
    pf_red_hearts: '빨간 하트',
    pf_orange_hearts: '주황 하트',
    pf_you_and: '나와 {name} · 레벨 {n}/3',
    pf_ask_her: '{name}님에게 질문하기',
    pf_ask_him: '{name}님에게 질문하기',
    pf_ask5_her: '{name}님에게 5가지 질문하기',
    pf_ask5_him: '{name}님에게 5가지 질문하기',
    pf_answer: '{name}님의 질문 5개에 답하기',
    pf_waiting_for: '{name}님을 기다리는 중',
    pf_opens_in: '레벨 {n}까지 {time}',
    pf_chat_with: '{name}님과 채팅',
    pf_chat_opens: '채팅은 레벨 3에서 열려요',
    pf_frozen: '이 대화는 종료되었어요',
    pf_phone_needed: '채팅하려면 전화번호를 인증해 주세요.',
    pf_verify_phone: '지금 인증',
    pf_gone: '이 사람은 더 이상 여기에 없어요.',
    pf_back_nearby: '근처로 돌아가기',
  },
  ja: {
    pf_title: 'プロフィール',
    pf_verified_with: '確認済み',
    pf_v_phone: '電話',
    pf_verified: '確認済み',
    pf_not_verified: '未確認',
    pf_view_photo: '写真を見る',
    pf_km_away: 'ここから{km}',
    pf_red_hearts: '赤いハート',
    pf_orange_hearts: 'オレンジのハート',
    pf_you_and: 'あなたと{name} · レベル {n}/3',
    pf_ask_her: '{name}さんに質問する',
    pf_ask_him: '{name}さんに質問する',
    pf_ask5_her: '{name}さんに5つ質問する',
    pf_ask5_him: '{name}さんに5つ質問する',
    pf_answer: '{name}さんの5つの質問に答える',
    pf_waiting_for: '{name}さんの返事待ち',
    pf_opens_in: 'レベル{n}まで {time}',
    pf_chat_with: '{name}さんとチャット',
    pf_chat_opens: 'チャットはレベル3で開きます',
    pf_frozen: 'この会話は終了しました',
    pf_phone_needed: 'チャットするには電話番号の確認が必要です。',
    pf_verify_phone: '今すぐ確認',
    pf_gone: 'この人はもういません。',
    pf_back_nearby: '近くに戻る',
  },
});
