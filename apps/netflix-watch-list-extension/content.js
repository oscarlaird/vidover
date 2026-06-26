const STORAGE_KEY = 'netflix_watch_list';
const PLAYER_KEY = 'netflix_player_rect';
const TIMESTAMP_KEY = 'netflix_timestamp';
const SYNC_DEBUG_KEY = 'netflix_sync_debug';
const OVERLAY_SEL_KEY = 'netflix_overlay_selection';

// -- Cloudflare Stream overlay library --
// Each Netflix episode maps to a Cloudflare Stream video. The right overlay is
// chosen from the title detected on the watch page (show + season/episode).
const CF_CUSTOMER = 'customer-ft9ftep4ttvcv7mg.cloudflarestream.com';
const cfManifest = (videoId) => `https://${CF_CUSTOMER}/${videoId}/manifest/video.m3u8`;

const OVERLAY_LIBRARY = [
  { label: 'Nemesis S01E01', show: /nemesis/i, season: 1, episode: 1,
    videoId: 'e9e6ea4715c535e58b1528607985a27d', syncOffsetSeconds: 0 },
  { label: 'Nemesis S01E03', show: /nemesis/i, season: 1, episode: 3,
    videoId: '3b122812eebf822ef6eb88c959ab5e32', syncOffsetSeconds: 0 },
];

// Pull season/episode numbers out of a Netflix title string. Handles the common
// formats: "S1:E3", "S01E03", "Season 1: Episode 3", or a bare "Episode 3".
function parseEpisode(text) {
  // "S1:E3", "S01E03", "Season 1: Episode 3"
  let m = text.match(/s(?:eason)?\s*(\d{1,2})\s*[:x\s]?\s*e(?:pisode)?\s*(\d{1,3})/i);
  if (m) return { season: Number(m[1]), episode: Number(m[2]) };
  // "Episode 3" word form.
  m = text.match(/\bepisode\s*(\d{1,3})/i);
  if (m) return { season: null, episode: Number(m[1]) };
  // Short/glued "E3" form, e.g. Netflix's "NemesisE3Tête-À-Tête". Case-sensitive
  // uppercase E + digits; E must not follow another uppercase letter, so we
  // don't grab a letter from inside an acronym.
  m = text.match(/(?:^|[^A-Z])E(\d{1,3})(?!\d)/);
  if (m) return { season: null, episode: Number(m[1]) };
  return { season: null, episode: null };
}

// Choose the overlay whose show matches and whose episode (and season, when
// both are known) matches the detected title. Returns null if nothing matches —
// we'd rather show no overlay than the wrong one.
function selectOverlay(titleText) {
  if (!titleText) return null;
  const { season, episode } = parseEpisode(titleText);
  const hit = OVERLAY_LIBRARY.find((e) =>
    e.show.test(titleText) &&
    (e.episode == null || e.episode === episode) &&
    (e.season == null || season == null || e.season === season));
  if (!hit) return null;
  return {
    enabled: true,
    label: hit.label,
    overlayUrl: cfManifest(hit.videoId),
    videoId: hit.videoId,
    syncOffsetSeconds: hit.syncOffsetSeconds || 0,
  };
}

// -- Local overlay server (commented out — replaced by Cloudflare) --
// const OVERLAY_SERVER_ORIGIN = 'http://127.0.0.1:8765';
// const OVERLAY_METADATA_URL = `${OVERLAY_SERVER_ORIGIN}/metadata.json`;
// async function refreshOverlayMetadata() {
//   try {
//     const result = await chrome.runtime.sendMessage({ type: 'fetchJSON', url: OVERLAY_METADATA_URL });
//     if (!result.ok) throw new Error(result.error);
//     overlayMetadata = result.data;
//     console.log('[vidover] metadata:', overlayMetadata);
//   } catch (error) {
//     console.warn('[vidover] metadata fetch failed:', error);
//     overlayMetadata = null;
//   }
// }

let lastDetectedTitle = null;
let pollTimer = null;
let timestampTimer = null;
let overlaySyncTimer = null;
let overlayMetadataTimer = null;
let overlayMetadata = null;       // set by refreshOverlaySelection() from the title
let lastTitleText = null;
let lastUrl = location.href;
let lastSentState = null;

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

// -- Cloudflare overlay video sync --

function overlayUrlFromMetadata(metadata) {
  if (!metadata || !metadata.enabled || !metadata.overlayUrl) return null;
  return metadata.overlayUrl;
}

// Combined title text used for overlay matching: the watch-page title element
// (show + S#:E# + episode title) plus the document title as a fallback.
function getNetflixTitleText() {
  const parts = [];
  const el = document.querySelector('[data-uia="video-title"]');
  if (el && el.textContent.trim()) parts.push(el.textContent.trim());
  if (document.title && document.title !== 'Netflix') parts.push(document.title);
  return parts.join(' | ');
}

// Re-evaluate which overlay should play for the current title. Cheap to call
// often — only recomputes (and republishes the debug selection) when the
// detected title text actually changes.
function refreshOverlaySelection() {
  const titleText = getNetflixTitleText();
  if (titleText === lastTitleText) return;
  lastTitleText = titleText;
  overlayMetadata = selectOverlay(titleText);
  const label = overlayMetadata ? overlayMetadata.label : null;
  console.log('[vidover] title:', JSON.stringify(titleText), '=> overlay:', label || '(none)');
  chrome.storage.local.set({
    [OVERLAY_SEL_KEY]: {
      title: titleText || null,
      label,
      videoId: overlayMetadata ? overlayMetadata.videoId : null,
      enabled: !!overlayMetadata,
      updatedAt: Date.now(),
    },
  });
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
  lastSentState = null;
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
    left: `${videoRect.x}px`,
    top: `${videoRect.y}px`,
    width: `${videoRect.width}px`,
    height: `${videoRect.height}px`,
  });
  return true;
}

// Events on the Netflix <video> that should immediately re-sync the overlay,
// so play/pause/seek/rate changes are reflected without waiting for the timer.
const NETFLIX_VIDEO_EVENTS = ['play', 'pause', 'seeking', 'seeked', 'ratechange', 'timeupdate', 'waiting', 'playing'];
let trackedVideoEl = null;

function detachVideoSyncListeners() {
  if (!trackedVideoEl) return;
  for (const ev of NETFLIX_VIDEO_EVENTS) trackedVideoEl.removeEventListener(ev, syncOverlayVideo);
  trackedVideoEl = null;
}

function ensureVideoSyncListeners(videoEl) {
  if (videoEl === trackedVideoEl) return;
  detachVideoSyncListeners();
  trackedVideoEl = videoEl;
  for (const ev of NETFLIX_VIDEO_EVENTS) videoEl.addEventListener(ev, syncOverlayVideo);
}

function syncOverlayVideo() {
  refreshOverlaySelection();
  const overlayUrl = overlayUrlFromMetadata(overlayMetadata);
  const netflixVideo = getNetflixVideo();
  if (!overlayUrl || !netflixVideo || !isWatchPage()) {
    detachVideoSyncListeners();
    removeOverlayIframe();
    return;
  }

  ensureVideoSyncListeners(netflixVideo);
  const iframe = ensureOverlayIframe(overlayUrl);
  if (!positionOverlayIframe(iframe)) return;

  const offset = Number(overlayMetadata.syncOffsetSeconds || 0);
  const targetTime = Math.max(0, netflixVideo.currentTime + offset);
  // Hold the overlay (treat as paused) while Netflix is scrubbing or buffering,
  // so it doesn't run ahead of a frozen Netflix frame and snap back later.
  const stalled = netflixVideo.seeking || netflixVideo.readyState < 3; // < HAVE_FUTURE_DATA
  const paused = netflixVideo.paused || netflixVideo.ended || stalled;
  const rate = netflixVideo.playbackRate || 1;

  // Only send a message when something meaningful has changed.
  // While paused, skip redundant messages — repeated pause() calls
  // can cause the overlay video to flicker in/out of play state.
  const roundedTime = Math.round(targetTime * 4) / 4; // 0.25s granularity
  const stateKey = `${paused}|${roundedTime}|${rate}|${overlayUrl}`;
  if (stateKey === lastSentState) return;
  lastSentState = stateKey;

  iframe.contentWindow?.postMessage({
    type: 'vidover',
    src: overlayUrl,
    time: targetTime,
    rate,
    paused,
  }, '*');
}

function startOverlayTracking() {
  // No metadata polling needed — overlay config is hardcoded from Cloudflare.
  // overlayMetadataTimer left unused (local server polling commented out above).
  if (!overlaySyncTimer) {
    overlaySyncTimer = setInterval(syncOverlayVideo, 250);
  }
}

function stopOverlayTracking() {
  if (overlaySyncTimer) {
    clearInterval(overlaySyncTimer);
    overlaySyncTimer = null;
  }
  detachVideoSyncListeners();
  removeOverlayIframe();
  chrome.storage.local.remove(SYNC_DEBUG_KEY);
  chrome.storage.local.remove(OVERLAY_SEL_KEY);
  overlayMetadata = null;
  lastTitleText = null;
}

// Receive actual overlay playback state from the player iframe and store a
// matched-instant Netflix-vs-overlay comparison for the popup debug readout.
window.addEventListener('message', (e) => {
  const msg = e.data;
  if (!msg || msg.type !== 'vidover-status') return;
  const offset = Number((overlayMetadata && overlayMetadata.syncOffsetSeconds) || 0);
  const netflixTime = Number.isFinite(msg.target) ? msg.target - offset : null;
  const overlayTime = Number.isFinite(msg.overlayTime) ? msg.overlayTime : null;
  const delta = (netflixTime != null && overlayTime != null) ? overlayTime - netflixTime : null;
  chrome.storage.local.set({
    [SYNC_DEBUG_KEY]: {
      netflixTime,
      overlayTime,
      delta,
      ready: msg.ready,
      err: msg.err || 0,
      paused: !!msg.paused,
      rate: msg.rate || 1,
      updatedAt: Date.now(),
    },
  });
});

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