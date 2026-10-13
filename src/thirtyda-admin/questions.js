// 30+DA super admin · Questions — the choices people pick from when they ask.
// Level 1: Question 1–4, Level 2: Question 1–3, each with its own 5 choices in all five languages and
// an optional topic ("Question 1 · Communication" in the app). The same rules the server enforces
// (shared/question-slots.js) run live here; the server is the authority.
import { checkQuestionSlots, checkQuestionTitles } from '/30da/shared/question-slots.js';
import { LANGS, LANG_CODES, LANG_ENGLISH } from '/30da/shared/rules.js';

const OTHER = LANGS.filter((l) => l !== 'en');
const API = '/30da/admin/api/questions';
const $ = (id) => document.getElementById(id);
const copy = (x) => JSON.parse(JSON.stringify(x));
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const blank = () => Object.fromEntries(LANGS.map((l) => [l, '']));
// Text boxes grow with their text: CSS `field-sizing: content` where the browser has it, else fit().
const FIELD_SIZING = typeof CSS !== 'undefined' && Boolean(CSS.supports?.('field-sizing', 'content'));

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

/** Grow a text box to its content (only needed where `field-sizing: content` is missing). */
function fit(node) {
  if (FIELD_SIZING || !node.isConnected || node.offsetParent === null) return;
  node.style.height = 'auto';
  node.style.height = `${node.scrollHeight + node.offsetHeight - node.clientHeight}px`;
}
const fitAll = (root) => { if (!FIELD_SIZING) root.querySelectorAll('textarea.q-in').forEach(fit); };

/** A one-line question box that wraps instead of cutting the text off (Enter never adds a line). */
function textBox(value, attrs, onInput) {
  const node = h('textarea', { rows: 1, class: 'input q-in', autocomplete: 'off', ...attrs });
  node.value = value ?? '';
  node.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) e.preventDefault(); });
  node.addEventListener('input', () => {
    if (/[\r\n]/.test(node.value)) {
      const at = node.selectionStart;
      node.value = node.value.replace(/[\r\n]+/g, ' ');
      node.setSelectionRange(at, at);
    }
    fit(node);
    onInput(node.value);
  });
  return node;
}

// ---------- api ----------
async function call(method, path, body) {
  const res = await fetch(path, {
    method,
    // Every write is JSON: the server refuses form-style bodies (cross-site form posts).
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  if (res.status === 401) {
    location.href = '/30da/admin';
    throw new Error('signed out');
  }
  return { status: res.status, ok: res.ok, data: await res.json().catch(() => ({})) };
}

// ---------- helpers ----------
const normText = (t) => Object.fromEntries(LANGS.map((l) => [l, clean(t?.[l])]));
const norm = (slots) => slots.map((slot) => slot.map((c) => ({ key: c.key ?? null, text: normText(c.text) })));
const hasText = (t) => Boolean(t) && LANGS.some((l) => clean(t[l]));
/** Topics as the server takes them: a topic left blank in every language = null. */
const normTitles = (titles) => titles.map((t) => (hasText(t) ? normText(t) : null));
const sameRow = (a, b) => Boolean(a && b) && JSON.stringify(norm([[a]])) === JSON.stringify(norm([[b]]));
const sameTitle = (a, b) => JSON.stringify(normTitles([a])) === JSON.stringify(normTitles([b]));
const rowKey = (i, j) => `${i}:${j}`;
const topicKey = (i) => `t:${i}`;

const isDirty = (L) => JSON.stringify(norm(L.draft)) !== JSON.stringify(norm(L.saved.slots))
  || JSON.stringify(normTitles(L.titles)) !== JSON.stringify(normTitles(L.saved.titles));

/** How many choices and topics differ from the saved version. */
function editCount(L) {
  let n = 0;
  L.draft.forEach((slot, i) => slot.forEach((c, j) => { if (!sameRow(c, L.saved.slots[i]?.[j])) n++; }));
  L.titles.forEach((t, i) => { if (!sameTitle(t, L.saved.titles[i])) n++; });
  return n;
}

function when(iso) {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
const timeOf = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'just now');

function savedText(v) {
  if (v.isDefault) return 'Built-in choices · not edited yet';
  if (v.reset) return `Reset to built-in choices · ${when(v.updatedAt)}`;
  return `Saved ${when(v.updatedAt)} · ${v.updatedBy || 'superadmin'}`;
}

let toastTimer;
function toast(text, ms = 5000) {
  const t = $('toast');
  t.replaceChildren(h('span', { text }));
  // Sit above the sticky save bar so the status and its buttons stay visible at every width.
  const bar = document.querySelector('.q-actions')?.getBoundingClientRect();
  t.style.bottom = `${Math.max(24, bar && bar.height ? Math.round(innerHeight - bar.top + 12) : 24)}px`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------- build one level ----------
function langToggle(where, tr, onClick) {
  const chips = Object.fromEntries(OTHER.map((l) => [l, h('span', { class: 'q-chip', text: LANG_CODES[l] })]));
  const button = h('button', {
    type: 'button', class: 'q-langs', 'aria-expanded': 'false', 'aria-controls': tr.id, title: 'Khmer, Chinese, Korean and Japanese',
    'aria-label': `${where}: other languages`, on: { click: onClick },
  }, Object.values(chips), icon('chevron'));
  return { chips, button };
}

function buildChoice(L, i, j) {
  const id = `q${state.level}-${i}-${j}`;
  const k = rowKey(i, j);
  const where = `Question ${i + 1} · choice ${j + 1}`;
  const inputs = {};
  const input = (lang) => {
    inputs[lang] = textBox(L.draft[i][j].text?.[lang], {
      lang, spellcheck: lang === 'en' ? 'true' : 'false', 'aria-label': `${where} · ${LANG_ENGLISH[lang]}`, 'aria-describedby': `${id}-err`,
    }, (v) => {
      L.draft[i][j].text[lang] = v;
      L.server = L.server.filter((p) => !(p.field !== 'title' && p.slot === i + 1 && p.choice === j + 1));
      schedule();
    });
    return inputs[lang];
  };
  const en = input('en');
  const tr = h('div', { class: 'q-tr', id: `${id}-tr`, hidden: true },
    OTHER.map((l) => h('label', { class: 'q-field' }, h('span', { class: 'label', text: `${LANG_CODES[l]} · ${LANG_ENGLISH[l]}` }), input(l))));
  const { chips, button: langs } = langToggle(where, tr, () => toggleRow(L, k));
  const replace = h('button', {
    type: 'button', class: 'q-replace', title: 'Replace with a new question (the old one stays in sets already sent)',
    'aria-label': `${where}: replace with a new question`, on: { click: () => replaceChoice(L, i, j) },
  }, icon('replace'), h('span', { text: 'Replace' }));
  const num = h('span', { class: 'q-num', 'aria-hidden': 'true', text: String(j + 1) });
  const undoText = h('span', {});
  const undo = h('p', { class: 'q-undo', hidden: true }, undoText,
    h('button', { type: 'button', class: 'link', text: 'Undo', 'aria-label': `${where}: undo replace`, on: { click: () => undoReplace(L, i, j) } }));
  const note = h('p', { class: 'q-note', hidden: true });
  const err = h('p', { class: 'q-err', id: `${id}-err`, hidden: true });
  const li = h('li', { class: 'q-choice' }, num, h('div', { class: 'q-body' }, h('div', { class: 'q-line' }, en, langs, replace), tr, undo, note, err));
  // A freshly replaced row says what is missing only once the admin has left it.
  li.addEventListener('focusout', (e) => {
    if (L.fresh.has(k) && !li.contains(e.relatedTarget)) {
      L.fresh.delete(k);
      schedule();
    }
  });
  return { li, num, inputs, chips, tr, langs, note, err, undo, undoText };
}

/** "Topic" under "Question N": optional, shown in the app as "Question N · <topic>". */
function buildTopic(L, i) {
  const id = `qt${state.level}-${i}`;
  const k = topicKey(i);
  const where = `Question ${i + 1} · topic`;
  const inputs = {};
  const input = (lang) => {
    inputs[lang] = textBox(L.titles[i][lang], {
      lang, spellcheck: lang === 'en' ? 'true' : 'false', placeholder: lang === 'en' ? 'Optional, e.g. Communication' : '',
      'aria-label': `${where} · ${LANG_ENGLISH[lang]}`, 'aria-describedby': `${id}-err`,
    }, (v) => {
      L.titles[i][lang] = v;
      L.server = L.server.filter((p) => !(p.field === 'title' && p.slot === i + 1));
      // A new topic needs all five languages: open the other four as soon as English is started, and
      // say they are missing only once the admin leaves the topic.
      if (lang === 'en' && clean(v) && OTHER.every((l) => !clean(L.titles[i][l]))) {
        L.open.add(k);
        L.fresh.add(k);
      }
      schedule();
    });
    return inputs[lang];
  };
  const en = input('en');
  const tr = h('div', { class: 'q-tr', id: `${id}-tr`, hidden: true },
    OTHER.map((l) => h('label', { class: 'q-field' }, h('span', { class: 'label', text: `${LANG_CODES[l]} · ${LANG_ENGLISH[l]}` }), input(l))));
  const { chips, button: langs } = langToggle(where, tr, () => toggleRow(L, k));
  const note = h('p', { class: 'q-note', hidden: true });
  const err = h('p', { class: 'q-err', id: `${id}-err`, hidden: true });
  const wrap = h('div', { class: 'q-topic' },
    h('div', { class: 'q-line' }, h('span', { class: 'label q-topic-label', 'aria-hidden': 'true', text: 'Topic' }), en, langs), tr, note, err);
  wrap.addEventListener('focusout', (e) => {
    if (L.fresh.has(k) && !wrap.contains(e.relatedTarget)) {
      L.fresh.delete(k);
      schedule();
    }
  });
  return { wrap, inputs, chips, tr, langs, note, err };
}

function buildLevel() {
  const L = cur();
  const { pick, write } = L.saved;
  $('level-rule').textContent = `People pick ${pick} · write ${write} · ${pick} × ${L.saved.choices} choices`;
  L.refs = L.draft.map((slot, i) => slot.map((_, j) => buildChoice(L, i, j)));
  L.topicRefs = L.draft.map((_, i) => buildTopic(L, i));
  $('slots').replaceChildren(...L.draft.map((slot, i) => h('section', { class: 'panel q-slot', 'aria-labelledby': `qh-${i}` },
    h('div', { class: 'panel-head' },
      h('h2', { id: `qh-${i}`, text: `Question ${i + 1}` }),
      h('span', { class: 'label', text: `${slot.length} choices · shown only in this list` })),
    L.topicRefs[i].wrap,
    h('ol', { class: 'q-choices' }, L.refs[i].map((r) => r.li)))));
  refresh();
  requestAnimationFrame(() => fitAll($('slots')));
}

// ---------- live state ----------
let timer;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(refresh, 120);
}

function problemsOf(L) {
  const { problems } = checkQuestionSlots(L.draft, L.saved.level);
  const { problems: topics } = checkQuestionTitles(normTitles(L.titles), L.saved.level);
  const local = [...problems, ...topics];
  const same = (a, b) => a.field === b.field && a.slot === b.slot && a.choice === b.choice && a.lang === b.lang && a.error === b.error;
  return [...local, ...L.server.filter((s) => !local.some((p) => same(p, s)))];
}

/** The problems to show now: a freshly replaced row (or new topic) is not "missing" text until the admin leaves it. */
const shownProblems = (L, all) => all.filter((p) => !(p.error === 'empty' && p.slot
  && L.fresh.has(p.field === 'title' ? topicKey(p.slot - 1) : rowKey(p.slot - 1, p.choice - 1))));

function paintLangs(r, open, bad, staleLangs, text) {
  for (const l of OTHER) {
    r.chips[l].className = `q-chip ${bad.has(l) ? 'err' : staleLangs.includes(l) ? 'stale' : clean(text[l]) ? 'ok' : ''}`;
  }
  const wasHidden = r.tr.hidden;
  r.tr.hidden = !open;
  if (open && wasHidden) fitAll(r.tr);
  r.langs.setAttribute('aria-expanded', String(open));
}

function paintErrors(r, ps) {
  const bad = new Set(ps.map((p) => p.lang));
  for (const l of LANGS) {
    r.inputs[l].classList.toggle('is-error', bad.has(l));
    r.inputs[l].setAttribute('aria-invalid', String(bad.has(l)));
  }
  const msgs = [...new Set(ps.map((p) => p.message))];
  r.err.hidden = !msgs.length;
  r.err.textContent = msgs.slice(0, 3).join(' ') + (msgs.length > 3 ? ` +${msgs.length - 3} more.` : '');
  return bad;
}

function refresh() {
  const L = cur();
  if (!L) return;
  const all = problemsOf(L);
  const problems = shownProblems(L, all);
  const byRow = new Map();
  const add = (k, p) => { if (!byRow.has(k)) byRow.set(k, []); byRow.get(k).push(p); };
  for (const p of problems) {
    if (!p.slot) continue;
    if (p.field === 'title') add(topicKey(p.slot - 1), p);
    else if (p.choice) add(rowKey(p.slot - 1, p.choice - 1), p);
  }

  L.refs.forEach((row, i) => row.forEach((r, j) => {
    const k = rowKey(i, j);
    const bad = paintErrors(r, byRow.get(k) || []);
    const d = L.draft[i][j];
    const saved = L.saved.slots[i]?.[j];
    const sameChoice = saved && d.key === saved.key;
    const enChanged = sameChoice && clean(d.text.en) !== clean(saved.text.en);
    // English edited but a translation still says the old thing: point at it.
    const stale = enChanged ? OTHER.filter((l) => clean(d.text[l]) && clean(d.text[l]) === clean(saved.text[l])) : [];
    paintLangs(r, state.allOpen || L.open.has(k), bad, stale, d.text);
    const notes = [];
    const theirs = L.collisions.get(k);
    if (theirs !== undefined) notes.push(`The other tab changed this too, to “${theirs}”. Yours is kept: check it, then save.`);
    if (stale.length) notes.push(`English changed. Check ${stale.map((l) => LANG_ENGLISH[l]).join(', ')} too.`);
    r.note.hidden = !notes.length;
    r.note.textContent = notes.join(' ');
    const prev = L.replaced.get(k);
    r.undo.hidden = !prev;
    r.undoText.textContent = prev ? `New question in place of “${clean(prev.text?.en)}”.` : '';
    for (const l of LANGS) r.inputs[l].placeholder = prev && clean(prev.text?.[l]) ? `Was: ${clean(prev.text[l])}` : '';
    const rowDirty = !sameRow(d, saved);
    r.num.classList.toggle('dirty', rowDirty);
    r.num.classList.toggle('new', !d.key);
    r.num.title = !d.key ? 'New question (gets its own key when saved)'
      : enChanged ? 'Re-worded: saved as a new question, so people choosing right now are asked to check again'
        : rowDirty ? 'Edited' : '';
  }));

  L.topicRefs.forEach((r, i) => {
    const k = topicKey(i);
    const bad = paintErrors(r, byRow.get(k) || []);
    const t = L.titles[i];
    const saved = L.saved.titles[i];
    const stale = saved && clean(t.en) && clean(t.en) !== clean(saved.en) ? OTHER.filter((l) => clean(t[l]) && clean(t[l]) === clean(saved[l])) : [];
    // "Show all languages" opens a topic only when it has one: empty topic boxes are just noise.
    paintLangs(r, L.open.has(k) || (state.allOpen && (hasText(t) || bad.size > 0)), bad, stale, t);
    const notes = [];
    const theirs = L.collisions.get(k);
    if (theirs !== undefined) notes.push(`The other tab changed this topic too, to “${theirs || 'no topic'}”. Yours is kept.`);
    if (stale.length) notes.push(`English changed. Check ${stale.map((l) => LANG_ENGLISH[l]).join(', ')} too.`);
    r.note.hidden = !notes.length;
    r.note.textContent = notes.join(' ');
    r.wrap.classList.toggle('dirty', !sameTitle(t, saved));
  });

  const dirty = isDirty(L);
  const edits = editCount(L);
  const status = $('status');
  status.className = 'q-status';
  if (state.busy) status.textContent = 'Saving…';
  else if (L.conflict) {
    status.textContent = `Level ${state.level} was saved in another tab at ${timeOf(L.conflict.updatedAt)}. Load it to keep your ${plural(edits, 'edit', 'edits')} on top, or discard them.`;
    status.classList.add('err');
  } else if (dirty && problems.length) {
    status.textContent = `${plural(problems.length, 'problem', 'problems')} to fix before saving`;
    status.classList.add('err');
  } else if (dirty && all.length) {
    status.textContent = 'Write it in all 5 languages, then save';
    status.classList.add('warn');
  } else if (dirty) {
    status.textContent = `Unsaved changes in Level ${state.level}`;
    status.classList.add('warn');
  } else status.textContent = 'All changes saved';
  document.querySelector('.q-actions').classList.toggle('conflict', Boolean(L.conflict) && !state.busy);
  const merge = $('merge');
  merge.hidden = !L.conflict;
  merge.disabled = state.busy;
  merge.textContent = edits ? `Load it, keep my ${plural(edits, 'edit', 'edits')}` : 'Load the latest';
  $('save').textContent = state.busy ? 'Saving…' : `Save Level ${state.level}`;
  $('save').disabled = state.busy || !dirty || Boolean(L.conflict);
  $('discard').textContent = L.conflict ? 'Discard my edits' : 'Discard changes';
  $('discard').disabled = state.busy || (!dirty && !L.conflict);
  $('reset').disabled = state.busy || (L.saved.matchesDefault && !dirty);
  $('saved-state').textContent = savedText(L.conflict || L.saved);
  for (const lvl of Object.keys(state.levels)) {
    const tab = $(`tab-${lvl}`);
    tab.classList.toggle('active', Number(lvl) === state.level);
    tab.setAttribute('aria-selected', String(Number(lvl) === state.level));
    tab.replaceChildren(`Level ${lvl}`, isDirty(state.levels[lvl]) ? h('span', { class: 'q-dot', title: 'Unsaved changes' }) : '');
  }
  $('expand-all').textContent = state.allOpen ? 'Hide other languages' : 'Show all languages';
  $('expand-all').setAttribute('aria-pressed', String(state.allOpen));
}

function toggleRow(L, k) {
  if (L.open.has(k) || state.allOpen) {
    if (state.allOpen) {
      // Leave "show all" and keep every other row open.
      state.allOpen = false;
      L.refs.forEach((row, a) => row.forEach((_, b) => L.open.add(rowKey(a, b))));
      L.topicRefs.forEach((_, a) => L.open.add(topicKey(a)));
    }
    L.open.delete(k);
  } else L.open.add(k);
  refresh();
}

function replaceChoice(L, i, j) {
  const k = rowKey(i, j);
  // Keep the first version: a second Replace still undoes back to the question that was there.
  if (!L.replaced.has(k)) L.replaced.set(k, copy(L.draft[i][j]));
  L.draft[i][j] = { key: null, text: blank() };
  L.server = L.server.filter((p) => !(p.field !== 'title' && p.slot === i + 1 && p.choice === j + 1));
  L.fresh.add(k);
  L.collisions.delete(k);
  const r = L.refs[i][j];
  for (const l of LANGS) r.inputs[l].value = '';
  L.open.add(k);
  refresh();
  fitAll(r.li);
  r.inputs.en.focus();
}

function undoReplace(L, i, j) {
  const k = rowKey(i, j);
  const prev = L.replaced.get(k);
  if (!prev) return;
  L.draft[i][j] = copy(prev);
  L.replaced.delete(k);
  L.fresh.delete(k);
  L.server = L.server.filter((p) => !(p.field !== 'title' && p.slot === i + 1 && p.choice === j + 1));
  const r = L.refs[i][j];
  for (const l of LANGS) r.inputs[l].value = prev.text?.[l] ?? '';
  refresh();
  fitAll(r.li);
  r.inputs.en.focus();
}

/** Open the rows with problems and put the cursor in the first bad box. */
function revealProblems(L, problems) {
  let first = null;
  for (const p of problems) {
    if (!p.slot || (!p.choice && p.field !== 'title')) continue;
    const k = p.field === 'title' ? topicKey(p.slot - 1) : rowKey(p.slot - 1, p.choice - 1);
    if (p.lang && p.lang !== 'en') L.open.add(k);
    first ??= p;
  }
  refresh();
  const r = first && (first.field === 'title' ? L.topicRefs[first.slot - 1] : L.refs[first.slot - 1]?.[first.choice - 1]);
  if (r) {
    const node = r.inputs[first.lang || 'en'];
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    node.focus({ preventScroll: true });
  }
}

// ---------- actions ----------
/** A level view from the server with its topics as [topic|null] × pick. */
function viewOf(view) {
  const titles = Array.from({ length: view.slots.length }, (_, i) => (hasText(view.titles?.[i]) ? normText(view.titles[i]) : null));
  return { ...view, titles };
}

function setLevel(raw) {
  const view = viewOf(raw);
  state.levels[view.level] = {
    saved: view,
    draft: copy(view.slots),
    titles: view.titles.map((t) => (t ? { ...t } : blank())),
    open: new Set(),
    server: [],
    refs: [],
    topicRefs: [],
    replaced: new Map(), // row → the choice that was there before "Replace" (for Undo and the "Was:" hints)
    fresh: new Set(), // replaced rows the admin has not left yet
    collisions: new Map(), // row → the other tab's English, when both tabs changed it
    conflict: null, // the newer save from another tab (after a 409), until loaded or discarded
  };
  return state.levels[view.level];
}

function selectLevel(level) {
  if (!state.levels[level]) return;
  state.level = level;
  history.replaceState(null, '', `#L${level}`);
  buildLevel();
}

async function save() {
  const L = cur();
  if (L.conflict || state.busy) return;
  const level = state.level;
  L.fresh.clear();
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
    r = await call('PUT', `${API}/L${level}`, { slots: norm(L.draft), titles: normTitles(L.titles), updatedAt: L.saved.updatedAt });
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
  } else if (r.status === 409 && r.data.current) {
    // Another tab saved first. Nothing is thrown away: the bar keeps saying so until the admin
    // loads that save (keeping these edits on top) or discards them.
    L.conflict = viewOf(r.data.current);
    refresh();
    toast(`Level ${level} was saved in another tab. Your edits are still here.`, 8000);
  } else {
    refresh();
    if (r.data.error) toast(r.data.error);
  }
}

/** After a 409: take the other tab's save and put this tab's edited rows back on top of it. */
function loadLatest() {
  const L = cur();
  const theirs = L.conflict;
  if (!theirs) return;
  const base = L.saved;
  const collisions = new Map();
  const replaced = new Map();
  let kept = 0;
  const draft = theirs.slots.map((slot, i) => slot.map((t, j) => {
    const k = rowKey(i, j);
    const mine = L.draft[i]?.[j];
    const was = base.slots[i]?.[j];
    if (!mine || sameRow(mine, was)) return copy(t);
    kept++;
    if (!sameRow(t, was) && !sameRow(mine, t)) collisions.set(k, clean(t.text.en));
    if (L.replaced.has(k)) replaced.set(k, L.replaced.get(k));
    return copy(mine);
  }));
  const titles = theirs.titles.map((t, i) => {
    const mine = L.titles[i];
    const was = base.titles[i];
    if (sameTitle(mine, was)) return t ? { ...t } : blank();
    kept++;
    if (!sameTitle(t, was) && !sameTitle(mine, t)) collisions.set(topicKey(i), clean(t?.en));
    return { ...mine };
  });
  const open = L.open;
  const M = setLevel(theirs);
  Object.assign(M, { draft, titles, collisions, replaced, open });
  buildLevel();
  const both = collisions.size ? ` ${plural(collisions.size, 'row was', 'rows were')} changed in both tabs: marked below.` : '';
  toast(`Loaded the save from ${timeOf(theirs.updatedAt)}. ${plural(kept, 'edit', 'edits')} of yours kept.${both} Save when ready.`, 9000);
}

async function resetLevel() {
  const level = state.level;
  const L = cur();
  const n = L.saved.pick * L.saved.choices;
  if (!confirm(`Reset Level ${level} to the built-in choices?\n\nAll ${n} choices of Level ${level} are replaced and the topics are cleared, including unsaved edits. Questions people already sent keep their text.`)) return;
  state.busy = true;
  refresh();
  const r = await call('POST', `${API}/L${level}/reset`, {}).catch(() => ({ ok: false, data: { error: 'Could not reach the server. Try again.' } }));
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
  const n = plural(editCount(L), 'edit', 'edits');
  const question = L.conflict
    ? `Discard your ${n} to Level ${state.level} and load the save from ${timeOf(L.conflict.updatedAt)}?\n\nYour ${n} will be lost.`
    : `Discard your ${n} to Level ${state.level}?\n\nYour ${n} will be lost.`;
  if (!confirm(question)) return;
  setLevel(L.conflict || L.saved);
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
$('merge').addEventListener('click', loadLatest);
$('reset').addEventListener('click', resetLevel);
$('discard').addEventListener('click', discard);
$('signout').addEventListener('click', async () => {
  await fetch('/30da/admin/api/signout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
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
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => fitAll($('slots')), 150);
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
