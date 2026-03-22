#!/usr/bin/env python3
"""Generate social draft files from the episode batch manifest."""

from __future__ import annotations

import argparse
from datetime import UTC, datetime
from pathlib import Path

from pipeline_common import (
    load_json,
    require_existing_paths,
    require_ready_statuses,
    save_json,
    write_text,
)

REQUIRED_STATUSES = (
    "approval_packet",
    "clip_candidates",
    "rendered_clips",
    "quote_cards",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, help="Path to handoff manifest json")
    parser.add_argument("--force", action="store_true", help="Overwrite existing social draft files")
    return parser.parse_args()


def ensure_outputs_writable(paths: list[Path], *, force: bool, context: str) -> None:
    if force:
        return
    existing = [str(path) for path in paths if path.exists()]
    if existing:
        raise SystemExit(f"{context} outputs already exist; re-run with --force to overwrite: {', '.join(existing)}")


def main() -> int:
    args = parse_args()
    manifest_path = Path(args.manifest).expanduser().resolve()
    if not manifest_path.exists():
        raise SystemExit(f"Manifest file not found: {manifest_path}")

    manifest = load_json(manifest_path)
    require_ready_statuses(manifest, REQUIRED_STATUSES, context="Social drafts")
    status = manifest.setdefault("status", {})

    social_target = manifest["targets"]["social_poster"]
    transcript_path = Path(manifest["source"]["transcript_path"]).expanduser().resolve()
    clip_candidates_json_path = Path(manifest["targets"]["clip_extractor"]["clip_candidates_json_path"]).expanduser().resolve()
    rendered_clips_json_path = Path(manifest["targets"]["clip_extractor"]["rendered_clips_json_path"]).expanduser().resolve()
    quote_cards_json_path = Path(manifest["targets"]["clip_extractor"]["quote_cards_json_path"]).expanduser().resolve()
    approval_packet_json_path = Path(
        social_target.get("approval_packet_json_path") or Path(social_target["approval_packet_path"]).with_suffix(".json")
    ).expanduser().resolve()

    require_existing_paths(
        {
            "transcript": transcript_path,
            "clip candidates": clip_candidates_json_path,
            "rendered clips": rendered_clips_json_path,
            "quote cards": quote_cards_json_path,
            "approval packet json": approval_packet_json_path,
        },
        context="Social drafts",
    )

    social_dir = Path(social_target["social_dir"]).expanduser().resolve()
    instagram_path = social_dir / "instagram-reel.md"
    facebook_path = social_dir / "facebook-post.md"
    tiktok_path = social_dir / "tiktok-post.md"
    ensure_outputs_writable([instagram_path, facebook_path, tiktok_path], force=args.force, context="Social drafts")

    transcript = transcript_path.read_text(encoding="utf-8", errors="replace").strip()
    clips = load_json(clip_candidates_json_path).get("clip_candidates") or []
    rendered_clips = load_json(rendered_clips_json_path).get("rendered_clips") or []
    quote_cards = load_json(quote_cards_json_path).get("quote_cards") or []
    packet = load_json(approval_packet_json_path)
    if not clips:
        raise SystemExit("Clip candidates are required for social drafts")
    if not rendered_clips:
        raise SystemExit("Rendered clips are required for social drafts")
    if not quote_cards:
        raise SystemExit("Quote-card specs are required for social drafts")

    episode_id = manifest.get("episode_id", "unknown-episode")
    title = manifest.get("title", episode_id)
    lead_asset = packet.get("lead_asset") if isinstance(packet.get("lead_asset"), dict) else {}
    lead_slot = str(lead_asset.get("slot") or clips[0].get("slot") or "clip-01")
    lead_quote_id = str(lead_asset.get("quote_id") or quote_cards[0].get("id") or "quote-card-01")
    lead_clip = next((clip for clip in clips if str(clip.get("slot") or "") == lead_slot), clips[0])
    lead_render = next((clip for clip in rendered_clips if str(clip.get("slot") or "") == lead_slot), rendered_clips[0])
    lead_quote = next((quote for quote in quote_cards if str(quote.get("id") or "") == lead_quote_id), quote_cards[0])
    generated_at = datetime.now(UTC).isoformat()
    transcript_excerpt = " ".join(transcript.split())
    transcript_excerpt = transcript_excerpt[:217].rstrip() + "..." if len(transcript_excerpt) > 220 else transcript_excerpt

    instagram = packet["instagram"]
    facebook = packet["facebook"]
    tiktok = packet["tiktok"]
    generation = packet.get("generation") or {}

    instagram_body = f"""# Instagram Reel Draft

Episode ID: `{episode_id}`
Title: {title}
Generated At: {generated_at}
Generation Mode: `{generation.get('mode') or 'unknown'}`

## Hook

{instagram['hook']}

## Caption

{instagram['caption']}

## CTA

{instagram['cta']}

## Hashtags

{" ".join(instagram['hashtags'])}

## Asset References

- Clip candidate: `{lead_clip['slot']}`
- Preview media: `{lead_render['preview_path']}`
- Audio clip: `{lead_render['audio_path']}`
- Subtitle sidecar: `{lead_render['subtitles_path']}`
- Quote card: `{lead_quote['id']}`
"""

    facebook_body = f"""# Facebook Post Draft

Episode ID: `{episode_id}`
Title: {title}
Generated At: {generated_at}
Generation Mode: `{generation.get('mode') or 'unknown'}`

## Copy

{facebook['copy']}

## CTA

{facebook['cta']}

## Supporting Context

{transcript_excerpt}

## Asset References

- Quote card: `{lead_quote['id']}`
- Supporting clip preview: `{lead_render['preview_path']}`
"""

    tiktok_body = f"""# TikTok Draft

Episode ID: `{episode_id}`
Title: {title}
Generated At: {generated_at}
Generation Mode: `{generation.get('mode') or 'unknown'}`

## On-screen Hook

{tiktok['hook']}

## Caption

{tiktok['caption']}

## CTA

{tiktok['cta']}

## Hashtags

{" ".join(tiktok['hashtags'])}

## Asset References

- Clip candidate: `{lead_clip['slot']}`
- Preview media: `{lead_render['preview_path']}`
- Subtitle sidecar: `{lead_render['subtitles_path']}`
"""

    write_text(instagram_path, instagram_body, overwrite=True)
    write_text(facebook_path, facebook_body, overwrite=True)
    write_text(tiktok_path, tiktok_body, overwrite=True)

    social_target["instagram_reel_path"] = str(instagram_path)
    social_target["facebook_post_path"] = str(facebook_path)
    social_target["tiktok_post_path"] = str(tiktok_path)
    status["social_drafts"] = "ready"
    manifest["updated_at"] = generated_at
    save_json(manifest_path, manifest)

    print(str(instagram_path))
    print(str(facebook_path))
    print(str(tiktok_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
