// Background service worker — proxies localhost fetches for content scripts.
// Content scripts run in the page's origin context (netflix.com) so Chrome's
// Private Network Access policy blocks them from reaching 127.0.0.1 directly.
// Service workers use the extension's own origin and are not subject to that
// restriction, so we proxy through here instead.

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'fetchJSON') return false;
  fetch(message.url, { cache: 'no-store' })
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(data => sendResponse({ ok: true, data }))
    .catch(err => sendResponse({ ok: false, error: err.message }));
  return true; // keep the message channel open for the async response
});
