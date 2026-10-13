// me · My profile (not in the design; same visual language): the 4 photo slots (main face photo, then
// slots that unlock at Level 2 and Level 3), app name (max 7 characters), birth year (read-only: set once),
// language, role, phone verification, hearts, Change PIN (the app lock, lock.js), sign out.
import {
  screen, el, icon, t, go, api, toast, modal, state, setLang, setMe, topBar, heartPills, roleLabel, resizeImage,
  registerStrings, LANGS, LANG_NATIVE, LANG_FLAG, ROLES, PHOTO_MAX, PHOTO_SLOT_LEVELS, photoSlotsFor, NAME_MAX, NAME_RAW_MAX,
} from '../core.js';
import {
  phoneVerifier, blankPhone, verifiedPhoneModel, appNameProblem, watchNameInput, clipNameInput, birthYearSelect, truthNote,
} from './create-profile.js';
import { changePinSheet, leaveWithoutLock } from '../lock.js';
// A tap on a slot asks "Take a selfie" (front camera) or "Choose from photos" (owner 2026-10-14).
import { photoSource } from '../photo-source.js';

let phoneModel = blankPhone(); // keeps a half-finished phone check across re-renders

function nameProblem(value) {
  const problem = appNameProblem(value);
  if (!value.trim() || problem === 'length') return t('me_name_length');
  return problem === 'contact' ? t('me_name_contact') : null;
}

const errText = (err) => (err.status === 0 ? t('err_network') : t('err_generic'));

/** { max, allowed, levels } from MeView.photoSlots (worked out from the level if an old server leaves it out). */
function slotsOf(me) {
  const s = me?.photoSlots || {};
  return {
    max: s.max || PHOTO_MAX,
    allowed: s.allowed || PHOTO_MAX, // all 4 can be uploaded; visibility goes by level
    levels: Array.isArray(s.levels) && s.levels.length ? s.levels : PHOTO_SLOT_LEVELS,
  };
}

const SIGNIN_NAMES = { google: 'Google', facebook: 'Facebook', tiktok: 'TikTok' };
const BACK_ERRORS = ['cancelled', 'expired', 'unavailable', 'failed', 'too_many', 'in_use'];
const BACK_ICON = { cancelled: 'question', expired: 'clock', too_many: 'clock', unavailable: 'refresh', failed: 'refresh', in_use: 'flag' };

/** The way back from Google / Facebook / TikTok started here: #/me?signin=google&ok=1 | &error=in_use → a calm note. */
function backNotice(query) {
  const name = SIGNIN_NAMES[query?.signin];
  if (!name) return null;
  if (query.ok === '1') return { ok: true, icon: 'check', text: t('cp_verified_with', { name }) };
  const reason = BACK_ERRORS.includes(query.error) ? query.error : 'failed';
  if (reason === 'in_use') return { ok: false, icon: BACK_ICON.in_use, text: t('vc_in_use', { name }) };
  if (reason === 'too_many') return { ok: false, icon: BACK_ICON.too_many, text: t('cp_too_many') };
  return { ok: false, icon: BACK_ICON[reason], text: t(`cp_signin_${reason}`, { name }) };
}

screen('/me', async ({ root, query }) => {
  root.classList.add('me');
  // Back from Google / Facebook / TikTok (a sign-in started on this page): said once, the address made plain again.
  const notice = backNotice(query);
  if (query?.signin) {
    try { history.replaceState(history.state, '', '#/me'); } catch { /* the address keeps its query */ }
  }
  root.append(topBar({ left: 'back', title: t('me_title'), me: false }));
  const body = el('div', { class: 'me-stack' }, el('p', { class: 'loading' }, t('core_loading')));
  root.append(body);

  // Fresh copy (hearts, verified) — the cached one is fine if the network is down.
  try {
    const r = await api.get('/me');
    if (r.user) setMe(r.user);
  } catch (err) {
    if (err.status === 401 || err.code === 'blocked' || !state.me) throw err;
  }
  const me = state.me;
  let phone = null;

  // --- photos
  // MeView.photos is slot-aligned: photos[i] is slot i+1 (null = empty). A photo never changes slots,
  // so the level it is seen at never changes either.
  // A tap on a slot asks first: "Take a selfie" (the front camera) or "Choose from photos" (photo-source.js).
  const file = photoSource((f) => putPhoto(f));
  const slots = el('ul', { class: 'photo-slots' });
  const slotCount = el('span', { class: 'label' });
  const keptNote = el('p', { class: 'help kept-note', hidden: true }, icon('lock', 13), el('span', {}, t('me_kept_note')));
  let busy = false;
  let target = 0; // the slot the camera / photo picker fills
  // Filled (photo; Main = replace, others = remove ×) · open and empty (+ Add photo) · locked (dashed,
  // lock, "Unlocks at Level n"). A filled slot past what the level allows is "kept": lock in its tag.
  function paintPhotos() {
    const urls = state.me.photos || [];
    const { max, allowed, levels } = slotsOf(state.me);
    const levelOf = (i) => levels[Math.min(i, levels.length - 1)];
    const filled = urls.filter(Boolean).length;
    const kept = urls.some((u, i) => u && i >= allowed);
    const open = Math.min(allowed, max);
    slotCount.textContent = `${filled} / ${max}`; // all 4 can be filled; the locks say who sees which
    keptNote.hidden = !kept;
    slots.replaceChildren(...Array.from({ length: Math.max(max, urls.length) }, (_, i) => {
      const url = urls[i];
      if (url) {
        const isKept = i >= allowed;
        const action = i === 0
          ? el('button', {
            type: 'button', class: 'slot-remove slot-replace', disabled: busy, 'aria-label': t('me_replace_main'),
            on: { click: () => pick(0) },
          }, icon('camera', 14))
          : el('button', {
            type: 'button', class: 'slot-remove', disabled: busy, 'aria-label': t('me_remove_photo_n', { n: i + 1 }),
            on: { click: () => removePhoto(i, isKept ? levelOf(i) : 0) },
          }, icon('close', 14));
        return el('li', { class: ['photo-slot', 'filled', isKept && 'kept', busy && 'busy'] },
          el('img', { src: url, alt: i === 0 ? t('me_main') : t('me_photo_n', { n: i + 1 }) }),
          // Photos 2–4 stay locked to each person until the two of you reach that level.
          el('span', { class: 'slot-tag' }, i > 0 ? icon('lock', 9) : null,
            el('span', {}, i === 0 ? t('me_main') : t('me_slot_level', { n: levelOf(i) }))),
          isKept ? el('span', { class: 'visually-hidden' }, t('me_kept_slot', { n: levelOf(i) })) : null,
          action);
      }
      if (i < allowed) {
        // The main photo comes first: with slot 1 empty, any + fills slot 1.
        return el('li', { class: 'photo-slot-cell' }, el('button', {
          type: 'button', class: ['photo-slot', 'add', busy && 'busy'], disabled: busy,
          'aria-label': `${t('me_add_photo')} · ${i === 0 ? t('me_main') : t('me_photo_n', { n: i + 1 })}`,
          on: { click: () => pick(urls[0] ? i : 0) },
        }, icon('plus', 20), el('span', { class: 'slot-text' }, t('me_add_photo')),
        // Which level this slot is seen at, so the owner knows who will see the photo.
        el('span', { class: 'slot-sub', 'aria-hidden': 'true' }, i > 0 ? icon('lock', 10) : null, i === 0 ? t('me_main') : t('me_slot_level', { n: levelOf(i) }))));
      }
      return el('li', { class: 'photo-slot locked' },
        icon('lock', 17),
        el('span', { class: 'slot-text' }, t('me_unlocks_at', { n: levelOf(i) })),
        el('span', { class: 'visually-hidden' }, t('me_photo_n', { n: i + 1 })));
    }));
  }
  function pick(i) {
    if (busy) return;
    target = i;
    file.open(t(i === 0 && state.me.photos?.[0] ? 'me_replace_main' : 'me_add_photo'));
  }
  async function refreshMe() {
    try {
      const r = await api.get('/me');
      if (r.user) setMe(r.user);
    } catch { /* keep what we have */ }
  }
  async function putPhoto(f) {
    if (busy) return;
    busy = true;
    paintPhotos();
    try {
      let photo;
      try {
        photo = await resizeImage(f);
      } catch {
        toast(t('me_photo_error'));
        return;
      }
      // Into the slot that was tapped (replacing the photo there, for Main).
      const r = await api.put(`/me/photos/${target}`, { photo });
      setMe(r.user);
    } catch (err) {
      if (err.code === 'photo_locked') {
        toast(t('me_photo_locked', { slot: err.data?.slot ?? target + 1, n: err.data?.needLevel ?? 2 }));
        await refreshMe(); // the level may have moved since this screen was drawn
      } else if (err.code === 'too_many_photos') {
        toast(t('me_photos_full', { max: err.data?.max ?? PHOTO_MAX }));
      } else if (err.code === 'main_first') {
        toast(t('me_main_first'));
        await refreshMe();
      } else if (err.code === 'photo_changed') {
        toast(t('me_photo_changed'));
        await refreshMe();
      } else {
        toast(err.data?.field === 'photo' ? t('me_photo_error') : errText(err));
      }
    } finally {
      busy = false;
      paintPhotos();
    }
  }
  /** A kept photo (past what the level allows) cannot be put back until that level: ask first. */
  function confirmKept(n, level) {
    return new Promise((resolve) => {
      let done = false;
      const remove = el('button', { type: 'button', class: 'btn btn-danger' }, t('me_remove'));
      const keep = el('button', { type: 'button', class: 'btn btn-primary' }, t('me_keep'));
      const dlg = modal(el('div', { class: 'dialog-body', role: 'alertdialog', 'aria-labelledby': 'me-kept-title' },
        el('span', { class: 'dialog-icon' }, icon('lock', 22)),
        el('h2', { class: 'dialog-title', id: 'me-kept-title' }, t('me_remove_kept_title', { n })),
        el('p', {}, t('me_remove_kept_body', { n: level })),
        el('div', { class: 'dialog-actions' }, keep, remove)), { label: t('me_remove_kept_title', { n }) });
      const finish = (yes) => {
        if (done) return;
        done = true;
        resolve(yes);
        dlg.close();
      };
      remove.addEventListener('click', () => finish(true));
      keep.addEventListener('click', () => finish(false));
      dlg.node.addEventListener('close', () => finish(false));
    });
  }
  async function removePhoto(i, keptLevel) {
    if (busy) return;
    if (keptLevel && !(await confirmKept(i + 1, keptLevel))) return;
    busy = true;
    paintPhotos();
    try {
      // The slot is left empty: the other photos stay in their slots (and at their levels).
      const r = await api.del(`/me/photos/${i}`);
      setMe(r.user);
    } catch (err) {
      toast(err.code === 'last_photo' ? t('me_last_photo') : err.code === 'main_photo' ? t('me_main_replace_only') : errText(err));
      if (err.code === 'not_found') await refreshMe();
    } finally {
      busy = false;
      paintPhotos();
    }
  }
  paintPhotos();

  // --- app name
  const nameErr = el('p', { class: 'field-error', role: 'alert', hidden: true });
  // Max 7 characters, held as typed like on screen 2 (a name saved before the rule shows in full until it is edited).
  const nameInput = watchNameInput(el('input', {
    class: 'input name-input', id: 'me-name', type: 'text', maxlength: String(NAME_RAW_MAX), autocomplete: 'nickname', value: me.name || '',
    placeholder: t('me_name_ph'), 'data-max-chars': String(NAME_MAX),
  }));
  // One row: app name · birth year · one Save (the year only while it has never been set).
  const saveId = el('button', { type: 'button', class: 'btn truth-btn', disabled: true }, t('me_save'));
  const yearErr = el('p', { class: 'field-error', role: 'alert', hidden: true });
  const yearCell = el('div', { class: 'me-id-cell' });
  let picked = '';
  const yearSet = () => Number.isInteger(state.me?.birthYear);
  const nameChanged = () => nameInput.value.trim().replace(/\s+/g, ' ') !== me.name;
  // Real name: kept private until Level 3, then shown to that person.
  const realInput = el('input', {
    class: 'input truth-field', id: 'me-real', type: 'text', maxlength: '60', autocomplete: 'name', value: me.realName || '', placeholder: t('me_real_ph'),
  });
  const realValue = () => realInput.value.trim().replace(/\s+/g, ' ');
  const realChanged = () => realValue() !== (me.realName || '');
  const realOk = () => [...realValue()].length >= 2;
  const paintSave = () => {
    const nameOk = nameChanged() && !(nameInput.value.trim() ? nameProblem(nameInput.value) : true);
    const yearOk = !yearSet() && Boolean(picked);
    const nameBad = nameChanged() && !nameOk;
    const realBad = realChanged() && !realOk();
    realInput.classList.toggle('is-error', realBad);
    saveId.disabled = nameBad || realBad || !(nameOk || yearOk || (realChanged() && realOk()));
  };
  realInput.addEventListener('input', () => paintSave());
  const paintName = () => {
    const value = nameInput.value;
    const problem = value.trim() ? nameProblem(value) : t('me_name_length');
    const changed = nameChanged();
    nameErr.textContent = changed && problem ? problem : '';
    nameErr.hidden = !(changed && problem);
    nameInput.classList.toggle('is-error', Boolean(changed && problem));
    paintSave();
  };
  function paintYear() {
    if (yearSet()) {
      yearCell.replaceChildren(el('span', { class: 'label ink' }, t('me_birth_year')),
        el('p', { class: 'year-fixed truth-field' }, icon('lock', 14), el('span', {}, String(state.me.birthYear))));
      return;
    }
    const sel = birthYearSelect({
      id: 'me-year',
      onChange: (v) => { picked = v; yearErr.hidden = true; sel.classList.remove('is-error'); paintSave(); },
    });
    yearCell.replaceChildren(el('label', { class: 'label ink', for: 'me-year' }, t('me_birth_year')), sel);
  }
  paintYear();
  const onName = (e) => {
    clipNameInput(nameInput, e);
    paintName();
  };
  nameInput.addEventListener('input', onName);
  nameInput.addEventListener('compositionend', onName);
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !saveId.disabled) saveId.click(); });
  saveId.addEventListener('click', async () => {
    const body = {};
    if (nameChanged()) body.name = nameInput.value.trim().replace(/\s+/g, ' ');
    if (realChanged() && realOk()) body.realName = realValue();
    if (!yearSet() && picked) body.birthYear = Number(picked);
    if (!Object.keys(body).length) return;
    saveId.disabled = true;
    try {
      const r = await api.patch('/me', body);
      setMe(r.user);
      me.name = r.user.name;
      nameInput.value = r.user.name;
      me.realName = r.user.realName || '';
      realInput.value = me.realName;
      picked = '';
      paintYear();
      paintName();
      toast(t('me_saved'));
    } catch (err) {
      if (err.code === 'birth_year_set') {
        toast(t('me_birth_set'));
        await refreshMe();
        paintYear();
        paintName();
        return;
      }
      paintSave();
      if (err.code === 'too_young' || err.data?.field === 'birthYear') {
        yearErr.replaceChildren(icon('flag', 14), err.code === 'too_young' ? t('cp_too_young') : t('cp_year_needed'));
        yearErr.hidden = false;
        yearCell.querySelector('select')?.classList.add('is-error');
        return;
      }
      const text = err.code === 'contact_detail' ? t('me_name_contact') : err.code === 'invalid' ? t('me_name_length') : '';
      if (!text) return toast(errText(err));
      nameErr.textContent = text;
      nameErr.hidden = false;
      nameInput.classList.add('is-error');
    }
  });

  // --- language (also the language others' messages are translated into)
  const langBtns = LANGS.map((code) => el('button', {
    type: 'button', class: 'btn btn-secondary', lang: code, 'aria-pressed': String(code === state.lang),
    on: {
      click: async () => {
        if (code === state.lang) return;
        langBtns.forEach((b) => { b.disabled = true; });
        try {
          const r = await api.patch('/me', { lang: code });
          setLang(code, { rerender: false });
          setMe(r.user);
          go('/me', { replace: true }); // same screen, new language
        } catch (err) {
          langBtns.forEach((b) => { b.disabled = false; });
          toast(errText(err));
        }
      },
    },
  }, el('span', { class: 'lang-label' }, el('span', { class: 'flag', 'aria-hidden': 'true' }, LANG_FLAG[code]), LANG_NATIVE[code])));

  // --- role
  const roleSel = el('select', {
    class: 'select truth-field', id: 'me-role', 'aria-label': t('me_role'),
    on: {
      change: async () => {
        const prev = state.me.role;
        try {
          const r = await api.patch('/me', { role: roleSel.value });
          setMe(r.user);
          toast(t('me_saved'));
        } catch (err) {
          roleSel.value = prev || '';
          toast(errText(err));
        }
      },
    },
  }, ROLES.map((r) => el('option', { value: r.key, selected: r.key === me.role }, roleLabel(r.key))));

  // --- verification + phone (owner 2026-10-13): the same 5 round buttons as Create profile, in the owner's order
  // TikTok · Telegram · Google · Facebook · WhatsApp — a green ✓ and "Verified" on each way this profile is verified
  // (Telegram / WhatsApp: the one the server says proved the number, MeView.phoneVia), "Coming soon" when off.
  // Tapping Google / Facebook / TikTok ADDS that account to this profile (never a switch) and comes back here.
  const v = me.verified || {};
  const ins = me.signins || {};
  let phoneBlock;
  // A verified number (owner 2026-10-13): shown in its box, editable, a ✓ on the app that proved it; "Change number"
  // = type a new one and verify it (the server puts the new number in place of the old one).
  const viaApp = ['telegram', 'whatsapp'].includes(me.phoneVia) ? me.phoneVia : null; // sms / not known: no app ✓
  if (v.phone && me.phone && (phoneModel.verifiedPhone !== me.phone || phoneModel.verifiedBy !== viaApp)) {
    phoneModel = verifiedPhoneModel(me.phone, blankPhone(), me.phoneVia);
  }
  {
    phone = phoneVerifier(phoneModel, {
      notice,
      signin: {
        to: 'me',
        verified: () => ({
          gmail: Boolean(v.gmail || ins.google), facebook: Boolean(v.facebook || ins.facebook), tiktok: Boolean(v.tiktok || ins.tiktok),
        }),
        // Test mode's instant sign-in: already on this profile — a fresh copy, drawn again.
        onVerified: async () => {
          try {
            const r = await api.get('/me', { redirect: false });
            if (r.user) setMe(r.user);
          } catch { /* the next visit shows it */ }
          go('/me', { replace: true });
        },
        beforeLeave: () => leaveWithoutLock(), // the trip to Google / Facebook / TikTok is not "closing the app"
      },
      onVerified: (r) => {
        phoneModel = blankPhone();
        if (!r.user) return;
        if (r.user.id !== state.me?.id) toast(t('me_switched', { name: r.user.name }));
        else toast(t('me_phone_done'));
        setMe(r.user);
        go(r.user.id === me.id ? '/me' : '/nearby', { replace: true });
      },
    });
    phoneBlock = el('div', { class: 'stack', style: { '--gap': '8px' } },
      v.phone && me.phone ? null : el('p', { class: 'lock-note' }, icon('lock', 14), el('span', {}, t('me_phone_needed'))), phone.node);
  }

  // --- the PIN that locks the app: small, above Sign out (set first if this profile has none yet)
  const changePin = el('button', {
    type: 'button', class: 'btn btn-secondary btn-sm btn-auto me-pin', on: { click: () => changePinSheet() },
  }, icon('lock', 16), el('span', {}, t('pin_change')));

  // --- sign out
  const signOut = el('button', { type: 'button', class: 'btn btn-secondary' }, icon('logout', 18), el('span', {}, t('me_signout')));
  signOut.addEventListener('click', async () => {
    signOut.disabled = true;
    try {
      await api.post('/auth/signout', {}, { redirect: false });
    } catch { /* signed out locally either way */ }
    state.me = null;
    state.actions = [];
    state.notices = [];
    state.pending = null;
    go('/opening', { replace: true });
  });

  // --- I am: Male / Female / Other, saved on tap
  const GENDER_KEYS = ['man', 'woman', 'other'];
  const paintGender = () => genderBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(GENDER_KEYS[i] === me.gender)));
  const genderBtns = GENDER_KEYS.map((g) => el('button', {
    type: 'button', 'aria-pressed': String(me.gender === g),
    on: {
      click: async () => {
        if (me.gender === g) return;
        genderBtns.forEach((b) => { b.disabled = true; });
        try {
          const r = await api.patch('/me', { gender: g });
          setMe(r.user);
          me.gender = r.user.gender;
          toast(t('me_saved'));
        } catch (err) {
          toast(errText(err));
        } finally {
          genderBtns.forEach((b) => { b.disabled = false; });
          paintGender();
        }
      },
    },
  }, t(`cp_gender_${g}`)));
  const genderSeg = el('div', { class: 'seg', role: 'group', 'aria-label': t('cp_i_am') }, genderBtns);

  const place = [me.area, me.city].filter((x, i, a) => x && a.indexOf(x) === i).join(', ');
  const section = (labelText, ...kids) => el('section', { class: 'section' }, labelText ? el('span', { class: 'label ink' }, labelText) : null, kids);

  body.replaceChildren(
    // Language first: it decides what everything below (and every chat) is shown in.
    // Owner (2026-10-13): hearts (left) and where I am (right) at the top, not hidden at the bottom.
    el('div', { class: 'me-hearts-top' },
      el('div', { class: 'me-hearts-left' }, el('span', { class: 'label' }, t('me_hearts')), heartPills(me.hearts, 'lg')),
      place ? el('span', { class: 'me-place' }, icon('pin', 14), el('span', {}, place)) : null),
    section(t('me_language'), el('div', { class: 'lang-grid' }, langBtns), el('p', { class: 'help' }, t('me_language_note'))),
    el('section', { class: 'section' },
      el('div', { class: 'section-head' }, el('span', { class: 'label ink' }, t('me_photos')), slotCount),
      slots, keptNote, el('p', { class: 'help' }, t('me_photos_note')), file.inputs),
    el('section', { class: 'section' },
      el('div', { class: 'me-id-row' },
        el('div', { class: 'me-id-cell' },
          el('div', { class: 'field-head' }, el('label', { class: 'label ink', for: 'me-name' }, t('me_app_name')),
            el('span', { class: 'tag tag-filled' }, icon('eye', 11), t('me_tag_shown'))),
          nameInput),
        yearCell,
        saveId),
      nameErr, yearErr, genderSeg, roleSel,
      el('div', { class: 'field-head' }, el('label', { class: 'label ink', for: 'me-real' }, t('me_real_name')),
        el('span', { class: 'tag' }, icon('lock', 11), t('me_real_tag'))),
      realInput, truthNote()), // gender, job, real name (shown at Level 3), then the warning
    section(t('me_verified_with'), phoneBlock),
    me.pinSet ? changePin : null,
    signOut,
    // Privacy policy · Terms, and a red "Delete my account" (Google Play / Apple: in the app).
    accountFoot(),
    el('p', { class: 'label me-foot' }, `30+DA · ${me.id}`));

  return () => phone?.destroy();
});

registerStrings({
  en: {
    me_title: 'My profile',
    me_photos: 'Photos',
    me_photos_note: 'Nearby sees only your main photo. Photo 2 is shown when you reach Level 2 with someone, photos 3–4 at Level 3. Each photo stays in its slot.',
    me_main: 'Main',
    me_photo_n: 'Photo {n}',
    me_remove_photo_n: 'Remove photo {n}',
    me_unlocks_at: 'Unlocks at Level {n}',
    me_slot_level: 'Level {n}',
    me_slots_open: '{n} of {max} unlocked',
    me_photo_locked: 'Photo {slot} unlocks at Level {n}.',
    me_photos_full: 'You can have {max} photos.',
    me_add_photo: 'Add photo',
    me_photo_error: 'This photo could not be used. Try another one.',
    me_last_photo: 'Keep at least one photo of your face.',
    me_slots_kept: '{count} photos · {n} of {max} unlocked',
    me_kept_note: 'Photos with a lock were added before your level allowed them. If you remove one, you can add a photo there again only at that level.',
    me_kept_slot: 'Kept from before: this slot opens again at Level {n}',
    me_remove_kept_title: 'Remove photo {n}?',
    me_remove_kept_body: 'This slot opens at Level {n}. Until you reach Level {n} with someone, you can’t add a photo here again.',
    me_remove: 'Remove',
    me_keep: 'Keep it',
    me_replace_main: 'Replace main photo',
    me_main_replace_only: 'Your main photo can be replaced, not removed.',
    me_main_first: 'Add your main photo first.',
    me_photo_changed: 'Your photos changed. Try again.',
    me_app_name: 'App name',
    me_tag_shown: 'Shown',
    me_real_name: 'Real name',
    me_real_tag: 'Shown at Level 3',
    me_real_ph: 'First and last name',
    me_name_length: 'Use 2 to 7 characters.',
    me_name_ph: 'Name',
    me_birth_year: 'Birth year',
    me_birth_year_is: 'Birth year {year}',
    me_birth_once: 'Set once at sign-up. Other people never see it.',
    me_birth_missing: 'Add your birth year. You can set it only once.',
    me_birth_set: 'Your birth year is already set.',
    me_name_contact: 'No phone numbers, emails or chat handles in your name.',
    me_save: 'Save',
    me_saved: 'Saved',
    me_language: 'Language',
    me_language_note: 'The app and other people’s messages are shown in this language.',
    me_role: 'You are',
    me_verified_with: 'Verified with',
    me_phone_needed: 'You need to verify to have conversations.',
    me_phone_done: 'Number verified ✓',
    me_switched: 'Signed in as {name}',
    me_hearts: 'Your hearts',
    me_signout: 'Sign out',
  },
  km: {
    me_title: 'ប្រវត្តិរូបរបស់ខ្ញុំ',
    me_photos: 'រូបថត',
    me_photos_note: 'ក្នុង «នៅជិត» គេឃើញតែរូបថតមេរបស់អ្នកប៉ុណ្ណោះ។ រូបថតទី 2 បង្ហាញនៅពេលអ្នកដល់កម្រិត 2 ជាមួយនរណាម្នាក់ ហើយរូបថតទី 3–4 នៅកម្រិត 3។ រូបថតនីមួយៗនៅតែក្នុងប្រអប់របស់វា។',
    me_main: 'មេ',
    me_photo_n: 'រូបថតទី {n}',
    me_remove_photo_n: 'លុបរូបថតទី {n}',
    me_unlocks_at: 'បើកនៅកម្រិត {n}',
    me_slot_level: 'កម្រិត {n}',
    me_slots_open: 'បានបើក {n} ក្នុងចំណោម {max}',
    me_photo_locked: 'រូបថតទី {slot} នឹងបើកនៅកម្រិត {n}។',
    me_photos_full: 'អ្នកអាចមានរូបថតបាន {max} សន្លឹក។',
    me_add_photo: 'បន្ថែមរូបថត',
    me_photo_error: 'មិនអាចប្រើរូបថតនេះបានទេ។ សូមសាកល្បងរូបផ្សេង។',
    me_last_photo: 'សូមទុករូបថតមុខយ៉ាងហោចណាស់មួយសន្លឹក។',
    me_slots_kept: 'រូបថត {count} · បានបើក {n} ក្នុងចំណោម {max}',
    me_kept_note: 'រូបថតដែលមានសោ ត្រូវបានបន្ថែមមុនពេលកម្រិតរបស់អ្នកអនុញ្ញាត។ បើអ្នកលុបវា អ្នកអាចបន្ថែមរូបថតនៅទីនោះម្តងទៀតបាន លុះត្រាតែដល់កម្រិតនោះ។',
    me_kept_slot: 'រក្សាទុកពីមុន៖ ប្រអប់នេះបើកម្តងទៀតនៅកម្រិត {n}',
    me_remove_kept_title: 'លុបរូបថតទី {n}?',
    me_remove_kept_body: 'ប្រអប់នេះបើកនៅកម្រិត {n}។ រហូតដល់អ្នកដល់កម្រិត {n} ជាមួយនរណាម្នាក់ អ្នកមិនអាចបន្ថែមរូបថតនៅទីនេះម្តងទៀតបានទេ។',
    me_remove: 'លុប',
    me_keep: 'ទុកវា',
    me_replace_main: 'ប្តូររូបថតមេ',
    me_main_replace_only: 'រូបថតមេអាចប្តូរបាន ប៉ុន្តែមិនអាចលុបបានទេ។',
    me_main_first: 'សូមបន្ថែមរូបថតមេជាមុនសិន។',
    me_photo_changed: 'រូបថតរបស់អ្នកបានផ្លាស់ប្តូរ។ សូមព្យាយាមម្តងទៀត។',
    me_app_name: 'ឈ្មោះក្នុងកម្មវិធី',
    me_tag_shown: 'បង្ហាញ',
    me_real_name: 'ឈ្មោះពិត',
    me_real_tag: 'បង្ហាញនៅកម្រិត 3',
    me_real_ph: 'នាមខ្លួន និងនាមត្រកូល',
    me_name_length: 'សូមប្រើពី 2 ដល់ 7 តួអក្សរ។',
    me_name_ph: 'ឈ្មោះ',
    me_birth_year: 'ឆ្នាំកំណើត',
    me_birth_year_is: 'ឆ្នាំកំណើត {year}',
    me_birth_once: 'កំណត់តែម្ដងនៅពេលចុះឈ្មោះ។ អ្នកដទៃមិនដែលឃើញវាទេ។',
    me_birth_missing: 'សូមបន្ថែមឆ្នាំកំណើតរបស់អ្នក។ អ្នកអាចកំណត់វាបានតែម្ដងប៉ុណ្ណោះ។',
    me_birth_set: 'ឆ្នាំកំណើតរបស់អ្នកត្រូវបានកំណត់រួចហើយ។',
    me_name_contact: 'កុំដាក់លេខទូរស័ព្ទ អ៊ីមែល ឬឈ្មោះគណនីជជែក ក្នុងឈ្មោះរបស់អ្នក។',
    me_save: 'រក្សាទុក',
    me_saved: 'បានរក្សាទុក',
    me_language: 'ភាសា',
    me_language_note: 'កម្មវិធី និងសាររបស់អ្នកដទៃ នឹងបង្ហាញជាភាសានេះ។',
    me_role: 'អ្នកជា',
    me_verified_with: 'បានផ្ទៀងផ្ទាត់ជាមួយ',
    me_phone_needed: 'អ្នកត្រូវផ្ទៀងផ្ទាត់ ដើម្បីអាចសន្ទនាបាន។',
    me_phone_done: 'បានផ្ទៀងផ្ទាត់លេខ ✓',
    me_switched: 'បានចូលជា {name}',
    me_hearts: 'បេះដូងរបស់អ្នក',
    me_signout: 'ចាកចេញ',
  },
  zh: {
    me_title: '我的资料',
    me_photos: '照片',
    me_photos_note: '在“附近”里，别人只能看到你的主照片。和某人到达等级 2 时显示第 2 张，等级 3 时显示第 3–4 张。每张照片都固定在自己的位置。',
    me_main: '主照片',
    me_photo_n: '第 {n} 张照片',
    me_remove_photo_n: '删除第 {n} 张照片',
    me_unlocks_at: '等级 {n} 解锁',
    me_slot_level: '等级 {n}',
    me_slots_open: '已解锁 {n}/{max}',
    me_photo_locked: '第 {slot} 张照片在等级 {n} 解锁。',
    me_photos_full: '最多可以放 {max} 张照片。',
    me_add_photo: '添加照片',
    me_photo_error: '这张照片无法使用，请换一张。',
    me_last_photo: '请至少保留一张正脸照。',
    me_slots_kept: '{count} 张照片 · 已解锁 {n}/{max}',
    me_kept_note: '带锁的照片是在你的等级允许之前添加的。如果删除，要到达那个等级后才能在那里再放照片。',
    me_kept_slot: '之前保留的照片：这个位置在等级 {n} 重新开放',
    me_remove_kept_title: '删除第 {n} 张照片？',
    me_remove_kept_body: '这个位置在等级 {n} 开放。在你和某人到达等级 {n} 之前，不能再在这里添加照片。',
    me_remove: '删除',
    me_keep: '保留',
    me_replace_main: '更换主照片',
    me_main_replace_only: '主照片可以更换，但不能删除。',
    me_main_first: '请先添加主照片。',
    me_photo_changed: '你的照片已有变化，请再试一次。',
    me_app_name: '应用昵称',
    me_tag_shown: '公开',
    me_real_name: '真实姓名',
    me_real_tag: '等级 3 时可见',
    me_real_ph: '名字和姓氏',
    me_name_length: '请使用 2 到 7 个字符。',
    me_name_ph: '昵称',
    me_birth_year: '出生年份',
    me_birth_year_is: '出生年份 {year}',
    me_birth_once: '注册时设定一次，其他人永远看不到。',
    me_birth_missing: '请填写你的出生年份，只能设定一次。',
    me_birth_set: '你的出生年份已经设定好了。',
    me_name_contact: '名字中不能包含电话、邮箱或聊天账号。',
    me_save: '保存',
    me_saved: '已保存',
    me_language: '语言',
    me_language_note: '应用界面和别人发来的消息都会用这种语言显示。',
    me_role: '你的身份',
    me_verified_with: '已验证方式',
    me_phone_needed: '验证后才能开始对话。',
    me_phone_done: '号码已验证 ✓',
    me_switched: '已登录为 {name}',
    me_hearts: '你的心',
    me_signout: '退出登录',
  },
  ko: {
    me_title: '내 프로필',
    me_photos: '사진',
    me_photos_note: '‘근처’에서는 대표 사진만 보여요. 누군가와 레벨 2가 되면 사진 2가, 레벨 3에서는 사진 3–4가 보여요. 사진은 각자 자리에 그대로 있어요.',
    me_main: '대표',
    me_photo_n: '사진 {n}',
    me_remove_photo_n: '사진 {n} 삭제',
    me_unlocks_at: '레벨 {n}에서 열려요',
    me_slot_level: '레벨 {n}',
    me_slots_open: '{max}칸 중 {n}칸 열림',
    me_photo_locked: '{slot}번째 사진은 레벨 {n}에서 올릴 수 있어요.',
    me_photos_full: '사진은 {max}장까지 올릴 수 있어요.',
    me_add_photo: '사진 추가',
    me_photo_error: '이 사진은 사용할 수 없어요. 다른 사진을 골라 주세요.',
    me_last_photo: '얼굴 사진은 최소 1장 있어야 해요.',
    me_slots_kept: '사진 {count}장 · {max}칸 중 {n}칸 열림',
    me_kept_note: '자물쇠가 있는 사진은 레벨이 허용되기 전에 올린 사진이에요. 삭제하면 그 레벨이 되어야 그 자리에 다시 올릴 수 있어요.',
    me_kept_slot: '예전에 올린 사진: 이 자리는 레벨 {n}에서 다시 열려요',
    me_remove_kept_title: '{n}번째 사진을 삭제할까요?',
    me_remove_kept_body: '이 자리는 레벨 {n}에서 열려요. 누군가와 레벨 {n}에 도달하기 전에는 여기에 사진을 다시 올릴 수 없어요.',
    me_remove: '삭제',
    me_keep: '그대로 두기',
    me_replace_main: '대표 사진 바꾸기',
    me_main_replace_only: '대표 사진은 바꿀 수는 있지만 삭제할 수는 없어요.',
    me_main_first: '대표 사진을 먼저 올려 주세요.',
    me_photo_changed: '사진이 바뀌었어요. 다시 시도해 주세요.',
    me_app_name: '앱 이름',
    me_tag_shown: '공개',
    me_real_name: '실명',
    me_real_tag: '레벨 3에서 공개',
    me_real_ph: '이름과 성',
    me_name_length: '2~7자로 입력해 주세요.',
    me_name_ph: '이름',
    me_birth_year: '출생 연도',
    me_birth_year_is: '출생 연도 {year}',
    me_birth_once: '가입할 때 한 번만 정해요. 다른 사람에게는 보이지 않아요.',
    me_birth_missing: '출생 연도를 추가해 주세요. 한 번만 정할 수 있어요.',
    me_birth_set: '출생 연도는 이미 정해져 있어요.',
    me_name_contact: '이름에 전화번호, 이메일, 메신저 아이디를 넣을 수 없어요.',
    me_save: '저장',
    me_saved: '저장했어요',
    me_language: '언어',
    me_language_note: '앱 화면과 다른 사람의 메시지가 이 언어로 보여요.',
    me_role: '하는 일',
    me_verified_with: '인증 수단',
    me_phone_needed: '대화하려면 인증이 필요해요.',
    me_phone_done: '번호 인증 완료 ✓',
    me_switched: '{name}님으로 로그인했어요',
    me_hearts: '내 하트',
    me_signout: '로그아웃',
  },
  ja: {
    me_title: 'マイプロフィール',
    me_photos: '写真',
    me_photos_note: '「近く」ではメイン写真だけが表示されます。誰かとレベル2になると写真2が、レベル3で写真3〜4が表示されます。写真はそれぞれの枠に固定されます。',
    me_main: 'メイン',
    me_photo_n: '写真{n}',
    me_remove_photo_n: '写真{n}を削除',
    me_unlocks_at: 'レベル{n}で\u200b解除', // zero-width space: wraps as レベル2で / 解除, never inside 解除
    me_slot_level: 'レベル{n}',
    me_slots_open: '{max}枠中{n}枠が利用可能',
    me_photo_locked: '写真{slot}はレベル{n}で追加できます。',
    me_photos_full: '写真は{max}枚までです。',
    me_add_photo: '写真を追加',
    me_photo_error: 'この写真は使えません。別の写真をお試しください。',
    me_last_photo: '顔写真は少なくとも1枚必要です。',
    me_slots_kept: '写真{count}枚 · {max}枠中{n}枠が利用可能',
    me_kept_note: '鍵マークの写真は、レベルで解除される前に追加されたものです。削除すると、そのレベルになるまでその枠に写真を追加できません。',
    me_kept_slot: '以前から残っている写真：この枠はレベル{n}で再び使えます',
    me_remove_kept_title: '写真{n}を削除しますか？',
    me_remove_kept_body: 'この枠はレベル{n}で解除されます。誰かとレベル{n}になるまで、ここに写真を追加し直すことはできません。',
    me_remove: '削除',
    me_keep: '残す',
    me_replace_main: 'メイン写真を変更',
    me_main_replace_only: 'メイン写真は変更できますが、削除はできません。',
    me_main_first: '先にメイン写真を追加してください。',
    me_photo_changed: '写真が変更されました。もう一度お試しください。',
    me_app_name: 'アプリ名',
    me_tag_shown: '表示',
    me_real_name: '本名',
    me_real_tag: 'レベル3で表示',
    me_real_ph: '名前と姓',
    me_name_length: '2〜7文字で入力してください。',
    me_name_ph: '名前',
    me_birth_year: '生まれ年',
    me_birth_year_is: '生まれ年 {year}',
    me_birth_once: '登録時に一度だけ設定します。他の人には表示されません。',
    me_birth_missing: '生まれ年を追加してください。設定できるのは一度だけです。',
    me_birth_set: '生まれ年はすでに設定されています。',
    me_name_contact: '名前に電話番号・メール・チャットIDは入れられません。',
    me_save: '保存',
    me_saved: '保存しました',
    me_language: '言語',
    me_language_note: 'アプリの表示と相手からのメッセージがこの言語になります。',
    me_role: 'お仕事・状況',
    me_verified_with: '確認済み',
    me_phone_needed: '会話するには確認が必要です。',
    me_phone_done: '番号を確認しました ✓',
    me_switched: '{name}さんとしてログインしました',
    me_hearts: 'あなたのハート',
    me_signout: 'ログアウト',
  },
});

// The bottom of the page: Privacy policy · Terms · Delete my account (its sheet and words live there).
import { accountFoot } from './delete-account.js'; // eslint-disable-line import/first
