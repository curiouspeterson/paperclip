#!/usr/bin/env python3
"""Tests for --force flag semantics in pipeline scripts."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from pipeline_common import write_text, load_json, save_json


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


class TestArtifactProvenanceAndFreshness:
    """Test provenance recording and freshness validation."""

    def test_record_artifact_provenance(self) -> None:
        """Verify that artifact provenance is recorded correctly."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir_path = Path(tmpdir)

            # Create some artifacts
            artifact1 = tmpdir_path / "artifact1.txt"
            artifact2 = tmpdir_path / "artifact2.txt"
            artifact1.write_text("content 1", encoding="utf-8")
            artifact2.write_text("content 2", encoding="utf-8")

            # Create manifest
            manifest = {"status": {}}

            # Record provenance
            from pipeline_common import record_artifact_provenance
            artifact_paths = {
                "artifact1": artifact1,
                "artifact2": artifact2,
            }
            record_artifact_provenance(manifest, "test_artifact", artifact_paths)

            # Verify provenance was recorded
            assert "artifacts" in manifest
            assert "test_artifact" in manifest["artifacts"]
            provenance = manifest["artifacts"]["test_artifact"]
            assert "generated_at" in provenance
            assert "hashes" in provenance
            assert "artifact1" in provenance["hashes"]
            assert "artifact2" in provenance["hashes"]
            assert len(provenance["hashes"]["artifact1"]) == 64  # SHA256 hex = 64 chars

    def test_validate_artifact_freshness_with_matching_hashes(self) -> None:
        """Verify freshness validation passes when upstream hashes match."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir_path = Path(tmpdir)

            artifact1 = tmpdir_path / "artifact1.txt"
            artifact1.write_text("content 1", encoding="utf-8")

            manifest = {"status": {}}

            # Record initial provenance
            from pipeline_common import record_artifact_provenance, validate_artifact_freshness
            artifact_paths = {"artifact1": artifact1}
            record_artifact_provenance(manifest, "test_artifact", artifact_paths)

            # Validate without changing content
            is_fresh = validate_artifact_freshness(manifest, "test_artifact", artifact_paths)
            assert is_fresh, "Artifact should be fresh when hashes match"

    def test_validate_artifact_freshness_with_changed_content(self) -> None:
        """Verify freshness validation fails when upstream content changes."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir_path = Path(tmpdir)

            artifact1 = tmpdir_path / "artifact1.txt"
            artifact1.write_text("content 1", encoding="utf-8")

            manifest = {"status": {}}

            # Record initial provenance
            from pipeline_common import record_artifact_provenance, validate_artifact_freshness
            artifact_paths = {"artifact1": artifact1}
            record_artifact_provenance(manifest, "test_artifact", artifact_paths)

            # Change content and validate
            artifact1.write_text("changed content", encoding="utf-8")
            is_fresh = validate_artifact_freshness(manifest, "test_artifact", artifact_paths)
            assert not is_fresh, "Artifact should be stale when hash changes"

    def test_validate_artifact_freshness_with_missing_provenance(self) -> None:
        """Verify freshness validation is lenient when no provenance exists."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir_path = Path(tmpdir)

            artifact1 = tmpdir_path / "artifact1.txt"
            artifact1.write_text("content 1", encoding="utf-8")

            manifest = {"status": {}}  # No provenance recorded

            from pipeline_common import validate_artifact_freshness
            artifact_paths = {"artifact1": artifact1}

            # Should return True (assume fresh) when no provenance
            is_fresh = validate_artifact_freshness(manifest, "test_artifact", artifact_paths)
            assert is_fresh, "Should assume fresh when no provenance exists"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
