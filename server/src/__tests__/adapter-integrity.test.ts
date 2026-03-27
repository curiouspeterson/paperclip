import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { companies, createDb } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { warnOnUnsupportedAgentAdapterTypes } from "../services/adapter-integrity.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres adapter integrity tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("warnOnUnsupportedAgentAdapterTypes", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-adapter-integrity-");
  }, 60_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("logs a startup warning when legacy agents use unsupported adapter types", async () => {
    const connectionString = tempDb!.connectionString;
    const db = createDb(connectionString);
    const companyId = randomUUID();
    const warn = vi.fn();

    await db.execute(sql.raw(`ALTER TABLE "agents" DROP CONSTRAINT IF EXISTS "agents_adapter_type_check";`));
    await db.insert(companies).values({
      id: companyId,
      name: "Legacy Adapter Co",
      issuePrefix: "LAC",
      requireBoardApprovalForNewAgents: false,
    });
    await db.execute(sql.raw(`
      INSERT INTO "agents" ("id", "company_id", "name", "status", "adapter_type", "adapter_config", "runtime_config", "permissions")
      VALUES ('${randomUUID()}', '${companyId}', 'Legacy Agent', 'idle', 'legacy_adapter', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb);
    `));

    const result = await warnOnUnsupportedAgentAdapterTypes(connectionString, { warn });
    expect(result).toEqual({
      affectedAgentCount: 1,
      invalidAdapterTypes: [{ adapterType: "legacy_adapter", count: 1 }],
    });
    expect(warn).toHaveBeenCalledWith(
      {
        affectedAgentCount: 1,
        invalidAdapterTypes: [{ adapterType: "legacy_adapter", count: 1 }],
      },
      "found legacy agents with unsupported adapter types; repair stale rows to a supported adapter",
    );
  }, 60_000);
});
