import { createHash } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  assets,
  companies,
  companyMemberships,
  documents,
  goals,
  heartbeatRuns,
  executionWorkspaces,
  issueAttachments,
  issueLabels,
  issueComments,
  issueDocuments,
  issueReadStates,
  issues,
  labels,
  projectWorkspaces,
  projects,
} from "@paperclipai/db";
import { extractProjectMentionIds, ISSUE_CHECKOUT_EXPECTED_STATUSES } from "@paperclipai/shared";
import { conflict, notFound, unprocessable } from "../errors.js";
import {
  defaultIssueExecutionWorkspaceSettingsForProject,
  gateProjectExecutionWorkspacePolicy,
  parseProjectExecutionWorkspacePolicy,
} from "./execution-workspace-policy.js";
import { instanceSettingsService } from "./instance-settings.js";
import { redactCurrentUserText } from "../log-redaction.js";
import { resolveIssueGoalId, resolveNextIssueGoalId } from "./issue-goal-fallback.js";
import { getDefaultCompanyGoal } from "./goals.js";

const ALL_ISSUE_STATUSES = ["backlog", "todo", "in_progress", "in_review", "blocked", "done", "cancelled"];
const OPEN_ISSUE_STATUSES = ["backlog", "todo", "in_progress", "in_review", "blocked"] as const;
const ISSUE_CHECKOUT_ALLOWED_STATUS_SET = new Set<string>(ISSUE_CHECKOUT_EXPECTED_STATUSES);
const MAX_ISSUE_COMMENT_PAGE_LIMIT = 500;
const MAX_OPEN_DELEGATED_CHILDREN_PER_PARENT = 20;
const MAX_RECENT_DELEGATED_CHILDREN_PER_PARENT = 5;
const DELEGATED_CHILD_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const DELEGATED_CHILD_EXECUTION_BLOCKER_TYPE = "delegated_child_execution";

function normalizeDelegatedIssueTitle(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeDelegationKey(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function deriveDelegationKey(input: {
  createdByAgentId: string;
  title: string;
  assigneeAgentId?: string | null;
  assigneeUserId?: string | null;
  projectId?: string | null;
  goalId?: string | null;
  requestDepth?: number | null;
}) {
  const hash = createHash("sha256");
  hash.update(JSON.stringify({
    createdByAgentId: input.createdByAgentId,
    title: normalizeDelegatedIssueTitle(input.title),
    assigneeAgentId: input.assigneeAgentId ?? null,
    assigneeUserId: input.assigneeUserId ?? null,
    projectId: input.projectId ?? null,
    goalId: input.goalId ?? null,
    requestDepth: input.requestDepth ?? 0,
  }));
  return `delegated:${hash.digest("hex")}`;
}

function resolveDelegationKey(input: {
  parentId?: string | null;
  createdByAgentId?: string | null;
  title: string;
  assigneeAgentId?: string | null;
  assigneeUserId?: string | null;
  projectId?: string | null;
  goalId?: string | null;
  requestDepth?: number | null;
  delegationKey?: string | null;
}) {
  if (!input.parentId || !input.createdByAgentId) return null;
  if (!input.assigneeAgentId && !input.assigneeUserId) return null;
  const explicitKey = normalizeDelegationKey(input.delegationKey);
  if (explicitKey) return explicitKey;
  return deriveDelegationKey({
    createdByAgentId: input.createdByAgentId,
    title: input.title,
    assigneeAgentId: input.assigneeAgentId ?? null,
    assigneeUserId: input.assigneeUserId ?? null,
    projectId: input.projectId ?? null,
    goalId: input.goalId ?? null,
    requestDepth: input.requestDepth ?? 0,
  });
}

function nullSafeEqual(left: string | null | undefined, right: string | null | undefined) {
  return (left ?? null) === (right ?? null);
}

function isUniqueViolation(error: unknown, constraint?: string) {
  return !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "23505" &&
    (constraint === undefined || ("constraint" in error && (error as { constraint?: string }).constraint === constraint));
}

function isOpenDelegatedChild(input: {
  parentId?: string | null;
  createdByAgentId?: string | null;
  assigneeAgentId?: string | null;
  assigneeUserId?: string | null;
}) {
  return Boolean(
    input.parentId &&
    input.createdByAgentId &&
    (input.assigneeAgentId || input.assigneeUserId),
  );
}

function assertTransition(from: string, to: string) {
  if (!ALL_ISSUE_STATUSES.includes(to)) {
    throw conflict(`Unknown issue status: ${to}`);
  }
  if (to === "in_progress") {
    throw unprocessable("Use checkout to set issue status to in_progress");
  }
  if (from === to) return;
}

function applyStatusSideEffects(
  status: string | undefined,
  patch: Partial<typeof issues.$inferInsert>,
): Partial<typeof issues.$inferInsert> {
  if (!status) return patch;

  if (status === "in_progress" && !patch.startedAt) {
    patch.startedAt = new Date();
  }
  if (status === "done") {
    patch.completedAt = new Date();
  }
  if (status === "cancelled") {
    patch.cancelledAt = new Date();
  }
  return patch;
}

function isDelegatedChildExecutionBlockerDetails(value: Record<string, unknown> | null | undefined) {
  return value?.blockerType === DELEGATED_CHILD_EXECUTION_BLOCKER_TYPE;
}

function buildDelegatedChildExecutionBlockerDetails(input: {
  delegatedChildIssueId: string;
  delegatedChildIdentifier: string;
}): Record<string, unknown> {
  return {
    blockerType: DELEGATED_CHILD_EXECUTION_BLOCKER_TYPE,
    summary: `Waiting on delegated child issue ${input.delegatedChildIdentifier}`,
    detail:
      `Delegated child ${input.delegatedChildIdentifier} is now the active execution path. ` +
      "Resume this coordination issue only when that work changes state or needs intervention.",
    requiredAction: "Wait for the delegated child issue to finish or manually resume coordination work.",
    delegatedChildIssueId: input.delegatedChildIssueId,
    delegatedChildIdentifier: input.delegatedChildIdentifier,
  };
}

export interface IssueFilters {
  status?: string;
  assigneeAgentId?: string;
  assigneeUserId?: string;
  touchedByUserId?: string;
  unreadForUserId?: string;
  projectId?: string;
  parentId?: string;
  labelId?: string;
  originKind?: string;
  originId?: string;
  includeRoutineExecutions?: boolean;
  q?: string;
}

type IssueRow = typeof issues.$inferSelect;
type IssueCommentRow = typeof issueComments.$inferSelect;
type IssueLabelRow = typeof labels.$inferSelect;
type IssueActiveRunRow = {
  id: string;
  status: string;
  agentId: string;
  invocationSource: string;
  triggerDetail: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
};
type IssueWithLabels = IssueRow & { labels: IssueLabelRow[]; labelIds: string[] };
type IssueWithLabelsAndRun = IssueWithLabels & { activeRun: IssueActiveRunRow | null };
type CreateIssueResult = {
  issue: IssueWithLabels;
  created: boolean;
  blockedParentIssue?: IssueWithLabels | null;
  blockedParentComment?: IssueCommentRow | null;
};
type IssueUserCommentStats = {
  issueId: string;
  myLastCommentAt: Date | null;
  lastExternalCommentAt: Date | null;
};
type IssueUserContextInput = {
  createdByUserId: string | null;
  assigneeUserId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

function sameRunLock(checkoutRunId: string | null, actorRunId: string | null) {
  if (actorRunId) return checkoutRunId === actorRunId;
  return checkoutRunId == null;
}

const TERMINAL_HEARTBEAT_RUN_STATUSES = new Set(["succeeded", "failed", "cancelled", "timed_out"]);

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function touchedByUserCondition(companyId: string, userId: string) {
  return sql<boolean>`
    (
      ${issues.createdByUserId} = ${userId}
      OR ${issues.assigneeUserId} = ${userId}
      OR EXISTS (
        SELECT 1
        FROM ${issueReadStates}
        WHERE ${issueReadStates.issueId} = ${issues.id}
          AND ${issueReadStates.companyId} = ${companyId}
          AND ${issueReadStates.userId} = ${userId}
      )
      OR EXISTS (
        SELECT 1
        FROM ${issueComments}
        WHERE ${issueComments.issueId} = ${issues.id}
          AND ${issueComments.companyId} = ${companyId}
          AND ${issueComments.authorUserId} = ${userId}
      )
    )
  `;
}

function myLastCommentAtExpr(companyId: string, userId: string) {
  return sql<Date | null>`
    (
      SELECT MAX(${issueComments.createdAt})
      FROM ${issueComments}
      WHERE ${issueComments.issueId} = ${issues.id}
        AND ${issueComments.companyId} = ${companyId}
        AND ${issueComments.authorUserId} = ${userId}
    )
  `;
}

function myLastReadAtExpr(companyId: string, userId: string) {
  return sql<Date | null>`
    (
      SELECT MAX(${issueReadStates.lastReadAt})
      FROM ${issueReadStates}
      WHERE ${issueReadStates.issueId} = ${issues.id}
        AND ${issueReadStates.companyId} = ${companyId}
        AND ${issueReadStates.userId} = ${userId}
    )
  `;
}

function myLastTouchAtExpr(companyId: string, userId: string) {
  const myLastCommentAt = myLastCommentAtExpr(companyId, userId);
  const myLastReadAt = myLastReadAtExpr(companyId, userId);
  return sql<Date | null>`
    GREATEST(
      COALESCE(${myLastCommentAt}, to_timestamp(0)),
      COALESCE(${myLastReadAt}, to_timestamp(0)),
      COALESCE(CASE WHEN ${issues.createdByUserId} = ${userId} THEN ${issues.createdAt} ELSE NULL END, to_timestamp(0)),
      COALESCE(CASE WHEN ${issues.assigneeUserId} = ${userId} THEN ${issues.updatedAt} ELSE NULL END, to_timestamp(0))
    )
  `;
}

function unreadForUserCondition(companyId: string, userId: string) {
  const touchedCondition = touchedByUserCondition(companyId, userId);
  const myLastTouchAt = myLastTouchAtExpr(companyId, userId);
  return sql<boolean>`
    (
      ${touchedCondition}
      AND EXISTS (
        SELECT 1
        FROM ${issueComments}
        WHERE ${issueComments.issueId} = ${issues.id}
          AND ${issueComments.companyId} = ${companyId}
          AND (
            ${issueComments.authorUserId} IS NULL
            OR ${issueComments.authorUserId} <> ${userId}
          )
          AND ${issueComments.createdAt} > ${myLastTouchAt}
      )
    )
  `;
}

export function deriveIssueUserContext(
  issue: IssueUserContextInput,
  userId: string,
  stats:
    | {
      myLastCommentAt: Date | string | null;
      myLastReadAt: Date | string | null;
      lastExternalCommentAt: Date | string | null;
    }
    | null
    | undefined,
) {
  const normalizeDate = (value: Date | string | null | undefined) => {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const myLastCommentAt = normalizeDate(stats?.myLastCommentAt);
  const myLastReadAt = normalizeDate(stats?.myLastReadAt);
  const createdTouchAt = issue.createdByUserId === userId ? normalizeDate(issue.createdAt) : null;
  const assignedTouchAt = issue.assigneeUserId === userId ? normalizeDate(issue.updatedAt) : null;
  const myLastTouchAt = [myLastCommentAt, myLastReadAt, createdTouchAt, assignedTouchAt]
    .filter((value): value is Date => value instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const lastExternalCommentAt = normalizeDate(stats?.lastExternalCommentAt);
  const isUnreadForMe = Boolean(
    myLastTouchAt &&
    lastExternalCommentAt &&
    lastExternalCommentAt.getTime() > myLastTouchAt.getTime(),
  );

  return {
    myLastTouchAt,
    lastExternalCommentAt,
    isUnreadForMe,
  };
}

async function labelMapForIssues(dbOrTx: any, issueIds: string[]): Promise<Map<string, IssueLabelRow[]>> {
  const map = new Map<string, IssueLabelRow[]>();
  if (issueIds.length === 0) return map;
  const rows = await dbOrTx
    .select({
      issueId: issueLabels.issueId,
      label: labels,
    })
    .from(issueLabels)
    .innerJoin(labels, eq(issueLabels.labelId, labels.id))
    .where(inArray(issueLabels.issueId, issueIds))
    .orderBy(asc(labels.name), asc(labels.id));

  for (const row of rows) {
    const existing = map.get(row.issueId);
    if (existing) existing.push(row.label);
    else map.set(row.issueId, [row.label]);
  }
  return map;
}

async function withIssueLabels(dbOrTx: any, rows: IssueRow[]): Promise<IssueWithLabels[]> {
  if (rows.length === 0) return [];
  const labelsByIssueId = await labelMapForIssues(dbOrTx, rows.map((row) => row.id));
  return rows.map((row) => {
    const issueLabels = labelsByIssueId.get(row.id) ?? [];
    return {
      ...row,
      labels: issueLabels,
      labelIds: issueLabels.map((label) => label.id),
    };
  });
}

const ACTIVE_RUN_STATUSES = ["queued", "running"];

async function activeRunMapForIssues(
  dbOrTx: any,
  issueRows: IssueWithLabels[],
): Promise<Map<string, IssueActiveRunRow>> {
  const map = new Map<string, IssueActiveRunRow>();
  const runIds = issueRows
    .map((row) => row.executionRunId)
    .filter((id): id is string => id != null);
  if (runIds.length === 0) return map;

  const rows = await dbOrTx
    .select({
      id: heartbeatRuns.id,
      status: heartbeatRuns.status,
      agentId: heartbeatRuns.agentId,
      invocationSource: heartbeatRuns.invocationSource,
      triggerDetail: heartbeatRuns.triggerDetail,
      startedAt: heartbeatRuns.startedAt,
      finishedAt: heartbeatRuns.finishedAt,
      createdAt: heartbeatRuns.createdAt,
    })
    .from(heartbeatRuns)
    .where(
      and(
        inArray(heartbeatRuns.id, runIds),
        inArray(heartbeatRuns.status, ACTIVE_RUN_STATUSES),
      ),
    );

  for (const row of rows) {
    map.set(row.id, row);
  }
  return map;
}

function withActiveRuns(
  issueRows: IssueWithLabels[],
  runMap: Map<string, IssueActiveRunRow>,
): IssueWithLabelsAndRun[] {
  return issueRows.map((row) => ({
    ...row,
    activeRun: row.executionRunId ? (runMap.get(row.executionRunId) ?? null) : null,
  }));
}

export function issueService(db: Db) {
  const instanceSettings = instanceSettingsService(db);

  async function findOpenDelegatedChildDuplicate(
    database: Pick<Db, "select">,
    input: {
    companyId: string;
    parentId: string;
    createdByAgentId: string;
    title: string;
    assigneeAgentId?: string | null;
    assigneeUserId?: string | null;
    projectId?: string | null;
    goalId?: string | null;
    requestDepth?: number | null;
  },
  ) {
    const normalizedTitle = normalizeDelegatedIssueTitle(input.title);
    const assigneeAgentId = input.assigneeAgentId ?? null;
    const assigneeUserId = input.assigneeUserId ?? null;
    const projectId = input.projectId ?? null;
    const goalId = input.goalId ?? null;
    const requestDepth = input.requestDepth ?? 0;

    const candidates = await database
      .select()
      .from(issues)
      .where(
        and(
          eq(issues.companyId, input.companyId),
          eq(issues.parentId, input.parentId),
          eq(issues.createdByAgentId, input.createdByAgentId),
          inArray(issues.status, [...OPEN_ISSUE_STATUSES]),
          isNull(issues.hiddenAt),
        ),
      )
      .orderBy(desc(issues.updatedAt), desc(issues.createdAt));

    const duplicate = candidates.find((candidate) => {
      if (normalizeDelegatedIssueTitle(candidate.title) !== normalizedTitle) return false;
      if (!nullSafeEqual(candidate.assigneeAgentId, assigneeAgentId)) return false;
      if (!nullSafeEqual(candidate.assigneeUserId, assigneeUserId)) return false;
      if (!nullSafeEqual(candidate.projectId, projectId)) return false;
      if (!nullSafeEqual(candidate.goalId, goalId)) return false;
      if ((candidate.requestDepth ?? 0) !== requestDepth) return false;
      return true;
    });
    if (!duplicate) return null;

    return withIssueLabels(database as Db, [duplicate]).then((rows) => rows[0] ?? null);
  }

  async function findOpenDelegatedChildByKey(
    database: Pick<Db, "select">,
    input: {
      companyId: string;
      parentId: string;
      delegationKey: string;
    },
  ) {
    const row = await database
      .select()
      .from(issues)
      .where(
        and(
          eq(issues.companyId, input.companyId),
          eq(issues.parentId, input.parentId),
          eq(issues.delegationKey, input.delegationKey),
          inArray(issues.status, [...OPEN_ISSUE_STATUSES]),
          isNull(issues.hiddenAt),
        ),
      )
      .orderBy(desc(issues.updatedAt), desc(issues.createdAt))
      .then((rows) => rows[0] ?? null);
    if (!row) return null;

    return withIssueLabels(database as Db, [row]).then((rows) => rows[0] ?? null);
  }

  async function countOpenDelegatedChildrenForParent(
    database: Pick<Db, "select">,
    input: {
      companyId: string;
      parentId: string;
      createdByAgentId: string;
    },
  ) {
    const [row] = await database
      .select({ count: sql<number>`count(*)` })
      .from(issues)
      .where(
        and(
          eq(issues.companyId, input.companyId),
          eq(issues.parentId, input.parentId),
          eq(issues.createdByAgentId, input.createdByAgentId),
          inArray(issues.status, [...OPEN_ISSUE_STATUSES]),
          isNull(issues.hiddenAt),
          sql`(${issues.assigneeAgentId} is not null or ${issues.assigneeUserId} is not null)`,
        ),
      );
    return Number(row?.count ?? 0);
  }

  async function countRecentDelegatedChildrenForParent(
    database: Pick<Db, "select">,
    input: {
      companyId: string;
      parentId: string;
      createdByAgentId: string;
      since: Date;
    },
  ) {
    const [row] = await database
      .select({ count: sql<number>`count(*)` })
      .from(issues)
      .where(
        and(
          eq(issues.companyId, input.companyId),
          eq(issues.parentId, input.parentId),
          eq(issues.createdByAgentId, input.createdByAgentId),
          inArray(issues.status, [...OPEN_ISSUE_STATUSES]),
          isNull(issues.hiddenAt),
          sql`(${issues.assigneeAgentId} is not null or ${issues.assigneeUserId} is not null)`,
          gte(issues.createdAt, input.since),
        ),
      );
    return Number(row?.count ?? 0);
  }

  async function maybeBlockDelegatingParent(
    database: Pick<Db, "select" | "update" | "insert">,
    input: {
      companyId: string;
      parentId: string;
      createdByAgentId: string;
      delegatedChildIssueId: string;
      delegatedChildIdentifier: string;
    },
  ) {
    const updated = await database
      .update(issues)
      .set({
        status: "blocked",
        blockerDetails: buildDelegatedChildExecutionBlockerDetails({
          delegatedChildIssueId: input.delegatedChildIssueId,
          delegatedChildIdentifier: input.delegatedChildIdentifier,
        }),
        checkoutRunId: null,
        executionRunId: null,
        executionLockedAt: null,
        executionAgentNameKey: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(issues.id, input.parentId),
          eq(issues.companyId, input.companyId),
          eq(issues.status, "in_progress"),
          eq(issues.assigneeAgentId, input.createdByAgentId),
          isNull(issues.hiddenAt),
        ),
      )
      .returning()
      .then((rows) => rows[0] ?? null);
    if (!updated) return null;

    const [comment] = await database
      .insert(issueComments)
      .values({
        companyId: input.companyId,
        issueId: input.parentId,
        authorAgentId: input.createdByAgentId,
        body:
          `Delegated child ${input.delegatedChildIdentifier} is now the active execution path. ` +
          "This coordination issue was moved to blocked until that work changes state or needs intervention.",
      })
      .returning();

    const issue = await withIssueLabels(database as Db, [updated]).then((rows) => rows[0] ?? null);
    if (!issue) return null;

    return { issue, comment };
  }

  function redactIssueComment<T extends { body: string }>(comment: T, censorUsernameInLogs: boolean): T {
    return {
      ...comment,
      body: redactCurrentUserText(comment.body, { enabled: censorUsernameInLogs }),
    };
  }

  async function assertAssignableAgent(companyId: string, agentId: string) {
    const assignee = await db
      .select({
        id: agents.id,
        companyId: agents.companyId,
        status: agents.status,
      })
      .from(agents)
      .where(eq(agents.id, agentId))
      .then((rows) => rows[0] ?? null);

    if (!assignee) throw notFound("Assignee agent not found");
    if (assignee.companyId !== companyId) {
      throw unprocessable("Assignee must belong to same company");
    }
    if (assignee.status === "pending_approval") {
      throw conflict("Cannot assign work to pending approval agents");
    }
    if (assignee.status === "terminated") {
      throw conflict("Cannot assign work to terminated agents");
    }
  }

  async function assertAssignableUser(companyId: string, userId: string) {
    const membership = await db
      .select({ id: companyMemberships.id })
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, userId),
          eq(companyMemberships.status, "active"),
        ),
      )
      .then((rows) => rows[0] ?? null);
    if (!membership) {
      throw notFound("Assignee user not found");
    }
  }

  async function assertValidProjectWorkspace(companyId: string, projectId: string | null | undefined, projectWorkspaceId: string) {
    const workspace = await db
      .select({
        id: projectWorkspaces.id,
        companyId: projectWorkspaces.companyId,
        projectId: projectWorkspaces.projectId,
      })
      .from(projectWorkspaces)
      .where(eq(projectWorkspaces.id, projectWorkspaceId))
      .then((rows) => rows[0] ?? null);
    if (!workspace) throw notFound("Project workspace not found");
    if (workspace.companyId !== companyId) throw unprocessable("Project workspace must belong to same company");
    if (projectId && workspace.projectId !== projectId) {
      throw unprocessable("Project workspace must belong to the selected project");
    }
  }

  async function assertValidExecutionWorkspace(companyId: string, projectId: string | null | undefined, executionWorkspaceId: string) {
    const workspace = await db
      .select({
        id: executionWorkspaces.id,
        companyId: executionWorkspaces.companyId,
        projectId: executionWorkspaces.projectId,
      })
      .from(executionWorkspaces)
      .where(eq(executionWorkspaces.id, executionWorkspaceId))
      .then((rows) => rows[0] ?? null);
    if (!workspace) throw notFound("Execution workspace not found");
    if (workspace.companyId !== companyId) throw unprocessable("Execution workspace must belong to same company");
    if (projectId && workspace.projectId !== projectId) {
      throw unprocessable("Execution workspace must belong to the selected project");
    }
  }

  async function assertProjectBelongsToCompany(companyId: string, projectId: string) {
    const project = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    if (!project) {
      throw unprocessable("Project must belong to same company");
    }
  }

  async function assertGoalBelongsToCompany(companyId: string, goalId: string) {
    const goal = await db
      .select({ id: goals.id })
      .from(goals)
      .where(and(eq(goals.id, goalId), eq(goals.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    if (!goal) {
      throw unprocessable("Goal must belong to same company");
    }
  }

  async function assertParentIssueBelongsToCompany(companyId: string, parentId: string) {
    const parentIssue = await db
      .select({ id: issues.id })
      .from(issues)
      .where(and(eq(issues.id, parentId), eq(issues.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    if (!parentIssue) {
      throw unprocessable("Parent issue must belong to same company");
    }
  }

  async function assertValidLabelIds(companyId: string, labelIds: string[], dbOrTx: any = db) {
    if (labelIds.length === 0) return;
    const existing = await dbOrTx
      .select({ id: labels.id })
      .from(labels)
      .where(and(eq(labels.companyId, companyId), inArray(labels.id, labelIds)));
    if (existing.length !== new Set(labelIds).size) {
      throw unprocessable("One or more labels are invalid for this company");
    }
  }

  async function syncIssueLabels(
    issueId: string,
    companyId: string,
    labelIds: string[],
    dbOrTx: any = db,
  ) {
    const deduped = [...new Set(labelIds)];
    await assertValidLabelIds(companyId, deduped, dbOrTx);
    await dbOrTx.delete(issueLabels).where(eq(issueLabels.issueId, issueId));
    if (deduped.length === 0) return;
    await dbOrTx.insert(issueLabels).values(
      deduped.map((labelId) => ({
        issueId,
        labelId,
        companyId,
      })),
    );
  }

  async function isTerminalOrMissingHeartbeatRun(runId: string) {
    const run = await db
      .select({ status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId))
      .then((rows) => rows[0] ?? null);
    if (!run) return true;
    return TERMINAL_HEARTBEAT_RUN_STATUSES.has(run.status);
  }

  async function adoptStaleCheckoutRun(input: {
    issueId: string;
    actorAgentId: string;
    actorRunId: string;
    expectedCheckoutRunId: string;
  }) {
    const stale = await isTerminalOrMissingHeartbeatRun(input.expectedCheckoutRunId);
    if (!stale) return null;

    const now = new Date();
    const adopted = await db
      .update(issues)
      .set({
        checkoutRunId: input.actorRunId,
        executionRunId: input.actorRunId,
        executionLockedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(issues.id, input.issueId),
          eq(issues.status, "in_progress"),
          eq(issues.assigneeAgentId, input.actorAgentId),
          eq(issues.checkoutRunId, input.expectedCheckoutRunId),
        ),
      )
      .returning({
        id: issues.id,
        status: issues.status,
        assigneeAgentId: issues.assigneeAgentId,
        checkoutRunId: issues.checkoutRunId,
        executionRunId: issues.executionRunId,
      })
      .then((rows) => rows[0] ?? null);

    return adopted;
  }

  return {
    list: async (companyId: string, filters?: IssueFilters) => {
      const conditions = [eq(issues.companyId, companyId)];
      const touchedByUserId = filters?.touchedByUserId?.trim() || undefined;
      const unreadForUserId = filters?.unreadForUserId?.trim() || undefined;
      const contextUserId = unreadForUserId ?? touchedByUserId;
      const rawSearch = filters?.q?.trim() ?? "";
      const hasSearch = rawSearch.length > 0;
      const escapedSearch = hasSearch ? escapeLikePattern(rawSearch) : "";
      const startsWithPattern = `${escapedSearch}%`;
      const containsPattern = `%${escapedSearch}%`;
      const titleStartsWithMatch = sql<boolean>`${issues.title} ILIKE ${startsWithPattern} ESCAPE '\\'`;
      const titleContainsMatch = sql<boolean>`${issues.title} ILIKE ${containsPattern} ESCAPE '\\'`;
      const identifierStartsWithMatch = sql<boolean>`${issues.identifier} ILIKE ${startsWithPattern} ESCAPE '\\'`;
      const identifierContainsMatch = sql<boolean>`${issues.identifier} ILIKE ${containsPattern} ESCAPE '\\'`;
      const descriptionContainsMatch = sql<boolean>`${issues.description} ILIKE ${containsPattern} ESCAPE '\\'`;
      const commentContainsMatch = sql<boolean>`
        EXISTS (
          SELECT 1
          FROM ${issueComments}
          WHERE ${issueComments.issueId} = ${issues.id}
            AND ${issueComments.companyId} = ${companyId}
            AND ${issueComments.body} ILIKE ${containsPattern} ESCAPE '\\'
        )
      `;
      if (filters?.status) {
        const statuses = filters.status.split(",").map((s) => s.trim());
        conditions.push(statuses.length === 1 ? eq(issues.status, statuses[0]) : inArray(issues.status, statuses));
      }
      if (filters?.assigneeAgentId) {
        conditions.push(eq(issues.assigneeAgentId, filters.assigneeAgentId));
      }
      if (filters?.assigneeUserId) {
        conditions.push(eq(issues.assigneeUserId, filters.assigneeUserId));
      }
      if (touchedByUserId) {
        conditions.push(touchedByUserCondition(companyId, touchedByUserId));
      }
      if (unreadForUserId) {
        conditions.push(unreadForUserCondition(companyId, unreadForUserId));
      }
      if (filters?.projectId) conditions.push(eq(issues.projectId, filters.projectId));
      if (filters?.parentId) conditions.push(eq(issues.parentId, filters.parentId));
      if (filters?.originKind) conditions.push(eq(issues.originKind, filters.originKind));
      if (filters?.originId) conditions.push(eq(issues.originId, filters.originId));
      if (filters?.labelId) {
        const labeledIssueIds = await db
          .select({ issueId: issueLabels.issueId })
          .from(issueLabels)
          .where(and(eq(issueLabels.companyId, companyId), eq(issueLabels.labelId, filters.labelId)));
        if (labeledIssueIds.length === 0) return [];
        conditions.push(inArray(issues.id, labeledIssueIds.map((row) => row.issueId)));
      }
      if (hasSearch) {
        conditions.push(
          or(
            titleContainsMatch,
            identifierContainsMatch,
            descriptionContainsMatch,
            commentContainsMatch,
          )!,
        );
      }
      if (!filters?.includeRoutineExecutions && !filters?.originKind && !filters?.originId) {
        conditions.push(ne(issues.originKind, "routine_execution"));
      }
      conditions.push(isNull(issues.hiddenAt));

      const priorityOrder = sql`CASE ${issues.priority} WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END`;
      const searchOrder = sql<number>`
        CASE
          WHEN ${titleStartsWithMatch} THEN 0
          WHEN ${titleContainsMatch} THEN 1
          WHEN ${identifierStartsWithMatch} THEN 2
          WHEN ${identifierContainsMatch} THEN 3
          WHEN ${descriptionContainsMatch} THEN 4
          WHEN ${commentContainsMatch} THEN 5
          ELSE 6
        END
      `;
      const rows = await db
        .select()
        .from(issues)
        .where(and(...conditions))
        .orderBy(hasSearch ? asc(searchOrder) : asc(priorityOrder), asc(priorityOrder), desc(issues.updatedAt));
      const withLabels = await withIssueLabels(db, rows);
      const runMap = await activeRunMapForIssues(db, withLabels);
      const withRuns = withActiveRuns(withLabels, runMap);
      if (!contextUserId || withRuns.length === 0) {
        return withRuns;
      }

      const issueIds = withRuns.map((row) => row.id);
      const statsRows = await db
        .select({
          issueId: issueComments.issueId,
          myLastCommentAt: sql<Date | null>`
            MAX(CASE WHEN ${issueComments.authorUserId} = ${contextUserId} THEN ${issueComments.createdAt} END)
          `,
          lastExternalCommentAt: sql<Date | null>`
            MAX(
              CASE
                WHEN ${issueComments.authorUserId} IS NULL OR ${issueComments.authorUserId} <> ${contextUserId}
                THEN ${issueComments.createdAt}
              END
            )
          `,
        })
        .from(issueComments)
        .where(
          and(
            eq(issueComments.companyId, companyId),
            inArray(issueComments.issueId, issueIds),
          ),
        )
        .groupBy(issueComments.issueId);
      const readRows = await db
        .select({
          issueId: issueReadStates.issueId,
          myLastReadAt: issueReadStates.lastReadAt,
        })
        .from(issueReadStates)
        .where(
          and(
            eq(issueReadStates.companyId, companyId),
            eq(issueReadStates.userId, contextUserId),
            inArray(issueReadStates.issueId, issueIds),
          ),
        );
      const statsByIssueId = new Map(statsRows.map((row) => [row.issueId, row]));
      const readByIssueId = new Map(readRows.map((row) => [row.issueId, row.myLastReadAt]));

      return withRuns.map((row) => ({
        ...row,
        ...deriveIssueUserContext(row, contextUserId, {
          myLastCommentAt: statsByIssueId.get(row.id)?.myLastCommentAt ?? null,
          myLastReadAt: readByIssueId.get(row.id) ?? null,
          lastExternalCommentAt: statsByIssueId.get(row.id)?.lastExternalCommentAt ?? null,
        }),
      }));
    },

    countUnreadTouchedByUser: async (companyId: string, userId: string, status?: string) => {
      const conditions = [
        eq(issues.companyId, companyId),
        isNull(issues.hiddenAt),
        unreadForUserCondition(companyId, userId),
        ne(issues.originKind, "routine_execution"),
      ];
      if (status) {
        const statuses = status.split(",").map((s) => s.trim()).filter(Boolean);
        if (statuses.length === 1) {
          conditions.push(eq(issues.status, statuses[0]));
        } else if (statuses.length > 1) {
          conditions.push(inArray(issues.status, statuses));
        }
      }
      const [row] = await db
        .select({ count: sql<number>`count(*)` })
        .from(issues)
        .where(and(...conditions));
      return Number(row?.count ?? 0);
    },

    markRead: async (companyId: string, issueId: string, userId: string, readAt: Date = new Date()) => {
      const now = new Date();
      const [row] = await db
        .insert(issueReadStates)
        .values({
          companyId,
          issueId,
          userId,
          lastReadAt: readAt,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [issueReadStates.companyId, issueReadStates.issueId, issueReadStates.userId],
          set: {
            lastReadAt: readAt,
            updatedAt: now,
          },
        })
        .returning();
      return row;
    },

    getById: async (id: string) => {
      const row = await db
        .select()
        .from(issues)
        .where(eq(issues.id, id))
        .then((rows) => rows[0] ?? null);
      if (!row) return null;
      const [enriched] = await withIssueLabels(db, [row]);
      return enriched;
    },

    getByIdentifier: async (identifier: string) => {
      const row = await db
        .select()
        .from(issues)
        .where(eq(issues.identifier, identifier.toUpperCase()))
        .then((rows) => rows[0] ?? null);
      if (!row) return null;
      const [enriched] = await withIssueLabels(db, [row]);
      return enriched;
    },

    create: async (
      companyId: string,
      data: Omit<typeof issues.$inferInsert, "companyId"> & { labelIds?: string[] },
    ): Promise<CreateIssueResult> => {
      const { labelIds: inputLabelIds, ...issueData } = data;
      const isolatedWorkspacesEnabled = (await instanceSettings.getExperimental()).enableIsolatedWorkspaces;
      if (!isolatedWorkspacesEnabled) {
        delete issueData.executionWorkspaceId;
        delete issueData.executionWorkspacePreference;
        delete issueData.executionWorkspaceSettings;
      }
      if (data.assigneeAgentId && data.assigneeUserId) {
        throw unprocessable("Issue can only have one assignee");
      }
      if (data.parentId && data.createdByAgentId && !data.assigneeAgentId && !data.assigneeUserId) {
        throw unprocessable("Delegated child issues must include an assignee");
      }
      if (data.assigneeAgentId) {
        await assertAssignableAgent(companyId, data.assigneeAgentId);
      }
      if (data.assigneeUserId) {
        await assertAssignableUser(companyId, data.assigneeUserId);
      }
      if (data.projectId) {
        await assertProjectBelongsToCompany(companyId, data.projectId);
      }
      if (data.goalId) {
        await assertGoalBelongsToCompany(companyId, data.goalId);
      }
      if (data.parentId) {
        await assertParentIssueBelongsToCompany(companyId, data.parentId);
      }
      if (data.projectWorkspaceId) {
        await assertValidProjectWorkspace(companyId, data.projectId, data.projectWorkspaceId);
      }
      if (data.executionWorkspaceId) {
        await assertValidExecutionWorkspace(companyId, data.projectId, data.executionWorkspaceId);
      }
      if (data.status === "in_progress") {
        throw unprocessable("Use checkout to set issue status to in_progress");
      }
      let delegatedParentId: string | null = null;
      let delegatedKey: string | null = null;
      try {
        return await db.transaction(async (tx) => {
          const defaultCompanyGoal = await getDefaultCompanyGoal(tx, companyId);
          const resolvedGoalId = resolveIssueGoalId({
            projectId: issueData.projectId,
            goalId: issueData.goalId,
            defaultGoalId: defaultCompanyGoal?.id ?? null,
          });
          const delegationKey = resolveDelegationKey({
            parentId: issueData.parentId ?? null,
            createdByAgentId: issueData.createdByAgentId ?? null,
            title: issueData.title,
            assigneeAgentId: issueData.assigneeAgentId ?? null,
            assigneeUserId: issueData.assigneeUserId ?? null,
            projectId: issueData.projectId ?? null,
            goalId: resolvedGoalId,
            requestDepth: issueData.requestDepth ?? 0,
            delegationKey: issueData.delegationKey ?? null,
          });
          delegatedParentId = issueData.parentId ?? null;
          delegatedKey = delegationKey;
          const duplicateDelegatedChildByKey =
            delegatedParentId && delegatedKey
              ? await findOpenDelegatedChildByKey(tx, {
                  companyId,
                  parentId: delegatedParentId,
                  delegationKey: delegatedKey,
                })
              : null;
          if (duplicateDelegatedChildByKey) {
            const blockedParentResult =
              isOpenDelegatedChild({
                parentId: issueData.parentId ?? null,
                createdByAgentId: issueData.createdByAgentId ?? null,
                assigneeAgentId: issueData.assigneeAgentId ?? null,
                assigneeUserId: issueData.assigneeUserId ?? null,
              })
                  ? await maybeBlockDelegatingParent(tx, {
                      companyId,
                      parentId: issueData.parentId!,
                      createdByAgentId: issueData.createdByAgentId!,
                      delegatedChildIssueId: duplicateDelegatedChildByKey.id,
                      delegatedChildIdentifier: duplicateDelegatedChildByKey.identifier ?? duplicateDelegatedChildByKey.title,
                    })
                  : null;
            return {
              issue: duplicateDelegatedChildByKey,
              created: false,
              blockedParentIssue: blockedParentResult?.issue ?? null,
              blockedParentComment: blockedParentResult?.comment ?? null,
            };
          }
          const duplicateDelegatedChild =
            issueData.createdByAgentId &&
            issueData.parentId &&
            (issueData.assigneeAgentId || issueData.assigneeUserId)
              ? await findOpenDelegatedChildDuplicate(tx, {
                  companyId,
                  parentId: issueData.parentId,
                  createdByAgentId: issueData.createdByAgentId,
                  title: issueData.title,
                  assigneeAgentId: issueData.assigneeAgentId ?? null,
                  assigneeUserId: issueData.assigneeUserId ?? null,
                  projectId: issueData.projectId ?? null,
                  goalId: resolvedGoalId,
                  requestDepth: issueData.requestDepth ?? 0,
                })
              : null;
          if (duplicateDelegatedChild) {
            const blockedParentResult =
              isOpenDelegatedChild({
                parentId: issueData.parentId ?? null,
                createdByAgentId: issueData.createdByAgentId ?? null,
                assigneeAgentId: issueData.assigneeAgentId ?? null,
                assigneeUserId: issueData.assigneeUserId ?? null,
              })
                  ? await maybeBlockDelegatingParent(tx, {
                      companyId,
                      parentId: issueData.parentId!,
                      createdByAgentId: issueData.createdByAgentId!,
                      delegatedChildIssueId: duplicateDelegatedChild.id,
                      delegatedChildIdentifier: duplicateDelegatedChild.identifier ?? duplicateDelegatedChild.title,
                    })
                  : null;
            return {
              issue: duplicateDelegatedChild,
              created: false,
              blockedParentIssue: blockedParentResult?.issue ?? null,
              blockedParentComment: blockedParentResult?.comment ?? null,
            };
          }
          if (
            isOpenDelegatedChild({
              parentId: issueData.parentId ?? null,
              createdByAgentId: issueData.createdByAgentId ?? null,
              assigneeAgentId: issueData.assigneeAgentId ?? null,
              assigneeUserId: issueData.assigneeUserId ?? null,
            })
          ) {
            const openDelegatedChildCount = await countOpenDelegatedChildrenForParent(tx, {
              companyId,
              parentId: issueData.parentId!,
              createdByAgentId: issueData.createdByAgentId!,
            });
            if (openDelegatedChildCount >= MAX_OPEN_DELEGATED_CHILDREN_PER_PARENT) {
              throw conflict(
                `Too many open delegated child issues under this parent. Continue existing child issues before creating more than ${MAX_OPEN_DELEGATED_CHILDREN_PER_PARENT}.`,
              );
            }
            const recentDelegatedChildCount = await countRecentDelegatedChildrenForParent(tx, {
              companyId,
              parentId: issueData.parentId!,
              createdByAgentId: issueData.createdByAgentId!,
              since: new Date(Date.now() - DELEGATED_CHILD_RATE_LIMIT_WINDOW_MS),
            });
            if (recentDelegatedChildCount >= MAX_RECENT_DELEGATED_CHILDREN_PER_PARENT) {
              throw conflict(
                `Too many delegated child issues were created under this parent recently. Continue existing child issues before creating more than ${MAX_RECENT_DELEGATED_CHILDREN_PER_PARENT} in ${Math.floor(DELEGATED_CHILD_RATE_LIMIT_WINDOW_MS / 60_000)} minutes.`,
              );
            }
          }
          let executionWorkspaceSettings =
            (issueData.executionWorkspaceSettings as Record<string, unknown> | null | undefined) ?? null;
          if (executionWorkspaceSettings == null && issueData.projectId) {
            const project = await tx
              .select({ executionWorkspacePolicy: projects.executionWorkspacePolicy })
              .from(projects)
              .where(and(eq(projects.id, issueData.projectId), eq(projects.companyId, companyId)))
              .then((rows) => rows[0] ?? null);
            executionWorkspaceSettings =
              defaultIssueExecutionWorkspaceSettingsForProject(
                gateProjectExecutionWorkspacePolicy(
                  parseProjectExecutionWorkspacePolicy(project?.executionWorkspacePolicy),
                  isolatedWorkspacesEnabled,
                ),
              ) as Record<string, unknown> | null;
          }
          let projectWorkspaceId = issueData.projectWorkspaceId ?? null;
          if (!projectWorkspaceId && issueData.projectId) {
            const project = await tx
              .select({
                executionWorkspacePolicy: projects.executionWorkspacePolicy,
              })
              .from(projects)
              .where(and(eq(projects.id, issueData.projectId), eq(projects.companyId, companyId)))
              .then((rows) => rows[0] ?? null);
            const projectPolicy = parseProjectExecutionWorkspacePolicy(project?.executionWorkspacePolicy);
            projectWorkspaceId = projectPolicy?.defaultProjectWorkspaceId ?? null;
            if (!projectWorkspaceId) {
              projectWorkspaceId = await tx
                .select({ id: projectWorkspaces.id })
                .from(projectWorkspaces)
                .where(and(eq(projectWorkspaces.projectId, issueData.projectId), eq(projectWorkspaces.companyId, companyId)))
                .orderBy(desc(projectWorkspaces.isPrimary), asc(projectWorkspaces.createdAt), asc(projectWorkspaces.id))
                .then((rows) => rows[0]?.id ?? null);
            }
          }
          const [company] = await tx
            .update(companies)
            .set({ issueCounter: sql`${companies.issueCounter} + 1` })
            .where(eq(companies.id, companyId))
            .returning({ issueCounter: companies.issueCounter, issuePrefix: companies.issuePrefix });

          const issueNumber = company.issueCounter;
          const identifier = `${company.issuePrefix}-${issueNumber}`;

          const values = {
            ...issueData,
            delegationKey,
            originKind: issueData.originKind ?? "manual",
            goalId: resolvedGoalId,
            ...(projectWorkspaceId ? { projectWorkspaceId } : {}),
            ...(executionWorkspaceSettings ? { executionWorkspaceSettings } : {}),
            companyId,
            issueNumber,
            identifier,
          } as typeof issues.$inferInsert;
          if (values.status === "in_progress" && !values.startedAt) {
            values.startedAt = new Date();
          }
          if (values.status === "done") {
            values.completedAt = new Date();
          }
          if (values.status === "cancelled") {
            values.cancelledAt = new Date();
          }

          const [issue] = await tx.insert(issues).values(values).returning();
          if (inputLabelIds) {
            await syncIssueLabels(issue.id, companyId, inputLabelIds, tx);
          }
          const [enriched] = await withIssueLabels(tx, [issue]);
          const blockedParentResult =
            isOpenDelegatedChild({
              parentId: issueData.parentId ?? null,
              createdByAgentId: issueData.createdByAgentId ?? null,
              assigneeAgentId: issueData.assigneeAgentId ?? null,
              assigneeUserId: issueData.assigneeUserId ?? null,
            })
              ? await maybeBlockDelegatingParent(tx, {
                  companyId,
                  parentId: issueData.parentId!,
                  createdByAgentId: issueData.createdByAgentId!,
                  delegatedChildIssueId: enriched.id,
                  delegatedChildIdentifier: enriched.identifier ?? enriched.title,
                })
              : null;
          return {
            issue: enriched,
            created: true,
            blockedParentIssue: blockedParentResult?.issue ?? null,
            blockedParentComment: blockedParentResult?.comment ?? null,
          };
        });
      } catch (error) {
        if (!delegatedParentId || !delegatedKey || !isUniqueViolation(error, "issues_open_delegation_key_uq")) {
          throw error;
        }
        const existing = await findOpenDelegatedChildByKey(db, {
          companyId,
          parentId: delegatedParentId,
          delegationKey: delegatedKey,
        });
        if (!existing) {
          throw error;
        }
        return { issue: existing, created: false, blockedParentIssue: null, blockedParentComment: null };
      }
    },

    backfillDelegationKeys: async (input?: { companyId?: string | null }) => {
      const conditions = [
        isNull(issues.delegationKey),
        isNull(issues.hiddenAt),
        inArray(issues.status, [...OPEN_ISSUE_STATUSES]),
        sql`${issues.parentId} is not null`,
        sql`${issues.createdByAgentId} is not null`,
        sql`(${issues.assigneeAgentId} is not null or ${issues.assigneeUserId} is not null)`,
      ];
      if (input?.companyId) {
        conditions.push(eq(issues.companyId, input.companyId));
      }

      const [legacyRows, existingRows] = await Promise.all([
        db
          .select({
            id: issues.id,
            companyId: issues.companyId,
            parentId: issues.parentId,
            createdByAgentId: issues.createdByAgentId,
            title: issues.title,
            assigneeAgentId: issues.assigneeAgentId,
            assigneeUserId: issues.assigneeUserId,
            projectId: issues.projectId,
            goalId: issues.goalId,
            requestDepth: issues.requestDepth,
          })
          .from(issues)
          .where(and(...conditions))
          .orderBy(asc(issues.createdAt), asc(issues.id)),
        db
          .select({
            id: issues.id,
            companyId: issues.companyId,
            parentId: issues.parentId,
            delegationKey: issues.delegationKey,
          })
          .from(issues)
          .where(
            and(
              isNull(issues.hiddenAt),
              inArray(issues.status, [...OPEN_ISSUE_STATUSES]),
              sql`${issues.parentId} is not null`,
              sql`${issues.delegationKey} is not null`,
              ...(input?.companyId ? [eq(issues.companyId, input.companyId)] : []),
            ),
          ),
      ]);

      const toTuple = (companyId: string, parentId: string, delegationKey: string) =>
        `${companyId}:${parentId}:${delegationKey}`;

      const candidates = legacyRows.map((row) => ({
        ...row,
        delegationKey: resolveDelegationKey({
          parentId: row.parentId,
          createdByAgentId: row.createdByAgentId,
          title: row.title,
          assigneeAgentId: row.assigneeAgentId,
          assigneeUserId: row.assigneeUserId,
          projectId: row.projectId,
          goalId: row.goalId,
          requestDepth: row.requestDepth,
        }),
      })).filter((row): row is typeof legacyRows[number] & { delegationKey: string } => row.delegationKey != null);

      const candidateCounts = new Map<string, number>();
      for (const candidate of candidates) {
        const tuple = toTuple(candidate.companyId, candidate.parentId!, candidate.delegationKey);
        candidateCounts.set(tuple, (candidateCounts.get(tuple) ?? 0) + 1);
      }

      const existingByTuple = new Map<string, string[]>();
      for (const existing of existingRows) {
        if (!existing.parentId || !existing.delegationKey) continue;
        const tuple = toTuple(existing.companyId, existing.parentId, existing.delegationKey);
        const ids = existingByTuple.get(tuple);
        if (ids) ids.push(existing.id);
        else existingByTuple.set(tuple, [existing.id]);
      }

      const skippedIssues: Array<{
        issueId: string;
        delegationKey: string;
        reason: "conflicting_legacy_duplicates" | "key_already_in_use";
      }> = [];
      let updatedCount = 0;

      await db.transaction(async (tx) => {
        for (const candidate of candidates) {
          const tuple = toTuple(candidate.companyId, candidate.parentId!, candidate.delegationKey);
          if ((candidateCounts.get(tuple) ?? 0) > 1) {
            skippedIssues.push({
              issueId: candidate.id,
              delegationKey: candidate.delegationKey,
              reason: "conflicting_legacy_duplicates",
            });
            continue;
          }
          if ((existingByTuple.get(tuple)?.length ?? 0) > 0) {
            skippedIssues.push({
              issueId: candidate.id,
              delegationKey: candidate.delegationKey,
              reason: "key_already_in_use",
            });
            continue;
          }

          await tx
            .update(issues)
            .set({
              delegationKey: candidate.delegationKey,
              updatedAt: new Date(),
            })
            .where(eq(issues.id, candidate.id));
          existingByTuple.set(tuple, [candidate.id]);
          updatedCount += 1;
        }
      });

      return {
        updatedCount,
        skippedIssues,
      };
    },

    update: async (id: string, data: Partial<typeof issues.$inferInsert> & { labelIds?: string[] }) => {
      const existing = await db
        .select()
        .from(issues)
        .where(eq(issues.id, id))
        .then((rows) => rows[0] ?? null);
      if (!existing) return null;

      const { labelIds: nextLabelIds, ...issueData } = data;
      const isolatedWorkspacesEnabled = (await instanceSettings.getExperimental()).enableIsolatedWorkspaces;
      if (!isolatedWorkspacesEnabled) {
        delete issueData.executionWorkspaceId;
        delete issueData.executionWorkspacePreference;
        delete issueData.executionWorkspaceSettings;
      }

      if (issueData.status) {
        assertTransition(existing.status, issueData.status);
      }

      const nextAssigneeAgentId =
        issueData.assigneeAgentId !== undefined ? issueData.assigneeAgentId : existing.assigneeAgentId;
      const nextAssigneeUserId =
        issueData.assigneeUserId !== undefined ? issueData.assigneeUserId : existing.assigneeUserId;
      const assigneeChanged =
        (issueData.assigneeAgentId !== undefined && issueData.assigneeAgentId !== existing.assigneeAgentId) ||
        (issueData.assigneeUserId !== undefined && issueData.assigneeUserId !== existing.assigneeUserId);
      const nextStatus = issueData.status ?? (existing.status === "in_progress" && assigneeChanged ? "todo" : undefined);

      const patch: Partial<typeof issues.$inferInsert> = {
        ...issueData,
        ...(nextStatus !== undefined ? { status: nextStatus } : {}),
        updatedAt: new Date(),
      };
      if (
        issueData.blockerDetails === undefined &&
        nextStatus &&
        nextStatus !== "blocked" &&
        isDelegatedChildExecutionBlockerDetails(existing.blockerDetails as Record<string, unknown> | null | undefined)
      ) {
        patch.blockerDetails = null;
      }

      if (nextAssigneeAgentId && nextAssigneeUserId) {
        throw unprocessable("Issue can only have one assignee");
      }
      if (issueData.assigneeAgentId) {
        await assertAssignableAgent(existing.companyId, issueData.assigneeAgentId);
      }
      if (issueData.assigneeUserId) {
        await assertAssignableUser(existing.companyId, issueData.assigneeUserId);
      }
      if (issueData.projectId !== undefined && issueData.projectId) {
        await assertProjectBelongsToCompany(existing.companyId, issueData.projectId);
      }
      if (issueData.goalId !== undefined && issueData.goalId) {
        await assertGoalBelongsToCompany(existing.companyId, issueData.goalId);
      }
      if (issueData.parentId !== undefined && issueData.parentId) {
        await assertParentIssueBelongsToCompany(existing.companyId, issueData.parentId);
      }

      const nextProjectId = issueData.projectId !== undefined ? issueData.projectId : existing.projectId;
      const nextProjectWorkspaceId =
        issueData.projectWorkspaceId !== undefined ? issueData.projectWorkspaceId : existing.projectWorkspaceId;
      const nextExecutionWorkspaceId =
        issueData.executionWorkspaceId !== undefined ? issueData.executionWorkspaceId : existing.executionWorkspaceId;
      if (issueData.projectId !== undefined || issueData.projectWorkspaceId !== undefined) {
        if (nextProjectWorkspaceId) {
          await assertValidProjectWorkspace(existing.companyId, nextProjectId, nextProjectWorkspaceId);
        }
      }
      if (issueData.projectId !== undefined || issueData.executionWorkspaceId !== undefined) {
        if (nextExecutionWorkspaceId) {
          await assertValidExecutionWorkspace(existing.companyId, nextProjectId, nextExecutionWorkspaceId);
        }
      }

      applyStatusSideEffects(nextStatus, patch);
      if (nextStatus && nextStatus !== "done") {
        patch.completedAt = null;
      }
      if (nextStatus && nextStatus !== "cancelled") {
        patch.cancelledAt = null;
      }
      if (nextStatus && nextStatus !== "in_progress") {
        patch.checkoutRunId = null;
        patch.executionRunId = null;
        patch.executionLockedAt = null;
        patch.executionAgentNameKey = null;
      }
      if (assigneeChanged) {
        patch.checkoutRunId = null;
        if (nextStatus === undefined || nextStatus !== "in_progress") {
          patch.executionRunId = null;
          patch.executionLockedAt = null;
          patch.executionAgentNameKey = null;
        }
      }

      return db.transaction(async (tx) => {
        const defaultCompanyGoal = await getDefaultCompanyGoal(tx, existing.companyId);
        patch.goalId = resolveNextIssueGoalId({
          currentProjectId: existing.projectId,
          currentGoalId: existing.goalId,
          projectId: issueData.projectId,
          goalId: issueData.goalId,
          defaultGoalId: defaultCompanyGoal?.id ?? null,
        });
        const updated = await tx
          .update(issues)
          .set(patch)
          .where(eq(issues.id, id))
          .returning()
          .then((rows) => rows[0] ?? null);
        if (!updated) return null;
        if (nextLabelIds !== undefined) {
          await syncIssueLabels(updated.id, existing.companyId, nextLabelIds, tx);
        }
        const [enriched] = await withIssueLabels(tx, [updated]);
        return enriched;
      });
    },

    remove: (id: string) =>
      db.transaction(async (tx) => {
        const attachmentAssetIds = await tx
          .select({ assetId: issueAttachments.assetId })
          .from(issueAttachments)
          .where(eq(issueAttachments.issueId, id));
        const issueDocumentIds = await tx
          .select({ documentId: issueDocuments.documentId })
          .from(issueDocuments)
          .where(eq(issueDocuments.issueId, id));

        const removedIssue = await tx
          .delete(issues)
          .where(eq(issues.id, id))
          .returning()
          .then((rows) => rows[0] ?? null);

        if (removedIssue && attachmentAssetIds.length > 0) {
          await tx
            .delete(assets)
            .where(inArray(assets.id, attachmentAssetIds.map((row) => row.assetId)));
        }

        if (removedIssue && issueDocumentIds.length > 0) {
          await tx
            .delete(documents)
            .where(inArray(documents.id, issueDocumentIds.map((row) => row.documentId)));
        }

        if (!removedIssue) return null;
        const [enriched] = await withIssueLabels(tx, [removedIssue]);
        return enriched;
      }),

    checkout: async (id: string, agentId: string, expectedStatuses: string[], checkoutRunId: string | null) => {
      const invalidExpectedStatuses = expectedStatuses.filter(
        (status) => !ISSUE_CHECKOUT_ALLOWED_STATUS_SET.has(status),
      );
      if (invalidExpectedStatuses.length > 0) {
        throw unprocessable(
          "Issue checkout expectedStatuses may only include backlog, todo, blocked, or in_review",
          { invalidExpectedStatuses, allowedExpectedStatuses: ISSUE_CHECKOUT_EXPECTED_STATUSES },
        );
      }

      const issueCompany = await db
        .select({
          companyId: issues.companyId,
          blockerDetails: issues.blockerDetails,
          executionRunId: issues.executionRunId,
        })
        .from(issues)
        .where(eq(issues.id, id))
        .then((rows) => rows[0] ?? null);
      if (!issueCompany) throw notFound("Issue not found");
      await assertAssignableAgent(issueCompany.companyId, agentId);

      if (issueCompany.executionRunId) {
        const executionRun = await db
          .select({ status: heartbeatRuns.status })
          .from(heartbeatRuns)
          .where(eq(heartbeatRuns.id, issueCompany.executionRunId))
          .then((rows) => rows[0] ?? null);
        if (executionRun && executionRun.status !== "queued" && executionRun.status !== "running") {
          await db
            .update(issues)
            .set({
              executionRunId: null,
              executionLockedAt: null,
              executionAgentNameKey: null,
              updatedAt: new Date(),
            })
            .where(and(eq(issues.id, id), eq(issues.executionRunId, issueCompany.executionRunId)));
        }
      }

      const now = new Date();
      const sameRunAssigneeCondition = checkoutRunId
        ? and(
          eq(issues.assigneeAgentId, agentId),
          or(isNull(issues.checkoutRunId), eq(issues.checkoutRunId, checkoutRunId)),
        )
        : and(eq(issues.assigneeAgentId, agentId), isNull(issues.checkoutRunId));
      const executionLockCondition = checkoutRunId
        ? or(isNull(issues.executionRunId), eq(issues.executionRunId, checkoutRunId))
        : isNull(issues.executionRunId);
      const updated = await db
        .update(issues)
        .set({
          assigneeAgentId: agentId,
          assigneeUserId: null,
          checkoutRunId,
          executionRunId: checkoutRunId,
          status: "in_progress",
          ...(isDelegatedChildExecutionBlockerDetails(
            issueCompany.blockerDetails as Record<string, unknown> | null | undefined,
          )
            ? { blockerDetails: null }
            : {}),
          startedAt: now,
          completedAt: null,
          cancelledAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(issues.id, id),
            inArray(issues.status, expectedStatuses),
            or(isNull(issues.assigneeAgentId), sameRunAssigneeCondition),
            executionLockCondition,
          ),
        )
        .returning()
        .then((rows) => rows[0] ?? null);

      if (updated) {
        const [enriched] = await withIssueLabels(db, [updated]);
        return enriched;
      }

      const current = await db
        .select({
          id: issues.id,
          status: issues.status,
          assigneeAgentId: issues.assigneeAgentId,
          checkoutRunId: issues.checkoutRunId,
          executionRunId: issues.executionRunId,
        })
        .from(issues)
        .where(eq(issues.id, id))
        .then((rows) => rows[0] ?? null);

      if (!current) throw notFound("Issue not found");

      if (
        current.assigneeAgentId === agentId &&
        current.status === "in_progress" &&
        current.checkoutRunId == null &&
        (current.executionRunId == null || current.executionRunId === checkoutRunId) &&
        checkoutRunId
      ) {
        const adopted = await db
          .update(issues)
          .set({
            checkoutRunId,
            executionRunId: checkoutRunId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(issues.id, id),
              eq(issues.status, "in_progress"),
              eq(issues.assigneeAgentId, agentId),
              isNull(issues.checkoutRunId),
              or(isNull(issues.executionRunId), eq(issues.executionRunId, checkoutRunId)),
            ),
          )
          .returning()
          .then((rows) => rows[0] ?? null);
        if (adopted) return adopted;
      }

      if (
        checkoutRunId &&
        current.assigneeAgentId === agentId &&
        current.status === "in_progress" &&
        current.checkoutRunId &&
        current.checkoutRunId !== checkoutRunId
      ) {
        const adopted = await adoptStaleCheckoutRun({
          issueId: id,
          actorAgentId: agentId,
          actorRunId: checkoutRunId,
          expectedCheckoutRunId: current.checkoutRunId,
        });
        if (adopted) {
          const row = await db.select().from(issues).where(eq(issues.id, id)).then((rows) => rows[0]!);
          const [enriched] = await withIssueLabels(db, [row]);
          return enriched;
        }
      }

      // If this run already owns it and it's in_progress, return it (no self-409)
      if (
        current.assigneeAgentId === agentId &&
        current.status === "in_progress" &&
        sameRunLock(current.checkoutRunId, checkoutRunId)
      ) {
        const row = await db.select().from(issues).where(eq(issues.id, id)).then((rows) => rows[0]!);
        const [enriched] = await withIssueLabels(db, [row]);
        return enriched;
      }

      throw conflict("Issue checkout conflict", {
        issueId: current.id,
        status: current.status,
        assigneeAgentId: current.assigneeAgentId,
        checkoutRunId: current.checkoutRunId,
        executionRunId: current.executionRunId,
      });
    },

    assertCheckoutOwner: async (id: string, actorAgentId: string, actorRunId: string | null) => {
      const current = await db
        .select({
          id: issues.id,
          status: issues.status,
          assigneeAgentId: issues.assigneeAgentId,
          checkoutRunId: issues.checkoutRunId,
        })
        .from(issues)
        .where(eq(issues.id, id))
        .then((rows) => rows[0] ?? null);

      if (!current) throw notFound("Issue not found");

      if (
        current.status === "in_progress" &&
        current.assigneeAgentId === actorAgentId &&
        sameRunLock(current.checkoutRunId, actorRunId)
      ) {
        return { ...current, adoptedFromRunId: null as string | null };
      }

      if (
        actorRunId &&
        current.status === "in_progress" &&
        current.assigneeAgentId === actorAgentId &&
        current.checkoutRunId &&
        current.checkoutRunId !== actorRunId
      ) {
        const adopted = await adoptStaleCheckoutRun({
          issueId: id,
          actorAgentId,
          actorRunId,
          expectedCheckoutRunId: current.checkoutRunId,
        });

        if (adopted) {
          return {
            ...adopted,
            adoptedFromRunId: current.checkoutRunId,
          };
        }
      }

      throw conflict("Issue run ownership conflict", {
        issueId: current.id,
        status: current.status,
        assigneeAgentId: current.assigneeAgentId,
        checkoutRunId: current.checkoutRunId,
        actorAgentId,
        actorRunId,
      });
    },

    release: async (id: string, actorAgentId?: string, actorRunId?: string | null) => {
      const existing = await db
        .select()
        .from(issues)
        .where(eq(issues.id, id))
        .then((rows) => rows[0] ?? null);

      if (!existing) return null;
      if (actorAgentId && existing.assigneeAgentId && existing.assigneeAgentId !== actorAgentId) {
        throw conflict("Only assignee can release issue");
      }
      if (
        actorAgentId &&
        existing.status === "in_progress" &&
        existing.assigneeAgentId === actorAgentId &&
        existing.checkoutRunId &&
        !sameRunLock(existing.checkoutRunId, actorRunId ?? null)
      ) {
        throw conflict("Only checkout run can release issue", {
          issueId: existing.id,
          assigneeAgentId: existing.assigneeAgentId,
          checkoutRunId: existing.checkoutRunId,
          actorRunId: actorRunId ?? null,
        });
      }

      const updated = await db
        .update(issues)
        .set({
          status: "todo",
          assigneeAgentId: null,
          ...(isDelegatedChildExecutionBlockerDetails(existing.blockerDetails as Record<string, unknown> | null | undefined)
            ? { blockerDetails: null }
            : {}),
          checkoutRunId: null,
          executionRunId: null,
          executionLockedAt: null,
          executionAgentNameKey: null,
          updatedAt: new Date(),
        })
        .where(eq(issues.id, id))
        .returning()
        .then((rows) => rows[0] ?? null);
      if (!updated) return null;
      const [enriched] = await withIssueLabels(db, [updated]);
      return enriched;
    },

    listLabels: (companyId: string) =>
      db.select().from(labels).where(eq(labels.companyId, companyId)).orderBy(asc(labels.name), asc(labels.id)),

    getLabelById: (id: string) =>
      db
        .select()
        .from(labels)
        .where(eq(labels.id, id))
        .then((rows) => rows[0] ?? null),

    createLabel: async (companyId: string, data: Pick<typeof labels.$inferInsert, "name" | "color">) => {
      const [created] = await db
        .insert(labels)
        .values({
          companyId,
          name: data.name.trim(),
          color: data.color,
        })
        .returning();
      return created;
    },

    deleteLabel: async (id: string) =>
      db
        .delete(labels)
        .where(eq(labels.id, id))
        .returning()
        .then((rows) => rows[0] ?? null),

    listComments: async (
      issueId: string,
      opts?: {
        afterCommentId?: string | null;
        order?: "asc" | "desc";
        limit?: number | null;
      },
    ) => {
      const order = opts?.order === "asc" ? "asc" : "desc";
      const afterCommentId = opts?.afterCommentId?.trim() || null;
      const limit =
        opts?.limit && opts.limit > 0
          ? Math.min(Math.floor(opts.limit), MAX_ISSUE_COMMENT_PAGE_LIMIT)
          : null;

      const conditions = [eq(issueComments.issueId, issueId)];
      if (afterCommentId) {
        const anchor = await db
          .select({
            id: issueComments.id,
            createdAt: issueComments.createdAt,
          })
          .from(issueComments)
          .where(and(eq(issueComments.issueId, issueId), eq(issueComments.id, afterCommentId)))
          .then((rows) => rows[0] ?? null);

        if (!anchor) return [];
        conditions.push(
          order === "asc"
            ? sql<boolean>`(
                ${issueComments.createdAt} > ${anchor.createdAt}
                OR (${issueComments.createdAt} = ${anchor.createdAt} AND ${issueComments.id} > ${anchor.id})
              )`
            : sql<boolean>`(
                ${issueComments.createdAt} < ${anchor.createdAt}
                OR (${issueComments.createdAt} = ${anchor.createdAt} AND ${issueComments.id} < ${anchor.id})
              )`,
        );
      }

      const query = db
        .select()
        .from(issueComments)
        .where(and(...conditions))
        .orderBy(
          order === "asc" ? asc(issueComments.createdAt) : desc(issueComments.createdAt),
          order === "asc" ? asc(issueComments.id) : desc(issueComments.id),
        );

      const comments = limit ? await query.limit(limit) : await query;
      const { censorUsernameInLogs } = await instanceSettings.getGeneral();
      return comments.map((comment) => redactIssueComment(comment, censorUsernameInLogs));
    },

    getCommentCursor: async (issueId: string) => {
      const [latest, countRow] = await Promise.all([
        db
          .select({
            latestCommentId: issueComments.id,
            latestCommentAt: issueComments.createdAt,
          })
          .from(issueComments)
          .where(eq(issueComments.issueId, issueId))
          .orderBy(desc(issueComments.createdAt), desc(issueComments.id))
          .limit(1)
          .then((rows) => rows[0] ?? null),
        db
          .select({
            totalComments: sql<number>`count(*)::int`,
          })
          .from(issueComments)
          .where(eq(issueComments.issueId, issueId))
          .then((rows) => rows[0] ?? null),
      ]);

      return {
        totalComments: Number(countRow?.totalComments ?? 0),
        latestCommentId: latest?.latestCommentId ?? null,
        latestCommentAt: latest?.latestCommentAt ?? null,
      };
    },

    getComment: (commentId: string) =>
      instanceSettings.getGeneral().then(({ censorUsernameInLogs }) =>
        db
        .select()
        .from(issueComments)
        .where(eq(issueComments.id, commentId))
        .then((rows) => {
          const comment = rows[0] ?? null;
          return comment ? redactIssueComment(comment, censorUsernameInLogs) : null;
        })),

    addComment: async (issueId: string, body: string, actor: { agentId?: string; userId?: string }) => {
      const issue = await db
        .select({ companyId: issues.companyId })
        .from(issues)
        .where(eq(issues.id, issueId))
        .then((rows) => rows[0] ?? null);

      if (!issue) throw notFound("Issue not found");

      const currentUserRedactionOptions = {
        enabled: (await instanceSettings.getGeneral()).censorUsernameInLogs,
      };
      const redactedBody = redactCurrentUserText(body, currentUserRedactionOptions);
      const [comment] = await db
        .insert(issueComments)
        .values({
          companyId: issue.companyId,
          issueId,
          authorAgentId: actor.agentId ?? null,
          authorUserId: actor.userId ?? null,
          body: redactedBody,
        })
        .returning();

      // Update issue's updatedAt so comment activity is reflected in recency sorting
      await db
        .update(issues)
        .set({ updatedAt: new Date() })
        .where(eq(issues.id, issueId));

      return redactIssueComment(comment, currentUserRedactionOptions.enabled);
    },

    createAttachment: async (input: {
      issueId: string;
      issueCommentId?: string | null;
      provider: string;
      objectKey: string;
      contentType: string;
      byteSize: number;
      sha256: string;
      originalFilename?: string | null;
      createdByAgentId?: string | null;
      createdByUserId?: string | null;
    }) => {
      const issue = await db
        .select({ id: issues.id, companyId: issues.companyId })
        .from(issues)
        .where(eq(issues.id, input.issueId))
        .then((rows) => rows[0] ?? null);
      if (!issue) throw notFound("Issue not found");

      if (input.issueCommentId) {
        const comment = await db
          .select({ id: issueComments.id, companyId: issueComments.companyId, issueId: issueComments.issueId })
          .from(issueComments)
          .where(eq(issueComments.id, input.issueCommentId))
          .then((rows) => rows[0] ?? null);
        if (!comment) throw notFound("Issue comment not found");
        if (comment.companyId !== issue.companyId || comment.issueId !== issue.id) {
          throw unprocessable("Attachment comment must belong to same issue and company");
        }
      }

      return db.transaction(async (tx) => {
        const [asset] = await tx
          .insert(assets)
          .values({
            companyId: issue.companyId,
            provider: input.provider,
            objectKey: input.objectKey,
            contentType: input.contentType,
            byteSize: input.byteSize,
            sha256: input.sha256,
            originalFilename: input.originalFilename ?? null,
            createdByAgentId: input.createdByAgentId ?? null,
            createdByUserId: input.createdByUserId ?? null,
          })
          .returning();

        const [attachment] = await tx
          .insert(issueAttachments)
          .values({
            companyId: issue.companyId,
            issueId: issue.id,
            assetId: asset.id,
            issueCommentId: input.issueCommentId ?? null,
          })
          .returning();

        return {
          id: attachment.id,
          companyId: attachment.companyId,
          issueId: attachment.issueId,
          issueCommentId: attachment.issueCommentId,
          assetId: attachment.assetId,
          provider: asset.provider,
          objectKey: asset.objectKey,
          contentType: asset.contentType,
          byteSize: asset.byteSize,
          sha256: asset.sha256,
          originalFilename: asset.originalFilename,
          createdByAgentId: asset.createdByAgentId,
          createdByUserId: asset.createdByUserId,
          createdAt: attachment.createdAt,
          updatedAt: attachment.updatedAt,
        };
      });
    },

    listAttachments: async (issueId: string) =>
      db
        .select({
          id: issueAttachments.id,
          companyId: issueAttachments.companyId,
          issueId: issueAttachments.issueId,
          issueCommentId: issueAttachments.issueCommentId,
          assetId: issueAttachments.assetId,
          provider: assets.provider,
          objectKey: assets.objectKey,
          contentType: assets.contentType,
          byteSize: assets.byteSize,
          sha256: assets.sha256,
          originalFilename: assets.originalFilename,
          createdByAgentId: assets.createdByAgentId,
          createdByUserId: assets.createdByUserId,
          createdAt: issueAttachments.createdAt,
          updatedAt: issueAttachments.updatedAt,
        })
        .from(issueAttachments)
        .innerJoin(assets, eq(issueAttachments.assetId, assets.id))
        .where(eq(issueAttachments.issueId, issueId))
        .orderBy(desc(issueAttachments.createdAt)),

    getAttachmentById: async (id: string) =>
      db
        .select({
          id: issueAttachments.id,
          companyId: issueAttachments.companyId,
          issueId: issueAttachments.issueId,
          issueCommentId: issueAttachments.issueCommentId,
          assetId: issueAttachments.assetId,
          provider: assets.provider,
          objectKey: assets.objectKey,
          contentType: assets.contentType,
          byteSize: assets.byteSize,
          sha256: assets.sha256,
          originalFilename: assets.originalFilename,
          createdByAgentId: assets.createdByAgentId,
          createdByUserId: assets.createdByUserId,
          createdAt: issueAttachments.createdAt,
          updatedAt: issueAttachments.updatedAt,
        })
        .from(issueAttachments)
        .innerJoin(assets, eq(issueAttachments.assetId, assets.id))
        .where(eq(issueAttachments.id, id))
        .then((rows) => rows[0] ?? null),

    removeAttachment: async (id: string) =>
      db.transaction(async (tx) => {
        const existing = await tx
          .select({
            id: issueAttachments.id,
            companyId: issueAttachments.companyId,
            issueId: issueAttachments.issueId,
            issueCommentId: issueAttachments.issueCommentId,
            assetId: issueAttachments.assetId,
            provider: assets.provider,
            objectKey: assets.objectKey,
            contentType: assets.contentType,
            byteSize: assets.byteSize,
            sha256: assets.sha256,
            originalFilename: assets.originalFilename,
            createdByAgentId: assets.createdByAgentId,
            createdByUserId: assets.createdByUserId,
            createdAt: issueAttachments.createdAt,
            updatedAt: issueAttachments.updatedAt,
          })
          .from(issueAttachments)
          .innerJoin(assets, eq(issueAttachments.assetId, assets.id))
          .where(eq(issueAttachments.id, id))
          .then((rows) => rows[0] ?? null);
        if (!existing) return null;

        await tx.delete(issueAttachments).where(eq(issueAttachments.id, id));
        await tx.delete(assets).where(eq(assets.id, existing.assetId));
        return existing;
      }),

    findMentionedAgents: async (companyId: string, body: string) => {
      const re = /\B@([^\s@,!?.]+)/g;
      const tokens = new Set<string>();
      let m: RegExpExecArray | null;
      while ((m = re.exec(body)) !== null) tokens.add(m[1].toLowerCase());
      if (tokens.size === 0) return [];
      const rows = await db.select({ id: agents.id, name: agents.name })
        .from(agents).where(eq(agents.companyId, companyId));
      return rows.filter(a => tokens.has(a.name.toLowerCase())).map(a => a.id);
    },

    findMentionedProjectIds: async (issueId: string) => {
      const issue = await db
        .select({
          companyId: issues.companyId,
          title: issues.title,
          description: issues.description,
        })
        .from(issues)
        .where(eq(issues.id, issueId))
        .then((rows) => rows[0] ?? null);
      if (!issue) return [];

      const comments = await db
        .select({ body: issueComments.body })
        .from(issueComments)
        .where(eq(issueComments.issueId, issueId));

      const mentionedIds = new Set<string>();
      for (const source of [
        issue.title,
        issue.description ?? "",
        ...comments.map((comment) => comment.body),
      ]) {
        for (const projectId of extractProjectMentionIds(source)) {
          mentionedIds.add(projectId);
        }
      }
      if (mentionedIds.size === 0) return [];

      const rows = await db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.companyId, issue.companyId),
            inArray(projects.id, [...mentionedIds]),
          ),
        );
      const valid = new Set(rows.map((row) => row.id));
      return [...mentionedIds].filter((projectId) => valid.has(projectId));
    },

    getAncestors: async (companyId: string, issueId: string) => {
      const raw: Array<{
        id: string;
        identifier: string | null;
        title: string;
        description: string | null;
        status: string;
        priority: string;
        assigneeAgentId: string | null;
        projectId: string | null;
        goalId: string | null;
        parentId: string | null;
      }> = [];
      const visited = new Set<string>([issueId]);
      const start = await db
        .select({ parentId: issues.parentId })
        .from(issues)
        .where(and(eq(issues.id, issueId), eq(issues.companyId, companyId)))
        .then((rows) => rows[0] ?? null);
      let currentId = start?.parentId ?? null;
      while (currentId && !visited.has(currentId) && raw.length < 50) {
        visited.add(currentId);
        const parent = await db
          .select({
            id: issues.id,
            identifier: issues.identifier,
            title: issues.title,
            description: issues.description,
            status: issues.status,
            priority: issues.priority,
            assigneeAgentId: issues.assigneeAgentId,
            projectId: issues.projectId,
            goalId: issues.goalId,
            parentId: issues.parentId,
          })
          .from(issues)
          .where(and(eq(issues.id, currentId), eq(issues.companyId, companyId)))
          .then((rows) => rows[0] ?? null);
        if (!parent) break;
        raw.push({
          id: parent.id,
          identifier: parent.identifier ?? null,
          title: parent.title,
          description: parent.description ?? null,
          status: parent.status,
          priority: parent.priority,
          assigneeAgentId: parent.assigneeAgentId ?? null,
          projectId: parent.projectId ?? null,
          goalId: parent.goalId ?? null,
          parentId: parent.parentId ?? null,
        });
        currentId = parent.parentId ?? null;
      }

      const projectIds = [...new Set(raw.map((a) => a.projectId).filter((id): id is string => id != null))];
      const goalIds = [...new Set(raw.map((a) => a.goalId).filter((id): id is string => id != null))];

      const projectMap = new Map<
        string,
        {
          id: string;
          name: string;
          description: string | null;
          status: string;
          goalId: string | null;
          workspaces: Array<{
            id: string;
            companyId: string;
            projectId: string;
            name: string;
            cwd: string | null;
            repoUrl: string | null;
            repoRef: string | null;
            metadata: Record<string, unknown> | null;
            isPrimary: boolean;
            createdAt: Date;
            updatedAt: Date;
          }>;
          primaryWorkspace: {
            id: string;
            companyId: string;
            projectId: string;
            name: string;
            cwd: string | null;
            repoUrl: string | null;
            repoRef: string | null;
            metadata: Record<string, unknown> | null;
            isPrimary: boolean;
            createdAt: Date;
            updatedAt: Date;
          } | null;
        }
      >();
      const goalMap = new Map<
        string,
        { id: string; title: string; description: string | null; level: string; status: string }
      >();

      if (projectIds.length > 0) {
        const workspaceRows = await db
          .select()
          .from(projectWorkspaces)
          .where(and(eq(projectWorkspaces.companyId, companyId), inArray(projectWorkspaces.projectId, projectIds)))
          .orderBy(desc(projectWorkspaces.isPrimary), asc(projectWorkspaces.createdAt), asc(projectWorkspaces.id));
        const workspaceMap = new Map<string, Array<(typeof workspaceRows)[number]>>();
        for (const workspace of workspaceRows) {
          const existing = workspaceMap.get(workspace.projectId);
          if (existing) existing.push(workspace);
          else workspaceMap.set(workspace.projectId, [workspace]);
        }

        const rows = await db
          .select({
            id: projects.id,
            name: projects.name,
            description: projects.description,
            status: projects.status,
            goalId: projects.goalId,
          })
          .from(projects)
          .where(and(eq(projects.companyId, companyId), inArray(projects.id, projectIds)));
        for (const r of rows) {
          const projectWorkspaceRows = workspaceMap.get(r.id) ?? [];
          const workspaces = projectWorkspaceRows.map((workspace) => ({
            id: workspace.id,
            companyId: workspace.companyId,
            projectId: workspace.projectId,
            name: workspace.name,
            cwd: workspace.cwd,
            repoUrl: workspace.repoUrl ?? null,
            repoRef: workspace.repoRef ?? null,
            metadata: (workspace.metadata as Record<string, unknown> | null) ?? null,
            isPrimary: workspace.isPrimary,
            createdAt: workspace.createdAt,
            updatedAt: workspace.updatedAt,
          }));
          const primaryWorkspace = workspaces.find((workspace) => workspace.isPrimary) ?? workspaces[0] ?? null;
          projectMap.set(r.id, {
            ...r,
            workspaces,
            primaryWorkspace,
          });
          if (r.goalId && !goalIds.includes(r.goalId)) goalIds.push(r.goalId);
        }
      }

      if (goalIds.length > 0) {
        const rows = await db
          .select({
            id: goals.id,
            title: goals.title,
            description: goals.description,
            level: goals.level,
            status: goals.status,
          })
          .from(goals)
          .where(and(eq(goals.companyId, companyId), inArray(goals.id, goalIds)));
        for (const r of rows) goalMap.set(r.id, r);
      }

      return raw.map((a) => ({
        ...a,
        project: a.projectId ? projectMap.get(a.projectId) ?? null : null,
        goal: a.goalId ? goalMap.get(a.goalId) ?? null : null,
      }));
    },
  };
}
