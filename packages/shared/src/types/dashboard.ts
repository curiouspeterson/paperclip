export interface DelegatedChildDashboardTarget {
  issueId: string;
  identifier: string | null;
  parentIssueId: string;
  parentIdentifier: string | null;
  parentTitle: string;
}

export interface DashboardSummary {
  companyId: string;
  agents: {
    active: number;
    running: number;
    paused: number;
    error: number;
  };
  tasks: {
    open: number;
    inProgress: number;
    blocked: number;
    waitingOnDelegatedChild: number;
    waitingOnDelegatedChildTarget: DelegatedChildDashboardTarget | null;
    waitingOnDelegatedChildTargets: DelegatedChildDashboardTarget[];
    done: number;
  };
  costs: {
    monthSpendCents: number;
    monthBudgetCents: number;
    monthUtilizationPercent: number;
  };
  pendingApprovals: number;
  budgets: {
    activeIncidents: number;
    pendingApprovals: number;
    pausedAgents: number;
    pausedProjects: number;
  };
}
