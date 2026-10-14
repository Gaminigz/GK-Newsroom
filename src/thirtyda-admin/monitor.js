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
    const how = f.kind === 'stopped'
      ? 'Stopped by the app before sending'
      : `Delivered · ${esc(f.toName)} reported it`;
    return `<article class="flag">
      <div class="flag-top"><b>${esc(f.fromName)} → ${esc(f.toName)}</b><span class="tag">Level ${f.level} ${esc(f.levelName)}</span><time datetime="${f.at}">${ago(f.at)}</time></div>
      <div class="reason">
        <svg width="9" height="10" viewBox="0 0 9 10" fill="none" aria-hidden="true"><path d="M1.5 9.5V1M1.5 1.3h5.5L5.8 3.4 7 5.5H1.5" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>
        ${esc(f.reason)}
      </div>
      ${bubble(f.message)}
      <div class="label how">${how}</div>
      <div class="flag-actions">
        <button type="button" class="btn block" data-block="${esc(f.from)}" data-flag="${esc(f.id)}">Block ${esc(f.fromName)}</button>
        <button type="button" class="btn" data-warn="${esc(f.id)}" ${f.warned ? 'disabled' : ''}>${f.warned ? 'Warning sent' : 'Send warning'}</button>
      </div>
      <div class="flag-links">
        <button type="button" class="link" data-chat-flag="${esc(f.id)}">View chat</button>
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
    return `<div class="msg ${m.flag ? 'flagged' : ''} ${m.kind === 'decision' ? 'decision' : ''}">
      <div class="msg-meta"><b>${esc(m.fromName)}</b><time datetime="${m.at}">${ago(m.at)}</time></div>
      ${bubble(m)}${note}
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
