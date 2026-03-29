import { afterEach, describe, expect, it, vi } from "vitest";
import { queueIssueAssignmentWakeup } from "../services/issue-assignment-wakeup.ts";

const ORIGINAL_DISABLE_ASSIGNMENT_WAKEUPS =
  process.env.PAPERCLIP_E2E_DISABLE_ASSIGNMENT_WAKEUPS;

afterEach(() => {
  if (ORIGINAL_DISABLE_ASSIGNMENT_WAKEUPS === undefined) {
    delete process.env.PAPERCLIP_E2E_DISABLE_ASSIGNMENT_WAKEUPS;
  } else {
    process.env.PAPERCLIP_E2E_DISABLE_ASSIGNMENT_WAKEUPS =
      ORIGINAL_DISABLE_ASSIGNMENT_WAKEUPS;
  }
});

describe("queueIssueAssignmentWakeup", () => {
  it("queues a wakeup for assigned non-backlog issues by default", async () => {
    delete process.env.PAPERCLIP_E2E_DISABLE_ASSIGNMENT_WAKEUPS;
    const wakeup = vi.fn().mockResolvedValue({ id: "run-1" });

    const result = await queueIssueAssignmentWakeup({
      heartbeat: { wakeup },
      issue: { id: "issue-1", assigneeAgentId: "agent-1", status: "todo" },
      reason: "issue_assigned",
      mutation: "create",
      contextSource: "issue.create",
      requestedByActorType: "user",
      requestedByActorId: "user-1",
    });

    expect(result).toEqual({ id: "run-1" });
    expect(wakeup).toHaveBeenCalledWith("agent-1", {
      source: "assignment",
      triggerDetail: "system",
      reason: "issue_assigned",
      payload: { issueId: "issue-1", mutation: "create" },
      requestedByActorType: "user",
      requestedByActorId: "user-1",
      contextSnapshot: { issueId: "issue-1", source: "issue.create" },
    });
  });

  it("skips wakeup when browser E2E disables assignment wakeups", async () => {
    process.env.PAPERCLIP_E2E_DISABLE_ASSIGNMENT_WAKEUPS = "true";
    const wakeup = vi.fn().mockResolvedValue({ id: "run-1" });

    const result = await queueIssueAssignmentWakeup({
      heartbeat: { wakeup },
      issue: { id: "issue-1", assigneeAgentId: "agent-1", status: "todo" },
      reason: "issue_assigned",
      mutation: "create",
      contextSource: "issue.create",
    });

    expect(result).toBeNull();
    expect(wakeup).not.toHaveBeenCalled();
  });

  it.each(["done", "cancelled"] as const)(
    "skips wakeup for assigned terminal issues with status %s",
    async (status) => {
      delete process.env.PAPERCLIP_E2E_DISABLE_ASSIGNMENT_WAKEUPS;
      const wakeup = vi.fn().mockResolvedValue({ id: "run-1" });

      const result = await queueIssueAssignmentWakeup({
        heartbeat: { wakeup },
        issue: { id: "issue-1", assigneeAgentId: "agent-1", status },
        reason: "issue_assigned",
        mutation: "create",
        contextSource: "issue.create",
      });

      expect(result).toBeUndefined();
      expect(wakeup).not.toHaveBeenCalled();
    },
  );
});
