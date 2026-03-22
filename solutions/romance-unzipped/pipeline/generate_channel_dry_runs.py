#!/usr/bin/env python3
"""Generate channel-specific dry-run runbooks that stop before live publish/send."""

from __future__ import annotations

import argparse
from datetime import UTC, datetime
from pathlib import Path

from pipeline_common import (
    load_json,
    write_text,
    require_existing_paths,
    require_ready_statuses,
    save_json,
)


REQUIRED_STATUSES = (
    "board_review",
    "social_drafts",
    "newsletter_draft",
    "quote_cards",
    "rendered_clips",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, help="Path to handoff manifest json")
    parser.add_argument("--force", action="store_true", help="Overwrite existing dry-run files")
    return parser.parse_args()


def select_clip(rendered_clips: list[dict], slot: str | None) -> dict | None:
    if not rendered_clips:
        return None
    if slot:
        match = next((clip for clip in rendered_clips if str(clip.get("slot") or "") == slot), None)
        if match:
            return match
    return rendered_clips[0]


def select_quote(quote_cards: list[dict], quote_id: str | None) -> dict | None:
    if not quote_cards:
        return None
    if quote_id:
        match = next((card for card in quote_cards if str(card.get("id") or "") == quote_id), None)
        if match:
            return match
    return quote_cards[0]

def main() -> int:
    args = parse_args()
    manifest_path = Path(args.manifest).expanduser().resolve()
    if not manifest_path.exists():
        raise SystemExit(f"Manifest file not found: {manifest_path}")

    manifest = load_json(manifest_path)
    require_ready_statuses(manifest, REQUIRED_STATUSES, context="Channel dry runs")
    status = manifest.setdefault("status", {})

    episode_id = manifest.get("episode_id", "unknown-episode")
    title = manifest.get("title", episode_id)
    generated_at = datetime.now(UTC).isoformat()

    social_target = manifest["targets"]["social_poster"]
    newsletter_target = manifest["targets"]["newsletter_agent"]
    clip_target = manifest["targets"]["clip_extractor"]

    instagram_path = Path(social_target["instagram_dry_run_path"]).expanduser().resolve()
    instagram_json_path = Path(social_target["instagram_dry_run_json_path"]).expanduser().resolve()
    mailchimp_path = Path(newsletter_target["mailchimp_dry_run_path"]).expanduser().resolve()
    mailchimp_json_path = Path(newsletter_target["mailchimp_dry_run_json_path"]).expanduser().resolve()
    require_existing_paths(
        {
            "board review": Path(social_target["board_review_path"]).expanduser().resolve(),
            "approval packet": Path(social_target["approval_packet_path"]).expanduser().resolve(),
            "instagram draft": Path(social_target["instagram_reel_path"]).expanduser().resolve(),
            "approval packet json": Path(social_target["approval_packet_json_path"]).expanduser().resolve(),
            "rendered clips": Path(clip_target["rendered_clips_path"]).expanduser().resolve(),
            "rendered clips json": Path(clip_target["rendered_clips_json_path"]).expanduser().resolve(),
            "quote-card specs": Path(clip_target["quote_cards_path"]).expanduser().resolve(),
            "quote-card json": Path(clip_target["quote_cards_json_path"]).expanduser().resolve(),
            "newsletter draft": Path(newsletter_target["draft_path"]).expanduser().resolve(),
            "newsletter draft json": Path(newsletter_target["draft_json_path"]).expanduser().resolve(),
        },
        context="Channel dry runs",
    )

    approval_packet = load_json(Path(social_target["approval_packet_json_path"]).expanduser().resolve())
    rendered_clips = load_json(Path(clip_target["rendered_clips_json_path"]).expanduser().resolve()).get("rendered_clips") or []
    quote_cards = load_json(Path(clip_target["quote_cards_json_path"]).expanduser().resolve()).get("quote_cards") or []
    newsletter_packet = load_json(Path(newsletter_target["draft_json_path"]).expanduser().resolve())
    lead_asset = approval_packet.get("lead_asset") if isinstance(approval_packet.get("lead_asset"), dict) else {}
    instagram_copy = approval_packet.get("instagram") if isinstance(approval_packet.get("instagram"), dict) else {}
    newsletter_copy = newsletter_packet.get("newsletter") if isinstance(newsletter_packet.get("newsletter"), dict) else {}
    lead_render = select_clip(rendered_clips, str(lead_asset.get("slot") or ""))
    lead_quote = select_quote(quote_cards, str(lead_asset.get("quote_id") or ""))

    if not lead_render:
        raise SystemExit("Channel dry runs require at least one rendered clip entry")
    if not lead_quote:
        raise SystemExit("Channel dry runs require at least one quote-card entry")

    instagram_payload = {
        "channel": "instagram",
        "episode_id": episode_id,
        "title": title,
        "generated_at": generated_at,
        "approval_gate": {
            "required": True,
            "authority": "CEO",
            "evidence": social_target["board_review_path"],
        },
        "inputs": {
            "board_review_path": social_target["board_review_path"],
            "approval_packet_path": social_target["approval_packet_path"],
            "approval_packet_json_path": social_target["approval_packet_json_path"],
            "draft_path": social_target["instagram_reel_path"],
            "rendered_clips_path": clip_target["rendered_clips_path"],
            "quote_card_path": clip_target["quote_cards_path"],
        },
        "selected_assets": {
            "slot": lead_asset.get("slot") or lead_render.get("slot"),
            "preview_path": lead_render.get("preview_path"),
            "audio_path": lead_render.get("audio_path"),
            "subtitles_path": lead_render.get("subtitles_path"),
            "quote_card_id": lead_quote.get("id"),
            "quote_card_path": lead_quote.get("asset_stub_path"),
        },
        "copy": {
            "hook": instagram_copy.get("hook"),
            "caption": instagram_copy.get("caption"),
            "cta": instagram_copy.get("cta"),
            "hashtags": instagram_copy.get("hashtags") or [],
        },
        "steps": [
            "Confirm CEO approval is recorded on the relevant Paperclip issue before opening Instagram.",
            "Open the Instagram 'Create new post' or Reel flow and load the selected preview asset.",
            "Use the provided hook, caption, CTA, and hashtags from this dry-run packet instead of re-copying manually from multiple files.",
            "Optionally attach the quote card if the creative needs a static companion tile in the carousel review path.",
            "Stop on the final confirmation screen. Do not press Share.",
        ],
        "stop_before": "share_button",
    }

    mailchimp_payload = {
        "channel": "mailchimp",
        "episode_id": episode_id,
        "title": title,
        "generated_at": generated_at,
        "approval_gate": {
            "required": True,
            "authority": "CEO",
            "evidence": social_target["board_review_path"],
        },
        "inputs": {
            "board_review_path": social_target["board_review_path"],
            "newsletter_draft_path": newsletter_target["draft_path"],
            "newsletter_draft_json_path": newsletter_target["draft_json_path"],
        },
        "copy": {
            "subject": newsletter_copy.get("subject"),
            "preview": newsletter_copy.get("preview"),
            "episode_spotlight": newsletter_copy.get("episode_spotlight"),
            "recommendation_stub": newsletter_copy.get("recommendation_stub"),
            "community_question": newsletter_copy.get("community_question"),
        },
        "steps": [
            "Confirm CEO approval is recorded on the relevant Paperclip issue before opening Mailchimp.",
            "Create a draft campaign only; do not send to a live audience.",
            "Use the structured copy in this dry-run packet as the source for subject, preview text, and body copy.",
            "Address any test send only to an internal mailbox or Mailchimp preview target if available.",
            "Stop on the final review or send-confirmation screen. Do not click Send.",
        ],
        "stop_before": "send_button",
    }

    instagram_body = f"""# Instagram Dry Run

Episode ID: `{episode_id}`
Title: {title}
Generated At: {generated_at}

## Inputs

- Board review: `{instagram_payload['inputs']['board_review_path']}`
- Approval packet: `{instagram_payload['inputs']['approval_packet_path']}`
- Approval packet JSON: `{instagram_payload['inputs']['approval_packet_json_path']}`
- Instagram draft: `{instagram_payload['inputs']['draft_path']}`
- Rendered clips: `{instagram_payload['inputs']['rendered_clips_path']}`
- Quote-card specs: `{instagram_payload['inputs']['quote_card_path']}`

## Selected Creative

- Reel preview: `{instagram_payload['selected_assets']['preview_path']}`
- Audio clip: `{instagram_payload['selected_assets']['audio_path']}`
- Subtitle sidecar: `{instagram_payload['selected_assets']['subtitles_path']}`
- Quote card: `{instagram_payload['selected_assets']['quote_card_path']}`

## Copy Payload

- Hook: {instagram_payload['copy']['hook']}
- CTA: {instagram_payload['copy']['cta']}
- Hashtags: {' '.join(instagram_payload['copy']['hashtags'])}

### Caption

{instagram_payload['copy']['caption']}

## Operator Steps

1. Confirm CEO approval is recorded on the relevant Paperclip issue before opening Instagram.
2. Open the Instagram create flow and load the selected rendered preview asset.
3. Paste the hook/caption/hashtags from this packet.
4. Validate the selected asset and quote-card against the board review bundle.
5. Stop on the final confirmation screen. Do not press Share.

## Stop Condition

- Final confirmation reached
- No publish action taken
"""

    mailchimp_body = f"""# Mailchimp Dry Run

Episode ID: `{episode_id}`
Title: {title}
Generated At: {generated_at}

## Inputs

- Board review: `{mailchimp_payload['inputs']['board_review_path']}`
- Newsletter draft: `{mailchimp_payload['inputs']['newsletter_draft_path']}`
- Newsletter JSON: `{mailchimp_payload['inputs']['newsletter_draft_json_path']}`

## Copy Payload

- Subject: {mailchimp_payload['copy']['subject']}
- Preview text: {mailchimp_payload['copy']['preview']}

### Episode Spotlight

{mailchimp_payload['copy']['episode_spotlight']}

### Recommendation Stub

{mailchimp_payload['copy']['recommendation_stub']}

### Community Question

{mailchimp_payload['copy']['community_question']}

## Operator Steps

1. Confirm CEO approval is recorded on the relevant Paperclip issue before opening Mailchimp.
2. Create a draft campaign only.
3. Populate subject, preview text, and body from this packet.
4. If a test-send step is available, target only an internal mailbox or preview flow.
5. Stop on the final review or send-confirmation screen. Do not click Send.

## Stop Condition

- Final send-review screen reached
- No live audience send performed
"""

    write_text(instagram_path, instagram_body, overwrite=args.force)
    write_text(mailchimp_path, mailchimp_body, overwrite=args.force)
    save_json(instagram_json_path, instagram_payload)
    save_json(mailchimp_json_path, mailchimp_payload)

    social_target["instagram_dry_run_path"] = str(instagram_path)
    social_target["instagram_dry_run_json_path"] = str(instagram_json_path)
    newsletter_target["mailchimp_dry_run_path"] = str(mailchimp_path)
    newsletter_target["mailchimp_dry_run_json_path"] = str(mailchimp_json_path)
    status["instagram_dry_run"] = "ready"
    status["mailchimp_dry_run"] = "ready"
    manifest["updated_at"] = generated_at
    save_json(manifest_path, manifest)

    print(str(instagram_path))
    print(str(instagram_json_path))
    print(str(mailchimp_path))
    print(str(mailchimp_json_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
