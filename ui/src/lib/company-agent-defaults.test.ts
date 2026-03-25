import { describe, expect, it } from "vitest";
import type { CreateConfigValues } from "@paperclipai/adapter-utils";
import { defaultCreateValues } from "../components/agent-config-defaults";
import {
  applyCompanyAgentDefaults,
  applyCompanyHeartbeatDefaults,
  resolveCompanyDefaultAgentAdapterType,
} from "./company-agent-defaults";

function makeValues(overrides: Partial<CreateConfigValues> = {}): CreateConfigValues {
  return {
    ...defaultCreateValues,
    adapterType: "hermes_local",
    command: "hermes",
    model: "anthropic/claude-sonnet-4",
    ...overrides,
  };
}

describe("company-agent-defaults", () => {
  it("resolves the company default adapter type when present", () => {
    expect(resolveCompanyDefaultAgentAdapterType({
      agentDefaultAdapterType: "hermes_local",
    })).toBe("hermes_local");
    expect(resolveCompanyDefaultAgentAdapterType(null)).toBe("claude_local");
  });

  it("applies company defaults to Hermes values and rewrites the provider arg", () => {
    const next = applyCompanyAgentDefaults(
      makeValues({
        extraArgs: "--provider anthropic --foo bar",
      }),
      {
        agentDefaultProvider: "zai",
        agentDefaultModel: "glm-4.7",
        agentDefaultHeartbeatIntervalSec: 600,
        agentDefaultBrowserAutomationProvider: "playwright",
        agentDefaultHermesManagedHome: true,
        agentDefaultHermesSeedCompanyProfileMemory: true,
        agentDefaultMaxTurnsPerRun: 500,
        agentDefaultHermesToolsets: "full,edit",
        agentDefaultHermesAllowedMcpServers: "github,filesystem",
        agentDefaultHermesMcpServers: {
          github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
        },
        agentDefaultDangerouslySkipPermissions: true,
      },
    );

    expect(next).toMatchObject({
      model: "glm-4.7",
      intervalSec: 600,
      browserAutomationProvider: "playwright",
      maxTurnsPerRun: 500,
      hermesManagedHome: true,
      hermesSeedCompanyProfileMemory: true,
      hermesToolsets: "full,edit",
      hermesAllowedMcpServers: "github,filesystem",
      dangerouslySkipPermissions: true,
      extraArgs: "--provider zai --foo bar",
    });
    expect(next.mcpServersJson).toBe(JSON.stringify({
      github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
    }, null, 2));
  });

  it("does not inject a Hermes provider arg for non-Hermes adapters", () => {
    const next = applyCompanyAgentDefaults(
      makeValues({
        adapterType: "claude_local",
        extraArgs: "--allowedTools Edit",
      }),
      {
        agentDefaultProvider: "zai",
        agentDefaultModel: "claude-sonnet-4",
        agentDefaultDangerouslySkipPermissions: false,
      },
    );

    expect(next).toMatchObject({
      adapterType: "claude_local",
      model: "claude-sonnet-4",
      dangerouslySkipPermissions: false,
      extraArgs: "--allowedTools Edit",
    });
  });

  it("applies company heartbeat defaults to new-agent runtime policy", () => {
    expect(
      applyCompanyHeartbeatDefaults(
        {
          enabled: true,
          intervalSec: 300,
          wakeOnDemand: true,
          cooldownSec: 10,
          maxConcurrentRuns: 1,
        },
        {
          agentDefaultHeartbeatIntervalSec: 900,
          agentDefaultWakeOnDemand: false,
          agentDefaultCooldownSec: 45,
          agentDefaultMaxConcurrentRuns: 2,
        },
      ),
    ).toEqual({
      enabled: true,
      intervalSec: 900,
      wakeOnDemand: false,
      cooldownSec: 45,
      maxConcurrentRuns: 2,
    });
  });
});
