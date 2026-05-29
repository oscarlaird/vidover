const STORAGE_KEY = 'netflix_watch_list';
const PLAYER_KEY = 'netflix_player_rect';
const TIMESTAMP_KEY = 'netflix_timestamp';

function formatDate(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function getList(callback) {
  chrome.storage.local.get([STORAGE_KEY], (result) => {
    callback(result[STORAGE_KEY] || []);
  });
}

function saveList(list, callback) {
  chrome.storage.local.set({ [STORAGE_KEY]: list }, callback);
}

function renderList(list) {
  const ul = document.getElementById('watch-list');
  const emptyState = document.getElementById('empty-state');
  const count = document.getElementById('count');

  ul.innerHTML = '';
  count.textContent = list.length;

  if (list.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');

  const reversed = [...list].reverse();
  reversed.forEach((item, idx) => {
    const realIdx = list.length - 1 - idx;
    const li = document.createElement('li');
    li.className = 'list-item';
    li.innerHTML = `
      <span class="item-dot"></span>
      <span class="item-name">${escapeHtml(item.title)}</span>
      <span class="item-date">${formatDate(item.addedAt)}</span>
      <button class="btn-remove" data-index="${realIdx}" title="Remove">&times;</button>
    `;
    ul.appendChild(li);
  });

  ul.querySelectorAll('.btn-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.index, 10);
      getList((list) => {
        list.splice(index, 1);
        saveList(list, () => renderList(list));
      });
    });
  });
}

function formatTime(totalSeconds) {
  if (totalSeconds == null || isNaN(totalSeconds)) return '—';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function renderTimestamp(data) {
  const section = document.getElementById('timestamp-section');
  if (!data || data.current == null) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');
  document.getElementById('ts-current').textContent = formatTime(data.current);
  document.getElementById('ts-duration').textContent = formatTime(data.duration);
  const pct = (data.duration && data.duration > 0)
    ? Math.min(100, (data.current / data.duration) * 100).toFixed(2)
    : 0;
  document.getElementById('ts-bar').style.width = `${pct}%`;
}

function px(val) {
  return `${val}<span class="unit">px</span>`;
}

function renderPlayerRect(data) {
  const section = document.getElementById('player-section');
  if (!data || !data.player) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');

  const p = data.player;
  document.getElementById('p-width').innerHTML  = px(p.width);
  document.getElementById('p-height').innerHTML = px(p.height);
  document.getElementById('p-x').innerHTML      = px(p.x);
  document.getElementById('p-y').innerHTML      = px(p.y);
  document.getElementById('p-right').innerHTML  = px(p.right);
  document.getElementById('p-bottom').innerHTML = px(p.bottom);

  const videoSection = document.getElementById('video-section');
  const v = data.video;
  if (v) {
    videoSection.classList.remove('hidden');
    document.getElementById('v-width').innerHTML  = px(v.width);
    document.getElementById('v-height').innerHTML = px(v.height);
    document.getElementById('v-x').innerHTML      = px(v.x);
    document.getElementById('v-y').innerHTML      = px(v.y);
    document.getElementById('v-right').innerHTML  = px(v.right);
    document.getElementById('v-bottom').innerHTML = px(v.bottom);
    document.getElementById('v-aspect').textContent = v.aspectRatio;
  } else {
    videoSection.classList.add('hidden');
  }
}

function initPopup() {
  getList(renderList);

  // Load initial state from storage for all live sections
  chrome.storage.local.get([PLAYER_KEY, TIMESTAMP_KEY], (result) => {
    renderPlayerRect(result[PLAYER_KEY] || null);
    renderTimestamp(result[TIMESTAMP_KEY] || null);
  });

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    const isWatch = tab && tab.url && /netflix\.com\/watch\//i.test(tab.url);
    if (isWatch) {
      document.getElementById('now-watching-badge').classList.remove('hidden');
      // Ask content script for a fresh player measurement
      chrome.tabs.sendMessage(tab.id, { action: 'getPlayerRect' }, (response) => {
        if (chrome.runtime.lastError) return;
        renderPlayerRect(response && response.rect ? response.rect : null);
      });
    }
  });

  // Live updates whenever storage changes (timestamp every 500ms, player on resize)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[STORAGE_KEY]) renderList(changes[STORAGE_KEY].newValue || []);
    if (changes[PLAYER_KEY])   renderPlayerRect(changes[PLAYER_KEY].newValue || null);
    if (changes[TIMESTAMP_KEY]) renderTimestamp(changes[TIMESTAMP_KEY].newValue || null);
  });
}

document.addEventListener('DOMContentLoaded', initPopup);
