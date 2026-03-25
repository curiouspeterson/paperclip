import { authUsers, cliAuthChallenges, companyMemberships, instanceUserRoles } from "@paperclipai/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { boardAuthService, hashBearerToken } from "../services/board-auth.js";

function createDbStub(input?: {
  companyIds?: string[];
  isInstanceAdmin?: boolean;
  requestedCompanyId?: string | null;
}) {
  const challenge = {
    id: "challenge-1",
    secretHash: hashBearerToken("pcp_cli_auth_secret"),
    command: "paperclipai company import",
    clientName: "paperclipai cli",
    requestedAccess: "board",
    requestedCompanyId: input?.requestedCompanyId ?? "company-1",
    pendingKeyHash: hashBearerToken("pcp_board_token"),
    pendingKeyName: "paperclipai cli (board)",
    approvedByUserId: null,
    boardApiKeyId: null,
    approvedAt: null,
    cancelledAt: null,
    expiresAt: new Date("2026-04-25T00:00:00.000Z"),
    createdAt: new Date("2026-03-25T00:00:00.000Z"),
    updatedAt: new Date("2026-03-25T00:00:00.000Z"),
  };

  const rowsByTable = new Map<object, unknown[]>([
    [authUsers, [{ id: "user-2", name: "User Two", email: "user-2@example.com" }]],
    [(companyMemberships as unknown) as object, (input?.companyIds ?? []).map((companyId) => ({ companyId }))],
    [instanceUserRoles, input?.isInstanceAdmin ? [{ id: "role-1" }] : []],
    [(cliAuthChallenges as unknown) as object, [challenge]],
  ]);

  const select = vi.fn(() => ({
    from: (table: object) => ({
      where: vi.fn(async () => rowsByTable.get(table) ?? []),
    }),
  }));

  const insertReturning = vi.fn(async () => [{ id: "board-key-1" }]);
  const insertValues = vi.fn(() => ({ returning: insertReturning }));
  const insert = vi.fn(() => ({ values: insertValues }));

  const updateReturning = vi.fn(async () => [
    {
      ...challenge,
      boardApiKeyId: "board-key-1",
      approvedByUserId: "user-2",
      approvedAt: new Date("2026-03-25T00:05:00.000Z"),
    },
  ]);
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));

  const execute = vi.fn(async () => undefined);
  const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({ execute, select, insert, update }),
  );

  return {
    db: { select, transaction },
    insert,
    update,
  };
}

describe("boardAuthService CLI approval access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects company-scoped approvals for board users outside the requested company", async () => {
    const { db, insert, update } = createDbStub({
      companyIds: ["company-2"],
      isInstanceAdmin: false,
      requestedCompanyId: "company-1",
    });

    await expect(
      boardAuthService(db as any).approveCliAuthChallenge("challenge-1", "pcp_cli_auth_secret", {
        userId: "user-2",
        companyIds: ["company-2"],
        isInstanceAdmin: false,
      } as any),
    ).rejects.toMatchObject({
      status: 403,
      message: "User does not have access to the requested company",
    });

    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
