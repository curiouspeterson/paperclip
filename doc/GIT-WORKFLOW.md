# Git Workflow

This document defines the long-term Git policy for running a customized Paperclip fork while staying close to upstream `master`.

The goal is to make three things true at the same time:

1. local Paperclip improvements are easy to ship in small commits
2. upstream Paperclip can be pulled in regularly with predictable rebases
3. conflict-heavy work is isolated to a small number of branches instead of spreading across every feature

## 1. Canonical Remotes

Every maintainer checkout should have these remotes:

- `upstream`: the canonical Paperclip repository
- `origin`: your fork or internal mirror

Expected setup:

```sh
git remote add upstream git@github.com:paperclipai/paperclip.git
git remote set-url origin <your-fork-url>
git fetch upstream --prune
git fetch origin --prune
```

## 2. Canonical Branch Roles

Use exactly three branch classes.

### `master`

`master` is the local upstream mirror.

Rules:

- it must stay aligned with `upstream/master`
- it must never carry instance-specific commits
- it is updated only by fast-forwarding from `upstream/master`

### `instance/main`

`instance/main` is the long-lived integration branch for your Paperclip instance.

Rules:

- all fork-specific commits land here first
- this branch is rebased onto `master` on a regular cadence
- this is the branch feature work starts from
- this is the branch you push to `origin`

### `codex/<ticket>-<slug>`

Feature branches are short-lived branches created from `instance/main`.

Rules:

- use the `codex/` prefix by default for agent-created branches
- one feature, fix, or refactor per branch
- one worktree per active feature branch
- merge or rebase back into `instance/main` quickly
- delete the branch after integration

## 3. Non-Negotiable Rules

1. Never commit directly to `master`.
2. Never develop new work on a dirty `instance/main`.
3. Never keep long-running feature branches unrebased for days at a time.
4. Never mix upstream sync work with feature work in the same branch.
5. Never bundle formatting sweeps, dependency churn, and behavior changes into one commit series.
6. Keep commits small enough that an upstream conflict can usually be resolved commit-by-commit.

## 4. Commit Policy

Every commit should have one clear purpose.

Preferred commit shapes:

- schema or contract change
- server behavior change
- UI/client alignment for the same change
- tests for the same change
- docs for the same change

Avoid these commit shapes:

- broad "cleanup" commits touching unrelated areas
- mixed refactor + behavior + formatting commits
- generated-file updates mixed with hand edits
- long-lived WIP commits pushed onto shared integration branches

Recommended pattern for a normal task:

1. make the smallest coherent code or doc change
2. add or update tests
3. update docs if behavior changed
4. verify locally
5. commit with a scoped message

Example messages:

```text
feat(heartbeat): persist normalized hermes completion summaries
fix(costs): keep agent budget route board-only
docs(git): define upstream sync and feature worktree policy
```

## 5. Branch Hygiene Rules That Reduce Rebase Conflicts

These rules matter more than any individual Git command.

1. Keep local customization seams obvious.
   Put instance-specific behavior behind focused files, wrappers, config, plugins, or docs instead of scattering small edits across core upstream files.

2. Land structural refactors separately from product changes.
   A branch that changes file layout and behavior at the same time is much harder to rebase.

3. Rebase feature branches onto `instance/main` before they diverge too far.
   Daily is better than weekly for active work.

4. Sync `instance/main` with upstream on a schedule.
   Small, regular rebases are materially easier than rare large rebases.

5. Prefer additive extension points over invasive rewrites.
   Skills, plugins, wrapper modules, adapter seams, config toggles, and documented local overrides are cheaper to carry long term.

6. Keep generated outputs out of the normal conflict path.
   Follow repo policy for `pnpm-lock.yaml` and do not create unnecessary generated diffs.

## 6. Day-To-Day Procedure

### Start of day

1. Sync from upstream.
2. Rebase `instance/main`.
3. Rebase any active feature branch on top of the updated `instance/main`.

Use:

```sh
./scripts/git-sync-upstream.sh
```

### Start a new feature

From the repository root:

```sh
git switch instance/main
git pull --ff-only origin instance/main
git worktree add .claude/worktrees/codex-<slug> -b codex/<ticket>-<slug> instance/main
cd .claude/worktrees/codex-<slug>
pnpm install
pnpm paperclipai worktree init
```

This keeps feature work isolated both at the Git layer and at the Paperclip instance/data-dir layer.

### While the feature is in progress

Rebase often:

```sh
git fetch origin --prune
git fetch upstream --prune
git rebase instance/main
```

If `instance/main` changed upstream-relative, re-run:

```sh
cd /path/to/main/repo
./scripts/git-sync-upstream.sh
cd /path/to/feature/worktree
git rebase instance/main
```

### Land the feature

From the feature branch:

```sh
pnpm -r typecheck
pnpm test:run
pnpm test:e2e
pnpm build
git push origin codex/<ticket>-<slug>
```

Then integrate into `instance/main` using a linear history:

```sh
git switch instance/main
git pull --ff-only origin instance/main
git merge --ff-only codex/<ticket>-<slug>
git push origin instance/main
```

If fast-forward merge is not possible, rebase the feature branch onto `instance/main` first and retry.

## 7. Upstream Sync Procedure

The only supported way to refresh the long-lived integration branch is:

1. fast-forward `master` to `upstream/master`
2. rebase `instance/main` onto the refreshed `master`
3. push `instance/main` with `--force-with-lease` only when the rebase rewrites history

Command:

```sh
./scripts/git-sync-upstream.sh
git push origin instance/main --force-with-lease
```

Why this policy exists:

- `master` stays a clean upstream mirror
- rebase conflicts are resolved once on `instance/main`
- feature branches inherit the resolved integration state instead of each replaying the entire upstream jump

## 8. Repo Git Config

Enable these settings in each maintainer clone:

```sh
git config fetch.prune true
git config pull.ff only
git config rebase.autoStash true
git config rerere.enabled true
git config branch.autoSetupRebase always
```

Why:

- `fetch.prune`: keeps stale branch references out of the way
- `pull.ff only`: prevents accidental merge commits on `master` or `instance/main`
- `rebase.autoStash`: reduces friction when rebasing small local edits
- `rerere.enabled`: reuses conflict resolutions across repeated rebases
- `branch.autoSetupRebase always`: makes tracking branches behave consistently

## 9. Recovery Rules

If a sync goes wrong:

1. stop before adding unrelated commits
2. inspect with `git status` and `git log --oneline --decorate --graph --max-count=20`
3. if the problem is local to the current rebase, use `git rebase --abort`
4. if `instance/main` was rewritten locally but not pushed, restart from `origin/instance/main`
5. if `instance/main` was pushed, use `git push --force-with-lease` only after confirming no one else advanced it

Do not "fix" branch drift by making merge commits from `upstream/master` into feature branches.

## 10. Maintainer Checklist

Before opening or landing a feature:

- `master` is a clean upstream mirror
- `instance/main` rebases cleanly onto `master`
- feature branch is rebased onto current `instance/main`
- worktree is isolated with `pnpm paperclipai worktree init`
- verification passed
- commits are small and scoped
- docs were updated if workflow or behavior changed

This workflow is intentionally strict. The strictness is what keeps a customized Paperclip fork maintainable over repeated upstream rebases.
