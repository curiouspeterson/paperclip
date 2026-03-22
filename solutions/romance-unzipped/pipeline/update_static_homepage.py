#!/usr/bin/env python3
"""Update the static Romance Unzipped homepage data from a completed episode batch."""

from __future__ import annotations

import argparse
import json
import re
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import parse_qs, urlparse


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
    return parser.parse_args()


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict) -> None:
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temp_path.replace(path)


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
    metadata_path = Path(manifest["source"]["metadata_path"]).expanduser().resolve()
    metadata = load_json(metadata_path)
    social_target = manifest["targets"]["social_poster"]
    clip_target = manifest["targets"]["clip_extractor"]

    approval_packet = load_json(Path(social_target["approval_packet_json_path"]).expanduser().resolve())
    rendered = load_json(Path(clip_target["rendered_clips_json_path"]).expanduser().resolve())
    lead_asset = approval_packet.get("lead_asset") or {}
    rendered_clips = rendered.get("rendered_clips") or []

    public_url = public_url_override or metadata.get("source_public_url")
    if not public_url:
        return None

    title = normalize(metadata.get("title") or manifest.get("title") or manifest.get("episode_id"))
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

    created_at = manifest.get("created_at") or metadata.get("detected_at") or datetime.now(UTC).isoformat()
    return {
        "episode_id": manifest.get("episode_id", metadata.get("episode_id")),
        "title": title,
        "episode_number": episode_number_for(title),
        "public_url": public_url,
        "embed_url": embed_url_for(public_url),
        "channel_url": channel_url_override or metadata.get("source_channel_url") or "https://www.youtube.com/@RomanceUnzipped/videos",
        "hook": shorten(hook or title, 120),
        "hero_summary": shorten(spotlight or recent_summary or title, 220),
        "featured_quote": shorten(featured_quote or title, 180),
        "recent_summary": shorten(recent_summary or title, 150),
        "created_at": created_at,
        "updated_at": datetime.now(UTC).isoformat(),
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
    manifest_path = Path(args.manifest).expanduser().resolve()
    if not manifest_path.exists():
        raise SystemExit(f"Manifest not found: {manifest_path}")

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

    entries = [item for item in payload.get("entries", []) if item.get("episode_id") != entry["episode_id"]]
    entries.append(entry)
    entries = sort_entries(entries)

    payload["updated_at"] = datetime.now(UTC).isoformat()
    payload["entries"] = entries
    payload["featured"] = entries[0] if entries else None
    payload["recent"] = entries[:3]
    write_json(data_path, payload)

    print(f"homepage_data={data_path}")
    print(f"featured_episode={entry['title']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
