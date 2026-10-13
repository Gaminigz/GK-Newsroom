// 30+DA admin: the unread count next to "Support" in every admin page's sidebar (questions people sent the Telegram
// bot that nobody has opened yet). The Support page itself keeps it fresh from its own list (support.js).
(() => {
  const badge = document.getElementById('support-badge');
  if (!badge) return;
  async function update() {
    try {
      const res = await fetch('/30da/admin/api/support/unread', { cache: 'no-store' });
      if (!res.ok) return;
      const { unread = 0 } = await res.json();
      badge.textContent = unread > 99 ? '99+' : String(unread);
      badge.setAttribute('aria-label', `${unread} unread`);
      badge.hidden = !(unread > 0);
    } catch { /* offline: try again later */ }
  }
  update();
  setInterval(() => { if (!document.hidden) update(); }, 30_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) update(); });
})();
