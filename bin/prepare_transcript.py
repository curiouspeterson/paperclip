#!/usr/bin/env python3
"""Prepare transcript file locations for the intake pipeline."""

from __future__ import annotations

import argparse
from datetime import UTC, datetime
from pathlib import Path

from pipeline_common import load_manifest, resolve_path, save_manifest, set_stage_status


PLACEHOLDER = """# Transcript Pending

status: pending
generated_at:
source:

"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, help="Path to episode manifest")
    parser.add_argument("--force", action="store_true", help="Overwrite transcript placeholder")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    manifest_path = resolve_path(args.manifest)
    if not manifest_path.exists():
        raise SystemExit(f"Manifest file not found: {manifest_path}")

    manifest = load_manifest(manifest_path)

    # Read paths from manifest source section
    transcript_path = resolve_path(manifest["source"]["transcript_path"])
    media_path = resolve_path(manifest["source"]["media_path"])

    transcript_path.parent.mkdir(parents=True, exist_ok=True)

    # Create placeholder if it doesn't exist or if forced
    if not transcript_path.exists() or args.force:
        body = PLACEHOLDER.replace("generated_at:", f"generated_at: {datetime.now(UTC).isoformat()}")
        body = body.replace("source:", f"source: {media_path}")
        transcript_path.write_text(body, encoding="utf-8")

    # Update manifest status through the manifest, not metadata
    set_stage_status(manifest, "transcript", "pending", timestamp_key="transcript_prepared_at")
    save_manifest(manifest_path, manifest)

    print(str(transcript_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
