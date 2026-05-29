# Video Processor

Python tool for creating clips with MediaPipe-driven face effects.

## Setup

From the repo root, use the existing local environment or create one:

```bash
uv venv --seed .venv
uv pip install --python .venv/bin/python -r apps/video-processor/requirements.txt
```

The script also requires `ffmpeg` and `ffprobe` on `PATH`.

## Examples

Render sunglasses on a fixed clip:

```bash
cd apps/video-processor
../../.venv/bin/python apply_face_mesh_filter.py \
  --effect sunglasses \
  --start 20:00 \
  --source ../../data/source/Nemesis.2026.S01E01.720p.HEVC.x265-MeGusta.mkv \
  --output ../../data/output/sunglasses_20m00s_10s_v2.mp4
```

Render Face Mesh on the same clip:

```bash
cd apps/video-processor
../../.venv/bin/python apply_face_mesh_filter.py \
  --effect mesh \
  --start 20:00 \
  --source ../../data/source/Nemesis.2026.S01E01.720p.HEVC.x265-MeGusta.mkv \
  --output ../../data/output/face_mesh_20m00s_10s.mp4
```

Render sunglasses across the full source video:

```bash
cd apps/video-processor
../../.venv/bin/python apply_face_mesh_filter.py \
  --effect sunglasses \
  --duration full \
  --source ../../data/source/Nemesis.2026.S01E01.720p.HEVC.x265-MeGusta.mkv \
  --output ../../data/output/sunglasses_full.mp4
```

Omit `--start` to select a random face-containing scene when possible. Use `--duration` with seconds, `MM:SS`, `HH:MM:SS`, or `full`.
