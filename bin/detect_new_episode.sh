#!/usr/bin/env bash
set -euo pipefail

ROOT_DEFAULT="${RU_PODCAST_ROOT:-$PWD/.runtime/ru-podcast}"
ROOT="$ROOT_DEFAULT"
SOURCE=""
FORCE=0
PUBLISH_DATE=""
PYTHON_BIN="${RU_PYTHON_BIN:-${PAPERCLIP_PYTHON_BIN:-python3}}"

usage() {
  cat <<'EOF'
Usage: bin/detect_new_episode.sh [--root PATH] [--source FILE] [--publish-date ISO_TIMESTAMP] [--force]

Creates the canonical metadata, transcript placeholder, and handoff manifest
for a newly detected episode asset.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --root)
      ROOT="$2"
      shift 2
      ;;
    --source)
      SOURCE="$2"
      shift 2
      ;;
    --publish-date)
      PUBLISH_DATE="$2"
      shift 2
      ;;
    --force)
      FORCE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

ROOT_PARENT="$(dirname "$ROOT")"
mkdir -p "$ROOT_PARENT"
ROOT="$(cd "$ROOT_PARENT" && pwd)/$(basename "$ROOT")"
INPUT_DIR="$ROOT/input"
mkdir -p "$INPUT_DIR"

if [[ -z "$SOURCE" ]]; then
  SOURCE="$(
    find "$INPUT_DIR" -maxdepth 1 -type f \
      \( -iname '*.mp3' -o -iname '*.mp4' -o -iname '*.m4a' -o -iname '*.mov' -o -iname '*.mkv' -o -iname '*.wav' -o -iname '*.webm' \) \
      -print | sort | tail -n 1
  )"
fi

if [[ -z "$SOURCE" ]]; then
  echo "No episode source found in $INPUT_DIR" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"


# Initialize episode manifest as the primary runtime contract
INIT_ARGS=(--source "$SOURCE" --root "$ROOT")
if [[ -n "$PUBLISH_DATE" ]]; then
  INIT_ARGS+=(--publish-date "$PUBLISH_DATE")
elif [[ -n "${RU_PUBLISH_DATE:-}" ]]; then
  INIT_ARGS+=(--publish-date "$RU_PUBLISH_DATE")
fi
if [[ "$FORCE" -eq 1 ]]; then
  INIT_ARGS+=(--force)
fi

# Create manifest first (manifest is the only authoritative state object)
MANIFEST_PATH="$("$PYTHON_BIN" "$SCRIPT_DIR/initialize_episode_manifest.py" "${INIT_ARGS[@]}")"

echo "manifest=$MANIFEST_PATH"
