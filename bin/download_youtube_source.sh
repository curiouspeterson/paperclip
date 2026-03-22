#!/usr/bin/env bash
set -euo pipefail

ROOT_DEFAULT="${RU_PODCAST_ROOT:-$PWD/.runtime/ru-podcast}"
ROOT="$ROOT_DEFAULT"
URL=""
AUDIO_ONLY=0
FORMAT=""
MAX_HEIGHT="${RU_YOUTUBE_MAX_HEIGHT:-720}"
CHANNEL_URL="${RU_YOUTUBE_CHANNEL_URL:-https://www.youtube.com/@RomanceUnzipped/videos}"
CHANNEL_ID="${RU_YOUTUBE_CHANNEL_ID:-${YOUTUBE_CHANNEL_ID:-}}"
PLAYLIST_INDEX=""
PYTHON_BIN="${RU_PYTHON_BIN:-${PAPERCLIP_PYTHON_BIN:-python3}}"

usage() {
  cat <<'EOF'
Usage: bin/download_youtube_source.sh [--url YOUTUBE_URL | --latest | --playlist-index N] [--root PATH] [--audio-only] [--max-height N] [--channel-url URL] [--channel-id CHANNEL_ID]

Downloads a YouTube source asset into the canonical pipeline input folder.
Defaults to a video-capable MP4 source so downstream clip rendering can produce
real video clips instead of audiograms when the upload includes video.
When YOUTUBE_API_KEY and a channel id are available, the latest-upload lookup
uses the YouTube Data API before falling back to yt-dlp scraping.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)
      URL="$2"
      shift 2
      ;;
    --latest)
      PLAYLIST_INDEX="1"
      shift
      ;;
    --playlist-index)
      PLAYLIST_INDEX="$2"
      shift 2
      ;;
    --root)
      ROOT="$2"
      shift 2
      ;;
    --channel-url)
      CHANNEL_URL="$2"
      shift 2
      ;;
    --channel-id)
      CHANNEL_ID="$2"
      shift 2
      ;;
    --audio-only)
      AUDIO_ONLY=1
      shift
      ;;
    --max-height)
      MAX_HEIGHT="$2"
      shift 2
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

if [[ -z "$URL" ]]; then
  if [[ -z "$PLAYLIST_INDEX" ]]; then
    PLAYLIST_INDEX="${RU_YOUTUBE_PLAYLIST_INDEX:-}"
  fi
fi

if [[ -z "$URL" && -n "$PLAYLIST_INDEX" ]]; then
  RESOLVER_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/resolve_youtube_latest.py"
  RESOLVE_ARGS=(--channel-url "$CHANNEL_URL" --playlist-index "$PLAYLIST_INDEX")
  if [[ -n "$CHANNEL_ID" ]]; then
    RESOLVE_ARGS+=(--channel-id "$CHANNEL_ID")
  fi
  URL="$("$PYTHON_BIN" "$RESOLVER_SCRIPT" "${RESOLVE_ARGS[@]}")"
fi

if [[ -z "$URL" ]]; then
  echo "--url or --latest/--playlist-index is required" >&2
  usage >&2
  exit 1
fi

if ! command -v yt-dlp >/dev/null 2>&1; then
  echo "yt-dlp not found in PATH" >&2
  exit 1
fi

ROOT_PARENT="$(dirname "$ROOT")"
mkdir -p "$ROOT_PARENT"
ROOT="$(cd "$ROOT_PARENT" && pwd)/$(basename "$ROOT")"
INCOMING_DIR="$ROOT/incoming"
mkdir -p "$INCOMING_DIR"

if [[ "$AUDIO_ONLY" -eq 1 ]]; then
  FORMAT="bestaudio[ext=m4a]/bestaudio"
  OUTPUT_TEMPLATE="$INCOMING_DIR/%(title)s.%(ext)s"
  DOWNLOAD_OUTPUT="$(
    yt-dlp --quiet --no-warnings --no-progress --print after_move:filepath -f "$FORMAT" -o "$OUTPUT_TEMPLATE" "$URL"
  )"
else
  FORMAT="bv*[ext=mp4][height<=${MAX_HEIGHT}]+ba[ext=m4a]/b[ext=mp4][height<=${MAX_HEIGHT}]/bv*[height<=${MAX_HEIGHT}]+ba/b[height<=${MAX_HEIGHT}]/best"
  OUTPUT_TEMPLATE="$INCOMING_DIR/%(title)s.%(ext)s"
  DOWNLOAD_OUTPUT="$(
    yt-dlp --quiet --no-warnings --no-progress --print after_move:filepath --merge-output-format mp4 -f "$FORMAT" -o "$OUTPUT_TEMPLATE" "$URL"
  )"
fi

LATEST_PATH="$(printf '%s\n' "$DOWNLOAD_OUTPUT" | tail -n 1)"

if [[ -z "$LATEST_PATH" ]]; then
  echo "Download finished but no media file was found in $INCOMING_DIR" >&2
  exit 1
fi

echo "$LATEST_PATH"
