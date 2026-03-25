import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentRoutes } from "../routes/agents.js";
import { errorHandler } from "../middleware/index.js";

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  resolveByReference: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(),
  hasPermission: vi.fn(),
  getMembership: vi.fn(),
  listPrincipalGrants: vi.fn(),
  ensureMembership: vi.fn(),
  setPrincipalPermission: vi.fn(),
}));

const mockApprovalService = vi.hoisted(() => ({
  create: vi.fn(),
}));
const mockBudgetService = vi.hoisted(() => ({}));
const mockHeartbeatService = vi.hoisted(() => ({}));
const mockIssueApprovalService = vi.hoisted(() => ({
  linkManyForApproval: vi.fn(),
}));
const mockWorkspaceOperationService = vi.hoisted(() => ({}));
const mockAgentInstructionsService = vi.hoisted(() => ({
  getBundle: vi.fn(),
  readFile: vi.fn(),
  updateBundle: vi.fn(),
  writeFile: vi.fn(),
  deleteFile: vi.fn(),
  exportFiles: vi.fn(),
  ensureManagedBundle: vi.fn(),
  materializeManagedBundle: vi.fn(),
}));

const mockCompanySkillService = vi.hoisted(() => ({
  listRuntimeSkillEntries: vi.fn(),
  resolveRequestedSkillKeys: vi.fn(),
  getByKey: vi.fn(),
}));

const mockSecretService = vi.hoisted(() => ({
  resolveAdapterConfigForRuntime: vi.fn(),
  normalizeAdapterConfigForPersistence: vi.fn(async (_companyId: string, config: Record<string, unknown>) => config),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

const mockAdapter = vi.hoisted(() => ({
  listSkills: vi.fn(),
  syncSkills: vi.fn(),
}));

const mockReplaceHermesExternalSkill = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  agentService: () => mockAgentService,
  agentInstructionsService: () => mockAgentInstructionsService,
  accessService: () => mockAccessService,
  approvalService: () => mockApprovalService,
  companySkillService: () => mockCompanySkillService,
  budgetService: () => mockBudgetService,
  heartbeatService: () => mockHeartbeatService,
  issueApprovalService: () => mockIssueApprovalService,
  issueService: () => ({}),
  logActivity: mockLogActivity,
  secretService: () => mockSecretService,
  syncInstructionsBundleConfigFromFilePath: vi.fn((_agent, config) => config),
  workspaceOperationService: () => mockWorkspaceOperationService,
}));

vi.mock("../adapters/index.js", () => ({
  findServerAdapter: vi.fn(() => mockAdapter),
  listAdapterModels: vi.fn(),
}));

vi.mock("../adapters/hermes-local/skills.js", () => ({
  replaceHermesExternalSkill: mockReplaceHermesExternalSkill,
}));

function createDb(requireBoardApprovalForNewAgents = false) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => [
          {
            id: "company-1",
            requireBoardApprovalForNewAgents,
          },
        ]),
      })),
    })),
  };
}

function createApp(db: Record<string, unknown> = createDb()) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "local-board",
      companyIds: ["company-1"],
      source: "local_implicit",
      isInstanceAdmin: false,
    };
    next();
  });
  app.use("/api", agentRoutes(db as any));
  app.use(errorHandler);
  return app;
}

function makeAgent(adapterType: string) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    companyId: "company-1",
    name: "Agent",
    role: "engineer",
    title: "Engineer",
    status: "active",
    reportsTo: null,
    capabilities: null,
    adapterType,
    adapterConfig: {},
    runtimeConfig: {},
    permissions: null,
    updatedAt: new Date(),
  };
}

describe("agent skill routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentService.resolveByReference.mockResolvedValue({
      ambiguous: false,
      agent: makeAgent("claude_local"),
    });
    mockSecretService.resolveAdapterConfigForRuntime.mockResolvedValue({ config: { env: {} } });
    mockCompanySkillService.listRuntimeSkillEntries.mockResolvedValue([
      {
        key: "paperclipai/paperclip/paperclip",
        runtimeName: "paperclip",
        source: "/tmp/paperclip",
        required: true,
        requiredReason: "required",
      },
    ]);
    mockCompanySkillService.resolveRequestedSkillKeys.mockImplementation(
      async (_companyId: string, requested: string[]) =>
        requested.map((value) =>
          value === "paperclip"
            ? "paperclipai/paperclip/paperclip"
            : value,
        ),
    );
    mockCompanySkillService.getByKey.mockResolvedValue({
      id: "skill-1",
      companyId: "company-1",
      key: "company/company-1/story-weaver",
      slug: "story-weaver",
      name: "Story Weaver",
      description: null,
      markdown: "# Story Weaver",
      sourceType: "local_path",
      sourceLocator: "/tmp/paperclip/managed/story-weaver",
      sourceRef: null,
      trustLevel: "markdown_only",
      compatibility: "compatible",
      fileInventory: [],
      metadata: {
        importedFromSourceLocator: "/tmp/.hermes/skills/story-weaver",
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockAdapter.listSkills.mockResolvedValue({
      adapterType: "claude_local",
      supported: true,
      mode: "ephemeral",
      desiredSkills: ["paperclipai/paperclip/paperclip"],
      entries: [],
      warnings: [],
    });
    mockAdapter.syncSkills.mockResolvedValue({
      adapterType: "claude_local",
      supported: true,
      mode: "ephemeral",
      desiredSkills: ["paperclipai/paperclip/paperclip"],
      entries: [],
      warnings: [],
    });
    mockReplaceHermesExternalSkill.mockResolvedValue({
      adapterType: "hermes_local",
      supported: true,
      mode: "persistent",
      desiredSkills: ["paperclipai/paperclip/paperclip", "company/company-1/story-weaver"],
      entries: [],
      warnings: [],
    });
    mockAgentService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      ...makeAgent("claude_local"),
      adapterConfig: patch.adapterConfig ?? {},
    }));
    mockAgentService.create.mockImplementation(async (_companyId: string, input: Record<string, unknown>) => ({
      ...makeAgent(String(input.adapterType ?? "claude_local")),
      ...input,
      adapterConfig: input.adapterConfig ?? {},
      runtimeConfig: input.runtimeConfig ?? {},
      budgetMonthlyCents: Number(input.budgetMonthlyCents ?? 0),
      permissions: null,
    }));
    mockApprovalService.create.mockImplementation(async (_companyId: string, input: Record<string, unknown>) => ({
      id: "approval-1",
      companyId: "company-1",
      type: "hire_agent",
      status: "pending",
      payload: input.payload ?? {},
    }));
    mockAgentInstructionsService.materializeManagedBundle.mockImplementation(
      async (agent: Record<string, unknown>, files: Record<string, string>) => ({
        bundle: null,
        adapterConfig: {
          ...((agent.adapterConfig as Record<string, unknown> | undefined) ?? {}),
          instructionsBundleMode: "managed",
          instructionsRootPath: `/tmp/${String(agent.id)}/instructions`,
          instructionsEntryFile: "AGENTS.md",
          instructionsFilePath: `/tmp/${String(agent.id)}/instructions/AGENTS.md`,
          promptTemplate: files["AGENTS.md"] ?? "",
        },
      }),
    );
    mockLogActivity.mockResolvedValue(undefined);
    mockAccessService.canUser.mockResolvedValue(true);
    mockAccessService.hasPermission.mockResolvedValue(true);
    mockAccessService.getMembership.mockResolvedValue(null);
    mockAccessService.listPrincipalGrants.mockResolvedValue([]);
    mockAccessService.ensureMembership.mockResolvedValue(undefined);
    mockAccessService.setPrincipalPermission.mockResolvedValue(undefined);
  });

  it("skips runtime materialization when listing Claude skills", async () => {
    mockAgentService.getById.mockResolvedValue(makeAgent("claude_local"));

    const res = await request(createApp())
      .get("/api/agents/11111111-1111-4111-8111-111111111111/skills?companyId=company-1");

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockCompanySkillService.listRuntimeSkillEntries).toHaveBeenCalledWith("company-1", {
      materializeMissing: false,
    });
    expect(mockAdapter.listSkills).toHaveBeenCalledWith(
      expect.objectContaining({
        adapterType: "claude_local",
        config: expect.objectContaining({
          paperclipRuntimeSkills: expect.any(Array),
        }),
      }),
    );
  });

  it("keeps runtime materialization for persistent skill adapters", async () => {
    mockAgentService.getById.mockResolvedValue(makeAgent("codex_local"));
    mockAdapter.listSkills.mockResolvedValue({
      adapterType: "codex_local",
      supported: true,
      mode: "persistent",
      desiredSkills: ["paperclipai/paperclip/paperclip"],
      entries: [],
      warnings: [],
    });

    const res = await request(createApp())
      .get("/api/agents/11111111-1111-4111-8111-111111111111/skills?companyId=company-1");

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockCompanySkillService.listRuntimeSkillEntries).toHaveBeenCalledWith("company-1", {
      materializeMissing: true,
    });
  });

  it("skips runtime materialization when syncing Claude skills", async () => {
    mockAgentService.getById.mockResolvedValue(makeAgent("claude_local"));

    const res = await request(createApp())
      .post("/api/agents/11111111-1111-4111-8111-111111111111/skills/sync?companyId=company-1")
      .send({ desiredSkills: ["paperclipai/paperclip/paperclip"] });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockCompanySkillService.listRuntimeSkillEntries).toHaveBeenCalledWith("company-1", {
      materializeMissing: false,
    });
    expect(mockAdapter.syncSkills).toHaveBeenCalled();
  });

  it("canonicalizes desired skill references before syncing", async () => {
    mockAgentService.getById.mockResolvedValue(makeAgent("claude_local"));

    const res = await request(createApp())
      .post("/api/agents/11111111-1111-4111-8111-111111111111/skills/sync?companyId=company-1")
      .send({ desiredSkills: ["paperclip"] });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockCompanySkillService.resolveRequestedSkillKeys).toHaveBeenCalledWith("company-1", ["paperclip"]);
    expect(mockAgentService.update).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        adapterConfig: expect.objectContaining({
          paperclipSkillSync: expect.objectContaining({
            desiredSkills: ["paperclipai/paperclip/paperclip"],
          }),
        }),
      }),
      expect.any(Object),
    );
  });

  it("replaces an adopted Hermes external skill with the managed copy", async () => {
    mockAgentService.getById.mockResolvedValue(makeAgent("hermes_local"));
    mockAgentService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      ...makeAgent("hermes_local"),
      adapterType: "hermes_local",
      adapterConfig: patch.adapterConfig ?? {},
    }));

    const res = await request(createApp())
      .post("/api/agents/11111111-1111-4111-8111-111111111111/skills/replace-external?companyId=company-1")
      .send({
        desiredSkillKey: "company/company-1/story-weaver",
        runtimeName: "story-weaver",
      });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockCompanySkillService.getByKey).toHaveBeenCalledWith("company-1", "company/company-1/story-weaver");
    expect(mockReplaceHermesExternalSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        adapterType: "hermes_local",
        config: expect.objectContaining({
          paperclipRuntimeSkills: expect.any(Array),
          paperclipSkillSync: {
            desiredSkills: ["paperclipai/paperclip/paperclip", "company/company-1/story-weaver"],
          },
        }),
      }),
      {
        desiredSkillKey: "company/company-1/story-weaver",
        runtimeName: "story-weaver",
        expectedExternalSourcePath: "/tmp/.hermes/skills/story-weaver",
      },
    );
  });

  it("migrates a legacy Hermes worker process agent to hermes_local", async () => {
    mockAgentService.getById.mockResolvedValue({
      ...makeAgent("process"),
      name: "Hermes Worker",
      adapterType: "process",
      adapterConfig: {
        command: "python3",
        args: ["scripts/hermes_paperclip_worker.py"],
        browserAutomationProvider: "playwright",
        browserSessionProfile: "romance-unzipped",
        browserHeadless: true,
        env: {
          HERMES_PROVIDER: { type: "plain", value: "zai" },
          HERMES_MODEL: { type: "plain", value: "glm-4.7" },
          HERMES_BIN: { type: "plain", value: "/usr/local/bin/hermes" },
          ZAI_API_KEY: { type: "secret_ref", secretId: "secret-1", version: "latest" },
        },
      },
    });
    mockAgentService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      ...makeAgent("hermes_local"),
      adapterType: String(patch.adapterType ?? "hermes_local"),
      adapterConfig: patch.adapterConfig ?? {},
    }));

    const res = await request(createApp())
      .post("/api/agents/11111111-1111-4111-8111-111111111111/migrate-hermes-worker?companyId=company-1")
      .send({});

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockAgentService.update).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      expect.objectContaining({
        adapterType: "hermes_local",
        adapterConfig: expect.objectContaining({
          model: "glm-4.7",
          provider: "zai",
          hermesCommand: "/usr/local/bin/hermes",
          paperclipManagedHermesHome: true,
          paperclipSeedCompanyProfileMemory: true,
          env: expect.objectContaining({
            ZAI_API_KEY: { type: "secret_ref", secretId: "secret-1", version: "latest" },
          }),
          browserAutomationProvider: "playwright",
          browserSessionProfile: "romance-unzipped",
          browserHeadless: true,
        }),
      }),
      expect.objectContaining({
        recordRevision: expect.objectContaining({
          source: "migrate_hermes_worker",
        }),
      }),
    );
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "agent.hermes_worker_migrated",
      }),
    );
  });

  it("rejects migration for non-Hermes process agents", async () => {
    mockAgentService.getById.mockResolvedValue({
      ...makeAgent("process"),
      adapterType: "process",
      adapterConfig: {
        command: "python3",
        args: ["scripts/not-hermes.py"],
      },
    });

    const res = await request(createApp())
      .post("/api/agents/11111111-1111-4111-8111-111111111111/migrate-hermes-worker?companyId=company-1")
      .send({});

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(mockAgentService.update).not.toHaveBeenCalled();
  });

  it("persists canonical desired skills when creating an agent directly", async () => {
    const res = await request(createApp())
      .post("/api/companies/company-1/agents")
      .send({
        name: "QA Agent",
        role: "engineer",
        adapterType: "claude_local",
        desiredSkills: ["paperclip"],
        adapterConfig: {},
      });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockCompanySkillService.resolveRequestedSkillKeys).toHaveBeenCalledWith("company-1", ["paperclip"]);
    expect(mockAgentService.create).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        adapterConfig: expect.objectContaining({
          paperclipSkillSync: expect.objectContaining({
            desiredSkills: ["paperclipai/paperclip/paperclip"],
          }),
        }),
      }),
    );
  });

  it("materializes a managed AGENTS.md for directly created local agents", async () => {
    const res = await request(createApp())
      .post("/api/companies/company-1/agents")
      .send({
        name: "QA Agent",
        role: "engineer",
        adapterType: "claude_local",
        adapterConfig: {
          promptTemplate: "You are QA.",
        },
      });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockAgentInstructionsService.materializeManagedBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "11111111-1111-4111-8111-111111111111",
        adapterType: "claude_local",
      }),
      { "AGENTS.md": "You are QA." },
      { entryFile: "AGENTS.md", replaceExisting: false },
    );
    expect(mockAgentService.update).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      expect.objectContaining({
        adapterConfig: expect.objectContaining({
          instructionsBundleMode: "managed",
          instructionsEntryFile: "AGENTS.md",
          instructionsFilePath: "/tmp/11111111-1111-4111-8111-111111111111/instructions/AGENTS.md",
        }),
      }),
    );
    expect(mockAgentService.update.mock.calls.at(-1)?.[1]).not.toMatchObject({
      adapterConfig: expect.objectContaining({
        promptTemplate: expect.anything(),
      }),
    });
  });

  it("materializes the bundled CEO instruction set for default CEO agents", async () => {
    const res = await request(createApp())
      .post("/api/companies/company-1/agents")
      .send({
        name: "CEO",
        role: "ceo",
        adapterType: "claude_local",
        adapterConfig: {},
      });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockAgentInstructionsService.materializeManagedBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "11111111-1111-4111-8111-111111111111",
        role: "ceo",
        adapterType: "claude_local",
      }),
      expect.objectContaining({
        "AGENTS.md": expect.stringContaining("You are the CEO."),
        "HEARTBEAT.md": expect.stringContaining("CEO Heartbeat Checklist"),
        "SOUL.md": expect.stringContaining("CEO Persona"),
        "TOOLS.md": expect.stringContaining("# Tools"),
      }),
      { entryFile: "AGENTS.md", replaceExisting: false },
    );
  });

  it("materializes the bundled default instruction set for non-CEO agents with no prompt template", async () => {
    const res = await request(createApp())
      .post("/api/companies/company-1/agents")
      .send({
        name: "Engineer",
        role: "engineer",
        adapterType: "claude_local",
        adapterConfig: {},
      });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockAgentInstructionsService.materializeManagedBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "11111111-1111-4111-8111-111111111111",
        role: "engineer",
        adapterType: "claude_local",
      }),
      expect.objectContaining({
        "AGENTS.md": expect.stringContaining("Keep the work moving until it's done."),
      }),
      { entryFile: "AGENTS.md", replaceExisting: false },
    );
  });

  it("includes canonical desired skills in hire approvals", async () => {
    const db = createDb(true);

    const res = await request(createApp(db))
      .post("/api/companies/company-1/agent-hires")
      .send({
        name: "QA Agent",
        role: "engineer",
        adapterType: "claude_local",
        desiredSkills: ["paperclip"],
        adapterConfig: {},
      });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockCompanySkillService.resolveRequestedSkillKeys).toHaveBeenCalledWith("company-1", ["paperclip"]);
    expect(mockApprovalService.create).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        payload: expect.objectContaining({
          desiredSkills: ["paperclipai/paperclip/paperclip"],
          requestedConfigurationSnapshot: expect.objectContaining({
            desiredSkills: ["paperclipai/paperclip/paperclip"],
          }),
        }),
      }),
    );
  });

  it("uses managed AGENTS config in hire approval payloads", async () => {
    const res = await request(createApp(createDb(true)))
      .post("/api/companies/company-1/agent-hires")
      .send({
        name: "QA Agent",
        role: "engineer",
        adapterType: "claude_local",
        adapterConfig: {
          promptTemplate: "You are QA.",
        },
      });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockApprovalService.create).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        payload: expect.objectContaining({
          adapterConfig: expect.objectContaining({
            instructionsBundleMode: "managed",
            instructionsEntryFile: "AGENTS.md",
            instructionsFilePath: "/tmp/11111111-1111-4111-8111-111111111111/instructions/AGENTS.md",
          }),
        }),
      }),
    );
    const approvalInput = mockApprovalService.create.mock.calls.at(-1)?.[1] as
      | { payload?: { adapterConfig?: Record<string, unknown> } }
      | undefined;
    expect(approvalInput?.payload?.adapterConfig?.promptTemplate).toBeUndefined();
  });
});
