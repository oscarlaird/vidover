#!/usr/bin/env python3
"""Render a face effect across a full video by splitting it into time-chunks
that are processed concurrently (one worker per core), then concatenated.

The per-frame MediaPipe render in apply_face_mesh_filter.py is single-threaded,
so the only way to use many cores is to run several independent slices at once.
Each slice is a normal apply_face_mesh_filter.py invocation with --start/--duration,
producing a complete (video+audio) mp4; the slices are joined with the ffmpeg
concat demuxer at the end.

Caveat: pose-smoothing state resets at each chunk boundary, so a single frame at
each of the (chunks-1) seams may glitch slightly. Visually negligible.
"""
import argparse
import json
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

HERE = Path(__file__).resolve().parent
RENDER_SCRIPT = HERE / "apply_face_mesh_filter.py"


def probe_duration(source):
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "json", str(source)],
        check=True, capture_output=True, text=True,
    )
    return float(json.loads(result.stdout)["format"]["duration"])


def make_chunks(duration, n):
    """Return list of (start, length) covering [0, duration) in n equal slices."""
    step = duration / n
    chunks = []
    for i in range(n):
        start = i * step
        length = step if i < n - 1 else (duration - start)
        chunks.append((start, length))
    return chunks


def render_chunk(python_bin, source, effect, start, length, out_path, work_dir, log_path):
    work_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        python_bin, str(RENDER_SCRIPT),
        "--effect", effect,
        "--source", str(source),
        "--output", str(out_path),
        "--work-dir", str(work_dir),
        "--start", f"{start:.3f}",
        "--duration", f"{length:.3f}",
    ]
    with open(log_path, "w") as log:
        proc = subprocess.run(cmd, stdout=log, stderr=subprocess.STDOUT)
    return proc.returncode


def concat(chunk_paths, output, work_dir):
    list_file = work_dir / "concat_list.txt"
    with open(list_file, "w") as fh:
        for p in chunk_paths:
            fh.write(f"file '{p.resolve()}'\n")
    # Streams share identical codecs/params, so a stream copy is safe and fast.
    subprocess.run(
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(list_file),
         "-c", "copy", str(output)],
        check=True,
    )


def main():
    parser = argparse.ArgumentParser(description="Parallel chunked face-effect render.")
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--effect", choices=("mesh", "sunglasses"), default="sunglasses")
    parser.add_argument("--chunks", type=int, default=10)
    parser.add_argument("--jobs", type=int, default=None,
                        help="Max concurrent workers (defaults to --chunks).")
    parser.add_argument("--work-dir", type=Path,
                        default=HERE.parents[1] / "data" / "work" / "parallel")
    parser.add_argument("--python", default=sys.executable)
    args = parser.parse_args()

    jobs = args.jobs or args.chunks
    args.work_dir.mkdir(parents=True, exist_ok=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)

    duration = probe_duration(args.source)
    chunks = make_chunks(duration, args.chunks)
    print(f"source_duration={duration:.3f}s chunks={args.chunks} jobs={jobs}", flush=True)

    chunk_paths = [args.work_dir / f"chunk_{i:02d}.mp4" for i in range(args.chunks)]
    log_paths = [args.work_dir / f"chunk_{i:02d}.log" for i in range(args.chunks)]
    chunk_work = [args.work_dir / f"w{i:02d}" for i in range(args.chunks)]

    started = time.monotonic()
    failures = []
    with ThreadPoolExecutor(max_workers=jobs) as pool:
        futures = {}
        for i, (start, length) in enumerate(chunks):
            fut = pool.submit(
                render_chunk, args.python, args.source, args.effect,
                start, length, chunk_paths[i], chunk_work[i], log_paths[i],
            )
            futures[fut] = i
        for fut in as_completed(futures):
            i = futures[fut]
            rc = fut.result()
            status = "ok" if rc == 0 else f"FAILED rc={rc}"
            elapsed = time.monotonic() - started
            print(f"chunk {i:02d} [{chunks[i][0]:.0f}s +{chunks[i][1]:.0f}s] {status} "
                  f"(t+{elapsed:.0f}s)", flush=True)
            if rc != 0:
                failures.append(i)

    if failures:
        print(f"ABORT: chunks failed: {failures} (see {args.work_dir}/chunk_NN.log)",
              flush=True)
        sys.exit(1)

    print("concatenating...", flush=True)
    concat(chunk_paths, args.output, args.work_dir)
    total = time.monotonic() - started
    out_dur = probe_duration(args.output)
    print(f"output={args.output} output_duration={out_dur:.3f}s wall={total:.0f}s",
          flush=True)


if __name__ == "__main__":
    main()
