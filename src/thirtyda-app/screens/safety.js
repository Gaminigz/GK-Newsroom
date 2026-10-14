// Block + report (store policy, owner 2026-10-14; the rules in shared/safety.js, the server in src/lib/thirtyda-blocks.mjs).
// What the profile, the photo viewer and the conversation share: the ⋯ menu of a top bar (Report / Block), the report
// sheet (the chat's: why? → one tap, then "Reported. Thank you."), "Block Sophea?" and the "Blocked people" list on Me
// (Unblock). A block works both ways and the other person is never told; only the one who blocked can lift it.
import {
  el, icon, t, api, toast, modal, errorText, registerStrings, PERSON_REPORT_REASONS, reportTarget,
} from '../core.js';

const enc = encodeURIComponent;
// The session ended, the account was blocked or the app locked: core already moved on (or the PIN covers the app).
const movedOn = (err) => err?.status === 401 || err?.status === 423 || err?.code === 'blocked';

/**
 * The report sheet: title, what is reported (a quote, optional), the reasons, Cancel (focused, so a stray Enter never
 * files a report). submit(reason) → Promise<{ already? }>. Returns the modal handle.
 */
export function reportSheet({ title, quote = null, reasons = PERSON_REPORT_REASONS, submit }) {
  const fail = el('p', { class: 'field-error', role: 'alert', hidden: true });
  const items = reasons.map((reason) => el('button', {
    type: 'button', class: 'menu-item', dataset: { reason }, on: { click: () => send(reason) },
  }, el('span', {}, t(`sf_reason_${reason}`)), icon('flag', 16)));
  const dlg = modal(el('div', { class: 'sheet-body report-sheet' },
    el('h2', { class: 'sheet-title' }, title),
    quote,
    el('p', { class: 'label' }, t('sf_report_why')),
    el('div', { class: 'menu' }, items),
    fail,
    el('button', { type: 'button', class: 'btn btn-secondary', autofocus: true, on: { click: () => dlg.close() } }, t('sf_cancel'))),
  { sheet: true, label: title });

  async function send(reason) {
    items.forEach((b) => { b.disabled = true; });
    fail.hidden = true;
    try {
      const r = await submit(reason);
      dlg.close();
      toast(r?.already ? t('sf_already') : t('sf_reported'));
    } catch (err) {
      if (movedOn(err)) { dlg.close(); return; }
      items.forEach((b) => { b.disabled = false; });
      fail.textContent = errorText(err);
      fail.hidden = false;
    }
  }
  return dlg;
}

/** Report a person: their profile (default), one photo (reportTarget.photo(n)) or one written line (reportTarget.line). */
export function reportPerson(person, target = reportTarget.profile(), { quote = null } = {}) {
  const kind = target.startsWith('photo:') ? 'photo' : target.startsWith('line:') ? 'line' : 'profile';
  return reportSheet({
    title: t(`sf_report_${kind}`, { name: person?.name || '' }),
    quote,
    submit: (reason) => api.post(`/people/${enc(person.id)}/report`, { reason, target }),
  });
}

/** "Block Sophea?" — what happens, then Block / Cancel. onBlocked(r) once the server said yes. */
export function confirmBlock(person, { onBlocked = null } = {}) {
  const name = person?.name || '';
  const fail = el('p', { class: 'field-error', role: 'alert', hidden: true });
  const yes = el('button', { type: 'button', class: 'btn btn-danger', dataset: { act: 'block' } }, icon('block', 18), el('span', {}, t('sf_block_yes')));
  const dlg = modal(el('div', { class: 'dialog-body' },
    el('span', { class: 'dialog-icon', 'aria-hidden': 'true' }, icon('block', 22)),
    el('h2', { class: 'dialog-title' }, t('sf_block_title', { name })),
    el('p', {}, t('sf_block_text', { name })),
    fail,
    el('div', { class: 'dialog-actions' },
      yes,
      el('button', { type: 'button', class: 'btn btn-secondary', autofocus: true, on: { click: () => dlg.close() } }, t('sf_cancel')))),
  { label: t('sf_block_title', { name }) });
  yes.addEventListener('click', async () => {
    yes.disabled = true;
    fail.hidden = true;
    try {
      const r = await api.post(`/people/${enc(person.id)}/block`, {});
      dlg.close();
      toast(t('sf_blocked', { name }));
      onBlocked?.(r);
    } catch (err) {
      if (movedOn(err)) { dlg.close(); return; }
      yes.disabled = false;
      fail.textContent = errorText(err);
      fail.hidden = false;
    }
  });
  return dlg;
}

/** The ⋯ sheet: Report <name> · Block <name> · Cancel. */
export function openPersonMenu(person, { onBlocked = null } = {}) {
  const name = person?.name || '';
  const item = (label, iconName, onClick, danger = false) => el('button', {
    type: 'button', class: ['menu-item', danger && 'danger'], on: { click: () => { dlg.close(); onClick(); } },
  }, el('span', {}, label), icon(iconName, 16));
  const dlg = modal(el('div', { class: 'sheet-body' },
    el('h2', { class: 'sheet-title' }, name),
    el('div', { class: 'menu' },
      item(t('sf_report_profile', { name }), 'flag', () => reportPerson(person)),
      item(t('sf_block_item', { name }), 'block', () => confirmBlock(person, { onBlocked }), true)),
    el('button', { type: 'button', class: 'btn btn-secondary', autofocus: true, on: { click: () => dlg.close() } }, t('sf_cancel'))),
  { sheet: true, label: t('sf_menu', { name }) });
  return dlg;
}

/** The ⋯ button for a top bar (profile, conversation). */
export function personMenuButton(person, { onBlocked = null } = {}) {
  return el('button', {
    type: 'button', class: 'icon-btn person-menu', 'aria-label': t('sf_menu', { name: person?.name || '' }), 'aria-haspopup': 'dialog',
    on: { click: () => openPersonMenu(person, { onBlocked }) },
  }, icon('more', 18));
}

/**
 * "Report photo" under a photo in a viewer. current() → the shown photo's place (1-based) among the photos I can see of
 * them (GET /people's order); the viewer closes first.
 */
export function reportPhotoButton(person, current, viewer) {
  return el('button', {
    type: 'button', class: 'link report-photo', on: {
      click: () => {
        const n = current();
        viewer?.close();
        if (n >= 1) reportPerson(person, reportTarget.photo(n));
      },
    },
  }, icon('flag', 14), el('span', {}, t('sf_report_photo_btn')));
}

/** Me · "Blocked people": everyone I blocked, each with Unblock (GET /me/blocks, DELETE /people/:id/block). */
export function blockedPeopleSection() {
  const list = el('ul', { class: 'blocked-list', 'aria-live': 'polite' });
  const none = el('p', { class: 'help', hidden: true }, t('sf_blocked_none'));
  const section = el('section', { class: 'section blocked-people' },
    el('span', { class: 'label ink' }, t('sf_blocked_title')), list, none);
  const paint = (rows) => {
    list.replaceChildren(...rows.map(row));
    none.hidden = rows.length > 0;
  };
  function row(p) {
    const b = el('button', {
      type: 'button', class: 'btn btn-secondary btn-sm btn-auto', 'aria-label': t('sf_unblock_aria', { name: p.name }), dataset: { unblock: p.id },
    }, t('sf_unblock'));
    const li = el('li', { class: 'blocked-row' }, el('span', { class: 'blocked-name' }, icon('block', 16), el('span', {}, p.name)), b);
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await api.del(`/people/${enc(p.id)}/block`);
        li.remove();
        none.hidden = list.children.length > 0;
        toast(t('sf_unblocked', { name: p.name }));
      } catch (err) {
        b.disabled = false;
        if (!movedOn(err)) toast(errorText(err));
      }
    });
    return li;
  }
  api.get('/me/blocks').then((r) => paint(Array.isArray(r?.blocks) ? r.blocks : []), (err) => {
    if (!movedOn(err)) { none.textContent = errorText(err); none.hidden = false; }
  });
  return section;
}

registerStrings({
  en: {
    sf_menu: 'More for {name}',
    sf_report_profile: 'Report {name}',
    sf_report_photo: 'Report this photo',
    sf_report_line: 'Report this line',
    sf_report_photo_btn: 'Report photo',
    sf_report_why: 'Why are you reporting it?',
    sf_reason_rude: 'Rude',
    sf_reason_sexual: 'Sexual or nudity',
    sf_reason_scam: 'Scam or money',
    sf_reason_underage: 'Underage',
    sf_reason_fake: 'Fake profile',
    sf_reason_other: 'Other',
    sf_reported: 'Reported. Thank you.',
    sf_already: 'You already reported this.',
    sf_cancel: 'Cancel',
    sf_block_item: 'Block {name}',
    sf_block_title: 'Block {name}?',
    sf_block_text: 'You will not see each other any more and your conversation stops. {name} is not told. You can unblock on My profile.',
    sf_block_yes: 'Block',
    sf_blocked: '{name} is blocked.',
    sf_blocked_title: 'Blocked people',
    sf_blocked_none: 'You have not blocked anyone.',
    sf_unblock: 'Unblock',
    sf_unblock_aria: 'Unblock {name}',
    sf_unblocked: '{name} is unblocked.',
  },
  km: {
    sf_menu: 'ជម្រើសបន្ថែមសម្រាប់ {name}',
    sf_report_profile: 'រាយការណ៍ {name}',
    sf_report_photo: 'រាយការណ៍រូបថតនេះ',
    sf_report_line: 'រាយការណ៍ឃ្លានេះ',
    sf_report_photo_btn: 'រាយការណ៍រូបថត',
    sf_report_why: 'ហេតុអ្វីបានជាអ្នករាយការណ៍?',
    sf_reason_rude: 'មិនគួរសម',
    sf_reason_sexual: 'ផ្លូវភេទ ឬអាក្រាត',
    sf_reason_scam: 'ការបោកប្រាស់ ឬរឿងលុយកាក់',
    sf_reason_underage: 'អាយុមិនទាន់គ្រប់',
    sf_reason_fake: 'ប្រវត្តិរូបក្លែងក្លាយ',
    sf_reason_other: 'ផ្សេងៗ',
    sf_reported: 'បានរាយការណ៍ហើយ។ សូមអរគុណ។',
    sf_already: 'អ្នកបានរាយការណ៍រួចហើយ។',
    sf_cancel: 'បោះបង់',
    sf_block_item: 'ទប់ស្កាត់ {name}',
    sf_block_title: 'ទប់ស្កាត់ {name}?',
    sf_block_text: 'អ្នកទាំងពីរនឹងលែងឃើញគ្នា ហើយការសន្ទនានឹងឈប់។ {name} មិនដឹងទេ។ អ្នកអាចឈប់ទប់ស្កាត់វិញនៅ ប្រវត្តិរូបរបស់ខ្ញុំ។',
    sf_block_yes: 'ទប់ស្កាត់',
    sf_blocked: 'បានទប់ស្កាត់ {name} ហើយ។',
    sf_blocked_title: 'មនុស្សដែលបានទប់ស្កាត់',
    sf_blocked_none: 'អ្នកមិនទាន់ទប់ស្កាត់នរណាម្នាក់ទេ។',
    sf_unblock: 'ឈប់ទប់ស្កាត់',
    sf_unblock_aria: 'ឈប់ទប់ស្កាត់ {name}',
    sf_unblocked: 'បានឈប់ទប់ស្កាត់ {name} ហើយ។',
  },
  zh: {
    sf_menu: '{name} 的更多选项',
    sf_report_profile: '举报 {name}',
    sf_report_photo: '举报这张照片',
    sf_report_line: '举报这句话',
    sf_report_photo_btn: '举报照片',
    sf_report_why: '举报原因是什么？',
    sf_reason_rude: '粗鲁无礼',
    sf_reason_sexual: '色情或裸露',
    sf_reason_scam: '诈骗或要钱',
    sf_reason_underage: '未成年',
    sf_reason_fake: '虚假资料',
    sf_reason_other: '其他',
    sf_reported: '已举报，谢谢你。',
    sf_already: '你已经举报过了。',
    sf_cancel: '取消',
    sf_block_item: '屏蔽 {name}',
    sf_block_title: '屏蔽 {name}？',
    sf_block_text: '你们将互相看不到对方，对话也会停止。{name} 不会收到通知。你可以在“我的资料”里取消屏蔽。',
    sf_block_yes: '屏蔽',
    sf_blocked: '已屏蔽 {name}。',
    sf_blocked_title: '已屏蔽的人',
    sf_blocked_none: '你还没有屏蔽任何人。',
    sf_unblock: '取消屏蔽',
    sf_unblock_aria: '取消屏蔽 {name}',
    sf_unblocked: '已取消屏蔽 {name}。',
  },
  ko: {
    sf_menu: '{name}님 더 보기',
    sf_report_profile: '{name}님 신고',
    sf_report_photo: '이 사진 신고',
    sf_report_line: '이 문장 신고',
    sf_report_photo_btn: '사진 신고',
    sf_report_why: '신고하는 이유를 골라 주세요.',
    sf_reason_rude: '무례함',
    sf_reason_sexual: '성적인 내용 또는 노출',
    sf_reason_scam: '사기 또는 돈 요구',
    sf_reason_underage: '미성년자',
    sf_reason_fake: '가짜 프로필',
    sf_reason_other: '기타',
    sf_reported: '신고했어요. 감사합니다.',
    sf_already: '이미 신고했어요.',
    sf_cancel: '취소',
    sf_block_item: '{name}님 차단',
    sf_block_title: '{name}님을 차단할까요?',
    sf_block_text: '서로 더 이상 볼 수 없고 대화도 멈춰요. {name}님에게는 알리지 않아요. 내 프로필에서 차단을 풀 수 있어요.',
    sf_block_yes: '차단',
    sf_blocked: '{name}님을 차단했어요.',
    sf_blocked_title: '차단한 사람',
    sf_blocked_none: '차단한 사람이 없어요.',
    sf_unblock: '차단 해제',
    sf_unblock_aria: '{name}님 차단 해제',
    sf_unblocked: '{name}님 차단을 풀었어요.',
  },
  ja: {
    sf_menu: '{name}さんのその他',
    sf_report_profile: '{name}さんを報告',
    sf_report_photo: 'この写真を報告',
    sf_report_line: 'この文を報告',
    sf_report_photo_btn: '写真を報告',
    sf_report_why: '報告する理由を選んでください。',
    sf_reason_rude: '失礼な内容',
    sf_reason_sexual: '性的な内容・裸',
    sf_reason_scam: '詐欺・お金の要求',
    sf_reason_underage: '未成年',
    sf_reason_fake: '偽のプロフィール',
    sf_reason_other: 'その他',
    sf_reported: '報告しました。ありがとうございます。',
    sf_already: 'すでに報告済みです。',
    sf_cancel: 'キャンセル',
    sf_block_item: '{name}さんをブロック',
    sf_block_title: '{name}さんをブロックしますか？',
    sf_block_text: 'お互いに見えなくなり、会話も止まります。{name}さんには知らされません。ブロックはマイプロフィールで解除できます。',
    sf_block_yes: 'ブロック',
    sf_blocked: '{name}さんをブロックしました。',
    sf_blocked_title: 'ブロックした人',
    sf_blocked_none: 'ブロックした人はいません。',
    sf_unblock: 'ブロック解除',
    sf_unblock_aria: '{name}さんのブロックを解除',
    sf_unblocked: '{name}さんのブロックを解除しました。',
  },
});
