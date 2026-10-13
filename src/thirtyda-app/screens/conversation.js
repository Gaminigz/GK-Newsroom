// #/c/:pairId · The conversation — one screen for the whole story between two people (owner's model,
// 2026-10-13: "Dara can start, send to Sophea, Sophea answers, Dara can see the answers above. Sophea can
// start, send to Dara, Dara can see them in the same UI. Then Level 2 the same. Level 3 becomes direct
// chat; the things above just become texts: what you told me before and what you asked me before.")
//
// Level 1 and Level 2: each person sends the other ONE set of 5 lines per level, in any order, and replies
// to the 5 they got, line by line, with one tap — Yes / No / Not really / Maybe, the sender's own written
// line Yes / No (Level 2 sets replied to in words before the taps read back as they were). Everything
// stays above as plain history, oldest first, like a chat: their lines on the left with my replies under
// them, my lines on the right with theirs.
// After Level 2 each person chooses "Open the chat (Level 3)" or "Forget it" ("after these 10 answers the
// sender can activate Level 3 or forget it"): the chat opens as soon as both chose it — under the
// history, with each other's real name in the header — and one "Forget it" ends the conversation for
// both (it stays readable, nothing more can be sent). The bottom of the screen is the one thing to do
// now: send your 5, reply, wait, choose, or (Level 3) chat.
// GET /pairs/:id/conversation is the one read model; replies save one at a time with PUT /replies, the
// choice with POST /decide.
import {
  screen, el, icon, t, go, api, toast, modal, topBar, levelBar, countdown, errorText, registerStrings, heartbeat,
  stageLevel, nextKind, l1Answers, answerText,
} from '../core.js';
import { sendPanel, translateNote, redirected, myLang, enc } from './level-ask.js';
import { mountChat, ensureStyles, partnerHeader, fmtTime, dayLabel } from './chat.js';

const POLL_MS = 4000; // the other person's lines, replies and choice show up while you look
const POLL_MAX_MS = 30000; // back-off ceiling while offline

// Survive leaving the screen (not a reload).
const panelOpen = new Map(); // pairId → the send panel opened (true) or folded (false) by hand

const unwrap = (r) => (r && typeof r === 'object' && r.conversation ? r.conversation : r);

// Toasts sit just above the bottom of the screen, however tall it is now: a status line, the choice after
// Level 2 (~220px), the send panel or the chat composer (app.css reads --conv-foot-h). The newest screen owns it.
let footOwner = 0;
function trackFoot(node) {
  const id = ++footOwner;
  const docEl = document.documentElement;
  const set = () => {
    if (footOwner === id) docEl.style.setProperty('--conv-foot-h', `${Math.round(node?.isConnected && !node.hidden ? node.offsetHeight : 0)}px`);
  };
  set();
  const ro = node && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(set) : null;
  ro?.observe(node);
  return () => {
    ro?.disconnect();
    if (footOwner === id) docEl.style.removeProperty('--conv-foot-h');
  };
}
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

/** chat = null (Levels 1–2, the choice, an ended conversation), or the chat's first read ({ v: messages } | { e: phone_needed }). */
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
  let deferred = false; // a timeline paint waits until the finger on it lets go
  let pressing = false;
  let remindBusy = false;
  let deciding = false; // "Open the chat" / "Forget it" is being saved
  const editing = new Set(); // reply keys reopened to change
  const busy = new Set(); // reply keys being saved

  const name = () => conv.other?.name || conv.pair?.other?.name || '';
  const theirLang = () => conv.other?.lang || conv.pair?.other?.lang || 'en';
  const stage = () => conv.pair?.stage || null;
  const ended = () => stage() === 'ended' || nextKind(conv.next) === 'ended' || Boolean(conv.decision?.ended);
  const choosing = () => !ended() && stage() === 'l3_decide';
  const frozen = () => !ended() && (nextKind(conv.next) === 'frozen' || conv.pair?.next === 'frozen');
  // The other person deleted their account: "This person left 30+DA" (no name any more; nothing more to send).
  const left = () => ended() && conv.pair?.endedReason === 'left';
  const setLevels = () => (conv.levels || []).filter((L) => L && (L.level === 1 || L.level === 2)).sort((a, b) => a.level - b.level);
  const levelOf = (n) => setLevels().find((L) => L.level === n) || null;
  const openLevel = () => setLevels().find((L) => L.state === 'open') || null;
  const keyOf = (s, line) => `${s.id}|${line.n}`;
  const lineId = (key) => `cv-q-${key.replace(/[^\w-]/g, '-')}`;
  // The server says so per set (canReply); older answers are worked out the same way here.
  const canReply = (s) => !chatMode && !frozen() && !ended() && !s.completedAt && s.from !== 'me'
    && (typeof s.canReply === 'boolean' ? s.canReply : levelOf(s.level)?.state === 'open');
  // A reply as words in my language: a tap's option, or (Level 2 sets from before the taps) the words.
  const replyText = (r) => (r?.key ? answerText(r.key, myLang()) || r.text || '' : r?.original ?? r?.text ?? '');

  /** The first line sent to me (in the open level) that has no reply from me yet. */
  function firstUnreplied() {
    const L = openLevel();
    const s = L?.theirs;
    if (!s || s.completedAt || frozen() || ended()) return null;
    const line = [...(s.lines || [])].sort((a, b) => a.n - b.n).find((l) => !l.reply);
    return line ? { s, line } : null;
  }

  // ------------------------------------------------ header: back, photos (per level), name, real name (Level 3), level, EN⇄KM

  function headerNode() {
    const st = stage();
    const fallback = st === 'l2_wait' ? 1 : st === 'l3_wait' ? 2 : stageLevel(conv.pair);
    const level = conv.chat?.open ? 3 : Math.max(1, Math.min(3, Number(conv.pair?.level) || fallback));
    const photos = (conv.other?.photos?.length ? conv.other.photos : [conv.pair?.other?.photo]).filter(Boolean).slice(0, 4);
    const sub = el('span', { class: 'conv-sub' },
      el('span', {}, t(ended() ? 'cv_ended_bar' : 'cv_level_bar', { n: level })), levelBar(level));
    // The real name only once the chat is open (the server sends it only then).
    const realName = conv.chat?.open ? conv.other?.realName || '' : '';
    return partnerHeader({ name: left() ? t('cv_left_name') : name(), photos, myLang: myLang(), theirLang: theirLang(), sub, realName });
  }
  const headerSig = (c) => JSON.stringify([
    c.other?.name, c.other?.lang, c.other?.photos, c.other?.realName, c.pair?.level, c.pair?.stage, c.chat?.open,
  ]);

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

  /** Their reply under one of my lines: a tap (in my language), or — Level 2 from before the taps — their words. */
  function theirReply(r) {
    if (r.key) return el('div', { class: 'bubble theirs conv-reply' }, el('span', { class: 'orig' }, replyText(r)));
    const orig = r.original ?? r.text ?? '';
    const tr = r.text && !same(r.text, orig) ? r.text : null;
    const untranslated = !tr && theirLang() !== myLang() && r.translated !== true;
    return el('div', { class: 'bubble theirs conv-reply' },
      el('span', { class: 'orig', lang: theirLang() }, orig),
      tr ? el('span', { class: 'trans', lang: myLang() }, tr) : untranslated ? el('span', { class: 'trans-note' }, t('cv_no_translation')) : null);
  }

  function myLine(line) {
    return el('div', { class: 'conv-line mine' },
      el('div', { class: 'bubble mine' }, lineParts(line, true)),
      line.reply
        ? theirReply(line.reply)
        // Nothing is "waiting" in an ended conversation (when the other person left, their replies went with them).
        : ended() ? null : el('span', { class: 'conv-pending' }, icon('clock', 12), el('span', {}, t('cv_waiting'))));
  }

  function theirLine(s, line) {
    const key = keyOf(s, line);
    return el('div', { class: 'conv-line theirs', dataset: { key } },
      el('div', { class: 'bubble theirs', id: lineId(key) }, lineParts(line, false)),
      myReply(s, line, key));
  }

  /** My reply under one of their lines: the tap I gave (tap it to change while the set is not complete), or the choices. */
  function myReply(s, line, key) {
    const r = line.reply;
    const open = canReply(s);
    if (r && (!open || !editing.has(key))) {
      const text = replyText(r);
      if (!open) return el('div', { class: 'bubble mine conv-reply' }, el('span', { class: 'orig' }, text));
      return el('button', {
        type: 'button', class: 'bubble mine conv-reply can-change', 'aria-label': t('cv_change_aria', { text }),
        on: { click: () => startEdit(key) },
      }, el('span', { class: 'orig' }, text));
    }
    return open ? replyChips(s, line, key) : null;
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
        dataset: { answer: a.key }, on: { click: () => replyTap(s, line, a.key, key) },
      }, answerText(a.key, myLang()) || a.text || a.key)));
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
    const hint = !mine && !done && canReply(s) ? t('cv_hint') : null;
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
      ...lines.map((line) => (mine ? myLine(line) : theirLine(s, line))),
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

  /** "Level 2 opens in 23:59:12 · Remind me" (the one wait left: between Level 1 and Level 2). */
  function waitBanner(level, until) {
    const time = el('b', { class: 'tabular', role: 'timer', 'aria-live': 'off' }, '--:--:--');
    // At zero the server opens the level on its next read; never loop on a time already past.
    const future = ms(until) > Date.now();
    clocks.push(countdown(time, until, future ? () => setTimeout(() => poll(true), 700) : null));
    const [before, after = ''] = t('cv_opens_in', { n: level }).split('{time}');
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
    if (ended()) out.push(divider(t(left() ? 'cv_left' : 'cv_ended_divider')));
    return out;
  }
  const timelineSig = (c) => JSON.stringify([c.levels, c.pair?.stage, c.pair?.l2OpensAt, c.pair?.next, c.next, c.chat, c.decision?.ended]);

  // ------------------------------------------------ Level 3: the chat under the history

  if (chatMode) {
    const history = el('div', { class: 'conv-thread conv-history' },
      ...timelineNodes(),
      divider(t('cv_chat_level')),
      el('div', { class: 'banner', role: 'note' }, icon('shield', 16), el('span', {}, t('chat_text_only'))));
    const gate = frozen() ? 'closed' : chat.e?.code === 'phone_needed' ? 'phone' : null;
    const stop = mountChat(root, { pair: conv.pair, data: chat.v || null, gate, history, header: headerNode() });
    const stopFoot = trackFoot(root.querySelector('.chat-foot'));
    return () => {
      alive = false;
      stopClocks();
      stopFoot();
      stop?.();
    };
  }

  // ------------------------------------------------ Levels 1–2, the choice after Level 2, an ended conversation

  const timeline = el('div', { class: 'conv-thread' });
  const scroller = el('div', { class: 'chat-scroll' }, timeline);
  const body = el('div', { class: 'chat-body' }, scroller);
  const foot = el('div', { class: 'chat-foot conv-foot' });
  let header = headerNode();

  // Repaint in place; someone reading the newest (at the bottom) stays at the bottom, where it grew.
  function renderTimeline() {
    deferred = false;
    const top = scroller.scrollTop;
    const atEnd = scroller.scrollHeight - top - scroller.clientHeight < 64;
    timeline.replaceChildren(...timelineNodes());
    scroller.scrollTop = atEnd ? scroller.scrollHeight : top;
  }

  // Never rebuild under a finger: paint when it lets go.
  function renderSoon() {
    if (pressing) deferred = true;
    else renderTimeline();
  }
  const flush = () => setTimeout(() => {
    if (alive && deferred && !pressing) renderTimeline();
  }, 60);
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
    (line?.querySelector('.chip[aria-pressed="true"]') || line?.querySelector('.chip'))?.focus();
  }

  /** After a tap: bring the next line waiting for a reply into view when it is off screen. */
  function revealNext(key) {
    const lines = [...timeline.querySelectorAll('.conv-line.theirs')];
    const from = lines.findIndex((n) => n.dataset.key === key);
    const next = lines.slice(from + 1).find((n) => n.querySelector('.conv-chips'));
    if (!next) return;
    const box = next.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    if (box.top >= view.top + 8 && box.bottom <= view.bottom - 8) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    next.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' });
  }

  function scrollToUnreplied() {
    const node = timeline.querySelector('.conv-chips')?.closest('.conv-line');
    if (node) node.scrollIntoView({ block: 'center' });
    return Boolean(node);
  }

  // ------------------------------------------------ replies (one tap each, at Level 1 and Level 2)

  function replyFailed(err) {
    if (!alive || redirected(err)) return;
    if (err.status === 409 || err.status === 404) {
      toast(err.code === 'other_blocked' ? t('cv_closed') : t('cv_moved'));
      poll(true);
    } else if (err.status === 422) {
      toast(t('cv_check'));
    } else {
      toast(errorText(err));
    }
  }

  async function replyTap(s, line, answer, key) {
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
      const r = await api.put(`${base}/replies`, { level: s.level, n: line.n, key: answer });
      busy.delete(key);
      editing.delete(key);
      apply(unwrap(r));
      if (alive) revealNext(key);
    } catch (err) {
      busy.delete(key);
      replyFailed(err);
      if (alive) renderTimeline();
    }
  }

  // ------------------------------------------------ after Level 2: open the chat or forget it

  async function choose(open) {
    if (!alive || deciding) return;
    deciding = true;
    ver++;
    renderFoot();
    try {
      const r = await api.post(`${base}/decide`, { open });
      deciding = false;
      heartbeat(); // My conversations: the red dot goes now, not at the next beat
      apply(unwrap(r));
    } catch (err) {
      deciding = false;
      if (!alive || redirected(err)) return;
      if (err.status === 409 || err.status === 404) {
        toast(err.code === 'conversation_ended' ? t('cv_ended') : err.code === 'other_blocked' ? t('cv_closed') : t('cv_moved'));
        poll(true);
      } else {
        toast(errorText(err));
      }
    }
    if (alive) renderFoot();
  }

  /** "Forget it" ends the conversation for both, so it asks once. */
  function confirmForget() {
    if (deciding) return;
    const yes = el('button', { type: 'button', class: 'btn btn-danger' }, t('cv_forget_yes'));
    const no = el('button', { type: 'button', class: 'btn btn-secondary' }, t('cv_forget_no'));
    const dlg = modal(el('div', { class: 'dialog-body' },
      el('h2', { class: 'dialog-title' }, t('cv_forget_q')),
      el('p', { class: 'conv-dialog-text' }, t('cv_forget_text', { name: name() })),
      el('div', { class: 'dialog-actions' }, yes, no)), { label: t('cv_forget_q') });
    yes.addEventListener('click', () => {
      dlg.close();
      choose(false);
    });
    no.addEventListener('click', () => dlg.close());
    no.focus(); // a stray Enter never ends it
  }

  function decideNode() {
    const open = el('button', { type: 'button', class: 'btn btn-primary', disabled: deciding, on: { click: () => choose(true) } },
      icon('chat', 18), el('span', { class: 'btn-text' }, t('cv_open_chat')));
    const forget = el('button', { type: 'button', class: 'btn btn-secondary', disabled: deciding, on: { click: confirmForget } },
      el('span', { class: 'btn-text' }, t('cv_forget')));
    return el('div', { class: 'conv-decide', role: 'group', 'aria-labelledby': 'cv-decide-title' },
      el('p', { class: 'conv-decide-title', id: 'cv-decide-title' }, t('cv_decide_title', { name: name() })),
      el('p', { class: 'conv-decide-note' }, t('cv_decide_note', { name: name() })),
      el('div', { class: 'conv-decide-actions' }, open, forget));
  }

  // ------------------------------------------------ bottom: send your 5 · your turn · waiting · choose · ended · closed

  let panel = null;
  let panelSig = null;
  let panelTitle = null;
  let panelFold = null; // folds the open panel (when their lines arrive while it is open on its own)
  let panelHadReplies = false; // their lines were waiting for my replies at the last paint
  let footSig = null;

  function footKind() {
    if (ended()) return 'ended';
    if (frozen()) return 'closed';
    if (choosing()) {
      const mine = conv.decision ? conv.decision.mine : nextKind(conv.next) === 'wait_them' ? true : null;
      return mine === true ? 'decided' : 'decide';
    }
    if (conv.canSend) return 'send';
    if (firstUnreplied()) return 'reply';
    if (openLevel()) return 'wait';
    return 'none'; // a level timer runs: the banner above says it
  }

  /** What the status line depends on: my replies to their set, their replies to mine. */
  function footState() {
    const L = openLevel();
    const count = (x) => (x ? [(x.lines || []).filter((l) => l.reply).length, Boolean(x.completedAt)] : null);
    return [L?.level ?? null, count(L?.mine), count(L?.theirs), name()];
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
      // chips get the screen (not while I type in it, nor when I opened it by hand).
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
    const sig = JSON.stringify([kind, kind === 'closed' || kind === 'ended' ? null : footState(), deciding]);
    if (sig === footSig && !panel) return;
    footSig = sig;
    panel = null;
    panelSig = null;
    panelTitle = null;
    panelFold = null;
    foot.hidden = kind === 'none';
    if (kind === 'closed') {
      foot.replaceChildren(el('p', { class: 'lock-note chat-closed', role: 'status' }, icon('lock', 14), el('span', {}, t('cv_closed'))));
    } else if (kind === 'ended') {
      // Calm, the same for both, never who chose it.
      foot.replaceChildren(el('div', { class: 'conv-ended', role: 'status' },
        el('strong', {}, t(left() ? 'cv_left' : 'cv_ended')), el('span', {}, t(left() ? 'cv_left_note' : 'cv_ended_note'))));
    } else if (kind === 'decide') {
      foot.replaceChildren(decideNode());
    } else if (kind === 'decided') {
      // Waiting for their choice; "Forget it" is still there (it asks first).
      const forget = el('button', { type: 'button', class: 'link', disabled: deciding, on: { click: confirmForget } }, t('cv_forget'));
      foot.replaceChildren(statusRow('clock', t('cv_decided_wait', { name: name() }), forget));
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

  // ------------------------------------------------ updates (replies, sends, choices, polls)

  /**
   * Toasts for what just changed: my replies all in, theirs all in, a level open, the conversation ended.
   * Not when Level 2 just finished: the choice under the history says so ("Level 2 is done …").
   */
  function announce(prev, next) {
    if (prev.pair?.stage !== 'l3_decide' && next.pair?.stage === 'l3_decide') {
      heartbeat();
      return;
    }
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
    if (prev.pair?.stage !== 'ended' && next.pair?.stage === 'ended') toast(t(next.pair?.endedReason === 'left' ? 'cv_left' : 'cv_ended'));
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
    // An ended conversation never changes again: nothing to poll for.
    if (!alive || document.hidden || ended()) return;
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
      if (alive && (now || (v === ver && !busy.size && !deciding))) apply(r);
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
  const stopFoot = trackFoot(foot);
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
    stopClocks();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pointerup', release, true);
    window.removeEventListener('pointercancel', release, true);
    stopViewport();
    stopFoot();
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
    cv_intro_2: 'Level 2 is open. 5 new lines each — 3 picked and 2 of your own. Replies are one tap again.',
    cv_waiting: 'Waiting',
    cv_they_replied: '{name} replied {n} of {total}',
    cv_they_replied_all: '{name} replied to all {total}',
    cv_they_none: 'Waiting for {name} to reply',
    cv_you_replied: 'You replied {n} of {total}',
    cv_you_replied_all: 'You replied to all {total}',
    cv_hint: 'One tap each. You can change a reply until all 5 are done.',
    cv_change_aria: 'Your reply: {text}. Tap to change it.',
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
    cv_remind: 'Remind me',
    cv_remind_on: 'Reminder on',
    cv_notify_off: 'Notifications are off in this browser, so you will see it here.',
    cv_all_replied: 'All 5 replied. {name} can see them.',
    cv_they_all: '{name} replied to all 5.',
    cv_level_open: 'Level {n} is open.',
    cv_closed: 'This conversation is closed.',
    cv_moved: 'This conversation has moved on.',
    cv_ended_bar: 'Level {n}/3 · Ended',
    cv_ended_divider: 'The conversation ended',
    cv_decide_title: 'Level 2 is done. Open the chat with {name}?',
    cv_decide_note: 'The chat (Level 3) opens as soon as you both choose it, and you see each other’s real names. If either of you chooses “Forget it”, the conversation ends for both.',
    cv_open_chat: 'Open the chat (Level 3)',
    cv_forget: 'Forget it',
    cv_forget_q: 'Forget it?',
    cv_forget_text: 'The conversation with {name} ends for both of you. You can still read it, but nothing more can be sent.',
    cv_forget_yes: 'Forget it',
    cv_forget_no: 'Go back',
    cv_decided_wait: 'You chose to open the chat — waiting for {name}',
    cv_ended: 'This conversation has ended',
    cv_ended_note: 'You can still read it above.',
    cv_left: 'This person left 30+DA',
    cv_left_note: 'This conversation is closed. Nothing more can be sent.',
    cv_left_name: 'Left 30+DA',
  },
  km: {
    cv_level: 'កម្រិត {n}',
    cv_level_bar: 'កម្រិត {n}/3',
    cv_chat_level: 'កម្រិត 3 · ជជែក',
    cv_you: 'អ្នក',
    cv_intro_1: 'ចាប់ផ្ដើមដោយឃ្លាខ្លីៗ 5។ {name} នឹងឆ្លើយតបឃ្លានីមួយៗ ហើយក៏អាចផ្ញើឃ្លា 5 មកអ្នកវិញដែរ។',
    cv_intro_2: 'កម្រិត 2 បានបើកហើយ។ ម្នាក់ៗផ្ញើឃ្លាថ្មី 5 — ជ្រើស 3 និងសរសេរខ្លួនឯង 2។ ការឆ្លើយតបនៅតែចុចម្ដងដដែល។',
    cv_waiting: 'កំពុងរង់ចាំ',
    cv_they_replied: '{name} បានឆ្លើយតប {n} ក្នុងចំណោម {total}',
    cv_they_replied_all: '{name} បានឆ្លើយតបទាំង {total}',
    cv_they_none: 'កំពុងរង់ចាំ {name} ឆ្លើយតប',
    cv_you_replied: 'អ្នកបានឆ្លើយតប {n} ក្នុងចំណោម {total}',
    cv_you_replied_all: 'អ្នកបានឆ្លើយតបទាំង {total}',
    cv_hint: 'ចុចម្ដងសម្រាប់ឃ្លានីមួយៗ។ អ្នកអាចប្ដូរការឆ្លើយតបបាន រហូតដល់ឆ្លើយគ្រប់ទាំង 5។',
    cv_change_aria: 'ការឆ្លើយតបរបស់អ្នក៖ {text}។ ចុចដើម្បីប្ដូរ។',
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
    cv_remind: 'រំលឹកខ្ញុំ',
    cv_remind_on: 'ការរំលឹកបានបើក',
    cv_notify_off: 'ការជូនដំណឹងត្រូវបានបិទនៅក្នុងកម្មវិធីរុករកនេះ ដូច្នេះអ្នកនឹងឃើញវានៅទីនេះ។',
    cv_all_replied: 'បានឆ្លើយតបទាំង 5 ហើយ។ {name} អាចមើលឃើញ។',
    cv_they_all: '{name} បានឆ្លើយតបទាំង 5 ហើយ។',
    cv_level_open: 'កម្រិត {n} បានបើកហើយ។',
    cv_closed: 'ការសន្ទនានេះត្រូវបានបិទ។',
    cv_moved: 'ការសន្ទនានេះបានបន្តទៅមុខរួចហើយ។',
    cv_ended_bar: 'កម្រិត {n}/3 · បានបញ្ចប់',
    cv_ended_divider: 'ការសន្ទនាបានបញ្ចប់',
    cv_decide_title: 'កម្រិត 2 បានចប់ហើយ។ បើកការជជែកជាមួយ {name} ទេ?',
    cv_decide_note: 'ការជជែក (កម្រិត 3) នឹងបើកភ្លាម ពេលអ្នកទាំងពីរជ្រើសវា ហើយអ្នកនឹងឃើញឈ្មោះពិតរបស់គ្នា។ បើម្នាក់ណាជ្រើស «ឈប់ត្រឹមនេះ» ការសន្ទនានឹងបញ្ចប់សម្រាប់អ្នកទាំងពីរ។',
    cv_open_chat: 'បើកការជជែក (កម្រិត 3)',
    cv_forget: 'ឈប់ត្រឹមនេះ',
    cv_forget_q: 'ឈប់ត្រឹមនេះមែនទេ?',
    cv_forget_text: 'ការសន្ទនាជាមួយ {name} នឹងបញ្ចប់សម្រាប់អ្នកទាំងពីរ។ អ្នកនៅតែអាចអានវាបាន ប៉ុន្តែមិនអាចផ្ញើអ្វីបន្ថែមទៀតបានទេ។',
    cv_forget_yes: 'ឈប់ត្រឹមនេះ',
    cv_forget_no: 'ត្រឡប់ក្រោយ',
    cv_decided_wait: 'អ្នកបានជ្រើសបើកការជជែក — កំពុងរង់ចាំ {name}',
    cv_ended: 'ការសន្ទនានេះបានបញ្ចប់ហើយ',
    cv_ended_note: 'អ្នកនៅតែអាចអានវានៅខាងលើបាន។',
    cv_left: 'មនុស្សនេះបានចាកចេញពី 30+DA',
    cv_left_note: 'ការសន្ទនានេះត្រូវបានបិទ។ មិនអាចផ្ញើអ្វីទៀតបានទេ។',
    cv_left_name: 'បានចាកចេញហើយ',
  },
  zh: {
    cv_level: '等级 {n}',
    cv_level_bar: '等级 {n}/3',
    cv_chat_level: '等级 3 · 聊天',
    cv_you: '你',
    cv_intro_1: '先发 5 句简短的话。{name} 会逐句回复，也可以给你发 5 句。',
    cv_intro_2: '等级 2 已开启。各自再发 5 句新的话——选 3 句，自己写 2 句。回复还是点一下就好。',
    cv_waiting: '等待中',
    cv_they_replied: '{name} 已回复 {n}/{total}',
    cv_they_replied_all: '{name} 已回复全部 {total} 句',
    cv_they_none: '等待 {name} 回复',
    cv_you_replied: '你已回复 {n}/{total}',
    cv_you_replied_all: '你已回复全部 {total} 句',
    cv_hint: '每句点一下即可。5 句全部回复之前，都可以修改。',
    cv_change_aria: '你的回复：{text}。点一下可以修改。',
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
    cv_remind: '提醒我',
    cv_remind_on: '提醒已开启',
    cv_notify_off: '此浏览器已关闭通知，你会在这里看到提醒。',
    cv_all_replied: '5 句都已回复，{name} 可以看到了。',
    cv_they_all: '{name} 已回复全部 5 句。',
    cv_level_open: '等级 {n} 已开启。',
    cv_closed: '此对话已关闭。',
    cv_moved: '这段对话已经往下进行了。',
    cv_ended_bar: '等级 {n}/3 · 已结束',
    cv_ended_divider: '对话已结束',
    cv_decide_title: '等级 2 已完成。要和 {name} 开始聊天吗？',
    cv_decide_note: '你们两人都选择后，聊天（等级 3）就会马上开启，你们也会看到彼此的真实姓名。只要有一方选择“算了”，对话就会对双方结束。',
    cv_open_chat: '开始聊天（等级 3）',
    cv_forget: '算了',
    cv_forget_q: '确定算了吗？',
    cv_forget_text: '和 {name} 的对话将对你们双方结束。你仍然可以阅读，但不能再发送任何内容。',
    cv_forget_yes: '算了',
    cv_forget_no: '返回',
    cv_decided_wait: '你已选择开始聊天 — 等待 {name}',
    cv_ended: '这段对话已经结束',
    cv_ended_note: '你仍然可以在上方阅读。',
    cv_left: '此人已离开 30+DA',
    cv_left_note: '此对话已关闭，无法再发送任何内容。',
    cv_left_name: '已离开 30+DA',
  },
  ko: {
    cv_level: '레벨 {n}',
    cv_level_bar: '레벨 {n}/3',
    cv_chat_level: '레벨 3 · 채팅',
    cv_you: '나',
    cv_intro_1: '짧은 한마디 5개로 시작해 보세요. {name}님이 하나씩 답장하고, {name}님도 5개를 보낼 수 있어요.',
    cv_intro_2: '레벨 2가 열렸어요. 서로 새 한마디 5개씩 — 3개 고르고 2개 직접 써요. 답장은 이번에도 한 번 누르기예요.',
    cv_waiting: '기다리는 중',
    cv_they_replied: '{name}님이 {total}개 중 {n}개에 답장했어요',
    cv_they_replied_all: '{name}님이 {total}개 모두 답장했어요',
    cv_they_none: '{name}님의 답장을 기다리는 중',
    cv_you_replied: '{total}개 중 {n}개 답장했어요',
    cv_you_replied_all: '{total}개 모두 답장했어요',
    cv_hint: '한마디마다 한 번만 누르세요. 5개 모두 답하기 전까지는 바꿀 수 있어요.',
    cv_change_aria: '내 답장: {text}. 눌러서 바꾸기.',
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
    cv_remind: '알려 주세요',
    cv_remind_on: '알림 켜짐',
    cv_notify_off: '이 브라우저는 알림이 꺼져 있어서 여기에서 알려 드려요.',
    cv_all_replied: '5개 모두 답장했어요. {name}님이 볼 수 있어요.',
    cv_they_all: '{name}님이 5개 모두 답장했어요.',
    cv_level_open: '레벨 {n} 열림',
    cv_closed: '이 대화는 종료되었어요.',
    cv_moved: '이 대화는 이미 다음으로 넘어갔어요.',
    cv_ended_bar: '레벨 {n}/3 · 끝남',
    cv_ended_divider: '대화가 끝났어요',
    cv_decide_title: '레벨 2가 끝났어요. {name}님과 채팅을 열까요?',
    cv_decide_note: '두 사람 모두 고르면 채팅(레벨 3)이 바로 열리고, 서로의 실명이 보여요. 한 사람이라도 ‘그만두기’를 고르면 대화는 두 사람 모두에게 끝나요.',
    cv_open_chat: '채팅 열기 (레벨 3)',
    cv_forget: '그만두기',
    cv_forget_q: '그만둘까요?',
    cv_forget_text: '{name}님과의 대화가 두 사람 모두에게 끝나요. 지금까지의 대화는 읽을 수 있지만, 더 보낼 수는 없어요.',
    cv_forget_yes: '그만두기',
    cv_forget_no: '돌아가기',
    cv_decided_wait: '채팅 열기를 골랐어요 — {name}님을 기다리는 중',
    cv_ended: '이 대화는 끝났어요',
    cv_ended_note: '위에서 계속 읽을 수 있어요.',
    cv_left: '이 사람은 30+DA를 떠났어요',
    cv_left_note: '이 대화는 닫혔어요. 더 이상 보낼 수 없어요.',
    cv_left_name: '30+DA를 떠난 사람',
  },
  ja: {
    cv_level: 'レベル{n}',
    cv_level_bar: 'レベル {n}/3',
    cv_chat_level: 'レベル3 · チャット',
    cv_you: 'あなた',
    cv_intro_1: 'まずは短いひとことを5つ。{name}さんがひとつずつ返信し、{name}さんからも5つ届きます。',
    cv_intro_2: 'レベル2が開きました。お互いに新しいひとことを5つずつ——3つ選んで2つ書きます。返信は今回もワンタップです。',
    cv_waiting: '返信待ち',
    cv_they_replied: '{name}さんが{total}つ中{n}つに返信',
    cv_they_replied_all: '{name}さんが{total}つすべてに返信',
    cv_they_none: '{name}さんの返信を待っています',
    cv_you_replied: '{total}つ中{n}つに返信済み',
    cv_you_replied_all: '{total}つすべてに返信済み',
    cv_hint: 'ひとことごとに1回タップ。5つすべて返すまでは変更できます。',
    cv_change_aria: 'あなたの返信：{text}。タップして変更。',
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
    cv_remind: '知らせる',
    cv_remind_on: 'リマインダーON',
    cv_notify_off: 'このブラウザでは通知がオフのため、ここでお知らせします。',
    cv_all_replied: '5つすべてに返信しました。{name}さんに届いています。',
    cv_they_all: '{name}さんが5つすべてに返信しました。',
    cv_level_open: 'レベル{n}が開きました。',
    cv_closed: 'この会話は終了しました。',
    cv_moved: 'この会話はすでに先に進んでいます。',
    cv_ended_bar: 'レベル {n}/3 · 終了',
    cv_ended_divider: '会話は終了しました',
    cv_decide_title: 'レベル2が終わりました。{name}さんとのチャットを開きますか？',
    cv_decide_note: '2人とも選ぶとすぐにチャット（レベル3）が開き、お互いの本名が表示されます。どちらかが「やめておく」を選ぶと、会話は2人とも終了します。',
    cv_open_chat: 'チャットを開く（レベル3）',
    cv_forget: 'やめておく',
    cv_forget_q: 'やめておきますか？',
    cv_forget_text: '{name}さんとの会話は2人とも終了します。これまでの会話は読めますが、もう送ることはできません。',
    cv_forget_yes: 'やめておく',
    cv_forget_no: '戻る',
    cv_decided_wait: 'チャットを開くを選びました — {name}さんを待っています',
    cv_ended: 'この会話は終了しました',
    cv_ended_note: '上でいつでも読めます。',
    cv_left: 'この人は30+DAを退会しました',
    cv_left_note: 'この会話は終了しました。これ以上送信できません。',
    cv_left_name: '退会したユーザー',
  },
});
