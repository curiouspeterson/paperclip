import type { AgentSkillEntry, CompanySkillListItem } from "@paperclipai/shared";

export interface AgentSkillDraftState {
  draft: string[];
  lastSaved: string[];
  hasHydratedSnapshot: boolean;
}

export interface AgentSkillSnapshotApplyResult extends AgentSkillDraftState {
  shouldSkipAutosave: boolean;
}

export function arraysEqual(a: string[], b: string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

export function applyAgentSkillSnapshot(
  state: AgentSkillDraftState,
  desiredSkills: string[],
): AgentSkillSnapshotApplyResult {
  const shouldReplaceDraft = !state.hasHydratedSnapshot || arraysEqual(state.draft, state.lastSaved);

  return {
    draft: shouldReplaceDraft ? desiredSkills : state.draft,
    lastSaved: desiredSkills,
    hasHydratedSnapshot: true,
    shouldSkipAutosave: shouldReplaceDraft,
  };
}

export function isReadOnlyUnmanagedSkillEntry(
  entry: AgentSkillEntry,
  companySkillKeys: Set<string>,
): boolean {
  if (companySkillKeys.has(entry.key)) return false;
  if (entry.origin === "user_installed" || entry.origin === "external_unknown") return true;
  return entry.managed === false && entry.state === "external";
}

export function getGovernableUnmanagedSkillImportSource(
  adapterType: string,
  entry: AgentSkillEntry,
): string | null {
  if (adapterType !== "hermes_local") return null;
  if (entry.origin !== "user_installed") return null;
  return typeof entry.targetPath === "string" && entry.targetPath.trim().length > 0
    ? entry.targetPath
    : null;
}

function normalizePortableSourcePath(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/[/\\]+$/, "");
}

export function findGovernedHermesSkillForImportSource(
  adapterType: string,
  entry: AgentSkillEntry,
  companySkills: CompanySkillListItem[],
): CompanySkillListItem | null {
  const importSource = getGovernableUnmanagedSkillImportSource(adapterType, entry);
  const normalizedImportSource = normalizePortableSourcePath(importSource);
  if (!normalizedImportSource) return null;
  return (
    companySkills.find((skill) => (
      normalizePortableSourcePath(skill.sourceLocator) === normalizedImportSource
      || normalizePortableSourcePath(skill.importedFromSourcePath) === normalizedImportSource
    ))
    ?? null
  );
}
