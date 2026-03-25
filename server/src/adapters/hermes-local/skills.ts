import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPersistentSkillSnapshot,
  ensurePaperclipSkillSymlink,
  readInstalledSkillTargets,
  readPaperclipRuntimeSkillEntries,
  resolvePaperclipDesiredSkillNames,
} from "@paperclipai/adapter-utils/server-utils";
import type { AdapterSkillContext, AdapterSkillSnapshot } from "../types.js";
import { resolveHermesHomeForConfig } from "./mcp.js";

const __moduleDir = path.dirname(fileURLToPath(import.meta.url));
const PAPERCLIP_SKILL_ROOT_CANDIDATES = [
  path.resolve(__moduleDir, "../../../../skills"),
];

function resolveHermesSkillsHome(ctx: Pick<AdapterSkillContext, "agentId" | "config">): string {
  return path.join(resolveHermesHomeForConfig(ctx.agentId, ctx.config), "skills");
}

function resolveHermesSkillsLocationLabel(config: Record<string, unknown>) {
  return config.paperclipManagedHermesHome || config.mcpServers
    ? "Paperclip-managed Hermes home"
    : "~/.hermes/skills";
}

async function buildHermesSkillSnapshot(
  ctx: Pick<AdapterSkillContext, "agentId" | "config">,
): Promise<AdapterSkillSnapshot> {
  const availableEntries = await readPaperclipRuntimeSkillEntries(
    ctx.config,
    __moduleDir,
    PAPERCLIP_SKILL_ROOT_CANDIDATES,
  );
  const desiredSkills = resolvePaperclipDesiredSkillNames(ctx.config, availableEntries);
  const skillsHome = resolveHermesSkillsHome(ctx);
  const installed = await readInstalledSkillTargets(skillsHome);
  return buildPersistentSkillSnapshot({
    adapterType: "hermes_local",
    availableEntries,
    desiredSkills,
    installed,
    skillsHome,
    locationLabel: resolveHermesSkillsLocationLabel(ctx.config),
    installedDetail: "Installed in the Hermes skills home.",
    missingDetail: "Configured but not currently linked into the Hermes skills home.",
    externalConflictDetail: "Skill name is occupied by an external Hermes installation.",
    externalDetail: "Installed outside Paperclip management in the Hermes skills home.",
  });
}

type ReplaceHermesExternalSkillInput = {
  desiredSkillKey: string;
  runtimeName: string;
  expectedExternalSourcePath: string;
};

export async function listHermesSkills(ctx: AdapterSkillContext): Promise<AdapterSkillSnapshot> {
  return buildHermesSkillSnapshot(ctx);
}

export async function syncHermesSkills(
  ctx: AdapterSkillContext,
  desiredSkills: string[],
): Promise<AdapterSkillSnapshot> {
  const availableEntries = await readPaperclipRuntimeSkillEntries(
    ctx.config,
    __moduleDir,
    PAPERCLIP_SKILL_ROOT_CANDIDATES,
  );
  const desiredSet = new Set([
    ...desiredSkills,
    ...availableEntries.filter((entry) => entry.required).map((entry) => entry.key),
  ]);
  const skillsHome = resolveHermesSkillsHome(ctx);
  await fs.mkdir(skillsHome, { recursive: true });
  const installed = await readInstalledSkillTargets(skillsHome);
  const availableByRuntimeName = new Map(availableEntries.map((entry) => [entry.runtimeName, entry]));

  for (const available of availableEntries) {
    if (!desiredSet.has(available.key)) continue;
    const target = path.join(skillsHome, available.runtimeName);
    await ensurePaperclipSkillSymlink(available.source, target);
  }

  for (const [name, installedEntry] of installed.entries()) {
    const available = availableByRuntimeName.get(name);
    if (!available) continue;
    if (desiredSet.has(available.key)) continue;
    if (installedEntry.targetPath !== available.source) continue;
    await fs.unlink(path.join(skillsHome, name)).catch(() => {});
  }

  return buildHermesSkillSnapshot(ctx);
}

export async function replaceHermesExternalSkill(
  ctx: AdapterSkillContext,
  input: ReplaceHermesExternalSkillInput,
): Promise<AdapterSkillSnapshot> {
  const availableEntries = await readPaperclipRuntimeSkillEntries(
    ctx.config,
    __moduleDir,
    PAPERCLIP_SKILL_ROOT_CANDIDATES,
  );
  const available = availableEntries.find(
    (entry) => entry.key === input.desiredSkillKey && entry.runtimeName === input.runtimeName,
  );
  if (!available) {
    throw new Error(`Managed Hermes skill ${input.desiredSkillKey} (${input.runtimeName}) is not available.`);
  }
  const skillsHome = resolveHermesSkillsHome(ctx);
  await fs.mkdir(skillsHome, { recursive: true });
  const installed = await readInstalledSkillTargets(skillsHome);
  const installedEntry = installed.get(input.runtimeName) ?? null;
  const normalizedExpected = path.resolve(input.expectedExternalSourcePath);
  const normalizedInstalled = installedEntry?.targetPath ? path.resolve(installedEntry.targetPath) : null;
  if (!installedEntry || normalizedInstalled !== normalizedExpected) {
    throw new Error(`Hermes runtime copy for ${input.runtimeName} no longer matches the expected external skill.`);
  }

  const target = path.join(skillsHome, input.runtimeName);
  await fs.rm(target, { recursive: true, force: true });
  await ensurePaperclipSkillSymlink(available.source, target);

  return buildHermesSkillSnapshot(ctx);
}
