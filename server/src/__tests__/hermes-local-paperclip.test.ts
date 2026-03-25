import { describe, expect, it } from "vitest";
import {
  finalizeHermesLocalEnvironmentTestResult,
  normalizeHermesLocalExecutionSummary,
  prepareHermesLocalExecutionConfig,
  withHermesLocalProcessEnv,
} from "../adapters/hermes-local/paperclip.js";

describe("prepareHermesLocalExecutionConfig", () => {
  it("injects the Paperclip API key for local Hermes runs when auth is available", () => {
    const config = prepareHermesLocalExecutionConfig(
      {},
      { authToken: "paperclip-token" },
    );

    expect(config.env).toMatchObject({
      PAPERCLIP_API_KEY: "paperclip-token",
    });
  });

  it("does not overwrite an explicit Paperclip API key configured on the agent", () => {
    const config = prepareHermesLocalExecutionConfig(
      {
        env: {
          PAPERCLIP_API_KEY: "agent-token",
        },
      },
      { authToken: "paperclip-token" },
    );

    expect(config.env).toMatchObject({
      PAPERCLIP_API_KEY: "agent-token",
    });
  });

  it("uses a prompt that requires authenticated final issue updates with comments", () => {
    const config = prepareHermesLocalExecutionConfig({}, { authToken: "paperclip-token" });
    const promptTemplate = String(config.promptTemplate ?? "");

    expect(promptTemplate).toContain("Authorization: Bearer $PAPERCLIP_API_KEY");
    expect(promptTemplate).toContain("X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID");
    expect(promptTemplate).toContain('"status":"done","comment":"what changed and why"');
    expect(promptTemplate).toContain("Do not leave an issue without a final status update and comment.");
    expect(promptTemplate).toContain("Paperclip structured response contract:");
    expect(promptTemplate).toContain('"comment_markdown": "1-3 short sentences explaining the outcome or blocker."');
    expect(promptTemplate).toContain("your final assistant response must be exactly one JSON object and nothing else");
  });

  it("appends the Paperclip workflow note to custom prompts without duplicating it", () => {
    const original = "You are a custom Hermes worker.";

    const first = prepareHermesLocalExecutionConfig(
      { promptTemplate: original },
      { authToken: "paperclip-token" },
    );
    const second = prepareHermesLocalExecutionConfig(first, { authToken: "paperclip-token" });

    expect(String(first.promptTemplate)).toContain(original);
    expect(String(first.promptTemplate)).toContain("Paperclip issue workflow note:");
    expect(String(first.promptTemplate)).toContain("Paperclip structured response contract:");
    expect(String(second.promptTemplate).match(/Paperclip issue workflow note:/g)?.length ?? 0).toBe(1);
    expect(String(second.promptTemplate).match(/Paperclip structured response contract:/g)?.length ?? 0).toBe(1);
  });

  it("normalizes provider-prefixed zai models into the provider flag plus bare model name", () => {
    const config = prepareHermesLocalExecutionConfig(
      {
        model: "zai:glm-5",
      },
      { authToken: null },
    );

    expect(config).toMatchObject({
      provider: "zai",
      model: "glm-5",
      env: {
        OPENAI_BASE_URL: "https://api.z.ai/api/coding/paas/v4",
      },
    });
  });

  it("injects the Z.AI coding endpoint for zai providers when no explicit base url is configured", () => {
    const config = prepareHermesLocalExecutionConfig(
      {
        provider: "zai",
        model: "glm-5",
      },
      { authToken: null },
    );

    expect(config.env).toMatchObject({
      OPENAI_BASE_URL: "https://api.z.ai/api/coding/paas/v4",
      TERMINAL_ENV: "local",
    });
  });

  it("routes Nous API-key configs through Hermes custom endpoint mode", () => {
    const config = prepareHermesLocalExecutionConfig(
      {
        provider: "nous",
        model: "Hermes-4-70B",
        extraArgs: ["--provider", "nous", "--reasoning-effort", "high"],
        env: {
          NOUS_API_KEY: "nous-secret",
        },
      },
      { authToken: null },
    );

    expect(config).toMatchObject({
      provider: "custom",
      extraArgs: ["--reasoning-effort", "high"],
      env: {
        NOUS_API_KEY: "nous-secret",
        OPENAI_API_KEY: "nous-secret",
        OPENAI_BASE_URL: "https://inference-api.nousresearch.com/v1",
        HERMES_INFERENCE_PROVIDER: "custom",
        TERMINAL_ENV: "local",
      },
    });
  });

  it("does not overwrite an explicit OPENAI_BASE_URL for zai providers", () => {
    const config = prepareHermesLocalExecutionConfig(
      {
        provider: "zai",
        model: "glm-5",
        env: {
          OPENAI_BASE_URL: "https://example.test/custom-base",
        },
      },
      { authToken: null },
    );

    expect(config.env).toMatchObject({
      OPENAI_BASE_URL: "https://example.test/custom-base",
      TERMINAL_ENV: "local",
    });
  });

  it("forces Hermes terminal access to the host by default so localhost Paperclip APIs remain reachable", () => {
    const config = prepareHermesLocalExecutionConfig(
      {
        model: "glm-5",
      },
      { authToken: null },
    );

    expect(config.env).toMatchObject({
      TERMINAL_ENV: "local",
    });
  });

  it("does not overwrite an explicit TERMINAL_ENV override", () => {
    const config = prepareHermesLocalExecutionConfig(
      {
        env: {
          TERMINAL_ENV: "docker",
        },
      },
      { authToken: null },
    );

    expect(config.env).toMatchObject({
      TERMINAL_ENV: "docker",
    });
  });

  it("exposes resolved adapter env vars to Hermes environment diagnostics", async () => {
    delete process.env.ZAI_API_KEY;

    await withHermesLocalProcessEnv(
      {
        env: {
          ZAI_API_KEY: "zai-secret",
        },
      },
      async () => {
        expect(process.env.ZAI_API_KEY).toBe("zai-secret");
      },
    );

    expect(process.env.ZAI_API_KEY).toBeUndefined();
  });

  it("reclassifies the generic missing-key warning when zai credentials are configured", () => {
    const result = finalizeHermesLocalEnvironmentTestResult(
      {
        provider: "zai",
        env: {
          ZAI_API_KEY: "zai-secret",
        },
      },
      {
        adapterType: "hermes_local",
        status: "warn",
        testedAt: "2026-03-25T00:00:00.000Z",
        checks: [
          {
            code: "hermes_model_configured",
            level: "info",
            message: "Model: glm-5",
          },
          {
            code: "hermes_no_api_keys",
            level: "warn",
            message: "No LLM API keys found in environment",
          },
        ],
      },
    );

    expect(result.status).toBe("pass");
    expect(result.checks.some((check) => check.code === "hermes_no_api_keys")).toBe(false);
    expect(result.checks).toContainEqual({
      code: "hermes_api_keys_found",
      level: "info",
      message: "API keys found: Z.AI (ZAI_API_KEY)",
    });
  });

  it("reclassifies the generic missing-key warning when Nous credentials are configured", () => {
    const result = finalizeHermesLocalEnvironmentTestResult(
      {
        provider: "custom",
        env: {
          NOUS_API_KEY: "nous-secret",
          OPENAI_BASE_URL: "https://inference-api.nousresearch.com/v1",
          HERMES_INFERENCE_PROVIDER: "custom",
        },
      },
      {
        adapterType: "hermes_local",
        status: "warn",
        testedAt: "2026-03-25T00:00:00.000Z",
        checks: [
          {
            code: "hermes_model_configured",
            level: "info",
            message: "Model: Hermes-4-70B",
          },
          {
            code: "hermes_no_api_keys",
            level: "warn",
            message: "No LLM API keys found in environment",
          },
        ],
      },
    );

    expect(result.status).toBe("pass");
    expect(result.checks.some((check) => check.code === "hermes_no_api_keys")).toBe(false);
    expect(result.checks).toContainEqual({
      code: "hermes_api_keys_found",
      level: "info",
      message: "API keys found: Nous Research (NOUS_API_KEY)",
    });
  });

  it("rewrites generic OpenAI key detection to Nous Research when Nous credentials are configured", () => {
    const result = finalizeHermesLocalEnvironmentTestResult(
      {
        provider: "custom",
        env: {
          NOUS_API_KEY: "nous-secret",
          OPENAI_BASE_URL: "https://inference-api.nousresearch.com/v1",
          HERMES_INFERENCE_PROVIDER: "custom",
        },
      },
      {
        adapterType: "hermes_local",
        status: "pass",
        testedAt: "2026-03-25T00:00:00.000Z",
        checks: [
          {
            code: "hermes_model_configured",
            level: "info",
            message: "Model: Hermes-4-70B",
          },
          {
            code: "hermes_api_keys_found",
            level: "info",
            message: "API keys found: OpenAI",
          },
        ],
      },
    );

    expect(result.status).toBe("pass");
    expect(result.checks).toContainEqual({
      code: "hermes_api_keys_found",
      level: "info",
      message: "API keys found: Nous Research (NOUS_API_KEY)",
    });
  });

  it("keeps the missing-key warning for providers without a recognized configured credential", () => {
    const result = finalizeHermesLocalEnvironmentTestResult(
      {
        provider: "openrouter",
        env: {},
      },
      {
        adapterType: "hermes_local",
        status: "warn",
        testedAt: "2026-03-25T00:00:00.000Z",
        checks: [
          {
            code: "hermes_no_api_keys",
            level: "warn",
            message: "No LLM API keys found in environment",
          },
        ],
      },
    );

    expect(result.status).toBe("warn");
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]?.code).toBe("hermes_no_api_keys");
  });
});

describe("normalizeHermesLocalExecutionSummary", () => {
  it("drops tool-call-only transcript output and marks it as anomalous", () => {
    const result = normalizeHermesLocalExecutionSummary([
      "╭─ ⚕ Hermes ───────────────────────────────────────────────────────────────────╮",
      "<tool_call>",
      "{\"name\": \"terminal\", \"arguments\": {\"command\": \"curl -s \\\"http://127.0.0.1:3100/api/issues\\\"\"}}",
      "<tool_call>",
      "{\"name\": \"terminal\", \"arguments\": {\"command\": \"curl -s \\\"http://127.0.0.1:3100/api/issues\\\"\"}}",
      "</tool_call>",
    ].join("\n"));

    expect(result).toEqual({
      summary: null,
      anomalyMessage: "Hermes returned tool-call transcript output without a final assistant completion.",
    });
  });

  it("preserves a final JSON payload that follows tool-call transcript output", () => {
    const structured = JSON.stringify({
      status: "done",
      comment_markdown: "Implemented the runtime bootstrap fix.",
      plan_markdown: "",
      change_summary: "",
    });

    const result = normalizeHermesLocalExecutionSummary([
      "╭─ ⚕ Hermes ───────────────────────────────────────────────────────────────────╮",
      "<tool_call>",
      "{\"name\": \"terminal\", \"arguments\": {\"command\": \"pwd\"}}",
      "</tool_call>",
      structured,
    ].join("\n"));

    expect(result).toEqual({
      summary: structured,
      anomalyMessage: null,
    });
  });
});
