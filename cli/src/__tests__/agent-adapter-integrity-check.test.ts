import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { companies, createDb } from "@paperclipai/db";
import type { PaperclipConfig } from "../config/schema.js";
import { agentAdapterIntegrityCheck } from "../checks/agent-adapter-integrity-check.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres agent adapter integrity check tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("agentAdapterIntegrityCheck", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-agent-adapter-check-");
  }, 60_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  function createPostgresConfig(connectionString: string): PaperclipConfig {
    return {
      $meta: {
        version: 1,
        updatedAt: "2026-03-27T00:00:00.000Z",
        source: "doctor",
      },
      database: {
        mode: "postgres",
        connectionString,
        embeddedPostgresDataDir: "",
        embeddedPostgresPort: 5432,
        backup: {
          enabled: false,
          intervalMinutes: 60,
          retentionDays: 30,
          dir: "",
        },
      },
      logging: {
        mode: "file",
        logDir: "",
      },
      server: {
        deploymentMode: "local_trusted",
        exposure: "private",
        host: "127.0.0.1",
        port: 3199,
        allowedHostnames: [],
        serveUi: true,
      },
      auth: {
        baseUrlMode: "auto",
        disableSignUp: false,
      },
      storage: {
        provider: "local_disk",
        localDisk: { baseDir: "" },
        s3: { bucket: "paperclip", region: "us-east-1", prefix: "", forcePathStyle: false },
      },
      secrets: {
        provider: "local_encrypted",
        strictMode: false,
        localEncrypted: { keyFilePath: "" },
      },
    };
  }

  it("warns when persisted agents use unsupported adapter types", async () => {
    const connectionString = tempDb!.connectionString;
    const db = createDb(connectionString);
    const companyId = randomUUID();

    await db.execute(sql.raw(`ALTER TABLE "agents" DROP CONSTRAINT IF EXISTS "agents_adapter_type_check";`));
    await db.insert(companies).values({
      id: companyId,
      name: "Adapter Drift Co",
      issuePrefix: "ADC",
      requireBoardApprovalForNewAgents: false,
    });
    await db.execute(sql.raw(`
      INSERT INTO "agents" ("id", "company_id", "name", "status", "adapter_type", "adapter_config", "runtime_config", "permissions")
      VALUES ('${randomUUID()}', '${companyId}', 'Legacy Adapter Agent', 'idle', 'legacy_adapter', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb);
    `));

    const result = await agentAdapterIntegrityCheck(createPostgresConfig(connectionString));
    expect(result.status).toBe("warn");
    expect(result.message).toContain("legacy_adapter (1)");
  }, 60_000);
});
