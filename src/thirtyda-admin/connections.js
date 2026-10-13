// 30+DA super admin · Connections — how people get their sign-in code and how they sign in.
// Telegram (live once a Telegram Gateway API token is saved), then WhatsApp, Google and Facebook (coming next).
// The server never sends a token back: only { set, last4, updatedAt, updatedBy }.
const API = '/30da/admin/api/connections';
const $ = (id) => document.getElementById(id);

const state = { data: null, busy: false, test: null };

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
const REASON_WORDS = {
  not_on_telegram: 'number not on Telegram',
  bad_token: 'bad token',
  no_balance: 'no balance',
  not_set: 'no token',
  other: 'other',
};
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

// ---------- Telegram ----------
function telegramStatus(c) {
  if (c.set && !c.readable) return { pill: 'warn', text: 'Needs attention' };
  if (c.live) return { pill: 'live', text: 'Live' };
  return { pill: 'off', text: 'Not set' };
}

function tokenLine(c) {
  if (c.set && !c.readable) {
    return [h('b', { text: `Saved ${when(c.updatedAt)}, but this server cannot read it.` }),
      ' The server\'s lock key changed since it was saved. Paste and save the token again.'];
  }
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

function appLine(c, { testCodes }) {
  if (c.live) return 'Working: people who pick Telegram get their code in Telegram.';
  if (c.set) return 'No codes go out and none are shown on screen until the token is saved again.';
  if (testCodes) return 'Test mode: the code shows on the screen until a token is saved.';
  return 'People cannot get a code by Telegram until a token is saved.';
}

/** Red, whenever test mode is on: on-screen codes let anyone sign in as any number. */
function devWarning(data) {
  if (!data.devAuth) return '';
  if (data.testCodes) {
    return 'Test mode is on: codes show on the screen, so anyone can sign in with any number. Ask your developer to turn test mode off before real people join.';
  }
  return 'Test mode is still on, so the Google and Facebook buttons let people in without checking. Ask your developer to turn test mode off.';
}

function lastSendLine(s) {
  if (!s) return null;
  if (s.ok) return row('Last code to a user', h('span', { class: 'cx-ok', text: `Sent ${when(s.at)}` }));
  return row('Last code to a user', h('span', { class: 'cx-bad', text: `Failed ${when(s.at)}` }),
    ` · ${REASON_WORDS[s.reason] || s.reason}${s.detail ? ` (${s.detail})` : ''}`);
}

function testResult() {
  const r = state.test;
  if (!r) return null;
  if (r.sending) return h('p', { class: 'cx-result', text: `Sending a test code to ${prettyPhone(r.phone)}…` });
  if (r.ok) {
    // Type back the code that arrived in Telegram: a ✓ proves the whole loop works end to end.
    const input = h('input', {
      type: 'text', inputmode: 'numeric', maxlength: '6', autocomplete: 'one-time-code', class: 'input cx-mono cx-check-input',
      placeholder: '6-digit code', 'aria-label': 'The code you got in Telegram', value: r.typed || '',
    });
    const verdict = r.checked == null ? null
      : r.checked
        ? h('p', { class: 'cx-check ok' }, h('b', { text: '✓ Correct. ' }), 'Telegram codes reach the phone — sign-in codes are working.')
        : h('p', { class: 'cx-check bad' }, h('b', { text: '✗ Not the same code. ' }), 'Check the latest message from Verification Codes in Telegram.');
    const check = h('form', {
      class: 'cx-check-row', novalidate: true,
      on: {
        submit: (e) => {
          e.preventDefault();
          const typed = input.value.replace(/\D/g, '');
          state.test = { ...r, typed, checked: typed === r.code };
          render(state.data);
        },
      },
    }, input, h('button', { type: 'submit', class: 'btn cx-test-btn' }, 'Check'));
    return h('div', { class: 'cx-result ok' },
      h('p', {}, h('b', { text: 'Sent. ' }), `A code is on its way to ${prettyPhone(r.phone)} in Telegram (from "Verification Codes"). Type it here:`),
      check, verdict,
      h('p', { class: 'cx-fine' }, `Telegram request id ${r.requestId || '–'}`,
        r.cost != null ? ` · cost US$${r.cost}` : '', r.balance != null ? ` · balance left US$${r.balance}` : '',
        ' · this test code does not sign anyone in.'));
  }
  return h('div', { class: 'cx-result bad' },
    h('p', {}, h('b', { text: 'Not sent. ' }), r.error || 'Something went wrong.'),
    r.reason || r.detail ? h('p', { class: 'cx-fine' }, r.reason ? `Reason: ${REASON_WORDS[r.reason] || r.reason}` : '',
      r.detail ? `${r.reason ? ' · ' : ''}Telegram said: ${r.detail}` : '') : null);
}

function telegramCard(c, data) {
  const { keyReady } = data;
  const st = telegramStatus(c);
  const err = h('p', { class: 'cx-err', id: 'tg-token-err', role: 'alert', hidden: true });
  const input = h('input', {
    class: 'input cx-mono', type: 'password', id: 'tg-token', name: 'tg-token', autocomplete: 'off', spellcheck: 'false',
    autocapitalize: 'off', placeholder: c.set ? 'Paste a new token to replace it' : 'Paste the API token',
    'aria-describedby': 'tg-token-help tg-token-err', disabled: !keyReady,
  });
  const show = h('button', {
    type: 'button', class: 'link show-btn', 'aria-controls': 'tg-token', 'aria-pressed': 'false', disabled: !keyReady,
    on: {
      click: () => {
        const on = input.type === 'password';
        input.type = on ? 'text' : 'password';
        show.textContent = on ? 'Hide' : 'Show';
        show.setAttribute('aria-pressed', String(on));
      },
    },
  }, 'Show');
  const save = h('button', { type: 'submit', class: 'btn-primary cx-save', disabled: !keyReady }, c.set ? 'Replace token' : 'Save token');
  const remove = c.set ? h('button', { type: 'button', class: 'link cx-remove', on: { click: removeToken } }, 'Remove') : null;
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
        input.value = '';
        state.test = null;
        render(r.data);
        const tg = r.data.connections.find((x) => x.id === 'telegram');
        toast(`Telegram token saved · ends …${tg.last4}. Send a test code to check it.`);
        $('tg-phone')?.focus();
      },
    },
  },
  h('label', { class: 'field', for: 'tg-token' },
    h('span', { class: 'label', text: 'Telegram Gateway API token' })),
  h('div', { class: 'input-wrap' }, input, show),
  h('p', { class: 'cx-help', id: 'tg-token-help' }, 'Get the token at ',
    h('a', { href: 'https://gateway.telegram.org', target: '_blank', rel: 'noopener noreferrer', text: 'gateway.telegram.org' }),
    ' → API token.'),
  err,
  h('div', { class: 'cx-actions' }, save, remove));

  const phone = h('input', {
    class: 'input cx-mono', type: 'tel', id: 'tg-phone', inputmode: 'tel', autocomplete: 'off', maxlength: '24',
    value: state.testPhone ?? '+855 ', placeholder: '+855 12 345 678', 'aria-label': 'Phone number for the test code',
    on: { input: () => { state.testPhone = phone.value; } },
  });
  const testBtn = h('button', { type: 'submit', class: 'btn cx-test-btn', disabled: Boolean(state.test?.sending) || !c.live },
    state.test?.sending ? 'Sending…' : 'Send test code');
  const testForm = h('form', {
    class: 'cx-test-row', novalidate: true,
    on: {
      submit: async (e) => {
        e.preventDefault();
        if (state.test?.sending) return;
        const value = phone.value.trim();
        state.test = { sending: true, phone: value };
        render(state.data);
        const r = await call('POST', `${API}/telegram/test`, { phone: value });
        state.test = { ...r.data, ok: r.ok, phone: r.data.phone || value, error: r.ok ? null : r.data.error };
        render(state.data);
        $('tg-phone')?.focus();
      },
    },
  }, phone, testBtn);

  return h('section', { class: 'panel cx-card cx-main', 'aria-labelledby': 'cx-telegram' },
    h('div', { class: 'cx-head' }, logo('telegram'),
      h('div', { class: 'cx-title' }, h('h2', { id: 'cx-telegram', text: 'Telegram' }),
        h('p', { class: 'cx-sub', text: 'Sign-in codes by Telegram message (Telegram Gateway)' })),
      h('span', { class: `cx-pill ${st.pill}`, text: st.text })),
    h('dl', { class: 'cx-status' },
      row('Token', ...tokenLine(c)),
      row('In the app', appLine(c, data)),
      lastSendLine(c.lastSend)),
    h('div', { class: 'cx-split' },
      form,
      h('div', { class: 'cx-test' },
        h('h3', { text: 'Send test code' }),
        h('p', { class: 'cx-help' }, c.live
          ? 'Sends a real 6-digit code by Telegram to this number with the token in use (about US$0.01 each).'
          : 'Save a token first. Then send a real code to your own phone to check it works.'),
        testForm,
        testResult())));
}

async function removeToken() {
  const devAuth = state.data?.devAuth;
  const question = `Remove the Telegram token?\n\nTelegram codes stop until a new token is saved.${devAuth ? ' In test mode codes then show on the screen instead.' : ''}`;
  if (!confirm(question)) return;
  const r = await call('DELETE', `${API}/telegram`, {});
  if (!r.ok) return toast(r.data.error || 'Could not remove the token.');
  state.test = null;
  render(r.data);
  toast('Telegram token removed.');
}

// ---------- coming next ----------
const NEXT = {
  whatsapp: {
    sub: 'Sign-in codes by WhatsApp message',
    note: 'Next to set up. Until then people are asked to use Telegram.',
    field: 'WhatsApp access token',
  },
  google: { sub: 'Sign in with a Google account', note: 'Comes after WhatsApp.', field: 'Google client ID' },
  facebook: { sub: 'Sign in with a Facebook account', note: 'Comes after Google.', field: 'Facebook app ID' },
};
function nextCard(c) {
  const n = NEXT[c.id] || { sub: '', note: '', field: 'Token' };
  return h('section', { class: 'panel cx-card is-next', 'aria-labelledby': `cx-${c.id}`, 'aria-disabled': 'true' },
    h('div', { class: 'cx-head' }, logo(c.id),
      h('div', { class: 'cx-title' }, h('h2', { id: `cx-${c.id}`, text: c.name }), h('p', { class: 'cx-sub', text: n.sub })),
      h('span', { class: 'cx-pill next', text: 'Coming next' })),
    h('p', { class: 'cx-help', text: n.note }),
    h('div', { class: 'cx-next-row' },
      h('input', { class: 'input', type: 'password', disabled: true, placeholder: n.field, 'aria-label': `${n.field} (coming next)` }),
      h('button', { type: 'button', class: 'btn', disabled: true, text: 'Save' })));
}

// ---------- render ----------
function render(data) {
  state.data = data;
  const focused = document.activeElement?.id;
  const tokenDraft = $('tg-token')?.value ?? '';
  const tg = data.connections.find((c) => c.id === 'telegram');
  $('key-banner').hidden = data.keyReady;
  $('key-banner').textContent = data.keyReady ? ''
    : 'The server\'s lock key is missing, so tokens cannot be saved yet. Ask your developer to set it, then reload.';
  const warning = devWarning(data);
  $('dev-banner').hidden = !warning;
  $('dev-banner').textContent = warning;
  $('state').textContent = tg.live ? 'Telegram live' : tg.set ? 'Telegram needs attention' : data.testCodes ? 'Test codes · nothing live yet' : 'No code channel live';
  $('cards').replaceChildren(
    telegramCard(tg, data),
    h('div', { class: 'cx-next' }, data.connections.filter((c) => c.comingNext).map(nextCard)));
  if ($('tg-token')) $('tg-token').value = tokenDraft;
  if (focused && $(focused) && !$(focused).disabled) $(focused).focus();
}

$('signout').addEventListener('click', async () => {
  await fetch('/30da/admin/api/signout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  location.href = '/30da/admin';
});

(async () => {
  try {
    const r = await call('GET', API);
    if (!r.ok) throw new Error(r.data.error || 'Could not load the connections.');
    render(r.data);
    // On a phone the side nav scrolls sideways: keep "Connections" in view.
    document.querySelector('.navitem.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  } catch (e) {
    if (e.message !== 'signed out') $('state').textContent = e.message;
  }
})();
