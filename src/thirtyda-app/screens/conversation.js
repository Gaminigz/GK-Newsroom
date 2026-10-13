// #/c/:pairId · The conversation — one screen for the whole story between two people (owner's model,
// 2026-10-13: "Dara can start, send to Sophea, Sophea answers, Dara can see the answers above. Sophea can
// start, send to Dara, Dara can see them in the same UI. Then Level 2 the same. Level 3 becomes direct
// chat; the things above just become texts: what you told me before and what you asked me before.")
//
// Level 1 and Level 2: each person sends the other ONE set of 5 lines per level, in any order, and replies
// to the 5 they got, line by line (Level 1: one tap — Yes / No / Not really / Maybe, a written line Yes /
// No; Level 2: in words, saved as you type). Everything stays above as plain history, oldest first, like
// a chat: their lines on the left with my replies under them, my lines on the right with theirs. The
// bottom of the screen is the one thing to do now: send your 5, reply, wait, or (Level 3) chat.
// GET /pairs/:id/conversation is the one read model; replies save one at a time with PUT /replies.
import {
  screen, el, icon, t, go, api, toast, topBar, levelBar, countdown, errorText, registerStrings, heartbeat,
  stageLevel, nextKind, l1Answers, answerText, checkWrittenAnswer,
} from '../core.js';
import {
  sendPanel, ruleMessage, showError, translateNote, redirected, ANSWER_MAX, myLang, enc,
} from './level-ask.js';
import { mountChat, ensureStyles, partnerHeader, fmtTime, dayLabel } from './chat.js';

const POLL_MS = 4000; // the other person's lines and replies show up while you look
const POLL_MAX_MS = 30000; // back-off ceiling while offline
const SAVE_PAUSE_MS = 1800; // Level 2 words save after a pause in typing (and on leaving the box)

// Survive leaving the screen (not a reload).
const replyDrafts = new Map(); // `${pairId}|${setId}|${n}` → Level 2 words typed and not saved yet
const panelOpen = new Map(); // pairId → the send panel opened (true) or folded (false) by hand

const unwrap = (r) => (r && typeof r === 'object' && r.conversation ? r.conversation : r);
const ms = (iso) => Date.parse(iso) || 0;
const same = (a, b) => String(a ?? '').trim() === String(b ?? '').trim();

// ---------------------------------------------------------------- notifications ("Remind me")

function notificationState() {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

// Must run inside the tap (user activation), before any await. Older Safari takes a callback and
// returns nothing, so the answer is always re-read from Notification.permission.
function askNotifications() {
  if (notificationState() !== 'default') return Promise.resolve(notificationState());
  return new Promise((resolve) => {
    const finish = () => resolve(notificationState());
    try {
      const p = Notification.requestPermission(finish);
      if (p && typeof p.then === 'function') p.then(finish, finish);
    } catch {
      finish();
    }
  });
}

// ---------------------------------------------------------------- the screen

screen('/c/:pairId', async ({ params, root }) => {
  ensureStyles();
  root.classList.add('chat', 'conv');
  root.append(topBar({ left: 'back' }), el('p', { class: 'loading' }, t('core_loading')));
  const base = `/pairs/${enc(params.pairId)}`;
  const conv = unwrap(await api.get(`${base}/conversation`));
  if (!root.isConnected) return null;
  if (conv?.chat?.open) {
    const res = await api.get(`${base}/messages`).then((v) => ({ v }), (e) => ({ e }));
    if (!root.isConnected) return null;
    if (res.v || res.e?.code === 'phone_needed') return mountConversation(root, base, conv, res);
    if (res.e?.code !== 'chat_closed') throw res.e;
    // The chat is not open after all (clock skew): show the conversation as it is.
  }
  return mountConversation(root, base, conv, null);
});

/** chat = null (Levels 1–2), or the chat's first read ({ v: messages } | { e: phone_needed }). */
function mountConversation(root, base, initial, chat) {
  let conv = initial;
  const pairId = conv.pair?.id;
  const chatMode = Boolean(chat);
  let alive = true;
  let ver = 0; // bumps on every write: a poll that started before it is dropped
  let pollTimer = null;
  let polling = false;
  let fails = 0;
  let clocks = [];
  let deferred = false; // a timeline paint waits until the reply box being typed in lets go
  let pressing = false;
  let remindBusy = false;
  const editing = new Set(); // reply keys reopened to change
  const busy = new Set(); // reply keys being saved
  const again = new Set(); // reply keys changed while their save was in flight
  const failed = new Set(); // reply keys whose last save did not go through
  const serverErr = new Map(); // reply key → the server's verdict, until the box changes
  const stopped = new Map(); // reply key → the text the server stopped (not posted twice)
  const saveTimers = new Map();

  const name = () => conv.other?.name || conv.pair?.other?.name || '';
  const theirLang = () => conv.other?.lang || conv.pair?.other?.lang || 'en';
  const frozen = () => nextKind(conv.next) === 'frozen' || conv.pair?.next === 'frozen';
  const setLevels = () => (conv.levels || []).filter((L) => L && (L.level === 1 || L.level === 2)).sort((a, b) => a.level - b.level);
  const levelOf = (n) => setLevels().find((L) => L.level === n) || null;
  const openLevel = () => setLevels().find((L) => L.state === 'open') || null;
  const draftKey = (key) => `${pairId}|${key}`;
  const keyOf = (s, line) => `${s.id}|${line.n}`;
  const lineId = (key) => `cv-q-${key.replace(/[^\w-]/g, '-')}`;
  // The server says so per set (canReply); older answers are worked out the same way here.
  const canReply = (s) => !chatMode && !frozen() && !s.completedAt && s.from !== 'me'
    && (typeof s.canReply === 'boolean' ? s.canReply : levelOf(s.level)?.state === 'open');

  /** The line (and its set) for a reply key, in the current conversation. */
  function find(key) {
    for (const L of setLevels()) {
      for (const s of [L.mine, L.theirs]) {
        if (!s) continue;
        const line = (s.lines || []).find((l) => keyOf(s, l) === key);
        if (line) return { s, line };
      }
    }
    return null;
  }

  /** The first line sent to me (in the open level) that has no reply from me yet. */
  function firstUnreplied() {
    const L = openLevel();
    const s = L?.theirs;
    if (!s || s.completedAt || frozen()) return null;
    const line = [...(s.lines || [])].sort((a, b) => a.n - b.n).find((l) => !l.reply);
    return line ? { s, line } : null;
  }

  // ------------------------------------------------ header: back, photos (per level), name, level, EN⇄KM

  function headerNode() {
    const stage = conv.pair?.stage;
    const fallback = stage === 'l2_wait' ? 1 : stage === 'l3_wait' ? 2 : stageLevel(conv.pair);
    const level = conv.chat?.open ? 3 : Math.max(1, Math.min(3, Number(conv.pair?.level) || fallback));
    const photos = (conv.other?.photos?.length ? conv.other.photos : [conv.pair?.other?.photo]).filter(Boolean).slice(0, 4);
    const sub = el('span', { class: 'conv-sub' }, el('span', {}, t('cv_level_bar', { n: level })), levelBar(level));
    return partnerHeader({ name: name(), photos, myLang: myLang(), theirLang: theirLang(), sub });
  }
  const headerSig = (c) => JSON.stringify([c.other?.name, c.other?.lang, c.other?.photos, c.pair?.level, c.pair?.stage, c.chat?.open]);

  // ------------------------------------------------ timeline (oldest first)

  function stopClocks() {
    clocks.forEach((stop) => stop());
    clocks = [];
  }

  const divider = (text) => el('div', { class: 'day-divider conv-divider' }, el('span', { class: 'label ink' }, text));

  function intro(level) {
    return el('div', { class: 'conv-intro' },
      el('span', { class: 'conv-intro-icon', 'aria-hidden': 'true' }, icon('chat', 20)),
      el('p', {}, t(level === 1 ? 'cv_intro_1' : 'cv_intro_2', { name: name() })),
      translateNote({ other: { lang: theirLang() } }));
  }

  /** Topic (small) + the line. Their written lines: their words, then my language under them. */
  function lineParts(line, mineSide) {
    const parts = [];
    if (line.topic) parts.push(el('span', { class: 'conv-topic' }, line.topic));
    if (line.source !== 'written') {
      parts.push(el('span', { class: 'orig' }, line.text ?? line.original ?? ''));
      return parts;
    }
    const orig = line.original ?? line.text ?? '';
    if (mineSide) {
      parts.push(el('span', { class: 'orig' }, orig));
      return parts;
    }
    const tr = typeof line.translated === 'string' ? line.translated : line.text;
    const lang = line.originalLang || theirLang();
    parts.push(el('span', { class: 'orig', lang }, orig));
    if (tr && !same(tr, orig)) parts.push(el('span', { class: 'trans', lang: myLang() }, tr));
    else if (lang !== myLang() && line.translated !== true) parts.push(el('span', { class: 'trans-note' }, t('cv_no_translation')));
    return parts;
  }

  /** Their reply under one of my lines: a Level 1 option, or their words (and my language under them). */
  function theirReply(r, level) {
    if (level === 1) {
      return el('div', { class: 'bubble theirs conv-reply' }, el('span', { class: 'orig' }, answerText(r.key, myLang()) || r.text || ''));
    }
    const orig = r.original ?? r.text ?? '';
    const tr = r.text && !same(r.text, orig) ? r.text : null;
    const untranslated = !tr && theirLang() !== myLang() && r.translated !== true;
    return el('div', { class: 'bubble theirs conv-reply' },
      el('span', { class: 'orig', lang: theirLang() }, orig),
      tr ? el('span', { class: 'trans', lang: myLang() }, tr) : untranslated ? el('span', { class: 'trans-note' }, t('cv_no_translation')) : null);
  }

  function myLine(s, line) {
    return el('div', { class: 'conv-line mine' },
      el('div', { class: 'bubble mine' }, lineParts(line, true)),
      line.reply
        ? theirReply(line.reply, s.level)
        : el('span', { class: 'conv-pending' }, icon('clock', 12), el('span', {}, t('cv_waiting'))));
  }

  function theirLine(s, line) {
    const key = keyOf(s, line);
    return el('div', { class: 'conv-line theirs', dataset: { key } },
      el('div', { class: 'bubble theirs', id: lineId(key) }, lineParts(line, false)),
      myReply(s, line, key));
  }

  /** My reply under one of their lines: a bubble (tap to change while the set is not complete), or the controls. */
  function myReply(s, line, key) {
    const r = line.reply;
    const open = canReply(s);
    const hasDraft = s.level === 2 && replyDrafts.has(draftKey(key));
    if (r && (!open || (!editing.has(key) && !hasDraft))) {
      const text = s.level === 1 ? answerText(r.key, myLang()) || r.text || '' : r.original ?? r.text ?? '';
      if (!open) return el('div', { class: 'bubble mine conv-reply' }, el('span', { class: 'orig' }, text));
      return el('button', {
        type: 'button', class: 'bubble mine conv-reply can-change', 'aria-label': t('cv_change_aria', { text }),
        on: { click: () => startEdit(key) },
      }, el('span', { class: 'orig' }, text));
    }
    if (!open) return null;
    return s.level === 1 ? replyChips(s, line, key) : replyBox(s, line, key);
  }

  // Yes / No / Not really / Maybe; the sender's own written line: Yes / No (the server lists them per line).
  function replyChips(s, line, key) {
    const current = line.reply?.key ?? null;
    const options = Array.isArray(line.options) && line.options.length
      ? line.options
      : l1Answers(line.source).map((a) => ({ key: a.key, text: answerText(a.key, myLang()) || a.text.en }));
    return el('div', { class: 'chips conv-chips', role: 'group', 'aria-labelledby': lineId(key) },
      options.map((a) => el('button', {
        type: 'button', class: 'chip', 'aria-pressed': String(current === a.key), disabled: busy.has(key),
        dataset: { answer: a.key }, on: { click: () => replyL1(s, line, a.key, key) },
      }, answerText(a.key, myLang()) || a.text || a.key)));
  }

  function replyBox(s, line, key) {
    const dk = draftKey(key);
    const savedText = line.reply ? line.reply.original ?? line.reply.text ?? '' : '';
    const errId = `${lineId(key)}-err`;
    const err = el('p', { class: 'field-error', id: errId, 'aria-live': 'polite', hidden: true });
    const status = el('span', { class: 'conv-save-state', 'aria-live': 'polite' });
    const box = el('textarea', {
      class: 'textarea conv-box', rows: 2, placeholder: t('cv_reply_ph'), autocapitalize: 'sentences', maxlength: 400,
      value: replyDrafts.has(dk) ? replyDrafts.get(dk) : savedText,
      'aria-labelledby': lineId(key), 'aria-describedby': errId, dataset: { key },
    });
    const send = el('button', { type: 'button', class: 'round-btn conv-send', 'aria-label': t('cv_save_reply') }, icon('send', 16));
    const paint = () => {
      const text = box.value; // the box is the truth while it is on screen (a saved draft is dropped)
      const check = checkWrittenAnswer(text.trim());
      const msg = serverErr.get(key) || ruleMessage(check, ANSWER_MAX);
      box.classList.toggle('is-error', Boolean(msg));
      box.setAttribute('aria-invalid', String(Boolean(msg)));
      showError(err, msg);
      const saved = Boolean(text.trim()) && same(text, find(key)?.line.reply?.original ?? find(key)?.line.reply?.text);
      status.replaceChildren(...(busy.has(key)
        ? [t('cv_saving')]
        : saved ? [icon('check', 12), t('cv_saved')] : failed.has(key) ? [t('cv_not_saved')] : []));
      send.setAttribute('aria-disabled', String(busy.has(key) || saved || !(check.ok || check.error === 'contact')));
    };
    box.addEventListener('input', () => {
      replyDrafts.set(dk, box.value);
      serverErr.delete(key);
      failed.delete(key);
      paint();
      clearTimeout(saveTimers.get(key));
      saveTimers.set(key, setTimeout(() => saveL2(key, false), SAVE_PAUSE_MS));
    });
    // Leaving the box is "done with this reply": it saves, and a contact detail goes to the server once,
    // which stops it and records the attempt for the admin (the pause save never sends one).
    box.addEventListener('blur', () => {
      saveL2(key, true).then(() => {
        if (!alive || document.activeElement === box || replyDrafts.has(dk)) return;
        editing.delete(key);
        renderSoon();
      });
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing) {
        e.preventDefault();
        saveL2(key, true);
      }
    });
    send.addEventListener('mousedown', (e) => e.preventDefault()); // keep the keyboard up
    send.addEventListener('click', () => saveL2(key, true));
    box.repaint = paint;
    paint();
    return el('div', { class: 'conv-edit' }, el('div', { class: 'conv-edit-row' }, box, send), err, status);
  }

  /** "Sophea replied 2 of 5" under my set; "You replied 2 of 5" (+ how replying works) under theirs. */
  function progress(s, mine, replied, total) {
    const done = Boolean(s.completedAt) || replied >= total;
    if (mine && !replied && !done) return null; // the "waiting" marks and the bottom line say it already
    let text;
    if (mine) {
      text = done ? t('cv_they_replied_all', { name: name(), total })
        : replied ? t('cv_they_replied', { name: name(), n: replied, total }) : t('cv_they_none', { name: name() });
    } else {
      text = done ? t('cv_you_replied_all', { total }) : t('cv_you_replied', { n: replied, total });
    }
    const hint = !mine && !done && canReply(s) ? t(`cv_hint_${s.level}`) : null;
    return el('div', { class: ['conv-progress', done && 'ok'] },
      el('span', { class: 'conv-progress-line' }, done ? icon('check', 13) : null, el('span', {}, text)),
      hint ? el('span', { class: 'conv-hint' }, hint) : null);
  }

  function setNodes(s) {
    const mine = s.from === 'me';
    const lines = [...(s.lines || [])].sort((a, b) => a.n - b.n);
    const total = lines.length || 5;
    const replied = Number.isFinite(s.replied) ? s.replied : lines.filter((l) => l.reply).length;
    const who = mine ? t('cv_you') : name();
    return [
      el('p', { class: 'conv-cap label' }, s.sentAt ? `${who} · ${dayLabel(s.sentAt)} ${fmtTime(s.sentAt)}` : who),
      ...lines.map((line) => (mine ? myLine(s, line) : theirLine(s, line))),
      progress(s, mine, replied, total),
    ].filter(Boolean);
  }

  function remindButton() {
    const on = Boolean(conv.pair?.remind);
    const b = el('button', {
      type: 'button', class: ['chip chip-sm conv-remind', on && 'on'], 'aria-pressed': String(on), disabled: remindBusy,
    }, icon(on ? 'check' : 'bell', 14), el('span', {}, on ? t('cv_remind_on') : t('cv_remind')));
    b.addEventListener('click', () => {
      if (remindBusy) return;
      const want = !conv.pair?.remind;
      remindBusy = true;
      b.disabled = true;
      const asked = want ? askNotifications() : Promise.resolve(notificationState());
      asked.then(async (permission) => {
        try {
          const r = await api.post(`${base}/remind`, { on: want });
          if (conv.pair) conv.pair.remind = Boolean(r.pair?.remind ?? want);
          if (want && permission !== 'granted') toast(t('cv_notify_off'));
        } catch (err) {
          if (!redirected(err)) toast(errorText(err));
        }
        remindBusy = false;
        if (alive) renderSoon();
      });
    });
    return b;
  }

  /** "Level 2 opens in 23:59:12 · Remind me" (Level 3: "Chat opens in …"). */
  function waitBanner(level, until) {
    const time = el('b', { class: 'tabular', role: 'timer', 'aria-live': 'off' }, '--:--:--');
    // At zero the server opens the level on its next read; never loop on a time already past.
    const future = ms(until) > Date.now();
    clocks.push(countdown(time, until, future ? () => setTimeout(() => poll(true), 700) : null));
    const [before, after = ''] = t(level === 3 ? 'cv_chat_opens_in' : 'cv_opens_in', { n: level }).split('{time}');
    return el('div', { class: 'conv-wait' },
      el('span', { class: 'conv-wait-icon', 'aria-hidden': 'true' }, icon('clock', 16)),
      el('span', { class: 'conv-wait-text' }, before, time, after),
      chatMode ? null : remindButton());
  }

  function timelineNodes() {
    stopClocks();
    const out = [];
    const levels = setLevels();
    if (!levels.length) out.push(divider(t('cv_level', { n: 1 })), intro(1));
    for (const L of levels) {
      const sets = [L.mine, L.theirs].filter(Boolean).sort((a, b) => ms(a.sentAt) - ms(b.sentAt));
      if (!sets.length) {
        if (L.state === 'wait') out.push(waitBanner(L.level, L.opensAt || conv.pair?.l2OpensAt));
        else if (L.state === 'open') out.push(divider(t('cv_level', { n: L.level })), intro(L.level));
        continue;
      }
      out.push(divider(t('cv_level', { n: L.level })));
      for (const s of sets) out.push(...setNodes(s));
    }
    const l3 = (conv.levels || []).find((L) => L?.level === 3);
    if (!conv.chat?.open && (conv.pair?.stage === 'l3_wait' || l3?.state === 'wait')) {
      out.push(waitBanner(3, l3?.opensAt || conv.chat?.opensAt || conv.pair?.l3OpensAt));
    }
    return out;
  }
  const timelineSig = (c) => JSON.stringify([c.levels, c.pair?.stage, c.pair?.l2OpensAt, c.pair?.l3OpensAt, c.pair?.next, c.next, c.chat]);

  // ------------------------------------------------ Level 3: the chat under the history

  if (chatMode) {
    const history = el('div', { class: 'conv-thread conv-history' },
      ...timelineNodes(),
      divider(t('cv_chat_level')),
      el('div', { class: 'banner', role: 'note' }, icon('shield', 16), el('span', {}, t('chat_text_only'))));
    const gate = frozen() ? 'closed' : chat.e?.code === 'phone_needed' ? 'phone' : null;
    const stop = mountChat(root, { pair: conv.pair, data: chat.v || null, gate, history, header: headerNode() });
    return () => {
      alive = false;
      stopClocks();
      stop?.();
    };
  }

  // ------------------------------------------------ Levels 1–2

  const timeline = el('div', { class: 'conv-thread' });
  const scroller = el('div', { class: 'chat-scroll' }, timeline);
  const body = el('div', { class: 'chat-body' }, scroller);
  const foot = el('div', { class: 'chat-foot conv-foot' });
  let header = headerNode();

  const typing = () => {
    const a = document.activeElement;
    return Boolean(a && a.tagName === 'TEXTAREA' && timeline.contains(a));
  };

  // Repaint in place; someone reading the newest (at the bottom) stays at the bottom, where it grew.
  function renderTimeline() {
    deferred = false;
    const top = scroller.scrollTop;
    const atEnd = scroller.scrollHeight - top - scroller.clientHeight < 64;
    timeline.replaceChildren(...timelineNodes());
    scroller.scrollTop = atEnd ? scroller.scrollHeight : top;
  }

  // Never rebuild under a box someone is typing in (or under a finger): paint when they let go.
  function renderSoon() {
    if (typing() || pressing) deferred = true;
    else renderTimeline();
  }
  const flush = () => setTimeout(() => {
    if (alive && deferred && !typing() && !pressing) renderTimeline();
  }, 60);
  timeline.addEventListener('focusout', flush);
  scroller.addEventListener('pointerdown', () => { pressing = true; }, true);
  const release = () => {
    if (!pressing) return;
    pressing = false;
    flush();
  };
  window.addEventListener('pointerup', release, true);
  window.addEventListener('pointercancel', release, true);

  function startEdit(key) {
    editing.add(key);
    renderTimeline();
    const line = timeline.querySelector(`[data-key="${key}"]`);
    const box = line?.querySelector('textarea');
    if (box) {
      box.focus();
      box.setSelectionRange?.(box.value.length, box.value.length);
    } else {
      (line?.querySelector('.chip[aria-pressed="true"]') || line?.querySelector('.chip'))?.focus();
    }
  }

  /** After a Level 1 tap: bring the next line waiting for a reply into view when it is off screen. */
  function revealNext(key) {
    const lines = [...timeline.querySelectorAll('.conv-line.theirs')];
    const from = lines.findIndex((n) => n.dataset.key === key);
    const next = lines.slice(from + 1).find((n) => n.querySelector('.conv-chips, .conv-edit'));
    if (!next) return;
    const box = next.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    if (box.top >= view.top + 8 && box.bottom <= view.bottom - 8) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    next.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' });
  }

  function scrollToUnreplied() {
    const node = timeline.querySelector('.conv-chips, .conv-edit')?.closest('.conv-line');
    if (node) node.scrollIntoView({ block: 'center' });
    return Boolean(node);
  }

  // ------------------------------------------------ replies

  function replyFailed(err, key, text) {
    if (!alive || redirected(err)) return;
    if (err.code === 'contact_detail') {
      stopped.set(key, text);
      serverErr.set(key, ruleMessage({ error: 'contact', hits: err.data?.hits }, ANSWER_MAX));
      toast(t('lv_stopped'));
    } else if (err.code === 'invalid' || err.status === 422) {
      serverErr.set(key, err.data?.reason === 'too_long' ? t('lv_too_long', { max: ANSWER_MAX }) : t('cv_check'));
    } else if (err.status === 409 || err.status === 404) {
      toast(err.code === 'other_blocked' ? t('cv_closed') : t('cv_moved'));
      poll(true);
    } else {
      failed.add(key);
      toast(errorText(err));
    }
  }

  async function replyL1(s, line, answer, key) {
    if (!alive || busy.has(key)) return;
    if (line.reply?.key === answer) {
      editing.delete(key);
      renderSoon();
      return;
    }
    busy.add(key);
    ver++;
    // The tap shows at once; the chips wait for the server.
    timeline.querySelectorAll(`[data-key="${key}"] .conv-chips .chip`).forEach((c) => {
      c.setAttribute('aria-pressed', String(c.dataset.answer === answer));
      c.disabled = true;
    });
    try {
      const r = await api.put(`${base}/replies`, { level: 1, n: line.n, key: answer });
      busy.delete(key);
      editing.delete(key);
      apply(unwrap(r));
      if (alive) revealNext(key);
    } catch (err) {
      busy.delete(key);
      replyFailed(err, key);
      if (alive) renderTimeline();
    }
  }

  const repaintBox = (key) => timeline.querySelector(`textarea[data-key="${key}"]`)?.repaint?.();

  /** Save one Level 2 reply. force = the send button: a contact detail still goes (the server stops and records it). */
  async function saveL2(key, force) {
    clearTimeout(saveTimers.get(key));
    saveTimers.delete(key);
    const dk = draftKey(key);
    const found = find(key);
    if (!alive || !found || !replyDrafts.has(dk)) return;
    const text = replyDrafts.get(dk).trim();
    if (same(text, found.line.reply?.original ?? found.line.reply?.text) && text) {
      replyDrafts.delete(dk);
      repaintBox(key);
      return;
    }
    const check = checkWrittenAnswer(text);
    if (!check.ok && !(force && check.error === 'contact')) return; // the box already says why
    if (check.error === 'contact' && stopped.get(key) === text) {
      toast(t('lv_stopped'));
      return;
    }
    if (busy.has(key)) {
      again.add(key);
      return;
    }
    busy.add(key);
    failed.delete(key);
    ver++;
    repaintBox(key);
    try {
      const r = await api.put(`${base}/replies`, { level: 2, n: found.line.n, text });
      busy.delete(key);
      if (same(replyDrafts.get(dk), text)) replyDrafts.delete(dk);
      apply(unwrap(r));
    } catch (err) {
      busy.delete(key);
      replyFailed(err, key, text);
    }
    repaintBox(key);
    if (again.delete(key) && alive) await saveL2(key, false);
  }

  // ------------------------------------------------ bottom: send your 5 · your turn · waiting · closed

  let panel = null;
  let panelSig = null;
  let panelTitle = null;
  let panelFold = null; // folds the open panel (when their lines arrive while it is open on its own)
  let panelHadReplies = false; // their lines were waiting for my replies at the last paint
  let footSig = null;

  function footKind() {
    if (frozen()) return 'closed';
    if (conv.canSend) return 'send';
    if (firstUnreplied()) return 'reply';
    if (openLevel()) return 'wait';
    return 'none'; // a level timer runs: the banner above says it
  }

  /** What the status line depends on: my replies to their set, their replies to mine. */
  function footState() {
    const L = openLevel();
    const count = (x) => (x ? [(x.lines || []).filter((l) => l.reply).length, Boolean(x.completedAt)] : null);
    return [L?.level ?? null, count(L?.mine), count(L?.theirs)];
  }

  function statusRow(iconName, text, action = null) {
    return el('div', { class: 'conv-status', role: 'status' }, icon(iconName, 16), el('span', { class: 'grow' }, text), action);
  }

  function renderPanel() {
    const cs = conv.canSend;
    const theirsSent = Boolean(levelOf(cs.level)?.theirs);
    const title = theirsSent ? t('cv_send_your', { name: name() }) : t('cv_start_level', { n: cs.level });
    const sig = JSON.stringify([cs.level, cs.pick, cs.write, cs.slots]);
    const toReply = Boolean(firstUnreplied());
    // Same level and lists: keep the panel (and whatever is being typed in it); only the title follows.
    if (panel && sig === panelSig && foot.contains(panel.node)) {
      if (panelTitle && panelTitle.textContent !== title) panelTitle.textContent = title;
      // Their 5 just arrived while the panel stood open on its own: fold it so their lines and my reply
      // boxes get the screen (not while I type in it, nor when I opened it by hand).
      if (toReply && !panelHadReplies && !panelOpen.has(pairId) && !foot.contains(document.activeElement)) panelFold?.();
      panelHadReplies = toReply;
      return;
    }
    panelSig = sig;
    panelHadReplies = toReply;
    panel = sendPanel({
      pairId, level: cs.level, bank: cs, name: name(),
      onSent: (r) => {
        panelOpen.delete(pairId);
        ver++;
        const toEnd = () => { if (alive) scroller.scrollTop = scroller.scrollHeight; };
        if (r?.conversation) {
          apply(unwrap(r));
          requestAnimationFrame(toEnd);
        } else {
          poll(true).then(toEnd);
        }
      },
      onReload: () => {
        panelSig = null;
        poll(true);
      },
      onMoved: (err) => {
        toast(err.code === 'other_blocked' ? t('cv_closed') : t('cv_moved'));
        panelSig = null;
        poll(true);
      },
    });
    // Folded while their lines still wait for my replies (open it by hand any time).
    const open = panelOpen.has(pairId) ? panelOpen.get(pairId) : !firstUnreplied();
    const { pick, write } = panel;
    const bodyNode = el('div', { class: 'conv-panel-body', id: 'cv-panel-body', hidden: !open }, panel.node);
    panelTitle = el('strong', {}, title);
    const head = el('button', { type: 'button', class: 'conv-panel-head', 'aria-expanded': String(open), 'aria-controls': 'cv-panel-body' },
      el('span', { class: 'conv-panel-title' },
        panelTitle,
        el('span', { class: 'label' }, t('la_rule', { pick, write }))),
      icon('chevron', 18));
    head.addEventListener('click', () => {
      const opening = bodyNode.hidden;
      panelOpen.set(pairId, opening);
      bodyNode.hidden = !opening;
      head.setAttribute('aria-expanded', String(opening));
    });
    panelFold = () => {
      bodyNode.hidden = true;
      head.setAttribute('aria-expanded', 'false');
    };
    foot.hidden = false;
    footSig = null;
    foot.replaceChildren(el('div', { class: 'conv-panel' }, head, bodyNode));
  }

  function renderFoot() {
    const kind = footKind();
    if (kind === 'send') {
      renderPanel();
      return;
    }
    // A status line repaints only when it says something new (it is a live region).
    const sig = JSON.stringify([kind, kind === 'closed' ? null : footState()]);
    if (sig === footSig && !panel) return;
    footSig = sig;
    panel = null;
    panelSig = null;
    panelTitle = null;
    panelFold = null;
    foot.hidden = kind === 'none';
    if (kind === 'closed') {
      foot.replaceChildren(el('p', { class: 'lock-note chat-closed', role: 'status' }, icon('lock', 14), el('span', {}, t('cv_closed'))));
    } else if (kind === 'reply') {
      const { s } = firstUnreplied();
      const total = (s.lines || []).length || 5;
      const done = (s.lines || []).filter((l) => l.reply).length;
      const show = el('button', { type: 'button', class: 'link', on: { click: () => scrollToUnreplied() } }, t('cv_show'));
      foot.replaceChildren(statusRow('chat', t('cv_turn_reply', { name: name(), n: done, total }), show));
    } else if (kind === 'wait') {
      const L = openLevel();
      const mine = L.mine;
      const total = (mine?.lines || []).length || 5;
      const replied = (mine?.lines || []).filter((l) => l.reply).length;
      // Their replies coming in say the most ("Sophea is replying · 2/5"), even before their own 5 arrive.
      let text;
      if (mine && !mine.completedAt && replied) text = t('cv_replying', { name: name(), n: replied, total });
      else if (!L.theirs) text = t('cv_wait_lines', { name: name() });
      else if (mine && !mine.completedAt) text = t('cv_wait_replies', { name: name() });
      else text = t('cv_wait_lines', { name: name() });
      foot.replaceChildren(statusRow('clock', text));
    } else {
      foot.replaceChildren();
    }
  }

  // ------------------------------------------------ updates (replies, sends, polls)

  /** Toasts for what just changed: my replies all in, theirs all in, a level open. */
  function announce(prev, next) {
    for (const L of (next.levels || [])) {
      const P = (prev.levels || []).find((x) => x?.level === L?.level);
      if (!P) continue;
      if (P.theirs && !P.theirs.completedAt && L.theirs?.completedAt) {
        toast(t('cv_all_replied', { name: name() }));
        heartbeat(); // My conversations: the red dot goes now, not at the next beat
      }
      if (P.mine && !P.mine.completedAt && L.mine?.completedAt) toast(t('cv_they_all', { name: name() }));
      if (P.state !== 'open' && L.state === 'open' && L.level === 2) toast(t('cv_level_open', { n: 2 }));
    }
  }

  function apply(next) {
    if (!alive || !next?.pair) return;
    const prev = conv;
    conv = next;
    if (conv.chat?.open) { // Level 3 opened: the chat mounts under the history
      go(`/c/${enc(pairId)}`, { replace: true });
      return;
    }
    announce(prev, conv);
    if (headerSig(prev) !== headerSig(conv)) {
      const h = headerNode();
      header.replaceWith(h);
      header = h;
    }
    if (timelineSig(prev) !== timelineSig(conv)) renderSoon();
    renderFoot();
  }

  function schedule(delay = POLL_MS) {
    clearTimeout(pollTimer);
    pollTimer = null;
    if (!alive || document.hidden) return;
    pollTimer = setTimeout(() => poll(false), delay);
  }

  /** Read the conversation again. now = a write just happened or a timer ran out (apply whatever comes). */
  async function poll(now) {
    clearTimeout(pollTimer);
    pollTimer = null;
    if (!alive || (polling && !now)) return;
    polling = true;
    const v = ver;
    try {
      const r = unwrap(await api.get(`${base}/conversation`));
      fails = 0;
      if (alive && (now || (v === ver && !busy.size))) apply(r);
    } catch (err) {
      if (redirected(err)) {
        alive = false;
        return;
      }
      if (err.status === 404) {
        toast(t('cv_closed'));
        go('/nearby', { replace: true });
        return;
      }
      fails++;
    } finally {
      polling = false;
    }
    schedule(fails ? Math.min(POLL_MAX_MS, POLL_MS * 2 ** fails) : POLL_MS);
  }

  const onVisibility = () => {
    if (document.hidden) {
      clearTimeout(pollTimer);
      pollTimer = null;
    } else {
      poll(false);
    }
  };

  // An on-screen keyboard that only shrinks the visual viewport: keep the box being typed in visible.
  function fitViewport() {
    const vv = window.visualViewport;
    if (!vv) return () => {};
    const fit = () => {
      if (Math.abs(vv.scale - 1) > 0.01) return; // pinch zoom: leave the layout alone
      const keyboard = window.innerHeight - vv.height > 80;
      root.style.height = keyboard ? `${Math.round(vv.height)}px` : '';
      if (!keyboard) return;
      window.scrollTo(0, 0);
      const a = document.activeElement;
      if (a && root.contains(a)) a.scrollIntoView?.({ block: 'nearest' });
    };
    vv.addEventListener('resize', fit);
    return () => vv.removeEventListener('resize', fit);
  }

  // ------------------------------------------------ mount

  root.replaceChildren(header, body, foot);
  renderTimeline();
  renderFoot();
  // Land on the first line waiting for my reply; otherwise on the newest.
  requestAnimationFrame(() => {
    if (!alive) return;
    if (!scrollToUnreplied()) scroller.scrollTop = scroller.scrollHeight;
  });
  schedule();
  document.addEventListener('visibilitychange', onVisibility);
  const stopViewport = fitViewport();

  return () => {
    alive = false;
    clearTimeout(pollTimer);
    for (const id of saveTimers.values()) clearTimeout(id);
    stopClocks();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pointerup', release, true);
    window.removeEventListener('pointercancel', release, true);
    stopViewport();
  };
}

// ---------------------------------------------------------------- strings

registerStrings({
  en: {
    cv_level: 'Level {n}',
    cv_level_bar: 'Level {n}/3',
    cv_chat_level: 'Level 3 · Chat',
    cv_you: 'You',
    cv_intro_1: 'Start with 5 short lines. {name} replies to each one, and can send you 5 too.',
    cv_intro_2: 'Level 2 is open. 5 new lines each — this time the replies come back in words.',
    cv_waiting: 'Waiting',
    cv_they_replied: '{name} replied {n} of {total}',
    cv_they_replied_all: '{name} replied to all {total}',
    cv_they_none: 'Waiting for {name} to reply',
    cv_you_replied: 'You replied {n} of {total}',
    cv_you_replied_all: 'You replied to all {total}',
    cv_hint_1: 'One tap each. You can change a reply until all 5 are done.',
    cv_hint_2: 'Your words save as you type. You can change them until all 5 are done.',
    cv_change_aria: 'Your reply: {text}. Tap to change it.',
    cv_reply_ph: 'Reply in your own words',
    cv_save_reply: 'Send this reply',
    cv_saving: 'Saving…',
    cv_saved: 'Saved',
    cv_not_saved: 'Not saved. Try again.',
    cv_check: 'Check this reply.',
    cv_no_translation: 'Translation not available yet.',
    cv_start_level: 'Start Level {n}',
    cv_send_your: 'Send your 5 to {name}',
    cv_turn_reply: 'Your turn: reply to {name} · {n}/{total}',
    cv_show: 'Show',
    cv_wait_lines: 'Waiting for {name}’s 5 lines',
    cv_wait_replies: 'Sent. Waiting for {name} to reply.',
    cv_replying: '{name} is replying · {n}/{total}',
    cv_opens_in: 'Level {n} opens in {time}',
    cv_chat_opens_in: 'Chat opens in {time}',
    cv_remind: 'Remind me',
    cv_remind_on: 'Reminder on',
    cv_notify_off: 'Notifications are off in this browser, so you will see it here.',
    cv_all_replied: 'All 5 replied. {name} can see them.',
    cv_they_all: '{name} replied to all 5.',
    cv_level_open: 'Level {n} is open.',
    cv_closed: 'This conversation is closed.',
    cv_moved: 'This conversation has moved on.',
  },
  km: {
    cv_level: 'កម្រិត {n}',
    cv_level_bar: 'កម្រិត {n}/3',
    cv_chat_level: 'កម្រិត 3 · ជជែក',
    cv_you: 'អ្នក',
    cv_intro_1: 'ចាប់ផ្ដើមដោយឃ្លាខ្លីៗ 5។ {name} នឹងឆ្លើយតបឃ្លានីមួយៗ ហើយក៏អាចផ្ញើឃ្លា 5 មកអ្នកវិញដែរ។',
    cv_intro_2: 'កម្រិត 2 បានបើកហើយ។ ម្នាក់ៗផ្ញើឃ្លាថ្មី 5 — លើកនេះ ការឆ្លើយតបមកជាពាក្យ។',
    cv_waiting: 'កំពុងរង់ចាំ',
    cv_they_replied: '{name} បានឆ្លើយតប {n} ក្នុងចំណោម {total}',
    cv_they_replied_all: '{name} បានឆ្លើយតបទាំង {total}',
    cv_they_none: 'កំពុងរង់ចាំ {name} ឆ្លើយតប',
    cv_you_replied: 'អ្នកបានឆ្លើយតប {n} ក្នុងចំណោម {total}',
    cv_you_replied_all: 'អ្នកបានឆ្លើយតបទាំង {total}',
    cv_hint_1: 'ចុចម្ដងសម្រាប់ឃ្លានីមួយៗ។ អ្នកអាចប្ដូរការឆ្លើយតបបាន រហូតដល់ឆ្លើយគ្រប់ទាំង 5។',
    cv_hint_2: 'ពាក្យរបស់អ្នករក្សាទុកដោយខ្លួនឯង ពេលអ្នកវាយ។ អ្នកអាចកែបាន រហូតដល់ឆ្លើយគ្រប់ទាំង 5។',
    cv_change_aria: 'ការឆ្លើយតបរបស់អ្នក៖ {text}។ ចុចដើម្បីប្ដូរ។',
    cv_reply_ph: 'ឆ្លើយតបតាមពាក្យរបស់អ្នកផ្ទាល់',
    cv_save_reply: 'ផ្ញើការឆ្លើយតបនេះ',
    cv_saving: 'កំពុងរក្សាទុក…',
    cv_saved: 'បានរក្សាទុក',
    cv_not_saved: 'មិនទាន់បានរក្សាទុកទេ។ សូមព្យាយាមម្ដងទៀត។',
    cv_check: 'សូមពិនិត្យការឆ្លើយតបនេះ។',
    cv_no_translation: 'មិនទាន់មានការបកប្រែនៅឡើយទេ។',
    cv_start_level: 'ចាប់ផ្ដើមកម្រិត {n}',
    cv_send_your: 'ផ្ញើឃ្លា 5 របស់អ្នកទៅ {name}',
    cv_turn_reply: 'ដល់វេនអ្នក៖ ឆ្លើយតបទៅ {name} · {n}/{total}',
    cv_show: 'បង្ហាញ',
    cv_wait_lines: 'កំពុងរង់ចាំឃ្លា 5 របស់ {name}',
    cv_wait_replies: 'បានផ្ញើហើយ។ កំពុងរង់ចាំ {name} ឆ្លើយតប។',
    cv_replying: '{name} កំពុងឆ្លើយតប · {n}/{total}',
    cv_opens_in: 'កម្រិត {n} បើកក្នុងរយៈពេល {time}',
    cv_chat_opens_in: 'ការជជែកបើកក្នុងរយៈពេល {time}',
    cv_remind: 'រំលឹកខ្ញុំ',
    cv_remind_on: 'ការរំលឹកបានបើក',
    cv_notify_off: 'ការជូនដំណឹងត្រូវបានបិទនៅក្នុងកម្មវិធីរុករកនេះ ដូច្នេះអ្នកនឹងឃើញវានៅទីនេះ។',
    cv_all_replied: 'បានឆ្លើយតបទាំង 5 ហើយ។ {name} អាចមើលឃើញ។',
    cv_they_all: '{name} បានឆ្លើយតបទាំង 5 ហើយ។',
    cv_level_open: 'កម្រិត {n} បានបើកហើយ។',
    cv_closed: 'ការសន្ទនានេះត្រូវបានបិទ។',
    cv_moved: 'ការសន្ទនានេះបានបន្តទៅមុខរួចហើយ។',
  },
  zh: {
    cv_level: '等级 {n}',
    cv_level_bar: '等级 {n}/3',
    cv_chat_level: '等级 3 · 聊天',
    cv_you: '你',
    cv_intro_1: '先发 5 句简短的话。{name} 会逐句回复，也可以给你发 5 句。',
    cv_intro_2: '等级 2 已开启。各自再发 5 句新的话——这次用文字回复。',
    cv_waiting: '等待中',
    cv_they_replied: '{name} 已回复 {n}/{total}',
    cv_they_replied_all: '{name} 已回复全部 {total} 句',
    cv_they_none: '等待 {name} 回复',
    cv_you_replied: '你已回复 {n}/{total}',
    cv_you_replied_all: '你已回复全部 {total} 句',
    cv_hint_1: '每句点一下即可。5 句全部回复之前，都可以修改。',
    cv_hint_2: '输入时会自动保存。5 句全部回复之前，都可以修改。',
    cv_change_aria: '你的回复：{text}。点一下可以修改。',
    cv_reply_ph: '用你自己的话回复',
    cv_save_reply: '发送这条回复',
    cv_saving: '保存中…',
    cv_saved: '已保存',
    cv_not_saved: '未保存，请重试。',
    cv_check: '请检查这条回复。',
    cv_no_translation: '暂时还没有翻译。',
    cv_start_level: '开始等级 {n}',
    cv_send_your: '给 {name} 发你的 5 句',
    cv_turn_reply: '轮到你了：回复 {name} · {n}/{total}',
    cv_show: '查看',
    cv_wait_lines: '等待 {name} 发来 5 句',
    cv_wait_replies: '已发送，等待 {name} 回复。',
    cv_replying: '{name} 正在回复 · {n}/{total}',
    cv_opens_in: '等级 {n} 将在 {time} 后开启',
    cv_chat_opens_in: '聊天将在 {time} 后开启',
    cv_remind: '提醒我',
    cv_remind_on: '提醒已开启',
    cv_notify_off: '此浏览器已关闭通知，你会在这里看到提醒。',
    cv_all_replied: '5 句都已回复，{name} 可以看到了。',
    cv_they_all: '{name} 已回复全部 5 句。',
    cv_level_open: '等级 {n} 已开启。',
    cv_closed: '此对话已关闭。',
    cv_moved: '这段对话已经往下进行了。',
  },
  ko: {
    cv_level: '레벨 {n}',
    cv_level_bar: '레벨 {n}/3',
    cv_chat_level: '레벨 3 · 채팅',
    cv_you: '나',
    cv_intro_1: '짧은 한마디 5개로 시작해 보세요. {name}님이 하나씩 답장하고, {name}님도 5개를 보낼 수 있어요.',
    cv_intro_2: '레벨 2가 열렸어요. 서로 새 한마디 5개씩 — 이번에는 글로 답장해요.',
    cv_waiting: '기다리는 중',
    cv_they_replied: '{name}님이 {total}개 중 {n}개에 답장했어요',
    cv_they_replied_all: '{name}님이 {total}개 모두 답장했어요',
    cv_they_none: '{name}님의 답장을 기다리는 중',
    cv_you_replied: '{total}개 중 {n}개 답장했어요',
    cv_you_replied_all: '{total}개 모두 답장했어요',
    cv_hint_1: '한마디마다 한 번만 누르세요. 5개 모두 답하기 전까지는 바꿀 수 있어요.',
    cv_hint_2: '쓰는 동안 자동으로 저장돼요. 5개 모두 답하기 전까지는 고칠 수 있어요.',
    cv_change_aria: '내 답장: {text}. 눌러서 바꾸기.',
    cv_reply_ph: '내 말로 답장해 주세요',
    cv_save_reply: '이 답장 보내기',
    cv_saving: '저장하는 중…',
    cv_saved: '저장됨',
    cv_not_saved: '저장하지 못했어요. 다시 시도해 주세요.',
    cv_check: '이 답장을 확인해 주세요.',
    cv_no_translation: '아직 번역이 없어요.',
    cv_start_level: '레벨 {n} 시작하기',
    cv_send_your: '{name}님에게 내 한마디 5개 보내기',
    cv_turn_reply: '내 차례: {name}님에게 답장 · {n}/{total}',
    cv_show: '보기',
    cv_wait_lines: '{name}님의 한마디 5개를 기다리는 중',
    cv_wait_replies: '보냈어요. {name}님의 답장을 기다리는 중이에요.',
    cv_replying: '{name}님이 답장하는 중 · {n}/{total}',
    cv_opens_in: '레벨 {n}까지 {time}',
    cv_chat_opens_in: '채팅까지 {time}',
    cv_remind: '알려 주세요',
    cv_remind_on: '알림 켜짐',
    cv_notify_off: '이 브라우저는 알림이 꺼져 있어서 여기에서 알려 드려요.',
    cv_all_replied: '5개 모두 답장했어요. {name}님이 볼 수 있어요.',
    cv_they_all: '{name}님이 5개 모두 답장했어요.',
    cv_level_open: '레벨 {n} 열림',
    cv_closed: '이 대화는 종료되었어요.',
    cv_moved: '이 대화는 이미 다음으로 넘어갔어요.',
  },
  ja: {
    cv_level: 'レベル{n}',
    cv_level_bar: 'レベル {n}/3',
    cv_chat_level: 'レベル3 · チャット',
    cv_you: 'あなた',
    cv_intro_1: 'まずは短いひとことを5つ。{name}さんがひとつずつ返信し、{name}さんからも5つ届きます。',
    cv_intro_2: 'レベル2が開きました。お互いに新しいひとことを5つずつ。今度は言葉で返信します。',
    cv_waiting: '返信待ち',
    cv_they_replied: '{name}さんが{total}つ中{n}つに返信',
    cv_they_replied_all: '{name}さんが{total}つすべてに返信',
    cv_they_none: '{name}さんの返信を待っています',
    cv_you_replied: '{total}つ中{n}つに返信済み',
    cv_you_replied_all: '{total}つすべてに返信済み',
    cv_hint_1: 'ひとことごとに1回タップ。5つすべて返すまでは変更できます。',
    cv_hint_2: '入力すると自動で保存されます。5つすべて返すまでは直せます。',
    cv_change_aria: 'あなたの返信：{text}。タップして変更。',
    cv_reply_ph: '自分の言葉で返信する',
    cv_save_reply: 'この返信を送る',
    cv_saving: '保存中…',
    cv_saved: '保存済み',
    cv_not_saved: '保存できませんでした。もう一度お試しください。',
    cv_check: 'この返信を確認してください。',
    cv_no_translation: '翻訳はまだありません。',
    cv_start_level: 'レベル{n}を始める',
    cv_send_your: '{name}さんに5つ送る',
    cv_turn_reply: 'あなたの番：{name}さんに返信 · {n}/{total}',
    cv_show: '表示',
    cv_wait_lines: '{name}さんの5つのひとことを待っています',
    cv_wait_replies: '送信しました。{name}さんの返信を待っています。',
    cv_replying: '{name}さんが返信中 · {n}/{total}',
    cv_opens_in: 'レベル{n}まで {time}',
    cv_chat_opens_in: 'チャットまで {time}',
    cv_remind: '知らせる',
    cv_remind_on: 'リマインダーON',
    cv_notify_off: 'このブラウザでは通知がオフのため、ここでお知らせします。',
    cv_all_replied: '5つすべてに返信しました。{name}さんに届いています。',
    cv_they_all: '{name}さんが5つすべてに返信しました。',
    cv_level_open: 'レベル{n}が開きました。',
    cv_closed: 'この会話は終了しました。',
    cv_moved: 'この会話はすでに先に進んでいます。',
  },
});
