#!/usr/bin/env python3
"""Legacy metadata capture script.

DEPRECATED: Use initialize_episode_manifest.py instead.

The manifest-first pipeline replaces this script. All intake state is now
captured in the manifest JSON as the single source of truth.
"""

raise SystemExit(
    "capture_metadata.py is deprecated. Use initialize_episode_manifest.py instead.\n"
    "The manifest is now the authoritative intake contract for the pipeline."
)
