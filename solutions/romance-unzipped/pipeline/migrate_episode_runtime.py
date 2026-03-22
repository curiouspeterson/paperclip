#!/usr/bin/env python3
"""Migrate legacy flat pipeline artifacts into per-episode runtime directories."""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from pipeline_common import episode_runtime_dirs, load_json, save_json


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        default=str(Path.cwd() / ".runtime" / "ru-podcast"),
        help="Pipeline runtime root to migrate",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print actions without moving files")
    return parser.parse_args()


def is_under(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def move_file(path: Path, target: Path, *, dry_run: bool) -> Path:
    if not path.exists():
        return target
    if path.resolve() == target.resolve():
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        if dry_run:
            return target
        if path.is_file() or path.is_symlink():
            path.unlink()
        return target
    if dry_run:
        return target
    shutil.move(str(path), str(target))
    return target


def canonical_runtime_target(path: Path, *, runtime_root: Path, episode_root: Path) -> Path | None:
    legacy_nested_root = episode_root / "episodes" / episode_root.name
    if is_under(path, legacy_nested_root):
        return episode_root / path.relative_to(legacy_nested_root)
    if is_under(path, runtime_root) and not is_under(path, episode_root):
        return episode_root / path.relative_to(runtime_root)
    if is_under(path, episode_root):
        return path
    return None


def rewrite_json_paths(payload: object, *, runtime_root: Path, episode_root: Path, dry_run: bool) -> object:
    if isinstance(payload, dict):
        rewritten: dict[str, object] = {}
        for key, value in payload.items():
            rewritten[key] = rewrite_json_paths(value, runtime_root=runtime_root, episode_root=episode_root, dry_run=dry_run)
        return rewritten
    if isinstance(payload, list):
        return [rewrite_json_paths(item, runtime_root=runtime_root, episode_root=episode_root, dry_run=dry_run) for item in payload]
    if isinstance(payload, str):
        path = Path(payload).expanduser().resolve()
        target = canonical_runtime_target(path, runtime_root=runtime_root, episode_root=episode_root)
        if target is None:
            return payload
        if path.is_dir():
            if path.exists():
                if not dry_run and path.resolve() != target.resolve():
                    target.mkdir(parents=True, exist_ok=True)
            elif not target.exists():
                return payload
            return str(target)
        if not path.exists():
            if target.exists():
                return str(target)
            return payload
        return str(move_file(path, target, dry_run=dry_run))
    return payload


def update_manifest_paths(manifest: dict, *, runtime_root: Path, episode_root: Path, dry_run: bool) -> None:
    source = manifest.setdefault("source", {})
    source_file_keys = (
        "media_path",
        "metadata_path",
        "transcript_path",
        "transcript_json_path",
        "transcript_segments_path",
        "transcript_diarization_path",
        "transcript_srt_path",
        "transcript_vtt_path",
        "transcript_tsv_path",
    )
    for key in source_file_keys:
        raw = source.get(key)
        if not raw:
            continue
        path = Path(str(raw)).expanduser().resolve()
        target = canonical_runtime_target(path, runtime_root=runtime_root, episode_root=episode_root)
        if target is None:
            continue
        if key == "metadata_path":
            source[key] = str(target)
            continue
        if key == "media_path":
            source[key] = str(move_file(path, target, dry_run=dry_run)) if path.exists() else str(target)
            continue
        source[key] = str(move_file(path, target, dry_run=dry_run)) if path.exists() else str(target)

    targets = manifest.setdefault("targets", {})

    def rewrite(node: dict) -> None:
        for key, value in node.items():
            if isinstance(value, dict):
                rewrite(value)
                continue
            if not isinstance(value, str):
                continue
            path = Path(value).expanduser().resolve()
            target = canonical_runtime_target(path, runtime_root=runtime_root, episode_root=episode_root)
            if target is None:
                continue
            if key.endswith("_dir"):
                if path.exists() and not dry_run and path.resolve() != target.resolve():
                    target.mkdir(parents=True, exist_ok=True)
                elif not path.exists() and not target.exists():
                    continue
                node[key] = str(target)
            elif key.endswith("_path"):
                node[key] = str(move_file(path, target, dry_run=dry_run)) if path.exists() else str(target)

    rewrite(targets)

    runtime = manifest.setdefault("runtime", {})
    runtime["root_path"] = str(runtime_root)
    runtime["episode_root_path"] = str(episode_root)


def collect_json_artifacts(node: object) -> set[Path]:
    paths: set[Path] = set()
    if isinstance(node, dict):
        for key, value in node.items():
            if isinstance(value, dict):
                paths.update(collect_json_artifacts(value))
            elif isinstance(value, str) and (key.endswith("_json_path") or value.endswith(".json")):
                paths.add(Path(value).expanduser().resolve())
    return paths


def migrate_episode(runtime_root: Path, metadata_path: Path, *, dry_run: bool) -> bool:
    metadata = load_json(metadata_path)
    episode_id = str(metadata.get("episode_id") or "").strip()
    if not episode_id:
        return False

    dirs = episode_runtime_dirs(runtime_root, episode_id)
    episode_root = dirs["episode_root"]
    metadata_dir = dirs["metadata_dir"]
    manifests_dir = dirs["manifests_dir"]
    input_dir = dirs["input_dir"]
    transcripts_dir = dirs["transcripts_dir"]
    assets_dir = dirs["assets_dir"]

    manifest_path_value = metadata.get("manifest_path")
    if not manifest_path_value:
        return False
    manifest_path = Path(str(manifest_path_value)).expanduser().resolve()
    if not manifest_path.exists():
        return False

    if not dry_run:
        for directory in [episode_root, metadata_dir, manifests_dir, input_dir, transcripts_dir, assets_dir]:
            directory.mkdir(parents=True, exist_ok=True)
        for subdir in ("clips", "quotes", "audiograms", "social", "newsletter", "ops"):
            (assets_dir / subdir).mkdir(parents=True, exist_ok=True)

    manifest = load_json(manifest_path)
    update_manifest_paths(manifest, runtime_root=runtime_root, episode_root=episode_root, dry_run=dry_run)

    for json_path in sorted(collect_json_artifacts(manifest)):
        if not json_path.exists() or not is_under(json_path, runtime_root):
            continue
        payload = load_json(json_path)
        rewritten_payload = rewrite_json_paths(
            payload,
            runtime_root=runtime_root,
            episode_root=episode_root,
            dry_run=dry_run,
        )
        if dry_run:
            print(f"rewrite {json_path}")
        else:
            save_json(json_path, rewritten_payload)  # type: ignore[arg-type]

    source_path = Path(str(metadata.get("source_path") or manifest["source"]["media_path"])).expanduser().resolve()
    new_source_path = canonical_runtime_target(source_path, runtime_root=runtime_root, episode_root=episode_root)
    if new_source_path is None:
        new_source_path = Path(str(manifest["source"]["media_path"])).expanduser().resolve()
    elif source_path.exists():
        if not dry_run and source_path.resolve() != new_source_path.resolve():
            new_source_path.parent.mkdir(parents=True, exist_ok=True)
        new_source_path = move_file(source_path, new_source_path, dry_run=dry_run)

    metadata_updates = {
        "source_path": str(new_source_path),
        "input_path": str(new_source_path),
        "manifest_path": str(episode_root / "manifests" / manifest_path.name),
    }
    if metadata.get("metadata_path"):
        metadata_updates["metadata_path"] = str(episode_root / "metadata" / Path(str(metadata["metadata_path"])).name)
    if "assets_dir" in metadata:
        metadata_updates["assets_dir"] = str(episode_root / "assets")
    if "transcripts_dir" in metadata:
        metadata_updates["transcripts_dir"] = str(episode_root / "transcripts")
    if "manifests_dir" in metadata:
        metadata_updates["manifests_dir"] = str(episode_root / "manifests")

    metadata.update(metadata_updates)
    metadata["manifest_generated_at"] = metadata.get("manifest_generated_at") or metadata.get("detected_at")
    metadata["status"] = metadata.get("status", "ready_for_handoff")

    new_metadata_path = episode_root / "metadata" / metadata_path.name
    new_manifest_path = episode_root / "manifests" / manifest_path.name

    if dry_run:
        print(f"migrate {metadata_path} -> {new_metadata_path}")
        print(f"migrate {manifest_path} -> {new_manifest_path}")
        return True

    new_metadata_path.parent.mkdir(parents=True, exist_ok=True)
    new_manifest_path.parent.mkdir(parents=True, exist_ok=True)
    save_json(new_metadata_path, metadata)
    save_json(new_manifest_path, manifest)

    if metadata_path != new_metadata_path and metadata_path.exists():
        metadata_path.unlink()
    if manifest_path != new_manifest_path and manifest_path.exists():
        manifest_path.unlink()

    return True


def cleanup_empty_dirs(root: Path) -> None:
    for name in ("metadata", "manifests", "transcripts", "assets", "input"):
        candidate = root / name
        if candidate.exists() and candidate.is_dir():
            try:
                candidate.rmdir()
            except OSError:
                pass


def main() -> int:
    args = parse_args()
    runtime_root = Path(args.root).expanduser().resolve()
    metadata_dirs = []
    legacy_metadata_dir = runtime_root / "metadata"
    episode_metadata_glob = runtime_root / "episodes"
    if legacy_metadata_dir.exists():
        metadata_dirs.extend(sorted(legacy_metadata_dir.glob("*.json")))
    if episode_metadata_glob.exists():
        metadata_dirs.extend(sorted(episode_metadata_glob.glob("*/metadata/*.json")))
    if not metadata_dirs:
        print("No runtime metadata found; nothing to migrate.")
        return 0

    migrated = 0
    seen: set[Path] = set()
    for metadata_path in metadata_dirs:
        if metadata_path in seen:
            continue
        seen.add(metadata_path)
        if migrate_episode(runtime_root, metadata_path, dry_run=args.dry_run):
            migrated += 1

    if not args.dry_run:
        cleanup_empty_dirs(runtime_root)

    print(f"episodes_migrated={migrated}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
