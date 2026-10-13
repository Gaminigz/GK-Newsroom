// 30+DA client core: state, API client, hash router, i18n, safe DOM builder and the small
// widgets every screen shares. Screen modules (owners C, D, E) import only from here.
import { LANGS, LANG_CODES, photoSlotsFor } from './shared/rules.js';
import { ROLES } from './shared/questions.js';

export * from './shared/rules.js';
export * from './shared/questions.js';
export * from './shared/question-slots.js';

const API_BASE = '/30da/api';
const LANG_KEY = 'thirtyda_lang';
const SVG_NS = 'http://www.w3.org/2000/svg';

// ---------------------------------------------------------------- storage

// localStorage can throw (private mode, blocked site data) — never let that break a screen.
export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* not persisted */ }
  },
};

function initialLang() {
  const saved = store.get(LANG_KEY);
  if (LANGS.includes(saved)) return saved;
  const prefs = typeof navigator === 'undefined' ? [] : navigator.languages || [navigator.language];
  for (const p of prefs) {
    const base = String(p || '').toLowerCase().split('-')[0];
    if (LANGS.includes(base)) return base;
  }
  return 'en';
}

// ---------------------------------------------------------------- state + events

// me: MeView | null · lang: UI language · notices: unseen admin notices · actions: pairs waiting on me
// pending: what a session without a profile has already verified ({ phone, phoneVerified, verified })
export const state = { me: null, lang: initialLang(), notices: [], actions: [], pending: null };

/** App-wide events: 'me', 'lang', 'actions', 'notices'. */
export const bus = new EventTarget();
const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));

if (typeof document !== 'undefined') document.documentElement.lang = state.lang;

export function setLang(lang, { rerender = true } = {}) {
  if (!LANGS.includes(lang)) return;
  const changed = lang !== state.lang;
  state.lang = lang;
  store.set(LANG_KEY, lang);
  document.documentElement.lang = lang;
  if (!changed) return;
  emit('lang', lang);
  if (rerender) renderRoute();
}

export function setMe(user) {
  state.me = user || null;
  if (user) state.pending = null;
  if (user?.lang) setLang(user.lang, { rerender: false });
  emit('me', state.me);
}

// ---------------------------------------------------------------- i18n

const strings = Object.fromEntries(LANGS.map((l) => [l, {}]));

export function registerStrings(dict) {
  for (const [lang, entries] of Object.entries(dict || {})) {
    strings[lang] ||= {};
    Object.assign(strings[lang], entries);
  }
}

/** UI string in state.lang with {name} interpolation; falls back to English, then the key. */
export function t(key, vars) {
  const s = strings[state.lang]?.[key] ?? strings.en?.[key] ?? key;
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] == null ? m : String(vars[k])));
}

// ---------------------------------------------------------------- API

export class ApiError extends Error {
  constructor(status, code, message, data = null) {
    super(message || code || 'error');
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

async function request(method, path, body, opts = {}) {
  const init = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(API_BASE + path, init);
  } catch {
    throw new ApiError(0, 'network', t('err_network'));
  }
  const text = await res.text().catch(() => '');
  let data = {};
  if (text) {
    try { data = JSON.parse(text); } catch { data = {}; }
  }
  if (res.ok) return data;
  const err = new ApiError(res.status, data.error || `http_${res.status}`, data.message || t('err_generic'), data);
  if (opts.redirect !== false) redirectFor(err);
  throw err;
}

// Signed out → opening (or create when only the profile is missing); blocked → blocked screen.
function redirectFor(err) {
  const path = currentPath();
  if (err.status === 401) {
    state.me = null;
    if (err.code === 'no_profile') {
      if (path !== '/create') go('/create', { replace: true });
    } else if (path !== '/opening' && path !== '/create') {
      go('/opening', { replace: true });
    }
  } else if (err.status === 403 && err.code === 'blocked') {
    if (state.me) state.me.blocked = true;
    if (path !== '/blocked') go('/blocked', { replace: true });
  }
}

/** api.get(path), api.post(path, body), api.patch(path, body), api.del(path); opts.redirect=false skips 401/403 routing. */
export const api = {
  get: (path, opts) => request('GET', path, undefined, opts),
  post: (path, body = {}, opts) => request('POST', path, body, opts),
  patch: (path, body = {}, opts) => request('PATCH', path, body, opts),
  put: (path, body = {}, opts) => request('PUT', path, body, opts),
  del: (path, opts) => request('DELETE', path, undefined, opts),
};

/** Human text for an ApiError (or any error) in the UI language. */
export function errorText(err) {
  if (err?.status === 0) return t('err_network');
  if (err?.status === 404) return t('err_not_found');
  return t('err_generic');
}

// ---------------------------------------------------------------- router

const routes = [];
let host = null;
let guardFn = null;
let started = false;
let renderSeq = 0;
let cleanupFn = null;

/** Register a screen. pattern like '/ask/:pairId/:level'; render({ params, root, query }) may return a cleanup fn. */
export function screen(pattern, render) {
  const keys = [];
  const source = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\/:(\w+)/g, (_, k) => { keys.push(k); return '/([^/?#]+)'; });
  routes.push({ pattern, keys, re: new RegExp(`^${source}/?$`), render });
}

function parseHash() {
  const raw = (typeof location === 'undefined' ? '' : location.hash).replace(/^#/, '');
  const [path, qs = ''] = raw.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(qs)) };
}

export function currentPath() {
  return parseHash().path;
}

const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

function runCleanup() {
  const fn = cleanupFn;
  cleanupFn = null;
  try { fn?.(); } catch (e) { console.error(e); }
}

async function renderRoute() {
  if (!started) return;
  const { path, query } = parseHash();
  const redirect = guardFn?.(path);
  if (redirect && redirect !== path) return go(redirect, { replace: true });

  let route = null;
  let match = null;
  for (const r of routes) {
    match = r.re.exec(path);
    if (match) { route = r; break; }
  }
  const fallback = state.me ? '/nearby' : '/opening';
  if (!route && path !== fallback && routes.some((r) => r.pattern === fallback)) return go(fallback, { replace: true });

  runCleanup();
  closeModals();
  const seq = ++renderSeq;
  const root = document.createElement('main');
  root.className = 'screen';
  host.replaceChildren(root);
  window.scrollTo(0, 0);
  if (!route) return renderFailure(root, new ApiError(404, 'not_found', ''));

  const params = {};
  route.keys.forEach((k, i) => { params[k] = decode(match[i + 1]); });
  try {
    const ret = await route.render({ params, root, query });
    if (typeof ret === 'function') {
      if (seq === renderSeq) cleanupFn = ret;
      else ret(); // the user already moved on
    }
  } catch (err) {
    if (seq === renderSeq) renderFailure(root, err);
  }
}

function renderFailure(root, err) {
  // 401 / blocked already redirected; nothing to show here.
  if (err instanceof ApiError && (err.status === 401 || err.code === 'blocked')) return;
  if (!(err instanceof ApiError)) console.error(err);
  root.classList.add('failed');
  root.replaceChildren(
    topBar({ left: 'back' }),
    el('div', { class: 'failure' },
      el('span', { class: 'failure-icon' }, icon('question', 26)),
      el('p', {}, errorText(err)),
      el('button', { type: 'button', class: 'btn btn-secondary btn-auto', on: { click: () => renderRoute() } }, t('core_retry'))),
  );
}

/** Start routing. guard(path) may return another path to redirect to. */
export function startRouter({ host: target = document.getElementById('app'), guard = null } = {}) {
  host = target;
  guardFn = guard;
  started = true;
  if (typeof history.state?.idx !== 'number') history.replaceState({ idx: 0 }, '');
  window.addEventListener('hashchange', () => renderRoute());
  renderRoute();
}

/** Navigate to '/path' (hash route). replace keeps the history length. Same path re-renders. */
export function go(path, { replace = false } = {}) {
  const clean = String(path).replace(/^#/, '');
  const target = `#${clean.startsWith('/') ? clean : `/${clean}`}`;
  const idx = typeof history.state?.idx === 'number' ? history.state.idx : 0;
  if (replace) history.replaceState({ idx }, '', target);
  else if (location.hash !== target) history.pushState({ idx: idx + 1 }, '', target);
  renderRoute();
}

/** History back inside the app, or Nearby when there is nothing to go back to. */
export function back() {
  if ((history.state?.idx ?? 0) > 0) history.back();
  else go(state.me ? '/nearby' : '/opening', { replace: true });
}

// ---------------------------------------------------------------- DOM

function appendKids(node, kids) {
  for (const c of kids) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) appendKids(node, c);
    else node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

function applyStyle(node, v) {
  if (typeof v === 'string') { node.style.cssText = v; return; }
  for (const [k, val] of Object.entries(v)) {
    if (val == null) continue;
    if (k.startsWith('--')) node.style.setProperty(k, String(val));
    else node.style[k] = val;
  }
}

/**
 * Safe DOM builder — text is always a text node, never parsed as HTML.
 * attrs: { class, text, on:{event:fn}, style, dataset, value, ...attributes }; null/false values are skipped.
 */
export function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs == null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) {
    if (attrs != null) children.unshift(attrs);
    attrs = {};
  }
  let value;
  for (const [key, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (key === 'class' || key === 'className') node.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : String(v);
    else if (key === 'text') node.textContent = String(v);
    else if (key === 'on') { for (const [ev, fn] of Object.entries(v)) if (fn) node.addEventListener(ev, fn); }
    else if (key === 'style') applyStyle(node, v);
    else if (key === 'dataset') Object.assign(node.dataset, v);
    else if (key === 'value') value = v; // after the children, so a <select> has its options
    else if (key.startsWith('on')) { if (typeof v === 'function') node.addEventListener(key.slice(2).toLowerCase(), v); }
    else node.setAttribute(key, v === true ? '' : String(v));
  }
  appendKids(node, children);
  if (value !== undefined) node.value = value;
  return node;
}

// 24×24 stroke icons (constant markup, never user text).
const ICONS = {
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  pin: '<path d="M12 21s-6.5-6.1-6.5-11a6.5 6.5 0 0 1 13 0c0 4.9-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
  target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  heart: '<path fill="currentColor" stroke="none" d="M12 20.6s-7.6-4.6-9.3-9.5C1.5 7.6 3.9 4.4 7.3 4.4c2 0 3.6 1.1 4.7 2.8 1.1-1.7 2.7-2.8 4.7-2.8 3.4 0 5.8 3.2 4.6 6.7-1.7 4.9-9.3 9.5-9.3 9.5z"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>',
  send: '<path d="M4 12 20 4l-6 16-2.5-6.5z"/><path d="M11.5 13.5 20 4"/>',
  shield: '<path d="M12 3l7 3v5.5c0 4.4-3 8.2-7 9.5-4-1.3-7-5.1-7-9.5V6z"/>',
  translate: '<path d="M3.5 5.5h9M8 3.5v2M10.8 5.5c-.8 3.4-3 6.2-6.3 8M5.8 8.6c1.3 2 3.1 3.6 5.2 4.6"/><path d="M12.5 20.5l4-10 4 10M14 17h5"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.3c-.7.3-1.2 1-1.2 1.8v.5"/><circle cx="12" cy="17" r=".7" fill="currentColor"/>',
  flag: '<path d="M5 21V4M5 4.5h11l-2 3.5 2 3.5H5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4 4-6.5 8-6.5s7.2 2.5 8 6.5"/>',
  logout: '<path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M16 16l4-4-4-4M20 12H9"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>',
  chat: '<path d="M4 5.5h16v10.5H9.5L5 20v-4H4z"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/>',
  google: '<path d="M20.5 12.2h-8.2M20.5 12.2a8.5 8.5 0 1 1-2.5-6"/>',
  facebook: '<path d="M14.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.5-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.8 1.4-3.8 4v2.2H9v3h2.5V21"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M4 18l5-5 4 4 3-3 4 4"/>',
  alert: '<path d="M12 3.8 21.2 19.5H2.8z"/><path d="M12 9.6v4.6"/><circle cx="12" cy="16.9" r=".7" fill="currentColor"/>',
};

/** Inline SVG icon (currentColor). Unknown names fall back to 'question'. */
export function icon(name, size = 18) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const attrs = {
    viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', class: `icon icon-${name}`,
  };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, String(v));
  svg.innerHTML = ICONS[name] || ICONS.question;
  return svg;
}

/** Header row: round back/close button, title + mono sub, right slot (string → mono label). */
/** My round photo, top right of every screen → my profile (language, photos, sign out). */
export function meButton(size = 34) {
  if (!state.me) return null;
  return el('button', { type: 'button', class: 'me-btn', 'aria-label': t('core_my_profile'), on: { click: () => go('/me') } },
    avatar(state.me.photos?.[0] || null, size));
}

export function topBar({ left = 'back', title = null, sub = null, right = null, onLeft = null, me = true } = {}) {
  const kind = left === 'close' ? 'close' : 'back';
  const leftBtn = left
    ? el('button', {
      type: 'button', class: 'icon-btn', 'aria-label': t(kind === 'close' ? 'core_close' : 'core_back'),
      on: { click: (e) => (onLeft ? onLeft(e) : back()) },
    }, icon(kind, 18))
    : null;
  const label = (v) => (typeof v === 'string' ? el('span', { class: 'label ink' }, v) : v);
  return el('header', { class: 'topbar' },
    leftBtn,
    el('div', { class: 'topbar-title' },
      title != null ? el('div', { class: 'topbar-h' }, title) : null,
      sub != null ? el('div', { class: 'label' }, sub) : null),
    right != null || me ? el('div', { class: 'topbar-right' }, right != null ? label(right) : null, me ? meButton() : null) : null);
}

/** Three small segments, `level` of them filled. */
export function levelBar(level, total = 3) {
  const n = Math.max(0, Math.min(total, Number(level) || 0));
  return el('span', { class: 'levelbar', role: 'img', 'aria-label': t('core_level_of', { n, total }) },
    Array.from({ length: total }, (_, i) => el('i', { class: i < n ? 'on' : null })));
}

function silhouette() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 40 40');
  svg.setAttribute('class', 'silhouette');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<rect class="sil-bg" width="40" height="40"/><circle class="sil-fg" cx="20" cy="15.5" r="7"/><path class="sil-fg" d="M6 41c1.4-8.6 6.8-13 14-13s12.6 4.4 14 13z"/>';
  return svg;
}

/** Round photo, or a grey silhouette when there is none. size: px number or any CSS length ('100%'). */
export function avatar(url, size = 40) {
  const node = el('span', { class: 'avatar' });
  if (size != null) node.style.setProperty('--size', typeof size === 'number' ? `${size}px` : String(size));
  if (url) {
    const img = el('img', { src: url, alt: '', decoding: 'async', draggable: 'false' });
    img.addEventListener('error', () => img.replaceWith(silhouette()), { once: true });
    node.append(img);
  } else {
    node.append(silhouette());
  }
  return node;
}

const fmtCount = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n));

/** Red (big) + orange (small) heart pills. size 'sm' (grid) or 'lg'. */
export function heartPills(hearts, size = 'sm') {
  const red = Number(hearts?.red) || 0;
  const orange = Number(hearts?.orange) || 0;
  const lg = size === 'lg';
  return el('span', { class: `hearts hearts-${lg ? 'lg' : 'sm'}`, role: 'img', 'aria-label': t('core_hearts_aria', { red, orange }) },
    el('span', { class: 'hp hp-red' }, icon('heart', lg ? 14 : 11), fmtCount(red)),
    el('span', { class: 'hp hp-orange' }, icon('heart', lg ? 11 : 9), fmtCount(orange)));
}

let toastNode = null;
let toastTimer = null;
/** Short message at the bottom of the screen. */
export function toast(text, ms = 2600) {
  if (!toastNode) {
    toastNode = el('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastNode);
  }
  toastNode.textContent = String(text ?? '');
  toastNode.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastNode.classList.remove('show'), ms);
}

const pad2 = (n) => String(n).padStart(2, '0');
export function fmtHMS(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
}

/** Writes HH:MM:SS into node every second until untilIso; then calls onDone once. Returns stop(). */
export function countdown(node, untilIso, onDone) {
  const until = new Date(untilIso).getTime();
  let timer = null;
  let done = false;
  let seen = false;
  const stop = () => { clearInterval(timer); timer = null; };
  const tick = () => {
    if (node.isConnected) seen = true;
    else if (seen) return stop(); // the screen went away without calling stop()
    const left = Number.isFinite(until) ? until - Date.now() : 0;
    node.textContent = fmtHMS(left);
    if (left <= 0 && !done) {
      done = true;
      stop();
      onDone?.();
    }
  };
  tick();
  if (!done) timer = setInterval(tick, 1000);
  return stop;
}

export const pronoun = (gender) => (gender === 'man' ? 'him' : 'her');

const codeOf = (l) => LANG_CODES[l] || String(l || '').toUpperCase();
export const langPair = (myLang, theirLang) => `${codeOf(myLang)}⇄${codeOf(theirLang)}`;

/** '0.4 km' in the UI language's unit ('0.4 公里', '0.4 គ.ម'). Whole numbers (slider ticks) keep no decimal. */
export function fmtKm(km, { whole = false } = {}) {
  const n = Number(km);
  if (km == null || !Number.isFinite(n)) return '';
  const value = whole ? String(Math.round(n)) : Math.max(0.1, Math.round(n * 10) / 10).toFixed(1);
  return t('core_km', { n: value });
}

// ---------------------------------------------------------------- extras shared by screens and app.js

/** Button with the design-system classes. kind: primary | secondary | light | ghost-light | dashed. */
export function button(label, { kind = 'primary', iconName = null, arrow = false, onClick = null, disabled = false, className = '' } = {}) {
  const b = el('button', { type: 'button', class: ['btn', `btn-${kind}`, className], disabled },
    iconName ? icon(iconName, 18) : null, el('span', { class: 'btn-text' }, label), arrow ? icon('arrow', 18) : null);
  if (onClick) b.addEventListener('click', (e) => onClick(b, e));
  return b;
}

const openModals = new Set();
function closeModals() {
  for (const m of [...openModals]) if (!m.sticky) m.close();
}

/** Native <dialog>: centred card, or a bottom sheet. dismissible=false keeps it open until code closes it. */
export function modal(content, { sheet = false, dismissible = true, label = '', className = '' } = {}) {
  const dlg = el('dialog', { class: [sheet ? 'sheet' : 'dialog', className], 'aria-label': label || null },
    sheet ? el('div', { class: 'sheet-grip', 'aria-hidden': 'true' }) : null, content);
  const handle = {
    node: dlg,
    sticky: !dismissible,
    close() {
      if (dlg.open) dlg.close();
      dlg.remove();
      openModals.delete(handle);
    },
  };
  dlg.addEventListener('close', () => handle.close());
  dlg.addEventListener('cancel', (e) => { if (!dismissible) e.preventDefault(); });
  if (dismissible) dlg.addEventListener('click', (e) => { if (e.target === dlg) handle.close(); });
  document.body.append(dlg);
  openModals.add(handle);
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
  return handle;
}

/** 1 for l1_*, 2 for l2_*, 3 for l3_* — the level the stage belongs to (wait stages: the level about to open). */
export function stageLevel(pair) {
  const s = String(pair?.stage || '');
  return s.startsWith('l3') ? 3 : s.startsWith('l2') ? 2 : 1;
}

/** Where a pair's `next` step lives. */
export function pairRoute(pair) {
  if (!pair) return '/nearby';
  const id = encodeURIComponent(pair.id);
  const lvl = stageLevel(pair);
  switch (pair.next) {
    case 'ask': return `/ask/${id}/${lvl}`;
    case 'answer': return `/answer/${id}/${lvl}`;
    case 'ask_answer': return pair.myOutgoing?.sent ? `/answer/${id}/${lvl}` : `/ask/${id}/${lvl}`;
    case 'wait_timer': return `/wait/${id}/${lvl}`;
    case 'chat': return `/chat/${id}`;
    default: return pair.other?.id ? `/person/${encodeURIComponent(pair.other.id)}` : '/nearby';
  }
}

/** One short line for a pair that needs me ("Dara asked you 5", "Level 2 is open", "Chat with Sophea"). */
export function actionLabel(pair) {
  const name = pair?.other?.name || '';
  const lvl = stageLevel(pair);
  switch (pair?.next) {
    case 'answer': return t('act_answer', { name });
    case 'ask': return lvl >= 2 ? t('act_level_open', { n: lvl }) : t('act_ask', { name });
    case 'ask_answer': return t('act_level_open', { n: lvl });
    case 'chat': return t('act_chat', { name });
    case 'wait_timer': return t('act_level_soon', { n: lvl });
    case 'wait_them': return t('act_waiting', { name });
    default: return name;
  }
}

/**
 * "You can now add 1 more photo" (or N) → #/me, for a pair that has opened `openLevel` (2 or 3): shown
 * while slots that level unlocked are still empty in my profile; null otherwise. (A pair that opened a
 * level means I have reached it too, so the slots are really mine to fill.)
 */
export function morePhotosPrompt(openLevel) {
  const lvl = Number(openLevel) || 1;
  if (lvl < 2 || !state.me) return null;
  // MeView.photos is slot-aligned (null = empty slot): count the empty slots this level has unlocked.
  const photos = state.me.photos || [];
  const free = Array.from({ length: photoSlotsFor(lvl) }, (_, i) => !photos[i]).filter(Boolean).length;
  if (free <= 0) return null;
  return el('button', { type: 'button', class: 'photo-prompt', on: { click: () => go('/me') } },
    el('span', { class: 'photo-prompt-icon', 'aria-hidden': 'true' }, icon('camera', 16)),
    el('span', { class: 'grow' }, t(free === 1 ? 'core_more_photo' : 'core_more_photos', { n: free })),
    el('span', { class: 'photo-prompt-go' }, t('core_add_photo'), icon('arrow', 14)));
}

/** ROLES entry text in the UI language. */
export function roleLabel(key) {
  const r = ROLES.find((x) => x.key === key);
  return r ? r.text?.[state.lang] || r.text?.en || r.key : '';
}

/** POST /me/heartbeat → state.actions / state.notices, then 'actions' + 'notices' events. */
export async function heartbeat() {
  if (!state.me || state.me.blocked) return null;
  try {
    const r = await api.post('/me/heartbeat', {});
    state.actions = Array.isArray(r.actions) ? r.actions : [];
    if (Array.isArray(r.notices)) state.notices = r.notices;
    emit('actions', state.actions);
    emit('notices', state.notices);
    return r;
  } catch {
    return null;
  }
}

/** Browser position → { lat, lng }. Rejects with err.code 'denied' | 'unavailable' | 'unsupported' | 'timeout'. */
export function locate({ timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const fail = (code) => reject(Object.assign(new Error(code), { code }));
    if (typeof navigator === 'undefined' || !navigator.geolocation) return fail('unsupported');
    // The permission prompt itself has no timeout; give up if nobody answers it.
    const guard = setTimeout(() => fail('timeout'), timeout + 15000);
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(guard); resolve({ lat: p.coords.latitude, lng: p.coords.longitude }); },
      (e) => { clearTimeout(guard); fail(e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable'); },
      { enableHighAccuracy: false, timeout, maximumAge: 5 * 60e3 },
    );
  });
}

/** Read GPS and send it (POST /me/location) → { area, city }. */
export async function updateLocation() {
  const pos = await locate();
  const r = await api.post('/me/location', pos);
  if (state.me) Object.assign(state.me, { area: r.area ?? '', city: r.city ?? '' });
  return r;
}

const dataUrlBytes = (u) => Math.floor(((u.length - u.indexOf(',') - 1) * 3) / 4);

/** Image file → JPEG data URL, longest side ≤ max px, ≤ maxBytes (lowers quality until it fits). */
export async function resizeImage(file, max = 720, maxBytes = 600 * 1024) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('bad_image'));
      i.src = url;
    });
    const w0 = img.naturalWidth;
    const h0 = img.naturalHeight;
    if (!w0 || !h0) throw new Error('bad_image');
    const scale = Math.min(1, max / Math.max(w0, h0));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w0 * scale));
    canvas.height = Math.max(1, Math.round(h0 * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // transparent PNGs get a white background, not black
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let out = '';
    for (const q of [0.86, 0.78, 0.7, 0.6, 0.5, 0.4]) {
      out = canvas.toDataURL('image/jpeg', q);
      if (dataUrlBytes(out) <= maxBytes) return out;
    }
    throw new Error('too_big');
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------------------------------------------------------------- strings

registerStrings({
  en: {
    core_km: '{n} km',
    core_back: 'Back',
    core_my_profile: 'My profile',
    core_close: 'Close',
    core_retry: 'Try again',
    core_loading: 'Loading…',
    core_level_of: 'Level {n} of {total}',
    core_hearts_aria: '{red} red hearts, {orange} orange hearts',
    err_network: 'No connection. Check your internet and try again.',
    err_generic: 'Something went wrong. Please try again.',
    err_not_found: 'This page is not available.',
    act_answer: '{name} asked you 5',
    act_ask: 'Ask {name} 5 questions',
    act_level_open: 'Level {n} is open',
    act_level_soon: 'Level {n} opens soon',
    act_chat: 'Chat with {name}',
    act_waiting: 'Waiting for {name}',
    core_more_photo: 'You can now add 1 more photo',
    core_more_photos: 'You can now add {n} more photos',
    core_add_photo: 'Add photo',
  },
  km: {
    core_km: '{n} គ.ម',
    core_back: 'ត្រឡប់ក្រោយ',
    core_my_profile: 'ប្រវត្តិរូបរបស់ខ្ញុំ',
    core_close: 'បិទ',
    core_retry: 'ព្យាយាមម្ដងទៀត',
    core_loading: 'កំពុងផ្ទុក…',
    core_level_of: 'កម្រិត {n} នៃ {total}',
    core_hearts_aria: 'បេះដូងក្រហម {red} បេះដូងទឹកក្រូច {orange}',
    err_network: 'គ្មានការតភ្ជាប់។ សូមពិនិត្យអ៊ីនធឺណិត ហើយព្យាយាមម្ដងទៀត។',
    err_generic: 'មានបញ្ហាបន្តិច។ សូមព្យាយាមម្ដងទៀត។',
    err_not_found: 'ទំព័រនេះមិនមានទេ។',
    act_answer: '{name} បានសួរអ្នក 5 សំណួរ',
    act_ask: 'សួរ {name} 5 សំណួរ',
    act_level_open: 'កម្រិត {n} បានបើកហើយ',
    act_level_soon: 'កម្រិត {n} នឹងបើកឆាប់ៗ',
    act_chat: 'ជជែកជាមួយ {name}',
    act_waiting: 'កំពុងរង់ចាំ {name}',
    core_more_photo: 'ឥឡូវនេះ អ្នកអាចបន្ថែមរូបថត 1 សន្លឹកទៀត',
    core_more_photos: 'ឥឡូវនេះ អ្នកអាចបន្ថែមរូបថត {n} សន្លឹកទៀត',
    core_add_photo: 'បន្ថែមរូបថត',
  },
  zh: {
    core_km: '{n} 公里',
    core_back: '返回',
    core_my_profile: '我的资料',
    core_close: '关闭',
    core_retry: '重试',
    core_loading: '加载中…',
    core_level_of: '等级 {n}/{total}',
    core_hearts_aria: '{red} 颗红心，{orange} 颗橙心',
    err_network: '网络未连接，请检查网络后重试。',
    err_generic: '出了点问题，请重试。',
    err_not_found: '此页面不存在。',
    act_answer: '{name} 问了你 5 个问题',
    act_ask: '向 {name} 提 5 个问题',
    act_level_open: '等级 {n} 已开启',
    act_level_soon: '等级 {n} 即将开启',
    act_chat: '和 {name} 聊天',
    act_waiting: '等待 {name} 回应',
    core_more_photo: '现在你可以再添加 1 张照片',
    core_more_photos: '现在你可以再添加 {n} 张照片',
    core_add_photo: '添加照片',
  },
  ko: {
    core_km: '{n}km',
    core_back: '뒤로',
    core_my_profile: '내 프로필',
    core_close: '닫기',
    core_retry: '다시 시도',
    core_loading: '불러오는 중…',
    core_level_of: '레벨 {n}/{total}',
    core_hearts_aria: '빨간 하트 {red}개, 주황 하트 {orange}개',
    err_network: '인터넷에 연결되어 있지 않아요. 연결을 확인하고 다시 시도해 주세요.',
    err_generic: '문제가 생겼어요. 다시 시도해 주세요.',
    err_not_found: '이 페이지를 찾을 수 없어요.',
    act_answer: '{name}님이 5가지를 물었어요',
    act_ask: '{name}님에게 5가지 질문하기',
    act_level_open: '레벨 {n} 열림',
    act_level_soon: '레벨 {n} 곧 열림',
    act_chat: '{name}님과 채팅',
    act_waiting: '{name}님을 기다리는 중',
    core_more_photo: '이제 사진을 1장 더 올릴 수 있어요',
    core_more_photos: '이제 사진을 {n}장 더 올릴 수 있어요',
    core_add_photo: '사진 추가',
  },
  ja: {
    core_km: '{n}km',
    core_back: '戻る',
    core_my_profile: 'マイプロフィール',
    core_close: '閉じる',
    core_retry: 'もう一度',
    core_loading: '読み込み中…',
    core_level_of: 'レベル {n}/{total}',
    core_hearts_aria: '赤いハート{red}個、オレンジのハート{orange}個',
    err_network: '接続できません。インターネットを確認して、もう一度お試しください。',
    err_generic: '問題が発生しました。もう一度お試しください。',
    err_not_found: 'このページは表示できません。',
    act_answer: '{name}さんから5つの質問',
    act_ask: '{name}さんに5つ質問する',
    act_level_open: 'レベル{n}が開きました',
    act_level_soon: 'まもなくレベル{n}',
    act_chat: '{name}さんとチャット',
    act_waiting: '{name}さんを待っています',
    core_more_photo: '写真をあと1枚追加できるようになりました',
    core_more_photos: '写真をあと{n}枚追加できるようになりました',
    core_add_photo: '写真を追加',
  },
});
