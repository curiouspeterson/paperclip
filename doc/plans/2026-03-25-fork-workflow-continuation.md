# 2026-03-25 Fork Workflow Continuation Plan

Status: Adopted working plan
Date: 2026-03-25
Audience: Fork owner and any collaborators working in `curiouspeterson/paperclip`

## 1. Purpose

This document defines how work should continue in the Paperclip fork after repairing the fork branch layout.

The immediate goal is to preserve local work while making future upstream sync and rebasing manageable.

This plan is specifically for the current fork state where:

- `master` has been reset to match `paperclipai/paperclip:master`
- `current-work` preserves the pre-reset fork history and ongoing local development
- `archive-master-2026-03-25` and `preserved-master-2026-03-25` exist as safety branches

This document answers the practical who, what, where, when, and how of continuing from here.

## 2. Executive Summary

We should continue with a two-layer model:

1. `master` is a read-only upstream mirror
2. all actual development happens on non-`master` branches

The main operating branch is now:

- `current-work`

The continuation strategy is:

- keep `master` clean and synchronized with `paperclipai/paperclip:master`
- treat `current-work` as the preserved long-lived fork branch
- create short-lived branches from either `current-work` or `master` depending on the kind of work
- regularly rebase `current-work` onto `upstream/master`
- gradually split upstreamable work into smaller branches that can be rebased or proposed independently

The key rule is simple:

- never commit directly to `master`

## 3. Who

### 3.1 Primary Owner

The fork owner is responsible for:

- keeping `master` aligned with upstream
- deciding whether work belongs in the long-lived fork branch or in a smaller branch
- deciding which changes are fork-specific versus upstreamable
- making sure risky or broad changes are preserved before any aggressive rebases

### 3.2 Collaborators

Any collaborator working in the fork should:

- treat `master` as read-only
- branch from the correct base branch for the task
- avoid pushing directly to `current-work` unless the work is intentionally part of the long-lived fork stream
- prefer focused branches for isolated fixes or experiments

### 3.3 Branch Responsibility Model

Each branch now has a clear owner-like role:

- `master`: upstream mirror
- `current-work`: long-lived fork integration branch
- `archive-master-2026-03-25`: historical safety snapshot
- `preserved-master-2026-03-25`: historical safety snapshot
- short-lived feature/fix branches: task-specific work only

## 4. What

### 4.1 What We Are Continuing

We are continuing development in a way that separates:

- upstream tracking
- local fork integration
- experimental or task-specific work

This is a branch discipline change, not a product-direction change.

### 4.2 What Each Branch Means

#### `master`

`master` is now the fork’s clean mirror of `paperclipai/paperclip:master`.

It exists so that:

- upstream sync is simple
- rebases have a clear base
- new focused branches can start from a stable reference
- the fork always has one branch that reflects upstream truth

#### `current-work`

`current-work` is the branch that preserves the existing custom fork work.

It is the correct place for:

- continuing the current integrated fork effort
- holding work that has not yet been split into smaller units
- staging larger fork-specific changes while they are being organized

It is not the right place for every future commit forever. Over time it should become a staging branch rather than the only place work lives.

#### Short-lived work branches

Short-lived branches should be created for:

- isolated bug fixes
- cleanup work
- documentation updates
- candidate upstream changes
- experiments that may be abandoned

### 4.3 What We Should Avoid

We should avoid the old pattern of:

- using `master` as the active work branch
- mixing unrelated work into one long-running stream
- repeatedly merging upstream into a heavily customized `master`
- making broad changes without preserving a safe recovery point
- leaving generated assets or one-off artifacts mixed into core product work unless they are intentional product assets

## 5. Where

### 5.1 Where Work Should Live By Default

The default destinations are:

- upstream mirror work: `master`
- ongoing fork integration: `current-work`
- focused implementation work: a short-lived branch

### 5.2 Where New Branches Should Start

Use this branching rule:

- start from `master` when the work is intended to stay close to upstream or could plausibly become a clean PR-sized change
- start from `current-work` when the work depends on existing fork-only changes that are not present in upstream

Examples:

- a small issue route fix that only depends on upstream code should start from `master`
- a feature depending on the current fork-only runtime and docs changes should start from `current-work`

### 5.3 Where Documentation Like This Should Live

Planning and workflow documents should live under:

- `doc/plans/`

That keeps branch/process plans close to the repo’s existing documentation conventions.

### 5.4 Where Upstream-Facing Work Should Be Prepared

Work that may eventually be contributed upstream should be prepared on branches that:

- start from `master` whenever possible
- contain one coherent topic
- exclude fork-only unrelated edits
- avoid bundling generated files unless required

## 6. When

### 6.1 When To Work On `current-work`

Use `current-work` when:

- you need the full existing fork state
- you are stabilizing the current local direction
- you are not yet ready to separate a change into a smaller unit

### 6.2 When To Start A Fresh Branch From `master`

Start from `master` when:

- the task can stand on its own
- you want to minimize future rebase conflicts
- the change may be upstreamable
- you are fixing a narrow bug or writing a contained doc change

### 6.3 When To Sync Upstream

Sync upstream:

- before starting a new branch from `master`
- before any large rebase effort
- after meaningful upstream movement
- at least on a regular maintenance cadence even when you are heads-down on local work

Recommended cadence:

- light check before each new work session
- full sync/rebase at least weekly when actively developing
- immediate sync when you know upstream touched the same area you are editing

### 6.4 When To Preserve A Recovery Point

Create a recovery branch before:

- a major rebase of `current-work`
- large-scale conflict resolution
- broad refactors
- history rewriting on a shared branch

## 7. How

### 7.1 How The Branch Model Works

The operating model is:

1. `master` mirrors upstream
2. `current-work` preserves the integrated fork state
3. new work branches are created intentionally from the correct base
4. rebases happen onto `upstream/master`, not onto an old divergent `master`

### 7.2 How To Keep `master` Clean

Local maintenance flow:

```bash
git fetch upstream

git switch master
git reset --hard upstream/master
git push --force-with-lease origin master
```

Rules:

- do not commit on `master`
- do not use `master` for experiments
- do not merge local branches into `master` unless the explicit goal is to change the fork mirror, which should generally not happen

### 7.3 How To Continue Daily Work

If the work depends on the existing fork state:

```bash
git fetch origin upstream
git switch current-work
```

If the work should be isolated:

```bash
git fetch origin upstream
git switch current-work
# or: git switch master
# choose the correct base first

git switch -c <task-branch>
```

### 7.4 How To Rebase `current-work`

The long-lived branch should be rebased onto upstream, not the other way around:

```bash
git fetch upstream
git switch current-work
git rebase upstream/master
git push --force-with-lease origin current-work
```

Before a large rebase, preserve a backup branch:

```bash
git switch current-work
git branch backup-current-work-<date>
git push -u origin backup-current-work-<date>
```

### 7.5 How To Start Smaller, Cleaner Units Of Work

There are two valid patterns.

#### Pattern A: Fork-dependent work

Use this when the work relies on changes already present in `current-work`:

```bash
git fetch origin upstream
git switch current-work
git switch -c fix/<topic>
```

#### Pattern B: Upstream-close work

Use this when the work should stay minimal and easy to rebase:

```bash
git fetch origin upstream
git switch master
git reset --hard upstream/master
git switch -c fix/<topic>
```

This second pattern should be preferred whenever it is feasible.

### 7.6 How To Gradually Untangle `current-work`

`current-work` is useful as a safety-preserving integration branch, but it is too broad to be the ideal long-term working shape.

We should gradually extract it into smaller strands such as:

- issue lifecycle and contract enforcement work
- workspace/runtime support work
- company import/export work
- UI polish and routing work
- docs-only updates
- generated or operational assets that may not belong in core product branches

A practical extraction method is:

1. identify one coherent topic in `current-work`
2. create a fresh branch from `master`
3. cherry-pick or manually port only the commits relevant to that topic
4. rebase and clean that smaller branch independently
5. keep `current-work` as the catch-all only until enough work has been extracted

### 7.7 How To Decide Between Rebase, Cherry-Pick, And Manual Porting

Use:

- rebase when the branch is already focused and the history is reasonably clean
- cherry-pick when only a subset of `current-work` should move into a new cleaner branch
- manual porting when the original commits are too tangled or conflict-heavy to reuse safely

### 7.8 How To Handle Generated Files And One-Off Artifacts

Generated files, screenshots, output captures, and operational artifacts should be treated deliberately.

Before keeping them in a long-lived branch, ask:

- is this part of the product or test surface?
- is it reproducible from code or scripts?
- does it create needless rebase churn?
- does it belong in docs, fixtures, output, or nowhere at all?

If the answer is unclear, prefer isolating it in a focused branch rather than letting it accumulate in the main long-lived branch.

## 8. Working Rules

The continuation rules are:

1. never commit directly to `master`
2. keep `master` aligned with `paperclipai/paperclip:master`
3. use `current-work` only when upstream-only branching is not yet practical
4. prefer short-lived branches for new work
5. prefer branches from `master` for upstream-close work
6. preserve backup branches before big rebases
7. split broad work into smaller strands over time
8. avoid mixing docs, product changes, generated assets, and experiments unless the coupling is intentional

## 9. Immediate Next Steps

### 9.1 Already Completed

The following are already done:

- `master` was reset to upstream
- the pre-reset fork state was preserved
- `current-work` was created as the main continuation branch

### 9.2 Next Practical Steps

The next steps should be:

1. update the local clone so `master` matches the repaired remote state
2. switch day-to-day development to `current-work`
3. stop using `master` for active work
4. begin extracting one or two coherent topics from `current-work` into smaller branches
5. establish a regular upstream sync and rebase cadence

### 9.3 Local Realignment Commands

```bash
git fetch origin upstream

git switch master
git reset --hard origin/master

git switch current-work
```

## 10. Recommended Near-Term Operating Pattern

For the next stage, the recommended pattern is:

- use `current-work` as the safe place to continue the existing fork effort
- for any new isolated fix, start a fresh branch rather than stacking more unrelated changes directly onto `current-work`
- once per week, or whenever upstream significantly moves in overlapping areas, rebase `current-work` onto `upstream/master`
- whenever a change looks clean enough to stand alone, extract it from `current-work` into a smaller branch based on `master`

This creates a workable bridge between the current reality and a healthier long-term fork model.

## 11. Recommendation

We should continue with `master` as a clean upstream mirror and `current-work` as the preserved long-lived fork branch.

That gives us three benefits immediately:

- upstream sync becomes predictable again
- local work is preserved without pretending it is already cleanly organized
- future refactoring into smaller branches becomes possible without risking the current fork state

The long-term goal is not to live on one giant branch forever.

The long-term goal is to use `current-work` as a transitional integration branch while progressively moving toward smaller, cleaner, more rebase-friendly branches.
