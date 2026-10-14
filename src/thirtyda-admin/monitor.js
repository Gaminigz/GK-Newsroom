const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

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
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
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
      <td>${levelBars(u.level)}</td>
      <td class="born">${Number.isInteger(u.birthYear) ? u.birthYear : '<span class="muted">–</span>'}</td>
      <td>${esc(u.language)}</td>
      <td>${esc(u.area)}</td>
      <td><span class="status"><span class="dot ${status}"></span>${status}</span></td>
      <td><span class="count ${u.openFlags ? 'hot' : ''}">${u.openFlags}</span></td>
      <td><span class="row-actions">
        <button type="button" class="link" data-chat-user="${esc(u.id)}">View chat</button>
        ${u.blocked
          ? `<button type="button" class="link" data-unblock="${esc(u.id)}">Unblock</button>`
          : `<button type="button" class="link danger" data-block="${esc(u.id)}">Block</button>`}
        <button type="button" class="link danger" data-delete="${esc(u.id)}">Delete</button>
      </span></td>
    </tr>`;
  }).join('');
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
