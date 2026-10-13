// Privacy · Terms · "Delete my account" (owner 2026-10-13: "Delete everything"). Google Play and Apple ask a dating app
// for an in-app privacy link and an in-app account deletion.
//  - legalLinks(): "Privacy policy · Terms" — /30da/privacy and /30da/terms in the app's language, in the same tab (the
//    pages link back to #/me). On the opening screen too, before anyone signs in.
//  - accountFoot(): the bottom of #/me — those links and a red "Delete my account".
//  - The sheet: what goes (profile, photos, sign-ins, phone, PIN, lines; people you talk to see "This person left
//    30+DA"; cannot be undone; the little that stays: a bare note of reports, the Telegram support chat) → the PIN
//    (checked like the lock screen: POST /me/unlock, a wrong one counts) → "Delete forever" (POST /me/delete { pin }).
//    Then signed out, on the opening screen: "Your account was deleted."
// The server: src/lib/thirtyda-delete.mjs.
import {
  el, icon, t, go, api, state, setMe, modal, toast, bus, errorText, registerStrings,
} from '../core.js';
import { pinPad, clearPinFlags, leaveWithoutLock } from '../lock.js';

const NOTE_KEY = '30da_deleted'; // this tab: the opening screen says "Your account was deleted." once
const RESET_KEY = '30da_pin_reset'; // lock.js: after 5 wrong PINs the next sign-in sets a new PIN

const tab = {
  set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* storage off: the note is skipped */ } },
  take(k) {
    try {
      const v = sessionStorage.getItem(k);
      sessionStorage.removeItem(k);
      return v;
    } catch { return null; }
  },
};

/** true once after a delete: the opening screen shows the note (and forgets it). */
export const takeDeletedNote = () => tab.take(NOTE_KEY) === '1';

// ---------------------------------------------------------------- styles (no app.css change needed)

const RULES = [
  '.legal-links { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 4px 8px; margin: 0; font-size: 13px; line-height: 1.5; color: var(--muted); text-align: center; }',
  '.legal-links a { color: inherit; font-weight: 600; text-decoration: underline; text-underline-offset: 3px; }',
  '.dark .legal-links { color: var(--on-dark-muted); }',
  '.legal-links .dot { opacity: 0.7; }',
  '.account-foot { display: flex; flex-direction: column; align-items: center; gap: 14px; padding-top: 6px; }',
  '.delete-link { min-height: 36px; padding: 0 8px; font-size: 14px; font-weight: 700; color: var(--red); text-decoration: underline; text-underline-offset: 3px; }',
  '.delete-sheet { padding-bottom: calc(24px + env(safe-area-inset-bottom)); }',
  '.delete-sheet .dialog-icon { align-self: flex-start; }',
  '.delete-what { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }',
  '.delete-what li { display: flex; gap: 10px; align-items: flex-start; font-size: 14.5px; line-height: 1.4; }',
  '.delete-what li .icon { flex: none; margin-top: 2px; color: var(--red); }',
  '.delete-others { margin: 0; padding: 10px 12px; border-radius: 10px; background: var(--red-soft); font-size: 14px; line-height: 1.45; }',
  '.delete-undo { margin: 0; font-weight: 800; color: var(--red); }',
  '.delete-kept { margin: 0; font-size: 12.5px; line-height: 1.45; color: var(--muted); }',
  '.delete-sheet.delete-pin { align-items: center; text-align: center; }',
  '.btn-delete { background: var(--red); color: #fff; border-color: var(--red); }',
  '.btn-delete:hover:not(:disabled) { background: #b42318; border-color: #b42318; }',
  '.deleted-note { display: flex; align-items: center; justify-content: center; gap: 8px; margin: 0 0 4px; padding: 10px 14px; border-radius: 12px; background: rgb(255 255 255 / 0.12); color: #fff; font-size: 15px; font-weight: 700; text-align: center; }',
];
let styled = false;
function ensureStyles() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(RULES.join('\n'));
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  } catch {
    // No constructable stylesheets: add the rules to app.css's sheet (same origin) instead.
    const own = [...document.styleSheets].find((s) => String(s.href || '').endsWith('/30da/app.css'));
    for (const rule of own ? RULES : []) {
      try { own.insertRule(rule, own.cssRules.length); } catch { /* skip a rule this engine cannot parse */ }
    }
  }
}

// ---------------------------------------------------------------- links

/** "Privacy policy · Terms · Help": the public pages in the app's language, same tab (they link back to the app). */
export function legalLinks() {
  ensureStyles();
  const lang = encodeURIComponent(state.lang || 'en');
  // Leaving on purpose to read a page is not "closing the app" (like the trip to Google sign-in): no PIN on the way back.
  const away = () => { if (state.me) leaveWithoutLock(); };
  return el('p', { class: 'legal-links' },
    el('a', { href: `/30da/privacy?lang=${lang}`, on: { click: away } }, t('da_privacy')),
    el('span', { class: 'dot', 'aria-hidden': 'true' }, '·'),
    el('a', { href: `/30da/terms?lang=${lang}`, on: { click: away } }, t('da_terms')),
    el('span', { class: 'dot', 'aria-hidden': 'true' }, '·'),
    // Help & support: who runs 30+DA and the support email (owner 2026-10-14).
    el('a', { href: `/30da/support?lang=${lang}`, on: { click: away } }, t('da_help')));
}

/** The bottom of #/me: Privacy policy · Terms · Help, the support email, and a red "Delete my account". */
export function accountFoot() {
  ensureStyles();
  const del = el('button', { type: 'button', class: 'delete-link', on: { click: () => deleteSheet() } }, t('da_delete'));
  // The support email, right there (owner 2026-10-14: "I don't see gk.smart@ggmt.sg anywhere").
  const mail = el('p', { class: 'legal-links' }, t('da_support_mail'), ' ',
    el('a', { href: 'mailto:gk.smart@ggmt.sg?subject=30%2BDA%20support' }, 'gk.smart@ggmt.sg'));
  return el('div', { class: 'account-foot' }, legalLinks(), mail, del);
}

// ---------------------------------------------------------------- the sheet

/** Signed out: back to the opening screen, which says "Your account was deleted." */
function gone() {
  tab.set(NOTE_KEY, '1');
  clearPinFlags();
  Object.assign(state, { pending: null, actions: [], notices: [] });
  setMe(null);
  go('/opening', { replace: true });
}

/** 5 wrong PINs ended the session (401 pin_tries): sign in again and set a new PIN, as on the lock screen. */
function pinTriesOut() {
  tab.set(RESET_KEY, '1');
  Object.assign(state, { pending: null, actions: [], notices: [] });
  setMe(null);
  toast(t('pin_signin_again'));
  go('/create', { replace: true });
}

const wrongText = (left) => (Number(left) === 1 ? t('pin_wrong_one') : t('pin_wrong', { n: left }));

/** What goes → (the PIN) → Delete forever. */
export function deleteSheet() {
  ensureStyles();
  const hasPin = Boolean(state.me?.pinSet);
  let pin = '';
  // A delete whose answer never came (offline) or failed half way (5xx): if a later call says "signed out", it was
  // finished (by the server, in the background) — the person sees "Your account was deleted.", not a plain sign-out.
  let lost = false;
  const body = el('div', { class: 'sheet-body delete-sheet', 'aria-labelledby': 'da-title' });
  const sheet = modal(body, { sheet: true, label: t('da_title') });
  const close = () => sheet.close();

  /** A call failed in a way the sheet cannot fix here: → true when it moved the person on. */
  function movedOn(e) {
    if (e.status === 401 && (e.code === 'pin_tries' || e.data?.signedOut)) { close(); pinTriesOut(); return true; }
    if (e.status === 401) {
      // No profile behind this session any more, or signed out after a delete whose answer never came: it is done.
      close();
      if (e.code === 'no_profile' || lost) {
        gone();
        return true;
      }
      Object.assign(state, { pending: null, actions: [], notices: [] });
      setMe(null);
      go('/opening', { replace: true });
      return true;
    }
    if (e.status === 423) { close(); bus.dispatchEvent(new CustomEvent('locked', { detail: e.data || {} })); return true; }
    if (e.code === 'blocked') { close(); go('/blocked', { replace: true }); return true; }
    return false;
  }
  const failText = (e) => (e.code === 'rate_limited' ? t('da_too_many') : errorText(e));

  function stepWhat() {
    const keep = el('button', { type: 'button', class: 'btn btn-primary', on: { click: close } }, t('da_keep'));
    const next = el('button', { type: 'button', class: 'btn btn-danger', on: { click: () => (hasPin ? stepPin() : stepFinal()) } }, t('da_continue'));
    const item = (key) => el('li', {}, icon('close', 16), el('span', {}, t(key)));
    body.className = 'sheet-body delete-sheet';
    body.replaceChildren(
      el('span', { class: 'dialog-icon', 'aria-hidden': 'true' }, icon('trash', 22)),
      el('h2', { class: 'sheet-title', id: 'da-title' }, t('da_title')),
      el('p', { class: 'help' }, t('da_lead')),
      el('ul', { class: 'delete-what' }, item('da_what_profile'), item('da_what_signins'), item('da_what_lines')),
      el('p', { class: 'delete-others' }, t('da_others')),
      el('p', { class: 'delete-undo' }, t('da_undo')),
      el('p', { class: 'delete-kept' }, t('da_kept')),
      el('div', { class: 'dialog-actions' }, keep, next));
    keep.focus();
  }

  function stepPin(line = '') {
    const err = el('p', { class: 'field-error pin-sheet-error', role: 'alert', 'aria-live': 'assertive' }, line);
    const pad = pinPad({ onFull, light: true });
    async function onFull(typed) {
      pad.setBusy(true);
      err.textContent = '';
      try {
        // The lock screen's own check: a wrong PIN counts as one of its 5 tries.
        await api.post('/me/unlock', { pin: typed }, { redirect: false });
        pin = typed;
        stepFinal();
      } catch (e) {
        pad.setBusy(false);
        pad.clear();
        if (movedOn(e)) return;
        if (e.code === 'wrong_pin') { pad.shake(); err.textContent = wrongText(e.data?.triesLeft); } else err.textContent = failText(e);
        pad.focus();
      }
    }
    const back = el('button', { type: 'button', class: 'link', on: { click: close } }, t('da_keep'));
    body.className = 'sheet-body delete-sheet pin-sheet delete-pin';
    body.replaceChildren(
      el('h2', { class: 'sheet-title', id: 'da-title' }, t('da_pin_title')),
      el('p', { class: 'help' }, t('da_pin_text')),
      pad.node, err, back);
    pad.focus();
  }

  function stepFinal() {
    const err = el('p', { class: 'field-error', role: 'alert', 'aria-live': 'assertive' });
    const keep = el('button', { type: 'button', class: 'btn btn-primary', on: { click: close } }, t('da_keep'));
    const forever = el('button', { type: 'button', class: 'btn btn-delete' }, icon('trash', 18), el('span', { class: 'btn-text' }, t('da_forever')));
    forever.addEventListener('click', async () => {
      forever.disabled = true;
      keep.disabled = true;
      forever.lastChild.textContent = t('da_deleting');
      err.textContent = '';
      try {
        await api.post('/me/delete', hasPin ? { pin } : {}, { redirect: false });
        close();
        gone();
      } catch (e) {
        if (e.status === 0 || e.status >= 500) lost = true;
        if (movedOn(e)) return;
        if (e.code === 'wrong_pin') return stepPin(wrongText(e.data?.triesLeft)); // the PIN changed meanwhile
        forever.disabled = false;
        keep.disabled = false;
        forever.lastChild.textContent = t('da_forever');
        err.textContent = failText(e);
      }
    });
    body.className = 'sheet-body delete-sheet';
    body.replaceChildren(
      el('span', { class: 'dialog-icon', 'aria-hidden': 'true' }, icon('trash', 22)),
      el('h2', { class: 'sheet-title', id: 'da-title' }, t('da_final_title')),
      el('p', {}, t('da_final_text')),
      el('p', { class: 'delete-undo' }, t('da_undo')),
      err,
      el('div', { class: 'dialog-actions' }, forever, keep));
    keep.focus();
  }

  stepWhat();
  return sheet;
}

registerStrings({
  en: {
    da_privacy: 'Privacy policy',
    da_terms: 'Terms',
    da_help: 'Help',
    da_support_mail: 'Support:',
    da_delete: 'Delete my account',
    da_title: 'Delete your account?',
    da_lead: 'Deleted at once:',
    da_what_profile: 'Your profile and all your photos',
    da_what_signins: 'Your sign-ins (Google, Facebook, TikTok), your phone number and your PIN',
    da_what_lines: 'Your lines, replies and chat messages',
    da_others: 'People you talk to will see “This person left 30+DA”, and those conversations close.',
    da_undo: 'This cannot be undone.',
    da_kept: 'We keep only a bare note of any report (no names or words), for everyone’s safety, and your chat with our Telegram support bot.',
    da_keep: 'Keep my account',
    da_continue: 'Continue',
    da_pin_title: 'Type your PIN',
    da_pin_text: 'To delete your account.',
    da_final_title: 'Delete forever?',
    da_final_text: 'Your account and everything in it is deleted now.',
    da_forever: 'Delete forever',
    da_deleting: 'Deleting…',
    da_done: 'Your account was deleted.',
    da_too_many: 'Too many tries. Try again in 15 minutes.',
  },
  km: {
    da_privacy: 'គោលការណ៍ឯកជនភាព',
    da_terms: 'លក្ខខណ្ឌប្រើប្រាស់',
    da_help: 'ជំនួយ',
    da_support_mail: 'ជំនួយ៖',
    da_delete: 'លុបគណនីរបស់ខ្ញុំ',
    da_title: 'លុបគណនីរបស់អ្នក?',
    da_lead: 'នឹងត្រូវលុបភ្លាមៗ៖',
    da_what_profile: 'ប្រវត្តិរូប និងរូបថតទាំងអស់របស់អ្នក',
    da_what_signins: 'ការចូលរបស់អ្នក (Google, Facebook, TikTok) លេខទូរស័ព្ទ និងលេខ PIN',
    da_what_lines: 'ឃ្លា ចម្លើយ និងសារជជែករបស់អ្នក',
    da_others: 'អ្នកដែលអ្នកកំពុងសន្ទនាជាមួយ នឹងឃើញថា «មនុស្សនេះបានចាកចេញពី 30+DA» ហើយការសន្ទនាទាំងនោះនឹងត្រូវបិទ។',
    da_undo: 'មិនអាចត្រឡប់វិញបានទេ។',
    da_kept: 'យើងរក្សាទុកតែកំណត់ត្រាខ្លីនៃការរាយការណ៍ (គ្មានឈ្មោះ ឬពាក្យ) ដើម្បីសុវត្ថិភាពរបស់អ្នករាល់គ្នា និងការជជែករបស់អ្នកជាមួយបូតជំនួយ Telegram របស់យើង។',
    da_keep: 'រក្សាគណនីរបស់ខ្ញុំ',
    da_continue: 'បន្ត',
    da_pin_title: 'វាយលេខ PIN របស់អ្នក',
    da_pin_text: 'ដើម្បីលុបគណនីរបស់អ្នក។',
    da_final_title: 'លុបជារៀងរហូត?',
    da_final_text: 'គណនីរបស់អ្នក និងអ្វីៗទាំងអស់នៅក្នុងនោះ នឹងត្រូវលុបឥឡូវនេះ។',
    da_forever: 'លុបជារៀងរហូត',
    da_deleting: 'កំពុងលុប…',
    da_done: 'គណនីរបស់អ្នកត្រូវបានលុបហើយ។',
    da_too_many: 'សាកច្រើនដងពេក។ សូមព្យាយាមម្ដងទៀតក្នុងរយៈពេល 15 នាទី។',
  },
  zh: {
    da_privacy: '隐私政策',
    da_terms: '使用条款',
    da_help: '帮助',
    da_support_mail: '客服：',
    da_delete: '删除我的账号',
    da_title: '删除你的账号？',
    da_lead: '以下内容会立即删除：',
    da_what_profile: '你的资料和所有照片',
    da_what_signins: '你的登录方式（Google、Facebook、TikTok）、电话号码和 PIN 码',
    da_what_lines: '你发出的问题、回复和聊天消息',
    da_others: '和你对话过的人会看到“此人已离开 30+DA”，这些对话也会关闭。',
    da_undo: '此操作无法撤销。',
    da_kept: '为了大家的安全，我们只保留举报的简短记录（不含姓名或文字），以及你和我们 Telegram 客服机器人的对话。',
    da_keep: '保留我的账号',
    da_continue: '继续',
    da_pin_title: '输入你的 PIN 码',
    da_pin_text: '以删除你的账号。',
    da_final_title: '永久删除？',
    da_final_text: '你的账号和其中的一切将立即删除。',
    da_forever: '永久删除',
    da_deleting: '正在删除…',
    da_done: '你的账号已删除。',
    da_too_many: '尝试次数太多，请 15 分钟后再试。',
  },
  ko: {
    da_privacy: '개인정보 처리방침',
    da_terms: '이용약관',
    da_help: '도움말',
    da_support_mail: '고객 지원:',
    da_delete: '내 계정 삭제',
    da_title: '계정을 삭제할까요?',
    da_lead: '바로 삭제되는 것:',
    da_what_profile: '내 프로필과 모든 사진',
    da_what_signins: '로그인 수단(Google, Facebook, TikTok), 전화번호, PIN',
    da_what_lines: '내가 보낸 한마디, 답장, 채팅 메시지',
    da_others: '대화하던 사람에게는 “이 사람은 30+DA를 떠났어요”라고 보이고, 그 대화는 닫혀요.',
    da_undo: '되돌릴 수 없어요.',
    da_kept: '모두의 안전을 위해 신고에 대한 짧은 기록(이름이나 글 없음)과 Telegram 고객지원 봇과의 대화만 남아요.',
    da_keep: '계정 유지하기',
    da_continue: '계속',
    da_pin_title: 'PIN을 입력하세요',
    da_pin_text: '계정을 삭제하려면 입력해 주세요.',
    da_final_title: '영구 삭제할까요?',
    da_final_text: '계정과 그 안의 모든 것이 지금 삭제돼요.',
    da_forever: '영구 삭제',
    da_deleting: '삭제하는 중…',
    da_done: '계정이 삭제되었어요.',
    da_too_many: '시도가 너무 많아요. 15분 후에 다시 시도해 주세요.',
  },
  ja: {
    da_privacy: 'プライバシーポリシー',
    da_terms: '利用規約',
    da_help: 'ヘルプ',
    da_support_mail: 'サポート：',
    da_delete: 'アカウントを削除',
    da_title: 'アカウントを削除しますか？',
    da_lead: 'すぐに削除されるもの：',
    da_what_profile: 'プロフィールとすべての写真',
    da_what_signins: 'ログイン（Google、Facebook、TikTok）、電話番号、PIN',
    da_what_lines: 'あなたが送った質問・返信・チャットのメッセージ',
    da_others: '会話していた相手には「この人は30+DAを退会しました」と表示され、その会話は終了します。',
    da_undo: '元に戻すことはできません。',
    da_kept: 'みんなの安全のため、通報の簡単な記録（名前や文章は含みません）と、Telegramサポートボットとのやりとりだけは残ります。',
    da_keep: 'アカウントを残す',
    da_continue: '次へ',
    da_pin_title: 'PINを入力',
    da_pin_text: 'アカウントを削除するために入力してください。',
    da_final_title: '完全に削除しますか？',
    da_final_text: 'アカウントとその中のすべてが、今すぐ削除されます。',
    da_forever: '完全に削除',
    da_deleting: '削除しています…',
    da_done: 'アカウントを削除しました。',
    da_too_many: '試行回数が多すぎます。15分後にもう一度お試しください。',
  },
});
