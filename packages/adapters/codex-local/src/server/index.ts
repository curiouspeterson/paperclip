export { execute, ensureCodexSkillsInjected } from "./execute.js";
export { listCodexModels, resetCodexModelsCacheForTests } from "./models.js";
export { testEnvironment } from "./test.js";
export { parseCodexJsonl, isCodexUnknownSessionError } from "./parse.js";
export {
  getQuotaWindows,
  readCodexAuthInfo,
  readCodexToken,
  fetchCodexQuota,
  fetchCodexRpcQuota,
  mapCodexRpcQuota,
  secondsToWindowLabel,
  fetchWithTimeout,
  codexHomeDir,
} from "./quota.js";
import type { AdapterConfigNormalizationInput, AdapterSessionCodec } from "@paperclipai/adapter-utils";
import {
  DEFAULT_CODEX_LOCAL_BYPASS_APPROVALS_AND_SANDBOX,
  DEFAULT_CODEX_LOCAL_MODEL,
} from "../index.js";

export async function normalizeConfigForPersistence({
  config,
}: AdapterConfigNormalizationInput): Promise<Record<string, unknown>> {
  const next = { ...config };
  if (!(typeof next.model === "string" && next.model.trim().length > 0)) {
    next.model = DEFAULT_CODEX_LOCAL_MODEL;
  }
  const hasBypassFlag =
    typeof next.dangerouslyBypassApprovalsAndSandbox === "boolean" ||
    typeof next.dangerouslyBypassSandbox === "boolean";
  if (!hasBypassFlag) {
    next.dangerouslyBypassApprovalsAndSandbox = DEFAULT_CODEX_LOCAL_BYPASS_APPROVALS_AND_SANDBOX;
  }
  return next;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export const sessionCodec: AdapterSessionCodec = {
  deserialize(raw: unknown) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    const sessionId = readNonEmptyString(record.sessionId) ?? readNonEmptyString(record.session_id);
    if (!sessionId) return null;
    const cwd =
      readNonEmptyString(record.cwd) ??
      readNonEmptyString(record.workdir) ??
      readNonEmptyString(record.folder);
    const workspaceId = readNonEmptyString(record.workspaceId) ?? readNonEmptyString(record.workspace_id);
    const repoUrl = readNonEmptyString(record.repoUrl) ?? readNonEmptyString(record.repo_url);
    const repoRef = readNonEmptyString(record.repoRef) ?? readNonEmptyString(record.repo_ref);
    return {
      sessionId,
      ...(cwd ? { cwd } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      ...(repoUrl ? { repoUrl } : {}),
      ...(repoRef ? { repoRef } : {}),
    };
  },
  serialize(params: Record<string, unknown> | null) {
    if (!params) return null;
    const sessionId = readNonEmptyString(params.sessionId) ?? readNonEmptyString(params.session_id);
    if (!sessionId) return null;
    const cwd =
      readNonEmptyString(params.cwd) ??
      readNonEmptyString(params.workdir) ??
      readNonEmptyString(params.folder);
    const workspaceId = readNonEmptyString(params.workspaceId) ?? readNonEmptyString(params.workspace_id);
    const repoUrl = readNonEmptyString(params.repoUrl) ?? readNonEmptyString(params.repo_url);
    const repoRef = readNonEmptyString(params.repoRef) ?? readNonEmptyString(params.repo_ref);
    return {
      sessionId,
      ...(cwd ? { cwd } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      ...(repoUrl ? { repoUrl } : {}),
      ...(repoRef ? { repoRef } : {}),
    };
  },
  getDisplayId(params: Record<string, unknown> | null) {
    if (!params) return null;
    return readNonEmptyString(params.sessionId) ?? readNonEmptyString(params.session_id);
  },
};
