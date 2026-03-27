import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { applyPendingMigrations, ensurePostgresDatabase } from "./client.js";

export type EmbeddedPostgresInstance = {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
};

export type EmbeddedPostgresCtor = new (opts: {
  databaseDir: string;
  user: string;
  password: string;
  port: number;
  persistent: boolean;
  initdbFlags?: string[];
  onLog?: (message: unknown) => void;
  onError?: (message: unknown) => void;
}) => EmbeddedPostgresInstance;

export type EmbeddedPostgresTestSupport = {
  supported: boolean;
  reason?: string;
};

export type EmbeddedPostgresTestDatabase = {
  connectionString: string;
  cleanup(): Promise<void>;
};

type ExecFileLike = (
  file: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

type CleanupStaleSysvSharedMemoryOptions = {
  currentUser?: string;
  execFile?: ExecFileLike;
  isPidAlive?: (pid: number) => boolean;
  removeSegment?: (id: number) => Promise<void>;
};

const INIT_LOCK_DIR = path.join(os.tmpdir(), "paperclip-embedded-postgres-init.lock");
const INIT_LOCK_STALE_MS = 5 * 60_000;
const INIT_LOCK_RETRY_MS = 50;
const execFile = promisify(execFileCallback);

let embeddedPostgresSupportPromise: Promise<EmbeddedPostgresTestSupport> | null = null;

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

async function acquireInitLock() {
  while (true) {
    try {
      fs.mkdirSync(INIT_LOCK_DIR);
      return () => {
        fs.rmSync(INIT_LOCK_DIR, { recursive: true, force: true });
      };
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== "EEXIST") throw error;

      const stat = fs.statSync(INIT_LOCK_DIR, { throwIfNoEntry: false });
      if (stat && Date.now() - stat.mtimeMs > INIT_LOCK_STALE_MS) {
        fs.rmSync(INIT_LOCK_DIR, { recursive: true, force: true });
        continue;
      }

      await delay(INIT_LOCK_RETRY_MS);
    }
  }
}

function formatEmbeddedPostgresError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  if (typeof error === "string" && error.length > 0) return error;
  return "embedded Postgres startup failed";
}

function isPidAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    return nodeError.code === "EPERM";
  }
}

function parseSharedMemorySegments(raw: string) {
  const segments: Array<{
    id: number;
    owner: string;
    creatorPid: number;
    lastPid: number;
  }> = [];

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("m ")) continue;

    const parts = trimmed.split(/\s+/);
    if (parts.length < 8) continue;

    const id = Number.parseInt(parts[1] ?? "", 10);
    const owner = parts[4] ?? "";
    const creatorPid = Number.parseInt(parts[6] ?? "", 10);
    const lastPid = Number.parseInt(parts[7] ?? "", 10);
    if (
      !Number.isFinite(id) ||
      owner.length === 0 ||
      !Number.isFinite(creatorPid) ||
      !Number.isFinite(lastPid)
    ) {
      continue;
    }

    segments.push({ id, owner, creatorPid, lastPid });
  }

  return segments;
}

export async function cleanupStaleSysvSharedMemorySegments(
  options: CleanupStaleSysvSharedMemoryOptions = {},
) {
  const {
    currentUser = os.userInfo().username,
    execFile: execFileImpl = execFile,
    isPidAlive: isPidAliveImpl = isPidAlive,
    removeSegment = async (id: number) => {
      await execFileImpl("ipcrm", ["-m", String(id)]);
    },
  } = options;

  let stdout: string;
  try {
    ({ stdout } = await execFileImpl("ipcs", ["-m", "-p"]));
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return 0;
    }
    throw error;
  }

  let removed = 0;
  for (const segment of parseSharedMemorySegments(stdout)) {
    if (segment.owner !== currentUser) continue;
    if (isPidAliveImpl(segment.creatorPid) || isPidAliveImpl(segment.lastPid)) continue;
    await removeSegment(segment.id);
    removed += 1;
  }

  return removed;
}

async function withEmbeddedPostgresInitLock<T>(fn: () => Promise<T>): Promise<T> {
  const release = await acquireInitLock();
  try {
    await cleanupStaleSysvSharedMemorySegments();
    return await fn();
  } finally {
    release();
  }
}

async function probeEmbeddedPostgresSupport(): Promise<EmbeddedPostgresTestSupport> {
  return await withEmbeddedPostgresInitLock(async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-embedded-postgres-probe-"));
    const port = await getAvailablePort();
    const EmbeddedPostgres = await getEmbeddedPostgresCtor();
    const instance = new EmbeddedPostgres({
      databaseDir: dataDir,
      user: "paperclip",
      password: "paperclip",
      port,
      persistent: true,
      initdbFlags: ["--encoding=UTF8", "--locale=C", "--lc-messages=C"],
      onLog: () => {},
      onError: () => {},
    });

    try {
      await instance.initialise();
      await instance.start();
      return { supported: true };
    } catch (error) {
      return {
        supported: false,
        reason: formatEmbeddedPostgresError(error),
      };
    } finally {
      await instance.stop().catch(() => {});
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
}

export async function getEmbeddedPostgresTestSupport(): Promise<EmbeddedPostgresTestSupport> {
  if (!embeddedPostgresSupportPromise) {
    embeddedPostgresSupportPromise = probeEmbeddedPostgresSupport();
  }
  return await embeddedPostgresSupportPromise;
}

export async function startEmbeddedPostgresTestDatabase(
  tempDirPrefix: string,
): Promise<EmbeddedPostgresTestDatabase> {
  const logLines: string[] = [];
  const release = await acquireInitLock();
  let released = false;
  let dataDir = "";
  let instance: EmbeddedPostgresInstance | null = null;
  let stopPromise: Promise<void> | null = null;

  function releaseLock() {
    if (released) return;
    released = true;
    release();
  }

  try {
    await cleanupStaleSysvSharedMemorySegments();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), tempDirPrefix));
    const port = await getAvailablePort();
    const EmbeddedPostgres = await getEmbeddedPostgresCtor();
    instance = new EmbeddedPostgres({
      databaseDir: dataDir,
      user: "paperclip",
      password: "paperclip",
      port,
      persistent: true,
      initdbFlags: ["--encoding=UTF8", "--locale=C", "--lc-messages=C"],
      onLog: (message) => {
        logLines.push(String(message));
      },
      onError: (message) => {
        logLines.push(String(message));
      },
    });

    const stop = instance.stop.bind(instance);
    instance.stop = async () => {
      if (!stopPromise) {
        stopPromise = stop();
      }
      await stopPromise;
    };

    await instance.initialise();
    await instance.start();

    const adminConnectionString = `postgres://paperclip:paperclip@127.0.0.1:${port}/postgres`;
    await ensurePostgresDatabase(adminConnectionString, "paperclip");
    const connectionString = `postgres://paperclip:paperclip@127.0.0.1:${port}/paperclip`;
    await applyPendingMigrations(connectionString);
    releaseLock();

    return {
      connectionString,
      cleanup: async () => {
        await instance?.stop().catch(() => {});
        fs.rmSync(dataDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (instance) {
      await instance.stop().catch(() => {});
    }
    releaseLock();
    if (dataDir) {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }

    const details = logLines.map((line) => line.trim()).filter(Boolean).join("\n");
    throw new Error(
      details ? `${formatEmbeddedPostgresError(error)}\n${details}` : formatEmbeddedPostgresError(error),
    );
  }
}
