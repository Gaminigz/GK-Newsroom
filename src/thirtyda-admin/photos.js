// 30+DA admin · Photos: new and changed photos wait here until the team approves them (store policy, owner 2026-10-14).
// Routes: src/lib/thirtyda-admin.mjs (/30da/admin/api/photos…); the rules: src/lib/thirtyda-photo-review.mjs.
// Photo 1 first (the face Nearby shows), then the oldest. Approve → everyone may see it. Reject → the photo is deleted
// and the person is told; "Also block this person" blocks them too. Names go on the page as text, never as HTML.

const $ = (id) => document.getElementById(id);
const API = '/30da/admin/api/photos';
const REFRESH_MS = 20_000;
const SLOT_NAMES = { 1: 'Photo 1 · main', 2: 'Photo 2 · Level 2', 3: 'Photo 3 · Level 3', 4: 'Photo 4 · Level 3' };
const view = { photos: [], busy: false, confirming: null };

// ---------- api ----------
async function api(path, body) {
  const res = await fetch(path, body === undefined ? { cache: 'no-store' } : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 401) { location.href = '/30da/admin'; throw new Error('signed out'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Try again.'), { status: res.status, data });
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

function ago(iso) {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

let toastTimer = null;
function toast(text) {
  const t = $('toast');
  t.replaceChildren(el('span', {}, text));
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
}

function setBadge(n) {
  const b = $('photos-badge');
  if (!b) return;
  b.textContent = n > 99 ? '99+' : String(n);
  b.setAttribute('aria-label', `${n} waiting`);
  b.hidden = !(n > 0);
}

const keyOf = (p) => `${p.user}/${p.index}/${p.photoId}`;

// ---------- render ----------
function card(p) {
  const key = keyOf(p);
  const confirming = view.confirming === key;
  const block = el('input', { type: 'checkbox', id: `block-${p.user}-${p.index}` });
  const approve = el('button', {
    type: 'button', class: 'btn-primary ph-approve', disabled: view.busy, onclick: () => decide(p, 'approve'),
  }, 'Approve');
  const reject = el('button', {
    type: 'button', class: 'btn block ph-reject', disabled: view.busy, onclick: () => { view.confirming = key; render(); },
  }, 'Reject');
  const confirm = el('div', { class: 'ph-confirm', role: 'group', 'aria-label': 'Reject this photo' },
    el('p', {}, 'Delete this photo and tell the person?'),
    el('label', { class: 'ph-check', for: block.id }, block, 'Also block this person'),
    el('div', { class: 'ph-confirm-row' },
      el('button', {
        type: 'button', class: 'btn block', disabled: view.busy, onclick: () => decide(p, 'reject', { block: block.checked }),
      }, 'Yes, reject'),
      el('button', { type: 'button', class: 'link', onclick: () => { view.confirming = null; render(); } }, 'Cancel')));
  return el('li', { class: ['ph-card', p.index === 0 && 'is-main'] },
    el('div', { class: 'ph-img' },
      el('img', { src: p.url, alt: `${SLOT_NAMES[p.slot] || `Photo ${p.slot}`} of ${p.name || p.user}`, loading: 'lazy' })),
    el('div', { class: 'ph-meta' },
      el('div', { class: 'ph-who' }, el('b', {}, p.name || '—'), el('small', {}, p.user)),
      el('div', { class: 'ph-tags' },
        el('span', { class: ['tag', 'ph-slot', p.index === 0 && 'main'] }, SLOT_NAMES[p.slot] || `Photo ${p.slot}`),
        // Nothing of theirs is public now: others see a silhouette until a photo is approved.
        p.nonePublic ? el('span', { class: 'tag ph-none', title: 'Others see a grey silhouette until you approve a photo' }, 'No public photo') : null,
        p.blocked ? el('span', { class: 'tag ph-blocked' }, 'Blocked') : null),
      el('time', { datetime: p.at || '' }, ago(p.at))),
    confirming ? confirm : el('div', { class: 'ph-actions' }, approve, reject));
}

function render() {
  const n = view.photos.length;
  $('state').textContent = n === 1 ? '1 photo waiting' : `${n} photos waiting`;
  setBadge(n);
  $('none').hidden = n > 0;
  $('grid').replaceChildren(...view.photos.map(card));
}

// ---------- actions ----------
async function load() {
  if (view.busy || view.confirming) return;
  try {
    const d = await api(API);
    view.photos = d.photos || [];
    render();
  } catch (e) {
    if (e.message !== 'signed out') $('state').textContent = 'Offline, retrying…';
  }
}

async function decide(p, what, { block = false } = {}) {
  if (view.busy) return;
  view.busy = true;
  render();
  try {
    const d = await api(`${API}/${encodeURIComponent(p.user)}/${p.index}/${what}`, { photoId: p.photoId, ...(what === 'reject' ? { block } : {}) });
    view.photos = d.photos || [];
    const who = p.name || p.user;
    toast(what === 'approve' ? `Approved ${who}'s photo ${p.slot}.`
      : d.blocked ? `Rejected and blocked ${who}. They were told.` : `Rejected ${who}'s photo ${p.slot}. They were told.`);
  } catch (e) {
    if (e.data?.photos) view.photos = e.data.photos;
    toast(e.message);
  } finally {
    view.busy = false;
    view.confirming = null;
    render();
  }
}

$('signout').addEventListener('click', async () => {
  await fetch('/30da/admin/api/signout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  location.href = '/30da/admin';
});

// ---------- start + keep fresh ----------
await load();
setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
