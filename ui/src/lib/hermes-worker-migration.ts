import type { Agent } from "@paperclipai/shared";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function resolveEnvValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  const record = asRecord(value);
  if (!record) return null;
  if (record.type === "plain" && typeof record.value === "string") {
    return record.value.trim() || null;
  }
  return null;
}

export function isLegacyHermesWorkerProcessAgent(agent: Pick<Agent, "adapterType" | "adapterConfig">): boolean {
  if (agent.adapterType !== "process") return false;
  const config = asRecord(agent.adapterConfig);
  if (!config) return false;
  const args = Array.isArray(config.args)
    ? config.args.filter((value): value is string => typeof value === "string")
    : [];
  return args.some((value) => /(^|[/\\])hermes_paperclip_worker\.py$/i.test(value.trim()));
}

export function buildLegacyHermesWorkerMigrationPreview(agent: Pick<Agent, "adapterType" | "adapterConfig">) {
  if (!isLegacyHermesWorkerProcessAgent(agent)) return null;
  const config = asRecord(agent.adapterConfig) ?? {};
  const env = asRecord(config.env) ?? {};
  return {
    provider: resolveEnvValue(env.HERMES_PROVIDER),
    model: resolveEnvValue(env.HERMES_MODEL),
    hermesCommand: resolveEnvValue(env.HERMES_BIN),
    browserAutomationProvider: asString(config.browserAutomationProvider),
    managedHome: true,
    memorySeeding: true,
  };
}
