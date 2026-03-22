#!/usr/bin/env python3
"""Shared helpers for deterministic episode pipeline scripts."""

from __future__ import annotations

import hashlib
import json
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterable


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def write_text(path: Path, body: str, *, overwrite: bool = False) -> bool:
    """Write text to a file only if it doesn't exist or overwrite is True.

    Returns True if the file was written, False if it already existed and overwrite=False.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and not overwrite:
        return False
    path.write_text(body, encoding="utf-8")
    return True


def overwrite_text(path: Path, body: str) -> None:
    """Deprecated: use write_text(..., overwrite=True) instead."""
    write_text(path, body, overwrite=True)


def _resolve_path(value: str | Path) -> Path:
    return Path(value).expanduser().resolve()


def _remove_path(path: Path) -> None:
    if path.is_dir():
        shutil.rmtree(path, ignore_errors=True)
    elif path.exists():
        path.unlink()


def clear_force_rerun_outputs(manifest: dict) -> None:
    """Remove generated outputs so force reruns start from a clean state."""
    source = manifest.get("source", {})
    clip_targets = manifest.get("targets", {}).get("clip_extractor", {})
    social_targets = manifest.get("targets", {}).get("social_poster", {})
    newsletter_targets = manifest.get("targets", {}).get("newsletter_agent", {})
    ops_targets = manifest.get("targets", {}).get("operations", {})

    for key in (
        "transcript_path",
        "transcript_json_path",
        "transcript_segments_path",
        "transcript_diarization_path",
        "transcript_srt_path",
        "transcript_vtt_path",
        "transcript_tsv_path",
    ):
        value = source.get(key)
        if value:
            _remove_path(_resolve_path(value))

    for value in (
        clip_targets.get("clip_candidates_path"),
        clip_targets.get("clip_candidates_json_path"),
        clip_targets.get("rendered_clips_path"),
        clip_targets.get("rendered_clips_json_path"),
        clip_targets.get("quote_candidates_path"),
        clip_targets.get("quote_cards_path"),
        clip_targets.get("quote_cards_json_path"),
        social_targets.get("approval_packet_path"),
        social_targets.get("approval_packet_json_path"),
        social_targets.get("board_review_path"),
        social_targets.get("board_review_json_path"),
        social_targets.get("instagram_dry_run_path"),
        social_targets.get("instagram_dry_run_json_path"),
        social_targets.get("instagram_reel_path"),
        social_targets.get("facebook_post_path"),
        social_targets.get("tiktok_post_path"),
        newsletter_targets.get("draft_path"),
        newsletter_targets.get("draft_json_path"),
        newsletter_targets.get("mailchimp_dry_run_path"),
        newsletter_targets.get("mailchimp_dry_run_json_path"),
        ops_targets.get("riverside_runbook_path"),
        ops_targets.get("riverside_runbook_json_path"),
        ops_targets.get("siteground_runbook_path"),
        ops_targets.get("siteground_runbook_json_path"),
        ops_targets.get("vercel_runbook_path"),
        ops_targets.get("vercel_runbook_json_path"),
        ops_targets.get("fable_runbook_path"),
        ops_targets.get("fable_runbook_json_path"),
    ):
        if value:
            _remove_path(_resolve_path(value))

    for key in ("rendered_clips_dir", "rendered_subtitles_dir"):
        value = clip_targets.get(key)
        if value:
            _remove_path(_resolve_path(value))

    quotes_dir = clip_targets.get("quotes_dir")
    if quotes_dir:
        quotes_root = _resolve_path(quotes_dir)
        if quotes_root.exists():
            for artifact in quotes_root.glob("quote-card-*.png"):
                _remove_path(artifact)

    status = manifest.setdefault("status", {})
    for key in (
        "transcript",
        "clip_candidates",
        "quote_candidates",
        "rendered_clips",
        "quote_cards",
        "approval_packet",
        "social_drafts",
        "board_review",
        "newsletter_draft",
        "instagram_dry_run",
        "mailchimp_dry_run",
        "riverside_runbook",
        "siteground_runbook",
        "vercel_runbook",
        "fable_runbook",
        "homepage_update",
        "paperclip_sync",
        ):
        if key in status:
            status[key] = "pending"
    status.pop("siteground_runbook", None)

    operations = manifest.get("targets", {}).get("operations")
    if isinstance(operations, dict):
        operations.pop("siteground_runbook_path", None)
        operations.pop("siteground_runbook_json_path", None)


def require_ready_statuses(manifest: dict, keys: Iterable[str], *, context: str) -> None:
    status = manifest.setdefault("status", {})
    missing = [key for key in keys if str(status.get(key) or "").strip().lower() != "ready"]
    if missing:
        raise SystemExit(f"{context} requires ready statuses for: {', '.join(missing)}")


def require_existing_paths(paths: dict[str, Path], *, context: str) -> None:
    missing = [f"{label}: {path}" for label, path in paths.items() if not path.exists()]
    if missing:
        raise SystemExit(f"{context} is missing required artifacts: {'; '.join(missing)}")


def calculate_file_hash(path: Path) -> str:
    """Calculate SHA256 hash of a file's contents."""
    if not path.exists():
        return "missing"
    hasher = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(8192):
            hasher.update(chunk)
    return hasher.hexdigest()


def record_artifact_provenance(manifest: dict, artifact_key: str, artifact_paths: dict[str, Path]) -> None:
    """Record provenance metadata for an artifact in the manifest.

    Args:
        manifest: The manifest dict to update
        artifact_key: The status key for this artifact (e.g., "transcript", "board_review")
        artifact_paths: Dict mapping friendly names to Path objects
    """
    manifest.setdefault("provenance", {})
    manifest.setdefault("artifacts", {})

    hashes = {name: calculate_file_hash(path) for name, path in artifact_paths.items()}

    manifest["artifacts"][artifact_key] = {
        "generated_at": datetime.now(UTC).isoformat(),
        "hashes": hashes,
    }


def validate_artifact_freshness(manifest: dict, artifact_key: str, artifact_paths: dict[str, Path]) -> bool:
    """Validate that an artifact's upstream inputs haven't changed.

    Returns True if the artifact is fresh (all upstream hashes match), False otherwise.
    """
    if artifact_key not in manifest.get("artifacts", {}):
        # No provenance recorded yet - cannot validate
        return True

    provenance = manifest["artifacts"][artifact_key]
    recorded_hashes = provenance.get("hashes", {})
    current_hashes = {name: calculate_file_hash(path) for name, path in artifact_paths.items()}

    # Check if any upstream hashes have changed
    for name, current_hash in current_hashes.items():
        recorded_hash = recorded_hashes.get(name, "missing")
        if current_hash != recorded_hash:
            return False

    return True


def episode_root_path(runtime_root: str | Path, episode_id: str) -> Path:
    """Return the per-episode runtime root under the shared runtime root."""
    return Path(runtime_root).expanduser().resolve() / "episodes" / episode_id


def episode_runtime_dirs(runtime_root: str | Path, episode_id: str) -> dict[str, Path]:
    """Return the canonical per-episode runtime directories."""
    runtime_root_path = Path(runtime_root).expanduser().resolve()
    episode_root = runtime_root_path / "episodes" / episode_id
    return {
        "runtime_root": runtime_root_path,
        "episode_root": episode_root,
        "incoming_dir": runtime_root_path / "incoming",
        "input_dir": episode_root / "input",
        "metadata_dir": episode_root / "metadata",
        "transcripts_dir": episode_root / "transcripts",
        "assets_dir": episode_root / "assets",
        "manifests_dir": episode_root / "manifests",
    }
