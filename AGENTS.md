# AGENTS.md

Guidance for human and AI contributors working in this repository.

## 1. Purpose

Paperclip is a control plane for AI-agent companies.
The current implementation target is V1 and is defined in `doc/SPEC-implementation.md`.

## 2. Read This First

Before making changes, read in this order:

1. `doc/GOAL.md`
2. `doc/PRODUCT.md`
3. `doc/SPEC-implementation.md`
4. `doc/DEVELOPING.md`
5. `doc/GIT-WORKFLOW.md`
6. `doc/DATABASE.md`

`doc/SPEC.md` is long-horizon product context.
`doc/SPEC-implementation.md` is the concrete V1 build contract.
`doc/GIT-WORKFLOW.md` is the branch, worktree, and upstream-sync contract for this fork.

## 3. Repo Map

- `server/`: Express REST API and orchestration services
- `ui/`: React + Vite board UI
- `cli/`: operator CLI and local workflows
- `packages/db/`: Drizzle schema, migrations, DB clients
- `packages/shared/`: shared types, constants, validators, API path constants
- `packages/adapters/`: agent adapter implementations (Claude, Codex, Cursor, etc.)
- `packages/adapter-utils/`: shared adapter utilities
- `packages/plugins/`: plugin system packages
- `skills/`: reusable agent skill packs and prompt/instruction assets
- `scripts/`: operational scripts and worktree helpers
- `doc/`: operational and product docs

## 4. Dev Setup (Auto DB)

Use embedded PostgreSQL in dev by leaving `DATABASE_URL` unset.

```sh
pnpm install
pnpm dev
```

This starts:

- API: `http://localhost:3100`
- UI: `http://localhost:3100` (served by API server in dev middleware mode)

Quick checks:

```sh
curl http://localhost:3100/api/health
curl http://localhost:3100/api/companies
```

Reset local dev DB:

```sh
rm -rf ~/.paperclip/instances/default/db
pnpm dev
```

## 5. Core Engineering Rules

1. Keep changes company-scoped.
Every domain entity should be scoped to a company and company boundaries must be enforced in routes/services.

2. Keep contracts synchronized.
If you change schema/API behavior, update all impacted layers:
- `packages/db` schema and exports
- `packages/shared` types/constants/validators
- `server` routes/services
- `ui` API clients and pages

3. Preserve control-plane invariants.
- Single-assignee task model
- Atomic issue checkout semantics
- Approval gates for governed actions
- Budget hard-stop auto-pause behavior
- Activity logging for mutating actions

4. Do not replace strategic docs wholesale unless asked.
Prefer additive updates. Keep `doc/SPEC.md` and `doc/SPEC-implementation.md` aligned.

5. Keep plan docs dated and centralized.
New plan documents belong in `doc/plans/` and should use `YYYY-MM-DD-slug.md` filenames.

6. Prefer extension seams before core divergence.
Use the smallest stable surface that can solve the problem:
- `skills/` and company skills for prompts, instructions, and domain knowledge
- `packages/plugins/` for additive UI, tools, jobs, connectors, dashboards, and workflow surfaces
- core `packages/db` / `packages/shared` / `server` / `ui` changes only when current extension seams are insufficient
Current plugin boundary note:
- today’s plugin runtime is trusted same-origin code and is best suited to self-hosted persistent deployments
- do not assume plugins are a sandbox boundary or that dynamic plugin install is ready for multi-node/public-cloud distribution

7. Treat adapters as coordinated platform changes.
New adapters are not fully out-of-tree today. If you add or change an adapter, keep `packages/shared`, `server/src/adapters`, and `ui/src/adapters` aligned.

8. Avoid hardcoded machine-local assumptions.
Do not bake developer-specific repo paths, runtime directories, or secrets into React components or server code. Prefer instance config, plugin config, env, or secret references.

## 6. Git And Worktree Policy

1. `master` mirrors `upstream/master`.
Never commit instance-specific work directly to `master`.

2. `instance/main` is the only long-lived customization branch.
Start new work from a clean `instance/main`.

3. Use short-lived feature branches with the default `codex/` prefix.
Create them in isolated git worktrees, preferably under `.claude/worktrees/`.

4. Initialize every feature worktree as its own Paperclip instance.
Run:

```sh
pnpm paperclipai worktree init
```

5. Sync upstream only through the maintained helper:

```sh
./scripts/git-sync-upstream.sh
```

6. Commit after the smallest coherent verified change.
Do not mix upstream sync work, refactors, formatting churn, and behavior changes in one branch or commit series.

7. Rebase active work frequently.
Feature branches should stay close to `instance/main`, and `instance/main` should stay close to `master`.

## 7. Database Change Workflow

When changing data model:

1. Edit `packages/db/src/schema/*.ts`
2. Ensure new tables are exported from `packages/db/src/schema/index.ts`
3. Generate migration:

```sh
pnpm db:generate
```

4. Validate compile:

```sh
pnpm -r typecheck
```

Notes:
- `packages/db/drizzle.config.ts` reads compiled schema from `dist/schema/*.js`
- `pnpm db:generate` compiles `packages/db` first

## 8. Verification Before Hand-off

Run this full check before claiming done:

```sh
pnpm -r typecheck
pnpm test:run
pnpm test:e2e
pnpm build
```

If anything cannot be run, explicitly report what was not run and why.

## 9. API and Auth Expectations

- Base path: `/api`
- Board access is treated as full-control operator context
- Agent access uses bearer API keys (`agent_api_keys`), hashed at rest
- Agent keys must not access other companies

When adding endpoints:

- apply company access checks
- enforce actor permissions (board vs agent)
- write activity log entries for mutations
- return consistent HTTP errors (`400/401/403/404/409/422/500`)

## 10. UI Expectations

- Keep routes and nav aligned with available API surface
- Use company selection context for company-scoped pages
- Surface failures clearly; do not silently ignore API errors

## 11. Definition of Done

A change is done when all are true:

1. Behavior matches `doc/SPEC-implementation.md`
2. Typecheck, tests, browser smoke, and build pass
3. Contracts are synced across db/shared/server/ui
4. Docs updated when behavior or commands change
