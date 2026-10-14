// 30+DA super admin · Code — the sign-in and messaging hub (owner 2026-10-14): ten towers left to right, in the owner's
// order (1 TikTok, 2 Telegram Bot, 3 Telegram Gateway, 4 Facebook, 5 Google, 6 WhatsApp, 7 WeChat, 8 Alipay, 9 YouTube,
// 10 Apple; 7–9 are "Later" placeholders), each with the keys it needs. Tower 10 is Sign in with Apple (owner
// 2026-10-14): the sign-in needs no key; its key (Team ID, Key ID, the .p8) lets a deleted account end its Apple link. A strip at the top jumps to a tower; ‹ ›, the
// arrow keys and the slider move along; the last tower is remembered in this browser. Later all our apps use this hub.
// Telegram and WhatsApp send the sign-in code: offered in the app only once a test code went through since the
// keys were saved, and stopped again by a lasting failure (no balance, bad token, template). Google, Facebook and
// TikTok (owner 2026-10-13) sign people in once their keys are saved; "Try sign-in" runs the real sign-in in a new tab and ends on a small
// "Works ✓" page (no profile made). The Telegram Bot tower is the FREE 30+DA bot (owner 2026-10-13): one box, the
// bot key from @BotFather; Save checks it with Telegram (→ @username) and links the bot to this site; "Try the bot"
// turns it on in the app (people share their number with the bot, no code). The paid Gateway is the next tower, optional.
// The server never sends a secret back: only its last 4 characters
// (last4 / masks); the plain boxes (WhatsApp phone number ID + template, Google client ID, Facebook app ID, TikTok
// client key) come back as saved.
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
  // A plain music note (stem, round head, curled flag): our own drawing.
  tiktok: '<path d="M13.6 4.2v11.4M13.6 4.2c.5 2.6 2.4 4.3 5 4.6" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/><circle cx="10.2" cy="15.6" r="3.4" stroke="currentColor" stroke-width="1.7" fill="none"/>',
  // The "Later" towers, our own simple drawings: two chat bubbles, the 支 of Alipay, a play button, an apple.
  wechat: '<path d="M10 4.2c-4 0-7.2 2.6-7.2 5.9 0 1.9 1 3.5 2.6 4.6l-.6 2.2 2.6-1.3c.8.2 1.7.4 2.6.4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M15.6 9.6c3.1 0 5.6 2.1 5.6 4.6 0 1.4-.8 2.7-2 3.6l.5 1.8-2.1-1c-.6.2-1.3.3-2 .3-3.1 0-5.6-2.1-5.6-4.7s2.5-4.6 5.6-4.6Z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/><circle cx="7.4" cy="8.6" r=".95" fill="currentColor"/><circle cx="11.6" cy="8.6" r=".95" fill="currentColor"/><circle cx="13.7" cy="13.6" r=".8" fill="currentColor"/><circle cx="17.5" cy="13.6" r=".8" fill="currentColor"/>',
  alipay: '<rect x="3" y="3" width="18" height="18" rx="4.5" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M7 8.2h10M12 5.6v4.8M7.6 11.6h8.6c-1 3.6-4 6.3-8.4 7.2M10 11.8c1.4 3.2 4.1 5.6 7.6 6.6" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  youtube: '<rect x="2.6" y="5.6" width="18.8" height="12.8" rx="4" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M10.2 9.2v5.6l4.8-2.8-4.8-2.8Z" fill="currentColor"/>',
  apple: '<path d="M12 8.1c-1.1-.9-3.6-1.4-5.1.5-1.6 2-1.1 5.8.6 8.4 1 1.5 2 2.6 3.1 2.5.9-.1 1.1-.6 2.1-.6 1 0 1.3.5 2.1.6 1.2.1 2.2-1.1 3.1-2.5.6-.9 1-1.8 1.2-2.4-1.7-.8-2.5-3.3-1.1-5 .3-.4.6-.7 1-.9-1.5-1.9-4-1.7-5.2-.6Z" fill="currentColor"/><path d="M12.1 7.3c-.1-1.6 1.2-3.2 2.8-3.3.2 1.7-1.2 3.3-2.8 3.3Z" fill="currentColor"/>',
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
const NAMES = { telegram: 'Telegram', 'telegram-bot': 'Telegram bot', whatsapp: 'WhatsApp', google: 'Google', facebook: 'Facebook', tiktok: 'TikTok', apple: 'Apple' };
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

/** Tower 3: the paid Telegram Gateway (a 6-digit code). Optional: the free bot (tower 2) is enough for most. */
function telegramGatewayCard(c, data) {
  const { keyReady } = data;
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

  // Its own tower now (owner 2026-10-14); the free bot is tower 2. The status pill sits on the tower's top line.
  const bot = c.bot || { set: false };
  return h('section', { class: 'panel cx-card cx-main', 'aria-labelledby': 'cx-tg-gateway' },
    h('div', { class: 'cx-head' }, logo('telegram'),
      h('div', { class: 'cx-title' }, h('h2', { id: 'cx-tg-gateway' }, 'Telegram Gateway ', h('span', { class: 'cx-free cx-paid', text: 'paid' })),
        h('p', { class: 'cx-sub', text: 'A 6-digit code by Telegram · optional' }))),
    h('p', { class: 'cx-help cx-intro' }, 'Sends a 6-digit code instead of the bot. Every code costs money from a balance at gateway.telegram.org. Leave it empty if the bot is enough.'),
    h('dl', { class: 'cx-status' },
      row('Token', ...tokenLine(c)),
      row('In the app', !bot.offered ? codeAppLine(c, data, 'Telegram', 'token')
        : c.live ? 'Not used while the bot works (the bot is free). Kept as a spare.' : 'Not needed: the bot already lets people use Telegram.'),
      lastSendLine(c.lastSend, 'telegram')),
    h('div', { class: 'cx-split' },
      form,
      testBlock(c, { help: 'Sends a real 6-digit code by Telegram to this number with the token in use (about US$0.01 each).' })));
}

// ---------- tower 2: the free Telegram bot ----------

function botStatus(b) {
  if (b.set && !b.readable) return { pill: 'warn', text: 'Needs attention' };
  if (b.offered) return { pill: 'live', text: 'Live' };
  if (b.live && b.offer?.state === 'stopped') return { pill: 'warn', text: 'Stopped' };
  if (b.live) return { pill: 'saved', text: 'Saved · not tried' };
  return { pill: 'off', text: 'Not set' };
}

function botLine(b) {
  if (b.set && !b.readable) return unreadableLine(b, 'bot key');
  if (!b.set) return [h('b', { text: 'Not set' })];
  return [h('b', { text: 'Set' }), ' · ', b.link ? link(b.link, `@${b.username}`) : `@${b.username}`, ' · key ends ',
    h('code', { class: 'cx-mono', text: `…${b.last4}` }), ` · saved ${when(b.updatedAt)} · ${b.updatedBy || 'superadmin'}`];
}

/** Why the bot stopped, in plain words. */
const BOT_STOP_WORDS = {
  bad_token: 'Telegram no longer accepts the bot key',
  moved: 'the bot sends its messages somewhere else',
  no_hook: 'the bot is not linked to this site any more',
  hook_error: 'Telegram could not deliver the bot’s messages to this site',
  timeout: 'Telegram did not answer',
  network: 'Telegram could not be reached',
};

function botAppLine(b) {
  if (b.offered) return 'Working: people who tap Telegram share their number with the bot. No code to type.';
  if (b.live && b.offer?.state === 'stopped') {
    return [h('b', { class: 'cx-bad', text: `Stopped: ${BOT_STOP_WORDS[b.offer.reason] || 'the last try did not work'}.` }), ' Fix it, then press “Try the bot”. Until then the app does not offer the bot.'];
  }
  if (b.live) return [h('b', { text: 'Not offered in the app yet — press “Try the bot”.' }), ' Once it works, people can tap Telegram.'];
  if (b.set) return 'The app does not offer the bot until the key is saved again.';
  return 'Save a bot key so people can prove their number with Telegram for free.';
}

function lastBotTry(b) {
  const s = b.lastTry;
  if (!s) return null;
  if (s.ok) return row('Last try', h('span', { class: 'cx-ok', text: `Worked ${when(s.at)}` }));
  return row('Last try', h('span', { class: 'cx-bad', text: `Did not work ${when(s.at)}` }),
    ` · ${BOT_STOP_WORDS[s.reason] || s.reason || 'refused'}`, s.detail ? h('span', { class: 'cx-fine', text: ` · Telegram said: ${s.detail}` }) : null);
}

function botForm(b, data) {
  const { keyReady } = data;
  const err = h('p', { class: 'cx-err', id: 'tg-bot-err', role: 'alert', hidden: true });
  const { input, wrap } = secretInput({
    id: 'tg-bot-token', name: 'tg-bot-token', placeholder: b.set ? 'Paste a new key to replace it' : 'Paste the bot key',
    'aria-describedby': 'tg-bot-help tg-bot-err', disabled: !keyReady, 'data-draft': 'telegram-bot',
  });
  const label = b.set ? 'Replace key' : 'Save';
  const save = h('button', { type: 'submit', class: 'btn-primary cx-save', disabled: !keyReady }, label);
  const remove = b.set ? h('button', { type: 'button', class: 'link cx-remove', on: { click: () => removeConnection('telegram-bot') } }, 'Remove') : null;
  input.addEventListener('input', () => { err.hidden = true; input.classList.remove('is-error'); });
  const fail = (text) => {
    err.textContent = text;
    err.hidden = false;
    input.classList.add('is-error');
    input.focus();
  };
  return h('form', {
    class: 'cx-form', novalidate: true,
    on: {
      submit: async (e) => {
        e.preventDefault();
        if (state.busy) return;
        const token = input.value.trim();
        if (!token) return fail('Paste the bot key first.');
        state.busy = true;
        save.disabled = true;
        save.textContent = 'Checking with Telegram…';
        const r = await call('PUT', `${API}/telegram-bot`, { token });
        state.busy = false;
        if (!r.ok) {
          save.disabled = false;
          save.textContent = label;
          return fail([r.data.error || 'Could not save the bot key.', r.data.detail ? ` Telegram said: ${r.data.detail}` : ''].join(''));
        }
        state.test['telegram-bot'] = null;
        render(r.data, { fresh: 'telegram-bot' });
        const now = r.data.connections.find((x) => x.id === 'telegram')?.bot;
        toast(`Bot saved · @${now?.username} · key ends …${now?.last4}. Press “Try the bot” to check it.`);
        $('tg-bot-try')?.focus();
      },
    },
  },
  h('label', { class: 'field', for: 'tg-bot-token' }, h('span', { class: 'label', text: 'Bot key' })),
  wrap,
  h('p', { class: 'cx-help', id: 'tg-bot-help' }, 'In Telegram open ', link('https://t.me/BotFather', '@BotFather'), ' → /newbot → name 30+DA → copy the key here.'),
  err,
  h('div', { class: 'cx-actions' }, save, remove));
}

/** "Try the bot": getMe + getWebhookInfo on the server. A pass turns Telegram on in the app. */
function botTry(b) {
  const r = state.test['telegram-bot'];
  const trying = Boolean(r?.trying);
  const btn = h('button', {
    type: 'button', class: 'btn cx-test-btn', id: 'tg-bot-try', disabled: trying || !b.live,
    on: {
      click: async () => {
        if (state.test['telegram-bot']?.trying) return;
        state.test['telegram-bot'] = { trying: true };
        render(state.data);
        const x = await call('POST', `${API}/telegram-bot/try`, {});
        const { view, ...result } = x.data;
        state.test['telegram-bot'] = { ...result, ok: x.ok };
        render(view?.connections ? view : state.data);
        $('tg-bot-try')?.focus();
      },
    },
  }, trying ? 'Trying…' : 'Try the bot');
  let result = null;
  if (r && !r.trying && r.ok) {
    result = h('div', { class: 'cx-result ok' },
      h('p', {}, h('b', { text: 'Works ✓ ' }), `@${r.username || b.username} answers, and its messages come to this site.`),
      b.offered ? h('p', { class: 'cx-fine' }, 'Telegram is now offered in the app. ', b.link ? link(b.link, `Open @${b.username}`) : null, ' to see it yourself.') : null);
  } else if (r && !r.trying) {
    result = h('div', { class: 'cx-result bad' },
      h('p', {}, h('b', { text: 'Did not work. ' }), r.error || 'Something went wrong.'),
      r.detail ? h('p', { class: 'cx-fine' }, `Telegram said: ${r.detail}`) : null);
  }
  return h('div', { class: 'cx-test' },
    h('h3', { text: 'Try the bot' }),
    h('p', { class: 'cx-help' }, b.live
      ? 'Checks that the bot answers and that Telegram sends its messages to this site. The app offers the bot only after a good try.'
      : 'Save the bot key first, then try it here.'),
    btn,
    result);
}

/** Tower 2: the free 30+DA bot (what the owner uses). Its data rides on the Telegram connection (c.bot). */
function telegramBotCard(c, data) {
  const b = c.bot || { set: false };
  return h('section', { class: 'panel cx-card cx-main', 'aria-labelledby': 'cx-tg-bot' },
    h('div', { class: 'cx-head' }, logo('telegram'),
      h('div', { class: 'cx-title' }, h('h2', { id: 'cx-tg-bot' }, 'Telegram Bot ', h('span', { class: 'cx-free', text: 'free' })),
        h('p', { class: 'cx-sub', text: 'People prove their phone number with Telegram' }))),
    h('p', { class: 'cx-help cx-intro' }, 'People type their number, tap Telegram and share their number with your 30+DA bot. No code, no cost.'),
    h('dl', { class: 'cx-status' },
      row('Bot', ...botLine(b)),
      row('In the app', botAppLine(b)),
      lastBotTry(b)),
    h('div', { class: 'cx-split' }, botForm(b, data), botTry(b)));
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
  tiktok: {
    title: 'TikTok sign-in',
    sub: 'Sign in with a TikTok account',
    what: 'keys',
    // TikTok's own menu names, in quotes. The website prefix comes from this page's address (the same as the others).
    steps: (c) => [
      ['Open ', link('https://developers.tiktok.com/apps', 'developers.tiktok.com'), ' → Manage apps → “Connect an app”, name it 30+DA.'],
      ['Add products → “Login Kit”. Under Login Kit → Web, paste the redirect address below in “Redirect URI”.'],
      [`Verify the website: “URL prefix” ${String(c.privacyUrl || '').replace(/privacy$/, '')} (its check file is already there).`],
      ['In the app’s details paste the Terms of service and Privacy policy addresses below.'],
      ['Copy the Client key and Client secret into the boxes here and press Save.'],
      ['Press “Submit for review”. Until TikTok approves it, only the app’s testers can sign in (Sandbox → Target users, with the Sandbox’s own Client key and secret).'],
    ],
    redirectHelp: 'paste it in TikTok under Login Kit → Web → “Redirect URI”',
    fields: [
      { key: 'clientKey', label: 'Client key', placeholder: 'Letters and digits', help: ['On the app’s page in developers.tiktok.com (App details).'] },
      { key: 'clientSecret', label: 'Client secret', secret: true, placeholder: 'Paste the Client secret', help: ['Same page, next to the Client key.'] },
    ],
  },
  // Sign in with Apple (tower 10): not a signinCard — no redirect, no web sign-in; see appleCard.
  apple: {
    title: 'Sign in with Apple',
    sub: 'On the iPhone app · ends the Apple link when an account is deleted',
    what: 'key',
    // Apple's own menu names, in quotes, so they can be found in the developer portal.
    steps: [
      ['Open ', link('https://developer.apple.com/account/resources/identifiers/list', 'developer.apple.com'), ' → Certificates, Identifiers & Profiles → Identifiers → sg.ggmt.thirtyda: “Sign In with Apple” is ticked (the iPhone app already uses it).'],
      ['Keys → the + button → name it 30+DA Sign in with Apple → tick “Sign in with Apple” → Configure → Primary App ID sg.ggmt.thirtyda → Save → Continue → Register.'],
      ['Download the key (a .p8 file). Apple lets you download it only ONCE: keep it somewhere safe. The page shows its Key ID.'],
      ['Open the .p8 file in TextEdit, copy all of it into “Private key” here, the Key ID into “Key ID”; the Team ID is already filled in. Press Save, then “Try the key”.'],
    ],
    fields: [
      {
        key: 'teamId', label: 'Team ID', placeholder: '10 letters and digits', fallback: '4KX4774V2U',
        help: ['Top right of the Apple developer portal (yours: 4KX4774V2U).'],
      },
      { key: 'keyId', label: 'Key ID', placeholder: '10 letters and digits', help: ['On the key’s page (Keys → your key).'] },
      {
        key: 'privateKey', label: 'Private key (.p8)', secret: true, placeholder: 'Paste all of the .p8 file',
        help: ['From -----BEGIN PRIVATE KEY----- to -----END PRIVATE KEY-----. Saved locked; only its last 4 characters show again.'],
      },
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
          : c.id === 'apple' ? `Apple key saved · key ends …${now.masks?.privateKey}. Press “Try the key” to check it.`
            : `${NAMES[c.id]} keys saved · secret ends …${now.last4}. Press Try sign-in to check them.`);
        if (c.id === 'apple') $('apple-try')?.focus();
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
  const f = c.fields || {};
  // The status pill (codeStatus) sits on the tower's top line.
  return h('section', { class: 'panel cx-card cx-main', 'aria-labelledby': 'cx-whatsapp' },
    h('div', { class: 'cx-head' }, logo('whatsapp'),
      h('div', { class: 'cx-title' }, h('h2', { id: 'cx-whatsapp', text: 'WhatsApp' }), h('p', { class: 'cx-sub', text: FIELD_CARDS.whatsapp.sub }))),
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
  tiktok: 'Until TikTok approves the app, only its testers can sign in (Sandbox → Target users). Press “Submit for review” in TikTok so everyone can.',
};
/** A failure every sign-in will hit until it is fixed (not a cancel or a slow answer) — and what fixes it. */
const SETUP_FIX = {
  bad_keys: () => 'Copy the keys again and save them',
  redirect: (name) => `Add the redirect address in ${name}`,
  not_live: (name, id) => ({
    google: 'Press “Publish app” on Google’s consent screen', tiktok: 'Submit the app for review in TikTok (with Login Kit)',
  })[id] || 'Switch the app to Live in Meta',
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
  const f = c.fields || {};
  const idKey = card.fields[0].key;
  const where = {
    google: 'in Google on the consent screen (“Application privacy policy link”)', tiktok: 'in TikTok in the app’s details (“Privacy Policy URL”)',
  }[c.id] || 'in Meta under App settings → Basic';
  // TikTok asks for a Terms of service address; Google and Meta have a box for it too.
  const termsWhere = {
    google: 'Google may ask for it on the consent screen (“Application terms of service link”)',
    facebook: 'paste it in Meta under App settings → Basic (“Terms of Service URL”)',
    tiktok: 'paste it in TikTok in the app’s details (“Terms of Service URL”)',
  }[c.id];
  // The status pill (signinStatus) sits on the tower's top line.
  return h('section', { class: 'panel cx-card cx-signin', 'aria-labelledby': `cx-${c.id}` },
    h('div', { class: 'cx-head' }, logo(c.id),
      h('div', { class: 'cx-title' }, h('h2', { id: `cx-${c.id}`, text: card.title }), h('p', { class: 'cx-sub', text: card.sub }))),
    h('dl', { class: 'cx-status' },
      row('Keys', ...keysLine(c)),
      c.set && c.readable ? row(card.fields[0].label, h('code', { class: 'cx-mono', text: f[idKey] })) : null,
      row('In the app', signinAppLine(c, data)),
      lastTryLine(c)),
    h('div', { class: 'cx-signin-body' },
      h('div', { class: 'cx-where' },
        h('p', { class: 'cx-help' }, h('b', { text: 'How to get the keys:' })),
        h('ol', { class: 'cx-steps' }, (typeof card.steps === 'function' ? card.steps(c) : card.steps).map((step) => h('li', {}, ...step)))),
      addressRow('Redirect address', card.redirectHelp, c.redirect),
      addressRow('Privacy policy address', `paste it ${where}`, c.privacyUrl),
      c.id === 'facebook' ? addressRow('Data deletion address', 'paste it in Meta under App settings → Basic (“Data deletion instructions URL”)', c.deleteUrl)
        : addressRow('Data deletion address', `how people have their data deleted (${NAMES[c.id]} may ask for it too)`, c.deleteUrl),
      c.termsUrl ? addressRow('Terms of service address', termsWhere, c.termsUrl) : null,
      fieldsForm(c, data),
      tryBlock(c)));
}

// ---------- remove ----------
const REMOVE_TEXT = {
  telegram: (devAuth) => `Remove the Telegram token?\n\nTelegram codes stop until a new token is saved.${devAuth ? ' In test mode codes then show on the screen instead.' : ''}`,
  'telegram-bot': () => 'Remove the Telegram bot?\n\nThe bot stops answering, and people cannot use Telegram until a bot key is saved and tried again.',
  whatsapp: () => 'Remove the WhatsApp keys?\n\nWhatsApp codes stop until all four boxes are saved again.',
  google: () => 'Remove the Google keys?\n\nThe Google button in the app goes back to “Coming soon”, and nobody can sign in with Google until keys are saved again.',
  facebook: () => 'Remove the Facebook keys?\n\nThe Facebook button in the app goes back to “Coming soon”, and nobody can sign in with Facebook until keys are saved again.',
  tiktok: () => 'Remove the TikTok keys?\n\nThe TikTok button in the app goes back to “Coming soon”, and nobody can sign in with TikTok until keys are saved again.',
  apple: () => 'Remove the Apple key?\n\nSign in with Apple keeps working on the iPhone app. Only the Apple link of a deleted account is no longer ended at Apple until a key is saved again.',
};
async function removeConnection(id) {
  if (!confirm(REMOVE_TEXT[id](state.data?.devAuth))) return;
  const r = await call('DELETE', `${API}/${id}`, {});
  if (!r.ok) return toast(r.data.error || 'Could not remove it.');
  state.test[id] = null;
  render(r.data, { fresh: id });
  toast(id === 'telegram' ? 'Telegram token removed.' : id === 'telegram-bot' ? 'Telegram bot removed.' : id === 'apple' ? 'Apple key removed.' : `${NAMES[id]} keys removed.`);
}

// ---------- the "Later" towers (7–9): not built yet (10, Apple, only while the server sends no apple connection) ----------

const LATER_PILL = { pill: 'later', text: 'Later' };
/** What each "Later" tower will be for, in one line. */
const LATER = {
  wechat: { title: 'WeChat', sub: 'WeChat sign-in', line: 'Later, people sign in to our apps with their WeChat account. Nothing to set up yet.' },
  alipay: { title: 'Alipay', sub: 'Alipay payments', line: 'Later, people pay in our apps with Alipay. Nothing to set up yet.' },
  youtube: { title: 'YouTube', sub: 'YouTube sign-in', line: 'Later, people sign in to our apps with their YouTube account. Nothing to set up yet.' },
  apple: { title: 'Apple', sub: 'Sign in with Apple', line: 'Later, people sign in to our apps with their Apple account. Nothing to set up yet.' },
};

function laterTower(key) {
  const l = LATER[key];
  return h('section', { class: 'panel cx-card cx-later', 'aria-labelledby': `cx-${key}` },
    h('div', { class: 'cx-head' }, logo(key),
      h('div', { class: 'cx-title' }, h('h2', { id: `cx-${key}`, text: l.title }), h('p', { class: 'cx-sub', text: l.sub }))),
    h('p', { class: 'cx-later-line', text: l.line }));
}

// ---------- tower 10 · Apple: Sign in with Apple (STEP G, owner 2026-10-14) ----------
// The sign-in itself needs no key: the iPhone app shows "Apple" first in its row of ways (never the website, never
// Android), Apple's own sheet signs the person in, and the server checks Apple's token with Apple's public keys. The key —
// Team ID, Key ID and the .p8 private key, saved locked (the key shows only its last 4) — lets the server swap the app's
// one-time code for Apple's refresh token, so "Delete my account" can revoke it (Apple 5.1.1(v)). "Try the key" signs a
// 5-minute client secret and asks Apple's token endpoint with a made-up code: invalid_grant = Apple took the key (Live);
// invalid_client = a wrong key. The bundle id sg.ggmt.thirtyda is fixed. Not signinCard-shaped (no redirect address,
// no web sign-in), so it has its own card; it stays "Later" only if the server sends no apple connection (an older server).

/** Apple's reasons in plain words (the server's tryAppleKey / exchangeAppleCode). */
const APPLE_REASON_WORDS = {
  bad_key: 'Apple refused the key (invalid_client)',
  bad_code: 'a used or old sign-in code',
  provider_error: 'a problem on Apple’s side',
  timeout: 'no answer in time',
  network: 'could not connect',
  no_key: 'no key saved',
  other: 'an answer we did not expect',
};

function appleKeyStatus(c) {
  if (c.set && !c.readable) return { pill: 'warn', text: 'Needs attention' };
  if (c.live) return { pill: 'live', text: 'Live' };
  if (c.set && c.lastSend && !c.lastSend.ok) return { pill: 'warn', text: c.lastSend.kind === 'try' ? 'Last try failed' : 'Needs attention' };
  if (c.set) return { pill: 'saved', text: 'Saved · not tried' };
  return { pill: 'off', text: 'Not set' };
}

function appleKeyLine(c) {
  if (c.set && !c.readable) return unreadableLine(c, 'key');
  if (!c.set) return [h('b', { text: 'Not set' }), ' · the sign-in works without it'];
  const f = c.fields || {};
  return [h('b', { text: 'Set' }), ' · Key ID ', h('code', { class: 'cx-mono', text: f.keyId || '–' }),
    ' · Team ID ', h('code', { class: 'cx-mono', text: f.teamId || '–' }),
    ' · key ends ', h('code', { class: 'cx-mono', text: `…${c.masks?.privateKey || ''}` }),
    ` · saved ${when(c.updatedAt)} · ${c.updatedBy || 'superadmin'}`];
}

function appleAppLine(c) {
  const s = c.lastSend;
  if (c.live) return [h('b', { text: 'Sign-in works, and so does the key. ' }), 'Deleting an account in the app also ends its Sign in with Apple at Apple.'];
  if (c.set && c.readable && s && !s.ok) {
    return [h('b', { class: 'cx-bad', text: `Sign-in works; the key did not (${APPLE_REASON_WORDS[s.reason] || s.reason}).` }),
      ' Check the Key ID, the Team ID and the key, then press “Try the key”.'];
  }
  if (c.set && c.readable) return [h('b', { text: 'Sign-in works. ' }), 'Press “Try the key” to check the key.'];
  if (c.set) return 'Sign-in works. The key cannot be read on this server: paste and save it again.';
  return [h('b', { text: 'Sign-in works; add the key for token revoke on delete.' }), ' The Apple button shows only in the iPhone app, first in the row.'];
}

function lastAppleLine(c) {
  const s = c.lastSend;
  if (!s) return null;
  const label = s.kind === 'try' ? 'Last try' : 'Last sign-in';
  if (s.ok) return row(label, h('span', { class: 'cx-ok', text: `Worked ${when(s.at)}` }));
  return row(label, h('span', { class: 'cx-bad', text: `Did not work ${when(s.at)}` }), ` · ${APPLE_REASON_WORDS[s.reason] || s.reason}`,
    s.detail ? h('span', { class: 'cx-fine', text: ` · Apple said: ${s.detail}` }) : null);
}

/** "Try the key": a client secret signed with the key and a made-up code at Apple. Nothing is signed in, nobody changes. */
function appleTry(c) {
  const r = state.test.apple;
  const trying = Boolean(r?.trying);
  const ready = c.set && c.readable;
  const btn = h('button', {
    type: 'button', class: 'btn cx-test-btn cx-try-btn', id: 'apple-try', disabled: trying || !ready,
    on: {
      click: async () => {
        if (state.test.apple?.trying) return;
        state.test.apple = { trying: true };
        render(state.data);
        const x = await call('POST', `${API}/apple/try`, {});
        const { view, ...result } = x.data;
        state.test.apple = { ...result, ok: x.ok };
        render(view?.connections ? view : state.data);
        $('apple-try')?.focus();
      },
    },
  }, trying ? 'Trying…' : 'Try the key');
  let result = null;
  if (r && !r.trying && r.ok) {
    result = h('div', { class: 'cx-result ok' },
      h('p', {}, h('b', { text: 'Works ✓ ' }), 'Apple accepted the key: it refused only the made-up code (invalid_grant), as it should.'),
      h('p', { class: 'cx-fine' }, 'From now on, deleting an account in the app also ends its Sign in with Apple.'));
  } else if (r && !r.trying) {
    result = h('div', { class: 'cx-result bad' },
      h('p', {}, h('b', { text: 'Did not work. ' }), r.error || 'Something went wrong.'),
      r.detail ? h('p', { class: 'cx-fine' }, `Apple said: ${r.detail}`) : null);
  }
  return h('div', { class: 'cx-try' },
    h('h3', { text: 'Try the key' }),
    h('p', { class: 'cx-help' }, ready
      ? 'Signs a 5-minute client secret with the key and asks Apple with a made-up code. Nobody is signed in or changed.'
      : 'Save the key first, then try it here.'),
    btn,
    result);
}

function appleCard(c, data) {
  const card = FIELD_CARDS.apple;
  // The status pill (appleKeyStatus) sits on the tower's top line.
  return h('section', { class: 'panel cx-card cx-signin', 'aria-labelledby': 'cx-apple' },
    h('div', { class: 'cx-head' }, logo('apple'),
      h('div', { class: 'cx-title' }, h('h2', { id: 'cx-apple', text: card.title }), h('p', { class: 'cx-sub', text: card.sub }))),
    h('dl', { class: 'cx-status' },
      row('Key', ...appleKeyLine(c)),
      row('Bundle ID', h('code', { class: 'cx-mono', text: c.bundleId || 'sg.ggmt.thirtyda' }), ' · the iPhone app (fixed)'),
      row('In the app', appleAppLine(c)),
      lastAppleLine(c)),
    h('div', { class: 'cx-signin-body' },
      h('div', { class: 'cx-where' },
        h('p', { class: 'cx-help' }, h('b', { text: 'How to get the key:' })),
        h('ol', { class: 'cx-steps' }, card.steps.map((step) => h('li', {}, ...step)))),
      fieldsForm(c, data),
      appleTry(c)));
}

function appleTower(byId, data) {
  return byId.apple ? appleCard(byId.apple, data) : laterTower('apple');
}

function appleStatus(byId) {
  return byId.apple ? appleKeyStatus(byId.apple) : LATER_PILL;
}

// ---------- the hub: ten towers left to right ----------

/** A sign-in tower (TikTok, Facebook, Google): its keys card, its pill from signinStatus. */
const signinTower = (id, name) => ({
  key: id, name, kind: 'Sign-in', has: (byId) => byId[id],
  status: (byId) => signinStatus(byId[id]), draw: (byId, data) => signinCard(byId[id], data),
});
const laterOne = (key, name, kind) => ({ key, name, kind, status: () => LATER_PILL, draw: () => laterTower(key) });

/**
 * The towers, left to right, in the owner's order (2026-10-14). key → the tower's id (tower-<key>) and what this
 * browser remembers; name → the strip at the top; kind → the tower's top line; has → drawn only when the server sent
 * its connection; status → its pill (and the dot in the strip); draw → its card.
 */
const TOWERS = [
  signinTower('tiktok', 'TikTok'),
  {
    key: 'telegram-bot', name: 'Telegram Bot', kind: 'Phone check', has: (byId) => byId.telegram,
    status: (byId) => botStatus(byId.telegram.bot || { set: false }), draw: (byId, data) => telegramBotCard(byId.telegram, data),
  },
  {
    key: 'telegram-gateway', name: 'Telegram Gateway', kind: 'Phone check', has: (byId) => byId.telegram,
    status: (byId) => codeStatus(byId.telegram), draw: (byId, data) => telegramGatewayCard(byId.telegram, data),
  },
  signinTower('facebook', 'Facebook'),
  signinTower('google', 'Google'),
  {
    key: 'whatsapp', name: 'WhatsApp', kind: 'Phone check', has: (byId) => byId.whatsapp,
    status: (byId) => codeStatus(byId.whatsapp), draw: (byId, data) => whatsappCard(byId.whatsapp, data),
  },
  laterOne('wechat', 'WeChat', 'Sign-in'),
  laterOne('alipay', 'Alipay', 'Payments'),
  laterOne('youtube', 'YouTube', 'Sign-in'),
  { key: 'apple', name: 'Apple', kind: 'Sign-in', status: appleStatus, draw: appleTower },
];
const towerNumber = (t) => TOWERS.indexOf(t) + 1;

/** One tower: its card, with the tower's top line (number, kind, status pill) put first. */
function tower(t, st, byId, data) {
  const n = towerNumber(t);
  const card = t.draw(byId, data);
  card.classList.add('cx-tower');
  card.id = `tower-${t.key}`;
  card.dataset.tower = t.key;
  card.tabIndex = -1;
  card.prepend(h('div', { class: 'cx-plate' },
    h('span', { class: 'cx-num', text: String(n), 'aria-hidden': 'true' }),
    h('span', { class: 'cx-sr', text: `Tower ${n} of ${TOWERS.length}: ` }),
    h('span', { class: 'label cx-kind', text: t.kind }),
    h('span', { class: `cx-pill ${st.pill}`, text: st.text })));
  return card;
}

/** One button of the strip at the top: number, short name, a status dot. */
function chip(t, i, st) {
  return h('li', {}, h('button', {
    type: 'button', class: 'cx-chip', id: `hub-chip-${t.key}`, 'aria-controls': `tower-${t.key}`,
    on: { click: () => go(i) },
  },
  h('span', { class: 'cx-n' }, String(towerNumber(t)), h('span', { class: `cx-dot ${st.pill}`, 'aria-hidden': 'true' })),
  h('span', { class: 'cx-chip-name', text: t.name }),
  h('span', { class: 'cx-sr', text: ` · ${st.text}` })));
}

const TOWER_KEY = '30da.admin.code.tower';
const hub = {
  shown: [], // the towers on the page, left to right
  inView: [], // which of them are (mostly) in view
  current: 0, // the tower the strip marks, and ‹ › step from
  target: null, // the tower last jumped to or worked in: it stays current while it is in view
  until: 0, // a jump's smooth slide is still running until then
  sliding: false, // the slider is being dragged
  frame: 0,
  settle: 0,
  // The tower worked on last time (this browser only). A private window may refuse: then it starts at tower 1.
  restore: (() => {
    try { return localStorage.getItem(TOWER_KEY); } catch { return null; }
  })(),
};
function remember(key) {
  try { localStorage.setItem(TOWER_KEY, key); } catch { /* not remembered: fine */ }
}
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const towerEls = () => [...$('cards').children];
/** Where the row must be scrolled to for this tower to sit first (at the snap edge). */
const startOf = (el) => el.offsetLeft - (parseFloat(getComputedStyle($('cards')).scrollPaddingLeft) || 0);

/** Moves to tower i. focus: 'tower' | 'chip' moves the keyboard focus along; page: lift a deep page to the towers' tops. */
function go(i, { smooth = true, focus = null, page = true } = {}) {
  const els = towerEls();
  if (!els.length) return;
  const to = Math.max(0, Math.min(els.length - 1, i));
  const row = $('cards');
  const behavior = smooth && !calm() ? 'smooth' : 'auto';
  hub.target = to;
  hub.until = behavior === 'smooth' ? Date.now() + 900 : 0;
  row.scrollTo({ left: startOf(els[to]), behavior });
  if (page) {
    // Deep in a tall tower: bring the towers' tops back under the strip, so the new tower shows from its top.
    const gap = row.getBoundingClientRect().top - $('hub-bar').getBoundingClientRect().bottom;
    if (gap < 0) window.scrollTo({ top: window.scrollY + gap, behavior });
  }
  if (focus === 'tower') els[to].focus({ preventScroll: true });
  if (focus === 'chip') $('hub-strip').children[to]?.firstChild?.focus({ preventScroll: true });
  setCurrent(to);
}

function setCurrent(i) {
  const moved = hub.current !== i;
  hub.current = i;
  if (moved && hub.shown[i]) remember(hub.shown[i].key);
  paintHub(moved);
}

/** After a scroll, a draw or a resize: which towers are in view, which one is current. */
function syncHub() {
  hub.frame = 0;
  const row = $('cards');
  const els = towerEls();
  if (!els.length) return;
  const box = row.getBoundingClientRect();
  hub.inView = els.map((el) => {
    const r = el.getBoundingClientRect();
    return (Math.min(r.right, box.right) - Math.max(r.left, box.left)) / r.width > 0.6;
  });
  let cur = hub.current;
  if (hub.target != null && (hub.inView[hub.target] || Date.now() < hub.until)) cur = hub.target;
  else {
    hub.target = null;
    // Slid by hand (scrollbar, trackpad, slider) to either end: that end's tower is current, so ‹ or › turns off.
    // On a wide screen the last few towers all start past the furthest scroll: take the last one in view there.
    const max = row.scrollWidth - row.clientWidth;
    if (hub.inView.includes(true)) {
      if (max > 1 && row.scrollLeft >= max - 1) cur = hub.inView.lastIndexOf(true);
      else if (max > 1 && row.scrollLeft <= 1) cur = hub.inView.indexOf(true);
      else if (!hub.inView[cur]) cur = hub.inView.indexOf(true);
    }
  }
  if (cur !== hub.current) setCurrent(cur);
  else paintHub(false);
}

/** The strip, the arrows, the slider and the current tower's ring, from hub. */
function paintHub(moved) {
  const els = towerEls();
  els.forEach((el, i) => el.classList.toggle('is-current', i === hub.current));
  [...$('hub-strip').children].forEach((li, i) => {
    const b = li.firstChild;
    b.classList.toggle('in-view', Boolean(hub.inView[i]));
    b.classList.toggle('current', i === hub.current);
    if (i === hub.current) b.setAttribute('aria-current', 'true');
    else b.removeAttribute('aria-current');
  });
  // aria-disabled, not disabled: the focus stays on the arrow at either end.
  $('hub-prev').setAttribute('aria-disabled', String(hub.current <= 0));
  $('hub-next').setAttribute('aria-disabled', String(hub.current >= els.length - 1));
  $('hub-prev').disabled = false;
  $('hub-next').disabled = false;
  // The slider: where the row is, its thumb as wide as the part in view (like a scrollbar).
  const row = $('cards');
  const slider = $('hub-slider');
  const max = row.scrollWidth - row.clientWidth;
  slider.disabled = max <= 0;
  if (!hub.sliding) slider.value = String(max > 0 ? Math.round((row.scrollLeft / max) * 1000) : 0);
  slider.style.setProperty('--thumb', `${Math.max(44, Math.round(slider.clientWidth * Math.min(1, row.clientWidth / row.scrollWidth)))}px`);
  const t = hub.shown[hub.current];
  if (t) slider.setAttribute('aria-valuetext', `Tower ${towerNumber(t)} of ${TOWERS.length}: ${t.name}`);
  if (moved) showChip(hub.current);
}

/** Keeps the current tower's button in view in the strip (on a phone the strip slides too). */
function showChip(i) {
  const strip = $('hub-strip');
  const li = strip.children[i];
  if (!li || strip.scrollWidth <= strip.clientWidth) return;
  const left = li.offsetLeft - (strip.clientWidth - li.offsetWidth) / 2;
  strip.scrollTo({ left, behavior: calm() ? 'auto' : 'smooth' });
}

/** Settles on the nearest tower once the slider is let go. */
function endSlide() {
  if (!hub.sliding) return;
  hub.sliding = false;
  const row = $('cards');
  row.classList.remove('is-sliding');
  const els = towerEls();
  const off = (el) => Math.abs(Math.min(startOf(el), row.scrollWidth - row.clientWidth) - row.scrollLeft);
  // A tie goes to the later tower: at the right end on a wide screen the last few all sit at the furthest scroll,
  // and the slider's end means the last tower (10), not the first of them.
  let best = 0;
  els.forEach((el, i) => { if (off(el) <= off(els[best])) best = i; });
  go(best, { page: false });
}

function wireHub() {
  const row = $('cards');
  row.addEventListener('scroll', () => {
    if (!hub.frame) hub.frame = requestAnimationFrame(syncHub);
    clearTimeout(hub.settle);
    hub.settle = setTimeout(() => { hub.until = 0; syncHub(); }, 160);
  }, { passive: true });
  // Working in a tower makes it the current one (and the one remembered).
  const pick = (e) => {
    const i = towerEls().indexOf(e.target.closest?.('.cx-tower'));
    if (i < 0 || i === hub.target) return;
    hub.target = i;
    hub.until = 0;
    if (i !== hub.current) setCurrent(i);
  };
  row.addEventListener('focusin', pick);
  row.addEventListener('pointerdown', pick);
  for (const [id, step] of [['hub-prev', -1], ['hub-next', 1]]) {
    $(id).addEventListener('click', () => {
      if ($(id).getAttribute('aria-disabled') !== 'true') go(hub.current + step);
    });
  }
  const slider = $('hub-slider');
  slider.addEventListener('input', () => {
    hub.sliding = true;
    hub.target = null;
    hub.until = 0;
    row.classList.add('is-sliding');
    row.scrollLeft = (Number(slider.value) / 1000) * (row.scrollWidth - row.clientWidth);
  });
  slider.addEventListener('change', endSlide);
  slider.addEventListener('pointerup', endSlide);
  slider.addEventListener('blur', endSlide);
  // ← → step tower by tower, except while typing in a box (there they move the cursor).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || !hub.shown.length) return;
    const el = e.target instanceof Element ? e.target : document.body;
    if (el !== slider && el.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    e.preventDefault();
    const focus = el.closest('#hub-strip') ? 'chip' : el.closest('#hub-bar') ? null : 'tower';
    go(hub.current + (e.key === 'ArrowRight' ? 1 : -1), { focus });
  });
  window.addEventListener('resize', () => {
    if (!hub.frame) hub.frame = requestAnimationFrame(syncHub);
  });
}
wireHub();

// ---------- render ----------

/** The line at the top right: what is live, what needs a look, what waits, over all the towers. */
function headline(data) {
  const byId = Object.fromEntries(data.connections.map((c) => [c.id, c]));
  const all = TOWERS.filter((t) => !t.has || t.has(byId)).map((t) => ({ name: t.name, st: t.status(byId) }));
  const named = (test) => all.filter(({ st }) => test(st)).map(({ name }) => name);
  const parts = [];
  const attention = named((st) => st.text === 'Needs attention');
  if (attention.length) parts.push(`${attention.join(' + ')} need${attention.length > 1 ? '' : 's'} attention`);
  const live = named((st) => st.pill === 'live');
  if (live.length) parts.push(`Live: ${live.join(' + ')}`);
  // Stopped / Last try failed, each with its own words.
  const warns = [...new Set(all.filter(({ st }) => st.pill === 'warn' && st.text !== 'Needs attention').map(({ st }) => st.text))];
  for (const text of warns) parts.push(`${text}: ${named((st) => st.pill === 'warn' && st.text === text).join(' + ')}`);
  const toTry = named((st) => st.pill === 'saved');
  if (toTry.length) parts.push(`Saved, not tried: ${toTry.join(' + ')}`);
  if (!live.length) parts.push(data.testCodes ? 'Test codes · nothing live yet' : 'Nothing live yet');
  const later = named((st) => st.pill === 'later');
  if (later.length) parts.push(`${later.length} for later`);
  return parts.join(' · ');
}

/** Re-draw every tower. What was typed but not saved stays (except on the card just saved / removed: `fresh`). */
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
  // The towers, left to right, and the strip's buttons; the row stays where it was.
  const row = $('cards');
  const left = row.scrollLeft;
  hub.shown = TOWERS.filter((t) => !t.has || t.has(byId));
  const statuses = hub.shown.map((t) => t.status(byId));
  row.replaceChildren(...hub.shown.map((t, i) => tower(t, statuses[i], byId, data)));
  $('hub-strip').replaceChildren(...hub.shown.map((t, i) => chip(t, i, statuses[i])));
  for (const [id, value] of Object.entries(drafts)) if ($(id)) $(id).value = value;
  if (hub.restore !== undefined) {
    // The first draw: back to the tower worked on last time.
    const i = hub.shown.findIndex((t) => t.key === hub.restore);
    hub.restore = undefined;
    if (i > 0) go(i, { smooth: false, page: false });
    else syncHub();
  } else {
    row.scrollLeft = left;
    syncHub();
  }
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
