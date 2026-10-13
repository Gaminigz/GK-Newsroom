// 30+DA super admin · Code — the four ways people sign in, and the keys each one needs:
// Telegram and WhatsApp send the sign-in code: offered in the app only once a test code went through since the
// keys were saved, and stopped again by a lasting failure (no balance, bad token, template). Google and Facebook
// sign people in once their keys are saved; "Try sign-in" runs the real sign-in in a new tab and ends on a small
// "Works ✓" page (no profile made). The server never sends a secret back: only its last 4 characters
// (last4 / masks); the plain boxes (WhatsApp phone number ID + template, Google client ID, Facebook app ID) come
// back as saved.
const API = '/30da/admin/api/connections';
const $ = (id) => document.getElementById(id);

const state = { data: null, busy: false, test: {}, testPhone: {} };

// ---------- dom ----------
function h(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'value') node.value = v;
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid);
  return node;
}

const LOGOS = {
  telegram: '<path d="M20.5 4.2 2.9 11c-.8.3-.8 1.4 0 1.7l4.3 1.4 1.7 5.3c.2.7 1.1.9 1.6.4l2.5-2.4 4.4 3.2c.6.4 1.4.1 1.6-.6L21.9 5.6c.2-.9-.6-1.7-1.4-1.4Z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/><path d="m7.2 14.1 9.6-6.3-6.9 7.4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/>',
  whatsapp: '<path d="M4 20l1.2-4A8.5 8.5 0 1 1 8 18.8L4 20Z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/><path d="M9.2 8.4c.3-.4.8-.4 1 0l.7 1.5c.1.3 0 .6-.2.8l-.4.4c.5 1 1.3 1.8 2.3 2.3l.4-.4c.2-.2.5-.3.8-.2l1.5.7c.4.2.4.7 0 1-.6.6-1.5.9-2.3.6-2.1-.8-3.7-2.4-4.5-4.5-.3-.8 0-1.7.7-2.2Z" fill="currentColor"/>',
  google: '<path d="M20.5 12.2h-8.2M20.5 12.2a8.5 8.5 0 1 1-2.5-6" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/>',
  facebook: '<path d="M14.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.5-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.8 1.4-3.8 4v2.2H9v3h2.5V21" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/>',
};
function logo(id) {
  const t = document.createElement('template');
  t.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">${LOGOS[id] || ''}</svg>`;
  return h('span', { class: `cx-logo ${id}` }, t.content.firstChild);
}

// ---------- api ----------
async function call(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      // Every write is JSON: the server refuses form-style bodies (cross-site form posts).
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    return { status: 0, ok: false, data: { error: 'Could not reach the server. Check the connection and try again.' } };
  }
  if (res.status === 401) {
    location.href = '/30da/admin';
    throw new Error('signed out');
  }
  return { status: res.status, ok: res.ok, data: await res.json().catch(() => ({})) };
}

// ---------- helpers ----------
const when = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const NAMES = { telegram: 'Telegram', whatsapp: 'WhatsApp', google: 'Google', facebook: 'Facebook' };
const REASON_WORDS = {
  not_on_telegram: 'number not on Telegram',
  not_on_whatsapp: 'number not on WhatsApp',
  not_allowed: 'phone not on the test number\'s list',
  template: 'template not approved',
  bad_token: 'bad token',
  no_balance: 'no balance',
  not_set: 'not set up',
  other: 'other',
};
const reasonWords = (channel, reason) => (channel === 'whatsapp' && reason === 'no_balance' ? 'payment problem' : REASON_WORDS[reason] || reason);
/** "+85512345678" → "+855 12 345 678" (other countries: as stored). */
function prettyPhone(p) {
  const m = String(p || '').match(/^\+855(\d{2})(\d{3})(\d{3,4})$/);
  return m ? `+855 ${m[1]} ${m[2]} ${m[3]}` : String(p || '');
}

let toastTimer;
function toast(text, ms = 5000) {
  const t = $('toast');
  t.replaceChildren(h('span', { text }));
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

function row(label, ...value) {
  return h('div', { class: 'cx-row' }, h('dt', { class: 'label', text: label }), h('dd', {}, ...value));
}

const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer', text });

/** A password box with a Show / Hide switch. */
function secretInput(attrs) {
  const input = h('input', { class: 'input cx-mono', type: 'password', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', ...attrs });
  const show = h('button', {
    type: 'button', class: 'link show-btn', 'aria-controls': attrs.id, 'aria-pressed': 'false', disabled: attrs.disabled,
    on: {
      click: () => {
        const on = input.type === 'password';
        input.type = on ? 'text' : 'password';
        show.textContent = on ? 'Hide' : 'Show';
        show.setAttribute('aria-pressed', String(on));
      },
    },
  }, 'Show');
  return { input, wrap: h('div', { class: 'input-wrap' }, input, show) };
}

/** Red, whenever test mode is on: on-screen codes let anyone sign in as any number. */
function devWarning(data) {
  if (!data.devAuth) return '';
  if (data.testCodes) {
    return 'Test mode is on: codes show on the screen, so anyone can sign in with any number. Ask your developer to turn test mode off before real people join.';
  }
  return 'Test mode is still on, so the Google and Facebook buttons let people in without checking. Ask your developer to turn test mode off.';
}

function lastSendLine(s, channel) {
  if (!s) return null;
  if (s.ok) return row('Last code to a user', h('span', { class: 'cx-ok', text: `Sent ${when(s.at)}` }));
  return row('Last code to a user', h('span', { class: 'cx-bad', text: `Failed ${when(s.at)}` }),
    ` · ${reasonWords(channel, s.reason)}${s.detail ? ` (${s.detail})` : ''}`);
}

function codeStatus(c) {
  if (c.set && !c.readable) return { pill: 'warn', text: 'Needs attention' };
  if (c.live && c.offered) return { pill: 'live', text: 'Live' };
  if (c.live && c.offer?.state === 'stopped') return { pill: 'warn', text: 'Stopped' };
  if (c.live) return { pill: 'saved', text: 'Saved · not tested' };
  return { pill: 'off', text: 'Not set' };
}

/** Why a channel was stopped, in plain words, and where to fix it. */
const STOP_WORDS = {
  telegram: {
    bad_token: 'Telegram did not accept the token',
    no_balance: 'the Telegram Gateway account has no balance left',
  },
  whatsapp: {
    bad_token: 'WhatsApp did not accept the access token',
    template: 'Meta has not approved the message template, or it is missing',
    no_balance: 'there is a payment problem on the Meta business account',
  },
};
const FIX_IN = { telegram: 'Telegram (gateway.telegram.org)', whatsapp: 'Meta' };
const stopWords = (c) => STOP_WORDS[c.id]?.[c.offer?.reason] || `${NAMES[c.id]} refused the codes`;

function unreadableLine(c, what) {
  return [h('b', { text: `Saved ${when(c.updatedAt)}, but this server cannot read it.` }),
    ` The server's lock key changed since it was saved. Paste and save the ${what} again.`];
}

// ---------- test send (Telegram, WhatsApp) ----------

const TEST_FROM = {
  telegram: 'in Telegram (from "Verification Codes")',
  whatsapp: 'in WhatsApp',
};

function testResult(c) {
  const r = state.test[c.id];
  const name = NAMES[c.id];
  if (!r) return null;
  if (r.sending) return h('p', { class: 'cx-result', text: `Sending a test code to ${prettyPhone(r.phone)}…` });
  if (r.ok) {
    // Type back the code that arrived: a ✓ proves the whole loop works end to end.
    const input = h('input', {
      type: 'text', inputmode: 'numeric', maxlength: '6', autocomplete: 'one-time-code', class: 'input cx-mono cx-check-input',
      placeholder: '6-digit code', 'aria-label': `The code you got in ${name}`, value: r.typed || '',
    });
    const verdict = r.checked == null ? null
      : r.checked
        ? h('p', { class: 'cx-check ok' }, h('b', { text: '✓ Correct. ' }), `${name} codes reach the phone — sign-in codes are working.`)
        : h('p', { class: 'cx-check bad' }, h('b', { text: '✗ Not the same code. ' }), `Check the latest code message in ${name}.`);
    const check = h('form', {
      class: 'cx-check-row', novalidate: true,
      on: {
        submit: (e) => {
          e.preventDefault();
          const typed = input.value.replace(/\D/g, '');
          state.test[c.id] = { ...r, typed, checked: typed === r.code };
          render(state.data);
        },
      },
    }, input, h('button', { type: 'submit', class: 'btn cx-test-btn' }, 'Check'));
    const money = c.id === 'telegram'
      ? [r.cost != null ? ` · cost US$${r.cost}` : '', r.balance != null ? ` · balance left US$${r.balance}` : ''] : [];
    return h('div', { class: 'cx-result ok' },
      h('p', {}, h('b', { text: 'Sent. ' }), `A code is on its way to ${prettyPhone(r.phone)} ${TEST_FROM[c.id]}. Type it here:`),
      c.offered ? h('p', { class: 'cx-fine' }, `${name} codes are now offered in the app.`) : null,
      check, verdict,
      h('p', { class: 'cx-fine' }, `${name} message id ${r.requestId || '–'}`, ...money, ' · this test code does not sign anyone in.'));
  }
  return h('div', { class: 'cx-result bad' },
    h('p', {}, h('b', { text: 'Not sent. ' }), r.error || 'Something went wrong.'),
    r.reason || r.detail ? h('p', { class: 'cx-fine' }, r.reason ? `Reason: ${reasonWords(c.id, r.reason)}` : '',
      r.detail ? `${r.reason ? ' · ' : ''}${name} said: ${r.detail}` : '') : null);
}

function testBlock(c, { help }) {
  const phoneId = c.id === 'telegram' ? 'tg-phone' : 'wa-phone';
  const sending = Boolean(state.test[c.id]?.sending);
  const phone = h('input', {
    class: 'input cx-mono', type: 'tel', id: phoneId, inputmode: 'tel', autocomplete: 'off', maxlength: '24',
    value: state.testPhone[c.id] ?? '+855 ', placeholder: '+855 12 345 678', 'aria-label': `Phone number for the ${NAMES[c.id]} test code`,
    on: { input: () => { state.testPhone[c.id] = phone.value; } },
  });
  const testBtn = h('button', { type: 'submit', class: 'btn cx-test-btn', disabled: sending || !c.live }, sending ? 'Sending…' : 'Send test code');
  const testForm = h('form', {
    class: 'cx-test-row', novalidate: true,
    on: {
      submit: async (e) => {
        e.preventDefault();
        if (state.test[c.id]?.sending) return;
        const value = phone.value.trim();
        state.test[c.id] = { sending: true, phone: value };
        render(state.data);
        const r = await call('POST', `${API}/${c.id}/test`, { phone: value });
        const { view, ...result } = r.data;
        state.test[c.id] = { ...result, ok: r.ok, phone: result.phone || value, error: r.ok ? null : result.error };
        // The answer carries the page's fresh data: a test that went through turns the channel on in the app.
        render(view?.connections ? view : state.data);
        $(phoneId)?.focus();
      },
    },
  }, phone, testBtn);
  return h('div', { class: 'cx-test' },
    h('h3', { text: 'Send test code' }),
    h('p', { class: 'cx-help' }, c.live ? `${help} The app offers ${NAMES[c.id]} only after a test code goes through.`
      : 'Save first. Then send a real code to your own phone to check it works.'),
    testForm,
    testResult(c));
}

// ---------- Telegram ----------

function tokenLine(c) {
  if (c.set && !c.readable) return unreadableLine(c, 'token');
  if (c.set) {
    return [h('b', { text: 'Set' }), ' · token ends ', h('code', { class: 'cx-mono', text: `…${c.last4}` }),
      ` · saved ${when(c.updatedAt)} · ${c.updatedBy || 'superadmin'}`];
  }
  if (c.envFallback) {
    return [h('b', { text: 'Not set here' }), ' · using a token set on the server (ends ',
      h('code', { class: 'cx-mono', text: `…${c.envFallback.last4}` }), ') until a token is saved here.'];
  }
  return [h('b', { text: 'Not set' })];
}

function codeAppLine(c, { testCodes }, name, what) {
  if (c.live && c.offered) return `Working: people who pick ${name} get their code in ${name}.`;
  if (c.live && c.offer?.state === 'stopped') {
    return [h('b', { class: 'cx-bad', text: `Stopped: ${stopWords(c)}.` }), ` Fix it in ${FIX_IN[c.id]}, then send a test code. Until then the app shows ${name} dimmed.`];
  }
  if (c.live) return [h('b', { text: 'Not offered in the app yet — send a test code first.' }), ` Once a test code reaches your phone, people can pick ${name}.`];
  if (c.set) return `No ${name} codes go out until the ${what} ${what.endsWith('s') ? 'are' : 'is'} saved again.`;
  if (testCodes) return `Test mode: the code shows on the screen until a code channel is saved.`;
  return `People cannot get a code by ${name} until the ${what} ${what.endsWith('s') ? 'are' : 'is'} saved. The app shows ${name} dimmed, “Coming soon”.`;
}

function telegramCard(c, data) {
  const { keyReady } = data;
  const st = codeStatus(c);
  const err = h('p', { class: 'cx-err', id: 'tg-token-err', role: 'alert', hidden: true });
  const { input, wrap } = secretInput({
    id: 'tg-token', name: 'tg-token', placeholder: c.set ? 'Paste a new token to replace it' : 'Paste the API token',
    'aria-describedby': 'tg-token-help tg-token-err', disabled: !keyReady, 'data-draft': 'telegram',
  });
  const save = h('button', { type: 'submit', class: 'btn-primary cx-save', disabled: !keyReady }, c.set ? 'Replace token' : 'Save token');
  const remove = c.set ? h('button', { type: 'button', class: 'link cx-remove', on: { click: () => removeConnection('telegram') } }, 'Remove') : null;
  input.addEventListener('input', () => { err.hidden = true; input.classList.remove('is-error'); });

  const form = h('form', {
    class: 'cx-form', novalidate: true,
    on: {
      submit: async (e) => {
        e.preventDefault();
        if (state.busy) return;
        const token = input.value.trim();
        if (!token) {
          err.textContent = 'Paste the token first.';
          err.hidden = false;
          input.classList.add('is-error');
          input.focus();
          return;
        }
        state.busy = true;
        save.disabled = true;
        save.textContent = 'Saving…';
        const r = await call('PUT', `${API}/telegram`, { token });
        state.busy = false;
        if (!r.ok) {
          save.disabled = false;
          save.textContent = c.set ? 'Replace token' : 'Save token';
          err.textContent = r.data.error || 'Could not save the token.';
          err.hidden = false;
          input.classList.add('is-error');
          input.focus();
          return;
        }
        state.test.telegram = null;
        render(r.data, { fresh: 'telegram' });
        const tg = r.data.connections.find((x) => x.id === 'telegram');
        toast(`Telegram token saved · ends …${tg.last4}. Send a test code to check it.`);
        $('tg-phone')?.focus();
      },
    },
  },
  h('label', { class: 'field', for: 'tg-token' }, h('span', { class: 'label', text: 'Telegram Gateway API token' })),
  wrap,
  h('p', { class: 'cx-help', id: 'tg-token-help' }, 'Get the token at ', link('https://gateway.telegram.org', 'gateway.telegram.org'), ' → API token.'),
  err,
  h('div', { class: 'cx-actions' }, save, remove));

  return h('section', { class: 'panel cx-card cx-main', 'aria-labelledby': 'cx-telegram' },
    h('div', { class: 'cx-head' }, logo('telegram'),
      h('div', { class: 'cx-title' }, h('h2', { id: 'cx-telegram', text: 'Telegram' }),
        h('p', { class: 'cx-sub', text: 'Sign-in codes by Telegram message (Telegram Gateway)' })),
      h('span', { class: `cx-pill ${st.pill}`, text: st.text })),
    h('dl', { class: 'cx-status' },
      row('Token', ...tokenLine(c)),
      row('In the app', codeAppLine(c, data, 'Telegram', 'token')),
      lastSendLine(c.lastSend, 'telegram')),
    h('div', { class: 'cx-split' },
      form,
      testBlock(c, { help: 'Sends a real 6-digit code by Telegram to this number with the token in use (about US$0.01 each).' })));
}

// ---------- WhatsApp, Google, Facebook: several boxes saved together ----------

/**
 * Each card's boxes. secret → a password box, shown back only as its last 4; left empty it keeps the saved one.
 * help → where to find the value (plain words).
 */
const FIELD_CARDS = {
  whatsapp: {
    title: 'WhatsApp',
    sub: 'Sign-in codes by WhatsApp message (sent through Meta)',
    what: 'keys',
    fields: [
      {
        key: 'token', label: 'Access token', secret: true, placeholder: 'Paste the permanent access token',
        help: ['Meta Business settings → Users → System users → your system user → Generate token. Choose “Never” for when it ends, and tick the two WhatsApp permissions.'],
      },
      {
        key: 'phoneNumberId', label: 'Phone number ID', placeholder: 'Only digits, e.g. 106540352242922', inputmode: 'numeric',
        help: [link('https://developers.facebook.com/apps', 'Meta for Developers'), ' → your app → WhatsApp → API setup → “Phone number ID” (not the phone number itself).'],
      },
      {
        key: 'templateName', label: 'Template name', placeholder: 'e.g. login_code',
        help: ['WhatsApp Manager → Message templates → an approved template of the “Authentication” kind with a “Copy code” button. Write its name exactly.'],
      },
      {
        key: 'templateLang', label: 'Template language', placeholder: 'en_US', fallback: 'en_US',
        help: ['The language of that template as Meta shows it. Keep en_US if you are not sure.'],
      },
    ],
  },
  google: {
    title: 'Google sign-in',
    sub: 'Sign in with a Google account',
    what: 'keys',
    // The console's own menu names, in quotes, so they can be found (Google sometimes calls this part “Google Auth Platform”).
    steps: [
      ['Open ', link('https://console.cloud.google.com/apis/credentials', 'console.cloud.google.com'), ' → APIs & Services.'],
      ['“OAuth consent screen”: choose External, give the app name 30+DA and your email, and paste the Privacy policy address below.'],
      ['Credentials → “Create credentials” → “OAuth client ID” → Web application.'],
      ['Under “Authorised redirect URIs” press Add URI and paste the redirect address below. Press Create.'],
      ['Copy the Client ID and Client secret it shows into the boxes here and press Save.'],
      ['Back on the consent screen (Audience), press “Publish app” so everyone can sign in, not only test users.'],
    ],
    redirectHelp: 'paste it in Google under “Authorised redirect URIs”',
    fields: [
      { key: 'clientId', label: 'Client ID', placeholder: '…apps.googleusercontent.com', help: ['Shown when the client is made (ends with .apps.googleusercontent.com).'] },
      { key: 'clientSecret', label: 'Client secret', secret: true, placeholder: 'Paste the Client secret', help: ['Shown next to the Client ID.'] },
    ],
  },
  facebook: {
    title: 'Facebook sign-in',
    sub: 'Sign in with a Facebook account',
    what: 'keys',
    steps: [
      ['In ', link('https://developers.facebook.com/apps', 'Meta for Developers'), ' make a separate app with the use case “Authenticate and request data from users with Facebook Login” (Meta will not put it in the WhatsApp app). In that use case, add the email permission.'],
      ['Facebook Login → Settings: paste the redirect address below in “Valid OAuth Redirect URIs” and save.'],
      ['App settings → Basic: copy the App ID and App secret (press Show) into the boxes here and press Save. On the same Meta page paste the Privacy policy and Data deletion addresses below.'],
      ['Switch the app to Live (at the top of the Meta page), so everyone can sign in, not only you.'],
    ],
    redirectHelp: 'paste it in Meta under Facebook Login → Settings → “Valid OAuth Redirect URIs”',
    fields: [
      { key: 'appId', label: 'App ID', placeholder: 'Only digits', inputmode: 'numeric', help: ['At the top of App settings → Basic.'] },
      { key: 'appSecret', label: 'App secret', secret: true, placeholder: 'Paste the App secret', help: ['Same page: App secret → press Show, then copy it.'] },
    ],
  },
};

/** The boxes + Save / Remove of one card. The plain boxes start filled with what is saved. */
function fieldsForm(c, data) {
  const card = FIELD_CARDS[c.id];
  const { keyReady } = data;
  const err = h('p', { class: 'cx-err', id: `${c.id}-err`, role: 'alert', hidden: true });
  const inputs = {};
  const boxes = card.fields.map((field) => {
    let f = field;
    const id = `${c.id}-${f.key}`;
    const helpId = `${id}-help`;
    let control;
    if (f.secret) {
      const masked = c.masks?.[f.key];
      const { input, wrap } = secretInput({
        id, name: id, disabled: !keyReady, 'data-draft': c.id, 'aria-describedby': `${helpId} ${c.id}-err`,
        placeholder: c.set && masked ? `Saved …${masked}` : f.placeholder,
      });
      inputs[f.key] = input;
      control = wrap;
      // Left empty, the saved secret stays: say so where the eye goes next.
      if (c.set && masked) f = { ...f, help: ['Leave it empty to keep the saved one, or paste a new one. ', ...f.help] };
    } else {
      const saved = c.fields?.[f.key];
      const input = h('input', {
        class: 'input cx-mono', type: 'text', id, name: id, autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off',
        inputmode: f.inputmode, placeholder: f.placeholder, disabled: !keyReady, 'data-draft': c.id, 'aria-describedby': `${helpId} ${c.id}-err`,
        value: saved || f.fallback || '',
      });
      inputs[f.key] = input;
      control = input;
    }
    return h('div', { class: 'cx-box' },
      h('label', { class: 'field', for: id }, h('span', { class: 'label', text: f.label })),
      control,
      h('p', { class: 'cx-help', id: helpId }, ...f.help));
  });
  for (const input of Object.values(inputs)) input.addEventListener('input', () => { err.hidden = true; input.classList.remove('is-error'); });

  const label = c.set ? 'Save changes' : 'Save';
  const save = h('button', { type: 'submit', class: 'btn-primary cx-save', disabled: !keyReady }, label);
  const remove = c.set ? h('button', { type: 'button', class: 'link cx-remove', on: { click: () => removeConnection(c.id) } }, 'Remove') : null;
  const fail = (field, text) => {
    err.textContent = text;
    err.hidden = false;
    const bad = inputs[field];
    if (bad) {
      bad.classList.add('is-error');
      bad.focus();
    }
  };

  return h('form', {
    class: 'cx-form', novalidate: true,
    on: {
      submit: async (e) => {
        e.preventDefault();
        if (state.busy) return;
        const body = Object.fromEntries(Object.entries(inputs).map(([k, input]) => [k, input.value.trim()]));
        // A secret box left empty keeps the saved secret; with nothing saved it must be filled in.
        const empty = card.fields.find((f) => !body[f.key] && !f.fallback && !(f.secret && c.set && c.readable && c.masks?.[f.key]));
        if (empty) return fail(empty.key, `Fill in “${empty.label}” first.`);
        state.busy = true;
        save.disabled = true;
        save.textContent = 'Saving…';
        const r = await call('PUT', `${API}/${c.id}`, body);
        state.busy = false;
        if (!r.ok) {
          save.disabled = false;
          save.textContent = label;
          return fail(r.data.field, r.data.error || 'Could not save.');
        }
        state.test[c.id] = null;
        render(r.data, { fresh: c.id });
        const now = r.data.connections.find((x) => x.id === c.id);
        toast(c.id === 'whatsapp'
          ? `WhatsApp keys saved · token ends …${now.masks?.token}. Send a test code to check them.`
          : `${NAMES[c.id]} keys saved · secret ends …${now.last4}. Press Try sign-in to check them.`);
        if (c.id === 'whatsapp') $('wa-phone')?.focus();
      },
    },
  },
  h('div', { class: `cx-boxes ${card.fields.length > 2 ? 'four' : 'two'}` }, boxes),
  err,
  h('div', { class: 'cx-actions' }, save, remove));
}

function keysLine(c) {
  if (c.set && !c.readable) return unreadableLine(c, 'keys');
  if (!c.set) return [h('b', { text: 'Not set' })];
  const secrets = Object.entries(c.masks || {}).map(([k, v]) => [` · ${k === 'token' ? 'token' : 'secret'} ends `, h('code', { class: 'cx-mono', text: `…${v}` })]);
  return [h('b', { text: 'Set' }), ...secrets.flat(), ` · saved ${when(c.updatedAt)} · ${c.updatedBy || 'superadmin'}`];
}

function whatsappCard(c, data) {
  const st = codeStatus(c);
  const f = c.fields || {};
  return h('section', { class: 'panel cx-card cx-main', 'aria-labelledby': 'cx-whatsapp' },
    h('div', { class: 'cx-head' }, logo('whatsapp'),
      h('div', { class: 'cx-title' }, h('h2', { id: 'cx-whatsapp', text: 'WhatsApp' }), h('p', { class: 'cx-sub', text: FIELD_CARDS.whatsapp.sub })),
      h('span', { class: `cx-pill ${st.pill}`, text: st.text })),
    h('dl', { class: 'cx-status' },
      row('Access token', ...keysLine(c)),
      c.set && c.readable ? row('Sends from', 'Phone number ID ', h('code', { class: 'cx-mono', text: f.phoneNumberId }),
        ' · template ', h('code', { class: 'cx-mono', text: f.templateName }), ` (${f.templateLang})`) : null,
      row('In the app', codeAppLine(c, data, 'WhatsApp', 'four boxes')),
      lastSendLine(c.lastSend, 'whatsapp')),
    h('div', { class: 'cx-split' },
      fieldsForm(c, data),
      testBlock(c, { help: 'Sends a real 6-digit code by WhatsApp to this number with the keys saved here (Meta charges a small fee per code).' })));
}

function signinStatus(c) {
  if (c.set && !c.readable) return { pill: 'warn', text: 'Needs attention' };
  if (!c.set) return { pill: 'off', text: 'Not set' };
  if (c.lastSend?.ok) return { pill: 'live', text: 'Working' };
  if (c.lastSend) return { pill: 'warn', text: c.lastSend.kind === 'try' ? 'Last try failed' : 'Needs attention' };
  return { pill: 'saved', text: 'Saved · not tried' };
}

/**
 * A good try proves only that the keys and the redirect address work: the owner got in. While the Google app is
 * in Testing (Facebook: Development mode) nobody else can, and that is decided on Google's / Facebook's own page,
 * so it never shows up here. Say so plainly.
 */
const ONLY_YOU = {
  google: 'If the Google app is still in Testing, only you and its test users can sign in. On Google’s consent screen press “Publish app” so everyone can.',
  facebook: 'If the Facebook app is still in Development mode, only you and people with a role on the app can sign in. Switch the app to Live in Meta so everyone can.',
};
/** A failure every sign-in will hit until it is fixed (not a cancel or a slow answer) — and what fixes it. */
const SETUP_FIX = {
  bad_keys: () => 'Copy the keys again and save them',
  redirect: (name) => `Add the redirect address in ${name}`,
  not_live: (name, id) => (id === 'google' ? 'Press “Publish app” on Google’s consent screen' : 'Switch the app to Live in Meta'),
};

function signinAppLine(c, data) {
  const name = NAMES[c.id];
  const s = c.lastSend;
  if (c.live) {
    if (s?.ok) return [h('b', { text: 'Keys work. ' }), ONLY_YOU[c.id]];
    if (s && SETUP_FIX[s.reason]) {
      return [h('b', { class: 'cx-bad', text: `The ${name} button is on in the app, but the last ${s.kind === 'try' ? 'try' : 'sign-in'} failed (${SIGNIN_REASON_WORDS[s.reason]}): people who tap it are sent back.` }),
        ` ${SETUP_FIX[s.reason](name, c.id)}, then press Try sign-in — or remove the keys to show “Coming soon”.`];
    }
    if (s) return `The ${name} button is on in the app. The last try did not finish (${SIGNIN_REASON_WORDS[s.reason] || s.reason}): press Try sign-in again to check it works.`;
    return `The ${name} button is on in the app. Press Try sign-in to check it works.`;
  }
  if (data.devAuth) return `Test mode: until the keys are saved, the ${name} button lets people in without checking.`;
  if (c.set) return `The keys cannot be read, so the app shows the ${name} button dimmed, “Coming soon”.`;
  return `The app shows the ${name} button dimmed, “Coming soon”, until the keys are saved.`;
}

const SIGNIN_REASON_WORDS = {
  cancelled: 'cancelled, or the account was not let in',
  bad_keys: 'wrong ID or secret',
  redirect: 'redirect address not added',
  not_live: 'app not live yet',
  expired: 'took too long',
  provider_error: 'a problem on their side',
  timeout: 'no answer in time',
  network: 'could not connect',
  other: 'refused',
};

/** "Last try: worked 13 Oct, 14:02" or why not (a real sign-in that hit a setup problem shows here too). */
function lastTryLine(c) {
  const s = c.lastSend;
  if (!s) return null;
  const label = s.kind === 'try' ? 'Last try' : 'Last sign-in';
  if (s.ok) return row(label, h('span', { class: 'cx-ok', text: `Worked ${when(s.at)}` }));
  return row(label, h('span', { class: 'cx-bad', text: `Did not work ${when(s.at)}` }),
    ` · ${SIGNIN_REASON_WORDS[s.reason] || s.reason}`, s.detail ? h('span', { class: 'cx-fine', text: ` · ${NAMES[c.id]} said: ${s.detail}` }) : null);
}

/** "Try sign-in": the real sign-in in a new tab, ending on a small result page. Nothing is made. */
function tryBlock(c) {
  const name = NAMES[c.id];
  const ready = c.live;
  return h('div', { class: 'cx-try' },
    h('h3', { text: 'Try sign-in' }),
    h('p', { class: 'cx-help' }, ready
      ? `Opens ${name} in a new tab. Sign in with your own account: the last page says “Works ✓” with the name ${name} gave, or what to fix. No profile is made.`
      : 'Save the keys first, then try them here.'),
    ready
      ? h('a', { class: 'btn cx-test-btn cx-try-btn', href: c.tryUrl, target: '_blank', rel: 'noopener' }, `Try ${name} sign-in`)
      : h('button', { type: 'button', class: 'btn cx-test-btn cx-try-btn', disabled: true }, `Try ${name} sign-in`));
}

function copyButton(text) {
  return h('button', {
    type: 'button', class: 'btn cx-copy-btn',
    on: {
      click: async () => {
        try {
          await navigator.clipboard.writeText(text);
          toast('Address copied.');
        } catch {
          toast('Select the address and copy it.');
        }
      },
    },
  }, 'Copy');
}

/** One address to paste into Google / Facebook, with its Copy button. */
function addressRow(label, help, value) {
  return h('div', { class: 'cx-redirect' },
    h('p', { class: 'cx-help' }, h('b', { text: `${label}` }), help ? ` — ${help}` : ''),
    h('div', { class: 'cx-copy-row' }, h('code', { class: 'cx-mono cx-address', text: value }), copyButton(value)));
}

function signinCard(c, data) {
  const card = FIELD_CARDS[c.id];
  const st = signinStatus(c);
  const f = c.fields || {};
  const idKey = card.fields[0].key;
  const where = c.id === 'google' ? 'in Google on the consent screen (“Application privacy policy link”)' : 'in Meta under App settings → Basic';
  return h('section', { class: 'panel cx-card cx-signin', 'aria-labelledby': `cx-${c.id}` },
    h('div', { class: 'cx-head' }, logo(c.id),
      h('div', { class: 'cx-title' }, h('h2', { id: `cx-${c.id}`, text: card.title }), h('p', { class: 'cx-sub', text: card.sub })),
      h('span', { class: `cx-pill ${st.pill}`, text: st.text })),
    h('dl', { class: 'cx-status' },
      row('Keys', ...keysLine(c)),
      c.set && c.readable ? row(card.fields[0].label, h('code', { class: 'cx-mono', text: f[idKey] })) : null,
      row('In the app', signinAppLine(c, data)),
      lastTryLine(c)),
    h('div', { class: 'cx-signin-body' },
      h('div', { class: 'cx-where' },
        h('p', { class: 'cx-help' }, h('b', { text: 'How to get the keys:' })),
        h('ol', { class: 'cx-steps' }, card.steps.map((step) => h('li', {}, ...step)))),
      addressRow('Redirect address', card.redirectHelp, c.redirect),
      addressRow('Privacy policy address', `paste it ${where}`, c.privacyUrl),
      c.id === 'facebook' ? addressRow('Data deletion address', 'paste it in Meta under App settings → Basic (“Data deletion instructions URL”)', c.deleteUrl)
        : addressRow('Data deletion address', 'how people have their data deleted (Google may ask for it too)', c.deleteUrl),
      fieldsForm(c, data),
      tryBlock(c)));
}

// ---------- remove ----------
const REMOVE_TEXT = {
  telegram: (devAuth) => `Remove the Telegram token?\n\nTelegram codes stop until a new token is saved.${devAuth ? ' In test mode codes then show on the screen instead.' : ''}`,
  whatsapp: () => 'Remove the WhatsApp keys?\n\nWhatsApp codes stop until all four boxes are saved again.',
  google: () => 'Remove the Google keys?\n\nThe Google button in the app goes back to “Coming soon”, and nobody can sign in with Google until keys are saved again.',
  facebook: () => 'Remove the Facebook keys?\n\nThe Facebook button in the app goes back to “Coming soon”, and nobody can sign in with Facebook until keys are saved again.',
};
async function removeConnection(id) {
  if (!confirm(REMOVE_TEXT[id](state.data?.devAuth))) return;
  const r = await call('DELETE', `${API}/${id}`, {});
  if (!r.ok) return toast(r.data.error || 'Could not remove it.');
  state.test[id] = null;
  render(r.data, { fresh: id });
  toast(id === 'telegram' ? 'Telegram token removed.' : `${NAMES[id]} keys removed.`);
}

// ---------- render ----------
function headline(data) {
  const codes = data.connections.filter((c) => c.kind === 'code');
  const offered = codes.filter((c) => c.live && c.offered).map((c) => c.name);
  const stopped = codes.filter((c) => c.live && c.offer?.state === 'stopped').map((c) => c.name);
  const untested = codes.filter((c) => c.live && c.offer?.state === 'untested').map((c) => c.name);
  const attention = data.connections.filter((c) => c.set && c.readable === false).map((c) => NAMES[c.id]);
  if (attention.length) return `${attention.join(' + ')} needs attention`;
  const parts = [];
  if (offered.length) parts.push(`Codes live: ${offered.join(' + ')}`);
  if (stopped.length) parts.push(`${stopped.join(' + ')} stopped`);
  if (untested.length) parts.push(`${untested.join(' + ')}: send a test code`);
  if (parts.length) return parts.join(' · ');
  return data.testCodes ? 'Test codes · nothing live yet' : 'No code channel live';
}

/** Re-draw every card. What was typed but not saved stays (except on the card just saved / removed: `fresh`). */
function render(data, { fresh = null } = {}) {
  state.data = data;
  const focused = document.activeElement?.id;
  const drafts = {};
  for (const input of document.querySelectorAll('[data-draft]')) {
    if (input.dataset.draft !== fresh && input.id) drafts[input.id] = input.value;
  }
  const byId = Object.fromEntries(data.connections.map((c) => [c.id, c]));
  $('key-banner').hidden = data.keyReady;
  $('key-banner').textContent = data.keyReady ? ''
    : 'The server\'s lock key is missing, so keys cannot be saved yet. Ask your developer to set it, then reload.';
  const warning = devWarning(data);
  $('dev-banner').hidden = !warning;
  $('dev-banner').textContent = warning;
  $('state').textContent = headline(data);
  $('cards').replaceChildren(
    telegramCard(byId.telegram, data),
    byId.whatsapp ? whatsappCard(byId.whatsapp, data) : null,
    h('div', { class: 'cx-pair' }, ['facebook', 'google'].filter((id) => byId[id]).map((id) => signinCard(byId[id], data))),
  );
  for (const [id, value] of Object.entries(drafts)) if ($(id)) $(id).value = value;
  if (focused && $(focused) && !$(focused).disabled) $(focused).focus();
}

$('signout').addEventListener('click', async () => {
  await fetch('/30da/admin/api/signout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  location.href = '/30da/admin';
});

// Back from the "Try sign-in" tab (or another tab): show the latest status. Typed boxes stay (render keeps drafts).
let refreshing = false;
window.addEventListener('focus', async () => {
  if (refreshing || state.busy || !state.data) return;
  refreshing = true;
  try {
    const r = await call('GET', API);
    if (r.ok) render(r.data);
  } catch { /* signed out: call() already moved on */ } finally {
    refreshing = false;
  }
});

(async () => {
  try {
    const r = await call('GET', API);
    if (!r.ok) throw new Error(r.data.error || 'Could not load the page.');
    render(r.data);
    // On a phone the side nav scrolls sideways: keep "Code" in view.
    document.querySelector('.navitem.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  } catch (e) {
    if (e.message !== 'signed out') $('state').textContent = e.message;
  }
})();
