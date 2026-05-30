const video = document.getElementById('v');
const src = new URLSearchParams(location.search).get('src');
if (src) video.src = src;

window.addEventListener('message', e => {
  const msg = e.data;
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
