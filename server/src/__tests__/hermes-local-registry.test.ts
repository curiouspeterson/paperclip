import { describe, expect, it, vi } from "vitest";

const { hermesExecuteMock } = vi.hoisted(() => ({
  hermesExecuteMock: vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    provider: "zai",
    resultJson: {},
  })),
}));

vi.mock("hermes-paperclip-adapter/server", () => ({
  execute: hermesExecuteMock,
  testEnvironment: vi.fn(),
  sessionCodec: {
    deserialize: (value: Record<string, unknown> | null) => value,
    serialize: (value: Record<string, unknown> | null) => value,
    getDisplayId: () => null,
  },
}));

vi.mock("hermes-paperclip-adapter", () => ({
  agentConfigurationDoc: "test-doc",
  models: [],
}));

import { getServerAdapter } from "../adapters/registry.js";

describe("hermes_local registry wrapper", () => {
  it("drops tool-call-only summaries and clears the saved session for the next run", async () => {
    hermesExecuteMock.mockResolvedValueOnce({
      exitCode: 0,
      signal: null,
      timedOut: false,
      provider: "nous",
      summary: [
        "╭─ ⚕ Hermes ───────────────────────────────────────────────────────────────────╮",
        "<tool_call>",
        "{\"name\": \"terminal\", \"arguments\": {\"command\": \"curl -s \\\"http://127.0.0.1:3100/api/issues\\\"\"}}",
        "<tool_call>",
        "{\"name\": \"terminal\", \"arguments\": {\"command\": \"curl -s \\\"http://127.0.0.1:3100/api/issues\\\"\"}}",
        "</tool_call>",
      ].join("\n"),
      sessionParams: { sessionId: "session-1" },
      sessionDisplayId: "session-1",
      resultJson: {},
    });

    const adapter = getServerAdapter("hermes_local");
    const result = await adapter.execute({
      runId: "run-2",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "VP Technical",
        adapterType: "hermes_local",
        adapterConfig: {
          provider: "nous",
          model: "Hermes-4-70B",
          env: {
            NOUS_API_KEY: "nous-secret",
          },
        },
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {
        provider: "nous",
        model: "Hermes-4-70B",
        env: {
          NOUS_API_KEY: "nous-secret",
        },
      },
      context: {},
      onLog: async () => undefined,
      authToken: "paperclip-token",
    });

    expect(result.summary).toBeNull();
    expect(result.clearSession).toBe(true);
    expect(result.resultJson).toMatchObject({
      message: "Hermes returned tool-call transcript output without a final assistant completion.",
    });
  });

  it("passes the prepared runtime config through agent.adapterConfig for Hermes execution", async () => {
    const adapter = getServerAdapter("hermes_local");

    await adapter.execute({
      runId: "run-1",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "VP Technical",
        adapterType: "hermes_local",
        adapterConfig: {
          provider: "zai",
          model: "zai:glm-5",
        },
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {
        provider: "zai",
        model: "zai:glm-5",
      },
      context: {},
      onLog: async () => undefined,
      authToken: "paperclip-token",
    });

    expect(hermesExecuteMock).toHaveBeenCalledTimes(1);
    const ctx = hermesExecuteMock.mock.calls[0]?.[0];
    expect(ctx?.config).toMatchObject({
      provider: "zai",
      model: "glm-5",
      promptTemplate: expect.stringContaining("Paperclip structured response contract:"),
    });
    expect(ctx?.config).toMatchObject({
      env: expect.objectContaining({
        OPENAI_BASE_URL: "https://api.z.ai/api/coding/paas/v4",
        PAPERCLIP_API_KEY: "paperclip-token",
        TERMINAL_ENV: "local",
      }),
    });
    expect(ctx?.agent?.adapterConfig).toEqual(ctx?.config);
  });
});
