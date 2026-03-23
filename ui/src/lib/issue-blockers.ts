import type { Issue, IssueBlockerDetails, IssueBlockerType } from "@paperclipai/shared";

export const blockerTypeLabels: Record<IssueBlockerType, string> = {
  missing_secret: "Missing secret",
  browser_login_required: "Browser login required",
  external_access: "External access",
  operator_action: "Operator action",
  delegated_child_execution: "Delegated child execution",
  unsupported_automation: "Unsupported automation",
  unknown: "Other blocker",
};

export function getIssueBlockerDetails(issue: Issue): IssueBlockerDetails | null {
  return (issue.blockerDetails ?? null) as IssueBlockerDetails | null;
}

export function getIssueBlockerSummary(issue: Issue): string | null {
  return getIssueBlockerDetails(issue)?.summary ?? null;
}

export function issueMatchesBlockerTypes(issue: Issue, blockerTypes: IssueBlockerType[]): boolean {
  if (blockerTypes.length === 0) return true;
  const blockerType = getIssueBlockerDetails(issue)?.blockerType;
  return blockerType ? blockerTypes.includes(blockerType) : false;
}

export function getDelegatedChildIssueTarget(issue: Issue) {
  const blockerDetails = getIssueBlockerDetails(issue);
  if (blockerDetails?.blockerType !== "delegated_child_execution") return null;
  const issueId = blockerDetails.delegatedChildIssueId ?? null;
  const identifier = blockerDetails.delegatedChildIdentifier ?? null;
  const issuePathId = identifier ?? issueId;
  if (!issuePathId || !issueId) return null;
  return {
    issueId,
    issuePathId,
    identifier: identifier ?? issueId,
  };
}
