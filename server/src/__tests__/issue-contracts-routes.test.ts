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

function makeIssueComment(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "99999999-9999-4999-8999-999999999999",
    issueId: "11111111-1111-4111-8111-111111111111",
    companyId: COMPANY_ID,
    authorAgentId: AGENT_ONE_ID,
    authorUserId: null,
    body: "Auto-blocked after delegation.",
    createdAt: new Date("2026-03-23T12:00:00.000Z").toISOString(),
    updatedAt: new Date("2026-03-23T12:00:00.000Z").toISOString(),
    ...overrides,
  };
}

describe("issue contract routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIssueService.create.mockResolvedValue({ issue: makeIssue(), created: true });
    mockIssueService.assertCheckoutOwner.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      status: "in_progress",
      assigneeAgentId: AGENT_ONE_ID,
      checkoutRunId: RUN_ID,
      adoptedFromRunId: null,
    });
    mockIssueService.findMentionedProjectIds.mockResolvedValue([]);
    mockIssueService.getCommentCursor.mockResolvedValue(null);
    mockIssueService.getAncestors.mockResolvedValue([]);
    mockProjectService.listByIds.mockResolvedValue([]);
    mockProjectService.getByIdForCompany.mockResolvedValue(null);
    mockGoalService.getByIdForCompany.mockResolvedValue(null);
    mockGoalService.getDefaultCompanyGoal.mockResolvedValue(null);
    mockDocumentService.getIssueDocumentPayload.mockResolvedValue({});
    mockDocumentService.upsertIssueDocument.mockResolvedValue({
      created: true,
      document: {
        id: "doc-1",
        issueId: "11111111-1111-4111-8111-111111111111",
        key: "plan",
        title: "Plan",
        format: "markdown",
        latestRevisionNumber: 1,
      },
    });
    mockWorkProductService.listForIssue.mockResolvedValue([]);
    mockWorkProductService.getById.mockResolvedValue(null);
    mockWorkProductService.createForIssue.mockResolvedValue({
      id: "wp-1",
      companyId: COMPANY_ID,
      issueId: "11111111-1111-4111-8111-111111111111",
      projectId: null,
      executionWorkspaceId: null,
      runtimeServiceId: null,
      type: "artifact",
      provider: "local",
      externalId: null,
      title: "Artifact",
      url: null,
      status: "active",
      reviewState: "none",
      isPrimary: false,
      healthStatus: "unknown",
      summary: null,
      metadata: null,
      createdByRunId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
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
    expect(mockIssueService.update).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", { title: "Updated title" });
  });

  it("does not pass delegationKey through issue patch requests", async () => {
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
      .send({
        title: "Updated title",
        delegationKey: "newsletter.hermes-wrapper",
      });

    expect(res.status).toBe(200);
    expect(mockIssueService.update).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      { title: "Updated title" },
    );
  });

  it("allows an agent to create an assigned child issue under their own parent issue", async () => {
    mockIssueService.getById.mockResolvedValueOnce(makeIssue({
      id: "22222222-2222-4222-8222-222222222222",
      status: "todo",
      assigneeAgentId: AGENT_ONE_ID,
    }));
    mockIssueService.create.mockResolvedValue({
      issue: makeIssue({
        id: "33333333-3333-4333-8333-333333333333",
        title: "Delegated child issue",
        parentId: "22222222-2222-4222-8222-222222222222",
        assigneeAgentId: AGENT_TWO_ID,
      }),
      created: true,
    });

    const res = await request(
      createApp({
        type: "agent",
        agentId: AGENT_ONE_ID,
        companyId: COMPANY_ID,
        runId: RUN_ID,
      }),
    )
      .post(`/api/companies/${COMPANY_ID}/issues`)
      .send({
        title: "Delegated child issue",
        parentId: "22222222-2222-4222-8222-222222222222",
        assigneeAgentId: AGENT_TWO_ID,
      });

    expect(res.status).toBe(201);
    expect(mockIssueService.create).toHaveBeenCalledWith(
      COMPANY_ID,
      expect.objectContaining({
        title: "Delegated child issue",
        parentId: "22222222-2222-4222-8222-222222222222",
        assigneeAgentId: AGENT_TWO_ID,
      }),
    );
  });

  it("reuses an existing delegated child issue instead of creating a duplicate", async () => {
    mockIssueService.getById.mockResolvedValueOnce(makeIssue({
      id: "22222222-2222-4222-8222-222222222222",
      status: "todo",
      assigneeAgentId: AGENT_ONE_ID,
    }));
    mockIssueService.create.mockResolvedValue({
      issue: makeIssue({
        id: "33333333-3333-4333-8333-333333333333",
        title: "Delegated child issue",
        parentId: "22222222-2222-4222-8222-222222222222",
        assigneeAgentId: AGENT_TWO_ID,
      }),
      created: false,
    });

    const res = await request(
      createApp({
        type: "agent",
        agentId: AGENT_ONE_ID,
        companyId: COMPANY_ID,
        runId: RUN_ID,
      }),
    )
      .post(`/api/companies/${COMPANY_ID}/issues`)
      .send({
        title: "Delegated child issue",
        parentId: "22222222-2222-4222-8222-222222222222",
        assigneeAgentId: AGENT_TWO_ID,
      });

    expect(res.status).toBe(200);
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.create_deduplicated",
        entityId: "33333333-3333-4333-8333-333333333333",
      }),
    );
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  });

  it("logs when delegated child creation blocks the parent issue", async () => {
    mockIssueService.getById.mockResolvedValueOnce(makeIssue({
      id: "22222222-2222-4222-8222-222222222222",
      status: "in_progress",
      assigneeAgentId: AGENT_ONE_ID,
      checkoutRunId: RUN_ID,
    }));
    mockIssueService.assertCheckoutOwner.mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
      status: "in_progress",
      assigneeAgentId: AGENT_ONE_ID,
      checkoutRunId: RUN_ID,
      adoptedFromRunId: null,
    });
    mockIssueService.create.mockResolvedValue({
      issue: makeIssue({
        id: "33333333-3333-4333-8333-333333333333",
        title: "Delegated child issue",
        parentId: "22222222-2222-4222-8222-222222222222",
        assigneeAgentId: AGENT_TWO_ID,
      }),
      created: true,
      blockedParentIssue: makeIssue({
        id: "22222222-2222-4222-8222-222222222222",
        status: "blocked",
        assigneeAgentId: AGENT_ONE_ID,
        identifier: "PAP-579",
      }),
      blockedParentComment: makeIssueComment({
        issueId: "22222222-2222-4222-8222-222222222222",
        body: "Delegated child PAP-580 is now active. This coordination issue was moved to blocked until that work changes state or needs intervention.",
      }),
    });

    const res = await request(
      createApp({
        type: "agent",
        agentId: AGENT_ONE_ID,
        companyId: COMPANY_ID,
        runId: RUN_ID,
      }),
    )
      .post(`/api/companies/${COMPANY_ID}/issues`)
      .send({
        title: "Delegated child issue",
        parentId: "22222222-2222-4222-8222-222222222222",
        assigneeAgentId: AGENT_TWO_ID,
      });

    expect(res.status).toBe(201);
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.updated",
        entityId: "22222222-2222-4222-8222-222222222222",
        details: expect.objectContaining({
          status: "blocked",
          delegatedChildIssueId: "33333333-3333-4333-8333-333333333333",
          source: "delegated_child_create",
        }),
      }),
    );
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.comment_added",
        entityId: "22222222-2222-4222-8222-222222222222",
        details: expect.objectContaining({
          commentId: "99999999-9999-4999-8999-999999999999",
          source: "delegated_child_create",
        }),
      }),
    );
  });

  it("rejects agent-created assigned child issues when the parent issue is not owned by the actor", async () => {
    mockIssueService.getById.mockResolvedValueOnce(makeIssue({
      id: "22222222-2222-4222-8222-222222222222",
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
      .post(`/api/companies/${COMPANY_ID}/issues`)
      .send({
        title: "Delegated child issue",
        parentId: "22222222-2222-4222-8222-222222222222",
        assigneeAgentId: AGENT_TWO_ID,
      });

    expect(res.status).toBe(403);
    expect(mockIssueService.create).not.toHaveBeenCalled();
  });

  it("requires checkout-run ownership when an agent delegates from an in_progress parent issue", async () => {
    mockIssueService.getById.mockResolvedValueOnce(makeIssue({
      id: "22222222-2222-4222-8222-222222222222",
      status: "in_progress",
      assigneeAgentId: AGENT_ONE_ID,
    }));
    mockIssueService.assertCheckoutOwner.mockRejectedValueOnce(
      Object.assign(new Error("Issue run ownership conflict"), { status: 409, expose: true }),
    );

    const res = await request(
      createApp({
        type: "agent",
        agentId: AGENT_ONE_ID,
        companyId: COMPANY_ID,
        runId: RUN_ID,
      }),
    )
      .post(`/api/companies/${COMPANY_ID}/issues`)
      .send({
        title: "Delegated child issue",
        parentId: "22222222-2222-4222-8222-222222222222",
        assigneeAgentId: AGENT_TWO_ID,
      });

    expect(res.status).toBe(409);
    expect(mockIssueService.create).not.toHaveBeenCalled();
  });

  it("requires agent ownership for issue document updates", async () => {
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
      .put("/api/issues/11111111-1111-4111-8111-111111111111/documents/plan")
      .send({ format: "markdown", body: "# Plan" });

    expect(res.status).toBe(403);
    expect(mockDocumentService.upsertIssueDocument).not.toHaveBeenCalled();
  });

  it("requires agent ownership for work product creation", async () => {
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
      .post("/api/issues/11111111-1111-4111-8111-111111111111/work-products")
      .send({
        type: "artifact",
        provider: "local",
        title: "Artifact",
      });

    expect(res.status).toBe(403);
    expect(mockWorkProductService.createForIssue).not.toHaveBeenCalled();
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
      .send({ agentId: AGENT_ONE_ID, expectedStatuses: ["todo", "backlog", "blocked", "in_review"] });

    expect(res.status).toBe(200);
    expect(mockIssueService.checkout).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      AGENT_ONE_ID,
      ["todo", "backlog", "blocked", "in_review"],
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
