// Screens 5 + 8 · Level 1 / Level 2 · "Send your 5" — the panel at the bottom of the conversation screen
// (screens/conversation.js): lines 1..pick are picked, each from its own 5 choices (set by the super admin),
// the rest are written (replied to with Yes / No, at both levels), live contact-detail check. Also exports the
// small helpers the conversation shares (rule messages, notes, the send button paint). The old
// #/ask/:pairId/:level address redirects to the conversation.
import {
  screen, el, icon, t, go, api, toast, state, langPair, heartbeat,
  errorText, registerStrings, LEVEL_RULES, checkWrittenQuestion, dealSlots,
} from '../core.js';

// Same limits as shared/rules.js (QUESTION_LIMITS / ANSWER_LIMITS are not exported there).
const QUESTION_MAX = { 1: 80, 2: 100 };
export const ANSWER_MAX = 120;
const MATCH_MAX = 40;
const HIT_TYPES = ['phone', 'email', 'handle', 'app', 'link'];

// Unsent work survives leaving the screen (not a reload): `${pairId}:${level}` → draft.
const drafts = new Map();

// ---------------------------------------------------------------- shared with the conversation screen

export const enc = encodeURIComponent;
export const myLang = () => state.me?.lang || state.lang;

const clip = (s) => {
  const chars = [...String(s ?? '').trim()];
  return chars.length > MATCH_MAX ? `${chars.slice(0, MATCH_MAX - 1).join('')}…` : chars.join('');
};

/** Red message for a rule check (contact detail, bad word or too long); null when the box is fine or just unfinished. */
export function ruleMessage(check, max) {
  if (check?.error === 'contact') {
    const hit = check.hits?.[0];
    const type = HIT_TYPES.includes(hit?.type) ? hit.type : 'contact';
    return t(`lv_hit_${type}`, { match: clip(hit?.match) });
  }
  if (check?.error === 'word') return t('lv_hit_word', { match: clip(check.hits?.[0]?.match) });
  if (check?.error === 'too_long') return t('lv_too_long', { max });
  return null;
}

/** Fill a .field-error node with a message (or hide it). */
export function showError(node, msg) {
  node.hidden = !msg;
  node.replaceChildren(...(msg ? [icon('flag', 14), el('span', {}, msg)] : []));
}

/** "文A We will translate for you · EN⇄KM" when the two people use different languages. */
export function translateNote(pair) {
  const theirs = pair.other?.lang;
  if (!theirs || theirs === myLang()) return null;
  return el('p', { class: 'lock-note' }, icon('translate', 14), el('span', {}, `${t('lv_translate')} · ${langPair(myLang(), theirs)}`));
}

export const lockNote = (text) => el('p', { class: 'lock-note' }, icon('lock', 14), el('span', {}, text));

/** True when the error was already handled by a redirect (signed out / blocked). */
// verify_needed: the "Verify to chat" sheet already said why (screens/verify-chat.js) — nothing more to say.
export const redirected = (err) => err?.status === 401 || err?.code === 'blocked' || err?.code === 'verify_needed';

/** Paint a send button: navy when ready, greyed (but still clickable) otherwise, really disabled while busy. */
export function paintSendButton(btn, { ready, busy, label }) {
  btn.className = ready && !busy ? 'btn btn-primary' : 'btn is-disabled';
  btn.disabled = busy;
  btn.setAttribute('aria-disabled', String(!ready || busy));
  btn.replaceChildren(...[el('span', { class: 'btn-text' }, busy ? t('lv_sending') : label), ready && !busy ? icon('arrow', 18) : null].filter(Boolean));
}

// ---------------------------------------------------------------- the "send your 5" panel

// Question N starts on choice 1 of its own list. `changed` = rows whose pick went back to choice 1
// because the admin changed that list; they stay marked until their list is opened.
function freshDraft(slots, write) {
  return { picks: slots.map((options) => options[0]?.key ?? null), written: Array(write).fill(''), changed: new Set() };
}

// The admin can change the choices between visits: keep the written lines and every pick that is
// still in its own list; a pick that is gone goes back to that list's choice 1, and the row is marked.
function draftFor(key, slots, write) {
  const old = drafts.get(key);
  const draft = freshDraft(slots, write);
  if (old?.written.length === write) draft.written = old.written;
  if (old?.picks.length === slots.length) {
    draft.changed = new Set([...(old.changed || [])].filter((i) => i < slots.length));
    draft.picks = old.picks.map((k, i) => {
      if (slots[i].some((q) => q.key === k)) return k;
      if (k) draft.changed.add(i);
      return draft.picks[i];
    });
  }
  drafts.set(key, draft);
  return draft;
}

/** [[{ key, text }] × pick]: the admin's lists (`slots[i].options`), or (older servers) the flat list dealt the same way. */
function slotsOf(bank, pick) {
  if (Array.isArray(bank.slots) && bank.slots.length === pick) return bank.slots.map((s) => s.options || []);
  return dealSlots(bank.system || [], pick);
}

/** Line N's optional topic set by the admin ("Communication"), or null. */
function titlesOf(bank, pick) {
  if (!Array.isArray(bank.slots) || bank.slots.length !== pick) return [];
  return bank.slots.map((s) => (typeof s.title === 'string' && s.title.trim() ? s.title.trim() : null));
}

const PICK_STYLE = {
  display: 'block', height: 'auto', minHeight: '46px', padding: '12px 40px 12px 14px', textAlign: 'left', lineHeight: '1.35',
};

/**
 * "Send your 5" — lines 1..pick are picked, each from its own list of 5 (set by the super admin), the rest
 * are written (the other person replies Yes / No to them, at both levels), with the live contact-detail check. A tap on the
 * greyed-out Send while a contact detail is present still posts the set: the server records the stopped
 * attempt for the admin (design A2). Unsent work survives leaving the screen (not a reload).
 *
 * bank = { pick, write, slots:[{ n, title, options:[{ key, text }] }] } (the conversation's `canSend`, or
 * GET /questions). onSent(res) after the 201; onReload() when the admin changed the lists under us (the
 * caller loads them again and builds a new panel: the drafts keep every pick still offered); onMoved(err)
 * for a 409 / 404 (the conversation moved on). Returns { node, pick, write, focus() }.
 */
export function sendPanel({ pairId, level, bank, name, onSent, onReload, onMoved }) {
  const pick = bank.pick ?? LEVEL_RULES[level].pick;
  const write = bank.write ?? LEVEL_RULES[level].write;
  const slots = slotsOf(bank, pick);
  const titles = titlesOf(bank, pick);
  // "Line 1 · Communication" when the admin gave line 1 a topic.
  const slotTitle = (i) => (titles[i] ? `${t('la_question_n', { n: i + 1 })} · ${titles[i]}` : t('la_question_n', { n: i + 1 }));
  const draftKey = `${pairId}:${level}`;
  const draft = draftFor(draftKey, slots, write);
  const serverErr = Array(write).fill(null); // a server 422 for a row, until the row is edited
  let busy = false;
  let stoppedSig = null; // the exact set the server last stopped: re-tapping does not post it twice
  let stoppedWord = false; // …and whether it was stopped for a bad word (else a contact detail)
  let node = null;

  const textOf = (i, key) => slots[i]?.find((q) => q.key === key)?.text || '';
  const qrow = (n, ...kids) => el('li', { class: 'qrow' },
    el('span', { class: 'num', 'aria-hidden': 'true' }, String((level - 1) * 5 + n)), // Level 2 continues: 6–10
    el('div', { class: 'qrow-main' }, ...kids));

  // --- pick rows: a field-fill trigger that drops that line's own 5 choices right under it
  const pickRows = draft.picks.map((_, i) => {
    const face = el('span', {});
    // The admin's topic for this line, if any, sits small above the picked text.
    const topic = titles[i] ? el('span', { class: 'label pick-topic', 'aria-hidden': 'true' }, titles[i]) : null;
    const trigger = el('button', {
      type: 'button', class: 'select', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', style: PICK_STYLE, on: { click: () => openPicker(i) },
    }, ...[el('span', { class: 'visually-hidden' }, `${slotTitle(i)}: `), topic, face].filter(Boolean));
    // Shown after the admin changed this line's list and the pick went back to choice 1.
    const note = el('p', { class: 'pick-note', id: `la-upd-${i + 1}`, hidden: true }, icon('flag', 14), el('span', {}, t('la_pick_updated')));
    return { face, trigger, note, node: qrow(i + 1, trigger, note) };
  });

  // One drop list open at a time, directly under the line that was tapped.
  let openIndex = -1;
  function closePicker() {
    if (openIndex < 0) return;
    const row = pickRows[openIndex];
    row.panel?.remove();
    row.panel = null;
    row.trigger.setAttribute('aria-expanded', 'false');
    openIndex = -1;
  }

  function openPicker(i) {
    if (busy) return;
    const wasOpen = openIndex === i;
    closePicker();
    if (draft.changed.delete(i)) paint();
    if (wasOpen) return;
    const options = slots[i] || [];
    const current = draft.picks[i];
    const panel = el('div', { class: 'droplist', role: 'listbox', 'aria-label': slotTitle(i) },
      options.map((q) => {
        const selected = q.key === current;
        return el('button', {
          type: 'button', class: ['droplist-item', selected && 'selected'], role: 'option', 'aria-selected': String(selected),
          on: {
            click: () => {
              draft.picks[i] = q.key;
              closePicker();
              paint();
              pickRows[i].trigger.focus();
            },
            keydown: (e) => {
              if (e.key !== 'Escape') return;
              closePicker();
              pickRows[i].trigger.focus();
            },
          },
        }, el('span', {}, q.text), selected ? icon('check', 18) : null);
      }));
    pickRows[i].trigger.after(panel);
    pickRows[i].trigger.setAttribute('aria-expanded', 'true');
    pickRows[i].panel = panel;
    openIndex = i;
    (panel.querySelector('.selected') || panel.firstChild)?.focus({ preventScroll: true });
    panel.scrollIntoView?.({ block: 'nearest' });
  }

  // --- write rows: outline inputs with a live rule check
  const writeRows = draft.written.map((text, j) => {
    const n = pick + j + 1;
    const err = el('p', { class: 'field-error', id: `la-err-${n}`, 'aria-live': 'polite', hidden: true });
    const input = el('input', {
      type: 'text', class: 'input', value: text, placeholder: t(`la_ph_${level}`), autocomplete: 'off', autocapitalize: 'sentences',
      enterkeyhint: j === write - 1 ? 'done' : 'next', 'aria-label': t('la_question_n', { n }), 'aria-describedby': err.id,
    });
    input.addEventListener('input', () => {
      draft.written[j] = input.value;
      serverErr[j] = null;
      paint();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      const nextRow = writeRows[j + 1];
      if (nextRow) nextRow.input.focus();
      else input.blur();
    });
    return { input, err, node: qrow(n, input, err) };
  });

  const sendBtn = el('button', { type: 'button', class: 'btn btn-primary' });

  function checks() {
    return draft.written.map((text) => checkWrittenQuestion(text.trim(), level));
  }

  function paint() {
    const results = checks();
    pickRows.forEach((row, i) => {
      row.face.textContent = textOf(i, draft.picks[i]);
      const changed = draft.changed.has(i);
      row.trigger.classList.toggle('is-updated', changed);
      row.note.hidden = !changed;
      if (changed) row.trigger.setAttribute('aria-describedby', row.note.id);
      else row.trigger.removeAttribute('aria-describedby');
    });
    writeRows.forEach((row, j) => {
      const msg = serverErr[j] || ruleMessage(results[j], QUESTION_MAX[level]);
      row.input.classList.toggle('is-error', Boolean(msg));
      row.input.setAttribute('aria-invalid', String(Boolean(msg)));
      showError(row.err, msg);
    });
    const missing = results.filter((r) => !r.ok).length;
    paintSendButton(sendBtn, { ready: !missing, busy, label: t('la_ask_them') }); // enabled once all 5 are ready
    for (const row of pickRows) row.trigger.disabled = busy;
    for (const row of writeRows) row.input.readOnly = busy;
    return { results, missing };
  }

  sendBtn.addEventListener('click', () => {
    if (busy) return;
    const { results, missing } = paint();
    if (!missing) return send(false);
    // A contact detail or a bad word still goes to the server, which records the stopped try for the admin.
    if (results.some((r) => r.error === 'contact' || r.error === 'word')) return send(true);
    writeRows[results.findIndex((r) => !r.ok)]?.input.focus();
  });

  async function send(attempt) {
    const body = {
      level,
      questions: [
        ...draft.picks.map((key) => ({ source: 'system', key })),
        ...draft.written.map((text) => ({ source: 'written', text: text.trim() })),
      ],
    };
    const sig = JSON.stringify(body);
    if (attempt && sig === stoppedSig) {
      toast(t(stoppedWord ? 'lv_stopped_word' : 'lv_stopped'));
      return;
    }
    busy = true;
    paint();
    try {
      const r = await api.post(`/pairs/${enc(pairId)}/sets`, body);
      drafts.delete(draftKey);
      heartbeat();
      toast(t('la_sent', { name }));
      onSent?.(r);
    } catch (err) {
      busy = false;
      if (!node?.isConnected) return;
      if (redirected(err)) {
        if (err.code === 'verify_needed') paint(); // the sheet closed unverified: the lines stay, Send is free again
        return;
      }
      const j = Number(err.data?.index) - pick;
      const row = Number.isInteger(j) && j >= 0 && j < write ? j : -1;
      if (err.code === 'contact_detail' || err.code === 'bad_word') {
        stoppedSig = sig;
        stoppedWord = err.code === 'bad_word';
        if (row >= 0) serverErr[row] = ruleMessage({ error: stoppedWord ? 'word' : 'contact', hits: err.data?.hits }, QUESTION_MAX[level]);
        toast(t(stoppedWord ? 'lv_stopped_word' : 'lv_stopped'));
      } else if (err.code === 'invalid' && err.data?.slot) {
        // A picked choice is no longer in its list (the admin changed the choices while this was open):
        // the caller loads the lists again; the written lines and the picks still offered are kept, and
        // the rows that went back to choice 1 are marked until their list is opened.
        toast(t('la_choices_changed'), 6000);
        onReload?.();
        return;
      } else if (err.code === 'invalid') {
        const n = Number(err.data?.index) + 1 || 1;
        if (row >= 0) serverErr[row] = err.data?.reason === 'too_long' ? t('lv_too_long', { max: QUESTION_MAX[level] }) : t('lv_check_n', { n });
        else toast(t('lv_check_n', { n }));
      } else if (err.status === 409 || err.status === 404) {
        onMoved?.(err);
        return;
      } else {
        toast(errorText(err));
      }
      paint();
      if (row >= 0) writeRows[row].input.focus();
    }
  }

  node = el('div', { class: 'conv-compose' },
    el('ol', { class: 'qlist' }, pickRows.map((r) => r.node), writeRows.map((r) => r.node)),
    el('div', { class: 'ask-actions' }, lockNote(t(`la_lock_${level}`)), sendBtn));
  paint();
  return {
    node,
    pick,
    write,
    focus: () => (writeRows.find((r) => !r.input.value.trim()) || writeRows[0])?.input.focus({ preventScroll: true }),
  };
}

// The conversation screen has the panel now; the old address takes you there.
screen('/ask/:pairId/:level', ({ params }) => {
  go(`/c/${enc(params.pairId)}`, { replace: true });
});

registerStrings({
  en: {
    lv_hit_phone: 'No phone numbers: “{match}”',
    lv_hit_email: 'No email addresses: “{match}”',
    lv_hit_handle: 'No chat handles: “{match}”',
    lv_hit_app: 'No chat app names: “{match}”',
    lv_hit_link: 'No links: “{match}”',
    lv_hit_contact: 'No contact details: “{match}”',
    lv_too_long: 'Too long. Keep it under {max} characters.',
    lv_stopped: 'Not sent. Contact details are never allowed.',
    lv_hit_word: 'No rude, sexual or money words: “{match}”',
    lv_stopped_word: 'Not sent. Rude, sexual or money words are never allowed.',
    lv_translate: 'We will translate for you',
    lv_check_n: 'Check line {n}.',
    lv_sending: 'Sending…',
    la_rule: 'Pick {pick} · Write {write}',
    la_ph_1: 'Write your own line (yes/no reply)',
    la_ph_2: 'Write your own line (yes/no reply)',
    la_lock_1: 'No phone numbers or chat handles.',
    la_lock_2: 'No phone numbers or chat handles.',
    la_ask_them: 'Send',
    la_sent: 'Sent. Now it is {name}’s turn.',
    la_question_n: 'Line {n}',
    la_choices_changed: 'The choices were just updated. Check your picks.',
    la_pick_updated: 'Updated. Check this line.',
  },
  km: {
    lv_hit_phone: 'មិនអនុញ្ញាតលេខទូរស័ព្ទ៖ “{match}”',
    lv_hit_email: 'មិនអនុញ្ញាតអាសយដ្ឋានអ៊ីមែល៖ “{match}”',
    lv_hit_handle: 'មិនអនុញ្ញាតឈ្មោះគណនីជជែក៖ “{match}”',
    lv_hit_app: 'មិនអនុញ្ញាតឈ្មោះកម្មវិធីជជែក៖ “{match}”',
    lv_hit_link: 'មិនអនុញ្ញាតតំណភ្ជាប់៖ “{match}”',
    lv_hit_contact: 'មិនអនុញ្ញាតព័ត៌មានទំនាក់ទំនង៖ “{match}”',
    lv_too_long: 'វែងពេក។ សូមសរសេរមិនឲ្យលើស {max} តួអក្សរ។',
    lv_stopped: 'មិនបានផ្ញើទេ។ ព័ត៌មានទំនាក់ទំនងមិនត្រូវបានអនុញ្ញាតឡើយ។',
    lv_hit_word: 'មិនអនុញ្ញាតពាក្យអសុរស ពាក្យផ្លូវភេទ ឬពាក្យទាក់ទងនឹងលុយ៖ “{match}”',
    lv_stopped_word: 'មិនបានផ្ញើទេ។ ពាក្យអសុរស ពាក្យផ្លូវភេទ ឬពាក្យទាក់ទងនឹងលុយ មិនត្រូវបានអនុញ្ញាតឡើយ។',
    lv_translate: 'យើងនឹងបកប្រែជូនអ្នក',
    lv_check_n: 'សូមពិនិត្យឃ្លាទី {n}។',
    lv_sending: 'កំពុងផ្ញើ…',
    la_rule: 'ជ្រើស {pick} · សរសេរ {write}',
    la_ph_1: 'សរសេរឃ្លាផ្ទាល់ខ្លួន (ឆ្លើយតប បាទ/ចាស ឬ ទេ)',
    la_ph_2: 'សរសេរឃ្លាផ្ទាល់ខ្លួន (ឆ្លើយតប បាទ/ចាស ឬ ទេ)',
    la_lock_1: 'គ្មានលេខទូរស័ព្ទ ឬឈ្មោះគណនីជជែកទេ។',
    la_lock_2: 'គ្មានលេខទូរស័ព្ទ ឬឈ្មោះគណនីជជែកទេ។',
    la_ask_them: 'ផ្ញើ',
    la_sent: 'បានផ្ញើហើយ។ ឥឡូវដល់វេន {name} ឆ្លើយតប។',
    la_question_n: 'ឃ្លាទី {n}',
    la_choices_changed: 'ជម្រើសទើបតែត្រូវបានធ្វើបច្ចុប្បន្នភាព។ សូមពិនិត្យជម្រើសរបស់អ្នកម្តងទៀត។',
    la_pick_updated: 'បានធ្វើបច្ចុប្បន្នភាព។ សូមពិនិត្យឃ្លានេះ។',
  },
  zh: {
    lv_hit_phone: '不能留电话号码：“{match}”',
    lv_hit_email: '不能留邮箱地址：“{match}”',
    lv_hit_handle: '不能留聊天账号：“{match}”',
    lv_hit_app: '不能提聊天软件：“{match}”',
    lv_hit_link: '不能发链接：“{match}”',
    lv_hit_contact: '不能留联系方式：“{match}”',
    lv_too_long: '太长了，请控制在 {max} 个字以内。',
    lv_stopped: '未发送。任何联系方式都不允许分享。',
    lv_hit_word: '不能用粗俗、色情或涉及金钱的词：“{match}”',
    lv_stopped_word: '未发送。不允许粗俗、色情或涉及金钱的词语。',
    lv_translate: '我们会为你翻译',
    lv_check_n: '请检查第 {n} 句。',
    lv_sending: '发送中…',
    la_rule: '选 {pick} 句 · 自己写 {write} 句',
    la_ph_1: '写一句你的话（用“是/不是”回复）',
    la_ph_2: '写一句你的话（用“是/不是”回复）',
    la_lock_1: '不能留电话号码或聊天账号。',
    la_lock_2: '不能留电话号码或聊天账号。',
    la_ask_them: '发送',
    la_sent: '已发送，现在轮到 {name} 回复。',
    la_question_n: '第 {n} 句',
    la_choices_changed: '选项刚刚更新了，请再检查一下你的选择。',
    la_pick_updated: '已更新，请检查这一句。',
  },
  ko: {
    lv_hit_phone: '전화번호는 안 돼요: “{match}”',
    lv_hit_email: '이메일 주소는 안 돼요: “{match}”',
    lv_hit_handle: '채팅 아이디는 안 돼요: “{match}”',
    lv_hit_app: '채팅 앱 이름은 안 돼요: “{match}”',
    lv_hit_link: '링크는 안 돼요: “{match}”',
    lv_hit_contact: '연락처는 안 돼요: “{match}”',
    lv_too_long: '너무 길어요. {max}자 이내로 써 주세요.',
    lv_stopped: '보내지 않았어요. 연락처는 절대 공유할 수 없어요.',
    lv_hit_word: '욕설, 성적인 말, 돈 관련 말은 안 돼요: “{match}”',
    lv_stopped_word: '보내지 않았어요. 욕설, 성적인 말, 돈 관련 말은 쓸 수 없어요.',
    lv_translate: '번역은 저희가 해 드려요',
    lv_check_n: '{n}번째 한마디를 확인해 주세요.',
    lv_sending: '보내는 중…',
    la_rule: '{pick}개 고르기 · {write}개 직접 쓰기',
    la_ph_1: '한마디 쓰기 (예/아니요로 답장)',
    la_ph_2: '한마디 쓰기 (예/아니요로 답장)',
    la_lock_1: '전화번호나 채팅 아이디는 안 돼요.',
    la_lock_2: '전화번호나 채팅 아이디는 안 돼요.',
    la_ask_them: '보내기',
    la_sent: '보냈어요. 이제 {name}님이 답장할 차례예요.',
    la_question_n: '{n}번째 한마디',
    la_choices_changed: '선택지가 방금 바뀌었어요. 고른 것을 다시 확인해 주세요.',
    la_pick_updated: '바뀌었어요. 이 한마디를 확인해 주세요.',
  },
  ja: {
    lv_hit_phone: '電話番号は送れません：「{match}」',
    lv_hit_email: 'メールアドレスは送れません：「{match}」',
    lv_hit_handle: 'チャットIDは送れません：「{match}」',
    lv_hit_app: 'チャットアプリ名は送れません：「{match}」',
    lv_hit_link: 'リンクは送れません：「{match}」',
    lv_hit_contact: '連絡先は送れません：「{match}」',
    lv_too_long: '長すぎます。{max}文字以内にしてください。',
    lv_stopped: '送信されませんでした。連絡先の共有は一切できません。',
    lv_hit_word: '乱暴・性的・お金に関する言葉は送れません：「{match}」',
    lv_stopped_word: '送信されませんでした。乱暴な言葉・性的な言葉・お金に関する言葉は使えません。',
    lv_translate: '翻訳はおまかせください',
    lv_check_n: '{n}つ目のひとことを確認してください。',
    lv_sending: '送信中…',
    la_rule: '{pick}つ選ぶ · {write}つ書く',
    la_ph_1: 'ひとことを書く（はい/いいえで返信）',
    la_ph_2: 'ひとことを書く（はい/いいえで返信）',
    la_lock_1: '電話番号やチャットIDは書けません。',
    la_lock_2: '電話番号やチャットIDは書けません。',
    la_ask_them: '送信',
    la_sent: '送信しました。次は{name}さんが返信する番です。',
    la_question_n: 'ひとこと{n}',
    la_choices_changed: '選択肢が更新されました。選んだものをもう一度確認してください。',
    la_pick_updated: '更新されました。このひとことを確認してください。',
  },
});
