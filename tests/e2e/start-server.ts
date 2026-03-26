import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { applyPendingMigrations } from "../../packages/db/src/index.ts";
import { resolveMigrationConnection } from "../../packages/db/src/migration-runtime.ts";

const listenPort = String(Number(process.env.PAPERCLIP_E2E_PORT ?? 3191));
const paperclipHome = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-e2e-"));

process.env.PAPERCLIP_HOME = paperclipHome;
process.env.PAPERCLIP_INSTANCE_ID = "e2e";
process.env.PORT = listenPort;
process.env.HOST = "127.0.0.1";
process.env.SERVE_UI = "true";
process.env.PAPERCLIP_UI_DEV_MIDDLEWARE = "true";
process.env.PAPERCLIP_SECRETS_PROVIDER = "local_encrypted";
process.env.PAPERCLIP_SECRETS_MASTER_KEY = crypto.randomBytes(32).toString("base64");
process.env.PAPERCLIP_AGENT_JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.PAPERCLIP_MIGRATION_AUTO_APPLY = "true";
process.env.PAPERCLIP_E2E_DISABLE_ASSIGNMENT_WAKEUPS = "true";

const migrationConnection = await resolveMigrationConnection();
process.env.DATABASE_URL = migrationConnection.connectionString;
await applyPendingMigrations(migrationConnection.connectionString);

const { startServer } = await import("../../server/src/index.ts");
const started = await startServer();

let cleanedUp = false;

async function cleanup(exitCode = 0) {
  if (cleanedUp) return;
  cleanedUp = true;

  await new Promise<void>((resolve) => {
    started.server.close(() => resolve());
  });
  await migrationConnection.stop();
  fs.rmSync(paperclipHome, { recursive: true, force: true });
  process.exit(exitCode);
}

process.on("SIGINT", () => {
  void cleanup(0);
});

process.on("SIGTERM", () => {
  void cleanup(0);
});

started.server.on("close", () => {
  if (!cleanedUp) {
    void cleanup(0);
  }
});
