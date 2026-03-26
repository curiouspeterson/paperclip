import type { Agent } from "@paperclipai/shared";
import type { HeartbeatInvokeResult } from "../api/agents";
import type { ToastInput } from "../context/ToastContext";

export type BulkHeartbeatMode = "all-hands" | "boo";

export interface BulkHeartbeatSummary {
  startedCount: number;
  skippedCount: number;
  failedCount: number;
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function isBlockedFromAnyBulkHeartbeat(agent: Agent) {
  return agent.status === "terminated" || agent.status === "pending_approval";
}

function isSkippedInvokeResult(result: HeartbeatInvokeResult) {
  return !("id" in result) && result.status === "skipped";
}

export function selectAgentsForBulkHeartbeat(agents: Agent[]): Agent[] {
  return agents.filter(
    (agent) => !isBlockedFromAnyBulkHeartbeat(agent) && agent.status !== "paused",
  );
}

export function selectAgentsForBoo(agents: Agent[]): Agent[] {
  return agents.filter((agent) => !isBlockedFromAnyBulkHeartbeat(agent));
}

export function summarizeBulkHeartbeatResults(
  results: PromiseSettledResult<HeartbeatInvokeResult>[],
): BulkHeartbeatSummary {
  let startedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const result of results) {
    if (result.status === "rejected") {
      failedCount += 1;
      continue;
    }
    if (isSkippedInvokeResult(result.value)) {
      skippedCount += 1;
      continue;
    }
    startedCount += 1;
  }

  return { startedCount, skippedCount, failedCount };
}

export function formatBulkHeartbeatToast(
  mode: BulkHeartbeatMode,
  summary: BulkHeartbeatSummary,
): Pick<ToastInput, "title" | "body" | "tone"> {
  const title = mode === "all-hands" ? "All Hands Heartbeat started" : "BOO! started";
  const segments: string[] = [];
  const tone = summary.failedCount > 0 || summary.skippedCount > 0 ? "warn" : "success";

  if (summary.startedCount > 0) {
    segments.push(`Started ${pluralize(summary.startedCount, "heartbeat")}.`);
  } else {
    segments.push("No heartbeats started.");
  }
  if (summary.skippedCount > 0) {
    segments.push(`${pluralize(summary.skippedCount, "skipped", "skipped")}.`);
  }
  if (summary.failedCount > 0) {
    segments.push(`${pluralize(summary.failedCount, "failed", "failed")}.`);
  }

  return {
    title,
    body: segments.join(" "),
    tone,
  };
}
