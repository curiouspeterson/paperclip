import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { execute } from "@paperclipai/adapter-claude-local/server";

const mockRunChildProcess = vi.hoisted(() => vi.fn());
const mockEnsureAbsoluteDirectory = vi.hoisted(() => vi.fn());
const mockEnsureCommandResolvable = vi.hoisted(() => vi.fn());
const mockReadPaperclipRuntimeSkillEntries = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const mockEnsurePathInEnv = vi.hoisted(() => vi.fn((env: Record<string, string>) => env));

vi.mock("@paperclipai/adapter-utils/server-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@paperclipai/adapter-utils/server-utils")>();
  return {
    ...actual,
    ensureAbsoluteDirectory: mockEnsureAbsoluteDirectory,
    ensureCommandResolvable: mockEnsureCommandResolvable,
    ensurePathInEnv: mockEnsurePathInEnv,
    readPaperclipRuntimeSkillEntries: mockReadPaperclipRuntimeSkillEntries,
    runChildProcess: mockRunChildProcess,
  };
});

describe("claude-local execute", () => {
  beforeEach(() => {
    mockRunChildProcess.mockReset();
    mockEnsureAbsoluteDirectory.mockReset();
    mockEnsureCommandResolvable.mockReset();
    mockReadPaperclipRuntimeSkillEntries.mockClear();
    mockEnsurePathInEnv.mockClear();
  });

  it("injects the issue workflow note into the Claude prompt", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-claude-execute-"));
    const prompts: string[] = [];

    mockRunChildProcess.mockImplementation(async (_runId, _command, _args, options) => {
      prompts.push(String(options.stdin ?? ""));
      return {
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: "",
        stderr: "",
      };
    });

    try {
      const result = await execute({
        runId: "run-1",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Claude Writer",
          adapterType: "claude_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: "claude",
          cwd: workspace,
          promptTemplate: "Continue the work.",
        },
        context: {
          issueId: "issue-1",
        },
        authToken: "run-jwt-token",
        onLog: async () => {},
        onMeta: async () => {},
      });

      expect(result.exitCode).toBe(0);
      expect(prompts[0]).toContain("Paperclip issue workflow note:");
      expect(prompts[0]).toContain('PATCH /api/issues/{issueId} with {"status":"done","comment":"what changed and why"}');
      expect(prompts[0]).toContain("Do not leave an issue without a final status update and comment.");
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
