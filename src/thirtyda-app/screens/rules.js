// #/rules · Community rules (store policy, owner 2026-10-14 — Apple 1.2 / Google Play UGC: an explicit "I agree" before
// anyone uses 30+DA). Right after the language, before the PIN: six one-line rules (30+ only and honest; respect, no
// hate or harassment; no nudity or sexual content; no money, gifts, escorts or sugar dating, no scams; reports checked
// within 24 hours and offenders removed; moderators may read chats for safety), the Terms and Privacy links, "I agree".
//  - A visitor: the agreement waits on this phone (terms.js) and goes with the sign-in / Create profile; then #/pin
//    (or home, when the PIN was already chosen).
//  - Signed in with a profile that has not agreed to the current rules (the version changed): "Our rules have changed",
//    "I agree" → POST /me/terms; nothing else in the app opens until then (app.js guard, the API's 403 terms_needed).
//    Sign out and Delete my account stay possible. An agreement already made on this phone goes by itself.
import { screen, el, icon, t, go, api, state, errorText, registerStrings } from '../core.js';
import { leaveWithoutLock, waitingPin } from '../lock.js';
import { agreedHere, keepAgreement, clearAgreement, syncTerms, termsNeeded } from '../terms.js';
import { deleteSheet } from './delete-account.js';

/** The six rules, in order: [string key, icon]. */
const RULES = [
  ['cr_r_age', 'user'],
  ['cr_r_respect', 'heart'],
  ['cr_r_sexual', 'block'],
  ['cr_r_money', 'alert'],
  ['cr_r_reports', 'flag'],
  ['cr_r_mods', 'eye'],
];

screen('/rules', ({ root }) => {
  root.classList.add('dark', 'rules-screen');
  const signedIn = Boolean(state.me);
  const lang = encodeURIComponent(state.lang || 'en');
  // Reading a page on purpose is not "closing the app": no PIN on the way back (the page's button comes back here).
  const away = () => { if (state.me) leaveWithoutLock(); };
  const fail = el('p', { class: 'field-error rules-error', role: 'alert', hidden: true });
  const agreeText = el('span', {}, t('cr_agree'));
  const agree = el('button', { type: 'button', class: 'btn btn-light rules-agree', dataset: { act: 'agree' } }, icon('check', 18), agreeText);

  const busy = (on) => {
    agree.disabled = on;
    agreeText.textContent = on ? t('cr_saving') : t('cr_agree');
  };
  const done = () => go(state.me ? '/nearby' : waitingPin() ? '/nearby' : '/pin', { replace: true });

  agree.addEventListener('click', async () => {
    fail.hidden = true;
    keepAgreement();
    if (!state.me) return done();
    busy(true);
    const ok = await syncTerms();
    if (ok) return done();
    busy(false);
    if (!state.me || state.locked) return; // signed out, blocked or locked meanwhile: core / lock.js moved on
    fail.textContent = errorText(null);
    fail.hidden = false;
  });

  const signOut = async () => {
    try {
      await api.post('/auth/signout', {}, { redirect: false });
    } catch { /* signed out here either way */ }
    clearAgreement(); // the next person on this phone agrees for themselves
    Object.assign(state, { me: null, actions: [], notices: [], pending: null });
    go('/opening', { replace: true });
  };

  // A visitor can go back to the language; a signed-in profile has Sign out / Delete my account at the bottom instead.
  const top = signedIn ? [] : [el('header', { class: 'rules-top' },
    el('button', {
      type: 'button', class: 'icon-btn light', 'aria-label': t('core_back'),
      on: { click: () => go('/opening', { replace: true }) },
    }, icon('back', 18)))];
  root.append(
    ...top,
    el('div', { class: 'rules-head' },
      el('span', { class: 'rules-icon', 'aria-hidden': 'true' }, icon('shield', 24)),
      el('h1', { class: 'rules-title', id: 'rules-title' }, t('cr_title')),
      el('p', { class: 'rules-lede' }, t(signedIn ? 'cr_changed' : 'cr_lede'))),
    el('ul', { class: 'rules-list', 'aria-labelledby': 'rules-title' },
      RULES.map(([key, ic]) => el('li', { dataset: { rule: key } },
        el('span', { class: 'rules-ic', 'aria-hidden': 'true' }, icon(ic, 17)), el('span', {}, t(key))))),
    el('p', { class: 'rules-links' },
      el('a', { href: `/30da/terms?lang=${lang}&from=rules`, on: { click: away } }, t('cr_terms')),
      el('span', { class: 'dot', 'aria-hidden': 'true' }, '·'),
      el('a', { href: `/30da/privacy?lang=${lang}&from=rules`, on: { click: away } }, t('cr_privacy'))),
    el('div', { class: 'rules-actions' },
      fail,
      agree,
      signedIn ? el('p', { class: 'rules-foot' },
        el('button', { type: 'button', class: 'link', on: { click: signOut } }, t('cr_signout')),
        el('span', { class: 'dot', 'aria-hidden': 'true' }, '·'),
        el('button', { type: 'button', class: 'link', on: { click: () => deleteSheet() } }, t('cr_delete'))) : null),
  );

  // Signed in, and this phone already agreed before the sign-in: it goes by itself (POST /me/terms), then the app.
  if (signedIn && agreedHere()) {
    busy(true);
    syncTerms().then((ok) => {
      if (ok && !termsNeeded()) return done();
      busy(false);
    });
  }
});

registerStrings({
  en: {
    cr_title: 'Community rules',
    cr_lede: '30+DA is for calm, honest dating. Please read and agree.',
    cr_changed: 'Our rules have changed. Please read and agree to keep using 30+DA.',
    cr_r_age: '30+ only. Be honest: your own photos, your real age.',
    cr_r_respect: 'Be kind and respectful. No hate, harassment or threats.',
    cr_r_sexual: 'No nudity or sexual content.',
    cr_r_money: 'No money, gifts, escorts or sugar dating. No scams.',
    cr_r_reports: 'We check reports within 24 hours and remove people who break the rules.',
    cr_r_mods: 'Moderators may read chats to keep everyone safe.',
    cr_terms: 'Terms',
    cr_privacy: 'Privacy policy',
    cr_agree: 'I agree',
    cr_saving: 'Saving…',
    cr_signout: 'Sign out',
    cr_delete: 'Delete my account',
  },
  km: {
    cr_title: 'ច្បាប់សហគមន៍',
    cr_lede: '30+DA គឺសម្រាប់ការណាត់ជួបដោយស្ងប់ស្ងាត់ និងស្មោះត្រង់។ សូមអាន ហើយយល់ព្រម។',
    cr_changed: 'ច្បាប់របស់យើងបានផ្លាស់ប្ដូរ។ សូមអាន ហើយយល់ព្រម ដើម្បីបន្តប្រើ 30+DA។',
    cr_r_age: 'សម្រាប់តែអាយុ 30+ ប៉ុណ្ណោះ។ ស្មោះត្រង់៖ រូបថតខ្លួនឯង អាយុពិត។',
    cr_r_respect: 'សូមមានចិត្តល្អ និងគោរពគ្នា។ គ្មានការស្អប់ខ្ពើម ការយាយី ឬការគំរាមកំហែង។',
    cr_r_sexual: 'គ្មានរូបអាក្រាត ឬខ្លឹមសារផ្លូវភេទ។',
    cr_r_money: 'គ្មានការសុំលុយ ឬអំណោយ សេវាកំដរ ឬការណាត់ជួបដើម្បីលុយ។ គ្មានការបោកប្រាស់។',
    cr_r_reports: 'យើងពិនិត្យរបាយការណ៍ក្នុងរយៈពេល 24 ម៉ោង ហើយដកចេញអ្នកដែលបំពានច្បាប់។',
    cr_r_mods: 'អ្នកសម្របសម្រួលអាចអានការជជែក ដើម្បីសុវត្ថិភាពអ្នករាល់គ្នា។',
    cr_terms: 'លក្ខខណ្ឌប្រើប្រាស់',
    cr_privacy: 'គោលការណ៍ឯកជនភាព',
    cr_agree: 'ខ្ញុំយល់ព្រម',
    cr_saving: 'កំពុងរក្សាទុក…',
    cr_signout: 'ចាកចេញ',
    cr_delete: 'លុបគណនីរបស់ខ្ញុំ',
  },
  zh: {
    cr_title: '社区规则',
    cr_lede: '30+DA 是一个从容、真诚的交友应用。请阅读并同意。',
    cr_changed: '我们的规则已更新。请阅读并同意，才能继续使用 30+DA。',
    cr_r_age: '仅限 30 岁以上。要真诚：用你自己的照片和真实年龄。',
    cr_r_respect: '友善、尊重他人。禁止仇恨、骚扰和威胁。',
    cr_r_sexual: '禁止裸露和色情内容。',
    cr_r_money: '禁止索要金钱或礼物，禁止陪侍和包养交友。禁止诈骗。',
    cr_r_reports: '我们会在 24 小时内处理举报，并移除违规的人。',
    cr_r_mods: '为了大家的安全，管理员可能会查看聊天内容。',
    cr_terms: '使用条款',
    cr_privacy: '隐私政策',
    cr_agree: '我同意',
    cr_saving: '正在保存…',
    cr_signout: '退出登录',
    cr_delete: '删除我的账号',
  },
  ko: {
    cr_title: '커뮤니티 규칙',
    cr_lede: '30+DA는 차분하고 정직한 만남을 위한 앱이에요. 읽고 동의해 주세요.',
    cr_changed: '규칙이 바뀌었어요. 30+DA를 계속 쓰려면 읽고 동의해 주세요.',
    cr_r_age: '30세 이상만. 정직하게: 본인 사진, 실제 나이.',
    cr_r_respect: '친절하고 서로 존중해 주세요. 혐오, 괴롭힘, 협박은 안 돼요.',
    cr_r_sexual: '노출이나 성적인 콘텐츠는 안 돼요.',
    cr_r_money: '돈이나 선물 요구, 유흥 서비스, 스폰서 만남은 안 돼요. 사기도 안 돼요.',
    cr_r_reports: '신고는 24시간 안에 확인하고, 규칙을 어긴 사람은 내보내요.',
    cr_r_mods: '모두의 안전을 위해 운영자가 채팅을 볼 수 있어요.',
    cr_terms: '이용 약관',
    cr_privacy: '개인정보 처리방침',
    cr_agree: '동의합니다',
    cr_saving: '저장 중…',
    cr_signout: '로그아웃',
    cr_delete: '내 계정 삭제',
  },
  ja: {
    cr_title: 'コミュニティルール',
    cr_lede: '30+DAは、穏やかで誠実な出会いのためのアプリです。読んで同意してください。',
    cr_changed: 'ルールが変わりました。30+DAを使い続けるには、読んで同意してください。',
    cr_r_age: '30歳以上のみ。正直に：ご本人の写真と本当の年齢で。',
    cr_r_respect: '親切に、お互いを尊重して。差別・嫌がらせ・脅しは禁止です。',
    cr_r_sexual: '裸や性的な内容は禁止です。',
    cr_r_money: 'お金やプレゼントの要求、風俗、パパ活は禁止です。詐欺も禁止です。',
    cr_r_reports: '報告は24時間以内に確認し、ルール違反の人は退会させます。',
    cr_r_mods: 'みんなの安全のため、運営がチャットを読むことがあります。',
    cr_terms: '利用規約',
    cr_privacy: 'プライバシーポリシー',
    cr_agree: '同意します',
    cr_saving: '保存中…',
    cr_signout: 'ログアウト',
    cr_delete: 'アカウントを削除',
  },
});
