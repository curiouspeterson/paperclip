import { randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  applyPendingMigrations,
  createDb,
  ensurePostgresDatabase,
  agents,
  companies,
  goals,
  heartbeatRuns,
  issues,
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

    await db.insert(issues).values({
      id: foreignParentId,
      companyId: foreignCompanyId,
      title: "Foreign parent",
      status: "todo",
      priority: "medium",
    });
    await db.insert(issues).values({
      id: childId,
      companyId,
      title: "Child",
      status: "todo",
      priority: "medium",
      parentId: foreignParentId,
    });

    const ancestors = await issueService(db).getAncestors(companyId, childId);
    expect(ancestors).toEqual([]);
  });
});
