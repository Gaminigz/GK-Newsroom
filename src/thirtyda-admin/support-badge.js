// 30+DA admin: the counts in every admin page's sidebar — next to "Support" the questions people sent the Telegram
// bot that nobody has opened yet, next to "Photos" the photos waiting for approval. The Support and Photos pages keep
// their own badge fresh from their own lists too (support.js, photos.js).
(() => {
  const BADGES = [
    { id: 'support-badge', url: '/30da/admin/api/support/unread', key: 'unread', label: 'unread' },
    { id: 'photos-badge', url: '/30da/admin/api/photos/count', key: 'count', label: 'waiting' },
  ].map((b) => ({ ...b, el: document.getElementById(b.id) })).filter((b) => b.el);
  if (!BADGES.length) return;
  async function update() {
    for (const b of BADGES) {
      try {
        const res = await fetch(b.url, { cache: 'no-store' });
        if (!res.ok) continue;
        const n = Number((await res.json())[b.key]) || 0;
        b.el.textContent = n > 99 ? '99+' : String(n);
        b.el.setAttribute('aria-label', `${n} ${b.label}`);
        b.el.hidden = !(n > 0);
      } catch { /* offline: try again later */ }
    }
  }
  update();
  setInterval(() => { if (!document.hidden) update(); }, 30_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) update(); });
})();
