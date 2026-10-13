// GET /30da/back — the page GKVerify's big "⬅️ Back to 30+DA" Telegram button opens (src/lib/thirtyda-pages.mjs
// backPage). Try its big button's link once by itself: the app on an iPhone (sg.ggmt.thirtyda://open), the app on an
// Android phone (Chrome's intent:// link, which falls back to the web app), else the web app (/30da/). When the phone
// wants a tap first, the button and "Open 30+DA in the browser" stay right there. An external file: the page's CSP
// allows no inline script.
const open = document.querySelector('a[data-back-open]');
if (open) {
  // The web app replaces this page, so the browser's Back does not land here and bounce forward again.
  if (/^https?:/i.test(open.href)) window.location.replace(open.href);
  else window.location.href = open.href;
}
