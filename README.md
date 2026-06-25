# Vidover PLUS
This is a test line

Vidover is a small monorepo for video-processing experiments, a local overlay server, and a Netflix Chrome extension.

## Apps

- `apps/video-processor`: Python/MediaPipe tooling for generating short clips with Face Mesh and sunglasses effects.
- `apps/overlay-server`: local HTTP server that exposes generated overlay videos to the browser.
- `apps/netflix-watch-list-extension`: Chrome extension that saves watched Netflix titles and shows player/timestamp metadata.

## Local Data

Large media, generated videos, temporary processing files, and source archives live outside app source code:

- `data/source`: extracted source videos
- `data/output`: generated MP4 outputs
- `data/work`: temporary clips and downloaded model files
- `archives`: original downloaded archives

These folders are ignored by `.gitignore` so the repo can stay source-focused.

## Quick Commands

Install video-processing dependencies:

```bash
make install-video-deps
```

Render the current 20-minute sunglasses clip:

```bash
make render-sunglasses-20s
```

Render the matching Face Mesh clip:

```bash
make render-facemesh-20s
```

Render sunglasses across the full source video:

```bash
make render-sunglasses-full
```

Serve generated overlays to the extension:

```bash
make overlay-server
```

Run lightweight checks:

```bash
make verify
```

## Netflix Overlay Workflow

The extension overlays the generated sunglasses video on top of Netflix by loading it from the local overlay server.

1. Generate `data/output/sunglasses_full.mp4` with `make render-sunglasses-full`.
2. Run `make overlay-server`.
3. Install the Chrome extension by loading `apps/netflix-watch-list-extension` as an unpacked extension in Chrome.
4. Open the matching Netflix title. The content script injects a muted overlay video, positions it over Netflix's rendered video region, and keeps it synced to Netflix playback time.

Netflix remains the source of truth for play, pause, seeking, and playback rate. The local overlay video follows the Netflix `<video>` element.
