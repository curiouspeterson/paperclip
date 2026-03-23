#!/usr/bin/env python3
"""Tests for --force flag semantics in pipeline scripts."""

from __future__ import annotations

import importlib.util
import json
import platform
import sys
import tempfile
from pathlib import Path

import pytest

from pipeline_common import write_text, load_json, save_json


def load_generate_transcript_module():
    script_dir = Path(__file__).resolve().parent
    if str(script_dir) not in sys.path:
        sys.path.insert(0, str(script_dir))
    module_name = "paperclip_generate_transcript_test_module"
    spec = importlib.util.spec_from_file_location(module_name, script_dir / "generate_transcript.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load generate_transcript.py for testing")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def load_generate_board_review_module():
    script_dir = Path(__file__).resolve().parent
    if str(script_dir) not in sys.path:
        sys.path.insert(0, str(script_dir))
    module_name = "paperclip_generate_board_review_test_module"
    spec = importlib.util.spec_from_file_location(module_name, script_dir / "generate_board_review.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load generate_board_review.py for testing")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def test_write_text_no_overwrite_when_file_exists() -> None:
    """Verify that write_text respects overwrite=False when file exists."""
    with tempfile.TemporaryDirectory() as tmpdir:
        path = Path(tmpdir) / "test.txt"

        # Write initial content
        write_text(path, "original content", overwrite=False)
        assert path.read_text(encoding="utf-8") == "original content"

        # Try to write without overwrite - should not change
        result = write_text(path, "new content", overwrite=False)
        assert not result, "write_text should return False when file exists and overwrite=False"
        assert path.read_text(encoding="utf-8") == "original content"


def test_write_text_overwrites_when_flag_true() -> None:
    """Verify that write_text overwrites file when overwrite=True."""
    with tempfile.TemporaryDirectory() as tmpdir:
        path = Path(tmpdir) / "test.txt"

        # Write initial content
        write_text(path, "original content", overwrite=False)

        # Overwrite with force=True
        result = write_text(path, "new content", overwrite=True)
        assert result, "write_text should return True when file is written"
        assert path.read_text(encoding="utf-8") == "new content"


def test_write_text_creates_parent_dirs() -> None:
    """Verify that write_text creates parent directories."""
    with tempfile.TemporaryDirectory() as tmpdir:
        path = Path(tmpdir) / "deeply" / "nested" / "path" / "test.txt"

        write_text(path, "content", overwrite=False)
        assert path.exists(), "write_text should create parent directories"
        assert path.read_text(encoding="utf-8") == "content"


def test_write_text_returns_true_for_new_file() -> None:
    """Verify that write_text returns True when creating a new file."""
    with tempfile.TemporaryDirectory() as tmpdir:
        path = Path(tmpdir) / "new.txt"

        result = write_text(path, "new content", overwrite=False)
        assert result, "write_text should return True when creating new file"
        assert path.read_text(encoding="utf-8") == "new content"


class TestGenerateChannelDryRuns:
    """Test --force semantics for generate_channel_dry_runs.py"""

    def test_dry_runs_not_overwritten_without_force(self) -> None:
        """Verify dry-run files are not overwritten without --force."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir_path = Path(tmpdir)

            # Create manifest
            manifest = {
                "episode_id": "ep-001",
                "title": "Test Episode",
                "status": {
                    "board_review": "ready",
                    "social_drafts": "ready",
                    "newsletter_draft": "ready",
                    "quote_cards": "ready",
                },
                "targets": {
                    "social_poster": {
                        "board_review_path": str(tmpdir_path / "board.md"),
                        "approval_packet_path": str(tmpdir_path / "approval.md"),
                        "instagram_reel_path": str(tmpdir_path / "ig.md"),
                        "instagram_dry_run_path": str(tmpdir_path / "ig-dry-run.md"),
                        "instagram_dry_run_json_path": str(tmpdir_path / "ig-dry-run.json"),
                    },
                    "newsletter_agent": {
                        "draft_path": str(tmpdir_path / "newsletter.md"),
                        "mailchimp_dry_run_path": str(tmpdir_path / "mailchimp-dry-run.md"),
                        "mailchimp_dry_run_json_path": str(tmpdir_path / "mailchimp-dry-run.json"),
                    },
                    "clip_extractor": {
                        "quote_cards_path": str(tmpdir_path / "quotes.md"),
                    },
                },
            }

            # Create required artifacts
            for name, path in [
                ("board_review_path", "board.md"),
                ("approval_packet_path", "approval.md"),
                ("instagram_reel_path", "ig.md"),
                ("draft_path", "newsletter.md"),
                ("quote_cards_path", "quotes.md"),
            ]:
                (tmpdir_path / path).write_text("existing content", encoding="utf-8")

            manifest_path = tmpdir_path / "manifest.json"
            save_json(manifest_path, manifest)

            # Create existing dry-run files with original content
            ig_dry_run = tmpdir_path / "ig-dry-run.md"
            mailchimp_dry_run = tmpdir_path / "mailchimp-dry-run.md"
            ig_dry_run.write_text("original instagram dry run", encoding="utf-8")
            mailchimp_dry_run.write_text("original mailchimp dry run", encoding="utf-8")

            # Simulate what generate_channel_dry_runs.py would do without --force
            from pipeline_common import write_text
            write_text(ig_dry_run, "new instagram dry run", overwrite=False)
            write_text(mailchimp_dry_run, "new mailchimp dry run", overwrite=False)

            # Verify they were NOT overwritten
            assert ig_dry_run.read_text(encoding="utf-8") == "original instagram dry run"
            assert mailchimp_dry_run.read_text(encoding="utf-8") == "original mailchimp dry run"

    def test_dry_runs_overwritten_with_force(self) -> None:
        """Verify dry-run files ARE overwritten with --force."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir_path = Path(tmpdir)

            # Create existing dry-run files
            ig_dry_run = tmpdir_path / "ig-dry-run.md"
            mailchimp_dry_run = tmpdir_path / "mailchimp-dry-run.md"
            ig_dry_run.write_text("original instagram dry run", encoding="utf-8")
            mailchimp_dry_run.write_text("original mailchimp dry run", encoding="utf-8")

            # Simulate what generate_channel_dry_runs.py would do with --force
            from pipeline_common import write_text
            write_text(ig_dry_run, "new instagram dry run", overwrite=True)
            write_text(mailchimp_dry_run, "new mailchimp dry run", overwrite=True)

            # Verify they WERE overwritten
            assert ig_dry_run.read_text(encoding="utf-8") == "new instagram dry run"
            assert mailchimp_dry_run.read_text(encoding="utf-8") == "new mailchimp dry run"


class TestGenerateApprovalPacket:
    """Test --force semantics for generate_approval_packet.py"""

    def test_packets_not_overwritten_without_force(self) -> None:
        """Verify approval packets are not overwritten without --force."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir_path = Path(tmpdir)

            approval_path = tmpdir_path / "approval.md"
            newsletter_path = tmpdir_path / "newsletter.md"

            approval_path.write_text("original approval packet", encoding="utf-8")
            newsletter_path.write_text("original newsletter draft", encoding="utf-8")

            from pipeline_common import write_text
            write_text(approval_path, "new approval packet", overwrite=False)
            write_text(newsletter_path, "new newsletter draft", overwrite=False)

            assert approval_path.read_text(encoding="utf-8") == "original approval packet"
            assert newsletter_path.read_text(encoding="utf-8") == "original newsletter draft"

    def test_packets_overwritten_with_force(self) -> None:
        """Verify approval packets ARE overwritten with --force."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir_path = Path(tmpdir)

            approval_path = tmpdir_path / "approval.md"
            newsletter_path = tmpdir_path / "newsletter.md"

            approval_path.write_text("original approval packet", encoding="utf-8")
            newsletter_path.write_text("original newsletter draft", encoding="utf-8")

            from pipeline_common import write_text
            write_text(approval_path, "new approval packet", overwrite=True)
            write_text(newsletter_path, "new newsletter draft", overwrite=True)

            assert approval_path.read_text(encoding="utf-8") == "new approval packet"
            assert newsletter_path.read_text(encoding="utf-8") == "new newsletter draft"


class TestUpstreamStageFreshness:
    """Test upstream-stage output freshness validation semantics."""

    def test_stale_upstream_output_causes_abort(self) -> None:
        """Verify require_fresh_upstream_stage_outputs aborts when upstream output changes."""
        import pytest
        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir_path = Path(tmpdir)
            artifact = tmpdir_path / "output.txt"
            artifact.write_text("original content", encoding="utf-8")

            from pipeline_common import record_stage_provenance, require_fresh_upstream_stage_outputs
            manifest = {"status": {"transcript": "ready"}, "provenance": {}}
            record_stage_provenance(manifest, "transcript", generated_artifacts={"transcript": artifact})

            # Change artifact content
            artifact.write_text("modified content", encoding="utf-8")

            with pytest.raises(SystemExit):
                require_fresh_upstream_stage_outputs(
                    manifest, "transcript", {"transcript": artifact},
                    context="Test", force=False,
                )

    def test_matching_upstream_output_passes(self) -> None:
        """Verify require_fresh_upstream_stage_outputs passes when hashes match."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir_path = Path(tmpdir)
            artifact = tmpdir_path / "output.txt"
            artifact.write_text("original content", encoding="utf-8")

            from pipeline_common import record_stage_provenance, require_fresh_upstream_stage_outputs
            manifest = {"status": {"transcript": "ready"}, "provenance": {}}
            record_stage_provenance(manifest, "transcript", generated_artifacts={"transcript": artifact})

            # Should not raise — content unchanged
            require_fresh_upstream_stage_outputs(
                manifest, "transcript", {"transcript": artifact},
                context="Test", force=False,
            )


def test_clear_force_rerun_outputs_removes_stale_generated_files_and_resets_statuses() -> None:
    from pipeline_common import clear_force_rerun_outputs

    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir)
        transcript = root / "transcript.txt"
        transcript.write_text("old transcript", encoding="utf-8")
        rendered_dir = root / "clips" / "rendered"
        rendered_dir.mkdir(parents=True, exist_ok=True)
        (rendered_dir / "clip-01.mp4").write_text("stale clip", encoding="utf-8")
        quotes_dir = root / "quotes"
        quotes_dir.mkdir(parents=True, exist_ok=True)
        (quotes_dir / "quote-card-01-old.png").write_text("stale quote card", encoding="utf-8")
        board_review = root / "board-review.md"
        board_review.write_text("old board review", encoding="utf-8")

        manifest = {
            "source": {
                "transcript_path": str(transcript),
            },
            "targets": {
                "clip_extractor": {
                    "rendered_clips_dir": str(rendered_dir),
                    "quotes_dir": str(quotes_dir),
                },
                "social_poster": {
                    "board_review_path": str(board_review),
                },
            },
            "status": {
                "transcript": "ready",
                "rendered_clips": "ready",
                "quote_cards": "ready",
                "board_review": "ready",
                "diarization": "skipped",
            },
            "provenance": {
                "transcript": {"outputs": {}},
                "rendered_clips": {"outputs": {}},
                "quote_cards": {"outputs": {}},
                "board_review": {"outputs": {}},
            },
        }

        clear_force_rerun_outputs(manifest)

        assert not transcript.exists()
        assert not rendered_dir.exists()
        assert list(quotes_dir.glob("quote-card-*.png")) == []
        assert not board_review.exists()
        assert manifest["status"]["transcript"] == "pending"
        assert manifest["status"]["rendered_clips"] == "pending"
        assert manifest["status"]["quote_cards"] == "pending"
        assert manifest["status"]["board_review"] == "pending"
        assert manifest["status"]["diarization"] == "skipped"
        assert "transcript" not in manifest["provenance"]


def test_build_episode_batch_uses_configured_python_and_preserves_existing_source_url() -> None:
    build_script = (Path(__file__).resolve().parent / "build_episode_batch.sh").read_text(encoding="utf-8")

    assert 'SOURCE_PUBLIC_URL="${RESOLVED_PUBLIC_URL:-${RU_SOURCE_URL:-}}"' in build_script
    assert 'DETECT_ARGS+=(--force)' not in build_script
    assert 'Skipping homepage update: homepage.publish_date is missing in the manifest.' in build_script

    for script_name in (
        "generate_transcript.py",
        "generate_clip_candidates.py",
        "render_clip_assets.py",
        "generate_quote_cards.py",
        "generate_approval_packet.py",
        "generate_social_drafts.py",
        "generate_board_review.py",
        "generate_connector_runbooks.py",
        "generate_channel_dry_runs.py",
        "update_static_homepage.py",
        ):
        assert f'"$PYTHON_BIN" "$SCRIPT_DIR/{script_name}"' in build_script


def test_initialize_episode_manifest_upgrades_existing_operations_targets() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir)
        source = root / "29. Truth and Measure by Roslyn Sinclair.mp4"
        source.write_text("media", encoding="utf-8")

        module_name = "paperclip_initialize_episode_manifest_test_module"
        spec = importlib.util.spec_from_file_location(module_name, Path(__file__).resolve().parent / "initialize_episode_manifest.py")
        if spec is None or spec.loader is None:
            raise RuntimeError("Could not load initialize_episode_manifest.py for testing")
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)

        episode_id = "20260322-29-truth-and-measure-by-roslyn-sinclair"
        episode_root = root / "episodes" / episode_id
        manifests_dir = episode_root / "manifests"
        manifests_dir.mkdir(parents=True, exist_ok=True)
        manifest_path = manifests_dir / f"{episode_id}.json"
        save_json(
            manifest_path,
            {
                "episode_id": episode_id,
                "title": "29. Truth and Measure by Roslyn Sinclair",
                "created_at": "2026-03-22T00:00:00+00:00",
                "source": {"media_path": str(source)},
                "targets": {
                    "operations": {
                        "ops_dir": str(episode_root / "assets" / "ops"),
                        "siteground_runbook_path": str(episode_root / "assets" / "ops" / "siteground-runbook.md"),
                        "siteground_runbook_json_path": str(episode_root / "assets" / "ops" / "siteground-runbook.json"),
                    }
                },
                "status": {"siteground_runbook": "ready"},
                "homepage": {"public_url": "https://www.youtube.com/watch?v=H5fSuLMbSTo"},
            },
        )

        old_argv = sys.argv[:]
        try:
            sys.argv = [
                "initialize_episode_manifest.py",
                "--source",
                str(source),
                "--root",
                str(root),
                "--episode-id",
                episode_id,
            ]
            module.main()
        finally:
            sys.argv = old_argv

        manifest = load_json(manifest_path)
        operations = manifest["targets"]["operations"]
        assert operations["vercel_runbook_path"].endswith("vercel-runbook.md")
        assert "siteground_runbook_path" not in operations
        assert "siteground_runbook" not in manifest["status"]
        assert manifest["status"]["vercel_runbook"] == "pending"


def test_initialize_episode_manifest_normalizes_publish_metadata_on_rerun() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir)
        source = root / "27. Lizard Holds The Sun by Dani Trujillo.mp4"
        source.write_text("media", encoding="utf-8")

        module_name = "paperclip_initialize_episode_manifest_publish_metadata_test_module"
        spec = importlib.util.spec_from_file_location(module_name, Path(__file__).resolve().parent / "initialize_episode_manifest.py")
        if spec is None or spec.loader is None:
            raise RuntimeError("Could not load initialize_episode_manifest.py for testing")
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)

        episode_id = "20260322-ep27"
        episode_root = root / "episodes" / episode_id
        manifests_dir = episode_root / "manifests"
        manifests_dir.mkdir(parents=True, exist_ok=True)
        manifest_path = manifests_dir / f"{episode_id}.json"
        save_json(
            manifest_path,
            {
                "episode_id": episode_id,
                "title": "27. Lizard Holds The Sun by Dani Trujillo",
                "created_at": "2026-03-22T00:00:00+00:00",
                "published_at": "2026-03-22",
                "upload_date": None,
                "source": {
                    "media_path": str(source),
                    "public_url": "https://www.youtube.com/watch?v=huCg3DRSF18",
                },
                "governance": {
                    "paperclip_issue_id": "issue-27",
                    "board_review_synced_at": "2026-03-22T19:16:36.034Z",
                    "board_approval": "pending",
                },
                "homepage": {
                    "publish_date": "2026-03-22",
                    "public_url": "https://www.youtube.com/watch?v=huCg3DRSF18",
                },
            },
        )

        old_argv = sys.argv[:]
        try:
            sys.argv = [
                "initialize_episode_manifest.py",
                "--source",
                str(source),
                "--root",
                str(root),
                "--episode-id",
                episode_id,
                "--publish-date",
                "2026-02-03T00:00:00+00:00",
            ]
            module.main()
        finally:
            sys.argv = old_argv

        manifest = load_json(manifest_path)
        assert manifest["homepage"]["publish_date"] == "2026-02-03T00:00:00+00:00"
        assert manifest["published_at"] == "2026-02-03T00:00:00+00:00"
        assert manifest["upload_date"] == "2026-02-03T00:00:00+00:00"
        assert manifest["governance"]["paperclip_issue_id"] == "issue-27"
        assert manifest["homepage"]["public_url"] == "https://www.youtube.com/watch?v=huCg3DRSF18"

    def test_ready_stage_without_provenance_aborts(self) -> None:
        """Verify that a 'ready' upstream stage with no provenance causes a hard abort."""
        import pytest
        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir_path = Path(tmpdir)
            artifact = tmpdir_path / "output.txt"
            artifact.write_text("content", encoding="utf-8")

            from pipeline_common import require_fresh_upstream_stage_outputs
            # Stage is marked ready but has no provenance block
            manifest = {"status": {"transcript": "ready"}, "provenance": {}}

            with pytest.raises(SystemExit):
                require_fresh_upstream_stage_outputs(
                    manifest, "transcript", {"transcript": artifact},
                    context="Test", force=False,
                )

    def test_non_ready_stage_without_provenance_is_noop(self) -> None:
        """Verify no-op when upstream stage has no provenance and is not yet ready."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir_path = Path(tmpdir)
            artifact = tmpdir_path / "output.txt"
            artifact.write_text("content", encoding="utf-8")

            from pipeline_common import require_fresh_upstream_stage_outputs
            manifest = {"status": {"transcript": "pending"}, "provenance": {}}

            # Should not raise — stage is not yet ready, first-run scenario
            require_fresh_upstream_stage_outputs(
                manifest, "transcript", {"transcript": artifact},
                context="Test", force=False,
            )

    def test_force_flag_bypasses_stale_abort(self) -> None:
        """Verify --force bypasses stale upstream output check."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir_path = Path(tmpdir)
            artifact = tmpdir_path / "output.txt"
            artifact.write_text("original content", encoding="utf-8")

            from pipeline_common import record_stage_provenance, require_fresh_upstream_stage_outputs
            manifest = {"status": {"transcript": "ready"}, "provenance": {}}
            record_stage_provenance(manifest, "transcript", generated_artifacts={"transcript": artifact})

            artifact.write_text("modified content", encoding="utf-8")

            # Should not raise when force=True despite stale content
            require_fresh_upstream_stage_outputs(
                manifest, "transcript", {"transcript": artifact},
                context="Test", force=True,
            )

    def test_require_fresh_inputs_from_stages_multi_upstream(self) -> None:
        """Verify require_fresh_inputs_from_stages validates all stages."""
        import pytest
        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir_path = Path(tmpdir)
            artifact_a = tmpdir_path / "a.txt"
            artifact_b = tmpdir_path / "b.txt"
            artifact_a.write_text("a content", encoding="utf-8")
            artifact_b.write_text("b content", encoding="utf-8")

            from pipeline_common import record_stage_provenance, require_fresh_inputs_from_stages
            manifest = {
                "status": {"stage_a": "ready", "stage_b": "ready"},
                "provenance": {},
            }
            record_stage_provenance(manifest, "stage_a", generated_artifacts={"a": artifact_a})
            record_stage_provenance(manifest, "stage_b", generated_artifacts={"b": artifact_b})

            # Both fresh — no raise
            require_fresh_inputs_from_stages(
                manifest,
                stages={"stage_a": {"a": artifact_a}, "stage_b": {"b": artifact_b}},
                context="Test",
            )

            # Stale one of them — should abort
            artifact_b.write_text("changed b content", encoding="utf-8")
            with pytest.raises(SystemExit):
                require_fresh_inputs_from_stages(
                    manifest,
                    stages={"stage_a": {"a": artifact_a}, "stage_b": {"b": artifact_b}},
                    context="Test",
                )


class TestDownstreamFreshnessAbort:
    """Test that downstream stages abort on stale upstream artifacts."""

    def _make_manifest_with_provenance(self, tmpdir: Path, stages: dict[str, dict[str, str]]) -> tuple[dict, dict[str, Path]]:
        """Create a manifest with provenance for given stages and return (manifest, path_map)."""
        from pipeline_common import record_stage_provenance
        manifest: dict = {"status": {}, "provenance": {}}
        path_map: dict[str, Path] = {}
        for stage, artifacts in stages.items():
            manifest["status"][stage] = "ready"
            stage_paths = {}
            for name, content in artifacts.items():
                p = tmpdir / f"{stage}_{name}.txt"
                p.write_text(content, encoding="utf-8")
                stage_paths[name] = p
                path_map[f"{stage}/{name}"] = p
            record_stage_provenance(manifest, stage, generated_artifacts=stage_paths)
        return manifest, path_map

    def test_stale_quote_candidates_aborts_board_review(self) -> None:
        """Board review must abort when quote_candidates are stale."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir_path = Path(tmpdir)
            manifest, paths = self._make_manifest_with_provenance(tmpdir_path, {
                "quote_candidates": {"quote_candidates": "original quotes"},
            })
            # Mutate artifact
            paths["quote_candidates/quote_candidates"].write_text("changed", encoding="utf-8")

            from pipeline_common import require_fresh_inputs_from_stages
            with pytest.raises(SystemExit):
                require_fresh_inputs_from_stages(
                    manifest,
                    stages={"quote_candidates": {"quote_candidates": paths["quote_candidates/quote_candidates"]}},
                    context="Board review",
                )

    def test_stale_facebook_draft_aborts_board_review(self) -> None:
        """Board review must abort when facebook draft is stale."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir_path = Path(tmpdir)
            manifest, paths = self._make_manifest_with_provenance(tmpdir_path, {
                "social_drafts": {"facebook": "fb content", "instagram": "ig content", "tiktok": "tt content"},
            })
            paths["social_drafts/facebook"].write_text("changed fb", encoding="utf-8")

            from pipeline_common import require_fresh_inputs_from_stages
            with pytest.raises(SystemExit):
                require_fresh_inputs_from_stages(
                    manifest,
                    stages={"social_drafts": {
                        "facebook": paths["social_drafts/facebook"],
                        "instagram": paths["social_drafts/instagram"],
                        "tiktok": paths["social_drafts/tiktok"],
                    }},
                    context="Board review",
                )

    def test_stale_tiktok_draft_aborts_board_review(self) -> None:
        """Board review must abort when tiktok draft is stale."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir_path = Path(tmpdir)
            manifest, paths = self._make_manifest_with_provenance(tmpdir_path, {
                "social_drafts": {"tiktok": "tt content"},
            })
            paths["social_drafts/tiktok"].write_text("changed tt", encoding="utf-8")

            from pipeline_common import require_fresh_inputs_from_stages
            with pytest.raises(SystemExit):
                require_fresh_inputs_from_stages(
                    manifest,
                    stages={"social_drafts": {"tiktok": paths["social_drafts/tiktok"]}},
                    context="Board review",
                )

    def test_stale_transcript_aborts_social_drafts(self) -> None:
        """Social drafts must abort when transcript is stale."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir_path = Path(tmpdir)
            manifest, paths = self._make_manifest_with_provenance(tmpdir_path, {
                "transcript": {"transcript": "original transcript"},
            })
            paths["transcript/transcript"].write_text("modified transcript", encoding="utf-8")

            from pipeline_common import require_fresh_inputs_from_stages
            with pytest.raises(SystemExit):
                require_fresh_inputs_from_stages(
                    manifest,
                    stages={"transcript": {"transcript": paths["transcript/transcript"]}},
                    context="Social drafts",
                )

    def test_stale_clip_candidates_aborts_social_drafts(self) -> None:
        """Social drafts must abort when clip_candidates are stale."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir_path = Path(tmpdir)
            manifest, paths = self._make_manifest_with_provenance(tmpdir_path, {
                "clip_candidates": {"candidates_json": "original clips"},
            })
            paths["clip_candidates/candidates_json"].write_text("changed clips", encoding="utf-8")

            from pipeline_common import require_fresh_inputs_from_stages
            with pytest.raises(SystemExit):
                require_fresh_inputs_from_stages(
                    manifest,
                    stages={"clip_candidates": {"candidates_json": paths["clip_candidates/candidates_json"]}},
                    context="Social drafts",
                )

    def test_stale_approval_packet_aborts_homepage_update(self) -> None:
        """Homepage update must abort when approval_packet is stale."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir_path = Path(tmpdir)
            manifest, paths = self._make_manifest_with_provenance(tmpdir_path, {
                "approval_packet": {"approval packet json": "original packet"},
            })
            paths["approval_packet/approval packet json"].write_text("changed", encoding="utf-8")

            from pipeline_common import require_fresh_inputs_from_stages
            with pytest.raises(SystemExit):
                require_fresh_inputs_from_stages(
                    manifest,
                    stages={"approval_packet": {"approval packet json": paths["approval_packet/approval packet json"]}},
                    context="Homepage update",
                )

    def test_stale_rendered_clips_aborts_homepage_publish(self) -> None:
        """Homepage publish must abort when rendered_clips are stale."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir_path = Path(tmpdir)
            manifest, paths = self._make_manifest_with_provenance(tmpdir_path, {
                "rendered_clips": {"rendered_json": "original rendered"},
            })
            paths["rendered_clips/rendered_json"].write_text("changed", encoding="utf-8")

            from pipeline_common import require_fresh_inputs_from_stages
            with pytest.raises(SystemExit):
                require_fresh_inputs_from_stages(
                    manifest,
                    stages={"rendered_clips": {"rendered_json": paths["rendered_clips/rendered_json"]}},
                    context="Publish to homepage",
                )


class TestTranscriptBackendSelection:
    """Test default transcript backend selection."""

    def test_prefers_mlx_on_arm64_when_available(self) -> None:
        module = load_generate_transcript_module()

        class Args:
            backend = "auto"
            mlx_whisper_bin = "mlx_whisper"

        original_machine = platform.machine
        original_mlx_available = module.mlx_available
        platform.machine = lambda: "arm64"  # type: ignore[assignment]
        module.mlx_available = lambda _args: True  # type: ignore[assignment]

        try:
            assert module.resolve_backend(Args()) == "mlx"
        finally:
            platform.machine = original_machine
            module.mlx_available = original_mlx_available

    def test_falls_back_to_whisper_when_mlx_unavailable(self) -> None:
        module = load_generate_transcript_module()

        class Args:
            backend = "auto"
            mlx_whisper_bin = "mlx_whisper"

        original_machine = platform.machine
        original_mlx_available = module.mlx_available
        platform.machine = lambda: "arm64"  # type: ignore[assignment]
        module.mlx_available = lambda _args: False  # type: ignore[assignment]

        try:
            assert module.resolve_backend(Args()) == "whisper"
        finally:
            platform.machine = original_machine
            module.mlx_available = original_mlx_available


class TestBoardReviewDependencies:
    """Test board review stage dependency boundaries."""

    def test_board_review_does_not_depend_on_vercel_runbook(self) -> None:
        module = load_generate_board_review_module()
        assert "vercel_runbook" not in module.REQUIRED_STATUSES


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
