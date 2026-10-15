const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Text only: a name or anything else from a profile goes on the page through textContent, never as HTML.
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

const view = { data: null, filter: 'all', query: '', tab: 'queue', chatFor: null, chat: null };

// ---------- api ----------
async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 401) { location.href = '/30da/admin'; throw new Error('signed out'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: res.status, data });
  return data;
}

async function refresh() {
  try {
    view.data = await api('/30da/admin/api/overview');
    render();
  } catch (e) {
    if (e.message !== 'signed out') $('updated').textContent = 'Live · offline, retrying';
  }
}

// Returns the server's answer (or null after showing the error).
async function act(path, body = {}) {
  try {
    const data = await api(path, body);
    view.data = data;
    if (view.tab === 'log' && view.chatFor) await loadChat(view.chatFor);
    render();
    return data;
  } catch (e) {
    toast(e.message);
    return null;
  }
}

async function loadChat(target) {
  view.chatFor = target;
  const q = target.flag ? `flag=${encodeURIComponent(target.flag)}` : `user=${encodeURIComponent(target.user)}`;
  view.chat = (await api(`/30da/admin/api/chat?${q}`)).chat;
}

// ---------- helpers ----------
function ago(iso) {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return `${h} h ago`;
}

function highlight(text, hit) {
  if (!hit || !text.includes(hit)) return esc(text);
  return text.split(hit).map(esc).join(`<mark class="hit">${esc(hit)}</mark>`);
}

function bubble(m) {
  const en = m.english ? ` <span class="en">/ ${highlight(m.english, m.hit)}</span>` : '';
  return `<div class="bubble">${highlight(m.text, m.hit)}${en}</div>`;
}

// Levels 1–2 rows say which line they are: a line someone sent, or the reply to it — a short typed reply (1–10
// characters, owner 2026-10-14; older ones were taps: Yes / No / Not really / Maybe). A stopped reply that was split
// down several replies keeps the pieces one per line (the bubble keeps the line breaks).
function rowLabel(m) {
  const lv = m.level === 1 || m.level === 2 ? `L${m.level} · ` : '';
  if (m.kind === 'question') return m.n ? `${lv}line ${m.n}` : `${lv}line`;
  if (m.kind === 'answer') return m.n ? `${lv}reply to line ${m.n}` : `${lv}reply`;
  return '';
}

// ---------- meetings in the Level 3 chat (owner 2026-10-14, src/lib/thirtyda-meet.mjs) ----------
// A meeting is a message { kind: 'meet', meet: { at, place: { name, address, lat, lng }, status, note, doneBy } }: shown as
// what it is (when, where, the Google Maps link, how it stands), always in Phnom Penh time like the app shows it.
function ppWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Phnom_Penh', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(d);
  } catch {
    return new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  }
}

function mapsLink(place) {
  const point = Number.isFinite(place?.lat) && Number.isFinite(place?.lng);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(point ? `${place.lat},${place.lng}` : String(place?.name ?? ''))}`;
}

function meetHtml(m, people) {
  const x = m.meet || {};
  const p = x.place || {};
  const by = x.doneBy ? people?.[x.doneBy] ?? x.doneBy : '';
  const status = x.status === 'accepted' ? `Accepted by ${by}`
    : x.status === 'declined' ? `Declined by ${by}`
      : x.status === 'cancelled' && x.note === 'replaced' ? `Replaced by a new suggestion (${by})`
        : x.status === 'cancelled' ? `Cancelled by ${by}`
          : 'Waiting for an answer';
  return `<div class="bubble meet"><b>Meeting</b> · ${esc(ppWhen(x.at))} (Phnom Penh time)<br>
    <b>${esc(p.name)}</b>${p.address ? ` · ${esc(p.address)}` : ''}${Number.isFinite(p.lat) ? '' : ' <span class="en">(no map pin: typed name)</span>'}
    · <a href="${esc(mapsLink(p))}" target="_blank" rel="noopener noreferrer">Google Maps</a>
    <span class="en"> · ${esc(status)}</span></div>`;
}

const levelBars = (n) =>
  `<span class="level" aria-label="Level ${n}">${[1, 2, 3].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}<span>L${n}</span></span>`;

const avatar = `<span class="avatar" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 14 14" fill="#a5adbb"><circle cx="7" cy="5" r="3"/><path d="M1.5 13.5c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5z"/></svg></span>`;

// ---------- render ----------
function render() {
  const d = view.data;
  if (!d) return;
  $('updated').textContent = `Live · updated ${ago(d.updatedAt)}`;
  $('s-online').textContent = d.stats.online;
  $('s-l3').textContent = d.stats.level3Chats;
  $('s-flags').textContent = d.stats.openFlags;
  $('s-blocked').textContent = d.stats.blocked;
  // App review accounts are counted on their own (not in Online now / Level 3 chats).
  $('s-review').textContent = d.stats.reviewAccounts ? `${d.stats.reviewAccounts} App review accounts (not counted above)` : '';
  $('q-count').textContent = d.stats.openFlags;
  $('nav-badge').textContent = d.stats.openFlags;
  $('nav-badge').hidden = !d.stats.openFlags;
  renderFilters();
  renderUsers();
  renderMonitor();
}

function counts() {
  const u = view.data.users;
  return {
    all: u.length,
    online: u.filter((x) => !x.blocked && x.presence === 'online').length,
    flagged: u.filter((x) => x.openFlags > 0).length,
    blocked: u.filter((x) => x.blocked).length,
  };
}

function renderFilters() {
  const c = counts();
  const names = { all: 'All', online: 'Online', flagged: 'Flagged', blocked: 'Blocked' };
  $('filters').innerHTML = Object.keys(names)
    .map((k) => `<button type="button" class="chip ${view.filter === k ? 'active' : ''}" data-filter="${k}" aria-pressed="${view.filter === k}">${names[k]} · ${c[k]}</button>`)
    .join('');
}

function renderUsers() {
  const q = view.query.trim().toLowerCase();
  const rows = view.data.users.filter((u) => {
    if (q && !u.name.toLowerCase().includes(q) && !u.id.toLowerCase().includes(q)) return false;
    if (view.filter === 'online') return !u.blocked && u.presence === 'online';
    if (view.filter === 'flagged') return u.openFlags > 0;
    if (view.filter === 'blocked') return u.blocked;
    return true;
  });
  $('no-users').hidden = rows.length > 0;
  $('user-rows').innerHTML = rows.map((u) => {
    const status = u.blocked ? 'blocked' : u.presence;
    return `<tr class="${u.blocked ? 'is-blocked' : ''}">
      <td><span class="who">${avatar}<span><b>${esc(u.name)}${u.review ? ' <span class="tag">App review</span>' : ''}</b><small>${esc(u.id)}</small></span></span></td>
      <td class="photos-cell" data-photos-cell="${esc(u.id)}"></td>
      <td>${levelBars(u.level)}</td>
      <td class="born">${Number.isInteger(u.birthYear) ? u.birthYear : '<span class="muted">–</span>'}</td>
      <td>${esc(u.language)}</td>
      <td>${esc(u.area)}</td>
      <td><span class="status"><span class="dot ${status}"></span>${status}</span></td>
      <td><span class="count ${u.openFlags ? 'hot' : ''}">${u.openFlags}</span></td>
      <td><span class="row-actions">
        <button type="button" class="link" data-chat-user="${esc(u.id)}">View chat</button>
        <button type="button" class="link" data-photos="${esc(u.id)}" aria-label="Photos of ${esc(u.name || u.id)}">Photos</button>
        ${u.blocked
          ? `<button type="button" class="link" data-unblock="${esc(u.id)}">Unblock</button>`
          : `<button type="button" class="link danger" data-block="${esc(u.id)}">Block</button>`}
        <button type="button" class="link danger" data-delete="${esc(u.id)}">Delete</button>
      </span></td>
    </tr>`;
  }).join('');
  // The 4 thumbnails, slot-aligned (built as elements: the <img> already on the page is reused, see thumbImg).
  const byId = new Map(rows.map((u) => [u.id, u]));
  $('user-rows').querySelectorAll('td[data-photos-cell]').forEach((td) => td.append(photoThumbs(byId.get(td.dataset.photosCell))));
  forgetThumbs();
}

function renderMonitor() {
  $('tab-queue').classList.toggle('active', view.tab === 'queue');
  $('tab-log').classList.toggle('active', view.tab === 'log');
  $('tab-queue').setAttribute('aria-selected', view.tab === 'queue');
  $('tab-log').setAttribute('aria-selected', view.tab === 'log');
  $('monitor-body').innerHTML = view.tab === 'queue' ? queueHtml() : logHtml();
}

function queueHtml() {
  const flags = view.data.flags;
  if (!flags.length) return '<p class="empty">No open flags. All calm.</p>';
  return flags.map((f) => {
    // Store policy (owner 2026-10-14): a person blocked in the app, or a report on a profile / photo / written line.
    const target = f.targetLabel ? ` · ${esc(f.targetLabel)}` : '';
    // A stopped name (bad words, owner 2026-10-14) has no conversation and nobody on the other side.
    const how = f.kind === 'stopped' && f.field ? 'Stopped by the app · name not saved'
      : f.kind === 'stopped' ? 'Stopped by the app before sending'
      : f.kind === 'blocked' ? `${esc(f.toName)} blocked ${esc(f.fromName)} in the app`
        : f.guest ? `A guest (no profile yet) reported it${target}` // POST /guest/report
          : `Delivered · ${esc(f.toName)} reported it${target}`;
    const body = f.photo ? `<img class="flag-photo" src="${esc(f.photo)}" alt="Reported photo" loading="lazy">`
      : f.message?.text ? bubble(f.message) : '';
    const tag = f.level ? `<span class="tag">Level ${f.level} ${esc(f.levelName)}</span>` : f.targetLabel ? `<span class="tag">${esc(f.targetLabel)}</span>` : '';
    return `<article class="flag">
      <div class="flag-top"><b>${esc(f.fromName)}${f.to ? ` → ${esc(f.toName)}` : ''}</b>${tag}<time datetime="${f.at}">${ago(f.at)}</time></div>
      <div class="reason">
        <svg width="9" height="10" viewBox="0 0 9 10" fill="none" aria-hidden="true"><path d="M1.5 9.5V1M1.5 1.3h5.5L5.8 3.4 7 5.5H1.5" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>
        ${esc(f.reason)}
      </div>
      ${body}
      <div class="label how">${how}</div>
      <div class="flag-actions">
        <button type="button" class="btn block" data-block="${esc(f.from)}" data-flag="${esc(f.id)}">Block ${esc(f.fromName)}</button>
        <button type="button" class="btn" data-warn="${esc(f.id)}" ${f.warned ? 'disabled' : ''}>${f.warned ? 'Warning sent' : 'Send warning'}</button>
      </div>
      <div class="flag-links">
        ${f.field || f.guest ? '' : `<button type="button" class="link" data-chat-flag="${esc(f.id)}">View chat</button>`}
        <button type="button" class="link plain" data-dismiss="${esc(f.id)}">Dismiss</button>
      </div>
    </article>`;
  }).join('');
}

function logHtml() {
  const c = view.chat;
  if (!view.chatFor) return '<p class="empty">Pick “View chat” on a flag or a user to read the full conversation.</p>';
  if (!c) {
    const u = view.data.users.find((x) => x.id === view.chatFor.user);
    return `<p class="empty">No chats on record for ${esc(u?.name ?? 'this user')} yet.</p>`;
  }
  const names = Object.values(c.people);
  const msgs = c.messages.map((m) => {
    const note = m.flag
      ? `<div class="note">${m.flag.kind === 'stopped' ? 'Stopped by the app · not delivered' : 'Delivered · reported'} · ${esc(m.flag.reason)}${m.flag.status !== 'open' ? ` · ${esc(m.flag.status)}` : ''}</div>`
      : '';
    // After Level 2: each person's choice (open the chat / forget it), shown as a note, not a message.
    // A meeting (delivered): when, where, the map link and how it stands. A stopped one shows the place text it tried.
    const body = m.kind === 'meet' && m.meet && !m.stopped ? meetHtml(m, c.people) : bubble(m);
    const what = m.kind === 'meet' ? ' · meeting' : '';
    return `<div class="msg ${m.flag ? 'flagged' : ''} ${m.kind === 'decision' ? 'decision' : ''}">
      <div class="msg-meta"><span><b>${esc(m.fromName)}${what}</b>${rowLabel(m) ? ` <span class="tag row-tag">${esc(rowLabel(m))}</span>` : ''}</span><time datetime="${m.at}">${ago(m.at)}</time></div>
      ${body}${note}
    </div>`;
  }).join('');
  const ended = c.endedAt ? ` · <span class="tag ended">Ended ${ago(c.endedAt)}</span>` : '';
  return `<div class="chatlog-head"><b>${esc(names[0])} ↔ ${esc(names[1])}</b> · <span class="tag">Level ${c.level} ${esc(c.levelName)}</span>${ended}</div>${msgs}`;
}

// ---------- Users → Photos (owner 2026-10-15: "the 4 photo preview and has function to manually view and approve or
// disqualify") ----------
// The table draws every profile's 4 slots from the overview (photos: 4 × { photoId, status }, ids + status only): an
// empty slot is a dashed box, a photo waiting for approval has an amber ring. A thumbnail, or the row's "Photos", opens
// the 4 slots large: Approve (a pending photo), Disqualify (any photo — deleted, the person told, blocked if asked).
// An App review account is view-only: its photos change on the App review page. Routes: src/lib/thirtyda-admin.mjs
// (/30da/admin/api/users/:id/photos…); the rules: src/lib/thirtyda-photo-review.mjs.
const SLOT_NAMES = ['Photo 1 · main', 'Photo 2 · Level 2', 'Photo 3 · Level 3', 'Photo 4 · Level 3'];
const PHOTOS_API = (id) => `/30da/admin/api/users/${encodeURIComponent(id)}/photos`;
// The url carries the photo id: a replaced photo is a new url (the server answers only while that id is in that slot).
const thumbSrc = (id, index, photoId) => `${PHOTOS_API(id)}/${index}?id=${encodeURIComponent(photoId)}&size=thumb`;

// The photos are never cached (no-store): the <img> already on the page is moved into the redrawn row, so the 15 s
// refresh never loads them again. Keyed by url; dropped once no profile in the overview has that photo any more, or
// once it fails to load (a redeploy, the network gone): the next refresh then draws a new <img> that asks again.
const thumbImgs = new Map();
function thumbImg(src) {
  let img = thumbImgs.get(src);
  if (!img) {
    img = el('img', { src, alt: '', loading: 'lazy', decoding: 'async', width: 24, height: 32 });
    img.addEventListener('error', () => { if (thumbImgs.get(src) === img) thumbImgs.delete(src); }, { once: true });
    thumbImgs.set(src, img);
  }
  return img;
}
function forgetThumbs() {
  const live = new Set(view.data.users.flatMap((u) => (u.photos || []).map((p, i) => (p.photoId ? thumbSrc(u.id, i, p.photoId) : null))));
  for (const src of thumbImgs.keys()) if (!live.has(src)) thumbImgs.delete(src);
}

function photoThumbs(u) {
  const who = u.name || u.id;
  return el('span', { class: 'thumbs' }, (u.photos || []).map((p, i) => {
    if (!p.photoId) return el('span', { class: 'thumb empty', role: 'img', 'aria-label': `${SLOT_NAMES[i]}: empty`, title: `${SLOT_NAMES[i]}: empty` });
    const pending = p.status === 'pending';
    return el('button', {
      type: 'button', class: ['thumb', pending && 'pending'], 'data-photos': u.id, 'data-slot': i,
      title: pending ? 'Waiting for approval' : SLOT_NAMES[i],
      'aria-label': `${SLOT_NAMES[i]} of ${who}${pending ? ', waiting for approval' : ''}`,
    }, thumbImg(thumbSrc(u.id, i, p.photoId)));
  }));
}

function setPhotosBadge(n) {
  const b = $('photos-badge');
  if (!b || !Number.isFinite(n)) return;
  b.textContent = n > 99 ? '99+' : String(n);
  b.setAttribute('aria-label', `${n} waiting`);
  b.hidden = !(n > 0);
}

// The dialog: built once, the admin's dialog style (app.css .ad-dialog). pd.asking = the slot whose Disqualify waits
// for "Yes, disqualify", pd.blockChoice = its "Also block this person" (kept across the redraws while it is sent);
// pd.opener = what to give the focus back to (the table may be redrawn meanwhile); pd.opened counts the openings (an
// answer is drawn only into the opening that asked, see decidePhoto).
const pd = {
  dlg: null, parts: null, user: null, view: null, asking: null, blockChoice: false, busy: false, opener: null, opened: 0, imgs: new Map(),
};

function photosDialog() {
  if (pd.dlg) return;
  const title = el('h2', { id: 'pd-title' });
  const sub = el('p', { class: 'pd-sub', id: 'pd-sub' });
  const close = el('button', { type: 'button', class: 'pd-close', 'aria-label': 'Close', 'data-pd': 'close', onclick: () => { if (!pd.busy) pd.dlg.close(); } }, '×');
  const note = el('p', { class: 'pd-note', hidden: true });
  const done = el('p', { class: 'pd-done', role: 'status' });
  const error = el('p', { class: 'form-error', role: 'alert', hidden: true });
  const grid = el('ul', { class: 'pd-grid', 'aria-label': 'Photo 1 to photo 4' });
  pd.dlg = el('dialog', { class: 'ad-dialog pd-dialog', id: 'photos-dialog', 'aria-labelledby': 'pd-title', 'aria-describedby': 'pd-sub' },
    el('div', { class: 'pd-head' }, el('div', { class: 'pd-titles' }, title, sub), close), note, error, done, grid);
  pd.parts = { title, sub, note, done, error, grid };
  // Esc closes (not while a decision is on its way); Tab stays inside the dialog.
  pd.dlg.addEventListener('cancel', (e) => { if (pd.busy) e.preventDefault(); });
  pd.dlg.addEventListener('close', photosClosed);
  pd.dlg.addEventListener('keydown', keepFocusInside);
  document.body.append(pd.dlg);
}

function keepFocusInside(e) {
  if (e.key !== 'Tab') return;
  const items = [...pd.dlg.querySelectorAll('button, a[href], input')].filter((n) => !n.disabled && n.getClientRects().length);
  if (!items.length) return;
  const [first, last] = [items[0], items.at(-1)];
  if (e.shiftKey && (document.activeElement === first || !pd.dlg.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (document.activeElement === last || !pd.dlg.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
}

function photosClosed() {
  const o = pd.opener;
  Object.assign(pd, { user: null, view: null, asking: null, blockChoice: false, busy: false, opener: null });
  pd.imgs.clear();
  pd.parts.grid.replaceChildren();
  // Back to the same thumbnail, or the row's "Photos" (the rows may have been redrawn, the thumbnail gone).
  const id = CSS.escape(o?.user ?? '');
  const back = (o?.slot != null && document.querySelector(`button.thumb[data-photos="${id}"][data-slot="${CSS.escape(String(o.slot))}"]`))
    || document.querySelector(`button.link[data-photos="${id}"]`);
  back?.focus();
}

async function openPhotos(userId, opener) {
  photosDialog();
  if (pd.dlg.open) return;
  Object.assign(pd, { user: userId, view: null, asking: null, blockChoice: false, busy: false, opener, opened: pd.opened + 1 });
  pd.imgs.clear();
  const { title, sub, note, done, error, grid } = pd.parts;
  title.textContent = `Photos · ${view.data?.users.find((u) => u.id === userId)?.name || userId}`;
  sub.textContent = 'Loading…';
  note.hidden = true;
  error.hidden = true;
  done.textContent = '';
  grid.replaceChildren();
  pd.dlg.showModal(); // the focus is on Close until the photos are in
  try {
    const v = await api(PHOTOS_API(userId));
    if (pd.user !== userId) return; // closed meanwhile
    pd.view = v;
    // The focus goes to the first thing to decide: the first photo's Approve (waiting) or Disqualify.
    const first = v.user.review ? null : v.slots.find((s) => s.photoId);
    renderPhotos(first ? `${first.status === 'pending' ? 'approve' : 'disqualify'}-${first.index}` : null);
  } catch (e) {
    if (e.message === 'signed out' || pd.user !== userId) return;
    sub.textContent = userId;
    error.textContent = e.message;
    error.hidden = false;
  }
}

// One slot of the dialog: the photo large (or an empty box), its name and status, and what can be done with it.
function slotCard(v, s) {
  const who = v.user.name || v.user.id;
  const name = SLOT_NAMES[s.index];
  const pending = s.status === 'pending';
  let actions = null;
  if (s.photoId && !v.user.review && pd.asking === s.index) {
    // Drawn again while "Yes, disqualify" is on its way: still ticked as the admin left it, and no longer to change.
    const block = el('input', {
      type: 'checkbox', id: `pd-block-${s.index}`, checked: pd.blockChoice, disabled: pd.busy,
      onchange: (e) => { pd.blockChoice = e.target.checked; },
    });
    actions = el('div', { class: 'pd-ask', role: 'group', 'aria-label': `Disqualify ${name} of ${who}` },
      el('p', {}, `The photo is deleted and ${who} is told to use a clear photo of their face.`),
      el('label', { class: 'pd-check', for: block.id }, block, 'Also block this person'),
      el('div', { class: 'pd-ask-row' },
        el('button', {
          type: 'button', class: 'btn block', disabled: pd.busy, 'data-pd': `yes-${s.index}`,
          onclick: () => decidePhoto(s, 'disqualify', { block: block.checked }),
        }, 'Yes, disqualify'),
        el('button', {
          type: 'button', class: 'link', disabled: pd.busy, 'data-pd': `cancel-${s.index}`,
          onclick: () => { pd.asking = null; pd.blockChoice = false; renderPhotos(`disqualify-${s.index}`); },
        }, 'Cancel')));
  } else if (s.photoId && !v.user.review) {
    actions = el('div', { class: 'pd-actions' },
      pending ? el('button', {
        type: 'button', class: 'btn-primary', disabled: pd.busy, 'data-pd': `approve-${s.index}`, 'aria-label': `Approve ${name} of ${who}`,
        onclick: () => decidePhoto(s, 'approve'),
      }, 'Approve') : null,
      el('button', {
        type: 'button', class: 'btn block', disabled: pd.busy, 'data-pd': `disqualify-${s.index}`, 'aria-label': `Disqualify ${name} of ${who}`,
        onclick: () => { pd.asking = s.index; pd.blockChoice = false; pd.parts.done.textContent = ''; renderPhotos(`cancel-${s.index}`); },
      }, 'Disqualify'));
  } else if (pending) {
    // An App review account's photo still waiting (a profile made a review account): the Photos page approves it.
    actions = el('p', { class: 'pd-hint' }, 'Approve it on the ', el('a', { href: '/30da/admin/photos' }, 'Photos page'), '.');
  }
  let img = el('span', { class: 'pd-none' }, 'No photo');
  if (s.url) {
    // Kept while the dialog is open: a redraw after a decision does not load the other photos again.
    img = pd.imgs.get(s.url) ?? el('img', { src: s.url, alt: `${name} of ${who}`, decoding: 'async' });
    pd.imgs.set(s.url, img);
  }
  return el('li', { class: ['pd-slot', pending && 'is-pending', !s.photoId && 'is-empty'] },
    el('div', { class: 'pd-img' }, img),
    el('div', { class: 'pd-meta' },
      el('b', {}, name),
      el('span', { class: ['tag', 'pd-status', s.status || 'empty'] }, pending ? 'Waiting for approval' : s.status === 'approved' ? 'Approved' : 'Empty'),
      pending && s.at ? el('time', { datetime: s.at }, ago(s.at)) : null),
    actions);
}

// Draws the dialog from pd.view; `focus` = the data-pd of the control that gets the focus (else the first photo's first
// button, else Close). Without one, the focus stays where it is when that is still in the dialog.
function renderPhotos(focus) {
  const v = pd.view;
  if (!v || !pd.dlg.open) return;
  const { title, sub, note, grid } = pd.parts;
  title.textContent = `Photos · ${v.user.name || v.user.id}`;
  const filled = v.slots.filter((s) => s.photoId).length;
  const waiting = v.slots.filter((s) => s.status === 'pending').length;
  sub.textContent = [v.user.id, `${filled} of 4 photos`, waiting ? `${waiting} waiting for approval` : null, v.user.blocked ? 'blocked' : null]
    .filter(Boolean).join(' · ');
  note.hidden = !v.user.review;
  if (v.user.review) note.replaceChildren('App review account — change its photos on the ', el('a', { href: '/30da/admin/review' }, 'App review page'), '.');
  for (const src of pd.imgs.keys()) if (!v.slots.some((s) => s.url === src)) pd.imgs.delete(src);
  grid.replaceChildren(...v.slots.map((s) => slotCard(v, s)));
  if (!focus && pd.dlg.contains(document.activeElement)) return;
  const usable = (n) => (n && !n.disabled ? n : null);
  (usable(focus && pd.dlg.querySelector(`[data-pd="${CSS.escape(focus)}"]`)) || usable(grid.querySelector('button'))
    || pd.dlg.querySelector('[data-pd="close"]')).focus();
}

async function decidePhoto(s, what, { block = false } = {}) {
  if (pd.busy || !pd.view) return;
  const v = pd.view;
  // Esc twice can close the dialog while the answer is on its way, and it may be open again (another profile) when the
  // answer lands: that opening, its view and its busy state are not this answer's. The badge and the table still take it.
  const opened = pd.opened;
  const here = () => pd.dlg.open && pd.opened === opened;
  const who = v.user.name || v.user.id;
  const n = s.index + 1;
  pd.busy = true;
  pd.parts.error.hidden = true;
  pd.parts.done.textContent = '';
  renderPhotos(what === 'approve' ? `approve-${s.index}` : `yes-${s.index}`);
  let focus = null;
  try {
    const d = await api(`${PHOTOS_API(v.user.id)}/${s.index}/${what}`, { photoId: s.photoId, ...(what === 'disqualify' ? { block } : {}) });
    setPhotosBadge(d.count);
    if (here()) {
      pd.view = { user: d.user, slots: d.slots };
      pd.parts.done.textContent = what === 'approve' ? `Approved photo ${n}. Everyone can see it now.`
        : d.blocked ? `Disqualified photo ${n} and blocked ${who}. They were told.` : `Disqualified photo ${n}. ${who} was told.`;
    }
    focus = `disqualify-${s.index}`;
  } catch (e) {
    if (e.message === 'signed out') return;
    // Changed meanwhile (replaced, already checked) or an App review account: the answer carries the fresh slots.
    if (e.data?.slots) setPhotosBadge(e.data.count);
    if (here()) {
      if (e.data?.slots) pd.view = { user: e.data.user, slots: e.data.slots };
      pd.parts.error.textContent = e.message;
      pd.parts.error.hidden = false;
    }
  } finally {
    if (here()) Object.assign(pd, { busy: false, asking: null, blockChoice: false });
  }
  if (here()) renderPhotos(focus);
  refresh(); // the table's thumbnails and counts
}

// ---------- toast with undo ----------
let toastTimer;
function toast(text, undo) {
  const t = $('toast');
  t.innerHTML = `<span>${esc(text)}</span>${undo ? '<button type="button" class="link" id="undo">Undo</button>' : ''}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 6000);
  if (undo) $('undo').onclick = () => { t.hidden = true; undo(); };
}

// ---------- events ----------
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const ds = b.dataset;
  const name = (id) => view.data.users.find((u) => u.id === id)?.name ?? id;

  if (ds.filter) { view.filter = ds.filter; render(); }
  else if (ds.block) {
    const r = await act(`/30da/admin/api/users/${ds.block}/block`, { flagId: ds.flag || null });
    if (!r) return;
    // Undo would lift a block that was already there before this click, so it is only offered for a new one.
    if (r.alreadyBlocked) toast(`${name(ds.block)} was already blocked. The flag is closed.`);
    else toast(`${name(ds.block)} is blocked.`, () => act(`/30da/admin/api/users/${ds.block}/unblock`, { undo: true }));
  } else if (ds.delete) {
    // The admin's delete dialog + the one delete route (delete-profile.js): the answer is the fresh overview.
    const id = ds.delete;
    const who = name(id);
    const data = await window.thirtydaDeleteProfile({ id, name: view.data.users.find((u) => u.id === id)?.name });
    if (!data) return;
    view.data = data;
    if (view.chatFor?.user === id) { view.chatFor = null; view.chat = null; }
    render();
    toast(`${who} is deleted.`);
  } else if (ds.photos) {
    // A thumbnail (data-slot) or the row's "Photos": the 4 photos large, Approve / Disqualify.
    openPhotos(ds.photos, { user: ds.photos, slot: ds.slot ?? null });
  } else if (ds.unblock) {
    await act(`/30da/admin/api/users/${ds.unblock}/unblock`);
    toast(`${name(ds.unblock)} is unblocked.`);
  } else if (ds.warn) {
    await act(`/30da/admin/api/flags/${ds.warn}/warn`);
    toast('Warning sent.');
  } else if (ds.dismiss) {
    await act(`/30da/admin/api/flags/${ds.dismiss}/dismiss`);
    toast('Flag dismissed.');
  } else if (ds.chatFlag || ds.chatUser) {
    await loadChat(ds.chatFlag ? { flag: ds.chatFlag } : { user: ds.chatUser });
    view.tab = 'log';
    render();
    $('monitor').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (b.id === 'tab-queue' || b.id === 'tab-log') {
    view.tab = b.id === 'tab-queue' ? 'queue' : 'log';
    renderMonitor();
  } else if (ds.target) {
    document.querySelectorAll('.navitem').forEach((n) => n.classList.toggle('active', n === b));
    if (ds.target === 'monitor') { view.tab = 'queue'; renderMonitor(); }
    $(ds.target).scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (b.id === 'signout') {
    await fetch('/30da/admin/api/signout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    location.href = '/30da/admin';
  }
});

$('search').addEventListener('input', (e) => {
  view.query = e.target.value;
  renderUsers();
});

// Arriving from another admin page with #users / #monitor: mark that section in the side nav.
if (/^#(top|users|monitor)$/.test(location.hash)) {
  const target = location.hash.slice(1);
  document.querySelectorAll('button.navitem').forEach((n) => n.classList.toggle('active', n.dataset.target === target));
}

refresh();
setInterval(refresh, 15000);
