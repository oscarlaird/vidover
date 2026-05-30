// Background service worker — proxies localhost fetches for content scripts.
// Content scripts run in the page's origin context (netflix.com) so Chrome's
// Private Network Access policy blocks them from reaching 127.0.0.1 directly.
// Service workers use the extension's own origin and are not subject to that
// restriction, so we proxy through here instead.

// One-shot JSON proxy (for metadata.json)
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'fetchJSON') return false;
  fetch(message.url, { cache: 'no-store' })
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(data => sendResponse({ ok: true, data }))
    .catch(err => sendResponse({ ok: false, error: err.message }));
  return true; // keep channel open for async response
});

// Streaming video proxy (for the overlay mp4).
// Uses a long-lived port to avoid message size limits when transferring
// large binary payloads. The content script assembles chunks into a Blob
// and creates a local blob: URL the video element can load safely.
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'videoStream') return;
  port.onMessage.addListener(async msg => {
    if (msg.type !== 'start') return;
    try {
      const response = await fetch(msg.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentLength = response.headers.get('content-length');
      if (contentLength) {
        port.postMessage({ type: 'size', bytes: Number(contentLength) });
      }
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) { port.postMessage({ type: 'done' }); break; }
        port.postMessage({ type: 'chunk', data: value }); // value is Uint8Array
      }
    } catch (e) {
      port.postMessage({ type: 'error', error: e.message });
    }
  });
});
