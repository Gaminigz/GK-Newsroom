// 30+DA admin · App review: demo accounts for the App Store / Google Play reviewers (src/lib/thirtyda-review.mjs).
// Routes: src/lib/thirtyda-admin.mjs (/30da/admin/api/review…). Everything from the server goes on the page as text.
// A real phone number is never shown in full (the server sends it masked); a mock number is not real, so it shows.

const $ = (id) => document.getElementById(id);
const BASE = '/30da/admin/api/review';
let view = null;
let editing = null; // the profile id the form is for
let busy = false;

// ---------- api ----------
async function api(path, body) {
  const res = await fetch(path, body === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
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
const dayOf = (iso) => (iso ? new Intl.DateTimeFormat('en-GB', { timeZone: PP, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)) : '—');
const whenOf = (iso) => (iso ? new Intl.DateTimeFormat('en-GB', { timeZone: PP, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '');
/** "+855100001122" → "+855 10 000 1122" (easier to read and type; the server takes either). */
const spaced = (p) => String(p ?? '').replace(/^\+855(\d{2})(\d{3})(\d{3,4})$/, '+855 $1 $2 $3');
const STAGE = { l1: 'Level 1', l2_wait: 'Level 2 (waiting)', l2_open: 'Level 2', l3_decide: 'Level 2 done (choosing)', l3_open: 'Level 3 (chat)', ended: 'Ended' };

let toastTimer = null;
function toast(text) {
  const t = $('toast');
  t.replaceChildren(el('span', {}, text));
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
}

async function copy(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied.`);
  } catch {
    toast('Could not copy here: select the text and copy it.');
  }
}

function waysChips(w) {
  const chips = [
    w.phone ? el('span', { class: 'rv-way rv-mono' }, `Phone ${w.phone}`) : null,
    w.google ? el('span', { class: 'rv-way' }, 'Google') : null,
    w.facebook ? el('span', { class: 'rv-way' }, 'Facebook') : null,
    w.tiktok ? el('span', { class: 'rv-way' }, 'TikTok') : null,
  ].filter(Boolean);
  return chips.length ? chips : [el('span', { class: 'muted' }, 'none')];
}

// ---------- render ----------
function render() {
  const v = view;
  $('state').textContent = `${v.counts.review} review · ${v.counts.real} real`;

  // the switch
  $('sw-pill').textContent = v.on ? 'ON' : 'OFF';
  $('sw-pill').classList.toggle('on', v.on);
  $('sw-help').textContent = v.on
    ? `Reviewers sign in with a review account's PIN ("App review" on the app's PIN screen), or its mock number and the code. Turn it off after the review${v.switchedAt ? ` (on since ${whenOf(v.switchedAt)})` : ''}.`
    : 'Off: "App review" is not shown in the app, the review PINs and the review code do not work, and the mock numbers act like any other number. Turn it on before you send the app for review.';
  $('sw-btn').textContent = v.on ? 'Turn off' : 'Turn on';
  $('sw-btn').classList.toggle('on', !v.on);
  $('sw-btn').disabled = false;
  document.querySelector('.rv-switch-panel').classList.toggle('is-off', !v.on && v.accounts.length > 0);

  // the code
  const c = v.code;
  $('code').textContent = c.code ?? '––––––';
  $('code').classList.toggle('is-blocked', c.blocked);
  $('code-copy').hidden = !c.code;
  $('code-when').textContent = c.updatedAt ? `made ${whenOf(c.updatedAt)}` : '';
  $('code-help').textContent = !v.keyReady ? "The server's lock key is missing: a code cannot be kept. Ask your developer to set it."
    : !c.readable ? 'The saved code cannot be read with this server key. Press New code.'
      : c.blocked ? `Too many wrong tries (${c.wrong}). It no longer works: press New code and update the review notes.`
        : !c.code ? 'No code yet. Press New code: one 6-digit code for every review account.'
          : `Wrong tries with this code: ${c.wrong} of ${c.wrongMax}. A new code replaces it at once (update the review notes).`;

  $('notes').value = v.notes;

  // the review accounts
  $('acc-count').textContent = `${v.accounts.length} of ${v.max}`;
  $('no-accounts').hidden = v.accounts.length > 0;
  $('accounts').replaceChildren(...v.accounts.map((a) => {
    const warn = [
      a.photos < a.photoMax ? `Only ${a.photos} of ${a.photoMax} photos` : null,
      a.birthYear ? null : 'No birth year',
      a.blocked ? 'Blocked: reviewers cannot sign in' : null,
      a.pin ? null : 'PIN not readable: save it again',
      v.accounts.length > 1 && !a.talks.length ? 'No conversation with another review account' : null,
    ].filter(Boolean);
    return el('li', { class: 'rv-account', 'data-id': a.id },
      el('div', { class: 'rv-account-head' }, el('b', {}, a.name), el('small', {}, a.id)),
      el('dl', { class: 'rv-facts' },
        el('dt', {}, 'Mock number'), el('dd', { class: 'rv-mono' }, a.ways.phone ?? a.phone ?? '—'),
        el('dt', {}, 'PIN'), el('dd', { class: 'rv-mono' }, a.pin ?? '—'),
        el('dt', {}, 'Photos'), el('dd', {}, `${a.photos} of ${a.photoMax}`),
        el('dt', {}, 'Born'), el('dd', {}, a.birthYear ?? '—'),
        el('dt', {}, 'Level'), el('dd', {}, String(a.level)),
        el('dt', {}, 'Verified'), el('dd', {}, waysChips(a.ways)),
        el('dt', {}, 'Talks with'), el('dd', {}, a.talks.length ? a.talks.map((t) => `${t.withName} · ${STAGE[t.stage] ?? t.stage}`).join(', ') : '—')),
      warn.length ? el('ul', { class: 'rv-warn' }, warn.map((w) => el('li', {}, w))) : null,
      el('div', { class: 'rv-actions' },
        el('button', { type: 'button', class: 'link', onclick: () => openForm(a) }, 'Change number / PIN'),
        el('button', { type: 'button', class: 'link danger', onclick: () => stop(a) }, 'Stop being a review account')));
  }));

  // all profiles
  $('all-count').textContent = `${v.profiles.length}`;
  $('no-profiles').hidden = v.profiles.length > 0;
  $('profiles').replaceChildren(...v.profiles.map((p) => el('tr', { 'data-id': p.id, class: p.blocked ? 'is-blocked' : null },
    el('td', {}, el('div', { class: 'who' }, el('div', {}, el('b', {}, p.name || '—'), el('small', {}, p.id)))),
    el('td', {}, dayOf(p.created)),
    el('td', { class: 'rv-num' }, String(p.level)),
    el('td', { class: 'rv-num' }, `${p.photos}/${p.photoMax}`),
    el('td', { class: 'rv-num' }, p.birthYear ?? '—'),
    el('td', { class: 'rv-ways' }, waysChips(p.ways)),
    el('td', {}, el('span', { class: ['rv-kind', p.review && 'review'] }, p.review ? 'Review' : p.blocked ? 'Real · blocked' : 'Real')),
    el('td', { class: 'rv-acts' }, el('div', { class: 'row-actions' },
      p.review ? null : el('button', { type: 'button', class: 'link use', onclick: () => openForm(p) }, 'Use as review account'),
      el('button', { type: 'button', class: 'link danger remove', onclick: () => remove(p) }, 'Remove'))))));
}

async function load() {
  try {
    view = await api(BASE);
    render();
  } catch (err) {
    $('state').textContent = err.message;
  }
}

async function act(path, body, done) {
  if (busy) return null;
  busy = true;
  try {
    view = await api(`${BASE}/${path}`, body);
    render();
    if (done) toast(done);
    return view;
  } catch (err) {
    toast(err.message);
    throw err;
  } finally {
    busy = false;
  }
}

// ---------- the form ----------
function nextDefault() {
  const used = new Set(view.accounts.map((a) => a.phone));
  return view.defaults.find((x) => !used.has(x.phone)) ?? { phone: '', pin: '' };
}

function openForm(p) {
  editing = p.id;
  const current = view.accounts.find((a) => a.id === p.id);
  const def = current ? { phone: current.phone, pin: current.pin ?? '' } : nextDefault();
  $('form-title').textContent = current ? 'Change number / PIN' : 'Use as review account';
  $('form-who').textContent = `${p.name || p.id} (${p.id})`;
  $('form-phone').value = spaced(def.phone);
  $('form-pin').value = def.pin;
  $('form-error').hidden = true;
  $('form-dialog').showModal();
  $('form-phone').focus();
}

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!editing) return;
  const pin = $('form-pin').value.replace(/\D/g, '');
  if (pin.length !== 4) {
    $('form-error').textContent = 'A PIN is 4 digits.';
    $('form-error').hidden = false;
    return;
  }
  $('form-save').disabled = true;
  try {
    await act(`accounts/${editing}`, { phone: $('form-phone').value, pin }, 'Saved: it is a review account now.');
    $('form-dialog').close();
  } catch (err) {
    $('form-error').textContent = err.message;
    $('form-error').hidden = false;
  } finally {
    $('form-save').disabled = false;
  }
});
$('form-cancel').addEventListener('click', () => $('form-dialog').close());

async function stop(a) {
  if (!confirm(`Stop using ${a.name} (${a.id}) as a review account?\n\nThe mock number goes, the profile's own number and PIN come back, and reviewers signed in to it are signed out.`)) return;
  await act(`accounts/${a.id}/stop`, {}, `${a.name} is a normal profile again.`).catch(() => {});
}

// "Remove": the admin's one delete path (delete-profile.js: its dialog + POST /30da/admin/api/users/:id/delete), then
// this page's fresh data.
async function remove(p) {
  if (busy) return;
  const done = await window.thirtydaDeleteProfile({ id: p.id, name: p.name });
  if (!done) return;
  await load();
  toast(`${p.name || p.id} is deleted.`);
}

// ---------- the switch, the code, copy ----------
$('sw-btn').addEventListener('click', () => {
  const on = !view.on;
  if (!on && !confirm('Turn review sign-in off? The review PINs and the review code stop working at once.')) return;
  act('switch', { on }, on ? 'Review sign-in is on.' : 'Review sign-in is off.').catch(() => {});
});
$('code-new').addEventListener('click', () => {
  if (view?.code?.code && !confirm('Make a new code? The old one stops working at once: update the review notes in App Store Connect and Play Console.')) return;
  act('code', {}, 'New code made. Copy the review notes again.').catch(() => {});
});
$('code-copy').addEventListener('click', () => copy(view.code.code, 'Code'));
$('notes-copy').addEventListener('click', () => copy($('notes').value, 'Review notes'));
$('signout').addEventListener('click', async () => {
  await fetch('/30da/admin/api/signout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  location.href = '/30da/admin';
});

load();
