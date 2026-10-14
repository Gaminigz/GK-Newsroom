// Inside the 30+DA iOS / Android app (owner 2026-10-14, the iOS audit; Apple 4.2): a permission that is off is the
// app's own setting on the phone, never "your browser settings". On the website each screen keeps its own words.
//  - settingsLine(kind): the app's line for 'location' | 'mic' | 'notify' (iOS: Settings › 30+DA › …; Android:
//    Settings › Apps › 30+DA › …), or null on the website.
//  - permissionOff(kind, webText): says it — the website: a toast with webText; Android: a toast with the app's line;
//    iOS: a small dialog with the line, "Open Settings" (app-settings:, the app's own page in Settings) and OK.
import { el, icon, t, modal, toast, registerStrings } from './core.js';
import { shellPlatform } from './shell.js';

const KINDS = ['location', 'mic', 'notify'];
const ICON = { location: 'pin', mic: 'mic', notify: 'bell' };

/** The app's own line for a permission that is off, or null (the website, or an unknown kind). */
export function settingsLine(kind) {
  const p = shellPlatform();
  return p && KINDS.includes(kind) ? t(`ia_${kind}_${p}`) : null;
}

/** A permission is off: the right words for where the person is (see the top of this file). */
export function permissionOff(kind, webText) {
  const line = settingsLine(kind);
  if (!line) {
    if (webText) toast(webText);
    return null;
  }
  if (shellPlatform() !== 'ios') {
    toast(line, 5000);
    return null;
  }
  const open = el('button', { type: 'button', class: 'btn btn-primary' }, t('ia_open_settings'));
  const ok = el('button', { type: 'button', class: 'btn btn-secondary' }, t('ia_ok'));
  const dlg = modal(el('div', { class: 'dialog-body' },
    el('span', { class: 'dialog-icon', 'aria-hidden': 'true' }, icon(ICON[kind], 22)),
    el('p', {}, line),
    el('div', { class: 'dialog-actions' }, open, ok)), { label: line });
  open.addEventListener('click', () => {
    dlg.close();
    location.href = 'app-settings:'; // iOS opens 30+DA's own page in Settings
  });
  ok.addEventListener('click', () => dlg.close());
  ok.focus();
  return dlg;
}

registerStrings({
  en: {
    ia_location_ios: 'Location is off for 30+DA. Turn it on in Settings › 30+DA › Location.',
    ia_location_android: 'Location is off for 30+DA. Turn it on in Settings › Apps › 30+DA › Permissions.',
    ia_mic_ios: 'The microphone is off for 30+DA. Turn it on in Settings › 30+DA › Microphone.',
    ia_mic_android: 'The microphone is off for 30+DA. Turn it on in Settings › Apps › 30+DA › Permissions.',
    ia_notify_ios: 'Notifications are off for 30+DA, so you will see it here. To turn them on: Settings › 30+DA › Notifications.',
    ia_notify_android: 'Notifications are off for 30+DA, so you will see it here. To turn them on: Settings › Apps › 30+DA › Notifications.',
    ia_open_settings: 'Open Settings',
    ia_ok: 'OK',
  },
  km: {
    ia_location_ios: 'ទីតាំងត្រូវបានបិទសម្រាប់ 30+DA។ សូមបើកវានៅ ការកំណត់ › 30+DA › ទីតាំង។',
    ia_location_android: 'ទីតាំងត្រូវបានបិទសម្រាប់ 30+DA។ សូមបើកវានៅ ការកំណត់ › កម្មវិធី › 30+DA › ការអនុញ្ញាត។',
    ia_mic_ios: 'មីក្រូហ្វូនត្រូវបានបិទសម្រាប់ 30+DA។ សូមបើកវានៅ ការកំណត់ › 30+DA › មីក្រូហ្វូន។',
    ia_mic_android: 'មីក្រូហ្វូនត្រូវបានបិទសម្រាប់ 30+DA។ សូមបើកវានៅ ការកំណត់ › កម្មវិធី › 30+DA › ការអនុញ្ញាត។',
    ia_notify_ios: 'ការជូនដំណឹងត្រូវបានបិទសម្រាប់ 30+DA ដូច្នេះអ្នកនឹងឃើញវានៅទីនេះ។ ដើម្បីបើក៖ ការកំណត់ › 30+DA › ការជូនដំណឹង។',
    ia_notify_android: 'ការជូនដំណឹងត្រូវបានបិទសម្រាប់ 30+DA ដូច្នេះអ្នកនឹងឃើញវានៅទីនេះ។ ដើម្បីបើក៖ ការកំណត់ › កម្មវិធី › 30+DA › ការជូនដំណឹង។',
    ia_open_settings: 'បើកការកំណត់',
    ia_ok: 'យល់ព្រម',
  },
  zh: {
    ia_location_ios: '30+DA 的定位已关闭。请在 设置 › 30+DA › 位置 中开启。',
    ia_location_android: '30+DA 的定位已关闭。请在 设置 › 应用 › 30+DA › 权限 中开启。',
    ia_mic_ios: '30+DA 的麦克风已关闭。请在 设置 › 30+DA › 麦克风 中开启。',
    ia_mic_android: '30+DA 的麦克风已关闭。请在 设置 › 应用 › 30+DA › 权限 中开启。',
    ia_notify_ios: '30+DA 的通知已关闭，你会在这里看到提醒。开启方法：设置 › 30+DA › 通知。',
    ia_notify_android: '30+DA 的通知已关闭，你会在这里看到提醒。开启方法：设置 › 应用 › 30+DA › 通知。',
    ia_open_settings: '打开设置',
    ia_ok: '好',
  },
  ko: {
    ia_location_ios: '30+DA의 위치가 꺼져 있어요. 설정 › 30+DA › 위치에서 켜 주세요.',
    ia_location_android: '30+DA의 위치가 꺼져 있어요. 설정 › 애플리케이션 › 30+DA › 권한에서 켜 주세요.',
    ia_mic_ios: '30+DA의 마이크가 꺼져 있어요. 설정 › 30+DA › 마이크에서 켜 주세요.',
    ia_mic_android: '30+DA의 마이크가 꺼져 있어요. 설정 › 애플리케이션 › 30+DA › 권한에서 켜 주세요.',
    ia_notify_ios: '30+DA의 알림이 꺼져 있어서 여기에서 알려 드려요. 켜려면: 설정 › 30+DA › 알림.',
    ia_notify_android: '30+DA의 알림이 꺼져 있어서 여기에서 알려 드려요. 켜려면: 설정 › 애플리케이션 › 30+DA › 알림.',
    ia_open_settings: '설정 열기',
    ia_ok: '확인',
  },
  ja: {
    ia_location_ios: '30+DAの位置情報がオフです。設定 › 30+DA › 位置情報 でオンにしてください。',
    ia_location_android: '30+DAの位置情報がオフです。設定 › アプリ › 30+DA › 権限 でオンにしてください。',
    ia_mic_ios: '30+DAのマイクがオフです。設定 › 30+DA › マイク でオンにしてください。',
    ia_mic_android: '30+DAのマイクがオフです。設定 › アプリ › 30+DA › 権限 でオンにしてください。',
    ia_notify_ios: '30+DAの通知がオフのため、ここでお知らせします。オンにするには：設定 › 30+DA › 通知。',
    ia_notify_android: '30+DAの通知がオフのため、ここでお知らせします。オンにするには：設定 › アプリ › 30+DA › 通知。',
    ia_open_settings: '設定を開く',
    ia_ok: 'OK',
  },
});
