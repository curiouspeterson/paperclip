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

  it("forces Hermes runs onto the codex provider and gpt-5.4 model", async () => {
    mockHermesExecute.mockResolvedValueOnce({
      exitCode: 0,
      signal: null,
      timedOut: false,
      summary: "Completed work.",
      provider: "codex",
      model: "gpt-5.4",
    });

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
      onLog: async () => {},
    });

    expect(mockHermesExecute).toHaveBeenCalledTimes(1);
    const expectedConfig = expect.objectContaining({
      provider: "codex",
      model: "gpt-5.4",
      promptTemplate: "Work the issue.",
    });
    expect(mockHermesExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expectedConfig,
        agent: expect.objectContaining({
          adapterConfig: expectedConfig,
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
            provider: "codex",
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
            provider: "codex",
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
  });
});
