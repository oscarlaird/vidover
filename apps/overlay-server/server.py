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
    # HTTP/1.1 is required for clients to attempt range requests / seeking.
    protocol_version = "HTTP/1.1"

    def __init__(self, *args, overlay_dir, overlay_file, **kwargs):
        self.overlay_dir = overlay_dir
        self.overlay_file = overlay_file
        super().__init__(*args, directory=str(overlay_dir), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Range, Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/metadata.json":
            self.send_metadata()
            return
        if parsed.path.startswith("/overlays/"):
            self.serve_overlay(unquote(parsed.path.removeprefix("/overlays/")))
            return
        self.send_error(404, "Use /metadata.json or /overlays/<filename>")

    def do_HEAD(self):
        parsed = urlparse(self.path)
        if parsed.path == "/metadata.json":
            self.send_metadata(head_only=True)
            return
        if parsed.path.startswith("/overlays/"):
            self.serve_overlay(unquote(parsed.path.removeprefix("/overlays/")), head_only=True)
            return
        self.send_error(404, "Use /metadata.json or /overlays/<filename>")

    def serve_overlay(self, filename, head_only=False):
        # Resolve safely within the overlay directory.
        target = (self.overlay_dir / filename).resolve()
        if self.overlay_dir not in target.parents and target != self.overlay_dir:
            self.send_error(403, "Forbidden")
            return
        if not target.is_file():
            self.send_error(404, "File not found")
            return

        file_size = target.stat().st_size
        ctype = self.guess_type(str(target))
        range_header = self.headers.get("Range")

        start, end = 0, file_size - 1
        partial = False
        if range_header and range_header.startswith("bytes="):
            try:
                range_spec = range_header.removeprefix("bytes=").split(",")[0].strip()
                start_str, _, end_str = range_spec.partition("-")
                if start_str:
                    start = int(start_str)
                    end = int(end_str) if end_str else file_size - 1
                else:
                    # Suffix range: last N bytes.
                    start = max(0, file_size - int(end_str))
                    end = file_size - 1
                if start > end or start >= file_size:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{file_size}")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                end = min(end, file_size - 1)
                partial = True
            except ValueError:
                partial = False
                start, end = 0, file_size - 1

        length = end - start + 1
        self.send_response(206 if partial else 200)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        if partial:
            self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
        self.end_headers()

        if head_only:
            return

        with open(target, "rb") as f:
            f.seek(start)
            remaining = length
            chunk_size = 64 * 1024
            while remaining > 0:
                chunk = f.read(min(chunk_size, remaining))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    return
                remaining -= len(chunk)

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
