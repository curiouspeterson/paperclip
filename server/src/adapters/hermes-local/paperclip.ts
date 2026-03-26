import type { AdapterExecutionResult } from "../types.js";

export const HERMES_TOOL_ONLY_EXIT_MESSAGE =
  "Hermes returned tool-call transcript output without a final assistant completion.";

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
    anomalyMessage: HERMES_TOOL_ONLY_EXIT_MESSAGE,
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
    errorCode: result.errorCode ?? "incomplete_assistant_completion",
    resultJson: {
      ...(existingResultJson ?? {}),
      message: normalized.anomalyMessage,
    },
  };
}
