import type { AdapterEnvironmentCheck, AdapterEnvironmentTestResult } from "@paperclipai/adapter-utils";
import { renderPaperclipIssueWorkflowNote } from "@paperclipai/adapter-utils/server-utils";

const DEFAULT_HERMES_LOCAL_PROMPT_TEMPLATE = `You are "{{agentName}}", an AI agent employee in a Paperclip-managed company.

IMPORTANT: Use \`terminal\` tool with \`curl\` for ALL Paperclip API calls (web_extract and browser cannot access localhost).

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
2. When done, report the result back to Paperclip using the authenticated issue workflow below
3. If blocked, report the blocker back to Paperclip using the authenticated issue workflow below
{{/taskId}}

{{#noTask}}
## Heartbeat Wake — Check for Work

1. List issues assigned to you:
   \`curl -s "{{paperclipApiUrl}}/companies/{{companyId}}/issues?assigneeAgentId={{agentId}}&status=todo" | python3 -m json.tool\`

2. If issues found, pick the highest priority one and work on it:
   - Checkout: \`curl -s -X POST "{{paperclipApiUrl}}/issues/ISSUE_ID/checkout" -H "Authorization: Bearer $PAPERCLIP_API_KEY" -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID" -H "Content-Type: application/json" -d '{"agentId":"{{agentId}}"}'\`
   - Do the work
   - Complete with a final comment through the authenticated issue workflow below

3. If no issues found, check for any unassigned issues:
   \`curl -s "{{paperclipApiUrl}}/companies/{{companyId}}/issues?status=backlog" | python3 -m json.tool\`

4. If truly nothing to do, report briefly.
{{/noTask}}`;

const PAPERCLIP_WORKFLOW_NOTE = renderPaperclipIssueWorkflowNote({
  PAPERCLIP_API_URL: "http://127.0.0.1:3100/api",
  PAPERCLIP_API_KEY: "$PAPERCLIP_API_KEY",
});
const PAPERCLIP_STRUCTURED_RESPONSE_NOTE = `Paperclip structured response contract:

If you worked on a specific issue, your final assistant response must be exactly one JSON object and nothing else.

Use this schema:
\`\`\`json
{
  "status": "done",
  "comment_markdown": "1-3 short sentences explaining the outcome or blocker.",
  "plan_markdown": "",
  "change_summary": ""
}
\`\`\`

Rules:
- Allowed status values: "in_progress", "blocked", "done"
- Always include all four keys
- \`comment_markdown\` is required and must be non-empty
- If you updated a plan, put the full markdown in \`plan_markdown\`
- If no plan changed, set \`plan_markdown\` and \`change_summary\` to empty strings
- Emit this JSON object even if you already called the Paperclip API yourself
- If this heartbeat found no work, a short plain-text response is allowed instead`;
const ZAI_CODING_OPENAI_BASE_URL = "https://api.z.ai/api/coding/paas/v4";
const NOUS_INFERENCE_OPENAI_BASE_URL = "https://inference-api.nousresearch.com/v1";
const PAPERCLIP_DEFAULT_TERMINAL_ENV = "local";

const VALID_HERMES_PROVIDERS = new Set([
  "auto",
  "openrouter",
  "nous",
  "openai-codex",
  "zai",
  "kimi-coding",
  "minimax",
  "minimax-cn",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function buildPromptTemplate(existingPromptTemplate: unknown) {
  const base =
    typeof existingPromptTemplate === "string" && existingPromptTemplate.trim().length > 0
      ? existingPromptTemplate.trim()
      : DEFAULT_HERMES_LOCAL_PROMPT_TEMPLATE;
  const sections = [base];
  if (!base.includes("Paperclip issue workflow note:")) {
    sections.push(PAPERCLIP_WORKFLOW_NOTE.trim());
  }
  if (!base.includes("Paperclip structured response contract:")) {
    sections.push(PAPERCLIP_STRUCTURED_RESPONSE_NOTE.trim());
  }
  return sections.join("\n\n");
}

function resolvePlainEnvValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  const record = asRecord(value);
  if (!record) return null;
  return record.type === "plain" && typeof record.value === "string" && record.value.trim().length > 0
    ? record.value.trim()
    : null;
}

function normalizeHermesModelProvider(config: Record<string, unknown>) {
  const next = { ...config };
  const rawModel = asString(config.model);
  const configuredProvider = asString(config.provider);
  if (!rawModel) return next;

  const prefixed = rawModel.match(/^([a-z0-9-]+)([:/])(.+)$/i);
  const inferredProvider = prefixed?.[1]?.toLowerCase() ?? null;
  const bareModel = prefixed?.[3]?.trim() ?? null;

  if (!inferredProvider || !bareModel || !VALID_HERMES_PROVIDERS.has(inferredProvider)) {
    return next;
  }

  if (!configuredProvider) {
    next.provider = inferredProvider;
  }
  if (!configuredProvider || configuredProvider.toLowerCase() === inferredProvider) {
    next.model = bareModel;
  }
  return next;
}

function buildHermesLocalProcessEnv(config: Record<string, unknown>) {
  const env = asRecord(config.env) ?? {};
  return Object.fromEntries(
    Object.entries(env)
      .map(([key, value]) => [key, resolvePlainEnvValue(value)] as const)
      .filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

function hasEnvBinding(env: Record<string, unknown>, key: string) {
  if (!Object.prototype.hasOwnProperty.call(env, key)) return false;
  if (resolvePlainEnvValue(env[key]) != null) return true;
  const record = asRecord(env[key]);
  return record?.type === "secret_ref" && typeof record.secretId === "string" && record.secretId.trim().length > 0;
}

function extractProviderFromExtraArgs(extraArgs: unknown): string | null {
  if (!Array.isArray(extraArgs)) return null;
  for (let index = 0; index < extraArgs.length; index += 1) {
    const value = extraArgs[index];
    if (typeof value !== "string") continue;
    if (value === "--provider") {
      const next = extraArgs[index + 1];
      return typeof next === "string" && next.trim().length > 0 ? next.trim().toLowerCase() : null;
    }
    const match = value.match(/^--provider=(.+)$/i);
    if (match?.[1]) return match[1].trim().toLowerCase();
  }
  return null;
}

function stripProviderFromExtraArgs(extraArgs: unknown): string[] | undefined {
  if (!Array.isArray(extraArgs)) return undefined;
  const next: string[] = [];
  for (let index = 0; index < extraArgs.length; index += 1) {
    const value = extraArgs[index];
    if (typeof value !== "string") continue;
    if (value === "--provider") {
      index += 1;
      continue;
    }
    if (/^--provider=.+$/i.test(value)) {
      continue;
    }
    next.push(value);
  }
  return next.length > 0 ? next : undefined;
}

function resolveConfiguredProvider(config: Record<string, unknown>) {
  return asString(config.provider)?.toLowerCase() ?? extractProviderFromExtraArgs(config.extraArgs);
}

function isNousInferenceBaseUrl(value: string | null) {
  return typeof value === "string" && /inference-api\.nousresearch\.com\/v1/i.test(value);
}

function summarizeEnvironmentStatus(checks: AdapterEnvironmentTestResult["checks"]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

function stripHermesTranscriptNoise(text: string) {
  return text
    .replace(/^\s*╭─\s*⚕\s*Hermes[\s\S]*?╮\s*$/gim, "")
    .replace(/^\s*╰[\s\S]*?╯\s*$/gim, "")
    .replace(/<tool_call>\s*[\s\S]*?(?:<\/tool_call>|$)/gi, "\n")
    .replace(/<tool_response>\s*[\s\S]*?(?:<\/tool_response>|$)/gi, "\n")
    .replace(/<tool_result>\s*[\s\S]*?(?:<\/tool_result>|$)/gi, "\n")
    .replace(/^\s*<\/?(?:tool_call|tool_response|tool_result)>\s*$/gim, "")
    .trim();
}

export function normalizeHermesLocalExecutionSummary(value: unknown): {
  summary: string | null;
  anomalyMessage: string | null;
} {
  const raw = asString(value);
  if (!raw) {
    return { summary: null, anomalyMessage: null };
  }

  const normalized = stripHermesTranscriptNoise(raw);
  if (normalized) {
    return { summary: normalized, anomalyMessage: null };
  }

  const hadToolTranscript = /<tool_call>|<tool_response>|<tool_result>/i.test(raw);
  if (!hadToolTranscript) {
    return { summary: raw, anomalyMessage: null };
  }

  return {
    summary: null,
    anomalyMessage: "Hermes returned tool-call transcript output without a final assistant completion.",
  };
}

export function prepareHermesLocalExecutionConfig(
  config: Record<string, unknown>,
  options: { authToken?: string | null },
): Record<string, unknown> {
  const next = normalizeHermesModelProvider(config);
  const env = { ...(asRecord(next.env) ?? {}) };
  const inferredProvider = resolveConfiguredProvider(next);
  if (!asString(next.provider) && inferredProvider) {
    next.provider = inferredProvider;
  }
  let provider = asString(next.provider)?.toLowerCase() ?? inferredProvider ?? null;
  if (
    options.authToken
    && typeof env.PAPERCLIP_API_KEY !== "string"
    && !(
      asRecord(env.PAPERCLIP_API_KEY)?.type === "plain"
      && typeof asRecord(env.PAPERCLIP_API_KEY)?.value === "string"
    )
  ) {
    env.PAPERCLIP_API_KEY = options.authToken;
  }
  if (
    provider === "nous"
    && hasEnvBinding(env, "NOUS_API_KEY")
  ) {
    if (!hasEnvBinding(env, "OPENAI_API_KEY")) {
      env.OPENAI_API_KEY = env.NOUS_API_KEY;
    }
    if (resolvePlainEnvValue(env.OPENAI_BASE_URL) == null) {
      env.OPENAI_BASE_URL = NOUS_INFERENCE_OPENAI_BASE_URL;
    }
    if (resolvePlainEnvValue(env.HERMES_INFERENCE_PROVIDER) == null) {
      env.HERMES_INFERENCE_PROVIDER = "custom";
    }
    const strippedArgs = stripProviderFromExtraArgs(next.extraArgs);
    if (strippedArgs) {
      next.extraArgs = strippedArgs;
    } else {
      delete next.extraArgs;
    }
    next.provider = "custom";
    provider = "custom";
  }
  if (
    provider === "zai"
    && resolvePlainEnvValue(env.OPENAI_BASE_URL) == null
  ) {
    env.OPENAI_BASE_URL = ZAI_CODING_OPENAI_BASE_URL;
  }
  if (resolvePlainEnvValue(env.TERMINAL_ENV) == null) {
    env.TERMINAL_ENV = PAPERCLIP_DEFAULT_TERMINAL_ENV;
  }
  if (Object.keys(env).length > 0) {
    next.env = env;
  }
  next.promptTemplate = buildPromptTemplate(config.promptTemplate);
  return next;
}

export async function withHermesLocalProcessEnv<T>(
  config: Record<string, unknown>,
  run: () => Promise<T>,
): Promise<T> {
  const envPatch = buildHermesLocalProcessEnv(config);
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(envPatch)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

export function finalizeHermesLocalEnvironmentTestResult(
  config: Record<string, unknown>,
  result: AdapterEnvironmentTestResult,
): AdapterEnvironmentTestResult {
  const runtimeEnv = buildHermesLocalProcessEnv(config);
  const provider = resolveConfiguredProvider(config);
  const hasZaiKey = typeof runtimeEnv.ZAI_API_KEY === "string" && runtimeEnv.ZAI_API_KEY.length > 0;
  const hasNousKey = typeof runtimeEnv.NOUS_API_KEY === "string" && runtimeEnv.NOUS_API_KEY.length > 0;
  const nousApiMode =
    hasNousKey
    && (
      provider === "nous"
      || (
        runtimeEnv.HERMES_INFERENCE_PROVIDER?.toLowerCase() === "custom"
        && isNousInferenceBaseUrl(runtimeEnv.OPENAI_BASE_URL ?? null)
      )
    );

  if (!hasZaiKey && !nousApiMode) {
    return result;
  }

  const providerSpecificMessage = nousApiMode
    ? "API keys found: Nous Research (NOUS_API_KEY)"
    : "API keys found: Z.AI (ZAI_API_KEY)";
  const filteredChecks = result.checks
    .filter((check) => check.code !== "hermes_no_api_keys")
    .map((check) =>
      check.code === "hermes_api_keys_found"
        ? {
            ...check,
            message: providerSpecificMessage,
          }
        : check,
    );
  const checks: AdapterEnvironmentCheck[] = filteredChecks.some((check) => check.code === "hermes_api_keys_found")
    ? filteredChecks
    : [
        ...filteredChecks,
        {
          code: "hermes_api_keys_found",
          level: "info",
          message: providerSpecificMessage,
        },
      ];

  return {
    ...result,
    status: summarizeEnvironmentStatus(checks),
    checks,
  };
}
