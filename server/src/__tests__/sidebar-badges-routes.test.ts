import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sidebarBadgeRoutes } from "../routes/sidebar-badges.js";
import { errorHandler } from "../middleware/index.js";

const mockSidebarBadgeService = vi.hoisted(() => ({
  get: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(),
  hasPermission: vi.fn(),
}));

const mockDashboardService = vi.hoisted(() => ({
  summary: vi.fn(),
}));

vi.mock("../services/sidebar-badges.js", () => ({
  sidebarBadgeService: () => mockSidebarBadgeService,
}));

vi.mock("../services/access.js", () => ({
  accessService: () => mockAccessService,
}));

vi.mock("../services/dashboard.js", () => ({
  dashboardService: () => mockDashboardService,
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
  app.use("/api", sidebarBadgeRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe("sidebar badge routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccessService.canUser.mockResolvedValue(false);
    mockAccessService.hasPermission.mockResolvedValue(false);
    mockSidebarBadgeService.get.mockResolvedValue({
      inbox: 1,
      approvals: 1,
      failedRuns: 0,
      joinRequests: 0,
    });
    mockDashboardService.summary.mockResolvedValue({
      companyId: "company-1",
      agents: {
        active: 1,
        running: 0,
        paused: 0,
        error: 0,
      },
      tasks: {
        open: 4,
        inProgress: 1,
        blocked: 2,
        waitingOnDelegatedChild: 0,
        done: 1,
      },
      costs: {
        monthSpendCents: 100,
        monthBudgetCents: 1000,
        monthUtilizationPercent: 10,
      },
      pendingApprovals: 0,
      budgets: {
        activeIncidents: 0,
        pendingApprovals: 0,
        pausedAgents: 0,
        pausedProjects: 0,
      },
    });
  });

  it("includes delegated coordination waits in the inbox alert count", async () => {
    mockDashboardService.summary.mockResolvedValue({
      companyId: "company-1",
      agents: {
        active: 1,
        running: 0,
        paused: 0,
        error: 0,
      },
      tasks: {
        open: 4,
        inProgress: 1,
        blocked: 2,
        waitingOnDelegatedChild: 3,
        done: 1,
      },
      costs: {
        monthSpendCents: 100,
        monthBudgetCents: 1000,
        monthUtilizationPercent: 10,
      },
      pendingApprovals: 0,
      budgets: {
        activeIncidents: 0,
        pendingApprovals: 0,
        pausedAgents: 0,
        pausedProjects: 0,
      },
    });

    const res = await request(createApp()).get("/api/companies/company-1/sidebar-badges");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      inbox: 2,
      approvals: 1,
      failedRuns: 0,
      joinRequests: 0,
    });
    expect(mockSidebarBadgeService.get).toHaveBeenCalledWith("company-1", {
      joinRequests: 0,
    });
  });
});
