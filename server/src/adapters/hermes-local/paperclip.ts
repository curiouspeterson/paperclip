import { existsSync } from "node:fs";
import path from "node:path";
import type { AdapterExecutionResult } from "../types.js";
import { prepareManagedHermesHome } from "./hermes-home.js";

export const DEFAULT_HERMES_LOCAL_MODEL = "gpt-5.4";
export const DEFAULT_HERMES_LOCAL_PROVIDER = "codex";
export const DEFAULT_HERMES_LOCAL_CLI_PROVIDER = "openai-codex";
export const DEFAULT_HERMES_LOCAL_TOOLSETS = [
  "terminal",
  "file",
  "web",
  "skills",
  "code_execution",
  "delegation",
  "memory",
  "session_search",
  "todo",
  "clarify",
] as const;
export const DEFAULT_HERMES_LOCAL_PROMPT_TEMPLATE = `You are "{{agentName}}", an AI agent employee in a Paperclip-managed company.

IMPORTANT: Use the \`code_execution\` tool for ALL Paperclip API calls.
Do NOT use terminal curl commands against localhost Paperclip URLs in this environment.

Inside \`code_execution\`, use Python and the \`PAPERCLIP_API_URL\` environment variable. This helper is safe to reuse:

\`\`\`python
import json
import os
import urllib.parse
import urllib.request

BASE = os.environ["PAPERCLIP_API_URL"].rstrip("/")

def paperclip_request(method: str, path: str, payload=None):
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(f"{BASE}{path}", data=body, method=method)
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req) as resp:
        raw = resp.read().decode("utf-8")
    return json.loads(raw) if raw else None
\`\`\`

Your Paperclip identity:
  Agent ID: {{agentId}}
  Company ID: {{companyId}}
  API Base: {{paperclipApiUrl}}

{{#taskId}}
## Assigned Task

Issue ID: {{taskId}}
Title: {{taskTitle}}

{{taskBody}}

## Workflow

1. Work on the task using your tools
2. When done, mark the issue as completed using \`code_execution\`:
   \`\`\`python
   paperclip_request("PATCH", "/issues/{{taskId}}", {"status": "done"})
   \`\`\`
3. Report what you did
{{/taskId}}

{{#noTask}}
## Heartbeat Wake — Check for Work

1. List issues assigned to you using \`code_execution\`:
   \`\`\`python
   from urllib.parse import urlencode
   assigned = paperclip_request(
       "GET",
       f"/companies/{{companyId}}/issues?{urlencode({'assigneeAgentId': '{{agentId}}', 'status': 'todo,in_progress'})}",
   )
   print(json.dumps(assigned, indent=2))
   \`\`\`

2. If issues are found, prioritize any issue already in \`in_progress\` before starting new backlog work.
   - For the chosen issue, load the full heartbeat context first:
     \`\`\`python
     context = paperclip_request("GET", "/issues/ISSUE_ID/heartbeat-context")
     print(json.dumps(context, indent=2))
     \`\`\`
   - If the issue is still in \`todo\`, checkout before you start:
     \`\`\`python
     paperclip_request("POST", "/issues/ISSUE_ID/checkout", {"agentId": "{{agentId}}"})
     \`\`\`
   - If the issue is already in \`in_progress\`, continue the assigned work directly. Do not skip it just because it is already started.
   - Do the work
   - Complete using \`code_execution\`:
     \`\`\`python
     paperclip_request("PATCH", "/issues/ISSUE_ID", {"status": "done"})
     \`\`\`

3. Only if no assigned \`todo\` or \`in_progress\` issues exist, check for any unassigned backlog issues:
   \`\`\`python
   from urllib.parse import urlencode
   backlog = paperclip_request(
       "GET",
       f"/companies/{{companyId}}/issues?{urlencode({'status': 'backlog'})}",
   )
   print(json.dumps(backlog, indent=2))
   \`\`\`

4. If truly nothing is available, report briefly.
{{/noTask}}`;
export const HERMES_TOOL_ONLY_EXIT_MESSAGE =
  "Hermes returned tool-call transcript output without a final assistant completion.";
export const HERMES_PROVIDER_AUTH_REQUIRED_CODE = "provider_auth_required";
export const HERMES_PAPERCLIP_UNREACHABLE_CODE = "paperclip_unreachable";

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function stripHermesTranscriptNoise(text: string): string {
  return text
    .replace(/^\s*╭─\s*⚕\s*Hermes[\s\S]*?╮\s*$/gim, "")
    .replace(/^\s*╰[\s\S]*?╯\s*$/gim, "")
    .replace(/<tool_call>\s*[\s\S]*?(?:<\/tool_call>|$)/gi, "\n")
    .replace(/<tool_response>\s*[\s\S]*?(?:<\/tool_response>|$)/gi, "\n")
    .replace(/<tool_result>\s*[\s\S]*?(?:<\/tool_result>|$)/gi, "\n")
    .replace(/^\s*<\/?(?:tool_call|tool_response|tool_result)>\s*$/gim, "")
    .trim();
}

function isPaperclipConnectivityFailure(text: string): boolean {
  const mentionsPaperclip = /paperclip/i.test(text);
  const mentionsApi = /\bapi\b|\/api\b/i.test(text);
  const mentionsLocalRuntime = /\blocalhost(?::\d+)?\b|127\.0\.0\.1(?::\d+)?|http:\/\/127\.0\.0\.1(?::\d+)?/i.test(
    text,
  );
  const mentionsConnectionFailure =
    /not responding|did not respond|not reachable|unreachable|connection refused|unable to connect|could not connect|failed to connect|not running|appears to be down|appears unavailable|appears unreachable|did not accept the connection/i.test(
      text,
    ) || /curl (?:exit code|exited with code|returned exit code|exit)\s*:?\s*7\b|exit code:\s*7\b/i.test(text);

  return (mentionsPaperclip || mentionsLocalRuntime) && mentionsApi && mentionsConnectionFailure;
}

export function normalizeHermesLocalPaperclipConfig(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const next = value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
  next.model = DEFAULT_HERMES_LOCAL_MODEL;
  next.provider = DEFAULT_HERMES_LOCAL_PROVIDER;
  return next;
}

function pathKey(env: NodeJS.ProcessEnv): "PATH" | "Path" {
  return typeof env.PATH === "string" ? "PATH" : "Path";
}

function uniquePathEntries(entries: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of entries) {
    if (!entry) continue;
    if (seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out;
}

function candidateHermesSearchPaths(env: NodeJS.ProcessEnv): string[] {
  const home = asString(env.HOME);
  const delimiter = process.platform === "win32" ? ";" : ":";
  const pathValue = env[pathKey(env)] ?? "";
  const envPaths = pathValue.split(delimiter).filter(Boolean);
  const preferredPaths = home
    ? [path.join(home, ".local", "bin"), path.join(home, "bin")]
    : [];
  return uniquePathEntries([...preferredPaths, ...envPaths]);
}

function resolveHermesCommandPath(command: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!command.trim()) return null;

  if (command.includes("/") || command.includes("\\")) {
    const absolute = path.isAbsolute(command) ? command : path.resolve(command);
    return existsSync(absolute) ? absolute : null;
  }

  const exts =
    process.platform === "win32"
      ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
      : [""];
  const hasExtension = process.platform === "win32" && path.extname(command).length > 0;

  for (const dir of candidateHermesSearchPaths(env)) {
    const candidates =
      process.platform === "win32"
        ? hasExtension
          ? [path.join(dir, command)]
          : exts.map((ext) => path.join(dir, `${command}${ext}`))
        : [path.join(dir, command)];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
  }

  return null;
}

export async function normalizeHermesLocalPaperclipRuntimeConfig(
  value: Record<string, unknown> | null | undefined,
  options: {
    companyId: string;
    agentId?: string | null;
    env?: NodeJS.ProcessEnv;
    onLog?: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
  },
): Promise<Record<string, unknown>> {
  const next = normalizeHermesLocalPaperclipConfig(value);
  next.provider = DEFAULT_HERMES_LOCAL_CLI_PROVIDER;
  const configuredCommand = asString(next.hermesCommand) ?? "hermes";
  const resolvedCommand = resolveHermesCommandPath(configuredCommand);
  if (resolvedCommand) {
    next.hermesCommand = resolvedCommand;
  }

  const existingEnv: Record<string, unknown> =
    next.env && typeof next.env === "object" && !Array.isArray(next.env)
      ? { ...next.env }
      : {};
  const runtimeEnv = options.env ?? process.env;
  const configuredHermesHome =
    typeof existingEnv.HERMES_HOME === "string" && existingEnv.HERMES_HOME.trim().length > 0
      ? path.resolve(existingEnv.HERMES_HOME.trim())
      : null;
  if (configuredHermesHome) {
    existingEnv.HERMES_HOME = configuredHermesHome;
  } else if (next.paperclipManagedHermesHome !== false) {
    existingEnv.HERMES_HOME = await prepareManagedHermesHome(runtimeEnv, {
      companyId: options.companyId,
      agentId: options.agentId,
      onLog: options.onLog,
    });
  }

  next.env = {
    ...existingEnv,
    TERMINAL_ENV: "local",
  };
  if (asString(next.toolsets) === null && !Array.isArray(next.enabledToolsets)) {
    next.toolsets = DEFAULT_HERMES_LOCAL_TOOLSETS.join(",");
  }
  if (asString(next.promptTemplate) === null) {
    next.promptTemplate = DEFAULT_HERMES_LOCAL_PROMPT_TEMPLATE;
  }
  return next;
}

export function normalizeHermesLocalExecutionSummary(value: unknown): {
  summary: string | null;
  anomalyMessage: string | null;
  anomalyCode: string | null;
} {
  const raw = asString(value);
  if (!raw) {
    return { summary: null, anomalyMessage: null, anomalyCode: null };
  }

  const normalized = stripHermesTranscriptNoise(raw);
  const hadToolTranscript = /<tool_call>|<tool_response>|<tool_result>/i.test(raw);
  const visibleText = normalized || raw;

  if (/Hermes is not logged into Nous Portal\./i.test(visibleText)) {
    return {
      summary: visibleText,
      anomalyMessage: visibleText,
      anomalyCode: HERMES_PROVIDER_AUTH_REQUIRED_CODE,
    };
  }

  if (isPaperclipConnectivityFailure(visibleText)) {
    return {
      summary: visibleText,
      anomalyMessage: visibleText,
      anomalyCode: HERMES_PAPERCLIP_UNREACHABLE_CODE,
    };
  }

  if (normalized) {
    return { summary: normalized, anomalyMessage: null, anomalyCode: null };
  }

  if (!hadToolTranscript) {
    return { summary: raw, anomalyMessage: null, anomalyCode: null };
  }

  return {
    summary: null,
    anomalyMessage: HERMES_TOOL_ONLY_EXIT_MESSAGE,
    anomalyCode: "incomplete_assistant_completion",
  };
}

export function normalizeHermesLocalExecutionResult(
  result: AdapterExecutionResult,
): AdapterExecutionResult {
  const normalized = normalizeHermesLocalExecutionSummary(result.summary);
  if (normalized.summary === null && normalized.anomalyMessage === null) {
    return result;
  }

  const next: AdapterExecutionResult = {
    ...result,
    summary: normalized.summary,
  };

  if (!normalized.anomalyMessage) {
    return next;
  }

  const existingResultJson =
    result.resultJson && typeof result.resultJson === "object" && !Array.isArray(result.resultJson)
      ? result.resultJson
      : null;

  return {
    ...next,
    errorMessage: result.errorMessage ?? normalized.anomalyMessage,
    errorCode: result.errorCode ?? normalized.anomalyCode ?? "incomplete_assistant_completion",
    clearSession:
      result.clearSession === true ||
      normalized.anomalyCode === HERMES_PAPERCLIP_UNREACHABLE_CODE,
    resultJson: {
      ...(existingResultJson ?? {}),
      message: normalized.anomalyMessage,
    },
  };
}
