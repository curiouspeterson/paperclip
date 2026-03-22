#!/usr/bin/env python3
"""Render real clip assets from clip candidate timestamps using ffmpeg."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import textwrap
from datetime import UTC, datetime
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from pipeline_common import (
    load_json,
    save_json,
    write_text,
    require_fresh_upstream_stage_outputs,
    finalize_stage_outputs,
    resolve_path,
    require_numeric_clip_timestamps,
)

WAVEFORM_WIDTH = 980
WAVEFORM_HEIGHT = 620
AUDIOGRAM_WIDTH = 1080
AUDIOGRAM_HEIGHT = 1920
CAPTION_CARD_WIDTH = 920
CAPTION_CARD_HEIGHT = 260
CAPTION_MARGIN_BOTTOM = 120


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, help="Path to handoff manifest json")
    parser.add_argument("--ffmpeg-bin", default="ffmpeg", help="ffmpeg binary to use")
    parser.add_argument("--ffprobe-bin", default="ffprobe", help="ffprobe binary to use")
    parser.add_argument("--force", action="store_true", help="Overwrite existing rendered clip assets")
    return parser.parse_args()


def ensure_binary(binary_name: str) -> str:
    result = subprocess.run(["/usr/bin/env", "bash", "-lc", f"command -v {binary_name}"], capture_output=True, text=True)
    resolved = result.stdout.strip() or binary_name
    if result.returncode != 0 and not Path(resolved).exists():
        raise SystemExit(f"Binary not found: {binary_name}")
    return resolved


def probe_media(ffprobe_bin: str, source_path: Path) -> dict:
    proc = subprocess.run(
        [
            ffprobe_bin,
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_streams",
            "-show_format",
            str(source_path),
        ],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise SystemExit(f"ffprobe failed: {(proc.stderr or proc.stdout).strip()[:400]}")
    return json.loads(proc.stdout)


def has_video_stream(probe: dict) -> bool:
    for stream in probe.get("streams") or []:
        if str(stream.get("codec_type") or "").strip().lower() == "video":
            return True
    return False


def run_ffmpeg(cmd: list[str]) -> None:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise SystemExit(f"ffmpeg failed: {(proc.stderr or proc.stdout).strip()[:500]}")


def format_srt_timestamp(seconds: float) -> str:
    total_ms = max(0, int(round(seconds * 1000)))
    hours, rem = divmod(total_ms, 3_600_000)
    minutes, rem = divmod(rem, 60_000)
    secs, millis = divmod(rem, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def normalize_subtitle_text(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def build_clip_subtitles(segments: list[dict], *, clip_start: float, clip_end: float) -> list[dict]:
    subtitles = []
    for segment in segments:
        start = segment.get("start")
        end = segment.get("end")
        text = normalize_subtitle_text(segment.get("text"))
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)) or not text:
            continue
        if end <= clip_start or start >= clip_end:
            continue
        relative_start = max(0.0, float(start) - clip_start)
        relative_end = max(relative_start + 0.2, min(float(end), clip_end) - clip_start)
        subtitles.append(
            {
                "start": relative_start,
                "end": relative_end,
                "text": text,
            }
        )
    return subtitles


def write_subtitle_file(path: Path, subtitles: list[dict]) -> bool:
    if not subtitles:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = []
    for index, subtitle in enumerate(subtitles, start=1):
        lines.extend(
            [
                str(index),
                f"{format_srt_timestamp(float(subtitle['start']))} --> {format_srt_timestamp(float(subtitle['end']))}",
                subtitle["text"],
                "",
            ]
        )
    path.write_text("\n".join(lines), encoding="utf-8")
    return True


def load_font(size: int) -> ImageFont.ImageFont:
    font_candidates = (
        Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
        Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
    )
    for candidate in font_candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default()


def wrap_caption_text(text: str, *, width: int = 34) -> str:
    return textwrap.fill(normalize_subtitle_text(text), width=width)


def create_caption_card(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGBA", (CAPTION_CARD_WIDTH, CAPTION_CARD_HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(
        [(0, 0), (CAPTION_CARD_WIDTH - 1, CAPTION_CARD_HEIGHT - 1)],
        radius=28,
        fill=(0, 0, 0, 180),
    )
    font = load_font(38)
    wrapped = wrap_caption_text(text)
    bbox = draw.multiline_textbbox((0, 0), wrapped, font=font, spacing=8, align="center")
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    x = max(24, int((CAPTION_CARD_WIDTH - text_width) / 2))
    y = max(24, int((CAPTION_CARD_HEIGHT - text_height) / 2) - 6)
    draw.multiline_text(
        (x, y),
        wrapped,
        font=font,
        fill=(255, 255, 255, 255),
        spacing=8,
        align="center",
    )
    image.save(path)


def create_caption_cards(subtitles: list[dict], *, captions_dir: Path) -> list[dict]:
    cards = []
    for index, subtitle in enumerate(subtitles, start=1):
        image_path = captions_dir / f"caption-{index:02d}.png"
        create_caption_card(image_path, str(subtitle["text"]))
        cards.append(
            {
                "start": float(subtitle["start"]),
                "end": float(subtitle["end"]),
                "image_path": image_path,
                "text": subtitle["text"],
            }
        )
    return cards


def build_overlay_filter_chain(base_label: str, overlays: list[dict], *, canvas_height: int) -> tuple[str, str]:
    if not overlays:
        return "", base_label
    filters: list[str] = []
    current_label = base_label
    for index, overlay in enumerate(overlays, start=1):
        image_label = f"{index}:v"
        next_label = f"cap{index}"
        filters.append(
            (
                f"[{current_label}][{image_label}]overlay="
                f"x=(W-w)/2:y=H-h-{CAPTION_MARGIN_BOTTOM}:"
                f"enable='between(t,{overlay['start']:.3f},{overlay['end']:.3f})'"
                f"[{next_label}]"
            )
        )
        current_label = next_label
    return ";".join(filters), current_label


def render_audio_clip(ffmpeg_bin: str, source_path: Path, start: float, duration: float, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    run_ffmpeg(
        [
            ffmpeg_bin,
            "-y",
            "-ss",
            f"{start:.3f}",
            "-t",
            f"{duration:.3f}",
            "-i",
            str(source_path),
            "-vn",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            str(output_path),
        ]
    )


def render_audiogram(
    ffmpeg_bin: str,
    source_path: Path,
    start: float,
    duration: float,
    output_path: Path,
    *,
    caption_cards: list[dict],
) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        ffmpeg_bin,
        "-y",
        "-ss",
        f"{start:.3f}",
        "-t",
        f"{duration:.3f}",
        "-i",
        str(source_path),
    ]
    for card in caption_cards:
        cmd.extend(["-loop", "1", "-i", str(card["image_path"])])
    filter_graph = (
        f"color=c=0x121212:s={AUDIOGRAM_WIDTH}x{AUDIOGRAM_HEIGHT}:d={duration:.3f}[bg];"
        f"[0:a]aformat=channel_layouts=mono,"
        f"showwaves=s={WAVEFORM_WIDTH}x{WAVEFORM_HEIGHT}:mode=line:colors=0xF4B400:r=25,"
        "format=rgba[wave];"
        "[bg][wave]overlay=(W-w)/2:(H-h)/2[base]"
    )
    overlay_filters, output_label = build_overlay_filter_chain("base", caption_cards, canvas_height=AUDIOGRAM_HEIGHT)
    if overlay_filters:
        filter_graph += ";" + overlay_filters
    cmd.extend(
        [
            "-filter_complex",
            filter_graph,
            "-map",
            f"[{output_label}]",
            "-map",
            "0:a",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-shortest",
            str(output_path),
        ]
    )
    run_ffmpeg(cmd)


def render_video_clip(
    ffmpeg_bin: str,
    source_path: Path,
    start: float,
    duration: float,
    output_path: Path,
    *,
    caption_cards: list[dict],
) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        ffmpeg_bin,
        "-y",
        "-ss",
        f"{start:.3f}",
        "-t",
        f"{duration:.3f}",
        "-i",
        str(source_path),
    ]
    for card in caption_cards:
        cmd.extend(["-loop", "1", "-i", str(card["image_path"])])
    if caption_cards:
        overlay_filters, output_label = build_overlay_filter_chain("0:v", caption_cards, canvas_height=1080)
        cmd.extend(["-filter_complex", overlay_filters, "-map", f"[{output_label}]"])
    else:
        cmd.extend(["-map", "0:v"])
    cmd.extend(
        [
            "-map",
            "0:a",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-shortest",
            str(output_path),
        ]
    )
    run_ffmpeg(cmd)


def main() -> int:
    args = parse_args()
    manifest_path = Path(args.manifest).expanduser().resolve()
    if not manifest_path.exists():
        raise SystemExit(f"Manifest file not found: {manifest_path}")

    ffmpeg_bin = ensure_binary(args.ffmpeg_bin)
    ffprobe_bin = ensure_binary(args.ffprobe_bin)

    manifest = load_json(manifest_path)
    status = manifest.setdefault("status", {})
    if str(status.get("clip_candidates") or "").strip().lower() != "ready":
        raise SystemExit("Clip candidates must be ready before rendering clip assets")

    source_path = Path(manifest["source"]["media_path"]).expanduser().resolve()
    if not source_path.exists():
        raise SystemExit(f"Source media file not found: {source_path}")

    target = manifest["targets"]["clip_extractor"]
    clip_candidates_json_path = Path(target["clip_candidates_json_path"]).expanduser().resolve()
    rendered_clips_dir = Path(target.get("rendered_clips_dir") or clip_candidates_json_path.parent / "rendered").expanduser().resolve()
    rendered_clips_path = Path(target.get("rendered_clips_path") or clip_candidates_json_path.with_name("rendered.md")).expanduser().resolve()
    rendered_clips_json_path = Path(
        target.get("rendered_clips_json_path") or clip_candidates_json_path.with_name("rendered.json")
    ).expanduser().resolve()
    audiograms_dir = Path(target.get("audiograms_dir") or rendered_clips_dir.parent / "audiograms").expanduser().resolve()
    rendered_subtitles_dir = Path(
        target.get("rendered_subtitles_dir") or rendered_clips_dir / "subtitles"
    ).expanduser().resolve()
    transcript_segments_path = Path(manifest["source"]["transcript_segments_path"]).expanduser().resolve()

    if not clip_candidates_json_path.exists():
        raise SystemExit(f"Clip candidates JSON not found: {clip_candidates_json_path}")

    # Validate upstream freshness: check clip_candidates stage outputs
    require_fresh_upstream_stage_outputs(
        manifest,
        "clip_candidates",
        {"candidates_json": clip_candidates_json_path},
        context="Rendered clips",
        force=args.force,
    )

    candidates_payload = load_json(clip_candidates_json_path)
    candidates = candidates_payload.get("clip_candidates") or []
    if not candidates:
        raise SystemExit("No clip candidates available for rendering")

    # Validate all candidates have numeric timestamps before rendering
    require_numeric_clip_timestamps(candidates, context="Clip rendering")

    segments = []
    if transcript_segments_path.exists():
        segments = load_json(transcript_segments_path).get("segments") or []

    probe = probe_media(ffprobe_bin, source_path)
    source_has_video = has_video_stream(probe)
    generated_at = datetime.now(UTC).isoformat()
    rendered_records = []
    lines = [
        "# Rendered Clip Assets",
        "",
        f"Episode ID: `{manifest.get('episode_id', 'unknown')}`",
        f"Generated At: {generated_at}",
        f"Source Media: `{source_path}`",
        f"Source Mode: `{'video' if source_has_video else 'audio-only'}`",
        "",
    ]

    for candidate in candidates:
        slot = str(candidate.get("slot") or "").strip()
        if not slot:
            continue
        start = candidate.get("start")
        end = candidate.get("end")
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)) or end <= start:
            raise SystemExit(
                f"Clip candidate '{slot}' has invalid timestamps: "
                f"start={start}, end={end}. All candidates must have numeric timestamps."
            )
        duration = max(0.1, float(end) - float(start))
        audio_path = rendered_clips_dir / f"{slot}.m4a"
        video_path = rendered_clips_dir / f"{slot}.mp4"
        audiogram_path = audiograms_dir / f"{slot}.mp4"
        subtitles_path = rendered_subtitles_dir / f"{slot}.srt"
        caption_cards_dir = rendered_subtitles_dir / f"{slot}-cards"

        subtitles = build_clip_subtitles(segments, clip_start=float(start), clip_end=float(end))
        subtitles_written = write_subtitle_file(subtitles_path, subtitles)
        caption_cards = create_caption_cards(subtitles, captions_dir=caption_cards_dir) if subtitles else []

        if args.force or not audio_path.exists():
            render_audio_clip(ffmpeg_bin, source_path, float(start), duration, audio_path)

        rendered_mode = "audio_clip"
        preview_path = None
        if source_has_video:
            if args.force or not video_path.exists():
                render_video_clip(
                    ffmpeg_bin,
                    source_path,
                    float(start),
                    duration,
                    video_path,
                    caption_cards=caption_cards,
                )
            rendered_mode = "video_clip"
            preview_path = video_path
        else:
            if args.force or not audiogram_path.exists():
                render_audiogram(
                    ffmpeg_bin,
                    source_path,
                    float(start),
                    duration,
                    audiogram_path,
                    caption_cards=caption_cards,
                )
            rendered_mode = "audio_clip_with_audiogram"
            preview_path = audiogram_path

        record = {
            "slot": slot,
            "clip_id": slot,
            "start": start,
            "end": end,
            "duration_seconds": duration,
            "excerpt": candidate.get("excerpt"),
            "mode": rendered_mode,
            "audio_path": str(audio_path),
            "video_path": str(video_path) if source_has_video else None,
            "audiogram_path": str(audiogram_path) if not source_has_video else None,
            "subtitles_path": str(subtitles_path) if subtitles_written else None,
            "caption_card_dir": str(caption_cards_dir) if caption_cards else None,
            "captions_burned": bool(caption_cards and preview_path),
            "preview_path": str(preview_path) if preview_path else None,
        }
        rendered_records.append(record)
        lines.extend(
            [
                f"## {slot}",
                f"- Time range: `{start:.2f}` -> `{end:.2f}`",
                f"- Duration: `{duration:.1f}s`",
                f"- Mode: `{rendered_mode}`",
                f"- Audio: `{audio_path}`",
                f"- Subtitles: `{subtitles_path}`" if subtitles_written else "- Subtitles: `none`",
                f"- Caption cards: `{caption_cards_dir}`" if caption_cards else "- Caption cards: `none`",
                f"- Preview: `{preview_path}`" if preview_path else "- Preview: `none`",
                f"- Excerpt: {candidate.get('excerpt') or ''}",
                "",
            ]
        )

    if not rendered_records:
        raise SystemExit("Clip candidates were present but no renderable timestamps were found")

    rendered_payload = {
        "episode_id": manifest.get("episode_id"),
        "generated_at": generated_at,
        "source_path": str(source_path),
        "source_media_path": str(source_path),
        "source_mode": "video" if source_has_video else "audio-only",
        "rendered_clips": rendered_records,
    }
    write_text(rendered_clips_path, "\n".join(lines), overwrite=args.force)
    save_json(rendered_clips_json_path, rendered_payload)

    finalize_stage_outputs(
        manifest_path,
        manifest,
        status_updates={"rendered_clips": "ready"},
        target_sections={
            "clip_extractor": {
                "rendered_clips_dir": str(rendered_clips_dir),
                "rendered_clips_path": str(rendered_clips_path),
                "rendered_clips_json_path": str(rendered_clips_json_path),
                "rendered_subtitles_dir": str(rendered_subtitles_dir),
                "audiograms_dir": str(audiograms_dir),
            },
        },
        provenance_updates={
            "rendered_clips": (
                {
                    "clip_candidates": clip_candidates_json_path,
                    "transcript_segments": transcript_segments_path,
                },
                {
                    "rendered_md": rendered_clips_path,
                    "rendered_json": rendered_clips_json_path,
                },
            )
        },
        generated_at=generated_at,
    )

    print(str(rendered_clips_path))
    print(str(rendered_clips_json_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
