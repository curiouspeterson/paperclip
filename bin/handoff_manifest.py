#!/usr/bin/env python3
"""Legacy manifest handoff script.

DEPRECATED: Use initialize_episode_manifest.py instead.

The manifest-first pipeline replaces this script. Manifests are now created
directly by initialize_episode_manifest.py as the single authoritative
intake contract. There is no separate handoff step.
"""

raise SystemExit(
    "handoff_manifest.py is deprecated. Use initialize_episode_manifest.py instead.\n"
    "Manifests are created directly during episode initialization."
)
