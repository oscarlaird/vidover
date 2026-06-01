const video = document.getElementById('v');
const src = new URLSearchParams(location.search).get('src');

console.log('[vidover player] loaded, src=', src);

if (src) {
  video.src = src;
  video.load();
}

video.addEventListener('error', () => console.error('[vidover player] video error:', video.error));
video.addEventListener('canplay', () => {
  console.log('[vidover player] canplay — starting playback');
  video.play().catch(e => console.error('[vidover player] play() failed:', e));
});
video.addEventListener('playing', () => console.log('[vidover player] playing'));

window.addEventListener('message', e => {
  const msg = e.data;
  console.log('[vidover player] message received:', msg?.type, msg?.cmd ?? '');
  if (!msg || msg.type !== 'vidover') return;
  if (msg.src && video.src !== msg.src) {
    video.src = msg.src;
    video.load();
  }
  if (Number.isFinite(msg.time) && Math.abs(video.currentTime - msg.time) > 0.12) {
    video.currentTime = msg.time;
  }
  video.playbackRate = msg.rate || 1;
  if (msg.paused) video.pause(); else video.play().catch(() => {});
});
