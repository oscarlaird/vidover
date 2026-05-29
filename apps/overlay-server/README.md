# Overlay Server

Tiny local HTTP server that lets the Chrome extension load generated overlay videos from `localhost`.

## Run

From the repo root:

```bash
make overlay-server
```

The default server listens on `http://127.0.0.1:8765` and serves:

- `GET /metadata.json`: overlay metadata consumed by the extension
- `GET /overlays/sunglasses_full.mp4`: generated sunglasses overlay video

## Custom File

```bash
python3 apps/overlay-server/server.py \
  --overlay-dir data/output \
  --overlay-file sunglasses_full.mp4
```

The server adds permissive CORS headers because the content script runs on Netflix pages.
# Overlay Server

Local HTTP server for serving a generated overlay video to the Chrome extension.

The extension loads `http://127.0.0.1:8765/metadata.json`, then injects and syncs `overlay.mp4` over the Netflix player.

## Run

From the repo root:

```bash
make overlay-server
```

Or directly:

```bash
python3 apps/overlay-server/serve_overlay.py \
  --overlay data/output/sunglasses_full.mp4 \
  --port 8765
```

## Endpoints

- `GET /health`: health check
- `GET /metadata.json`: overlay URL and sync settings
- `GET /overlay.mp4`: video file with byte-range support for browser seeking

The server adds CORS headers so the Chrome extension can query and load the video from Netflix pages.
