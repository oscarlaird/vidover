// Background service worker — proxies localhost JSON fetches for content scripts.
// Content scripts run in netflix.com's origin context, so Chrome's Private
// Network Access policy blocks them from reaching 127.0.0.1 directly.
// Service workers use the extension's own origin and are not affected.
// Video loading is handled by player.html (an extension page) which also
// has extension origin and can reach localhost without PNA issues.

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'fetchJSON') return false;
  fetch(message.url, { cache: 'no-store' })
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(data => sendResponse({ ok: true, data }))
    .catch(err => sendResponse({ ok: false, error: err.message }));
  return true;
});
