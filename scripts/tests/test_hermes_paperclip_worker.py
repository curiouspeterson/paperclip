import importlib.util
import os
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[1] / "hermes_paperclip_worker.py"
SPEC = importlib.util.spec_from_file_location("hermes_paperclip_worker", MODULE_PATH)
assert SPEC and SPEC.loader
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


class HermesWorkerTests(unittest.TestCase):
    def test_build_prompt_keeps_subtask_contract_available(self) -> None:
        prompt = worker.build_prompt(
            {"title": "Newsletter Agent", "role": "general", "adapterConfig": {}, "id": "agent-1"},
            {"title": "Configure Newsletter Agent for Mailchimp", "description": "", "planDocument": "existing plan"},
            [{"authorAgentId": "agent-1", "body": "previous update"}],
            can_assign_tasks=False,
        )
        self.assertIn('"subtasks": [', prompt)
        self.assertIn("The worker will create them as child issues", prompt)

    def test_normalize_subtask_status_maps_in_progress_to_in_review(self) -> None:
        self.assertEqual("in_review", worker.normalize_subtask_status("in_progress"))
        self.assertEqual("blocked", worker.normalize_subtask_status("blocked"))
        self.assertEqual("backlog", worker.normalize_subtask_status("unknown"))

    def test_runtime_preflight_reports_mailchimp_state_for_newsletter_work(self) -> None:
        agent = {"title": "Chief Executive Officer"}
        issue = {"title": "Configure Newsletter Agent for Mailchimp campaigns"}
        with patch.dict(os.environ, {"MAILCHIMP_API_KEY": "present-us19"}, clear=False):
            preflight = worker.build_runtime_preflight(agent, issue)
        self.assertIn("MAILCHIMP_API_KEY=present", preflight)
        self.assertIn("MAILCHIMP_WEBHOOK_SECRET=not_required_by_current_integration", preflight)

    def test_runtime_preflight_reports_fable_as_iphone_mirroring_work(self) -> None:
        agent = {"title": "Vice President of Technical"}
        issue = {"title": "Assign Truth and Measure discussion tasks on Fable platform"}
        preflight = worker.build_runtime_preflight(agent, issue)
        self.assertIn("FABLE_API=not_available_use_iphone_mirroring", preflight)
        self.assertRegex(preflight, r"IPHONE_MIRRORING_APP=(present|missing)")

    def test_runtime_preflight_reports_social_credentials_for_social_work(self) -> None:
        agent = {"title": "Social Poster"}
        issue = {"title": "Configure Social Poster for Instagram/TikTok posting"}
        with patch.dict(
            os.environ,
            {
                "INSTAGRAM_USERNAME": "romanceunzipped",
                "INSTAGRAM_PASSWORD": "secret",
                "TIKTOK_USERNAME": "romanceunzipped",
                "TIKTOK_PASSWORD": "secret",
                "X_CONSUMER_KEY": "key",
                "X_CONSUMER_SECRET": "secret",
                "X_BEARER_TOKEN": "token",
            },
            clear=False,
        ):
            preflight = worker.build_runtime_preflight(agent, issue)
        self.assertIn("INSTAGRAM_USERNAME=present", preflight)
        self.assertIn("TIKTOK_USERNAME=present", preflight)
        self.assertIn("X_BEARER_TOKEN=present", preflight)
        self.assertIn("SOCIAL_ACCESS_PATH=credential_login_preferred", preflight)

    def test_runtime_preflight_reports_clip_credentials_for_clip_work(self) -> None:
        agent = {"title": "Clip Extractor"}
        issue = {"title": "Configure Clip Extractor for Riverside FM/YouTube"}
        with patch.dict(
            os.environ,
            {
                "RIVERSIDE_FM_USERNAME": "romanceunzipped",
                "RIVERSIDE_FM_PASSWORD": "secret",
                "YOUTUBE_CREATOR_USERNAME": "romanceunzipped",
                "YOUTUBE_CREATOR_PASSWORD": "secret",
                "ADOBE_USERNAME": "romanceunzipped",
                "ADOBE_PASSWORD": "secret",
            },
            clear=False,
        ):
            preflight = worker.build_runtime_preflight(agent, issue)
        self.assertIn("RIVERSIDE_FM_USERNAME=present", preflight)
        self.assertIn("YOUTUBE_CREATOR_USERNAME=present", preflight)
        self.assertIn("YOUTUBE_API_KEY=not_required_when_browser_session_is_used", preflight)
        self.assertIn("CLIP_ACCESS_PATH=credential_login_preferred", preflight)

    def test_build_prompt_explicitly_blocks_fable_api_secret_work(self) -> None:
        prompt = worker.build_prompt(
            {"title": "VP Technical", "role": "technical", "adapterConfig": {}, "id": "agent-1"},
            {"title": "Research Fable platform API authentication documentation", "description": "", "planDocument": ""},
            [],
            can_assign_tasks=False,
        )
        self.assertIn("Fable has no API integration in this environment.", prompt)
        self.assertIn("Do not create API-secret or API-client tasks for Fable.", prompt)
        self.assertIn("Prefer Hermes iPhone Mirroring tools for Fable interaction when available.", prompt)

    def test_build_prompt_blocks_secret_provisioning_loops_for_social_work(self) -> None:
        prompt = worker.build_prompt(
            {"title": "Social Poster", "role": "social_media_manager", "adapterConfig": {}, "id": "agent-1"},
            {"title": "Configure Social Poster for Instagram/TikTok posting", "description": "", "planDocument": ""},
            [],
            can_assign_tasks=False,
        )
        self.assertIn("do not create secret-provisioning tasks", prompt.lower())
        self.assertIn("Focus on workflow setup, content templates, validation, and login/session verification.", prompt)

    def test_build_prompt_blocks_invented_youtube_api_requirements_for_clip_work(self) -> None:
        prompt = worker.build_prompt(
            {"title": "Clip Extractor", "role": "content_ops", "adapterConfig": {}, "id": "agent-1"},
            {"title": "Configure Clip Extractor for Riverside FM/YouTube", "description": "", "planDocument": ""},
            [],
            can_assign_tasks=False,
        )
        self.assertIn("do not create provisioning tasks", prompt.lower())
        self.assertIn("Prefer browser/session-based workflows over inventing a YouTube API-key requirement", prompt)

    def test_create_subtasks_reuses_existing_goal_mailchimp_secret_escalation(self) -> None:
        parent_issue = {"id": "parent-1", "companyId": "company-1", "goalId": "goal-1"}
        raw_subtasks = [
            {
                "title": "Provide Mailchimp API key and webhook secrets",
                "description": "Ask Adam to provide the Mailchimp API key and webhook secrets.",
                "status": "todo",
                "priority": "high",
                "assigneeUserId": "local-board",
            }
        ]
        existing_issue = {
            "id": "issue-50",
            "identifier": "ROM-50",
            "title": "Request Mailchimp API key and webhook secrets from Adam",
            "description": "Contact Adam to provide Mailchimp API key and webhook secrets for manual provisioning.",
            "status": "todo",
            "goalId": "goal-1",
        }

        def fake_api_request(method: str, path: str, payload=None, include_run_id: bool = False, tolerate_404: bool = False):
            if method == "GET" and path == "/companies/company-1/issues?parentId=parent-1":
                return []
            if method == "GET" and path == "/companies/company-1/issues?goalId=goal-1":
                return [existing_issue]
            if method == "GET" and path == "/companies/company-1/agents":
                return []
            if method == "POST":
                raise AssertionError("create_subtasks should have reused the existing issue")
            raise AssertionError(f"Unexpected API call: {method} {path}")

        with patch.object(worker, "api_request", side_effect=fake_api_request):
            created = worker.create_subtasks(parent_issue, raw_subtasks, allow_assignments=True)

        self.assertEqual([existing_issue], created)

    def test_allows_delegated_subtask_assignments_from_own_parent_issue_without_tasks_assign(self) -> None:
        agent = {
            "id": "agent-1",
            "access": {"canAssignTasks": False},
        }
        issue = {
            "id": "issue-1",
            "assigneeAgentId": "agent-1",
        }

        self.assertTrue(worker.can_delegate_subtask_assignments(agent, issue))

    def test_blocks_delegated_subtask_assignments_when_agent_does_not_own_parent_issue(self) -> None:
        agent = {
            "id": "agent-1",
            "access": {"canAssignTasks": False},
        }
        issue = {
            "id": "issue-1",
            "assigneeAgentId": "agent-2",
        }

        self.assertFalse(worker.can_delegate_subtask_assignments(agent, issue))

if __name__ == "__main__":
    unittest.main()
