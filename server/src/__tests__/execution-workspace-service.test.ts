import { randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  applyPendingMigrations,
  companies,
  createDb,
  ensurePostgresDatabase,
  executionWorkspaces,
  projects,
} from "@paperclipai/db";
import { executionWorkspaceService } from "../services/execution-workspaces.js";

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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-execution-workspace-service-"));
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

describe("execution workspace service", () => {
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
    await db.delete(executionWorkspaces);
    await db.delete(projects);
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

  async function seedProject(companyId: string, name: string) {
    const id = randomUUID();
    await db.insert(projects).values({
      id,
      companyId,
      name,
      status: "backlog",
    });
    return id;
  }

  it("does not update a workspace outside the requested company", async () => {
    const companyId = await seedCompany("Alpha");
    const foreignCompanyId = await seedCompany("Beta");
    const foreignProjectId = await seedProject(foreignCompanyId, "Beta project");
    const workspaceId = randomUUID();
    const svc = executionWorkspaceService(db);

    await db.insert(executionWorkspaces).values({
      id: workspaceId,
      companyId: foreignCompanyId,
      projectId: foreignProjectId,
      mode: "shared_workspace",
      strategyType: "project_primary",
      name: "Foreign workspace",
      status: "active",
      providerType: "local_fs",
    });

    const updated = await svc.updateForCompany(companyId, workspaceId, {
      status: "archived",
    });

    expect(updated).toBeNull();
    expect(await svc.getById(workspaceId)).toMatchObject({
      id: workspaceId,
      companyId: foreignCompanyId,
      status: "active",
    });
  });
});
