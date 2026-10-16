// 30+DA super admin · Code — the sign-in and messaging hub, the GK API Hub (owner 2026-10-14): thirteen towers left to right,
// in the owner's order (1 TikTok, 2 Telegram Bot, 3 Telegram Gateway, 4 Facebook, 5 Google, 6 WhatsApp, 7 WeChat, 8 Alipay,
// 9 YouTube, 10 Apple, 11 Wan, 12 Places, 13 Translate; 7–9 are "Later" placeholders), each with the keys it needs. Tower 10 is Sign in with Apple
// (owner 2026-10-14): the sign-in needs no key; its key (Team ID, Key ID, the .p8) lets a deleted account end its Apple
// link. Tower 11 is Wan (owner 2026-10-14): image to video on our M5 for Yai Media Director — a client token and a worker
// token (each shown once, then only its last 4), On / Off, the sizes and seconds allowed, and a Try that plays its clip
// here (src/lib/thirtyda-hub-wan.mjs). Tower 12 is Places (owner 2026-10-15): our own Phnom Penh place list — its
// status, Refresh now and a test search (src/lib/thirtyda-hub-places.mjs). Tower 13 is Translate (owner 2026-10-15): where
// chat lines are translated — our own model on the M1 (src/lib/thirtyda-hub-translate.mjs). A strip at the top jumps to a tower; ‹ ›, the
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

// wanReveal: a Wan token just made { kind, token } — this page's memory only, until "Done" (never stored, never sent back).
// placesBusy / placesError: Tower 12's Refresh now; placesTry: its test search { busy, result, error } (its Google key,
// On / Off and cap: googleBlock); trTry: Tower 13's Try.
const state = {
  data: null, busy: false, test: {}, testPhone: {}, wanReveal: null, wanBusy: null, wanTrying: false, wanTryError: null,
  placesBusy: false, placesError: null, placesTry: {}, trTry: {},
};

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
  // Wan (tower 11): a video camera with a play mark, our own drawing.
  wan: '<rect x="2.8" y="5.6" width="13" height="12.8" rx="2.6" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="m15.8 10.4 5.2-3v9.2l-5.2-3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/><path d="M7.6 9.4v5.2l4.3-2.6-4.3-2.6Z" fill="currentColor"/>',
  // Places (tower 12): a map pin, our own drawing.
  places: '<path d="M12 21s-6.6-6.1-6.6-11.2a6.6 6.6 0 0 1 13.2 0C18.6 14.9 12 21 12 21Z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/><circle cx="12" cy="9.8" r="2.4" stroke="currentColor" stroke-width="1.6" fill="none"/>',
  // Translate (tower 13): two speech marks, "A" and "文", our own drawing.
  translate: '<path d="M3.5 5.5h9v7h-5l-3 2.5v-2.5h-1Z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/><path d="m6.2 11 1.8-4.2 1.8 4.2M6.8 9.6h2.4" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M14.5 9.5h6v7h-1v2.5l-3-2.5h-5v-3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/><path d="M14.4 12.2h4.2M16.5 11.2v1M15 15.4c1.4-.6 2.6-1.8 3-3.2M15.4 13.2c.5 1 1.4 1.8 2.6 2.2" stroke="currentColor" stroke-width="1.1" fill="none" stroke-linecap="round"/>',
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
const NAMES = { telegram: 'Telegram', 'telegram-bot': 'Telegram bot', whatsapp: 'WhatsApp', google: 'Google', facebook: 'Facebook', tiktok: 'TikTok', apple: 'Apple', wan: 'Wan' };
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
  // Tower 12 · Places, Google (src/lib/thirtyda-places-google.mjs, owner 2026-10-16): the Places API key. Google's own
  // menu names, in quotes, so they can be found in the Cloud console.
  googleplaces: {
    title: 'Google Places',
    sub: 'Asked first in the meeting place search',
    what: 'key',
    steps: [
      ['Open ', link('https://console.cloud.google.com/', 'console.cloud.google.com'), ' → pick or make a project (e.g. “30DA”) → “Billing”: link a billing account. Google asks for one even within its free monthly amount.'],
      ['“APIs & Services” → “Library” → “Places API (New)” → Enable.'],
      ['“APIs & Services” → “Credentials” → “Create credentials” → “API key”. Then edit the key: “API restrictions” → “Restrict key” → only “Places API (New)” → Save.'],
      ['Paste the key here → Save → run a few test searches below (they ask Google even while Off) → Turn on.'],
      ['In “Billing” → “Budgets & alerts”, set a small monthly budget with an email alert. The cap below stops us asking Google too.'],
    ],
    fields: [
      {
        key: 'key', label: 'API key', secret: true, placeholder: 'AIza… (39 characters)',
        help: ['From “Credentials” in the Google Cloud console. Saved locked; only its last 4 characters show again.'],
      },
    ],
  },
  // Tower 13 · Translate (src/lib/thirtyda-hub-translate.mjs): the pick is Tencent Hy-MT2-1.8B in LM Studio on the M1.
  translate: {
    title: 'Translate',
    sub: 'Chat lines in 5 languages · our own model on the M1',
    what: 'keys',
    steps: [
      ['On the M1, in LM Studio: download Tencent Hy-MT2-1.8B (Apache-2.0, knows Khmer), load it, and copy its API name (Developer tab).'],
      ['Here: the address https://llm.ggmt.sg (our M1, already on the privacy page), the model name, the M1 guard token, “Hy-MT”. Save.'],
      ['Try lines in every language; have a Khmer speaker check about 50 casual lines.'],
      ['Turn on. Every new chat line is then translated; older lines are filled in when someone reads them.'],
    ],
    fields: [
      {
        key: 'url', label: 'Address', placeholder: 'https://llm.ggmt.sg', fallback: 'https://llm.ggmt.sg',
        help: ['Our M1 (the M1 guard in front of LM Studio). Any OpenAI-style …/v1/chat/completions server works.'],
      },
      { key: 'model', label: 'Model', placeholder: 'e.g. hy-mt2-1.8b', help: ['The name LM Studio shows for the loaded model.'] },
      {
        key: 'token', label: 'Token', secret: true, placeholder: 'Paste the M1 guard token',
        help: ['The bearer token of llm.ggmt.sg (M1_LLM_TOKEN). Saved locked; only its last 4 characters show again.'],
      },
      {
        key: 'style', label: 'How it is asked', fallback: 'hy-mt',
        choices: [['hy-mt', 'Hy-MT: no system prompt'], ['chat', 'Chat model: a system prompt']],
        help: ['Hy-MT2 / Hunyuan-MT take the instruction in the message itself. Chat: Qwen and other chat models.'],
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
    } else if (f.choices) {
      // A fixed choice (Tower 13's "How it is asked"): a list, the saved one picked.
      const saved = c.fields?.[f.key] || f.fallback;
      const input = h('select', { class: 'input', id, name: id, disabled: !keyReady, 'data-draft': c.id, 'aria-describedby': `${helpId} ${c.id}-err` },
        f.choices.map(([v, text]) => h('option', { value: v, text, selected: v === saved })));
      inputs[f.key] = input;
      control = input;
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
        const now = r.data.connections.find((x) => x.id === c.id) ?? r.data[c.id];
        toast(c.id === 'googleplaces' ? `Google Places key saved · ends …${r.data.places?.google?.masks?.key || ''}. Try a search below, then turn it on.`
          : c.id === 'translate' ? `Translate keys saved · token ends …${now?.masks?.token}. Try a line below.`
          : c.id === 'whatsapp'
          ? `WhatsApp keys saved · token ends …${now.masks?.token}. Send a test code to check them.`
          : c.id === 'apple' ? `Apple key saved · key ends …${now.masks?.privateKey}. Press “Try the key” to check it.`
            : `${NAMES[c.id]} keys saved · secret ends …${now.last4}. Press Try sign-in to check them.`);
        if (c.id === 'apple') $('apple-try')?.focus();
        if (c.id === 'translate') $('tr-text')?.focus();
        if (c.id === 'googleplaces') $('places-q')?.focus();
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

function copyButton(text, done = 'Address copied.', id = null) {
  return h('button', {
    type: 'button', class: 'btn cx-copy-btn', id,
    on: {
      click: async () => {
        try {
          await navigator.clipboard.writeText(text);
          toast(done);
        } catch {
          toast(done === 'Address copied.' ? 'Select the address and copy it.' : 'Select it and copy it.');
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
  translate: () => 'Remove the Translate keys?\n\nNew chat lines are no longer translated (people see the original) until keys are saved again.',
  googleplaces: () => 'Remove the Google Places key?\n\nThe app stops asking Google at once; place searches use our own list and OpenStreetMap only.',
  apple: () => 'Remove the Apple key?\n\nSign in with Apple keeps working on the iPhone app. Only the Apple link of a deleted account is no longer ended at Apple until a key is saved again.',
};
async function removeConnection(id) {
  if (!confirm(REMOVE_TEXT[id](state.data?.devAuth))) return;
  const r = await call('DELETE', `${API}/${id}`, {});
  if (!r.ok) return toast(r.data.error || 'Could not remove it.');
  state.test[id] = null;
  render(r.data, { fresh: id });
  toast(id === 'googleplaces' ? 'Google Places key removed.' : id === 'translate' ? 'Translate keys removed.' : id === 'telegram' ? 'Telegram token removed.' : id === 'telegram-bot' ? 'Telegram bot removed.' : id === 'apple' ? 'Apple key removed.' : `${NAMES[id]} keys removed.`);
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

// ---------- tower 11 · Wan: image to video on our M5, for Yai Media Director (the GK API Hub, owner 2026-10-14) ----------
// Wan 2.2 runs in ComfyUI on the owner's M5 laptop. The hub never calls the M5: the M5's worker calls out (claim, progress,
// done, fail) with the WORKER token; Yai Media Director sends a picture + a prompt with the CLIENT token and fetches the
// clip (src/lib/thirtyda-hub-wan.mjs, contract v1). A token shows in full ONCE, right after New token (kept only in this
// page's memory until "Done"); after that only its last 4. The server sends a `wan` block next to the connections.

const WAN_PILLS = {
  not_set: { pill: 'off', text: 'Not set' },
  off: { pill: 'off', text: 'Off' },
  waiting: { pill: 'wait', text: 'Waiting for the M5' },
  live: { pill: 'live', text: 'Live' },
};
const wanPill = (w) => WAN_PILLS[w?.status] || WAN_PILLS.not_set;

const WAN_TOKEN_WORDS = {
  client: {
    label: 'Client token', who: 'Yai Media Director',
    help: 'Goes in Yai Media Director as Authorization: Bearer <token>. It can send renders and fetch clips.',
    renew: 'Make a new client token?\n\nThe one Yai Media Director uses now stops working at once: paste the new one there.',
    revoke: 'Revoke the client token?\n\nYai Media Director cannot send renders or fetch clips until a new token is made.',
  },
  worker: {
    label: 'Worker token', who: 'the M5',
    help: 'Goes in the M5 worker’s settings. It can only take renders and send clips back.',
    renew: 'Make a new worker token?\n\nThe M5 worker stops at once until the new token is in its settings.',
    revoke: 'Revoke the worker token?\n\nThe M5 cannot take renders until a new token is made; renders wait in the queue.',
  },
};

/** "40 s", "3 min", "5 h", "2 days". */
function ago(s) {
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 48 * 3600) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} days`;
}
const megabytes = (n) => `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;

function wanWorkerLine(w) {
  if (!w.worker) {
    return [h('b', { text: 'Not seen yet' }), w.tokens.worker.set
      ? ' · start the worker on the M5 with the worker token.' : ' · make a worker token, then start the worker on the M5.'];
  }
  const { name, seenAgoS, info = {} } = w.worker;
  const live = seenAgoS * 1000 <= 2 * 60e3;
  const about = [info.gpu, info.comfy_version ? `ComfyUI ${info.comfy_version}` : null].filter(Boolean).join(' · ');
  return [h('b', { class: live ? 'cx-ok' : null, text: `${name || 'M5'} seen ${ago(seenAgoS)} ago` }), about ? ` · ${about}` : '',
    live ? '' : ' · asleep or away: renders wait here until it calls in again.'];
}

function wanQueueLine(w) {
  const q = w.queue;
  return `${q.pending} waiting · ${q.running} rendering · ${q.clips} ${q.clips === 1 ? 'clip' : 'clips'} kept · ${megabytes(q.storedBytes)} of ${megabytes(q.storageMax)}`;
}

function wanAppLine(w) {
  if (w.status === 'not_set') return 'Make a client token for Yai Media Director and a worker token for the M5.';
  if (w.status === 'off') return [h('b', { class: 'cx-bad', text: 'Off: ' }), 'Yai Media Director gets “tower_off” until you turn it on. Renders already queued still go to the M5.'];
  if (w.status === 'live') return 'Working: the M5 takes renders as they come in.';
  return 'On. Renders from Yai Media Director wait in the queue until the M5 calls in.';
}

async function makeWanToken(kind, replacing) {
  if (state.wanBusy) return;
  if (replacing && !confirm(WAN_TOKEN_WORDS[kind].renew)) return;
  state.wanBusy = kind;
  render(state.data);
  const r = await call('POST', `${API}/wan/tokens/${kind}`, {});
  state.wanBusy = null;
  if (!r.ok) {
    render(state.data);
    return toast(r.data.error || 'Could not make the token.');
  }
  // Shown once: kept in this page's memory only, until "Done, I copied it".
  state.wanReveal = { kind, token: r.data.token };
  render(r.data.view?.connections ? r.data.view : state.data);
  $(`wan-copy-${kind}`)?.focus();
}

async function revokeWanToken(kind) {
  if (!confirm(WAN_TOKEN_WORDS[kind].revoke)) return;
  const r = await call('DELETE', `${API}/wan/tokens/${kind}`, {});
  if (!r.ok) return toast(r.data.error || 'Could not revoke it.');
  if (state.wanReveal?.kind === kind) state.wanReveal = null;
  render(r.data);
  toast(`${WAN_TOKEN_WORDS[kind].label} revoked.`);
}

/** The new token, in full, this once. */
function wanReveal(kind) {
  const r = state.wanReveal;
  if (!r || r.kind !== kind) return null;
  return h('div', { class: 'cx-result ok cx-reveal' },
    h('p', {}, h('b', { text: 'Shown once. ' }), 'Copy it now: after this only its last 4 characters show. A token made before it has stopped working.'),
    h('div', { class: 'cx-copy-row' }, h('code', { class: 'cx-mono cx-address', text: r.token }), copyButton(r.token, 'Token copied.', `wan-copy-${kind}`)),
    h('button', {
      type: 'button', class: 'link',
      on: { click: () => { state.wanReveal = null; render(state.data); } },
    }, 'Done, I copied it'));
}

function wanTokenRow(w, kind) {
  const t = w.tokens[kind];
  const words = WAN_TOKEN_WORDS[kind];
  const busy = state.wanBusy === kind;
  const make = h('button', {
    type: 'button', class: 'btn cx-test-btn', id: `wan-new-${kind}`, disabled: Boolean(state.wanBusy),
    on: { click: () => makeWanToken(kind, t.set) },
  }, busy ? 'Making…' : t.set ? 'New token' : 'Make token');
  const revoke = t.set ? h('button', { type: 'button', class: 'link cx-remove', on: { click: () => revokeWanToken(kind) } }, 'Revoke') : null;
  return h('div', { class: 'cx-token' },
    h('p', { class: 'cx-token-line' }, h('b', { text: `${words.label} · ${words.who}` }), ' · ',
      t.set ? ['ends ', h('code', { class: 'cx-mono', text: `…${t.last4}` }), ` · made ${when(t.madeAt)}`] : h('span', { class: 'cx-bad', text: 'not set' })),
    h('p', { class: 'cx-help' }, words.help),
    wanReveal(kind),
    h('div', { class: 'cx-actions' }, make, revoke));
}

async function saveWanOptions(body, err) {
  if (state.busy) return;
  state.busy = true;
  const r = await call('PUT', `${API}/wan/options`, body);
  state.busy = false;
  if (!r.ok) {
    if (err) {
      err.textContent = r.data.error || 'Could not save.';
      err.hidden = false;
    } else toast(r.data.error || 'Could not save.');
    return;
  }
  render(r.data, { fresh: 'wan' });
  const o = r.data.wan?.options;
  toast('enabled' in body ? `Wan tower ${o?.enabled ? 'on' : 'off'}.` : 'Wan options saved.');
}

/** On / Off (at once), the sizes allowed and the most seconds (Save). */
function wanOptionsBlock(w) {
  const o = w.options;
  const err = h('p', { class: 'cx-err', id: 'wan-opt-err', role: 'alert', hidden: true });
  const box = (s) => h('input', { type: 'checkbox', id: `wan-size-${s}`, checked: Boolean(o.sizes[s]), 'data-draft': 'wan' });
  const sizes = Object.fromEntries(o.sizesAll.map((s) => [s, box(s)]));
  const secs = h('input', {
    class: 'input cx-mono cx-secs', type: 'number', id: 'wan-max-seconds', min: '1', max: String(o.secondsMax), step: '1',
    inputmode: 'numeric', value: String(o.maxSeconds), 'data-draft': 'wan', 'aria-describedby': 'wan-opt-err',
  });
  for (const input of [...Object.values(sizes), secs]) input.addEventListener('input', () => { err.hidden = true; });
  const power = h('button', {
    type: 'button', class: 'btn cx-test-btn', id: 'wan-power', 'aria-pressed': String(o.enabled),
    on: { click: () => saveWanOptions({ enabled: !o.enabled }) },
  }, o.enabled ? 'Turn off' : 'Turn on');
  const sizeWords = { '480p': '480p', '720p': '720p — the M5’s 32 GB runs out of memory at 720p' };
  const form = h('form', {
    class: 'cx-form', novalidate: true,
    on: {
      submit: (e) => {
        e.preventDefault();
        const maxSeconds = Number(secs.value);
        if (!Number.isInteger(maxSeconds) || maxSeconds < 1 || maxSeconds > o.secondsMax) {
          err.textContent = `The most seconds is a whole number from 1 to ${o.secondsMax}.`;
          err.hidden = false;
          return secs.focus();
        }
        saveWanOptions({ sizes: Object.fromEntries(Object.entries(sizes).map(([s, input]) => [s, input.checked])), maxSeconds }, err);
      },
    },
  },
  h('fieldset', { class: 'cx-sizes' },
    h('legend', { class: 'label', text: 'Sizes Yai may ask for' }),
    o.sizesAll.map((s) => h('label', { class: 'cx-check-label', for: `wan-size-${s}` }, sizes[s], h('span', { text: sizeWords[s] || s })))),
  h('label', { class: 'field cx-secs-label', for: 'wan-max-seconds' }, h('span', { class: 'label', text: 'Most seconds per clip' })),
  secs,
  err,
  h('div', { class: 'cx-actions' }, h('button', { type: 'submit', class: 'btn-primary cx-save' }, 'Save')));
  return h('div', { class: 'cx-try' },
    h('h3', { text: 'Tower' }),
    h('div', { class: 'cx-power' },
      h('p', { class: 'cx-help' }, h('b', { text: o.enabled ? 'On. ' : 'Off. ' }),
        o.enabled ? 'Yai Media Director can send renders.' : 'Renders from Yai Media Director are refused (“tower_off”).'),
      power),
    form);
}

const WAN_JOB_WORDS = { pending: 'Waiting', running: 'Rendering', done: 'Done', failed: 'Failed' };
const WAN_ERROR_WORDS = { worker_lost: 'the M5 went away twice', storage_full: 'the hub was full', input_lost: 'the picture was lost' };

async function tryWan() {
  if (state.wanTrying) return;
  state.wanTrying = true;
  state.wanTryError = null;
  render(state.data);
  const r = await call('POST', `${API}/wan/try`, {});
  state.wanTrying = false;
  const data = r.data.view?.connections ? r.data.view : state.data;
  // The answer's own Wan block is not news: a "Not queued" stays until the tower changes after it (noteWan).
  noteWan(data.wan);
  state.wanTryError = r.ok ? null : r.data.error || 'Could not queue the try.';
  render(data);
  $('wan-try')?.focus();
}

/** Try: a short render of the home picture; its status, and the clip when it is done. */
function wanTryBlock(w) {
  const t = w.lastTry;
  const working = t && (t.status === 'pending' || t.status === 'running');
  const ready = w.options.enabled;
  const btn = h('button', {
    type: 'button', class: 'btn cx-test-btn cx-try-btn', id: 'wan-try', disabled: state.wanTrying || working || !ready,
    on: { click: tryWan },
  }, state.wanTrying ? 'Queueing…' : 'Try a render');
  // A press that was refused shows next to the last Try's own status, never in place of it.
  const refused = state.wanTryError
    ? h('div', { class: 'cx-result bad' }, h('p', {}, h('b', { text: 'Not queued. ' }), state.wanTryError)) : null;
  const again = wanAsk.stopped ? h('p', { class: 'cx-fine' }, 'Nothing new for 10 minutes, so this page stopped asking. ',
    h('button', { type: 'button', class: 'link', id: 'wan-check', on: { click: checkWanAgain } }, 'Check again')) : null;
  let result = null;
  if (t?.status === 'pending') {
    result = h('div', { class: 'cx-result' }, h('p', {}, h('b', { text: 'Waiting for the M5. ' }), `Queued ${when(t.createdAt)} · ${t.size}, ${t.seconds} s.`), again);
  } else if (t?.status === 'running') {
    result = h('div', { class: 'cx-result' }, h('p', {}, h('b', { text: `Rendering ${Math.round((t.progress || 0) * 100)} %. ` }), `${t.size}, ${t.seconds} s.`), again);
  } else if (t?.status === 'done') {
    const media = !t.clipUrl ? null : t.clipType === 'image/webp'
      ? h('img', { class: 'cx-video', src: t.clipUrl, alt: 'The Try clip' })
      : h('video', { class: 'cx-video', src: t.clipUrl, controls: true, muted: true, loop: true, playsinline: true, preload: 'metadata' });
    result = h('div', { class: 'cx-result ok' },
      h('p', {}, h('b', { text: 'Done ✓ ' }), `${t.size}, ${t.seconds} s · ${when(t.finishedAt)}.`),
      media || h('p', { class: 'cx-fine' }, 'The clip was deleted 48 hours after it was made.'));
  } else if (t?.status === 'failed') {
    result = h('div', { class: 'cx-result bad' }, h('p', {}, h('b', { text: 'Failed. ' }), WAN_ERROR_WORDS[t.error] || t.error || 'The M5 could not make it.'));
  }
  return h('div', { class: 'cx-try' },
    h('h3', { text: 'Try' }),
    h('p', { class: 'cx-help' }, ready
      ? 'Queues a short render of the 30+DA home picture (the same caps as Yai). The M5 takes it on its next claim; this tower shows the clip here.'
      : 'Turn the tower on first, then try it here.'),
    btn,
    refused,
    result);
}

/** The last 8 renders: what, from where, when; never a prompt or a picture. */
function wanJobsBlock(w) {
  if (!w.jobs?.length) return null;
  return h('div', { class: 'cx-try' },
    h('h3', { text: 'Last renders' }),
    h('ol', { class: 'cx-jobs' }, w.jobs.map((j) => h('li', {},
      h('span', { class: `cx-job ${j.status}`, text: j.status === 'running' ? `${WAN_JOB_WORDS.running} ${Math.round((j.progress || 0) * 100)} %` : WAN_JOB_WORDS[j.status] || j.status }),
      ` ${j.source === 'try' ? 'Try' : 'Yai'} · ${j.size} · ${j.seconds} s · ${j.aspect} · ${when(j.createdAt)}`,
      j.finishedAt ? ` → ${when(j.finishedAt)}` : '',
      j.error ? h('span', { class: 'cx-bad', text: ` · ${WAN_ERROR_WORDS[j.error] || j.error}` }) : null))));
}

function wanCard(w) {
  // The status pill (wanPill) sits on the tower's top line.
  return h('section', { class: 'panel cx-card cx-signin', 'aria-labelledby': 'cx-wan' },
    h('div', { class: 'cx-head' }, logo('wan'),
      h('div', { class: 'cx-title' }, h('h2', { id: 'cx-wan', text: 'Wan' }), h('p', { class: 'cx-sub', text: 'Image to video on our M5 · for Yai Media Director' }))),
    h('dl', { class: 'cx-status' },
      row('M5', ...wanWorkerLine(w)),
      row('Queue', wanQueueLine(w)),
      row('In Yai', wanAppLine(w))),
    h('div', { class: 'cx-signin-body' },
      h('div', { class: 'cx-try' }, h('h3', { text: 'Tokens' }), wanTokenRow(w, 'client'), wanTokenRow(w, 'worker')),
      wanOptionsBlock(w),
      wanTryBlock(w),
      wanJobsBlock(w),
      addressRow('Endpoint', `for developers: Yai Media Director and the M5 worker follow contract ${w.contract || 'v1'}; every call and answer is listed at the top of src/lib/thirtyda-hub-wan.mjs. Tokens go in Authorization: Bearer.`, w.endpoint)));
}

/**
 * While a Try waits or renders, the page asks again every 5 seconds. Only the Wan tower is re-drawn (renderWan), and only
 * when its status, queue or jobs changed: the other towers (what is typed there, an error, a shown secret) are never
 * touched, and a box being typed in inside the Wan tower holds the asking. Nothing new for 10 minutes (the M5 asleep)
 * stops it — no polling for hours, no sign-in bounce from an idle tab — and "Check again" asks once more.
 */
const WAN_ASK_MS = 5000;
const WAN_ASK_FOR_MS = 10 * 60e3;
const wanAsk = { timer: 0, shape: '', since: 0, stopped: false };
/** What the asking compares (not seenAgoS: it moves every time). */
const wanShape = (w) => JSON.stringify(w ? [w.status, w.queue, w.lastTry, w.jobs] : null);

/** Before every draw: a Wan block that changed starts the 10 minutes again, and clears a Try's "Not queued" message. */
function noteWan(w) {
  const shape = wanShape(w);
  if (shape === wanAsk.shape) return;
  Object.assign(wanAsk, { shape, since: Date.now(), stopped: false });
  state.wanTryError = null;
}

/** A box inside the Wan tower has the focus (being typed in). */
function wanEditing() {
  const el = document.activeElement;
  return Boolean(el?.matches?.('input, select, textarea') && el.closest('#tower-wan'));
}

/** After every draw: ask again in 5 s while the latest Try waits or renders (and the asking has not stopped). */
function pollWan(data) {
  clearTimeout(wanAsk.timer);
  const t = data?.wan?.lastTry;
  if (!t || (t.status !== 'pending' && t.status !== 'running') || wanAsk.stopped) return;
  wanAsk.timer = setTimeout(askWan, WAN_ASK_MS);
}

async function askWan() {
  if (state.busy || document.hidden || wanEditing()) return pollWan(state.data);
  let r;
  try {
    r = await call('GET', API);
  } catch {
    return; // signed out: call() already moved on
  }
  if (!r.ok) return pollWan(state.data);
  if (wanShape(r.data.wan) !== wanAsk.shape) return renderWan(r.data);
  if (Date.now() - wanAsk.since < WAN_ASK_FOR_MS) return pollWan(state.data);
  wanAsk.stopped = true; // nothing new for 10 minutes: the Try shows "Check again"
  return renderWan(state.data);
}

/** "Check again": the next answer counts as news (a fresh 10 minutes), whatever it says. */
function checkWanAgain() {
  wanAsk.shape = '';
  return askWan();
}

// ---------- Tower 12 · Places ----------
// Our own Phnom Penh place list (src/lib/thirtyda-hub-places.mjs, src/lib/thirtyda-places-index.mjs): the app's place
// search asks it first, then Nominatim. The tower shows the list (places, size, age, where it is kept), the last ask of
// OpenStreetMap and the last error; "Refresh now" asks OpenStreetMap again (in the background, up to 3 minutes: this
// page asks every 4 seconds meanwhile); a test search shows which hits are ours and whether Nominatim was asked.

const PLACES_PILLS = {
  live: { pill: 'live', text: 'Live' },
  old: { pill: 'warn', text: 'Out of date' },
  none: { pill: 'warn', text: 'No list yet' },
  refreshing: { pill: 'wait', text: 'Refreshing' },
};
const placesPill = (p) => PLACES_PILLS[p?.status] || PLACES_PILLS.none;
const kilobytes = (n) => `${Math.max(1, Math.round(n / 1024))} KB`;
const STORE_WORDS = { mongo: 'kept in Mongo (one doc)', local: 'kept in a file on this server', memory: 'in memory only' };
const NOMINATIM_WORDS = {
  not_asked: 'not asked (3 of ours were enough)',
  asked: 'asked',
  cached: 'answered from its cache (24 h)',
  busy: 'busy, not asked',
  unavailable: 'no answer within 4 s',
};
const FROM_WORDS = { google: ['Google', 'done'], ours: ['Ours', 'done'], ours_typo: ['Ours · typo', 'pending'], nominatim: ['Nominatim', ''] };
const GOOGLE_WORDS = {
  not_set: 'no key', off: 'Off', cap: 'not asked (the month’s cap is reached)', failed: 'asked, failed (ours answered)',
  none: 'asked, found nothing (ours answered)', asked: 'asked first',
};
const PLACE_LANGS = [['en', 'English'], ['km', 'ខ្មែរ'], ['zh', '中文'], ['ko', '한국어'], ['ja', '日本語']];

function placesListLine(p) {
  if (!p.count) {
    return [h('b', { class: 'cx-bad', text: 'No list yet' }),
      p.refreshing ? ' · being made now.' : ' · the app searches Nominatim alone until there is one. Press Refresh now.'];
  }
  return [h('b', { class: p.status === 'old' ? 'cx-bad' : 'cx-ok', text: `${p.count.toLocaleString('en-GB')} places` }),
    ` · ${kilobytes(p.bytes)} · ${STORE_WORDS[p.store] || p.store || 'kept'}${p.from ? ` · from ${p.from}` : ''}`];
}

/** Each Overpass server's last answer, in the order a refresh asks them (the main one, then the backups). */
function placesServers(p) {
  if (!p.servers?.length) return null;
  return h('ol', { class: 'cx-jobs' }, p.servers.map((s, i) => {
    const ok = s.okAt && (!s.error || s.okAt >= s.error.at);
    const word = s.asking ? ['asking now…', 'pending'] : !s.okAt && !s.error ? ['not asked yet', ''] : ok ? ['good', 'done'] : ['failed', 'failed'];
    return h('li', {}, h('span', { class: `cx-job ${word[1]}`, text: s.host }), ` · ${i ? 'backup' : 'main'} · ${word[0]}`,
      s.okAt ? ` · last good ${when(s.okAt)} (${(s.rows ?? 0).toLocaleString('en-GB')} places, ${(s.ms / 1000).toFixed(1)} s)` : '',
      s.error ? h('span', { class: 'cx-bad', text: ` · ${s.error.message} · ${when(s.error.at)}` }) : null);
  }));
}

function placesAgeLine(p) {
  if (!p.at) return 'Never made.';
  const made = `Made ${ago(p.ageS)} ago (${when(p.at)})`;
  if (p.status === 'old') return [h('b', { class: 'cx-bad', text: `${made}: older than ${p.maxAgeDays} days.` }), ' The next search starts a refresh.'];
  return `${made} · refreshes by itself after ${when(p.nextAt)}.`;
}

function placesAskLine(p) {
  if (p.refreshing) return [h('b', { text: 'Asking now…' }), ` up to 3 minutes.${p.count ? ' The old list stays until the new one is good.' : ''}`];
  if (!p.askedAt) return 'Not asked since the server last started.';
  const ok = p.okAt && p.okAt >= p.askedAt;
  return [`Last asked ${when(p.askedAt)} · `, h('b', { class: ok ? 'cx-ok' : 'cx-bad', text: ok ? 'good answer ✓' : 'failed' })];
}

function placesErrorLine(p) {
  const e = p.lastError;
  return [h('span', { class: 'cx-bad', text: e.message }), ` · ${when(e.at)}`,
    p.retryAt ? ` · searches try again after ${when(p.retryAt)}` : ''];
}

async function refreshPlacesNow() {
  if (state.placesBusy) return;
  state.placesBusy = true;
  state.placesError = null;
  renderPlaces(state.data);
  const r = await call('POST', `${API}/places/refresh`, {});
  state.placesBusy = false;
  state.placesError = r.ok ? null : r.data.error || 'Could not start the refresh.';
  if (r.data.view) renderPlaces(r.data.view);
  else renderPlaces(state.data);
  if (r.ok) toast('Asking OpenStreetMap… up to 3 minutes.');
  $('places-refresh')?.focus();
}

function placesRefreshBlock(p) {
  const btn = h('button', {
    type: 'button', class: 'btn cx-test-btn cx-try-btn', id: 'places-refresh', disabled: state.placesBusy || p.refreshing,
    on: { click: refreshPlacesNow },
  }, p.refreshing || state.placesBusy ? 'Refreshing…' : 'Refresh now');
  const refused = state.placesError
    ? h('div', { class: 'cx-result bad' }, h('p', {}, h('b', { text: 'Not started. ' }), state.placesError)) : null;
  return h('div', { class: 'cx-try' },
    h('h3', { text: 'Refresh' }),
    h('p', { class: 'cx-help' }, `Asks OpenStreetMap (Overpass: the main server, then two backups) for every named café, restaurant, bar, mall, park, museum and hotel in greater Phnom Penh. It also happens by itself every ${p.maxAgeDays} days. At most once every 5 minutes${p.canRefreshAt ? ` (next: ${when(p.canRefreshAt)})` : ''}.`),
    btn,
    refused);
}

async function trySearchPlaces() {
  if (state.placesTry.busy) return;
  const q = ($('places-q')?.value || '').trim();
  const lang = $('places-lang')?.value || 'en';
  if (Array.from(q).length < 2) {
    state.placesTry = { error: 'Type at least 2 letters of a place.' };
    renderPlaces(state.data);
    $('places-q')?.focus();
    return;
  }
  state.placesTry = { busy: true, result: state.placesTry.result };
  renderPlaces(state.data);
  const r = await call('POST', `${API}/places/search`, { q, lang });
  state.placesTry = r.ok ? { result: r.data } : { error: r.data.error || 'Could not search.' };
  renderPlaces(state.data);
  $('places-q')?.focus();
}

function placesResult(t) {
  if (t.error) return h('div', { class: 'cx-result bad' }, h('p', {}, h('b', { text: 'Not searched. ' }), t.error));
  const r = t.result;
  if (!r) return null;
  const n = r.places.length;
  const summary = h('p', {}, h('b', { text: `“${r.q}”: ${n} ${n === 1 ? 'place' : 'places'}` }),
    ` · ${r.ms} ms · Google: ${GOOGLE_WORDS[r.google] || r.google || 'no key'} · ours: ${r.own} (${r.sure} without a typo) · Nominatim: ${NOMINATIM_WORDS[r.nominatim] || r.nominatim}`);
  const list = n ? h('ol', { class: 'cx-jobs' }, r.places.map((p) => {
    const [word, cls] = FROM_WORDS[p.from] || FROM_WORDS.nominatim;
    return h('li', {}, h('span', { class: `cx-job ${cls}`, text: word }), ` ${p.name}`, p.address ? ` — ${p.address}` : '',
      Number.isFinite(p.lat) ? [' · ', link(`https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=18/${p.lat}/${p.lng}`, 'map')] : null);
  })) : h('p', { class: 'cx-fine' }, 'Nothing found: the app shows “No places found”.');
  return h('div', { class: `cx-result ${n ? 'ok' : ''}` }, summary, list);
}

function placesSearchBlock() {
  const t = state.placesTry;
  const input = h('input', {
    class: 'input', id: 'places-q', type: 'search', maxlength: '80', autocomplete: 'off', spellcheck: 'false',
    placeholder: 'e.g. Browns, cafe riverside, BKK1 pizza', 'aria-label': 'Place to search for', 'data-draft': 'places',
    on: { keydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); trySearchPlaces(); } } },
  });
  const lang = h('select', { class: 'input cx-lang', id: 'places-lang', 'aria-label': 'App language', 'data-draft': 'places' },
    PLACE_LANGS.map(([v, text]) => h('option', { value: v, text })));
  const btn = h('button', { type: 'button', class: 'btn cx-test-btn', id: 'places-search', disabled: Boolean(t.busy), on: { click: trySearchPlaces } },
    t.busy ? 'Searching…' : 'Search');
  return h('div', { class: 'cx-try' },
    h('h3', { text: 'Test search' }),
    h('p', { class: 'cx-help' }, 'The app’s own search, around Phnom Penh, in the language picked: Google first when its key is saved (here even while Off; each search counts towards the month’s cap), then our list; 3 of ours found without a typo and Nominatim is not asked. Shown here only.'),
    h('div', { class: 'cx-test-row' }, input, lang, btn),
    placesResult(t));
}

function placesCard(p) {
  // The status pill (placesPill) sits on the tower's top line.
  return h('section', { class: 'panel cx-card cx-signin', 'aria-labelledby': 'cx-places' },
    h('div', { class: 'cx-head' }, logo('places'),
      h('div', { class: 'cx-title' }, h('h2', { id: 'cx-places', text: 'Places' }), h('p', { class: 'cx-sub', text: 'Our own Phnom Penh place list · searched before Nominatim' }))),
    h('dl', { class: 'cx-status' },
      row('List', ...placesListLine(p)),
      row('Age', placesAgeLine(p)),
      row('OpenStreetMap', placesAskLine(p)),
      p.servers?.length ? row('Servers', placesServers(p)) : null,
      p.lastError ? row('Last error', ...placesErrorLine(p)) : null,
      p.google ? row('Google', ...googleLine(p.google)) : null,
      row('In the app', p.google?.state === 'live'
        ? 'Level 3 “Meet” → search: Google first, our sure ones after it; Google failing → ours, then Nominatim.'
        : 'Level 3 “Meet” → search: ours first; fewer than 3 sure hits → Nominatim too, its places after ours.')),
    h('div', { class: 'cx-signin-body' },
      placesRefreshBlock(p),
      p.google ? googleBlock(p.google) : null,
      placesSearchBlock(),
      h('p', { class: 'cx-fine' }, `Source: ${p.source}${p.google?.set ? ' and Google Maps (asked live, nothing kept)' : ''}. © OpenStreetMap contributors (ODbL).`)));
}

// Google Places (src/lib/thirtyda-places-google.mjs): the key (its last 4), On / Off (off until turned on), the cap a
// month and this month's searches. Nothing Google answers is kept, so there is nothing else to show.
const GOOGLE_STATE = {
  not_set: ['cx-bad', 'Not set', ' · the app searches our list and OpenStreetMap only.'],
  unreadable: ['cx-bad', 'Saved with another lock key', ' · save the key again.'],
  off: ['cx-bad', 'Off', ' · the key is saved; try a search below, then turn it on.'],
  cap: ['cx-bad', 'The month’s cap is reached', ' · Google is not asked until the 1st; our list answers.'],
  failing: ['cx-bad', 'Failing', ' · the last search failed (below); our list answered.'],
  live: ['cx-ok', 'On', ' · asked first in every place search.'],
};

function googleLine(gp) {
  const [cls, word, rest] = GOOGLE_STATE[gp.state] || GOOGLE_STATE.not_set;
  return [h('b', { class: cls, text: word }), rest, gp.set && gp.masks?.key ? [' · key ', h('code', { class: 'cx-mono', text: `…${gp.masks.key}` })] : ''];
}

function googleUsageLine(gp) {
  const u = gp.usage;
  const cap = gp.options.monthlyCap;
  const out = [h('b', { class: u.calls >= cap ? 'cx-bad' : 'cx-ok', text: `${u.calls.toLocaleString('en-GB')} of ${cap.toLocaleString('en-GB')}` }),
    ` searches this month (${u.month}, Phnom Penh time) · ${u.ok} good · ${u.failed} failed`];
  if (u.lastError && (!u.lastOk || u.lastError.at > u.lastOk.at)) out.push(' · ', h('span', { class: 'cx-bad', text: u.lastError.message }), ` · ${when(u.lastError.at)}`);
  else if (u.lastOk) out.push(` · last good ${when(u.lastOk.at)}${Number.isFinite(u.lastOk.ms) ? `, ${secs(u.lastOk.ms)}` : ''}`);
  return out;
}

async function saveGoogleOptions(body, err) {
  if (state.busy) return;
  state.busy = true;
  const r = await call('PUT', `${API}/places/google`, body);
  state.busy = false;
  if (!r.ok) {
    if (err) {
      err.textContent = r.data.error || 'Could not save.';
      err.hidden = false;
    } else toast(r.data.error || 'Could not save.');
    return;
  }
  render(r.data, { fresh: 'googleplaces-opt' });
  toast('enabled' in body ? `Google Places ${r.data.places?.google?.options.enabled ? 'on: asked first' : 'off'}.` : 'Monthly cap saved.');
}

function googleBlock(gp) {
  const card = FIELD_CARDS.googleplaces;
  const o = gp.options;
  const [min, max] = gp.capRange;
  const err = h('p', { class: 'cx-err', id: 'gp-opt-err', role: 'alert', hidden: true });
  const cap = h('input', {
    class: 'input cx-mono cx-secs', type: 'number', id: 'gp-cap', min: String(min), max: String(max), step: '1',
    inputmode: 'numeric', value: String(o.monthlyCap), 'data-draft': 'googleplaces-opt', 'aria-describedby': 'gp-opt-err',
  });
  const power = h('button', {
    type: 'button', class: 'btn cx-test-btn', id: 'gp-power', 'aria-pressed': String(o.enabled), disabled: !gp.set || !gp.readable,
    on: { click: () => saveGoogleOptions({ enabled: !o.enabled }) },
  }, o.enabled ? 'Turn off' : 'Turn on');
  const save = h('button', {
    type: 'button', class: 'btn cx-test-btn', id: 'gp-cap-save',
    on: {
      click: () => {
        const n = Number(cap.value);
        if (!Number.isInteger(n) || n < min || n > max) {
          err.textContent = `A whole number of searches from ${min} to ${max.toLocaleString('en-GB')}.`;
          err.hidden = false;
          cap.focus();
          return;
        }
        saveGoogleOptions({ monthlyCap: n }, err);
      },
    },
  }, 'Save');
  return h('div', { class: 'cx-try' },
    h('h3', { text: 'Google Places' }),
    h('p', { class: 'cx-help' }, 'OpenStreetMap is thin on Phnom Penh’s own chains (Tube Coffee, BreadTalk, Pasta Corner …). With a key and On, the app asks Google first, live, and keeps nothing it answers; our list fills in after it and takes over when Google fails or the cap is reached.'),
    h('div', { class: 'cx-where' },
      h('p', { class: 'cx-help' }, h('b', { text: 'How to set it up:' })),
      h('ol', { class: 'cx-steps' }, card.steps.map((step) => h('li', {}, ...step)))),
    fieldsForm({ ...gp, id: 'googleplaces' }, state.data),
    h('dl', { class: 'cx-status' }, row('This month', ...googleUsageLine(gp))),
    h('div', { class: 'cx-power' }, power, h('p', { class: 'cx-help' }, o.enabled
      ? 'On: every place search in the app asks Google first.'
      : 'Off: the app does not ask Google. Test searches below still do.')),
    h('label', { class: 'field cx-secs-label', for: 'gp-cap' }, h('span', { class: 'label', text: 'Most searches a month' })),
    h('div', { class: 'cx-test-row' }, cap, save),
    h('p', { class: 'cx-help' }, `Past it, Google is not asked until the 1st (Phnom Penh time) and our list answers alone (${min}–${max.toLocaleString('en-GB')}; 0 = never). Each person can search 10 times a minute.`),
    err);
}

/** While a refresh runs, the page asks every 4 seconds (at most 4 minutes); only the Places tower is re-drawn. */
const PLACES_ASK_MS = 4000;
const placesAsk = { timer: 0, since: 0 };
function pollPlaces(data) {
  clearTimeout(placesAsk.timer);
  if (!data?.places?.refreshing) {
    placesAsk.since = 0;
    return;
  }
  placesAsk.since ||= Date.now();
  if (Date.now() - placesAsk.since > 4 * 60e3) return;
  placesAsk.timer = setTimeout(askPlaces, PLACES_ASK_MS);
}

async function askPlaces() {
  if (state.busy || document.hidden) return pollPlaces(state.data);
  let r;
  try {
    r = await call('GET', API);
  } catch {
    return; // signed out: call() already moved on
  }
  if (!r.ok || !r.data.places) return pollPlaces(state.data);
  renderPlaces(r.data);
  const p = r.data.places;
  if (p.refreshing) return;
  const ok = p.okAt && p.okAt >= p.askedAt;
  const kept = p.count ? 'The old list stays.' : 'Still no list: the app uses Nominatim alone.';
  // The servers' own words are on the card (Servers): the toast stays short.
  toast(ok ? `Place list refreshed: ${p.count.toLocaleString('en-GB')} places${p.from ? ` from ${p.from}` : ''}.` : `The refresh failed on every server. ${kept}`, 8000);
}

// ---------- Tower 13 · Translate ----------
// Where chat lines and written answers are translated (src/lib/thirtyda-hub-translate.mjs, src/lib/thirtyda-translate.mjs):
// the server (our M1, llm.ggmt.sg), the model, its token (saved locked, its last 4 only) and how the model is asked; On /
// Off (off until turned on) and the most seconds a send waits; what the app's translations did since the server started;
// and a Try (one line into one language or all four, even while Off).

const TR_PILLS = {
  not_set: { pill: 'off', text: 'Not set' },
  off: { pill: 'off', text: 'Off' },
  saved: { pill: 'saved', text: 'Saved, not tried' },
  failing: { pill: 'warn', text: 'Failing' },
  live: { pill: 'live', text: 'Live' },
};
const trPill = (t) => TR_PILLS[t?.status] || TR_PILLS.not_set;
const LANG_WORDS = Object.fromEntries(PLACE_LANGS);
const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;

function trWhereLine(t) {
  if (!t.host) return [h('b', { class: 'cx-bad', text: 'Not set' }), ' · chats show “Translation not available yet” and the original line.'];
  return [h('b', { text: t.host }), ` · ${t.model || 'the loaded model'} · ${t.style === 'hy-mt' ? 'Hy-MT (no system prompt)' : 'chat prompt'}`,
    t.source === 'env' ? ' · from the server’s settings (THIRTYDA_TRANSLATE_…): saving here takes over.' : '',
    t.ours ? '' : h('span', { class: 'cx-bad', text: ` · not ${t.privacyHost}: put this company on the privacy page before turning it on.` })];
}

function trTokenLine(t) {
  if (!t.set) return t.source === 'env' ? 'From the server’s settings.' : 'Not saved.';
  if (!t.readable) return [h('b', { class: 'cx-bad', text: 'Saved with another lock key' }), ' · save it again.'];
  return [h('code', { class: 'cx-mono', text: `…${t.masks?.token || ''}` }), ` · saved ${when(t.updatedAt)}`];
}

function trAppLine(t) {
  if (!t.host) return 'Nothing is translated: people see the original line.';
  if (!t.options.enabled) return [h('b', { class: 'cx-bad', text: 'Off: ' }), 'nothing is translated; people see the original line. Try it, then turn it on.'];
  const s = t.stats;
  return `On · since the server started: ${s.ok} translated, ${s.failed} failed, ${s.cached} from memory${s.avgMs ? ` · about ${secs(s.avgMs)} a line` : ''}.`;
}

function trLastLine(t) {
  const s = t.stats;
  const out = [];
  if (s.pausedUntil) out.push(h('b', { class: 'cx-bad', text: `Paused until ${when(s.pausedUntil)} after a failure. ` }));
  if (s.lastError) out.push(h('span', { class: 'cx-bad', text: s.lastError.message }), ` · ${when(s.lastError.at)}. `);
  if (s.lastOk) out.push(`Last good: ${when(s.lastOk.at)}, ${secs(s.lastOk.ms)}.`);
  return out.length ? out : 'Nothing translated since the server started.';
}

async function saveTrOptions(body, err) {
  if (state.busy) return;
  state.busy = true;
  const r = await call('PUT', `${API}/translate/options`, body);
  state.busy = false;
  if (!r.ok) {
    if (err) {
      err.textContent = r.data.error || 'Could not save.';
      err.hidden = false;
    } else toast(r.data.error || 'Could not save.');
    return;
  }
  render(r.data, { fresh: 'translate-opt' });
  toast('enabled' in body ? `Translation ${r.data.translate?.options.enabled ? 'on' : 'off'}.` : 'Wait saved.');
}

function trOptionsBlock(t) {
  const o = t.options;
  const [min, max] = t.timeoutRange;
  const err = h('p', { class: 'cx-err', id: 'tr-opt-err', role: 'alert', hidden: true });
  const wait = h('input', {
    class: 'input cx-mono cx-secs', type: 'number', id: 'tr-timeout', min: String(min), max: String(max), step: '1',
    inputmode: 'numeric', value: String(o.timeoutS), 'data-draft': 'translate-opt', 'aria-describedby': 'tr-opt-err',
  });
  const power = h('button', {
    type: 'button', class: 'btn cx-test-btn', id: 'tr-power', 'aria-pressed': String(o.enabled), disabled: !t.host,
    on: { click: () => saveTrOptions({ enabled: !o.enabled }) },
  }, o.enabled ? 'Turn off' : 'Turn on');
  const save = h('button', {
    type: 'button', class: 'btn cx-test-btn', id: 'tr-wait-save',
    on: {
      click: () => {
        const n = Number(wait.value);
        if (!Number.isInteger(n) || n < min || n > max) {
          err.textContent = `A whole number of seconds from ${min} to ${max}.`;
          err.hidden = false;
          wait.focus();
          return;
        }
        saveTrOptions({ timeoutS: n }, err);
      },
    },
  }, 'Save');
  return h('div', { class: 'cx-try' },
    h('h3', { text: 'On / Off' }),
    h('div', { class: 'cx-power' }, power, h('p', { class: 'cx-help' }, o.enabled
      ? 'On: every chat line and written answer is translated into the other 4 languages when it is sent.'
      : 'Off: nothing is translated. Save the keys, try a few lines, then turn it on.')),
    h('label', { class: 'field cx-secs-label', for: 'tr-timeout' }, h('span', { class: 'label', text: 'Most seconds to wait per line' })),
    h('div', { class: 'cx-test-row' }, wait, save),
    h('p', { class: 'cx-help' }, `A message is sent once its translations are back, so this is how long a send can wait when the M1 is slow (${min}–${max} s; 15 is the pick for Hy-MT2 on the M1). One failure pauses translation for a minute.`),
    err);
}

async function tryTranslateNow() {
  if (state.trTry.busy) return;
  const text = ($('tr-text')?.value || '').trim();
  const from = $('tr-from')?.value || 'en';
  const to = $('tr-to')?.value || 'all';
  if (!text) {
    state.trTry = { error: 'Write a line to translate.' };
    renderTranslate();
    $('tr-text')?.focus();
    return;
  }
  state.trTry = { busy: true, result: state.trTry.result };
  renderTranslate();
  const r = await call('POST', `${API}/translate/try`, { text, from, to });
  state.trTry = r.ok ? { result: r.data } : { error: r.data.error || 'Could not try.' };
  renderTranslate(r.data.view);
  $('tr-text')?.focus();
}

function trTryResult(tt) {
  if (tt.error) return h('div', { class: 'cx-result bad' }, h('p', {}, h('b', { text: 'Not tried. ' }), tt.error));
  const r = tt.result;
  if (!r) return null;
  return h('div', { class: `cx-result ${r.ok ? 'ok' : 'bad'}` },
    h('p', {}, h('b', { text: r.ok ? 'Works ✓ ' : 'Failed. ' }), `${r.host} · ${r.model || 'the loaded model'}${r.enabled ? '' : ' · the app is still Off'}`),
    h('ol', { class: 'cx-jobs' }, r.results.map((x) => h('li', {},
      h('span', { class: `cx-job ${x.ok ? 'done' : 'failed'}`, text: LANG_WORDS[x.to] || x.to }), ' ',
      x.ok ? h('span', { class: 'cx-tr-out', lang: x.to, text: x.text }) : h('span', { class: 'cx-bad', text: x.error }),
      ` · ${secs(x.ms)}`))));
}

function trTryBlock(t) {
  const tt = state.trTry;
  const langSelect = (id, label, first) => h('select', { class: 'input cx-lang', id, 'aria-label': label, 'data-draft': 'translate-try' },
    first, PLACE_LANGS.map(([v, text]) => h('option', { value: v, text })));
  const text = h('textarea', {
    class: 'input cx-area', id: 'tr-text', rows: '2', maxlength: '500', 'aria-label': 'Line to translate', 'data-draft': 'translate-try',
    placeholder: 'e.g. Would you like to meet for coffee on Saturday?',
  });
  const btn = h('button', { type: 'button', class: 'btn cx-test-btn', id: 'tr-try', disabled: Boolean(tt.busy) || !t.host, on: { click: tryTranslateNow } },
    tt.busy ? 'Translating…' : 'Translate');
  return h('div', { class: 'cx-try' },
    h('h3', { text: 'Try' }),
    h('p', { class: 'cx-help' }, t.host
      ? 'One line through the saved server, even while Off; “All four” goes one language after the other. The line is not kept. Check Khmer with a Khmer speaker.'
      : 'Save the address, model and token first.'),
    text,
    h('div', { class: 'cx-test-row cx-tr-row' }, langSelect('tr-from', 'Written in', null), h('span', { class: 'cx-fine', text: '→' }),
      langSelect('tr-to', 'Translate into', h('option', { value: 'all', text: 'All four' })), btn),
    trTryResult(tt));
}

function translateCard(t, data) {
  const card = FIELD_CARDS.translate;
  return h('section', { class: 'panel cx-card cx-signin', 'aria-labelledby': 'cx-translate' },
    h('div', { class: 'cx-head' }, logo('translate'),
      h('div', { class: 'cx-title' }, h('h2', { id: 'cx-translate', text: card.title }), h('p', { class: 'cx-sub', text: card.sub }))),
    h('dl', { class: 'cx-status' },
      row('Server', ...trWhereLine(t)),
      row('Token', ...[trTokenLine(t)].flat()),
      row('In the app', trAppLine(t)),
      row('Last', ...[trLastLine(t)].flat()),
      t.lastTry ? row('Last try', h('b', { class: t.lastTry.ok ? 'cx-ok' : 'cx-bad', text: t.lastTry.ok ? 'worked ✓' : 'failed' }),
        ` · ${when(t.lastTry.at)}${t.lastTry.detail ? ` · ${t.lastTry.detail}` : ''}`) : null),
    h('div', { class: 'cx-signin-body' },
      h('div', { class: 'cx-where' },
        h('p', { class: 'cx-help' }, h('b', { text: 'How to set it up:' })),
        h('ol', { class: 'cx-steps' }, card.steps.map((step) => h('li', {}, ...step)))),
      fieldsForm(t, data),
      trOptionsBlock(t),
      trTryBlock(t)));
}

/** The Try's own draws: the Translate tower only (its data from the answer's `view` when there is one). */
function renderTranslate(view) {
  if (view?.translate && state.data) state.data = { ...state.data, translate: view.translate };
  if (!state.data || !redrawTower('translate')) render(view ?? state.data);
}

// ---------- the hub: thirteen towers left to right ----------

/** A sign-in tower (TikTok, Facebook, Google): its keys card, its pill from signinStatus. */
const signinTower = (id, name) => ({
  key: id, name, kind: 'Sign-in', has: (byId) => byId[id],
  status: (byId) => signinStatus(byId[id]), draw: (byId, data) => signinCard(byId[id], data),
});
const laterOne = (key, name, kind) => ({ key, name, kind, status: () => LATER_PILL, draw: () => laterTower(key) });

/**
 * The towers, left to right, in the owner's order (2026-10-14). key → the tower's id (tower-<key>) and what this
 * browser remembers; name → the strip at the top; kind → the tower's top line; has(byId, data) → drawn only when the
 * server sent its connection (Wan: its `wan` block); status(byId, data) → its pill (and the dot in the strip); draw → its card.
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
  {
    key: 'wan', name: 'Wan', kind: 'Video', has: (byId, data) => Boolean(data?.wan),
    status: (byId, data) => wanPill(data.wan), draw: (byId, data) => wanCard(data.wan),
  },
  {
    key: 'places', name: 'Places', kind: 'Search', has: (byId, data) => Boolean(data?.places),
    status: (byId, data) => placesPill(data.places), draw: (byId, data) => placesCard(data.places),
  },
  {
    key: 'translate', name: 'Translate', kind: 'Language', has: (byId, data) => Boolean(data?.translate),
    status: (byId, data) => trPill(data.translate), draw: (byId, data) => translateCard(data.translate, data),
  },
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
  // and the slider's end means the last tower (11), not the first of them.
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
  // ← → step tower by tower, except while typing in a box (there they move the cursor) or on a player (the Try clip:
  // there they seek).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || !hub.shown.length) return;
    const el = e.target instanceof Element ? e.target : document.body;
    if (el !== slider && el.closest('input, textarea, select, video, audio, [contenteditable]:not([contenteditable="false"])')) return;
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
  const all = TOWERS.filter((t) => !t.has || t.has(byId, data)).map((t) => ({ name: t.name, st: t.status(byId, data) }));
  const named = (test) => all.filter(({ st }) => test(st)).map(({ name }) => name);
  const parts = [];
  const attention = named((st) => st.text === 'Needs attention');
  if (attention.length) parts.push(`${attention.join(' + ')} need${attention.length > 1 ? '' : 's'} attention`);
  const live = named((st) => st.pill === 'live');
  if (live.length) parts.push(`Live: ${live.join(' + ')}`);
  // Stopped / Last try failed, each with its own words.
  const warns = [...new Set(all.filter(({ st }) => st.pill === 'warn' && st.text !== 'Needs attention').map(({ st }) => st.text))];
  for (const text of warns) parts.push(`${text}: ${named((st) => st.pill === 'warn' && st.text === text).join(' + ')}`);
  // Wan, on but its M5 not seen for 2 minutes ("Waiting for the M5"); Places, a refresh on its way ("Refreshing").
  const waits = [...new Set(all.filter(({ st }) => st.pill === 'wait').map(({ st }) => st.text))];
  for (const text of waits) parts.push(`${text}: ${named((st) => st.pill === 'wait' && st.text === text).join(' + ')}`);
  const toTry = named((st) => st.pill === 'saved');
  if (toTry.length) parts.push(`Saved, not tried: ${toTry.join(' + ')}`);
  if (!live.length) parts.push(data.testCodes ? 'Test codes · nothing live yet' : 'Nothing live yet');
  const later = named((st) => st.pill === 'later');
  if (later.length) parts.push(`${later.length} for later`);
  return parts.join(' · ');
}

/** Re-draw every tower. What was typed but not saved stays (except on the card just saved / removed: `fresh`). */
function render(data, { fresh = null } = {}) {
  noteWan(data.wan);
  state.data = data;
  const focused = document.activeElement?.id;
  const drafts = {};
  for (const input of document.querySelectorAll('[data-draft]')) {
    if (input.dataset.draft !== fresh && input.id) drafts[input.id] = input.type === 'checkbox' ? input.checked : input.value;
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
  hub.shown = TOWERS.filter((t) => !t.has || t.has(byId, data));
  const statuses = hub.shown.map((t) => t.status(byId, data));
  row.replaceChildren(...hub.shown.map((t, i) => tower(t, statuses[i], byId, data)));
  $('hub-strip').replaceChildren(...hub.shown.map((t, i) => chip(t, i, statuses[i])));
  for (const [id, value] of Object.entries(drafts)) {
    if (!$(id)) continue;
    if (typeof value === 'boolean') $(id).checked = value;
    else $(id).value = value;
  }
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
  pollWan(data);
  pollPlaces(data);
}

/**
 * One tower re-drawn from state.data, with its strip button and the top line; the other towers are left exactly as they
 * are. What was typed in it, and the focus, stay. → false when the tower is not on the page.
 */
function redrawTower(key) {
  const i = hub.shown.findIndex((t) => t.key === key);
  const old = $(`tower-${key}`);
  if (i < 0 || !old) return false;
  const focused = old.contains(document.activeElement) ? document.activeElement.id : null;
  const drafts = {};
  for (const input of old.querySelectorAll('[data-draft]')) {
    if (input.id) drafts[input.id] = input.type === 'checkbox' ? input.checked : input.value;
  }
  const byId = Object.fromEntries(state.data.connections.map((c) => [c.id, c]));
  const t = hub.shown[i];
  const st = t.status(byId, state.data);
  old.replaceWith(tower(t, st, byId, state.data));
  $('hub-strip').children[i]?.replaceWith(chip(t, i, st));
  for (const [id, value] of Object.entries(drafts)) {
    if (!$(id)) continue;
    if (typeof value === 'boolean') $(id).checked = value;
    else $(id).value = value;
  }
  $('state').textContent = headline(state.data);
  paintHub(false);
  if (focused && $(focused) && !$(focused).disabled) $(focused).focus({ preventScroll: true });
  return true;
}

/**
 * The Try poll's draw: the Wan tower only (its data too: only `wan` is taken from the answer). What was typed in the
 * Wan tower stays.
 */
function renderWan(data) {
  if (!data.wan || !state.data || !$('tower-wan')) return render(data);
  noteWan(data.wan);
  state.data = { ...state.data, wan: data.wan };
  redrawTower('wan');
  pollWan(state.data);
}

/** Tower 12's own draws (Refresh now, the test search, the refresh poll): the Places tower only. */
function renderPlaces(data) {
  if (!data?.places || !state.data || !$('tower-places')) return render(data ?? state.data);
  state.data = { ...state.data, places: data.places };
  redrawTower('places');
  pollPlaces(state.data);
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
