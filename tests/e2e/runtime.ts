import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_E2E_PORT = 3191;
const DEFAULT_INSTANCE_ID = "e2e";
const DETECT_PORT_SCRIPT = `
const { detect } = require("detect-port");
const input = process.argv[1];
const requestedPort = input ? Number(input) : undefined;
detect(Number.isInteger(requestedPort) ? requestedPort : undefined)
  .then((port) => {
    process.stdout.write(String(port));
  })
  .catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(message);
    process.exit(1);
  });
`;

function parsePort(raw: string | undefined, fallback: number) {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function shellQuote(value: string) {
  return JSON.stringify(value);
}

function detectAvailablePortSync(requestedPort?: number) {
  const output = execFileSync(
    process.execPath,
    ["-e", DETECT_PORT_SCRIPT, ...(requestedPort !== undefined ? [String(requestedPort)] : [])],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        FORCE_COLOR: "0",
        NO_COLOR: "1",
      },
    },
  ).trim();
  const port = Number(output);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Failed to resolve available port from detect-port output: ${JSON.stringify(output)}`);
  }
  return port;
}

function getAvailablePortSync(preferredPort?: number, exclude = new Set<number>()) {
  if (preferredPort && !exclude.has(preferredPort)) {
    const preferred = detectAvailablePortSync(preferredPort);
    if (!exclude.has(preferred)) return preferred;
  }

  while (true) {
    const selected = detectAvailablePortSync();
    if (!exclude.has(selected)) return selected;
  }
}

export interface PlaywrightE2eRuntime {
  baseUrl: string;
  command: string;
  configPath: string;
  dataDir: string;
  instanceId: string;
  port: number;
  dbPort: number;
}

function resolvePersistedPort(raw: string | undefined) {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function preparePlaywrightE2eRuntime(
  env: NodeJS.ProcessEnv = process.env,
): PlaywrightE2eRuntime {
  const preferredPort = parsePort(env.PAPERCLIP_E2E_PORT, DEFAULT_E2E_PORT);
  const instanceId =
    env.PAPERCLIP_E2E_RESOLVED_INSTANCE_ID?.trim() ||
    env.PAPERCLIP_E2E_INSTANCE_ID?.trim() ||
    DEFAULT_INSTANCE_ID;
  const persistedPort = resolvePersistedPort(env.PAPERCLIP_E2E_RESOLVED_PORT);
  const port = persistedPort ?? getAvailablePortSync(preferredPort);
  const persistedDbPort = resolvePersistedPort(env.PAPERCLIP_E2E_RESOLVED_DB_PORT);
  const dbPort = persistedDbPort ?? getAvailablePortSync(undefined, new Set([port]));
  const dataDir = path.resolve(
    env.PAPERCLIP_E2E_RESOLVED_DATA_DIR?.trim() ||
      env.PAPERCLIP_E2E_DATA_DIR?.trim() ||
      mkdtempSync(path.join(os.tmpdir(), `paperclip-playwright-e2e-${port}-`)),
  );
  const instanceRoot = path.join(dataDir, "instances", instanceId);
  const configPath = path.join(instanceRoot, "config.json");

  const config = {
    $meta: {
      version: 1,
      updatedAt: new Date().toISOString(),
      source: "doctor",
    },
    database: {
      mode: "embedded-postgres",
      embeddedPostgresDataDir: path.join(instanceRoot, "db"),
      embeddedPostgresPort: dbPort,
      backup: {
        enabled: false,
        intervalMinutes: 60,
        retentionDays: 30,
        dir: path.join(instanceRoot, "data", "backups"),
      },
    },
    logging: {
      mode: "file",
      logDir: path.join(instanceRoot, "logs"),
    },
    server: {
      deploymentMode: "local_trusted",
      exposure: "private",
      host: "127.0.0.1",
      port,
      allowedHostnames: [],
      serveUi: true,
    },
    auth: {
      baseUrlMode: "auto",
      disableSignUp: false,
    },
    storage: {
      provider: "local_disk",
      localDisk: {
        baseDir: path.join(instanceRoot, "data", "storage"),
      },
      s3: {
        bucket: "paperclip",
        region: "us-east-1",
        prefix: "",
        forcePathStyle: false,
      },
    },
    secrets: {
      provider: "local_encrypted",
      strictMode: false,
      localEncrypted: {
        keyFilePath: path.join(instanceRoot, "secrets", "master.key"),
      },
    },
  };

  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  const command = [
    `HOST=127.0.0.1`,
    `PORT=${port}`,
    `PAPERCLIP_OPEN_ON_LISTEN=false`,
    `PAPERCLIP_DB_BACKUP_ENABLED=false`,
    `HEARTBEAT_SCHEDULER_ENABLED=false`,
    `PAPERCLIP_UI_DEV_MIDDLEWARE=true`,
    `pnpm paperclipai run --data-dir ${shellQuote(dataDir)} --instance ${instanceId}`,
  ].join(" ");

  env.PAPERCLIP_E2E_RESOLVED_PORT = String(port);
  env.PAPERCLIP_E2E_RESOLVED_DB_PORT = String(dbPort);
  env.PAPERCLIP_E2E_RESOLVED_DATA_DIR = dataDir;
  env.PAPERCLIP_E2E_RESOLVED_INSTANCE_ID = instanceId;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    command,
    configPath,
    dataDir,
    instanceId,
    port,
    dbPort,
  };
}
