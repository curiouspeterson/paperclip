import type { AdapterExecutionContext, AdapterExecutionResult, UsageSummary } from "../types.js";
import {
  asString,
  asNumber,
  asStringArray,
  parseObject,
  buildPaperclipEnv,
  buildBrowserAutomationEnv,
  redactEnvForLogs,
  runChildProcess,
} from "../utils.js";

/**
 * Try to parse a JSON object from the last non-empty line of stdout.
 * Process workers (e.g. hermes_paperclip_worker.py) emit a JSON summary
 * as their final stdout line containing `_usage`, `_provider`, `_model`, etc.
 */
function parseStdoutJson(stdout: string): Record<string, unknown> | null {
  const lines = stdout.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // not valid JSON, skip
    }
    break;
  }
  return null;
}

/**
 * Extract usage, provider, model, and cost fields from parsed stdout JSON.
 * Recognizes the `_usage` / `_provider` / `_model` convention used by
 * Paperclip process workers.
 */
function extractUsageFromStdout(parsed: Record<string, unknown>): {
  usage?: UsageSummary;
  provider?: string;
  model?: string;
  costUsd?: number;
  sessionId?: string;
  sessionDisplayId?: string;
  sessionParams?: Record<string, unknown> | null;
  clearSession?: boolean;
} {
  const result: {
    usage?: UsageSummary;
    provider?: string;
    model?: string;
    costUsd?: number;
    sessionId?: string;
    sessionDisplayId?: string;
    sessionParams?: Record<string, unknown> | null;
    clearSession?: boolean;
  } = {};

  const rawUsage = parsed._usage;
  if (rawUsage && typeof rawUsage === "object" && !Array.isArray(rawUsage)) {
    const u = rawUsage as Record<string, unknown>;
    const inputTokens = typeof u.inputTokens === "number" ? u.inputTokens : 0;
    const outputTokens = typeof u.outputTokens === "number" ? u.outputTokens : 0;
    const cachedInputTokens = typeof u.cachedInputTokens === "number" ? u.cachedInputTokens : 0;
    if (inputTokens > 0 || outputTokens > 0) {
      result.usage = { inputTokens, outputTokens, cachedInputTokens };
    }
  }

  if (typeof parsed._provider === "string" && parsed._provider.trim()) {
    result.provider = parsed._provider.trim();
  }
  if (typeof parsed._model === "string" && parsed._model.trim()) {
    result.model = parsed._model.trim();
  }
  if (typeof parsed._costUsd === "number" && parsed._costUsd > 0) {
    result.costUsd = parsed._costUsd;
  }
  if (typeof parsed._sessionId === "string" && parsed._sessionId.trim()) {
    result.sessionId = parsed._sessionId.trim();
  }
  if (typeof parsed._sessionDisplayId === "string" && parsed._sessionDisplayId.trim()) {
    result.sessionDisplayId = parsed._sessionDisplayId.trim();
  }
  if (
    Object.prototype.hasOwnProperty.call(parsed, "_sessionParams") &&
    parsed._sessionParams &&
    typeof parsed._sessionParams === "object" &&
    !Array.isArray(parsed._sessionParams)
  ) {
    result.sessionParams = parsed._sessionParams as Record<string, unknown>;
  }
  if (typeof parsed._clearSession === "boolean") {
    result.clearSession = parsed._clearSession;
  }

  return result;
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, runtime, config, context, onLog, onMeta, authToken } = ctx;
  const command = asString(config.command, "");
  if (!command) throw new Error("Process adapter missing command");

  const args = asStringArray(config.args);
  const cwd = asString(config.cwd, process.cwd());
  const envConfig = parseObject(config.env);
  const hasExplicitApiKey =
    typeof envConfig.PAPERCLIP_API_KEY === "string" && envConfig.PAPERCLIP_API_KEY.trim().length > 0;
  const env: Record<string, string> = { ...buildPaperclipEnv(agent) };
  env.PAPERCLIP_RUN_ID = runId;
  const workspaceContext = parseObject(context.paperclipWorkspace);
  const workspaceCwd = asString(workspaceContext.cwd, "");
  const workspaceSource = asString(workspaceContext.source, "");
  const workspaceId = asString(workspaceContext.workspaceId, "");
  const workspaceRepoUrl = asString(workspaceContext.repoUrl, "");
  const workspaceRepoRef = asString(workspaceContext.repoRef, "");
  const agentHome = asString(workspaceContext.agentHome, "");
  const taskId =
    (typeof context.taskId === "string" && context.taskId.trim().length > 0 && context.taskId.trim()) ||
    (typeof context.issueId === "string" && context.issueId.trim().length > 0 && context.issueId.trim()) ||
    "";
  const wakeReason =
    typeof context.wakeReason === "string" && context.wakeReason.trim().length > 0
      ? context.wakeReason.trim()
      : "";
  const wakeCommentId =
    (typeof context.wakeCommentId === "string" && context.wakeCommentId.trim().length > 0 && context.wakeCommentId.trim()) ||
    (typeof context.commentId === "string" && context.commentId.trim().length > 0 && context.commentId.trim()) ||
    "";
  const approvalId =
    typeof context.approvalId === "string" && context.approvalId.trim().length > 0
      ? context.approvalId.trim()
      : "";
  const approvalStatus =
    typeof context.approvalStatus === "string" && context.approvalStatus.trim().length > 0
      ? context.approvalStatus.trim()
      : "";
  const runtimeSessionId = asString(runtime.sessionId, "").trim();
  const runtimeSessionParams =
    runtime.sessionParams && typeof runtime.sessionParams === "object" && !Array.isArray(runtime.sessionParams)
      ? runtime.sessionParams
      : null;

  env.PAPERCLIP_WORKSPACE_CWD = workspaceCwd || cwd;
  if (taskId) env.PAPERCLIP_TASK_ID = taskId;
  if (wakeReason) env.PAPERCLIP_WAKE_REASON = wakeReason;
  if (wakeCommentId) env.PAPERCLIP_WAKE_COMMENT_ID = wakeCommentId;
  if (approvalId) env.PAPERCLIP_APPROVAL_ID = approvalId;
  if (approvalStatus) env.PAPERCLIP_APPROVAL_STATUS = approvalStatus;
  if (workspaceSource) env.PAPERCLIP_WORKSPACE_SOURCE = workspaceSource;
  if (workspaceId) env.PAPERCLIP_WORKSPACE_ID = workspaceId;
  if (workspaceRepoUrl) env.PAPERCLIP_WORKSPACE_REPO_URL = workspaceRepoUrl;
  if (workspaceRepoRef) env.PAPERCLIP_WORKSPACE_REPO_REF = workspaceRepoRef;
  if (agentHome) env.AGENT_HOME = agentHome;
  if (runtimeSessionId) env.PAPERCLIP_RUNTIME_SESSION_ID = runtimeSessionId;
  if (runtimeSessionParams) {
    env.PAPERCLIP_RUNTIME_SESSION_PARAMS_JSON = JSON.stringify(runtimeSessionParams);
  }
  for (const [k, v] of Object.entries(envConfig)) {
    if (typeof v === "string") env[k] = v;
  }
  if (!hasExplicitApiKey && authToken) {
    env.PAPERCLIP_API_KEY = authToken;
  }
  Object.assign(env, buildBrowserAutomationEnv(parseObject(config)));

  const timeoutSec = asNumber(config.timeoutSec, 0);
  const graceSec = asNumber(config.graceSec, 15);

  if (onMeta) {
    await onMeta({
      adapterType: "process",
      command,
      cwd,
      commandArgs: args,
      env: redactEnvForLogs(env),
    });
  }

  const proc = await runChildProcess(runId, command, args, {
    cwd,
    env,
    timeoutSec,
    graceSec,
    onLog,
  });

  if (proc.timedOut) {
    return {
      exitCode: proc.exitCode,
      signal: proc.signal,
      timedOut: true,
      errorMessage: `Timed out after ${timeoutSec}s`,
    };
  }

  // Parse stdout JSON to extract usage/cost telemetry from process workers
  const stdoutParsed = proc.stdout ? parseStdoutJson(proc.stdout) : null;
  const extracted = stdoutParsed ? extractUsageFromStdout(stdoutParsed) : {};

  if ((proc.exitCode ?? 0) !== 0) {
    return {
      exitCode: proc.exitCode,
      signal: proc.signal,
      timedOut: false,
      errorMessage: `Process exited with code ${proc.exitCode ?? -1}`,
      ...extracted,
      resultJson: {
        stdout: proc.stdout,
        stderr: proc.stderr,
      },
    };
  }

  return {
    exitCode: proc.exitCode,
    signal: proc.signal,
    timedOut: false,
    errorMessage: null,
    ...extracted,
    resultJson: {
      stdout: proc.stdout,
      stderr: proc.stderr,
    },
  };
}
