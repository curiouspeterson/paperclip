---
name: paperclip-qa-review
description: >
  Verify deliverables, run acceptance checks, and leave evidence on Paperclip
  issues. Use when an agent or operator needs structured QA work, not ambient
  status polling.
---

# Paperclip QA Review Skill

Use this skill when you are acting as a QA or review agent inside Paperclip.

## Purpose

This skill is for issue-based verification work:

- smoke-test deliverables
- inspect generated artifacts for completeness
- verify acceptance criteria
- leave clear evidence in issue comments
- decide whether work is done, blocked, or needs revision

This skill is **not** for ambient monitoring. If you need to watch for stale work, failed runs, or other recurring operational conditions, use a Paperclip routine that creates an issue for QA review. Do not spend budget polling the dashboard.

## Workflow

1. Read the issue heartbeat context and comment thread first.
2. Confirm what “done” means for this issue.
3. Inspect the actual deliverables:
   - files
   - previews
   - screenshots
   - generated docs
   - links or attached evidence
4. Run the smallest credible verification that proves or disproves the claim.
5. Leave a concise markdown comment with evidence.
6. Move the issue forward:
   - `done` if acceptance is satisfied
   - `in_review` if board or human review is next
   - `blocked` if a specific blocker prevents completion

## Evidence Standard

Every QA update should include:

- a short status line
- what was checked
- what passed or failed
- exact evidence paths, URLs, or outputs when available

Good QA comments answer:

- what did I verify
- how did I verify it
- what remains risky

## Acceptance Checks

Use the smallest verification that proves the behavior:

- browser smoke check for UI work
- file existence and content checks for generated artifacts
- targeted tests for logic changes
- API response checks for control-plane behavior

Do not pad the review with unrelated checks.

## Blocking Rules

If verification cannot complete:

- set the issue to `blocked`
- say exactly what is missing
- name who needs to act if known
- avoid repeating the same blocked comment unless there is new context

## Scope Discipline

QA should verify and report. QA should not silently redesign the task.

If the work is wrong but salvageable:

- explain the gap
- point to the failing evidence
- send it back with a concrete next action

If the work is acceptable:

- say so explicitly
- reference the evidence that justified the decision

## Status Watching Pattern

If your company wants a “status watcher,” do not create a dedicated polling agent.

Preferred pattern:

1. create a Paperclip routine for the operational condition
2. let the routine create a concrete issue when action is needed
3. assign that issue to QA

That keeps monitoring policy in the control plane and keeps QA work auditable through normal issue history.
