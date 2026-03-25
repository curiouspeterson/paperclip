import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ISSUE_CHECKOUT_EXPECTED_STATUSES } from "@paperclipai/shared";

const {
  mockGet,
  mockPatch,
  mockPost,
  mockFormatInlineRecord,
  mockPrintOutput,
  mockHandleCommandError,
} = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPatch: vi.fn(),
  mockPost: vi.fn(),
  mockFormatInlineRecord: vi.fn((record: Record<string, unknown>) => JSON.stringify(record)),
  mockPrintOutput: vi.fn(),
  mockHandleCommandError: vi.fn((error: unknown): never => {
    throw error instanceof Error ? error : new Error(String(error));
  }),
}));

vi.mock("../commands/client/common.js", () => ({
  addCommonClientOptions: (command: Command) => command,
  formatInlineRecord: mockFormatInlineRecord,
  handleCommandError: mockHandleCommandError,
  printOutput: mockPrintOutput,
  resolveCommandContext: (opts: { companyId?: string } = {}) => ({
    api: {
      get: mockGet,
      patch: mockPatch,
      post: mockPost,
    },
    companyId: opts.companyId,
    json: true,
  }),
}));

import { registerIssueCommands } from "../commands/client/issue.js";

describe("issue client commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prints the full add-comment result payload for issue comment", async () => {
    const result = {
      comment: {
        id: "comment-1",
        issueId: "issue-1",
        companyId: "company-1",
        body: "hello",
        createdAt: "2026-03-23T16:00:00.000Z",
        updatedAt: "2026-03-23T16:00:00.000Z",
        authorAgentId: null,
        authorUserId: "user-1",
      },
      warnings: [
        {
          code: "issue_reopened",
          message: "Issue was reopened because the comment requested it.",
        },
      ],
    };
    mockPost.mockResolvedValue(result);

    const program = new Command();
    registerIssueCommands(program);

    await program.parseAsync([
      "node",
      "paperclipai",
      "issue",
      "comment",
      "issue-1",
      "--body",
      "hello",
      "--reopen",
    ]);

    expect(mockPost).toHaveBeenCalledWith("/api/issues/issue-1/comments", {
      body: "hello",
      reopen: true,
    });
    expect(mockPrintOutput).toHaveBeenCalledWith(result, { json: true });
    expect(mockHandleCommandError).not.toHaveBeenCalled();
  });

  it("passes the default checkout expected statuses to the API", async () => {
    mockPost.mockResolvedValue({ id: "issue-1", status: "in_progress" });

    const program = new Command();
    registerIssueCommands(program);

    await program.parseAsync([
      "node",
      "paperclipai",
      "issue",
      "checkout",
      "issue-1",
      "--agent-id",
      "00000000-0000-4000-8000-000000000001",
    ]);

    expect(mockPost).toHaveBeenCalledWith("/api/issues/issue-1/checkout", {
      agentId: "00000000-0000-4000-8000-000000000001",
      expectedStatuses: [...ISSUE_CHECKOUT_EXPECTED_STATUSES],
    });
  });

  it("parses null hiddenAt and integer request depth for update", async () => {
    mockPatch.mockResolvedValue({ id: "issue-1", hiddenAt: null });

    const program = new Command();
    registerIssueCommands(program);

    await program.parseAsync([
      "node",
      "paperclipai",
      "issue",
      "update",
      "issue-1",
      "--hidden-at",
      "null",
      "--request-depth",
      "3",
      "--comment",
      "board note",
    ]);

    expect(mockPatch).toHaveBeenCalledWith("/api/issues/issue-1", {
      comment: "board note",
      hiddenAt: null,
      requestDepth: 3,
    });
  });

  it("filters list output locally before printing json", async () => {
    const rows = [
      {
        id: "issue-1",
        identifier: "PAP-1",
        title: "Fix heartbeat orphaning",
        description: "Running issue cleanup",
      },
      {
        id: "issue-2",
        identifier: "PAP-2",
        title: "Budget review",
        description: "Monthly review",
      },
    ];
    mockGet.mockResolvedValue(rows);

    const program = new Command();
    registerIssueCommands(program);

    await program.parseAsync([
      "node",
      "paperclipai",
      "issue",
      "list",
      "-C",
      "company-1",
      "--status",
      "todo,blocked",
      "--project-id",
      "project-1",
      "--match",
      "heartbeat",
    ]);

    expect(mockGet).toHaveBeenCalledWith(
      "/api/companies/company-1/issues?status=todo%2Cblocked&projectId=project-1",
    );
    expect(mockPrintOutput).toHaveBeenCalledWith([rows[0]], { json: true });
  });

  it("posts an empty payload for release", async () => {
    mockPost.mockResolvedValue({ id: "issue-1", status: "todo" });

    const program = new Command();
    registerIssueCommands(program);

    await program.parseAsync(["node", "paperclipai", "issue", "release", "issue-1"]);

    expect(mockPost).toHaveBeenCalledWith("/api/issues/issue-1/release", {});
  });
});
