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

if __name__ == "__main__":
    unittest.main()
