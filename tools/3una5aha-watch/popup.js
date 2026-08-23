const v = document.getElementById('ver');
try { v.textContent = 'v' + chrome.runtime.getManifest().version; } catch (_) {}

async function openOrFocus(urlPattern, url) {
  const tabs = await chrome.tabs.query({ url: urlPattern });
  if (tabs.length) await chrome.tabs.update(tabs[0].id, { active: true });
  else await chrome.tabs.create({ url });
  window.close();
}

document.getElementById('whatsapp').addEventListener('click', () => {
  openOrFocus('https://web.whatsapp.com/*', 'https://web.whatsapp.com/');
});

document.getElementById('telegram').addEventListener('click', () => {
  openOrFocus('https://web.telegram.org/*', 'https://web.telegram.org/');
});

document.getElementById('maps').addEventListener('click', () => {
  openOrFocus('https://www.google.com/maps*', 'https://www.google.com/maps');
});

document.getElementById('reload').addEventListener('click', async () => {
  // Reload the extension from disk, then refresh any open watched tabs so
  // fresh content scripts (once there are any) inject cleanly.
  const tabs = await chrome.tabs.query({
    url: ['https://web.whatsapp.com/*', 'https://web.telegram.org/*', 'https://www.google.com/maps*'],
  });
  await chrome.storage.local.set({ reloadTabs: tabs.map((t) => t.id) });
  chrome.runtime.reload();
  window.close();
});
