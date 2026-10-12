// Screens 5 + 8 · Level 1 / Level 2 · Ask 5 — pick system questions from the bank, write your own
// (yes/no at Level 1, open at Level 2), live contact-detail check. A tap on the greyed-out Send
// while a contact detail is present still posts the set: the server records the stopped attempt
// for the admin (design A2). Also exports the helpers the answer and wait screens share.
import {
  screen, el, icon, t, go, api, toast, modal, state, topBar, levelBar, avatar, pronoun, langPair, heartbeat,
  pairRoute, stageLevel, errorText, registerStrings, LEVEL_RULES, checkWrittenQuestion,
} from '../core.js';

// Same limits as shared/rules.js (QUESTION_LIMITS / ANSWER_LIMITS are not exported there).
const QUESTION_MAX = { 1: 80, 2: 100 };
export const ANSWER_MAX = 120;
const MATCH_MAX = 40;
const HIT_TYPES = ['phone', 'email', 'handle', 'app', 'link'];

// Unsent work survives leaving the screen (not a reload): `${pairId}:${level}` → draft.
const drafts = new Map();

// ---------------------------------------------------------------- shared with level-answer / level-wait

export const enc = encodeURIComponent;
export const personPath = (pair) => `/person/${enc(pair.other.id)}`;
export const myLang = () => state.me?.lang || state.lang;

/** Route param → level number when it is one of `allowed`, else 0. */
export function levelParam(raw, allowed = [1, 2]) {
  const n = Number(raw);
  return allowed.includes(n) ? n : 0;
}

const clip = (s) => {
  const chars = [...String(s ?? '').trim()];
  return chars.length > MATCH_MAX ? `${chars.slice(0, MATCH_MAX - 1).join('')}…` : chars.join('');
};

/** Red message for a rule check (contact detail or too long); null when the box is fine or just unfinished. */
export function ruleMessage(check, max) {
  if (check?.error === 'contact') {
    const hit = check.hits?.[0];
    const type = HIT_TYPES.includes(hit?.type) ? hit.type : 'contact';
    return t(`lv_hit_${type}`, { match: clip(hit?.match) });
  }
  if (check?.error === 'too_long') return t('lv_too_long', { max });
  return null;
}

/** Fill a .field-error node with a message (or hide it). */
export function showError(node, msg) {
  node.hidden = !msg;
  node.replaceChildren(...(msg ? [icon('flag', 14), el('span', {}, msg)] : []));
}

/** Header title: small avatar + text. */
export const headTitle = (pair, text) => [avatar(pair.other.photo, 32), el('span', { class: 'grow' }, text)];

/** "LEVEL 1/3" over the level bar, for the right side of the header. */
export function levelRight(level) {
  return el('div', { class: 'stack', style: { '--gap': '6px', alignItems: 'flex-end' } },
    el('span', { class: 'label ink' }, t('lv_level_of', { n: level })), levelBar(level));
}

/** "文A We will translate for you · EN⇄KM" when the two people use different languages. */
export function translateNote(pair) {
  const theirs = pair.other?.lang;
  if (!theirs || theirs === myLang()) return null;
  return el('p', { class: 'lock-note' }, icon('translate', 14), el('span', {}, `${t('lv_translate')} · ${langPair(myLang(), theirs)}`));
}

export const lockNote = (text) => el('p', { class: 'lock-note' }, icon('lock', 14), el('span', {}, text));

/** The pair moved on under us (409/404): say so, then show wherever it is now. */
export async function moveOn(err, pairId, fallback = '/nearby') {
  toast(err.code === 'other_blocked' ? t('lv_closed') : t('lv_moved_on'));
  try {
    const { pair } = await api.get(`/pairs/${enc(pairId)}`);
    go(pairRoute(pair), { replace: true });
  } catch {
    go(fallback, { replace: true });
  }
}

/** True when the error was already handled by a redirect (signed out / blocked). */
export const redirected = (err) => err?.status === 401 || err?.code === 'blocked';

/** Paint a send button: navy when ready, greyed (but still clickable) otherwise, really disabled while busy. */
export function paintSendButton(btn, { ready, busy, label }) {
  btn.className = ready && !busy ? 'btn btn-primary' : 'btn is-disabled';
  btn.disabled = busy;
  btn.setAttribute('aria-disabled', String(!ready || busy));
  btn.replaceChildren(...[el('span', { class: 'btn-text' }, busy ? t('lv_sending') : label), ready && !busy ? icon('arrow', 18) : null].filter(Boolean));
}

// ---------------------------------------------------------------- screen

const canAsk = (pair, level) => stageLevel(pair) === level
  && (pair.next === 'ask' || (pair.next === 'ask_answer' && !pair.myOutgoing?.sent));

function freshDraft(system, pick, write) {
  return { picks: system.slice(0, pick).map((q) => q.key), written: Array(write).fill('') };
}

// The bank can change between visits: keep a draft only if its picks are still valid and distinct.
function draftFor(key, system, pick, write) {
  const old = drafts.get(key);
  const keys = new Set(system.map((q) => q.key));
  const valid = old && old.picks.length === pick && old.written.length === write
    && new Set(old.picks).size === pick && old.picks.every((k) => keys.has(k));
  const draft = valid ? old : freshDraft(system, pick, write);
  drafts.set(key, draft);
  return draft;
}

const PICK_STYLE = {
  display: 'block', height: 'auto', minHeight: '46px', padding: '12px 40px 12px 14px', textAlign: 'left', lineHeight: '1.35',
};

screen('/ask/:pairId/:level', async ({ params, root }) => {
  const level = levelParam(params.level);
  if (!level) {
    go('/nearby', { replace: true });
    return;
  }
  root.classList.add('level', 'level-ask');
  root.append(topBar({ left: 'back' }), el('p', { class: 'loading' }, t('core_loading')));

  const [{ pair }, bank] = await Promise.all([
    api.get(`/pairs/${enc(params.pairId)}`),
    api.get(`/questions?level=${level}`),
  ]);
  if (!root.isConnected) return;
  if (!canAsk(pair, level)) {
    go(pairRoute(pair), { replace: true });
    return;
  }

  const name = pair.other.name;
  const pick = bank.pick ?? LEVEL_RULES[level].pick;
  const write = bank.write ?? LEVEL_RULES[level].write;
  const system = bank.system || [];
  const draftKey = `${pair.id}:${level}`;
  const draft = draftFor(draftKey, system, pick, write);
  const serverErr = Array(write).fill(null); // a server 422 for a row, until the row is edited
  let busy = false;
  let stoppedSig = null; // the exact set the server last stopped: re-tapping does not post it twice

  const textOf = (key) => system.find((q) => q.key === key)?.text || '';
  const qrow = (n, ...kids) => el('li', { class: 'qrow' },
    el('span', { class: 'num', 'aria-hidden': 'true' }, String(n)),
    el('div', { class: 'qrow-main' }, ...kids));

  // --- pick rows: a field-fill trigger that opens a sheet with the whole bank (no duplicates)
  const pickRows = draft.picks.map((_, i) => {
    const face = el('span', {});
    const trigger = el('button', {
      type: 'button', class: 'select', 'aria-haspopup': 'dialog', style: PICK_STYLE, on: { click: () => openPicker(i) },
    }, el('span', { class: 'visually-hidden' }, `${t('la_question_n', { n: i + 1 })}: `), face);
    return { face, trigger, node: qrow(i + 1, trigger) };
  });

  function openPicker(i) {
    if (busy) return;
    const used = new Set(draft.picks.filter((_, k) => k !== i));
    const current = draft.picks[i];
    const title = t('la_question_n', { n: i + 1 });
    const sheet = modal(el('div', { class: 'sheet-body' },
      el('h2', { class: 'sheet-title' }, title),
      el('div', { class: 'menu', role: 'listbox', 'aria-label': title }, system.map((q) => {
        const taken = used.has(q.key);
        const selected = q.key === current;
        return el('button', {
          type: 'button', class: ['menu-item', selected && 'selected'], role: 'option', 'aria-selected': String(selected),
          disabled: taken, style: { minHeight: '52px', padding: '12px 4px', lineHeight: '1.35', opacity: taken ? '0.45' : null },
          on: {
            click: () => {
              draft.picks[i] = q.key;
              sheet.close();
              paint();
              pickRows[i].trigger.focus();
            },
          },
        }, el('span', {}, q.text), selected ? icon('check', 18) : taken ? el('span', { class: 'label' }, t('la_in_list')) : null);
      }))),
    { sheet: true, label: title });
    sheet.node.querySelector('.menu-item.selected')?.scrollIntoView({ block: 'center' });
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
    pickRows.forEach((row, i) => { row.face.textContent = textOf(draft.picks[i]); });
    writeRows.forEach((row, j) => {
      const msg = serverErr[j] || ruleMessage(results[j], QUESTION_MAX[level]);
      row.input.classList.toggle('is-error', Boolean(msg));
      row.input.setAttribute('aria-invalid', String(Boolean(msg)));
      showError(row.err, msg);
    });
    const missing = results.filter((r) => !r.ok).length;
    const label = !missing ? t('la_send') : missing === 1 ? t('la_write_one') : t('la_write_n', { n: missing });
    paintSendButton(sendBtn, { ready: !missing, busy, label });
    for (const row of pickRows) row.trigger.disabled = busy;
    return { results, missing };
  }

  sendBtn.addEventListener('click', () => {
    if (busy) return;
    const { results, missing } = paint();
    if (!missing) return send(false);
    if (results.some((r) => r.error === 'contact')) return send(true);
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
      toast(t('lv_stopped'));
      return;
    }
    busy = true;
    paint();
    try {
      const r = await api.post(`/pairs/${enc(pair.id)}/sets`, body);
      drafts.delete(draftKey);
      heartbeat();
      toast(t('la_sent', { name }));
      if (root.isConnected) go(pairRoute(r.pair), { replace: true });
    } catch (err) {
      busy = false;
      if (!root.isConnected || redirected(err)) return;
      const j = Number(err.data?.index) - pick;
      const row = Number.isInteger(j) && j >= 0 && j < write ? j : -1;
      if (err.code === 'contact_detail') {
        stoppedSig = sig;
        if (row >= 0) serverErr[row] = ruleMessage({ error: 'contact', hits: err.data?.hits }, QUESTION_MAX[level]);
        toast(t('lv_stopped'));
      } else if (err.code === 'invalid') {
        const n = Number(err.data?.index) + 1 || 1;
        if (row >= 0) serverErr[row] = err.data?.reason === 'too_long' ? t('lv_too_long', { max: QUESTION_MAX[level] }) : t('lv_check_n', { n });
        else toast(t('lv_check_n', { n }));
      } else if (err.status === 409 || err.status === 404) {
        moveOn(err, pair.id, personPath(pair));
        return;
      } else {
        toast(errorText(err));
      }
      paint();
      if (row >= 0) writeRows[row].input.focus();
    }
  }

  // Level 2 can be answered before asking: offer that way round too.
  const answerFirst = pair.next === 'ask_answer'
    ? el('button', {
      type: 'button', class: 'btn btn-dashed', style: { marginBottom: '18px' },
      on: { click: () => go(`/answer/${enc(pair.id)}/${level}`) },
    }, icon('question', 16), el('span', {}, t('la_answer_first', { name })))
    : null;

  root.replaceChildren(...[
    topBar({ left: 'back', title: headTitle(pair, t(`la_title_${pronoun(pair.other.gender)}`, { name })), right: levelRight(level) }),
    answerFirst,
    el('section', { class: 'section', style: { marginTop: '6px' } },
      el('span', { class: 'label ink' }, t('la_rule', { pick, write })),
      translateNote(pair),
      el('ol', { class: 'qlist', style: { marginTop: '6px' } }, pickRows.map((r) => r.node), writeRows.map((r) => r.node))),
    el('div', { class: 'spacer' }),
    el('div', { class: 'sticky-actions' }, lockNote(t(`la_lock_${level}`)), sendBtn),
  ].filter(Boolean));
  paint();
});

registerStrings({
  en: {
    lv_level_of: 'Level {n}/3',
    lv_hit_phone: 'No phone numbers: “{match}”',
    lv_hit_email: 'No email addresses: “{match}”',
    lv_hit_handle: 'No chat handles: “{match}”',
    lv_hit_app: 'No chat app names: “{match}”',
    lv_hit_link: 'No links: “{match}”',
    lv_hit_contact: 'No contact details: “{match}”',
    lv_too_long: 'Too long. Keep it under {max} characters.',
    lv_stopped: 'Not sent. Contact details are never allowed.',
    lv_moved_on: 'This step has already moved on.',
    lv_closed: 'This conversation is closed.',
    lv_translate: 'We will translate for you',
    lv_check_n: 'Check question {n}.',
    lv_sending: 'Sending…',
    la_title_her: 'Ask her 5 questions',
    la_title_him: 'Ask him 5 questions',
    la_rule: 'Pick {pick} questions · Write {write}',
    la_ph_1: 'Write a yes/no question',
    la_ph_2: 'Write a question',
    la_lock_1: 'No phone numbers or chat handles.',
    la_lock_2: 'Answers come back in words. No phone numbers or chat handles.',
    la_send: 'Send 5 questions',
    la_write_one: 'Write 1 more question',
    la_write_n: 'Write {n} more questions',
    la_sent: 'Sent. Now it is {name}’s turn.',
    la_question_n: 'Question {n}',
    la_in_list: 'In your list',
    la_answer_first: '{name} asked you 5 · answer first',
  },
  km: {
    lv_level_of: 'កម្រិត {n}/3',
    lv_hit_phone: 'មិនអនុញ្ញាតលេខទូរស័ព្ទ៖ “{match}”',
    lv_hit_email: 'មិនអនុញ្ញាតអាសយដ្ឋានអ៊ីមែល៖ “{match}”',
    lv_hit_handle: 'មិនអនុញ្ញាតឈ្មោះគណនីជជែក៖ “{match}”',
    lv_hit_app: 'មិនអនុញ្ញាតឈ្មោះកម្មវិធីជជែក៖ “{match}”',
    lv_hit_link: 'មិនអនុញ្ញាតតំណភ្ជាប់៖ “{match}”',
    lv_hit_contact: 'មិនអនុញ្ញាតព័ត៌មានទំនាក់ទំនង៖ “{match}”',
    lv_too_long: 'វែងពេក។ សូមសរសេរមិនឲ្យលើស {max} តួអក្សរ។',
    lv_stopped: 'មិនបានផ្ញើទេ។ ព័ត៌មានទំនាក់ទំនងមិនត្រូវបានអនុញ្ញាតឡើយ។',
    lv_moved_on: 'ជំហាននេះបានបន្តទៅមុខរួចហើយ។',
    lv_closed: 'ការសន្ទនានេះត្រូវបានបិទ។',
    lv_translate: 'យើងនឹងបកប្រែជូនអ្នក',
    lv_check_n: 'សូមពិនិត្យសំណួរទី {n}។',
    lv_sending: 'កំពុងផ្ញើ…',
    la_title_her: 'សួរនាង 5 សំណួរ',
    la_title_him: 'សួរគាត់ 5 សំណួរ',
    la_rule: 'ជ្រើស {pick} សំណួរ · សរសេរ {write}',
    la_ph_1: 'សរសេរសំណួរដែលឆ្លើយបាន បាទ/ចាស ឬ ទេ',
    la_ph_2: 'សរសេរសំណួរមួយ',
    la_lock_1: 'គ្មានលេខទូរស័ព្ទ ឬឈ្មោះគណនីជជែកទេ។',
    la_lock_2: 'ចម្លើយនឹងត្រឡប់មកវិញជាពាក្យ។ គ្មានលេខទូរស័ព្ទ ឬឈ្មោះគណនីជជែកទេ។',
    la_send: 'ផ្ញើ 5 សំណួរ',
    la_write_one: 'សរសេរសំណួរ 1 ទៀត',
    la_write_n: 'សរសេរសំណួរ {n} ទៀត',
    la_sent: 'បានផ្ញើហើយ។ ឥឡូវដល់វេន {name} ឆ្លើយ។',
    la_question_n: 'សំណួរទី {n}',
    la_in_list: 'មានក្នុងបញ្ជីហើយ',
    la_answer_first: '{name} បានសួរអ្នក 5 សំណួរ · ឆ្លើយមុនសិន',
  },
  zh: {
    lv_level_of: '等级 {n}/3',
    lv_hit_phone: '不能留电话号码：“{match}”',
    lv_hit_email: '不能留邮箱地址：“{match}”',
    lv_hit_handle: '不能留聊天账号：“{match}”',
    lv_hit_app: '不能提聊天软件：“{match}”',
    lv_hit_link: '不能发链接：“{match}”',
    lv_hit_contact: '不能留联系方式：“{match}”',
    lv_too_long: '太长了，请控制在 {max} 个字以内。',
    lv_stopped: '未发送。任何联系方式都不允许分享。',
    lv_moved_on: '这一步已经往下进行了。',
    lv_closed: '此对话已关闭。',
    lv_translate: '我们会为你翻译',
    lv_check_n: '请检查第 {n} 个问题。',
    lv_sending: '发送中…',
    la_title_her: '问她 5 个问题',
    la_title_him: '问他 5 个问题',
    la_rule: '选 {pick} 个问题 · 自己写 {write} 个',
    la_ph_1: '写一个用“是/不是”回答的问题',
    la_ph_2: '写一个问题',
    la_lock_1: '不能留电话号码或聊天账号。',
    la_lock_2: '对方会用文字回答。不能留电话号码或聊天账号。',
    la_send: '发送 5 个问题',
    la_write_one: '还要再写 1 个问题',
    la_write_n: '还要再写 {n} 个问题',
    la_sent: '已发送，现在轮到 {name} 回答。',
    la_question_n: '第 {n} 个问题',
    la_in_list: '已在列表中',
    la_answer_first: '{name} 问了你 5 个问题 · 先回答',
  },
  ko: {
    lv_level_of: '레벨 {n}/3',
    lv_hit_phone: '전화번호는 안 돼요: “{match}”',
    lv_hit_email: '이메일 주소는 안 돼요: “{match}”',
    lv_hit_handle: '채팅 아이디는 안 돼요: “{match}”',
    lv_hit_app: '채팅 앱 이름은 안 돼요: “{match}”',
    lv_hit_link: '링크는 안 돼요: “{match}”',
    lv_hit_contact: '연락처는 안 돼요: “{match}”',
    lv_too_long: '너무 길어요. {max}자 이내로 써 주세요.',
    lv_stopped: '보내지 않았어요. 연락처는 절대 공유할 수 없어요.',
    lv_moved_on: '이 단계는 이미 다음으로 넘어갔어요.',
    lv_closed: '이 대화는 종료되었어요.',
    lv_translate: '번역은 저희가 해 드려요',
    lv_check_n: '{n}번 질문을 확인해 주세요.',
    lv_sending: '보내는 중…',
    la_title_her: '{name}님에게 5가지 질문하기',
    la_title_him: '{name}님에게 5가지 질문하기',
    la_rule: '질문 {pick}개 고르기 · {write}개 직접 쓰기',
    la_ph_1: '예/아니요로 답할 질문을 써 주세요',
    la_ph_2: '질문을 써 주세요',
    la_lock_1: '전화번호나 채팅 아이디는 안 돼요.',
    la_lock_2: '답은 글로 돌아와요. 전화번호나 채팅 아이디는 안 돼요.',
    la_send: '질문 5개 보내기',
    la_write_one: '질문 1개 더 써 주세요',
    la_write_n: '질문 {n}개 더 써 주세요',
    la_sent: '보냈어요. 이제 {name}님이 답할 차례예요.',
    la_question_n: '{n}번 질문',
    la_in_list: '이미 목록에 있어요',
    la_answer_first: '{name}님이 5가지를 물었어요 · 먼저 답하기',
  },
  ja: {
    lv_level_of: 'レベル {n}/3',
    lv_hit_phone: '電話番号は送れません：「{match}」',
    lv_hit_email: 'メールアドレスは送れません：「{match}」',
    lv_hit_handle: 'チャットIDは送れません：「{match}」',
    lv_hit_app: 'チャットアプリ名は送れません：「{match}」',
    lv_hit_link: 'リンクは送れません：「{match}」',
    lv_hit_contact: '連絡先は送れません：「{match}」',
    lv_too_long: '長すぎます。{max}文字以内にしてください。',
    lv_stopped: '送信されませんでした。連絡先の共有は一切できません。',
    lv_moved_on: 'このステップはすでに先に進んでいます。',
    lv_closed: 'この会話は終了しました。',
    lv_translate: '翻訳はおまかせください',
    lv_check_n: '質問{n}を確認してください。',
    lv_sending: '送信中…',
    la_title_her: '{name}さんに5つ質問する',
    la_title_him: '{name}さんに5つ質問する',
    la_rule: '{pick}つ選ぶ · {write}つ書く',
    la_ph_1: 'はい/いいえで答えられる質問を書く',
    la_ph_2: '質問を書く',
    la_lock_1: '電話番号やチャットIDは書けません。',
    la_lock_2: '答えは言葉で返ってきます。電話番号やチャットIDは書けません。',
    la_send: '5つの質問を送る',
    la_write_one: 'あと1つ質問を書いてください',
    la_write_n: 'あと{n}つ質問を書いてください',
    la_sent: '送信しました。次は{name}さんが答える番です。',
    la_question_n: '質問{n}',
    la_in_list: 'リストに追加済み',
    la_answer_first: '{name}さんから5つの質問 · 先に答える',
  },
});
