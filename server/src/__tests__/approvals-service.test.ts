import { beforeEach, describe, expect, it, vi } from "vitest";
import { approvalService } from "../services/approvals.ts";

const mockAgentService = vi.hoisted(() => ({
  activatePendingApproval: vi.fn(),
  create: vi.fn(),
  terminate: vi.fn(),
}));

const mockBudgetService = vi.hoisted(() => ({
  upsertPolicy: vi.fn(),
}));

const mockNotifyHireApproved = vi.hoisted(() => vi.fn());
const mockInstanceSettingsService = vi.hoisted(() => ({
  getGeneral: vi.fn(),
}));

vi.mock("../services/agents.js", () => ({
  agentService: vi.fn(() => mockAgentService),
}));

vi.mock("../services/budgets.js", () => ({
  budgetService: vi.fn(() => mockBudgetService),
}));

vi.mock("../services/hire-hook.js", () => ({
  notifyHireApproved: mockNotifyHireApproved,
}));

vi.mock("../services/instance-settings.js", () => ({
  instanceSettingsService: vi.fn(() => mockInstanceSettingsService),
}));

type ApprovalRecord = {
  id: string;
  companyId: string;
  type: string;
  status: string;
  payload: Record<string, unknown>;
  requestedByAgentId: string | null;
};

function createApproval(status: string): ApprovalRecord {
  return {
    id: "approval-1",
    companyId: "company-1",
    type: "hire_agent",
    status,
    payload: {
      agentId: "11111111-1111-4111-8111-111111111111",
      name: "Agent One",
    },
    requestedByAgentId: "requester-1",
  };
}

function createBudgetApproval(status: string): ApprovalRecord {
  return {
    id: "approval-1",
    companyId: "company-1",
    type: "budget_override_required",
    status,
    payload: { policyId: "policy-1" },
    requestedByAgentId: null,
  };
}

function createDbStub(selectResults: ApprovalRecord[][], updateResults: ApprovalRecord[]) {
  const pendingSelectResults = [...selectResults];
  const selectWhere = vi.fn(async () => pendingSelectResults.shift() ?? []);
  const from = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from }));

  const returning = vi.fn(async () => updateResults);
  const updateWhere = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set }));

  return {
    db: { select, update },
    selectWhere,
    returning,
  };
}

function createCommentDbStub() {
  const approval = createApproval("pending");
  const comment = {
    id: "comment-1",
    companyId: "company-1",
    approvalId: "approval-1",
    authorAgentId: null,
    authorUserId: "user-1",
    body: "Looks good",
    createdAt: new Date("2026-03-22T00:00:00.000Z"),
    updatedAt: new Date("2026-03-22T00:00:00.000Z"),
  };
  const pendingSelectResults = [[approval], [comment]];
  const pendingInsertResults = [[comment]];

  const selectChain = {
    from: vi.fn(() => selectChain),
    where: vi.fn(() => selectChain),
    orderBy: vi.fn(() => selectChain),
    then: vi.fn((resolve: (value: unknown[]) => unknown) => Promise.resolve(resolve(pendingSelectResults.shift() ?? []))),
  };

  return {
    db: {
      select: vi.fn(() => selectChain),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => pendingInsertResults.shift() ?? []),
        })),
      })),
    },
    comment,
  };
}

describe("approvalService resolution idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentService.activatePendingApproval.mockResolvedValue(undefined);
    mockAgentService.create.mockResolvedValue({ id: "agent-1" });
    mockAgentService.terminate.mockResolvedValue(undefined);
    mockBudgetService.upsertPolicy.mockResolvedValue(undefined);
    mockNotifyHireApproved.mockResolvedValue(undefined);
    mockInstanceSettingsService.getGeneral.mockResolvedValue({ censorUsernameInLogs: false });
  });

  it("treats repeated approve retries as no-ops after another worker resolves the approval", async () => {
    const dbStub = createDbStub(
      [[createApproval("pending")], [createApproval("approved")]],
      [],
    );

    const svc = approvalService(dbStub.db as any);
    const result = await svc.approve("approval-1", "board", "ship it");

    expect(result.applied).toBe(false);
    expect(result.approval.status).toBe("approved");
    expect(mockAgentService.activatePendingApproval).not.toHaveBeenCalled();
    expect(mockNotifyHireApproved).not.toHaveBeenCalled();
  });

  it("treats repeated reject retries as no-ops after another worker resolves the approval", async () => {
    const dbStub = createDbStub(
      [[createApproval("pending")], [createApproval("rejected")]],
      [],
    );

    const svc = approvalService(dbStub.db as any);
    const result = await svc.reject("approval-1", "board", "not now");

    expect(result.applied).toBe(false);
    expect(result.approval.status).toBe("rejected");
    expect(mockAgentService.terminate).not.toHaveBeenCalled();
  });

  it("still performs side effects when the resolution update is newly applied", async () => {
    const approved = createApproval("approved");
    const dbStub = createDbStub([[createApproval("pending")]], [approved]);

    const svc = approvalService(dbStub.db as any);
    const result = await svc.approve("approval-1", "board", "ship it");

    expect(result.applied).toBe(true);
    expect(mockAgentService.activatePendingApproval).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(mockNotifyHireApproved).toHaveBeenCalledTimes(1);
  });

  it("uses a transaction when approving a hire if the database exposes one", async () => {
    const approved = createApproval("approved");
    const dbStub = createDbStub([[createApproval("pending")]], [approved]);
    const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(dbStub.db));

    const svc = approvalService({ ...dbStub.db, transaction } as any);
    const result = await svc.approve("approval-1", "board", "ship it");

    expect(result.applied).toBe(true);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(mockAgentService.activatePendingApproval).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it("does not emit hire notifications when a transactional approval side effect fails", async () => {
    const approved = createApproval("approved");
    const dbStub = createDbStub([[createApproval("pending")]], [approved]);
    const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(dbStub.db));
    mockAgentService.activatePendingApproval.mockRejectedValueOnce(new Error("activate failed"));

    const svc = approvalService({ ...dbStub.db, transaction } as any);

    await expect(svc.approve("approval-1", "board", "ship it")).rejects.toThrow("activate failed");
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(mockNotifyHireApproved).not.toHaveBeenCalled();
  });

  it("rejects generic approval for budget override approvals", async () => {
    const dbStub = createDbStub([[createBudgetApproval("pending")]], []);
    const svc = approvalService(dbStub.db as any);

    await expect(svc.approve("approval-1", "board", "ship it")).rejects.toThrow(
      /Resolve budget override approvals from the budget incident controls/i,
    );
  });

  it("rejects revision lifecycle changes for budget override approvals", async () => {
    const dbStub = createDbStub([[createBudgetApproval("pending")]], []);
    const svc = approvalService(dbStub.db as any);

    await expect(svc.requestRevision("approval-1", "board", "revise")).rejects.toThrow(
      /Resolve budget override approvals from the budget incident controls/i,
    );
  });

  it("rejects malformed hire approvals instead of creating default agents", async () => {
    const invalidApproval = {
      ...createApproval("pending"),
      payload: {},
    };
    const dbStub = createDbStub(
      [[invalidApproval]],
      [{ ...invalidApproval, status: "approved" }],
    );
    const svc = approvalService(dbStub.db as any);

    await expect(svc.approve("approval-1", "board", "ship it")).rejects.toThrow(
      /Invalid hire agent approval payload/i,
    );
    expect(mockAgentService.create).not.toHaveBeenCalled();
    expect(mockAgentService.activatePendingApproval).not.toHaveBeenCalled();
    expect(mockNotifyHireApproved).not.toHaveBeenCalled();
  });

  it("lists approval comments for the approval company", async () => {
    const dbStub = createCommentDbStub();

    const svc = approvalService(dbStub.db as any);
    const comments = await svc.listComments("approval-1");

    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      id: dbStub.comment.id,
      approvalId: "approval-1",
      companyId: "company-1",
    });
  });

  it("adds approval comments for the approval company", async () => {
    const dbStub = createCommentDbStub();

    const svc = approvalService(dbStub.db as any);
    const comment = await svc.addComment("approval-1", "Looks good", { userId: "user-1" });

    expect(comment).toMatchObject({
      id: dbStub.comment.id,
      approvalId: "approval-1",
      companyId: "company-1",
      authorUserId: "user-1",
    });
  });
});
