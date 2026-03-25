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
const ZAI_CODING_OPENAI_BASE_URL = "https://api.z.ai/api/coding/paas/v4";

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
  if (base.includes("Paperclip issue workflow note:")) {
    return base;
  }
  return `${base}\n\n${PAPERCLIP_WORKFLOW_NOTE.trim()}`;
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

function summarizeEnvironmentStatus(checks: AdapterEnvironmentTestResult["checks"]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

export function prepareHermesLocalExecutionConfig(
  config: Record<string, unknown>,
  options: { authToken?: string | null },
): Record<string, unknown> {
  const next = normalizeHermesModelProvider(config);
  const env = { ...(asRecord(config.env) ?? {}) };
  const provider = asString(next.provider)?.toLowerCase() ?? null;
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
    provider === "zai"
    && resolvePlainEnvValue(env.OPENAI_BASE_URL) == null
  ) {
    env.OPENAI_BASE_URL = ZAI_CODING_OPENAI_BASE_URL;
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
  const provider = asString(config.provider)?.toLowerCase() ?? null;
  const hasZaiKey = typeof runtimeEnv.ZAI_API_KEY === "string" && runtimeEnv.ZAI_API_KEY.length > 0;

  if (!hasZaiKey || provider !== "zai") {
    return result;
  }

  const filteredChecks = result.checks.filter((check) => check.code !== "hermes_no_api_keys");
  const checks: AdapterEnvironmentCheck[] = filteredChecks.some((check) => check.code === "hermes_api_keys_found")
    ? filteredChecks
    : [
        ...filteredChecks,
        {
          code: "hermes_api_keys_found",
          level: "info",
          message: "API keys found: Z.AI (ZAI_API_KEY)",
        },
      ];

  return {
    ...result,
    status: summarizeEnvironmentStatus(checks),
    checks,
  };
}
