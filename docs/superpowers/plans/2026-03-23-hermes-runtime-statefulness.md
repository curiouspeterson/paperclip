# Hermes Runtime Statefulness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Paperclip-managed Hermes worker participate in Paperclip task-session persistence and isolate Hermes runtime state per Paperclip agent.

**Architecture:** Extend the generic process adapter so it passes runtime/session/workspace context and can return session metadata from worker stdout. Then update the Hermes worker to derive a stable Hermes home, reuse deterministic task-scoped Hermes sessions, and emit session metadata back to Paperclip.

**Tech Stack:** TypeScript, Vitest, Python, unittest, Hermes CLI

---

### Task 1: Cover process adapter session passthrough

**Files:**
- Modify: `/Users/adampeterson/GitHub/paperclip/server/src/__tests__/process-adapter-execute.test.ts`
- Modify: `/Users/adampeterson/GitHub/paperclip/server/src/adapters/process/execute.ts`

- [ ] **Step 1: Add a failing process adapter test for runtime/session env passthrough**
- [ ] **Step 2: Add a failing process adapter test for `_sessionId` / `_sessionParams` stdout parsing**
- [ ] **Step 3: Implement richer env passthrough and session metadata extraction in the process adapter**
- [ ] **Step 4: Run `pnpm vitest run server/src/__tests__/process-adapter-execute.test.ts`**

### Task 2: Make the Hermes worker task-stateful

**Files:**
- Modify: `/Users/adampeterson/GitHub/paperclip/scripts/tests/test_hermes_paperclip_worker.py`
- Modify: `/Users/adampeterson/GitHub/paperclip/scripts/hermes_paperclip_worker.py`

- [ ] **Step 1: Add failing worker tests for Hermes home derivation and session-name derivation**
- [ ] **Step 2: Add failing worker tests for emitted session metadata**
- [ ] **Step 3: Implement Hermes home/session helpers and deterministic `--continue` reuse**
- [ ] **Step 4: Run `python -m unittest scripts.tests.test_hermes_paperclip_worker`**

### Task 3: Clean up Hermes creation UX

**Files:**
- Modify: `/Users/adampeterson/GitHub/paperclip/ui/src/pages/CompanySettings.tsx`

- [ ] **Step 1: Update the Hermes shortcut copy to describe the Paperclip-managed Hermes worker accurately**
- [ ] **Step 2: Keep the existing preset route intact for this slice**

### Task 4: Verify and hand off

**Files:**
- Modify: `/Users/adampeterson/GitHub/paperclip/docs/superpowers/specs/2026-03-23-hermes-runtime-statefulness-design.md`
- Modify: `/Users/adampeterson/GitHub/paperclip/docs/superpowers/plans/2026-03-23-hermes-runtime-statefulness.md`

- [ ] **Step 1: Run `pnpm -r typecheck`**
- [ ] **Step 2: Summarize remaining Hermes roadmap items not included in this slice**
