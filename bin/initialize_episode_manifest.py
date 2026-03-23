#!/usr/bin/env python3
"""Initialize an episode manifest as the first and only runtime contract.

This combines metadata capture and manifest creation into a single manifest-first intake step.
The manifest is the authoritative state object for the entire pipeline.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
from datetime import UTC, datetime
from pathlib import Path

from pipeline_common import (
    atomic_save_json,
    episode_root_path,
    episode_runtime_dirs,
    load_json,
    normalize_publish_metadata,
    resolve_path,
    save_json,
)


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
    parser.add_argument("--publish-date", help="Optional ISO timestamp for the episode's public publish date (e.g. YouTube upload date)")
    parser.add_argument("--force", action="store_true", help="Overwrite existing manifest")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source = resolve_path(args.source)
    if not source.exists():
        raise SystemExit(f"Source file not found: {source}")
    if source.suffix.lower() not in MEDIA_EXTENSIONS:
        raise SystemExit(f"Unsupported media extension: {source.suffix}")

    root = resolve_path(args.root)
    # Derive or use provided episode ID
    episode_id = args.episode_id or derive_episode_id(source)
    dirs = episode_runtime_dirs(root, episode_id)
    episode_root = dirs["episode_root"]
    metadata_dir = dirs["metadata_dir"]
    assets_dir = dirs["assets_dir"]
    transcripts_dir = dirs["transcripts_dir"]
    input_dir = dirs["input_dir"]
    manifests_dir = dirs["manifests_dir"]
    incoming_dir = dirs["incoming_dir"]

    # Create all necessary directories
    for directory in [incoming_dir, metadata_dir, assets_dir, transcripts_dir, input_dir, manifests_dir]:
        directory.mkdir(parents=True, exist_ok=True)

    # Create asset subdirectories
    for subdir in ("clips", "quotes", "audiograms", "social", "newsletter", "ops"):
        (assets_dir / subdir).mkdir(parents=True, exist_ok=True)

    canonical_source = input_dir / source.name
    if source.resolve() != canonical_source.resolve():
        if canonical_source.exists():
            if source.exists():
                source.unlink()
        else:
            shutil.move(str(source), str(canonical_source))
    source = canonical_source

    manifest_path = manifests_dir / f"{episode_id}.json"
    metadata_path = metadata_dir / f"{episode_id}.json"

    existing_manifest = load_json(manifest_path) if manifest_path.exists() and not args.force else None

    # Prepare transcript paths
    transcript_path = transcripts_dir / f"{episode_id}.txt"
    transcript_json_path = transcripts_dir / f"{episode_id}.json"
    transcript_segments_path = transcripts_dir / f"{episode_id}.segments.json"
    transcript_diarization_path = transcripts_dir / f"{episode_id}.diarization.json"
    transcript_srt_path = transcripts_dir / f"{episode_id}.srt"
    transcript_vtt_path = transcripts_dir / f"{episode_id}.vtt"
    transcript_tsv_path = transcripts_dir / f"{episode_id}.tsv"

    # Collect file metadata for manifest
    stat = source.stat()
    created_at = datetime.now(UTC).isoformat()

    # Create the canonical manifest
    manifest = {
        "runtime": {
            "root_path": str(root),
            "episode_root_path": str(episode_root),
            "initialized_at": created_at,
        },
        "episode_id": episode_id,
        "title": args.title or source.stem.replace("_", " ").strip(),
        "created_at": created_at,
        "source": {
            "media_path": str(source),
            "metadata_path": str(metadata_path),
            "public_url": os.environ.get("RU_SOURCE_URL"),
            "channel_url": os.environ.get("RU_SOURCE_CHANNEL_URL"),
            "transcript_path": str(transcript_path),
            "transcript_json_path": str(transcript_json_path),
            "transcript_segments_path": str(transcript_segments_path),
            "transcript_diarization_path": str(transcript_diarization_path),
            "transcript_srt_path": str(transcript_srt_path),
            "transcript_vtt_path": str(transcript_vtt_path),
            "transcript_tsv_path": str(transcript_tsv_path),
        },
        "targets": {
            "clip_extractor": {
                "clips_dir": str(assets_dir / "clips"),
                "clip_candidates_path": str(assets_dir / "clips" / "candidates.md"),
                "clip_candidates_json_path": str(assets_dir / "clips" / "candidates.json"),
                "rendered_clips_dir": str(assets_dir / "clips" / "rendered"),
                "rendered_clips_path": str(assets_dir / "clips" / "rendered.md"),
                "rendered_clips_json_path": str(assets_dir / "clips" / "rendered.json"),
                "rendered_subtitles_dir": str(assets_dir / "clips" / "rendered" / "subtitles"),
                "quotes_dir": str(assets_dir / "quotes"),
                "quote_candidates_path": str(assets_dir / "quotes" / "candidates.md"),
                "quote_cards_path": str(assets_dir / "quotes" / "cards.md"),
                "quote_cards_json_path": str(assets_dir / "quotes" / "cards.json"),
                "audiograms_dir": str(assets_dir / "audiograms"),
            },
            "social_poster": {
                "social_dir": str(assets_dir / "social"),
                "approval_packet_path": str(assets_dir / "social" / "approval-packet.md"),
                "approval_packet_json_path": str(assets_dir / "social" / "approval-packet.json"),
                "board_review_path": str(assets_dir / "social" / "board-review.md"),
                "board_review_json_path": str(assets_dir / "social" / "board-review.json"),
                "instagram_dry_run_path": str(assets_dir / "social" / "instagram-dry-run.md"),
                "instagram_dry_run_json_path": str(assets_dir / "social" / "instagram-dry-run.json"),
                "instagram_reel_path": str(assets_dir / "social" / "instagram-reel.md"),
                "facebook_post_path": str(assets_dir / "social" / "facebook-post.md"),
                "tiktok_post_path": str(assets_dir / "social" / "tiktok-post.md"),
            },
            "newsletter_agent": {
                "newsletter_dir": str(assets_dir / "newsletter"),
                "draft_path": str(assets_dir / "newsletter" / "draft.md"),
                "draft_json_path": str(assets_dir / "newsletter" / "draft.json"),
                "mailchimp_dry_run_path": str(assets_dir / "newsletter" / "mailchimp-dry-run.md"),
                "mailchimp_dry_run_json_path": str(assets_dir / "newsletter" / "mailchimp-dry-run.json"),
            },
            "operations": {
                "ops_dir": str(assets_dir / "ops"),
                "riverside_runbook_path": str(assets_dir / "ops" / "riverside-runbook.md"),
                "riverside_runbook_json_path": str(assets_dir / "ops" / "riverside-runbook.json"),
                "vercel_runbook_path": str(assets_dir / "ops" / "vercel-runbook.md"),
                "vercel_runbook_json_path": str(assets_dir / "ops" / "vercel-runbook.json"),
                "fable_runbook_path": str(assets_dir / "ops" / "fable-runbook.md"),
                "fable_runbook_json_path": str(assets_dir / "ops" / "fable-runbook.json"),
            },
        },
        "status": {
            "manifest": "ready",
            "metadata": "ready",
            "transcript": "pending",
            "diarization": "pending",
            "clip_candidates": "pending",
            "quote_candidates": "pending",
            "rendered_clips": "pending",
            "quote_cards": "pending",
            "approval_packet": "pending",
            "social_drafts": "pending",
            "board_review": "pending",
            "newsletter_draft": "pending",
            "instagram_dry_run": "pending",
            "mailchimp_dry_run": "pending",
            "riverside_runbook": "pending",
            "vercel_runbook": "pending",
            "fable_runbook": "pending",
            "homepage_update": "pending",
            "paperclip_sync": "pending",
        },
        "governance": {
            "paperclip_issue_id": None,
            "board_review_synced_at": None,
            "board_approval": "pending",
        },
        "homepage": {
            "publish_date": args.publish_date or os.environ.get("RU_PUBLISH_DATE") or None,
            "public_url": os.environ.get("RU_SOURCE_URL"),
            "channel_url": os.environ.get("RU_SOURCE_CHANNEL_URL"),
        },
    }

    # If manifest already exists (but not forced), merge targets and status
    if existing_manifest:
        existing = existing_manifest
        for section in ("source", "runtime", "homepage", "governance"):
            if isinstance(existing.get(section), dict):
                merged = dict(manifest.get(section, {}))
                merged.update(existing[section])
                manifest[section] = merged
        if isinstance(existing.get("targets"), dict):
            for section, defaults in manifest["targets"].items():
                merged = dict(defaults)
                if isinstance(existing.get("targets", {}).get(section), dict):
                    existing_section = dict(existing["targets"][section])
                    if section == "operations":
                        existing_section.pop("siteground_runbook_path", None)
                        existing_section.pop("siteground_runbook_json_path", None)
                    merged.update(existing_section)
                manifest["targets"][section] = merged
        if isinstance(existing.get("status"), dict):
            existing_status = dict(existing.get("status", {}))
            existing_status.pop("siteground_runbook", None)
            manifest["status"] = {**existing_status, **manifest["status"]}
        manifest["created_at"] = existing.get("created_at", created_at)
        for passthrough_key in ("provenance", "artifacts", "timestamps"):
            if passthrough_key in existing and passthrough_key not in manifest:
                manifest[passthrough_key] = existing[passthrough_key]

    normalize_publish_metadata(
        manifest,
        args.publish_date or os.environ.get("RU_PUBLISH_DATE"),
    )

    # Save manifest atomically (manifest is the primary contract)
    atomic_save_json(manifest_path, manifest)

    # Also create metadata file as a derived artifact (for backwards compatibility)
    metadata = {
        "episode_id": episode_id,
        "title": manifest["title"],
        "source_path": str(source),
        "input_path": str(source),
        "source_public_url": os.environ.get("RU_SOURCE_URL"),
        "source_channel_url": os.environ.get("RU_SOURCE_CHANNEL_URL"),
        "source_filename": source.name,
        "source_extension": source.suffix.lower(),
        "source_size_bytes": stat.st_size,
        "published_at": manifest.get("published_at"),
        "upload_date": manifest.get("upload_date"),
        "detected_at": created_at,
        "source_modified_at": datetime.fromtimestamp(stat.st_mtime, UTC).isoformat(),
        "manifest_path": str(manifest_path),
        "manifest_generated_at": created_at,
        "status": "ready_for_handoff",
        "tags": [],
        "notes": [],
    }
    save_json(metadata_path, metadata)

    print(str(manifest_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
