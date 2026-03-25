import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCheckout, mockUpdate } = vi.hoisted(() => ({
  mockCheckout: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock("../api/issues", () => ({
  issuesApi: {
    checkout: mockCheckout,
    update: mockUpdate,
  },
}));

import { saveIssuePatchWithCheckout } from "./issue-mutations";

describe("saveIssuePatchWithCheckout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses checkout instead of patch when moving an issue into in_progress with an explicit assignee", async () => {
    mockCheckout.mockResolvedValue({ id: "issue-1" });

    const patch = { status: "in_progress", assigneeAgentId: "agent-2", priority: "high" };
    const result = await saveIssuePatchWithCheckout("issue-1", null, patch);

    expect(mockCheckout).toHaveBeenCalledWith("issue-1", "agent-2");
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(result).toEqual({ id: "issue-1" });
  });

  it("falls back to the current assignee when checkout is requested without a patch assignee", async () => {
    mockCheckout.mockResolvedValue({ id: "issue-1" });

    await saveIssuePatchWithCheckout(
      "issue-1",
      {
        assigneeAgentId: "agent-1",
      } as never,
      { status: "in_progress" },
    );

    expect(mockCheckout).toHaveBeenCalledWith("issue-1", "agent-1");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects in_progress transitions that do not resolve to an assignee", async () => {
    await expect(
      saveIssuePatchWithCheckout("issue-1", null, { status: "in_progress" }),
    ).rejects.toThrow("Issue must have an assignee before checkout");

    expect(mockCheckout).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("uses the generic update path for non-checkout patches", async () => {
    mockUpdate.mockResolvedValue({ id: "issue-1", status: "blocked" });

    const patch = { status: "blocked", priority: "low" };
    const result = await saveIssuePatchWithCheckout("issue-1", null, patch);

    expect(mockUpdate).toHaveBeenCalledWith("issue-1", patch);
    expect(mockCheckout).not.toHaveBeenCalled();
    expect(result).toEqual({ id: "issue-1", status: "blocked" });
  });
});
