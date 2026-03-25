import { describe, expect, it } from "vitest";
import { buildHermesLocalPresetValues } from "./hermes-preset";

describe("buildHermesLocalPresetValues", () => {
  it("builds a native hermes_local preset with Paperclip defaults and secret refs", () => {
    const values = buildHermesLocalPresetValues([
      {
        id: "secret-1",
        companyId: "company-1",
        name: "zai_api_key",
        provider: "local_encrypted",
        externalRef: null,
        description: null,
        createdByAgentId: null,
        createdByUserId: null,
        latestVersion: 2,
        createdAt: new Date("2026-03-23T00:00:00.000Z"),
        updatedAt: new Date("2026-03-23T00:00:00.000Z"),
      },
    ], {
      agentDefaultHermesToolsets: "full,edit",
      agentDefaultHermesAllowedMcpServers: "github,filesystem",
      agentDefaultHermesMcpServers: {
        github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
      },
    });

    expect(values).toMatchObject({
      adapterType: "hermes_local",
      model: "glm-4.7",
      command: "hermes",
      hermesManagedHome: true,
      hermesSeedCompanyProfileMemory: true,
      extraArgs: "--provider zai",
      heartbeatEnabled: true,
      intervalSec: 300,
      hermesToolsets: "full,edit",
      hermesAllowedMcpServers: "github,filesystem",
      envBindings: {
        ZAI_API_KEY: { type: "secret_ref", secretId: "secret-1", version: "latest" },
      },
    });
    expect(values.mcpServersJson).toBe(JSON.stringify({
      github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
    }, null, 2));
  });
});
