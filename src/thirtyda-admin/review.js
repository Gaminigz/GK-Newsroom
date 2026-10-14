// 30+DA admin · App review: demo accounts for the App Store / Google Play reviewers (src/lib/thirtyda-review.mjs).
// Routes: src/lib/thirtyda-admin.mjs (/30da/admin/api/review…). Everything from the server goes on the page as text.
// A real phone number is never shown in full (the server sends it masked); a mock number is not real, so it shows.

const $ = (id) => document.getElementById(id);
const BASE = '/30da/admin/api/review';
let view = null;
let editing = null; // the profile id the form is for
let demoEditing = null; // the preset ('woman' | 'man') the demo form is for
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
    ? `Reviewers sign in with a review account's PIN (typed on the app's "Set your PIN" screen it signs straight in; or "App review sign-in" there), or its mock number and the code. Turn it off after the review${v.switchedAt ? ` (on since ${whenOf(v.switchedAt)})` : ''}.`
    : 'Off: "App review sign-in" is not shown in the app, a demo PIN typed in the app is just a PIN (it signs in to nothing), the review code does not work, and the mock numbers act like any other number. Turn it on before you send the app for review.';
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
      v.accounts.length > 1 && !a.talks.length && !a.made ? 'No conversation with another review account' : null,
    ].filter(Boolean);
    // Made on this page (Create demo account): edit it there, Refresh photos, Remove — never "Stop" (no own profile).
    const actions = a.made
      ? [
        el('button', { type: 'button', class: 'link', onclick: () => openDemo(a.made) }, 'Edit demo account'),
        el('button', { type: 'button', class: 'link', onclick: () => refreshPhotos(a) }, 'Refresh photos'),
        el('button', { type: 'button', class: 'link danger', onclick: () => remove(a) }, 'Remove'),
      ]
      : [
        el('button', { type: 'button', class: 'link', onclick: () => openForm(a) }, 'Change number / PIN'),
        el('button', { type: 'button', class: 'link danger', onclick: () => stop(a) }, 'Stop being a review account'),
      ];
    return el('li', { class: 'rv-account', 'data-id': a.id },
      el('div', { class: 'rv-account-head' }, el('b', {}, a.made ? `${a.name} · made here` : a.name), el('small', {}, a.id)),
      el('dl', { class: 'rv-facts' },
        el('dt', {}, 'Mock number'), el('dd', { class: 'rv-mono' }, a.ways.phone ?? a.phone ?? '—'),
        el('dt', {}, 'PIN'), el('dd', { class: 'rv-mono' }, a.pin ?? '—'),
        el('dt', {}, 'Photos'), el('dd', {}, `${a.photos} of ${a.photoMax}`),
        el('dt', {}, 'Born'), el('dd', {}, a.birthYear ?? '—'),
        el('dt', {}, 'Level'), el('dd', {}, String(a.level)),
        el('dt', {}, 'Verified'), el('dd', {}, waysChips(a.ways)),
        el('dt', {}, 'Talks with'), el('dd', {}, a.talks.length ? a.talks.map((t) => `${t.withName} · ${STAGE[t.stage] ?? t.stage}`).join(', ') : '—')),
      warn.length ? el('ul', { class: 'rv-warn' }, warn.map((w) => el('li', {}, w))) : null,
      el('div', { class: 'rv-actions' }, actions));
  }));

  renderDemos();

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

// ---------- Create demo account (src/lib/thirtyda-demo.mjs) ----------
const GENDER_TEXT = { woman: 'Woman', man: 'Man', other: 'Other' };

/** "Photos: …" for a preset: which of the Media Director's 4 files are in the folder (placeholders for the rest). */
function photoLine(p) {
  const f = p.files;
  if (!f.count) return { text: 'Photos: placeholders — real demo photos not added yet', cls: 'is-placeholder' };
  if (f.count === f.of) return { text: `Photos: real demo photos (${f.count} of ${f.of})`, cls: 'is-real' };
  const missing = f.names.filter((_, i) => !f.real[i]);
  return { text: `Photos: ${f.count} of ${f.of} real — placeholders for ${missing.join(', ')}`, cls: 'is-placeholder' };
}

function renderDemos() {
  const dm = view.demo;
  if (!dm) return;
  $('demo-state').textContent = `${dm.presets.filter((p) => p.account).length} of ${dm.presets.length} made`;
  $('demos').replaceChildren(...dm.presets.map((p) => {
    const a = p.account;
    const pin = a?.pin ?? p.defaults.pin;
    const line = photoLine(p);
    const facts = a
      ? el('dl', { class: 'rv-facts' },
        el('dt', {}, 'App name'), el('dd', {}, a.name),
        el('dt', {}, 'Real name'), el('dd', {}, a.realName || '—'),
        el('dt', {}, 'Born'), el('dd', {}, a.birthYear ?? '—'),
        el('dt', {}, 'Mock number'), el('dd', { class: 'rv-mono' }, spaced(a.phone) || '—'),
        el('dt', {}, 'PIN'), el('dd', { class: 'rv-mono' }, a.pin ?? '—'),
        el('dt', {}, 'Photos'), el('dd', {}, `${a.photos} of 4 · ${a.realPhotos ? `${a.realPhotos} real` : 'placeholders'}`))
      : el('p', { class: 'rv-help' }, `Not made yet: ${p.defaults.name}, ${GENDER_TEXT[p.defaults.gender] ?? p.defaults.gender}, born ${p.defaults.birthYear}, ${spaced(p.defaults.phone)}.`);
    return el('li', { class: ['rv-demo', a && 'is-made'], 'data-preset': p.preset },
      el('div', { class: 'rv-demo-head' }, el('b', {}, `${p.label} (PIN ${pin})`), a ? el('small', {}, a.id) : null),
      facts,
      el('p', { class: ['rv-photos', line.cls] }, line.text),
      a?.refresh ? el('p', { class: 'rv-help' }, 'New photo files are in the folder: press Refresh photos to use them.') : null,
      el('div', { class: 'rv-actions' },
        el('button', { type: 'button', class: 'btn-primary', onclick: () => openDemo(p.preset) }, a ? 'Edit' : `Create ${p.label.toLowerCase()}`),
        a ? el('button', { type: 'button', class: 'link', onclick: () => refreshPhotos({ id: a.id, name: a.name }) }, 'Refresh photos') : null,
        a ? el('button', { type: 'button', class: 'link danger', onclick: () => remove({ id: a.id, name: a.name }) }, 'Remove') : null));
  }));
  const names = dm.presets.map((p) => `${p.files.names[0]} … ${p.files.names.at(-1)}`).join(' and ');
  $('demo-folder').replaceChildren('Real demo photos: put ', el('code', {}, names), ' in ', el('code', {}, dm.folder),
    ' (photo 1 = the face), then Create or Refresh photos. Until then each slot gets a navy / grey silhouette placeholder.');
}

function options(select, list, value) {
  select.replaceChildren(...list.map((o) => el('option', { value: o.key, selected: o.key === value }, o.text)));
  select.value = value;
}

function openDemo(preset) {
  const p = view.demo?.presets.find((x) => x.preset === preset);
  if (!p) return;
  demoEditing = preset;
  const v = p.account ? { ...p.defaults, ...Object.fromEntries(Object.entries(p.account).filter(([, x]) => x != null && x !== '')) } : p.defaults;
  $('demo-form-title').textContent = p.account ? `Edit ${p.label.toLowerCase()}` : `Create ${p.label.toLowerCase()}`;
  $('demo-form-who').textContent = p.account
    ? `${p.account.name} (${p.account.id}). Saving updates this same account, its photos too.`
    : 'A new profile, made as a review account at once.';
  $('demo-name').value = v.name ?? '';
  $('demo-real').value = v.realName ?? '';
  options($('demo-gender'), view.demo.genders.map((g) => ({ key: g, text: GENDER_TEXT[g] ?? g })), v.gender);
  $('demo-birth').value = v.birthYear ?? '';
  options($('demo-role'), view.demo.roles, v.role);
  options($('demo-lang'), view.demo.langs, v.lang);
  $('demo-phone').value = spaced(v.phone);
  $('demo-pin').value = v.pin ?? '';
  $('demo-form-photos').textContent = photoLine(p).text;
  $('demo-save').textContent = p.account ? 'Save' : 'Create';
  $('demo-error').hidden = true;
  $('demo-dialog').showModal();
  $('demo-name').focus();
}

$('demo-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!demoEditing) return;
  const pin = $('demo-pin').value.replace(/\D/g, '');
  if (pin.length !== 4) {
    $('demo-error').textContent = 'A PIN is 4 digits.';
    $('demo-error').hidden = false;
    return;
  }
  $('demo-save').disabled = true;
  try {
    const r = await act('demo', {
      preset: demoEditing, name: $('demo-name').value, realName: $('demo-real').value, gender: $('demo-gender').value,
      birthYear: $('demo-birth').value.trim(), role: $('demo-role').value, lang: $('demo-lang').value, phone: $('demo-phone').value, pin,
    });
    $('demo-dialog').close();
    toast(r?.created ? 'Made: the demo account is a review account now.' : 'Saved: the demo account is updated.');
  } catch (err) {
    $('demo-error').textContent = err.message;
    $('demo-error').hidden = false;
  } finally {
    $('demo-save').disabled = false;
  }
});
$('demo-cancel').addEventListener('click', () => $('demo-dialog').close());

async function refreshPhotos(a) {
  await act(`demo/${a.id}/photos`, {}, `${a.name}: photos refreshed (approved, photo 1 = the face).`).catch(() => {});
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
