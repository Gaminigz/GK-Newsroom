// Screen 2 · Create profile — face photo, app name (shown), real name (not shown), I am, You are,
// and a verified phone (or Google / Facebook). Then location, then Nearby.
import {
  screen, el, icon, t, go, api, toast, modal, state, setLang, setMe, registerStrings,
  resizeImage, updateLocation, roleLabel, LANGS, LANG_CODES, LANG_NATIVE, ROLES, findContactDetails, charCount,
} from '../core.js';

const COUNTRY_CODES = [
  '+855', '+66', '+84', '+856', '+95', '+60', '+65', '+63', '+62', '+86', '+852', '+886', '+82', '+81',
  '+91', '+61', '+64', '+1', '+44', '+33', '+49',
];

// ---------------------------------------------------------------- phone verifier (also used on #/me)

export const blankPhone = () => ({
  cc: '+855', phone: '', codeSent: false, code: '', devCode: null, resendAt: 0, sentTo: null, verified: false, verifiedPhone: null,
});

// What the user typed → E.164-ish ("+855" + digits, leading zeros dropped), or null when too short.
function fullPhone(model) {
  const raw = model.phone.trim();
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  const local = digits.replace(/^0+/, '');
  return local.length >= 6 && local.length <= 12 ? `${model.cc}${local}` : null;
}

function sendErrorText(err) {
  if (err.code === 'sms_unavailable') return t('cp_sms_off');
  if (err.code === 'too_soon') return t('cp_resend_in', { s: err.data?.resendIn ?? 30 });
  if (err.status === 429) return t('cp_too_many');
  if (err.status === 422 || err.status === 400) return t('cp_phone_invalid');
  return err.status === 0 ? t('err_network') : t('err_generic');
}

function verifyErrorText(err) {
  if (err.code === 'wrong_code' || err.code === 'invalid') return t('cp_code_wrong');
  if (err.code === 'code_expired') return t('cp_code_expired');
  if (err.status === 429) return t('cp_too_many');
  return err.status === 0 ? t('err_network') : t('err_generic');
}

/**
 * [+855 ⌄][12 345 678][Send code] → 6-digit code with a resend countdown → green "Phone verified".
 * `model` (see blankPhone) keeps the state across re-renders. onVerified(response) after a good code.
 */
export function phoneVerifier(model, { onVerified, onChange } = {}) {
  const node = el('div', { class: 'stack phone-box', style: { '--gap': '10px' } });
  const error = el('p', { class: 'field-error', role: 'alert', hidden: true });
  let resendTimer = null;
  let sending = false;
  let checking = false;
  let codeEl = null;

  const showError = (text) => {
    error.replaceChildren(...(text ? [icon('flag', 14), text] : []));
    error.hidden = !text;
  };

  async function send() {
    if (sending) return;
    const phone = fullPhone(model);
    if (!phone) return showError(t('cp_phone_invalid'));
    sending = true;
    render();
    let sent = false;
    try {
      const r = await api.post('/auth/send-code', { phone });
      Object.assign(model, {
        codeSent: true, code: '', devCode: r.devCode || null, sentTo: r.phone || phone,
        resendAt: Date.now() + (Number(r.resendIn) || 30) * 1000,
      });
      showError(null);
      sent = true;
    } catch (err) {
      if (err.code === 'too_soon' && model.codeSent) model.resendAt = Date.now() + (Number(err.data?.resendIn) || 30) * 1000;
      showError(sendErrorText(err));
    } finally {
      sending = false;
      render();
    }
    if (sent) codeEl?.focus();
  }

  async function check(input) {
    if (checking) return;
    checking = true;
    input.readOnly = true;
    try {
      const r = await api.post('/auth/verify-code', { phone: model.sentTo, code: model.code });
      Object.assign(model, { verified: true, verifiedPhone: model.sentTo, codeSent: false, code: '', devCode: null });
      showError(null);
      render();
      onChange?.();
      onVerified?.(r);
    } catch (err) {
      model.code = '';
      input.value = '';
      input.readOnly = false;
      showError(verifyErrorText(err));
      if (err.code === 'code_expired' || err.status === 429) {
        model.resendAt = 0; // let them ask for a new one straight away
        render();
      } else {
        input.focus();
      }
    } finally {
      checking = false;
    }
  }

  function resendLine() {
    const line = el('span', { class: 'resend' });
    const paint = () => {
      const s = Math.ceil((model.resendAt - Date.now()) / 1000);
      if (s > 0) {
        line.textContent = t('cp_resend_in', { s });
        return;
      }
      clearInterval(resendTimer);
      resendTimer = null;
      line.replaceChildren(el('button', { type: 'button', class: 'link', on: { click: send } }, t('cp_resend')));
    };
    paint();
    if (model.resendAt > Date.now()) resendTimer = setInterval(paint, 1000);
    return line;
  }

  function render() {
    clearInterval(resendTimer);
    resendTimer = null;
    codeEl = null;
    if (model.verified) {
      node.replaceChildren(
        el('div', { class: 'phone-verified' },
          el('span', { class: 'phone-num' }, model.verifiedPhone || ''),
          el('span', { class: 'verified-line' }, icon('check', 16), t('cp_phone_verified'))),
        error);
      return;
    }
    const ccSel = el('select', { class: 'select', 'aria-label': t('cp_country_code'), on: { change: () => { model.cc = ccSel.value; } } },
      COUNTRY_CODES.map((c) => el('option', { value: c, selected: c === model.cc }, c)));
    // While a code is out, "Resend code" under it takes over until the 30 s are up.
    const waiting = () => model.codeSent && model.resendAt > Date.now();
    const sendBtn = el('button', {
      type: 'button', class: 'btn btn-secondary btn-sm send-code', disabled: sending || waiting() || !fullPhone(model), on: { click: send },
    }, t(sending ? 'cp_sending' : 'cp_send_code'));
    const phoneInput = el('input', {
      class: 'input', type: 'tel', inputmode: 'tel', autocomplete: 'tel-national', maxlength: '20',
      placeholder: t('cp_phone_ph'), 'aria-label': t('cp_phone'), value: model.phone,
      on: {
        input: () => {
          model.phone = phoneInput.value;
          if (model.codeSent && fullPhone(model) !== model.sentTo) Object.assign(model, { codeSent: false, devCode: null, code: '' });
          sendBtn.disabled = sending || waiting() || !fullPhone(model);
          codeBox.hidden = !model.codeSent;
        },
        keydown: (e) => { if (e.key === 'Enter') send(); },
      },
    });

    const codeBox = el('div', { class: 'stack', style: { '--gap': '8px' }, hidden: !model.codeSent });
    if (model.codeSent) {
      const codeInput = el('input', {
        class: 'input code', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6',
        placeholder: t('cp_code_ph'), 'aria-label': t('cp_code_ph'), value: model.code,
        on: {
          input: () => {
            codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6);
            model.code = codeInput.value;
            if (model.code.length === 6) check(codeInput);
          },
        },
      });
      codeEl = codeInput;
      codeBox.append(
        el('div', { class: 'code-row' }, codeInput, resendLine()),
        el('p', { class: 'help' }, t('cp_code_sent', { phone: model.sentTo })));
      if (model.devCode) codeBox.append(el('p', { class: 'dev-note' }, t('cp_test_code', { code: model.devCode })));
    }
    node.replaceChildren(el('div', { class: 'phone-row' }, ccSel, phoneInput, sendBtn), codeBox, error);
  }

  render();
  return {
    node,
    focusCode: () => codeEl?.focus(),
    destroy: () => clearInterval(resendTimer),
  };
}

// ---------------------------------------------------------------- screen

const blankDraft = () => ({
  photo: null, name: '', realName: '', gender: '', role: '', phone: blankPhone(), verified: { gmail: false, facebook: false },
});
// Survives a language switch (which re-renders this screen) but not a reload.
let draft = blankDraft();

function nameProblem(value) {
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name) return null;
  const n = charCount(name);
  if (n < 2 || n > 24) return t('cp_name_length');
  if (!findContactDetails(name).ok) return t('cp_name_contact');
  return null;
}

const tag = (text, iconName, filled) =>
  el('span', { class: ['tag', filled ? 'tag-filled' : 'tag-outline'] }, iconName ? icon(iconName, 11) : null, text);

// Label row (+ optional tag) over its controls. forId ties a <label> to one input; labelId names a group.
function field(labelText, tagNode, { forId = null, labelId = null } = {}, ...controls) {
  const label = forId
    ? el('label', { class: 'label ink', for: forId }, labelText)
    : el('span', { class: 'label ink', id: labelId }, labelText);
  return el('div', { class: 'field' }, el('div', { class: 'field-head' }, label, tagNode), controls);
}

function languageSheet() {
  const sheet = modal(el('div', { class: 'sheet-body' },
    el('h2', { class: 'sheet-title' }, t('cp_choose_language')),
    el('div', { class: 'menu' }, LANGS.map((code) => el('button', {
      type: 'button',
      class: ['menu-item', code === state.lang && 'selected'],
      lang: code,
      'aria-pressed': String(code === state.lang),
      on: { click: () => { sheet.close(); setLang(code); } },
    }, el('span', {}, LANG_NATIVE[code]), code === state.lang ? icon('check', 18) : null)))),
  { sheet: true, label: t('cp_choose_language') });
}

screen('/create', ({ root }) => {
  root.classList.add('create');
  // A session that already proved something (e.g. phone verified, then the tab was closed).
  const pending = state.pending;
  if (pending?.phoneVerified && !draft.phone.verified) Object.assign(draft.phone, { verified: true, verifiedPhone: pending.phone || '' });
  if (pending?.verified) {
    draft.verified.gmail ||= Boolean(pending.verified.gmail);
    draft.verified.facebook ||= Boolean(pending.verified.facebook);
  }
  let saving = false;

  root.append(
    el('header', { class: 'brandbar' },
      el('span', { class: 'wordmark brand' }, '30+DA'),
      el('button', { type: 'button', class: 'globe-pill', 'aria-label': t('cp_choose_language'), on: { click: languageSheet } },
        icon('globe', 15), LANG_CODES[state.lang] || state.lang.toUpperCase())),
    el('h1', { class: 'title' }, t('cp_title')));

  // --- photo
  const file = el('input', { type: 'file', accept: 'image/*', capture: 'user', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
  const pick = el('button', { type: 'button', class: 'photo-pick', on: { click: () => file.click() } });
  const photoErr = el('p', { class: 'field-error', role: 'alert', hidden: true });
  const paintPhoto = () => {
    pick.classList.toggle('has-photo', Boolean(draft.photo));
    pick.setAttribute('aria-label', t(draft.photo ? 'cp_photo_change' : 'cp_photo_add'));
    pick.replaceChildren(
      draft.photo ? el('img', { src: draft.photo, alt: '' }) : icon('camera', 30),
      el('span', { class: 'badge', 'aria-hidden': 'true' }, icon('plus', 16)));
  };
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    photoErr.hidden = true;
    pick.classList.add('busy');
    try {
      draft.photo = await resizeImage(f);
      paintPhoto();
    } catch {
      photoErr.textContent = t('cp_photo_error');
      photoErr.hidden = false;
    } finally {
      pick.classList.remove('busy');
      update();
    }
  });
  paintPhoto();

  // --- names
  const nameErr = el('p', { class: 'field-error', role: 'alert', hidden: true });
  const nameInput = el('input', {
    class: 'input', id: 'cp-name', type: 'text', maxlength: '40', autocomplete: 'nickname', enterkeyhint: 'next',
    placeholder: t('cp_app_name_ph'), value: draft.name,
    on: { input: () => { draft.name = nameInput.value; paintName(); update(); } },
  });
  const paintName = () => {
    const problem = nameProblem(draft.name);
    nameErr.textContent = problem || '';
    nameErr.hidden = !problem;
    nameInput.classList.toggle('is-error', Boolean(problem));
    nameInput.setAttribute('aria-invalid', String(Boolean(problem)));
  };
  paintName();
  const realInput = el('input', {
    class: 'input', id: 'cp-real', type: 'text', maxlength: '60', autocomplete: 'name', enterkeyhint: 'next',
    placeholder: t('cp_real_name_ph'), value: draft.realName,
    on: { input: () => { draft.realName = realInput.value; update(); } },
  });

  // --- I am (gender) + You are (role)
  const genderBtns = ['woman', 'man'].map((g) => el('button', {
    type: 'button', 'aria-pressed': String(draft.gender === g),
    on: {
      click: () => {
        draft.gender = g;
        genderBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(['woman', 'man'][i] === g)));
        update();
      },
    },
  }, t(`cp_gender_${g}`)));
  const roleSel = el('select', {
    class: ['select', !draft.role && 'placeholder'], id: 'cp-role',
    on: { change: () => { draft.role = roleSel.value; roleSel.classList.toggle('placeholder', !draft.role); update(); } },
  },
  el('option', { value: '', disabled: true, selected: !draft.role }, t('cp_choose')),
  ROLES.map((r) => el('option', { value: r.key, selected: r.key === draft.role }, roleLabel(r.key))));

  // --- phone or Google / Facebook
  const phone = phoneVerifier(draft.phone, {
    onChange: () => update(),
    onVerified: (r) => {
      if (r.existing && r.user) {
        draft = blankDraft();
        setMe(r.user);
        toast(t('cp_welcome_back', { name: r.user.name }));
        go('/nearby', { replace: true });
      }
    },
  });
  const socialRow = el('div', { class: 'social-row' });
  const paintSocial = () => socialRow.replaceChildren(...[['google', 'gmail', 'Google'], ['facebook', 'facebook', 'Facebook']].map(([provider, key, name]) => {
    const done = Boolean(draft.verified[key]);
    return el('button', {
      type: 'button', class: ['btn', 'btn-secondary', 'btn-social', done && 'is-verified'], 'aria-pressed': String(done),
      on: { click: () => { if (!done) verifySocial(provider, key); } },
    }, icon(done ? 'check' : provider, 18), name, done ? el('span', { class: 'visually-hidden' }, t('cp_verified')) : null);
  }));
  async function verifySocial(provider, key) {
    try {
      const r = await api.post('/auth/verify-social', { provider });
      draft.verified = { ...draft.verified, ...(r.verified || {}), [key]: true };
      paintSocial();
      update();
    } catch (err) {
      toast(err.code === 'oauth_unavailable' ? t('cp_social_off') : err.status === 0 ? t('err_network') : t('err_generic'));
    }
  }
  paintSocial();

  // --- continue
  const contText = el('span', { class: 'btn-text' }, t('cp_continue'));
  const cont = el('button', { type: 'button', class: 'btn btn-primary', on: { click: () => submit() } }, contText, icon('arrow', 18));
  const contNote = el('p', { class: 'help center' }, t('cp_need_all'));
  const ready = () => Boolean(draft.photo && draft.name.trim() && !nameProblem(draft.name) && charCount(draft.realName.trim()) >= 2
    && draft.gender && draft.role && (draft.phone.verified || draft.verified.gmail || draft.verified.facebook));
  function update() {
    const ok = ready();
    cont.disabled = !ok || saving;
    contNote.hidden = ok || saving;
  }

  async function submit() {
    if (!ready() || saving) return;
    saving = true;
    update();
    contText.textContent = t('cp_saving');
    try {
      const r = await api.post('/profile', {
        name: draft.name.trim().replace(/\s+/g, ' '), realName: draft.realName.trim(), role: draft.role, gender: draft.gender,
        lang: state.lang, photo: draft.photo,
      });
      draft = blankDraft();
      setMe(r.user);
      contText.textContent = t('cp_locating');
      // Don't hold the new user here if the location prompt is ignored; Nearby can ask again.
      const gaveUp = new Promise((resolve) => { setTimeout(resolve, 15000); });
      await Promise.race([updateLocation().catch(() => {}), gaveUp]);
      go('/nearby', { replace: true });
    } catch (err) {
      saving = false;
      contText.textContent = t('cp_continue');
      update();
      profileError(err);
    }
  }

  function profileError(err) {
    const fieldName = err.data?.field;
    if (err.code === 'contact_detail' || fieldName === 'name') {
      nameErr.textContent = err.code === 'contact_detail' ? t('cp_name_contact') : t('cp_name_length');
      nameErr.hidden = false;
      nameInput.classList.add('is-error');
      nameInput.focus();
    } else if (err.code === 'photo_too_large' || fieldName === 'photo') {
      photoErr.textContent = t('cp_photo_error');
      photoErr.hidden = false;
    } else if (err.code === 'phone_in_use') {
      toast(t('cp_phone_in_use'));
    } else if (err.code === 'not_verified' || err.status === 401) {
      // The session expired: what it proved is gone, so verify again.
      Object.assign(draft.phone, blankPhone(), { phone: draft.phone.phone, cc: draft.phone.cc });
      draft.verified = { gmail: false, facebook: false };
      state.pending = null;
      toast(t('cp_verify_again'));
      go('/create', { replace: true });
    } else if (err.code === 'profile_exists') {
      go('/nearby', { replace: true });
    } else {
      toast(err.status === 0 ? t('err_network') : t('err_generic'));
    }
  }

  root.append(
    el('div', { class: 'form' },
      field(t('cp_photo'), null, {},
        el('div', { class: 'photo-row' }, pick, el('p', { class: 'photo-hint' }, t('cp_photo_hint'))),
        photoErr, file),
      field(t('cp_app_name'), tag(t('cp_tag_shown'), 'eye', true), { forId: 'cp-name' }, nameInput, nameErr),
      field(t('cp_real_name'), tag(t('cp_tag_not_shown'), 'eye-off', false), { forId: 'cp-real' }, realInput),
      field(t('cp_i_am'), null, { labelId: 'cp-gender-l' },
        el('div', { class: 'seg', role: 'group', 'aria-labelledby': 'cp-gender-l' }, genderBtns)),
      field(t('cp_you_are'), null, { forId: 'cp-role' }, roleSel),
      field(t('cp_phone'), tag(t('cp_tag_needed_chat'), 'chat', false), { labelId: 'cp-phone-l' }, phone.node),
      el('div', { class: 'stack', style: { '--gap': '12px' } },
        el('p', { class: 'label or-divider' }, t('cp_or_verify')),
        socialRow,
        el('p', { class: 'help' }, t('cp_social_note')))),
    el('div', { class: 'sticky-actions' }, cont, contNote));
  update();

  return () => phone.destroy();
});

registerStrings({
  en: {
    cp_title: 'Create profile',
    cp_choose_language: 'Choose language',
    cp_photo: 'Profile photo',
    cp_photo_hint: 'Add 1 clear photo of your face.',
    cp_photo_add: 'Add a photo of your face',
    cp_photo_change: 'Change photo',
    cp_photo_error: 'This photo could not be used. Try another one.',
    cp_app_name: 'App name',
    cp_tag_shown: 'Shown',
    cp_app_name_ph: 'The name others see',
    cp_real_name: 'Real name',
    cp_tag_not_shown: 'Not shown',
    cp_real_name_ph: 'First and last name',
    cp_name_length: 'Use 2 to 24 characters.',
    cp_name_contact: 'No phone numbers, emails or chat handles in your name.',
    cp_i_am: 'I am',
    cp_gender_woman: 'Woman',
    cp_gender_man: 'Man',
    cp_you_are: 'You are',
    cp_choose: 'Choose one',
    cp_phone: 'Phone number',
    cp_tag_needed_chat: 'Needed to chat',
    cp_country_code: 'Country code',
    cp_phone_ph: '12 345 678',
    cp_send_code: 'Send code',
    cp_sending: 'Sending…',
    cp_code_ph: '6-digit code',
    cp_code_sent: 'We sent a code to {phone}.',
    cp_resend_in: 'Resend in {s} s',
    cp_resend: 'Resend code',
    cp_test_code: 'Test code: {code}',
    cp_phone_verified: 'Phone verified',
    cp_phone_invalid: 'Enter a valid phone number.',
    cp_code_wrong: 'That code is not right. Try again.',
    cp_code_expired: 'That code has expired. Ask for a new one.',
    cp_too_many: 'Too many tries. Please wait a few minutes.',
    cp_sms_off: 'Text messages are not available yet. Verify with Google or Facebook for now.',
    cp_phone_in_use: 'This phone number already has a profile.',
    cp_or_verify: 'Or verify with',
    cp_verified: 'Verified',
    cp_social_off: 'This sign-in is not available yet.',
    cp_social_note: 'Google or Facebook is enough to start. Your phone is needed before you can chat at Level 3.',
    cp_continue: 'Continue',
    cp_need_all: 'Add your photo, fill in every field and verify your phone, Google or Facebook.',
    cp_saving: 'Saving…',
    cp_locating: 'Finding people near you…',
    cp_verify_again: 'Please verify your phone, Google or Facebook again.',
    cp_welcome_back: 'Welcome back, {name}',
  },
  km: {
    cp_title: 'បង្កើតប្រវត្តិរូប',
    cp_choose_language: 'ជ្រើសរើសភាសា',
    cp_photo: 'រូបថតប្រវត្តិរូប',
    cp_photo_hint: 'បន្ថែមរូបថតមុខរបស់អ្នក ១ សន្លឹកឲ្យច្បាស់។',
    cp_photo_add: 'បន្ថែមរូបថតមុខរបស់អ្នក',
    cp_photo_change: 'ប្ដូររូបថត',
    cp_photo_error: 'មិនអាចប្រើរូបថតនេះបានទេ។ សូមសាកល្បងរូបផ្សេង។',
    cp_app_name: 'ឈ្មោះក្នុងកម្មវិធី',
    cp_tag_shown: 'បង្ហាញ',
    cp_app_name_ph: 'ឈ្មោះដែលអ្នកដទៃឃើញ',
    cp_real_name: 'ឈ្មោះពិត',
    cp_tag_not_shown: 'មិនបង្ហាញ',
    cp_real_name_ph: 'នាមត្រកូល និងនាមខ្លួន',
    cp_name_length: 'សូមប្រើពី 2 ដល់ 24 តួអក្សរ។',
    cp_name_contact: 'កុំដាក់លេខទូរស័ព្ទ អ៊ីមែល ឬឈ្មោះគណនីជជែក ក្នុងឈ្មោះរបស់អ្នក។',
    cp_i_am: 'ខ្ញុំជា',
    cp_gender_woman: 'ស្ត្រី',
    cp_gender_man: 'បុរស',
    cp_you_are: 'អ្នកជា',
    cp_choose: 'ជ្រើសរើសមួយ',
    cp_phone: 'លេខទូរស័ព្ទ',
    cp_tag_needed_chat: 'ត្រូវការដើម្បីជជែក',
    cp_country_code: 'លេខកូដប្រទេស',
    cp_phone_ph: '12 345 678',
    cp_send_code: 'ផ្ញើលេខកូដ',
    cp_sending: 'កំពុងផ្ញើ…',
    cp_code_ph: 'លេខកូដ 6 ខ្ទង់',
    cp_code_sent: 'យើងបានផ្ញើលេខកូដទៅ {phone}។',
    cp_resend_in: 'ផ្ញើម្ដងទៀតក្នុងរយៈពេល {s} វិនាទី',
    cp_resend: 'ផ្ញើលេខកូដម្ដងទៀត',
    cp_test_code: 'លេខកូដសាកល្បង៖ {code}',
    cp_phone_verified: 'បានផ្ទៀងផ្ទាត់លេខទូរស័ព្ទ',
    cp_phone_invalid: 'សូមបញ្ចូលលេខទូរស័ព្ទឲ្យបានត្រឹមត្រូវ។',
    cp_code_wrong: 'លេខកូដនោះមិនត្រឹមត្រូវទេ។ សូមព្យាយាមម្ដងទៀត។',
    cp_code_expired: 'លេខកូដនោះផុតកំណត់ហើយ។ សូមស្នើលេខកូដថ្មី។',
    cp_too_many: 'ព្យាយាមច្រើនដងពេក។ សូមរង់ចាំប៉ុន្មាននាទីសិន។',
    cp_sms_off: 'សារ SMS មិនទាន់អាចប្រើបាននៅឡើយទេ។ សូមផ្ទៀងផ្ទាត់ជាមួយ Google ឬ Facebook សិន។',
    cp_phone_in_use: 'លេខទូរស័ព្ទនេះមានប្រវត្តិរូបរួចហើយ។',
    cp_or_verify: 'ឬផ្ទៀងផ្ទាត់ជាមួយ',
    cp_verified: 'បានផ្ទៀងផ្ទាត់',
    cp_social_off: 'ការចូលតាមវិធីនេះមិនទាន់អាចប្រើបាននៅឡើយទេ។',
    cp_social_note: 'Google ឬ Facebook គ្រប់គ្រាន់ដើម្បីចាប់ផ្ដើម។ ត្រូវការលេខទូរស័ព្ទ មុនពេលអ្នកអាចជជែកនៅកម្រិត 3។',
    cp_continue: 'បន្ត',
    cp_need_all: 'សូមបន្ថែមរូបថត បំពេញគ្រប់ចន្លោះ ហើយផ្ទៀងផ្ទាត់ទូរស័ព្ទ Google ឬ Facebook។',
    cp_saving: 'កំពុងរក្សាទុក…',
    cp_locating: 'កំពុងស្វែងរកមនុស្សនៅជិតអ្នក…',
    cp_verify_again: 'សូមផ្ទៀងផ្ទាត់ទូរស័ព្ទ Google ឬ Facebook ម្ដងទៀត។',
    cp_welcome_back: 'សូមស្វាគមន៍ការត្រឡប់មកវិញ {name}',
  },
  zh: {
    cp_title: '创建个人资料',
    cp_choose_language: '选择语言',
    cp_photo: '头像照片',
    cp_photo_hint: '请添加 1 张清晰的正脸照片。',
    cp_photo_add: '添加正脸照片',
    cp_photo_change: '更换照片',
    cp_photo_error: '这张照片无法使用，请换一张。',
    cp_app_name: '应用昵称',
    cp_tag_shown: '公开',
    cp_app_name_ph: '别人看到的名字',
    cp_real_name: '真实姓名',
    cp_tag_not_shown: '不公开',
    cp_real_name_ph: '姓和名',
    cp_name_length: '请使用 2 到 24 个字符。',
    cp_name_contact: '名字中不能包含电话、邮箱或聊天账号。',
    cp_i_am: '我是',
    cp_gender_woman: '女士',
    cp_gender_man: '男士',
    cp_you_are: '你的身份',
    cp_choose: '请选择',
    cp_phone: '手机号码',
    cp_tag_needed_chat: '聊天必需',
    cp_country_code: '国家/地区代码',
    cp_phone_ph: '12 345 678',
    cp_send_code: '发送验证码',
    cp_sending: '发送中…',
    cp_code_ph: '6 位验证码',
    cp_code_sent: '验证码已发送至 {phone}。',
    cp_resend_in: '{s} 秒后可重新发送',
    cp_resend: '重新发送验证码',
    cp_test_code: '测试验证码：{code}',
    cp_phone_verified: '手机号已验证',
    cp_phone_invalid: '请输入有效的手机号码。',
    cp_code_wrong: '验证码不正确，请重试。',
    cp_code_expired: '验证码已过期，请重新获取。',
    cp_too_many: '尝试次数过多，请稍等几分钟。',
    cp_sms_off: '短信验证暂未开通，请先用 Google 或 Facebook 验证。',
    cp_phone_in_use: '这个手机号已经有资料了。',
    cp_or_verify: '或通过以下方式验证',
    cp_verified: '已验证',
    cp_social_off: '此登录方式暂未开通。',
    cp_social_note: '用 Google 或 Facebook 即可开始；到等级 3 聊天前需要验证手机号。',
    cp_continue: '继续',
    cp_need_all: '请添加照片、填写所有信息，并验证手机、Google 或 Facebook。',
    cp_saving: '保存中…',
    cp_locating: '正在寻找你附近的人…',
    cp_verify_again: '请重新验证手机、Google 或 Facebook。',
    cp_welcome_back: '欢迎回来，{name}',
  },
  ko: {
    cp_title: '프로필 만들기',
    cp_choose_language: '언어 선택',
    cp_photo: '프로필 사진',
    cp_photo_hint: '얼굴이 잘 보이는 사진 1장을 올려 주세요.',
    cp_photo_add: '얼굴 사진 추가',
    cp_photo_change: '사진 바꾸기',
    cp_photo_error: '이 사진은 사용할 수 없어요. 다른 사진을 골라 주세요.',
    cp_app_name: '앱 이름',
    cp_tag_shown: '공개',
    cp_app_name_ph: '다른 사람에게 보이는 이름',
    cp_real_name: '실명',
    cp_tag_not_shown: '비공개',
    cp_real_name_ph: '성과 이름',
    cp_name_length: '2~24자로 입력해 주세요.',
    cp_name_contact: '이름에 전화번호, 이메일, 메신저 아이디를 넣을 수 없어요.',
    cp_i_am: '나는',
    cp_gender_woman: '여성',
    cp_gender_man: '남성',
    cp_you_are: '하는 일',
    cp_choose: '하나를 선택하세요',
    cp_phone: '전화번호',
    cp_tag_needed_chat: '채팅에 필요',
    cp_country_code: '국가 번호',
    cp_phone_ph: '12 345 678',
    cp_send_code: '코드 받기',
    cp_sending: '보내는 중…',
    cp_code_ph: '6자리 코드',
    cp_code_sent: '{phone}(으)로 코드를 보냈어요.',
    cp_resend_in: '{s}초 후 다시 보내기',
    cp_resend: '코드 다시 받기',
    cp_test_code: '테스트 코드: {code}',
    cp_phone_verified: '전화번호 인증 완료',
    cp_phone_invalid: '올바른 전화번호를 입력해 주세요.',
    cp_code_wrong: '코드가 맞지 않아요. 다시 입력해 주세요.',
    cp_code_expired: '코드가 만료됐어요. 새 코드를 받아 주세요.',
    cp_too_many: '시도 횟수가 너무 많아요. 몇 분 뒤에 다시 해 주세요.',
    cp_sms_off: '아직 문자 인증을 쓸 수 없어요. 지금은 Google 또는 Facebook으로 인증해 주세요.',
    cp_phone_in_use: '이 전화번호로 이미 만든 프로필이 있어요.',
    cp_or_verify: '또는 다음으로 인증',
    cp_verified: '인증됨',
    cp_social_off: '이 로그인 방법은 아직 쓸 수 없어요.',
    cp_social_note: 'Google 또는 Facebook으로 시작할 수 있어요. 레벨 3에서 채팅하려면 전화번호 인증이 필요해요.',
    cp_continue: '계속',
    cp_need_all: '사진을 올리고 모든 항목을 채운 뒤 전화번호, Google 또는 Facebook으로 인증해 주세요.',
    cp_saving: '저장 중…',
    cp_locating: '근처에 있는 사람을 찾는 중…',
    cp_verify_again: '전화번호, Google 또는 Facebook으로 다시 인증해 주세요.',
    cp_welcome_back: '다시 오신 걸 환영해요, {name}님',
  },
  ja: {
    cp_title: 'プロフィール作成',
    cp_choose_language: '言語を選択',
    cp_photo: 'プロフィール写真',
    cp_photo_hint: '顔がはっきり写った写真を1枚追加してください。',
    cp_photo_add: '顔写真を追加',
    cp_photo_change: '写真を変更',
    cp_photo_error: 'この写真は使えません。別の写真をお試しください。',
    cp_app_name: 'アプリ名',
    cp_tag_shown: '表示',
    cp_app_name_ph: '相手に表示される名前',
    cp_real_name: '本名',
    cp_tag_not_shown: '非表示',
    cp_real_name_ph: '姓と名',
    cp_name_length: '2〜24文字で入力してください。',
    cp_name_contact: '名前に電話番号・メール・チャットIDは入れられません。',
    cp_i_am: '性別',
    cp_gender_woman: '女性',
    cp_gender_man: '男性',
    cp_you_are: 'お仕事・状況',
    cp_choose: '1つ選んでください',
    cp_phone: '電話番号',
    cp_tag_needed_chat: 'チャットに必要',
    cp_country_code: '国番号',
    cp_phone_ph: '12 345 678',
    cp_send_code: 'コード送信',
    cp_sending: '送信中…',
    cp_code_ph: '6桁のコード',
    cp_code_sent: '{phone} にコードを送りました。',
    cp_resend_in: '{s}秒後に再送信できます',
    cp_resend: 'コードを再送信',
    cp_test_code: 'テストコード：{code}',
    cp_phone_verified: '電話番号を確認しました',
    cp_phone_invalid: '正しい電話番号を入力してください。',
    cp_code_wrong: 'コードが正しくありません。もう一度お試しください。',
    cp_code_expired: 'コードの有効期限が切れました。新しいコードを送信してください。',
    cp_too_many: '試行回数が多すぎます。数分お待ちください。',
    cp_sms_off: 'SMSはまだ利用できません。今はGoogleまたはFacebookで確認してください。',
    cp_phone_in_use: 'この電話番号のプロフィールはすでにあります。',
    cp_or_verify: 'または次で確認',
    cp_verified: '確認済み',
    cp_social_off: 'このログイン方法はまだ利用できません。',
    cp_social_note: 'GoogleまたはFacebookで始められます。レベル3でチャットするには電話番号の確認が必要です。',
    cp_continue: '次へ',
    cp_need_all: '写真を追加してすべての項目を入力し、電話番号・Google・Facebookのいずれかで確認してください。',
    cp_saving: '保存中…',
    cp_locating: '近くの人を探しています…',
    cp_verify_again: '電話番号・Google・Facebookのいずれかでもう一度確認してください。',
    cp_welcome_back: 'おかえりなさい、{name}さん',
  },
});
