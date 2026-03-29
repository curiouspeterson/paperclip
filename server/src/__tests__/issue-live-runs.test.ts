import { describe, expect, it } from "vitest";
import { pickIssueActiveRunId } from "../services/issue-live-runs.ts";

describe("pickIssueActiveRunId", () => {
  it("returns the newest issue-linked live run when the issue is terminal", () => {
    const activeRunId = pickIssueActiveRunId({
      issue: {
        id: "issue-1",
        status: "done",
        executionRunId: null,
        assigneeAgentId: "agent-1",
      },
      liveRuns: [
        { id: "run-new", createdAt: "2026-03-29T18:00:00.000Z" },
        { id: "run-old", createdAt: "2026-03-29T17:00:00.000Z" },
      ],
      executionRun: null,
      assigneeRun: null,
    });

    expect(activeRunId).toBe("run-new");
  });

  it("prefers the issue execution run when it is still live", () => {
    const activeRunId = pickIssueActiveRunId({
      issue: {
        id: "issue-1",
        status: "in_progress",
        executionRunId: "run-execution",
        assigneeAgentId: "agent-1",
      },
      liveRuns: [
        { id: "run-newer-detached", createdAt: "2026-03-29T18:00:00.000Z" },
        { id: "run-execution", createdAt: "2026-03-29T17:00:00.000Z" },
      ],
      executionRun: {
        id: "run-execution",
        status: "running",
      },
      assigneeRun: null,
    });

    expect(activeRunId).toBe("run-execution");
  });

  it("falls back to the assignee's active issue-matching run when no linked summaries are available yet", () => {
    const activeRunId = pickIssueActiveRunId({
      issue: {
        id: "issue-1",
        status: "in_progress",
        executionRunId: null,
        assigneeAgentId: "agent-1",
      },
      liveRuns: [],
      executionRun: null,
      assigneeRun: {
        id: "run-assignee",
        status: "running",
        contextSnapshot: { issueId: "issue-1" },
      },
    });

    expect(activeRunId).toBe("run-assignee");
  });
});
