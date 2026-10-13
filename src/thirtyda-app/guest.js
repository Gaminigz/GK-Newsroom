// The guest (owner 2026-10-13: "Language → PIN → the home screen"): after the PIN, before any profile, the home
// screen shows who is on 30+DA as cards only (POST /guest/nearby, src/lib/thirtyda-guest.mjs). Looking is free;
// anything more — opening a profile, hearts, talking, Me — first needs a profile: a small sheet "Make your profile
// first" → #/create. After Next the person comes back to the home screen, or to the profile they tapped.
// The PIN chosen on #/pin keeps waiting in this tab (lock.js) and goes with the new profile, as before.
import { el, icon, t, go, modal, state, registerStrings } from './core.js';
import { waitingPin } from './lock.js';

const NEXT_KEY = '30da_after_create'; // where to go once the profile exists (this tab only)
const NEXT_OK = /^\/(nearby|person\/U-\d+)$/;

/** No profile yet, the PIN chosen: looking around the home screen. */
export const isGuest = () => !state.me && Boolean(waitingPin());

/** Where the guest was going when they tapped (kept for Create profile's Next). */
export function keepAfterCreate(path) {
  if (!NEXT_OK.test(String(path || ''))) return;
  try { sessionStorage.setItem(NEXT_KEY, path); } catch { /* the home screen then */ }
}

/** Create profile's Next: the kept place (used once), else null (the home screen). */
export function takeAfterCreate() {
  let path = null;
  try {
    path = sessionStorage.getItem(NEXT_KEY);
    sessionStorage.removeItem(NEXT_KEY);
  } catch { /* nothing kept */ }
  return NEXT_OK.test(String(path || '')) ? path : null;
}

let open = null;
/** "Make your profile first": a small sheet with one button to #/create. next = where to go after Next. */
export function profileFirst(next = '/nearby') {
  if (open) return;
  const make = () => {
    keepAfterCreate(next);
    open?.close();
    go('/create');
  };
  open = modal(el('div', { class: 'sheet-body verify-chat guest-first' },
    el('div', { class: 'vc-head' },
      el('span', { class: 'vc-icon', 'aria-hidden': 'true' }, icon('user', 20)),
      el('h2', { class: 'sheet-title', id: 'gf-title' }, t('gf_title'))),
    el('p', { class: 'vc-text' }, t('gf_text')),
    el('button', { type: 'button', class: 'btn btn-primary', on: { click: make } },
      el('span', {}, t('gf_make')), icon('arrow', 18)),
    el('button', { type: 'button', class: 'link vc-later', on: { click: () => open?.close() } }, t('gf_later'))),
  { sheet: true, label: t('gf_title'), className: 'verify-sheet' });
  const close = open.close.bind(open);
  open.close = () => { close(); open = null; };
}

registerStrings({
  en: {
    gf_title: 'Make your profile first',
    gf_text: 'A photo, your app name and birth year. Then you can open profiles.',
    gf_make: 'Make my profile',
    gf_later: 'Just looking',
    gf_phnom_penh: 'Phnom Penh',
    gf_slow: 'Too many looks. Try again in a few minutes.',
  },
  km: {
    gf_title: 'បង្កើតប្រវត្តិរូបជាមុនសិន',
    gf_text: 'រូបថត ឈ្មោះក្នុងកម្មវិធី និងឆ្នាំកំណើត។ បន្ទាប់មកអ្នកអាចបើកមើលប្រវត្តិរូបបាន។',
    gf_make: 'បង្កើតប្រវត្តិរូបរបស់ខ្ញុំ',
    gf_later: 'គ្រាន់តែមើល',
    gf_phnom_penh: 'ភ្នំពេញ',
    gf_slow: 'មើលច្រើនពេក។ សូមព្យាយាមម្ដងទៀតក្នុងរយៈពេលប៉ុន្មាននាទីទៀត។',
  },
  zh: {
    gf_title: '请先创建资料',
    gf_text: '一张照片、你的应用名和出生年份。之后就能查看资料。',
    gf_make: '创建我的资料',
    gf_later: '先看看',
    gf_phnom_penh: '金边',
    gf_slow: '浏览太频繁了，请几分钟后再试。',
  },
  ko: {
    gf_title: '먼저 프로필을 만드세요',
    gf_text: '사진, 앱 이름, 출생 연도. 그러면 프로필을 열어 볼 수 있어요.',
    gf_make: '내 프로필 만들기',
    gf_later: '그냥 둘러볼게요',
    gf_phnom_penh: '프놈펜',
    gf_slow: '너무 자주 봤어요. 몇 분 뒤에 다시 시도해 주세요.',
  },
  ja: {
    gf_title: 'まずプロフィールを作成',
    gf_text: '写真、アプリ名、生まれ年。そのあとプロフィールを開けます。',
    gf_make: 'プロフィールを作る',
    gf_later: '見るだけ',
    gf_phnom_penh: 'プノンペン',
    gf_slow: '表示が多すぎます。数分後にもう一度お試しください。',
  },
});
