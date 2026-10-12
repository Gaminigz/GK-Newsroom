// Screen 1 · Opening — headline, the 30+DA wordmark rising in letter by letter, the white rule
// filling left → right, and the five language buttons. Picking a language goes to Create profile.
import { screen, el, icon, t, go, state, setLang, registerStrings, LANGS, LANG_NATIVE } from '../core.js';

screen('/opening', ({ root }) => {
  root.classList.add('dark', 'opening');

  const letters = [...'30+DA'].map((ch, i) => el('span', { class: 'rise', 'aria-hidden': 'true', style: { '--i': i } }, ch));
  const pick = (code) => {
    setLang(code, { rerender: false });
    go('/create');
  };

  root.append(
    el('div', { class: 'opening-top' },
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
        }, LANG_NATIVE[code]))),
      el('p', { class: 'opening-foot' }, icon('translate', 19), t('op_translate'))),
  );
});

registerStrings({
  en: {
    op_headline: 'Don’t make the same mistake again.',
    op_tagline: 'Safe and calm dating for 30+',
    op_language: 'Language · ភាសា · 语言 · 언어 · 言語',
    op_translate: 'We will translate for you',
  },
  km: {
    op_headline: 'កុំធ្វើខុសដដែលម្ដងទៀត។',
    op_tagline: 'ការណាត់ជួបប្រកបដោយសុវត្ថិភាព និងភាពស្ងប់ស្ងាត់ សម្រាប់វ័យ 30+',
    op_language: 'ភាសា · Language · 语言 · 언어 · 言語',
    op_translate: 'យើងនឹងបកប្រែឲ្យអ្នក',
  },
  zh: {
    op_headline: '别再犯同样的错误。',
    op_tagline: '30+ 的安全、从容交友',
    op_language: '语言 · Language · ភាសា · 언어 · 言語',
    op_translate: '我们会为你翻译',
  },
  ko: {
    op_headline: '같은 실수를 반복하지 마세요.',
    op_tagline: '30+를 위한 안전하고 차분한 만남',
    op_language: '언어 · Language · ភាសា · 语言 · 言語',
    op_translate: '번역은 저희가 해 드려요',
  },
  ja: {
    op_headline: '同じ過ちを、もう繰り返さない。',
    op_tagline: '30+のための、安心で穏やかな出会い',
    op_language: '言語 · Language · ភាសា · 语言 · 언어',
    op_translate: '翻訳はおまかせください',
  },
});
