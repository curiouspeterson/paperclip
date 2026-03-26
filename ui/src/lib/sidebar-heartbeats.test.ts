import { describe, expect, it } from "vitest";
import type { Agent } from "@paperclipai/shared";
import type { HeartbeatInvokeResult } from "../api/agents";
import {
  formatBulkHeartbeatToast,
  selectAgentsForBoo,
  selectAgentsForBulkHeartbeat,
  summarizeBulkHeartbeatResults,
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
    makeAgent("error-agent", "error"),
    makeAgent("paused-agent", "paused"),
    makeAgent("pending-agent", "pending_approval"),
    makeAgent("terminated-agent", "terminated"),
  ];

  it("targets only eligible non-paused agents for all hands heartbeat", () => {
    expect(selectAgentsForBulkHeartbeat(agents).map((agent) => agent.id)).toEqual([
      "active-agent",
      "idle-agent",
      "running-agent",
      "error-agent",
    ]);
  });

  it("targets all non-terminated and non-pending agents for BOO", () => {
    expect(selectAgentsForBoo(agents).map((agent) => agent.id)).toEqual([
      "active-agent",
      "idle-agent",
      "running-agent",
      "error-agent",
      "paused-agent",
    ]);
  });

  it("counts started, skipped, and failed results separately", () => {
    const results = summarizeBulkHeartbeatResults([
      {
        status: "fulfilled",
        value: { id: "run-1", status: "queued" } as HeartbeatInvokeResult,
      },
      {
        status: "fulfilled",
        value: { status: "skipped" } as HeartbeatInvokeResult,
      },
      {
        status: "rejected",
        reason: new Error("network"),
      },
    ]);

    expect(results).toEqual({
      startedCount: 1,
      skippedCount: 1,
      failedCount: 1,
    });
  });

  it("formats a clean success toast for zero failures and skips", () => {
    expect(
      formatBulkHeartbeatToast("all-hands", {
        startedCount: 3,
        skippedCount: 0,
        failedCount: 0,
      }),
    ).toEqual({
      title: "All Hands Heartbeat started",
      body: "Started 3 heartbeats.",
      tone: "success",
    });
  });

  it("formats a warning toast when some invokes are skipped or fail", () => {
    expect(
      formatBulkHeartbeatToast("boo", {
        startedCount: 2,
        skippedCount: 1,
        failedCount: 2,
      }),
    ).toEqual({
      title: "BOO! started",
      body: "Started 2 heartbeats. 1 skipped. 2 failed.",
      tone: "warn",
    });
  });
});
