#!/usr/bin/env python3
"""Generate rendered quote-card assets from quote candidates."""

from __future__ import annotations

import argparse
import math
import re
import textwrap
from datetime import UTC, datetime
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from pipeline_common import (
    load_json,
    require_existing_paths,
    require_ready_statuses,
    save_json,
    write_text,
)

CARD_WIDTH = 1080
CARD_HEIGHT = 1350
MARGIN_X = 110
MARGIN_TOP = 120
MARGIN_BOTTOM = 110
QUOTE_TEXT_WIDTH = 24
HANDLE_TEXT = "@romanceunzipped"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, help="Path to handoff manifest json")
    parser.add_argument("--force", action="store_true", help="Overwrite existing quote-card files")
    return parser.parse_args()


def slugify(text: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return normalized or "quote"


def trim_quote(text: str, limit: int = 180) -> str:
    clean = re.sub(r"\s+", " ", text).strip()
    if len(clean) <= limit:
        return clean
    return clean[: limit - 3].rstrip() + "..."


def ensure_outputs_writable(paths: list[Path], *, force: bool, context: str) -> None:
    if force:
        return
    existing = [str(path) for path in paths if path.exists()]
    if existing:
        raise SystemExit(f"{context} outputs already exist; re-run with --force to overwrite: {', '.join(existing)}")


def load_font(size: int, *, serif: bool = False, bold: bool = False) -> ImageFont.ImageFont:
    serif_candidates = (
        "/System/Library/Fonts/Supplemental/Georgia Bold.ttf",
        "/System/Library/Fonts/Supplemental/Georgia.ttf",
        "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf",
        "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
        "/System/Library/Fonts/Supplemental/Palatino.ttc",
    )
    sans_candidates = (
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Helvetica.ttc",
    )
    candidates = serif_candidates if serif else sans_candidates
    if bold:
        candidates = tuple(path for path in candidates if "Bold" in path) + tuple(path for path in candidates if "Bold" not in path)
    for candidate in candidates:
        font_path = Path(candidate)
        if font_path.exists():
            return ImageFont.truetype(str(font_path), size=size)
    return ImageFont.load_default()


def draw_gradient_background(draw: ImageDraw.ImageDraw) -> None:
    top = (249, 176, 120)
    bottom = (41, 17, 20)
    for y in range(CARD_HEIGHT):
        ratio = y / max(1, CARD_HEIGHT - 1)
        color = tuple(int(top[i] + (bottom[i] - top[i]) * ratio) for i in range(3))
        draw.line([(0, y), (CARD_WIDTH, y)], fill=color)


def draw_glow_orbs(draw: ImageDraw.ImageDraw) -> None:
    for center_x, center_y, radius, color in (
        (180, 170, 170, (255, 232, 191, 58)),
        (900, 320, 240, (255, 183, 110, 40)),
        (780, 1120, 280, (255, 106, 78, 34)),
    ):
        for step in range(radius, 0, -18):
            alpha = max(0, int(color[3] * (step / radius) ** 2))
            fill = (color[0], color[1], color[2], alpha)
            draw.ellipse(
                [(center_x - step, center_y - step), (center_x + step, center_y + step)],
                fill=fill,
            )


def fit_quote_font(quote_text: str, *, max_width: int, max_height: int) -> tuple[ImageFont.ImageFont, str, tuple[int, int, int, int]]:
    wrapped = textwrap.fill(quote_text, width=QUOTE_TEXT_WIDTH)
    for size in range(86, 45, -4):
        font = load_font(size, serif=True, bold=False)
        temp = Image.new("RGBA", (CARD_WIDTH, CARD_HEIGHT), (0, 0, 0, 0))
        draw = ImageDraw.Draw(temp)
        bbox = draw.multiline_textbbox((0, 0), wrapped, font=font, spacing=18, align="left")
        width = bbox[2] - bbox[0]
        height = bbox[3] - bbox[1]
        if width <= max_width and height <= max_height:
            return font, wrapped, bbox
    font = load_font(46, serif=True, bold=False)
    temp = Image.new("RGBA", (CARD_WIDTH, CARD_HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(temp)
    bbox = draw.multiline_textbbox((0, 0), wrapped, font=font, spacing=16, align="left")
    return font, wrapped, bbox


def render_quote_card(path: Path, *, quote_text: str, title: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGBA", (CARD_WIDTH, CARD_HEIGHT), (0, 0, 0, 255))
    draw = ImageDraw.Draw(image, "RGBA")
    draw_gradient_background(draw)
    draw_glow_orbs(draw)

    panel = [
        (56, 56),
        (CARD_WIDTH - 56, CARD_HEIGHT - 56),
    ]
    draw.rounded_rectangle(panel, radius=42, outline=(255, 239, 221, 120), width=3, fill=(20, 9, 15, 78))

    label_font = load_font(28, bold=True)
    handle_font = load_font(28, bold=True)
    title_font = load_font(34, bold=True)
    quote_mark_font = load_font(160, serif=True, bold=True)

    draw.text((MARGIN_X, MARGIN_TOP), "ROMANCE UNZIPPED", font=label_font, fill=(255, 235, 214, 235))
    draw.text((MARGIN_X, MARGIN_TOP + 58), "Quote card preview", font=label_font, fill=(255, 207, 171, 210))
    draw.text((MARGIN_X - 18, MARGIN_TOP + 120), "“", font=quote_mark_font, fill=(255, 214, 167, 190))

    quote_top = MARGIN_TOP + 210
    max_quote_width = CARD_WIDTH - (MARGIN_X * 2)
    max_quote_height = CARD_HEIGHT - quote_top - MARGIN_BOTTOM - 220
    quote_font, wrapped_quote, quote_bbox = fit_quote_font(
        quote_text,
        max_width=max_quote_width,
        max_height=max_quote_height,
    )
    quote_x = MARGIN_X
    quote_y = quote_top
    draw.multiline_text(
        (quote_x, quote_y),
        wrapped_quote,
        font=quote_font,
        fill=(255, 248, 241, 255),
        spacing=18,
        align="left",
    )

    footer_y = CARD_HEIGHT - MARGIN_BOTTOM - 120
    draw.line([(MARGIN_X, footer_y), (CARD_WIDTH - MARGIN_X, footer_y)], fill=(255, 223, 190, 140), width=2)
    draw.text((MARGIN_X, footer_y + 36), HANDLE_TEXT, font=handle_font, fill=(255, 227, 201, 230))

    wrapped_title = textwrap.fill(title, width=34)
    title_bbox = draw.multiline_textbbox((0, 0), wrapped_title, font=title_font, spacing=8, align="right")
    title_width = title_bbox[2] - title_bbox[0]
    draw.multiline_text(
        (CARD_WIDTH - MARGIN_X - title_width, footer_y + 30),
        wrapped_title,
        font=title_font,
        fill=(255, 208, 173, 235),
        spacing=8,
        align="right",
    )
    image.save(path)


def main() -> int:
    args = parse_args()
    manifest_path = Path(args.manifest).expanduser().resolve()
    if not manifest_path.exists():
        raise SystemExit(f"Manifest file not found: {manifest_path}")

    manifest = load_json(manifest_path)
    require_ready_statuses(manifest, ("quote_candidates",), context="Quote cards")
    status = manifest.setdefault("status", {})

    target = manifest["targets"]["clip_extractor"]
    quote_candidates_path = Path(target["quote_candidates_path"]).expanduser().resolve()
    quote_cards_path = Path(target.get("quote_cards_path") or quote_candidates_path.with_name("cards.md")).expanduser().resolve()
    quote_cards_json_path = Path(
        target.get("quote_cards_json_path") or quote_candidates_path.with_name("cards.json")
    ).expanduser().resolve()
    clip_candidates_json_path = Path(target["clip_candidates_json_path"]).expanduser().resolve()

    require_existing_paths(
        {
            "clip candidates json": clip_candidates_json_path,
            "quote candidates markdown": quote_candidates_path,
        },
        context="Quote cards",
    )

    candidates = load_json(clip_candidates_json_path)
    quote_candidates = candidates.get("quote_candidates") or []
    if not quote_candidates:
        raise SystemExit("No quote candidates available for quote-card generation")

    episode_id = manifest.get("episode_id", "unknown-episode")
    title = manifest.get("title", episode_id)
    generated_at = datetime.now(UTC).isoformat()
    cards = []
    output_paths = [quote_cards_path, quote_cards_json_path]
    for index, candidate in enumerate(quote_candidates, start=1):
        quote_text = trim_quote(str(candidate.get("text") or ""))
        if not quote_text:
            continue
        card_id = f"quote-card-{index:02d}"
        slug = slugify(quote_text[:48])
        output_paths.append(quote_cards_json_path.parent / f"{card_id}-{slug}.png")
    ensure_outputs_writable(output_paths, force=args.force, context="Quote cards")

    lines = [
        "# Quote Cards",
        "",
        f"Episode ID: `{episode_id}`",
        f"Title: {title}",
        f"Generated At: {generated_at}",
        "",
    ]

    for index, candidate in enumerate(quote_candidates, start=1):
        quote_text = trim_quote(str(candidate.get("text") or ""))
        if not quote_text:
            continue
        card_id = f"quote-card-{index:02d}"
        slug = slugify(quote_text[:48])
        asset_path = quote_cards_json_path.parent / f"{card_id}-{slug}.png"
        render_quote_card(asset_path, quote_text=quote_text, title=title)
        card = {
            "id": card_id,
            "quote_slot": candidate.get("slot") or f"quote-{index:02d}",
            "text": quote_text,
            "theme": "warm-neon-romance",
            "format": "1080x1350",
            "asset_path": str(asset_path),
            "asset_stub_path": str(asset_path),
            "rendered": True,
            "overlay": {
                "show_title": title,
                "show_handle": HANDLE_TEXT,
            },
            "notes": [
                "Rendered PNG ready for board review",
                "High-contrast serif treatment for mobile readability",
                "Preserve authentic tone; do not exaggerate the quote",
            ],
        }
        cards.append(card)
        lines.extend(
            [
                f"## {card_id}",
                f"- Quote slot: `{card['quote_slot']}`",
                f"- Format: `{card['format']}`",
                f"- Theme: `{card['theme']}`",
                f"- Asset: `{card['asset_path']}`",
                f"- Text: {card['text']}",
                "- Notes:",
                "  - Rendered PNG ready for board review",
                "  - High-contrast serif treatment for mobile readability",
                "  - Preserve authentic tone; do not exaggerate the quote",
                "",
            ]
        )

    if not cards:
        raise SystemExit("Quote candidates were present but no quote cards could be generated")

    payload = {
        "episode_id": episode_id,
        "title": title,
        "generated_at": generated_at,
        "quote_cards": cards,
    }

    write_text(quote_cards_path, "\n".join(lines), overwrite=True)
    save_json(quote_cards_json_path, payload)

    target["quote_cards_path"] = str(quote_cards_path)
    target["quote_cards_json_path"] = str(quote_cards_json_path)
    status["quote_cards"] = "ready"
    manifest["updated_at"] = generated_at
    save_json(manifest_path, manifest)

    print(str(quote_cards_path))
    print(str(quote_cards_json_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
