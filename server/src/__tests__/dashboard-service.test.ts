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
    const waitingParentIssueId = randomUUID();
    const secondWaitingParentIssueId = randomUUID();
    const thirdWaitingParentIssueId = randomUUID();
    const fourthWaitingParentIssueId = randomUUID();
    const delegatedChildIssueId = randomUUID();
    const secondDelegatedChildIssueId = randomUUID();
    const thirdDelegatedChildIssueId = randomUUID();
    const fourthDelegatedChildIssueId = randomUUID();

    await db.insert(issues).values([
      {
        id: waitingParentIssueId,
        companyId,
        title: "Waiting on canonical child",
        status: "blocked",
        priority: "medium",
        identifier: "PAP-44",
        blockerDetails: {
          blockerType: "delegated_child_execution",
          summary: "Waiting on delegated child issue PAP-581",
          delegatedChildIssueId,
          delegatedChildIdentifier: "PAP-581",
        },
        updatedAt: new Date("2026-03-23T12:00:00.000Z"),
      },
      {
        id: secondWaitingParentIssueId,
        companyId,
        title: "Waiting on second canonical child",
        status: "blocked",
        priority: "medium",
        identifier: "PAP-45",
        blockerDetails: {
          blockerType: "delegated_child_execution",
          summary: "Waiting on delegated child issue PAP-582",
          delegatedChildIssueId: secondDelegatedChildIssueId,
          delegatedChildIdentifier: "PAP-582",
        },
        updatedAt: new Date("2026-03-23T11:00:00.000Z"),
      },
      {
        id: thirdWaitingParentIssueId,
        companyId,
        title: "Waiting on third canonical child",
        status: "blocked",
        priority: "medium",
        identifier: "PAP-46",
        blockerDetails: {
          blockerType: "delegated_child_execution",
          summary: "Waiting on delegated child issue PAP-583",
          delegatedChildIssueId: thirdDelegatedChildIssueId,
          delegatedChildIdentifier: "PAP-583",
        },
        updatedAt: new Date("2026-03-23T10:00:00.000Z"),
      },
      {
        id: fourthWaitingParentIssueId,
        companyId,
        title: "Waiting on fourth canonical child",
        status: "blocked",
        priority: "medium",
        identifier: "PAP-47",
        blockerDetails: {
          blockerType: "delegated_child_execution",
          summary: "Waiting on delegated child issue PAP-584",
          delegatedChildIssueId: fourthDelegatedChildIssueId,
          delegatedChildIdentifier: "PAP-584",
        },
        updatedAt: new Date("2026-03-23T09:00:00.000Z"),
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
      open: 7,
      inProgress: 1,
      blocked: 6,
      waitingOnDelegatedChild: 4,
      waitingOnDelegatedChildTarget: {
        issueId: delegatedChildIssueId,
        identifier: "PAP-581",
        parentIssueId: waitingParentIssueId,
        parentIdentifier: "PAP-44",
        parentTitle: "Waiting on canonical child",
      },
      waitingOnDelegatedChildTargets: [
        {
          issueId: delegatedChildIssueId,
          identifier: "PAP-581",
          parentIssueId: waitingParentIssueId,
          parentIdentifier: "PAP-44",
          parentTitle: "Waiting on canonical child",
        },
        {
          issueId: secondDelegatedChildIssueId,
          identifier: "PAP-582",
          parentIssueId: secondWaitingParentIssueId,
          parentIdentifier: "PAP-45",
          parentTitle: "Waiting on second canonical child",
        },
        {
          issueId: thirdDelegatedChildIssueId,
          identifier: "PAP-583",
          parentIssueId: thirdWaitingParentIssueId,
          parentIdentifier: "PAP-46",
          parentTitle: "Waiting on third canonical child",
        },
      ],
      done: 1,
    });
  });
});
