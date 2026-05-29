#!/usr/bin/env python3
import argparse
import json
import math
import random
import subprocess
import urllib.request
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
from mediapipe.tasks.python.vision import drawing_styles
from mediapipe.tasks.python.vision import drawing_utils


CLIP_SECONDS = 10.0
DEFAULT_EFFECT = "mesh"
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_WORK_DIR = REPO_ROOT / "data" / "work"
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
    "face_landmarker/float16/latest/face_landmarker.task"
)


def run(command):
    subprocess.run(command, check=True)


def probe_duration(source):
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            str(source),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(json.loads(result.stdout)["format"]["duration"])


def parse_timestamp(value):
    parts = value.split(":")
    if not all(part.strip() for part in parts):
        raise argparse.ArgumentTypeError(f"Invalid timestamp: {value}")
    try:
        numbers = [float(part) for part in parts]
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"Invalid timestamp: {value}") from exc

    if len(numbers) == 1:
        seconds = numbers[0]
    elif len(numbers) == 2:
        seconds = numbers[0] * 60 + numbers[1]
    elif len(numbers) == 3:
        seconds = numbers[0] * 3600 + numbers[1] * 60 + numbers[2]
    else:
        raise argparse.ArgumentTypeError("Use seconds, MM:SS, or HH:MM:SS")

    if seconds < 0:
        raise argparse.ArgumentTypeError("Timestamp must be non-negative")
    return seconds


def parse_duration(value):
    if value.lower() == "full":
        return None
    return parse_timestamp(value)


def ensure_model(model_path):
    if model_path.exists():
        return
    model_path.parent.mkdir(parents=True, exist_ok=True)
    print(f"downloading_model={MODEL_URL}")
    urllib.request.urlretrieve(MODEL_URL, model_path)


def create_landmarker(model_path, running_mode):
    options = vision.FaceLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_path=str(model_path)),
        running_mode=running_mode,
        num_faces=2,
        min_face_detection_confidence=0.5,
        min_face_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    return vision.FaceLandmarker.create_from_options(options)


def frame_at(capture, seconds):
    capture.set(cv2.CAP_PROP_POS_MSEC, seconds * 1000)
    ok, frame = capture.read()
    return frame if ok else None


def has_face(face_mesh, frame):
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    results = face_mesh.detect(image)
    return bool(results.face_landmarks)


def choose_start(source, duration, clip_duration, attempts, rng, model_path):
    max_start = max(0.0, duration - clip_duration)
    capture = cv2.VideoCapture(str(source))
    if not capture.isOpened():
        raise RuntimeError(f"Could not open source video: {source}")

    with create_landmarker(model_path, vision.RunningMode.IMAGE) as face_mesh:
        fallback = rng.uniform(0, max_start) if max_start else 0.0
        offsets = [min(clip_duration - 0.25, value) for value in (1.0, 3.0, 5.0, 7.0, 9.0)]
        offsets = [value for value in offsets if value > 0]
        for _ in range(attempts):
            start = rng.uniform(0, max_start) if max_start else 0.0
            for offset in offsets:
                frame = frame_at(capture, min(duration, start + offset))
                if frame is not None and has_face(face_mesh, frame):
                    capture.release()
                    return start, True

    capture.release()
    return fallback, False


def extract_clip(source, clip_path, start, clip_duration):
    run(
        [
            "ffmpeg",
            "-y",
            "-ss",
            f"{start:.3f}",
            "-i",
            str(source),
            "-t",
            f"{clip_duration:.3f}",
            "-map",
            "0:v:0",
            "-map",
            "0:a?",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "18",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            str(clip_path),
        ]
    )


def landmark_xy(landmark, width, height):
    return np.array([landmark.x * width, landmark.y * height], dtype=np.float32)


def smoothed_pose(previous, current, alpha=0.72):
    if previous is None:
        return current
    result = {}
    for key, value in current.items():
        if key == "angle":
            delta = (value - previous[key] + math.pi) % (2 * math.pi) - math.pi
            result[key] = previous[key] + (1 - alpha) * delta
        else:
            result[key] = alpha * previous[key] + (1 - alpha) * value
    return result


def sunglasses_pose(landmarks, width, height):
    left_eye = (landmark_xy(landmarks[33], width, height) + landmark_xy(landmarks[133], width, height)) / 2
    right_eye = (landmark_xy(landmarks[362], width, height) + landmark_xy(landmarks[263], width, height)) / 2
    if left_eye[0] > right_eye[0]:
        left_eye, right_eye = right_eye, left_eye

    eye_line = right_eye - left_eye
    eye_distance = float(np.linalg.norm(eye_line))
    if eye_distance < 20:
        return None

    center = (left_eye + right_eye) / 2
    angle = math.atan2(float(eye_line[1]), float(eye_line[0]))
    return {"center": center, "eye_distance": eye_distance, "angle": angle}


def rotated_point(center, direction, normal, x_offset, y_offset):
    return center + direction * x_offset + normal * y_offset


def blend_overlay(frame, overlay, alpha):
    mask = np.any(overlay != frame, axis=2)
    frame[mask] = cv2.addWeighted(overlay, alpha, frame, 1 - alpha, 0)[mask]


def draw_sunglasses(frame, landmarks, previous_pose):
    height, width = frame.shape[:2]
    pose = sunglasses_pose(landmarks, width, height)
    if pose is None:
        return previous_pose

    pose = smoothed_pose(previous_pose, pose)
    center = pose["center"]
    eye_distance = pose["eye_distance"]
    angle = pose["angle"]
    direction = np.array([math.cos(angle), math.sin(angle)], dtype=np.float32)
    normal = np.array([-math.sin(angle), math.cos(angle)], dtype=np.float32)

    lens_width = eye_distance * 0.72
    lens_height = eye_distance * 0.46
    lens_offset = eye_distance * 0.50
    y_offset = -eye_distance * 0.02
    left_center = rotated_point(center, direction, normal, -lens_offset, y_offset)
    right_center = rotated_point(center, direction, normal, lens_offset, y_offset)

    overlay = frame.copy()
    ellipse_angle = math.degrees(angle)
    lens_axes = (max(1, int(lens_width / 2)), max(1, int(lens_height / 2)))
    frame_thickness = max(3, int(eye_distance * 0.045))
    bridge_thickness = max(3, int(eye_distance * 0.035))

    for lens_center in (left_center, right_center):
        cv2.ellipse(
            overlay,
            tuple(lens_center.astype(int)),
            lens_axes,
            ellipse_angle,
            0,
            360,
            (12, 12, 14),
            -1,
            cv2.LINE_AA,
        )

    blend_overlay(frame, overlay, 0.78)

    for lens_center in (left_center, right_center):
        cv2.ellipse(
            frame,
            tuple(lens_center.astype(int)),
            lens_axes,
            ellipse_angle,
            0,
            360,
            (5, 5, 6),
            frame_thickness,
            cv2.LINE_AA,
        )
        highlight_start = rotated_point(lens_center, direction, normal, -lens_width * 0.18, -lens_height * 0.18)
        highlight_end = rotated_point(lens_center, direction, normal, lens_width * 0.16, -lens_height * 0.26)
        cv2.line(
            frame,
            tuple(highlight_start.astype(int)),
            tuple(highlight_end.astype(int)),
            (130, 130, 135),
            max(1, frame_thickness // 3),
            cv2.LINE_AA,
        )

    bridge_start = rotated_point(left_center, direction, normal, lens_width * 0.45, -lens_height * 0.05)
    bridge_end = rotated_point(right_center, direction, normal, -lens_width * 0.45, -lens_height * 0.05)
    cv2.line(frame, tuple(bridge_start.astype(int)), tuple(bridge_end.astype(int)), (5, 5, 6), bridge_thickness, cv2.LINE_AA)

    left_arm_start = rotated_point(left_center, direction, normal, -lens_width * 0.48, -lens_height * 0.02)
    left_arm_end = rotated_point(left_center, direction, normal, -lens_width * 0.92, -lens_height * 0.25)
    right_arm_start = rotated_point(right_center, direction, normal, lens_width * 0.48, -lens_height * 0.02)
    right_arm_end = rotated_point(right_center, direction, normal, lens_width * 0.92, -lens_height * 0.25)
    cv2.line(frame, tuple(left_arm_start.astype(int)), tuple(left_arm_end.astype(int)), (5, 5, 6), bridge_thickness, cv2.LINE_AA)
    cv2.line(frame, tuple(right_arm_start.astype(int)), tuple(right_arm_end.astype(int)), (5, 5, 6), bridge_thickness, cv2.LINE_AA)
    return pose


def render_mesh(clip_path, video_only_path, model_path):
    connections = vision.FaceLandmarksConnections

    capture = cv2.VideoCapture(str(clip_path))
    if not capture.isOpened():
        raise RuntimeError(f"Could not open clip: {clip_path}")

    fps = capture.get(cv2.CAP_PROP_FPS) or 24.0
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    writer = cv2.VideoWriter(
        str(video_only_path),
        cv2.VideoWriter_fourcc(*"mp4v"),
        fps,
        (width, height),
    )

    with create_landmarker(model_path, vision.RunningMode.VIDEO) as face_mesh:
        frame_index = 0
        while True:
            ok, frame = capture.read()
            if not ok:
                break

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            timestamp_ms = int(frame_index * 1000 / fps)
            results = face_mesh.detect_for_video(image, timestamp_ms)

            if results.face_landmarks:
                for landmarks in results.face_landmarks:
                    drawing_utils.draw_landmarks(
                        image=frame,
                        landmark_list=landmarks,
                        connections=connections.FACE_LANDMARKS_TESSELATION,
                        landmark_drawing_spec=None,
                        connection_drawing_spec=drawing_styles.get_default_face_mesh_tesselation_style(),
                    )
                    drawing_utils.draw_landmarks(
                        image=frame,
                        landmark_list=landmarks,
                        connections=connections.FACE_LANDMARKS_CONTOURS,
                        landmark_drawing_spec=None,
                        connection_drawing_spec=drawing_styles.get_default_face_mesh_contours_style(),
                    )
                    drawing_utils.draw_landmarks(
                        image=frame,
                        landmark_list=landmarks,
                        connections=connections.FACE_LANDMARKS_LEFT_IRIS
                        + connections.FACE_LANDMARKS_RIGHT_IRIS,
                        landmark_drawing_spec=None,
                        connection_drawing_spec=drawing_styles.get_default_face_mesh_iris_connections_style(),
                    )

            writer.write(frame)
            frame_index += 1

    capture.release()
    writer.release()


def render_sunglasses(clip_path, video_only_path, model_path):
    capture = cv2.VideoCapture(str(clip_path))
    if not capture.isOpened():
        raise RuntimeError(f"Could not open clip: {clip_path}")

    fps = capture.get(cv2.CAP_PROP_FPS) or 24.0
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    writer = cv2.VideoWriter(
        str(video_only_path),
        cv2.VideoWriter_fourcc(*"mp4v"),
        fps,
        (width, height),
    )

    with create_landmarker(model_path, vision.RunningMode.VIDEO) as face_mesh:
        frame_index = 0
        previous_pose = None
        while True:
            ok, frame = capture.read()
            if not ok:
                break

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            timestamp_ms = int(frame_index * 1000 / fps)
            results = face_mesh.detect_for_video(image, timestamp_ms)

            if results.face_landmarks:
                previous_pose = draw_sunglasses(frame, results.face_landmarks[0], previous_pose)

            writer.write(frame)
            frame_index += 1

    capture.release()
    writer.release()


def render_effect(effect, clip_path, video_only_path, model_path):
    if effect == "mesh":
        render_mesh(clip_path, video_only_path, model_path)
    elif effect == "sunglasses":
        render_sunglasses(clip_path, video_only_path, model_path)
    else:
        raise ValueError(f"Unsupported effect: {effect}")


def mux_audio(processed_video, clip_path, output):
    run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(processed_video),
            "-i",
            str(clip_path),
            "-map",
            "0:v:0",
            "-map",
            "1:a?",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "20",
            "-c:a",
            "copy",
            "-shortest",
            str(output),
        ]
    )


def main():
    parser = argparse.ArgumentParser(description="Create a MediaPipe face-effect clip.")
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--work-dir", default=DEFAULT_WORK_DIR, type=Path)
    parser.add_argument("--model", default=None, type=Path)
    parser.add_argument("--effect", choices=("mesh", "sunglasses"), default=DEFAULT_EFFECT)
    parser.add_argument("--start", type=parse_timestamp, help="Fixed clip start time, as seconds, MM:SS, or HH:MM:SS.")
    parser.add_argument(
        "--duration",
        default=str(CLIP_SECONDS),
        help='Clip duration as seconds, MM:SS, HH:MM:SS, or "full". Defaults to 10 seconds.',
    )
    parser.add_argument("--attempts", default=30, type=int)
    parser.add_argument("--seed", default=None, type=int)
    args = parser.parse_args()

    rng = random.Random(args.seed)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.work_dir.mkdir(parents=True, exist_ok=True)
    model_path = args.model or args.work_dir / "face_landmarker.task"
    ensure_model(model_path)

    duration = probe_duration(args.source)
    requested_duration = parse_duration(args.duration)
    if args.start is None and requested_duration is None:
        start = 0.0
        found_face = None
        clip_prefix = f"full_{args.effect}"
    elif args.start is None:
        start, found_face = choose_start(args.source, duration, requested_duration, args.attempts, rng, model_path)
        clip_prefix = f"random_{args.effect}_{int(requested_duration):06d}s"
    else:
        start = args.start
        found_face = None
        clip_prefix = f"fixed_{int(start):06d}_{args.effect}"

    clip_duration = duration - start if requested_duration is None else requested_duration
    if clip_duration <= 0:
        raise ValueError("Clip duration must be greater than zero.")
    if start + clip_duration > duration + 0.001:
        raise ValueError(
            f"Start {start:.3f}s plus duration {clip_duration:.3f}s exceeds source duration {duration:.3f}s."
        )

    raw_clip = args.work_dir / f"{clip_prefix}_raw.mp4"
    effect_video = args.work_dir / f"{clip_prefix}_video_only.mp4"

    print(f"source_duration={duration:.3f}s")
    print(f"clip_start={start:.3f}s")
    print(f"clip_duration={clip_duration:.3f}s")
    print(f"face_found_during_selection={found_face}")
    print(f"effect={args.effect}")

    extract_clip(args.source, raw_clip, start, clip_duration)
    render_effect(args.effect, raw_clip, effect_video, model_path)
    mux_audio(effect_video, raw_clip, args.output)
    print(f"output={args.output}")


if __name__ == "__main__":
    main()
