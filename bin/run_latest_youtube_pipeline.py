#!/usr/bin/env python3
"""Detect the latest YouTube upload and kick off a batch only when it is new."""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from pipeline_common import load_json, save_json


DEFAULT_CHANNEL_URL = "https://www.youtube.com/@RomanceUnzipped/videos"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        default=str(Path.cwd() / ".runtime" / "ru-podcast"),
        help="Pipeline runtime root passed through to build_episode_batch.sh",
    )
    parser.add_argument(
        "--channel-url",
        default=os.environ.get("RU_YOUTUBE_CHANNEL_URL", DEFAULT_CHANNEL_URL),
        help="YouTube channel/videos URL used to resolve the latest upload",
    )
    parser.add_argument(
        "--channel-id",
        default=os.environ.get("RU_YOUTUBE_CHANNEL_ID") or os.environ.get("YOUTUBE_CHANNEL_ID") or "",
        help="Optional YouTube channel id (UC...) used for API-assisted lookup",
    )
    parser.add_argument(
        "--playlist-index",
        type=int,
        default=1,
        help="1-based index into the flat playlist/videos feed (1 = latest, 2 = second latest)",
    )
    parser.add_argument(
        "--state-path",
        help="Optional state file path. Defaults to <root>/state/youtube-latest.json",
    )
    parser.add_argument(
        "--check-only",
        action="store_true",
        help="Resolve and print the latest upload without triggering a batch run",
    )
    parser.add_argument("--skip-transcript", action="store_true", help="Pass through to build_episode_batch.sh")
    parser.add_argument("--force", action="store_true", help="Rebuild even if the latest upload was already processed")
    parser.add_argument("--paperclip-sync", action="store_true", help="Pass through to build_episode_batch.sh")
    parser.add_argument("--paperclip-api-url", help="Pass through to build_episode_batch.sh")
    parser.add_argument("--paperclip-api-key", help="Pass through to build_episode_batch.sh")
    parser.add_argument("--paperclip-issue-id", help="Pass through to build_episode_batch.sh")
    parser.add_argument("--paperclip-company-id", help="Pass through to build_episode_batch.sh")
    return parser.parse_args()


def extract_youtube_video_id(url: str) -> str:
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    if "youtu.be" in host:
        video_id = parsed.path.strip("/").split("/", 1)[0]
        if video_id:
            return video_id
    if "youtube.com" in host and parsed.path == "/watch":
        video_id = parse_qs(parsed.query).get("v", [""])[0]
        if video_id:
            return video_id
    raise SystemExit(f"Could not extract a YouTube video id from URL: {url}")


def resolve_latest_upload(channel_url: str, playlist_index: int, channel_id: str = "") -> str:
    script_dir = Path(__file__).resolve().parent
    resolver_script = script_dir / "resolve_youtube_latest.py"
    python_bin = (
        os.environ.get("RU_PYTHON_BIN")
        or os.environ.get("PAPERCLIP_PYTHON_BIN")
        or os.environ.get("PYTHON_BIN")
        or "python3"
    )
    cmd = [
        python_bin,
        str(resolver_script),
        "--channel-url",
        channel_url,
        "--playlist-index",
        str(playlist_index),
    ]
    if channel_id.strip():
        cmd.extend(["--channel-id", channel_id.strip()])
    result = subprocess.run(cmd, check=True, capture_output=True, text=True)
    return result.stdout.strip().splitlines()[-1]


def resolve_upload_publish_date(public_url: str) -> str | None:
    """Resolve the upload date for a YouTube video URL using yt-dlp.

    Returns an ISO 8601 date-time string (YYYY-MM-DDTHH:MM:SS+00:00) on success,
    or None if yt-dlp is not available or the date cannot be resolved.
    """
    if not shutil_which("yt-dlp"):
        return None
    try:
        result = subprocess.run(
            ["yt-dlp", "--no-download", "--print", "%(upload_date>%Y-%m-%dT00:00:00+00:00)s", public_url],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode == 0:
            date_str = result.stdout.strip()
            if date_str and date_str != "NA":
                return date_str
    except (subprocess.TimeoutExpired, OSError):
        pass
    return None


def shutil_which(binary: str) -> str | None:
    for entry in os.environ.get("PATH", "").split(os.pathsep):
        candidate = Path(entry) / binary
        if candidate.exists() and os.access(candidate, os.X_OK):
            return str(candidate)
    return None


def load_state(path: Path) -> dict:
    if not path.exists():
        return {}
    return load_json(path)


def save_state(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    save_json(path, payload)


def discover_existing_processed_batch(root: Path, public_url: str) -> dict[str, str] | None:
    metadata_candidates = []
    episodes_dir = root / "episodes"
    if episodes_dir.exists():
        metadata_candidates.extend(sorted(episodes_dir.glob("*/metadata/*.json"), reverse=True))
    legacy_metadata_dir = root / "metadata"
    if legacy_metadata_dir.exists():
        metadata_candidates.extend(sorted(legacy_metadata_dir.glob("*.json"), reverse=True))

    if not metadata_candidates:
        return None

    for metadata_path in metadata_candidates:
        metadata = load_json(metadata_path)
        if str(metadata.get("source_public_url") or "").strip() != public_url:
            continue
        episode_id = str(metadata.get("episode_id") or "").strip()
        if not episode_id:
            continue
        manifest_path = metadata_path.parent.parent / "manifests" / f"{episode_id}.json"
        if not manifest_path.exists():
            continue
        manifest = load_json(manifest_path)
        status = manifest.get("status", {})
        if str(status.get("approval_packet") or "").strip().lower() != "ready":
            continue
        return {
            "episode_id": episode_id,
            "metadata_path": str(metadata_path.resolve()),
            "manifest_path": str(manifest_path.resolve()),
        }
    return None


def parse_batch_output(stdout: str) -> dict[str, str]:
    parsed: dict[str, str] = {}
    for line in stdout.splitlines():
        match = re.match(r"^(metadata|manifest)=(.+)$", line.strip())
        if match:
            parsed[match.group(1)] = match.group(2)
    return parsed


def run_batch_and_stream(cmd: list[str], env: dict[str, str]) -> tuple[int, str]:
    lines: list[str] = []
    with subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env=env,
        bufsize=1,
    ) as process:
        assert process.stdout is not None
        for line in process.stdout:
            lines.append(line)
            print(line, end="")
            sys.stdout.flush()
        return_code = process.wait()
    return return_code, "".join(lines)


def main() -> int:
    args = parse_args()
    root = Path(args.root).expanduser().resolve()
    state_path = (
        Path(args.state_path).expanduser().resolve()
        if args.state_path
        else (root / "state" / "youtube-latest.json").resolve()
    )
    checked_at = datetime.now(UTC).isoformat()
    public_url = resolve_latest_upload(args.channel_url, args.playlist_index, args.channel_id)
    video_id = extract_youtube_video_id(public_url)

    state = load_state(state_path)
    state.update(
        {
            "channel_url": args.channel_url,
            "playlist_index": args.playlist_index,
            "last_checked_at": checked_at,
            "last_observed_public_url": public_url,
            "last_observed_video_id": video_id,
        }
    )

    if not state.get("last_processed_video_id"):
        discovered = discover_existing_processed_batch(root, public_url)
        if discovered:
            state.update(
                {
                    "last_run_status": "bootstrapped_from_existing_batch",
                    "last_processed_at": checked_at,
                    "last_processed_video_id": video_id,
                    "last_processed_public_url": public_url,
                    "last_processed_manifest_path": discovered["manifest_path"],
                    "last_processed_metadata_path": discovered["metadata_path"],
                    "last_processed_episode_id": discovered["episode_id"],
                }
            )

    already_processed = state.get("last_processed_video_id") == video_id

    print(f"latest_public_url={public_url}")
    print(f"latest_video_id={video_id}")
    print(f"already_processed={'true' if already_processed else 'false'}")

    if args.check_only:
        save_state(state_path, state)
        print(f"state_path={state_path}")
        return 0

    if already_processed and not args.force:
        state["last_run_status"] = "skipped_already_processed"
        save_state(state_path, state)
        print("run_status=skipped")
        print(f"state_path={state_path}")
        return 0

    publish_date = resolve_upload_publish_date(public_url)

    script_dir = Path(__file__).resolve().parent
    build_script = script_dir / "build_episode_batch.sh"
    cmd = [
        "bash",
        str(build_script),
        "--root",
        str(root),
        "--youtube-url",
        public_url,
        "--youtube-channel-url",
        args.channel_url,
    ]
    if args.channel_id:
        cmd.extend(["--youtube-channel-id", args.channel_id])
    if publish_date:
        cmd.extend(["--publish-date", publish_date])
    if args.skip_transcript:
        cmd.append("--skip-transcript")
    if args.force:
        cmd.append("--force")
    if args.paperclip_sync:
        cmd.append("--paperclip-sync")
    if args.paperclip_api_url:
        cmd.extend(["--paperclip-api-url", args.paperclip_api_url])
    if args.paperclip_api_key:
        cmd.extend(["--paperclip-api-key", args.paperclip_api_key])
    if args.paperclip_issue_id:
        cmd.extend(["--paperclip-issue-id", args.paperclip_issue_id])
    if args.paperclip_company_id:
        cmd.extend(["--paperclip-company-id", args.paperclip_company_id])

    env = os.environ.copy()

    return_code, combined_output = run_batch_and_stream(cmd, env)
    if return_code != 0:
        state["last_run_status"] = "failed"
        state["last_error"] = combined_output.strip()[-4000:]
        save_state(state_path, state)
        raise SystemExit(return_code)

    parsed_output = parse_batch_output(combined_output)
    state.update(
        {
            "last_run_status": "ready",
            "last_error": None,
            "last_processed_at": datetime.now(UTC).isoformat(),
            "last_processed_video_id": video_id,
            "last_processed_public_url": public_url,
            "last_processed_manifest_path": parsed_output.get("manifest"),
            "last_processed_metadata_path": parsed_output.get("metadata"),
        }
    )
    save_state(state_path, state)
    print(f"state_path={state_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
