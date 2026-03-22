#!/usr/bin/env python3
"""Generate deterministic clip and quote candidate drafts from a transcript manifest."""

from __future__ import annotations

import argparse
import json
import os
import re
from datetime import UTC, datetime
from pathlib import Path

from pipeline_common import load_json, write_text, save_json
from pipeline_llm import (
    ZAI_CODING_OPENAI_BASE_URL,
    chat_json,
    default_llm_api_key,
    discover_llm_config,
    normalize_text,
)

DEFAULT_LLM_TIMEOUT_SECONDS = max(
    5,
    int(
        os.environ.get(
            "RU_CLIP_LLM_TIMEOUT_SECONDS",
            os.environ.get("RU_LLM_TIMEOUT_SECONDS", "45" if (os.environ.get("RU_CLIP_ZAI_API_KEY") or os.environ.get("ZAI_API_KEY")) else "20"),
        )
    ),
)
DEFAULT_LLM_SHORTLIST_SIZE = max(4, int(os.environ.get("RU_CLIP_LLM_SHORTLIST_SIZE", "6")))
BOILERPLATE_PATTERNS = (
    r"\bthank(s| you)? for (applying|your patience|interviewing)\b",
    r"\bwe('ve| have) got\b",
    r"\bseries of \d+ questions\b",
    r"\bkeep an eye on time\b",
    r"\bgo around the room\b",
    r"\bintroduce (yourself|themselves)\b",
    r"\bminutes? to spend with you\b",
    r"\bposition\b",
    r"\bcurrent position\b",
    r"\bexecutive director\b",
    r"\bworked my way through\b",
    r"\btraining and development manager\b",
    r"\bunderwent a consolidation\b",
    r"\blooking for an opportunity\b",
    r"\bskills and the knowledge\b",
)
INTERVIEW_PROMPT_PATTERNS = (
    r"\bthank(s| you)? for being here\b",
    r"\bbrief overview\b",
    r"\bbased on your understanding\b",
    r"\bwhat do you see as\b",
    r"\bhow would you\b",
    r"\bhow have you\b",
    r"\bcan you please\b",
    r"\bcan you talk\b",
    r"\bcan you tell us\b",
    r"\bplease take a few minutes\b",
    r"\btop challenges?\b",
    r"\bserving as the next\b",
    r"\bpublic trust\b",
    r"\bpromote transparency\b",
    r"\btechnology transitions?\b",
    r"\borganizational change\b",
    r"\bmaintaining morale\b",
)
INSTITUTIONAL_CONTEXT_PATTERNS = (
    r"\bcity council\b",
    r"\bpolice chief\b",
    r"\bpublic safety\b",
    r"\bboard\b",
    r"\bagency\b",
    r"\boperations?\b",
    r"\bexecutive director\b",
    r"\btransparency\b",
    r"\baccountability\b",
    r"\bmission focus\b",
)
PERSONAL_STAKES_PATTERNS = (
    r"\bmy son\b",
    r"\bmy daughter\b",
    r"\bmy family\b",
    r"\bi feel\b",
    r"\bi love\b",
    r"\bi wanted\b",
    r"\bi want\b",
    r"\bi'm at the point\b",
    r"\bstruggle\b",
    r"\bhard\b",
    r"\bchange\b",
    r"\bbecause\b",
)
ANSWER_MOMENT_PATTERNS = (
    r"\bone of the reasons\b",
    r"\bthe biggest thing\b",
    r"\bi think\b",
    r"\bi learned\b",
    r"\bi realized\b",
    r"\bwhat i have done\b",
    r"\bwhat i've done\b",
    r"\bi started\b",
    r"\bi've been\b",
    r"\bfor me\b",
    r"\bfor people\b",
    r"\bit's really important\b",
)


def parse_args() -> argparse.Namespace:
    default_zai_key = os.environ.get("RU_CLIP_ZAI_API_KEY") or os.environ.get("ZAI_API_KEY")
    default_base_url = (
        os.environ.get("RU_CLIP_LLM_BASE_URL")
        or os.environ.get("ZAI_API_BASE_URL")
        or (ZAI_CODING_OPENAI_BASE_URL if default_zai_key else None)
        or os.environ.get("RU_LLM_BASE_URL")
        or os.environ.get("OPENAI_BASE_URL")
    )
    default_api_key = (
        os.environ.get("RU_CLIP_LLM_API_KEY")
        or default_zai_key
        or os.environ.get("RU_LLM_API_KEY")
        or os.environ.get("OPENAI_API_KEY")
    )
    default_model = (
        os.environ.get("RU_CLIP_LLM_MODEL")
        or (os.environ.get("ZAI_MODEL") if default_zai_key else None)
        or ("glm-4.7" if default_zai_key else None)
        or os.environ.get("RU_LLM_MODEL")
        or os.environ.get("LLM_MODEL")
        or ""
    )
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, help="Path to handoff manifest json")
    parser.add_argument(
        "--selection-mode",
        choices=("auto", "heuristic", "llm"),
        default=os.environ.get("RU_CLIP_SELECTION_MODE", "auto"),
        help="Clip selection strategy",
    )
    parser.add_argument(
        "--llm-base-url",
        default=default_base_url,
        help="OpenAI-compatible base URL for optional clip reranking",
    )
    parser.add_argument(
        "--llm-api-key",
        default=default_api_key,
        help="API key for the OpenAI-compatible endpoint",
    )
    parser.add_argument(
        "--llm-model",
        default=default_model,
        help="Model name for optional clip reranking",
    )
    parser.add_argument(
        "--candidate-count",
        type=int,
        default=max(1, int(os.environ.get("RU_CLIP_CANDIDATE_COUNT", "5"))),
        help="Number of clip candidates to emit",
    )
    parser.add_argument(
        "--llm-timeout-seconds",
        type=int,
        default=DEFAULT_LLM_TIMEOUT_SECONDS,
        help="Timeout for the optional OpenAI-compatible reranking call",
    )
    parser.add_argument("--force", action="store_true", help="Overwrite existing candidate files")
    return parser.parse_args()

def split_sentences(text: str) -> list[str]:
    collapsed = re.sub(r"\s+", " ", text).strip()
    if not collapsed:
        return []
    parts = re.split(r"(?<=[.!?])\s+", collapsed)
    return [part.strip() for part in parts if part.strip()]

def format_timestamp(seconds: float | int | None) -> str:
    if seconds is None:
        return "manual review required"
    total = max(0, int(round(float(seconds))))
    hours, rem = divmod(total, 3600)
    minutes, secs = divmod(rem, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def duration_seconds(start: float | None, end: float | None) -> float | None:
    if start is None or end is None:
        return None
    return max(0.0, float(end) - float(start))


def load_transcript_segments(manifest: dict, transcript_path: Path) -> list[dict]:
    source = manifest.get("source") or {}
    segments_path_raw = source.get("transcript_segments_path")
    json_path_raw = source.get("transcript_json_path")

    if isinstance(segments_path_raw, str) and segments_path_raw.strip():
        segments_path = Path(segments_path_raw).expanduser().resolve()
        if segments_path.exists():
            payload = load_json(segments_path)
            segments = payload.get("segments") or []
            if isinstance(segments, list) and segments:
                return [segment for segment in segments if normalize_text(str(segment.get("text") or ""))]

    if isinstance(json_path_raw, str) and json_path_raw.strip():
        json_path = Path(json_path_raw).expanduser().resolve()
        if json_path.exists():
            payload = load_json(json_path)
            segments = []
            for index, segment in enumerate(payload.get("segments") or [], start=1):
                text = normalize_text(str(segment.get("text") or ""))
                if not text:
                    continue
                segments.append(
                    {
                        "id": segment.get("id", index - 1),
                        "index": index,
                        "start": segment.get("start"),
                        "end": segment.get("end"),
                        "text": text,
                        "words": segment.get("words") or [],
                    }
                )
            if segments:
                return segments

    transcript = transcript_path.read_text(encoding="utf-8", errors="replace").strip()
    sentences = split_sentences(transcript)
    return [
        {
            "id": index,
            "index": index + 1,
            "start": None,
            "end": None,
            "text": sentence,
            "words": [],
        }
        for index, sentence in enumerate(sentences)
        if sentence
    ]


def build_candidate_windows(segments: list[dict]) -> list[dict]:
    windows: list[dict] = []
    max_window_segments = 4
    for start_idx in range(len(segments)):
        combined: list[dict] = []
        for end_idx in range(start_idx, min(len(segments), start_idx + max_window_segments)):
            combined.append(segments[end_idx])
            text = normalize_text(" ".join(part["text"] for part in combined))
            if not text or len(text.split()) < 12:
                continue
            start = combined[0].get("start")
            end = combined[-1].get("end")
            clip_duration = duration_seconds(start, end)
            if clip_duration is not None and clip_duration > 95:
                break
            speakers = [
                str(part.get("speaker")).strip()
                for part in combined
                if str(part.get("speaker") or "").strip()
            ]
            windows.append(
                {
                    "id": f"window-{start_idx + 1:03d}-{end_idx + 1:03d}",
                    "start": start,
                    "end": end,
                    "duration": clip_duration,
                    "segment_ids": [part.get("id", idx) for idx, part in enumerate(combined)],
                    "segment_indexes": [part.get("index") for part in combined],
                    "text": text,
                    "speakers": sorted(set(speakers)),
                    "speaker_turns": speakers,
                    "word_count": len(text.split()),
                    "source_count": len(combined),
                }
            )
    return windows


def pattern_hits(text: str, patterns: tuple[str, ...]) -> int:
    return sum(1 for pattern in patterns if re.search(pattern, text, re.IGNORECASE))


def count_question_sentences(text: str) -> int:
    return len(re.findall(r"[^?]+\?", text))


def dominant_speaker_ratio(window: dict) -> float:
    turns = [speaker for speaker in window.get("speaker_turns") or [] if speaker]
    if not turns:
        return 0.0
    counts: dict[str, int] = {}
    for speaker in turns:
        counts[speaker] = counts.get(speaker, 0) + 1
    return max(counts.values()) / len(turns)


def score_window(window: dict) -> float:
    text = window["text"]
    lowered_text = text.lower()
    word_count = window["word_count"]
    duration = window.get("duration")
    start = window.get("start")
    speaker_count = len(window.get("speakers") or [])
    dominant_ratio = dominant_speaker_ratio(window)
    question_sentences = count_question_sentences(text)
    punctuation_bonus = 0.0
    punctuation_bonus += 0.15 if "?" in text else 0.0
    punctuation_bonus += 0.25 if "!" in text else 0.0
    punctuation_bonus += 0.25 if "\"" in text or "“" in text or "'" in text else 0.0
    conversational_bonus = 0.3 if re.search(r"\b(I|you|we|she|he|they)\b", text, re.IGNORECASE) else 0.0
    conversational_bonus += 0.15 if 2 <= window.get("source_count", 1) <= 3 else 0.0
    conversational_bonus += 0.25 if re.search(r"\b(i|you)\b.*\b(i|you)\b", text, re.IGNORECASE) else 0.0
    length_score = max(0.0, 1.0 - abs(word_count - 45) / 45)
    duration_score = 0.7
    if duration is not None:
        duration_score = max(0.0, 1.0 - abs(duration - 45.0) / 45.0)
        if duration < 12 or duration > 90:
            duration_score *= 0.25
        elif 18 <= duration <= 35:
            duration_score += 0.2
    boilerplate_penalty = 0.0
    boilerplate_penalty += pattern_hits(lowered_text, BOILERPLATE_PATTERNS) * 0.75
    if start is not None and float(start) < 45 and boilerplate_penalty > 0:
        boilerplate_penalty += 0.6
    interview_penalty = pattern_hits(lowered_text, INTERVIEW_PROMPT_PATTERNS) * 1.1
    institutional_penalty = pattern_hits(lowered_text, INSTITUTIONAL_CONTEXT_PATTERNS) * 0.35
    if question_sentences >= 2:
        interview_penalty += 0.6
    elif question_sentences == 1 and not re.search(r"\b(i|my|we)\b", lowered_text, re.IGNORECASE):
        interview_penalty += 0.35
    personal_stakes_bonus = 0.0
    personal_stakes_bonus += pattern_hits(lowered_text, PERSONAL_STAKES_PATTERNS) * 0.4
    answer_bonus = pattern_hits(lowered_text, ANSWER_MOMENT_PATTERNS) * 0.35
    speaker_bonus = 0.0
    if speaker_count == 1:
        speaker_bonus += 0.85
    elif speaker_count == 2:
        speaker_bonus += 0.35
    elif speaker_count >= 3:
        speaker_bonus -= 0.45
    if dominant_ratio >= 0.75:
        speaker_bonus += 0.55
    elif dominant_ratio >= 0.5:
        speaker_bonus += 0.2
    else:
        speaker_bonus -= 0.25
    if text.strip().endswith("?"):
        interview_penalty += 0.8
    if speaker_count == 1 and question_sentences == 0 and re.search(r"\b(i|my|me)\b", lowered_text, re.IGNORECASE):
        answer_bonus += 0.45
    return round(
        length_score * 1.8
        + duration_score * 1.6
        + punctuation_bonus
        + conversational_bonus
        + personal_stakes_bonus
        + answer_bonus
        + speaker_bonus
        - boilerplate_penalty
        - interview_penalty
        - institutional_penalty,
        4,
    )


def pick_diverse_windows(windows: list[dict], count: int) -> list[dict]:
    ranked = sorted(windows, key=lambda item: (item["score"], item["word_count"]), reverse=True)
    selected: list[dict] = []
    for candidate in ranked:
        if any(set(candidate["segment_indexes"]) & set(existing["segment_indexes"]) for existing in selected):
            continue
        if candidate.get("start") is not None and any(
            existing.get("start") is not None and abs(float(candidate["start"]) - float(existing["start"])) < 45
            for existing in selected
        ):
            continue
        selected.append(candidate)
        if len(selected) >= count:
            break
    return selected or ranked[:count]


def trim_excerpt(text: str, *, limit_words: int = 55, limit_chars: int = 320) -> str:
    clean = normalize_text(text)
    words = clean.split()
    if len(words) > limit_words:
        clean = " ".join(words[:limit_words]).rstrip() + " ..."
    if len(clean) > limit_chars:
        clean = clean[: limit_chars - 3].rstrip() + "..."
    return clean


def build_llm_shortlist(windows: list[dict], count: int) -> list[dict]:
    ranked = sorted(windows, key=lambda item: (item["score"], item["word_count"]), reverse=True)
    if not ranked:
        return []

    shortlist_target = max(count + 1, min(DEFAULT_LLM_SHORTLIST_SIZE, len(ranked)))
    selected: list[dict] = []

    def take_candidate(candidate: dict) -> None:
        if candidate["id"] in {item["id"] for item in selected}:
            return
        selected.append(candidate)

    top_span = ranked[: max(shortlist_target * 3, shortlist_target)]
    # Preserve the strongest overall choices first.
    for candidate in top_span[: min(2, len(top_span))]:
        take_candidate(candidate)

    # Then spread across the transcript timeline so the model can compare different moments.
    timed = [candidate for candidate in top_span if candidate.get("start") is not None]
    if timed:
        quartiles = {}
        max_start = max(float(candidate["start"]) for candidate in timed) or 1.0
        for candidate in timed:
            bucket = min(3, int((float(candidate["start"]) / max_start) * 4))
            current = quartiles.get(bucket)
            if current is None or candidate["score"] > current["score"]:
                quartiles[bucket] = candidate
        for bucket in sorted(quartiles):
            take_candidate(quartiles[bucket])

    # Finally, add more high scoring items until we hit the shortlist size.
    for candidate in top_span:
        take_candidate(candidate)
        if len(selected) >= shortlist_target:
            break

    return selected[:shortlist_target]


def rerank_with_llm(
    windows: list[dict],
    *,
    base_url: str,
    api_key: str,
    model: str,
    count: int,
    timeout_seconds: int,
) -> dict | None:
    candidate_windows = build_llm_shortlist(windows, count)
    if not candidate_windows:
        return None

    prompt = {
        "task": "Choose the strongest short-form social clip candidates from podcast transcript windows.",
        "selection_rules": [
            "Pick clips that can stand alone without full episode context.",
            "Prefer chemistry, tension, specificity, humor, surprise, or emotional clarity.",
            "Avoid repetitive exposition or low-energy setup.",
            "Avoid generic introductions, resumes, housekeeping, and moderation unless they contain a clearly surprising or emotionally revealing moment.",
            "Prefer dialogue that sounds like a compelling standalone scene, not just informational background.",
            "Prefer answer-heavy moments over interviewer question setup.",
            "Treat formal interview prompts, board moderation, and institutional framing as weak unless the window contains a strong personal turn.",
            "Return strict JSON only.",
            "Return exactly the requested number of clips if possible.",
        ],
        "requested_count": count,
        "candidates": [
            {
                "id": window["id"],
                "start": window.get("start"),
                "end": window.get("end"),
                "duration": window.get("duration"),
                "score_hint": window.get("score"),
                "speakers": window.get("speakers") or [],
                "speaker_count": len(window.get("speakers") or []),
                "excerpt": trim_excerpt(window["text"]),
            }
            for window in candidate_windows
        ],
        "response_format": {
            "clips": [
                {
                    "id": "candidate id",
                    "reason": "brief explanation",
                    "hook": "short hook phrase",
                }
            ]
        },
    }
    parsed = chat_json(
        base_url=base_url,
        api_key=api_key,
        model=model,
        system_prompt="Select podcast clip candidates. Respond with one JSON object only. Do not include analysis, markdown fences, or <think> tags.",
        user_payload=prompt,
        timeout_seconds=timeout_seconds,
        max_tokens=400,
        temperature=0.2,
    )
    if not isinstance(parsed, dict):
        return None
    clips = parsed.get("clips")
    if not isinstance(clips, list):
        return None
    ranked = []
    known = {window["id"]: window for window in candidate_windows}
    for entry in clips:
        if not isinstance(entry, dict):
            continue
        window = known.get(str(entry.get("id") or ""))
        if not window:
            continue
        ranked.append(
            {
                **window,
                "selection_mode": "llm",
                "selection_reason": normalize_text(str(entry.get("reason") or "")) or "Selected by model reranking.",
                "hook": normalize_text(str(entry.get("hook") or "")) or None,
                "llm_model": model,
            }
        )
    if not ranked:
        return None
    return {
        "windows": ranked[:count],
        "provider": "llm",
        "model": model,
    }


def trim_quote(text: str, *, limit: int = 180) -> str:
    clean = normalize_text(text)
    if len(clean) <= limit:
        return clean
    parts = split_sentences(clean)
    for part in parts:
        if 50 <= len(part) <= limit:
            return part
    return clean[: limit - 3].rstrip() + "..."


def main() -> int:
    args = parse_args()
    manifest_path = Path(args.manifest).expanduser().resolve()
    if not manifest_path.exists():
        raise SystemExit(f"Manifest file not found: {manifest_path}")

    manifest = load_json(manifest_path)
    transcript_status = str((manifest.get("status") or {}).get("transcript") or "").strip().lower()
    if transcript_status != "ready":
        raise SystemExit(f"Transcript status must be ready before candidate generation (got: {transcript_status or 'unknown'})")

    transcript_path = Path(manifest["source"]["transcript_path"]).expanduser().resolve()
    if not transcript_path.exists():
        raise SystemExit(f"Transcript file not found: {transcript_path}")

    transcript = transcript_path.read_text(encoding="utf-8", errors="replace").strip()
    segments = load_transcript_segments(manifest, transcript_path)
    if not segments:
        raise SystemExit("Transcript is empty; cannot generate clip candidates")

    windows = build_candidate_windows(segments)
    if not windows:
        raise SystemExit("Transcript segments were loaded but no clip windows could be built")
    for window in windows:
        window["score"] = score_window(window)

    selected = pick_diverse_windows(windows, args.candidate_count)
    selection_provider = "heuristic"
    selection_model = None
    selection_fallback_reason = None
    if args.selection_mode in {"auto", "llm"}:
        llm_base_url, llm_api_key, llm_model = discover_llm_config(
            args.llm_base_url,
            args.llm_api_key,
            args.llm_model or None,
        )
        if llm_base_url and llm_api_key and llm_model:
            llm_result = rerank_with_llm(
                sorted(windows, key=lambda item: item["score"], reverse=True),
                base_url=llm_base_url,
                api_key=llm_api_key,
                model=llm_model,
                count=args.candidate_count,
                timeout_seconds=args.llm_timeout_seconds,
            )
            if llm_result:
                selected = llm_result["windows"]
                selection_provider = str(llm_result["provider"])
                selection_model = str(llm_result["model"])
            elif args.selection_mode == "llm":
                raise SystemExit("LLM clip selection was requested but reranking failed")
            else:
                selection_fallback_reason = "llm_rerank_failed"
        elif args.selection_mode == "auto":
            selection_fallback_reason = "llm_unavailable"

    quote_candidates = []
    for index, window in enumerate(selected, start=1):
        quote_candidates.append(
            {
                "slot": f"quote-{index:02d}",
                "text": trim_quote(window["text"]),
                "source_clip_slot": f"clip-{index:02d}",
                "start": window.get("start"),
                "end": window.get("end"),
                "notes": "trim for shareability if needed",
            }
        )

    target = manifest["targets"]["clip_extractor"]
    clips_dir = Path(target["clips_dir"]).expanduser().resolve()
    quotes_dir = Path(target["quotes_dir"]).expanduser().resolve()
    clip_candidates_path = Path(target.get("clip_candidates_path") or clips_dir / "candidates.md").expanduser().resolve()
    clip_candidates_json_path = Path(target.get("clip_candidates_json_path") or clips_dir / "candidates.json").expanduser().resolve()
    quote_candidates_path = Path(target.get("quote_candidates_path") or quotes_dir / "candidates.md").expanduser().resolve()

    clip_markdown_lines = [
        "# Clip Candidates",
        "",
        f"Episode ID: `{manifest.get('episode_id', 'unknown')}`",
        f"Generated At: {datetime.now(UTC).isoformat()}",
        "",
    ]
    clip_json_payload = {
        "episode_id": manifest.get("episode_id"),
        "generated_at": datetime.now(UTC).isoformat(),
        "selection_mode": selection_provider,
        "selection_model": selection_model,
        "selection_fallback_reason": selection_fallback_reason,
        "segment_source": "structured" if any(segment.get("start") is not None for segment in segments) else "text-only",
        "clip_candidates": [],
        "quote_candidates": quote_candidates,
    }

    for index, window in enumerate(selected, start=1):
        start = window.get("start")
        end = window.get("end")
        clip_duration = duration_seconds(start, end)
        reason = window.get("selection_reason") or "Selected by deterministic scoring for standalone clarity and energy."
        clip_markdown_lines.extend(
            [
                f"## Clip {index}",
                f"- Slot: `clip-{index:02d}`",
                f"- Start: `{format_timestamp(start)}`",
                f"- End: `{format_timestamp(end)}`",
                f"- Duration target: `{clip_duration:.1f}s`" if clip_duration is not None else "- Duration target: `manual review required`",
                f"- Segment indexes: `{window['segment_indexes']}`",
                f"- Speakers: `{', '.join(window.get('speakers') or ['unknown'])}`",
                f"- Excerpt: {window['text']}",
                f"- Selection reason: {reason}",
                "",
            ]
        )
        clip_json_payload["clip_candidates"].append(
            {
                "slot": f"clip-{index:02d}",
                "start": start,
                "end": end,
                "duration_seconds": clip_duration,
                "excerpt": window["text"],
                "segment_indexes": window["segment_indexes"],
                "speakers": window.get("speakers") or [],
                "selection_mode": window.get("selection_mode", selection_provider),
                "selection_reason": reason,
                "hook": window.get("hook"),
                "score": window.get("score"),
                "notes": "Validate chemistry, humor, and standalone clarity before final render.",
            }
        )

    quote_markdown_lines = [
        "# Quote Candidates",
        "",
        f"Episode ID: `{manifest.get('episode_id', 'unknown')}`",
        f"Generated At: {datetime.now(UTC).isoformat()}",
        "",
    ]
    for index, candidate in enumerate(quote_candidates, start=1):
        quote_markdown_lines.extend(
            [
                f"## Quote {index}",
                f"- Slot: `quote-{index:02d}`",
                f"- Source clip: `{candidate['source_clip_slot']}`",
                f"- Time range: `{format_timestamp(candidate.get('start'))}` -> `{format_timestamp(candidate.get('end'))}`",
                f"- Speakers: `{', '.join(selected[index - 1].get('speakers') or ['unknown'])}`",
                f"- Text: {candidate['text']}",
                "- Notes: trim for shareability if needed",
                "",
            ]
        )

    write_text(clip_candidates_path, "\n".join(clip_markdown_lines), overwrite=args.force)
    write_text(quote_candidates_path, "\n".join(quote_markdown_lines), overwrite=args.force)
    clip_candidates_json_path.parent.mkdir(parents=True, exist_ok=True)
    save_json(clip_candidates_json_path, clip_json_payload)

    manifest.setdefault("targets", {}).setdefault("clip_extractor", {})
    manifest["targets"]["clip_extractor"]["clip_candidates_path"] = str(clip_candidates_path)
    manifest["targets"]["clip_extractor"]["clip_candidates_json_path"] = str(clip_candidates_json_path)
    manifest["targets"]["clip_extractor"]["quote_candidates_path"] = str(quote_candidates_path)
    manifest.setdefault("status", {})
    manifest["status"]["clip_candidates"] = "ready"
    manifest["status"]["quote_candidates"] = "ready"
    manifest["updated_at"] = datetime.now(UTC).isoformat()
    save_json(manifest_path, manifest)

    print(str(clip_candidates_path))
    print(str(clip_candidates_json_path))
    print(str(quote_candidates_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
