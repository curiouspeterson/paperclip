import { existsSync } from "node:fs";
import path from "node:path";
import type { AdapterExecutionResult } from "../types.js";

export const DEFAULT_HERMES_LOCAL_MODEL = "gpt-5.4";
export const DEFAULT_HERMES_LOCAL_PROVIDER = "codex";
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

export function normalizeHermesLocalPaperclipRuntimeConfig(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const next = normalizeHermesLocalPaperclipConfig(value);
  const configuredCommand = asString(next.hermesCommand) ?? "hermes";
  const resolvedCommand = resolveHermesCommandPath(configuredCommand);
  if (resolvedCommand) {
    next.hermesCommand = resolvedCommand;
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

  if (
    /Paperclip API server/i.test(visibleText) &&
    /(not responding|connection refused|unable to connect|server appears to be down|server appears unreachable)/i.test(
      visibleText,
    )
  ) {
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
    resultJson: {
      ...(existingResultJson ?? {}),
      message: normalized.anomalyMessage,
    },
  };
}
