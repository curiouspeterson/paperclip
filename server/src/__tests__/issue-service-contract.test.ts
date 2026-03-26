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

    const issue = await issueService(db).create(companyId, {
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

    expect(created.goalId).toBe(parentGoalId);
  });

  it("rejects a foreign goal on update", async () => {
    const companyId = await seedCompany("Alpha");
    const foreignCompanyId = await seedCompany("Beta");
    const issue = await issueService(db).create(companyId, {
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

  it("clears a legacy user assignee when reassigning to an agent", async () => {
    const companyId = await seedCompany("Alpha");
    const agentId = await seedAgent(companyId);
    const issueId = randomUUID();

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Legacy user-assigned issue",
      status: "todo",
      priority: "medium",
      assigneeUserId: "user-1",
    });

    const updated = await issueService(db).update(issueId, {
      assigneeAgentId: agentId,
    } as any);

    expect(updated?.assigneeAgentId).toBe(agentId);
    expect(updated?.assigneeUserId).toBeNull();
  });

  it("clears a legacy user assignee when explicitly unassigning the issue", async () => {
    const companyId = await seedCompany("Alpha");
    const issueId = randomUUID();

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Legacy user-assigned issue",
      status: "todo",
      priority: "medium",
      assigneeUserId: "user-1",
    });

    const updated = await issueService(db).update(issueId, {
      assigneeAgentId: null,
    } as any);

    expect(updated?.assigneeAgentId).toBeNull();
    expect(updated?.assigneeUserId).toBeNull();
  });

  it("rejects a foreign parent issue on update", async () => {
    const companyId = await seedCompany("Alpha");
    const foreignCompanyId = await seedCompany("Beta");
    const issue = await issueService(db).create(companyId, {
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
    } as any);

    expect(updated?.status).toBe("todo");
    expect(updated?.assigneeAgentId).toBe(nextAgentId);
    expect(updated?.checkoutRunId).toBeNull();
    expect(updated?.executionRunId).toBeNull();
    expect(updated?.executionLockedAt).toBeNull();
    expect(updated?.executionAgentNameKey).toBeNull();
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
