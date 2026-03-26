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
  goals,
} from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { companyService } from "../services/companies.js";
import { goalService } from "../services/goals.js";

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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-company-goal-contract-"));
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

describe("company goal contracts", () => {
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
    await db.delete(goals);
    await db.delete(companies);
  });

  afterAll(async () => {
    await instance?.stop();
    if (dataDir) {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("creates a root company goal automatically for every new company", async () => {
    const company = await companyService(db).create({
      name: "Alpha Labs",
      description: "Build a sustainable AI product business.",
      budgetMonthlyCents: 0,
    });

    const companyGoals = await db
      .select()
      .from(goals)
      .where(eq(goals.companyId, company.id));

    expect(companyGoals).toHaveLength(1);
    expect(companyGoals[0]).toMatchObject({
      companyId: company.id,
      title: "Alpha Labs",
      description: "Build a sustainable AI product business.",
      level: "company",
      status: "planned",
      parentId: null,
    });
  });

  it("rejects deleting the last root company goal", async () => {
    const companyId = randomUUID();
    const goalId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Alpha",
      issuePrefix: "ALP",
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(goals).values({
      id: goalId,
      companyId,
      title: "Alpha mission",
      level: "company",
      status: "active",
      parentId: null,
    });

    await expect(goalService(db).remove(goalId)).rejects.toMatchObject({
      status: 422,
      message: "Company must keep at least one root company goal",
    });
  });

  it("rejects demoting the last root company goal into a child goal", async () => {
    const companyId = randomUUID();
    const rootGoalId = randomUUID();
    const childParentId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Alpha",
      issuePrefix: "ALP",
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(goals).values([
      {
        id: rootGoalId,
        companyId,
        title: "Alpha mission",
        level: "company",
        status: "active",
        parentId: null,
      },
      {
        id: childParentId,
        companyId,
        title: "Existing parent",
        level: "team",
        status: "active",
        parentId: null,
      },
    ]);

    await expect(goalService(db).update(rootGoalId, { parentId: childParentId })).rejects.toMatchObject({
      status: 422,
      message: "Company must keep at least one root company goal",
    });
  });
});
