import { describe, expect, it } from "vitest";
import type { IssueViewState } from "../components/IssuesList";
import { buildInitialIssueViewState, getIssueBlockerTypesFromSearchParams } from "./issues-view-state";

const storedViewState: IssueViewState = {
  statuses: ["done"],
  priorities: ["high"],
  assignees: ["agent-1"],
  labels: ["label-1"],
  projects: ["project-1"],
  blockerTypes: ["missing_secret"],
  sortField: "created",
  sortDir: "asc",
  groupBy: "priority",
  viewMode: "board",
  collapsedGroups: ["done"],
};

describe("issues view state helpers", () => {
  it("reads blocker filters from the query string", () => {
    const params = new URLSearchParams("blocker=delegated_child_execution&blocker=missing_secret");

    expect(getIssueBlockerTypesFromSearchParams(params)).toEqual([
      "delegated_child_execution",
      "missing_secret",
    ]);
  });

  it("overrides stored filters when deep-link blocker filters are present", () => {
    const next = buildInitialIssueViewState({
      storedState: storedViewState,
      initialAssignees: undefined,
      initialBlockerTypes: ["delegated_child_execution"],
    });

    expect(next).toEqual({
      ...storedViewState,
      statuses: [],
      priorities: [],
      assignees: [],
      labels: [],
      projects: [],
      blockerTypes: ["delegated_child_execution"],
      sortField: "updated",
      sortDir: "desc",
      groupBy: "none",
      viewMode: "list",
      collapsedGroups: [],
    });
  });

  it("still honors assignee deep links using the default list state", () => {
    const next = buildInitialIssueViewState({
      storedState: storedViewState,
      initialAssignees: ["me"],
      initialBlockerTypes: [],
    });

    expect(next.assignees).toEqual(["me"]);
    expect(next.blockerTypes).toEqual([]);
    expect(next.statuses).toEqual([]);
    expect(next.sortField).toBe("updated");
  });
});
