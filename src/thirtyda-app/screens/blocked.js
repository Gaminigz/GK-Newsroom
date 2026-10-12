// blocked · A calm navy screen for an account the admin has blocked. Rechecks GET /me on open, every
// 30 s while the page is visible and whenever it becomes visible again, so an account the admin
// unblocks (or whose block was undone) goes straight back to Nearby without a reload.
import { screen, el, icon, t, go, api, state, setMe, registerStrings } from '../core.js';

const CONTACT = 'gk.smart@ggmt.sg';
const RECHECK_MS = 30_000;

screen('/blocked', ({ root }) => {
  root.classList.add('dark', 'blocked');
  let alive = true;

  const [before, after = ''] = t('bl_body').split('{email}');
  const signOut = el('button', { type: 'button', class: 'btn btn-ghost-light' }, icon('logout', 18), el('span', {}, t('bl_signout')));
  signOut.addEventListener('click', async () => {
    signOut.disabled = true;
    try {
      await api.post('/auth/signout', {}, { redirect: false });
    } catch { /* signed out locally either way */ }
    state.me = null;
    state.actions = [];
    state.notices = [];
    go('/opening', { replace: true });
  });

  root.append(
    el('span', { class: 'blocked-icon', 'aria-hidden': 'true' }, icon('shield', 30)),
    el('h1', {}, t('bl_title')),
    el('p', {}, before, el('a', { href: `mailto:${CONTACT}` }, CONTACT), after),
    signOut);

  let checking = false;
  async function recheck() {
    if (!alive || checking || document.visibilityState === 'hidden') return;
    checking = true;
    try {
      const r = await api.get('/me', { redirect: false });
      if (alive && r.user && !r.user.blocked) {
        setMe(r.user);
        go('/nearby', { replace: true });
      }
    } catch { /* stay here */ } finally {
      checking = false;
    }
  }
  const timer = setInterval(recheck, RECHECK_MS);
  document.addEventListener('visibilitychange', recheck);
  recheck();

  return () => {
    alive = false;
    clearInterval(timer);
    document.removeEventListener('visibilitychange', recheck);
  };
});

registerStrings({
  en: {
    bl_title: 'Your account is blocked',
    bl_body: 'Every admin action is logged. If you think this is a mistake, contact {email}.',
    bl_signout: 'Sign out',
  },
  km: {
    bl_title: 'គណនីរបស់អ្នកត្រូវបានបិទ',
    bl_body: 'រាល់សកម្មភាពរបស់អ្នកគ្រប់គ្រង ត្រូវបានកត់ត្រាទុក។ បើអ្នកគិតថានេះជាការភ្លាំងភ្លាត់ សូមទាក់ទង {email}។',
    bl_signout: 'ចាកចេញ',
  },
  zh: {
    bl_title: '你的账号已被封禁',
    bl_body: '管理员的每一项操作都有记录。如果你认为这是误判，请联系 {email}。',
    bl_signout: '退出登录',
  },
  ko: {
    bl_title: '계정이 차단되었어요',
    bl_body: '모든 관리자 조치는 기록됩니다. 잘못된 조치라고 생각되면 {email}로 연락해 주세요.',
    bl_signout: '로그아웃',
  },
  ja: {
    bl_title: 'アカウントが停止されています',
    bl_body: '管理者の操作はすべて記録されています。誤りだと思われる場合は、{email} までご連絡ください。',
    bl_signout: 'ログアウト',
  },
});
