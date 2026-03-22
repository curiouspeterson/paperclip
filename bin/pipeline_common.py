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


def _remove_path(path: Path) -> None:
    if path.is_dir():
        shutil.rmtree(path, ignore_errors=True)
    elif path.exists():
        path.unlink()


def clear_force_rerun_outputs(manifest: dict) -> None:
    """Remove generated outputs so force reruns start from a clean state.

    This preserves intake identity and governance metadata while clearing
    downstream generated artifacts, their recorded provenance, and the
    corresponding stage statuses.
    """
    source = manifest.get("source", {})
    clip_targets = manifest.get("targets", {}).get("clip_extractor", {})
    social_targets = manifest.get("targets", {}).get("social_poster", {})
    newsletter_targets = manifest.get("targets", {}).get("newsletter_agent", {})
    ops_targets = manifest.get("targets", {}).get("operations", {})

    file_keys = [
        "transcript_path",
        "transcript_json_path",
        "transcript_segments_path",
        "transcript_diarization_path",
        "transcript_srt_path",
        "transcript_vtt_path",
        "transcript_tsv_path",
    ]
    for key in file_keys:
        value = source.get(key)
        if value:
            _remove_path(resolve_path(value))

    removable_paths = [
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
    ]
    for value in removable_paths:
        if value:
            _remove_path(resolve_path(value))

    for key in ("rendered_clips_dir", "rendered_subtitles_dir"):
        value = clip_targets.get(key)
        if value:
            _remove_path(resolve_path(value))

    quotes_dir = clip_targets.get("quotes_dir")
    if quotes_dir:
        quotes_root = resolve_path(quotes_dir)
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

    if status.get("diarization") not in (None, "skipped"):
        status["diarization"] = "pending"

    provenance = manifest.get("provenance")
    if isinstance(provenance, dict):
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
            provenance.pop(key, None)
        provenance.pop("siteground_runbook", None)

    artifacts = manifest.get("artifacts")
    if isinstance(artifacts, dict):
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
            artifacts.pop(key, None)
        artifacts.pop("siteground_runbook", None)

    operations = manifest.get("targets", {}).get("operations")
    if isinstance(operations, dict):
        operations.pop("siteground_runbook_path", None)
        operations.pop("siteground_runbook_json_path", None)
    status.pop("siteground_runbook", None)


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


def record_stage_provenance(manifest: dict, stage: str, *, upstream_artifacts: dict[str, Path] | None = None, generated_artifacts: dict[str, Path] | None = None) -> None:
    """Record unified provenance for a pipeline stage.

    Uses stage name as key with consistent inputs/outputs structure.

    Args:
        manifest: The manifest dict to update
        stage: The stage name (e.g., "clip_candidates", "approval_packet")
        upstream_artifacts: Dict of input artifact name -> path
        generated_artifacts: Dict of output artifact name -> path
    """
    manifest.setdefault("provenance", {})[stage] = {
        "generated_at": datetime.now(UTC).isoformat(),
        "inputs": {name: calculate_file_hash(path) for name, path in (upstream_artifacts or {}).items()},
        "outputs": {name: calculate_file_hash(path) for name, path in (generated_artifacts or {}).items()},
    }




def require_fresh_upstream_stage_outputs(
    manifest: dict,
    upstream_stage: str,
    output_artifacts: dict[str, Path],
    *,
    context: str,
    force: bool = False,
) -> None:
    """Require that an upstream stage's recorded outputs still match the current files.

    Validates current file hashes against the outputs recorded in the upstream stage's
    provenance block. This is the correct check: we compare the files we are about to
    consume against what the upstream stage certified it produced.

    Aborts with a hard error when:
    - The upstream stage is 'ready' but has no provenance recorded (re-run required).
    - Any recorded output hash does not match the current file hash.

    Silent no-op when:
    - force=True
    - The upstream stage has no provenance AND is not yet 'ready' (first run, pipeline
      hasn't produced that stage yet — not an error).

    Args:
        manifest: The manifest dict
        upstream_stage: The upstream stage name whose outputs we validate
                        (e.g., "clip_candidates", "approval_packet")
        output_artifacts: Dict of output artifact name -> path to validate.
                          Names must match those recorded by the upstream stage.
        context: Error message context for abort messages
        force: If True, skip freshness check

    Raises SystemExit if upstream outputs have changed and force=False.
    """
    if force:
        return

    upstream_status = manifest.get("status", {}).get(upstream_stage)
    provenance = manifest.get("provenance", {}).get(upstream_stage)

    if not provenance:
        if upstream_status == "ready":
            raise SystemExit(
                f"{context}: upstream stage '{upstream_stage}' is marked ready but has no "
                f"recorded provenance. Re-run the upstream stage to record provenance."
            )
        return

    recorded_outputs = provenance.get("outputs", {})
    for name, path in output_artifacts.items():
        current_hash = calculate_file_hash(path)
        recorded_hash = recorded_outputs.get(name, "missing")
        if current_hash != recorded_hash:
            raise SystemExit(
                f"{context}: upstream stage '{upstream_stage}' outputs have changed. "
                f"The artifact '{name}' was {recorded_hash[:8]}... but is now {current_hash[:8]}... "
                f"Re-run the upstream stage or use --force to override."
            )


def require_fresh_inputs_from_stages(
    manifest: dict,
    *,
    stages: dict[str, dict[str, Path]],
    context: str,
    force: bool = False,
) -> None:
    """Validate freshness for multiple upstream stages in one call.

    A convenience wrapper around require_fresh_upstream_stage_outputs that accepts a
    mapping of upstream stage name -> {artifact_name: path} and validates each stage
    independently.

    Args:
        manifest: The manifest dict
        stages: Dict mapping upstream_stage_name -> {artifact_name: path} for each
                upstream stage whose outputs should be validated.
        context: Error message context for abort messages
        force: If True, skip all freshness checks

    Raises SystemExit if any upstream stage outputs have changed and force=False.
    """
    for upstream_stage, output_artifacts in stages.items():
        require_fresh_upstream_stage_outputs(
            manifest,
            upstream_stage,
            output_artifacts,
            context=context,
            force=force,
        )


def resolve_path(value: str | Path) -> Path:
    """Resolve a path string or Path object to an absolute Path."""
    return Path(value).expanduser().resolve()


def episode_root_path(runtime_root: str | Path, episode_id: str) -> Path:
    """Return the per-episode runtime root under the shared runtime root."""
    return resolve_path(runtime_root) / "episodes" / episode_id


def episode_runtime_dirs(runtime_root: str | Path, episode_id: str) -> dict[str, Path]:
    """Return the canonical per-episode runtime directories."""
    episode_root = episode_root_path(runtime_root, episode_id)
    return {
        "runtime_root": resolve_path(runtime_root),
        "episode_root": episode_root,
        "incoming_dir": resolve_path(runtime_root) / "incoming",
        "input_dir": episode_root / "input",
        "metadata_dir": episode_root / "metadata",
        "transcripts_dir": episode_root / "transcripts",
        "assets_dir": episode_root / "assets",
        "manifests_dir": episode_root / "manifests",
    }


def load_manifest(path: str | Path) -> dict:
    """Load a manifest JSON file."""
    return load_json(resolve_path(path))


def save_manifest(path: str | Path, manifest: dict) -> None:
    """Save a manifest JSON file with atomic write."""
    atomic_save_json(resolve_path(path), manifest)


def atomic_save_json(path: Path, payload: dict) -> None:
    """Atomically save JSON to a file using temp file + rename."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temp_path.replace(path)


def set_stage_status(manifest: dict, stage: str, status: str, *, timestamp_key: str | None = None) -> None:
    """Set the status of a pipeline stage in the manifest.

    Args:
        manifest: The manifest dict to update
        stage: The stage key (e.g., "transcript", "clip_candidates")
        status: The status value (e.g., "ready", "pending", "failed")
        timestamp_key: If provided, also update this key with current timestamp
    """
    manifest.setdefault("status", {})[stage] = status
    if timestamp_key:
        manifest.setdefault("timestamps", {})[timestamp_key] = datetime.now(UTC).isoformat()




def finalize_stage_outputs(
    manifest_path: Path,
    manifest: dict,
    *,
    status_updates: dict[str, str],
    target_sections: dict[str, dict[str, str]] | None = None,
    provenance_updates: dict[str, tuple[dict[str, Path], dict[str, Path]]] | None = None,
    generated_at: str | None = None,
) -> None:
    """Finalize all output from a pipeline stage: status, targets, and provenance.

    Args:
        manifest_path: Path to save the manifest
        manifest: The manifest dict to update
        status_updates: Dict of status key -> value to update
        target_sections: Dict of section_name -> dict of path updates, written atomically
                         (e.g., {"clip_extractor": {"path": "/..."}, "social_poster": {...}})
        provenance_updates: Dict of stage_name -> (input_artifacts, output_artifacts)
                            for recording multiple provenance blocks atomically.
                            Each value is a tuple of (inputs dict, outputs dict).
        generated_at: ISO timestamp for provenance generation time (defaults to now)
    """
    ts = generated_at or datetime.now(UTC).isoformat()

    # Update all status fields
    manifest.setdefault("status", {}).update(status_updates)

    # Update named target sections atomically
    if target_sections:
        for section_name, updates in target_sections.items():
            if updates:
                manifest.setdefault("targets", {}).setdefault(section_name, {}).update(updates)

    # Record multiple provenance blocks atomically
    if provenance_updates:
        prov = manifest.setdefault("provenance", {})
        for stage, (inputs, outputs) in provenance_updates.items():
            prov[stage] = {
                "generated_at": ts,
                "inputs": {name: calculate_file_hash(path) for name, path in inputs.items()},
                "outputs": {name: calculate_file_hash(path) for name, path in outputs.items()},
            }

    # Update manifest timestamp
    manifest["updated_at"] = datetime.now(UTC).isoformat()

    # Save manifest atomically
    atomic_save_json(manifest_path, manifest)


def require_numeric_transcript_segments(segments: list[dict], *, context: str) -> list[dict]:
    """Require all transcript segments to have numeric start/end timestamps.

    Aborts before any candidate scoring or serialization if any segment lacks
    numeric timestamps, enforcing that the pipeline only runs on timestamped transcripts.

    Args:
        segments: List of transcript segment dicts
        context: Error message context

    Returns:
        The same list, validated (for fluent chaining).

    Raises SystemExit if any segment lacks numeric start or end timestamps.
    """
    for i, seg in enumerate(segments):
        start = seg.get("start")
        end = seg.get("end")
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
            raise SystemExit(
                f"{context}: transcript segment {i} lacks numeric timestamps "
                f"(start={start!r}, end={end!r}). "
                f"Clip generation requires a timestamped transcript. "
                f"Re-run transcription with word_timestamps=true or use a backend that produces numeric segments."
            )
    return segments


def require_numeric_clip_timestamps(candidates: list[dict], *, context: str) -> None:
    """Require all clip candidates to have numeric start/end timestamps.

    Args:
        candidates: List of candidate dicts
        context: Error message context

    Raises SystemExit if any candidate lacks numeric timestamps.
    """
    for i, candidate in enumerate(candidates):
        start = candidate.get("start")
        end = candidate.get("end")

        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
            raise SystemExit(
                f"{context}: clip candidate {i} (slot: {candidate.get('slot', 'unknown')}) "
                f"has invalid timestamps: start={start}, end={end}. "
                f"All timestamps must be numeric (seconds)."
            )

        if end <= start:
            raise SystemExit(
                f"{context}: clip candidate {i} (slot: {candidate.get('slot', 'unknown')}) "
                f"has invalid duration: start={start}, end={end}. "
                f"End time must be greater than start time."
            )


def require_board_approval(manifest: dict, *, context: str, approval_key: str = "board_approval") -> None:
    """Require board approval status in the manifest before proceeding.

    Args:
        manifest: The manifest dict
        context: Error message context
        approval_key: The governance key to check (default: "board_approval")

    Raises SystemExit if approval status is not "approved".
    """
    governance = manifest.get("governance", {})
    approval_status = governance.get(approval_key)

    if approval_status != "approved":
        raise SystemExit(
            f"{context} requires board approval. "
            f"Current status: {approval_status or 'not set'}. "
            f"Issue ID: {governance.get('paperclip_issue_id') or 'not linked'}"
        )


def mark_skip_transcript_ready(
    manifest_path: str | Path,
    *,
    source_path: Path | None = None,
    transcript_outputs: dict[str, Path] | None = None,
) -> None:
    """Mark transcript as ready without running transcription.

    Used when --skip-transcript is specified and a pre-existing transcript is available.
    Records transcript output hashes as provenance so downstream freshness checks have a
    certified upstream artifact baseline to compare against.

    Args:
        manifest_path: Path to the manifest JSON file
        source_path: Optional path to the source media file (defaults to manifest source)
        transcript_outputs: Optional dict of name -> path for transcript output files.
                            Defaults to the canonical transcript paths declared in the manifest.

    Raises SystemExit if manifest not found or transcript file missing.
    """
    manifest_path = resolve_path(manifest_path)
    if not manifest_path.exists():
        raise SystemExit(f"Manifest file not found: {manifest_path}")

    manifest = load_json(manifest_path)
    source = manifest.get("source", {})
    transcript_path = Path(source["transcript_path"]).expanduser().resolve()

    if not transcript_path.exists():
        raise SystemExit(f"Transcript file not found for skip-transcript mode: {transcript_path}")

    # Build provenance inputs: source media file
    if source_path is None:
        source_path = Path(source["media_path"]).expanduser().resolve()

    # Build provenance outputs: all canonical transcript files that exist
    if transcript_outputs is None:
        candidates: dict[str, Path] = {
            "transcript": transcript_path,
        }
        for key in ("transcript_json_path", "transcript_segments_path"):
            raw = source.get(key)
            if raw:
                p = Path(raw).expanduser().resolve()
                label = key.replace("_path", "").replace("transcript_", "transcript_")
                candidates[label] = p
        for key in ("transcript_srt_path", "transcript_vtt_path", "transcript_tsv_path"):
            raw = source.get(key)
            if raw:
                p = Path(raw).expanduser().resolve()
                if p.exists():
                    label = key.replace("_path", "")
                    candidates[label] = p
        diar_raw = source.get("transcript_diarization_path")
        if diar_raw:
            diar_p = Path(diar_raw).expanduser().resolve()
            if diar_p.exists():
                candidates["transcript_diarization"] = diar_p
        transcript_outputs = {k: v for k, v in candidates.items() if v.exists()}

    # Record provenance: certifies the existing transcript outputs
    record_stage_provenance(
        manifest,
        "transcript",
        upstream_artifacts={"source": source_path},
        generated_artifacts=transcript_outputs,
    )
    manifest.setdefault("status", {})["transcript"] = "ready"
    manifest["updated_at"] = datetime.now(UTC).isoformat()
    atomic_save_json(manifest_path, manifest)


def calculate_sync_total(manifest: dict) -> dict:
    """Calculate the overall sync completion status.

    Returns a dict with:
    - total_stages: total number of tracked stages
    - ready_stages: number of stages marked "ready"
    - pending_stages: number of stages marked "pending"
    - failed_stages: number of stages marked "failed"
    - completion_ratio: ready_stages / total_stages (0.0 to 1.0)
    - completion_percentage: completion_ratio * 100
    """
    status = manifest.get("status", {})
    statuses = list(status.values())

    if not statuses:
        return {
            "total_stages": 0,
            "ready_stages": 0,
            "pending_stages": 0,
            "failed_stages": 0,
            "completion_ratio": 0.0,
            "completion_percentage": 0,
        }

    total = len(statuses)
    ready = sum(1 for s in statuses if str(s).lower() == "ready")
    pending = sum(1 for s in statuses if str(s).lower() == "pending")
    failed = sum(1 for s in statuses if str(s).lower() == "failed")

    completion_ratio = ready / total if total > 0 else 0.0

    return {
        "total_stages": total,
        "ready_stages": ready,
        "pending_stages": pending,
        "failed_stages": failed,
        "completion_ratio": round(completion_ratio, 2),
        "completion_percentage": int(completion_ratio * 100),
    }


def require_board_review_ready(manifest: dict, *, context: str) -> None:
    """Require board review to be ready before syncing.

    Args:
        manifest: The manifest dict
        context: Error message context

    Raises SystemExit if board_review status is not "ready".
    """
    status = manifest.get("status", {})
    board_review_status = status.get("board_review")

    if board_review_status != "ready":
        raise SystemExit(
            f"{context} requires board review to be ready. "
            f"Current status: {board_review_status or 'not set'}. "
            f"Generate board review first using generate_board_review.py"
        )


def record_paperclip_sync(manifest: dict, issue_id: str, *, generated_at: str | None = None) -> None:
    """Record that board review has been synced to Paperclip.

    Records sync metadata without altering governance.board_approval — approval
    stays in the normalized pending|approved|rejected vocabulary.

    Args:
        manifest: The manifest dict to update
        issue_id: The Paperclip issue ID
        generated_at: ISO timestamp for sync time (defaults to now)
    """
    ts = generated_at or datetime.now(UTC).isoformat()
    governance = manifest.setdefault("governance", {})
    governance["paperclip_issue_id"] = issue_id
    governance["board_review_synced_at"] = ts
    manifest["updated_at"] = datetime.now(UTC).isoformat()


def record_board_approval(manifest: dict, approval_status: str, *, decided_at: str | None = None) -> None:
    """Record the board's approval decision for publishing.

    Args:
        manifest: The manifest dict to update
        approval_status: "approved" or "rejected"
        decided_at: ISO timestamp for decision time (defaults to now)

    Raises SystemExit if invalid approval status.
    """
    if approval_status not in ("approved", "rejected"):
        raise SystemExit(f"Invalid approval status: {approval_status}. Must be 'approved' or 'rejected'.")

    governance = manifest.setdefault("governance", {})
    governance["board_approval"] = approval_status
    governance["board_approval_decided_at"] = decided_at or datetime.now(UTC).isoformat()
    manifest["updated_at"] = datetime.now(UTC).isoformat()


def require_board_approval_for_publish(
    manifest: dict,
    *,
    context: str,
    require_paperclip_sync: bool = True,
    require_review_issue: bool = True,
) -> None:
    """Require board approval and completed Paperclip review sync before publishing.

    Args:
        manifest: The manifest dict
        context: Error message context
        require_paperclip_sync: If True, also require status.paperclip_sync == "ready"
        require_review_issue: If True, also require non-null paperclip_issue_id and
                              board_review_synced_at in governance

    Raises SystemExit if any publish gate condition is not satisfied.
    """
    governance = manifest.get("governance", {})
    approval_status = governance.get("board_approval")

    if approval_status != "approved":
        raise SystemExit(
            f"{context} requires board approval for publication. "
            f"Current approval status: {approval_status or 'not set'}. "
            f"Paperclip issue ID: {governance.get('paperclip_issue_id') or 'not linked'}"
        )

    if require_paperclip_sync:
        sync_status = manifest.get("status", {}).get("paperclip_sync")
        if sync_status != "ready":
            raise SystemExit(
                f"{context} requires Paperclip review sync to be complete. "
                f"Current paperclip_sync status: {sync_status or 'not set'}. "
                f"Run sync_batch_to_paperclip.mjs first."
            )

    if require_review_issue:
        issue_id = governance.get("paperclip_issue_id")
        synced_at = governance.get("board_review_synced_at")
        if not issue_id:
            raise SystemExit(
                f"{context} requires a linked Paperclip review issue. "
                f"governance.paperclip_issue_id is not set. "
                f"Run sync_batch_to_paperclip.mjs first."
            )
        if not synced_at:
            raise SystemExit(
                f"{context} requires a recorded board review sync timestamp. "
                f"governance.board_review_synced_at is not set. "
                f"Run sync_batch_to_paperclip.mjs first."
            )


def require_homepage_fields_complete(homepage_data: dict, *, context: str) -> None:
    """Require that homepage entry has all required fields for publication.

    Args:
        homepage_data: The homepage entry dict
        context: Error message context

    Raises SystemExit if any required field is missing or None.
    """
    required_fields = {
        "episode_id",
        "title",
        "episode_number",
        "public_url",
        "channel_url",
        "hook",
        "hero_summary",
        "featured_quote",
        "recent_summary",
        "created_at",
        "publish_date",
    }

    missing = [field for field in required_fields if not homepage_data.get(field)]
    if missing:
        raise SystemExit(
            f"{context}: homepage entry missing required fields for publication: {', '.join(missing)}"
        )


def record_publish_event(manifest: dict, *, publish_date: str | None = None) -> None:
    """Record a publish event in the manifest governance.

    Args:
        manifest: The manifest dict to update
        publish_date: ISO timestamp for publication (defaults to now)
    """
    governance = manifest.setdefault("governance", {})
    governance["published_at"] = publish_date or datetime.now(UTC).isoformat()
    governance["publication_complete"] = True
    manifest["updated_at"] = datetime.now(UTC).isoformat()


def mark_homepage_entry_published(manifest: dict, *, publish_date: str | None = None) -> None:
    """Mark a homepage entry as published by recording the publish date.

    Args:
        manifest: The manifest dict to update
        publish_date: ISO timestamp for publication (defaults to now)
    """
    publish_ts = publish_date or datetime.now(UTC).isoformat()
    manifest.setdefault("homepage", {})["publish_date"] = publish_ts
    record_publish_event(manifest, publish_date=publish_ts)
