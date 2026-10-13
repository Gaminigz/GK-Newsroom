// #/pin · Set your PIN (owner 2026-10-13, "Lock the app"): the step right after the language, before Create
// profile. The PIN is typed twice, then waits in this tab (sessionStorage — never localStorage, never in a URL)
// until the first sign-in or Create profile sends it once (lock.js). From then on 30+DA asks for it every time.
import { screen, el, t, go, icon } from '../core.js';
import { setPinSteps, keepWaitingPin, pinFrame } from '../lock.js';

screen('/pin', ({ root }) => {
  root.classList.add('dark', 'pin-route');
  const steps = setPinSteps({
    title: t('pin_set_title'),
    text: t('pin_set_text'),
    async onDone(pin) {
      keepWaitingPin(pin);
      go('/create');
      return null;
    },
  });
  root.append(
    el('header', { class: 'pin-route-top' },
      el('button', {
        type: 'button', class: 'icon-btn light', 'aria-label': t('core_back'),
        on: { click: () => go('/opening', { replace: true }) },
      }, icon('back', 18))),
    pinFrame(steps.node));
  steps.focus();
});
