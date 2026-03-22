import type { Agent } from "@paperclipai/shared";
import type { ToastInput } from "../context/ToastContext";

export type BulkHeartbeatMode = "all-hands" | "boo";

export function selectAgentsForBulkHeartbeat(agents: Agent[]): Agent[] {
  return agents.filter((agent) => agent.status !== "terminated" && agent.status !== "paused");
}

export function selectAgentsForBoo(agents: Agent[]): Agent[] {
  return agents.filter((agent) => agent.status !== "terminated");
}

export function formatBulkHeartbeatToast(
  mode: BulkHeartbeatMode,
  startedCount: number,
  failedCount: number,
): Pick<ToastInput, "title" | "body" | "tone"> {
  const title = mode === "all-hands" ? "All Hands Heartbeat started" : "BOO! started";
  const body =
    failedCount > 0
      ? `Started ${startedCount} heartbeats. ${failedCount} failed.`
      : `Started ${startedCount} heartbeats.`;
  return {
    title,
    body,
    tone: failedCount > 0 ? "warn" : "success",
  };
}
