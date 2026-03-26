import { randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  applyPendingMigrations,
  createDb,
  ensurePostgresDatabase,
  agents,
  companies,
  executionWorkspaces,
  goals,
  heartbeatRuns,
  issueComments,
  issues,
  projectWorkspaces,
  projects,
} from "@paperclipai/db";
import { issueService } from "../services/issues.js";

type EmbeddedPostgresInstance = {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
};

type EmbeddedPostgresCtor = new (opts: {
  databaseDir: string;
  user: string;
  password: string;
  port: number;
  persistent: boolean;
  initdbFlags?: string[];
  onLog?: (message: unknown) => void;
  onError?: (message: unknown) => void;
}) => EmbeddedPostgresInstance;

async function getEmbeddedPostgresCtor(): Promise<EmbeddedPostgresCtor> {
  const mod = await import("embedded-postgres");
  return mod.default as EmbeddedPostgresCtor;
}

async function getAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate test port")));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

async function startTempDatabase() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-issue-contract-"));
  const port = await getAvailablePort();
  const EmbeddedPostgres = await getEmbeddedPostgresCtor();
  const instance = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "paperclip",
    password: "paperclip",
    port,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {},
    onError: () => {},
  });
  await instance.initialise();
  await instance.start();

  const adminConnectionString = `postgres://paperclip:paperclip@127.0.0.1:${port}/postgres`;
  await ensurePostgresDatabase(adminConnectionString, "paperclip");
  const connectionString = `postgres://paperclip:paperclip@127.0.0.1:${port}/paperclip`;
  await applyPendingMigrations(connectionString);
  return { connectionString, dataDir, instance };
}

describe("issue service contracts", () => {
  let db!: ReturnType<typeof createDb>;
  let instance: EmbeddedPostgresInstance | null = null;
  let dataDir = "";

  beforeAll(async () => {
    const started = await startTempDatabase();
    db = createDb(started.connectionString);
    instance = started.instance;
    dataDir = started.dataDir;
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueComments);
    await db.delete(issues);
    await db.delete(executionWorkspaces);
    await db.delete(projectWorkspaces);
    await db.delete(heartbeatRuns);
    await db.delete(goals);
    await db.delete(projects);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await instance?.stop();
    if (dataDir) {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  async function seedCompany(name: string) {
    const id = randomUUID();
    await db.insert(companies).values({
      id,
      name,
      issuePrefix: name.slice(0, 3).toUpperCase(),
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(goals).values({
      id: randomUUID(),
      companyId: id,
      title: `${name} goal`,
      level: "company",
      status: "active",
      parentId: null,
    });
    return id;
  }

  async function seedAgent(companyId: string, name = "Agent") {
    const id = randomUUID();
    await db.insert(agents).values({
      id,
      companyId,
      name,
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    return id;
  }

  it("rejects a foreign project on create", async () => {
    const companyId = await seedCompany("Alpha");
    const foreignCompanyId = await seedCompany("Beta");
    const foreignProjectId = randomUUID();

    await db.insert(projects).values({
      id: foreignProjectId,
      companyId: foreignCompanyId,
      name: "Foreign project",
      status: "backlog",
    });

    const svc = issueService(db);

    await expect(
      svc.create(companyId, {
        projectId: foreignProjectId,
        title: "Cross-company project",
        status: "todo",
        priority: "medium",
      } as any),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("rejects creating a top-level issue when it cannot trace to a company goal", async () => {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Alpha",
      issuePrefix: "ALP",
      requireBoardApprovalForNewAgents: false,
    });

    await expect(
      issueService(db).create(companyId, {
        title: "Untraceable issue",
        status: "todo",
        priority: "medium",
      } as any),
    ).rejects.toMatchObject({
      status: 422,
      message: "Issue must trace to a goal via goalId, parentId, projectId, or a company goal",
    });
  });

  it("uses the default root company goal even when it is planned", async () => {
    const companyId = randomUUID();
    const rootGoalId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Alpha",
      issuePrefix: "ALP",
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(goals).values({
      id: rootGoalId,
      companyId,
      title: "Alpha mission",
      level: "company",
      status: "planned",
      parentId: null,
    });

    const { issue } = await issueService(db).create(companyId, {
      title: "Traceable via root goal",
      status: "todo",
      priority: "medium",
    } as any);

    expect(issue.goalId).toBe(rootGoalId);
  });

  it("inherits the parent issue goal when creating a child issue without an explicit goal", async () => {
    const companyId = await seedCompany("Alpha");
    const agentId = await seedAgent(companyId);
    const parentGoalId = randomUUID();
    const parentIssueId = randomUUID();

    await db.insert(goals).values({
      id: parentGoalId,
      companyId,
      title: "Parent goal",
      level: "task",
      status: "active",
      parentId: null,
    });
    await db.insert(issues).values({
      id: parentIssueId,
      companyId,
      title: "Parent issue",
      status: "todo",
      priority: "medium",
      goalId: parentGoalId,
      assigneeAgentId: agentId,
      createdByAgentId: agentId,
    });

    const created = await issueService(db).create(companyId, {
      title: "Child issue",
      parentId: parentIssueId,
      assigneeAgentId: agentId,
      createdByAgentId: agentId,
      status: "todo",
      priority: "medium",
    } as any);

    expect(created.issue.goalId).toBe(parentGoalId);
  });

  it("rejects a foreign goal on update", async () => {
    const companyId = await seedCompany("Alpha");
    const foreignCompanyId = await seedCompany("Beta");
    const { issue } = await issueService(db).create(companyId, {
      title: "Owned issue",
      status: "todo",
      priority: "medium",
    } as any);

    const foreignGoalId = randomUUID();
    await db.insert(goals).values({
      id: foreignGoalId,
      companyId: foreignCompanyId,
      title: "Foreign goal",
      level: "task",
      status: "planned",
    });

    await expect(
      issueService(db).update(issue.id, { goalId: foreignGoalId } as any),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("rejects new human-assigned issues on create", async () => {
    const companyId = await seedCompany("Alpha");

    await expect(
      issueService(db).create(companyId, {
        title: "Human assignment",
        status: "todo",
        priority: "medium",
        assigneeUserId: "user-1",
      } as any),
    ).rejects.toMatchObject({
      status: 422,
      message: "Human assignees are no longer supported for new issue assignments",
    });
  });

  it("rejects assigning an issue to a user on update", async () => {
    const companyId = await seedCompany("Alpha");
    const issueId = randomUUID();

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Issue",
      status: "todo",
      priority: "medium",
    });

    await expect(
      issueService(db).update(issueId, {
        assigneeUserId: "user-1",
      } as any),
    ).rejects.toMatchObject({
      status: 422,
      message: "Human assignees are no longer supported for new issue assignments",
    });
  });

  it("rejects a foreign parent issue on update", async () => {
    const companyId = await seedCompany("Alpha");
    const foreignCompanyId = await seedCompany("Beta");
    const { issue } = await issueService(db).create(companyId, {
      title: "Owned issue",
      status: "todo",
      priority: "medium",
    } as any);

    const foreignParentId = randomUUID();
    await db.insert(issues).values({
      id: foreignParentId,
      companyId: foreignCompanyId,
      title: "Foreign parent",
      status: "todo",
      priority: "medium",
    });

    await expect(
      issueService(db).update(issue.id, { parentId: foreignParentId } as any),
    ).rejects.toMatchObject({ status: 422 });
  });

  it.each([
    { from: "backlog", to: "done" },
    { from: "blocked", to: "done" },
  ])("rejects invalid issue transitions from $from to $to", async ({ from, to }) => {
    const companyId = await seedCompany("Alpha");
    const { issue } = await issueService(db).create(companyId, {
      title: "Transition issue",
      status: from,
      priority: "medium",
    } as any);

    await expect(
      issueService(db).update(issue.id, { status: to } as any),
    ).rejects.toMatchObject({
      status: 409,
      message: "Invalid issue status transition",
      details: {
        from,
        to,
      },
    });
  });

  it("clears execution locks on release", async () => {
    const companyId = await seedCompany("Alpha");
    const agentId = await seedAgent(companyId);
    const runId = randomUUID();
    const issueId = randomUUID();
    const now = new Date("2026-03-20T12:00:00.000Z");

    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "assignment",
      status: "running",
      startedAt: now,
      updatedAt: now,
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Release me",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: agentId,
      checkoutRunId: runId,
      executionRunId: runId,
      executionAgentNameKey: "agent",
      executionLockedAt: now,
    });

    const released = await issueService(db).release(issueId, agentId, runId);
    expect(released).not.toBeNull();
    expect(released?.checkoutRunId).toBeNull();
    expect(released?.executionRunId).toBeNull();
    expect(released?.executionLockedAt).toBeNull();
    expect(released?.executionAgentNameKey).toBeNull();
  });

  it("clears both assignee fields on release", async () => {
    const companyId = await seedCompany("Alpha");
    const issueId = randomUUID();
    const userId = "user-1";

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Release me",
      status: "todo",
      priority: "medium",
      assigneeUserId: userId,
    });

    const released = await issueService(db).release(issueId);
    expect(released).not.toBeNull();
    expect(released?.assigneeAgentId).toBeNull();
    expect(released?.assigneeUserId).toBeNull();
  });

  it("rejects releasing a done issue through the release path", async () => {
    const companyId = await seedCompany("Alpha");
    const issueId = randomUUID();
    const completedAt = new Date("2026-03-20T12:00:00.000Z");

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Done issue",
      status: "done",
      priority: "medium",
      completedAt,
    });

    await expect(issueService(db).release(issueId)).rejects.toMatchObject({
      status: 409,
      message: "Cannot release issue from terminal status",
    });

    const persisted = await db
      .select()
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0] ?? null);
    expect(persisted?.status).toBe("done");
    expect(persisted?.completedAt?.toISOString()).toBe(completedAt.toISOString());
  });

  it("rejects releasing a cancelled issue through the release path", async () => {
    const companyId = await seedCompany("Alpha");
    const issueId = randomUUID();
    const cancelledAt = new Date("2026-03-20T12:00:00.000Z");

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Cancelled issue",
      status: "cancelled",
      priority: "medium",
      cancelledAt,
    });

    await expect(issueService(db).release(issueId)).rejects.toMatchObject({
      status: 409,
      message: "Cannot release issue from terminal status",
    });

    const persisted = await db
      .select()
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0] ?? null);
    expect(persisted?.status).toBe("cancelled");
    expect(persisted?.cancelledAt?.toISOString()).toBe(cancelledAt.toISOString());
  });

  it("does not traverse parent issues from another company", async () => {
    const companyId = await seedCompany("Alpha");
    const foreignCompanyId = await seedCompany("Beta");
    const foreignParentId = randomUUID();
    const childId = randomUUID();

    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = replica`);
      await tx.insert(issues).values({
        id: foreignParentId,
        companyId: foreignCompanyId,
        title: "Foreign parent",
        status: "todo",
        priority: "medium",
      });
      await tx.insert(issues).values({
        id: childId,
        companyId,
        title: "Child",
        status: "todo",
        priority: "medium",
        parentId: foreignParentId,
      });
    });

    const ancestors = await issueService(db).getAncestors(companyId, childId);
    expect(ancestors).toEqual([]);
  });

  it("demotes an active issue to todo when the assignee changes", async () => {
    const companyId = await seedCompany("Alpha");
    const currentAgentId = await seedAgent(companyId, "Current");
    const nextAgentId = await seedAgent(companyId, "Next");
    const runId = randomUUID();
    const issueId = randomUUID();
    const now = new Date("2026-03-20T12:00:00.000Z");

    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId: currentAgentId,
      invocationSource: "assignment",
      status: "running",
      startedAt: now,
      updatedAt: now,
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Reassign me",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: currentAgentId,
      checkoutRunId: runId,
      executionRunId: runId,
      executionAgentNameKey: "agent",
      executionLockedAt: now,
    });

    const updated = await issueService(db).update(issueId, {
      assigneeAgentId: nextAgentId,
      assigneeUserId: null,
    } as any);

    expect(updated?.status).toBe("todo");
    expect(updated?.assigneeAgentId).toBe(nextAgentId);
    expect(updated?.checkoutRunId).toBeNull();
    expect(updated?.executionRunId).toBeNull();
    expect(updated?.executionLockedAt).toBeNull();
    expect(updated?.executionAgentNameKey).toBeNull();
  });

  it("reuses an open delegated child issue for repeated agent delegation", async () => {
    const companyId = await seedCompany("Alpha");
    const managerAgentId = await seedAgent(companyId, "Manager");
    const workerAgentId = await seedAgent(companyId, "Worker");
    const parentId = randomUUID();

    await db.insert(issues).values({
      id: parentId,
      companyId,
      title: "Parent task",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: managerAgentId,
      createdByAgentId: managerAgentId,
    });

    const svc = issueService(db);
    const first = await svc.create(companyId, {
      title: "Implement Hermes wrapper",
      parentId,
      assigneeAgentId: workerAgentId,
      createdByAgentId: managerAgentId,
      status: "todo",
      priority: "medium",
    } as any);
    const second = await svc.create(companyId, {
      title: "  Implement   Hermes wrapper  ",
      parentId,
      assigneeAgentId: workerAgentId,
      createdByAgentId: managerAgentId,
      status: "todo",
      priority: "medium",
    } as any);

    expect(first.created).toBe(true);
    expect(first.issue.delegationKey).toMatch(/^delegated:/);
    expect(second.created).toBe(false);
    expect(second.issue.id).toBe(first.issue.id);
    expect(second.issue.delegationKey).toBe(first.issue.delegationKey);

    const rows = await db
      .select({ id: issues.id, delegationKey: issues.delegationKey })
      .from(issues)
      .where(eq(issues.companyId, companyId));
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === first.issue.id)?.delegationKey).toBe(first.issue.delegationKey);

    const company = await db
      .select({ issueCounter: companies.issueCounter })
      .from(companies)
      .where(eq(companies.id, companyId))
      .then((result) => result[0]);
    expect(company?.issueCounter).toBe(1);
  });

  it("rejects agent-delegated child issues without an assignee", async () => {
    const companyId = await seedCompany("Alpha");
    const managerAgentId = await seedAgent(companyId, "Manager");
    const parentId = randomUUID();

    await db.insert(issues).values({
      id: parentId,
      companyId,
      title: "Parent task",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: managerAgentId,
      createdByAgentId: managerAgentId,
    });

    const svc = issueService(db);

    await expect(
      svc.create(companyId, {
        title: "Unassigned delegated child",
        parentId,
        createdByAgentId: managerAgentId,
        status: "todo",
        priority: "medium",
      } as any),
    ).rejects.toMatchObject({
      status: 422,
      message: "Delegated child issues must include an assignee",
    });
  });

  it("reuses a delegated child by explicit delegation key even when the title changes", async () => {
    const companyId = await seedCompany("Alpha");
    const managerAgentId = await seedAgent(companyId, "Manager");
    const workerAgentId = await seedAgent(companyId, "Worker");
    const parentId = randomUUID();

    await db.insert(issues).values({
      id: parentId,
      companyId,
      title: "Parent task",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: managerAgentId,
      createdByAgentId: managerAgentId,
    });

    const svc = issueService(db);
    const first = await svc.create(companyId, {
      title: "Implement Hermes wrapper",
      parentId,
      delegationKey: "newsletter.hermes-wrapper",
      assigneeAgentId: workerAgentId,
      createdByAgentId: managerAgentId,
      status: "todo",
      priority: "medium",
    } as any);
    const second = await svc.create(companyId, {
      title: "Fix syntax in Hermes wrapper",
      parentId,
      delegationKey: "newsletter.hermes-wrapper",
      assigneeAgentId: workerAgentId,
      createdByAgentId: managerAgentId,
      status: "todo",
      priority: "medium",
    } as any);

    expect(first.created).toBe(true);
    expect(first.issue.delegationKey).toBe("newsletter.hermes-wrapper");
    expect(second.created).toBe(false);
    expect(second.issue.id).toBe(first.issue.id);
  });

  it("backfills legacy delegated children so future creates reuse them", async () => {
    const companyId = await seedCompany("Alpha");
    const managerAgentId = await seedAgent(companyId, "Manager");
    const workerAgentId = await seedAgent(companyId, "Worker");
    const parentId = randomUUID();
    const legacyChildId = randomUUID();

    await db.insert(issues).values({
      id: parentId,
      companyId,
      title: "Parent task",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: managerAgentId,
      createdByAgentId: managerAgentId,
    });
    await db.insert(issues).values({
      id: legacyChildId,
      companyId,
      parentId,
      title: "Implement Hermes wrapper",
      status: "todo",
      priority: "medium",
      assigneeAgentId: workerAgentId,
      createdByAgentId: managerAgentId,
    });

    const svc = issueService(db);
    const result = await svc.backfillDelegationKeys({ companyId });

    expect(result.updatedCount).toBe(1);
    expect(result.skippedIssues).toEqual([]);

    const backfilled = await svc.getById(legacyChildId);
    expect(backfilled?.delegationKey).toMatch(/^delegated:/);

    const created = await svc.create(companyId, {
      title: "  Implement   Hermes wrapper ",
      parentId,
      assigneeAgentId: workerAgentId,
      createdByAgentId: managerAgentId,
      status: "todo",
      priority: "medium",
    } as any);

    expect(created.created).toBe(false);
    expect(created.issue.id).toBe(legacyChildId);
  });

  it("reports conflicting legacy delegated children without backfilling them", async () => {
    const companyId = await seedCompany("Alpha");
    const managerAgentId = await seedAgent(companyId, "Manager");
    const workerAgentId = await seedAgent(companyId, "Worker");
    const parentId = randomUUID();
    const firstLegacyChildId = randomUUID();
    const secondLegacyChildId = randomUUID();

    await db.insert(issues).values({
      id: parentId,
      companyId,
      title: "Parent task",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: managerAgentId,
      createdByAgentId: managerAgentId,
    });
    await db.insert(issues).values([
      {
        id: firstLegacyChildId,
        companyId,
        parentId,
        title: "Implement Hermes wrapper",
        status: "todo",
        priority: "medium",
        assigneeAgentId: workerAgentId,
        createdByAgentId: managerAgentId,
      },
      {
        id: secondLegacyChildId,
        companyId,
        parentId,
        title: "  Implement   Hermes wrapper  ",
        status: "todo",
        priority: "medium",
        assigneeAgentId: workerAgentId,
        createdByAgentId: managerAgentId,
      },
    ]);

    const result = await issueService(db).backfillDelegationKeys({ companyId });

    expect(result.updatedCount).toBe(0);
    expect(result.skippedIssues).toHaveLength(2);
    expect(result.skippedIssues.every((entry) => entry.reason === "conflicting_legacy_duplicates")).toBe(true);

    const rows = await db
      .select({ id: issues.id, delegationKey: issues.delegationKey })
      .from(issues)
      .where(eq(issues.companyId, companyId));
    expect(rows.filter((row) => row.id !== parentId).every((row) => row.delegationKey == null)).toBe(true);
  });

  it("rejects delegated child creation when a parent already has too many open delegated children", async () => {
    const companyId = await seedCompany("Alpha");
    const managerAgentId = await seedAgent(companyId, "Manager");
    const workerAgentId = await seedAgent(companyId, "Worker");
    const parentId = randomUUID();
    const now = new Date();

    await db.insert(issues).values({
      id: parentId,
      companyId,
      title: "Parent task",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: managerAgentId,
      createdByAgentId: managerAgentId,
    });

    for (let index = 0; index < 20; index += 1) {
      await db.insert(issues).values({
        id: randomUUID(),
        companyId,
        title: `Delegated child ${index + 1}`,
        parentId,
        assigneeAgentId: workerAgentId,
        createdByAgentId: managerAgentId,
        status: "todo",
        priority: "medium",
        createdAt: new Date(now.getTime() - ((20 - index) * 60 * 60 * 1000)),
        updatedAt: now,
      });
    }

    await expect(
      issueService(db).create(companyId, {
        title: "Delegated child 21",
        parentId,
        assigneeAgentId: workerAgentId,
        createdByAgentId: managerAgentId,
        status: "todo",
        priority: "medium",
      } as any),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("rejects delegated child creation bursts under the same parent in a short window", async () => {
    const companyId = await seedCompany("Alpha");
    const managerAgentId = await seedAgent(companyId, "Manager");
    const workerAgentId = await seedAgent(companyId, "Worker");
    const parentId = randomUUID();
    const now = new Date();

    await db.insert(issues).values({
      id: parentId,
      companyId,
      title: "Coordinate newsletter launch",
      status: "blocked",
      priority: "medium",
      assigneeAgentId: managerAgentId,
      createdByAgentId: managerAgentId,
      updatedAt: now,
    });

    for (let index = 0; index < 5; index += 1) {
      await db.insert(issues).values({
        id: randomUUID(),
        companyId,
        title: `Delegated child ${index + 1}`,
        status: "todo",
        priority: "medium",
        parentId,
        assigneeAgentId: workerAgentId,
        createdByAgentId: managerAgentId,
        createdAt: new Date(now.getTime() - index * 60_000),
        updatedAt: now,
      });
    }

    await expect(
      issueService(db).create(companyId, {
        title: "Delegated child 6",
        parentId,
        assigneeAgentId: workerAgentId,
        createdByAgentId: managerAgentId,
        status: "todo",
        priority: "medium",
      } as any),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("moves an in_progress delegating parent to blocked after creating a delegated child", async () => {
    const companyId = await seedCompany("Alpha");
    const managerAgentId = await seedAgent(companyId, "Manager");
    const workerAgentId = await seedAgent(companyId, "Worker");
    const runId = randomUUID();
    const parentId = randomUUID();
    const now = new Date("2026-03-23T12:00:00.000Z");

    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId: managerAgentId,
      invocationSource: "assignment",
      status: "running",
      startedAt: now,
      updatedAt: now,
    });
    await db.insert(issues).values({
      id: parentId,
      companyId,
      title: "Coordinate newsletter launch",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: managerAgentId,
      createdByAgentId: managerAgentId,
      checkoutRunId: runId,
      executionRunId: runId,
      executionAgentNameKey: "manager",
      executionLockedAt: now,
      startedAt: now,
    });

    const result = await issueService(db).create(companyId, {
      title: "Implement Hermes wrapper",
      parentId,
      assigneeAgentId: workerAgentId,
      createdByAgentId: managerAgentId,
      status: "todo",
      priority: "medium",
    } as any);

    expect(result.created).toBe(true);
    expect(result.blockedParentIssue?.id).toBe(parentId);
    expect(result.blockedParentIssue?.status).toBe("blocked");
    expect(result.blockedParentIssue?.assigneeAgentId).toBe(managerAgentId);
    expect(result.blockedParentIssue?.checkoutRunId).toBeNull();
    expect(result.blockedParentIssue?.executionRunId).toBeNull();
    expect(result.blockedParentIssue?.executionLockedAt).toBeNull();
    expect(result.blockedParentIssue?.executionAgentNameKey).toBeNull();
    expect(result.blockedParentIssue?.blockerDetails).toMatchObject({
      blockerType: "delegated_child_execution",
      delegatedChildIssueId: result.issue.id,
      delegatedChildIdentifier: result.issue.identifier,
    });

    const parentComments = await db
      .select({
        body: issueComments.body,
        authorAgentId: issueComments.authorAgentId,
      })
      .from(issueComments)
      .where(eq(issueComments.issueId, parentId));

    expect(parentComments).toHaveLength(1);
    expect(parentComments[0]?.authorAgentId).toBe(managerAgentId);
    expect(parentComments[0]?.body).toContain(result.issue.identifier);
    expect(parentComments[0]?.body).toContain("blocked");
  });

  it("clears delegated execution blocker details when checkout resumes a blocked issue", async () => {
    const companyId = await seedCompany("Alpha");
    const agentId = await seedAgent(companyId);
    const issueId = randomUUID();
    const runId = randomUUID();
    const now = new Date("2026-03-23T12:00:00.000Z");

    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "assignment",
      status: "running",
      startedAt: now,
      updatedAt: now,
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Coordinate newsletter launch",
      status: "blocked",
      priority: "medium",
      assigneeAgentId: agentId,
      blockerDetails: {
        blockerType: "delegated_child_execution",
        summary: "Waiting on delegated child issue PAP-581",
        delegatedChildIssueId: randomUUID(),
        delegatedChildIdentifier: "PAP-581",
      } as any,
    });

    const checkedOut = await issueService(db).checkout(issueId, agentId, ["blocked"], runId);

    expect(checkedOut?.status).toBe("in_progress");
    expect(checkedOut?.blockerDetails).toBeNull();
  });

  it.each([
    { status: "done", timestampField: "completedAt" as const },
    { status: "cancelled", timestampField: "cancelledAt" as const },
  ])("rejects checkout from terminal status $status", async ({ status, timestampField }) => {
    const companyId = await seedCompany("Alpha");
    const agentId = await seedAgent(companyId);
    const issueId = randomUUID();
    const runId = randomUUID();
    const terminalAt = new Date("2026-03-20T12:00:00.000Z");

    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "assignment",
      status: "running",
      startedAt: terminalAt,
      updatedAt: terminalAt,
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Closed issue",
      status,
      priority: "medium",
      [timestampField]: terminalAt,
    });

    await expect(
      issueService(db).checkout(issueId, agentId, [status], runId),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("clears stale terminal timestamps when checkout moves an issue to in_progress", async () => {
    const companyId = await seedCompany("Alpha");
    const agentId = await seedAgent(companyId);
    const issueId = randomUUID();
    const runId = randomUUID();
    const now = new Date("2026-03-20T14:00:00.000Z");

    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "assignment",
      status: "running",
      startedAt: now,
      updatedAt: now,
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Reclaimed issue",
      status: "todo",
      priority: "medium",
      completedAt: new Date("2026-03-20T12:00:00.000Z"),
      cancelledAt: new Date("2026-03-20T13:00:00.000Z"),
    });

    const checkedOut = await issueService(db).checkout(issueId, agentId, ["todo"], runId);

    expect(checkedOut?.status).toBe("in_progress");
    expect(checkedOut?.completedAt).toBeNull();
    expect(checkedOut?.cancelledAt).toBeNull();
  });

  it("allows checkout when a todo issue still points at a failed execution run", async () => {
    const companyId = await seedCompany("Alpha");
    const agentId = await seedAgent(companyId);
    const runId = randomUUID();
    const issueId = randomUUID();
    const now = new Date("2026-03-23T20:21:49.245Z");

    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "assignment",
      status: "failed",
      startedAt: now,
      finishedAt: new Date("2026-03-23T20:22:10.589Z"),
      updatedAt: new Date("2026-03-23T20:22:10.589Z"),
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Retry checkout after failed run",
      status: "todo",
      priority: "high",
      assigneeAgentId: agentId,
      executionRunId: runId,
      executionLockedAt: now,
      executionAgentNameKey: "ceo",
      updatedAt: now,
    });

    const nextRunId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: nextRunId,
      companyId,
      agentId,
      invocationSource: "assignment",
      status: "running",
      startedAt: new Date("2026-03-23T20:22:30.000Z"),
      updatedAt: new Date("2026-03-23T20:22:30.000Z"),
    });
    const checkedOut = await issueService(db).checkout(issueId, agentId, ["todo"], nextRunId);

    expect(checkedOut?.status).toBe("in_progress");
    expect(checkedOut?.assigneeAgentId).toBe(agentId);
    expect(checkedOut?.checkoutRunId).toBe(nextRunId);
    expect(checkedOut?.executionRunId).toBe(nextRunId);
  });

  it("rejects direct cross-company issue links at the database layer", async () => {
    const companyId = await seedCompany("Alpha");
    const foreignCompanyId = await seedCompany("Beta");
    const foreignParentId = randomUUID();
    const childId = randomUUID();

    await db.insert(issues).values({
      id: foreignParentId,
      companyId: foreignCompanyId,
      title: "Foreign parent",
      status: "todo",
      priority: "medium",
    });

    await expect(
      db.insert(issues).values({
        id: childId,
        companyId,
        title: "Cross-company child",
        status: "todo",
        priority: "medium",
        parentId: foreignParentId,
      }),
    ).rejects.toThrow();
  });

  it("rejects direct foreign execution workspace links at the database layer", async () => {
    const companyId = await seedCompany("Alpha");
    const foreignCompanyId = await seedCompany("Beta");
    const projectId = randomUUID();
    const foreignProjectId = randomUUID();
    const foreignExecutionWorkspaceId = randomUUID();
    const issueId = randomUUID();

    await db.insert(projects).values({
      id: projectId,
      companyId,
      name: "Alpha project",
      status: "backlog",
    });
    await db.insert(projects).values({
      id: foreignProjectId,
      companyId: foreignCompanyId,
      name: "Beta project",
      status: "backlog",
    });
    await db.insert(executionWorkspaces).values({
      id: foreignExecutionWorkspaceId,
      companyId: foreignCompanyId,
      projectId: foreignProjectId,
      mode: "shared_workspace",
      strategyType: "project_primary",
      name: "Foreign workspace",
      status: "active",
      providerType: "local_fs",
    });

    await expect(
      db.insert(issues).values({
        id: issueId,
        companyId,
        projectId,
        title: "Cross-company execution workspace",
        status: "todo",
        priority: "medium",
        executionWorkspaceId: foreignExecutionWorkspaceId,
      }),
    ).rejects.toThrow();
  });
});
