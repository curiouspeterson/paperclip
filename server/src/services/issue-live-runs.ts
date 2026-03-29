import type { Db } from "@paperclipai/db";
import { agents, heartbeatRuns } from "@paperclipai/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

export interface IssueLiveRunSummary {
  id: string;
  status: string;
  invocationSource: string;
  triggerDetail: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  agentId: string;
  agentName: string;
  adapterType: string;
}

type IssueRunIdentity = {
  id: string;
  status: string;
  contextSnapshot?: unknown;
};

type ActiveRunSelectionInput = {
  issue: {
    id: string;
    status: string;
    executionRunId: string | null;
    assigneeAgentId: string | null;
  };
  liveRuns: Array<Pick<IssueLiveRunSummary, "id" | "createdAt">>;
  executionRun: IssueRunIdentity | null;
  assigneeRun: IssueRunIdentity | null;
};

function readIssueIdFromContextSnapshot(contextSnapshot: unknown): string | null {
  if (!contextSnapshot || typeof contextSnapshot !== "object" || Array.isArray(contextSnapshot)) return null;
  const issueId = (contextSnapshot as Record<string, unknown>).issueId;
  return typeof issueId === "string" && issueId.trim().length > 0 ? issueId.trim() : null;
}

function isActiveHeartbeatRunStatus(status: string | null | undefined): boolean {
  return status === "queued" || status === "running";
}

function toTimestamp(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

export async function listIssueLiveRuns(
  db: Db,
  companyId: string,
  issueId: string,
): Promise<IssueLiveRunSummary[]> {
  return db
    .select({
      id: heartbeatRuns.id,
      status: heartbeatRuns.status,
      invocationSource: heartbeatRuns.invocationSource,
      triggerDetail: heartbeatRuns.triggerDetail,
      startedAt: heartbeatRuns.startedAt,
      finishedAt: heartbeatRuns.finishedAt,
      createdAt: heartbeatRuns.createdAt,
      agentId: heartbeatRuns.agentId,
      agentName: agents.name,
      adapterType: agents.adapterType,
    })
    .from(heartbeatRuns)
    .innerJoin(agents, eq(heartbeatRuns.agentId, agents.id))
    .where(
      and(
        eq(heartbeatRuns.companyId, companyId),
        inArray(heartbeatRuns.status, ["queued", "running"]),
        sql`${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${issueId}`,
      ),
    )
    .orderBy(desc(heartbeatRuns.createdAt));
}

export function pickIssueActiveRunId(input: ActiveRunSelectionInput): string | null {
  if (input.executionRun && isActiveHeartbeatRunStatus(input.executionRun.status)) {
    return input.executionRun.id;
  }

  const latestLinkedRun = [...input.liveRuns].sort(
    (left, right) => toTimestamp(right.createdAt) - toTimestamp(left.createdAt),
  )[0];
  if (latestLinkedRun) {
    return latestLinkedRun.id;
  }

  if (
    input.assigneeRun &&
    isActiveHeartbeatRunStatus(input.assigneeRun.status) &&
    input.issue.status === "in_progress" &&
    readIssueIdFromContextSnapshot(input.assigneeRun.contextSnapshot) === input.issue.id
  ) {
    return input.assigneeRun.id;
  }

  return null;
}
