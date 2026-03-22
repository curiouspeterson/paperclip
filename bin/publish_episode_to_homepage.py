#!/usr/bin/env python3
"""Publish an episode to the homepage after board approval.

This stage marks the episode as published on the homepage, setting the publish date
and recording the publication event in governance. Requires board approval to proceed.
"""

from __future__ import annotations

import argparse
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from pipeline_common import (
    load_json,
    atomic_save_json,
    resolve_path,
    require_board_approval_for_publish,
    require_homepage_fields_complete,
    require_ready_statuses,
    require_fresh_inputs_from_stages,
    mark_homepage_entry_published,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, help="Path to manifest JSON")
    parser.add_argument(
        "--site-dir",
        default=str(Path(__file__).resolve().parents[1] / "sites" / "romanceunzippedpodcast"),
        help="Static site directory containing homepage-data.json",
    )
    parser.add_argument("--publish-date", help="Optional ISO timestamp for publication (defaults to now)")
    return parser.parse_args()


def extract_youtube_video_id(url: str) -> str | None:
    """Extract YouTube video ID from various YouTube URL formats."""
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    if "youtu.be" in host:
        video_id = parsed.path.strip("/").split("/")[0]
        return video_id or None
    if "youtube.com" in host:
        if parsed.path == "/watch":
            return parse_qs(parsed.query).get("v", [None])[0]
        if parsed.path.startswith("/embed/"):
            video_id = parsed.path.split("/embed/", 1)[1].split("/", 1)[0]
            return video_id or None
    return None


def embed_url_for(public_url: str) -> str | None:
    """Generate embed URL from public URL."""
    video_id = extract_youtube_video_id(public_url)
    if not video_id:
        return None
    return f"https://www.youtube.com/embed/{video_id}"


def build_homepage_entry(manifest: dict) -> dict:
    """Build a homepage entry dict from manifest data."""
    social_target = manifest["targets"]["social_poster"]
    clip_target = manifest["targets"]["clip_extractor"]
    homepage_data = manifest.get("homepage", {})

    approval_packet = load_json(Path(social_target["approval_packet_json_path"]).expanduser().resolve())
    rendered = load_json(Path(clip_target["rendered_clips_json_path"]).expanduser().resolve())
    lead_asset = approval_packet.get("lead_asset") or {}
    rendered_clips = rendered.get("rendered_clips") or []

    source_data = manifest.get("source", {})
    public_url = homepage_data.get("public_url") or source_data.get("public_url") or ""

    # Helper to normalize text
    def normalize(text: object) -> str:
        import re

        return re.sub(r"\s+", " ", str(text or "")).strip()

    # Helper to shorten text
    def shorten(text: object, limit: int) -> str:
        clean = normalize(text)
        if len(clean) <= limit:
            return clean
        return clean[: limit - 3].rstrip() + "..."

    # Helper to extract episode number
    def episode_number_for(title: str) -> int:
        import re

        match = re.match(r"^\s*(\d+)\.", title)
        return int(match.group(1)) if match else 0

    title = normalize(manifest.get("title", manifest.get("episode_id")))
    hook = normalize(
        lead_asset.get("hook") or approval_packet.get("instagram", {}).get("hook") or approval_packet.get("episode_angle")
    )
    spotlight = normalize(
        approval_packet.get("episode_angle")
        or approval_packet.get("newsletter", {}).get("episode_spotlight")
        or hook
    )
    featured_quote = normalize(
        lead_asset.get("hook")
        or approval_packet.get("instagram", {}).get("hook")
        or (rendered_clips[0].get("excerpt") if rendered_clips else "")
    )
    recent_summary = normalize(approval_packet.get("episode_angle") or spotlight or hook or title)

    created_at = manifest.get("created_at") or datetime.now(UTC).isoformat()
    publish_date = manifest.get("homepage", {}).get("publish_date")

    return {
        "episode_id": manifest.get("episode_id"),
        "title": title,
        "episode_number": episode_number_for(title),
        "public_url": public_url,
        "embed_url": embed_url_for(public_url),
        "channel_url": homepage_data.get("channel_url")
        or source_data.get("channel_url")
        or "https://www.youtube.com/@RomanceUnzipped/videos",
        "hook": shorten(hook or title, 120),
        "hero_summary": shorten(spotlight or recent_summary or title, 220),
        "featured_quote": shorten(featured_quote or title, 180),
        "recent_summary": shorten(recent_summary or title, 150),
        "created_at": created_at,
        "updated_at": datetime.now(UTC).isoformat(),
        "publish_date": publish_date,
    }


def sort_entries(entries: list[dict]) -> list[dict]:
    """Sort homepage entries by episode number and date."""
    import re

    def normalize(text: object) -> str:
        return re.sub(r"\s+", " ", str(text or "")).strip()

    return sorted(
        entries,
        key=lambda item: (
            int(item.get("episode_number") or 0),
            normalize(item.get("created_at")),
            normalize(item.get("updated_at")),
        ),
        reverse=True,
    )


def main() -> int:
    args = parse_args()
    manifest_path = resolve_path(args.manifest)

    if not manifest_path.exists():
        raise SystemExit(f"Manifest not found: {manifest_path}")

    manifest = load_json(manifest_path)
    episode_id = manifest.get("episode_id", "unknown-episode")

    # Require homepage_update and paperclip_sync to be ready
    require_ready_statuses(
        manifest,
        ("homepage_update", "paperclip_sync"),
        context="Publish to homepage",
    )

    # Require board approval with full governance gate
    require_board_approval_for_publish(
        manifest,
        context="Publish to homepage",
        require_paperclip_sync=True,
        require_review_issue=True,
    )

    # Validate upstream freshness before building homepage entry
    social_target = manifest["targets"]["social_poster"]
    clip_target = manifest["targets"]["clip_extractor"]
    approval_packet_json_path = Path(
        social_target.get("approval_packet_json_path") or Path(social_target["approval_packet_path"]).with_suffix(".json")
    ).expanduser().resolve()
    rendered_clips_json_path = Path(clip_target["rendered_clips_json_path"]).expanduser().resolve()
    require_fresh_inputs_from_stages(
        manifest,
        stages={
            "approval_packet": {"approval packet json": approval_packet_json_path},
            "rendered_clips": {"rendered_json": rendered_clips_json_path},
        },
        context="Publish to homepage",
        force=False,
    )

    # Build the homepage entry
    entry = build_homepage_entry(manifest)

    # Require all homepage fields are complete
    require_homepage_fields_complete(entry, context="Publish to homepage")

    # Update static homepage data
    site_dir = Path(args.site_dir).expanduser().resolve()
    site_dir.mkdir(parents=True, exist_ok=True)
    data_path = site_dir / "homepage-data.json"

    payload = (
        load_json(data_path)
        if data_path.exists()
        else {
            "updated_at": None,
            "featured": None,
            "recent": [],
            "entries": [],
        }
    )

    # Remove old entry if it exists, add the new one
    entries = [item for item in payload.get("entries", []) if item.get("episode_id") != episode_id]
    entries.append(entry)
    entries = sort_entries(entries)

    publish_date = args.publish_date or datetime.now(UTC).isoformat()

    # Update payload
    payload["updated_at"] = publish_date
    payload["entries"] = entries
    payload["featured"] = entries[0] if entries else None
    payload["recent"] = entries[:3]
    atomic_save_json(data_path, payload)

    # Mark episode as published in manifest
    mark_homepage_entry_published(manifest, publish_date=publish_date)
    manifest["updated_at"] = publish_date
    atomic_save_json(manifest_path, manifest)

    print(f"published_to_homepage={episode_id}")
    print(f"publish_date={publish_date}")
    print(f"homepage_data={data_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
