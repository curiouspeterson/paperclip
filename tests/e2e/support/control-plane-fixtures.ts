import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  activityLog,
  agents,
  approvals,
  budgetIncidents,
  budgetPolicies,
  companies,
  costEvents,
  createDb,
  heartbeatRuns,
  issueComments,
  issues,
} from "../../../packages/db/src/index.ts";

type ClosableDb = ReturnType<typeof createDb> & {
  $client?: { end?: (opts?: { timeout?: number }) => Promise<void> };
};

function currentUtcMonthWindow(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)),
    end: new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0)),
  };
}

function resolveRuntimeConfigPath() {
  const explicitConfig = process.env.PAPERCLIP_CONFIG?.trim();
  if (explicitConfig) return explicitConfig;

  const dataDir = process.env.PAPERCLIP_E2E_RESOLVED_DATA_DIR?.trim();
  const instanceId = process.env.PAPERCLIP_E2E_RESOLVED_INSTANCE_ID?.trim() || "e2e";
  if (!dataDir) {
    throw new Error("Missing PAPERCLIP_E2E_RESOLVED_DATA_DIR; Playwright runtime was not initialized");
  }
  return path.join(dataDir, "instances", instanceId, "config.json");
}

function resolveDbPort() {
  const portFromEnv = Number(process.env.PAPERCLIP_E2E_RESOLVED_DB_PORT);
  if (Number.isInteger(portFromEnv) && portFromEnv > 0) return portFromEnv;

  const configPath = resolveRuntimeConfigPath();
  const parsed = JSON.parse(readFileSync(configPath, "utf8")) as {
    database?: { embeddedPostgresPort?: number };
  };
  const configPort = Number(parsed.database?.embeddedPostgresPort);
  if (Number.isInteger(configPort) && configPort > 0) return configPort;

  throw new Error(`Unable to resolve embedded postgres port from ${configPath}`);
}

function resolveConnectionString() {
  return `postgres://paperclip:paperclip@127.0.0.1:${resolveDbPort()}/paperclip`;
}

function sqlLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function issuePrefix() {
  const lettersOnly = randomUUID().replace(/[^a-f]/gi, "").toUpperCase();
  return `E${lettersOnly.slice(0, 5).padEnd(5, "A")}`;
}

async function withDb<T>(run: (db: ClosableDb) => Promise<T>) {
  const db = createDb(resolveConnectionString()) as ClosableDb;
  try {
    return await run(db);
  } finally {
    await db.$client?.end?.({ timeout: 1 }).catch(() => undefined);
  }
}

async function insertCompany(
  db: ClosableDb,
  input: {
    name: string;
    status?: "active" | "paused";
    pauseReason?: "budget" | "manual" | "system" | null;
    budgetMonthlyCents?: number;
    spentMonthlyCents?: number;
    issueCounter?: number;
  },
) {
  const now = new Date();
  const id = randomUUID();
  const status = input.status ?? "active";
  const pauseReason = input.pauseReason ?? null;
  const pausedAt = status === "paused" ? now : null;
  const companyIssuePrefix = issuePrefix();

  await db.insert(companies).values({
    id,
    name: input.name,
    status,
    pauseReason,
    pausedAt,
    issuePrefix: companyIssuePrefix,
    issueCounter: input.issueCounter ?? 0,
    budgetMonthlyCents: input.budgetMonthlyCents ?? 0,
    spentMonthlyCents: input.spentMonthlyCents ?? 0,
    requireBoardApprovalForNewAgents: true,
    createdAt: now,
    updatedAt: now,
  });

  return { id, name: input.name, issuePrefix: companyIssuePrefix };
}

async function insertAgent(
  db: ClosableDb,
  input: {
    companyId: string;
    name: string;
    status?: "idle" | "active" | "paused";
  },
) {
  const now = new Date();
  const id = randomUUID();
  const status = input.status ?? "idle";

  await db.insert(agents).values({
    id,
    companyId: input.companyId,
    name: input.name,
    role: "general",
    status,
    adapterType: "process",
    adapterConfig: {},
    runtimeConfig: {},
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    permissions: {},
    createdAt: now,
    updatedAt: now,
  });

  return { id, name: input.name };
}

export async function seedIssueTimelineFixture() {
  return withDb(async (db) => {
    const now = new Date();
    const company = await insertCompany(db, {
      name: `E2E Issue ${randomUUID().slice(0, 8)}`,
      issueCounter: 1,
    });
    const agent = await insertAgent(db, {
      companyId: company.id,
      name: "Run Reporter",
    });

    const issueId = randomUUID();
    const runId = randomUUID();
    const commentId = randomUUID();
    const issueTitle = "Seeded run completion issue";
    const completionComment = "Completed seeded operator handoff.";
    const identifier = `${company.issuePrefix}-1`;

    await db.insert(issues).values({
      id: issueId,
      companyId: company.id,
      title: issueTitle,
      description: "Seeded for browser e2e coverage",
      status: "in_review",
      priority: "high",
      assigneeAgentId: agent.id,
      createdByUserId: "board",
      issueNumber: 1,
      identifier,
      originKind: "manual",
      requestDepth: 0,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      completedAt: now,
    });

    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId: company.id,
      agentId: agent.id,
      invocationSource: "on_demand",
      status: "succeeded",
      startedAt: now,
      finishedAt: now,
      exitCode: 0,
      resultJson: { summary: "Seeded completion run" },
      contextSnapshot: { issueId, taskId: issueId, source: "e2e.seed" },
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(issueComments).values({
      id: commentId,
      companyId: company.id,
      issueId,
      authorAgentId: agent.id,
      body: completionComment,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(activityLog).values({
      id: randomUUID(),
      companyId: company.id,
      actorType: "agent",
      actorId: agent.id,
      action: "issue.comment_added",
      entityType: "issue",
      entityId: issueId,
      agentId: agent.id,
      runId,
      details: { commentId },
      createdAt: now,
    });

    return {
      companyId: company.id,
      companyPrefix: company.issuePrefix,
      issueId,
      issueTitle,
      completionComment,
      runShortId: runId.slice(0, 8),
    };
  });
}

export async function cleanupCompanyFixture(companyId: string) {
  await withDb(async (db) => {
    const client = db.$client;
    if (!client || typeof client.unsafe !== "function") {
      throw new Error("Cleanup requires direct postgres client access");
    }

    const id = sqlLiteral(companyId);
    const companyIssueIds = `(SELECT id FROM issues WHERE company_id = ${id})`;
    const statements = [
      `DELETE FROM issue_read_states WHERE company_id = ${id}`,
      `DELETE FROM issue_approvals WHERE issue_id IN ${companyIssueIds}`,
      `DELETE FROM issue_labels WHERE issue_id IN ${companyIssueIds}`,
      `DELETE FROM issue_documents WHERE issue_id IN ${companyIssueIds}`,
      `DELETE FROM issue_work_products WHERE issue_id IN ${companyIssueIds}`,
      `DELETE FROM issue_attachments WHERE issue_id IN ${companyIssueIds}`,
      `DELETE FROM finance_events WHERE company_id = ${id}`,
      `DELETE FROM activity_log WHERE company_id = ${id}`,
      `DELETE FROM issue_comments WHERE company_id = ${id}`,
      `DELETE FROM heartbeat_runs WHERE company_id = ${id}`,
      `DELETE FROM budget_incidents WHERE company_id = ${id}`,
      `DELETE FROM budget_policies WHERE company_id = ${id}`,
      `DELETE FROM cost_events WHERE company_id = ${id}`,
      `DELETE FROM approvals WHERE company_id = ${id}`,
      `DELETE FROM issues WHERE company_id = ${id}`,
      `DELETE FROM agents WHERE company_id = ${id}`,
      `DELETE FROM companies WHERE id = ${id}`,
    ];

    for (const statement of statements) {
      await client.unsafe(statement);
    }
  });
}

export async function seedPendingApprovalFixture() {
  return withDb(async (db) => {
    const now = new Date();
    const company = await insertCompany(db, {
      name: `E2E Approval ${randomUUID().slice(0, 8)}`,
    });
    const approvalId = randomUUID();

    await db.insert(approvals).values({
      id: approvalId,
      companyId: company.id,
      type: "approve_ceo_strategy",
      requestedByUserId: "board",
      status: "pending",
      payload: {
        title: "Podcast content expansion",
        plan: "Approve the next editorial experiment for the seeded e2e company.",
      },
      createdAt: now,
      updatedAt: now,
    });

    return {
      companyId: company.id,
      companyPrefix: company.issuePrefix,
      approvalId,
      label: "CEO Strategy",
    };
  });
}

export async function seedBudgetIncidentFixture() {
  return withDb(async (db) => {
    const now = new Date();
    const { start, end } = currentUtcMonthWindow(now);
    const company = await insertCompany(db, {
      name: `E2E Budget ${randomUUID().slice(0, 8)}`,
      status: "paused",
      pauseReason: "budget",
      budgetMonthlyCents: 10_000,
      spentMonthlyCents: 12_500,
    });
    const agent = await insertAgent(db, {
      companyId: company.id,
      name: "Budgeted Agent",
    });
    const policyId = randomUUID();
    const incidentId = randomUUID();

    await db.insert(budgetPolicies).values({
      id: policyId,
      companyId: company.id,
      scopeType: "company",
      scopeId: company.id,
      metric: "billed_cents",
      windowKind: "calendar_month_utc",
      amount: 10_000,
      warnPercent: 80,
      hardStopEnabled: true,
      notifyEnabled: true,
      isActive: true,
      createdByUserId: "board",
      updatedByUserId: "board",
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(costEvents).values({
      id: randomUUID(),
      companyId: company.id,
      agentId: agent.id,
      provider: "openai",
      biller: "openai",
      billingType: "inference",
      model: "gpt-5.4",
      inputTokens: 1_200,
      cachedInputTokens: 0,
      outputTokens: 600,
      costCents: 12_500,
      occurredAt: now,
      createdAt: now,
    });

    await db.insert(budgetIncidents).values({
      id: incidentId,
      companyId: company.id,
      policyId,
      scopeType: "company",
      scopeId: company.id,
      metric: "billed_cents",
      windowKind: "calendar_month_utc",
      windowStart: start,
      windowEnd: end,
      thresholdType: "hard",
      amountLimit: 10_000,
      amountObserved: 12_500,
      status: "open",
      createdAt: now,
      updatedAt: now,
    });

    return {
      companyId: company.id,
      companyPrefix: company.issuePrefix,
      incidentId,
      scopeName: company.name,
    };
  });
}
