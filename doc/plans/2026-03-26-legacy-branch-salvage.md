# Legacy Branch Salvage Plan

Date: 2026-03-26

Branches analyzed:
- `codex/pre-upstream-merge-2026-03-22`
- `codex/backup-before-github-sync-fix-20260322`

Baseline:
- `instance/main` at `b34fa3b2`
- current feature branch `codex/extract-issue-goal-contracts` already carries the issue-goal / checkout contract work and should be treated as the source of truth for that topic, not the March 22 branches

## Goal

Recover the useful UI and podcast pipeline work from the March 22 legacy branches without replaying their mixed history onto the rebased fork.

This plan follows the Git workflow policy:
- do not merge or rebase the legacy branches wholesale
- extract only coherent feature slices onto fresh branches from `instance/main`
- keep generated artifacts, runtime payloads, and unrelated refactors out of the salvage path

## Confirmed Missing From `instance/main`

These features existed in the March 22 branches and are not present in the current build:

1. Podcast workflow control plane
   - workflow DB/schema/types
   - workflow routes/services
   - workflow list/detail UI
   - Mailchimp integration

2. Episode/content review UI
   - Content index page
   - Content episode detail page
   - sidebar content surfacing

3. Romance Unzipped batch pipeline
   - YouTube latest-upload detection
   - transcript, clips, quotes, social, approval packet, runbook generation
   - sync-to-Paperclip bridge
   - per-episode runtime migration

4. Sidebar bulk-heartbeat UX
   - `All Hands Heartbeat`
   - `BOO!`
   - explicit `HeartbeatButton`
   - bulk selection and toast helpers

5. Static Romance Unzipped site
   - static homepage and homepage data

6. Company-level manual pause/resume UI
   - current build still has agent pause/resume and budget pause infrastructure
   - the old company-level manual controls are gone

## Do Not Recover As-Is

Drop these outright during intake:

- `.runtime/**`
- `*.pyc`
- large media files and binary inputs
- merge commits from the legacy branches
- broad “readability” or “cleanup” commits with no stable product boundary
- mixed refactors that touch issue contracts, adapters, docs, and podcast features at the same time

## Salvage Matrix

### UI and Podcast Commits

| Commit | Subject | Class | Recommendation |
| --- | --- | --- | --- |
| `8c464160` | add `HeartbeatButton` component | `port` | Recover as part of a new sidebar-heartbeat branch. The component is absent from current `SidebarAgents`. |
| `b2b6aad2` | copy functionality for run details in `LogViewer` | `port` | Recover as a small UI polish branch after the heartbeat work. Current `LogViewer` does not expose run-detail copy actions. |
| `c3d7aa20` | static homepage for Romance Unzipped | `rewrite` | Recover only if the static site is still a product goal. Rebuild cleanly under a dedicated site branch; do not carry old Vercel-coupled assumptions blindly. |
| `a3d83100` | Mailchimp and podcast workflows APIs/pages | `rewrite` | This is the main podcast control-plane commit. Rebuild from current db/shared/server/ui contracts instead of cherry-picking. |
| `d92c79a9` | secret management and podcast workflow follow-up | `rewrite` | Fold into the podcast control-plane rewrite after secret handling is re-evaluated against current server secrets architecture. |
| `ab53a236` | bulk heartbeat actions in sidebar | `port` | Recover as a focused UX slice. This is still absent and fits the current sidebar architecture cleanly. |
| `ebc77a9d` | company/agent pause-resume UI | `rewrite` | Current build still has pause state fields and agent pause routes, but not the old company-level manual controls. Reintroduce only with a current product decision. |
| `0d89324c` | YouTube pipeline scripts and homepage updates | `rewrite` | Recover the pipeline concept and script responsibilities, not the commit itself. The commit is contaminated by runtime data and duplicated solution copies. |
| `d50d2d6e` | per-episode runtime migration and content UI | `rewrite` | Recover the content UI and per-episode runtime structure, but rebuild against the current app/router/contracts. |
| `bbd3cb62` | podcast workflow management and content handling | `rewrite` | Good source material for workflow catalog/status logic. Extract behavior, not patchset. |
| `c93e3db0` | episode manifest init and pipeline common refactor | `port later` | Recover only after the pipeline rewrite establishes the new runtime layout. |
| `a068e4db` | binary podcast input update | `drop` | Generated / media payload only. |
| `2b1c15b7` | binary podcast input update | `drop` | Generated / media payload only. |

### Adapter / Platform / Infra Commits

| Commit | Subject | Class | Recommendation |
| --- | --- | --- | --- |
| `741bd980` | ensure `PAPERCLIP_RUN_ID` is set | `already landed` | Current adapters already seed `PAPERCLIP_RUN_ID` in execution envs. Do not salvage from the legacy branch. |
| `d70a2910` | Tailscale service and authToken support | `rewrite if needed` | Current dev flow already has Tailscale-aware auth flags. Only recover if you still need a Docker/Tailscale topology, and then redesign it explicitly. |
| `6e4d1b85` | Codex/Cursor model management | `already landed` | Current build already contains `server/src/adapters/codex-models.ts` and `server/src/adapters/cursor-models.ts`. |
| `d980184e` | normalize config for persistence | `rewrite if needed` | The exact implementation is absent, but current adapter config flows changed materially. Recover only if config persistence remains a live pain point. |
| `8b3010c9` | adapter operation service / skill utilities | `drop` | Too broad and architecture-heavy for blind recovery. Reassess only from a fresh spec. |
| `fa40ff8d` | refactor skill management to adapter-utils | `drop` | Same reason as above. |
| `8da08fc4` | Hermes local adapter support | `partially landed` | Hermes support exists on the server now, but old UI exposure/config should be treated separately. Do not salvage the old mixed commit wholesale. |
| `c7f67ad6` | Hermes and Pi adapter support in agent config | `partially landed` | Pi is present in current UI flows; Hermes is not fully exposed. Recover only the Hermes UI slice if you want that back. |
| `909ded91` | Hermes/Pi labels in UI | `rewrite narrow` | Recover only if Hermes should be surfaced in the current UI. Pi labeling already exists in current flows. |
| `557ea297` | issue workflow note in execute functions | `port candidate` | Keep as a low-priority standalone candidate. Useful idea, but separate from podcast salvage. |
| `cebbff83` | normalize API URL handling | `rewrite if needed` | Not part of the podcast/UI recovery path unless a current bug proves this is still needed. |

### Issue Contract / Worktree Overlap Commits

These should not be salvaged from the March 22 branches because they are already superseded by newer work:

| Commit | Subject | Class | Recommendation |
| --- | --- | --- | --- |
| `00e28777` | routines page | `already landed` | Current build already has routines end-to-end. |
| `abd482c9` | issue contract tests | `carried elsewhere` | Superseded by the newer issue-contract branch work. |
| `3480705c` | issue checkout enforcement | `carried elsewhere` | Superseded by the newer issue-contract branch work. |
| `c69c2322` | process adapter execute tests | `drop` | Not part of the current salvage target. |
| `99fa0d5b` | expected checkout statuses | `carried elsewhere` | Superseded by the newer issue-contract branch work. |
| `c186d314` | readability refactor | `drop` | No stable product unit to recover. |
| `5dca1bfb` | delegated child issues | `drop for now` | Product direction changed; not part of current V1 invariants. |
| `7ce67649` | merge upstream master | `drop` | Never salvage merge commits. |

## Recommended Recovery Order

1. `feature/legacy-sidebar-heartbeats`
   - Recover `8c464160`, `ab53a236`, and optionally `b2b6aad2`
   - Scope: pure UI/operator workflow
   - Why first: small, isolated, low contract risk

2. `feature/legacy-podcast-control-plane`
   - Rebuild the intent of `a3d83100` and `d92c79a9`
   - Scope: db/shared/server/ui for workflows + Mailchimp
   - Why second: establishes the canonical model the other podcast surfaces need

3. `feature/legacy-content-ui`
   - Rebuild the intent of `d50d2d6e` and `bbd3cb62`
   - Scope: `Content`, `ContentEpisodeDetail`, sidebar surfacing, status helpers
   - Depends on: podcast control-plane contracts

4. `feature/legacy-episode-pipeline`
   - Rebuild the intent of `0d89324c`, `d50d2d6e`, `bbd3cb62`, `c93e3db0`
   - Scope: pipeline scripts, runtime layout, sync bridge
   - Rule: keep scripts and runtime state out of normal Paperclip app boundaries unless they have a clear contract

5. `feature/legacy-company-pause-controls`
   - Rebuild only if still desired
   - Requires fresh product decision because the current system already uses budget pause semantics

6. `feature/legacy-romance-site`
   - Rebuild only if still desired
   - Keep separate from the core Paperclip app and from the pipeline branch

## Extraction Rules Per Branch

For every recovery branch:

1. Start from `instance/main`
2. Create a new worktree
3. Use one salvage slice per branch
4. Never cherry-pick commits containing:
   - `.runtime/`
   - `__pycache__/`
   - large media
   - merge commits
5. Prefer:
   - direct cherry-pick for tiny clean UI commits
   - manual file extraction / rewrite for mixed podcast commits
6. Verify before integration:
   - `pnpm -r typecheck`
   - `pnpm test:run`
   - `pnpm build`

## Immediate Next Step

Start with `feature/legacy-sidebar-heartbeats`.

Why:
- the feature is still absent
- the behavior is easy to demonstrate
- the write surface is mostly `ui/`
- it avoids reopening db/shared/server contracts while the podcast workflow rewrite is still undefined

After that, move to the podcast control-plane rewrite as a clean design effort, not as a replay of the March 22 branch history.
