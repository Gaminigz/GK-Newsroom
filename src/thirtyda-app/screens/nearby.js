// Screen 3 · Nearby — GPS card, distance slider, Everyone/Women/Men, the "waiting for you" strip
// and the 3-column grid of faces with heart pills.
import {
  screen, el, icon, t, go, api, toast, modal, state, bus, store, avatar, heartPills, fmtKm, pairRoute, actionLabel,
  heartbeat, updateLocation, locate, registerStrings, roleLabel, khmerKeep,
} from '../core.js';
import { profileFirst } from '../guest.js';
import { verifyBanner } from './verify-chat.js';
// Inside the iOS / Android app: location is the app's own setting, never "your browser settings" (Apple 4.2).
import { permissionOff } from '../in-app.js';
import { shellPlatform } from '../shell.js';

const KM_KEY = 'thirtyda_km';
const SHOW_KEY = 'thirtyda_show';
const SHOWS = ['everyone', 'women', 'men'];
const DEBOUNCE_MS = 300;
let refreshedThisLoad = false; // re-read GPS silently once per page load when already allowed
// A guest's position (no profile yet): only in this page's memory, sent with each look, never stored anywhere.
let guestPos = null;

const clampKm = (v) => Math.min(50, Math.max(1, Math.round(Number(v)) || 10));

async function geoAllowed() {
  try {
    const p = await navigator.permissions?.query({ name: 'geolocation' });
    return p?.state === 'granted';
  } catch {
    return false;
  }
}

function locationErrorText(err) {
  if (err?.code === 'denied') return t('nb_loc_denied');
  if (err?.code === 'unsupported') return t('nb_loc_unsupported');
  if (err?.status === 0) return t('err_network');
  return t('nb_loc_fail');
}

/** Say why the location could not be read: in the app, a blocked (or missing) location is the app's own setting. */
function sayLocationError(err) {
  if (shellPlatform() && (err?.code === 'denied' || err?.code === 'unsupported')) permissionOff('location');
  else toast(locationErrorText(err));
}

/** "Sign out of 30+DA?" in the app's own dialog (never the browser's confirm). → Promise<boolean>. */
function confirmSignOut(text) {
  return new Promise((resolve) => {
    let done = false;
    const yes = el('button', { type: 'button', class: 'btn btn-primary' }, icon('logout', 18), el('span', {}, t('nb_signout')));
    const no = el('button', { type: 'button', class: 'btn btn-secondary' }, t('nb_cancel'));
    const dlg = modal(el('div', { class: 'dialog-body', role: 'alertdialog', 'aria-labelledby': 'nb-out-title' },
      el('span', { class: 'dialog-icon', 'aria-hidden': 'true' }, icon('logout', 22)),
      el('p', { id: 'nb-out-title' }, text),
      el('div', { class: 'dialog-actions' }, no, yes)), { label: t('nb_signout') });
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
      dlg.close();
    };
    yes.addEventListener('click', () => finish(true));
    no.addEventListener('click', () => finish(false));
    dlg.node.addEventListener('close', () => finish(false));
    no.focus();
  });
}

screen('/nearby', ({ root }) => {
  root.classList.add('nearby');
  let km = clampKm(store.get(KM_KEY, 10));
  let show = SHOWS.includes(store.get(SHOW_KEY)) ? store.get(SHOW_KEY) : 'everyone';
  let alive = true;
  let timer = null;
  let seq = 0;
  let locating = false;
  let last = null; // last /nearby response
  // A guest (the PIN chosen, no profile yet — guard in app.js): the same cards, from POST /guest/nearby. Looking only:
  // a tap on a face, or on Me, asks for a profile first (guest.js); no pairs, no heartbeat.
  const guest = !state.me;

  // --- header: 30+DA · where I am (tap = refresh GPS) · my photo, all on one row
  const gpsCard = el('div', { class: 'gps-inline', 'aria-live': 'polite' });
  root.append(el('header', { class: 'brandbar' },
    el('span', { class: 'wordmark brand' }, '30+DA'),
    gpsCard,
    el('button', { type: 'button', class: 'me-btn', 'aria-label': t('nb_my_profile'), on: { click: () => go(guest ? '/create' : '/me') } },
      avatar(state.me?.photos?.[0] || null, 34)),
    // Owner (2026-10-13): a sign-out right on the home screen, next to my photo.
    guest ? null : el('button', {
      type: 'button', class: 'icon-btn nb-signout', 'aria-label': t('nb_signout'), title: t('nb_signout'),
      on: { click: signOutNow },
    }, icon('logout', 18))));
  async function signOutNow(e) {
    const btn = e.currentTarget;
    if (!(await confirmSignOut(t(Object.values(state.me?.verified || {}).some(Boolean) ? 'nb_signout_ask' : 'nb_signout_ask_unverified')))) return;
    btn.disabled = true;
    try { await api.post('/auth/signout', {}, { redirect: false }); } catch { /* signed out locally either way */ }
    state.me = null;
    state.actions = [];
    state.notices = [];
    state.pending = null;
    go('/opening', { replace: true });
  }
  function paintGps() {
    const on = Boolean(last?.gps);
    let place = '…';
    if (locating) place = t('nb_locating');
    else if (last?.guest) place = last.near === 'you' ? t('nb_near_you') : t('gf_phnom_penh');
    else if (last && on) place = [last.area, last.city].filter((x, i, a) => x && a.indexOf(x) === i).join(', ') || t('nb_near_you');
    else if (last) place = t('nb_turn_on');
    gpsCard.replaceChildren(el('button', {
      type: 'button', class: ['gps-chip', locating && 'busy', last && !on && 'off'], disabled: locating,
      'aria-label': `${place} · ${t('nb_refresh')}`, on: { click: () => refreshGps(false) },
    }, icon('pin', 15), el('span', { class: 'gps-place' }, khmerKeep(place)), icon('target', 15)));
  }

  async function refreshGps(silent) {
    if (locating) return;
    locating = true;
    paintGps();
    try {
      if (guest) guestPos = await locate();
      else await updateLocation();
      refreshedThisLoad = true;
    } catch (err) {
      if (!silent && alive) sayLocationError(err);
    } finally {
      locating = false;
    }
    if (alive) {
      paintGps();
      await load();
    }
  }

  // --- distance
  const within = el('span', { class: 'label ink within' }); // the current distance, in the middle of the scale
  const range = el('input', { type: 'range', class: 'range', min: '1', max: '50', step: '1', value: String(km), 'aria-label': t('nb_distance') });
  function paintRange() {
    const text = t('nb_within', { km });
    within.textContent = fmtKm(km, { whole: true });
    range.setAttribute('aria-valuetext', text);
    range.style.setProperty('--pct', `${((km - 1) / 49) * 100}%`);
  }
  range.addEventListener('input', () => {
    km = clampKm(range.value);
    store.set(KM_KEY, km);
    paintRange();
    schedule();
  });

  // --- show: everyone / women / men
  const segBtns = SHOWS.map((s) => el('button', {
    type: 'button', 'aria-pressed': String(s === show),
    on: {
      click: () => {
        if (s === show) return;
        show = s;
        store.set(SHOW_KEY, s);
        segBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(SHOWS[i] === s)));
        schedule(0);
      },
    },
  }, t(`nb_show_${s}`)));

  // --- waiting strip, count, grid
  const waitRow = el('div', { class: 'waiting-row' });
  // My conversations: every pair as a round photo; a red dot when it is my turn. An ended one ("Forget it")
  // has no dot and sits last, faded: it can still be opened and read.
  const waiting = el('section', { class: 'waiting', hidden: true, 'aria-label': t('nb_my_convos') },
    el('span', { class: 'label ink' }, t('nb_my_convos')), waitRow);
  let pairs = [];
  function paintWaiting() {
    const mine = new Map((state.actions || []).filter((p) => p?.other).map((p) => [p.id, p]));
    // GET /pairs says it too (PairView.turn), so the dot is there on the first paint, before the heartbeat.
    for (const p of pairs) if (p?.other && p.turn === true && !mine.has(p.id)) mine.set(p.id, p);
    const items = [...pairs.filter((p) => p?.other && !mine.has(p.id)), ...mine.values()];
    const ended = (p) => p.stage === 'ended';
    // My turn first, ended last.
    items.sort((a, b) => Number(mine.has(b.id)) - Number(mine.has(a.id)) || Number(ended(a)) - Number(ended(b)));
    waiting.hidden = !items.length;
    waitRow.replaceChildren(...items.map((p) => {
      const turn = mine.has(p.id) && !ended(p);
      const label = turn || ended(p) ? actionLabel(p) : p.other.name;
      return el('button', { type: 'button', class: ['wait-item', ended(p) && 'ended'], 'aria-label': label, title: label, on: { click: () => go(pairRoute(p)) } },
        avatar(p.other.photo || null, 44), turn ? el('span', { class: 'dot', 'aria-hidden': 'true' }) : null);
    }));
  }
  async function loadPairs() {
    try {
      pairs = (await api.get('/pairs')).pairs || [];
    } catch { /* keep what we had */ }
    if (alive) paintWaiting();
  }

  const countLine = el('p', { class: 'label ink count-line', 'aria-live': 'polite' });
  const grid = el('div', { class: 'people' });

  const skeleton = () => grid.replaceChildren(...Array.from({ length: 6 }, () =>
    el('div', { class: 'person skeleton', 'aria-hidden': 'true' }, el('span', { class: 'face' }, avatar(null, '100%')), el('span', { class: 'bar' }))));

  const emptyBox = (text, action) => el('div', { class: 'empty' },
    el('span', { class: 'icon-circle', 'aria-hidden': 'true' }, icon('pin', 22)), el('p', {}, text), action);

  // A guest: "Make your profile first", with "Report this profile" for the card that was tapped (POST /guest/report).
  const openPerson = (p) => (guest ? profileFirst(`/person/${p.id}`, { id: p.id, name: p.name }) : go(`/person/${encodeURIComponent(p.id)}`));
  const tile = (p) => el('button', { type: 'button', class: 'person', on: { click: () => openPerson(p) } },
    el('span', { class: 'face' }, avatar(p.photo || null, '100%'), heartPills(p.hearts, 'sm')),
    el('span', { class: 'person-name' }, p.name),
    p.role ? el('span', { class: 'person-role' }, roleLabel(p.role)) : null,
    // A guest sees a band (≤ 5 km), never an exact distance (src/lib/thirtyda-guest.mjs).
    el('span', { class: 'person-km' }, guest ? `≤ ${fmtKm(p.km, { whole: true })}` : fmtKm(p.km)));

  function paintPeople() {
    const people = Array.isArray(last.people) ? last.people : [];
    if (!last.gps) { // the GPS card above carries the "Turn on location" button
      countLine.textContent = '';
      grid.replaceChildren(emptyBox(t('nb_gps_empty')));
      return;
    }
    const n = last.count ?? people.length;
    countLine.textContent = t(n === 1 ? 'nb_count_one' : 'nb_count', { n });
    grid.replaceChildren(...(people.length ? people.map(tile) : [emptyBox(t('nb_empty', { km }))]));
  }

  async function load() {
    const mine = ++seq;
    grid.setAttribute('aria-busy', 'true');
    try {
      const r = guest
        ? await api.post('/guest/nearby', { km, show, ...(guestPos || {}) }) // the position in the body, never in a URL
        : await api.get(`/nearby?km=${km}&show=${show}`);
      if (!alive || mine !== seq) return;
      last = r;
      paintGps();
      paintPeople();
    } catch (err) {
      if (!alive || mine !== seq || err.status === 401 || err.code === 'blocked') return;
      countLine.textContent = '';
      grid.replaceChildren(el('div', { class: 'empty' },
        el('p', {}, err.status === 0 ? t('err_network') : err.status === 429 ? t('gf_slow') : t('err_generic')),
        el('button', { type: 'button', class: 'btn btn-secondary btn-sm btn-auto', on: { click: () => load() } }, t('core_retry'))));
    } finally {
      if (mine === seq) grid.removeAttribute('aria-busy');
    }
  }

  function schedule(delay = DEBOUNCE_MS) {
    clearTimeout(timer);
    timer = setTimeout(load, delay);
  }

  root.append(
    // Never verified: "Verify within 48 hours to keep your profile" + the time left (owner 2026-10-14).
    ...[guest ? null : verifyBanner()].filter(Boolean),
    el('section', { class: 'distance' },
      range,
      el('div', { class: 'ticks' }, el('span', { class: 'label' }, fmtKm(1, { whole: true })), within, el('span', { class: 'label' }, fmtKm(50, { whole: true })))),
    el('div', { class: 'seg', role: 'group', 'aria-label': t('nb_show') }, segBtns),
    waiting,
    countLine,
    grid);

  paintGps();
  paintRange();
  paintWaiting();
  skeleton();
  if (!guest) {
    bus.addEventListener('actions', loadPairs);
    loadPairs();
    heartbeat();
  }
  (async () => {
    if (!refreshedThisLoad && (await geoAllowed())) await refreshGps(true);
    else await load();
  })();

  return () => {
    alive = false;
    clearTimeout(timer);
    bus.removeEventListener('actions', loadPairs);
  };
});

registerStrings({
  en: {
    nb_title: 'Nearby',
    nb_my_profile: 'My profile',
    nb_signout: 'Sign out',
    nb_signout_ask: 'Sign out of 30+DA?',
    nb_signout_ask_unverified: 'Sign out? You have not verified yet, so you cannot sign back in to this profile.',
    nb_cancel: 'Cancel',
    nb_near_you: 'Near you',
    nb_gps_on: 'Near you · GPS on',
    nb_gps_off: 'GPS off',
    nb_loc_off: 'Location is off',
    nb_turn_on: 'Turn on location',
    nb_refresh: 'Refresh location',
    nb_locating: 'Finding you…',
    nb_loc_denied: 'Location is blocked. Turn it on in your browser settings.',
    nb_loc_unsupported: 'This browser cannot share your location.',
    nb_loc_fail: 'We could not find your location. Try again.',
    nb_distance: 'Distance',
    nb_within: 'Within {km} km',
    nb_show: 'Show',
    nb_show_everyone: 'Everyone',
    nb_show_women: 'Women',
    nb_show_men: 'Men',
    nb_waiting: 'Waiting for you',
    nb_my_convos: 'My conversations',
    nb_count: '{n} people near you',
    nb_count_one: '1 person near you',
    nb_empty: 'No one within {km} km yet. Try a wider distance.',
    nb_gps_empty: 'Turn on location to see people near you.',
  },
  km: {
    nb_title: 'នៅជិត',
    nb_my_profile: 'ប្រវត្តិរូបរបស់ខ្ញុំ',
    nb_signout: 'ចាកចេញ',
    nb_signout_ask: 'ចាកចេញពី 30+DA មែនទេ?',
    nb_signout_ask_unverified: 'ចាកចេញមែនទេ? អ្នកមិនទាន់ផ្ទៀងផ្ទាត់ទេ ដូច្នេះអ្នកមិនអាចចូលប្រវត្តិរូបនេះវិញបានទេ។',
    nb_cancel: 'បោះបង់',
    nb_near_you: 'នៅជិតអ្នក',
    nb_gps_on: 'នៅជិតអ្នក · GPS បើក',
    nb_gps_off: 'GPS បិទ',
    nb_loc_off: 'ទីតាំងត្រូវបានបិទ',
    nb_turn_on: 'បើកទីតាំង',
    nb_refresh: 'ធ្វើបច្ចុប្បន្នភាពទីតាំង',
    nb_locating: 'កំពុងរកទីតាំងរបស់អ្នក…',
    nb_loc_denied: 'ទីតាំងត្រូវបានរារាំង។ សូមបើកវានៅក្នុងការកំណត់កម្មវិធីរុករក។',
    nb_loc_unsupported: 'កម្មវិធីរុករកនេះមិនអាចចែករំលែកទីតាំងរបស់អ្នកបានទេ។',
    nb_loc_fail: 'យើងរកទីតាំងរបស់អ្នកមិនឃើញទេ។ សូមព្យាយាមម្ដងទៀត។',
    nb_distance: 'ចម្ងាយ',
    nb_within: 'ក្នុងរង្វង់ {km} គ.ម',
    nb_show: 'បង្ហាញ',
    nb_show_everyone: 'ទាំងអស់',
    nb_show_women: 'ស្ត្រី',
    nb_show_men: 'បុរស',
    nb_waiting: 'កំពុងរង់ចាំអ្នក',
    nb_my_convos: 'ការសន្ទនារបស់ខ្ញុំ',
    nb_count: 'មនុស្ស {n} នាក់នៅជិតអ្នក',
    nb_count_one: 'មនុស្ស 1 នាក់នៅជិតអ្នក',
    nb_empty: 'មិនទាន់មាននរណាម្នាក់ក្នុងរង្វង់ {km} គ.ម នៅឡើយទេ។ សូមសាកល្បងចម្ងាយឆ្ងាយជាងនេះ។',
    nb_gps_empty: 'បើកទីតាំង ដើម្បីមើលមនុស្សនៅជិតអ្នក។',
  },
  zh: {
    nb_title: '附近',
    nb_my_profile: '我的资料',
    nb_signout: '退出登录',
    nb_signout_ask: '要退出 30+DA 吗？',
    nb_signout_ask_unverified: '要退出吗？你还没有验证，退出后无法再登录这个资料。',
    nb_cancel: '取消',
    nb_near_you: '你附近',
    nb_gps_on: '你附近 · GPS 已开启',
    nb_gps_off: 'GPS 已关闭',
    nb_loc_off: '定位已关闭',
    nb_turn_on: '开启定位',
    nb_refresh: '刷新位置',
    nb_locating: '正在定位…',
    nb_loc_denied: '定位被阻止，请在浏览器设置中开启。',
    nb_loc_unsupported: '此浏览器无法共享你的位置。',
    nb_loc_fail: '无法获取你的位置，请重试。',
    nb_distance: '距离',
    nb_within: '{km} 公里以内',
    nb_show: '显示',
    nb_show_everyone: '所有人',
    nb_show_women: '女士',
    nb_show_men: '男士',
    nb_waiting: '等你回应',
    nb_my_convos: '我的对话',
    nb_count: '附近有 {n} 人',
    nb_count_one: '附近有 1 人',
    nb_empty: '{km} 公里内暂时没有人，试试扩大距离。',
    nb_gps_empty: '开启定位，看看你附近的人。',
  },
  ko: {
    nb_title: '근처',
    nb_my_profile: '내 프로필',
    nb_signout: '로그아웃',
    nb_signout_ask: '30+DA에서 로그아웃할까요?',
    nb_signout_ask_unverified: '로그아웃할까요? 아직 인증하지 않아서 이 프로필로 다시 들어올 수 없어요.',
    nb_cancel: '취소',
    nb_near_you: '내 주변',
    nb_gps_on: '내 주변 · GPS 켜짐',
    nb_gps_off: 'GPS 꺼짐',
    nb_loc_off: '위치가 꺼져 있어요',
    nb_turn_on: '위치 켜기',
    nb_refresh: '위치 새로고침',
    nb_locating: '위치를 찾는 중…',
    nb_loc_denied: '위치 권한이 막혀 있어요. 브라우저 설정에서 켜 주세요.',
    nb_loc_unsupported: '이 브라우저에서는 위치를 공유할 수 없어요.',
    nb_loc_fail: '위치를 찾지 못했어요. 다시 시도해 주세요.',
    nb_distance: '거리',
    nb_within: '{km}km 이내',
    nb_show: '보기',
    nb_show_everyone: '모두',
    nb_show_women: '여성',
    nb_show_men: '남성',
    nb_waiting: '나를 기다리는 중',
    nb_my_convos: '나의 대화',
    nb_count: '근처에 {n}명',
    nb_count_one: '근처에 1명',
    nb_empty: '{km}km 안에는 아직 아무도 없어요. 거리를 넓혀 보세요.',
    nb_gps_empty: '위치를 켜면 근처 사람들을 볼 수 있어요.',
  },
  ja: {
    nb_title: '近く',
    nb_my_profile: 'マイプロフィール',
    nb_signout: 'ログアウト',
    nb_signout_ask: '30+DA からログアウトしますか？',
    nb_signout_ask_unverified: 'ログアウトしますか？まだ確認していないので、このプロフィールには戻れません。',
    nb_cancel: 'キャンセル',
    nb_near_you: '近く',
    nb_gps_on: '近く · GPS オン',
    nb_gps_off: 'GPS オフ',
    nb_loc_off: '位置情報がオフです',
    nb_turn_on: '位置情報をオンにする',
    nb_refresh: '位置情報を更新',
    nb_locating: '位置を確認中…',
    nb_loc_denied: '位置情報がブロックされています。ブラウザの設定でオンにしてください。',
    nb_loc_unsupported: 'このブラウザでは位置情報を共有できません。',
    nb_loc_fail: '位置情報を取得できませんでした。もう一度お試しください。',
    nb_distance: '距離',
    nb_within: '{km}km以内',
    nb_show: '表示',
    nb_show_everyone: 'すべて',
    nb_show_women: '女性',
    nb_show_men: '男性',
    nb_waiting: 'あなたの番です',
    nb_my_convos: 'わたしの会話',
    nb_count: '近くに{n}人',
    nb_count_one: '近くに1人',
    nb_empty: '{km}km以内にはまだ誰もいません。距離を広げてみてください。',
    nb_gps_empty: '位置情報をオンにすると、近くの人が表示されます。',
  },
});
