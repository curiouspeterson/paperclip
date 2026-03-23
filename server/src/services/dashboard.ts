import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, approvals, companies, costEvents, issues } from "@paperclipai/db";
import { notFound } from "../errors.js";
import { budgetService } from "./budgets.js";

const DELEGATED_CHILD_EXECUTION_BLOCKER_TYPE = "delegated_child_execution";
const MAX_DELEGATED_CHILD_TARGETS = 3;

export function dashboardService(db: Db) {
  const budgets = budgetService(db);
  return {
    summary: async (companyId: string) => {
      const company = await db
        .select()
        .from(companies)
        .where(eq(companies.id, companyId))
        .then((rows) => rows[0] ?? null);

      if (!company) throw notFound("Company not found");

      const agentRows = await db
        .select({ status: agents.status, count: sql<number>`count(*)` })
        .from(agents)
        .where(eq(agents.companyId, companyId))
        .groupBy(agents.status);

      const taskRows = await db
        .select({ status: issues.status, count: sql<number>`count(*)` })
        .from(issues)
        .where(eq(issues.companyId, companyId))
        .groupBy(issues.status);

      const waitingOnDelegatedChild = await db
        .select({ count: sql<number>`count(*)` })
        .from(issues)
        .where(
          and(
            eq(issues.companyId, companyId),
            eq(issues.status, "blocked"),
            sql`${issues.blockerDetails} ->> 'blockerType' = ${DELEGATED_CHILD_EXECUTION_BLOCKER_TYPE}`,
          ),
        )
        .then((rows) => Number(rows[0]?.count ?? 0));

      const waitingOnDelegatedChildTarget = await db
        .select({
          issueId: sql<string>`${issues.blockerDetails} ->> 'delegatedChildIssueId'`,
          identifier: sql<string | null>`${issues.blockerDetails} ->> 'delegatedChildIdentifier'`,
          parentIssueId: issues.id,
          parentIdentifier: issues.identifier,
          parentTitle: issues.title,
        })
        .from(issues)
        .where(
          and(
            eq(issues.companyId, companyId),
            eq(issues.status, "blocked"),
            isNotNull(issues.blockerDetails),
            sql`${issues.blockerDetails} ->> 'blockerType' = ${DELEGATED_CHILD_EXECUTION_BLOCKER_TYPE}`,
            sql`${issues.blockerDetails} ->> 'delegatedChildIssueId' is not null`,
          ),
        )
        .orderBy(desc(issues.updatedAt))
        .limit(1)
        .then((rows) => rows[0] ?? null);

      const waitingOnDelegatedChildTargets = await db
        .select({
          issueId: sql<string>`${issues.blockerDetails} ->> 'delegatedChildIssueId'`,
          identifier: sql<string | null>`${issues.blockerDetails} ->> 'delegatedChildIdentifier'`,
          parentIssueId: issues.id,
          parentIdentifier: issues.identifier,
          parentTitle: issues.title,
        })
        .from(issues)
        .where(
          and(
            eq(issues.companyId, companyId),
            eq(issues.status, "blocked"),
            isNotNull(issues.blockerDetails),
            sql`${issues.blockerDetails} ->> 'blockerType' = ${DELEGATED_CHILD_EXECUTION_BLOCKER_TYPE}`,
            sql`${issues.blockerDetails} ->> 'delegatedChildIssueId' is not null`,
          ),
        )
        .orderBy(desc(issues.updatedAt))
        .limit(10)
        .then((rows) => {
          const deduped: Array<{
            issueId: string;
            identifier: string | null;
            parentIssueId: string;
            parentIdentifier: string | null;
            parentTitle: string;
          }> = [];
          const seenIssueIds = new Set<string>();
          for (const row of rows) {
            if (!row.issueId || seenIssueIds.has(row.issueId)) continue;
            seenIssueIds.add(row.issueId);
            deduped.push(row);
            if (deduped.length >= MAX_DELEGATED_CHILD_TARGETS) break;
          }
          return deduped;
        });

      const pendingApprovals = await db
        .select({ count: sql<number>`count(*)` })
        .from(approvals)
        .where(and(eq(approvals.companyId, companyId), eq(approvals.status, "pending")))
        .then((rows) => Number(rows[0]?.count ?? 0));

      const agentCounts: Record<string, number> = {
        active: 0,
        running: 0,
        paused: 0,
        error: 0,
      };
      for (const row of agentRows) {
        const count = Number(row.count);
        // "idle" agents are operational — count them as active
        const bucket = row.status === "idle" ? "active" : row.status;
        agentCounts[bucket] = (agentCounts[bucket] ?? 0) + count;
      }

      const taskCounts: {
        open: number;
        inProgress: number;
        blocked: number;
        waitingOnDelegatedChild: number;
        waitingOnDelegatedChildTarget: {
          issueId: string;
          identifier: string | null;
          parentIssueId: string;
          parentIdentifier: string | null;
          parentTitle: string;
        } | null;
        waitingOnDelegatedChildTargets: Array<{
          issueId: string;
          identifier: string | null;
          parentIssueId: string;
          parentIdentifier: string | null;
          parentTitle: string;
        }>;
        done: number;
      } = {
        open: 0,
        inProgress: 0,
        blocked: 0,
        waitingOnDelegatedChild,
        waitingOnDelegatedChildTarget,
        waitingOnDelegatedChildTargets,
        done: 0,
      };
      for (const row of taskRows) {
        const count = Number(row.count);
        if (row.status === "in_progress") taskCounts.inProgress += count;
        if (row.status === "blocked") taskCounts.blocked += count;
        if (row.status === "done") taskCounts.done += count;
        if (row.status !== "done" && row.status !== "cancelled") taskCounts.open += count;
      }

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const [{ monthSpend }] = await db
        .select({
          monthSpend: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::int`,
        })
        .from(costEvents)
        .where(
          and(
            eq(costEvents.companyId, companyId),
            gte(costEvents.occurredAt, monthStart),
          ),
        );

      const monthSpendCents = Number(monthSpend);
      const utilization =
        company.budgetMonthlyCents > 0
          ? (monthSpendCents / company.budgetMonthlyCents) * 100
          : 0;
      const budgetOverview = await budgets.overview(companyId);

      return {
        companyId,
        agents: {
          active: agentCounts.active,
          running: agentCounts.running,
          paused: agentCounts.paused,
          error: agentCounts.error,
        },
        tasks: taskCounts,
        costs: {
          monthSpendCents,
          monthBudgetCents: company.budgetMonthlyCents,
          monthUtilizationPercent: Number(utilization.toFixed(2)),
        },
        pendingApprovals,
        budgets: {
          activeIncidents: budgetOverview.activeIncidents.length,
          pendingApprovals: budgetOverview.pendingApprovalCount,
          pausedAgents: budgetOverview.pausedAgentCount,
          pausedProjects: budgetOverview.pausedProjectCount,
        },
      };
    },
  };
}
