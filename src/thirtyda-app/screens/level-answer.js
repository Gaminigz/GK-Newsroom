// Screens 6 + 9 · Level 1 / Level 2 · Reply to all — the 5 lines the other person sent, shown in
// my language (written ones with their original under the translation). Level 1: one tap per
// line on Yes / No / OK / Not really / Maybe, and the replies send by themselves after the 5th.
// Level 2: replies in words with the live contact-detail check.
import {
  screen, el, icon, t, go, api, toast, topBar, levelBar, heartbeat, pairRoute, stageLevel, errorText, registerStrings,
  l1Answers, answerText, checkWrittenAnswer,
} from '../core.js';
import {
  ANSWER_MAX, enc, personPath, myLang, levelParam, ruleMessage, showError, headTitle, translateNote, lockNote, moveOn,
  redirected, paintSendButton,
} from './level-ask.js';

const AUTO_SEND_MS = 650; // a beat to see the 5th chip turn navy (and change it) before it goes
const drafts = new Map(); // `${pairId}:${level}` → { [n]: answer key (L1) | text (L2) }

const canAnswer = (pair, level) => stageLevel(pair) === level
  && (pair.next === 'answer' || (pair.next === 'ask_answer' && pair.myIncoming?.received && !pair.myIncoming?.answered));

/** "1 · SYSTEM" / "5 · BY DARA", the question in my language, and the writer's original when it differs. */
function questionHead(q, name) {
  const written = q.source === 'written';
  const theirLang = q.originalLang || null;
  const untranslated = written && !q.translated && theirLang && theirLang !== myLang();
  return [
    el('span', { class: 'label ink' }, written ? t('lan_by', { n: q.n, name }) : t('lan_system', { n: q.n })),
    el('p', { class: 'qtext', id: `lan-q-${q.n}`, lang: untranslated ? theirLang : null }, q.text),
    written && q.translated && q.original && q.original !== q.text
      ? el('p', { class: 'qorig', lang: theirLang }, q.original)
      : null,
    untranslated ? el('p', { class: 'qorig' }, t('lan_no_translation')) : null,
  ];
}

screen('/answer/:pairId/:level', async ({ params, root }) => {
  const level = levelParam(params.level);
  if (!level) {
    go('/nearby', { replace: true });
    return;
  }
  root.classList.add('level', 'level-answer');
  root.append(topBar({ left: 'close' }), el('p', { class: 'loading' }, t('core_loading')));

  const { pair } = await api.get(`/pairs/${enc(params.pairId)}`);
  if (!root.isConnected) return;
  if (!canAnswer(pair, level)) {
    go(pairRoute(pair), { replace: true });
    return;
  }
  const { set } = await api.get(`/pairs/${enc(pair.id)}/incoming?level=${level}`);
  if (!root.isConnected) return;
  if (set.answered) {
    // pairRoute() would point straight back here (next is still 'answer'), so go to the profile.
    go(personPath(pair), { replace: true });
    return;
  }

  const name = set.from?.name || pair.other.name;
  const questions = [...set.questions].sort((a, b) => a.n - b.n);
  const total = questions.length;
  const draftKey = `${pair.id}:${level}`;
  const draft = drafts.get(draftKey) || {};
  drafts.set(draftKey, draft);
  let busy = false;
  let autoTimer = null;

  const sub = el('span', {});
  const paintSub = (done) => { sub.textContent = t('lan_sub', { n: level, done, total }); };
  const close = () => go(personPath(pair));

  // Hand-off after a successful send: L1 → wait for Level 2; L2 → wait for Level 3, my own
  // questions if I have not asked yet, or the profile while the other person still answers.
  function done(r) {
    drafts.delete(draftKey);
    heartbeat();
    toast(t('lan_sent', { name }));
    if (!root.isConnected) return;
    const next = level === 1 && r.pair.next === 'wait_timer' ? `/wait/${enc(pair.id)}/2` : pairRoute(r.pair);
    go(next, { replace: true });
  }

  function failed(err) {
    if (!root.isConnected || redirected(err)) return true;
    if (err.status === 409 || err.status === 404) {
      moveOn(err, pair.id, personPath(pair));
      return true;
    }
    return false;
  }

  const head = topBar({ left: 'close', onLeft: close, title: headTitle(pair, t('lan_title', { name })), sub, right: levelBar(level) });
  const list = el('ol', { class: 'stack', style: { '--gap': '26px', marginTop: '8px' } });
  const actions = el('div', { class: 'sticky-actions' });

  // ------------------------------------------------ Level 1: one tap each, auto-send after the 5th
  if (level === 1) {
    const status = el('p', { class: 'help center', 'aria-live': 'polite' });
    const retry = el('button', { type: 'button', class: 'btn btn-secondary', hidden: true, on: { click: () => sendL1() } }, t('core_retry'));
    const groups = [];
    const blocks = questions.map((q) => {
      // Questions 1–4: Yes / No / OK / Not really / Maybe; the asker's own question 5: Yes / No only.
      const chips = l1Answers(q.source).map((a) => el('button', {
        type: 'button', class: 'chip', dataset: { key: a.key }, on: { click: () => choose(q.n, a.key) },
      }, answerText(a.key, myLang()) || a.text.en));
      const group = el('div', { class: 'chips', role: 'group', 'aria-labelledby': `lan-q-${q.n}` }, chips);
      groups.push({ n: q.n, chips });
      return el('li', { class: 'stack', style: { '--gap': '8px' } }, ...questionHead(q, name), group);
    });
    const answered = () => questions.filter((q) => draft[q.n]).length;

    function paint() {
      for (const g of groups) {
        for (const c of g.chips) {
          c.setAttribute('aria-pressed', String(draft[g.n] === c.dataset.key));
          c.disabled = busy;
        }
      }
      paintSub(answered());
    }

    function choose(n, key) {
      if (busy) return;
      draft[n] = key;
      retry.hidden = true;
      paint();
      clearTimeout(autoTimer);
      if (answered() === total) {
        status.textContent = t('lv_sending');
        autoTimer = setTimeout(sendL1, AUTO_SEND_MS);
        return;
      }
      status.textContent = t('lan_hint_1');
      showNext(questions.findIndex((q) => q.n === n));
    }

    // Bring the next unanswered question into view when it is off screen (or under the bottom bar).
    function showNext(from) {
      let next = questions.findIndex((q, i) => i > from && !draft[q.n]);
      if (next < 0) next = questions.findIndex((q) => !draft[q.n]);
      const target = blocks[next];
      if (!target) return;
      const box = target.getBoundingClientRect();
      if (box.top >= 60 && box.bottom <= window.innerHeight - 110) return;
      const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' });
    }

    async function sendL1() {
      clearTimeout(autoTimer);
      if (busy || answered() !== total) return;
      busy = true;
      retry.hidden = true;
      status.textContent = t('lv_sending');
      paint();
      try {
        done(await api.post(`/pairs/${enc(pair.id)}/answers`, { level: 1, answers: questions.map((q) => ({ n: q.n, key: draft[q.n] })) }));
      } catch (err) {
        busy = false;
        if (failed(err)) return;
        status.textContent = `${t('lan_failed')} ${errorText(err)}`;
        retry.hidden = false;
        paint();
      }
    }

    list.append(...blocks);
    actions.append(status, retry);
    root.replaceChildren(...[head, translateNote(pair), list, el('div', { class: 'spacer' }), actions].filter(Boolean));
    paint();
    // Back on a draft with all 5 tapped (left before it went out): it sends, as after the 5th tap.
    if (answered() === total) {
      status.textContent = t('lv_sending');
      autoTimer = setTimeout(sendL1, AUTO_SEND_MS);
    } else {
      status.textContent = t('lan_hint_1');
    }
    return () => clearTimeout(autoTimer);
  }

  // ------------------------------------------------ Level 2: answers in words
  const serverErr = {}; // n → message from a server 422, until that box is edited
  let stoppedSig = null;
  const sendBtn = el('button', { type: 'button', class: 'btn btn-primary' });
  const rows = questions.map((q) => {
    const err = el('p', { class: 'field-error', id: `lan-err-${q.n}`, 'aria-live': 'polite', hidden: true });
    const box = el('textarea', {
      class: 'textarea', rows: 2, placeholder: t('lan_ph'), value: draft[q.n] || '', autocapitalize: 'sentences',
      'aria-labelledby': `lan-q-${q.n}`, 'aria-describedby': err.id,
    });
    box.addEventListener('input', () => {
      draft[q.n] = box.value;
      delete serverErr[q.n];
      paint();
    });
    return { q, box, err, node: el('li', { class: 'stack', style: { '--gap': '8px' } }, ...questionHead(q, name), box, err) };
  });

  function paint() {
    const results = rows.map((r) => checkWrittenAnswer((draft[r.q.n] || '').trim()));
    rows.forEach((r, i) => {
      const msg = serverErr[r.q.n] || ruleMessage(results[i], ANSWER_MAX);
      r.box.classList.toggle('is-error', Boolean(msg));
      r.box.setAttribute('aria-invalid', String(Boolean(msg)));
      r.box.readOnly = busy;
      showError(r.err, msg);
    });
    const ok = results.filter((r) => r.ok).length;
    const missing = total - ok;
    paintSub(ok);
    const label = !missing ? t('lan_send') : missing === 1 ? t('lan_more_one') : t('lan_more_n', { n: missing });
    paintSendButton(sendBtn, { ready: !missing, busy, label });
    return { results, missing };
  }

  sendBtn.addEventListener('click', () => {
    if (busy) return;
    const { results, missing } = paint();
    if (!missing) return sendL2(false);
    if (results.some((r) => r.error === 'contact')) return sendL2(true);
    rows[results.findIndex((r) => !r.ok)]?.box.focus();
  });

  async function sendL2(attempt) {
    const body = { level: 2, answers: rows.map((r) => ({ n: r.q.n, text: (draft[r.q.n] || '').trim() })) };
    const sig = JSON.stringify(body);
    if (attempt && sig === stoppedSig) {
      toast(t('lv_stopped'));
      return;
    }
    busy = true;
    paint();
    try {
      done(await api.post(`/pairs/${enc(pair.id)}/answers`, body));
    } catch (err) {
      busy = false;
      if (failed(err)) return;
      const row = rows[Number(err.data?.index)];
      if (err.code === 'contact_detail') {
        stoppedSig = sig;
        if (row) serverErr[row.q.n] = ruleMessage({ error: 'contact', hits: err.data?.hits }, ANSWER_MAX);
        toast(t('lv_stopped'));
      } else if (err.code === 'invalid' && row) {
        serverErr[row.q.n] = err.data?.reason === 'too_long' ? t('lv_too_long', { max: ANSWER_MAX }) : t('lan_check');
      } else {
        toast(errorText(err));
      }
      paint();
      row?.box.focus();
    }
  }

  list.append(...rows.map((r) => r.node));
  actions.append(lockNote(t('lan_lock')), sendBtn);
  root.replaceChildren(...[head, translateNote(pair), list, el('div', { class: 'spacer' }), actions].filter(Boolean));
  paint();
});

registerStrings({
  en: {
    lan_title: '{name} started a conversation',
    lan_sub: 'Level {n}/3 · {done}/{total} replied',
    lan_system: '{n} · System',
    lan_by: '{n} · By {name}',
    lan_no_translation: 'Translation not available yet.',
    lan_hint_1: 'One tap for each line. Your replies send by themselves after the 5th.',
    lan_ph: 'Reply in your own words',
    lan_lock: 'No phone numbers or chat handles.',
    lan_more_one: '1 more reply to go',
    lan_more_n: '{n} more replies to go',
    lan_send: 'Send 5 replies',
    lan_sent: 'Your replies are on their way to {name}.',
    lan_failed: 'Your replies were not sent.',
    lan_check: 'Check this reply.',
  },
  km: {
    lan_title: '{name} បានចាប់ផ្ដើមការសន្ទនា',
    lan_sub: 'កម្រិត {n}/3 · បានឆ្លើយតប {done}/{total}',
    lan_system: '{n} · ប្រព័ន្ធ',
    lan_by: '{n} · ដោយ {name}',
    lan_no_translation: 'មិនទាន់មានការបកប្រែនៅឡើយទេ។',
    lan_hint_1: 'ចុចម្ដងសម្រាប់ឃ្លានីមួយៗ។ ការឆ្លើយតបរបស់អ្នកនឹងផ្ញើដោយស្វ័យប្រវត្តិ បន្ទាប់ពីឃ្លាទី 5។',
    lan_ph: 'ឆ្លើយតបតាមពាក្យរបស់អ្នកផ្ទាល់',
    lan_lock: 'គ្មានលេខទូរស័ព្ទ ឬឈ្មោះគណនីជជែកទេ។',
    lan_more_one: 'នៅសល់ការឆ្លើយតប 1 ទៀត',
    lan_more_n: 'នៅសល់ការឆ្លើយតប {n} ទៀត',
    lan_send: 'ផ្ញើការឆ្លើយតបទាំង 5',
    lan_sent: 'ការឆ្លើយតបរបស់អ្នកកំពុងផ្ញើទៅ {name}។',
    lan_failed: 'ការឆ្លើយតបរបស់អ្នកមិនទាន់បានផ្ញើទេ។',
    lan_check: 'សូមពិនិត្យការឆ្លើយតបនេះ។',
  },
  zh: {
    lan_title: '{name} 开始了对话',
    lan_sub: '等级 {n}/3 · 已回复 {done}/{total}',
    lan_system: '{n} · 系统',
    lan_by: '{n} · 来自 {name}',
    lan_no_translation: '暂时还没有翻译。',
    lan_hint_1: '每句点一下即可。回复完第 5 句后会自动发送。',
    lan_ph: '用你自己的话回复',
    lan_lock: '不能留电话号码或聊天账号。',
    lan_more_one: '还差 1 条回复',
    lan_more_n: '还差 {n} 条回复',
    lan_send: '发送 5 条回复',
    lan_sent: '你的回复已发给 {name}。',
    lan_failed: '你的回复没有发送成功。',
    lan_check: '请检查这条回复。',
  },
  ko: {
    lan_title: '{name}님이 대화를 시작했어요',
    lan_sub: '레벨 {n}/3 · {done}/{total} 답장함',
    lan_system: '{n} · 기본',
    lan_by: '{n} · {name}님이 쓴 말',
    lan_no_translation: '아직 번역이 없어요.',
    lan_hint_1: '한마디마다 한 번만 누르세요. 5번째까지 누르면 답장이 자동으로 보내져요.',
    lan_ph: '내 말로 답장해 주세요',
    lan_lock: '전화번호나 채팅 아이디는 안 돼요.',
    lan_more_one: '답장 1개 남았어요',
    lan_more_n: '답장 {n}개 남았어요',
    lan_send: '답장 5개 보내기',
    lan_sent: '{name}님에게 답장을 보냈어요.',
    lan_failed: '답장을 보내지 못했어요.',
    lan_check: '이 답장을 확인해 주세요.',
  },
  ja: {
    lan_title: '{name}さんが会話を始めました',
    lan_sub: 'レベル {n}/3 · {done}/{total} 返信済み',
    lan_system: '{n} · システム',
    lan_by: '{n} · {name}さんより',
    lan_no_translation: '翻訳はまだありません。',
    lan_hint_1: 'ひとことごとに1回タップ。5つ目をタップすると返信が自動で送信されます。',
    lan_ph: '自分の言葉で返信する',
    lan_lock: '電話番号やチャットIDは書けません。',
    lan_more_one: 'あと1つ返信してください',
    lan_more_n: 'あと{n}つ返信してください',
    lan_send: '5つの返信を送る',
    lan_sent: '{name}さんに返信を送りました。',
    lan_failed: '返信を送信できませんでした。',
    lan_check: 'この返信を確認してください。',
  },
});
