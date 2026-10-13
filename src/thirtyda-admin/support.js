// 30+DA admin · Support: questions people send the Telegram bot, and the team's replies (sent by the bot).
// Routes: src/lib/thirtyda-admin.mjs (/30da/admin/api/support…); data: src/lib/thirtyda-support.mjs.
// Everything people wrote is put on the page as text (textContent), never as HTML.

const $ = (id) => document.getElementById(id);
const BASE = '/30da/admin/api/support';
const MAX = 2000;
const REFRESH_MS = 10_000;
const LANG_NAMES = { en: 'English', km: 'Khmer', zh: 'Chinese', ko: 'Korean', ja: 'Japanese' };
const view = { list: null, open: null, thread: null, sending: false };

// ---------- api ----------
async function api(path, body) {
  const res = await fetch(path, body === undefined ? { cache: 'no-store' } : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 401) { location.href = '/30da/admin'; throw new Error('signed out'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Try again.'), { status: res.status });
  return data;
}

// ---------- helpers ----------
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c instanceof Node ? c : String(c));
  return n;
}

const PP = 'Asia/Phnom_Penh';
const fmt = (opts) => new Intl.DateTimeFormat('en-GB', { timeZone: PP, ...opts });
const timeOf = (iso) => fmt({ hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const dayOf = (iso) => fmt({ weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));
const dayKey = (iso) => fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

function ago(iso) {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (dayKey(iso) === dayKey(new Date().toISOString())) return timeOf(iso);
  return dayOf(iso);
}

const initial = (name) => (String(name || '?').trim()[0] || '?').toUpperCase();

let toastTimer = null;
function toast(text) {
  const t = $('toast');
  t.replaceChildren(el('span', {}, text));
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
}

function setBadge(unread) {
  const b = $('support-badge');
  if (!b) return;
  b.textContent = unread > 99 ? '99+' : String(unread);
  b.setAttribute('aria-label', `${unread} unread`);
  b.hidden = !(unread > 0);
}

function tags(c) {
  return [
    c.profileId ? el('span', { class: 'sp-tag profile', title: '30+DA profile (this person verified a number with the bot)' },
      c.profileName ? `${c.profileId} · ${c.profileName}` : c.profileId) : null,
    c.lang && c.lang !== 'en' ? el('span', { class: 'sp-tag' }, LANG_NAMES[c.lang] || c.lang) : null,
    c.blocked ? el('span', { class: 'sp-tag blocked' }, 'Blocked the bot') : null,
  ].filter(Boolean);
}

// ---------- list ----------
function renderList() {
  const d = view.list;
  if (!d) return;
  setBadge(d.unread);
  $('state').textContent = d.unread ? `${d.unread} unread · updated ${timeOf(new Date().toISOString())}` : `All read · updated ${timeOf(new Date().toISOString())}`;
  $('list-count').textContent = d.chats.length ? String(d.chats.length) : '';
  const banner = $('bot-banner');
  if (!d.bot?.set) {
    banner.replaceChildren('The Telegram bot is not set up on this site, so nobody can write to it yet. Save its key on the ',
      el('a', { href: '/30da/admin/connections' }, 'Code page'), '.');
    banner.hidden = false;
  } else if (!d.bot.offered) {
    banner.replaceChildren(`The bot @${d.bot.username} is saved but its last Try did not pass. People can still write to it; press Try on the `,
      el('a', { href: '/30da/admin/connections' }, 'Code page'), ' so the app offers it again.');
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
  $('no-chats').hidden = d.chats.length > 0;
  $('chats').replaceChildren(...d.chats.map((c) => el('li', {},
    el('button', {
      type: 'button',
      class: ['sp-chat', c.unread > 0 && 'is-unread'],
      'aria-current': view.open === c.chatId ? 'true' : null,
      'data-chat': c.chatId,
      onclick: () => openChat(c.chatId),
    },
    el('span', { class: 'sp-ava', 'aria-hidden': 'true' }, initial(c.name)),
    el('span', { class: 'sp-name' }, el('b', {}, c.name), c.username ? el('small', {}, c.username) : null),
    el('span', { class: 'sp-when' }, ago(c.lastAt)),
    el('span', { class: 'sp-last' }, `${c.lastDir === 'out' ? 'You: ' : ''}${c.lastText}`),
    c.unread > 0 ? el('span', { class: 'sp-unread', 'aria-label': `${c.unread} unread` }, String(c.unread)) : el('span', {}),
    tags(c).length ? el('span', { class: 'sp-tags' }, tags(c)) : null))));
}

async function loadList() {
  try {
    view.list = await api(BASE);
    renderList();
  } catch (e) {
    if (e.message !== 'signed out') $('state').textContent = 'Offline · retrying';
  }
}

// ---------- one conversation ----------
function renderThread({ keepScroll = false } = {}) {
  const t = view.thread;
  const open = Boolean(t);
  $('cols').classList.toggle('is-open', open);
  $('pick').hidden = open;
  $('open').hidden = !open;
  if (!open) return;
  const c = t.chat;
  $('thread-title').textContent = c.name;
  $('who').replaceChildren(
    c.username ? el('span', {}, c.username) : el('span', {}, 'No @username'),
    el('span', { 'aria-hidden': 'true' }, '·'),
    el('span', {}, `Writing since ${dayOf(c.firstAt || c.lastAt)}`),
    ...tags(c),
  );
  const box = $('msgs');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  let lastDay = null;
  const rows = [];
  for (const m of t.messages) {
    const key = dayKey(m.at);
    if (key !== lastDay) { rows.push(el('div', { class: 'sp-day' }, dayOf(m.at))); lastDay = key; }
    rows.push(el('div', { class: ['sp-msg', m.dir] },
      el('div', { class: 'sp-bubble' }, m.text),
      el('span', { class: 'sp-meta' }, `${m.dir === 'out' ? 'Team (sent by the bot)' : c.name} · ${timeOf(m.at)}`)));
  }
  box.replaceChildren(...rows);
  if (!keepScroll || atBottom) box.scrollTop = box.scrollHeight;
  if (c.blocked) setStatus('This person has blocked the bot: a reply will not reach them until they write again.', 'error');
}

async function openChat(chatId, { refresh = false } = {}) {
  try {
    const t = await api(`${BASE}/${encodeURIComponent(chatId)}${refresh ? '?refresh=1' : ''}`);
    const changed = view.open !== chatId;
    view.open = chatId;
    view.thread = t;
    if (changed) { setStatus(''); $('reply').value = ''; count(); }
    renderThread({ keepScroll: refresh });
    if (!refresh && location.hash !== `#c=${chatId}`) history.replaceState(null, '', `#c=${chatId}`);
    if (!refresh) { await loadList(); if (window.matchMedia('(max-width: 760px)').matches) window.scrollTo(0, 0); }
  } catch (e) {
    if (e.message === 'signed out') return;
    if (e.status === 404) { closeChat(); toast('That conversation is not there any more.'); return; }
    if (!refresh) toast(e.message);
  }
}

function closeChat() {
  view.open = null;
  view.thread = null;
  history.replaceState(null, '', location.pathname);
  renderThread();
  renderList();
}

// ---------- reply ----------
function setStatus(text, kind = '') {
  const s = $('status');
  s.textContent = text;
  s.className = ['sp-status', kind].filter(Boolean).join(' ');
}

function count() {
  const n = $('reply').value.length;
  const c = $('count');
  c.textContent = `${n} / ${MAX}`;
  c.classList.toggle('near', n > MAX - 200);
}

async function send() {
  if (view.sending || !view.open) return;
  const text = $('reply').value;
  if (!text.trim()) { setStatus('Write a reply first.', 'error'); $('reply').focus(); return; }
  if (text.trim().length > MAX) { setStatus(`A reply can be at most ${MAX} characters.`, 'error'); return; }
  view.sending = true;
  $('send').disabled = true;
  setStatus('Sending…');
  try {
    const r = await api(`${BASE}/${encodeURIComponent(view.open)}/reply`, { text });
    $('reply').value = '';
    count();
    if (r.chat) view.thread = { chat: r.chat, messages: r.messages };
    renderThread();
    setStatus('Sent ✓ The bot delivered it.', 'ok');
    loadList();
  } catch (e) {
    if (e.message !== 'signed out') setStatus(e.message, 'error');
    // A refused reply may have changed the conversation (blocked): show it as it is now.
    if (view.open) openChat(view.open, { refresh: true });
  } finally {
    view.sending = false;
    $('send').disabled = false;
  }
}

$('reply-form').addEventListener('submit', (e) => { e.preventDefault(); send(); });
$('reply').addEventListener('input', () => { count(); if ($('status').classList.contains('error')) setStatus(''); });
$('reply').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });
$('back').addEventListener('click', closeChat);
$('signout').addEventListener('click', async () => {
  await fetch('/30da/admin/api/signout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  location.href = '/30da/admin';
});

// ---------- start + keep fresh ----------
await loadList();
const fromHash = location.hash.match(/^#c=(\d{1,16})$/);
if (fromHash) await openChat(Number(fromHash[1]));
else renderThread();
setInterval(() => {
  if (document.hidden) return;
  loadList();
  if (view.open && !view.sending) openChat(view.open, { refresh: true });
}, REFRESH_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadList(); });
// A link to one conversation (#c=<chat id>) opened on this page.
window.addEventListener('hashchange', () => {
  const c = location.hash.match(/^#c=(\d{1,16})$/);
  if (c && Number(c[1]) !== view.open) openChat(Number(c[1]));
});
