# Netflix Watch List — Chrome Extension

## How to Install

1. Open Chrome and go to: `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select `/home/oscar/vidover/apps/netflix-watch-list-extension`
5. The extension icon (red square) will appear in your toolbar

## How to Use

- Just open Netflix and start playing any title — it's added to your list automatically
- Run `make overlay-server` from `/home/oscar/vidover` to serve `data/output/sunglasses_full.mp4`
- On Netflix watch pages, the extension overlays the local sunglasses video and syncs it to playback
- Open the extension popup anytime to see everything you've watched
- A pulsing **● Live** indicator appears in the popup when you're actively on a watch page
- Click **×** next to any title to remove it from the list

## Notes

- Titles are detected within a few seconds of the player loading
- Your list is saved locally in Chrome's storage (no account needed)
- The same title will never be added twice
- Works across sessions — your list persists when you close and reopen Chrome
