#!/usr/bin/env python3
import argparse
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OVERLAY_DIR = REPO_ROOT / "data" / "output"
DEFAULT_OVERLAY_FILE = "sunglasses_full.mp4"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765


class OverlayRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, overlay_dir, overlay_file, **kwargs):
        self.overlay_dir = overlay_dir
        self.overlay_file = overlay_file
        super().__init__(*args, directory=str(overlay_dir), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Range, Content-Type")
        self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/metadata.json":
            self.send_metadata()
            return
        if parsed.path.startswith("/overlays/"):
            self.path = "/" + unquote(parsed.path.removeprefix("/overlays/"))
            return super().do_GET()
        self.send_error(404, "Use /metadata.json or /overlays/<filename>")

    def do_HEAD(self):
        parsed = urlparse(self.path)
        if parsed.path == "/metadata.json":
            self.send_metadata(head_only=True)
            return
        if parsed.path.startswith("/overlays/"):
            self.path = "/" + unquote(parsed.path.removeprefix("/overlays/"))
            return super().do_HEAD()
        self.send_error(404, "Use /metadata.json or /overlays/<filename>")

    def send_metadata(self, head_only=False):
        overlay_path = self.overlay_dir / self.overlay_file
        body = json.dumps(
            {
                "enabled": overlay_path.exists(),
                "overlayUrl": f"/overlays/{self.overlay_file}",
                "filename": self.overlay_file,
                "exists": overlay_path.exists(),
                "size": overlay_path.stat().st_size if overlay_path.exists() else None,
                "syncOffsetSeconds": 0,
            },
            indent=2,
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if not head_only:
            self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser(description="Serve locally generated overlay videos for the Chrome extension.")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", default=DEFAULT_PORT, type=int)
    parser.add_argument("--overlay-dir", default=DEFAULT_OVERLAY_DIR, type=Path)
    parser.add_argument("--overlay-file", default=DEFAULT_OVERLAY_FILE)
    args = parser.parse_args()

    args.overlay_dir.mkdir(parents=True, exist_ok=True)
    handler = partial(
        OverlayRequestHandler,
        overlay_dir=args.overlay_dir.resolve(),
        overlay_file=args.overlay_file,
    )
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"Serving overlays from {args.overlay_dir.resolve()}")
    print(f"Metadata: http://{args.host}:{args.port}/metadata.json")
    print(f"Overlay:  http://{args.host}:{args.port}/overlays/{args.overlay_file}")
    server.serve_forever()


if __name__ == "__main__":
    main()
