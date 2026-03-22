#!/usr/bin/env python3
"""Generate a transcript for an intake manifest using Whisper or MLX Whisper."""

from __future__ import annotations

import argparse
import importlib
import importlib.util
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

import yaml

from pipeline_common import load_json, save_json

DEFAULT_MLX_MODEL_REPOS = {
    "tiny": "mlx-community/whisper-tiny",
    "tiny.en": "mlx-community/whisper-tiny.en",
    "base": "mlx-community/whisper-base",
    "base.en": "mlx-community/whisper-base.en",
    "small": "mlx-community/whisper-small",
    "small.en": "mlx-community/whisper-small.en",
    "medium": "mlx-community/whisper-medium",
    "medium.en": "mlx-community/whisper-medium.en",
    "large": "mlx-community/whisper-large",
    "large-v2": "mlx-community/whisper-large-v2",
    # MLX currently exposes the high-end v3 path via the turbo repo in this environment.
    "large-v3": "mlx-community/whisper-large-v3-turbo",
    "large-v3-turbo": "mlx-community/whisper-large-v3-turbo",
    "turbo": "mlx-community/whisper-large-v3-turbo",
}

DEFAULT_PRESET = "accurate"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--metadata", required=True, help="Path to metadata json from the intake scaffold")
    parser.add_argument(
        "--backend",
        default=os.environ.get("RU_WHISPER_BACKEND", "auto"),
        choices=("auto", "whisper", "mlx"),
        help="Transcription backend to use",
    )
    parser.add_argument(
        "--preset",
        default=os.environ.get("RU_WHISPER_PRESET", DEFAULT_PRESET),
        choices=("fast", "balanced", "accurate"),
        help="Transcript quality/speed preset",
    )
    parser.add_argument("--model", default=os.environ.get("RU_WHISPER_MODEL", ""), help="Whisper model name")
    parser.add_argument("--language", default=os.environ.get("RU_WHISPER_LANGUAGE", "en"), help="Spoken language")
    parser.add_argument("--whisper-bin", default=os.environ.get("RU_WHISPER_BIN", "whisper"), help="Whisper CLI binary")
    parser.add_argument(
        "--mlx-whisper-bin",
        default=os.environ.get("RU_MLX_WHISPER_BIN", "mlx_whisper"),
        help="MLX Whisper CLI binary",
    )
    parser.add_argument(
        "--task",
        default=os.environ.get("RU_WHISPER_TASK", "transcribe"),
        choices=("transcribe", "translate"),
        help="Whisper task mode",
    )
    parser.add_argument(
        "--word-timestamps",
        default=os.environ.get("RU_WHISPER_WORD_TIMESTAMPS", "true"),
        help="Whether to ask Whisper for word-level timestamps (true/false)",
    )
    parser.add_argument("--temperature", default=os.environ.get("RU_WHISPER_TEMPERATURE", ""), help="Decoder temperature")
    parser.add_argument("--best-of", default=os.environ.get("RU_WHISPER_BEST_OF", ""), help="Sampling candidate count")
    parser.add_argument("--beam-size", default=os.environ.get("RU_WHISPER_BEAM_SIZE", ""), help="Beam size for deterministic decoding")
    parser.add_argument("--patience", default=os.environ.get("RU_WHISPER_PATIENCE", ""), help="Beam patience")
    parser.add_argument(
        "--condition-on-previous-text",
        default=os.environ.get("RU_WHISPER_CONDITION_ON_PREVIOUS_TEXT", ""),
        help="Whether to prompt each window with the prior output",
    )
    parser.add_argument(
        "--initial-prompt",
        default=os.environ.get("RU_WHISPER_INITIAL_PROMPT", ""),
        help="Optional domain prompt to bias transcription",
    )
    parser.add_argument(
        "--diarization-backend",
        default=os.environ.get("RU_DIARIZATION_BACKEND", "none"),
        choices=("auto", "none", "pyannote"),
        help="Optional speaker diarization backend",
    )
    parser.add_argument(
        "--diarization-auth-token",
        default=os.environ.get("RU_PYANNOTE_TOKEN", ""),
        help="Auth token for pyannote hosted model pulls",
    )
    parser.add_argument(
        "--min-speakers",
        type=int,
        default=int(os.environ.get("RU_DIARIZATION_MIN_SPEAKERS", "0")),
        help="Optional diarization minimum speaker count",
    )
    parser.add_argument(
        "--max-speakers",
        type=int,
        default=int(os.environ.get("RU_DIARIZATION_MAX_SPEAKERS", "0")),
        help="Optional diarization maximum speaker count",
    )
    parser.add_argument("--force", action="store_true", help="Overwrite an existing transcript")
    return parser.parse_args()


def ensure_binary(binary_name: str) -> str:
    resolved = shutil.which(binary_name) or binary_name
    if not shutil.which(resolved) and not Path(resolved).exists():
        raise SystemExit(f"Binary not found: {binary_name}")
    return resolved


def parse_bool(value: str | None, *, default: bool) -> bool:
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    return default


def canonical_transcript_paths(metadata: dict, transcript_path: Path) -> dict[str, Path]:
    return {
        "txt": transcript_path,
        "json": Path(metadata.get("transcript_json_path", transcript_path.with_suffix(".json"))).expanduser().resolve(),
        "segments": Path(
            metadata.get("transcript_segments_path", transcript_path.with_suffix(".segments.json"))
        ).expanduser().resolve(),
        "diarization": Path(
            metadata.get("transcript_diarization_path", transcript_path.with_suffix(".diarization.json"))
        ).expanduser().resolve(),
        "srt": Path(metadata.get("transcript_srt_path", transcript_path.with_suffix(".srt"))).expanduser().resolve(),
        "vtt": Path(metadata.get("transcript_vtt_path", transcript_path.with_suffix(".vtt"))).expanduser().resolve(),
        "tsv": Path(metadata.get("transcript_tsv_path", transcript_path.with_suffix(".tsv"))).expanduser().resolve(),
    }


def normalize_transcript_json(payload: dict, *, metadata: dict, model: str, language: str, diarization_payload: dict | None = None) -> dict:
    diarization_turns = diarization_payload.get("turns", []) if isinstance(diarization_payload, dict) else []
    normalized_segments = []
    for index, segment in enumerate(payload.get("segments") or [], start=1):
        text = str(segment.get("text") or "").strip()
        if not text:
            continue
        start = segment.get("start")
        end = segment.get("end")
        words = []
        for word in segment.get("words") or []:
            token = str(word.get("word") or "").strip()
            if not token:
                continue
            words.append(
                {
                    "word": token,
                    "start": word.get("start"),
                    "end": word.get("end"),
                    "probability": word.get("probability"),
                }
            )
        speaker = assign_speaker(start, end, diarization_turns)
        normalized_segments.append(
            {
                "id": segment.get("id", index - 1),
                "index": index,
                "start": start,
                "end": end,
                "duration": (end - start) if isinstance(start, (int, float)) and isinstance(end, (int, float)) else None,
                "text": text,
                "speaker": speaker,
                "word_count": len(text.split()),
                "words": words,
                "avg_logprob": segment.get("avg_logprob"),
                "compression_ratio": segment.get("compression_ratio"),
                "no_speech_prob": segment.get("no_speech_prob"),
                "temperature": segment.get("temperature"),
            }
        )

    return {
        "episode_id": metadata.get("episode_id"),
        "title": metadata.get("title"),
        "generated_at": datetime.now(UTC).isoformat(),
        "model": model,
        "language": payload.get("language") or language,
        "text": str(payload.get("text") or "").strip(),
        "segment_count": len(normalized_segments),
        "speaker_count": len({turn.get("speaker") for turn in diarization_turns if turn.get("speaker")}),
        "segments": normalized_segments,
    }


def copy_if_present(source: Path, destination: Path) -> bool:
    if not source.exists():
        return False
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)
    return True


def update_manifest_status(metadata: dict, transcript_status: str) -> None:
    manifest_path = Path(metadata["manifest_path"]).expanduser().resolve()
    if not manifest_path.exists():
        return
    manifest = load_json(manifest_path)
    manifest.setdefault("status", {})
    manifest["status"]["transcript"] = transcript_status
    manifest["status"]["diarization"] = metadata.get("diarization_status", manifest["status"].get("diarization", "pending"))
    manifest["status"]["manifest"] = "ready"
    manifest["updated_at"] = datetime.now(UTC).isoformat()
    save_json(manifest_path, manifest)


def mlx_available(args: argparse.Namespace) -> bool:
    if shutil.which(args.mlx_whisper_bin):
        return True
    try:
        return importlib.util.find_spec("mlx_whisper.cli") is not None
    except ModuleNotFoundError:
        return False


def pyannote_available() -> bool:
    try:
        return importlib.util.find_spec("pyannote.audio") is not None
    except ModuleNotFoundError:
        return False


def resolve_huggingface_token(explicit_token: str) -> str:
    candidate = str(explicit_token or "").strip()
    if candidate:
        return candidate
    cached_token = Path.home() / ".cache" / "huggingface" / "token"
    if cached_token.exists():
        return cached_token.read_text(encoding="utf-8").strip()
    return ""


@contextmanager
def temporary_env(updates: dict[str, str]):
    original: dict[str, str | None] = {key: os.environ.get(key) for key in updates}
    try:
        for key, value in updates.items():
            os.environ[key] = value
        yield
    finally:
        for key, value in original.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def resolve_diarization_backend(args: argparse.Namespace) -> str:
    if args.diarization_backend == "none":
        return "none"
    if args.diarization_backend == "pyannote":
        return "pyannote"
    if pyannote_available() and resolve_huggingface_token(args.diarization_auth_token):
        return "pyannote"
    return "none"


def resolve_backend(args: argparse.Namespace) -> str:
    if args.backend in {"whisper", "mlx"}:
        return args.backend
    if platform.machine() == "arm64" and mlx_available(args):
        return "mlx"
    return "whisper"


def resolve_mlx_model(requested_model: str) -> str:
    candidate = str(requested_model or "").strip()
    if not candidate:
        return DEFAULT_MLX_MODEL_REPOS["tiny"]
    if "/" in candidate or Path(candidate).expanduser().exists():
        return candidate
    normalized = candidate.lower().replace("_", "-")
    if normalized.startswith("whisper-"):
        return f"mlx-community/{normalized}"
    return DEFAULT_MLX_MODEL_REPOS.get(normalized, f"mlx-community/whisper-{normalized}")


def resolve_decoder_options(args: argparse.Namespace) -> dict[str, str | bool]:
    presets: dict[str, dict[str, str | bool]] = {
        "fast": {
            "temperature": "0",
            "best_of": "",
            "beam_size": "",
            "patience": "",
            "condition_on_previous_text": True,
        },
        "balanced": {
            "temperature": "0",
            "best_of": "",
            "beam_size": "3",
            "patience": "0.5",
            "condition_on_previous_text": True,
        },
        "accurate": {
            "temperature": "0",
            "best_of": "",
            "beam_size": "5",
            "patience": "1.0",
            "condition_on_previous_text": True,
        },
    }
    resolved = dict(presets.get(args.preset, presets[DEFAULT_PRESET]))
    if str(args.temperature).strip():
        resolved["temperature"] = str(args.temperature).strip()
    if str(args.best_of).strip():
        resolved["best_of"] = str(args.best_of).strip()
    if str(args.beam_size).strip():
        resolved["beam_size"] = str(args.beam_size).strip()
    if str(args.patience).strip():
        resolved["patience"] = str(args.patience).strip()
    if str(args.condition_on_previous_text).strip():
        resolved["condition_on_previous_text"] = parse_bool(args.condition_on_previous_text, default=True)
    return resolved


def resolve_model(args: argparse.Namespace, backend: str) -> str:
    if args.model.strip():
        return args.model.strip()
    defaults = {
        "fast": "turbo",
        "balanced": "medium",
        "accurate": "large-v3",
    }
    return defaults.get(args.preset, defaults[DEFAULT_PRESET])


def summarize_transcript_quality(payload: dict) -> dict[str, int | float | None]:
    segments = payload.get("segments") or []
    low_confidence = 0
    high_no_speech = 0
    logprobs: list[float] = []
    compression_ratios: list[float] = []
    duration_seconds = 0.0
    for segment in segments:
        avg_logprob = segment.get("avg_logprob")
        compression_ratio = segment.get("compression_ratio")
        no_speech_prob = segment.get("no_speech_prob")
        duration = segment.get("duration")
        if isinstance(avg_logprob, (int, float)):
            logprobs.append(float(avg_logprob))
            if float(avg_logprob) < -1.0:
                low_confidence += 1
        if isinstance(compression_ratio, (int, float)):
            compression_ratios.append(float(compression_ratio))
        if isinstance(no_speech_prob, (int, float)) and float(no_speech_prob) > 0.6:
            high_no_speech += 1
        if isinstance(duration, (int, float)):
            duration_seconds += float(duration)
    return {
        "segment_count": len(segments),
        "speaker_count": payload.get("speaker_count"),
        "duration_seconds": round(duration_seconds, 3) if duration_seconds else None,
        "avg_logprob_mean": round(sum(logprobs) / len(logprobs), 4) if logprobs else None,
        "max_compression_ratio": round(max(compression_ratios), 4) if compression_ratios else None,
        "low_confidence_segments": low_confidence,
        "high_no_speech_segments": high_no_speech,
    }


def safe_output_stem(source_path: Path) -> str:
    candidate = re.sub(r"[^A-Za-z0-9]+", "-", source_path.stem).strip("-").lower()
    return candidate or "transcript"


def generated_paths_for(output_stem: str, tmp_path: Path) -> dict[str, Path]:
    return {
        "txt": tmp_path / f"{output_stem}.txt",
        "json": tmp_path / f"{output_stem}.json",
        "srt": tmp_path / f"{output_stem}.srt",
        "vtt": tmp_path / f"{output_stem}.vtt",
        "tsv": tmp_path / f"{output_stem}.tsv",
    }


def assign_speaker(start: float | None, end: float | None, diarization_turns: list[dict]) -> str | None:
    if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
        return None
    best_speaker = None
    best_overlap = 0.0
    for turn in diarization_turns:
        turn_start = turn.get("start")
        turn_end = turn.get("end")
        speaker = turn.get("speaker")
        if not isinstance(turn_start, (int, float)) or not isinstance(turn_end, (int, float)) or not speaker:
            continue
        overlap = max(0.0, min(end, turn_end) - max(start, turn_start))
        if overlap > best_overlap:
            best_overlap = overlap
            best_speaker = str(speaker)
    return best_speaker


def prepare_diarization_audio(source_path: Path) -> tuple[Path, tempfile.TemporaryDirectory[str] | None]:
    if source_path.suffix.lower() == ".wav":
        return source_path, None

    ffmpeg_bin = shutil.which("ffmpeg")
    if not ffmpeg_bin:
        raise RuntimeError("ffmpeg is required to normalize diarization audio inputs")

    temp_dir = tempfile.TemporaryDirectory(prefix="ru-diarization-audio-")
    normalized_path = Path(temp_dir.name) / f"{safe_output_stem(source_path)}.wav"
    cmd = [
        ffmpeg_bin,
        "-y",
        "-i",
        str(source_path),
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        str(normalized_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0 or not normalized_path.exists():
        temp_dir.cleanup()
        raise RuntimeError((proc.stderr or proc.stdout).strip()[:400] or "ffmpeg failed to normalize diarization audio")
    return normalized_path, temp_dir


def run_pyannote_diarization(args: argparse.Namespace, *, source_path: Path) -> dict:
    resolved_token = resolve_huggingface_token(args.diarization_auth_token)
    if not resolved_token:
        raise RuntimeError("pyannote diarization requested without RU_PYANNOTE_TOKEN")
    if not pyannote_available():
        raise RuntimeError("pyannote.audio is not installed")

    pipeline_module = importlib.import_module("pyannote.audio.core.pipeline")
    model_module = importlib.import_module("pyannote.audio.core.model")
    huggingface_hub = importlib.import_module("huggingface_hub")

    def compat_hf_hub_download(*download_args, **download_kwargs):
        if "use_auth_token" in download_kwargs and "token" not in download_kwargs:
            download_kwargs["token"] = download_kwargs.pop("use_auth_token")
        else:
            download_kwargs.pop("use_auth_token", None)
        return huggingface_hub.hf_hub_download(*download_args, **download_kwargs)

    pipeline_module.hf_hub_download = compat_hf_hub_download
    model_module.hf_hub_download = compat_hf_hub_download

    config_path = Path(
        compat_hf_hub_download(
            "pyannote/speaker-diarization-3.1",
            "config.yaml",
            token=resolved_token,
        )
    )
    pipeline_config = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    dependencies = (pipeline_config.get("pipeline") or {}).get("params") or {}
    for dependency_key in ("segmentation", "embedding"):
        dependency_repo = dependencies.get(dependency_key)
        if not isinstance(dependency_repo, str) or "/" not in dependency_repo:
            continue
        try:
            compat_hf_hub_download(dependency_repo, "config.yaml", token=resolved_token)
        except Exception as exc:
            raise RuntimeError(
                f"Access denied for diarization dependency '{dependency_repo}'. Accept or request approval on hf.co and retry. Root error: {str(exc)[:400]}"
            ) from exc

    Pipeline = importlib.import_module("pyannote.audio").Pipeline
    with temporary_env(
        {
            "HF_TOKEN": resolved_token,
            "HUGGINGFACE_HUB_TOKEN": resolved_token,
        }
    ):
        pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1")
        if pipeline is None:
            raise RuntimeError(
                "Could not load pyannote/speaker-diarization-3.1. The Hugging Face token is present, but the model is still gated or unauthorized. Accept the model terms on hf.co and retry."
            )

        diarization_kwargs: dict[str, int] = {}
        if args.min_speakers > 0:
            diarization_kwargs["min_speakers"] = args.min_speakers
        if args.max_speakers > 0:
            diarization_kwargs["max_speakers"] = args.max_speakers

        prepared_source_path, temp_dir = prepare_diarization_audio(source_path)
        try:
            diarization = pipeline(str(prepared_source_path), **diarization_kwargs)
            turns = []
            speakers: set[str] = set()
            for segment, _, speaker in diarization.itertracks(yield_label=True):
                speaker_label = str(speaker)
                speakers.add(speaker_label)
                turns.append(
                    {
                        "speaker": speaker_label,
                        "start": round(float(segment.start), 3),
                        "end": round(float(segment.end), 3),
                        "duration": round(float(segment.end - segment.start), 3),
                    }
                )
        finally:
            if temp_dir is not None:
                temp_dir.cleanup()

    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "backend": "pyannote",
        "speaker_count": len(speakers),
        "speakers": sorted(speakers),
        "turns": turns,
    }


def run_whisper_backend(
    args: argparse.Namespace,
    *,
    source_path: Path,
    tmp_path: Path,
) -> tuple[dict[str, Path], str]:
    whisper_bin = ensure_binary(args.whisper_bin)
    resolved_model = resolve_model(args, "whisper")
    decoder = resolve_decoder_options(args)
    cmd = [
        whisper_bin,
        str(source_path),
        "--model",
        resolved_model,
        "--task",
        args.task,
        "--language",
        args.language,
        "--output_format",
        "all",
        "--output_dir",
        str(tmp_path),
    ]
    if decoder["temperature"]:
        cmd.extend(["--temperature", str(decoder["temperature"])])
    if decoder["best_of"]:
        cmd.extend(["--best_of", str(decoder["best_of"])])
    if decoder["beam_size"]:
        cmd.extend(["--beam_size", str(decoder["beam_size"])])
    if decoder["patience"]:
        cmd.extend(["--patience", str(decoder["patience"])])
    cmd.extend(["--condition_on_previous_text", "True" if decoder["condition_on_previous_text"] else "False"])
    if args.initial_prompt:
        cmd.extend(["--initial_prompt", args.initial_prompt])
    if parse_bool(args.word_timestamps, default=True):
        cmd.extend(["--word_timestamps", "True"])
    if os.environ.get("RU_WHISPER_FP16", "").lower() in {"0", "false", "no"}:
        cmd.extend(["--fp16", "False"])

    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout).strip()[:400] or "whisper failed")
    return generated_paths_for(source_path.stem, tmp_path), resolved_model


def run_mlx_backend(
    args: argparse.Namespace,
    *,
    source_path: Path,
    tmp_path: Path,
) -> tuple[dict[str, Path], str]:
    requested_model = resolve_mlx_model(resolve_model(args, "mlx"))
    decoder = resolve_decoder_options(args)
    output_name = safe_output_stem(source_path)
    if shutil.which(args.mlx_whisper_bin) or Path(args.mlx_whisper_bin).exists():
        cli_cmd = [shutil.which(args.mlx_whisper_bin) or args.mlx_whisper_bin]
    elif mlx_available(args):
        cli_cmd = [sys.executable, "-m", "mlx_whisper.cli"]
    else:
        raise SystemExit("MLX Whisper backend requested, but mlx_whisper is not installed")

    cmd = [
        *cli_cmd,
        str(source_path),
        "--model",
        requested_model,
        "--task",
        args.task,
        "--language",
        args.language,
        "--output-format",
        "all",
        "--output-dir",
        str(tmp_path),
        "--output-name",
        output_name,
        "--verbose",
        "False",
        "--word-timestamps",
        "True" if parse_bool(args.word_timestamps, default=True) else "False",
    ]
    if decoder["temperature"]:
        cmd.extend(["--temperature", str(decoder["temperature"])])
    if decoder["best_of"]:
        cmd.extend(["--best-of", str(decoder["best_of"])])
    cmd.extend(["--condition-on-previous-text", "True" if decoder["condition_on_previous_text"] else "False"])
    if args.initial_prompt:
        cmd.extend(["--initial-prompt", args.initial_prompt])
    if os.environ.get("RU_WHISPER_FP16", "").lower() in {"0", "false", "no"}:
        cmd.extend(["--fp16", "False"])

    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        error_text = (proc.stderr or proc.stdout).strip()
        fallback_model = DEFAULT_MLX_MODEL_REPOS["large-v3-turbo"]
        should_retry = (
            requested_model != fallback_model
            and any(marker in error_text.lower() for marker in ("repository not found", "404", "401", "unauthorized"))
        )
        if should_retry:
            retry_cmd = cmd.copy()
            retry_cmd[retry_cmd.index("--model") + 1] = fallback_model
            retry_proc = subprocess.run(retry_cmd, capture_output=True, text=True)
            if retry_proc.returncode == 0:
                return generated_paths_for(output_name, tmp_path), fallback_model
            error_text = (retry_proc.stderr or retry_proc.stdout).strip() or error_text
        raise RuntimeError(error_text[:400] or "mlx_whisper failed")
    return generated_paths_for(output_name, tmp_path), requested_model


def main() -> int:
    args = parse_args()
    metadata_path = Path(args.metadata).expanduser().resolve()
    if not metadata_path.exists():
        raise SystemExit(f"Metadata file not found: {metadata_path}")

    metadata = load_json(metadata_path)
    source_path = Path(metadata["source_path"]).expanduser().resolve()
    transcript_path = Path(metadata["transcript_path"]).expanduser().resolve()
    transcript_paths = canonical_transcript_paths(metadata, transcript_path)

    if not source_path.exists():
        raise SystemExit(f"Source media not found: {source_path}")

    backend = resolve_backend(args)
    diarization_backend = resolve_diarization_backend(args)
    if backend == "whisper":
        ensure_binary(args.whisper_bin)
    elif not mlx_available(args):
        raise SystemExit("MLX Whisper backend requested, but mlx_whisper is not available")

    for path in transcript_paths.values():
        path.parent.mkdir(parents=True, exist_ok=True)
    if all(path.exists() for path in transcript_paths.values()) and not args.force:
        print(str(transcript_paths["txt"]))
        print(str(transcript_paths["json"]))
        print(str(transcript_paths["segments"]))
        return 0

    metadata["transcript_status"] = "running"
    metadata["transcript_started_at"] = datetime.now(UTC).isoformat()
    metadata["transcript_backend"] = backend
    metadata["transcript_preset"] = args.preset
    metadata["transcript_model"] = resolve_model(args, backend)
    metadata["transcript_word_timestamps"] = parse_bool(args.word_timestamps, default=True)
    metadata["transcript_decoder"] = {
        **resolve_decoder_options(args),
        "initial_prompt": bool(args.initial_prompt),
    }
    metadata["diarization_backend"] = diarization_backend
    metadata["diarization_status"] = "running" if diarization_backend != "none" else "skipped"
    save_json(metadata_path, metadata)
    update_manifest_status(metadata, "running")

    with tempfile.TemporaryDirectory(prefix="ru-whisper-") as tmp_dir:
        tmp_path = Path(tmp_dir)
        try:
            if backend == "mlx":
                generated_paths, resolved_model = run_mlx_backend(args, source_path=source_path, tmp_path=tmp_path)
            else:
                generated_paths, resolved_model = run_whisper_backend(args, source_path=source_path, tmp_path=tmp_path)
        except RuntimeError as exc:
            metadata["transcript_status"] = "failed"
            metadata["transcript_failed_at"] = datetime.now(UTC).isoformat()
            metadata["transcript_error"] = str(exc)[:1200]
            save_json(metadata_path, metadata)
            update_manifest_status(metadata, "failed")
            raise SystemExit(f"Transcription failed: {str(exc)[:400]}")

        if not generated_paths["txt"].exists():
            metadata["transcript_status"] = "failed"
            metadata["transcript_failed_at"] = datetime.now(UTC).isoformat()
            metadata["transcript_error"] = "Transcriber completed without producing a transcript file"
            save_json(metadata_path, metadata)
            update_manifest_status(metadata, "failed")
            raise SystemExit("Transcriber did not produce the expected transcript file")

        transcript_text = generated_paths["txt"].read_text(encoding="utf-8", errors="replace").strip()
        transcript_paths["txt"].write_text(transcript_text + ("\n" if transcript_text else ""), encoding="utf-8")

        whisper_json = {}
        diarization_payload = None
        if generated_paths["json"].exists():
            whisper_json = load_json(generated_paths["json"])
            copy_if_present(generated_paths["json"], transcript_paths["json"])
            if diarization_backend == "pyannote":
                try:
                    diarization_payload = run_pyannote_diarization(args, source_path=source_path)
                    save_json(transcript_paths["diarization"], diarization_payload)
                    metadata["diarization_status"] = "ready"
                    metadata["diarization_generated_at"] = datetime.now(UTC).isoformat()
                    metadata["transcript_diarization_path"] = str(transcript_paths["diarization"])
                    metadata.pop("diarization_error", None)
                except Exception as exc:
                    metadata["diarization_status"] = "failed"
                    metadata["diarization_error"] = str(exc)[:1200]
            else:
                metadata["diarization_status"] = "skipped"
                metadata["transcript_diarization_path"] = str(transcript_paths["diarization"])
            save_json(
                transcript_paths["segments"],
                normalize_transcript_json(
                    whisper_json,
                    metadata=metadata,
                    model=resolved_model,
                    language=args.language,
                    diarization_payload=diarization_payload,
                ),
            )
            metadata["transcript_quality"] = summarize_transcript_quality(load_json(transcript_paths["segments"]))
        for key in ("srt", "vtt", "tsv"):
            copy_if_present(generated_paths[key], transcript_paths[key])

    metadata["transcript_status"] = "ready"
    metadata["transcript_generated_at"] = datetime.now(UTC).isoformat()
    metadata["transcript_backend"] = backend
    metadata["transcript_model"] = resolved_model
    metadata["transcript_path"] = str(transcript_paths["txt"])
    metadata["transcript_json_path"] = str(transcript_paths["json"])
    metadata["transcript_segments_path"] = str(transcript_paths["segments"])
    metadata["transcript_diarization_path"] = str(transcript_paths["diarization"])
    metadata["transcript_srt_path"] = str(transcript_paths["srt"])
    metadata["transcript_vtt_path"] = str(transcript_paths["vtt"])
    metadata["transcript_tsv_path"] = str(transcript_paths["tsv"])
    metadata.pop("transcript_error", None)
    save_json(metadata_path, metadata)
    update_manifest_status(metadata, "ready")
    print(str(transcript_paths["txt"]))
    print(str(transcript_paths["json"]))
    print(str(transcript_paths["segments"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
