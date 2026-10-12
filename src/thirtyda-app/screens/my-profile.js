// me · My profile (not in the design; same visual language): face photo + up to 2 extra photos,
// app name, language, role, phone verification, hearts, sign out.
import {
  screen, el, icon, t, go, api, toast, state, setLang, setMe, topBar, heartPills, roleLabel, resizeImage,
  registerStrings, LANGS, LANG_NATIVE, ROLES, findContactDetails, charCount,
} from '../core.js';
import { phoneVerifier, blankPhone } from './create-profile.js';

const MAX_PHOTOS = 3;
let phoneModel = blankPhone(); // keeps a half-finished phone check across re-renders

function nameProblem(value) {
  const name = value.trim().replace(/\s+/g, ' ');
  const n = charCount(name);
  if (n < 2 || n > 24) return t('me_name_length');
  if (!findContactDetails(name).ok) return t('me_name_contact');
  return null;
}

const errText = (err) => (err.status === 0 ? t('err_network') : t('err_generic'));

screen('/me', async ({ root }) => {
  root.classList.add('me');
  root.append(topBar({ left: 'back', title: t('me_title') }));
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
  const file = el('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
  const slots = el('div', { class: 'photo-slots' });
  let busy = false;
  function paintPhotos() {
    const urls = state.me.photos || [];
    slots.replaceChildren(...Array.from({ length: MAX_PHOTOS }, (_, i) => {
      const url = urls[i];
      if (!url) {
        return el('button', {
          type: 'button', class: ['photo-slot', 'empty', busy && 'busy'], disabled: busy, 'aria-label': t('me_add_photo'),
          on: { click: () => file.click() },
        }, icon('plus', 22));
      }
      return el('div', { class: ['photo-slot', busy && 'busy'] },
        el('img', { src: url, alt: i === 0 ? t('me_face') : '' }),
        i === 0 ? el('span', { class: 'slot-tag' }, t('me_face')) : null,
        urls.length > 1
          ? el('button', { type: 'button', class: 'slot-remove', disabled: busy, 'aria-label': t('me_remove_photo'), on: { click: () => removePhoto(i) } }, icon('close', 14))
          : null);
    }));
  }
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f || busy) return;
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
      const r = await api.post('/me/photos', { photo });
      setMe(r.user);
    } catch (err) {
      toast(err.code === 'too_many_photos' ? t('me_photos_full') : err.data?.field === 'photo' ? t('me_photo_error') : errText(err));
    } finally {
      busy = false;
      paintPhotos();
    }
  });
  async function removePhoto(i) {
    if (busy) return;
    busy = true;
    paintPhotos();
    try {
      const r = await api.del(`/me/photos/${i}`);
      setMe(r.user);
    } catch (err) {
      toast(err.code === 'last_photo' ? t('me_last_photo') : errText(err));
    } finally {
      busy = false;
      paintPhotos();
    }
  }
  paintPhotos();

  // --- app name
  const nameErr = el('p', { class: 'field-error', role: 'alert', hidden: true });
  const nameInput = el('input', { class: 'input', id: 'me-name', type: 'text', maxlength: '40', autocomplete: 'nickname', value: me.name || '' });
  const saveName = el('button', { type: 'button', class: 'btn btn-secondary', disabled: true }, t('me_save'));
  const paintName = () => {
    const value = nameInput.value;
    const problem = value.trim() ? nameProblem(value) : t('me_name_length');
    const changed = value.trim().replace(/\s+/g, ' ') !== me.name;
    nameErr.textContent = changed && problem ? problem : '';
    nameErr.hidden = !(changed && problem);
    nameInput.classList.toggle('is-error', Boolean(changed && problem));
    saveName.disabled = !changed || Boolean(problem);
  };
  nameInput.addEventListener('input', paintName);
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !saveName.disabled) saveName.click(); });
  saveName.addEventListener('click', async () => {
    saveName.disabled = true;
    try {
      const r = await api.patch('/me', { name: nameInput.value.trim().replace(/\s+/g, ' ') });
      setMe(r.user);
      me.name = r.user.name;
      nameInput.value = r.user.name;
      paintName();
      toast(t('me_saved'));
    } catch (err) {
      saveName.disabled = false;
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
  }, LANG_NATIVE[code]));

  // --- role
  const roleSel = el('select', {
    class: 'select', id: 'me-role',
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

  // --- verification + phone
  const v = me.verified || {};
  const chips = el('div', { class: 'vchips' }, [['phone', t('me_v_phone')], ['gmail', 'Gmail'], ['facebook', 'Facebook']].map(([key, label]) =>
    el('span', { class: ['vchip', v[key] ? 'on' : 'off'] }, v[key] ? icon('check', 13) : null, label)));
  let phoneBlock;
  if (v.phone && me.phone) {
    phoneBlock = el('p', { class: 'kv' }, icon('check', 16), el('span', { class: 'mono' }, me.phone));
  } else {
    phone = phoneVerifier(phoneModel, {
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
      el('p', { class: 'lock-note' }, icon('lock', 14), el('span', {}, t('me_phone_needed'))), phone.node);
  }

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

  const place = [me.area, me.city].filter((x, i, a) => x && a.indexOf(x) === i).join(', ');
  const section = (labelText, ...kids) => el('section', { class: 'section' }, labelText ? el('span', { class: 'label ink' }, labelText) : null, kids);

  body.replaceChildren(
    section(t('me_photos'), slots, el('p', { class: 'help' }, t('me_photos_note')), file),
    el('section', { class: 'section' },
      el('div', { class: 'field-head' }, el('label', { class: 'label ink', for: 'me-name' }, t('me_app_name')),
        el('span', { class: 'tag tag-filled' }, icon('eye', 11), t('me_tag_shown'))),
      el('div', { class: 'inline-row' }, nameInput, saveName), nameErr),
    section(t('me_language'), el('div', { class: 'lang-grid' }, langBtns), el('p', { class: 'help' }, t('me_language_note'))),
    el('section', { class: 'section' }, el('label', { class: 'label ink', for: 'me-role' }, t('me_role')), roleSel),
    section(t('me_verified_with'), chips, phoneBlock),
    section(t('me_hearts'), el('div', { class: 'row', style: { '--gap': '12px' } }, heartPills(me.hearts, 'lg')),
      place ? el('p', { class: 'kv' }, icon('pin', 16), el('span', {}, place)) : null),
    signOut,
    el('p', { class: 'label me-foot' }, `30+DA · ${me.id}`));

  return () => phone?.destroy();
});

registerStrings({
  en: {
    me_title: 'My profile',
    me_photos: 'Photos',
    me_photos_note: 'Your first photo is your face. Extra photos are shown only at Level 3.',
    me_face: 'Face',
    me_add_photo: 'Add photo',
    me_remove_photo: 'Remove photo',
    me_photo_error: 'This photo could not be used. Try another one.',
    me_photos_full: 'You can have 3 photos.',
    me_last_photo: 'Keep at least one photo of your face.',
    me_app_name: 'App name',
    me_tag_shown: 'Shown',
    me_name_length: 'Use 2 to 24 characters.',
    me_name_contact: 'No phone numbers, emails or chat handles in your name.',
    me_save: 'Save',
    me_saved: 'Saved',
    me_language: 'Language',
    me_language_note: 'The app and other people’s messages are shown in this language.',
    me_role: 'You are',
    me_verified_with: 'Verified with',
    me_v_phone: 'Phone',
    me_phone_needed: 'Your phone number is needed to chat at Level 3.',
    me_phone_done: 'Phone verified',
    me_switched: 'Signed in as {name}',
    me_hearts: 'Your hearts',
    me_signout: 'Sign out',
  },
  km: {
    me_title: 'ប្រវត្តិរូបរបស់ខ្ញុំ',
    me_photos: 'រូបថត',
    me_photos_note: 'រូបទីមួយគឺជារូបមុខរបស់អ្នក។ រូបបន្ថែមបង្ហាញតែនៅកម្រិត 3 ប៉ុណ្ណោះ។',
    me_face: 'មុខ',
    me_add_photo: 'បន្ថែមរូបថត',
    me_remove_photo: 'លុបរូបថត',
    me_photo_error: 'មិនអាចប្រើរូបថតនេះបានទេ។ សូមសាកល្បងរូបផ្សេង។',
    me_photos_full: 'អ្នកអាចមានរូបថតបាន 3 សន្លឹក។',
    me_last_photo: 'សូមទុករូបថតមុខយ៉ាងហោចណាស់មួយសន្លឹក។',
    me_app_name: 'ឈ្មោះក្នុងកម្មវិធី',
    me_tag_shown: 'បង្ហាញ',
    me_name_length: 'សូមប្រើពី 2 ដល់ 24 តួអក្សរ។',
    me_name_contact: 'កុំដាក់លេខទូរស័ព្ទ អ៊ីមែល ឬឈ្មោះគណនីជជែក ក្នុងឈ្មោះរបស់អ្នក។',
    me_save: 'រក្សាទុក',
    me_saved: 'បានរក្សាទុក',
    me_language: 'ភាសា',
    me_language_note: 'កម្មវិធី និងសាររបស់អ្នកដទៃ នឹងបង្ហាញជាភាសានេះ។',
    me_role: 'អ្នកជា',
    me_verified_with: 'បានផ្ទៀងផ្ទាត់ជាមួយ',
    me_v_phone: 'ទូរស័ព្ទ',
    me_phone_needed: 'ត្រូវការលេខទូរស័ព្ទរបស់អ្នក ដើម្បីជជែកនៅកម្រិត 3។',
    me_phone_done: 'បានផ្ទៀងផ្ទាត់លេខទូរស័ព្ទ',
    me_switched: 'បានចូលជា {name}',
    me_hearts: 'បេះដូងរបស់អ្នក',
    me_signout: 'ចាកចេញ',
  },
  zh: {
    me_title: '我的资料',
    me_photos: '照片',
    me_photos_note: '第一张是你的正脸照。其他照片只在等级 3 显示。',
    me_face: '正脸',
    me_add_photo: '添加照片',
    me_remove_photo: '删除照片',
    me_photo_error: '这张照片无法使用，请换一张。',
    me_photos_full: '最多可以放 3 张照片。',
    me_last_photo: '请至少保留一张正脸照。',
    me_app_name: '应用昵称',
    me_tag_shown: '公开',
    me_name_length: '请使用 2 到 24 个字符。',
    me_name_contact: '名字中不能包含电话、邮箱或聊天账号。',
    me_save: '保存',
    me_saved: '已保存',
    me_language: '语言',
    me_language_note: '应用界面和别人发来的消息都会用这种语言显示。',
    me_role: '你的身份',
    me_verified_with: '已验证方式',
    me_v_phone: '手机',
    me_phone_needed: '在等级 3 聊天需要验证手机号。',
    me_phone_done: '手机号已验证',
    me_switched: '已登录为 {name}',
    me_hearts: '你的心',
    me_signout: '退出登录',
  },
  ko: {
    me_title: '내 프로필',
    me_photos: '사진',
    me_photos_note: '첫 번째 사진은 얼굴 사진이에요. 추가 사진은 레벨 3에서만 보여요.',
    me_face: '얼굴',
    me_add_photo: '사진 추가',
    me_remove_photo: '사진 삭제',
    me_photo_error: '이 사진은 사용할 수 없어요. 다른 사진을 골라 주세요.',
    me_photos_full: '사진은 3장까지 올릴 수 있어요.',
    me_last_photo: '얼굴 사진은 최소 1장 있어야 해요.',
    me_app_name: '앱 이름',
    me_tag_shown: '공개',
    me_name_length: '2~24자로 입력해 주세요.',
    me_name_contact: '이름에 전화번호, 이메일, 메신저 아이디를 넣을 수 없어요.',
    me_save: '저장',
    me_saved: '저장했어요',
    me_language: '언어',
    me_language_note: '앱 화면과 다른 사람의 메시지가 이 언어로 보여요.',
    me_role: '하는 일',
    me_verified_with: '인증 수단',
    me_v_phone: '전화',
    me_phone_needed: '레벨 3에서 채팅하려면 전화번호가 필요해요.',
    me_phone_done: '전화번호 인증 완료',
    me_switched: '{name}님으로 로그인했어요',
    me_hearts: '내 하트',
    me_signout: '로그아웃',
  },
  ja: {
    me_title: 'マイプロフィール',
    me_photos: '写真',
    me_photos_note: '1枚目は顔写真です。追加の写真はレベル3でのみ表示されます。',
    me_face: '顔写真',
    me_add_photo: '写真を追加',
    me_remove_photo: '写真を削除',
    me_photo_error: 'この写真は使えません。別の写真をお試しください。',
    me_photos_full: '写真は3枚までです。',
    me_last_photo: '顔写真は少なくとも1枚必要です。',
    me_app_name: 'アプリ名',
    me_tag_shown: '表示',
    me_name_length: '2〜24文字で入力してください。',
    me_name_contact: '名前に電話番号・メール・チャットIDは入れられません。',
    me_save: '保存',
    me_saved: '保存しました',
    me_language: '言語',
    me_language_note: 'アプリの表示と相手からのメッセージがこの言語になります。',
    me_role: 'お仕事・状況',
    me_verified_with: '確認済み',
    me_v_phone: '電話',
    me_phone_needed: 'レベル3でチャットするには電話番号が必要です。',
    me_phone_done: '電話番号を確認しました',
    me_switched: '{name}さんとしてログインしました',
    me_hearts: 'あなたのハート',
    me_signout: 'ログアウト',
  },
});
