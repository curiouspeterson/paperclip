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
  issues,
} from "@paperclipai/db";
import { dashboardService } from "../services/dashboard.js";

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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-dashboard-service-"));
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

describe("dashboard service", () => {
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

  it("reports blocked delegated-child waits separately from general blocked work", async () => {
    const companyId = await seedCompany("Alpha");
    const foreignCompanyId = await seedCompany("Beta");

    await db.insert(issues).values([
      {
        id: randomUUID(),
        companyId,
        title: "Waiting on canonical child",
        status: "blocked",
        priority: "medium",
        blockerDetails: {
          blockerType: "delegated_child_execution",
          summary: "Waiting on delegated child issue PAP-581",
          delegatedChildIssueId: randomUUID(),
          delegatedChildIdentifier: "PAP-581",
        },
      },
      {
        id: randomUUID(),
        companyId,
        title: "Missing secret",
        status: "blocked",
        priority: "medium",
        blockerDetails: {
          blockerType: "missing_secret",
          summary: "Need MAILCHIMP_API_KEY",
        },
      },
      {
        id: randomUUID(),
        companyId,
        title: "General blocked work",
        status: "blocked",
        priority: "medium",
      },
      {
        id: randomUUID(),
        companyId,
        title: "Active work",
        status: "in_progress",
        priority: "medium",
      },
      {
        id: randomUUID(),
        companyId,
        title: "Done work",
        status: "done",
        priority: "medium",
      },
      {
        id: randomUUID(),
        companyId: foreignCompanyId,
        title: "Foreign delegated wait",
        status: "blocked",
        priority: "medium",
        blockerDetails: {
          blockerType: "delegated_child_execution",
          summary: "Should not count across companies",
        },
      },
    ]);

    const summary = await dashboardService(db).summary(companyId);

    expect(summary.tasks).toMatchObject({
      open: 4,
      inProgress: 1,
      blocked: 3,
      waitingOnDelegatedChild: 1,
      done: 1,
    });
  });
});
