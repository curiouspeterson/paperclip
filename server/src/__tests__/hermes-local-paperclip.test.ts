import { describe, expect, it } from "vitest";
import {
  finalizeHermesLocalEnvironmentTestResult,
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
    expect(String(second.promptTemplate).match(/Paperclip issue workflow note:/g)?.length ?? 0).toBe(1);
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
