import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHermesExecute = vi.hoisted(() => vi.fn());
const mockHermesTestEnvironment = vi.hoisted(() => vi.fn());

vi.mock("hermes-paperclip-adapter/server", () => ({
  execute: mockHermesExecute,
  testEnvironment: mockHermesTestEnvironment,
  sessionCodec: {
    deserialize: vi.fn(),
    serialize: vi.fn(),
  },
}));

import { execute, testEnvironment } from "../adapters/hermes-local/index.js";

describe("Hermes local Paperclip wrapper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("treats transcript-only Hermes output as an incomplete assistant completion", async () => {
    mockHermesExecute.mockResolvedValueOnce({
      exitCode: 0,
      signal: null,
      timedOut: false,
      summary: `<tool_call>
{"name":"execute_code","arguments":{"language":"python","code":"print('hello')"}}
</tool_call>`,
      sessionParams: { sessionId: "hermes-session-1" },
      sessionDisplayId: "hermes-session-1",
      provider: "nous",
      model: "Hermes-3-Llama-3.1-8B",
    });

    const result = await execute({
      runId: "run-1",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Hermes Agent",
        adapterType: "hermes_local",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {},
      context: {},
      onLog: async () => {},
    });

    expect(result.summary).toBeNull();
    expect(result.errorCode).toBe("incomplete_assistant_completion");
    expect(result.errorMessage).toBe(
      "Hermes returned tool-call transcript output without a final assistant completion.",
    );
    expect(result.resultJson).toEqual({
      message: "Hermes returned tool-call transcript output without a final assistant completion.",
    });
    expect(result.sessionParams).toEqual({ sessionId: "hermes-session-1" });
    expect(result.sessionDisplayId).toBe("hermes-session-1");
  });

  it("forces Hermes runs onto the CLI codex provider, gpt-5.4 model, and a Paperclip-managed local Hermes home", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-hermes-home-"));
    const sharedHermesHome = path.join(root, "shared-hermes-home");
    const sharedSkills = path.join(sharedHermesHome, "skills");
    const paperclipHome = path.join(root, "paperclip-home");
    const managedHermesHome = path.join(
      paperclipHome,
      "instances",
      "default",
      "companies",
      "company-1",
      "agents",
      "agent-1",
      "hermes-home",
    );
    const previousHome = process.env.HOME;
    const previousHermesHome = process.env.HERMES_HOME;
    const previousPaperclipHome = process.env.PAPERCLIP_HOME;
    const previousPaperclipInstanceId = process.env.PAPERCLIP_INSTANCE_ID;
    const previousPaperclipInWorktree = process.env.PAPERCLIP_IN_WORKTREE;
    await fs.mkdir(sharedSkills, { recursive: true });
    await fs.writeFile(path.join(sharedHermesHome, ".env"), "OPENROUTER_API_KEY=test-key\n", "utf8");
    await fs.writeFile(path.join(sharedHermesHome, "auth.json"), '{"active_provider":"openai-codex"}\n', "utf8");
    await fs.writeFile(path.join(sharedHermesHome, "SOUL.md"), "# soul\n", "utf8");
    await fs.writeFile(path.join(sharedSkills, "README.md"), "skills\n", "utf8");

    mockHermesExecute.mockResolvedValueOnce({
      exitCode: 0,
      signal: null,
      timedOut: false,
      summary: "Completed work.",
      provider: "codex",
      model: "gpt-5.4",
    });

    try {
      process.env.HOME = root;
      process.env.HERMES_HOME = sharedHermesHome;
      process.env.PAPERCLIP_HOME = paperclipHome;
      delete process.env.PAPERCLIP_INSTANCE_ID;
      delete process.env.PAPERCLIP_IN_WORKTREE;

      const logs: Array<{ stream: "stdout" | "stderr"; chunk: string }> = [];
      await execute({
        runId: "run-2",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Hermes Agent",
          adapterType: "hermes_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          provider: "nous",
          model: "Hermes-4-405B",
          promptTemplate: "Work the issue.",
        },
        context: {},
        onLog: async (stream, chunk) => {
          logs.push({ stream, chunk });
        },
      });

      expect(mockHermesExecute).toHaveBeenCalledTimes(1);
      const expectedConfig = expect.objectContaining({
        provider: "openai-codex",
        model: "gpt-5.4",
        promptTemplate: "Work the issue.",
        toolsets: "terminal,file,web,skills,code_execution,delegation,memory,session_search,todo,clarify",
        env: expect.objectContaining({
          TERMINAL_ENV: "local",
          HERMES_HOME: managedHermesHome,
        }),
      });
      expect(mockHermesExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expectedConfig,
          agent: expect.objectContaining({
            adapterConfig: expectedConfig,
          }),
        }),
      );

      const managedAuth = path.join(managedHermesHome, "auth.json");
      const managedEnv = path.join(managedHermesHome, ".env");
      const managedSoul = path.join(managedHermesHome, "SOUL.md");
      const managedSkills = path.join(managedHermesHome, "skills");
      expect((await fs.lstat(managedAuth)).isSymbolicLink()).toBe(true);
      expect(await fs.realpath(managedAuth)).toBe(await fs.realpath(path.join(sharedHermesHome, "auth.json")));
      expect((await fs.lstat(managedEnv)).isSymbolicLink()).toBe(true);
      expect(await fs.realpath(managedEnv)).toBe(await fs.realpath(path.join(sharedHermesHome, ".env")));
      expect((await fs.lstat(managedSoul)).isSymbolicLink()).toBe(true);
      expect(await fs.realpath(managedSoul)).toBe(await fs.realpath(path.join(sharedHermesHome, "SOUL.md")));
      expect((await fs.lstat(managedSkills)).isSymbolicLink()).toBe(true);
      expect(await fs.realpath(managedSkills)).toBe(await fs.realpath(sharedSkills));
      await expect(fs.lstat(path.join(managedHermesHome, "config.yaml"))).rejects.toThrow();
      expect(logs).toContainEqual(
        expect.objectContaining({
          stream: "stdout",
          chunk: expect.stringContaining("Using Paperclip-managed Hermes home"),
        }),
      );
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousHermesHome === undefined) delete process.env.HERMES_HOME;
      else process.env.HERMES_HOME = previousHermesHome;
      if (previousPaperclipHome === undefined) delete process.env.PAPERCLIP_HOME;
      else process.env.PAPERCLIP_HOME = previousPaperclipHome;
      if (previousPaperclipInstanceId === undefined) delete process.env.PAPERCLIP_INSTANCE_ID;
      else process.env.PAPERCLIP_INSTANCE_ID = previousPaperclipInstanceId;
      if (previousPaperclipInWorktree === undefined) delete process.env.PAPERCLIP_IN_WORKTREE;
      else process.env.PAPERCLIP_IN_WORKTREE = previousPaperclipInWorktree;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("provides a Paperclip-specific code_execution prompt template when none is configured", async () => {
    mockHermesExecute.mockResolvedValueOnce({
      exitCode: 0,
      signal: null,
      timedOut: false,
      summary: "Completed work.",
      provider: "openai-codex",
      model: "gpt-5.4",
    });

    await execute({
      runId: "run-2c",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Hermes Agent",
        adapterType: "hermes_local",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {},
      context: {},
      onLog: async () => {},
    });

    expect(mockHermesExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          promptTemplate: expect.stringContaining("Use the `code_execution` tool for ALL Paperclip API calls."),
        }),
      }),
    );
  });

  it("tells generic Hermes wakeups to include assigned in-progress issues before backlog", async () => {
    mockHermesExecute.mockResolvedValueOnce({
      exitCode: 0,
      signal: null,
      timedOut: false,
      summary: "Completed work.",
      provider: "openai-codex",
      model: "gpt-5.4",
    });

    await execute({
      runId: "run-2d",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Hermes Agent",
        adapterType: "hermes_local",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {},
      context: {},
      onLog: async () => {},
    });

    expect(mockHermesExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          promptTemplate: expect.stringContaining("'status': 'todo,in_progress'"),
        }),
      }),
    );
    expect(mockHermesExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          promptTemplate: expect.stringContaining("/issues/ISSUE_ID/heartbeat-context"),
        }),
      }),
    );
    expect(mockHermesExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          promptTemplate: expect.stringContaining("Do not skip it just because it is already started."),
        }),
      }),
    );
  });

  it("resolves hermes from HOME/.local/bin when PATH does not include it", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-hermes-path-"));
    const localBin = path.join(root, ".local", "bin");
    const hermesPath = path.join(localBin, "hermes");
    const previousHome = process.env.HOME;
    const previousPath = process.env.PATH;
    await fs.mkdir(localBin, { recursive: true });
    await fs.writeFile(hermesPath, "#!/bin/sh\nexit 0\n", "utf8");
    await fs.chmod(hermesPath, 0o755);

    mockHermesExecute.mockResolvedValueOnce({
      exitCode: 0,
      signal: null,
      timedOut: false,
      summary: "Completed work.",
      provider: "codex",
      model: "gpt-5.4",
    });

    try {
      process.env.HOME = root;
      process.env.PATH = "/usr/bin:/bin";

      await execute({
        runId: "run-2b",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Hermes Agent",
          adapterType: "hermes_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {},
        context: {},
        onLog: async () => {},
      });

      expect(mockHermesExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            hermesCommand: hermesPath,
            model: "gpt-5.4",
            provider: "openai-codex",
            env: expect.objectContaining({
              HERMES_HOME: expect.any(String),
              TERMINAL_ENV: "local",
            }),
          }),
        }),
      );
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("uses the resolved hermes command for environment checks when PATH is stripped", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-hermes-env-test-"));
    const localBin = path.join(root, ".local", "bin");
    const hermesPath = path.join(localBin, "hermes");
    const previousHome = process.env.HOME;
    const previousPath = process.env.PATH;
    await fs.mkdir(localBin, { recursive: true });
    await fs.writeFile(hermesPath, "#!/bin/sh\nexit 0\n", "utf8");
    await fs.chmod(hermesPath, 0o755);

    mockHermesTestEnvironment.mockResolvedValueOnce({
      adapterType: "hermes_local",
      status: "pass",
      checks: [],
      testedAt: "2026-03-27T00:00:00.000Z",
    });

    try {
      process.env.HOME = root;
      process.env.PATH = "/usr/bin:/bin";

      await testEnvironment({
        companyId: "company-1",
        adapterType: "hermes_local",
        config: {},
      });

      expect(mockHermesTestEnvironment).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            hermesCommand: hermesPath,
            model: "gpt-5.4",
            provider: "openai-codex",
            env: expect.objectContaining({
              HERMES_HOME: expect.any(String),
              TERMINAL_ENV: "local",
            }),
          }),
        }),
      );
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("treats provider login failures as execution errors instead of successes", async () => {
    mockHermesExecute.mockResolvedValueOnce({
      exitCode: 0,
      signal: null,
      timedOut: false,
      summary: "Hermes is not logged into Nous Portal. Run `hermes model` to re-authenticate.",
      provider: "codex",
      model: "gpt-5.4",
    });

    const result = await execute({
      runId: "run-3",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Hermes Agent",
        adapterType: "hermes_local",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {},
      context: {},
      onLog: async () => {},
    });

    expect(result.summary).toBe("Hermes is not logged into Nous Portal. Run `hermes model` to re-authenticate.");
    expect(result.errorCode).toBe("provider_auth_required");
    expect(result.errorMessage).toBe(
      "Hermes is not logged into Nous Portal. Run `hermes model` to re-authenticate.",
    );
  });

  it("treats Paperclip API connectivity failures as execution errors instead of successes", async () => {
    mockHermesExecute.mockResolvedValueOnce({
      exitCode: 0,
      signal: null,
      timedOut: false,
      summary:
        "**Heartbeat Report**\n\nStatus: Unable to connect to Paperclip API server at `http://127.0.0.1:3100`\n\nThe server appears to be down or not running.",
      provider: "codex",
      model: "gpt-5.4",
    });

    const result = await execute({
      runId: "run-4",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Hermes Agent",
        adapterType: "hermes_local",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {},
      context: {},
      onLog: async () => {},
    });

    expect(result.errorCode).toBe("paperclip_unreachable");
    expect(result.errorMessage).toContain("Paperclip API server");
    expect(result.summary).toContain("Unable to connect to Paperclip API server");
    expect(result.clearSession).toBe(true);
  });

  it("treats stored localhost-unreachable heartbeat summaries as Paperclip failures", async () => {
    mockHermesExecute.mockResolvedValueOnce({
      exitCode: 0,
      signal: null,
      timedOut: false,
      summary:
        "Tried the assigned-issues Paperclip API call, but localhost:3100 is unreachable from this session.\n\n" +
        "Result:\n" +
        "- curl to http://127.0.0.1:3100/... failed with exit code 7\n" +
        "- So I could not list assigned issues or continue checkout/completion flow\n\n" +
        "If you want, I can retry once the Paperclip API is running and reachable from this environment.\n\n" +
        "session_id: 20260327_080439_1dd08a\n",
      provider: "codex",
      model: "gpt-5.4",
    });

    const result = await execute({
      runId: "run-5",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Hermes Agent",
        adapterType: "hermes_local",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {},
      context: {},
      onLog: async () => {},
    });

    expect(result.errorCode).toBe("paperclip_unreachable");
    expect(result.errorMessage).toContain("localhost:3100 is unreachable from this session");
    expect(result.summary).toContain("curl to http://127.0.0.1:3100/... failed with exit code 7");
    expect(result.clearSession).toBe(true);
  });
});
