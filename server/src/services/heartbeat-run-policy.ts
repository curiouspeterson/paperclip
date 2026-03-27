import type { AdapterExecutionResult } from "../adapters/index.js";
import { summarizeHeartbeatRunResultJson } from "./heartbeat-run-summary.js";

export type HeartbeatRunOutcome = "succeeded" | "failed" | "cancelled" | "timed_out";
export type HeartbeatRunFinalStatus = HeartbeatRunOutcome;

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asResultObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : null;
}

export function resolveHeartbeatRunOutcome(input: {
  latestRunStatus: string | null | undefined;
  adapterResult: AdapterExecutionResult;
}): HeartbeatRunOutcome {
  if (input.latestRunStatus === "cancelled") {
    return "cancelled";
  }
  if (input.adapterResult.timedOut) {
    return "timed_out";
  }
  if (asNonEmptyString(input.adapterResult.errorMessage) || asNonEmptyString(input.adapterResult.errorCode)) {
    return "failed";
  }
  return (input.adapterResult.exitCode ?? 0) === 0 ? "succeeded" : "failed";
}

export function buildPersistedHeartbeatResultJson(
  adapterResult: AdapterExecutionResult,
): Record<string, unknown> | null {
  const resultJson = asResultObject(adapterResult.resultJson) ?? {};
  const summary = asNonEmptyString(adapterResult.summary);
  const errorMessage = asNonEmptyString(adapterResult.errorMessage);

  if (summary && !asNonEmptyString(resultJson.summary)) {
    resultJson.summary = summary;
  }
  if (errorMessage && !asNonEmptyString(resultJson.message)) {
    resultJson.message = errorMessage;
  }
  if (errorMessage && !asNonEmptyString(resultJson.error)) {
    resultJson.error = errorMessage;
  }

  return Object.keys(resultJson).length > 0 ? resultJson : null;
}

function describeStatus(status: HeartbeatRunFinalStatus) {
  switch (status) {
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "timed_out":
      return "timed out";
    case "cancelled":
      return "was cancelled";
  }
}

function readSummaryLine(summary: Record<string, unknown> | null) {
  return (
    asNonEmptyString(summary?.summary) ??
    asNonEmptyString(summary?.result) ??
    asNonEmptyString(summary?.message)
  );
}

export function buildHeartbeatIssueCompletionComment(input: {
  runId: string;
  status: HeartbeatRunFinalStatus;
  error: string | null;
  resultJson: Record<string, unknown> | null | undefined;
}): string | null {
  const summary = summarizeHeartbeatRunResultJson(input.resultJson);
  const summaryLine = readSummaryLine(summary);
  const errorLine = asNonEmptyString(input.error) ?? asNonEmptyString(summary?.error);
  const lines = [`Run \`${input.runId.slice(0, 8)}\` ${describeStatus(input.status)}.`];

  if (summaryLine) {
    lines.push("", `Summary: ${summaryLine}`);
  }
  if (errorLine) {
    lines.push(`Error: ${errorLine}`);
  }

  return lines.join("\n");
}
