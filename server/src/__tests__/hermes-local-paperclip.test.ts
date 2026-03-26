import { describe, expect, it, vi } from "vitest";

const mockHermesExecute = vi.hoisted(() => vi.fn());

vi.mock("hermes-paperclip-adapter/server", () => ({
  execute: mockHermesExecute,
  testEnvironment: vi.fn(),
  sessionCodec: {
    deserialize: vi.fn(),
    serialize: vi.fn(),
  },
}));

import { execute } from "../adapters/hermes-local/index.js";

describe("Hermes local Paperclip wrapper", () => {
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
});
