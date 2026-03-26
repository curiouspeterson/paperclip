import type { Issue } from "@paperclipai/shared";
import { issuesApi } from "../api/issues";

export async function saveIssuePatchWithCheckout(
  issueId: string,
  issue: Issue | null | undefined,
  patch: Record<string, unknown>,
) {
  if (patch.status === "in_progress") {
    const assigneeAgentId =
      typeof patch.assigneeAgentId === "string"
        ? patch.assigneeAgentId
        : issue?.assigneeAgentId ?? null;
    if (!assigneeAgentId) {
      throw new Error("Issue must have an assignee before checkout");
    }
    return issuesApi.checkout(issueId, assigneeAgentId);
  }

  return issuesApi.update(issueId, patch);
}
