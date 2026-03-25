import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalLinkedIssueSummary } from "@paperclipai/shared";
import { approvalRoutes } from "../routes/approvals.js";
import { errorHandler } from "../middleware/index.js";
import { unprocessable } from "../errors.js";

const mockApprovalService = vi.hoisted(() => ({
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
  requestRevision: vi.fn(),
  resubmit: vi.fn(),
  listComments: vi.fn(),
  addComment: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  wakeup: vi.fn(),
}));

const mockIssueApprovalService = vi.hoisted(() => ({
  listIssuesForApproval: vi.fn(),
  linkManyForApproval: vi.fn(),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockSecretService = vi.hoisted(() => ({
  normalizeHireApprovalPayloadForPersistence: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  agentService: () => mockAgentService,
  approvalService: () => mockApprovalService,
  heartbeatService: () => mockHeartbeatService,
  issueApprovalService: () => mockIssueApprovalService,
  logActivity: mockLogActivity,
  secretService: () => mockSecretService,
}));

function createApp(
  actor: Record<string, unknown> = {
    type: "board",
    userId: "user-1",
    companyIds: ["company-1"],
    source: "session",
    isInstanceAdmin: false,
  },
) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", approvalRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe("approval routes idempotent retries", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockHeartbeatService.wakeup.mockResolvedValue({ id: "wake-1" });
    mockIssueApprovalService.listIssuesForApproval.mockResolvedValue([{ id: "issue-1" }]);
    mockSecretService.normalizeHireApprovalPayloadForPersistence.mockImplementation(
      async (_companyId: string, payload: Record<string, unknown>) => payload,
    );
    mockApprovalService.create.mockResolvedValue({
      id: "approval-created",
      companyId: "company-1",
      type: "hire_agent",
      status: "pending",
      payload: {},
      requestedByAgentId: null,
    });
    mockApprovalService.getById.mockResolvedValue({
      id: "approval-1",
      companyId: "company-1",
      type: "hire_agent",
      status: "pending",
      payload: {},
      requestedByAgentId: "agent-1",
    });
    mockApprovalService.requestRevision.mockResolvedValue({
      id: "approval-1",
      companyId: "company-1",
      type: "hire_agent",
      status: "revision_requested",
      payload: {},
      requestedByAgentId: "agent-1",
    });
    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      companyId: "company-1",
      role: "ceo",
    });
    mockLogActivity.mockResolvedValue(undefined);
  });

  it("does not emit duplicate approval side effects when approve is already resolved", async () => {
    mockApprovalService.approve.mockResolvedValue({
      approval: {
        id: "approval-1",
        companyId: "company-1",
        type: "hire_agent",
        status: "approved",
        payload: {},
        requestedByAgentId: "agent-1",
      },
      applied: false,
    });

    const res = await request(createApp())
      .post("/api/approvals/approval-1/approve")
      .send({});

    expect(res.status).toBe(200);
    expect(mockIssueApprovalService.listIssuesForApproval).not.toHaveBeenCalled();
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("does not emit duplicate rejection logs when reject is already resolved", async () => {
    mockApprovalService.reject.mockResolvedValue({
      approval: {
        id: "approval-1",
        companyId: "company-1",
        type: "hire_agent",
        status: "rejected",
        payload: {},
      },
      applied: false,
    });

    const res = await request(createApp())
      .post("/api/approvals/approval-1/reject")
      .send({});

    expect(res.status).toBe(200);
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("returns approval-linked issues using the summary contract shape", async () => {
    const linkedIssues: ApprovalLinkedIssueSummary[] = [
      {
        id: "issue-1",
        companyId: "company-1",
        projectId: "project-1",
        goalId: null,
        parentId: null,
        title: "Budget incident follow-up",
        description: "Resolve the blocked run",
        status: "in_progress",
        priority: "high",
        assigneeAgentId: "agent-1",
        createdByAgentId: null,
        createdByUserId: "user-1",
        issueNumber: 42,
        identifier: "PAP-42",
        requestDepth: 0,
        billingCode: null,
        startedAt: "2026-03-23T16:00:00.000Z",
        completedAt: null,
        cancelledAt: null,
        createdAt: "2026-03-23T16:00:00.000Z",
        updatedAt: "2026-03-23T16:05:00.000Z",
      },
    ];
    mockIssueApprovalService.listIssuesForApproval.mockResolvedValue(linkedIssues);

    const res = await request(createApp()).get("/api/approvals/approval-1/issues");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(linkedIssues);
    expect(mockIssueApprovalService.listIssuesForApproval).toHaveBeenCalledWith("approval-1");
  });

  it.each([
    ["/api/approvals/approval-1/approve", "approve"],
    ["/api/approvals/approval-1/reject", "reject"],
    ["/api/approvals/approval-1/request-revision", "requestRevision"],
    ["/api/approvals/approval-1/resubmit", "resubmit"],
  ] as const)(
    "surfaces budget override approvals as unprocessable for %s",
    async (path, method) => {
      mockApprovalService.getById.mockResolvedValue({
        id: "approval-1",
        companyId: "company-1",
        type: "budget_override_required",
        status: "pending",
        payload: {},
        requestedByAgentId: "agent-1",
      });
      mockApprovalService[method].mockRejectedValue(
        unprocessable(
          "Resolve budget override approvals from the budget incident controls instead of generic approval actions",
        ),
      );

      const res = await request(createApp()).post(path).send({ decisionNote: "ship it" });

      expect(res.status).toBe(422);
      expect(res.body).toEqual({
        error: "Resolve budget override approvals from the budget incident controls instead of generic approval actions",
      });
      expect(mockLogActivity).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["/api/approvals/approval-1/approve", "approve"],
    ["/api/approvals/approval-1/reject", "reject"],
    ["/api/approvals/approval-1/request-revision", "requestRevision"],
  ] as const)(
    "rejects %s for board users outside the approval company",
    async (path, method) => {
      const res = await request(createApp({
        type: "board",
        userId: "user-2",
        companyIds: ["company-2"],
        source: "session",
        isInstanceAdmin: false,
      }))
        .post(path)
        .send({});

      expect(res.status).toBe(403);
      expect(mockApprovalService[method]).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["/api/approvals/approval-1/approve", "approve"],
    ["/api/approvals/approval-1/reject", "reject"],
    ["/api/approvals/approval-1/request-revision", "requestRevision"],
  ] as const)(
    "binds %s decisions to the authenticated board actor",
    async (path, method) => {
      if (method === "approve") {
        mockApprovalService.approve.mockResolvedValue({
          approval: {
            id: "approval-1",
            companyId: "company-1",
            type: "hire_agent",
            status: "approved",
            payload: {},
            requestedByAgentId: "agent-1",
          },
          applied: false,
        });
      } else if (method === "reject") {
        mockApprovalService.reject.mockResolvedValue({
          approval: {
            id: "approval-1",
            companyId: "company-1",
            type: "hire_agent",
            status: "rejected",
            payload: {},
            requestedByAgentId: "agent-1",
          },
          applied: false,
        });
      }

      const res = await request(createApp())
        .post(path)
        .send({ decidedByUserId: "spoofed-user", decisionNote: "ship it" });

      expect(res.status).toBe(200);
      expect(mockApprovalService[method]).toHaveBeenCalledWith("approval-1", "user-1", "ship it");
    },
  );

  it("rejects agent-created approvals that try to spoof another requesting agent", async () => {
    const res = await request(createApp({
      type: "agent",
      agentId: "agent-1",
      companyId: "company-1",
      source: "agent_key",
      runId: "run-1",
    }))
      .post("/api/companies/company-1/approvals")
      .send({
        type: "approve_ceo_strategy",
        requestedByAgentId: "22222222-2222-4222-8222-222222222222",
        payload: { plan: "Ship it" },
      });

    expect(res.status).toBe(403);
    expect(mockApprovalService.create).not.toHaveBeenCalled();
  });

  it("rejects board-created approvals that point at an agent in another company", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
      companyId: "company-2",
      role: "ceo",
    });

    const res = await request(createApp())
      .post("/api/companies/company-1/approvals")
      .send({
        type: "approve_ceo_strategy",
        requestedByAgentId: "22222222-2222-4222-8222-222222222222",
        payload: { plan: "Ship it" },
      });

    expect(res.status).toBe(422);
    expect(mockApprovalService.create).not.toHaveBeenCalled();
  });

  it("rejects malformed hire approvals before persistence", async () => {
    const res = await request(createApp())
      .post("/api/companies/company-1/approvals")
      .send({
        type: "hire_agent",
        payload: {},
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation error");
    expect(mockSecretService.normalizeHireApprovalPayloadForPersistence).not.toHaveBeenCalled();
    expect(mockApprovalService.create).not.toHaveBeenCalled();
  });
});
