#!/usr/bin/env python3
"""Generate a board-ready review summary from the episode batch manifest."""

from __future__ import annotations

import argparse
from datetime import UTC, datetime
from pathlib import Path

from pipeline_common import (
    load_json,
    write_text,
    require_existing_paths,
    require_ready_statuses,
    record_artifact_provenance,
    validate_artifact_freshness,
    save_json,
)


REQUIRED_STATUSES = (
    "approval_packet",
    "newsletter_draft",
    "clip_candidates",
    "rendered_clips",
    "quote_candidates",
    "quote_cards",
    "social_drafts",
    "riverside_runbook",
    "fable_runbook",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, help="Path to handoff manifest json")
    parser.add_argument("--force", action="store_true", help="Overwrite existing board-review files")
    return parser.parse_args()

def main() -> int:
    args = parse_args()
    manifest_path = Path(args.manifest).expanduser().resolve()
    if not manifest_path.exists():
        raise SystemExit(f"Manifest file not found: {manifest_path}")

    manifest = load_json(manifest_path)
    require_ready_statuses(manifest, REQUIRED_STATUSES, context="Board review")
    status = manifest.setdefault("status", {})

    episode_id = manifest.get("episode_id", "unknown-episode")
    title = manifest.get("title", episode_id)
    generated_at = datetime.now(UTC).isoformat()

    social_target = manifest["targets"]["social_poster"]
    clip_target = manifest["targets"]["clip_extractor"]
    newsletter_target = manifest["targets"]["newsletter_agent"]
    operations_target = manifest["targets"]["operations"]
    quote_cards_json_path = Path(clip_target["quote_cards_json_path"]).expanduser().resolve()

    board_review_path = Path(social_target["board_review_path"]).expanduser().resolve()
    board_review_json_path = Path(social_target["board_review_json_path"]).expanduser().resolve()
    artifact_paths = {
        "approval packet": Path(social_target["approval_packet_path"]).expanduser().resolve(),
        "instagram draft": Path(social_target["instagram_reel_path"]).expanduser().resolve(),
        "facebook draft": Path(social_target["facebook_post_path"]).expanduser().resolve(),
        "tiktok draft": Path(social_target["tiktok_post_path"]).expanduser().resolve(),
        "newsletter draft": Path(newsletter_target["draft_path"]).expanduser().resolve(),
        "riverside runbook": Path(operations_target["riverside_runbook_path"]).expanduser().resolve(),
        "fable runbook": Path(operations_target["fable_runbook_path"]).expanduser().resolve(),
        "clip candidates": Path(clip_target["clip_candidates_path"]).expanduser().resolve(),
        "rendered clips": Path(clip_target["rendered_clips_path"]).expanduser().resolve(),
        "quote candidates": Path(clip_target["quote_candidates_path"]).expanduser().resolve(),
        "quote-card specs": Path(clip_target["quote_cards_path"]).expanduser().resolve(),
    }
    require_existing_paths(artifact_paths, context="Board review")
    quote_cards_payload = load_json(quote_cards_json_path)
    quote_card_assets = {
        f"quote card asset {card.get('id') or index}": Path(str(card.get("asset_path") or card.get("asset_stub_path") or "")).expanduser().resolve()
        for index, card in enumerate(quote_cards_payload.get("quote_cards") or [], start=1)
        if str(card.get("asset_path") or card.get("asset_stub_path") or "").strip()
    }
    require_existing_paths(quote_card_assets, context="Board review")

    # Validate artifact freshness
    if not args.force and not validate_artifact_freshness(manifest, "board_review_inputs", artifact_paths):
        raise SystemExit(
            "Board review artifacts are stale (upstream inputs changed). "
            "Upstream artifacts may have been regenerated. Re-run dependent scripts."
        )

    payload = {
        "episode_id": episode_id,
        "title": title,
        "generated_at": generated_at,
        "review_items": [
            {
                "label": "Approval packet",
                "path": str(artifact_paths["approval packet"]),
                "status": "ready",
            },
            {
                "label": "Instagram draft",
                "path": str(artifact_paths["instagram draft"]),
                "status": "ready",
            },
            {
                "label": "Facebook draft",
                "path": str(artifact_paths["facebook draft"]),
                "status": "ready",
            },
            {
                "label": "TikTok draft",
                "path": str(artifact_paths["tiktok draft"]),
                "status": "ready",
            },
            {
                "label": "Newsletter draft",
                "path": str(artifact_paths["newsletter draft"]),
                "status": "ready",
            },
            {
                "label": "Riverside runbook",
                "path": str(artifact_paths["riverside runbook"]),
                "status": "ready",
            },
            {
                "label": "Fable runbook",
                "path": str(artifact_paths["fable runbook"]),
                "status": "ready",
            },
            {
                "label": "Clip candidates",
                "path": str(artifact_paths["clip candidates"]),
                "status": "ready",
            },
            {
                "label": "Rendered clips",
                "path": str(artifact_paths["rendered clips"]),
                "status": "ready",
            },
            {
                "label": "Quote candidates",
                "path": str(artifact_paths["quote candidates"]),
                "status": "ready",
            },
            {
                "label": "Quote-card specs",
                "path": str(artifact_paths["quote-card specs"]),
                "status": "ready",
            },
        ],
        "approval_prompt": {
            "decision": "Approve or reject this batch for external publishing preparation",
            "gates": [
                "voice matches Romance Unzipped",
                "no publish without explicit approval",
                "asset references are complete",
                "platform destinations are correct",
                "connector follow-ups stop before any external mutation",
            ],
        },
    }

    lines = [
        "# Board Review Bundle",
        "",
        f"Episode ID: `{episode_id}`",
        f"Title: {title}",
        f"Generated At: {generated_at}",
        "",
        "## Review Items",
        "",
    ]
    for item in payload["review_items"]:
        lines.extend(
            [
                f"- {item['label']}: `{item['path']}`",
            ]
        )

    lines.extend(
        [
            "",
            "## Decision Prompt",
            "",
            payload["approval_prompt"]["decision"],
            "",
            "## Approval Gates",
            "",
        ]
    )
    for gate in payload["approval_prompt"]["gates"]:
        lines.append(f"- [ ] {gate}")

    write_text(board_review_path, "\n".join(lines) + "\n", overwrite=args.force)
    save_json(board_review_json_path, payload)

    # Record provenance of upstream artifacts for freshness validation
    record_artifact_provenance(manifest, "board_review_inputs", artifact_paths)

    social_target["board_review_path"] = str(board_review_path)
    social_target["board_review_json_path"] = str(board_review_json_path)
    status["board_review"] = "ready"
    manifest["updated_at"] = generated_at
    save_json(manifest_path, manifest)

    print(str(board_review_path))
    print(str(board_review_json_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
