# QA Agent And Routine Watcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reusable Paperclip support for a QA agent plus routine-driven status review, without introducing a dedicated polling watcher agent.

**Architecture:** Keep backend behavior unchanged and build on existing Paperclip primitives. Add a reusable QA guidance skill, add a routine-template helper plus light preset UI in the routines composer, and document the recommended operating pattern so operators can apply it consistently across companies.

**Tech Stack:** React + TypeScript, Vitest, Markdown docs, Paperclip skill packs

---

## File Map

- Create: `skills/paperclip-qa-review/SKILL.md`
- Create: `ui/src/lib/routine-templates.ts`
- Create: `ui/src/lib/routine-templates.test.ts`
- Modify: `ui/src/pages/Routines.tsx`
- Create: `doc/QA-ROUTINE-PATTERN.md`
- Modify: `doc/PRODUCT.md`

## Task 1: Add The QA Review Skill

**Files:**
- Create: `skills/paperclip-qa-review/SKILL.md`

- [ ] **Step 1: Inspect existing skill conventions**

Read:
- `skills/paperclip/SKILL.md`
- `skills/paperclip-create-agent/SKILL.md`

Expected: confirm formatting, tone, and workflow structure to mirror.

- [ ] **Step 2: Write the QA review skill**

Create `skills/paperclip-qa-review/SKILL.md` with:
- purpose and boundaries
- when to use it
- required workflow for issue-based QA work
- evidence expectations
- explicit rule that status watching should come from routines/issues, not ambient polling

The skill should cover:
- acceptance review
- artifact completeness checks
- browser smoke checks
- blocker comments and evidence quality

- [ ] **Step 3: Review the skill file for repo style**

Check:
- frontmatter is valid
- wording is operational, not generic
- no references to nonexistent endpoints or features

- [ ] **Step 4: Commit**

```bash
git add skills/paperclip-qa-review/SKILL.md
git commit -m "Add QA review skill"
```

## Task 2: Add Reusable Routine Templates

**Files:**
- Create: `ui/src/lib/routine-templates.ts`
- Create: `ui/src/lib/routine-templates.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `ui/src/lib/routine-templates.test.ts` covering:
- returns a stable QA status-review template
- template defaults align with existing routine schema values
- template copy explicitly avoids a dedicated watcher agent model

Run:

```bash
pnpm exec vitest run ui/src/lib/routine-templates.test.ts
```

Expected: FAIL because the helper does not exist yet.

- [ ] **Step 2: Implement the template helper**

Create `ui/src/lib/routine-templates.ts` exporting:
- one or more routine starter templates
- a QA status-review template with:
  - title
  - description
  - default concurrency policy
  - default catch-up policy
  - optional helper copy for operators

Keep this file focused on static reusable templates only.

- [ ] **Step 3: Run the focused tests**

Run:

```bash
pnpm exec vitest run ui/src/lib/routine-templates.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add ui/src/lib/routine-templates.ts ui/src/lib/routine-templates.test.ts
git commit -m "Add QA routine templates"
```

## Task 3: Wire Templates Into The Routines Composer

**Files:**
- Modify: `ui/src/pages/Routines.tsx`
- Test: `ui/src/lib/routine-templates.test.ts`

- [ ] **Step 1: Add minimal preset UI to the composer**

Modify `ui/src/pages/Routines.tsx` to expose routine starters near the composer:
- a lightweight preset selector or button group
- one option for “QA status review”
- selecting it should prefill title, description, and delivery defaults

Do not add backend fields or new schema. This must remain a UI-only helper.

- [ ] **Step 2: Keep manual routine creation intact**

Verify the composer still supports fully manual entry:
- no required preset selection
- no regression to current field validation
- no hidden magic after the preset is applied

- [ ] **Step 3: Add or extend a focused UI test if needed**

If the preset application logic becomes nontrivial, add a targeted test beside the helper or existing UI tests rather than introducing a large page integration suite.

Run at minimum:

```bash
pnpm exec vitest run ui/src/lib/routine-templates.test.ts
```

And add a second focused test command if a new UI test file is created.

- [ ] **Step 4: Commit**

```bash
git add ui/src/pages/Routines.tsx ui/src/lib/routine-templates.ts ui/src/lib/routine-templates.test.ts
git commit -m "Add QA routine preset to routines composer"
```

## Task 4: Document The Operating Pattern

**Files:**
- Create: `doc/QA-ROUTINE-PATTERN.md`
- Modify: `doc/PRODUCT.md`

- [ ] **Step 1: Write the operator-facing pattern doc**

Create `doc/QA-ROUTINE-PATTERN.md` covering:
- when to add a QA agent
- why not to add a dedicated polling watcher agent
- how to use routines for status review
- example routine types
- how dashboard/inbox fit into the workflow

- [ ] **Step 2: Add a concise pointer in product docs**

Modify `doc/PRODUCT.md` to point operators toward the QA/routine pattern doc in the section that discusses workflow quality or control-plane operation.

Keep this additive. Do not rewrite the product doc.

- [ ] **Step 3: Review docs for alignment**

Check that the docs match:
- existing routine behavior
- current UI route names
- current agent role names

- [ ] **Step 4: Commit**

```bash
git add doc/QA-ROUTINE-PATTERN.md doc/PRODUCT.md
git commit -m "Document QA and routine watcher pattern"
```

## Task 5: Final Verification

**Files:**
- Review changes in:
  - `skills/paperclip-qa-review/SKILL.md`
  - `ui/src/lib/routine-templates.ts`
  - `ui/src/lib/routine-templates.test.ts`
  - `ui/src/pages/Routines.tsx`
  - `doc/QA-ROUTINE-PATTERN.md`
  - `doc/PRODUCT.md`

- [ ] **Step 1: Install dependencies in the clean worktree**

Run:

```bash
pnpm install
```

Expected: worktree has local dependencies required for tests and build.

- [ ] **Step 2: Run targeted verification**

Run:

```bash
pnpm exec vitest run ui/src/lib/routine-templates.test.ts
```

If a dedicated UI test was added, run it here too.

- [ ] **Step 3: Run repo-level verification**

Run:

```bash
pnpm -r typecheck
pnpm test:run
pnpm build
```

Expected: all pass from the clean worktree.

- [ ] **Step 4: Review the diff for scope control**

Confirm only the intended skill, UI helper/composer, and doc files changed.

- [ ] **Step 5: Final commit**

```bash
git add skills/paperclip-qa-review/SKILL.md ui/src/lib/routine-templates.ts ui/src/lib/routine-templates.test.ts ui/src/pages/Routines.tsx doc/QA-ROUTINE-PATTERN.md doc/PRODUCT.md
git commit -m "Add QA agent and routine watcher operating pattern"
```

## Notes

- Do not add backend schema or route changes unless implementation proves the UI helper is insufficient.
- Do not introduce a new dedicated watcher agent abstraction.
- Keep the implementation aligned with the design spec at `docs/superpowers/specs/2026-03-29-qa-routine-watcher-design.md`.
