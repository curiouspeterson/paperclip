#!/usr/bin/env python3
"""Update the static Romance Unzipped homepage data from a completed episode batch."""

from __future__ import annotations

import argparse
import re
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from pipeline_common import load_json, resolve_path, require_ready_statuses, require_homepage_fields_complete, require_fresh_inputs_from_stages, finalize_stage_outputs, atomic_save_json


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, help="Path to the completed batch manifest JSON")
    parser.add_argument(
        "--site-dir",
        default=str(Path(__file__).resolve().parents[1] / "sites" / "romanceunzippedpodcast"),
        help="Static site directory containing homepage-data.json",
    )
    parser.add_argument("--public-url", help="Optional public episode URL override")
    parser.add_argument("--channel-url", help="Optional channel/archive URL override")
    parser.add_argument("--force", action="store_true", help="Skip upstream freshness checks")
    return parser.parse_args()


def normalize(text: object) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def shorten(text: object, limit: int) -> str:
    clean = normalize(text)
    if len(clean) <= limit:
        return clean
    return clean[: limit - 3].rstrip() + "..."


def extract_youtube_video_id(url: str) -> str | None:
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
    video_id = extract_youtube_video_id(public_url)
    if not video_id:
        return None
    return f"https://www.youtube.com/embed/{video_id}"


def episode_number_for(title: str) -> int:
    match = re.match(r"^\s*(\d+)\.", title)
    return int(match.group(1)) if match else 0


def build_entry(manifest_path: Path, public_url_override: str | None, channel_url_override: str | None) -> dict | None:
    manifest = load_json(manifest_path)
    social_target = manifest["targets"]["social_poster"]
    clip_target = manifest["targets"]["clip_extractor"]

    approval_packet = load_json(Path(social_target["approval_packet_json_path"]).expanduser().resolve())
    rendered = load_json(Path(clip_target["rendered_clips_json_path"]).expanduser().resolve())
    lead_asset = approval_packet.get("lead_asset") or {}
    rendered_clips = rendered.get("rendered_clips") or []

    source = manifest.get("source", {})
    homepage = manifest.get("homepage", {})
    public_url = public_url_override or homepage.get("public_url") or source.get("public_url")
    if not public_url:
        return None

    title = normalize(manifest.get("title") or manifest.get("episode_id"))
    hook = normalize(
        lead_asset.get("hook")
        or approval_packet.get("instagram", {}).get("hook")
        or approval_packet.get("episode_angle")
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
    publish_date = homepage.get("publish_date") or manifest.get("published_at")
    return {
        "episode_id": manifest.get("episode_id"),
        "title": title,
        "episode_number": episode_number_for(title),
        "public_url": public_url,
        "embed_url": embed_url_for(public_url),
        "channel_url": channel_url_override or homepage.get("channel_url") or source.get("channel_url") or "https://www.youtube.com/@RomanceUnzipped/videos",
        "hook": shorten(hook or title, 120),
        "hero_summary": shorten(spotlight or recent_summary or title, 220),
        "featured_quote": shorten(featured_quote or title, 180),
        "recent_summary": shorten(recent_summary or title, 150),
        "created_at": created_at,
        "updated_at": datetime.now(UTC).isoformat(),
        "publish_date": publish_date,
    }


def sort_entries(entries: list[dict]) -> list[dict]:
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
    require_ready_statuses(manifest, ("approval_packet", "rendered_clips"), context="Homepage update")

    # Validate upstream freshness before reading artifacts
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
        context="Homepage update",
        force=args.force,
    )

    homepage = manifest.get("homepage", {})
    publish_date = homepage.get("publish_date") or manifest.get("published_at")
    if not publish_date:
        raise SystemExit(
            "Homepage update requires a non-empty homepage.publish_date in the manifest. "
            "Re-initialize the manifest with --publish-date or set RU_PUBLISH_DATE."
        )

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
    entry = build_entry(manifest_path, args.public_url, args.channel_url)
    if entry is None:
        print("skipped=no-public-url")
        return 0
    require_homepage_fields_complete(entry, context="Homepage update")

    entries = [item for item in payload.get("entries", []) if item.get("episode_id") != entry["episode_id"]]
    entries.append(entry)
    entries = sort_entries(entries)

    updated_at = datetime.now(UTC).isoformat()
    payload["updated_at"] = updated_at
    payload["entries"] = entries
    payload["featured"] = entries[0] if entries else None
    payload["recent"] = entries[:3]
    atomic_save_json(data_path, payload)

    # Finalize homepage_update stage
    finalize_stage_outputs(
        manifest_path,
        manifest,
        status_updates={"homepage_update": "ready"},
        provenance_updates={
            "homepage_update": (
                {
                    "approval_packet": approval_packet_json_path,
                    "rendered_clips": rendered_clips_json_path,
                },
                {"homepage_data": data_path},
            ),
        },
        generated_at=updated_at,
    )

    print(f"homepage_data={data_path}")
    print(f"featured_episode={entry['title']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
