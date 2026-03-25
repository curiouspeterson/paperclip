import express from "express";
import request from "supertest";
import { agentApiKeys, agents, boardApiKeys, companyMemberships, instanceUserRoles } from "@paperclipai/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { actorMiddleware } from "../middleware/auth.js";
import { errorHandler } from "../middleware/index.js";
import { accessRoutes } from "../routes/access.js";
import { hashBearerToken } from "../services/board-auth.js";

const mockAccessService = vi.hoisted(() => ({
  isInstanceAdmin: vi.fn(),
  hasPermission: vi.fn(),
  canUser: vi.fn(),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockBoardAuthService = vi.hoisted(() => ({
  createCliAuthChallenge: vi.fn(),
  describeCliAuthChallenge: vi.fn(),
  approveCliAuthChallenge: vi.fn(),
  cancelCliAuthChallenge: vi.fn(),
  resolveBoardAccess: vi.fn(),
  resolveBoardActivityCompanyIds: vi.fn(),
  assertCurrentBoardKey: vi.fn(),
  revokeBoardApiKey: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  agentService: () => mockAgentService,
  boardAuthService: () => mockBoardAuthService,
  logActivity: mockLogActivity,
  notifyHireApproved: vi.fn(),
  deduplicateAgentName: vi.fn((name: string) => name),
}));

function createDbStub() {
  const rowsByTable = new Map<object, unknown[]>([
    [
      boardApiKeys,
      [
        {
          id: "board-key-1",
          userId: "user-1",
          name: "paperclipai cli (board)",
          keyHash: hashBearerToken("pcp_board_token"),
          lastUsedAt: null,
          revokedAt: null,
          expiresAt: new Date("2026-04-25T00:00:00.000Z"),
          createdAt: new Date("2026-03-25T00:00:00.000Z"),
        },
      ],
    ],
    [companyMemberships, [{ companyId: "company-1" }]],
    [instanceUserRoles, []],
    [agentApiKeys, []],
    [agents, []],
  ]);

  const select = vi.fn(() => ({
    from: (table: object) => ({
      where: vi.fn(async () => rowsByTable.get(table) ?? []),
    }),
  }));

  const updateWhere = vi.fn(async () => undefined);
  const set = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set }));

  return {
    db: { select, update },
    updateWhere,
  };
}

function createApp(db: any) {
  const app = express();
  app.use(express.json());
  app.use(actorMiddleware(db, { deploymentMode: "authenticated" }));
  app.use(
    "/api",
    accessRoutes(db, {
      deploymentMode: "authenticated",
      deploymentExposure: "private",
      bindHost: "127.0.0.1",
      allowedHostnames: [],
    }),
  );
  app.use(errorHandler);
  return app;
}

describe("board API key auth middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBoardAuthService.resolveBoardAccess.mockResolvedValue({
      user: { id: "user-1", name: "User One", email: "user@example.com" },
      companyIds: ["company-1"],
      isInstanceAdmin: false,
    });
  });

  it("authenticates board API bearer tokens through actor middleware", async () => {
    const { db, updateWhere } = createDbStub();
    const res = await request(createApp(db))
      .get("/api/cli-auth/me")
      .set("authorization", "Bearer pcp_board_token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      user: { id: "user-1", name: "User One", email: "user@example.com" },
      userId: "user-1",
      isInstanceAdmin: false,
      companyIds: ["company-1"],
      source: "board_key",
      keyId: "board-key-1",
    });
    expect(updateWhere).toHaveBeenCalledTimes(1);
    expect(mockBoardAuthService.resolveBoardAccess).toHaveBeenCalledWith("user-1");
  });
});
