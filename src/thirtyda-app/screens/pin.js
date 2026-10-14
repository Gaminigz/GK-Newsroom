// #/pin · Set your PIN (owner 2026-10-13, "Lock the app"): the step right after the language and the community rules
// (#/rules, owner 2026-10-14); then the home screen
// as a guest (owner 2026-10-13: "Language → PIN → the home screen"), Create profile only when they want to do something.
// The PIN is typed twice, then waits on this phone (localStorage, never in a URL — owner 2026-10-14: it survives closing
// the app, and the app opens on "Enter your PIN") until the first sign-in or Create profile sends it once (lock.js). From
// then on 30+DA asks for it every time. Once chosen, this screen is never shown again (app.js guard → home).
import { screen, el, t, go, icon } from '../core.js';
import { setPinSteps, keepWaitingPin, pinFrame } from '../lock.js';

screen('/pin', ({ root }) => {
  root.classList.add('dark', 'pin-route');
  const steps = setPinSteps({
    title: t('pin_set_title'),
    text: t('pin_set_text'),
    async onDone(pin) {
      keepWaitingPin(pin);
      go('/nearby');
      return null;
    },
  });
  root.append(
    el('header', { class: 'pin-route-top' },
      el('button', {
        type: 'button', class: 'icon-btn light', 'aria-label': t('core_back'),
        on: { click: () => go('/rules', { replace: true }) }, // the step before: the community rules
      }, icon('back', 18))),
    pinFrame(steps.node));
  steps.focus();
});
