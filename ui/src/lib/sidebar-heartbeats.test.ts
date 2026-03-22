import { describe, expect, it } from "vitest";
import type { Agent } from "@paperclipai/shared";
import {
  formatBulkHeartbeatToast,
  selectAgentsForBulkHeartbeat,
  selectAgentsForBoo,
} from "./sidebar-heartbeats";

function makeAgent(id: string, status: Agent["status"]): Agent {
  const now = new Date("2026-03-21T00:00:00.000Z");
  return {
    id,
    companyId: "company-1",
    name: id,
    urlKey: id,
    role: "general",
    title: null,
    icon: null,
    status,
    reportsTo: null,
    capabilities: null,
    adapterType: "process",
    adapterConfig: {},
    runtimeConfig: {},
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    pauseReason: status === "paused" ? "manual" : null,
    pausedAt: status === "paused" ? now : null,
    permissions: { canCreateAgents: false },
    lastHeartbeatAt: null,
    metadata: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("sidebar heartbeat helpers", () => {
  const agents = [
    makeAgent("active-agent", "active"),
    makeAgent("idle-agent", "idle"),
    makeAgent("running-agent", "running"),
    makeAgent("paused-agent", "paused"),
    makeAgent("terminated-agent", "terminated"),
  ];

  it("targets only eligible non-paused agents for all hands heartbeat", () => {
    expect(selectAgentsForBulkHeartbeat(agents).map((agent) => agent.id)).toEqual([
      "active-agent",
      "idle-agent",
      "running-agent",
    ]);
  });

  it("targets all non-terminated agents for BOO", () => {
    expect(selectAgentsForBoo(agents).map((agent) => agent.id)).toEqual([
      "active-agent",
      "idle-agent",
      "running-agent",
      "paused-agent",
    ]);
  });

  it("formats a clean success toast for zero failures", () => {
    expect(formatBulkHeartbeatToast("all-hands", 3, 0)).toEqual({
      title: "All Hands Heartbeat started",
      body: "Started 3 heartbeats.",
      tone: "success",
    });
  });

  it("formats a warning toast when some invokes fail", () => {
    expect(formatBulkHeartbeatToast("boo", 4, 2)).toEqual({
      title: "BOO! started",
      body: "Started 4 heartbeats. 2 failed.",
      tone: "warn",
    });
  });
});
