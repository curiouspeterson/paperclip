import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPost, mockPrintOutput, mockHandleCommandError } = vi.hoisted(() => ({
  mockPost: vi.fn(),
  mockPrintOutput: vi.fn(),
  mockHandleCommandError: vi.fn((error: unknown): never => {
    throw error instanceof Error ? error : new Error(String(error));
  }),
}));

vi.mock("../commands/client/common.js", () => ({
  addCommonClientOptions: (command: Command) => command,
  formatInlineRecord: vi.fn(),
  handleCommandError: mockHandleCommandError,
  printOutput: mockPrintOutput,
  resolveCommandContext: () => ({
    api: {
      post: mockPost,
    },
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
});
