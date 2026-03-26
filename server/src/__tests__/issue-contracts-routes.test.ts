import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  checkout: vi.fn(),
  release: vi.fn(),
  assertCheckoutOwner: vi.fn(),
  getAncestors: vi.fn(),
  findMentionedAgents: vi.fn(),
  findMentionedProjectIds: vi.fn(),
  getCommentCursor: vi.fn(),
  addComment: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(),
  hasPermission: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  wakeup: vi.fn(async () => undefined),
  reportRunActivity: vi.fn(async () => undefined),
  cancelRun: vi.fn(async () => null),
  getRun: vi.fn(async () => null),
  getActiveRunForAgent: vi.fn(async () => null),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockProjectService = vi.hoisted(() => ({
  getById: vi.fn(),
  getByIdForCompany: vi.fn(),
  listByIds: vi.fn(),
}));

const mockGoalService = vi.hoisted(() => ({
  getById: vi.fn(),
  getByIdForCompany: vi.fn(),
  getDefaultCompanyGoal: vi.fn(),
}));

const mockDocumentService = vi.hoisted(() => ({
  getIssueDocumentPayload: vi.fn(),
  upsertIssueDocument: vi.fn(),
}));

const mockWorkProductService = vi.hoisted(() => ({
  listForIssue: vi.fn(),
  getById: vi.fn(),
  createForIssue: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

const mockExecutionWorkspaceService = vi.hoisted(() => ({
  getByIdForCompany: vi.fn(),
}));

const mockBudgetService = vi.hoisted(() => ({
  getInvocationBlock: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn(async () => undefined));

const COMPANY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENT_ONE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AGENT_TWO_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RUN_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  agentService: () => mockAgentService,
  budgetService: () => mockBudgetService,
  documentService: () => mockDocumentService,
  executionWorkspaceService: () => mockExecutionWorkspaceService,
  goalService: () => mockGoalService,
  heartbeatService: () => mockHeartbeatService,
  issueApprovalService: () => ({ listApprovalsForIssue: vi.fn(async () => []) }),
  issueService: () => mockIssueService,
  logActivity: mockLogActivity,
  projectService: () => mockProjectService,
  routineService: () => ({ syncRunStatusForIssue: vi.fn(async () => undefined) }),
  workProductService: () => mockWorkProductService,
}));

function createApp(actor: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", issueRoutes({} as any, {} as any));
  app.use(errorHandler);
  return app;
}

function makeIssue(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    companyId: COMPANY_ID,
    status: "todo",
    assigneeAgentId: AGENT_ONE_ID,
    assigneeUserId: null,
    createdByUserId: "user-1",
    identifier: "PAP-580",
    title: "Contract issue",
    projectId: null,
    goalId: null,
    executionWorkspaceId: null,
    ...overrides,
  };
}

describe("issue contract routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockIssueService.create.mockResolvedValue(makeIssue());
    mockIssueService.assertCheckoutOwner.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      status: "in_progress",
      assigneeAgentId: AGENT_ONE_ID,
      checkoutRunId: RUN_ID,
      adoptedFromRunId: null,
    });
    mockIssueService.findMentionedAgents.mockResolvedValue([]);
    mockIssueService.findMentionedProjectIds.mockResolvedValue([]);
    mockIssueService.getCommentCursor.mockResolvedValue(null);
    mockIssueService.getAncestors.mockResolvedValue([]);
    mockHeartbeatService.wakeup.mockResolvedValue(undefined);
    mockHeartbeatService.reportRunActivity.mockResolvedValue(undefined);
    mockHeartbeatService.cancelRun.mockResolvedValue(null);
    mockHeartbeatService.getRun.mockResolvedValue(null);
    mockHeartbeatService.getActiveRunForAgent.mockResolvedValue(null);
    mockProjectService.listByIds.mockResolvedValue([]);
    mockProjectService.getById.mockResolvedValue(null);
    mockProjectService.getByIdForCompany.mockResolvedValue(null);
    mockGoalService.getById.mockResolvedValue(null);
    mockGoalService.getByIdForCompany.mockResolvedValue(null);
    mockGoalService.getDefaultCompanyGoal.mockResolvedValue(null);
    mockDocumentService.getIssueDocumentPayload.mockResolvedValue({});
    mockDocumentService.upsertIssueDocument.mockResolvedValue(null);
    mockWorkProductService.listForIssue.mockResolvedValue([]);
    mockWorkProductService.getById.mockResolvedValue(null);
    mockWorkProductService.createForIssue.mockResolvedValue(null);
    mockWorkProductService.update.mockResolvedValue(null);
    mockWorkProductService.remove.mockResolvedValue(null);
    mockExecutionWorkspaceService.getByIdForCompany.mockResolvedValue(null);
    mockBudgetService.getInvocationBlock.mockResolvedValue(null);
    mockAgentService.getById.mockResolvedValue({
      id: AGENT_ONE_ID,
      companyId: COMPANY_ID,
      status: "idle",
      role: "general",
    });
  });

  it("rejects generic in_progress updates before they reach the service", async () => {
    mockIssueService.getById.mockResolvedValue(makeIssue());

    const res = await request(
      createApp({
        type: "board",
        userId: "board-user",
        companyIds: [COMPANY_ID],
        source: "local_implicit",
        isInstanceAdmin: false,
      }),
    )
      .patch("/api/issues/11111111-1111-4111-8111-111111111111")
      .send({ status: "in_progress" });

    expect(res.status).toBe(400);
    expect(mockIssueService.update).not.toHaveBeenCalled();
  });

  it("requires agent ownership for non-checkout issue patches", async () => {
    mockIssueService.getById.mockResolvedValue(makeIssue({
      status: "todo",
      assigneeAgentId: AGENT_TWO_ID,
    }));

    const res = await request(
      createApp({
        type: "agent",
        agentId: AGENT_ONE_ID,
        companyId: COMPANY_ID,
        runId: RUN_ID,
      }),
    )
      .patch("/api/issues/11111111-1111-4111-8111-111111111111")
      .send({ title: "Agent cannot edit another agent's issue" });

    expect(res.status).toBe(403);
    expect(mockIssueService.update).not.toHaveBeenCalled();
  });

  it("allows an agent to patch their own assigned issue", async () => {
    mockIssueService.getById.mockResolvedValue(makeIssue({
      status: "todo",
      assigneeAgentId: AGENT_ONE_ID,
    }));
    mockIssueService.update.mockResolvedValue(makeIssue({
      title: "Updated title",
      status: "todo",
      assigneeAgentId: AGENT_ONE_ID,
    }));

    const res = await request(
      createApp({
        type: "agent",
        agentId: AGENT_ONE_ID,
        companyId: COMPANY_ID,
        runId: RUN_ID,
      }),
    )
      .patch("/api/issues/11111111-1111-4111-8111-111111111111")
      .send({ title: "Updated title" });

    expect(res.status).toBe(200);
    expect(mockIssueService.update).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", {
      title: "Updated title",
    });
  });

  it("scopes issue detail hydration to the issue company", async () => {
    mockIssueService.getById.mockResolvedValue(makeIssue({
      projectId: "project-foreign",
      goalId: "goal-foreign",
      executionWorkspaceId: "workspace-foreign",
    }));
    mockIssueService.getAncestors.mockResolvedValue([]);
    mockProjectService.getByIdForCompany.mockResolvedValue({
      id: "project-foreign",
      companyId: COMPANY_ID,
      name: "Scoped project",
      status: "backlog",
      targetDate: null,
    });
    mockGoalService.getByIdForCompany.mockResolvedValue({
      id: "goal-foreign",
      companyId: COMPANY_ID,
      title: "Scoped goal",
      status: "planned",
      level: "task",
      parentId: null,
    });
    mockExecutionWorkspaceService.getByIdForCompany.mockResolvedValue({
      id: "workspace-foreign",
      companyId: COMPANY_ID,
      status: "active",
    });

    const res = await request(
      createApp({
        type: "board",
        userId: "board-user",
        companyIds: [COMPANY_ID],
        source: "local_implicit",
        isInstanceAdmin: false,
      }),
    ).get("/api/issues/11111111-1111-4111-8111-111111111111");

    expect(res.status).toBe(200);
    expect(mockIssueService.getAncestors).toHaveBeenCalledWith(COMPANY_ID, "11111111-1111-4111-8111-111111111111");
    expect(mockProjectService.getByIdForCompany).toHaveBeenCalledWith(COMPANY_ID, "project-foreign");
    expect(mockGoalService.getByIdForCompany).toHaveBeenCalledWith(COMPANY_ID, "goal-foreign");
    expect(mockExecutionWorkspaceService.getByIdForCompany).toHaveBeenCalledWith(COMPANY_ID, "workspace-foreign");
    expect(res.body.project?.companyId).toBe(COMPANY_ID);
    expect(res.body.goal?.companyId).toBe(COMPANY_ID);
  });

  it("still supports the dedicated checkout path", async () => {
    mockIssueService.getById.mockResolvedValue(makeIssue({
      status: "todo",
      assigneeAgentId: AGENT_ONE_ID,
    }));
    mockIssueService.checkout.mockResolvedValue(makeIssue({
      status: "in_progress",
      assigneeAgentId: AGENT_ONE_ID,
      checkoutRunId: RUN_ID,
      executionRunId: RUN_ID,
    }));

    const res = await request(
      createApp({
        type: "agent",
        agentId: AGENT_ONE_ID,
        companyId: COMPANY_ID,
        runId: RUN_ID,
      }),
    )
      .post("/api/issues/11111111-1111-4111-8111-111111111111/checkout")
      .send({ agentId: AGENT_ONE_ID, expectedStatuses: ["todo", "backlog", "blocked"] });

    expect(res.status).toBe(200);
    expect(mockIssueService.checkout).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      AGENT_ONE_ID,
      ["todo", "backlog", "blocked"],
      RUN_ID,
    );
  });

  it("requires tasks:assign permission for board-driven checkout", async () => {
    mockIssueService.getById.mockResolvedValue(makeIssue({
      status: "todo",
      assigneeAgentId: AGENT_ONE_ID,
    }));
    mockAccessService.canUser.mockResolvedValue(false);

    const res = await request(
      createApp({
        type: "board",
        userId: "board-user",
        companyIds: [COMPANY_ID],
        source: "session",
        isInstanceAdmin: false,
      }),
    )
      .post("/api/issues/11111111-1111-4111-8111-111111111111/checkout")
      .send({ agentId: AGENT_ONE_ID, expectedStatuses: ["todo"] });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("tasks:assign");
    expect(mockIssueService.checkout).not.toHaveBeenCalled();
  });

  it("rejects checkout when the target agent is manually paused", async () => {
    mockIssueService.getById.mockResolvedValue(makeIssue({
      status: "todo",
      assigneeAgentId: AGENT_ONE_ID,
    }));
    mockAgentService.getById.mockResolvedValue({
      id: AGENT_ONE_ID,
      companyId: COMPANY_ID,
      status: "paused",
      pauseReason: "manual",
      role: "general",
    });

    const res = await request(
      createApp({
        type: "agent",
        agentId: AGENT_ONE_ID,
        companyId: COMPANY_ID,
        runId: RUN_ID,
      }),
    )
      .post("/api/issues/11111111-1111-4111-8111-111111111111/checkout")
      .send({ agentId: AGENT_ONE_ID, expectedStatuses: ["todo"] });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/agent is paused/i);
    expect(mockIssueService.checkout).not.toHaveBeenCalled();
  });

  it("rejects checkout when budget or company policy blocks new work", async () => {
    mockIssueService.getById.mockResolvedValue(makeIssue({
      status: "todo",
      assigneeAgentId: AGENT_ONE_ID,
      projectId: "project-1",
    }));
    mockBudgetService.getInvocationBlock.mockResolvedValue({
      scopeType: "company",
      scopeId: COMPANY_ID,
      scopeName: "Paperclip",
      reason: "Company is paused because its budget hard-stop was reached.",
    });

    const res = await request(
      createApp({
        type: "agent",
        agentId: AGENT_ONE_ID,
        companyId: COMPANY_ID,
        runId: RUN_ID,
      }),
    )
      .post("/api/issues/11111111-1111-4111-8111-111111111111/checkout")
      .send({ agentId: AGENT_ONE_ID, expectedStatuses: ["todo"] });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Company is paused because its budget hard-stop was reached.");
    expect(mockIssueService.checkout).not.toHaveBeenCalled();
  });

  it.each(["done", "cancelled"] as const)(
    "rejects checkout requests from terminal status %s before they reach the service",
    async (status) => {
      mockIssueService.getById.mockResolvedValue(makeIssue({
        status,
        assigneeAgentId: AGENT_ONE_ID,
      }));

      const res = await request(
        createApp({
          type: "agent",
          agentId: AGENT_ONE_ID,
          companyId: COMPANY_ID,
          runId: RUN_ID,
        }),
      )
        .post("/api/issues/11111111-1111-4111-8111-111111111111/checkout")
        .send({ agentId: AGENT_ONE_ID, expectedStatuses: [status] });

      expect(res.status).toBe(400);
      expect(mockIssueService.checkout).not.toHaveBeenCalled();
    },
  );
});
