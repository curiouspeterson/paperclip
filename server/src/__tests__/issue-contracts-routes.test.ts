import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
  update: vi.fn(),
  checkout: vi.fn(),
  release: vi.fn(),
  getAncestors: vi.fn(),
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
  getByIdForCompany: vi.fn(),
  listByIds: vi.fn(),
}));

const mockGoalService = vi.hoisted(() => ({
  getByIdForCompany: vi.fn(),
  getDefaultCompanyGoal: vi.fn(),
}));

const mockExecutionWorkspaceService = vi.hoisted(() => ({
  getByIdForCompany: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  agentService: () => mockAgentService,
  documentService: () => ({ getIssueDocumentPayload: vi.fn(async () => ({})) }),
  executionWorkspaceService: () => mockExecutionWorkspaceService,
  goalService: () => mockGoalService,
  heartbeatService: () => mockHeartbeatService,
  issueApprovalService: () => ({ listApprovalsForIssue: vi.fn(async () => []) }),
  issueService: () => mockIssueService,
  logActivity: mockLogActivity,
  projectService: () => mockProjectService,
  routineService: () => ({ syncRunStatusForIssue: vi.fn(async () => undefined) }),
  workProductService: () => ({ listForIssue: vi.fn(async () => []) }),
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
    companyId: "company-1",
    status: "todo",
    assigneeAgentId: "agent-1",
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
    vi.clearAllMocks();
    mockIssueService.findMentionedProjectIds.mockResolvedValue([]);
    mockIssueService.getCommentCursor.mockResolvedValue(null);
    mockIssueService.getAncestors.mockResolvedValue([]);
    mockProjectService.listByIds.mockResolvedValue([]);
    mockProjectService.getByIdForCompany.mockResolvedValue(null);
    mockGoalService.getByIdForCompany.mockResolvedValue(null);
    mockGoalService.getDefaultCompanyGoal.mockResolvedValue(null);
    mockExecutionWorkspaceService.getByIdForCompany.mockResolvedValue(null);
  });

  it("rejects generic in_progress updates before they reach the service", async () => {
    mockIssueService.getById.mockResolvedValue(makeIssue());

    const res = await request(
      createApp({
        type: "board",
        userId: "board-user",
        companyIds: ["company-1"],
        source: "local_implicit",
        isInstanceAdmin: false,
      }),
    )
      .patch("/api/issues/11111111-1111-4111-8111-111111111111")
      .send({ status: "in_progress" });

    expect(res.status).toBe(422);
    expect(mockIssueService.update).not.toHaveBeenCalled();
  });

  it("requires agent ownership for non-checkout issue patches", async () => {
    mockIssueService.getById.mockResolvedValue(makeIssue({
      status: "todo",
      assigneeAgentId: "agent-2",
    }));

    const res = await request(
      createApp({
        type: "agent",
        agentId: "agent-1",
        companyId: "company-1",
        runId: "run-1",
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
      assigneeAgentId: "agent-1",
    }));
    mockIssueService.update.mockResolvedValue(makeIssue({
      title: "Updated title",
      status: "todo",
      assigneeAgentId: "agent-1",
    }));

    const res = await request(
      createApp({
        type: "agent",
        agentId: "agent-1",
        companyId: "company-1",
        runId: "run-1",
      }),
    )
      .patch("/api/issues/11111111-1111-4111-8111-111111111111")
      .send({ title: "Updated title" });

    expect(res.status).toBe(200);
    expect(mockIssueService.update).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      { title: "Updated title" },
    );
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
      companyId: "company-1",
      name: "Scoped project",
      status: "backlog",
      targetDate: null,
    });
    mockGoalService.getByIdForCompany.mockResolvedValue({
      id: "goal-foreign",
      companyId: "company-1",
      title: "Scoped goal",
      status: "planned",
      level: "task",
      parentId: null,
    });
    mockExecutionWorkspaceService.getByIdForCompany.mockResolvedValue({
      id: "workspace-foreign",
      companyId: "company-1",
      status: "active",
    });

    const res = await request(
      createApp({
        type: "board",
        userId: "board-user",
        companyIds: ["company-1"],
        source: "local_implicit",
        isInstanceAdmin: false,
      }),
    ).get("/api/issues/11111111-1111-4111-8111-111111111111");

    expect(res.status).toBe(200);
    expect(mockIssueService.getAncestors).toHaveBeenCalledWith("company-1", "11111111-1111-4111-8111-111111111111");
    expect(mockProjectService.getByIdForCompany).toHaveBeenCalledWith("company-1", "project-foreign");
    expect(mockGoalService.getByIdForCompany).toHaveBeenCalledWith("company-1", "goal-foreign");
    expect(mockExecutionWorkspaceService.getByIdForCompany).toHaveBeenCalledWith("company-1", "workspace-foreign");
    expect(res.body.project?.companyId).toBe("company-1");
    expect(res.body.goal?.companyId).toBe("company-1");
  });

  it("still supports the dedicated checkout path", async () => {
    mockIssueService.getById.mockResolvedValue(makeIssue({
      status: "todo",
      assigneeAgentId: "agent-1",
    }));
    mockIssueService.checkout.mockResolvedValue(makeIssue({
      status: "in_progress",
      assigneeAgentId: "agent-1",
      checkoutRunId: "run-1",
      executionRunId: "run-1",
    }));

    const res = await request(
      createApp({
        type: "agent",
        agentId: "agent-1",
        companyId: "company-1",
        runId: "run-1",
      }),
    )
      .post("/api/issues/11111111-1111-4111-8111-111111111111/checkout")
      .send({ agentId: "agent-1", expectedStatuses: ["todo", "backlog", "blocked"] });

    expect(res.status).toBe(200);
    expect(mockIssueService.checkout).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      "agent-1",
      ["todo", "backlog", "blocked"],
      "run-1",
    );
  });
});
