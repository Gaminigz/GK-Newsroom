// 30+DA web app entry: loads every screen module, restores the session, starts the hash
// router, keeps the heartbeat going and shows admin notices as a blocking dialog. The PIN lock (lock.js)
// covers the app when the session is locked, after 30 s without a touch, and when the app is hidden.
import {
  state, api, bus, t, el, icon, go, modal, heartbeat, startRouter, setMe, registerStrings, actionLabel, pairRoute,
} from './core.js';
import { startLock, bootLock, applyLockInfo, waitingPin, pinResetPending, leaveWithoutLock } from './lock.js';

// Each screen registers its own route. One failing module must not take the whole app down,
// so they load side by side and a failure is only logged.
const SCREENS = [
  ['opening', () => import('./screens/opening.js')],
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
];

const OPEN_PATHS = new Set(['/opening', '/pin', '/create']);
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
function guard(path) {
  if (state.me?.blocked) return path === '/blocked' ? null : '/blocked';
  if (!state.me) {
    if (path === '/create' && !waitingPin() && !pinResetPending()) return '/pin';
    if (OPEN_PATHS.has(path)) return null;
    return state.pending ? '/create' : '/opening';
  }
  if (OPEN_PATHS.has(path) || path === '/' || path === '/blocked') return '/nearby';
  return null;
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
  if (noticeOpen || !state.me || state.me.blocked || state.locked) return;
  const notice = state.notices.find((n) => n && !n.seenAt);
  if (!notice) return;
  noticeOpen = true;
  const ok = el('button', { type: 'button', class: 'btn btn-primary' }, t('app_notice_ok'));
  const dlg = modal(el('div', { class: 'dialog-body', role: 'alertdialog', 'aria-labelledby': 'notice-title' },
    el('span', { class: 'dialog-icon' }, icon('shield', 24)),
    el('h2', { class: 'dialog-title', id: 'notice-title' }, t('app_notice_title')),
    // Warnings have a fixed meaning, so they are shown in the reader's language.
    el('p', {}, notice.kind === 'warning' ? t('app_notice_warning') : notice.text || ''),
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

function notifyActions(actions) {
  const allowed = typeof Notification !== 'undefined' && Notification.permission === 'granted';
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

// ---------------------------------------------------------------- heartbeat

let beatTimer = null;

function scheduleBeat() {
  clearTimeout(beatTimer);
  const allowed = typeof Notification !== 'undefined' && Notification.permission === 'granted';
  if (document.hidden && !allowed) return; // resumes on visibilitychange
  beatTimer = setTimeout(async () => {
    await heartbeat();
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
  bus.addEventListener('me', () => {
    const id = state.me?.id ?? null;
    if (id && id !== meId) { // just signed in (new profile or "welcome back")
      heartbeat();
      showNotices();
    }
    meId = id;
  });
  // Back from the PIN screen: the news and messages that waited.
  bus.addEventListener('unlocked', () => {
    noticeOpen = false; // the cover closed every dialog, a notice too: it shows again
    heartbeat();
    showNotices();
  });
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
  },
  km: {
    app_offline_title: 'មិនអាចភ្ជាប់ទៅ 30+DA បានទេ',
    app_notice_title: 'សារពី 30+DA',
    app_notice_ok: 'ខ្ញុំយល់ហើយ',
    app_notice_warning: 'យើងបានបញ្ឈប់សារមួយដែលបំពានច្បាប់របស់ 30+DA។ ព័ត៌មានទំនាក់ទំនងមិនត្រូវបានអនុញ្ញាតឡើយ។ បើកើតឡើងម្ដងទៀត គណនីនឹងត្រូវបិទ។',
  },
  zh: {
    app_offline_title: '无法连接 30+DA',
    app_notice_title: '来自 30+DA 的通知',
    app_notice_ok: '我明白了',
    app_notice_warning: '我们拦截了一条违反 30+DA 规则的消息。任何联系方式都不允许分享。如再违规，账号将被封禁。',
  },
  ko: {
    app_offline_title: '30+DA에 연결할 수 없어요',
    app_notice_title: '30+DA 안내',
    app_notice_ok: '알겠습니다',
    app_notice_warning: '30+DA 규칙을 어긴 메시지를 저희가 막았어요. 연락처는 절대 공유할 수 없어요. 다시 그러면 계정이 차단됩니다.',
  },
  ja: {
    app_offline_title: '30+DAに接続できません',
    app_notice_title: '30+DAからのお知らせ',
    app_notice_ok: 'わかりました',
    app_notice_warning: '30+DAのルールに違反するメッセージを停止しました。連絡先の共有は一切できません。次回はアカウントが停止されます。',
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
