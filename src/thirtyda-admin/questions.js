// 30+DA super admin · Questions — the choices people pick from when they ask.
// Level 1: Question 1–4, Level 2: Question 1–2, each with its own 5 choices in all five languages.
// The same rules the server enforces (shared/question-slots.js) run live here; the server is the authority.
import { checkQuestionSlots } from '/30da/shared/question-slots.js';
import { LANGS, LANG_CODES, LANG_ENGLISH } from '/30da/shared/rules.js';

const OTHER = LANGS.filter((l) => l !== 'en');
const API = '/30da/admin/api/questions';
const $ = (id) => document.getElementById(id);
const copy = (x) => JSON.parse(JSON.stringify(x));
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const state = { level: 1, levels: {}, allOpen: false, busy: false };
const cur = () => state.levels[state.level];

// ---------- dom ----------
function h(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'value') node.value = v;
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null) node.append(kid);
  return node;
}

const ICONS = {
  chevron: '<path d="m3.5 5.5 3.5 3.5 3.5-3.5" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  replace: '<path d="M2.5 7a4.5 4.5 0 0 1 7.9-2.9M11.5 7a4.5 4.5 0 0 1-7.9 2.9" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/><path d="M10.6 1.8v2.5H8.1M3.4 12.2V9.7h2.5" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
};
function icon(name) {
  const t = document.createElement('template');
  t.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">${ICONS[name]}</svg>`;
  return t.content.firstChild;
}

// ---------- api ----------
async function call(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) {
    location.href = '/30da/admin';
    throw new Error('signed out');
  }
  return { status: res.status, ok: res.ok, data: await res.json().catch(() => ({})) };
}

// ---------- helpers ----------
const norm = (slots) => slots.map((slot) => slot.map((c) => ({
  key: c.key ?? null,
  text: Object.fromEntries(LANGS.map((l) => [l, clean(c.text?.[l])])),
})));
const isDirty = (L) => JSON.stringify(norm(L.draft)) !== JSON.stringify(norm(L.saved.slots));
const rowKey = (i, j) => `${i}:${j}`;

function when(iso) {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function savedText(v) {
  if (v.isDefault) return 'Built-in choices · not edited yet';
  if (v.reset) return `Reset to built-in choices · ${when(v.updatedAt)}`;
  return `Saved ${when(v.updatedAt)} · ${v.updatedBy || 'superadmin'}`;
}

let toastTimer;
function toast(text, action) {
  const t = $('toast');
  t.replaceChildren(h('span', { text }));
  if (action) {
    t.append(h('button', { type: 'button', class: 'link', text: action.label, on: { click: () => { t.hidden = true; action.run(); } } }));
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, action ? 10000 : 5000);
}

// ---------- build one level ----------
function buildChoice(L, i, j) {
  const c = L.draft[i][j];
  const id = `q${state.level}-${i}-${j}`;
  const where = `Question ${i + 1} · choice ${j + 1}`;
  const inputs = {};
  const input = (lang) => {
    const node = h('input', {
      type: 'text', class: 'input q-in', value: c.text?.[lang] ?? '', lang, autocomplete: 'off',
      spellcheck: lang === 'en' ? 'true' : 'false', 'aria-label': `${where} · ${LANG_ENGLISH[lang]}`, 'aria-describedby': `${id}-err`,
    });
    node.addEventListener('input', () => {
      L.draft[i][j].text[lang] = node.value;
      L.server = L.server.filter((p) => !(p.slot === i + 1 && p.choice === j + 1));
      schedule();
    });
    inputs[lang] = node;
    return node;
  };
  const en = input('en');
  const chips = Object.fromEntries(OTHER.map((l) => [l, h('span', { class: 'q-chip', text: LANG_CODES[l] })]));
  const tr = h('div', { class: 'q-tr', id: `${id}-tr`, hidden: true },
    OTHER.map((l) => h('label', { class: 'q-field' }, h('span', { class: 'label', text: `${LANG_CODES[l]} · ${LANG_ENGLISH[l]}` }), input(l))));
  const langs = h('button', {
    type: 'button', class: 'q-langs', 'aria-expanded': 'false', 'aria-controls': tr.id, title: 'Khmer, Chinese, Korean and Japanese',
    'aria-label': `${where}: other languages`,
    on: { click: () => { toggleRow(L, i, j); } },
  }, Object.values(chips), icon('chevron'));
  const replace = h('button', {
    type: 'button', class: 'q-replace', title: 'Replace with a new question', 'aria-label': `${where}: replace with a new question`,
    on: { click: () => replaceChoice(L, i, j) },
  }, icon('replace'));
  const num = h('span', { class: 'q-num', 'aria-hidden': 'true', text: String(j + 1) });
  const note = h('p', { class: 'q-note', hidden: true });
  const err = h('p', { class: 'q-err', id: `${id}-err`, hidden: true });
  const li = h('li', { class: 'q-choice' }, num, h('div', { class: 'q-body' }, h('div', { class: 'q-line' }, en, langs, replace), tr, note, err));
  return { li, num, inputs, chips, tr, langs, note, err };
}

function buildLevel() {
  const L = cur();
  const { pick, write } = L.saved;
  $('level-rule').textContent = `People pick ${pick} · write ${write} · ${pick} × ${L.saved.choices} choices`;
  L.refs = L.draft.map((slot, i) => slot.map((_, j) => buildChoice(L, i, j)));
  $('slots').replaceChildren(...L.draft.map((slot, i) => h('section', { class: 'panel q-slot', 'aria-labelledby': `qh-${i}` },
    h('div', { class: 'panel-head' },
      h('h2', { id: `qh-${i}`, text: `Question ${i + 1}` }),
      h('span', { class: 'label', text: `${slot.length} choices · shown only in this list` })),
    h('ol', { class: 'q-choices' }, L.refs[i].map((r) => r.li)))));
  refresh();
}

// ---------- live state ----------
let timer;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(refresh, 120);
}

function problemsOf(L) {
  const { problems } = checkQuestionSlots(L.draft, L.saved.level);
  const same = (a, b) => a.slot === b.slot && a.choice === b.choice && a.lang === b.lang && a.error === b.error;
  return [...problems, ...L.server.filter((s) => !problems.some((p) => same(p, s)))];
}

function refresh() {
  const L = cur();
  if (!L) return;
  const problems = problemsOf(L);
  const byRow = new Map();
  for (const p of problems) {
    if (!p.slot || !p.choice) continue;
    const k = rowKey(p.slot - 1, p.choice - 1);
    if (!byRow.has(k)) byRow.set(k, []);
    byRow.get(k).push(p);
  }
  L.refs.forEach((row, i) => row.forEach((r, j) => {
    const ps = byRow.get(rowKey(i, j)) || [];
    const bad = new Set(ps.map((p) => p.lang));
    for (const l of LANGS) {
      r.inputs[l].classList.toggle('is-error', bad.has(l));
      r.inputs[l].setAttribute('aria-invalid', String(bad.has(l)));
    }
    const d = L.draft[i][j];
    const saved = L.saved.slots[i]?.[j];
    const sameChoice = saved && d.key === saved.key;
    // English edited but a translation still says the old thing: point at it.
    const stale = sameChoice && clean(d.text.en) !== clean(saved.text.en)
      ? OTHER.filter((l) => clean(d.text[l]) && clean(d.text[l]) === clean(saved.text[l])) : [];
    for (const l of OTHER) {
      r.chips[l].className = `q-chip ${bad.has(l) ? 'err' : stale.includes(l) ? 'stale' : clean(d.text[l]) ? 'ok' : ''}`;
    }
    const open = state.allOpen || L.open.has(rowKey(i, j));
    r.tr.hidden = !open;
    r.langs.setAttribute('aria-expanded', String(open));
    r.note.hidden = !stale.length;
    r.note.textContent = stale.length ? `English changed. Check ${stale.map((l) => LANG_ENGLISH[l]).join(', ')} too.` : '';
    const msgs = [...new Set(ps.map((p) => p.message))];
    r.err.hidden = !msgs.length;
    r.err.textContent = msgs.slice(0, 3).join(' ') + (msgs.length > 3 ? ` +${msgs.length - 3} more.` : '');
    const rowDirty = !saved || JSON.stringify(norm([[d]])) !== JSON.stringify(norm([[saved]]));
    r.num.classList.toggle('dirty', rowDirty);
    r.num.title = !d.key ? 'New question (gets its own key when saved)' : rowDirty ? 'Edited' : '';
    r.num.classList.toggle('new', !d.key);
  }));

  const dirty = isDirty(L);
  const status = $('status');
  status.className = 'q-status';
  if (state.busy) status.textContent = 'Saving…';
  else if (dirty && problems.length) {
    status.textContent = `${plural(problems.length, 'problem', 'problems')} to fix before saving`;
    status.classList.add('err');
  } else if (dirty) {
    status.textContent = `Unsaved changes in Level ${state.level}`;
    status.classList.add('warn');
  } else status.textContent = 'All changes saved';
  $('save').textContent = state.busy ? 'Saving…' : `Save Level ${state.level}`;
  $('save').disabled = state.busy || !dirty;
  $('discard').disabled = state.busy || !dirty;
  $('reset').disabled = state.busy || (L.saved.matchesDefault && !dirty);
  $('saved-state').textContent = savedText(L.saved);
  for (const lvl of Object.keys(state.levels)) {
    const tab = $(`tab-${lvl}`);
    tab.classList.toggle('active', Number(lvl) === state.level);
    tab.setAttribute('aria-selected', String(Number(lvl) === state.level));
    tab.replaceChildren(`Level ${lvl}`, isDirty(state.levels[lvl]) ? h('span', { class: 'q-dot', title: 'Unsaved changes' }) : '');
  }
  $('expand-all').textContent = state.allOpen ? 'Hide other languages' : 'Show all languages';
  $('expand-all').setAttribute('aria-pressed', String(state.allOpen));
}

function toggleRow(L, i, j) {
  const k = rowKey(i, j);
  if (L.open.has(k) || state.allOpen) {
    if (state.allOpen) {
      // Leave "show all" and keep every other row open.
      state.allOpen = false;
      L.refs.forEach((row, a) => row.forEach((_, b) => L.open.add(rowKey(a, b))));
    }
    L.open.delete(k);
  } else L.open.add(k);
  refresh();
}

function replaceChoice(L, i, j) {
  L.draft[i][j] = { key: null, text: Object.fromEntries(LANGS.map((l) => [l, ''])) };
  L.server = L.server.filter((p) => !(p.slot === i + 1 && p.choice === j + 1));
  const r = L.refs[i][j];
  for (const l of LANGS) r.inputs[l].value = '';
  L.open.add(rowKey(i, j));
  refresh();
  r.inputs.en.focus();
}

/** Open the rows with problems and put the cursor in the first bad box. */
function revealProblems(L, problems) {
  let first = null;
  for (const p of problems) {
    if (!p.slot || !p.choice) continue;
    if (p.lang && p.lang !== 'en') L.open.add(rowKey(p.slot - 1, p.choice - 1));
    first ??= p;
  }
  refresh();
  const r = first && L.refs[first.slot - 1]?.[first.choice - 1];
  if (r) {
    const node = r.inputs[first.lang || 'en'];
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    node.focus({ preventScroll: true });
  }
}

// ---------- actions ----------
function setLevel(view) {
  state.levels[view.level] = { saved: view, draft: copy(view.slots), open: new Set(), server: [], refs: [] };
}

function selectLevel(level) {
  if (!state.levels[level]) return;
  state.level = level;
  history.replaceState(null, '', `#L${level}`);
  buildLevel();
}

async function save() {
  const L = cur();
  const level = state.level;
  const problems = problemsOf(L);
  if (problems.length) {
    revealProblems(L, problems);
    toast(`Fix ${plural(problems.length, 'problem', 'problems')} before saving.`);
    return;
  }
  state.busy = true;
  refresh();
  let r;
  try {
    r = await call('PUT', `${API}/L${level}`, { slots: norm(L.draft), updatedAt: L.saved.updatedAt });
  } catch (e) {
    r = { status: 0, ok: false, data: { error: e.message === 'signed out' ? '' : 'Could not reach the server. Try again.' } };
  }
  state.busy = false;
  if (r.ok) {
    setLevel(r.data);
    if (state.level === level) buildLevel();
    toast(`Level ${level} saved · ${plural(r.data.changes, 'change', 'changes')}. People see it on their next ask.`);
  } else if (r.status === 422) {
    L.server = r.data.problems || [];
    revealProblems(L, L.server);
    toast(r.data.error || 'Fix the problems before saving.');
  } else if (r.status === 409) {
    refresh();
    toast(r.data.error, {
      label: 'Reload',
      run: () => {
        if (!r.data.current) return location.reload();
        setLevel(r.data.current);
        if (state.level === level) buildLevel();
      },
    });
  } else {
    refresh();
    if (r.data.error) toast(r.data.error);
  }
}

async function resetLevel() {
  const level = state.level;
  const L = cur();
  const n = L.saved.pick * L.saved.choices;
  if (!confirm(`Reset Level ${level} to the built-in choices?\n\nAll ${n} choices of Level ${level} are replaced, including unsaved edits. Questions people already sent keep their text.`)) return;
  state.busy = true;
  refresh();
  const r = await call('POST', `${API}/L${level}/reset`).catch(() => ({ ok: false, data: { error: 'Could not reach the server. Try again.' } }));
  state.busy = false;
  if (r.ok) {
    setLevel(r.data);
    if (state.level === level) buildLevel();
    toast(`Level ${level} is back to the built-in choices.`);
  } else {
    refresh();
    toast(r.data.error || 'Could not reset. Try again.');
  }
}

function discard() {
  const L = cur();
  if (!confirm(`Discard your unsaved changes to Level ${state.level}?`)) return;
  setLevel(L.saved);
  buildLevel();
}

// ---------- events ----------
for (const lvl of [1, 2]) $(`tab-${lvl}`).addEventListener('click', () => selectLevel(lvl));
$('expand-all').addEventListener('click', () => {
  state.allOpen = !state.allOpen;
  if (!state.allOpen) cur().open.clear();
  refresh();
});
$('save').addEventListener('click', save);
$('reset').addEventListener('click', resetLevel);
$('discard').addEventListener('click', discard);
$('signout').addEventListener('click', async () => {
  await fetch('/30da/admin/api/signout', { method: 'POST' });
  location.href = '/30da/admin';
});
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    if (!$('save').disabled) save();
  }
});
window.addEventListener('beforeunload', (e) => {
  if (Object.values(state.levels).some(isDirty)) {
    e.preventDefault();
    e.returnValue = '';
  }
});

(async () => {
  try {
    const r = await call('GET', API);
    if (!r.ok) throw new Error(r.data.error || 'Could not load the questions.');
    for (const v of r.data.levels) setLevel(v);
    selectLevel(location.hash === '#L2' ? 2 : 1);
    // On a phone the side nav scrolls sideways: keep "Questions" in view.
    document.querySelector('.navitem.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  } catch (e) {
    if (e.message !== 'signed out') $('saved-state').textContent = e.message;
  }
})();
