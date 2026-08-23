// Starter — most behavior isn't decided yet. Placeholder so the manifest's
// service_worker reference resolves; fill in once the watch logic is decided.

// After "Reload Agent" the extension reloads from disk and the worker
// restarts here — refresh the tabs the popup flagged so fresh content
// scripts (once there are any) inject cleanly.
chrome.storage.local.get('reloadTabs', ({ reloadTabs }) => {
  if (!reloadTabs || !reloadTabs.length) return;
  chrome.storage.local.remove('reloadTabs');
  reloadTabs.forEach((id) => { try { chrome.tabs.reload(id); } catch (_) {} });
});
