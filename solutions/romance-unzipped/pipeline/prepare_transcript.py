#!/usr/bin/env python3
"""Prepare transcript file locations for the intake pipeline."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path


PLACEHOLDER = """# Transcript Pending

status: pending
generated_at:
source:

"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--metadata", required=True, help="Path to metadata json")
    parser.add_argument("--force", action="store_true", help="Overwrite transcript placeholder")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    metadata_path = Path(args.metadata).expanduser().resolve()
    if not metadata_path.exists():
        raise SystemExit(f"Metadata file not found: {metadata_path}")

    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    transcript_path = Path(metadata["transcript_path"]).expanduser().resolve()
    transcript_path.parent.mkdir(parents=True, exist_ok=True)

    if not transcript_path.exists() or args.force:
        body = PLACEHOLDER.replace("generated_at:", f"generated_at: {datetime.now(UTC).isoformat()}")
        body = body.replace("source:", f"source: {metadata.get('source_path', '')}")
        transcript_path.write_text(body, encoding="utf-8")

    metadata["transcript_status"] = "pending"
    metadata["transcript_prepared_at"] = datetime.now(UTC).isoformat()
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(str(transcript_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
