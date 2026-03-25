import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agentRuntimeState,
  agentTaskSessions,
  agentWakeupRequests,
  agents,
  applyPendingMigrations,
  companies,
  companySkills,
  costEvents,
  createDb,
  ensurePostgresDatabase,
  executionWorkspaces,
  heartbeatRunEvents,
  heartbeatRuns,
  issueComments,
  issues,
} from "@paperclipai/db";
import { heartbeatService } from "../services/heartbeat.ts";

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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-heartbeat-comments-"));
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

async function writeFakeProcessCommand(commandPath: string) {
  const script = `#!/usr/bin/env node
console.log(JSON.stringify({
  _usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
  _provider: "process-test",
  _model: "fake-worker"
}));
`;
  await fsPromises.writeFile(commandPath, script, "utf8");
  await fsPromises.chmod(commandPath, 0o755);
}

describe("heartbeat run issue comments", () => {
  let db!: ReturnType<typeof createDb>;
  let instance: EmbeddedPostgresInstance | null = null;
  let dataDir = "";
  let rootDir = "";

  beforeAll(async () => {
    const started = await startTempDatabase();
    db = createDb(started.connectionString);
    instance = started.instance;
    dataDir = started.dataDir;
    rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "paperclip-heartbeat-comment-worker-"));
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(companySkills);
    await db.delete(costEvents);
    await db.delete(issueComments);
    await db.delete(issues);
    await db.delete(executionWorkspaces);
    await db.delete(heartbeatRunEvents);
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(agentTaskSessions);
    await db.delete(agentRuntimeState);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await instance?.stop();
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
    if (rootDir) fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("adds a fallback issue comment after a successful run that did not post one itself", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const commandPath = path.join(rootDir, `worker-${randomUUID()}.js`);
    const workerCwd = path.join(rootDir, `cwd-${randomUUID()}`);
    await fsPromises.mkdir(workerCwd, { recursive: true });
    await writeFakeProcessCommand(commandPath);

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: "ROM",
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "VP Technical",
      role: "engineer",
      status: "active",
      adapterType: "process",
      adapterConfig: {
        command: commandPath,
        cwd: workerCwd,
      },
      runtimeConfig: {},
      permissions: {},
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Bootstrap the runtime",
      status: "todo",
      priority: "high",
      assigneeAgentId: agentId,
      issueNumber: 1,
      identifier: "ROM-1",
    });

    const heartbeat = heartbeatService(db);
    const queuedRun = await heartbeat.invoke(
      agentId,
      "assignment",
      { issueId, taskId: issueId },
      "system",
      { actorType: "system", actorId: "test-suite" },
    );

    expect(queuedRun).not.toBeNull();

    const finalizedRun = await heartbeat.waitForRunSettled(queuedRun!.id, { timeoutMs: 10_000 });

    expect(finalizedRun?.status).toBe("succeeded");

    const comments = await db
      .select()
      .from(issueComments)
      .where(eq(issueComments.issueId, issueId));
    const loggedActivity = await db
      .select()
      .from(activityLog)
      .where(
        and(
          eq(activityLog.runId, finalizedRun!.id),
          eq(activityLog.action, "issue.comment_added"),
          eq(activityLog.entityType, "issue"),
          eq(activityLog.entityId, issueId),
        ),
      );

    expect(comments.some((comment) => comment.body.includes("Run completed before the agent posted its structured update."))).toBe(true);
    expect(comments.some((comment) => comment.body.includes("Provider: process-test"))).toBe(true);
    expect(comments.some((comment) => comment.body.includes("Model: fake-worker"))).toBe(true);
    expect(loggedActivity.some((entry) => entry.details?.source === "heartbeat_run_completion_fallback")).toBe(true);
  });
});
