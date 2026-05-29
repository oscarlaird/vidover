#!/usr/bin/env python3
import argparse
import json
import mimetypes
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OVERLAY = REPO_ROOT / "data" / "output" / "sunglasses_full.mp4"


class OverlayHandler(BaseHTTPRequestHandler):
    overlay_path: Path
    metadata: dict

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Range, Content-Type")
        self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_HEAD(self):
        self._route(send_body=False)

    def do_GET(self):
        self._route(send_body=True)

    def _route(self, send_body):
        path = urlparse(self.path).path
        if path == "/health":
            self._send_json({"ok": True}, send_body)
        elif path == "/metadata.json":
            self._send_json(self.metadata, send_body)
        elif path == "/overlay.mp4":
            self._send_file(self.overlay_path, send_body)
        else:
            self.send_error(HTTPStatus.NOT_FOUND, "Unknown endpoint")

    def _send_json(self, payload, send_body):
        body = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if send_body:
            self.wfile.write(body)

    def _send_file(self, file_path, send_body):
        if not file_path.exists():
            self.send_error(HTTPStatus.NOT_FOUND, f"Missing overlay file: {file_path}")
            return

        file_size = file_path.stat().st_size
        content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        range_header = self.headers.get("Range")

        if range_header:
            start, end = self._parse_range(range_header, file_size)
            if start is None:
                self.send_error(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                return
            status = HTTPStatus.PARTIAL_CONTENT
            content_length = end - start + 1
        else:
            start, end = 0, file_size - 1
            status = HTTPStatus.OK
            content_length = file_size

        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(content_length))
        if status == HTTPStatus.PARTIAL_CONTENT:
            self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
        self.end_headers()

        if not send_body:
            return

        with file_path.open("rb") as handle:
            handle.seek(start)
            remaining = content_length
            while remaining > 0:
                chunk = handle.read(min(1024 * 1024, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    @staticmethod
    def _parse_range(range_header, file_size):
        if not range_header.startswith("bytes="):
            return None, None
        range_value = range_header.removeprefix("bytes=").split(",", 1)[0].strip()
        start_text, _, end_text = range_value.partition("-")
        try:
            if start_text:
                start = int(start_text)
                end = int(end_text) if end_text else file_size - 1
            else:
                suffix_length = int(end_text)
                start = max(0, file_size - suffix_length)
                end = file_size - 1
        except ValueError:
            return None, None
        if start < 0 or end < start or start >= file_size:
            return None, None
        return start, min(end, file_size - 1)


def build_metadata(overlay_path, offset):
    return {
        "overlayUrl": "/overlay.mp4",
        "offsetSeconds": offset,
        "syncToleranceSeconds": 0.08,
        "overlayPath": str(overlay_path),
    }


def main():
    parser = argparse.ArgumentParser(description="Serve a local video overlay for the Netflix extension.")
    parser.add_argument("--overlay", type=Path, default=DEFAULT_OVERLAY)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.environ.get("VIDOVER_OVERLAY_PORT", "8765")))
    parser.add_argument("--offset", type=float, default=0.0, help="Seconds to add to the Netflix playback time.")
    args = parser.parse_args()

    overlay_path = args.overlay.resolve()
    OverlayHandler.overlay_path = overlay_path
    OverlayHandler.metadata = build_metadata(overlay_path, args.offset)

    server = ThreadingHTTPServer((args.host, args.port), OverlayHandler)
    print(f"Serving overlay: {overlay_path}")
    print(f"Metadata: http://{args.host}:{args.port}/metadata.json")
    print(f"Overlay: http://{args.host}:{args.port}/overlay.mp4")
    server.serve_forever()


if __name__ == "__main__":
    main()
