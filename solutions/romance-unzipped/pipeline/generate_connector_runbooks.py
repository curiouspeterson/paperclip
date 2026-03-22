#!/usr/bin/env python3
"""Generate non-live connector runbooks for verified external surfaces."""

from __future__ import annotations

import argparse
from datetime import UTC, datetime
from pathlib import Path

from pipeline_common import load_json, require_ready_statuses, save_json, write_text


REQUIRED_STATUSES = (
    "approval_packet",
)

FABLE_PROFILE_URL = "https://fable.co/store/profile"
FABLE_CLUB_NAME = "Romance Unzipped"
FABLE_CLUB_INVITE_URL = (
    "https://fable.co/club/romance-unzipped-with-romance-unzipped-233772325675"
    "?invite=17b1a31f-de71-4e3b-a7ad-187c6a12f660"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, help="Path to handoff manifest json")
    parser.add_argument("--force", action="store_true", help="Overwrite existing runbook files")
    return parser.parse_args()


def ensure_outputs_writable(paths: list[Path], *, force: bool, context: str) -> None:
    if force:
        return
    existing = [str(path) for path in paths if path.exists()]
    if existing:
        raise SystemExit(f"{context} outputs already exist; re-run with --force to overwrite: {', '.join(existing)}")


def write_pair(markdown_path: Path, json_path: Path, *, markdown_body: str, payload: dict) -> None:
    write_text(markdown_path, markdown_body, overwrite=True)
    save_json(json_path, payload)


def main() -> int:
    args = parse_args()
    manifest_path = Path(args.manifest).expanduser().resolve()
    if not manifest_path.exists():
        raise SystemExit(f"Manifest file not found: {manifest_path}")

    manifest = load_json(manifest_path)
    require_ready_statuses(manifest, REQUIRED_STATUSES, context="Connector runbooks")
    status = manifest.setdefault("status", {})

    episode_id = manifest.get("episode_id", "unknown-episode")
    title = manifest.get("title", episode_id)
    generated_at = datetime.now(UTC).isoformat()

    social_target = manifest["targets"]["social_poster"]
    operations_target = manifest["targets"]["operations"]

    riverside_md = Path(operations_target["riverside_runbook_path"]).expanduser().resolve()
    riverside_json = Path(operations_target["riverside_runbook_json_path"]).expanduser().resolve()
    vercel_md = Path(operations_target["vercel_runbook_path"]).expanduser().resolve()
    vercel_json = Path(operations_target["vercel_runbook_json_path"]).expanduser().resolve()
    fable_md = Path(operations_target["fable_runbook_path"]).expanduser().resolve()
    fable_json = Path(operations_target["fable_runbook_json_path"]).expanduser().resolve()
    ensure_outputs_writable(
        [riverside_md, riverside_json, vercel_md, vercel_json, fable_md, fable_json],
        force=args.force,
        context="Connector runbooks",
    )

    board_review_path = social_target["board_review_path"]
    approval_packet_path = social_target["approval_packet_path"]

    riverside_payload = {
        "connector": "riverside",
        "episode_id": episode_id,
        "title": title,
        "generated_at": generated_at,
        "access_status": "verified",
        "verified_surface": {
            "url": "https://riverside.com/dashboard/home",
            "workspace": "Romance Unzipped",
            "available_tools": ["record", "edit", "upload", "hosting", "ai_tools"],
        },
        "approval_gate": {
            "required": True,
            "authority": "CEO",
            "evidence": board_review_path,
        },
        "inputs": {
            "board_review_path": board_review_path,
            "approval_packet_path": approval_packet_path,
            "manifest_path": str(manifest_path),
            "source_media_path": manifest["source"]["media_path"],
        },
        "steps": [
            "Open the verified Riverside dashboard for the Romance Unzipped workspace.",
            "Create or select the episode project that matches the batch title.",
            "Upload the source media or attach the local batch source path for internal processing only.",
            "Use Riverside AI tools such as Magic Clips or Show Notes only for internal comparison against the local pipeline outputs.",
            "Capture any useful differences in clip ideas or metadata back into Paperclip. Do not publish, distribute, or share from Riverside.",
        ],
        "stop_before": "export_or_publish",
    }

    vercel_payload = {
        "connector": "vercel",
        "episode_id": episode_id,
        "title": title,
        "generated_at": generated_at,
        "access_status": "verified",
        "verified_surface": {
            "dashboard_url": "https://vercel.com/dashboard",
            "project_name": "Paperclip",
            "production_host": "Vercel",
            "available_surfaces": ["production deployment", "preview deployments", "domains", "environment variables"],
        },
        "approval_gate": {
            "required": True,
            "authority": "CEO",
            "evidence": board_review_path,
        },
        "inputs": {
            "board_review_path": board_review_path,
            "approval_packet_path": approval_packet_path,
            "manifest_path": str(manifest_path),
        },
        "steps": [
            "Open the verified Vercel dashboard for the Paperclip project.",
            "Review the current production deployment and any active preview deployments for the latest batch.",
            "Verify the build status, deployment logs, environment variables, and domain routing for the current site.",
            "Record any useful deployment or preview notes back into Paperclip.",
            "Do not promote, rollback, or change domains from this runbook.",
        ],
        "stop_before": "deployment_or_domain_mutation",
    }

    fable_payload = {
        "connector": "fable",
        "episode_id": episode_id,
        "title": title,
        "generated_at": generated_at,
        "access_status": "verified_private_club",
        "verified_surface": {
            "url": FABLE_PROFILE_URL,
            "profile_name": FABLE_CLUB_NAME,
            "club_setup_status": "created_in_mobile_app",
            "club_name": FABLE_CLUB_NAME,
            "club_privacy": "private",
            "invite_url": FABLE_CLUB_INVITE_URL,
        },
        "constraints": {
            "official_api": False,
            "official_cli": False,
            "club_creation_surface": "mobile_app",
        },
        "approval_gate": {
            "required": True,
            "authority": "CEO",
            "evidence": board_review_path,
        },
        "inputs": {
            "board_review_path": board_review_path,
            "approval_packet_path": approval_packet_path,
            "manifest_path": str(manifest_path),
        },
        "steps": [
            "Open the verified Romance Unzipped Fable account in the mobile app and navigate to the existing club.",
            "Use the saved invite URL only for internal moderator review or future gated invites.",
            "Confirm the club description, genre, language, and privacy settings still match the podcast voice.",
            "Add the current episode or related book pick only as a draft/community planning step inside the private club.",
            "Do not invite members or announce the club publicly from this runbook.",
        ],
        "stop_before": "member_invites_or_public_launch",
    }

    write_pair(
        riverside_md,
        riverside_json,
        markdown_body="\n".join(
            [
                "# Riverside Runbook",
                "",
                f"Episode ID: `{episode_id}`",
                f"Title: {title}",
                f"Generated At: {generated_at}",
                "",
                "## Verified Surface",
                "",
                f"- Dashboard: `{riverside_payload['verified_surface']['url']}`",
                f"- Workspace: {riverside_payload['verified_surface']['workspace']}",
                f"- Available tools: {', '.join(riverside_payload['verified_surface']['available_tools'])}",
                "",
                "## Inputs",
                "",
                f"- Board review: `{board_review_path}`",
                f"- Approval packet: `{approval_packet_path}`",
                f"- Manifest: `{manifest_path}`",
                f"- Source media: `{manifest['source']['media_path']}`",
                "",
                "## Operator Steps",
                "",
                "1. Open the verified Riverside dashboard for the Romance Unzipped workspace.",
                "2. Create or select the matching episode project.",
                "3. Upload or attach the source media for internal tool comparison only.",
                "4. Use Magic Clips or Show Notes only to compare internal ideas against the local pipeline outputs.",
                "5. Record useful findings back into Paperclip. Do not export or publish from Riverside.",
                "",
                "## Stop Condition",
                "",
                "- Internal comparison complete",
                "- No export, distribution, or publish action taken",
            ]
        )
        + "\n",
        payload=riverside_payload,
    )

    write_pair(
        vercel_md,
        vercel_json,
        markdown_body="\n".join(
            [
                "# Vercel Runbook",
                "",
                f"Episode ID: `{episode_id}`",
                f"Title: {title}",
                f"Generated At: {generated_at}",
                "",
                "## Verified Surface",
                "",
                f"- Dashboard: `{vercel_payload['verified_surface']['dashboard_url']}`",
                f"- Project: {vercel_payload['verified_surface']['project_name']}",
                f"- Production host: {vercel_payload['verified_surface']['production_host']}",
                f"- Available surfaces: {', '.join(vercel_payload['verified_surface']['available_surfaces'])}",
                "",
                "## Inputs",
                "",
                f"- Board review: `{board_review_path}`",
                f"- Approval packet: `{approval_packet_path}`",
                f"- Manifest: `{manifest_path}`",
                "",
                "## Operator Steps",
                "",
                "1. Open the verified Vercel dashboard for the Paperclip project.",
                "2. Review the current production deployment and any active preview deployments for the latest batch.",
                "3. Verify build status, deployment logs, environment variables, and domain routing.",
                "4. Capture any useful deployment or preview notes back into Paperclip.",
                "5. Do not promote, rollback, or change domains from this runbook.",
                "",
                "## Stop Condition",
                "",
                "- Deployment and preview notes captured",
                "- No promotion, rollback, or domain changes made",
            ]
        )
        + "\n",
        payload=vercel_payload,
    )

    write_pair(
        fable_md,
        fable_json,
        markdown_body="\n".join(
            [
                "# Fable Runbook",
                "",
                f"Episode ID: `{episode_id}`",
                f"Title: {title}",
                f"Generated At: {generated_at}",
                "",
                "## Verified Surface",
                "",
                f"- Profile: `{fable_payload['verified_surface']['url']}`",
                f"- Profile name: {fable_payload['verified_surface']['profile_name']}",
                f"- Club setup status: {fable_payload['verified_surface']['club_setup_status']}",
                f"- Club name: {fable_payload['verified_surface']['club_name']}",
                f"- Club privacy: {fable_payload['verified_surface']['club_privacy']}",
                f"- Internal invite URL: `{fable_payload['verified_surface']['invite_url']}`",
                "",
                "## Constraints",
                "",
                "- No official Fable club-management API",
                "- No official CLI",
                "- Club creation and management require the mobile app",
                "",
                "## Inputs",
                "",
                f"- Board review: `{board_review_path}`",
                f"- Approval packet: `{approval_packet_path}`",
                f"- Manifest: `{manifest_path}`",
                "",
                "## Operator Steps",
                "",
                "1. Open the Fable mobile app with the verified Romance Unzipped account.",
                "2. Navigate to the existing Romance Unzipped club and confirm the private-club settings.",
                "3. Use the saved invite URL only for internal ops, moderator review, or future gated invites.",
                "4. Add the current episode or book pick only as an internal setup step if needed.",
                "5. Do not invite members or announce the club publicly from this runbook.",
                "",
                "## Stop Condition",
                "",
                "- Club exists with intended private settings captured",
                "- No public launch or invite action taken",
            ]
        )
        + "\n",
        payload=fable_payload,
    )

    status["riverside_runbook"] = "ready"
    status["vercel_runbook"] = "ready"
    status["fable_runbook"] = "ready"
    manifest["updated_at"] = generated_at
    save_json(manifest_path, manifest)

    print(str(riverside_md))
    print(str(riverside_json))
    print(str(vercel_md))
    print(str(vercel_json))
    print(str(fable_md))
    print(str(fable_json))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
