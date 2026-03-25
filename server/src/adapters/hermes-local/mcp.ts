import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolvePaperclipInstanceRoot } from "../../home-paths.js";
import type { AdapterAgent, AdapterEnvironmentTestContext, AdapterExecutionContext } from "../types.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

type HermesCompanyProfile = {
  companyName: string | null;
  voiceDescription: string | null;
  targetAudience: string | null;
  defaultChannel: string | null;
  defaultGoal: string | null;
  voiceExamplesRight: string[];
  voiceExamplesWrong: string[];
};

export type HermesAppliedRuntimePolicy = {
  hermesHome: string;
  managedHome: boolean;
  companyProfileMemorySeeded: boolean;
  toolsets: string[];
  configuredMcpServerNames: string[];
  allowedMcpServerNames: string[];
  materializedMcpServerNames: string[];
  seededContextFiles: string[];
};

export function asHermesCompanyProfile(value: unknown): HermesCompanyProfile | null {
  const record = asRecord(value);
  if (!record) return null;
  const companyName = asString(record.companyName);
  const voiceDescription = asString(record.voiceDescription);
  const targetAudience = asString(record.targetAudience);
  const defaultChannel = asString(record.defaultChannel);
  const defaultGoal = asString(record.defaultGoal);
  const voiceExamplesRight = asStringArray(record.voiceExamplesRight);
  const voiceExamplesWrong = asStringArray(record.voiceExamplesWrong);
  if (
    !companyName
    && !voiceDescription
    && !targetAudience
    && !defaultChannel
    && !defaultGoal
    && voiceExamplesRight.length === 0
    && voiceExamplesWrong.length === 0
  ) {
    return null;
  }
  return {
    companyName: companyName ?? null,
    voiceDescription: voiceDescription ?? null,
    targetAudience: targetAudience ?? null,
    defaultChannel: defaultChannel ?? null,
    defaultGoal: defaultGoal ?? null,
    voiceExamplesRight,
    voiceExamplesWrong,
  };
}

function cloneConfig(config: Record<string, unknown>): Record<string, unknown> {
  return {
    ...config,
    env: {
      ...(asRecord(config.env) ?? {}),
    },
  };
}

export function resolveHermesManagedHome(agentId: string) {
  return path.resolve(resolvePaperclipInstanceRoot(), "data", "hermes", agentId);
}

export function resolveHermesHomeForConfig(agentId: string, config: Record<string, unknown>): string {
  const env = asRecord(config.env) ?? {};
  const explicitHermesHome = asString(env.HERMES_HOME);
  if (explicitHermesHome) return path.resolve(explicitHermesHome);
  const configuredHome = asString(env.HOME);
  if (configuredHome && !config.paperclipManagedHermesHome) {
    return path.join(path.resolve(configuredHome), ".hermes");
  }
  if (config.paperclipManagedHermesHome || asRecord(config.mcpServers)) {
    return resolveHermesManagedHome(agentId);
  }
  if (configuredHome) {
    return path.join(path.resolve(configuredHome), ".hermes");
  }
  return path.resolve(process.env.HOME ?? os.homedir(), ".hermes");
}

async function writeHermesManagedConfig(hermesHome: string, mcpServers: Record<string, unknown>) {
  await fs.mkdir(hermesHome, { recursive: true });
  const configPath = path.join(hermesHome, "config.yaml");
  const serialized = `${JSON.stringify({ mcp_servers: mcpServers }, null, 2)}\n`;
  await fs.writeFile(configPath, serialized, "utf8");
}

async function ensureHermesManagedHome(hermesHome: string) {
  await fs.mkdir(hermesHome, { recursive: true });
}

async function writeIfChanged(filePath: string, content: string) {
  const normalized = content.endsWith("\n") ? content : `${content}\n`;
  const existing = await fs.readFile(filePath, "utf8").catch(() => null);
  if (existing === normalized) return;
  await fs.writeFile(filePath, normalized, "utf8");
}

function buildSoulMd(profile: HermesCompanyProfile) {
  const lines = [
    "# SOUL.md -- Company Voice",
    "",
    "Use this as the default brand-voice reference for work done on behalf of the company.",
  ];
  if (profile.companyName) {
    lines.push("", `Company: ${profile.companyName}`);
  }
  if (profile.voiceDescription) {
    lines.push("", "## How We Describe Our Voice", "", profile.voiceDescription);
  }
  if (profile.targetAudience) {
    lines.push("", "## Who We Are Talking To", "", profile.targetAudience);
  }
  if (profile.defaultChannel) {
    lines.push("", "## Default Channel", "", profile.defaultChannel);
  }
  if (profile.defaultGoal) {
    lines.push("", "## Default Goal", "", profile.defaultGoal);
  }
  if (profile.voiceExamplesRight.length > 0) {
    lines.push("", "## Examples That Feel Exactly Right", "");
    profile.voiceExamplesRight.forEach((sample, index) => {
      lines.push(`${index + 1}. ${sample}`);
    });
  }
  if (profile.voiceExamplesWrong.length > 0) {
    lines.push("", "## Examples That Feel Wrong", "");
    profile.voiceExamplesWrong.forEach((sample, index) => {
      lines.push(`${index + 1}. ${sample}`);
    });
  }
  return lines.join("\n");
}

function buildAgentsMd(profile: HermesCompanyProfile) {
  const lines = [
    "# AGENTS.md -- Company Prompt Packet",
    "",
    "Before writing, planning, or editing for this company, anchor on this packet:",
    "",
    "1. Here is how we describe our voice.",
    "2. Here are examples that feel exactly right.",
    "3. Here are examples that feel wrong.",
    "4. Here is who we are talking to.",
    "5. Here is what the piece needs to achieve.",
  ];
  if (profile.voiceDescription) {
    lines.push("", "## Voice", "", profile.voiceDescription);
  }
  if (profile.voiceExamplesRight.length > 0) {
    lines.push("", "## Right Examples", "");
    profile.voiceExamplesRight.forEach((sample, index) => {
      lines.push(`${index + 1}. ${sample}`);
    });
  }
  if (profile.voiceExamplesWrong.length > 0) {
    lines.push("", "## Wrong Examples", "");
    profile.voiceExamplesWrong.forEach((sample, index) => {
      lines.push(`${index + 1}. ${sample}`);
    });
  }
  if (profile.targetAudience) {
    lines.push("", "## Audience", "", profile.targetAudience);
  }
  if (profile.defaultChannel) {
    lines.push("", "## Channel", "", profile.defaultChannel);
  }
  if (profile.defaultGoal) {
    lines.push("", "## Goal", "", profile.defaultGoal);
  }
  return lines.join("\n");
}

async function seedHermesManagedHomeContext(hermesHome: string, profile: HermesCompanyProfile | null) {
  if (!profile) return;
  await ensureHermesManagedHome(hermesHome);
  await Promise.all([
    writeIfChanged(path.join(hermesHome, "SOUL.md"), buildSoulMd(profile)),
    writeIfChanged(path.join(hermesHome, "AGENTS.md"), buildAgentsMd(profile)),
  ]);
}

function buildUserMd(profile: HermesCompanyProfile) {
  const lines = [
    "# USER.md -- Working Audience",
    "",
    "Treat this as stable user/company context for this Hermes home.",
  ];
  if (profile.companyName) lines.push("", `Company: ${profile.companyName}`);
  if (profile.targetAudience) lines.push("", "## Audience", "", profile.targetAudience);
  if (profile.defaultChannel) lines.push("", "## Default Channel", "", profile.defaultChannel);
  if (profile.defaultGoal) lines.push("", "## Default Goal", "", profile.defaultGoal);
  return lines.join("\n");
}

function buildMemoryMd(profile: HermesCompanyProfile) {
  const lines = [
    "# MEMORY.md -- Seeded Company Memory",
    "",
    "Seeded from the Paperclip Company Profile. Treat these as durable brand facts unless the profile changes.",
  ];
  if (profile.voiceDescription) lines.push("", "## Voice", "", profile.voiceDescription);
  if (profile.targetAudience) lines.push("", "## Audience", "", profile.targetAudience);
  if (profile.defaultChannel) lines.push("", "## Channel", "", profile.defaultChannel);
  if (profile.defaultGoal) lines.push("", "## Goal", "", profile.defaultGoal);
  if (profile.voiceExamplesRight.length > 0) {
    lines.push("", "## Right Examples", "");
    profile.voiceExamplesRight.forEach((sample, index) => lines.push(`${index + 1}. ${sample}`));
  }
  if (profile.voiceExamplesWrong.length > 0) {
    lines.push("", "## Wrong Examples", "");
    profile.voiceExamplesWrong.forEach((sample, index) => lines.push(`${index + 1}. ${sample}`));
  }
  return lines.join("\n");
}

async function seedHermesManagedHomeMemory(
  hermesHome: string,
  profile: HermesCompanyProfile | null,
  enabled: boolean,
) {
  if (!enabled || !profile) return;
  await ensureHermesManagedHome(hermesHome);
  await Promise.all([
    writeIfChanged(path.join(hermesHome, "USER.md"), buildUserMd(profile)),
    writeIfChanged(path.join(hermesHome, "MEMORY.md"), buildMemoryMd(profile)),
  ]);
}

function filterMcpServers(
  mcpServers: Record<string, unknown>,
  allowedMcpServerNames: string[],
) {
  if (allowedMcpServerNames.length === 0) return mcpServers;
  const allowed = new Set(allowedMcpServerNames);
  return Object.fromEntries(
    Object.entries(mcpServers).filter(([name]) => allowed.has(name)),
  );
}

export function buildHermesAppliedRuntimePolicy(
  config: Record<string, unknown>,
  companyProfile: HermesCompanyProfile | null,
): HermesAppliedRuntimePolicy {
  const env = asRecord(config.env) ?? {};
  const hermesHome = asString(env.HERMES_HOME)
    ?? resolveHermesHomeForConfig("unknown", config);
  const toolsets = asString(config.toolsets)
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean) ?? [];
  const configuredMcpServerNames = Object.keys(asRecord(config.mcpServers) ?? {}).sort((a, b) => a.localeCompare(b));
  const allowedMcpServerNames = asStringArray(config.allowedMcpServerNames).sort((a, b) => a.localeCompare(b));
  const materializedMcpServerNames = filterMcpServers(
    asRecord(config.mcpServers) ?? {},
    allowedMcpServerNames,
  );
  const seededContextFiles = companyProfile
    ? [
        "SOUL.md",
        "AGENTS.md",
        ...(config.paperclipSeedCompanyProfileMemory === true ? ["USER.md", "MEMORY.md"] : []),
      ]
    : [];

  return {
    hermesHome,
    managedHome: config.paperclipManagedHermesHome === true,
    companyProfileMemorySeeded: config.paperclipSeedCompanyProfileMemory === true,
    toolsets,
    configuredMcpServerNames,
    allowedMcpServerNames,
    materializedMcpServerNames: Object.keys(materializedMcpServerNames).sort((a, b) => a.localeCompare(b)),
    seededContextFiles,
  };
}

type HermesLikeContext =
  | Pick<AdapterExecutionContext, "agent" | "config" | "context">
  | (Pick<AdapterEnvironmentTestContext, "companyId" | "config"> & { agent?: Pick<AdapterAgent, "id"> | null });

export async function materializeHermesMcpConfig<T extends HermesLikeContext>(ctx: T): Promise<Record<string, unknown>> {
  const configuredMcpServers = asRecord(ctx.config.mcpServers);
  const shouldManageHome = ctx.config.paperclipManagedHermesHome === true;
  if ((!configuredMcpServers || Object.keys(configuredMcpServers).length === 0) && !shouldManageHome) {
    return ctx.config;
  }
  const allowedMcpServerNames = asStringArray(ctx.config.allowedMcpServerNames);
  const mcpServers = filterMcpServers(configuredMcpServers ?? {}, allowedMcpServerNames);

  const fallbackOwnerId =
    "companyId" in ctx && typeof ctx.companyId === "string" && ctx.companyId.trim().length > 0
      ? `company-${ctx.companyId}`
      : "company-default";
  const agentId = "agent" in ctx && ctx.agent?.id ? ctx.agent.id : fallbackOwnerId;
  const nextConfig = cloneConfig(ctx.config);
  const env = asRecord(nextConfig.env) ?? {};
  const hermesHome = resolveHermesHomeForConfig(agentId, nextConfig);
  const companyProfile = "context" in ctx ? asHermesCompanyProfile(asRecord(ctx.context)?.paperclipCompanyProfile) : null;
  const seedCompanyProfileMemory = nextConfig.paperclipSeedCompanyProfileMemory === true;
  if (Object.keys(mcpServers).length > 0) {
    await writeHermesManagedConfig(hermesHome, mcpServers);
  } else {
    await ensureHermesManagedHome(hermesHome);
  }
  await seedHermesManagedHomeContext(hermesHome, companyProfile);
  await seedHermesManagedHomeMemory(hermesHome, companyProfile, seedCompanyProfileMemory);
  env.HERMES_HOME = hermesHome;
  nextConfig.env = env;
  nextConfig.paperclipManagedHermesHome = true;
  return nextConfig;
}
