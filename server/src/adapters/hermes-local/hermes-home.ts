import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_PAPERCLIP_INSTANCE_ID = "default";
const TRUTHY_ENV_RE = /^(1|true|yes|on)$/i;
const SHARED_SYMLINK_TARGETS = [".env", "auth.json", "SOUL.md", "skills"] as const;

function nonEmpty(value: string | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isWorktreeMode(env: NodeJS.ProcessEnv): boolean {
  return TRUTHY_ENV_RE.test(env.PAPERCLIP_IN_WORKTREE ?? "");
}

export async function pathExists(candidate: string): Promise<boolean> {
  return fs.access(candidate).then(() => true).catch(() => false);
}

export function resolveSharedHermesHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = nonEmpty(env.HERMES_HOME);
  return fromEnv ? path.resolve(fromEnv) : path.join(os.homedir(), ".hermes");
}

export function resolveManagedHermesHomeDir(
  env: NodeJS.ProcessEnv,
  input: { companyId: string; agentId?: string | null },
): string {
  const paperclipHome = nonEmpty(env.PAPERCLIP_HOME) ?? path.resolve(os.homedir(), ".paperclip");
  const instanceId = nonEmpty(env.PAPERCLIP_INSTANCE_ID) ?? DEFAULT_PAPERCLIP_INSTANCE_ID;
  const companyId = input.companyId.trim();
  const agentId = nonEmpty(input.agentId ?? undefined);
  if (!companyId) {
    throw new Error("Managed Hermes home requires companyId.");
  }
  return agentId
    ? path.resolve(
        paperclipHome,
        "instances",
        instanceId,
        "companies",
        companyId,
        "agents",
        agentId,
        "hermes-home",
      )
    : path.resolve(paperclipHome, "instances", instanceId, "companies", companyId, "hermes-home");
}

async function ensureParentDir(target: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
}

async function ensureManagedSymlink(target: string, source: string): Promise<void> {
  const existing = await fs.lstat(target).catch(() => null);
  if (existing) {
    if (existing.isSymbolicLink()) {
      const linkedPath = await fs.readlink(target).catch(() => null);
      if (linkedPath) {
        const resolvedLinkedPath = path.resolve(path.dirname(target), linkedPath);
        if (resolvedLinkedPath === source) return;
      }
    }
    await fs.rm(target, { recursive: true, force: true });
  }

  await ensureParentDir(target);
  const sourceStat = await fs.lstat(source);
  const type = process.platform === "win32" && sourceStat.isDirectory() ? "junction" : null;
  await fs.symlink(source, target, type as Parameters<typeof fs.symlink>[2]);
}

export async function prepareManagedHermesHome(
  env: NodeJS.ProcessEnv,
  input: {
    companyId: string;
    agentId?: string | null;
    onLog?: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
  },
): Promise<string> {
  const targetHome = resolveManagedHermesHomeDir(env, input);
  const sourceHome = resolveSharedHermesHomeDir(env);
  if (path.resolve(sourceHome) === path.resolve(targetHome)) return targetHome;

  await fs.mkdir(targetHome, { recursive: true });
  await Promise.all(
    ["cron", "sessions", "logs", "memories"].map((dir) =>
      fs.mkdir(path.join(targetHome, dir), { recursive: true }),
    ),
  );

  await fs.rm(path.join(targetHome, "config.yaml"), { force: true });

  for (const name of SHARED_SYMLINK_TARGETS) {
    const source = path.join(sourceHome, name);
    if (!(await pathExists(source))) continue;
    await ensureManagedSymlink(path.join(targetHome, name), source);
  }

  if (input.onLog) {
    await input.onLog(
      "stdout",
      `[paperclip] Using ${isWorktreeMode(env) ? "worktree-isolated" : "Paperclip-managed"} Hermes home "${targetHome}" (seeded from "${sourceHome}").\n`,
    );
  }

  return targetHome;
}
