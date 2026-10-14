// "Verify to chat" (owner 2026-10-13). A profile can be made without verifying (Create profile → Nearby at once);
// talking to someone needs one verified way. When the server answers a call 403 verify_needed (src/lib/thirtyda-verify.mjs),
// core.js asks this module: a small sheet opens with the same 5 round buttons as Create profile (TikTok · Telegram ·
// Google · Facebook · WhatsApp; inside the iPhone app Sign in with Apple first) and the number box (phoneVerifier from
// create-profile.js). A good verify ATTACHES to
// this profile; then the sheet closes and the same call goes again, so the person carries on where they were. A
// number or account that already has another profile is said plainly in the sheet (never a switch, never a merge).
// Google / Facebook / TikTok leave the page: the route is kept in this tab and #/verified brings the person back.
// Telegram / WhatsApp are other apps: with a PIN set, going there covers 30+DA (the PIN lock) and takes the sheet down;
// after the PIN it comes back by itself with what was in it (the number, the code box, the wait for Telegram's bot).
// Owner 2026-10-14: a profile that never verifies is deleted 48 hours after it was made — verifyBanner says so, with the
// time left, on the home screen and #/me.
import { screen, el, icon, t, api, go, toast, modal, state, setMe, registerStrings, onVerifyNeeded, currentPath, bus, timeLeft } from '../core.js';
import { phoneVerifier, blankPhone } from './create-profile.js';
import { leaveWithoutLock } from '../lock.js';

const RETURN_KEY = '30da_vc_return'; // where the person was when they left for Google / Facebook / TikTok
const RETURN_MS = 15 * 60e3;
const NOT_BACK_TO = new Set(['/verified', '/create', '/opening', '/pin', '/blocked']);
const SIGNIN_NAMES = { google: 'Google', facebook: 'Facebook', tiktok: 'TikTok', apple: 'Apple' };
const BACK_ERRORS = ['cancelled', 'expired', 'unavailable', 'failed', 'too_many', 'in_use', 'review'];
const ERROR_ICON = { cancelled: 'question', expired: 'clock', too_many: 'clock', unavailable: 'refresh', failed: 'refresh', in_use: 'flag', review: 'flag' };

/** The verified ways that let a profile talk (the server's VERIFIED_WAYS / canTalk, src/lib/thirtyda-verify.mjs): any one. */
export const CHAT_WAYS = Object.freeze(['phone', 'gmail', 'facebook', 'tiktok', 'apple']);
/** True once `me` has any verified way: the Level 3 chat opens for it too, no phone needed (store policy, owner 2026-10-14). */
export const canChat = (me) => CHAT_WAYS.some((k) => me?.verified?.[k] === true);

function keepReturn() {
  const raw = (typeof location === 'undefined' ? '' : location.hash).replace(/^#/, '');
  const path = raw.split('?')[0] || '/';
  if (NOT_BACK_TO.has(path)) return;
  try { sessionStorage.setItem(RETURN_KEY, JSON.stringify({ route: raw, at: Date.now() })); } catch { /* back to Nearby then */ }
}

function takeReturn() {
  let kept = null;
  try {
    kept = JSON.parse(sessionStorage.getItem(RETURN_KEY) || 'null');
    sessionStorage.removeItem(RETURN_KEY);
  } catch { /* nothing kept */ }
  const route = typeof kept?.route === 'string' ? kept.route : '';
  const fresh = Number.isFinite(kept?.at) && Date.now() - kept.at < RETURN_MS;
  return fresh && route.startsWith('/') && !NOT_BACK_TO.has(route.split('?')[0]) ? route : null;
}

/** The number typed on Create profile (kept unverified on the profile) goes back in the box: "+855 12 345 678". */
function modelFor(me) {
  const model = blankPhone();
  const typed = typeof me?.phoneUnverified === 'string' ? me.phoneUnverified : '';
  if (typed.startsWith('+855')) model.phone = typed.slice(4);
  else if (typed.startsWith('+')) model.phone = typed;
  return model;
}

let open = null; // { promise } while the sheet is up: two calls refused at once share one sheet
let kept = null; // { id, model }: the sheet's number / code / Telegram wait for this profile, across openings
let reopen = false; // the PIN cover took the sheet down: it comes back after the PIN

/**
 * The sheet. notice: a calm line at the start (the way back from Google / Facebook / TikTok).
 * → Promise<boolean>: true once this profile has a verified way (the sheet closed by itself), false when closed.
 */
export function verifyChatSheet({ notice = null } = {}) {
  if (open) return open.promise;
  let settle;
  const promise = new Promise((resolve) => { settle = resolve; });
  open = { promise };
  let verifier = null;
  let handle = null;
  let done = false;
  const finish = (ok) => {
    if (done) return;
    done = true;
    open = null;
    // Covered by the PIN lock (the person went to Telegram / WhatsApp): back after the PIN, with what was in it.
    reopen = !ok && state.locked;
    if (ok) kept = null;
    verifier?.destroy();
    handle?.close();
    if (ok) toast(t('vc_done'));
    settle(ok);
  };
  /** Verified: this profile as it is now (it carries the new way), then the sheet closes. */
  const verified = async (user) => {
    let me = user;
    if (!me) {
      try { me = (await api.get('/me', { redirect: false })).user; } catch { /* the call goes again either way */ }
    }
    if (me) setMe(me);
    finish(true);
  };
  if (kept?.id !== state.me?.id) kept = { id: state.me?.id ?? null, model: modelFor(state.me) };
  verifier = phoneVerifier(kept.model, {
    onVerified: (r) => verified(r?.user),
    signin: {
      verified: () => ({
        gmail: Boolean(state.me?.verified?.gmail), facebook: Boolean(state.me?.verified?.facebook), tiktok: Boolean(state.me?.verified?.tiktok),
        apple: Boolean(state.me?.verified?.apple),
      }),
      onVerified: () => verified(null), // test mode's instant sign-in: already on this profile
      beforeLeave: () => { keepReturn(); leaveWithoutLock(); }, // the trip to Google / Facebook / TikTok
    },
    notice,
  });
  handle = modal(el('div', { class: 'sheet-body verify-chat' },
    el('div', { class: 'vc-head' },
      el('span', { class: 'vc-icon', 'aria-hidden': 'true' }, icon('chat', 20)),
      el('h2', { class: 'sheet-title', id: 'vc-title' }, t('vc_title'))),
    el('p', { class: 'vc-text' }, t('vc_text')),
    verifier.node,
    el('button', { type: 'button', class: 'link vc-later', on: { click: () => finish(false) } }, t('vc_later'))),
  { sheet: true, label: t('vc_title'), className: 'verify-sheet' });
  // Closed any other way (a tap outside, Esc, the PIN cover, another screen): the call stays refused.
  const close = handle.close.bind(handle);
  handle.close = () => {
    close();
    if (!done) finish(false);
  };
  return promise;
}

// Every call that talks to someone and comes back verify_needed opens the sheet (core.js sends it again after).
onVerifyNeeded(() => (state.me && !state.locked ? verifyChatSheet() : Promise.resolve(false)));
// The PIN was right: the sheet the cover took down comes back (nothing to send again: the screen was drawn afresh).
bus.addEventListener('unlocked', () => {
  if (!reopen) return;
  reopen = false;
  const me = state.me;
  if (me && !me.blocked && !canChat(me)) verifyChatSheet();
});

// ---------------------------------------------------------------- "Verify within 48 hours to keep your profile"

/** "21 h 5 min left" / "48 h left" / "35 min left" until MeView.verifyBy (owner 2026-10-14); null when it is not a time. */
export function verifyLeftText(verifyBy, now = Date.now()) {
  const left = timeLeft(verifyBy, now);
  if (!left) return null;
  if (!left.hours) return t('vb_left_m', { m: left.minutes });
  return left.minutes ? t('vb_left_h', { h: left.hours, m: left.minutes }) : t('vb_left_h0', { h: left.hours });
}

/**
 * The short banner on the home screen and #/me for a profile that never verified (owner 2026-10-14): such a profile is
 * deleted 48 hours after it was made (src/lib/thirtyda-delete.mjs). "Verify within 48 hours to keep your profile" and
 * the time left (MeView.verifyBy), kept up to date; a tap opens "Verify to chat". It goes once the profile is verified.
 * → the element, or null (nothing to say).
 */
export function verifyBanner() {
  if (!state.me?.verifyBy || state.me.blocked || !verifyLeftText(state.me.verifyBy)) return null;
  const left = el('span', { class: 'vb-left' });
  const node = el('button', { type: 'button', class: 'verify-banner', on: { click: () => verifyChatSheet() } },
    icon('clock', 20),
    el('span', { class: 'vb-text' }, el('strong', {}, t('vb_title')), left),
    icon('arrow', 16));
  let timer = 0;
  const stop = () => {
    clearInterval(timer);
    bus.removeEventListener('me', paint);
  };
  function paint() {
    const by = state.me?.verifyBy;
    const text = by && !state.me.blocked ? verifyLeftText(by) : null;
    if (!text) {
      node.remove();
      stop();
      return;
    }
    left.textContent = text;
  }
  paint();
  timer = setInterval(() => (node.isConnected ? paint() : stop()), 20e3);
  bus.addEventListener('me', paint);
  return node;
}

/** The way back from Google / Facebook / TikTok started in the sheet: #/verified?signin=google&ok=1 | &error=in_use. */
function backNotice(query) {
  const name = SIGNIN_NAMES[query?.signin] || '';
  const reason = BACK_ERRORS.includes(query?.error) ? query.error : 'failed';
  if (reason === 'in_use') return { ok: false, icon: ERROR_ICON.in_use, text: t('vc_in_use', { name }) };
  if (reason === 'review') return { ok: false, icon: ERROR_ICON.review, text: t('cp_review_fixed') }; // an App review account
  if (reason === 'too_many') return { ok: false, icon: ERROR_ICON.too_many, text: t('cp_too_many') };
  return { ok: false, icon: ERROR_ICON[reason], text: t(`cp_signin_${reason}`, { name }) };
}

screen('/verified', ({ query }) => {
  const back = takeReturn() || '/nearby';
  go(back, { replace: true });
  if (query?.ok === '1') {
    toast(t('vc_done'));
    return;
  }
  // Not verified: the sheet again, over the screen they were on, saying why.
  if (state.me && currentPath() !== '/verified') verifyChatSheet({ notice: backNotice(query) });
});

registerStrings({
  en: {
    vc_title: 'Verify to chat',
    vc_text: 'You can look around without it. To talk with someone, verify one way first.',
    vc_later: 'Not now',
    vc_done: 'Verified. You can chat now.',
    vc_in_use: 'This {name} account already has another profile. Use another way to verify.',
    // Create profile without verifying: a few per connection per day (server: 429 too_many_profiles).
    cp_too_many_profiles: 'Too many new profiles from this connection today. Verify one way above, or try again tomorrow.',
    // One profile made without verifying per phone (server: 409 device_used, owner 2026-10-14).
    cp_device_used: 'This phone already made a profile. Verify your number to make a new one.',
    vb_title: 'Verify within 48 hours to keep your profile',
    vb_left_h: '{h} h {m} min left',
    vb_left_h0: '{h} h left',
    vb_left_m: '{m} min left',
  },
  km: {
    vc_title: 'ផ្ទៀងផ្ទាត់ដើម្បីជជែក',
    vc_text: 'អ្នកអាចមើលបានដោយមិនចាំបាច់ផ្ទៀងផ្ទាត់។ ដើម្បីនិយាយជាមួយនរណាម្នាក់ សូមផ្ទៀងផ្ទាត់មួយវិធីជាមុនសិន។',
    vc_later: 'ពេលក្រោយ',
    vc_done: 'បានផ្ទៀងផ្ទាត់ហើយ។ ឥឡូវអ្នកអាចជជែកបាន។',
    vc_in_use: 'គណនី {name} នេះមានប្រវត្តិរូបផ្សេងរួចហើយ។ សូមប្រើវិធីផ្សេងដើម្បីផ្ទៀងផ្ទាត់។',
    cp_too_many_profiles: 'ថ្ងៃនេះ មានប្រវត្តិរូបថ្មីច្រើនពេកពីការតភ្ជាប់នេះ។ សូមផ្ទៀងផ្ទាត់មួយវិធីខាងលើ ឬសាកម្ដងទៀតនៅថ្ងៃស្អែក។',
    cp_device_used: 'ទូរស័ព្ទនេះបានបង្កើតប្រវត្តិរូបរួចហើយ។ សូមផ្ទៀងផ្ទាត់លេខរបស់អ្នក ដើម្បីបង្កើតថ្មី។',
    vb_title: 'ផ្ទៀងផ្ទាត់ក្នុងរយៈពេល 48 ម៉ោង ដើម្បីរក្សាប្រវត្តិរូបរបស់អ្នក',
    vb_left_h: 'នៅសល់ {h} ម៉ោង {m} នាទី',
    vb_left_h0: 'នៅសល់ {h} ម៉ោង',
    vb_left_m: 'នៅសល់ {m} នាទី',
  },
  zh: {
    vc_title: '验证后才能聊天',
    vc_text: '不验证也可以随便看看。想和别人聊天，请先完成一种验证。',
    vc_later: '以后再说',
    vc_done: '已验证，现在可以聊天了。',
    vc_in_use: '这个 {name} 账号已经有另一个资料了。请换一种方式验证。',
    cp_too_many_profiles: '今天从这个网络新建的资料太多了。请先用上面的一种方式验证，或明天再试。',
    cp_device_used: '这部手机已经创建过资料。请先验证你的号码，再创建新的。',
    vb_title: '请在 48 小时内验证，以保留你的资料',
    vb_left_h: '还剩 {h} 小时 {m} 分钟',
    vb_left_h0: '还剩 {h} 小时',
    vb_left_m: '还剩 {m} 分钟',
  },
  ko: {
    vc_title: '채팅하려면 인증하세요',
    vc_text: '인증 없이도 둘러볼 수 있어요. 다른 사람과 이야기하려면 먼저 한 가지 방법으로 인증해 주세요.',
    vc_later: '나중에',
    vc_done: '인증됐어요. 이제 채팅할 수 있어요.',
    vc_in_use: '이 {name} 계정에는 이미 다른 프로필이 있어요. 다른 방법으로 인증해 주세요.',
    cp_too_many_profiles: '오늘 이 연결에서 새 프로필이 너무 많이 만들어졌어요. 위에서 한 가지 방법으로 인증하거나 내일 다시 해 주세요.',
    cp_device_used: '이 휴대폰으로 이미 프로필을 만들었어요. 새로 만들려면 번호를 인증하세요.',
    vb_title: '48시간 안에 인증해야 프로필이 유지돼요',
    vb_left_h: '{h}시간 {m}분 남음',
    vb_left_h0: '{h}시간 남음',
    vb_left_m: '{m}분 남음',
  },
  ja: {
    vc_title: 'チャットするには確認を',
    vc_text: '確認しなくても見て回れます。相手と話すには、まずどれか1つで確認してください。',
    vc_later: 'あとで',
    vc_done: '確認しました。チャットできます。',
    vc_in_use: 'この{name}アカウントには、すでに別のプロフィールがあります。別の方法で確認してください。',
    cp_too_many_profiles: '今日はこの接続から作られた新しいプロフィールが多すぎます。上のどれか1つで確認するか、明日もう一度お試しください。',
    cp_device_used: 'この端末ではすでにプロフィールが作られています。新しく作るには番号を確認してください。',
    vb_title: '48時間以内に確認して、プロフィールを残しましょう',
    vb_left_h: 'あと{h}時間{m}分',
    vb_left_h0: 'あと{h}時間',
    vb_left_m: 'あと{m}分',
  },
});
