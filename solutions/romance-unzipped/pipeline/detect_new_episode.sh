#!/usr/bin/env bash
set -euo pipefail

ROOT_DEFAULT="${RU_PODCAST_ROOT:-$PWD/.runtime/ru-podcast}"
ROOT="$ROOT_DEFAULT"
SOURCE=""
FORCE=0

usage() {
  cat <<'EOF'
Usage: bin/detect_new_episode.sh [--root PATH] [--source FILE] [--force]

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


# Always initialize arrays to avoid unbound variable errors
CAPTURE_ARGS=(--source "$SOURCE" --root "$ROOT")
PREPARE_ARGS=()
MANIFEST_ARGS=()

if [[ "$FORCE" -eq 1 ]]; then
  CAPTURE_ARGS+=(--force)
  PREPARE_ARGS+=(--force)
  MANIFEST_ARGS+=(--force)
fi

# Defensive: only pass arrays if they have elements
METADATA_PATH="$("$SCRIPT_DIR/capture_metadata.py" "${CAPTURE_ARGS[@]}" )"
if [[ ${#PREPARE_ARGS[@]} -gt 0 ]]; then
  TRANSCRIPT_PATH="$("$SCRIPT_DIR/prepare_transcript.py" --metadata "$METADATA_PATH" "${PREPARE_ARGS[@]}" )"
else
  TRANSCRIPT_PATH="$("$SCRIPT_DIR/prepare_transcript.py" --metadata "$METADATA_PATH" )"
fi
if [[ ${#MANIFEST_ARGS[@]} -gt 0 ]]; then
  MANIFEST_PATH="$("$SCRIPT_DIR/handoff_manifest.py" --metadata "$METADATA_PATH" "${MANIFEST_ARGS[@]}" )"
else
  MANIFEST_PATH="$("$SCRIPT_DIR/handoff_manifest.py" --metadata "$METADATA_PATH" )"
fi

cat <<EOF
root=$ROOT
source=$SOURCE
metadata=$METADATA_PATH
transcript=$TRANSCRIPT_PATH
manifest=$MANIFEST_PATH
EOF
