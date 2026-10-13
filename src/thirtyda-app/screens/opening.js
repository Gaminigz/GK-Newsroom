// Screen 1 · Opening — headline, the 30+DA wordmark rising in letter by letter, the white rule
// filling left → right, and the five language buttons. Picking a language goes to Set your PIN (#/pin),
// then the home screen as a guest (Create profile when they want to do something).
import { screen, el, icon, t, go, state, setLang, registerStrings, LANGS, LANG_NATIVE, LANG_FLAG } from '../core.js';
import { legalLinks, takeDeletedNote } from './delete-account.js';

screen('/opening', ({ root }) => {
  root.classList.add('dark', 'opening');
  // Just after "Delete my account": said once, at the top.
  const deleted = takeDeletedNote()
    ? el('p', { class: 'deleted-note', role: 'status' }, icon('check', 18), el('span', {}, t('da_done')))
    : null;

  const letters = [...'30+DA'].map((ch, i) => el('span', { class: 'rise', 'aria-hidden': 'true', style: { '--i': i } }, ch));
  const pick = (code) => {
    setLang(code, { rerender: false });
    go('/pin');
  };

  root.append(
    el('div', { class: 'opening-top' },
      deleted,
      el('h1', { class: 'opening-headline' }, t('op_headline')),
      el('div', { class: 'opening-mark wordmark', role: 'img', 'aria-label': '30+DA' }, letters),
      el('div', { class: 'opening-rule', 'aria-hidden': 'true' }, el('span')),
      el('p', { class: 'opening-tagline' }, t('op_tagline'))),
    el('div', { class: 'opening-langs' },
      el('p', { class: 'label', id: 'op-lang-label' }, t('op_language')),
      el('div', { class: 'lang-grid', role: 'group', 'aria-labelledby': 'op-lang-label' },
        LANGS.map((code) => el('button', {
          type: 'button',
          class: 'btn btn-ghost-light',
          lang: code,
          'aria-pressed': String(code === state.lang),
          on: { click: () => pick(code) },
        }, el('span', { class: 'lang-label' }, el('span', { class: 'flag', 'aria-hidden': 'true' }, LANG_FLAG[code]), LANG_NATIVE[code])))),
      // "Pick your language, get started — it translates by itself.": two halves, each kept whole (Khmer never breaks mid-word).
      el('p', { class: 'opening-foot' },
        el('span', { class: 'op-part' }, icon('translate', 19), t('op_pick')), state.lang === 'zh' || state.lang === 'ja' ? '\u200b' : ' ',
        el('span', { class: 'op-part' }, t('op_translate'))),
      // Privacy policy · Terms, before anyone signs in (Google Play / Apple).
      legalLinks()),
  );
});

registerStrings({
  en: {
    op_headline: 'Don’t make the same mistake again.',
    op_tagline: 'Safe and calm dating for 30+',
    op_language: 'Language · ភាសា · 语言 · 언어 · 言語',
    op_pick: 'Pick your language, get started —',
    op_translate: 'it translates by itself.',
  },
  km: {
    op_headline: 'កុំធ្វើខុសដដែលម្ដងទៀត។',
    op_tagline: 'ការណាត់ជួបប្រកបដោយសុវត្ថិភាព និងភាពស្ងប់ស្ងាត់ សម្រាប់វ័យ 30+',
    op_language: 'ភាសា · Language · 语言 · 언어 · 言語',
    op_pick: 'ជ្រើសរើសភាសា ហើយចាប់ផ្ដើម —',
    op_translate: 'វាបកប្រែដោយខ្លួនឯង។',
  },
  zh: {
    op_headline: '别再犯同样的错误。',
    op_tagline: '30+ 的安全、从容交友',
    op_language: '语言 · Language · ភាសា · 언어 · 言語',
    op_pick: '选择语言，马上开始——',
    op_translate: '它会自动翻译。',
  },
  ko: {
    op_headline: '같은 실수를 반복하지 마세요.',
    op_tagline: '30+를 위한 안전하고 차분한 만남',
    op_language: '언어 · Language · ភាសា · 语言 · 言語',
    op_pick: '언어를 고르고 시작하세요 —',
    op_translate: '자동으로 번역돼요.',
  },
  ja: {
    op_headline: '同じ過ちを、もう繰り返さない。',
    op_tagline: '30+のための、安心で穏やかな出会い',
    op_language: '言語 · Language · ភាសា · 语言 · 언어',
    op_pick: '言語を選んで、始めましょう。',
    op_translate: '自動で翻訳されます。',
  },
});
