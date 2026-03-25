type ActiveRun = {
  id: string;
  status: string;
  contextSnapshot?: Record<string, unknown> | null;
};

type ActiveRunLookup = {
  getRun(runId: string): Promise<ActiveRun | null>;
  getActiveRunForAgent(agentId: string): Promise<ActiveRun | null>;
};

type IssueRunContext = {
  id: string;
  assigneeAgentId: string | null;
  executionRunId?: string | null;
};

export async function findRunningExecutionForIssue(
  heartbeat: ActiveRunLookup,
  issue: IssueRunContext,
) {
  if (issue.executionRunId) {
    const run = await heartbeat.getRun(issue.executionRunId);
    if (run?.status === "running") return run;
  }

  if (!issue.assigneeAgentId) return null;
  const activeRun = await heartbeat.getActiveRunForAgent(issue.assigneeAgentId);
  const activeIssueId =
    activeRun &&
      activeRun.contextSnapshot &&
      typeof activeRun.contextSnapshot === "object" &&
      typeof (activeRun.contextSnapshot as Record<string, unknown>).issueId === "string"
      ? ((activeRun.contextSnapshot as Record<string, unknown>).issueId as string)
      : null;
  if (activeRun?.status === "running" && activeIssueId === issue.id) return activeRun;
  return null;
}
