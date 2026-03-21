#!/usr/bin/env python3
"""Bridge Paperclip process agents to Hermes noninteractive runs."""

from __future__ import annotations

import json
import os
import re
import signal
import shutil
import subprocess
import sys
import textwrap
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


DEFAULT_API_URL = "http://127.0.0.1:3100"
SCRIPT_PATH = Path(__file__).resolve()
DEFAULT_REPO_ROOT = SCRIPT_PATH.parent.parent
MAX_COMMENTS = 8
MAX_DESCRIPTION_CHARS = 1200
MAX_PLAN_CHARS = 1600
MAX_COMMENT_CHARS = 800
MAX_SUBTASKS = 10

WORKER_SKILL_NAME = "paperclip-worker"
WORKER_BASE_SKILLS = ["paperclip-worker", "paperclip"]
REQUIRED_RESPONSE_KEYS = {"status", "comment_markdown", "plan_markdown", "change_summary"}
BROWSER_AUTOMATION_PROVIDERS = {"playwright", "page_agent", "lightpanda"}
SUBTASK_ALLOWED_STATUSES = {"backlog", "todo", "in_progress", "blocked"}
SUBTASK_ALLOWED_PRIORITIES = {"critical", "high", "medium", "low"}


class WorkerError(RuntimeError):
    pass


def stderr(message: str) -> None:
    print(message, file=sys.stderr)


def debug(message: str) -> None:
    stderr(f"[hermes-worker] {message}")


def env_required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise WorkerError(f"Missing required environment variable: {name}")
    return value


def paperclip_headers(include_run_id: bool = False) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {env_required('PAPERCLIP_API_KEY')}",
        "Accept": "application/json",
    }
    if include_run_id:
        headers["X-Paperclip-Run-Id"] = env_required("PAPERCLIP_RUN_ID")
    return headers


def resolve_repo_root() -> Path:
    configured = os.environ.get("HERMES_REPO_ROOT", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    workspace_cwd = os.environ.get("PAPERCLIP_WORKSPACE_CWD", "").strip()
    if workspace_cwd:
        return Path(workspace_cwd).expanduser().resolve()
    return DEFAULT_REPO_ROOT


def resolve_hermes_bin() -> str:
    """Resolve the Hermes binary path.

    Resolution order (see ADR 0001 and doc/spec/paperclip-hermes-machine-boundary.md):
    1. HERMES_BIN environment variable (explicit path)
    2. 'hermes' on system PATH
    3. Dev-only repo fallback (only when PAPERCLIP_ALLOW_DEV_HERMES_REPO=1)

    Any other resolution path is a policy violation.
    """
    # Priority 1: explicit env var
    configured = os.environ.get("HERMES_BIN", "").strip()
    if configured:
        p = Path(configured).expanduser().resolve()
        if p.exists():
            return str(p)
        raise WorkerError(
            f"HERMES_BIN is set but the path does not exist: {configured}\n"
            "Fix HERMES_BIN or install Hermes at that path."
        )

    # Priority 2: system PATH
    found = shutil.which("hermes")
    if found:
        return found

    # Priority 3: dev-only fallback (opt-in only)
    allow_dev = os.environ.get("PAPERCLIP_ALLOW_DEV_HERMES_REPO", "").strip().lower()
    if allow_dev in ("1", "true", "yes"):
        dev_repo = os.environ.get("HERMES_DEV_REPO", "").strip()
        if dev_repo:
            dev_bin = Path(dev_repo).expanduser().resolve() / ".venv" / "bin" / "hermes"
        else:
            dev_bin = resolve_repo_root() / "hermes-agent" / ".venv" / "bin" / "hermes"
        if dev_bin.exists():
            debug(f"Using dev-only Hermes fallback: {dev_bin}")
            return str(dev_bin)
        raise WorkerError(
            f"PAPERCLIP_ALLOW_DEV_HERMES_REPO is set but dev Hermes binary not found at: {dev_bin}\n"
            "Set HERMES_DEV_REPO to the hermes-agent checkout path, or install Hermes properly."
        )

    raise WorkerError(
        "Hermes binary not found.\n"
        "Install Hermes and ensure 'hermes' is on PATH, or set HERMES_BIN to the binary path.\n"
        "See doc/spec/paperclip-hermes-machine-boundary.md for installation instructions.\n"
        "For dev-only repo fallback, set PAPERCLIP_ALLOW_DEV_HERMES_REPO=1."
    )


def check_hermes_version(hermes_bin: str) -> str:
    """Run 'hermes --version', verify binary works, and optionally check version pin.

    Returns the raw version output string.
    Raises WorkerError on missing binary, non-zero exit, or version mismatch.
    """
    try:
        result = subprocess.run(
            [hermes_bin, "--version"],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except FileNotFoundError as exc:
        raise WorkerError(f"Hermes binary not executable: {hermes_bin}") from exc
    except subprocess.TimeoutExpired as exc:
        raise WorkerError(f"Hermes --version timed out after 10s: {hermes_bin}") from exc
    except OSError as exc:
        raise WorkerError(f"Hermes binary failed to run: {exc}") from exc

    if result.returncode != 0:
        raise WorkerError(
            f"Hermes --version exited with code {result.returncode}: "
            f"{(result.stderr or result.stdout).strip()[:200]}"
        )

    version_output = (result.stdout or result.stderr).strip()
    if not version_output:
        raise WorkerError("Hermes --version produced no output")

    debug(f"Hermes version: {version_output}")

    required = os.environ.get("HERMES_REQUIRED_VERSION", "").strip()
    if required:
        version_match = re.search(r"(\d+\.\d+(?:\.\d+)?)", version_output)
        detected = version_match.group(1) if version_match else None
        if detected is None or (detected != required and not detected.startswith(required + ".")):
            raise WorkerError(
                f"Hermes version mismatch: detected {detected!r}, required {required!r}.\n"
                "Upgrade Hermes or update HERMES_REQUIRED_VERSION."
            )

    return version_output


def resolve_skills_dir() -> str | None:
    """Return an explicit skills directory path to pass to Hermes, or None.

    Paperclip does NOT mutate ~/.hermes/skills. Skills are passed per-run via
    HERMES_SKILLS_DIR. This replaces the old maybe_link_skills() side-effect approach.
    """
    configured = os.environ.get("HERMES_SKILLS_DIR", "").strip()
    if configured:
        p = Path(configured).expanduser().resolve()
        if p.is_dir():
            return str(p)
        debug(f"HERMES_SKILLS_DIR points to non-existent directory: {configured} (skipping)")
        return None

    # Fall back to repo-local skills if available (no mutation, just path passing)
    repo_root = resolve_repo_root()
    for candidate in [repo_root / "skills", repo_root / ".agents" / "skills"]:
        if candidate.is_dir():
            return str(candidate)

    return None


def default_browser_automation_command(provider: str, repo_root: Path) -> str | None:
    if provider == "playwright":
        script = repo_root / "bin" / "browser_channel_dry_run.mjs"
        return f"node {script}" if script.is_file() else None
    if provider == "page_agent":
        return "page-agent"
    if provider == "lightpanda":
        return "lightpanda"
    return None


def resolve_browser_automation() -> dict[str, Any] | None:
    provider = os.environ.get("PAPERCLIP_BROWSER_AUTOMATION_PROVIDER", "").strip().lower()
    if not provider:
        return None
    if provider not in BROWSER_AUTOMATION_PROVIDERS:
        debug(f"Ignoring unsupported browser automation provider: {provider}")
        return None

    repo_root = resolve_repo_root()
    command = (
        os.environ.get("PAPERCLIP_BROWSER_AUTOMATION_COMMAND", "").strip()
        or default_browser_automation_command(provider, repo_root)
        or ""
    )
    session_profile = os.environ.get("PAPERCLIP_BROWSER_SESSION_PROFILE", "").strip()
    headless_raw = os.environ.get("PAPERCLIP_BROWSER_HEADLESS", "").strip().lower()
    headless = headless_raw in {"1", "true", "yes", "on"}

    command_available: bool | None = None
    if command:
        command_head = command.split()[0]
        if "/" in command_head or command_head.startswith("."):
            command_available = Path(command_head).expanduser().exists()
        else:
            command_available = shutil.which(command_head) is not None

    return {
        "provider": provider,
        "command": command,
        "sessionProfile": session_profile,
        "headless": headless,
        "commandAvailable": command_available,
    }


def browser_automation_summary(config: dict[str, Any] | None) -> str:
    if not config:
        return "Browser automation: not configured."

    availability = config.get("commandAvailable")
    availability_label = (
        "available"
        if availability is True
        else "missing"
        if availability is False
        else "unverified"
    )
    lines = [
        f"Browser automation provider: {config['provider']}",
        f"Browser automation command: {config.get('command') or '(none)'}",
        f"Browser session profile: {config.get('sessionProfile') or '(none)'}",
        f"Browser headless preference: {'true' if config.get('headless') else 'false'}",
        f"Browser command availability: {availability_label}",
    ]
    return "\n".join(lines)


def resolve_worker_skills(browser_automation: dict[str, Any] | None = None) -> str:
    skills = list(WORKER_BASE_SKILLS)
    if browser_automation:
        skills.append("browser-runtime")
    return ",".join(skills)


def api_request(
    method: str,
    path: str,
    *,
    payload: dict[str, Any] | None = None,
    include_run_id: bool = False,
    tolerate_404: bool = False,
) -> Any:
    api_base = os.environ.get("PAPERCLIP_API_URL", DEFAULT_API_URL).rstrip("/")
    url = f"{api_base}/api{path}"
    data = None
    headers = paperclip_headers(include_run_id=include_run_id)
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        if tolerate_404 and exc.code == 404:
            return None
        raise WorkerError(f"Paperclip API {method} {path} failed with {exc.code}: {body}") from exc
    except urllib.error.URLError as exc:
        raise WorkerError(f"Paperclip API {method} {path} failed: {exc}") from exc
    if not raw.strip():
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise WorkerError(f"Paperclip API {method} {path} returned invalid JSON") from exc


def pick_issue(issues: list[dict[str, Any]]) -> dict[str, Any] | None:
    requested_issue_id = os.environ.get("PAPERCLIP_TASK_ID", "").strip()
    if requested_issue_id:
        for issue in issues:
            if issue.get("id") == requested_issue_id:
                return issue
    priorities = {"in_progress": 0, "todo": 1, "backlog": 2, "blocked": 3}
    ordered = sorted(
        issues,
        key=lambda issue: (
            priorities.get(str(issue.get("status", "")).strip(), 99),
            str(issue.get("identifier", issue.get("id", ""))),
        ),
    )
    return ordered[0] if ordered else None


def issue_summary(issue: dict[str, Any]) -> str:
    identifier = issue.get("identifier") or issue.get("id") or "Unknown issue"
    title = issue.get("title") or "(untitled)"
    status = issue.get("status") or "unknown"
    priority = issue.get("priority") or "unset"
    project = ""
    if isinstance(issue.get("project"), dict):
        project = issue["project"].get("name") or ""
    goal = ""
    if isinstance(issue.get("goal"), dict):
        goal = issue["goal"].get("title") or ""
    lines = [
        f"Identifier: {identifier}",
        f"Title: {title}",
        f"Status: {status}",
        f"Priority: {priority}",
    ]
    if project:
        lines.append(f"Project: {project}")
    if goal:
        lines.append(f"Goal: {goal}")
    description = str(issue.get("description") or "").strip()
    if len(description) > MAX_DESCRIPTION_CHARS:
        description = f"{description[:MAX_DESCRIPTION_CHARS].rstrip()}..."
    if description:
        lines.append("")
        lines.append("Description:")
        lines.append(description)
    plan_document = str(issue.get("planDocument") or "").strip()
    if len(plan_document) > MAX_PLAN_CHARS:
        plan_document = f"{plan_document[:MAX_PLAN_CHARS].rstrip()}..."
    if plan_document:
        lines.append("")
        lines.append("Current plan document:")
        lines.append(plan_document)
    return "\n".join(lines)


def comments_summary(comments: list[dict[str, Any]]) -> str:
    if not comments:
        return "No comments."
    snippets: list[str] = []
    for comment in comments[-MAX_COMMENTS:]:
        author = "Unknown"
        if comment.get("createdByAgentId"):
            author = f"Agent {comment['createdByAgentId']}"
        elif comment.get("createdByUserId"):
            author = f"User {comment['createdByUserId']}"
        body = str(comment.get("body") or "").strip()
        if len(body) > MAX_COMMENT_CHARS:
            body = f"{body[:MAX_COMMENT_CHARS].rstrip()}..."
        if not body:
            continue
        snippets.append(f"{author}: {body}")
    return "\n\n".join(snippets) if snippets else "No comments."


def build_runtime_preflight(agent: dict[str, Any], issue: dict[str, Any]) -> str:
    title = f"{agent.get('title') or ''} {issue.get('title') or ''}".lower()
    checks: list[str] = []
    browser_automation = resolve_browser_automation()

    def env_presence(name: str) -> str:
        return "present" if os.environ.get(name, "").strip() else "missing"

    if "siteground" in title or "domain" in title or "website" in title:
        checks.append(f"SITEGROUND_USERNAME={env_presence('SITEGROUND_USERNAME')}")
        checks.append(f"SITEGROUND_PASSWORD={env_presence('SITEGROUND_PASSWORD')}")

    if any(token in title for token in ("spotify", "rss", "apple", "podcast", "feed")):
        checks.append(f"APPLEID_USERNAME={env_presence('APPLEID_USERNAME')}")
        checks.append(f"APPLEID_PASSWORD={env_presence('APPLEID_PASSWORD')}")
        checks.append(f"SPOTIFY_RSS_FEED_URL={env_presence('SPOTIFY_RSS_FEED_URL')}")
        rss_url = os.environ.get("SPOTIFY_RSS_FEED_URL", "").strip()
        if rss_url:
            try:
                request = urllib.request.Request(rss_url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(request, timeout=20) as response:
                    content_type = response.headers.get("Content-Type", "")
                    body = response.read(4096).decode("utf-8", errors="replace")
                title_match = re.search(r"<title>(.*?)</title>", body, flags=re.IGNORECASE | re.DOTALL)
                rss_title = title_match.group(1).strip() if title_match else "unknown"
                checks.append(
                    "RSS_FETCH="
                    + f"ok status={getattr(response, 'status', 'unknown')} content_type={content_type} title={rss_title[:120]}"
                )
            except Exception as exc:  # pragma: no cover - network errors vary
                checks.append(f"RSS_FETCH=failed {type(exc).__name__}: {str(exc)[:160]}")

    if browser_automation:
        checks.append(f"BROWSER_PROVIDER={browser_automation['provider']}")
        checks.append(f"BROWSER_COMMAND={browser_automation.get('command') or 'missing'}")
        checks.append(
            "BROWSER_COMMAND_AVAILABLE="
            + (
                "yes"
                if browser_automation.get("commandAvailable") is True
                else "no"
                if browser_automation.get("commandAvailable") is False
                else "unknown"
            )
        )
        checks.append(
            f"BROWSER_SESSION_PROFILE={browser_automation.get('sessionProfile') or 'none'}"
        )
        checks.append(
            f"BROWSER_HEADLESS={'true' if browser_automation.get('headless') else 'false'}"
        )

    return "\n".join(f"- {check}" for check in checks) if checks else "No runtime preflight checks."


def build_company_context(agent: dict[str, Any]) -> str:
    """Pre-fetch company dashboard and open issues for the agent's prompt context.

    Hermes terminal tools run inside Docker, so they cannot reach the host's
    Paperclip API at 127.0.0.1. We fetch the data here in the worker (which
    runs on the host) and inject it into the prompt as plain text.
    """
    company_id = os.environ.get("PAPERCLIP_COMPANY_ID", "").strip()
    if not company_id:
        return "Company context unavailable (no PAPERCLIP_COMPANY_ID)."

    sections: list[str] = []

    # Dashboard summary
    try:
        dashboard = api_request("GET", f"/companies/{company_id}/dashboard")
        if isinstance(dashboard, dict):
            tasks = dashboard.get("tasks", {})
            agents_info = dashboard.get("agents", {})
            sections.append(
                f"Dashboard: {agents_info.get('active', '?')} agents active, "
                f"{tasks.get('open', '?')} open tasks, "
                f"{tasks.get('inProgress', '?')} in progress, "
                f"{tasks.get('blocked', '?')} blocked, "
                f"{tasks.get('done', '?')} done"
            )
    except WorkerError:
        sections.append("Dashboard: fetch failed")

    # Open issues summary
    try:
        issues = api_request(
            "GET",
            f"/companies/{company_id}/issues?status=todo,in_progress,blocked&limit=20",
        )
        if isinstance(issues, list) and issues:
            lines = ["Open issues:"]
            for iss in issues[:20]:
                assignee = iss.get("assigneeAgentId") or "(unassigned)"
                lines.append(
                    f"  - {iss.get('identifier', '?')} [{iss.get('status', '?')}] "
                    f"P:{iss.get('priority', '?')} → {assignee[:12]}  "
                    f"{(iss.get('title') or '')[:60]}"
                )
            sections.append("\n".join(lines))
    except WorkerError:
        sections.append("Open issues: fetch failed")

    # Agent list with status
    try:
        agents_list = api_request("GET", f"/companies/{company_id}/agents")
        if isinstance(agents_list, list) and agents_list:
            lines = ["Agents (use these exact ids for assigneeAgentId):"]
            for a in agents_list:
                lines.append(
                    f"  - {a.get('name', '?'):20s} [{a.get('status', '?')}] "
                    f"id={a.get('id', '?')} role={a.get('role', '?')}"
                )
            sections.append("\n".join(lines))
    except WorkerError:
        sections.append("Agents: fetch failed")

    return "\n\n".join(sections) if sections else "No company context available."


def build_prompt(agent: dict[str, Any], issue: dict[str, Any], comments: list[dict[str, Any]]) -> str:
    role_prompt = str(agent.get("adapterConfig", {}).get("promptTemplate") or "").strip()
    wake_reason = os.environ.get("PAPERCLIP_WAKE_REASON", "").strip()
    wake_comment_id = os.environ.get("PAPERCLIP_WAKE_COMMENT_ID", "").strip()
    title = str(agent.get("title") or "").lower()
    role = str(agent.get("role") or "").lower()
    technical_role = any(
        token in f"{title} {role}" for token in ("technical", "cto", "engineer", "integrator", "analyst")
    )
    agent_id = str(agent.get("id") or "").strip()
    has_plan = bool(str(issue.get("planDocument") or "").strip())
    prior_agent_updates = sum(1 for comment in comments if str(comment.get("authorAgentId") or "").strip() == agent_id)
    first_touch = prior_agent_updates == 0 and not has_plan
    wants_plan = not has_plan and not first_touch
    plan_mode = wants_plan
    status_only_mode = first_touch
    role_prompt_short = role_prompt[:500].rstrip() + ("..." if len(role_prompt) > 500 else "")
    short_description = str(issue.get("description") or "").strip()
    if len(short_description) > 320:
        short_description = f"{short_description[:320].rstrip()}..."
    runtime_preflight = build_runtime_preflight(agent, issue)
    browser_automation = resolve_browser_automation()
    browser_summary = browser_automation_summary(browser_automation)

    # Pre-fetch company context so the LLM has real data without needing API access
    company_context = build_company_context(agent)

    if status_only_mode:
        prompt = f"""
        Return exactly one JSON object and nothing else.

        Agent:
        - Name: {agent.get("name") or "Unknown"}
        - Title: {agent.get("title") or "Unknown"}

        Role instructions:
        {role_prompt_short or "No additional role instructions."}

        Task:
        - Identifier: {issue.get("identifier") or issue.get("id") or "Unknown"}
        - Title: {issue.get("title") or "(untitled)"}
        - Description: {short_description or "No description."}

        Runtime preflight:
        {runtime_preflight}

        Browser automation:
        {browser_summary}

        Company context:
        {company_context}

        Wake reason: {wake_reason or "scheduled_or_manual"}

        Return JSON:
        {{
          "status": "in_progress" | "blocked" | "done",
          "comment_markdown": "one short operational update sentence",
          "plan_markdown": "",
          "change_summary": ""
        }}

        Do not write a plan. Just report progress or blocker in one short sentence.
        """
        return textwrap.dedent(prompt).strip()

    prompt = f"""
    Return exactly one JSON object and nothing else.

    Agent:
    - Name: {agent.get("name") or "Unknown"}
    - Title: {agent.get("title") or "Unknown"}
    - Role: {agent.get("role") or "Unknown"}

    Role instructions:
    {role_prompt or "No additional role instructions."}

    Task:
    {issue_summary(issue)}

    Runtime preflight:
    {runtime_preflight}

    Browser automation:
    {browser_summary}

    Company context:
    {company_context}

    Recent comments:
    {comments_summary(comments)}

    Wake:
    - Reason: {wake_reason or "scheduled_or_manual"}
    - Comment id: {wake_comment_id or "none"}

    JSON schema:
    {{
      "status": "in_progress" | "blocked" | "done",
      "comment_markdown": "1-3 short sentences",
      "plan_markdown": "short markdown plan, or empty string",
      "change_summary": "very short summary, or empty string",
      "subtasks": [
        {{
          "title": "short governed issue title",
          "description": "optional longer details",
          "priority": "critical | high | medium | low",
          "status": "backlog | todo | in_progress | blocked",
          "assigneeAgentId": "uuid of delegated agent, if known",
          "assigneeUserId": "user id, if delegated to a human"
        }}
      ]
    }}

    Keep it brief. If unsure, keep status as "in_progress".
    If browser automation is configured, prefer the named provider/command and reuse the named session profile instead of inventing a different browser path.
    If this work needs delegated follow-up, include governed subtasks in the "subtasks" array. The worker will create them as child issues under this issue.
    Use exact agent ids from the company context for assigneeAgentId. If you are not sure, leave assigneeAgentId blank.
    {"Do not write a plan for this run. Set plan_markdown and change_summary to empty strings. Just post a concise status update or blocker." if status_only_mode else ""}
    {"Focus on creating a concise implementation plan for this run. Include a 3-5 bullet plan and a short status update." if plan_mode else ""}
    """
    return textwrap.dedent(prompt).strip()


def build_retry_prompt(agent: dict[str, Any], issue: dict[str, Any]) -> str:
    role_hint = str(agent.get("title") or agent.get("name") or "Agent").strip()
    identifier = issue.get("identifier") or issue.get("id") or "Unknown"
    title = issue.get("title") or "(untitled)"
    return textwrap.dedent(
        f"""
        Reply with exactly one JSON object and nothing else.

        Agent title: {role_hint}
        Issue: {identifier} - {title}

        JSON:
        {{
          "status": "in_progress" | "blocked" | "done",
          "comment_markdown": "one short sentence, 18 words max",
          "plan_markdown": "",
          "change_summary": ""
        }}

        If external access or credentials are missing, return status "blocked".
        """
    ).strip()



def extract_json_object(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if not text:
        raise WorkerError("Hermes returned empty output")
    fenced = re.match(r"^```(?:json)?\s*(.*?)\s*```$", text, flags=re.DOTALL)
    if fenced:
        text = fenced.group(1).strip()
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        decoder = json.JSONDecoder()
        for start, char in enumerate(text):
            if char != "{":
                continue
            try:
                value, _ = decoder.raw_decode(text[start:])
                break
            except json.JSONDecodeError:
                continue
        else:
            raise WorkerError(f"Hermes did not return parseable JSON: {raw[:400]}")
    if not isinstance(value, dict):
        raise WorkerError("Hermes response must be a JSON object")
    return value


def validate_hermes_response(response: dict[str, Any]) -> None:
    """Fail hard if the response is missing required fields or has an invalid status."""
    missing = REQUIRED_RESPONSE_KEYS - response.keys()
    if missing:
        raise WorkerError(
            f"Hermes response missing required fields: {sorted(missing)}. "
            f"Got keys: {sorted(response.keys())}"
        )
    status = str(response.get("status") or "").strip()
    if status not in {"in_progress", "blocked", "done"}:
        raise WorkerError(
            f"Hermes response has invalid status: {status!r}. "
            f"Must be one of: in_progress, blocked, done"
        )
    subtasks = response.get("subtasks")
    if subtasks is not None:
        if not isinstance(subtasks, list):
            raise WorkerError("Hermes response subtasks field must be a JSON array")
        if len(subtasks) > MAX_SUBTASKS:
            raise WorkerError(
                f"Hermes response contains too many subtasks: {len(subtasks)} > {MAX_SUBTASKS}"
            )


def run_hermes(prompt: str, skills_dir: str | None = None) -> dict[str, Any]:
    hermes_bin = resolve_hermes_bin()
    repo_root = resolve_repo_root()
    model = os.environ.get("HERMES_MODEL", "").strip()
    provider = os.environ.get("HERMES_PROVIDER", "").strip()
    browser_automation = resolve_browser_automation()
    worker_skills = resolve_worker_skills(browser_automation)
    cmd = [hermes_bin, "chat", "-Q", "--yolo", "--skills", worker_skills, "-q", prompt]
    if provider:
        cmd.extend(["--provider", provider])
    if model:
        cmd.extend(["-m", model])
    hermes_env = os.environ.copy()
    hermes_env.setdefault("NO_COLOR", "1")
    # Pass skills dir explicitly — no mutation of ~/.hermes/skills
    if skills_dir:
        hermes_env["HERMES_SKILLS_DIR"] = skills_dir
    if browser_automation:
        hermes_env["HERMES_BROWSER_AUTOMATION_PROVIDER"] = browser_automation["provider"]
        if browser_automation.get("command"):
            hermes_env["HERMES_BROWSER_AUTOMATION_COMMAND"] = browser_automation["command"]
        if browser_automation.get("sessionProfile"):
            hermes_env["HERMES_BROWSER_SESSION_PROFILE"] = browser_automation["sessionProfile"]
        hermes_env["HERMES_BROWSER_HEADLESS"] = "1" if browser_automation.get("headless") else "0"
        hermes_env["HERMES_BROWSER_RUNTIME_WRAPPER"] = str(
            resolve_repo_root() / "bin" / "hermes_browser_runtime.mjs"
        )
    timeout_sec = int(os.environ.get("HERMES_TIMEOUT_SEC", "150"))
    debug(
        "Invoking Hermes "
        f"(model={model or 'default'}, provider={provider or 'default'}, "
        f"skills={worker_skills}, timeout={timeout_sec}s)"
    )
    proc = subprocess.Popen(
        cmd,
        cwd=str(repo_root),
        env=hermes_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    try:
        stdout, stderr_text = proc.communicate(timeout=timeout_sec)
    except subprocess.TimeoutExpired:
        debug("Hermes exceeded timeout; terminating process group")
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            stdout, stderr_text = proc.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            stdout, stderr_text = proc.communicate()
        raise WorkerError(f"Hermes timed out after {timeout_sec}s")
    if proc.returncode != 0:
        full_output = (stderr_text or stdout).strip()
        # Dump full output to a log file for debugging (no truncation)
        try:
            log_path = Path("/tmp/hermes_last_failure.log")
            log_path.write_text(full_output, encoding="utf-8")
            debug(f"Full Hermes failure output written to {log_path} ({len(full_output)} chars)")
        except Exception:
            pass
        raise WorkerError(
            f"Hermes failed with exit code {proc.returncode}: {full_output[:4000]}"
        )
    debug(f"Hermes completed with {len(stdout)} stdout chars")
    response = extract_json_object(stdout)
    validate_hermes_response(response)
    return response


def run_hermes_with_retry(
    agent: dict[str, Any],
    issue: dict[str, Any],
    prompt: str,
    skills_dir: str | None = None,
) -> dict[str, Any]:
    try:
        return run_hermes(prompt, skills_dir=skills_dir)
    except WorkerError as exc:
        retryable = "timed out" in str(exc).lower() or "parseable json" in str(exc).lower()
        if not retryable:
            raise
        retry_prompt = build_retry_prompt(agent, issue)
        debug(f"Retrying Hermes with compact prompt ({len(retry_prompt)} chars)")
        return run_hermes(retry_prompt, skills_dir=skills_dir)


def estimate_token_usage(prompt_chars: int, response_chars: int) -> dict[str, int]:
    """Rough token estimate: ~4 chars per token for English text.

    This is an approximation since we don't have access to the actual token
    counts from the LLM provider. The process adapter extracts _usage from
    stdout JSON and reports it to the heartbeat cost ledger.
    """
    return {
        "inputTokens": max(1, prompt_chars // 4),
        "outputTokens": max(1, response_chars // 4),
        "cachedInputTokens": 0,
    }


def normalize_status(value: Any) -> str:
    status = str(value or "").strip().lower()
    if status not in {"in_progress", "blocked", "done"}:
        return "in_progress"
    return status


def normalize_subtask_status(value: Any) -> str:
    status = str(value or "").strip().lower()
    if status not in SUBTASK_ALLOWED_STATUSES:
        return "backlog"
    return status


def normalize_subtask_priority(value: Any) -> str:
    priority = str(value or "").strip().lower()
    if priority not in SUBTASK_ALLOWED_PRIORITIES:
        return "medium"
    return priority


def ensure_issue_checkout(issue: dict[str, Any], agent_id: str) -> bool:
    """Attempt to checkout the issue. Returns True on success, False on 409 conflict."""
    try:
        api_request(
            "POST",
            f"/issues/{issue['id']}/checkout",
            payload={"agentId": agent_id, "expectedStatuses": ["todo", "backlog", "blocked", "in_progress"]},
            include_run_id=True,
        )
        return True
    except WorkerError as exc:
        if "409" in str(exc):
            debug(f"Checkout conflict for {issue.get('identifier') or issue['id']} (locked by another run)")
            return False
        raise


def upsert_plan_document(issue_id: str, plan_markdown: str, change_summary: str) -> None:
    if not plan_markdown.strip():
        return
    existing = api_request("GET", f"/issues/{issue_id}/documents/plan", tolerate_404=True)
    payload: dict[str, Any] = {
        "title": "Implementation plan",
        "format": "markdown",
        "body": plan_markdown.strip(),
    }
    if change_summary.strip():
        payload["changeSummary"] = change_summary.strip()
    revision_id = None
    if isinstance(existing, dict):
        revision_id = existing.get("latestRevisionId") or existing.get("currentRevisionId")
    if revision_id:
        payload["baseRevisionId"] = revision_id
        debug(f"Updating plan document with baseRevisionId={revision_id!r}")
    api_request("PUT", f"/issues/{issue_id}/documents/plan", payload=payload, include_run_id=True)


def patch_issue(issue_id: str, status: str, comment_markdown: str) -> None:
    payload: dict[str, Any] = {"status": status}
    if comment_markdown.strip():
        payload["comment"] = comment_markdown.strip()
    api_request("PATCH", f"/issues/{issue_id}", payload=payload, include_run_id=True)


def normalize_subtask_payload(
    parent_issue: dict[str, Any],
    raw_subtask: Any,
    index: int,
    valid_agent_ids: set[str] | None = None,
) -> dict[str, Any]:
    if not isinstance(raw_subtask, dict):
        raise WorkerError(f"Subtask #{index + 1} must be a JSON object")

    title = str(raw_subtask.get("title") or "").strip()
    if not title:
        raise WorkerError(f"Subtask #{index + 1} is missing a title")
    title = title[:200]

    description = str(raw_subtask.get("description") or "").strip()
    if len(description) > 5000:
        description = f"{description[:5000].rstrip()}..."

    payload: dict[str, Any] = {
        "title": title,
        "description": description or None,
        "status": normalize_subtask_status(raw_subtask.get("status")),
        "priority": normalize_subtask_priority(raw_subtask.get("priority")),
        "parentId": parent_issue["id"],
        "projectId": parent_issue.get("projectId"),
        "goalId": parent_issue.get("goalId"),
        "requestDepth": int(parent_issue.get("requestDepth") or 0) + 1,
    }

    for key in ("projectWorkspaceId", "executionWorkspaceId", "executionWorkspacePreference", "billingCode"):
        value = parent_issue.get(key)
        if value is not None:
            payload[key] = value

    if parent_issue.get("executionWorkspaceSettings"):
        payload["executionWorkspaceSettings"] = parent_issue.get("executionWorkspaceSettings")

    assignee_agent_id = str(raw_subtask.get("assigneeAgentId") or "").strip()
    if assignee_agent_id:
        if valid_agent_ids is not None and assignee_agent_id not in valid_agent_ids:
            debug(
                f"Ignoring invalid assigneeAgentId {assignee_agent_id!r} for subtask {title!r}; "
                "not found in company agent roster"
            )
        else:
            payload["assigneeAgentId"] = assignee_agent_id

    assignee_user_id = str(raw_subtask.get("assigneeUserId") or "").strip()
    if assignee_user_id:
        payload["assigneeUserId"] = assignee_user_id

    for optional_key in ("assigneeAdapterOverrides", "labelIds"):
        if optional_key in raw_subtask and raw_subtask[optional_key] is not None:
            payload[optional_key] = raw_subtask[optional_key]

    return payload


def create_subtasks(parent_issue: dict[str, Any], raw_subtasks: Any) -> list[dict[str, Any]]:
    if raw_subtasks in (None, "", []):
        return []
    if not isinstance(raw_subtasks, list):
        raise WorkerError("Hermes response subtasks field must be a JSON array")
    if len(raw_subtasks) > MAX_SUBTASKS:
        raise WorkerError(f"Hermes response contains too many subtasks: {len(raw_subtasks)} > {MAX_SUBTASKS}")

    company_id = str(parent_issue.get("companyId") or "").strip()
    if not company_id:
        raise WorkerError("Parent issue is missing companyId")

    existing_children_query = urllib.parse.urlencode({"parentId": parent_issue["id"]})
    existing_children = api_request("GET", f"/companies/{company_id}/issues?{existing_children_query}")
    if not isinstance(existing_children, list):
        raise WorkerError("Failed to load existing child issues for parent task")
    existing_by_title = {
        str(child.get("title") or "").strip().casefold(): child
        for child in existing_children
        if str(child.get("title") or "").strip()
    }
    company_agents = api_request("GET", f"/companies/{company_id}/agents")
    valid_agent_ids: set[str] | None = None
    if isinstance(company_agents, list):
        valid_agent_ids = {
            str(agent.get("id") or "").strip()
            for agent in company_agents
            if isinstance(agent, dict) and str(agent.get("id") or "").strip()
        }

    created: list[dict[str, Any]] = []
    for index, raw_subtask in enumerate(raw_subtasks):
        payload = normalize_subtask_payload(parent_issue, raw_subtask, index, valid_agent_ids=valid_agent_ids)
        normalized_title = payload["title"].strip().casefold()
        existing = existing_by_title.get(normalized_title)
        if existing:
            debug(
                f"Reusing existing subtask {existing.get('identifier') or existing.get('id')} "
                f"for {payload['title']!r}"
            )
            created.append(existing)
            existing_by_title[normalized_title] = existing
            continue
        debug(
            "Creating governed subtask "
            f"#{index + 1}: {payload['title']!r} "
            f"(assignee={payload.get('assigneeAgentId') or payload.get('assigneeUserId') or 'unassigned'})"
        )
        issue = api_request(
            "POST",
            f"/companies/{company_id}/issues",
            payload=payload,
            include_run_id=True,
        )
        if not isinstance(issue, dict):
            raise WorkerError("Paperclip API returned an invalid subtask creation response")
        created.append(issue)
        existing_by_title[normalized_title] = issue
        debug(
            f"Created subtask {issue.get('identifier') or issue.get('id')} "
            f"-> {issue.get('title') or payload['title']!r}"
        )
    return created


def append_subtask_summary(comment_markdown: str, created_subtasks: list[dict[str, Any]]) -> str:
    if not created_subtasks:
        return comment_markdown
    lines = ["", "Created governed subtasks:"]
    for subtask in created_subtasks:
        identifier = subtask.get("identifier") or subtask.get("id") or "unknown"
        title = subtask.get("title") or "(untitled)"
        assignee = subtask.get("assigneeAgentId") or subtask.get("assigneeUserId") or "unassigned"
        lines.append(f"- {identifier}: {title} [{assignee}]")
    summary = "\n".join(lines)
    if comment_markdown.strip():
        return f"{comment_markdown.rstrip()}{summary}"
    return summary.strip()


def fetch_active_issue(agent: dict[str, Any]) -> dict[str, Any] | None:
    company_id = env_required("PAPERCLIP_COMPANY_ID")
    agent_id = agent["id"]
    query = urllib.parse.urlencode(
        {
            "assigneeAgentId": agent_id,
            "status": "todo,in_progress,blocked,backlog",
        }
    )
    issues = api_request("GET", f"/companies/{company_id}/issues?{query}")
    if not isinstance(issues, list):
        raise WorkerError("Issue list response was not an array")
    selected = pick_issue(issues)
    if not selected:
        return None
    issue = api_request("GET", f"/issues/{selected['id']}")
    if not isinstance(issue, dict):
        raise WorkerError("Issue detail response was not an object")
    return issue


def main() -> int:
    debug("Worker start")

    # Resolve and verify Hermes binary upfront — fail fast before any API calls
    hermes_bin = resolve_hermes_bin()
    check_hermes_version(hermes_bin)

    # Resolve skills dir once — explicit path passing, no ~/.hermes mutation
    # Skills are delivered from the repo-local directory or HERMES_SKILLS_DIR env var,
    # never mutated into ~/.hermes/skills as a side effect.
    skills_dir = resolve_skills_dir()
    if skills_dir:
        debug(f"Using skills dir: {skills_dir}")
    else:
        debug("No skills dir configured (HERMES_SKILLS_DIR not set, no repo-local skills found)")

    browser_automation = resolve_browser_automation()
    if browser_automation:
        debug(
            "Browser automation configured: "
            f"provider={browser_automation['provider']} "
            f"command={browser_automation.get('command') or '(none)'} "
            f"profile={browser_automation.get('sessionProfile') or '(none)'} "
            f"headless={'true' if browser_automation.get('headless') else 'false'}"
        )
    else:
        debug("Browser automation not configured")

    debug("Resolving current agent")
    agent = api_request("GET", "/agents/me")
    if not isinstance(agent, dict) or not agent.get("id"):
        raise WorkerError("Unable to resolve current Paperclip agent")

    debug(f"Resolved agent {agent.get('name') or agent['id']}")
    issue = fetch_active_issue(agent)
    if issue is None:
        debug("No assigned issue found")
        print(json.dumps({"ok": True, "idle": True, "message": "No assigned issue available"}))
        return 0

    debug(f"Selected issue {issue.get('identifier') or issue['id']}")
    if not ensure_issue_checkout(issue, str(agent["id"])):
        debug("Issue locked by another run, skipping")
        print(json.dumps({"ok": True, "idle": True, "message": f"Issue {issue.get('identifier') or issue['id']} locked by another run"}))
        return 0
    debug("Issue checkout confirmed")
    comments = api_request("GET", f"/issues/{issue['id']}/comments")
    if not isinstance(comments, list):
        comments = []

    prompt = build_prompt(agent, issue, comments)
    debug(f"Built prompt ({len(prompt)} chars)")
    hermes_output = run_hermes_with_retry(agent, issue, prompt, skills_dir=skills_dir)

    status = normalize_status(hermes_output.get("status"))
    comment_markdown = str(hermes_output.get("comment_markdown") or "").strip()
    plan_markdown = str(hermes_output.get("plan_markdown") or "").strip()
    change_summary = str(hermes_output.get("change_summary") or "").strip()
    created_subtasks = create_subtasks(issue, hermes_output.get("subtasks"))
    if created_subtasks:
        comment_markdown = append_subtask_summary(comment_markdown, created_subtasks)

    upsert_plan_document(str(issue["id"]), plan_markdown, change_summary)
    debug(f"Plan update applied={bool(plan_markdown)}")
    patch_issue(str(issue["id"]), status, comment_markdown)
    debug(f"Issue patched with status={status}")

    model = os.environ.get("HERMES_MODEL", "").strip() or "default"
    provider = os.environ.get("HERMES_PROVIDER", "").strip() or "default"
    response_chars = sum(len(str(v)) for v in hermes_output.values())
    usage = estimate_token_usage(len(prompt), response_chars)

    print(
        json.dumps(
            {
                "ok": True,
                "agentId": agent["id"],
                "issueId": issue["id"],
                "issueIdentifier": issue.get("identifier"),
                "status": status,
                "planUpdated": bool(plan_markdown),
                "createdSubtasks": [subtask.get("identifier") or subtask.get("id") for subtask in created_subtasks],
                "_usage": usage,
                "_provider": provider,
                "_model": model,
            }
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except WorkerError as exc:
        stderr(str(exc))
        raise SystemExit(1)
    except subprocess.TimeoutExpired as exc:
        stderr(f"Hermes timed out after {exc.timeout} seconds")
        raise SystemExit(1)
