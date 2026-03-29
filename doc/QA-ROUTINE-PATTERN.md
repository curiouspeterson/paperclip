# QA Agent And Routine Status Review Pattern

Paperclip already has the right primitives for operational review work:

- agents for owned work
- routines for recurring triggers
- issues for auditable execution
- dashboard and inbox for aggregate visibility

The recommended long-term pattern is:

- add a QA agent for real verification work
- use routines to create status-review issues for that QA agent
- do not create a dedicated polling watcher agent

## When To Add A QA Agent

Add a QA agent when review work is recurring and concrete:

- browser smoke checks
- artifact completeness checks
- acceptance review before `done`
- release readiness review
- “verify and send back with evidence” workflows

QA should own issue-based verification, not ambient monitoring.

## Why Not A Polling Watcher Agent

A permanent watcher agent is the wrong abstraction for Paperclip:

- it spends budget rereading control-plane state
- it duplicates dashboard and inbox logic
- it makes alerting behavior prompt-dependent instead of policy-driven
- it produces weaker operational boundaries than routines plus issues

Paperclip already computes aggregate status in the dashboard and inbox. Watching for conditions should happen through routines that materialize actionable work.

## Recommended Pattern

### QA Agent

Create a QA agent with:

- role: `qa`
- clear verification capabilities
- issue-based review responsibilities
- evidence-oriented comment style

### Status Review Routine

Create a routine assigned to QA that runs on a schedule or webhook and checks for one class of condition:

- failed run triage
- stale in-progress work
- missing review evidence
- budget or delivery risk review

The routine should create or coalesce a concrete issue. QA then handles that issue through the normal heartbeat flow.

## Example Routine Types

- Daily failed run review
- Weekday stale issue review
- Pre-release readiness review
- Post-deploy smoke review

## Operator Guidance

- Keep routines narrow. One routine should correspond to one operational question.
- Keep QA evidence concrete. Use files, links, screenshots, and exact outputs.
- Let dashboard and inbox remain the aggregate monitoring surfaces.
- Use routines when you want persistent conditions to become owned work.

## ROM Example

For a company like Romance Unzipped:

- QA agent verifies newsletters, homepage updates, rendered assets, and channel dry runs
- a status-review routine can periodically create QA issues for failed batches, stale delivery work, or missing review artifacts

That gives you the watcher behavior you want without paying for a second agent that only polls.
