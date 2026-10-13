// Where a profile photo comes from (owner 2026-10-14): tapping a photo circle / tile — Create profile (the face
// photo and photos 2–4) and #/me — opens a small sheet: "Take a selfie" (the FRONT camera) or "Choose from photos"
// (the phone's library), or Cancel. WebKit cannot open the front camera AND offer the library from one file input,
// so there are two hidden inputs: capture="user" for the selfie, none for the library.
// The inputs live in the screen, not in the sheet (it is gone once a choice is made): lock.js still sees the click
// that opens the picker and its change / cancel, so the PIN lock waits while the camera / photos are open.
// Styles: photo-source.css (loaded by index.html and board/frame.html).
import { el, icon, t, modal, registerStrings } from './core.js';

const hiddenInput = (attrs) => el('input', {
  type: 'file', accept: 'image/*', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true', ...attrs,
});

/**
 * photoSource(onFile) → { inputs, open(title) }. The screen puts `inputs` in its page once and calls open() from
 * the tap on a photo circle / tile; onFile(file) gets the chosen picture (the screen resizes, shows and uploads it).
 */
export function photoSource(onFile) {
  const selfie = hiddenInput({ capture: 'user', 'data-picker': 'selfie' });
  const library = hiddenInput({ 'data-picker': 'library' });
  for (const input of [selfie, library]) {
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      input.value = '';
      if (f) onFile(f);
    });
  }

  function open(title = t('ps_title')) {
    let dlg = null;
    // The sheet closes first (nothing stays inert), then the input opens — still inside the same tap, so the
    // phone shows its camera / photos.
    const choose = (input) => () => {
      dlg.close();
      input.click();
    };
    dlg = modal(el('div', { class: 'sheet-body photo-source' },
      el('h2', { class: 'sheet-title' }, title),
      el('div', { class: 'photo-source-choices' },
        el('button', {
          type: 'button', class: 'btn btn-primary photo-source-choice', 'data-source': 'selfie', on: { click: choose(selfie) },
        }, icon('camera', 24), el('span', { class: 'btn-text' }, t('ps_selfie'))),
        el('button', {
          type: 'button', class: 'btn btn-secondary photo-source-choice', 'data-source': 'library', on: { click: choose(library) },
        }, icon('image', 24), el('span', { class: 'btn-text' }, t('ps_library')))),
      // Focus starts on Cancel, as on the app's other sheets: Enter never opens the camera by itself.
      el('button', { type: 'button', class: 'btn photo-source-cancel', autofocus: true, on: { click: () => dlg.close() } }, t('ps_cancel'))),
    { sheet: true, label: title });
    return dlg;
  }

  return { inputs: [selfie, library], open };
}

registerStrings({
  en: {
    ps_title: 'Add a photo',
    ps_selfie: 'Take a selfie',
    ps_library: 'Choose from photos',
    ps_cancel: 'Cancel',
  },
  km: {
    ps_title: 'បន្ថែមរូបថត',
    ps_selfie: 'ថតរូបសែលហ្វី',
    ps_library: 'ជ្រើសរើសពីរូបថត',
    ps_cancel: 'បោះបង់',
  },
  zh: {
    ps_title: '添加照片',
    ps_selfie: '拍张自拍',
    ps_library: '从相册选择',
    ps_cancel: '取消',
  },
  ko: {
    ps_title: '사진 추가',
    ps_selfie: '셀카 찍기',
    ps_library: '앨범에서 선택',
    ps_cancel: '취소',
  },
  ja: {
    ps_title: '写真を追加',
    ps_selfie: '自撮りする',
    ps_library: '写真から選ぶ',
    ps_cancel: 'キャンセル',
  },
});
