#!/usr/bin/env python3
"""Resumable (tus) upload of a video file to Cloudflare Stream.

Usage: cf_stream_upload.py <path> [name]
Reads CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN from the environment.
Prints the resulting video UID (stream-media-id).
"""
import base64
import os
import sys
import time
import urllib.error
import urllib.request

ACCOUNT = os.environ["CLOUDFLARE_ACCOUNT_ID"]
TOKEN = os.environ["CLOUDFLARE_API_TOKEN"]

path = sys.argv[1]
name = sys.argv[2] if len(sys.argv) > 2 else os.path.basename(path)
size = os.path.getsize(path)
CHUNK = 50 * 1024 * 1024  # 50 MiB — a multiple of 256 KiB, as Stream requires

create_url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/stream"
meta = ",".join([
    f"name {base64.b64encode(name.encode()).decode()}",
])

req = urllib.request.Request(
    create_url, data=b"", method="POST",
    headers={
        "Authorization": f"Bearer {TOKEN}",
        "Tus-Resumable": "1.0.0",
        "Upload-Length": str(size),
        "Upload-Metadata": meta,
    },
)
try:
    with urllib.request.urlopen(req, timeout=60) as resp:
        location = resp.headers.get("Location")
        media_id = resp.headers.get("stream-media-id")
except urllib.error.HTTPError as e:
    print("CREATE error", e.code, e.read().decode()[:500], flush=True)
    sys.exit(1)

print(f"MEDIA_ID={media_id}", flush=True)
print(f"location={location}", flush=True)
print(f"size={size} bytes ({size/1024/1024:.1f} MiB)", flush=True)

offset = 0
t0 = time.time()
with open(path, "rb") as f:
    while offset < size:
        f.seek(offset)
        chunk = f.read(min(CHUNK, size - offset))
        preq = urllib.request.Request(
            location, data=chunk, method="PATCH",
            headers={
                "Authorization": f"Bearer {TOKEN}",
                "Tus-Resumable": "1.0.0",
                "Upload-Offset": str(offset),
                "Content-Type": "application/offset+octet-stream",
            },
        )
        try:
            with urllib.request.urlopen(preq, timeout=600) as presp:
                offset = int(presp.headers.get("Upload-Offset"))
        except urllib.error.HTTPError as e:
            print("PATCH error", e.code, e.read().decode()[:500], flush=True)
            sys.exit(1)
        elapsed = time.time() - t0
        print(f"  {offset}/{size} ({offset/size*100:.1f}%)  "
              f"{offset/1024/1024/max(elapsed,1e-9):.1f} MiB/s", flush=True)

print(f"DONE MEDIA_ID={media_id} in {time.time()-t0:.0f}s", flush=True)
