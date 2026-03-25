import { describe, expect, it, vi } from "vitest";
import {
  applyStructuredHeartbeatIssueUpdate,
  parseStructuredHeartbeatIssueUpdate,
} from "../services/heartbeat-structured-update.js";

describe("parseStructuredHeartbeatIssueUpdate", () => {
  it("parses a plain JSON structured update from the persisted summary", () => {
    expect(
      parseStructuredHeartbeatIssueUpdate({
        summary: JSON.stringify({
          status: "done",
          comment_markdown: "Implemented the runtime bootstrap fix.",
          plan_markdown: "",
          change_summary: "",
        }),
      }),
    ).toMatchObject({
      status: "done",
      commentMarkdown: "Implemented the runtime bootstrap fix.",
      planMarkdown: "",
      changeSummary: "",
    });
  });

  it("parses fenced JSON payloads", () => {
    expect(
      parseStructuredHeartbeatIssueUpdate({
        summary: [
          "```json",
          JSON.stringify({
            status: "blocked",
            comment_markdown: "Blocked on missing provider credits.",
            plan_markdown: "",
            change_summary: "",
          }),
          "```",
        ].join("\n"),
      }),
    ).toMatchObject({
      status: "blocked",
      commentMarkdown: "Blocked on missing provider credits.",
    });
  });

  it("salvages issue-shaped payloads into the structured contract", () => {
    expect(
      parseStructuredHeartbeatIssueUpdate({
        summary: JSON.stringify({
          status: "done",
          title: "Episode assets are ready.",
          description: "Pipeline completed and the assets are ready for review.",
        }),
      }),
    ).toMatchObject({
      status: "done",
      commentMarkdown: "Episode assets are ready.\n\nPipeline completed and the assets are ready for review.",
      planMarkdown: "",
      changeSummary: "",
    });
  });

  it("rejects invalid statuses and empty comments", () => {
    expect(
      parseStructuredHeartbeatIssueUpdate({
        summary: JSON.stringify({
          status: "todo",
          comment_markdown: "Not valid for structured completion.",
          plan_markdown: "",
          change_summary: "",
        }),
      }),
    ).toBeNull();

    expect(
      parseStructuredHeartbeatIssueUpdate({
        summary: JSON.stringify({
          status: "done",
          comment_markdown: "",
          plan_markdown: "",
          change_summary: "",
        }),
      }),
    ).toBeNull();
  });
});

describe("applyStructuredHeartbeatIssueUpdate", () => {
  it("applies status, comment, and plan updates from a structured Hermes payload", async () => {
    const services = {
      getIssueById: vi.fn(async () => ({
        id: "issue-1",
        companyId: "company-1",
        identifier: "ROM-1",
        title: "Bootstrap the runtime",
        status: "in_progress",
      })),
      updateIssue: vi.fn(async () => ({
        id: "issue-1",
        companyId: "company-1",
        identifier: "ROM-1",
        title: "Bootstrap the runtime",
        status: "done",
      })),
      addComment: vi.fn(async () => ({
        id: "comment-1",
        body: "Implemented the runtime bootstrap fix.",
      })),
      getIssueDocumentByKey: vi.fn(async () => ({
        id: "doc-1",
        key: "plan",
        title: "Implementation plan",
        format: "markdown",
        latestRevisionId: "rev-1",
        latestRevisionNumber: 1,
      })),
      upsertIssueDocument: vi.fn(async () => ({
        created: false,
        document: {
          id: "doc-1",
          key: "plan",
          title: "Implementation plan",
          format: "markdown",
          latestRevisionId: "rev-2",
          latestRevisionNumber: 2,
        },
      })),
      logActivity: vi.fn(async () => undefined),
    };

    const applied = await applyStructuredHeartbeatIssueUpdate(services, {
      issueId: "issue-1",
      companyId: "company-1",
      runId: "run-1",
      agentId: "agent-1",
      resultJson: {
        summary: JSON.stringify({
          status: "done",
          comment_markdown: "Implemented the runtime bootstrap fix.",
          plan_markdown: "1. Verify the runtime policy.\n2. Re-run the issue.",
          change_summary: "Bootstrap fix",
        }),
      },
    });

    expect(applied).toBe(true);
    expect(services.updateIssue).toHaveBeenCalledWith("issue-1", { status: "done" });
    expect(services.addComment).toHaveBeenCalledWith(
      "issue-1",
      "Implemented the runtime bootstrap fix.",
      { agentId: "agent-1" },
    );
    expect(services.upsertIssueDocument).toHaveBeenCalledWith({
      issueId: "issue-1",
      key: "plan",
      title: "Implementation plan",
      format: "markdown",
      body: "1. Verify the runtime policy.\n2. Re-run the issue.",
      changeSummary: "Bootstrap fix",
      baseRevisionId: "rev-1",
      createdByAgentId: "agent-1",
    });
    expect(services.logActivity).toHaveBeenCalledTimes(3);
    expect(services.logActivity).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: "issue.updated",
        entityId: "issue-1",
        runId: "run-1",
      }),
    );
    expect(services.logActivity).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: "issue.comment_added",
        entityId: "issue-1",
        runId: "run-1",
      }),
    );
    expect(services.logActivity).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        action: "issue.document_updated",
        entityId: "issue-1",
        runId: "run-1",
      }),
    );
  });

  it("returns false without mutating state when no valid structured payload exists", async () => {
    const services = {
      getIssueById: vi.fn(),
      updateIssue: vi.fn(),
      addComment: vi.fn(),
      getIssueDocumentByKey: vi.fn(),
      upsertIssueDocument: vi.fn(),
      logActivity: vi.fn(),
    };

    const applied = await applyStructuredHeartbeatIssueUpdate(services, {
      issueId: "issue-1",
      companyId: "company-1",
      runId: "run-1",
      agentId: "agent-1",
      resultJson: {
        summary: "Plain prose only",
      },
    });

    expect(applied).toBe(false);
    expect(services.getIssueById).not.toHaveBeenCalled();
    expect(services.updateIssue).not.toHaveBeenCalled();
    expect(services.addComment).not.toHaveBeenCalled();
    expect(services.logActivity).not.toHaveBeenCalled();
  });
});
