import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issuesApi } from "./issues";

const fetchMock = vi.fn();

function mockJsonResponse(body: unknown) {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  } as Response);
}

describe("issuesApi", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the shared checkout statuses when claiming an issue", async () => {
    mockJsonResponse({ id: "issue-1", status: "in_progress" });

    await issuesApi.checkout("issue-1", "agent-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/issues/issue-1/checkout",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          agentId: "agent-1",
          expectedStatuses: ["todo", "backlog", "blocked", "in_review"],
        }),
      }),
    );
  });
});
