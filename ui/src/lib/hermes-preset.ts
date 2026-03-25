import type { Company, CompanySecret, EnvBinding } from "@paperclipai/shared";
import type { CreateConfigValues } from "@paperclipai/adapter-utils";
import { defaultCreateValues } from "../components/agent-config-defaults";
import { applyCompanyAgentDefaults } from "./company-agent-defaults";

export const HERMES_PRESET_PROMPT_TEMPLATE =
  "You are agent {{ agent.name }}.\n\nFollow the current task instructions. Keep outputs concise, concrete, and blocker-oriented.";

const HERMES_PRESET_SECRET_BINDINGS: Record<string, string> = {
  NOUS_API_KEY: "nous_api_key",
  ZAI_API_KEY: "zai_api_key",
};

export function buildHermesLocalPresetEnvBindings(secrets: CompanySecret[]): Record<string, EnvBinding> {
  const env: Record<string, EnvBinding> = {};
  const secretByName = new Map(secrets.map((secret) => [secret.name.toLowerCase(), secret]));
  for (const [envKey, secretName] of Object.entries(HERMES_PRESET_SECRET_BINDINGS)) {
    const secret = secretByName.get(secretName.toLowerCase());
    if (!secret) continue;
    env[envKey] = { type: "secret_ref", secretId: secret.id, version: "latest" };
  }
  return env;
}

export function buildHermesLocalPresetValues(
  secrets: CompanySecret[],
  company?: Partial<Pick<
    Company,
    | "agentDefaultProvider"
    | "agentDefaultModel"
    | "agentDefaultHeartbeatIntervalSec"
    | "agentDefaultBrowserAutomationProvider"
    | "agentDefaultMaxTurnsPerRun"
    | "agentDefaultHermesManagedHome"
    | "agentDefaultHermesSeedCompanyProfileMemory"
    | "agentDefaultDangerouslySkipPermissions"
    | "agentDefaultDangerouslyBypassSandbox"
    | "agentDefaultHermesToolsets"
    | "agentDefaultHermesAllowedMcpServers"
    | "agentDefaultHermesMcpServers"
  >> | null,
): CreateConfigValues {
  return applyCompanyAgentDefaults({
    ...defaultCreateValues,
    adapterType: "hermes_local",
    model: "glm-4.7",
    command: "hermes",
    hermesManagedHome: true,
    hermesSeedCompanyProfileMemory: true,
    extraArgs: "--provider zai",
    promptTemplate: HERMES_PRESET_PROMPT_TEMPLATE,
    envBindings: buildHermesLocalPresetEnvBindings(secrets),
    heartbeatEnabled: true,
    intervalSec: 300,
  }, company ?? null);
}
