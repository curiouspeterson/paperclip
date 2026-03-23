#!/usr/bin/env bash
set -euo pipefail

ROOT="${RU_PODCAST_ROOT:-$PWD/.runtime/ru-podcast}"
HOMEPAGE_SITE_DIR="${RU_HOMEPAGE_SITE_DIR:-$PWD/sites/romanceunzippedpodcast}"
SOURCE=""
YOUTUBE_URL=""
YOUTUBE_LATEST_INDEX=""
YOUTUBE_CHANNEL_URL=""
YOUTUBE_CHANNEL_ID="${RU_YOUTUBE_CHANNEL_ID:-${YOUTUBE_CHANNEL_ID:-}}"
RESOLVED_PUBLIC_URL=""
PUBLISH_DATE=""
SKIP_TRANSCRIPT=0
FORCE=0
SYNC_TO_PAPERCLIP=0
PAPERCLIP_API_URL_ARG=""
PAPERCLIP_API_KEY_ARG=""
PAPERCLIP_ISSUE_ID_ARG=""
PAPERCLIP_COMPANY_ID_ARG=""
PYTHON_BIN="${RU_PYTHON_BIN:-${PAPERCLIP_PYTHON_BIN:-python3}}"

usage() {
  cat <<'EOF'
Usage: bin/build_episode_batch.sh [--root PATH] [--source FILE | --youtube-url URL | --youtube-latest [N]] [--youtube-channel-url URL] [--youtube-channel-id ID] [--skip-transcript] [--force] [--paperclip-sync] [--paperclip-api-url URL] [--paperclip-api-key TOKEN] [--paperclip-issue-id ID] [--paperclip-company-id ID]

Runs the deterministic episode batch scaffold:
1. detect episode and create metadata/manifest
2. optionally generate transcript
3. generate clip + quote candidate drafts
4. render clip assets
5. generate quote-card specs
6. generate approval packet + newsletter draft
7. generate social draft files
8. generate board review bundle
9. generate pre-publish dry-run runbooks
10. generate non-live connector runbooks
11. optionally sync the review bundle back into Paperclip
12. auto-update the static homepage data when the source is a public YouTube URL

If a YouTube URL or latest index is provided, the source video is downloaded into
the canonical input folder first. Video is preferred by default so rendered clip
assets can use real episode footage instead of audiograms.

If --paperclip-sync is used with a company id but no issue id, the sync step
creates a new review issue automatically and attaches the batch outputs there.

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
    --youtube-url)
      YOUTUBE_URL="$2"
      shift 2
      ;;
    --youtube-latest)
      if [[ $# -gt 1 && "$2" != --* ]]; then
        YOUTUBE_LATEST_INDEX="$2"
        shift 2
      else
        YOUTUBE_LATEST_INDEX="1"
        shift
      fi
      ;;
    --youtube-channel-url)
      YOUTUBE_CHANNEL_URL="$2"
      shift 2
      ;;
    --youtube-channel-id)
      YOUTUBE_CHANNEL_ID="$2"
      shift 2
      ;;
    --skip-transcript)
      SKIP_TRANSCRIPT=1
      shift
      ;;
    --force)
      FORCE=1
      shift
      ;;
    --paperclip-sync)
      SYNC_TO_PAPERCLIP=1
      shift
      ;;
    --paperclip-api-url)
      PAPERCLIP_API_URL_ARG="$2"
      shift 2
      ;;
    --paperclip-api-key)
      PAPERCLIP_API_KEY_ARG="$2"
      shift 2
      ;;
    --paperclip-issue-id)
      PAPERCLIP_ISSUE_ID_ARG="$2"
      shift 2
      ;;
    --paperclip-company-id)
      PAPERCLIP_COMPANY_ID_ARG="$2"
      shift 2
      ;;
    --publish-date)
      PUBLISH_DATE="$2"
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

if [[ -n "$SOURCE" && ( -n "$YOUTUBE_URL" || -n "$YOUTUBE_LATEST_INDEX" ) ]]; then
  echo "Choose either --source or a YouTube ingest option, not both" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_PUBLIC_URL="${RESOLVED_PUBLIC_URL:-${RU_SOURCE_URL:-}}"
SOURCE_CHANNEL_URL="${YOUTUBE_CHANNEL_URL:-${RU_SOURCE_CHANNEL_URL:-https://www.youtube.com/@RomanceUnzipped/videos}}"

if [[ -n "$YOUTUBE_URL" || -n "$YOUTUBE_LATEST_INDEX" ]]; then
  if [[ -n "$YOUTUBE_URL" ]]; then
    RESOLVED_PUBLIC_URL="$YOUTUBE_URL"
  else
    PLAYLIST_ITEM_INDEX="${YOUTUBE_LATEST_INDEX:-1}"
    CHANNEL_URL_TO_RESOLVE="${YOUTUBE_CHANNEL_URL:-${RU_YOUTUBE_CHANNEL_URL:-https://www.youtube.com/@RomanceUnzipped/videos}}"
    RESOLVER_SCRIPT="$SCRIPT_DIR/resolve_youtube_latest.py"
    RESOLVE_ARGS=(--channel-url "$CHANNEL_URL_TO_RESOLVE" --playlist-index "$PLAYLIST_ITEM_INDEX")
    if [[ -n "$YOUTUBE_CHANNEL_ID" ]]; then
      RESOLVE_ARGS+=(--channel-id "$YOUTUBE_CHANNEL_ID")
    fi
    RESOLVED_PUBLIC_URL="$("$PYTHON_BIN" "$RESOLVER_SCRIPT" "${RESOLVE_ARGS[@]}")"
  fi

  DOWNLOAD_ARGS=(--root "$ROOT" --url "$RESOLVED_PUBLIC_URL")
  if [[ -n "$YOUTUBE_CHANNEL_URL" ]]; then
    DOWNLOAD_ARGS+=(--channel-url "$YOUTUBE_CHANNEL_URL")
  fi
  SOURCE="$(bash "$SCRIPT_DIR/download_youtube_source.sh" "${DOWNLOAD_ARGS[@]}")"
  SOURCE_PUBLIC_URL="$RESOLVED_PUBLIC_URL"
  SOURCE_CHANNEL_URL="${YOUTUBE_CHANNEL_URL:-${RU_YOUTUBE_CHANNEL_URL:-https://www.youtube.com/@RomanceUnzipped/videos}}"
fi

DETECT_ARGS=(--root "$ROOT")
if [[ -n "$SOURCE" ]]; then
  DETECT_ARGS+=(--source "$SOURCE")
fi
if [[ -n "$PUBLISH_DATE" ]]; then
  DETECT_ARGS+=(--publish-date "$PUBLISH_DATE")
fi

MANIFEST_PATH=""
while IFS='=' read -r key value; do
  [[ -n "$key" ]] || continue
  case "$key" in
    manifest)
      MANIFEST_PATH="$value"
      ;;
  esac
done < <(
  RU_SOURCE_URL="$SOURCE_PUBLIC_URL" \
  RU_SOURCE_CHANNEL_URL="$SOURCE_CHANNEL_URL" \
  "$SCRIPT_DIR/detect_new_episode.sh" "${DETECT_ARGS[@]}"
)

if [[ -z "$MANIFEST_PATH" ]]; then
  echo "Failed to resolve manifest path from detect step" >&2
  exit 1
fi

if [[ -n "$SOURCE_PUBLIC_URL" || -n "$SOURCE_CHANNEL_URL" || -n "${PUBLISH_DATE:-${RU_PUBLISH_DATE:-}}" ]]; then
  SCRIPT_DIR_ENV="$SCRIPT_DIR" MANIFEST_PATH_ENV="$MANIFEST_PATH" SOURCE_PUBLIC_URL_ENV="$SOURCE_PUBLIC_URL" SOURCE_CHANNEL_URL_ENV="$SOURCE_CHANNEL_URL" PUBLISH_DATE_ENV="${PUBLISH_DATE:-${RU_PUBLISH_DATE:-}}" "$PYTHON_BIN" - <<'PY'
import os
import sys
from pathlib import Path

sys.path.insert(0, os.environ["SCRIPT_DIR_ENV"])
from pipeline_common import atomic_save_json, load_json, normalize_publish_metadata

manifest_path = Path(os.environ["MANIFEST_PATH_ENV"]).expanduser().resolve()
manifest = load_json(manifest_path)

source_public_url = os.environ.get("SOURCE_PUBLIC_URL_ENV", "").strip()
source_channel_url = os.environ.get("SOURCE_CHANNEL_URL_ENV", "").strip()
publish_date = os.environ.get("PUBLISH_DATE_ENV", "").strip()

source = manifest.setdefault("source", {})
homepage = manifest.setdefault("homepage", {})
if source_public_url:
    source["public_url"] = source_public_url
    homepage["public_url"] = source_public_url
if source_channel_url:
    source["channel_url"] = source_channel_url
    homepage["channel_url"] = source_channel_url
if publish_date:
    normalize_publish_metadata(manifest, publish_date)

atomic_save_json(manifest_path, manifest)
PY
fi

if [[ "$FORCE" -eq 1 ]]; then
  SCRIPT_DIR_ENV="$SCRIPT_DIR" MANIFEST_PATH_ENV="$MANIFEST_PATH" "$PYTHON_BIN" - <<'PY'
import os
import sys
from pathlib import Path

sys.path.insert(0, os.environ["SCRIPT_DIR_ENV"])
from pipeline_common import atomic_save_json, clear_force_rerun_outputs, load_json

manifest_path = Path(os.environ["MANIFEST_PATH_ENV"]).expanduser().resolve()
manifest = load_json(manifest_path)
clear_force_rerun_outputs(manifest)
atomic_save_json(manifest_path, manifest)
PY
fi

if [[ "$SKIP_TRANSCRIPT" -ne 1 ]]; then
  TRANSCRIPT_ARGS=(--manifest "$MANIFEST_PATH")
  if [[ "$FORCE" -eq 1 ]]; then
    TRANSCRIPT_ARGS+=(--force)
  fi
  "$PYTHON_BIN" "$SCRIPT_DIR/generate_transcript.py" "${TRANSCRIPT_ARGS[@]}"
else
  "$PYTHON_BIN" <<PY
import sys
sys.path.insert(0, "$SCRIPT_DIR")
from pathlib import Path
from pipeline_common import mark_skip_transcript_ready
mark_skip_transcript_ready("$MANIFEST_PATH")
PY
fi

PACKET_ARGS=(--manifest "$MANIFEST_PATH")
CLIP_ARGS=(--manifest "$MANIFEST_PATH")
if [[ "$FORCE" -eq 1 ]]; then
  PACKET_ARGS+=(--force)
  CLIP_ARGS+=(--force)
fi

"$PYTHON_BIN" "$SCRIPT_DIR/generate_clip_candidates.py" "${CLIP_ARGS[@]}"
"$PYTHON_BIN" "$SCRIPT_DIR/render_clip_assets.py" "${CLIP_ARGS[@]}"
"$PYTHON_BIN" "$SCRIPT_DIR/generate_quote_cards.py" "${CLIP_ARGS[@]}"
"$PYTHON_BIN" "$SCRIPT_DIR/generate_approval_packet.py" "${PACKET_ARGS[@]}"
"$PYTHON_BIN" "$SCRIPT_DIR/generate_social_drafts.py" "${PACKET_ARGS[@]}"
"$PYTHON_BIN" "$SCRIPT_DIR/generate_board_review.py" "${PACKET_ARGS[@]}"
"$PYTHON_BIN" "$SCRIPT_DIR/generate_connector_runbooks.py" "${PACKET_ARGS[@]}"
"$PYTHON_BIN" "$SCRIPT_DIR/generate_channel_dry_runs.py" "${PACKET_ARGS[@]}"

HOMEPAGE_PUBLISH_DATE="$(
  MANIFEST_PATH_ENV="$MANIFEST_PATH" "$PYTHON_BIN" - <<'PY'
import json
import os
from pathlib import Path

manifest = json.loads(Path(os.environ["MANIFEST_PATH_ENV"]).read_text(encoding="utf-8"))
print(str(manifest.get("homepage", {}).get("publish_date") or "").strip())
PY
)"

if [[ -n "$SOURCE_PUBLIC_URL" && -n "$HOMEPAGE_PUBLISH_DATE" ]]; then
  "$PYTHON_BIN" "$SCRIPT_DIR/update_static_homepage.py" \
    --manifest "$MANIFEST_PATH" \
    --site-dir "$HOMEPAGE_SITE_DIR" \
    --public-url "$SOURCE_PUBLIC_URL" \
    --channel-url "$SOURCE_CHANNEL_URL"
elif [[ -n "$SOURCE_PUBLIC_URL" ]]; then
  echo "Skipping homepage update: homepage.publish_date is missing in the manifest." >&2
fi

if [[ "$SYNC_TO_PAPERCLIP" -eq 1 ]]; then
  SYNC_ARGS=(--manifest "$MANIFEST_PATH")
  if [[ -n "$PAPERCLIP_API_URL_ARG" ]]; then
    SYNC_ARGS+=(--api-url "$PAPERCLIP_API_URL_ARG")
  fi
  if [[ -n "$PAPERCLIP_API_KEY_ARG" ]]; then
    SYNC_ARGS+=(--api-key "$PAPERCLIP_API_KEY_ARG")
  fi
  if [[ -n "$PAPERCLIP_ISSUE_ID_ARG" ]]; then
    SYNC_ARGS+=(--issue-id "$PAPERCLIP_ISSUE_ID_ARG")
  fi
  if [[ -n "$PAPERCLIP_COMPANY_ID_ARG" ]]; then
    SYNC_ARGS+=(--company-id "$PAPERCLIP_COMPANY_ID_ARG")
  fi
  node "$SCRIPT_DIR/sync_batch_to_paperclip.mjs" "${SYNC_ARGS[@]}"
fi

echo "manifest=$MANIFEST_PATH"
