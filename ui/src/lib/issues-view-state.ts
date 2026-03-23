import type { IssueBlockerType } from "@paperclipai/shared";
import type { IssueViewState } from "../components/IssuesList";

const issueBlockerTypes = new Set<IssueBlockerType>([
  "delegated_child_execution",
  "missing_secret",
  "browser_login_required",
  "external_access",
  "operator_action",
  "unsupported_automation",
  "unknown",
]);

export const defaultIssueViewState: IssueViewState = {
  statuses: [],
  priorities: [],
  assignees: [],
  labels: [],
  projects: [],
  blockerTypes: [],
  sortField: "updated",
  sortDir: "desc",
  groupBy: "none",
  viewMode: "list",
  collapsedGroups: [],
};

export function getIssueBlockerTypesFromSearchParams(
  searchParams: URLSearchParams,
): IssueBlockerType[] {
  return searchParams
    .getAll("blocker")
    .filter((value): value is IssueBlockerType => issueBlockerTypes.has(value as IssueBlockerType));
}

export function buildInitialIssueViewState({
  storedState,
  initialAssignees,
  initialBlockerTypes,
}: {
  storedState: IssueViewState;
  initialAssignees?: string[];
  initialBlockerTypes?: IssueBlockerType[];
}): IssueViewState {
  if (initialAssignees && initialAssignees.length > 0) {
    return {
      ...defaultIssueViewState,
      assignees: initialAssignees,
    };
  }

  if (initialBlockerTypes && initialBlockerTypes.length > 0) {
    return {
      ...defaultIssueViewState,
      blockerTypes: initialBlockerTypes,
    };
  }

  return storedState;
}
