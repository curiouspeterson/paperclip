import { AGENT_ADAPTER_TYPES } from "@paperclipai/shared";
import { listUnsupportedAgentAdapterTypes } from "@paperclipai/db";
import type { PaperclipConfig } from "../config/schema.js";
import type { CheckResult } from "./index.js";

function formatUnsupportedTypes(types: Array<{ adapterType: string; count: number }>): string {
  return types.map((entry) => `${entry.adapterType} (${entry.count})`).join(", ");
}

export async function agentAdapterIntegrityCheck(config: PaperclipConfig): Promise<CheckResult> {
  if (config.database.mode !== "postgres") {
    return {
      name: "Agent adapter integrity",
      status: "pass",
      message: "Embedded PostgreSQL integrity audit runs after the server starts",
    };
  }

  if (!config.database.connectionString) {
    return {
      name: "Agent adapter integrity",
      status: "fail",
      message: "PostgreSQL mode selected but no connection string configured",
      canRepair: false,
      repairHint: "Run `paperclipai configure --section database`",
    };
  }

  const unsupported = await listUnsupportedAgentAdapterTypes(config.database.connectionString);
  if (unsupported.length === 0) {
    return {
      name: "Agent adapter integrity",
      status: "pass",
      message: "All persisted agents use supported adapter types",
    };
  }

  const total = unsupported.reduce((sum, entry) => sum + entry.count, 0);
  return {
    name: "Agent adapter integrity",
    status: "warn",
    message:
      `Found ${total} persisted agent${total === 1 ? "" : "s"} with unsupported adapter types: ` +
      `${formatUnsupportedTypes(unsupported)}`,
    canRepair: false,
    repairHint: `Update stale agent adapter types to one of: ${AGENT_ADAPTER_TYPES.join(", ")}`,
  };
}
