import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[1] / "hermes_paperclip_worker.py"
SPEC = importlib.util.spec_from_file_location("hermes_paperclip_worker", MODULE_PATH)
assert SPEC and SPEC.loader
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


class HermesWorkerTests(unittest.TestCase):
    def test_resolve_hermes_home_uses_agent_home_when_available(self) -> None:
        home = worker.resolve_hermes_home("/tmp/agent-home")
        self.assertEqual(Path("/tmp/agent-home").resolve() / ".hermes", home)

    def test_resolve_hermes_home_falls_back_to_repo_local_runtime_dir(self) -> None:
        with patch.object(worker, "resolve_repo_root", return_value=Path("/tmp/paperclip")):
            home = worker.resolve_hermes_home("")
        self.assertEqual(Path("/tmp/paperclip/.runtime/hermes"), home)

    def test_build_session_name_prefers_issue_identifier(self) -> None:
        session_name = worker.build_session_name({"id": "agent-1234567890"}, {"identifier": "ROM-44", "id": "issue-1"})
        self.assertEqual("paperclip::agent-1234::ROM-44", session_name)

    def test_build_session_name_falls_back_to_issue_id(self) -> None:
        session_name = worker.build_session_name({"id": "agent-1234567890"}, {"id": "issue-1"})
        self.assertEqual("paperclip::agent-1234::issue-1", session_name)

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
        self.assertIn("MAILCHIMP_API_KEY_USAGE=available_to_heartbeat_process_env", preflight)
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

    def test_build_prompt_treats_mailchimp_key_as_runtime_available(self) -> None:
        prompt = worker.build_prompt(
            {"title": "Newsletter Agent", "role": "general", "adapterConfig": {}, "id": "agent-1"},
            {"title": "Configure Newsletter Agent for Mailchimp campaigns", "description": "", "planDocument": ""},
            [],
            can_assign_tasks=False,
        )
        self.assertIn("Mailchimp credentials may already be bound in the runtime preflight above.", prompt)
        self.assertIn(
            "If MAILCHIMP_API_KEY is present, it is available to the heartbeat child process for direct API calls",
            prompt,
        )
        self.assertIn("Do not create secret-provisioning tasks or ask for the key again.", prompt)

    def test_build_prompt_blocks_invented_youtube_api_requirements_for_clip_work(self) -> None:
        prompt = worker.build_prompt(
            {"title": "Clip Extractor", "role": "content_ops", "adapterConfig": {}, "id": "agent-1"},
            {"title": "Configure Clip Extractor for Riverside FM/YouTube", "description": "", "planDocument": ""},
            [],
            can_assign_tasks=False,
        )
        self.assertIn("do not create provisioning tasks", prompt.lower())
        self.assertIn("Prefer browser/session-based workflows over inventing a YouTube API-key requirement", prompt)

    def test_build_prompt_includes_explicit_riverside_login_focus_guidance_for_playwright(self) -> None:
        with patch.dict(
            os.environ,
            {"PAPERCLIP_BROWSER_AUTOMATION_PROVIDER": "playwright"},
            clear=False,
        ):
            prompt = worker.build_prompt(
                {"title": "Clip Extractor", "role": "content_ops", "adapterConfig": {}, "id": "agent-1"},
                {"title": "Test Riverside FM session access with bound credentials", "description": "", "planDocument": ""},
                [],
                can_assign_tasks=False,
            )
        self.assertIn("click or focus the Email field before waiting for anything else", prompt)
        self.assertIn("If the login page loads and appears idle, do not stop at page-load success", prompt)
        self.assertIn("blur the password field once", prompt)

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

    def test_create_subtasks_treats_delegated_child_throttle_as_non_fatal(self) -> None:
        parent_issue = {"id": "parent-1", "companyId": "company-1", "goalId": "goal-1"}
        raw_subtasks = [
            {
                "title": "Create test campaign with newsletter.html via Mailchimp API",
                "description": "Use the existing template and create a test Mailchimp campaign.",
                "status": "todo",
                "priority": "high",
                "assigneeAgentId": "agent-1",
            }
        ]

        def fake_api_request(method: str, path: str, payload=None, include_run_id: bool = False, tolerate_404: bool = False):
            if method == "GET" and path == "/companies/company-1/issues?parentId=parent-1":
                return []
            if method == "GET" and path == "/companies/company-1/issues?goalId=goal-1":
                return []
            if method == "GET" and path == "/companies/company-1/agents":
                return [{"id": "agent-1"}]
            if method == "POST" and path == "/companies/company-1/issues":
                raise worker.WorkerError(
                    "Paperclip API POST /companies/company-1/issues failed with 409: "
                    '{"error":"Too many delegated child issues were created under this parent recently. '
                    'Continue existing child issues before creating more than 5 in 15 minutes."}'
                )
            raise AssertionError(f"Unexpected API call: {method} {path}")

        with patch.object(worker, "api_request", side_effect=fake_api_request):
            created = worker.create_subtasks(parent_issue, raw_subtasks, allow_assignments=True)

        self.assertEqual([], created)

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

    def test_build_worker_result_includes_session_metadata(self) -> None:
        result = worker.build_worker_result(
            {
                "id": "agent-1",
                "companyId": "company-1",
                "name": "Hermes Worker",
            },
            {
                "id": "issue-1",
                "identifier": "ROM-44",
            },
            "done",
            [],
            {
                "sessionId": "session-1",
                "sessionName": "paperclip::agent-1::ROM-44",
            },
            "zai",
            "glm-4.7",
            {"inputTokens": 1, "outputTokens": 2, "cachedInputTokens": 0},
        )
        self.assertEqual("session-1", result["_sessionId"])
        self.assertEqual("paperclip::agent-1::ROM-44", result["_sessionDisplayId"])
        self.assertEqual(
            {"sessionId": "session-1", "sessionName": "paperclip::agent-1::ROM-44"},
            result["_sessionParams"],
        )

    def test_seed_hermes_home_context_writes_company_profile_files(self) -> None:
        with patch.dict(
            os.environ,
            {
                "PAPERCLIP_COMPANY_PROFILE_JSON": json.dumps(
                    {
                        "companyName": "Romance Unzipped",
                        "voiceDescription": "Warm, witty, emotionally direct.",
                        "targetAudience": "Romance readers who want sharp commentary.",
                        "defaultChannel": "newsletter",
                        "defaultGoal": "Make the next read irresistible.",
                        "voiceExamplesRight": ["Smart, intimate, and specific."],
                        "voiceExamplesWrong": ["Flat promo copy."],
                    }
                )
            },
            clear=False,
        ):
            with tempfile.TemporaryDirectory() as tmpdir:
                hermes_home = Path(tmpdir) / ".hermes"
                worker.seed_hermes_home_context(hermes_home)
                self.assertTrue((hermes_home / "SOUL.md").is_file())
                self.assertTrue((hermes_home / "AGENTS.md").is_file())
                self.assertIn("How We Describe Our Voice", (hermes_home / "SOUL.md").read_text())
                self.assertIn("Examples That Feel Exactly Right", (hermes_home / "SOUL.md").read_text())
                self.assertIn("Company Prompt Packet", (hermes_home / "AGENTS.md").read_text())

    def test_seed_hermes_home_context_writes_memory_files_when_enabled(self) -> None:
        with patch.dict(
            os.environ,
            {
                "PAPERCLIP_COMPANY_PROFILE_JSON": json.dumps(
                    {
                        "companyName": "Romance Unzipped",
                        "voiceDescription": "Warm, witty, emotionally direct.",
                        "targetAudience": "Romance readers who want sharp commentary.",
                        "defaultChannel": "newsletter",
                        "defaultGoal": "Make the next read irresistible.",
                        "voiceExamplesRight": ["Smart, intimate, and specific."],
                        "voiceExamplesWrong": ["Flat promo copy."],
                    }
                ),
                "PAPERCLIP_SEED_COMPANY_PROFILE_MEMORY": "1",
            },
            clear=False,
        ):
            with tempfile.TemporaryDirectory() as tmpdir:
                hermes_home = Path(tmpdir) / ".hermes"
                worker.seed_hermes_home_context(hermes_home)
                self.assertTrue((hermes_home / "USER.md").is_file())
                self.assertTrue((hermes_home / "MEMORY.md").is_file())
                self.assertIn("Working Audience", (hermes_home / "USER.md").read_text())
                self.assertIn("Seeded Company Memory", (hermes_home / "MEMORY.md").read_text())

    def test_main_posts_blocking_issue_comment_when_hermes_provider_run_fails(self) -> None:
        agent = {
            "id": "agent-1",
            "name": "CEO",
            "title": "Chief Executive Officer",
            "companyId": "company-1",
            "access": {"canAssignTasks": False},
        }
        issue = {
            "id": "issue-1",
            "identifier": "ROM-592",
            "companyId": "company-1",
            "title": "Run pipeline on episode 26 from YouTube channel",
            "status": "todo",
            "assigneeAgentId": "agent-1",
        }
        api_calls: list[tuple[str, str, object | None]] = []

        def fake_api_request(method: str, path: str, payload=None, include_run_id: bool = False, tolerate_404: bool = False):
            api_calls.append((method, path, payload))
            if method == "GET" and path == "/agents/me":
                return agent
            if method == "GET" and path.startswith("/companies/company-1/issues?"):
                return [issue]
            if method == "GET" and path == "/issues/issue-1":
                return issue
            if method == "POST" and path == "/issues/issue-1/checkout":
                return {"ok": True}
            if method == "GET" and path == "/issues/issue-1/comments":
                return []
            if method == "PATCH" and path == "/issues/issue-1":
                return {**issue, **(payload or {})}
            raise AssertionError(f"Unexpected API call: {method} {path}")

        with patch.dict(
            os.environ,
            {
                "PAPERCLIP_API_KEY": "test-key",
                "PAPERCLIP_RUN_ID": "run-1",
                "PAPERCLIP_COMPANY_ID": "company-1",
                "HERMES_PROVIDER": "zai",
                "HERMES_MODEL": "glm-4.7",
            },
            clear=False,
        ):
            with (
                patch.object(worker, "resolve_hermes_bin", return_value="/tmp/hermes"),
                patch.object(worker, "check_hermes_version", return_value="Hermes Agent v0.4.0"),
                patch.object(worker, "resolve_skills_dir", return_value=None),
                patch.object(worker, "resolve_browser_automation", return_value=None),
                patch.object(worker, "api_request", side_effect=fake_api_request),
                patch.object(worker, "resolve_hermes_home", return_value=Path("/tmp/.hermes")),
                patch.object(worker, "ensure_directory", return_value=Path("/tmp/.hermes")),
                patch.object(worker, "seed_hermes_home_context", return_value=[]),
                patch.object(worker, "read_runtime_session_params", return_value=None),
                patch.object(worker, "find_session_by_title", return_value=None),
                patch.object(worker, "build_prompt", return_value="prompt"),
                patch.object(
                    worker,
                    "run_hermes_with_retry",
                    side_effect=worker.WorkerError(
                        "Hermes failed with exit code 1: "
                        "openai.RateLimitError: Error code: 429 - "
                        "{'error': {'code': '1113', 'message': 'Insufficient balance or no resource package. "
                        "Please recharge.'}}"
                    ),
                ),
            ):
                with self.assertRaisesRegex(worker.WorkerError, "Insufficient balance or no resource package"):
                    worker.main()

        patch_calls = [call for call in api_calls if call[0] == "PATCH" and call[1] == "/issues/issue-1"]
        self.assertEqual(1, len(patch_calls))
        patch_payload = patch_calls[0][2]
        assert isinstance(patch_payload, dict)
        self.assertEqual("blocked", patch_payload["status"])
        self.assertIn("Run failed before the agent could post its structured update.", patch_payload["comment"])
        self.assertIn("Provider: zai", patch_payload["comment"])
        self.assertIn("Model: glm-4.7", patch_payload["comment"])
        self.assertIn("Insufficient balance or no resource package. Please recharge.", patch_payload["comment"])

    def test_normalize_hermes_response_salvages_issue_shaped_payload(self) -> None:
        normalized = worker.normalize_hermes_response(
            {
                "status": "done",
                "title": "26. Berries + Greed by Lily Mayne, a Cozy Monster Romance",
                "description": "Pipeline completed and assets are ready.",
                "priority": "medium",
                "assigneeAgentId": "agent-1",
            }
        )

        self.assertEqual("done", normalized["status"])
        self.assertEqual("", normalized["plan_markdown"])
        self.assertEqual("", normalized["change_summary"])
        self.assertIn("26. Berries + Greed by Lily Mayne, a Cozy Monster Romance", normalized["comment_markdown"])
        self.assertIn("Pipeline completed and assets are ready.", normalized["comment_markdown"])

if __name__ == "__main__":
    unittest.main()
