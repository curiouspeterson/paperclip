import type { DashboardSummary } from "./types/dashboard.js";

export type DashboardAlertKind =
  | "agent-errors"
  | "budget"
  | "delegated-work";

export function getDashboardAlertKinds(
  summary: DashboardSummary | undefined,
  options?: { hasFailedRuns?: boolean },
): DashboardAlertKind[] {
  if (!summary) return [];

  const alerts: DashboardAlertKind[] = [];
  const hasFailedRuns = options?.hasFailedRuns ?? false;

  if (summary.agents.error > 0 && !hasFailedRuns) {
    alerts.push("agent-errors");
  }

  if (summary.costs.monthBudgetCents > 0 && summary.costs.monthUtilizationPercent >= 80) {
    alerts.push("budget");
  }

  if (summary.tasks.waitingOnDelegatedChild > 0) {
    alerts.push("delegated-work");
  }

  return alerts;
}
