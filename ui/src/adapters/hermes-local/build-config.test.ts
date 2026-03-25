import { describe, expect, it } from "vitest";
import { buildHermesLocalConfig } from "./build-config";
import { defaultCreateValues } from "../../components/agent-config-defaults";

describe("buildHermesLocalConfig", () => {
  it("preserves env bindings for Hermes local agents", () => {
    const config = buildHermesLocalConfig({
      ...defaultCreateValues,
      adapterType: "hermes_local",
      model: "glm-4.7",
      command: "hermes",
      extraArgs: "--provider zai",
      envBindings: {
        ZAI_API_KEY: { type: "secret_ref", secretId: "secret-1", version: "latest" },
      },
    });

    expect(config).toMatchObject({
      model: "glm-4.7",
      hermesCommand: "hermes",
      extraArgs: ["--provider", "zai"],
      env: {
        ZAI_API_KEY: { type: "secret_ref", secretId: "secret-1", version: "latest" },
      },
    });
  });

  it("merges legacy env text into Hermes env when explicit bindings are absent", () => {
    const config = buildHermesLocalConfig({
      ...defaultCreateValues,
      adapterType: "hermes_local",
      envVars: "FOO=bar\n# comment\nINVALID KEY=nope",
    });

    expect(config).toMatchObject({
      env: {
        FOO: { type: "plain", value: "bar" },
      },
    });
  });

  it("stores managed MCP servers for Hermes config materialization", () => {
    const config = buildHermesLocalConfig({
      ...defaultCreateValues,
      adapterType: "hermes_local",
      hermesToolsets: "skills, browser",
      hermesAllowedMcpServers: "github, filesystem",
      mcpServersJson: JSON.stringify({
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
        },
      }),
    });

    expect(config).toMatchObject({
      paperclipManagedHermesHome: true,
      toolsets: "skills,browser",
      allowedMcpServerNames: ["github", "filesystem"],
      mcpServers: {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
        },
      },
    });
  });

  it("can request a Paperclip-managed Hermes home without MCP servers", () => {
    const config = buildHermesLocalConfig({
      ...defaultCreateValues,
      adapterType: "hermes_local",
      hermesManagedHome: true,
    });

    expect(config).toMatchObject({
      paperclipManagedHermesHome: true,
    });
    expect(config).not.toHaveProperty("mcpServers");
  });

  it("enables managed Hermes home when company-profile memory seeding is requested", () => {
    const config = buildHermesLocalConfig({
      ...defaultCreateValues,
      adapterType: "hermes_local",
      hermesSeedCompanyProfileMemory: true,
    });

    expect(config).toMatchObject({
      paperclipManagedHermesHome: true,
      paperclipSeedCompanyProfileMemory: true,
    });
  });
});
