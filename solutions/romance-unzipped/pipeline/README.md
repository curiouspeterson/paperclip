# Romance Unzipped Content Pipeline

Content production pipeline for the Romance Unzipped podcast/show.

## Overview

This pipeline processes YouTube content into multiple formats and distribution channels.
Each run now stores its artifacts under `.runtime/ru-podcast/episodes/<episode_id>/`
so input, transcripts, metadata, manifests, and generated assets stay isolated per episode.
The shared runtime root keeps only transient download staging under `incoming/` and
cross-run state under `state/`.

## Scripts

### Main Pipeline

- `run_latest_youtube_pipeline.py` - Orchestrates the full pipeline for the latest episode
- `detect_new_episode.sh` - Detects new YouTube episodes
- `download_youtube_source.sh` - Downloads source video/audio

### Transcript Processing

- `generate_transcript.py` - Generates transcript from video
- `prepare_transcript.py` - Prepares transcript for further processing

### Content Generation

- `generate_clip_candidates.py` - Generates potential clip candidates
- `generate_social_drafts.py` - Generates social media draft content
- `generate_quote_cards.py` - Generates quote card images
- `generate_board_review.py` - Generates board review content
- `generate_approval_packet.py` - Generates approval packets
- `generate_connector_runbooks.py` - Generates connector documentation

### Rendering

- `render_clip_assets.py` - Renders clip assets

### Integration

- `sync_batch_to_paperclip.mjs` - Syncs content to Paperclip
- `handoff_manifest.py` - Creates handoff manifests
- `migrate_episode_runtime.py` - One-time migration from the legacy flat runtime layout

### Testing

- `test_pipeline_force_semantics.py` - Tests pipeline force semantics

## Dependencies

```bash
pip install -r requirements.txt
npm install
```

Optional transcriber backends are provided by external binaries or extra
packages, depending on your environment:

- `whisper` CLI for OpenAI Whisper
- `mlx_whisper` for Apple Silicon MLX transcription
- `pyannote.audio` for speaker diarization

On Apple Silicon, the transcript pipeline prefers `mlx_whisper` automatically
when it is installed and falls back to `whisper` otherwise.
The standard pipeline requirements now include `mlx-whisper` so Apple Silicon
setups get the fast path by default.

Runtime overrides:

- `PAPERCLIP_PYTHON_BIN` or `RU_PYTHON_BIN` to point the pipeline at a specific Python interpreter
- `PAPERCLIP_API_URL` for sync and dry-run upload steps
- `YOUTUBE_API_KEY` and `RU_YOUTUBE_CHANNEL_ID` for API-assisted latest-upload lookup

## Usage

```bash
# Run full pipeline for latest episode
python run_latest_youtube_pipeline.py

# Run specific step
python generate_transcript.py --video-id <id>
```

## Configuration

Environment variables (see `pipeline_common.py`):

- `PAPERCLIP_API_URL` - Paperclip API endpoint
- `PAPERCLIP_API_KEY` - Paperclip API key
- `OPENAI_API_KEY` - OpenAI API key (for LLM features)
- `YOUTUBE_API_KEY` - YouTube Data API key used for latest-upload lookup; the pipeline auto-discovers the channel id from the public channel page when possible and otherwise falls back to yt-dlp scraping
- `RU_YOUTUBE_CHANNEL_ID` - Optional YouTube channel id override for API-assisted latest-upload lookup

## Testing

```bash
# Run pipeline force semantics tests
python test_pipeline_force_semantics.py

# Dry runs
node browser_channel_dry_run.mjs
node run_issue_instagram_dry_run.mjs
```
