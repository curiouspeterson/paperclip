import { describe, expect, it, vi } from "vitest";
import { findRunningExecutionForIssue } from "../routes/issues-active-run.js";

describe("findRunningExecutionForIssue", () => {
  it("returns the tracked execution run when it is still running", async () => {
    const heartbeat = {
      getRun: vi.fn(async () => ({
        id: "run-1",
        status: "running",
        contextSnapshot: { issueId: "issue-1" },
      })),
      getActiveRunForAgent: vi.fn(async () => null),
    };

    const result = await findRunningExecutionForIssue(heartbeat, {
      id: "issue-1",
      assigneeAgentId: "agent-1",
      executionRunId: "run-1",
    });

    expect(result?.id).toBe("run-1");
    expect(heartbeat.getActiveRunForAgent).not.toHaveBeenCalled();
  });

  it("falls back to the agent active run when it belongs to the same issue", async () => {
    const heartbeat = {
      getRun: vi.fn(async () => ({
        id: "run-1",
        status: "failed",
        contextSnapshot: { issueId: "issue-1" },
      })),
      getActiveRunForAgent: vi.fn(async () => ({
        id: "run-2",
        status: "running",
        contextSnapshot: { issueId: "issue-1" },
      })),
    };

    const result = await findRunningExecutionForIssue(heartbeat, {
      id: "issue-1",
      assigneeAgentId: "agent-1",
      executionRunId: "run-1",
    });

    expect(result?.id).toBe("run-2");
  });

  it("ignores active runs for other issues", async () => {
    const heartbeat = {
      getRun: vi.fn(async () => null),
      getActiveRunForAgent: vi.fn(async () => ({
        id: "run-2",
        status: "running",
        contextSnapshot: { issueId: "issue-2" },
      })),
    };

    const result = await findRunningExecutionForIssue(heartbeat, {
      id: "issue-1",
      assigneeAgentId: "agent-1",
    });

    expect(result).toBeNull();
  });
});
