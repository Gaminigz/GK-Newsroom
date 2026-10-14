// 30+DA web app entry: loads every screen module, restores the session, starts the hash
// router, keeps the heartbeat going and shows admin notices as a blocking dialog. The PIN lock (lock.js)
// covers the app when the session is locked, after 30 s without a touch, and when the app is hidden; while
// locked and hidden, "Remind me" only checks how many conversations wait (GET /me/pending).
import {
  state, api, bus, t, el, icon, go, modal, heartbeat, startRouter, setMe, registerStrings, actionLabel, pairRoute,
} from './core.js';
import { startLock, bootLock, applyLockInfo, waitingPin, pinResetPending, leaveWithoutLock } from './lock.js';
// The community rules' "I agree" (store policy, owner 2026-10-14): screens/rules.js, kept on the phone by terms.js.
import { agreedHere, syncTerms, termsNeeded } from './terms.js';
import { shellPlatform } from './shell.js';

// Inside the iOS / Android app (owner 2026-10-14, the iOS audit): <html data-shell="ios|android"> — app.css then keeps
// the page from being selected like a web page (fields stay selectable). The website has no data-shell.
try {
  const shell = shellPlatform();
  if (shell) document.documentElement.dataset.shell = shell;
} catch { /* the website look */ }

// Each screen registers its own route. One failing module must not take the whole app down,
// so they load side by side and a failure is only logged.
const SCREENS = [
  ['opening', () => import('./screens/opening.js')],
  ['rules', () => import('./screens/rules.js')],
  ['pin', () => import('./screens/pin.js')],
  ['create-profile', () => import('./screens/create-profile.js')],
  ['nearby', () => import('./screens/nearby.js')],
  ['profile', () => import('./screens/profile.js')],
  ['my-profile', () => import('./screens/my-profile.js')],
  ['blocked', () => import('./screens/blocked.js')],
  ['level-ask', () => import('./screens/level-ask.js')],
  ['level-answer', () => import('./screens/level-answer.js')],
  ['level-wait', () => import('./screens/level-wait.js')],
  ['chat', () => import('./screens/chat.js')],
  ['conversation', () => import('./screens/conversation.js')],
  // "Verify to chat": the sheet for a profile with nothing verified yet, and #/verified (the way back from Google & co).
  ['verify-chat', () => import('./screens/verify-chat.js')],
];

const OPEN_PATHS = new Set(['/opening', '/rules', '/pin', '/create']);
const BEAT_VISIBLE_MS = 30e3;
const BEAT_HIDDEN_MS = 5 * 60e3; // only while notifications are allowed

async function loadScreens() {
  const results = await Promise.allSettled(SCREENS.map(([, load]) => load()));
  results.forEach((r, i) => {
    if (r.status === 'rejected') console.error(`30+DA: screen "${SCREENS[i][0]}" failed to load`, r.reason);
  });
}

/** true when the server answered (signed in or not), false when it could not be reached. */
async function loadSession() {
  try {
    // probe=1: a signed-out visit gets 200 { user:null, session:null } instead of a logged 401.
    const r = await api.get('/me?probe=1', { redirect: false });
    applyLockInfo(r.lock);
    if (r.user) {
      setMe(r.user);
      state.notices = Array.isArray(r.notices) ? r.notices : [];
    } else {
      state.pending = r.session || null; // a session without a profile yet, or nobody
    }
    return true;
  } catch (err) {
    state.me = null;
    if (err.status === 423) { // locked: the PIN screen comes first (lock.js)
      bootLock(err.data);
      return true;
    }
    if (err.code === 'no_profile') state.pending = {};
    return err.status !== 0 && err.status < 500;
  }
}

// No session → opening; session without profile → create; blocked → blocked; signed in never sees 1–2.
// Create profile comes after the PIN step (#/pin), unless the person is signing in again after "Forgot PIN?".
// A guest (owner 2026-10-13: "Language → PIN → the home screen"): the PIN chosen, no profile yet → the home screen
// (#/nearby) to look around; Me is Create profile; anything else goes back home (guest.js asks for a profile first).
// The community rules (store policy, owner 2026-10-14): "Language → Community rules → PIN". Past the language nothing
// opens before "I agree" on this phone (#/rules) — except the way back in after "Forgot PIN?" (that profile agreed
// already; the server asks again if the rules changed). A profile without the current rules: #/rules before anything.
function guard(path) {
  if (state.me?.blocked) return path === '/blocked' ? null : '/blocked';
  if (!state.me) {
    const to = visitorRoute(path);
    const where = to ?? path;
    if (where !== '/opening' && where !== '/rules' && !agreedHere() && !pinResetPending()) return '/rules';
    return to;
  }
  if (termsNeeded()) return path === '/rules' ? null : '/rules';
  if (OPEN_PATHS.has(path) || path === '/' || path === '/blocked') return '/nearby';
  return null;
}

/** Where someone with no profile may be (null = stay on `path`). */
function visitorRoute(path) {
  // The PIN already chosen on this phone (kept when the app closes, lock.js): never "Set your PIN" again — home.
  if (path === '/pin' && waitingPin()) return '/nearby';
  if (path === '/create' && !waitingPin() && !pinResetPending()) return '/pin';
  if (OPEN_PATHS.has(path)) return null;
  if (waitingPin()) return path === '/nearby' ? null : path === '/me' ? '/create' : '/nearby';
  return state.pending ? '/create' : '/opening';
}

function renderOffline(host) {
  host.replaceChildren(el('main', { class: 'screen dark blocked' },
    el('span', { class: 'blocked-icon' }, icon('refresh', 28)),
    el('h1', {}, t('app_offline_title')),
    el('p', {}, t('err_network')),
    el('button', { type: 'button', class: 'btn btn-light', on: { click: () => location.reload() } }, t('core_retry'))));
}

// ---------------------------------------------------------------- admin notices

let noticeOpen = false;

function showNotices() {
  if (noticeOpen || !state.me || state.me.blocked || state.locked || termsNeeded()) return; // the rules come first
  const notice = state.notices.find((n) => n && !n.seenAt);
  if (!notice) return;
  noticeOpen = true;
  const ok = el('button', { type: 'button', class: 'btn btn-primary' }, t('app_notice_ok'));
  const dlg = modal(el('div', { class: 'dialog-body', role: 'alertdialog', 'aria-labelledby': 'notice-title' },
    el('span', { class: 'dialog-icon' }, icon('shield', 24)),
    el('h2', { class: 'dialog-title', id: 'notice-title' }, t('app_notice_title')),
    // Warnings have a fixed meaning, so they are shown in the reader's language.
    // A rejected photo (store policy, owner 2026-10-14): the same fixed words, in the reader's language.
    el('p', {}, notice.kind === 'warning' ? t(notice.rule === 'word' ? 'app_notice_warning_word' : 'app_notice_warning')
      : notice.kind === 'photo' ? t('app_notice_photo') : notice.text || ''),
    el('div', { class: 'dialog-actions' }, ok)), { dismissible: false, label: t('app_notice_title') });

  ok.addEventListener('click', async () => {
    ok.disabled = true;
    try {
      await api.post(`/notices/${encodeURIComponent(notice.id)}/seen`, {});
    } catch (err) {
      if (err.status === 0) { ok.disabled = false; return; } // offline: keep the dialog
    }
    state.notices = state.notices.filter((n) => n !== notice);
    dlg.close();
    noticeOpen = false;
    showNotices();
  });
  ok.focus();
}

// ---------------------------------------------------------------- notifications (when "Remind me" allowed them)

const notified = new Set();
const actionKey = (p) => `${p.id}:${p.stage}:${p.next}`;
const notificationsAllowed = () => typeof Notification !== 'undefined' && Notification.permission === 'granted';

function notifyActions(actions) {
  const allowed = notificationsAllowed();
  for (const p of actions) {
    const key = actionKey(p);
    if (notified.has(key)) continue;
    notified.add(key);
    // Only when the page is in the background; on screen the Nearby strip shows it.
    if (!allowed || !document.hidden) continue;
    try {
      const n = new Notification('30+DA', { body: actionLabel(p), tag: `30da-${p.id}` });
      n.onclick = () => {
        window.focus();
        go(pairRoute(p));
        n.close();
      };
    } catch { /* some browsers only allow notifications from a service worker */ }
  }
}

// A hidden app is locked (lock.js), so the heartbeat stops. "Remind me" still works: GET /me/pending (open while
// locked, never counted as use) gives only how many conversations wait, and the notification says only that
// something new is waiting — no name, no text: the phone is locked (owner 2026-10-13).
let pendingSeen = null; // how many the person already knows about (the last heartbeat before the lock, then each check)

async function checkPending() {
  if (!notificationsAllowed() || !document.hidden || state.me?.blocked) return;
  let count;
  try {
    count = Number((await api.get('/me/pending', { redirect: false }))?.count) || 0;
  } catch {
    return; // signed out, offline: nothing to say
  }
  // The first check after the app opened locked knows nothing yet: it only notes what is already there.
  const known = pendingSeen ?? (state.me ? state.actions.length : null);
  pendingSeen = count;
  if (known === null || count <= known) return;
  try {
    const n = new Notification('30+DA', { body: t('app_pending_note'), tag: '30da-pending' });
    n.onclick = () => {
      window.focus(); // the PIN screen first, then the app
      n.close();
    };
  } catch { /* some browsers only allow notifications from a service worker */ }
}

// ---------------------------------------------------------------- heartbeat

let beatTimer = null;

function scheduleBeat() {
  clearTimeout(beatTimer);
  if (document.hidden && !notificationsAllowed()) return; // resumes on visibilitychange
  beatTimer = setTimeout(async () => {
    // Locked (the PIN screen covers the app): no heartbeat, only the "something new is waiting" check.
    if (state.locked) await checkPending();
    else await heartbeat();
    scheduleBeat();
  }, document.hidden ? BEAT_HIDDEN_MS : BEAT_VISIBLE_MS);
}

function onVisibility() {
  if (!document.hidden) heartbeat();
  scheduleBeat();
}

// ---------------------------------------------------------------- boot

async function boot() {
  const host = document.getElementById('app');
  await loadScreens();
  if (!(await loadSession())) return renderOffline(host);

  bus.addEventListener('notices', showNotices);
  bus.addEventListener('actions', () => notifyActions(state.actions));
  let meId = state.me?.id ?? null;
  let rulesOk = !termsNeeded();
  bus.addEventListener('me', () => {
    const id = state.me?.id ?? null;
    if (id !== meId) pendingSeen = null; // another person (or nobody) on this phone now
    if (id && id !== meId) { // just signed in (new profile or "welcome back")
      heartbeat();
      showNotices();
    }
    meId = id;
    // Just signed in: an "I agree" made on this phone before the sign-in goes now (POST /me/terms).
    syncTerms();
    // Just agreed to the community rules: the news and messages that waited.
    const ok = Boolean(state.me) && !termsNeeded();
    if (ok && !rulesOk) {
      heartbeat();
      showNotices();
    }
    rulesOk = ok;
  });
  // Back from the PIN screen: the news and messages that waited.
  bus.addEventListener('unlocked', () => {
    noticeOpen = false; // the cover closed every dialog, a notice too: it shows again
    pendingSeen = null; // seen now: the next lock starts from the next heartbeat
    syncTerms();
    heartbeat();
    showNotices();
  });
  syncTerms(); // signed in already (the app opened): an agreement still waiting on this phone goes now
  startLock();
  startRouter({ host, guard });
  showNotices();
  if (state.me) heartbeat();
  scheduleBeat();
  document.addEventListener('visibilitychange', onVisibility);
}

registerStrings({
  en: {
    app_offline_title: 'Cannot reach 30+DA',
    app_notice_title: 'A message from 30+DA',
    app_notice_ok: 'I understand',
    app_notice_warning: 'We stopped a message that broke the 30+DA rules. Contact details are never allowed. Next time the account is blocked.',
    app_notice_warning_word: 'We stopped words that broke the 30+DA rules. Rude, sexual or money words are never allowed. Next time the account is blocked.',
    app_notice_photo: 'A photo was not accepted — please use a clear photo of your face.',
    app_pending_note: 'Something new is waiting for you.',
  },
  km: {
    app_offline_title: 'មិនអាចភ្ជាប់ទៅ 30+DA បានទេ',
    app_notice_title: 'សារពី 30+DA',
    app_notice_ok: 'ខ្ញុំយល់ហើយ',
    app_notice_warning: 'យើងបានបញ្ឈប់សារមួយដែលបំពានច្បាប់របស់ 30+DA។ ព័ត៌មានទំនាក់ទំនងមិនត្រូវបានអនុញ្ញាតឡើយ។ បើកើតឡើងម្ដងទៀត គណនីនឹងត្រូវបិទ។',
    app_notice_warning_word: 'យើងបានបញ្ឈប់ពាក្យដែលបំពានច្បាប់របស់ 30+DA។ ពាក្យអសុរស ពាក្យផ្លូវភេទ ឬពាក្យទាក់ទងនឹងលុយ មិនត្រូវបានអនុញ្ញាតឡើយ។ បើកើតឡើងម្ដងទៀត គណនីនឹងត្រូវបិទ។',
    app_notice_photo: 'រូបថតមួយមិនត្រូវបានទទួលយកទេ — សូមប្រើរូបថតមុខរបស់អ្នកដែលច្បាស់។',
    app_pending_note: 'មានអ្វីថ្មីកំពុងរង់ចាំអ្នក។',
  },
  zh: {
    app_offline_title: '无法连接 30+DA',
    app_notice_title: '来自 30+DA 的通知',
    app_notice_ok: '我明白了',
    app_notice_warning: '我们拦截了一条违反 30+DA 规则的消息。任何联系方式都不允许分享。如再违规，账号将被封禁。',
    app_notice_warning_word: '我们拦截了违反 30+DA 规则的词语。不允许粗俗、色情或涉及金钱的词语。如再违规，账号将被封禁。',
    app_notice_photo: '有一张照片没有通过审核——请使用一张清晰的本人正脸照。',
    app_pending_note: '有新动态在等你。',
  },
  ko: {
    app_offline_title: '30+DA에 연결할 수 없어요',
    app_notice_title: '30+DA 안내',
    app_notice_ok: '알겠습니다',
    app_notice_warning: '30+DA 규칙을 어긴 메시지를 저희가 막았어요. 연락처는 절대 공유할 수 없어요. 다시 그러면 계정이 차단됩니다.',
    app_notice_warning_word: '30+DA 규칙을 어긴 말을 저희가 막았어요. 욕설, 성적인 말, 돈 관련 말은 쓸 수 없어요. 다시 그러면 계정이 차단됩니다.',
    app_notice_photo: '사진 한 장이 승인되지 않았어요. 얼굴이 잘 보이는 사진을 올려 주세요.',
    app_pending_note: '새로운 소식이 기다리고 있어요.',
  },
  ja: {
    app_offline_title: '30+DAに接続できません',
    app_notice_title: '30+DAからのお知らせ',
    app_notice_ok: 'わかりました',
    app_notice_warning: '30+DAのルールに違反するメッセージを停止しました。連絡先の共有は一切できません。次回はアカウントが停止されます。',
    app_notice_warning_word: '30+DAのルールに違反する言葉を停止しました。乱暴な言葉・性的な言葉・お金に関する言葉は使えません。次回はアカウントが停止されます。',
    app_notice_photo: '写真が1枚承認されませんでした。顔がはっきり写った写真を使ってください。',
    app_pending_note: '新しいお知らせが届いています。',
  },
});

// A new version went live while this tab was open: reload on the next screen change, or when the tab
// comes back into view, so nobody keeps running old screens.
let bootBuild = null;
let stale = false;
async function checkBuild() {
  try {
    const { build } = await (await fetch('/30da/api/version', { cache: 'no-store' })).json();
    if (!build) return;
    if (bootBuild === null) bootBuild = build;
    else if (build !== bootBuild) stale = true;
  } catch { /* offline: try again later */ }
}
checkBuild();
setInterval(checkBuild, 60e3);
window.addEventListener('hashchange', () => {
  if (!stale) return;
  leaveWithoutLock(); // our own reload, not the app being closed
  location.reload();
});
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  await checkBuild();
  if (stale) location.reload();
});

boot();
