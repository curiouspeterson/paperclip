# QA Agent And Routine-Driven Status Review

Date: 2026-03-29
Status: Proposed design
Audience: Product, maintainers, company operators

## Summary

Paperclip should treat QA as real issue-based work owned by an agent, and treat status watching as control-plane automation rather than another polling employee. The recommended operating model is:

- add a reusable QA agent pattern for acceptance and verification work
- use routines to create concrete status-review issues for that QA agent
- keep aggregate monitoring in dashboard and inbox alert surfaces

This design avoids a wasteful "status watcher" agent that repeatedly spends budget rereading state the control plane already computes.

## Problem

Operators want two distinct capabilities:

1. a QA function that can verify outputs, perform smoke checks, and produce acceptance evidence
2. a watcher that notices failures, drift, or stale work and prompts follow-up

Today, Paperclip already has most of the primitives needed for both, but they are not expressed as a documented reusable pattern:

- `qa` is already a valid agent role
- routines already create execution issues and wake assignees
- dashboard and inbox already aggregate many operational signals

Without a recommended pattern, users are likely to create a dedicated watcher agent that polls for status. That duplicates control-plane logic, increases budget consumption, and makes observability worse instead of better.

## Goals

- Provide a reusable long-term pattern for QA work in Paperclip companies
- Provide a reusable long-term pattern for status watching without a polling agent
- Reuse current control-plane primitives instead of inventing a parallel subsystem
- Keep the model issue-centric and auditable
- Make the pattern easy to apply to live companies such as ROM

## Non-Goals

- Do not add a continuously running watcher service inside an agent adapter
- Do not move monitoring responsibility from dashboard/inbox into agent prompts
- Do not build enterprise incident management, paging, or multi-step alert routing
- Do not require new database tables to support the initial pattern

## Current Repo Facts

- `qa` is already a first-class agent role in `packages/shared/src/constants.ts`
- routines create execution issues and assign them to agents through the normal issue and heartbeat path
- inbox already surfaces failed runs, budget alerts, and aggregate agent error conditions
- dashboard already summarizes task, cost, and agent health state

These existing surfaces are sufficient for a first durable solution.

## Recommended Architecture

### 1. QA Agent

The QA agent is a normal company agent with a concrete remit:

- verify issue outputs before completion or release
- run browser or artifact smoke checks
- review generated deliverables for completeness and format quality
- attach acceptance evidence in comments or linked artifacts
- move work to `blocked`, `in_review`, or `done` based on evidence

The QA agent should not own ambient monitoring. It should wake up because there is an issue to verify, not because it is constantly polling the board.

### 2. Status Review Routine

Status watching should be implemented as one or more routines assigned to the QA agent.

Each routine:

- runs on a schedule or webhook trigger
- checks for one narrow class of operational conditions
- creates or coalesces a concrete issue when action is needed
- assigns that issue to the QA agent

Examples:

- failed run triage review
- stale `in_progress` issue review
- release readiness review
- budget threshold review
- missing evidence review for `in_review` items

This matches the existing Paperclip routine model and preserves auditability through routine runs, linked issues, and normal heartbeat execution.

### 3. Dashboard And Inbox Stay Primary

Dashboard and inbox remain the aggregate operator view. They should continue to be the primary place for:

- alert visibility
- run failure summaries
- cost pressure summaries
- live issue and agent state

The routine pattern complements these surfaces by turning persistent or review-worthy conditions into owned work. It does not replace the UI surfaces.

## Design Details

### Reusable QA Pattern

Paperclip should ship a documented QA operating pattern that includes:

- a recommended role/title/capability profile for QA agents
- a recommended issue checklist for verification work
- a recommended company skill or prompt guidance for QA evidence quality

This should live in repo docs and skills so operators can apply it consistently across companies.

### Reusable Status Review Pattern

Paperclip should ship a documented watcher pattern built on routines:

- routine title and description templates
- recommended trigger shapes
- recommended concurrency policies
- examples of issue descriptions produced by status-review routines

This should explicitly discourage a general-purpose polling watcher agent.

### Scope Of Initial Product Work

The initial long-term implementation should be lightweight:

1. document the QA-plus-routine pattern
2. add a reusable QA skill/template in `skills/`
3. add product guidance that status watching should be done with routines, not a dedicated agent
4. optionally add copy or presets that make routine setup easier in the UI

No new backend entity model is required for the first version.

## Data Flow

### QA Verification Flow

1. Delivery work reaches `in_review` or another review handoff state.
2. A human or routine assigns the issue to the QA agent.
3. QA checks artifacts, comments, and runtime outputs.
4. QA records evidence in the issue thread.
5. QA resolves the issue or blocks it with specific follow-up.

### Status Review Flow

1. A routine trigger fires on schedule or webhook.
2. The routine service creates or coalesces a routine execution issue.
3. The issue is assigned to the QA agent.
4. The QA agent investigates the concrete condition.
5. The QA agent leaves evidence and resolves or escalates through normal issue mechanics.

## Alternatives Considered

### A Dedicated Polling Status Watcher Agent

Rejected.

Pros:

- simple mental model for operators

Cons:

- duplicates dashboard and inbox logic
- spends budget polling state
- makes alerting behavior prompt-dependent instead of policy-driven
- creates weaker auditability because the trigger logic lives in prompts

### UI-Only Alerts With No Follow-Up Issues

Rejected as the only solution.

Pros:

- cheapest implementation

Cons:

- does not create owned work
- easy for operators to miss or defer
- does not leverage the issue-based operating model

### New Specialized Watcher Backend

Deferred.

Pros:

- could support richer operational automation later

Cons:

- unnecessary for current repo capabilities
- increases product and maintenance scope

## Error Handling

- routine execution should continue to use existing coalescing and failure semantics
- watcher routines should create issues only when they detect actionable conditions
- QA agents should mark issues `blocked` with explicit evidence when verification cannot complete
- false-positive watcher issues should be closed with an explanatory comment so the signal remains auditable

## Testing And Verification

### Product Verification

- create a QA agent in a test company
- create a routine assigned to that QA agent
- verify that the routine produces a linked execution issue
- verify the issue wakes the QA agent through the normal heartbeat path
- verify dashboard and inbox still show the originating alert surfaces

### Contract Verification

- ensure agent creation supports the QA role cleanly in current UI/API flows
- ensure routine issue creation and coalescing continue to work for QA-assigned routines
- ensure no new company boundary violations are introduced

### Documentation Verification

- docs and skill guidance must align with current routine and agent surfaces
- guidance must explicitly recommend routines over a dedicated watcher agent for status monitoring

## Rollout Plan

### Phase 1

- publish the documented pattern
- add a QA guidance skill/template

### Phase 2

- add lightweight UX guidance or presets for status-review routines

### Phase 3

- apply the pattern to live companies such as ROM where it is useful

## Recommendation

Paperclip should standardize on:

- one QA agent for verification work
- zero dedicated polling watcher agents
- routine-generated review issues for operational status watching

This aligns with the current control-plane architecture, minimizes budget waste, and keeps all meaningful work inside the issue and routine model that Paperclip already implements.
