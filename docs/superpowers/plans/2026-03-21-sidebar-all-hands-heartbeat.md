# Sidebar All Hands Heartbeat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `All Hands Heartbeat` and `BOO!` sidebar actions with correct agent targeting and shared bulk invoke feedback.

**Architecture:** Keep the behavior in `SidebarAgents`, extract target-selection and summary formatting into a small pure helper module, and reuse the existing per-agent invoke API for execution. This avoids new backend surface area while keeping the UI logic testable.

**Tech Stack:** React 19, TypeScript, TanStack Query, Vitest

---

### Task 1: Add bulk heartbeat selection helpers

**Files:**
- Create: `ui/src/lib/sidebar-heartbeats.ts`
- Test: `ui/src/lib/sidebar-heartbeats.test.ts`

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run `pnpm test:run -- ui/src/lib/sidebar-heartbeats.test.ts` and verify it fails**
- [ ] **Step 3: Implement target-selection and summary helpers**
- [ ] **Step 4: Re-run the targeted test and verify it passes**

### Task 2: Wire the sidebar bulk actions

**Files:**
- Modify: `ui/src/components/SidebarAgents.tsx`

- [ ] **Step 1: Add the action row above the agents section header**
- [ ] **Step 2: Reuse the helper functions to target eligible vs non-terminated agents**
- [ ] **Step 3: Add shared pending state and aggregated toast handling**
- [ ] **Step 4: Re-run targeted tests and typecheck**

### Task 3: Final verification

**Files:**
- Modify: none unless verification reveals issues

- [ ] **Step 1: Run `pnpm -r typecheck`**
- [ ] **Step 2: Run `pnpm test:run`**
- [ ] **Step 3: Run `pnpm build`**
