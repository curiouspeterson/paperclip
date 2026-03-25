import type {
  Agent,
  AgentRuntimeState,
  AgentSkillSnapshot,
  AgentTaskSession,
  CompanySkillListItem,
} from "@paperclipai/shared";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function parseHermesAppliedRuntimePolicy(value: unknown) {
  const record = asRecord(value);
  if (!record) return null;
  const hermesHome = asNonEmptyString(record.hermesHome);
  if (!hermesHome) return null;
  return {
    hermesHome,
    managedHome: record.managedHome === true,
    companyProfileMemorySeeded: record.companyProfileMemorySeeded === true,
    toolsets: asStringArray(record.toolsets),
    configuredMcpServerNames: asStringArray(record.configuredMcpServerNames),
    allowedMcpServerNames: asStringArray(record.allowedMcpServerNames),
    materializedMcpServerNames: asStringArray(record.materializedMcpServerNames),
    seededContextFiles: asStringArray(record.seededContextFiles),
  };
}

function resolveHermesHome(agent: Agent): string {
  const adapterConfig = asRecord(agent.adapterConfig);
  if (adapterConfig?.paperclipManagedHermesHome === true) {
    return "Paperclip-managed per-agent Hermes home";
  }
  const env = asRecord(adapterConfig?.env);
  const explicitHome = asNonEmptyString(env?.HERMES_HOME);
  if (explicitHome) return explicitHome;
  const home = asNonEmptyString(env?.HOME);
  if (home) return `${home.replace(/[/\\]+$/, "")}/.hermes`;
  return "~/.hermes";
}

export interface HermesDiagnosticsSummary {
  hermesHome: string;
  managedHome: boolean;
  companyProfileMemorySeeded: boolean;
  runtimeConfigDrift: boolean;
  runtimeConfigDriftReason: string | null;
  lastAppliedRuntimePolicy: {
    hermesHome: string;
    managedHome: boolean;
    companyProfileMemorySeeded: boolean;
    toolsets: string[];
    configuredMcpServerNames: string[];
    allowedMcpServerNames: string[];
    materializedMcpServerNames: string[];
    seededContextFiles: string[];
  } | null;
  activeSessionDisplayId: string | null;
  activeSessionId: string | null;
  toolsets: string[];
  configuredMcpServerCount: number;
  allowedMcpServerNames: string[];
  taskSessionCount: number;
  taskSessionDisplayIds: string[];
  continuityDrift: boolean;
  recentTaskSessions: Array<{
    id: string;
    taskKey: string;
    sessionLabel: string;
    createdAt: Date;
    updatedAt: Date;
    lastRunId: string | null;
    lastError: string | null;
    isActive: boolean;
  }>;
  desiredManagedSkillCount: number;
  importedSourceConflictRuntimeNames: string[];
  importedSourceConflicts: Array<{
    key: string;
    runtimeName: string;
    externalConflictPath: string | null;
    companySkillId: string | null;
    companySkillName: string | null;
  }>;
}

export function buildHermesDiagnosticsSummary(input: {
  agent: Agent;
  runtimeState?: AgentRuntimeState | null;
  taskSessions?: AgentTaskSession[] | null;
  skillSnapshot?: AgentSkillSnapshot | null;
  companySkills?: CompanySkillListItem[] | null;
}): HermesDiagnosticsSummary | null {
  const { agent, runtimeState, taskSessions, skillSnapshot, companySkills } = input;
  if (agent.adapterType !== "hermes_local") return null;

  const entries = skillSnapshot?.entries ?? [];
  const adapterConfig = asRecord(agent.adapterConfig);
  const managedHome = adapterConfig?.paperclipManagedHermesHome === true;
  const companyProfileMemorySeeded = adapterConfig?.paperclipSeedCompanyProfileMemory === true;
  const toolsets = (asNonEmptyString(adapterConfig?.toolsets) ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const configuredMcpServerCount = Object.keys(asRecord(adapterConfig?.mcpServers) ?? {}).length;
  const allowedMcpServerNames = Array.isArray(adapterConfig?.allowedMcpServerNames)
    ? adapterConfig.allowedMcpServerNames.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  const desiredManagedSkillCount = entries.filter(
    (entry) => entry.desired && (entry.origin === "company_managed" || entry.origin === "paperclip_required"),
  ).length;
  const importedSourceConflictRuntimeNames = entries
    .filter((entry) => entry.externalConflictKind === "imported_source" && entry.runtimeName)
    .map((entry) => entry.runtimeName!)
    .sort((left, right) => left.localeCompare(right));
  const companySkillsByKey = new Map((companySkills ?? []).map((skill) => [skill.key, skill]));
  const importedSourceConflicts = entries
    .filter((entry) => entry.externalConflictKind === "imported_source" && entry.runtimeName)
    .map((entry) => {
      const companySkill = companySkillsByKey.get(entry.key) ?? null;
      return {
        key: entry.key,
        runtimeName: entry.runtimeName!,
        externalConflictPath: asNonEmptyString(entry.externalConflictPath),
        companySkillId: companySkill?.id ?? null,
        companySkillName: companySkill?.name ?? null,
      };
    })
    .sort((left, right) => left.runtimeName.localeCompare(right.runtimeName));
  const taskSessionDisplayIds = (taskSessions ?? [])
    .map((session) => asNonEmptyString(session.sessionDisplayId) ?? session.taskKey)
    .filter((value, index, array): value is string => Boolean(value) && array.indexOf(value) === index)
    .sort((left, right) => left.localeCompare(right));
  const activeSessionDisplayId = asNonEmptyString(runtimeState?.sessionDisplayId);
  const activeSessionId = asNonEmptyString(runtimeState?.sessionId);
  const lastAppliedRuntimePolicy = parseHermesAppliedRuntimePolicy(
    asRecord(runtimeState?.stateJson)?.hermesAppliedRuntimePolicy,
  );
  const runtimeConfigDrift =
    Boolean(activeSessionId)
    && runtimeState !== undefined
    && runtimeState !== null
    && agent.updatedAt.getTime() > runtimeState.updatedAt.getTime();
  const runtimeConfigDriftReason = runtimeConfigDrift
    ? "The saved Hermes agent configuration was updated after the active runtime last refreshed. Reset or rerun the session to apply the latest managed-home, toolset, and MCP policy."
    : null;
  const recentTaskSessions = [...(taskSessions ?? [])]
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
    .slice(0, 5)
    .map((session) => {
      const sessionLabel = asNonEmptyString(session.sessionDisplayId) ?? session.taskKey;
      return {
        id: session.id,
        taskKey: session.taskKey,
        sessionLabel,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        lastRunId: session.lastRunId ?? null,
        lastError: asNonEmptyString(session.lastError),
        isActive: activeSessionDisplayId !== null && session.sessionDisplayId === activeSessionDisplayId,
      };
    });
  const continuityDrift =
    activeSessionDisplayId !== null
    && (taskSessions?.length ?? 0) > 0
    && !(taskSessions ?? []).some((session) => session.sessionDisplayId === activeSessionDisplayId);

  return {
    hermesHome: resolveHermesHome(agent),
    managedHome,
    companyProfileMemorySeeded,
    runtimeConfigDrift,
    runtimeConfigDriftReason,
    lastAppliedRuntimePolicy,
    activeSessionDisplayId,
    activeSessionId,
    toolsets,
    configuredMcpServerCount,
    allowedMcpServerNames,
    taskSessionCount: taskSessions?.length ?? 0,
    taskSessionDisplayIds,
    continuityDrift,
    recentTaskSessions,
    desiredManagedSkillCount,
    importedSourceConflictRuntimeNames,
    importedSourceConflicts,
  };
}
