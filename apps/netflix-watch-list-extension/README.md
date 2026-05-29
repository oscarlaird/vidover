# Netflix Watch List Extension

Chrome Manifest V3 extension that stores watched Netflix titles locally and exposes current playback/player metadata in the popup.

It also injects a synced overlay video from the local overlay server at `http://127.0.0.1:8765`.

## Install

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select `/home/oscar/vidover/apps/netflix-watch-list-extension`.

## Behavior

- Runs on `https://www.netflix.com/*`.
- Adds watched titles to Chrome local storage.
- Shows live watch-page status, timestamp, player dimensions, and saved titles.
- Fetches overlay metadata from `http://127.0.0.1:8765/metadata.json`.
- Places the overlay video over Netflix's rendered video region.
- Syncs the overlay to Netflix play/pause, seeking, current time, and playback rate.
- Stores data locally in the browser.

## Overlay Setup

From the repo root:

```bash
make render-sunglasses-full
make overlay-server
```

Then load this folder as an unpacked Chrome extension.
