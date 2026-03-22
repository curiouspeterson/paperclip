#!/usr/bin/env python3
"""Resolve the latest YouTube upload for a channel.

Uses the YouTube Data API when YOUTUBE_API_KEY and a channel id are available,
and falls back to yt-dlp playlist scraping otherwise.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen


DEFAULT_CHANNEL_URL = "https://www.youtube.com/@RomanceUnzipped/videos"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--channel-url",
        default=os.environ.get("RU_YOUTUBE_CHANNEL_URL", DEFAULT_CHANNEL_URL),
        help="YouTube channel/videos URL used to resolve the latest upload",
    )
    parser.add_argument(
        "--playlist-index",
        type=int,
        default=int(os.environ.get("RU_YOUTUBE_PLAYLIST_INDEX", "1")),
        help="1-based index into the flat playlist/videos feed (1 = latest, 2 = second latest)",
    )
    parser.add_argument(
        "--channel-id",
        default=os.environ.get("RU_YOUTUBE_CHANNEL_ID") or os.environ.get("YOUTUBE_CHANNEL_ID") or "",
        help="Optional YouTube channel id (UC...) used for API-assisted lookup",
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("YOUTUBE_API_KEY", ""),
        help="Optional YouTube Data API key",
    )
    return parser.parse_args()


def shutil_which(binary: str) -> str | None:
    for entry in os.environ.get("PATH", "").split(os.pathsep):
        candidate = Path(entry) / binary
        if candidate.exists() and os.access(candidate, os.X_OK):
            return str(candidate)
    return None


def channel_id_from_url(channel_url: str) -> str:
    parsed = urlparse(channel_url)
    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) >= 2 and parts[0] == "channel" and parts[1]:
        return parts[1]
    return ""


def channel_id_from_page(channel_url: str) -> str:
    request = Request(channel_url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(request, timeout=30) as response:
        html = response.read().decode("utf-8", errors="ignore")
    for pattern in (
        r'"channelId":"(UC[^"]+)"',
        r'"browseId":"(UC[^"]+)"',
        r'/channel/(UC[^"/]+)',
    ):
        match = re.search(pattern, html)
        if match:
            return match.group(1)
    return ""


def resolve_via_api(channel_id: str, api_key: str, playlist_index: int) -> str:
    channel_url = (
        "https://www.googleapis.com/youtube/v3/channels?"
        + urlencode({"part": "contentDetails", "id": channel_id, "key": api_key})
    )
    with urlopen(channel_url, timeout=30) as response:
        payload = json.load(response)
    items = payload.get("items") or []
    if not items:
        raise SystemExit(f"No YouTube channel found for id {channel_id}")
    uploads = (((items[0].get("contentDetails") or {}).get("relatedPlaylists") or {}).get("uploads"))
    if not uploads:
        raise SystemExit(f"No uploads playlist found for channel id {channel_id}")

    playlist_url = (
        "https://www.googleapis.com/youtube/v3/playlistItems?"
        + urlencode(
            {
                "part": "contentDetails",
                "playlistId": uploads,
                "maxResults": str(playlist_index),
                "key": api_key,
            }
        )
    )
    with urlopen(playlist_url, timeout=30) as response:
        playlist_payload = json.load(response)
    playlist_items = playlist_payload.get("items") or []
    if not playlist_items:
        raise SystemExit(f"No playlist items found for uploads playlist {uploads}")
    latest_item = playlist_items[-1]
    video_id = ((latest_item.get("contentDetails") or {}).get("videoId")) or (
        ((latest_item.get("snippet") or {}).get("resourceId") or {}).get("videoId")
    )
    if not video_id:
        raise SystemExit("Could not resolve a YouTube video id from the API response")
    return f"https://www.youtube.com/watch?v={video_id}"


def resolve_via_ytdlp(channel_url: str, playlist_index: int) -> str:
    if not shutil_which("yt-dlp"):
        raise SystemExit("yt-dlp not found in PATH")
    result = subprocess.run(
        [
            "yt-dlp",
            "--flat-playlist",
            "--playlist-items",
            f"{playlist_index}:{playlist_index}",
            "--print",
            "%(webpage_url)s",
            channel_url,
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    if not lines:
        raise SystemExit(f"No YouTube uploads resolved for {channel_url} at playlist index {playlist_index}")
    return lines[-1]


def main() -> int:
    args = parse_args()
    channel_id = (args.channel_id or "").strip() or channel_id_from_url(args.channel_url)
    api_key = (args.api_key or "").strip()

    if api_key and not channel_id:
        try:
            channel_id = channel_id_from_page(args.channel_url)
        except Exception:
            channel_id = ""

    if api_key and channel_id:
        try:
            resolved = resolve_via_api(channel_id, api_key, args.playlist_index)
            print(resolved)
            return 0
        except Exception as exc:
            print(f"[youtube] API-assisted latest lookup failed: {exc}. Falling back to yt-dlp.", file=sys.stderr)
    elif api_key and not channel_id:
        print(
            "[youtube] YOUTUBE_API_KEY is present but no channel id was provided; falling back to yt-dlp.",
            file=sys.stderr,
        )

    print(resolve_via_ytdlp(args.channel_url, args.playlist_index))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
