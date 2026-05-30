const STORAGE_KEY = 'netflix_watch_list';
const PLAYER_KEY = 'netflix_player_rect';
const TIMESTAMP_KEY = 'netflix_timestamp';
const OVERLAY_SERVER_ORIGIN = 'http://127.0.0.1:8765';
const OVERLAY_METADATA_URL = `${OVERLAY_SERVER_ORIGIN}/metadata.json`;
let lastDetectedTitle = null;
let pollTimer = null;
let timestampTimer = null;
let overlaySyncTimer = null;
let overlayMetadataTimer = null;
let overlayMetadata = null;
let lastUrl = location.href;

const OVERLAY_IFRAME_ID = 'vidover-netflix-overlay-iframe';

// -- Player dimension tracking --

const PLAYER_SELECTORS = [
  '.watch-video--player-view',
  '.NFPlayer',
  '.VideoContainer',
  'video',
];

function getPlayerElement() {
  for (const sel of PLAYER_SELECTORS) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function getNetflixVideo() {
  return document.querySelector('video');
}

function calcVideoContentRect(container, videoEl) {
  const vW = videoEl.videoWidth;
  const vH = videoEl.videoHeight;
  if (!vW || !vH) return null;

  const videoAR = vW / vH;
  const containerAR = container.width / container.height;

  let renderedW, renderedH;
  if (videoAR >= containerAR) {
    // Wider than container — pillarbox (black bars left/right)
    renderedW = container.width;
    renderedH = container.width / videoAR;
  } else {
    // Taller than container — letterbox (black bars top/bottom)
    renderedH = container.height;
    renderedW = container.height * videoAR;
  }

  const x = container.x + (container.width - renderedW) / 2;
  const y = container.y + (container.height - renderedH) / 2;

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(renderedW),
    height: Math.round(renderedH),
    right: Math.round(x + renderedW),
    bottom: Math.round(y + renderedH),
    intrinsicWidth: vW,
    intrinsicHeight: vH,
    aspectRatio: `${vW}:${vH}`,
  };
}

function measurePlayer() {
  const el = getPlayerElement();
  if (!el) {
    chrome.storage.local.remove(PLAYER_KEY);
    return;
  }

  const r = el.getBoundingClientRect();
  const player = {
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: Math.round(r.width),
    height: Math.round(r.height),
    bottom: Math.round(r.bottom),
    right: Math.round(r.right),
  };

  const videoEl = document.querySelector('video');
  const video = videoEl ? calcVideoContentRect(player, videoEl) : null;

  chrome.storage.local.set({ [PLAYER_KEY]: { player, video, updatedAt: Date.now() } });
}

function startPlayerTracking() {
  measurePlayer();
  window.addEventListener('resize', measurePlayer);
}

function stopPlayerTracking() {
  window.removeEventListener('resize', measurePlayer);
  chrome.storage.local.remove(PLAYER_KEY);
}

// -- Timestamp tracking --

function measureTimestamp() {
  const videoEl = document.querySelector('video');
  if (!videoEl) {
    chrome.storage.local.remove(TIMESTAMP_KEY);
    return;
  }
  const current = videoEl.currentTime;
  const duration = videoEl.duration;
  if (isNaN(current)) return;
  chrome.storage.local.set({
    [TIMESTAMP_KEY]: {
      current: Math.floor(current),
      duration: isNaN(duration) ? null : Math.floor(duration),
    },
  });
}

function startTimestampTracking() {
  if (timestampTimer) return;
  measureTimestamp();
  timestampTimer = setInterval(measureTimestamp, 500);
}

function stopTimestampTracking() {
  if (timestampTimer) {
    clearInterval(timestampTimer);
    timestampTimer = null;
  }
  chrome.storage.local.remove(TIMESTAMP_KEY);
}

// -- Local overlay video sync --

function overlayUrlFromMetadata(metadata) {
  if (!metadata || !metadata.enabled || !metadata.overlayUrl) return null;
  if (/^https?:\/\//i.test(metadata.overlayUrl)) return metadata.overlayUrl;
  return `${OVERLAY_SERVER_ORIGIN}${metadata.overlayUrl}`;
}

async function refreshOverlayMetadata() {
  try {
    const result = await chrome.runtime.sendMessage({ type: 'fetchJSON', url: OVERLAY_METADATA_URL });
    if (!result.ok) throw new Error(result.error);
    overlayMetadata = result.data;
    console.log('[vidover] metadata:', overlayMetadata);
  } catch (error) {
    console.warn('[vidover] metadata fetch failed:', error);
    overlayMetadata = null;
  }
}

function ensureOverlayIframe(src) {
  let iframe = document.getElementById(OVERLAY_IFRAME_ID);
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.id = OVERLAY_IFRAME_ID;
    Object.assign(iframe.style, {
      position: 'fixed',
      left: '0px',
      top: '0px',
      width: '0px',
      height: '0px',
      zIndex: '2147483647',
      pointerEvents: 'none',
      border: '3px solid hotpink',
      opacity: '0.5',
      background: 'transparent',
    });
    iframe.allow = 'autoplay';
    iframe.src = chrome.runtime.getURL('player.html') + '?src=' + encodeURIComponent(src);
    document.documentElement.appendChild(iframe);
  }
  return iframe;
}

function removeOverlayIframe() {
  const iframe = document.getElementById(OVERLAY_IFRAME_ID);
  if (iframe) iframe.remove();
}

function positionOverlayIframe(iframe) {
  const player = getPlayerElement();
  const netflixVideo = getNetflixVideo();
  if (!player || !netflixVideo) return false;

  const playerRect = player.getBoundingClientRect();
  const videoRect = calcVideoContentRect(
    { x: playerRect.x, y: playerRect.y, width: playerRect.width, height: playerRect.height },
    netflixVideo
  );
  if (!videoRect) return false;

  Object.assign(iframe.style, {
    left: `${videoRect.x + 50}px`,
    top: `${videoRect.y + 50}px`,
    width: `${videoRect.width}px`,
    height: `${videoRect.height}px`,
  });
  return true;
}

function syncOverlayVideo() {
  const serverUrl = overlayUrlFromMetadata(overlayMetadata);
  const netflixVideo = getNetflixVideo();
  if (!serverUrl || !netflixVideo || !isWatchPage()) {
    removeOverlayIframe();
    return;
  }

  const iframe = ensureOverlayIframe(serverUrl);
  if (!positionOverlayIframe(iframe)) return;

  const offset = Number(overlayMetadata.syncOffsetSeconds || 0);
  const targetTime = Math.max(0, netflixVideo.currentTime + offset);

  iframe.contentWindow?.postMessage({
    type: 'vidover',
    src: serverUrl,
    time: targetTime,
    rate: netflixVideo.playbackRate || 1,
    paused: netflixVideo.paused || netflixVideo.ended,
  }, '*');
}

function startOverlayTracking() {
  if (!overlayMetadataTimer) {
    refreshOverlayMetadata();
    overlayMetadataTimer = setInterval(refreshOverlayMetadata, 5000);
  }
  if (!overlaySyncTimer) {
    overlaySyncTimer = setInterval(syncOverlayVideo, 250);
  }
}

function stopOverlayTracking() {
  if (overlayMetadataTimer) {
    clearInterval(overlayMetadataTimer);
    overlayMetadataTimer = null;
  }
  if (overlaySyncTimer) {
    clearInterval(overlaySyncTimer);
    overlaySyncTimer = null;
  }
  overlayMetadata = null;
  removeOverlayVideo();
}

function isWatchPage() {
  return /netflix\.com\/watch\//i.test(location.href);
}

function getNetflixTitle() {
  const selectors = [
    '[data-uia="video-title"]',
    '.watch-title',
    '.video-title h4',
    '.video-title',
    '.ellipsize-text h4',
    '.ellipsize-text',
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && el.textContent.trim()) {
      return el.textContent.trim();
    }
  }

  const docTitle = document.title;
  if (docTitle && docTitle !== 'Netflix') {
    const cleaned = docTitle.replace(/\s*[-–|]\s*Netflix\s*$/i, '').trim();
    if (cleaned && cleaned !== 'Netflix') return cleaned;
  }

  return null;
}

function addTitleToList(title) {
  chrome.storage.local.get([STORAGE_KEY], (result) => {
    const list = result[STORAGE_KEY] || [];
    const alreadyExists = list.some(
      (item) => item.title.toLowerCase() === title.toLowerCase()
    );
    if (!alreadyExists) {
      list.push({ title, addedAt: new Date().toISOString() });
      chrome.storage.local.set({ [STORAGE_KEY]: list });
    }
  });
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startPolling() {
  stopPolling();
  lastDetectedTitle = null;

  let attempts = 0;
  const MAX_ATTEMPTS = 30;

  pollTimer = setInterval(() => {
    attempts++;

    const title = getNetflixTitle();
    if (title && title !== lastDetectedTitle) {
      lastDetectedTitle = title;
      addTitleToList(title);
    }

    if (attempts >= MAX_ATTEMPTS) {
      stopPolling();
    }
  }, 1000);
}

function onUrlChange() {
  const currentUrl = location.href;
  if (currentUrl === lastUrl) return;
  lastUrl = currentUrl;

  if (isWatchPage()) {
    startPolling();
    startPlayerTracking();
    startTimestampTracking();
    startOverlayTracking();
  } else {
    stopPolling();
    stopPlayerTracking();
    stopTimestampTracking();
    stopOverlayTracking();
  }
}

// Observe URL changes in Netflix's single-page app
const observer = new MutationObserver(onUrlChange);
observer.observe(document.body, { childList: true, subtree: true });

// Also poll for URL changes as a fallback
setInterval(onUrlChange, 1500);

// Kick off immediately if already on a watch page
if (isWatchPage()) {
  startPolling();
  startPlayerTracking();
  startTimestampTracking();
  startOverlayTracking();
}

// Respond to requests from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getTitle') {
    sendResponse({ title: getNetflixTitle() });
  }
  if (request.action === 'getPlayerRect') {
    measurePlayer();
    chrome.storage.local.get([PLAYER_KEY], (result) => {
      sendResponse({ rect: result[PLAYER_KEY] || null });
    });
    return true;
  }
});
