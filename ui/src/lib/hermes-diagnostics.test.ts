import { describe, expect, it } from "vitest";
import { buildHermesDiagnosticsSummary } from "./hermes-diagnostics";

function makeHermesAgent() {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    companyId: "company-1",
    name: "Hermes",
    urlKey: "hermes",
    role: "engineer",
    title: null,
    icon: null,
    status: "active",
    reportsTo: null,
    capabilities: null,
    adapterType: "hermes_local",
    adapterConfig: {},
    runtimeConfig: {},
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    pauseReason: null,
    pausedAt: null,
    permissions: { canCreateAgents: false },
    lastHeartbeatAt: null,
    metadata: null,
    createdAt: new Date("2026-03-23T00:00:00Z"),
    updatedAt: new Date("2026-03-23T00:00:00Z"),
  } as const;
}

describe("buildHermesDiagnosticsSummary", () => {
  it("returns null for non-Hermes agents", () => {
    expect(buildHermesDiagnosticsSummary({
      agent: {
        ...makeHermesAgent(),
        adapterType: "claude_local",
      },
    })).toBeNull();
  });

  it("shows the managed Hermes home label when Paperclip owns the runtime home", () => {
    const summary = buildHermesDiagnosticsSummary({
      agent: {
        ...makeHermesAgent(),
        adapterConfig: {
          paperclipManagedHermesHome: true,
        },
      },
    });

    expect(summary?.hermesHome).toBe("Paperclip-managed per-agent Hermes home");
    expect(summary?.managedHome).toBe(true);
    expect(summary?.companyProfileMemorySeeded).toBe(false);
  });

  it("derives Hermes home, session ids, and conflict summary", () => {
    const summary = buildHermesDiagnosticsSummary({
      agent: {
        ...makeHermesAgent(),
        adapterConfig: {
          env: {
            HOME: "/Users/demo",
          },
          paperclipSeedCompanyProfileMemory: true,
        },
      },
      runtimeState: {
        agentId: "11111111-1111-4111-8111-111111111111",
        companyId: "company-1",
        adapterType: "hermes_local",
        sessionId: "session-123",
        sessionDisplayId: "paperclip::agent::ROM-44",
        sessionParamsJson: { sessionName: "paperclip::agent::ROM-44" },
        stateJson: {
          hermesAppliedRuntimePolicy: {
            hermesHome: "/Users/demo/.hermes",
            managedHome: false,
            companyProfileMemorySeeded: true,
            toolsets: ["skills"],
            configuredMcpServerNames: ["filesystem", "github"],
            allowedMcpServerNames: ["github"],
            materializedMcpServerNames: ["github"],
            seededContextFiles: ["SOUL.md", "AGENTS.md", "USER.md", "MEMORY.md"],
          },
        },
        lastRunId: null,
        lastRunStatus: null,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCachedInputTokens: 0,
        totalCostCents: 0,
        lastError: null,
        createdAt: new Date("2026-03-23T00:00:00Z"),
        updatedAt: new Date("2026-03-23T00:00:00Z"),
      },
      taskSessions: [
        {
          id: "task-1",
          companyId: "company-1",
          agentId: "11111111-1111-4111-8111-111111111111",
          adapterType: "hermes_local",
          taskKey: "issue:ROM-44",
          sessionParamsJson: {},
          sessionDisplayId: "paperclip::agent::ROM-44",
          lastRunId: null,
          lastError: null,
          createdAt: new Date("2026-03-23T00:00:00Z"),
          updatedAt: new Date("2026-03-23T00:00:00Z"),
        },
      ],
      skillSnapshot: {
        adapterType: "hermes_local",
        supported: true,
        mode: "persistent",
        desiredSkills: ["company/company-1/story-weaver"],
        warnings: [],
        entries: [
          {
            key: "company/company-1/story-weaver",
            runtimeName: "story-weaver",
            desired: true,
            managed: false,
            state: "external",
            origin: "company_managed",
            externalConflictKind: "imported_source",
            externalConflictPath: "/Users/demo/.hermes/skills/story-weaver",
          },
        ],
      },
      companySkills: [
        {
          id: "skill-1",
          companyId: "company-1",
          key: "company/company-1/story-weaver",
          slug: "story-weaver",
          name: "Story Weaver",
          description: null,
          sourceType: "local_path",
          sourceLocator: "/Users/demo/Paperclip/managed/story-weaver",
          sourceRef: null,
          trustLevel: "markdown_only",
          compatibility: "compatible",
          fileInventory: [],
          attachedAgentCount: 0,
          editable: true,
          editableReason: null,
          sourceLabel: "Local path",
          sourceBadge: "local",
          sourcePath: "/Users/demo/Paperclip/managed/story-weaver",
          importedFromSourcePath: "/Users/demo/.hermes/skills/story-weaver",
          createdAt: new Date("2026-03-23T00:00:00Z"),
          updatedAt: new Date("2026-03-23T00:00:00Z"),
        },
      ],
    });

    expect(summary).toEqual({
      hermesHome: "/Users/demo/.hermes",
      managedHome: false,
      companyProfileMemorySeeded: true,
      runtimeConfigDrift: false,
      runtimeConfigDriftReason: null,
      lastAppliedRuntimePolicy: {
        hermesHome: "/Users/demo/.hermes",
        managedHome: false,
        companyProfileMemorySeeded: true,
        toolsets: ["skills"],
        configuredMcpServerNames: ["filesystem", "github"],
        allowedMcpServerNames: ["github"],
        materializedMcpServerNames: ["github"],
        seededContextFiles: ["SOUL.md", "AGENTS.md", "USER.md", "MEMORY.md"],
      },
      activeSessionDisplayId: "paperclip::agent::ROM-44",
      activeSessionId: "session-123",
      toolsets: [],
      configuredMcpServerCount: 0,
      allowedMcpServerNames: [],
      taskSessionCount: 1,
      taskSessionDisplayIds: ["paperclip::agent::ROM-44"],
      continuityDrift: false,
      recentTaskSessions: [
        {
          id: "task-1",
          taskKey: "issue:ROM-44",
          sessionLabel: "paperclip::agent::ROM-44",
          createdAt: new Date("2026-03-23T00:00:00Z"),
          updatedAt: new Date("2026-03-23T00:00:00Z"),
          lastRunId: null,
          lastError: null,
          isActive: true,
        },
      ],
      desiredManagedSkillCount: 1,
      importedSourceConflictRuntimeNames: ["story-weaver"],
      importedSourceConflicts: [
        {
          key: "company/company-1/story-weaver",
          runtimeName: "story-weaver",
          externalConflictPath: "/Users/demo/.hermes/skills/story-weaver",
          companySkillId: "skill-1",
          companySkillName: "Story Weaver",
        },
      ],
    });
  });

  it("sorts recent task sessions and flags continuity drift when the active session is not persisted", () => {
    const summary = buildHermesDiagnosticsSummary({
      agent: makeHermesAgent(),
      runtimeState: {
        agentId: "11111111-1111-4111-8111-111111111111",
        companyId: "company-1",
        adapterType: "hermes_local",
        sessionId: "session-999",
        sessionDisplayId: "paperclip::agent::ROM-999",
        sessionParamsJson: null,
        stateJson: {},
        lastRunId: null,
        lastRunStatus: null,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCachedInputTokens: 0,
        totalCostCents: 0,
        lastError: null,
        createdAt: new Date("2026-03-23T00:00:00Z"),
        updatedAt: new Date("2026-03-23T00:00:00Z"),
      },
      taskSessions: [
        {
          id: "older",
          companyId: "company-1",
          agentId: "11111111-1111-4111-8111-111111111111",
          adapterType: "hermes_local",
          taskKey: "issue:ROM-44",
          sessionParamsJson: {},
          sessionDisplayId: "paperclip::agent::ROM-44",
          lastRunId: "run-1",
          lastError: null,
          createdAt: new Date("2026-03-22T00:00:00Z"),
          updatedAt: new Date("2026-03-22T01:00:00Z"),
        },
        {
          id: "newer",
          companyId: "company-1",
          agentId: "11111111-1111-4111-8111-111111111111",
          adapterType: "hermes_local",
          taskKey: "issue:ROM-45",
          sessionParamsJson: {},
          sessionDisplayId: "paperclip::agent::ROM-45",
          lastRunId: "run-2",
          lastError: "session stale",
          createdAt: new Date("2026-03-23T00:00:00Z"),
          updatedAt: new Date("2026-03-23T01:00:00Z"),
        },
      ],
    });

    expect(summary?.continuityDrift).toBe(true);
    expect(summary?.lastAppliedRuntimePolicy).toBeNull();
    expect(summary?.recentTaskSessions.map((entry) => entry.id)).toEqual(["newer", "older"]);
    expect(summary?.recentTaskSessions[0]).toMatchObject({
      sessionLabel: "paperclip::agent::ROM-45",
      lastError: "session stale",
      isActive: false,
    });
  });

  it("flags runtime config drift when the saved agent config is newer than the active Hermes runtime", () => {
    const summary = buildHermesDiagnosticsSummary({
      agent: {
        ...makeHermesAgent(),
        updatedAt: new Date("2026-03-23T02:00:00Z"),
        adapterConfig: {
          paperclipManagedHermesHome: true,
        },
      },
      runtimeState: {
        agentId: "11111111-1111-4111-8111-111111111111",
        companyId: "company-1",
        adapterType: "hermes_local",
        sessionId: "session-123",
        sessionDisplayId: "paperclip::agent::ROM-44",
        sessionParamsJson: null,
        stateJson: {},
        lastRunId: null,
        lastRunStatus: null,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCachedInputTokens: 0,
        totalCostCents: 0,
        lastError: null,
        createdAt: new Date("2026-03-23T00:00:00Z"),
        updatedAt: new Date("2026-03-23T01:00:00Z"),
      },
    });

    expect(summary?.runtimeConfigDrift).toBe(true);
    expect(summary?.runtimeConfigDriftReason).toContain("saved Hermes agent configuration was updated");
  });

  it("summarizes Hermes toolsets and MCP governance", () => {
    const summary = buildHermesDiagnosticsSummary({
      agent: {
        ...makeHermesAgent(),
        adapterConfig: {
          toolsets: "skills,browser",
          mcpServers: {
            github: { command: "npx" },
            filesystem: { command: "npx" },
          },
          allowedMcpServerNames: ["github"],
        },
      },
    });

    expect(summary?.toolsets).toEqual(["skills", "browser"]);
    expect(summary?.configuredMcpServerCount).toBe(2);
    expect(summary?.allowedMcpServerNames).toEqual(["github"]);
    expect(summary?.managedHome).toBe(false);
    expect(summary?.companyProfileMemorySeeded).toBe(false);
  });
});
