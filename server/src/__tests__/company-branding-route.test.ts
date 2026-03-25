import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { companyRoutes } from "../routes/companies.js";
import { errorHandler } from "../middleware/index.js";

const mockCompanyService = vi.hoisted(() => ({
  list: vi.fn(),
  stats: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  pauseAll: vi.fn(),
  resumeAll: vi.fn(),
  archive: vi.fn(),
  remove: vi.fn(),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  ensureMembership: vi.fn(),
}));

const mockBudgetService = vi.hoisted(() => ({
  upsertPolicy: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  cancelActiveForAgent: vi.fn(),
  resetRuntimeSession: vi.fn(),
}));

const mockCompanyPortabilityService = vi.hoisted(() => ({
  exportBundle: vi.fn(),
  previewExport: vi.fn(),
  previewImport: vi.fn(),
  importBundle: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  agentService: () => mockAgentService,
  budgetService: () => mockBudgetService,
  companyPortabilityService: () => mockCompanyPortabilityService,
  companyService: () => mockCompanyService,
  heartbeatService: () => mockHeartbeatService,
  logActivity: mockLogActivity,
}));

function createCompany() {
  const now = new Date("2026-03-19T02:00:00.000Z");
  return {
    id: "company-1",
    name: "Paperclip",
    description: null,
    status: "active",
    issuePrefix: "PAP",
    issueCounter: 568,
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    requireBoardApprovalForNewAgents: false,
    brandColor: "#123456",
    voiceDescription: null,
    targetAudience: null,
    defaultChannel: null,
    defaultGoal: null,
    voiceExamplesRight: [],
    voiceExamplesWrong: [],
    mailchimpDefaultListId: null,
    mailchimpDefaultTemplateId: null,
    mailchimpDefaultFromName: null,
    mailchimpDefaultReplyTo: null,
    agentDefaultAdapterType: null,
    agentDefaultProvider: null,
    agentDefaultModel: null,
    agentDefaultHeartbeatIntervalSec: null,
    agentDefaultWakeOnDemand: null,
    agentDefaultCooldownSec: null,
    agentDefaultMaxConcurrentRuns: null,
    agentDefaultMaxTurnsPerRun: null,
    agentDefaultBrowserAutomationProvider: null,
    agentDefaultHermesManagedHome: null,
    agentDefaultHermesSeedCompanyProfileMemory: null,
    agentDefaultHermesToolsets: null,
    agentDefaultHermesAllowedMcpServers: null,
    agentDefaultHermesMcpServers: null,
    agentDefaultDangerouslySkipPermissions: null,
    agentDefaultDangerouslyBypassSandbox: null,
    logoAssetId: "11111111-1111-4111-8111-111111111111",
    logoUrl: "/api/assets/11111111-1111-4111-8111-111111111111/content",
    createdAt: now,
    updatedAt: now,
  };
}

function createApp(actor: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api/companies", companyRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe("PATCH /api/companies/:companyId/branding", () => {
  beforeEach(() => {
    mockCompanyService.update.mockReset();
    mockCompanyService.pauseAll.mockReset();
    mockCompanyService.resumeAll.mockReset();
    mockAgentService.getById.mockReset();
    mockAgentService.list.mockReset();
    mockAgentService.update.mockReset();
    mockHeartbeatService.cancelActiveForAgent.mockReset();
    mockHeartbeatService.resetRuntimeSession.mockReset();
    mockLogActivity.mockReset();
  });

  it("rejects non-CEO agent callers", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      companyId: "company-1",
      role: "engineer",
    });
    const app = createApp({
      type: "agent",
      agentId: "agent-1",
      companyId: "company-1",
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .patch("/api/companies/company-1/branding")
      .send({ logoAssetId: "11111111-1111-4111-8111-111111111111" });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Only CEO agents");
    expect(mockCompanyService.update).not.toHaveBeenCalled();
  });

  it("allows CEO agent callers to update branding fields", async () => {
    const company = createCompany();
    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      companyId: "company-1",
      role: "ceo",
    });
    mockCompanyService.update.mockResolvedValue(company);
    const app = createApp({
      type: "agent",
      agentId: "agent-1",
      companyId: "company-1",
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .patch("/api/companies/company-1/branding")
      .send({
        logoAssetId: "11111111-1111-4111-8111-111111111111",
        brandColor: "#123456",
      });

    expect(res.status).toBe(200);
    expect(res.body.logoAssetId).toBe(company.logoAssetId);
    expect(mockCompanyService.update).toHaveBeenCalledWith("company-1", {
      logoAssetId: "11111111-1111-4111-8111-111111111111",
      brandColor: "#123456",
    });
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId: "company-1",
        actorType: "agent",
        actorId: "agent-1",
        agentId: "agent-1",
        runId: "run-1",
        action: "company.branding_updated",
        details: {
          logoAssetId: "11111111-1111-4111-8111-111111111111",
          brandColor: "#123456",
        },
      }),
    );
  });

  it("allows board callers to update branding fields", async () => {
    const company = createCompany();
    mockCompanyService.update.mockResolvedValue({
      ...company,
      brandColor: null,
      logoAssetId: null,
      logoUrl: null,
    });
    const app = createApp({
      type: "board",
      userId: "user-1",
      source: "local_implicit",
    });

    const res = await request(app)
      .patch("/api/companies/company-1/branding")
      .send({ brandColor: null, logoAssetId: null });

    expect(res.status).toBe(200);
    expect(res.body.brandColor).toBeNull();
    expect(res.body.logoAssetId).toBeNull();
  });

  it("allows board callers to update company agent defaults", async () => {
    const company = {
      ...createCompany(),
      agentDefaultAdapterType: "hermes_local",
      agentDefaultProvider: "zai",
      agentDefaultModel: "glm-4.7",
      agentDefaultHeartbeatIntervalSec: 300,
      agentDefaultWakeOnDemand: true,
      agentDefaultCooldownSec: 10,
      agentDefaultMaxConcurrentRuns: 1,
      agentDefaultMaxTurnsPerRun: 300,
      agentDefaultBrowserAutomationProvider: "playwright",
      agentDefaultHermesManagedHome: true,
      agentDefaultHermesSeedCompanyProfileMemory: true,
      agentDefaultHermesToolsets: "full,edit",
      agentDefaultHermesAllowedMcpServers: "github,filesystem",
      agentDefaultHermesMcpServers: {
        github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
      },
      agentDefaultDangerouslySkipPermissions: true,
      agentDefaultDangerouslyBypassSandbox: false,
    };
    mockCompanyService.update.mockResolvedValue(company);
    const app = createApp({
      type: "board",
      userId: "user-1",
      source: "local_implicit",
    });

    const res = await request(app)
      .patch("/api/companies/company-1")
      .send({
        agentDefaultAdapterType: "hermes_local",
        agentDefaultProvider: "zai",
        agentDefaultModel: "glm-4.7",
        agentDefaultHeartbeatIntervalSec: 300,
        agentDefaultWakeOnDemand: true,
        agentDefaultCooldownSec: 10,
        agentDefaultMaxConcurrentRuns: 1,
        agentDefaultMaxTurnsPerRun: 300,
        agentDefaultBrowserAutomationProvider: "playwright",
        agentDefaultHermesManagedHome: true,
        agentDefaultHermesSeedCompanyProfileMemory: true,
        agentDefaultHermesToolsets: "full,edit",
        agentDefaultHermesAllowedMcpServers: "github,filesystem",
        agentDefaultHermesMcpServers: {
          github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
        },
        agentDefaultDangerouslySkipPermissions: true,
        agentDefaultDangerouslyBypassSandbox: false,
      });

    expect(res.status).toBe(200);
    expect(mockCompanyService.update).toHaveBeenCalledWith("company-1", {
      agentDefaultAdapterType: "hermes_local",
      agentDefaultProvider: "zai",
      agentDefaultModel: "glm-4.7",
      agentDefaultHeartbeatIntervalSec: 300,
      agentDefaultWakeOnDemand: true,
      agentDefaultCooldownSec: 10,
      agentDefaultMaxConcurrentRuns: 1,
      agentDefaultMaxTurnsPerRun: 300,
      agentDefaultBrowserAutomationProvider: "playwright",
      agentDefaultHermesManagedHome: true,
      agentDefaultHermesSeedCompanyProfileMemory: true,
      agentDefaultHermesToolsets: "full,edit",
      agentDefaultHermesAllowedMcpServers: "github,filesystem",
      agentDefaultHermesMcpServers: {
        github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
      },
      agentDefaultDangerouslySkipPermissions: true,
      agentDefaultDangerouslyBypassSandbox: false,
    });
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId: "company-1",
        actorType: "user",
        actorId: "user-1",
        action: "company.updated",
        details: expect.objectContaining({
          agentDefaultAdapterType: "hermes_local",
          agentDefaultProvider: "zai",
          agentDefaultModel: "glm-4.7",
        }),
      }),
    );
  });

  it("rejects status updates on the generic company patch route", async () => {
    const app = createApp({
      type: "board",
      userId: "user-1",
      source: "local_implicit",
    });

    const res = await request(app)
      .patch("/api/companies/company-1")
      .send({ status: "paused" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation error");
    expect(mockCompanyService.update).not.toHaveBeenCalled();
  });

  it("applies the selected runtime defaults to all agents and resets their sessions", async () => {
    const company = {
      ...createCompany(),
      agentDefaultProvider: "zai",
      agentDefaultModel: "glm-5",
    };
    mockCompanyService.update.mockResolvedValue(company);
    mockAgentService.list.mockResolvedValue([
      {
        id: "agent-1",
        companyId: "company-1",
        name: "VP Technical",
        adapterConfig: { provider: "openrouter", model: "minimax/minimax-m2.7", toolsets: "full,edit" },
      },
      {
        id: "agent-2",
        companyId: "company-1",
        name: "VP Content Ops",
        adapterConfig: { model: "deepseek/deepseek-r1" },
      },
    ]);
    mockAgentService.update
      .mockResolvedValueOnce({
        id: "agent-1",
        companyId: "company-1",
        name: "VP Technical",
      })
      .mockResolvedValueOnce({
        id: "agent-2",
        companyId: "company-1",
        name: "VP Content Ops",
      });
    mockHeartbeatService.resetRuntimeSession.mockResolvedValue(null);
    const app = createApp({
      type: "board",
      userId: "user-1",
      source: "local_implicit",
    });

    const res = await request(app)
      .post("/api/companies/company-1/agents/apply-runtime-defaults")
      .send({
        provider: "zai",
        model: "glm-5",
      });

    expect(res.status).toBe(200);
    expect(res.body.affectedAgentCount).toBe(2);
    expect(res.body.resetSessionCount).toBe(2);
    expect(mockCompanyService.update).toHaveBeenCalledWith("company-1", {
      agentDefaultProvider: "zai",
      agentDefaultModel: "glm-5",
    });
    expect(mockAgentService.update).toHaveBeenNthCalledWith(1, "agent-1", {
      adapterConfig: {
        provider: "zai",
        model: "glm-5",
        toolsets: "full,edit",
      },
    });
    expect(mockAgentService.update).toHaveBeenNthCalledWith(2, "agent-2", {
      adapterConfig: {
        provider: "zai",
        model: "glm-5",
      },
    });
    expect(mockHeartbeatService.resetRuntimeSession).toHaveBeenCalledTimes(2);
    expect(mockHeartbeatService.resetRuntimeSession).toHaveBeenCalledWith("agent-1");
    expect(mockHeartbeatService.resetRuntimeSession).toHaveBeenCalledWith("agent-2");
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "company.updated",
        entityType: "company",
        entityId: "company-1",
        details: expect.objectContaining({
          source: "apply_runtime_defaults",
          agentDefaultProvider: "zai",
          agentDefaultModel: "glm-5",
          affectedAgentCount: 2,
          resetSessionCount: 2,
        }),
      }),
    );
  });

  it("rejects budget updates on the generic company patch route", async () => {
    const app = createApp({
      type: "board",
      userId: "user-1",
      source: "local_implicit",
    });

    const res = await request(app)
      .patch("/api/companies/company-1")
      .send({ budgetMonthlyCents: 2500 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation error");
    expect(mockCompanyService.update).not.toHaveBeenCalled();
  });

  it("rejects non-branding fields in the request body", async () => {
    const app = createApp({
      type: "board",
      userId: "user-1",
      source: "local_implicit",
    });

    const res = await request(app)
      .patch("/api/companies/company-1/branding")
      .send({
        logoAssetId: "11111111-1111-4111-8111-111111111111",
        status: "archived",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation error");
    expect(mockCompanyService.update).not.toHaveBeenCalled();
  });

  it("pauses the company and all resumable agents", async () => {
    const company = {
      ...createCompany(),
      status: "paused",
      pauseReason: "manual",
      pausedAt: new Date("2026-03-22T16:00:00.000Z"),
    };
    mockCompanyService.pauseAll.mockResolvedValue({
      company,
      affectedAgentIds: ["agent-1", "agent-2"],
    });
    const app = createApp({
      type: "board",
      userId: "user-1",
      source: "local_implicit",
    });

    const res = await request(app).post("/api/companies/company-1/pause").send({});

    expect(res.status).toBe(200);
    expect(res.body.company.status).toBe("paused");
    expect(res.body.affectedAgentCount).toBe(2);
    expect(mockHeartbeatService.cancelActiveForAgent).toHaveBeenCalledTimes(2);
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId: "company-1",
        actorType: "user",
        actorId: "user-1",
        action: "company.paused",
        entityType: "company",
        entityId: "company-1",
      }),
    );
  });

  it("resumes the company and all paused agents", async () => {
    const company = {
      ...createCompany(),
      status: "active",
      pauseReason: null,
      pausedAt: null,
    };
    mockCompanyService.resumeAll.mockResolvedValue({
      company,
      affectedAgentIds: ["agent-1"],
    });
    const app = createApp({
      type: "board",
      userId: "user-1",
      source: "local_implicit",
    });

    const res = await request(app).post("/api/companies/company-1/resume").send({});

    expect(res.status).toBe(200);
    expect(res.body.company.status).toBe("active");
    expect(res.body.affectedAgentCount).toBe(1);
    expect(mockHeartbeatService.cancelActiveForAgent).not.toHaveBeenCalled();
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId: "company-1",
        actorType: "user",
        actorId: "user-1",
        action: "company.resumed",
        entityType: "company",
        entityId: "company-1",
      }),
    );
  });
});
