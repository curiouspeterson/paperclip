# Legacy Podcast Control Plane Design

Date: 2026-03-26

Branch context:
- working branch: `codex/legacy-podcast-control-plane`
- verified integration base: `instance/main` at `0a0cd411`
- legacy source material: `codex/pre-upstream-merge-2026-03-22`

## Goal

Recover the useful podcast workflow and Mailchimp operator functionality from the March 22 legacy branches without reintroducing hardcoded repo paths, mixed core-fork churn, or a large rebase burden.

The new control plane should:

- work for the current Romance Unzipped use case
- be structurally reusable for other Paperclip instances
- avoid new core schema/API contracts unless the current plugin surface proves insufficient
- preserve Paperclip invariants by keeping governance, issue semantics, approvals, and budgets inside core

## Recommendation

Rebuild the podcast control plane as a plugin-first, configuration-driven feature.

That means:

1. the control plane UI should live behind plugin-owned routes and slots
2. workflow state should live in plugin state and plugin configuration, not a new core table in phase 1
3. the plugin should drive existing core entities such as projects, issues, comments, goals, workspaces, and agents through the current host APIs
4. repo-specific paths, channel URLs, script locations, and Mailchimp details must be instance-configured, never hardcoded in UI code

## Why This Is The Right Layer

### What the legacy branch did wrong

The old podcast workflow slice mixed at least four different concerns in one patchset:

- a new business entity (`podcast_workflows`)
- repo-local Romance Unzipped script assumptions
- generic connector behavior (Mailchimp)
- unrelated adapter, issue, and UI churn

The old UI also hardcoded local machine paths directly in the page layer:

- Paperclip repo root
- runtime root
- Python/Node script paths
- YouTube channel defaults

That approach is not rebase-friendly, not reusable, and not a valid long-term instance customization seam.

### What the current repo supports today

The current plugin runtime already provides the surfaces needed for a first-pass rebuild:

- company route pages
- settings pages
- dashboard widgets
- detail tabs
- sidebar items and panels
- worker actions
- jobs
- launchers
- tools
- plugin state
- projects and project workspaces
- issues and comments
- goals
- agents and agent sessions

Relevant current references:

- `doc/plugins/PLUGIN_AUTHORING_GUIDE.md`
- `doc/plugins/PLUGIN_SPEC.md`
- `packages/plugins/examples/plugin-kitchen-sink-example`
- `packages/plugins/examples/plugin-file-browser-example`

The plugin runtime is explicitly intended for additive capabilities such as connectors, dashboards, file/project tooling, and knowledge features, while core invariants remain owned by Paperclip.

### What should stay out of phase 1

Phase 1 should not add:

- new core tables
- new shared workflow entity contracts
- new core workflow routes
- hardcoded script paths in `ui/`
- generic workflow abstractions that are not required yet

Those are justified only if the plugin surface is proven insufficient after a focused implementation attempt.

## Options Considered

### Option A: Restore podcast workflows as a first-class core entity

Shape:

- reintroduce `podcast_workflows` in `packages/db`
- add shared types and validators
- add server routes and services
- add dedicated UI pages in `ui/`

Pros:

- strong typed contracts across db/shared/server/ui
- easy to query and inspect in core tables
- familiar shape compared with the legacy implementation

Cons:

- highest fork divergence
- guarantees long-lived rebase surface across `packages/db`, `packages/shared`, `server`, and `ui`
- hard to justify as a generic Paperclip V1 concept
- legacy commit evidence shows this quickly attracts unrelated changes

Decision:

- reject for phase 1

### Option B: Plugin-first control plane using plugin state and existing core entities

Shape:

- implement a first-party or instance-local plugin
- store workflow definitions and runtime state in plugin state
- use existing projects, issues, goals, comments, agent invocations, and project workspaces as the core system of record
- expose operator UI through plugin page/detail surfaces

Pros:

- smallest core divergence
- cleanly reusable for other instances
- configuration-driven instead of hardcoded
- aligns with the current implemented extension surface
- lets us validate whether the feature truly belongs in core

Cons:

- plugin state is less discoverable than a dedicated core table
- some UI polish may require working within current plugin slot limitations
- if we later need stronger first-class query/report semantics, we may still promote parts to core

Decision:

- recommended

### Option C: Hybrid generic workflow kernel in core plus podcast plugin on top

Shape:

- build a generic workflow entity/service layer in core
- layer podcast-specific UI and connector logic on top via plugin or fork code

Pros:

- potentially reusable for many verticals
- can offer stronger shared query/report semantics

Cons:

- too much design risk right now
- likely to overfit around the old podcast workflow shape
- violates the salvage rule of recovering only the smallest coherent slice first

Decision:

- defer

## Phase 1 Product Shape

Phase 1 should deliver a company-scoped operator control plane for podcast workflows without changing core contracts.

### Primary use cases

1. view configured podcast workflows for a company
2. create or edit a workflow definition from reusable templates
3. bind a workflow to a project workspace and optional project
4. trigger curated actions such as:
   - initialize manifest
   - run transcript/content pipeline stages
   - sync outputs back into Paperclip
   - publish/update external surfaces
5. inspect latest operation status, last sync, and stage readiness
6. store integration/configuration details for optional Mailchimp steps

### Phase 1 operator surfaces

Recommended plugin UI surfaces:

1. company page route
   - canonical route for podcast workflows
   - list view and detail view

2. settings page
   - instance-level defaults
   - connector configuration references
   - workflow template defaults

3. project detail tab
   - workspace-aware workflow context for a selected project
   - quick action entry point for pipeline stages tied to that workspace

4. dashboard widget
   - compact visibility into workflow status and recent runs

Optional later surfaces:

- sidebar panel
- issue detail view for synced episode issues
- comment annotations for generated asset links

## Phase 1 Architecture

### 1. Plugin package boundary

Implement the control plane as a plugin package, developed in-repo first for speed.

Recommended dev location:

- `packages/plugins/podcast-control-plane`

Long-term deployment options:

- keep it as an in-repo first-party plugin
- or publish it as a private npm package once stable

Why in-repo first:

- fastest integration with the current monorepo
- easiest access to local SDK/examples
- still keeps the feature out of core db/shared/server/ui boundaries

### 2. Data model

Use plugin state as the primary persistence layer in phase 1.

Recommended state scopes:

1. instance scope
   - global defaults
   - allowed workflow templates
   - optional connector defaults

2. company scope
   - workflow definitions
   - workflow list ordering
   - company-level channel/newsletter defaults

3. project scope
   - project/workspace bindings
   - project-local runtime defaults

4. issue scope
   - sync metadata between a workflow run and a Paperclip issue

Suggested logical records:

- `workflow:<workflowId>`
- `workflow-run:<runId>`
- `mailchimp-profile:<companyId>`
- `workflow-bindings:<projectId>`

The plugin should own the schema of these JSON records internally and version them explicitly.

### 3. Configuration model

All environment-specific details must be configured, not hardcoded.

Required instance config fields should include:

- repository root path
- runtime root path
- workflow template catalog
- allowed executable/script paths
- default output directories
- optional newsletter connector mode
- optional secret reference names

Workflow definition fields should include:

- workflow id
- company id
- title
- type
- status
- project id or project workspace binding
- optional issue id
- optional goal id
- stage definitions
- script/action definitions
- metadata

Important rule:

Do not store absolute developer-machine defaults inside React components.
All path defaults should come from plugin instance config or workflow metadata derived from it.

### 4. Execution model

The plugin should use curated actions and jobs, not arbitrary free-form shell composition in the UI.

Recommended execution paths:

1. manual operator action
   - button from plugin page or detail tab
   - worker records operation state in plugin state
   - worker may create/update a Paperclip issue when appropriate

2. scheduled/background action
   - plugin job for polling or periodic refresh
   - only for repeatable low-risk steps

3. agent tool surface
   - optional later
   - allow agents to query workflow summaries or trigger narrow safe actions

Execution should operate on project workspaces resolved through the host project/workspace APIs, not via ad hoc path guessing.

### 5. Core entity integration

The plugin should reuse existing core entities instead of inventing duplicates.

Use:

- projects for workspace ownership and grouping
- issues for execution/audit narrative
- comments and attachments for generated outputs and review artifacts
- goals when a workflow or episode maps to an explicit strategic objective
- agents for execution ownership where needed

Do not create a second workflow-specific approval or budgeting system.
If a step needs governance, it should flow through existing Paperclip mechanisms.

### 6. Mailchimp integration

Treat Mailchimp as an optional connector feature inside the same plugin boundary, not a separate core route set.

Phase 1 Mailchimp rules:

- connector details live in plugin configuration and secret references
- no new core `server/src/routes/mailchimp.ts`
- no direct coupling between generic Paperclip settings pages and podcast-only newsletter behavior

If the Mailchimp connector later proves broadly useful outside podcast operations, it can be split into a standalone connector plugin.

## Proposed Plugin Capabilities

Initial capability set should be minimal and explicit.

Likely required:

- `companies.read`
- `projects.read`
- `project.workspaces.read`
- `issues.read`
- `issues.create`
- `issues.update`
- `issue.comments.read`
- `issue.comments.create`
- `goals.read`
- `plugin.state.read`
- `plugin.state.write`
- `ui.page.register`
- `ui.settingsPage.register`
- `ui.detailTab.register`
- `ui.dashboardWidget.register`
- `activity.log.write`
- `http.outbound` only if the connector path truly needs it
- `secrets.read-ref` only if secret references are actually used

Do not request agent pause/resume, budget, approval, or unrelated mutation capabilities unless phase 1 proves they are needed.

## UI Design Principles

### What the new UI must avoid

- hardcoded repo paths
- workflow types tied to one podcast brand in component code
- direct references to one local runtime directory
- mixed control-plane and implementation-script details without clear separation

### What the new UI should emphasize

1. workflow catalog
   - reusable templates
   - current status
   - last run state

2. bindings
   - which project/workspace a workflow uses
   - which core issue or goal it is associated with

3. staged actions
   - explicit stage names
   - readiness/blocker indicators
   - action buttons for only the next valid operations

4. output traceability
   - latest run status
   - linked issue/comment/attachment context
   - generated artifact references

5. connector status
   - configured or not configured
   - latest delivery state
   - no secret values in UI

## Migration From Legacy Branches

The legacy branch should be treated as source material, not a patch source.

Recover:

- workflow types and operator vocabulary
- useful stage naming
- useful action naming
- useful detail-page interaction patterns
- Mailchimp/use-case requirements

Do not recover directly:

- old DB schema
- old shared contracts
- old route/service patchset
- hardcoded local paths
- bundled adapter/UI churn from the mixed commits

## Implementation Phases

### Phase 1: Plugin-only control plane

Deliver:

- plugin package scaffold
- company route page
- settings page
- dashboard widget
- project detail tab
- plugin state model
- workflow CRUD inside plugin state
- project/workspace binding
- curated manual actions

No core schema or route changes.

### Phase 2: Sync and artifact flow

Deliver:

- issue/comment/attachment sync
- better run history presentation
- structured run/result records in plugin state
- optional connector hooks

Still avoid core schema changes unless blocked.

### Phase 3: Evaluate promotion to core

Only after real usage:

- assess whether querying/reporting limits of plugin state are material
- assess whether a generic workflow kernel is justified
- assess whether Mailchimp belongs in a separate connector plugin

## Risks

1. plugin state may become too opaque for cross-company reporting
2. some podcast pipeline actions may need host capabilities not yet exposed cleanly
3. same-origin plugin UI means trusted code only; this is acceptable for the current self-hosted model but should be documented
4. the old branch may tempt cherry-picks that would reintroduce bad boundaries

## Mitigations

1. keep plugin state records versioned and structured
2. keep execution actions curated and narrow
3. use existing example plugins as the implementation reference, not the legacy podcast branch
4. isolate any missing host-surface changes into separate small commits on top of the plugin work

## Verification Expectations

For the design-to-implementation transition, phase 1 should be considered valid only if:

- the plugin installs through the current local-path plugin workflow
- typecheck passes
- plugin tests pass
- repo verification passes when host integration changes are required
- the control plane can create and persist workflow definitions without core schema changes
- the control plane can bind to a real project workspace
- at least one curated workflow action can create or update a real Paperclip issue as part of the flow

Required verification before claiming implementation complete:

- `pnpm --filter <plugin-package> typecheck`
- `pnpm --filter <plugin-package> test`
- `pnpm --filter <plugin-package> build`
- `pnpm -r typecheck`
- `pnpm test:run`
- `pnpm test:e2e`
- `pnpm build`

## Decision

Proceed with a plugin-first, configuration-driven podcast control-plane rewrite.

Do not restore the legacy `podcast_workflows` core table or the legacy `mailchimp` and `podcast-workflows` core routes in phase 1.

If the plugin seam proves insufficient, promote only the smallest missing capability to core in a separate, isolated change.
