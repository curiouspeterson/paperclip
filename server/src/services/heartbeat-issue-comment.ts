import { summarizeHeartbeatRunResultJson } from "./heartbeat-run-summary.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function buildIntro(status: string) {
  switch (status) {
    case "succeeded":
      return "Run completed before the agent posted its structured update.";
    case "failed":
      return "Run failed before the agent posted its structured update.";
    case "timed_out":
      return "Run timed out before the agent posted its structured update.";
    case "cancelled":
      return "Run was cancelled before the agent posted its structured update.";
    default:
      return "Run ended before the agent posted its structured update.";
  }
}

export function buildHeartbeatRunIssueComment(input: {
  status: string;
  error?: string | null;
  resultJson?: unknown;
  usageJson?: unknown;
}) {
  const summarizedResult = summarizeHeartbeatRunResultJson(asRecord(input.resultJson));
  const usage = asRecord(input.usageJson);
  const provider = asString(usage?.provider);
  const model = asString(usage?.model);
  const summary = asString(summarizedResult?.summary);
  const message = asString(summarizedResult?.message);
  const result = asString(summarizedResult?.result);
  const error = asString(summarizedResult?.error) ?? asString(input.error);

  const lines = [buildIntro(input.status), ""];
  if (provider) lines.push(`Provider: ${provider}`);
  if (model) lines.push(`Model: ${model}`);
  if (provider || model) lines.push("");
  if (summary) lines.push(`Summary: ${summary}`);
  if (message && message !== summary) lines.push(`Message: ${message}`);
  if (result && result !== summary && result !== message) lines.push(`Result: ${result}`);
  if (error) lines.push(`Error: ${error}`);
  if (!summary && !message && !result && !error) {
    lines.push(`Status: ${input.status}`);
  }

  return lines.join("\n").trim();
}
