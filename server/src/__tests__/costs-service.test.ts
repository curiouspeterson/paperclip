import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { costRoutes } from "../routes/costs.js";
import { costService } from "../services/costs.ts";
import { errorHandler } from "../middleware/index.js";

function makeDb(overrides: Record<string, unknown> = {}) {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: vi.fn().mockResolvedValue([]),
  };

  const thenableChain = Object.assign(Promise.resolve([]), selectChain);

  return {
    select: vi.fn().mockReturnValue(thenableChain),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
    ...overrides,
  };
}

const mockCompanyService = vi.hoisted(() => ({
  getById: vi.fn(),
  update: vi.fn(),
}));
const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
  update: vi.fn(),
}));
const mockHeartbeatService = vi.hoisted(() => ({
  cancelBudgetScopeWork: vi.fn().mockResolvedValue(undefined),
}));
const mockLogActivity = vi.hoisted(() => vi.fn());
const mockFetchAllQuotaWindows = vi.hoisted(() => vi.fn());
const mockCostService = vi.hoisted(() => ({
  createEvent: vi.fn(),
  summary: vi.fn().mockResolvedValue({ spendCents: 0 }),
  byAgent: vi.fn().mockResolvedValue([]),
  byAgentModel: vi.fn().mockResolvedValue([]),
  byProvider: vi.fn().mockResolvedValue([]),
  byBiller: vi.fn().mockResolvedValue([]),
  windowSpend: vi.fn().mockResolvedValue([]),
  byProject: vi.fn().mockResolvedValue([]),
}));
const mockFinanceService = vi.hoisted(() => ({
  createEvent: vi.fn(),
  summary: vi.fn().mockResolvedValue({ debitCents: 0, creditCents: 0, netCents: 0, estimatedDebitCents: 0, eventCount: 0 }),
  byBiller: vi.fn().mockResolvedValue([]),
  byKind: vi.fn().mockResolvedValue([]),
  list: vi.fn().mockResolvedValue([]),
}));
const mockEvaluateCostEvent = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockBudgetService = vi.hoisted(() => ({
  overview: vi.fn().mockResolvedValue({
    companyId: "company-1",
    policies: [],
    activeIncidents: [],
    pausedAgentCount: 0,
    pausedProjectCount: 0,
    pendingApprovalCount: 0,
  }),
  upsertPolicy: vi.fn(),
  resolveIncident: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  budgetService: () => mockBudgetService,
  costService: () => mockCostService,
  financeService: () => mockFinanceService,
  companyService: () => mockCompanyService,
  agentService: () => mockAgentService,
  heartbeatService: () => mockHeartbeatService,
  logActivity: mockLogActivity,
}));

vi.mock("../services/quota-windows.js", () => ({
  fetchAllQuotaWindows: mockFetchAllQuotaWindows,
}));

vi.mock("../services/budgets.js", () => ({
  budgetService: () => ({
    evaluateCostEvent: mockEvaluateCostEvent,
  }),
}));

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = { type: "board", userId: "board-user", source: "local_implicit" };
    next();
  });
  app.use("/api", costRoutes(makeDb() as any));
  app.use(errorHandler);
  return app;
}

function createAppWithActor(actor: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", costRoutes(makeDb() as any));
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCompanyService.update.mockResolvedValue({
    id: "company-1",
    name: "Paperclip",
    budgetMonthlyCents: 100,
    spentMonthlyCents: 0,
  });
  mockAgentService.update.mockResolvedValue({
    id: "agent-1",
    companyId: "company-1",
    name: "Budget Agent",
    budgetMonthlyCents: 100,
    spentMonthlyCents: 0,
  });
  mockBudgetService.upsertPolicy.mockResolvedValue(undefined);
});

describe("cost routes", () => {
  it("accepts valid ISO date strings and passes them to cost summary routes", async () => {
    const app = createApp();
    const res = await request(app)
      .get("/api/companies/company-1/costs/summary")
      .query({ from: "2026-01-01T00:00:00.000Z", to: "2026-01-31T23:59:59.999Z" });
    expect(res.status).toBe(200);
  });

  it("returns 400 for an invalid 'from' date string", async () => {
    const app = createApp();
    const res = await request(app)
      .get("/api/companies/company-1/costs/summary")
      .query({ from: "not-a-date" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid 'from' date/i);
  });

  it("returns 400 for an invalid 'to' date string", async () => {
    const app = createApp();
    const res = await request(app)
      .get("/api/companies/company-1/costs/summary")
      .query({ to: "banana" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid 'to' date/i);
  });

  it("returns finance summary rows for valid requests", async () => {
    const app = createApp();
    const res = await request(app)
      .get("/api/companies/company-1/costs/finance-summary")
      .query({ from: "2026-02-01T00:00:00.000Z", to: "2026-02-28T23:59:59.999Z" });
    expect(res.status).toBe(200);
    expect(mockFinanceService.summary).toHaveBeenCalled();
  });

  it("returns 400 for invalid finance event list limits", async () => {
    const app = createApp();
    const res = await request(app)
      .get("/api/companies/company-1/costs/finance-events")
      .query({ limit: "0" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid 'limit'/i);
  });

  it("accepts valid finance event list limits", async () => {
    const app = createApp();
    const res = await request(app)
      .get("/api/companies/company-1/costs/finance-events")
      .query({ limit: "25" });
    expect(res.status).toBe(200);
    expect(mockFinanceService.list).toHaveBeenCalledWith("company-1", undefined, 25);
  });

  it("rejects company budget updates for board users outside the company", async () => {
    const app = createAppWithActor({
      type: "board",
      userId: "board-user",
      source: "session",
      isInstanceAdmin: false,
      companyIds: ["company-2"],
    });

    const res = await request(app)
      .patch("/api/companies/company-1/budgets")
      .send({ budgetMonthlyCents: 2500 });

    expect(res.status).toBe(403);
    expect(mockCompanyService.update).not.toHaveBeenCalled();
  });

  it("rejects agent budget updates for board users outside the agent company", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      companyId: "company-1",
      name: "Budget Agent",
      budgetMonthlyCents: 100,
      spentMonthlyCents: 0,
    });
    const app = createAppWithActor({
      type: "board",
      userId: "board-user",
      source: "session",
      isInstanceAdmin: false,
      companyIds: ["company-2"],
    });

    const res = await request(app)
      .patch("/api/agents/agent-1/budgets")
      .send({ budgetMonthlyCents: 2500 });

    expect(res.status).toBe(403);
    expect(mockAgentService.update).not.toHaveBeenCalled();
  });

  it("rejects agent budget updates from the agent actor, including self-service changes", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      companyId: "company-1",
      name: "Budget Agent",
      budgetMonthlyCents: 100,
      spentMonthlyCents: 0,
    });
    const app = createAppWithActor({
      type: "agent",
      agentId: "agent-1",
      companyId: "company-1",
      source: "api_key",
    });

    const res = await request(app)
      .patch("/api/agents/agent-1/budgets")
      .send({ budgetMonthlyCents: 2500 });

    expect(res.status).toBe(403);
    expect(mockAgentService.update).not.toHaveBeenCalled();
    expect(mockBudgetService.upsertPolicy).not.toHaveBeenCalled();
  });
});

function createCostServiceDb(
  selectResults: unknown[],
  options: {
    onInsert?: (values: Record<string, unknown>) => void;
    insertReturning?: unknown[];
  } = {},
) {
  const pending = [...selectResults];
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    groupBy: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    then: vi.fn((resolve: (value: unknown[]) => unknown) => Promise.resolve(resolve(pending.shift() ?? []))),
  };

  return {
    select: vi.fn(() => chain),
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        options.onInsert?.(values);
        return {
          returning: vi.fn(async () => options.insertReturning ?? [values]),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => []),
      })),
    })),
  };
}

describe("costService.createEvent", () => {
  function createEventData(overrides: Record<string, unknown> = {}) {
    return {
      agentId: "agent-1",
      issueId: null,
      projectId: null,
      goalId: null,
      heartbeatRunId: null,
      billingCode: null,
      provider: "openai",
      biller: "openai",
      billingType: "unknown",
      model: "gpt-test",
      inputTokens: 1,
      cachedInputTokens: 0,
      outputTokens: 1,
      costCents: 1,
      occurredAt: new Date("2026-03-25T12:00:00.000Z"),
      ...overrides,
    };
  }

  it("rejects issue links that point at another company", async () => {
    const db = createCostServiceDb([
      [{ id: "agent-1", companyId: "company-1" }],
      [{ id: "issue-1", companyId: "company-2" }],
    ]);

    const service = costService(db as any);

    await expect(
      service.createEvent("company-1", {
        agentId: "agent-1",
        issueId: "issue-1",
        projectId: null,
        goalId: null,
        heartbeatRunId: null,
        billingCode: null,
        provider: "openai",
        biller: "openai",
        billingType: "unknown",
        model: "gpt-test",
        inputTokens: 1,
        cachedInputTokens: 0,
        outputTokens: 1,
        costCents: 1,
        occurredAt: new Date(),
      }),
    ).rejects.toThrow(/issue does not belong to company/i);
  });

  it("rejects project links that point at another company", async () => {
    const db = createCostServiceDb([
      [{ id: "agent-1", companyId: "company-1" }],
      [{ id: "project-1", companyId: "company-2" }],
    ]);

    const service = costService(db as any);

    await expect(
      service.createEvent("company-1", {
        agentId: "agent-1",
        issueId: null,
        projectId: "project-1",
        goalId: null,
        heartbeatRunId: null,
        billingCode: null,
        provider: "openai",
        biller: "openai",
        billingType: "unknown",
        model: "gpt-test",
        inputTokens: 1,
        cachedInputTokens: 0,
        outputTokens: 1,
        costCents: 1,
        occurredAt: new Date(),
      }),
    ).rejects.toThrow(/project does not belong to company/i);
  });

  it("rejects same-company issue links whose project and goal do not match the provided attribution", async () => {
    const db = createCostServiceDb([
      [{ id: "agent-1", companyId: "company-1" }],
      [{ id: "issue-1", companyId: "company-1", projectId: "project-1", goalId: "goal-1" }],
      [{ id: "project-2", companyId: "company-1" }],
      [{ id: "goal-2", companyId: "company-1" }],
    ]);

    const service = costService(db as any);

    await expect(
      service.createEvent("company-1", {
        agentId: "agent-1",
        issueId: "issue-1",
        projectId: "project-2",
        goalId: "goal-2",
        heartbeatRunId: null,
        billingCode: null,
        provider: "openai",
        biller: "openai",
        billingType: "unknown",
        model: "gpt-test",
        inputTokens: 1,
        cachedInputTokens: 0,
        outputTokens: 1,
        costCents: 1,
        occurredAt: new Date(),
      }),
    ).rejects.toThrow(/project must match linked issue/i);
  });

  it("rejects caller-supplied project attribution when the linked issue has no project", async () => {
    const db = createCostServiceDb([
      [{ id: "agent-1", companyId: "company-1" }],
      [{ id: "issue-1", companyId: "company-1", projectId: null, goalId: null }],
      [{ id: "project-2", companyId: "company-1" }],
    ]);

    const service = costService(db as any);

    await expect(
      service.createEvent(
        "company-1",
        createEventData({
          issueId: "issue-1",
          projectId: "project-2",
        }),
      ),
    ).rejects.toThrow(/project must match linked issue/i);
  });

  it("rejects caller-supplied goal attribution when the linked issue has no goal", async () => {
    const db = createCostServiceDb([
      [{ id: "agent-1", companyId: "company-1" }],
      [{ id: "issue-1", companyId: "company-1", projectId: null, goalId: null }],
      [{ id: "goal-2", companyId: "company-1" }],
    ]);

    const service = costService(db as any);

    await expect(
      service.createEvent(
        "company-1",
        createEventData({
          issueId: "issue-1",
          goalId: "goal-2",
        }),
      ),
    ).rejects.toThrow(/goal must match linked issue/i);
  });

  it("inherits linked issue project and goal attribution when omitted by the caller", async () => {
    let insertedValues: Record<string, unknown> | null = null;
    const db = createCostServiceDb(
      [
        [{ id: "agent-1", companyId: "company-1" }],
        [{ id: "issue-1", companyId: "company-1", projectId: "project-1", goalId: "goal-1" }],
        [{ companyId: "company-1" }],
        [{ companyId: "company-1" }],
        [{ total: 1 }],
        [{ total: 1 }],
      ],
      {
        onInsert: (values) => {
          insertedValues = values;
        },
      },
    );

    const service = costService(db as any);

    const event = await service.createEvent(
      "company-1",
      createEventData({
        issueId: "issue-1",
        projectId: null,
        goalId: null,
      }),
    );

    expect(insertedValues).toMatchObject({
      companyId: "company-1",
      issueId: "issue-1",
      projectId: "project-1",
      goalId: "goal-1",
    });
    expect(event).toMatchObject({
      issueId: "issue-1",
      projectId: "project-1",
      goalId: "goal-1",
    });
    expect(mockEvaluateCostEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: "issue-1",
        projectId: "project-1",
        goalId: "goal-1",
      }),
    );
  });

  it("rejects heartbeat run links that belong to another agent in the same company", async () => {
    const db = createCostServiceDb([
      [{ id: "agent-1", companyId: "company-1" }],
      [{ id: "run-1", companyId: "company-1", agentId: "agent-2" }],
    ]);

    const service = costService(db as any);

    await expect(
      service.createEvent("company-1", {
        agentId: "agent-1",
        issueId: null,
        projectId: null,
        goalId: null,
        heartbeatRunId: "run-1",
        billingCode: null,
        provider: "openai",
        biller: "openai",
        billingType: "unknown",
        model: "gpt-test",
        inputTokens: 1,
        cachedInputTokens: 0,
        outputTokens: 1,
        costCents: 1,
        occurredAt: new Date(),
      }),
    ).rejects.toThrow(/heartbeat run must belong to the same agent/i);
  });
});
