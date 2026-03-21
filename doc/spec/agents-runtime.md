# Agent Runtime Guide

Status: User-facing guide  
Last updated: 2026-02-17  
Audience: Operators setting up and running agents in Paperclip

## 1. What this system does

Agents in Paperclip do not run continuously.  
They run in **heartbeats**: short execution windows triggered by a wakeup.

Each heartbeat:

1. Starts the configured agent adapter (for example, Claude CLI or Codex CLI)
2. Gives it the current prompt/context
3. Lets it work until it exits, times out, or is cancelled
4. Stores results (status, token usage, errors, logs)
5. Updates the UI live

## 2. When an agent wakes up

An agent can be woken up in four ways:

- `timer`: scheduled interval (for example every 5 minutes)
- `assignment`: when work is assigned/checked out to that agent
- `on_demand`: manual wakeup (button/API)
- `automation`: system-triggered wakeup for future automations

If an agent is already running, new wakeups are merged (coalesced) instead of launching duplicate runs.

## 3. What to configure per agent

## 3.1 Adapter choice

Common choices:

- `claude_local`: runs your local `claude` CLI
- `codex_local`: runs your local `codex` CLI
- `process`: generic shell command adapter
- `http`: calls an external HTTP endpoint

For `claude_local` and `codex_local`, Paperclip assumes the CLI is already installed and authenticated on the host machine.

## 3.2 Runtime behavior

In agent runtime settings, configure heartbeat policy:

- `enabled`: allow scheduled heartbeats
- `intervalSec`: timer interval (0 = disabled)
- `wakeOnAssignment`: wake when assigned work
- `wakeOnOnDemand`: allow ping-style on-demand wakeups
- `wakeOnAutomation`: allow system automation wakeups

## 3.3 Working directory and execution limits

For local adapters, set:

- `cwd` (working directory)
- `timeoutSec` (max runtime per heartbeat)
- `graceSec` (time before force-kill after timeout/cancel)
- optional env vars and extra CLI args
- optional `externalSkillDirs` for additional local skill packs
- optional `contextPrepCommand` to build repo/task context before the run and append stdout to the prompt
- for `process`, optional browser automation settings:
  - `browserAutomationProvider`
  - `browserAutomationCommand`
  - `browserSessionProfile`
  - `browserHeadless`

`externalSkillDirs` is the intended seam for third-party local skill packs such as Superpowers.

`contextPrepCommand` is the intended seam for repo summarizers such as context-hub. It runs in the configured working directory before the adapter starts, and its stdout is appended to the prompt as prepared context.

For `process` workers, browser automation selection is passed through a stable env contract:

- `PAPERCLIP_BROWSER_AUTOMATION_PROVIDER`
- `PAPERCLIP_BROWSER_AUTOMATION_COMMAND`
- `PAPERCLIP_BROWSER_SESSION_PROFILE`
- `PAPERCLIP_BROWSER_HEADLESS`

Current provider identifiers are:

- `playwright`
- `page_agent`
- `lightpanda`

Paperclip does not implement those runtimes itself in the process adapter. The worker command remains responsible for consuming these env vars and invoking the selected browser layer.

## 3.4 Prompt templates

You can set:

- `promptTemplate`: used for every run (first run and resumed sessions)

Templates support variables like `{{agent.id}}`, `{{agent.name}}`, and run context values.

## 4. Session resume behavior

Paperclip stores resumable session state per `(agent, taskKey, adapterType)`.
`taskKey` is derived from wakeup context (`taskKey`, `taskId`, or `issueId`).

- A heartbeat for the same task key reuses the previous session for that task.
- Different task keys for the same agent keep separate session state.
- If restore fails, adapters should retry once with a fresh session and continue.
- You can reset all sessions for an agent or reset one task session by task key.

Use session reset when:

- you significantly changed prompt strategy
- the agent is stuck in a bad loop
- you want a clean restart

## 5. Logs, status, and run history

For each heartbeat run you get:

- run status (`queued`, `running`, `succeeded`, `failed`, `timed_out`, `cancelled`)
- error text and stderr/stdout excerpts
- token usage/cost when available from the adapter
- full logs (stored outside core run rows, optimized for large output)

In local/dev setups, full logs are stored on disk under the configured run-log path.

## 6. Live updates in the UI

Paperclip pushes runtime/activity updates to the browser in real time.

You should see live changes for:

- agent status
- heartbeat run status
- task/activity updates caused by agent work
- dashboard/cost/activity panels as relevant

If the connection drops, the UI reconnects automatically.

## 7. Common operating patterns

## 7.1 Simple autonomous loop

1. Enable timer wakeups (for example every 300s)
2. Keep assignment wakeups on
3. Use a focused prompt template
4. Watch run logs and adjust prompt/config over time

## 7.2 Event-driven loop (less constant polling)

1. Disable timer or set a long interval
2. Keep wake-on-assignment enabled
3. Use on-demand wakeups for manual nudges

## 7.3 Safety-first loop

1. Short timeout
2. Conservative prompt
3. Monitor errors + cancel quickly when needed
4. Reset sessions when drift appears

## 7.4 Manual Browser Session Handoff

Use a `browser_session_handoff` approval when an agent needs a human to complete an interactive login in a real browser profile.

Contract:

- The agent creates an approval with:
  - `type: "browser_session_handoff"`
  - payload:
    - `service: string`
    - `loginUrl: string`
    - `browserProfileName?: string | null`
    - `browserProfilePath?: string | null`
    - `completionNote?: string | null`
    - `agentInstruction?: string | null`
- The approval should be linked to the current issue when the handoff is task-specific.
- Board approval means the operator has completed the login in the named local browser/profile and the agent may resume using that already-authenticated local session.
- After approval, Paperclip wakes the requesting agent with `approval_approved`; the agent must fetch the approval payload and continue from the local browser state rather than retrying credential-based web login.

This flow is the supported fallback for sites that reject automated sign-in, including consumer Google login flows.

## 7.5 Secret Provisioning Handoff

Use a `secret_provisioning_required` approval when an agent is blocked on missing company secrets or missing adapter env bindings.

Contract:

- The agent creates an approval with:
  - `type: "secret_provisioning_required"`
  - payload:
    - `service?: string | null`
    - `secretNames: string[]`
    - `completionNote?: string | null`
    - `agentInstruction?: string | null`
- The approval should be linked to the current issue when the missing secret blocks a specific task.
- Board approval means the operator has created the named company secret(s) and bound them into the relevant agent adapter environment.
- After approval, Paperclip wakes the requesting agent with `approval_approved`; the agent must reload its runtime configuration and continue without asking for the same secret again.

Issue comments are not a secret transport. Inline `KEY=value` comments must not be treated as runtime env.

## 7.6 Blocked Issue Contract

Blocked issues should carry structured `blockerDetails`, not just `status: "blocked"`.

Recommended fields:

- `blockerType`
- `summary`
- `detail`
- `requiredAction`
- `approvalType` when Paperclip can unblock through an approval
- integration-specific hints such as `service`, `secretNames`, `loginUrl`, or browser profile fields

This lets the UI surface the correct unblock action instead of leaving operators to infer the next step from logs alone.

## 8. Troubleshooting

If runs fail repeatedly:

1. Check adapter command availability (`claude`/`codex` installed and logged in).
2. Verify `cwd` exists and is accessible.
3. Inspect run error + stderr excerpt, then full log.
4. Confirm timeout is not too low.
5. Reset session and retry.
6. Pause agent if it is causing repeated bad updates.

Typical failure causes:

- CLI not installed/authenticated
- bad working directory
- malformed adapter args/env
- prompt too broad or missing constraints
- process timeout

## 9. Security and risk notes

Local CLI adapters run unsandboxed on the host machine.

That means:

- prompt instructions matter
- configured credentials/env vars are sensitive
- working directory permissions matter

Start with least privilege where possible, and avoid exposing secrets in broad reusable prompts unless intentionally required.

## 10. Minimal setup checklist

1. Choose adapter (`claude_local` or `codex_local`).
2. Set `cwd` to the target workspace.
3. Add bootstrap + normal prompt templates.
4. Configure heartbeat policy (timer and/or assignment wakeups).
5. Trigger a manual wakeup.
6. Confirm run succeeds and session/token usage is recorded.
7. Watch live updates and iterate prompt/config.
