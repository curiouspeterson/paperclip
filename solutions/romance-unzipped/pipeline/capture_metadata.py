#!/usr/bin/env python3
"""Capture canonical episode metadata for the intake pipeline."""

from __future__ import annotations

import argparse
import json
import os
import re
from datetime import UTC, datetime
from pathlib import Path


MEDIA_EXTENSIONS = {".mp3", ".mp4", ".m4a", ".mov", ".mkv", ".wav", ".webm"}


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "episode"


def derive_episode_id(source: Path) -> str:
    timestamp = datetime.now(UTC).strftime("%Y%m%d")
    return f"{timestamp}-{slugify(source.stem)}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, help="Path to the raw episode media file")
    parser.add_argument("--root", required=True, help="Pipeline root directory")
    parser.add_argument("--episode-id", help="Optional explicit episode id")
    parser.add_argument("--title", help="Optional canonical episode title")
    parser.add_argument("--force", action="store_true", help="Overwrite existing metadata")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source = Path(args.source).expanduser().resolve()
    if not source.exists():
        raise SystemExit(f"Source file not found: {source}")
    if source.suffix.lower() not in MEDIA_EXTENSIONS:
        raise SystemExit(f"Unsupported media extension: {source.suffix}")

    root = Path(args.root).expanduser().resolve()
    metadata_dir = root / "metadata"
    assets_dir = root / "assets"
    transcripts_dir = root / "transcripts"
    input_dir = root / "input"
    manifests_dir = root / "manifests"
    metadata_dir.mkdir(parents=True, exist_ok=True)
    assets_dir.mkdir(parents=True, exist_ok=True)
    transcripts_dir.mkdir(parents=True, exist_ok=True)
    input_dir.mkdir(parents=True, exist_ok=True)
    manifests_dir.mkdir(parents=True, exist_ok=True)

    episode_id = args.episode_id or derive_episode_id(source)
    metadata_path = metadata_dir / f"{episode_id}.json"
    if metadata_path.exists() and not args.force:
        print(str(metadata_path))
        return 0

    stat = source.stat()
    payload = {
        "episode_id": episode_id,
        "title": args.title or source.stem.replace("_", " ").strip(),
        "source_path": str(source),
        "input_path": str(input_dir / source.name),
        "source_public_url": os.environ.get("RU_SOURCE_URL") or None,
        "source_channel_url": os.environ.get("RU_SOURCE_CHANNEL_URL") or None,
        "source_filename": source.name,
        "source_extension": source.suffix.lower(),
        "source_size_bytes": stat.st_size,
        "detected_at": datetime.now(UTC).isoformat(),
        "source_modified_at": datetime.fromtimestamp(stat.st_mtime, UTC).isoformat(),
        "transcript_path": str(transcripts_dir / f"{episode_id}.txt"),
        "transcript_json_path": str(transcripts_dir / f"{episode_id}.json"),
        "transcript_segments_path": str(transcripts_dir / f"{episode_id}.segments.json"),
        "transcript_diarization_path": str(transcripts_dir / f"{episode_id}.diarization.json"),
        "transcript_srt_path": str(transcripts_dir / f"{episode_id}.srt"),
        "transcript_vtt_path": str(transcripts_dir / f"{episode_id}.vtt"),
        "transcript_tsv_path": str(transcripts_dir / f"{episode_id}.tsv"),
        "assets_dir": str(assets_dir / episode_id),
        "manifest_path": str(manifests_dir / f"{episode_id}.json"),
        "status": "detected",
        "tags": [],
        "notes": [],
    }
    metadata_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(str(metadata_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
