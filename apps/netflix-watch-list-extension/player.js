// Overlay player. Receives the Netflix playback state via postMessage and keeps
// this muted <video> locked to it.
//
// The overlay is streamed over HTTP range requests, so every seek forces a
// rebuffer. We therefore avoid seeking during normal playback: instead we
// predict Netflix's live position between messages and steer toward it with
// small playbackRate nudges. Hard seeks are reserved for large jumps (scrubs)
// and for paused repositioning.

const video = document.getElementById('v');

// Desired playback state, set by 'vidover' messages from the content script.
const state = {
  src: new URLSearchParams(location.search).get('src') || null,
  targetTime: 0,
  rate: 1,
  // Stay put until the first message tells us what Netflix is doing, so we
  // never autoplay into the wrong state.
  paused: true,
  receivedAt: performance.now(),
  haveState: false,
};

// Sync tuning, in seconds / fractions.
const DEAD_BAND = 0.05;   // within this drift we're synced; hold rate exactly
const HARD_SEEK = 0.75;   // beyond this we jump instead of nudging (scrub/jump)
const NUDGE_GAIN = 0.5;   // playbackRate delta per second of drift
const MAX_NUDGE = 0.30;   // cap the nudge at +/-30% so motion stays natural
const PAUSED_EPS = 0.08;  // while paused, only re-seek past this drift

if (state.src) {
  video.src = state.src;
  video.load();
}

// Where Netflix is *now*, extrapolated from the last message we received.
function predictedTarget() {
  if (state.paused) return state.targetTime;
  const elapsed = (performance.now() - state.receivedAt) / 1000;
  return state.targetTime + elapsed * state.rate;
}

function control() {
  if (!state.haveState || !Number.isFinite(video.duration)) return;

  // Paused: sit exactly on the target frame and stay there. Crucially, do not
  // play() here — that is what made the overlay loop while Netflix was paused.
  if (state.paused) {
    if (!video.paused) video.pause();
    if (Math.abs(video.currentTime - state.targetTime) > PAUSED_EPS) {
      video.currentTime = state.targetTime;
    }
    if (video.playbackRate !== 1) video.playbackRate = 1;
    return;
  }

  const target = predictedTarget();
  const drift = video.currentTime - target;  // >0 => overlay is ahead

  if (Math.abs(drift) > HARD_SEEK) {
    // Big gap (initial load, scrub, tab wakeup): jump.
    video.currentTime = target;
    video.playbackRate = state.rate;
  } else if (Math.abs(drift) <= DEAD_BAND) {
    // Synced: hold the real rate.
    if (video.playbackRate !== state.rate) video.playbackRate = state.rate;
  } else {
    // Small drift: steer back smoothly. Slow down if ahead, speed up if behind.
    const delta = Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, -drift * NUDGE_GAIN));
    video.playbackRate = state.rate * (1 + delta);
  }

  if (video.paused) video.play().catch(() => {});
}

window.addEventListener('message', (e) => {
  const msg = e.data;
  if (!msg || msg.type !== 'vidover') return;

  if (msg.src && msg.src !== state.src) {
    state.src = msg.src;
    video.src = msg.src;
    video.load();
  }
  if (Number.isFinite(msg.time)) state.targetTime = Math.max(0, msg.time);
  state.rate = msg.rate || 1;
  state.paused = !!msg.paused;
  state.receivedAt = performance.now();
  state.haveState = true;

  control();
});

video.addEventListener('loadeddata', control);
// Only resume after a (re)buffer if we're actually supposed to be playing.
video.addEventListener('canplay', () => {
  if (state.haveState && !state.paused) video.play().catch(() => {});
});
video.addEventListener('error', () => console.error('[vidover player] video error:', video.error));

// Continuous correction between messages, driven by the predicted target.
setInterval(control, 50);
