#!/usr/bin/env python3
"""Generate a handoff manifest for downstream episode processors."""

from __future__ import annotations

import argparse
from datetime import UTC, datetime
from pathlib import Path
import shutil

from pipeline_common import episode_runtime_dirs, load_json, save_json


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--metadata", required=True, help="Path to metadata json")
    parser.add_argument("--force", action="store_true", help="Overwrite existing manifest")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    metadata_path = Path(args.metadata).expanduser().resolve()
    if not metadata_path.exists():
        raise SystemExit(f"Metadata file not found: {metadata_path}")

    metadata = load_json(metadata_path)
    manifest_path = Path(metadata["manifest_path"]).expanduser().resolve()
    episode_id = metadata["episode_id"]
    if manifest_path.parent.parent.name == episode_id:
        runtime_root = manifest_path.parent.parent.parent
    else:
        runtime_root = manifest_path.parent.parent
    dirs = episode_runtime_dirs(runtime_root, episode_id)
    assets_dir = dirs["assets_dir"]
    metadata_dir = dirs["metadata_dir"]
    manifests_dir = dirs["manifests_dir"]
    transcripts_dir = dirs["transcripts_dir"]
    input_dir = dirs["input_dir"]
    transcript_path = Path(metadata["transcript_path"]).expanduser().resolve()
    transcript_json_path = Path(metadata.get("transcript_json_path", transcript_path.with_suffix(".json"))).expanduser().resolve()
    transcript_segments_path = Path(metadata.get("transcript_segments_path", transcript_path.with_suffix(".segments.json"))).expanduser().resolve()
    transcript_diarization_path = Path(
        metadata.get("transcript_diarization_path", transcript_path.with_suffix(".diarization.json"))
    ).expanduser().resolve()
    transcript_srt_path = Path(metadata.get("transcript_srt_path", transcript_path.with_suffix(".srt"))).expanduser().resolve()
    transcript_vtt_path = Path(metadata.get("transcript_vtt_path", transcript_path.with_suffix(".vtt"))).expanduser().resolve()
    transcript_tsv_path = Path(metadata.get("transcript_tsv_path", transcript_path.with_suffix(".tsv"))).expanduser().resolve()

    for directory in [assets_dir, metadata_dir, manifests_dir, transcripts_dir, input_dir]:
        directory.mkdir(parents=True, exist_ok=True)
    for child in ("clips", "quotes", "audiograms", "social", "newsletter", "ops"):
        (assets_dir / child).mkdir(parents=True, exist_ok=True)

    # Relocate source and transcript artifacts into the episode-scoped runtime tree.
    def move_if_needed(path: Path, target_dir: Path) -> Path:
        if not path.exists():
            return path
        target = target_dir / path.name
        if path.resolve() == target.resolve():
            return path
        if target.exists():
            path.unlink()
            return target
        shutil.move(str(path), str(target))
        return target

    source_path = Path(metadata["source_path"]).expanduser().resolve()
    metadata_path = move_if_needed(metadata_path, metadata_dir)
    manifest_path = manifests_dir / manifest_path.name
    source_path = move_if_needed(source_path, input_dir)
    transcript_path = move_if_needed(transcript_path, transcripts_dir)
    transcript_json_path = move_if_needed(transcript_json_path, transcripts_dir)
    transcript_segments_path = move_if_needed(transcript_segments_path, transcripts_dir)
    transcript_diarization_path = move_if_needed(transcript_diarization_path, transcripts_dir)
    transcript_srt_path = move_if_needed(transcript_srt_path, transcripts_dir)
    transcript_vtt_path = move_if_needed(transcript_vtt_path, transcripts_dir)
    transcript_tsv_path = move_if_needed(transcript_tsv_path, transcripts_dir)

    payload = {
        "episode_id": metadata["episode_id"],
        "title": metadata["title"],
        "created_at": datetime.now(UTC).isoformat(),
        "source": {
            "media_path": str(source_path),
            "metadata_path": str(metadata_path),
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
            "metadata": "ready",
            "transcript": metadata.get("transcript_status", "pending"),
            "diarization": metadata.get("diarization_status", "pending"),
            "manifest": "ready",
        },
        "runtime": {
            "root_path": str(runtime_root),
            "episode_root_path": str(dirs["episode_root"]),
            "initialized_at": metadata.get("detected_at", datetime.now(UTC).isoformat()),
        },
    }
    if manifest_path.exists() and not args.force:
        existing = load_json(manifest_path)
        existing_targets = existing.get("targets") if isinstance(existing.get("targets"), dict) else {}
        for section, defaults in payload["targets"].items():
            merged = dict(defaults)
            if isinstance(existing_targets.get(section), dict):
                merged.update(existing_targets[section])
            payload["targets"][section] = merged
        existing_status = existing.get("status") if isinstance(existing.get("status"), dict) else {}
        payload["status"] = {
            **existing_status,
            "metadata": "ready",
            "transcript": metadata.get("transcript_status", existing_status.get("transcript", "pending")),
            "diarization": metadata.get("diarization_status", existing_status.get("diarization", "pending")),
            "manifest": "ready",
        }
        payload["created_at"] = existing.get("created_at", payload["created_at"])
    save_json(manifest_path, payload)

    metadata["manifest_generated_at"] = datetime.now(UTC).isoformat()
    metadata["status"] = "ready_for_handoff"
    metadata["source_path"] = str(source_path)
    metadata["input_path"] = str(source_path)
    metadata["metadata_path"] = str(metadata_path)
    metadata["manifest_path"] = str(manifest_path)
    save_json(metadata_path, metadata)

    print(str(manifest_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
