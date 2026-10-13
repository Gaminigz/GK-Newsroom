// Screen 4 · Profile view — verified chips, big photo, hearts, "You and Sophea · Level n/3", the photos this
// viewer may see (slot 2 from Level 2, slots 3–4 from Level 3; the rest as locked placeholders) and one
// primary action driven by pair.next. Every state opens the one conversation screen (#/c/:pairId):
// start, reply, see where it is while waiting, choose after Level 2, chat, or read an ended one.
// The real name shows under the app name only once the chat (Level 3) is open (the server sends it then).
import {
  screen, el, icon, t, go, api, toast, modal, state, topBar, levelBar, avatar, countdown, pronoun, fmtKm,
  pairRoute, stageLevel, nextKind, registerStrings, morePhotosPrompt, stageOpenLevel, roleLabel,
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

/** The photos this viewer can see (tap → large) and the locked ones as "Level n" placeholders. */
function photoStrip(person) {
  const visible = person.photos || [];
  const locked = person.lockedPhotos || [];
  if (visible.length < 2 && !locked.length) return null; // only the main photo: it is already shown above
  const name = person.name;
  return el('div', { class: 'photo-strip' },
    el('span', { class: 'label' }, t('pf_photos')),
    el('ul', { class: 'thumbs' },
      visible.map((url, i) => el('li', {}, el('button', {
        type: 'button', class: 'thumb', 'aria-label': t('pf_photo_n', { n: i + 1 }), on: { click: () => viewPhoto(url, name) },
      }, el('img', { src: url, alt: '' })))),
      locked.map((x) => el('li', { class: 'thumb locked' },
        icon('lock', 15),
        el('span', { class: 'label', 'aria-hidden': 'true' }, t('pf_slot_level', { n: x.level })),
        el('span', { class: 'visually-hidden' }, t('pf_slot_locked', { slot: x.slot, n: x.level }))))));
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
  const secondary = (label, iconName, onClick) => el('button', { type: 'button', class: 'btn btn-secondary', on: { click: onClick } },
    icon(iconName, 18), el('span', {}, label));
  const open = () => go(pairRoute(pair));
  // Level 1: start the conversation (or carry it on when their 5 are already here); Level 2: carry it on.
  const startLabel = () => (stageLevel(pair) >= 2 || pair?.myIncoming?.received ? t('pf_continue', { name }) : t(`pf_ask5_${pr}`, { name }));

  if (!pair) {
    const b = el('button', { type: 'button', class: 'btn btn-primary' }, icon('chat', 18), el('span', {}, t(`pf_ask_${pr}`, { name })));
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        const r = await api.post('/pairs', { to: person.id });
        go(pairRoute(r.pair));
      } catch (err) {
        b.disabled = false;
        // verify_needed: the "Verify to chat" sheet was closed without verifying (it already said why).
        if (err.status !== 401 && err.code !== 'blocked' && err.code !== 'verify_needed') toast(pairError(err));
      }
    });
    return b;
  }

  switch (nextKind(pair.next)) {
    case 'send':
      return primary(startLabel(), 'chat', open);
    case 'reply':
    case 'send_reply':
      return primary(t('pf_answer', { name }), 'chat', open);
    case 'wait_them':
      // Nothing to do but wait: the conversation still opens, to read what was said.
      return secondary(t('pf_waiting_for', { name }), 'clock', open);
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
    case 'decide':
      // Level 2 is done: open the chat or forget it (the choice is on the conversation screen).
      return primary(t('pf_decide'), 'chat', open);
    case 'chat':
      return primary(t('pf_chat_with', { name }), 'chat', open);
    case 'ended':
      // "Forget it": nothing more to send, but what was said can still be read.
      return secondary(t('pf_ended'), 'lock', open);
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
  root.append(topBar({ left: 'back', right: t('pf_title') }));
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
  const ended = pair?.stage === 'ended';
  const reload = () => go(`/person/${encodeURIComponent(person.id)}`, { replace: true });

  // Native replaceChildren() would print "null", so optional parts are filtered out.
  body.replaceChildren(...[
    el('div', { class: 'section' }, el('span', { class: 'label' }, t('pf_verified_with')), verifiedChips(person.verified)),
    el('div', { class: 'profile-photo' },
      person.photo
        ? el('button', { type: 'button', 'aria-label': t('pf_view_photo'), on: { click: () => viewPhoto(person.photo, name) } }, avatar(person.photo, 170))
        : avatar(null, 170)),
    el('h1', { class: 'display profile-name' }, name),
    person.realName
      ? el('p', { class: 'profile-real' }, el('span', { class: 'visually-hidden' }, `${t('pf_real_name')}: `), person.realName)
      : null,
    person.role ? el('p', { class: 'profile-role' }, roleLabel(person.role)) : null,
    person.km != null ? el('p', { class: 'profile-km' }, t('pf_km_away', { km: fmtKm(person.km) })) : null,
    el('div', { class: 'heart-cards' },
      heartCard('red', person.hearts?.red, t('pf_red_hearts')),
      heartCard('orange', person.hearts?.orange, t('pf_orange_hearts'))),
    el('div', { class: 'level-row' },
      el('span', { class: 'label ink' }, t('pf_you_and', { name, n: level })),
      levelBar(level)),
    photoStrip(person),
    // A level that opened with this person also opened photo slots in my own profile.
    morePhotosPrompt(stageOpenLevel(pair?.stage)),
    el('div', { class: 'profile-actions' },
      actionButton(person, pair, { reload, stops }),
      chatOpen || ended ? null : el('div', { class: 'btn btn-dashed', role: 'note' }, icon('lock', 16), el('span', {}, t('pf_chat_opens'))),
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
    pf_photos: 'Photos',
    pf_photo_n: 'Photo {n}',
    pf_slot_level: 'Level {n}',
    pf_slot_locked: 'Photo {slot} opens at Level {n}',
    pf_km_away: '{km} away',
    pf_red_hearts: 'Red hearts',
    pf_orange_hearts: 'Orange hearts',
    pf_you_and: 'You and {name} · Level {n}/3',
    pf_ask_her: 'Start a conversation',
    pf_ask_him: 'Start a conversation',
    pf_ask_them: 'Start a conversation',
    pf_ask5_her: 'Start a conversation',
    pf_ask5_him: 'Start a conversation',
    pf_ask5_them: 'Start a conversation',
    pf_continue: 'Continue the conversation',
    pf_answer: 'Reply to {name}',
    pf_waiting_for: 'Waiting for {name}',
    pf_opens_in: 'Level {n} opens in {time}',
    pf_chat_with: 'Chat with {name}',
    pf_chat_opens: 'Chat opens at Level 3',
    pf_decide: 'Open the chat or forget it',
    pf_ended: 'This conversation has ended',
    pf_real_name: 'Real name',
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
    pf_photos: 'រូបថត',
    pf_photo_n: 'រូបថតទី {n}',
    pf_slot_level: 'កម្រិត {n}',
    pf_slot_locked: 'រូបថតទី {slot} បើកនៅកម្រិត {n}',
    pf_km_away: 'ចម្ងាយ {km}',
    pf_red_hearts: 'បេះដូងក្រហម',
    pf_orange_hearts: 'បេះដូងទឹកក្រូច',
    pf_you_and: 'អ្នក និង {name} · កម្រិត {n}/3',
    pf_ask_her: 'ចាប់ផ្ដើមការសន្ទនា',
    pf_ask_him: 'ចាប់ផ្ដើមការសន្ទនា',
    pf_ask_them: 'ចាប់ផ្ដើមការសន្ទនា',
    pf_ask5_her: 'ចាប់ផ្ដើមការសន្ទនា',
    pf_ask5_him: 'ចាប់ផ្ដើមការសន្ទនា',
    pf_ask5_them: 'ចាប់ផ្ដើមការសន្ទនា',
    pf_continue: 'បន្តការសន្ទនា',
    pf_answer: 'ឆ្លើយតបទៅ {name}',
    pf_waiting_for: 'កំពុងរង់ចាំ {name}',
    pf_opens_in: 'កម្រិត {n} បើកក្នុងរយៈពេល {time}',
    pf_chat_with: 'ជជែកជាមួយ {name}',
    pf_chat_opens: 'ការជជែកបើកនៅកម្រិត 3',
    pf_decide: 'បើកការជជែក ឬឈប់ត្រឹមនេះ',
    pf_ended: 'ការសន្ទនានេះបានបញ្ចប់ហើយ',
    pf_real_name: 'ឈ្មោះពិត',
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
    pf_photos: '照片',
    pf_photo_n: '第 {n} 张照片',
    pf_slot_level: '等级 {n}',
    pf_slot_locked: '第 {slot} 张照片在等级 {n} 开放',
    pf_km_away: '距离 {km}',
    pf_red_hearts: '红心',
    pf_orange_hearts: '橙心',
    pf_you_and: '你和 {name} · 等级 {n}/3',
    pf_ask_her: '开始对话',
    pf_ask_him: '开始对话',
    pf_ask_them: '开始对话',
    pf_ask5_her: '开始对话',
    pf_ask5_him: '开始对话',
    pf_ask5_them: '开始对话',
    pf_continue: '继续对话',
    pf_answer: '回复 {name}',
    pf_waiting_for: '等待 {name} 回应',
    pf_opens_in: '等级 {n} 将在 {time} 后开启',
    pf_chat_with: '和 {name} 聊天',
    pf_chat_opens: '等级 3 开放聊天',
    pf_decide: '开始聊天，还是算了',
    pf_ended: '这段对话已经结束',
    pf_real_name: '真实姓名',
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
    pf_photos: '사진',
    pf_photo_n: '사진 {n}',
    pf_slot_level: '레벨 {n}',
    pf_slot_locked: '{slot}번째 사진은 레벨 {n}에서 보여요',
    pf_km_away: '{km} 거리',
    pf_red_hearts: '빨간 하트',
    pf_orange_hearts: '주황 하트',
    pf_you_and: '나와 {name} · 레벨 {n}/3',
    pf_ask_her: '대화 시작하기',
    pf_ask_him: '대화 시작하기',
    pf_ask_them: '대화 시작하기',
    pf_ask5_her: '대화 시작하기',
    pf_ask5_him: '대화 시작하기',
    pf_ask5_them: '대화 시작하기',
    pf_continue: '대화 이어가기',
    pf_answer: '{name}님에게 답장하기',
    pf_waiting_for: '{name}님을 기다리는 중',
    pf_opens_in: '레벨 {n}까지 {time}',
    pf_chat_with: '{name}님과 채팅',
    pf_chat_opens: '채팅은 레벨 3에서 열려요',
    pf_decide: '채팅 열기 또는 그만두기',
    pf_ended: '이 대화는 끝났어요',
    pf_real_name: '실명',
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
    pf_photos: '写真',
    pf_photo_n: '写真{n}',
    pf_slot_level: 'レベル{n}',
    pf_slot_locked: '写真{slot}はレベル{n}で表示',
    pf_km_away: 'ここから{km}',
    pf_red_hearts: '赤いハート',
    pf_orange_hearts: 'オレンジのハート',
    pf_you_and: 'あなたと{name} · レベル {n}/3',
    pf_ask_her: '会話を始める',
    pf_ask_him: '会話を始める',
    pf_ask_them: '会話を始める',
    pf_ask5_her: '会話を始める',
    pf_ask5_him: '会話を始める',
    pf_ask5_them: '会話を始める',
    pf_continue: '会話を続ける',
    pf_answer: '{name}さんに返信する',
    pf_waiting_for: '{name}さんの返事待ち',
    pf_opens_in: 'レベル{n}まで {time}',
    pf_chat_with: '{name}さんとチャット',
    pf_chat_opens: 'チャットはレベル3で開きます',
    pf_decide: 'チャットを開くか、やめておくか',
    pf_ended: 'この会話は終わりました',
    pf_real_name: '本名',
    pf_frozen: 'この会話は終了しました',
    pf_phone_needed: 'チャットするには電話番号の確認が必要です。',
    pf_verify_phone: '今すぐ確認',
    pf_gone: 'この人はもういません。',
    pf_back_nearby: '近くに戻る',
  },
});
