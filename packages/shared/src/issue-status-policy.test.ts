import { describe, expect, it } from "vitest";
import {
  ISSUE_OPEN_STATUSES,
  isIssueClosedStatus,
  isIssueOpenStatus,
} from "./index.js";

describe("issue status policy", () => {
  it("exports the canonical set of open issue statuses", () => {
    expect(ISSUE_OPEN_STATUSES).toEqual([
      "backlog",
      "todo",
      "in_progress",
      "in_review",
      "blocked",
    ]);
  });

  it("classifies open and closed statuses consistently", () => {
    expect(isIssueOpenStatus("backlog")).toBe(true);
    expect(isIssueOpenStatus("blocked")).toBe(true);
    expect(isIssueOpenStatus("done")).toBe(false);

    expect(isIssueClosedStatus("done")).toBe(true);
    expect(isIssueClosedStatus("cancelled")).toBe(true);
    expect(isIssueClosedStatus("todo")).toBe(false);
  });
});
