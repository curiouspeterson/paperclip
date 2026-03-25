import type { CreateConfigValues } from "@paperclipai/adapter-utils";
import type { Company } from "@paperclipai/shared";
import { defaultCreateValues } from "../components/agent-config-defaults";

export type CompanyAgentDefaults = Partial<
  Pick<
    Company,
  | "agentDefaultAdapterType"
  | "agentDefaultProvider"
  | "agentDefaultModel"
  | "agentDefaultHeartbeatIntervalSec"
  | "agentDefaultWakeOnDemand"
  | "agentDefaultCooldownSec"
  | "agentDefaultMaxConcurrentRuns"
  | "agentDefaultMaxTurnsPerRun"
  | "agentDefaultBrowserAutomationProvider"
  | "agentDefaultHermesManagedHome"
  | "agentDefaultHermesSeedCompanyProfileMemory"
  | "agentDefaultHermesToolsets"
  | "agentDefaultHermesAllowedMcpServers"
  | "agentDefaultHermesMcpServers"
  | "agentDefaultDangerouslySkipPermissions"
  | "agentDefaultDangerouslyBypassSandbox"
  >
>;

function trimOrNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function replaceHermesProviderArg(extraArgs: string, provider: string) {
  const trimmed = extraArgs.trim();
  if (!trimmed) return `--provider ${provider}`;
  if (/(^|\s)--provider(?:=|\s+)/.test(trimmed)) {
    return trimmed.replace(/(^|\s)--provider(?:=|\s+)(?:"[^"]+"|'[^']+'|\S+)/, `$1--provider ${provider}`).trim();
  }
  return `--provider ${provider} ${trimmed}`.trim();
}

export function resolveCompanyDefaultAgentAdapterType(company: CompanyAgentDefaults | null | undefined) {
  return company?.agentDefaultAdapterType ?? defaultCreateValues.adapterType;
}

export function applyCompanyAgentDefaults(
  values: CreateConfigValues,
  company: CompanyAgentDefaults | null | undefined,
): CreateConfigValues {
  if (!company) return values;

  const next: CreateConfigValues = { ...values };
  const provider = trimOrNull(company.agentDefaultProvider);
  const model = trimOrNull(company.agentDefaultModel);
  const browserAutomationProvider = trimOrNull(company.agentDefaultBrowserAutomationProvider);
  const hermesToolsets = trimOrNull(company.agentDefaultHermesToolsets);
  const hermesAllowedMcpServers = trimOrNull(company.agentDefaultHermesAllowedMcpServers);

  if (model) next.model = model;
  if (company.agentDefaultHeartbeatIntervalSec != null) next.intervalSec = company.agentDefaultHeartbeatIntervalSec;
  if (company.agentDefaultMaxTurnsPerRun != null) next.maxTurnsPerRun = company.agentDefaultMaxTurnsPerRun;
  if (browserAutomationProvider) next.browserAutomationProvider = browserAutomationProvider as CreateConfigValues["browserAutomationProvider"];
  if (company.agentDefaultDangerouslySkipPermissions != null) {
    next.dangerouslySkipPermissions = company.agentDefaultDangerouslySkipPermissions;
  }
  if (company.agentDefaultDangerouslyBypassSandbox != null) {
    next.dangerouslyBypassSandbox = company.agentDefaultDangerouslyBypassSandbox;
  }

  if (next.adapterType === "hermes_local" && provider) {
    next.extraArgs = replaceHermesProviderArg(next.extraArgs, provider);
  }
  if (next.adapterType === "hermes_local" && company.agentDefaultHermesManagedHome != null) {
    next.hermesManagedHome = company.agentDefaultHermesManagedHome;
  }
  if (next.adapterType === "hermes_local" && company.agentDefaultHermesSeedCompanyProfileMemory != null) {
    next.hermesSeedCompanyProfileMemory = company.agentDefaultHermesSeedCompanyProfileMemory;
  }
  if (next.adapterType === "hermes_local" && hermesToolsets) {
    next.hermesToolsets = hermesToolsets;
  }
  if (next.adapterType === "hermes_local" && hermesAllowedMcpServers) {
    next.hermesAllowedMcpServers = hermesAllowedMcpServers;
  }
  if (
    next.adapterType === "hermes_local"
    && company.agentDefaultHermesMcpServers
    && Object.keys(company.agentDefaultHermesMcpServers).length > 0
  ) {
    next.mcpServersJson = JSON.stringify(company.agentDefaultHermesMcpServers, null, 2);
  }

  return next;
}

export function applyCompanyHeartbeatDefaults(
  heartbeat: {
    enabled: boolean;
    intervalSec: number;
    wakeOnDemand: boolean;
    cooldownSec: number;
    maxConcurrentRuns: number;
  },
  company: CompanyAgentDefaults | null | undefined,
) {
  if (!company) return heartbeat;
  return {
    ...heartbeat,
    intervalSec: company.agentDefaultHeartbeatIntervalSec ?? heartbeat.intervalSec,
    wakeOnDemand: company.agentDefaultWakeOnDemand ?? heartbeat.wakeOnDemand,
    cooldownSec: company.agentDefaultCooldownSec ?? heartbeat.cooldownSec,
    maxConcurrentRuns: company.agentDefaultMaxConcurrentRuns ?? heartbeat.maxConcurrentRuns,
  };
}
