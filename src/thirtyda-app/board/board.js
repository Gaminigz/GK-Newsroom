// 30+DA design board (/30da/board): builds the 12 columns (header, ▷ Play, ↻, live phone, design note)
// and loads each phone (board/frame.html?s=N) only when its column comes into view, a few at a time.
(() => {
  'use strict';

  const FAST = new URLSearchParams(location.search).get('fast') === '1';
  const frameUrl = (n) => `/30da/board/frame.html?s=${n}${FAST ? '&fast=1' : ''}`;

  const PHASES = [
    { name: 'Join', screens: [1, 2, 3, 4] },
    { name: 'Level 1', screens: [5, 6, 7] },
    { name: 'Level 2', screens: [8, 9, 10] },
    { name: 'Level 3', screens: [11, 12] },
  ];

  const SCREENS = {
    1: {
      title: 'Opening', who: 'Signed out · English',
      notes: [
        'App opens with the 30+DA logo animation (letters rise, white bar fills).',
        'Big headline above the logo: “Don’t make the same mistake again.” Tagline under it: safe and calm dating for 30+.',
        'User picks a language: English, ខ្មែរ, 中文, 한국어 or 日本語. The whole app switches to it.',
        '“We will translate for you”: every chat is translated between the two people’s languages.',
        'Tap a language → 2 · Create profile.',
      ],
    },
    2: {
      title: 'Create profile', who: 'New user · English',
      notes: [
        'Add 1 clear photo of your face (more photos unlock at Level 2 and Level 3).',
        'App name = shown to others. Real name = never shown.',
        '“You are”: Sales, Accountant, Own business, Taking some time off, Family time or Home business.',
        'Phone number is needed to chat: Send code → type the 6-digit SMS code (resend after 30 s).',
        'Or verify with Google or Facebook instead.',
        'Globe button switches the language.',
        'Continue → 3 · Nearby.',
      ],
    },
    3: {
      title: 'Nearby', who: 'Dara · English',
      notes: [
        'Phone GPS finds the user’s area (tap the target button to refresh).',
        'Distance slider 1–50 km decides who appears.',
        'Filter: Everyone / Women / Men.',
        'Round faces fill the screen and scroll. Each shows the distance, red hearts received (big, left) and orange hearts received (small, right).',
        'Tap a face → 4 · Profile view.',
      ],
    },
    4: {
      title: 'Profile view', who: 'Dara looks at Sophea',
      notes: [
        'Top: how the person verified — Phone, Gmail, Facebook (dashed = not verified).',
        'Big photo, app name, distance, red and orange heart counts.',
        'Level bar shows where the two people are: 1/3, 2/3 or 3/3.',
        'Level 1–2: “Start a conversation” opens the conversation. Chat stays locked until Level 3.',
        'Level 3: “Chat with Sophea” opens the text chat (11).',
      ],
    },
    5: {
      title: 'Level 1 · Start the conversation', who: 'Dara · English',
      notes: [
        'One conversation screen for everything (5–12): what each of you sent and replied stays above, like a chat.',
        'Either person can start. Dara sends 5 lines: 4 picked from the admin’s lists (one per list) + 1 of his own, a Yes / No line.',
        'Phone numbers, emails, @handles and chat-app names are never allowed: the box turns red and Send stays off.',
        'Sent → his 5 lines sit on the right; Sophea’s replies appear under each one as she taps (“Sophea replied 2 of 5”).',
        'Sophea sends her own 5 too, in any order → they show on the left for Dara to reply to.',
      ],
    },
    6: {
      title: 'Level 1 · Reply line by line', who: 'Sophea · English',
      notes: [
        'Dara’s 5 lines on the left, each with its reply under it: Yes / No / Not really / Maybe (his own written line: Yes / No).',
        'Each tap saves on its own and Dara sees it at once. A reply can be changed until all 5 are in.',
        'Sophea can send her own 5 to Dara at any time (the composer at the bottom).',
        'Level 1 is done when both have sent their 5 and both have replied to all 5 → 7.',
      ],
    },
    7: {
      title: 'Level 1 done · wait 24 h', who: 'Dara · English',
      notes: [
        'Level 1 stays above as plain text: what you told each other and what you asked each other.',
        'A slim banner counts down: “Level 2 opens in 23:59:33” + Remind me (a notification when it opens).',
        'When the time is up, Level 2 opens on the same screen → 8.',
      ],
    },
    8: {
      title: 'Level 2 · Send your 5', who: 'Dara · English',
      notes: [
        'Level 2 works the same way, both ways: 3 lines picked from the admin’s lists + 2 of his own.',
        'Sophea already sent her Level 2: her lines wait on the left for Dara’s words.',
        'Replies come back in words. Phone numbers and chat handles are never allowed.',
      ],
    },
    9: {
      title: 'Level 2 · Reply in words', who: 'Sophea · English',
      notes: [
        'Under each of Dara’s lines: a text box that saves when she pauses or leaves it.',
        'She has replied 2 of 5; Dara has replied 3 of 5 to hers. Each reply shows to the other as soon as it is saved.',
        'A contact detail is stopped: the box turns red, nothing is sent, and the admin sees the attempt.',
        'Level 2 is done when both sets have all 5 replies → 10.',
      ],
    },
    10: {
      title: 'Level 2 done · wait 24 h', who: 'Dara · English',
      notes: [
        'Level 1 and Level 2 stay above as text.',
        'Banner: the chat opens in 24 hours + Remind me.',
        'Level 3 is a text chat. Phone numbers and chat handles are still not allowed; no photos, voice or video (strongly advise to stay text only).',
        'When the time is up the chat opens under the history → 11.',
      ],
    },
    11: {
      title: 'Level 3 · Chat (Dara)', who: 'Dara · English ⇄ Sophea · ខ្មែរ',
      notes: [
        'The chat carries on under the Level 1 and Level 2 history: what you told each other and what you asked each other.',
        'Top row: the partner’s photos (photo 1 always, photo 2 from Level 2, photos 3–4 at Level 3), name, language pair EN⇄KM.',
        'Real-time translation: Sophea’s messages show her Khmer and the English under it; Dara’s own messages show what he wrote.',
        'Type, or tap the mic for speech-to-text (sent as text, never as voice).',
        'Each message must be 20–30 characters. Bar and counter show progress; Send stays off outside the range.',
        'Blocked: messages that are only “yes / ok / hi / bye”, and any phone number, email or chat handle.',
        'Text only: no photos, voice or video.',
      ],
    },
    12: {
      title: 'Same chat · Sophea (KM)', who: 'Sophea · ខ្មែរ ⇄ Dara · English',
      notes: [
        'The same conversation seen from the other side, with the same history above it.',
        'Her app is in Khmer. Dara’s messages show his English and the Khmer under it; her own messages show what she wrote.',
        'Same rules: 20–30 characters, mic speech-to-text, text only, no contact details.',
      ],
    },
  };

  // ---------------------------------------------------------------- DOM (text only, never parsed as HTML)

  function h(tag, attrs = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'on') Object.entries(v).forEach(([ev, fn]) => node.addEventListener(ev, fn));
      else node.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat()) if (kid != null) node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    return node;
  }

  const flow = document.getElementById('flow');
  const jump = document.getElementById('jump');
  const frames = [];

  function column(n) {
    const s = SCREENS[n];
    const label = `${n} · ${s.title}`;
    const frame = h('iframe', {
      title: `Screen ${label} — live demo`,
      'data-src': frameUrl(n),
      width: 390,
      height: 844,
      allow: 'microphone',
      referrerpolicy: 'same-origin',
    });
    frame.dataset.n = String(n);
    const wrap = h('div', { class: 'screen-wrap' }, frame, h('span', { class: 'booting', 'aria-hidden': 'true', text: '30+DA' }));
    frame.addEventListener('load', () => { if (frame.getAttribute('src')) wrap.classList.add('ready'); });
    frames.push(frame);

    const reset = h('button', {
      type: 'button', class: 'reset', title: 'Start this screen over', 'aria-label': `Start screen ${n} over`,
      on: { click: () => restart(frame) },
    }, '↻');
    const play = h('a', {
      class: 'play', href: frameUrl(n), target: '_blank', rel: 'noopener', 'aria-label': `Play screen ${label} full size in a new tab`,
    }, '▷ PLAY');

    return h('article', { class: 'col', id: `s${n}`, 'aria-label': label },
      h('header', { class: 'col-head' },
        h('div', {},
          h('h3', { class: 'col-title', text: label }),
          h('p', { class: 'col-who', text: s.who })),
        h('div', { class: 'col-actions' }, play, reset)),
      h('div', { class: 'bezel' }, wrap),
      h('div', { class: 'note' }, h('ul', {}, s.notes.map((text) => h('li', { text })))));
  }

  for (const phase of PHASES) {
    flow.append(h('section', { class: 'phase', 'aria-label': phase.name },
      h('h2', { class: 'phase-label', text: phase.name }),
      h('div', { class: 'phase-cols' }, phase.screens.map(column))));
    jump.append(h('span', { class: 'jump-group' },
      h('span', { class: 'jump-name', text: phase.name }),
      phase.screens.map((n) => h('button', {
        type: 'button', 'aria-label': `Screen ${n} · ${SCREENS[n].title}`, title: SCREENS[n].title,
        on: { click: () => goTo(n) },
      }, String(n)))));
  }

  function goTo(n) {
    const col = document.getElementById(`s${n}`);
    if (!col) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    col.scrollIntoView({ behavior: still ? 'auto' : 'smooth', inline: 'start', block: 'nearest' });
    load(col.querySelector('iframe'));
  }

  // ---------------------------------------------------------------- lazy loading, a few at a time

  const queue = [];
  let pumping = false;

  function load(frame) {
    if (!frame || frame.dataset.queued) return;
    frame.dataset.queued = '1';
    queue.push(frame);
    pump();
  }

  function pump() {
    if (pumping) return;
    pumping = true;
    const next = () => {
      const frame = queue.shift();
      if (!frame) { pumping = false; return; }
      frame.src = frame.dataset.src;
      setTimeout(next, 260); // twelve apps never boot in the same instant
    };
    next();
  }

  // ↻ reloads the phone in place: location.replace adds no entry to the board tab's history
  // (setting src again would, and the browser's Back button would then step through phones).
  function restart(frame) {
    frame.closest('.screen-wrap')?.classList.remove('ready');
    if (!frame.dataset.queued) { load(frame); return; }
    const url = `${frame.dataset.src}&r=${Date.now()}`;
    try {
      frame.contentWindow.location.replace(url);
    } catch {
      frame.src = url;
    }
  }

  let observer = null;
  const wide = window.matchMedia('(min-width: 721px)');
  function observe() {
    observer?.disconnect();
    const visible = (entries) => entries.forEach((e) => { if (e.isIntersecting) load(e.target); });
    if (!('IntersectionObserver' in window)) { frames.forEach(load); return; }
    // Wide: the row scrolls sideways, so watch it (with one column of lead). Narrow: the page scrolls down.
    observer = new IntersectionObserver(visible, wide.matches
      ? { root: flow, rootMargin: '0px 300px 0px 300px', threshold: 0.01 }
      : { root: null, rootMargin: '300px 0px', threshold: 0.01 });
    frames.filter((f) => !f.dataset.queued).forEach((f) => observer.observe(f));
  }
  observe();
  wide.addEventListener?.('change', observe);

  // Side by side, every phone starts at the same height: the column heads (title + who) all take the
  // height of the tallest one, whatever wraps. Stacked on a phone, each head keeps its own height.
  function alignHeads() {
    const heads = [...flow.querySelectorAll('.col-head')];
    heads.forEach((head) => { head.style.minHeight = ''; });
    if (!wide.matches) return;
    const tallest = Math.max(0, ...heads.map((head) => head.getBoundingClientRect().height));
    heads.forEach((head) => { head.style.minHeight = `${Math.ceil(tallest)}px`; });
  }
  alignHeads();
  document.fonts?.ready.then(alignHeads, () => {});
  let resizing = 0;
  window.addEventListener('resize', () => { cancelAnimationFrame(resizing); resizing = requestAnimationFrame(alignHeads); });
})();
