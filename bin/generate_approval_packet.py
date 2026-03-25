#!/usr/bin/env python3
"""Generate an approval packet and newsletter draft from the episode batch manifest."""

from __future__ import annotations

import argparse
import os
import re
from datetime import UTC, datetime
from pathlib import Path

from pipeline_common import (
    load_json,
    require_existing_paths,
    require_ready_statuses,
    require_fresh_upstream_stage_outputs,
    save_json,
    resolve_path,
    write_text,
    finalize_stage_outputs,
)
from pipeline_llm import (
    COPY_SYSTEM_PROMPT,
    ZAI_CODING_OPENAI_BASE_URL,
    chat_json,
    discover_llm_config,
    normalize_text,
    resolve_llm_timeout,
)
INSTAGRAM_HASHTAGS = [
    "#RomanceUnzipped",
    "#RomanceBooks",
    "#BookPodcast",
    "#Bookstagram",
]
TIKTOK_HASHTAGS = [
    "#RomanceUnzipped",
    "#BookTok",
    "#RomanceBooks",
    "#PodcastClips",
]
VOICE_RULES = [
    "Warm, smart, and genuinely bookish.",
    "Funny in a human way, never hype-driven.",
    "Curious and opinionated without rage-bait.",
    "No casino-scroll energy, no corporate filler, no generic influencer phrasing.",
    "Sound like a thoughtful text from a funny reader friend.",
]
REQUIRED_STATUSES = (
    "transcript",
    "clip_candidates",
    "rendered_clips",
    "quote_cards",
)
LEAD_CLIP_PENALTY_PATTERNS = (
    r"\bapply\b",
    r"\bopportunity\b",
    r"\bposition\b",
    r"\binterview\b",
    r"\bquestions?\b",
    r"\bemployees?\b",
    r"\bdirector\b",
    r"\btax increase\b",
    r"\bpublic safety\b",
)
LEAD_CLIP_BONUS_PATTERNS = (
    r"\bmy\b",
    r"\bi feel\b",
    r"\bi want\b",
    r"\bi love\b",
    r"\bbecause\b",
    r"\bcommunity\b",
    r"\bfamily\b",
    r"\bexcite",
    r"\bchange\b",
)


def parse_args() -> argparse.Namespace:
    default_zai_key = os.environ.get("RU_COPY_ZAI_API_KEY") or os.environ.get("ZAI_API_KEY")
    default_timeout_seconds = max(
        10,
        int(os.environ.get("RU_COPY_TIMEOUT_SECONDS", "90" if default_zai_key else "45")),
    )
    default_base_url = (
        os.environ.get("RU_COPY_LLM_BASE_URL")
        or os.environ.get("ZAI_API_BASE_URL")
        or (ZAI_CODING_OPENAI_BASE_URL if default_zai_key else None)
        or os.environ.get("RU_LLM_BASE_URL")
        or os.environ.get("OPENAI_BASE_URL")
    )
    default_api_key = (
        os.environ.get("RU_COPY_LLM_API_KEY")
        or default_zai_key
        or os.environ.get("RU_LLM_API_KEY")
        or os.environ.get("OPENAI_API_KEY")
    )
    default_model = (
        os.environ.get("RU_COPY_LLM_MODEL")
        or (os.environ.get("ZAI_MODEL") if default_zai_key else None)
        or ("glm-4.7" if default_zai_key else None)
        or os.environ.get("RU_LLM_MODEL")
        or os.environ.get("LLM_MODEL")
        or None
    )

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, help="Path to handoff manifest json")
    parser.add_argument(
        "--llm-base-url",
        default=default_base_url,
        help="OpenAI-compatible base URL for copy generation",
    )
    parser.add_argument(
        "--llm-api-key",
        default=default_api_key,
        help="API key for the OpenAI-compatible endpoint",
    )
    parser.add_argument(
        "--llm-model",
        default=default_model,
        help="Model name for copy generation",
    )
    parser.add_argument(
        "--llm-timeout-seconds",
        type=int,
        default=default_timeout_seconds,
        help="Timeout for the optional OpenAI-compatible copy generation call",
    )
    parser.add_argument("--force", action="store_true", help="Overwrite existing draft files")
    return parser.parse_args()


def transcript_excerpt(text: str, limit: int = 420) -> str:
    clean = re.sub(r"\s+", " ", text).strip()
    if len(clean) <= limit:
        return clean
    return clean[: limit - 3].rstrip() + "..."


def shorten(text: str, limit: int) -> str:
    clean = normalize_text(text)
    if len(clean) <= limit:
        return clean
    return clean[: limit - 3].rstrip() + "..."


def sanitize_multiline(text: str, *, max_chars: int) -> str:
    clean = normalize_text(text)
    if len(clean) <= max_chars:
        return clean
    return clean[: max_chars - 3].rstrip() + "..."


def sanitize_hashtags(values: object, *, fallback: list[str], max_items: int) -> list[str]:
    if not isinstance(values, list):
        return fallback[:max_items]
    normalized = []
    seen = set()
    for raw in values:
        tag = normalize_text(str(raw or ""))
        if not tag:
            continue
        if not tag.startswith("#"):
            tag = "#" + re.sub(r"\s+", "", tag)
        if tag.lower() in seen:
            continue
        seen.add(tag.lower())
        normalized.append(tag)
        if len(normalized) >= max_items:
            break
    return normalized or fallback[:max_items]


def ensure_outputs_writable(paths: list[Path], *, force: bool, context: str) -> None:
    if force:
        return
    existing = [str(path) for path in paths if path.exists()]
    if existing:
        raise SystemExit(f"{context} outputs already exist; re-run with --force to overwrite: {', '.join(existing)}")


def load_context(manifest: dict, manifest_path: Path) -> dict:
    source = manifest["source"]
    social_target = manifest["targets"]["social_poster"]
    clip_target = manifest["targets"]["clip_extractor"]

    transcript_path = Path(source["transcript_path"]).expanduser().resolve()
    clip_candidates_json_path = Path(clip_target["clip_candidates_json_path"]).expanduser().resolve()
    rendered_clips_json_path = Path(clip_target["rendered_clips_json_path"]).expanduser().resolve()
    quote_cards_json_path = Path(clip_target["quote_cards_json_path"]).expanduser().resolve()

    require_existing_paths(
        {
            "transcript": transcript_path,
            "clip candidates": clip_candidates_json_path,
            "rendered clips": rendered_clips_json_path,
            "quote cards": quote_cards_json_path,
        },
        context="Approval packet",
    )

    transcript = transcript_path.read_text(encoding="utf-8", errors="replace").strip()
    clips = load_json(clip_candidates_json_path).get("clip_candidates") or []
    rendered = load_json(rendered_clips_json_path).get("rendered_clips") or []
    quote_cards = load_json(quote_cards_json_path).get("quote_cards") or []
    if not clips:
        raise SystemExit("Clip candidates are required before approval packet generation")
    if not rendered:
        raise SystemExit("Rendered clips are required before approval packet generation")
    if not quote_cards:
        raise SystemExit("Quote cards are required before approval packet generation")

    speaker_roster = sorted(
        {
            str(speaker).strip()
            for clip in clips
            for speaker in (clip.get("speakers") or [])
            if str(speaker).strip()
        }
    )

    lead_index = pick_lead_index(clips)
    lead_clip = clips[lead_index]
    lead_render = rendered[lead_index] if lead_index < len(rendered) else rendered[0]
    lead_quote = quote_cards[lead_index] if lead_index < len(quote_cards) else quote_cards[0]

    return {
        "episode_id": manifest.get("episode_id", "unknown-episode"),
        "title": manifest.get("title", manifest.get("episode_id", "unknown-episode")),
        "manifest_path": str(manifest_path),
        "transcript_path": str(transcript_path),
        "transcript_excerpt": transcript_excerpt(transcript or "Transcript pending."),
        "lead_clip": {
            "slot": lead_clip.get("slot"),
            "start": lead_clip.get("start"),
            "end": lead_clip.get("end"),
            "hook": lead_clip.get("hook"),
            "excerpt": shorten(str(lead_clip.get("excerpt") or ""), 320),
            "speakers": lead_clip.get("speakers") or [],
            "selection_reason": lead_clip.get("selection_reason"),
            "lead_selection_reason": lead_clip.get("lead_selection_reason"),
        },
        "lead_render": {
            "slot": lead_render.get("slot") or lead_render.get("clip_id") or lead_clip.get("slot"),
            "clip_id": lead_render.get("clip_id") or lead_render.get("slot") or lead_clip.get("slot"),
            "mode": lead_render.get("mode"),
            "preview_path": str(lead_render.get("preview_path") or ""),
            "audio_path": str(lead_render.get("audio_path") or ""),
            "video_path": str(lead_render.get("video_path") or ""),
            "subtitles_path": str(lead_render.get("subtitles_path") or ""),
        },
        "lead_quote": {
            "id": lead_quote.get("id"),
            "text": shorten(str(lead_quote.get("text") or ""), 180),
            "asset_stub_path": str(lead_quote.get("asset_stub_path") or ""),
        },
        "voice_rules": VOICE_RULES,
        "speaker_roster": speaker_roster,
    }


def score_lead_candidate(clip: dict) -> float:
    text = normalize_text(str(clip.get("excerpt") or "")).lower()
    if not text:
        return float("-inf")
    score = float(clip.get("score") or 0.0)
    for pattern in LEAD_CLIP_BONUS_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            score += 0.4
    for pattern in LEAD_CLIP_PENALTY_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            score -= 0.8
    if len(text.split()) < 18:
        score -= 0.4
    if "?" in text:
        score += 0.2
    return score


def pick_lead_index(clips: list[dict]) -> int:
    best_index = 0
    best_score = float("-inf")
    for index, clip in enumerate(clips):
        candidate_score = score_lead_candidate(clip)
        if candidate_score > best_score:
            best_index = index
            best_score = candidate_score
    if clips:
        clips[best_index]["lead_selection_reason"] = "Chosen for strongest human-stakes copy context."
    return best_index


def fallback_copy_bundle(context: dict) -> dict:
    hook = shorten(context["lead_clip"]["hook"] or context["lead_clip"]["excerpt"], 90)
    quote = context["lead_quote"]["text"]
    transcript_snippet = context["transcript_excerpt"]
    title = context["title"]
    return {
        "generation": {
            "mode": "fallback",
            "provider": "deterministic",
            "model": None,
            "fallback_reason": "llm_unavailable",
        },
        "lead_asset": {
            "slot": context["lead_clip"]["slot"],
            "clip_id": context["lead_render"]["clip_id"],
            "mode": context["lead_render"]["mode"],
            "quote_id": context["lead_quote"]["id"],
            "preview_path": context["lead_render"]["preview_path"],
            "audio_path": context["lead_render"]["audio_path"],
            "video_path": context["lead_render"]["video_path"],
            "subtitles_path": context["lead_render"]["subtitles_path"],
            "hook": hook,
        },
        "speaker_roster": context.get("speaker_roster") or [],
        "episode_angle": sanitize_multiline(
            f"{title} lands best as a warm, reader-first moment built around {hook.lower()} and the human specificity in the conversation.",
            max_chars=180,
        ),
        "instagram": {
            "hook": hook,
            "caption": sanitize_multiline(
                f"{quote} This is the kind of moment Romance Unzipped is built for: specific, funny, and just a little unguarded. Full episode energy lives in the clip, but the bigger conversation keeps unfolding from there.",
                max_chars=420,
            ),
            "cta": "Listen to the full episode, then tell us which line you would send to a reader friend.",
            "hashtags": INSTAGRAM_HASHTAGS,
        },
        "facebook": {
            "copy": sanitize_multiline(
                f"We pulled one of the most shareable moments from this week's Romance Unzipped conversation: \"{quote}\". The full episode keeps that same warm, candid energy without drifting into promo voice.",
                max_chars=420,
            ),
            "cta": "Drop your take in the comments, then catch the full episode.",
        },
        "tiktok": {
            "hook": shorten(hook, 70),
            "caption": sanitize_multiline(
                f"{quote} If you like your romance talk funny, specific, and a little too honest, start here.",
                max_chars=220,
            ),
            "cta": "Watch the clip, then go listen to the whole conversation.",
            "hashtags": TIKTOK_HASHTAGS,
        },
        "newsletter": {
            "subject": shorten(f"Romance Unzipped: {hook}", 60),
            "preview": shorten("A warm, candid episode moment worth sending to another romance reader.", 90),
            "episode_spotlight": sanitize_multiline(
                f"This week's episode opens up around {hook.lower()}, then keeps moving through the same mix of honesty, chemistry, and reader specificity. {transcript_snippet}",
                max_chars=520,
            ),
            "recommendation_stub": "Add one romance read that matches the same emotional texture or trope energy as this episode.",
            "community_question": "What line or dynamic from this episode would make you send it straight to a reader friend?",
        },
    }


def normalize_copy_bundle(raw: dict, *, context: dict, mode: str, provider: str, model: str | None, fallback_reason: str | None) -> dict | None:
    if not isinstance(raw, dict):
        return None
    instagram = raw.get("instagram")
    facebook = raw.get("facebook")
    tiktok = raw.get("tiktok")
    newsletter = raw.get("newsletter")
    if not all(isinstance(item, dict) for item in (instagram, facebook, tiktok, newsletter)):
        return None

    episode_angle = sanitize_multiline(str(raw.get("episode_angle") or ""), max_chars=180)
    if not episode_angle:
        return None

    return {
        "generation": {
            "mode": mode,
            "provider": provider,
            "model": model,
            "fallback_reason": fallback_reason,
        },
        "lead_asset": {
            "slot": context["lead_clip"]["slot"],
            "clip_id": context["lead_render"]["clip_id"],
            "mode": context["lead_render"]["mode"],
            "quote_id": context["lead_quote"]["id"],
            "preview_path": context["lead_render"]["preview_path"],
            "audio_path": context["lead_render"]["audio_path"],
            "video_path": context["lead_render"]["video_path"],
            "subtitles_path": context["lead_render"]["subtitles_path"],
            "hook": sanitize_multiline(str(instagram.get("hook") or ""), max_chars=90),
        },
        "speaker_roster": context.get("speaker_roster") or [],
        "episode_angle": episode_angle,
        "instagram": {
            "hook": sanitize_multiline(str(instagram.get("hook") or ""), max_chars=90),
            "caption": sanitize_multiline(str(instagram.get("caption") or ""), max_chars=420),
            "cta": sanitize_multiline(str(instagram.get("cta") or ""), max_chars=160),
            "hashtags": sanitize_hashtags(instagram.get("hashtags"), fallback=INSTAGRAM_HASHTAGS, max_items=5),
        },
        "facebook": {
            "copy": sanitize_multiline(str(facebook.get("copy") or ""), max_chars=420),
            "cta": sanitize_multiline(str(facebook.get("cta") or ""), max_chars=160),
        },
        "tiktok": {
            "hook": sanitize_multiline(str(tiktok.get("hook") or ""), max_chars=70),
            "caption": sanitize_multiline(str(tiktok.get("caption") or ""), max_chars=220),
            "cta": sanitize_multiline(str(tiktok.get("cta") or ""), max_chars=140),
            "hashtags": sanitize_hashtags(tiktok.get("hashtags"), fallback=TIKTOK_HASHTAGS, max_items=5),
        },
        "newsletter": {
            "subject": sanitize_multiline(str(newsletter.get("subject") or ""), max_chars=60),
            "preview": sanitize_multiline(str(newsletter.get("preview") or ""), max_chars=90),
            "episode_spotlight": sanitize_multiline(str(newsletter.get("episode_spotlight") or ""), max_chars=520),
            "recommendation_stub": sanitize_multiline(str(newsletter.get("recommendation_stub") or ""), max_chars=220),
            "community_question": sanitize_multiline(str(newsletter.get("community_question") or ""), max_chars=180),
        },
    }


def llm_copy_bundle(context: dict, *, base_url: str, api_key: str, model: str, timeout_seconds: int) -> dict | None:
    compact_context = {
        "episode_id": context["episode_id"],
        "title": context["title"],
        "lead_clip": {
            "slot": context["lead_clip"]["slot"],
            "hook": context["lead_clip"]["hook"],
            "excerpt": context["lead_clip"]["excerpt"],
            "speakers": context["lead_clip"].get("speakers") or [],
        },
        "lead_quote": {
            "id": context["lead_quote"]["id"],
            "text": context["lead_quote"]["text"],
        },
        "transcript_excerpt": context["transcript_excerpt"],
        "speaker_roster": context.get("speaker_roster") or [],
    }
    full_payload = {
        "task": "Write structured social and newsletter copy for Romance Unzipped.",
        "voice_rules": VOICE_RULES,
        "constraints": {
            "avoid": [
                "all-caps hype",
                "generic influencer phrasing",
                "fake urgency",
                "hashtag walls",
                "emoji spam",
                "inventing facts not present in the provided context",
            ],
            "must": [
                "sound like a thoughtful text from a funny reader friend",
                "feel warm, specific, and human",
                "keep hooks compact",
                "prefer the lead clip hook over the broader transcript excerpt when choosing the angle",
                "return one JSON object only",
            ],
        },
        "context": compact_context,
        "response_format": {
            "episode_angle": "1-2 sentence positioning summary",
            "instagram": {
                "hook": "short hook under 14 words",
                "caption": "1 short paragraph, under 420 chars",
                "cta": "single sentence",
                "hashtags": ["up to 5 hashtags"],
            },
            "facebook": {
                "copy": "1 short paragraph under 420 chars",
                "cta": "single sentence",
            },
            "tiktok": {
                "hook": "short hook under 10 words",
                "caption": "short caption under 220 chars",
                "cta": "single sentence",
                "hashtags": ["up to 5 hashtags"],
            },
            "newsletter": {
                "subject": "under 60 chars",
                "preview": "under 90 chars",
                "episode_spotlight": "short paragraph under 520 chars",
                "recommendation_stub": "one sentence, do not invent a real book title unless one appears in source",
                "community_question": "one sentence readers would actually answer",
            },
        },
    }
    reduced_payload = {
        "task": "Return compact structured copy for one Romance Unzipped episode.",
        "voice_rules": VOICE_RULES[:4],
        "context": {
            "title": compact_context["title"],
            "lead_clip": compact_context["lead_clip"],
            "lead_quote": compact_context["lead_quote"],
            "transcript_excerpt": compact_context["transcript_excerpt"],
        },
        "constraints": {
            "must": [
                "return one JSON object only",
                "keep every field concise",
                "use provided context only",
            ],
        },
        "response_format": full_payload["response_format"],
    }
    attempts = (
        (full_payload, 650, 0.2),
        (reduced_payload, 420, 0.1),
    )
    for payload, max_tokens, temperature in attempts:
        parsed = chat_json(
            base_url=base_url,
            api_key=api_key,
            model=model,
            system_prompt=COPY_SYSTEM_PROMPT,
            user_payload=payload,
            timeout_seconds=timeout_seconds,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        normalized = normalize_copy_bundle(
            parsed,
            context=context,
            mode="llm",
            provider="llm",
            model=model,
            fallback_reason=None,
        )
        if normalized is not None:
            return normalized
    return None


def render_approval_packet(copy_bundle: dict, *, context: dict, generated_at: str, approval_packet_path: Path, newsletter_draft_path: Path) -> str:
    generation = copy_bundle["generation"]
    instagram = copy_bundle["instagram"]
    facebook = copy_bundle["facebook"]
    tiktok = copy_bundle["tiktok"]
    newsletter = copy_bundle["newsletter"]
    lead_clip = context["lead_clip"]
    lead_render = context["lead_render"]
    lead_quote = context["lead_quote"]

    lines = [
        "# Approval Packet",
        "",
        f"Episode ID: `{context['episode_id']}`",
        f"Title: {context['title']}",
        f"Generated At: {generated_at}",
        f"Generation Mode: `{generation['mode']}`",
    ]
    if generation.get("model"):
        lines.append(f"Generation Model: `{generation['model']}`")
    if generation.get("fallback_reason"):
        lines.append(f"Fallback Reason: `{generation['fallback_reason']}`")
    lines.extend(
        [
            "",
            "## Source",
            "",
            f"- Transcript: `{context['transcript_path']}`",
            f"- Manifest: `{context['manifest_path']}`",
            "",
            "## Episode Angle",
            "",
            copy_bundle["episode_angle"],
            "",
            "## Lead Moment",
            "",
            f"- Clip slot: `{lead_clip['slot']}`",
            f"- Speakers: `{', '.join(lead_clip.get('speakers') or ['unknown'])}`",
            f"- Clip excerpt: {lead_clip['excerpt']}",
            f"- Selection note: {lead_clip.get('selection_reason') or 'Primary lead clip'}",
            f"- Lead choice note: {lead_clip.get('lead_selection_reason') or 'Primary copy lead'}",
            f"- Clip preview: `{lead_render['preview_path']}`",
            f"- Clip audio: `{lead_render['audio_path']}`",
            f"- Quote card: `{lead_quote['asset_stub_path']}`",
            "",
            "## Speaker Context",
            "",
            f"- Speaker labels detected: `{', '.join(context.get('speaker_roster') or ['none'])}`",
            "",
            "## Transcript Excerpt",
            "",
            f"> {context['transcript_excerpt']}",
            "",
            "## Social Draft Slots",
            "",
            "### Instagram Reel",
            f"- Status: draft",
            f"- Asset path: `{Path(approval_packet_path.parent) / 'instagram-reel.md'}`",
            f"- Hook: {instagram['hook']}",
            f"- Caption: {instagram['caption']}",
            f"- CTA: {instagram['cta']}",
            f"- Hashtags: {' '.join(instagram['hashtags'])}",
            "",
            "### Facebook Post",
            "- Status: draft",
            f"- Asset path: `{Path(approval_packet_path.parent) / 'facebook-post.md'}`",
            f"- Copy: {facebook['copy']}",
            f"- CTA: {facebook['cta']}",
            "",
            "### TikTok Post",
            "- Status: draft",
            f"- Asset path: `{Path(approval_packet_path.parent) / 'tiktok-post.md'}`",
            f"- Hook: {tiktok['hook']}",
            f"- Caption: {tiktok['caption']}",
            f"- CTA: {tiktok['cta']}",
            f"- Hashtags: {' '.join(tiktok['hashtags'])}",
            "",
            "## Newsletter Draft Preview",
            "",
            f"- Draft path: `{newsletter_draft_path}`",
            f"- Subject: {newsletter['subject']}",
            f"- Preview: {newsletter['preview']}",
            f"- Community question: {newsletter['community_question']}",
            "",
            "## Approval Checklist",
            "",
            "- [ ] Voice matches Romance Unzipped",
            "- [ ] No public publishing without approval",
            "- [ ] Platform destinations confirmed",
            "- [ ] Asset files attached or linked",
        ]
    )
    return "\n".join(lines) + "\n"


def render_newsletter_draft(copy_bundle: dict, *, context: dict, generated_at: str) -> str:
    newsletter = copy_bundle["newsletter"]
    return "\n".join(
        [
            "# Newsletter Draft",
            "",
            f"Episode ID: `{context['episode_id']}`",
            f"Title: {context['title']}",
            f"Generated At: {generated_at}",
            "",
            "## Subject Line",
            "",
            newsletter["subject"],
            "",
            "## Preview Text",
            "",
            newsletter["preview"],
            "",
            "## Episode Spotlight",
            "",
            newsletter["episode_spotlight"],
            "",
            "## Book Recommendation",
            "",
            newsletter["recommendation_stub"],
            "",
            "## Community Question",
            "",
            newsletter["community_question"],
            "",
            "## Links",
            "",
            "- Spotify:",
            "- YouTube:",
            "- Apple Podcasts:",
            "- Fable:",
        ]
    ) + "\n"


def main() -> int:
    args = parse_args()
    manifest_path = Path(args.manifest).expanduser().resolve()
    if not manifest_path.exists():
        raise SystemExit(f"Manifest file not found: {manifest_path}")

    manifest = load_json(manifest_path)
    require_ready_statuses(manifest, REQUIRED_STATUSES, context="Approval packet")
    social_target = manifest["targets"]["social_poster"]
    newsletter_target = manifest["targets"]["newsletter_agent"]

    approval_packet_path = Path(social_target["approval_packet_path"]).expanduser().resolve()
    approval_packet_json_path = Path(
        social_target.get("approval_packet_json_path") or approval_packet_path.with_suffix(".json")
    ).expanduser().resolve()
    newsletter_draft_path = Path(newsletter_target["draft_path"]).expanduser().resolve()
    newsletter_draft_json_path = Path(
        newsletter_target.get("draft_json_path") or newsletter_draft_path.with_suffix(".json")
    ).expanduser().resolve()
    ensure_outputs_writable(
        [approval_packet_path, approval_packet_json_path, newsletter_draft_path, newsletter_draft_json_path],
        force=args.force,
        context="Approval packet",
    )

    context = load_context(manifest, manifest_path)
    clip_target = manifest["targets"]["clip_extractor"]
    transcript_path = Path(context["transcript_path"]).expanduser().resolve()
    clip_candidates_json_path = Path(clip_target["clip_candidates_json_path"]).expanduser().resolve()
    rendered_clips_json_path = Path(clip_target["rendered_clips_json_path"]).expanduser().resolve()
    quote_cards_json_path = Path(clip_target["quote_cards_json_path"]).expanduser().resolve()

    # Validate freshness against each upstream stage's certified outputs
    require_fresh_upstream_stage_outputs(
        manifest, "transcript",
        {"transcript": transcript_path},
        context="Approval packet generation", force=args.force,
    )
    require_fresh_upstream_stage_outputs(
        manifest, "clip_candidates",
        {"candidates_json": clip_candidates_json_path},
        context="Approval packet generation", force=args.force,
    )
    require_fresh_upstream_stage_outputs(
        manifest, "rendered_clips",
        {"rendered_json": rendered_clips_json_path},
        context="Approval packet generation", force=args.force,
    )
    require_fresh_upstream_stage_outputs(
        manifest, "quote_cards",
        {"cards_json": quote_cards_json_path},
        context="Approval packet generation", force=args.force,
    )

    copy_bundle = None
    llm_base_url, llm_api_key, llm_model = discover_llm_config(
        args.llm_base_url,
        args.llm_api_key,
        args.llm_model,
    )
    if llm_base_url and llm_api_key and llm_model:
        copy_bundle = llm_copy_bundle(
            context,
            base_url=llm_base_url,
            api_key=llm_api_key,
            model=llm_model,
            timeout_seconds=resolve_llm_timeout(default_seconds=args.llm_timeout_seconds),
        )

    if copy_bundle is None:
        fallback_reason = "llm_generation_failed" if llm_base_url else "llm_unavailable"
        copy_bundle = fallback_copy_bundle(context)
        copy_bundle["generation"]["fallback_reason"] = fallback_reason

    generated_at = datetime.now(UTC).isoformat()
    approval_packet_body = render_approval_packet(
        copy_bundle,
        context=context,
        generated_at=generated_at,
        approval_packet_path=approval_packet_path,
        newsletter_draft_path=newsletter_draft_path,
    )
    newsletter_body = render_newsletter_draft(copy_bundle, context=context, generated_at=generated_at)

    write_text(approval_packet_path, approval_packet_body, overwrite=True)
    save_json(approval_packet_json_path, copy_bundle)
    write_text(newsletter_draft_path, newsletter_body, overwrite=True)
    save_json(
        newsletter_draft_json_path,
        {
            "generation": copy_bundle["generation"],
            "episode_id": context["episode_id"],
            "title": context["title"],
            "newsletter": copy_bundle["newsletter"],
        },
    )

    # Build upstream artifact map for provenance inputs
    upstream_inputs = {
        "transcript": transcript_path,
        "clip_candidates": clip_candidates_json_path,
        "rendered_clips": rendered_clips_json_path,
        "quote_cards": quote_cards_json_path,
    }

    finalize_stage_outputs(
        resolve_path(manifest_path),
        manifest,
        status_updates={
            "approval_packet": "ready",
            "newsletter_draft": "ready",
        },
        target_sections={
            "social_poster": {
                "approval_packet_path": str(approval_packet_path),
                "approval_packet_json_path": str(approval_packet_json_path),
            },
            "newsletter_agent": {
                "draft_path": str(newsletter_draft_path),
                "draft_json_path": str(newsletter_draft_json_path),
            },
        },
        provenance_updates={
            "approval_packet": (
                upstream_inputs,
                {
                    "approval packet": approval_packet_path,
                    "approval packet json": approval_packet_json_path,
                },
            ),
            "newsletter_draft": (
                upstream_inputs,
                {
                    "newsletter draft": newsletter_draft_path,
                    "newsletter draft json": newsletter_draft_json_path,
                },
            ),
        },
        generated_at=generated_at,
    )

    print(str(approval_packet_path))
    print(str(approval_packet_json_path))
    print(str(newsletter_draft_path))
    print(str(newsletter_draft_json_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
