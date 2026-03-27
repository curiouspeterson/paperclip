import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { agentService } from "../services/agents.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres agent service contract tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("agent service contracts", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-agent-contract-");
    db = createDb(tempDb.connectionString);
  }, 60_000);

  afterEach(async () => {
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
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

  it("rejects unsupported adapter types on create", async () => {
    const companyId = await seedCompany("Alpha");

    await expect(
      agentService(db).create(companyId, {
        name: "Broken Adapter",
        role: "engineer",
        status: "active",
        adapterType: "unknown_adapter",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      } as any),
    ).rejects.toMatchObject({
      status: 422,
      message: "Invalid adapter type: unknown_adapter",
    });
  });

  it("rejects unsupported adapter types on update", async () => {
    const companyId = await seedCompany("Alpha");
    const created = await agentService(db).create(companyId, {
      name: "Valid Agent",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    await expect(
      agentService(db).update(created.id, {
        adapterType: "unknown_adapter",
      } as any),
    ).rejects.toMatchObject({
      status: 422,
      message: "Invalid adapter type: unknown_adapter",
    });
  });
});
