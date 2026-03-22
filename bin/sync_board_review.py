#!/usr/bin/env python3
"""Sync board review to Paperclip after board review generation is complete.

This stage records the Paperclip issue ID and sync timestamp in the manifest.
The board_review status stays "ready" — only paperclip_sync tracks the sync lifecycle.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

from pipeline_common import (
    load_json,
    atomic_save_json,
    resolve_path,
    require_board_review_ready,
    record_paperclip_sync,
    calculate_sync_total,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, help="Path to manifest JSON")
    parser.add_argument("--api-url", help="Paperclip API URL (defaults to PAPERCLIP_API_URL env)")
    parser.add_argument("--api-key", help="Paperclip API key (defaults to PAPERCLIP_API_KEY env)")
    parser.add_argument("--issue-id", help="Existing Paperclip issue ID (creates new if not provided)")
    parser.add_argument("--company-id", help="Paperclip company ID (defaults to PAPERCLIP_COMPANY_ID env)")
    parser.add_argument("--project-id", help="Paperclip project ID (defaults to PAPERCLIP_PROJECT_ID env)")
    parser.add_argument("--skip-sync", action="store_true", help="Skip actual Paperclip sync (test mode)")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    manifest_path = resolve_path(args.manifest)

    if not manifest_path.exists():
        raise SystemExit(f"Manifest file not found: {manifest_path}")

    manifest = load_json(manifest_path)
    episode_id = manifest.get("episode_id", "unknown-episode")

    # Require board review to be ready
    require_board_review_ready(manifest, context="Board review sync")

    # Build sync command arguments
    sync_args = ["node", str(Path(__file__).parent / "sync_batch_to_paperclip.mjs"), "--manifest", str(manifest_path)]

    # Add optional arguments
    if args.api_url:
        sync_args.extend(["--api-url", args.api_url])
    if args.api_key:
        sync_args.extend(["--api-key", args.api_key])
    if args.issue_id:
        sync_args.extend(["--issue-id", args.issue_id])
    if args.company_id:
        sync_args.extend(["--company-id", args.company_id])
    if args.project_id:
        sync_args.extend(["--project-id", args.project_id])

    # Check required Paperclip configuration — companyId only required when creating a new issue
    paperclip_company_id = args.company_id or os.environ.get("PAPERCLIP_COMPANY_ID")
    if not paperclip_company_id and not args.issue_id:
        raise SystemExit(
            "Paperclip company ID required when creating a new issue: "
            "use --company-id or set PAPERCLIP_COMPANY_ID env var, "
            "or provide --issue-id to update an existing issue"
        )

    # Run sync if not in test mode
    if not args.skip_sync:
        try:
            result = subprocess.run(sync_args, check=True, capture_output=True, text=True)
            sync_output = json.loads(result.stdout)
            issue_id = sync_output.get("issueId")

            if not issue_id:
                raise SystemExit("Paperclip sync succeeded but no issue ID returned")

            print(f"✓ Board review synced to Paperclip issue: {issue_id}", file=sys.stderr)
        except subprocess.CalledProcessError as e:
            raise SystemExit(f"Paperclip sync failed: {e.stderr}")
        except json.JSONDecodeError as e:
            raise SystemExit(f"Failed to parse Paperclip sync response: {e}")
    else:
        # Test mode: use a synthetic issue ID
        issue_id = "test-issue-123"
        print(f"✓ (Test mode) Would sync to Paperclip issue: {issue_id}", file=sys.stderr)

    # Reload manifest from disk to capture any changes written by the Node sync subprocess
    # (e.g., paperclip_sync = "ready" written by sync_batch_to_paperclip.mjs)
    manifest = load_json(manifest_path)

    # Record sync in manifest — board_review stays "ready", only paperclip_sync tracks sync lifecycle
    generated_at = datetime.now(UTC).isoformat()
    record_paperclip_sync(manifest, issue_id, generated_at=generated_at)

    # Calculate and record sync total
    sync_total = calculate_sync_total(manifest)
    manifest.setdefault("publishing", {})["sync_total"] = sync_total

    atomic_save_json(manifest_path, manifest)

    # Print sync status summary
    print(str(issue_id))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
