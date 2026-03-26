import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_CWD = process.cwd();

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  vi.resetModules();

  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }
});

function buildConfig(root: string) {
  return {
    $meta: {
      version: 1,
      updatedAt: "2026-03-26T00:00:00.000Z",
      source: "test",
    },
    database: {
      mode: "embedded-postgres" as const,
      embeddedPostgresDataDir: path.join(root, "db"),
      embeddedPostgresPort: 54329,
      backup: {
        enabled: false,
        intervalMinutes: 60,
        retentionDays: 30,
        dir: path.join(root, "data", "backups"),
      },
    },
    logging: {
      mode: "file" as const,
      logDir: path.join(root, "logs"),
    },
    server: {
      deploymentMode: "local_trusted" as const,
      exposure: "private" as const,
      host: "127.0.0.1",
      port: 3100,
      allowedHostnames: [],
      serveUi: true,
    },
    auth: {
      baseUrlMode: "auto" as const,
      disableSignUp: false,
    },
    storage: {
      provider: "local_disk" as const,
      localDisk: {
        baseDir: path.join(root, "data", "storage"),
      },
      s3: {
        bucket: "paperclip",
        region: "us-east-1",
        prefix: "",
        forcePathStyle: false,
      },
    },
    secrets: {
      provider: "local_encrypted" as const,
      strictMode: false,
      localEncrypted: {
        keyFilePath: path.join(root, "secrets", "master.key"),
      },
    },
  };
}

async function writeConfig(configPath: string) {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(buildConfig(path.dirname(configPath)), null, 2) + "\n", "utf8");
}

describe("config env loading", () => {
  it("ignores cwd .env when PAPERCLIP_CONFIG points to an isolated instance", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-config-env-"));
    const repoRoot = path.join(tempRoot, "repo");
    const instanceRoot = path.join(tempRoot, "instance");
    const configPath = path.join(instanceRoot, "config.json");

    await fs.mkdir(repoRoot, { recursive: true });
    await fs.writeFile(repoRoot + "/.env", 'DATABASE_URL="postgres://cwd-user:cwd-pass@db.example.com:5432/paperclip"\n', "utf8");
    await writeConfig(configPath);

    process.chdir(repoRoot);
    process.env.PAPERCLIP_CONFIG = configPath;
    delete process.env.DATABASE_URL;

    const { loadConfig } = await import("../config.js");
    const config = loadConfig();

    expect(config.databaseMode).toBe("embedded-postgres");
    expect(config.databaseUrl).toBeUndefined();
  });

  it("loads the config-adjacent env file when PAPERCLIP_CONFIG is explicit", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-config-env-"));
    const repoRoot = path.join(tempRoot, "repo");
    const instanceRoot = path.join(tempRoot, "instance");
    const configPath = path.join(instanceRoot, "config.json");

    await fs.mkdir(repoRoot, { recursive: true });
    await fs.writeFile(repoRoot + "/.env", 'DATABASE_URL="postgres://cwd-user:cwd-pass@db.example.com:5432/paperclip"\n', "utf8");
    await writeConfig(configPath);
    await fs.writeFile(path.join(instanceRoot, ".env"), 'DATABASE_URL="postgres://instance-user:instance-pass@db.example.com:6543/paperclip"\n', "utf8");

    process.chdir(repoRoot);
    process.env.PAPERCLIP_CONFIG = configPath;
    delete process.env.DATABASE_URL;

    const { loadConfig } = await import("../config.js");
    const config = loadConfig();

    expect(config.databaseUrl).toBe("postgres://instance-user:instance-pass@db.example.com:6543/paperclip");
  });

  it("still loads cwd .env when config is discovered from the current repo", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-config-env-"));
    const repoRoot = path.join(tempRoot, "repo");
    const configPath = path.join(repoRoot, ".paperclip", "config.json");

    await fs.mkdir(path.join(repoRoot, ".paperclip"), { recursive: true });
    await fs.writeFile(path.join(repoRoot, ".env"), 'DATABASE_URL="postgres://cwd-user:cwd-pass@db.example.com:5432/paperclip"\n', "utf8");
    await writeConfig(configPath);

    process.chdir(repoRoot);
    delete process.env.PAPERCLIP_CONFIG;
    delete process.env.DATABASE_URL;

    const { loadConfig } = await import("../config.js");
    const config = loadConfig();

    expect(config.databaseUrl).toBe("postgres://cwd-user:cwd-pass@db.example.com:5432/paperclip");
  });
});
