# Hermes Runtime Statefulness Design

## Goal

Improve Paperclip's Hermes integration so the Paperclip-managed Hermes worker can reuse task-scoped Hermes state across heartbeats instead of starting from a fresh stateless `hermes chat` run each time.

## Scope

This design intentionally covers only the first Hermes integration slice:

- make the process-based Hermes worker task-stateful
- pass Paperclip runtime/session/workspace context into process workers
- store and reuse Hermes session metadata through Paperclip's existing task-session contract
- clean up the misleading "Create Hermes Agent" flow so it no longer suggests a generic process worker is the primary Hermes integration path

This does not yet add:

- Hermes `listSkills` / `syncSkills`
- Hermes MCP configuration UI
- Honcho integration
- native `hermes_local` execution changes inside the external adapter package

## Current Problem

Paperclip currently launches the Hermes worker as a generic process command. The worker invokes:

- `hermes chat -Q --yolo -q <prompt>`

on every run.

That means:

- Hermes does not receive Paperclip runtime session state through the process adapter
- the worker does not emit session metadata back to Paperclip
- Paperclip cannot persist Hermes task sessions even though it already has adapter task-session storage
- the Hermes worker cannot use native Hermes session continuity features like `--continue`

## Design

### 1. Reuse the existing Paperclip task-session contract

Paperclip already stores task-scoped adapter session state per:

- company
- agent
- adapter type
- task key

The Hermes process worker should participate in that contract instead of inventing a parallel persistence system.

### 2. Extend the process adapter env contract

The generic process adapter should pass the same runtime context that other local adapters already receive:

- wake/task identifiers
- approval context
- workspace metadata
- `AGENT_HOME`
- runtime session identifier and serialized runtime session params

This makes the process adapter viable for session-aware workers, not just stateless scripts.

### 3. Give the Hermes worker a stable Hermes home

When `AGENT_HOME` is available, the worker should derive a Hermes runtime home inside it.

Recommended path:

- `$AGENT_HOME/.hermes`

That gives each Paperclip agent:

- isolated Hermes sessions
- isolated Hermes memory files
- isolated Hermes-created skills

without polluting the operator's default global `~/.hermes`.

### 4. Resume by deterministic task-scoped session name

The worker should compute a stable Hermes session name from the selected issue:

- example shape: `paperclip::<agent-id-prefix>::<issue-identifier-or-id>`

Flow:

1. if Paperclip runtime session params already contain a Hermes session name, call `hermes chat --continue <name>`
2. otherwise run a fresh session
3. after the run, inspect the Hermes SQLite state for the newest CLI session in the agent-local Hermes home
4. rename that session to the deterministic Paperclip task session name
5. return both the Hermes session id and deterministic session name back to Paperclip

This avoids fragile model-output scraping and aligns with Hermes' native session model.

### 5. Emit session metadata through process stdout JSON

The Hermes worker should add these keys to its final stdout JSON:

- `_sessionId`
- `_sessionDisplayId`
- `_sessionParams`
- `_clearSession` when needed

The process adapter should parse those keys and return them as `AdapterExecutionResult` session fields so Paperclip's heartbeat service can persist them.

### 6. Clean up the UI creation flow

The Company Settings "Hermes Agent" shortcut currently routes through a process preset. That is still useful for the Paperclip-managed Hermes worker, but the UI should label it accurately as a Paperclip-managed Hermes worker flow rather than implying it is the native adapter.

For this slice, the change is:

- keep the process preset
- rename the UX copy to reflect that it creates a Paperclip-managed Hermes worker

This avoids claiming that the native `hermes_local` adapter is the current preferred path before its feature parity improves.

## Expected Outcome

After this slice:

- Hermes worker runs keep task-scoped continuity across heartbeats
- Paperclip can display and persist Hermes session state like other local adapters
- Hermes memory and sessions stop leaking into the operator's global default home
- the Hermes creation flow becomes less misleading

## Verification

Add targeted tests for:

- process adapter env passthrough of runtime/session/workspace fields
- process adapter extraction of session metadata from stdout JSON
- Hermes worker derivation of Hermes home and session name
- Hermes worker session metadata emission

Run:

- targeted Vitest for process adapter
- targeted Python unittest for Hermes worker
- `pnpm -r typecheck`
