import { describe, expect, it } from "vitest";
import type { Issue } from "@paperclipai/shared";
import {
  getDelegatedChildIssueTarget,
  getIssueBlockerSummary,
  issueMatchesBlockerTypes,
} from "./issue-blockers";

function makeIssue(overrides?: Partial<Issue>): Issue {
  return {
    id: "issue-1",
    companyId: "company-1",
    projectId: null,
    projectWorkspaceId: null,
    goalId: null,
    parentId: null,
    delegationKey: null,
    title: "Blocked issue",
    description: null,
    status: "blocked",
    priority: "medium",
    assigneeAgentId: null,
    assigneeUserId: null,
    checkoutRunId: null,
    executionRunId: null,
    executionAgentNameKey: null,
    executionLockedAt: null,
    createdByAgentId: null,
    createdByUserId: null,
    issueNumber: 42,
    identifier: "PAP-42",
    requestDepth: 0,
    billingCode: null,
    assigneeAdapterOverrides: null,
    executionWorkspaceId: null,
    executionWorkspacePreference: null,
    executionWorkspaceSettings: null,
    blockerDetails: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    hiddenAt: null,
    createdAt: new Date("2026-03-23T00:00:00.000Z"),
    updatedAt: new Date("2026-03-23T00:00:00.000Z"),
    ...overrides,
  };
}

describe("issue blocker helpers", () => {
  it("surfaces delegated child summaries and targets for blocked issues", () => {
    const issue = makeIssue({
      blockerDetails: {
        blockerType: "delegated_child_execution",
        summary: "Waiting on delegated child issue PAP-581",
        delegatedChildIssueId: "child-1",
        delegatedChildIdentifier: "PAP-581",
      },
    });

    expect(getIssueBlockerSummary(issue)).toBe("Waiting on delegated child issue PAP-581");
    expect(getDelegatedChildIssueTarget(issue)).toEqual({
      issueId: "child-1",
      issuePathId: "PAP-581",
      identifier: "PAP-581",
    });
  });

  it("filters issues by blocker type without matching unblocked issues", () => {
    const delegated = makeIssue({
      blockerDetails: {
        blockerType: "delegated_child_execution",
        summary: "Waiting on delegated child issue PAP-581",
      },
    });
    const secret = makeIssue({
      blockerDetails: {
        blockerType: "missing_secret",
        summary: "Need MAILCHIMP_API_KEY",
      },
    });
    const clear = makeIssue({ status: "todo" });

    expect(issueMatchesBlockerTypes(delegated, ["delegated_child_execution"])).toBe(true);
    expect(issueMatchesBlockerTypes(secret, ["delegated_child_execution"])).toBe(false);
    expect(issueMatchesBlockerTypes(clear, ["delegated_child_execution"])).toBe(false);
  });
});
