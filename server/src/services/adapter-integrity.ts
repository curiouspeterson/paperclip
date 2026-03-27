import { listUnsupportedAgentAdapterTypes } from "@paperclipai/db";

export async function warnOnUnsupportedAgentAdapterTypes(
  connectionString: string,
  log: { warn: (payload: Record<string, unknown>, message: string) => void },
): Promise<{ affectedAgentCount: number; invalidAdapterTypes: Array<{ adapterType: string; count: number }> }> {
  const invalidAdapterTypes = await listUnsupportedAgentAdapterTypes(connectionString);
  const affectedAgentCount = invalidAdapterTypes.reduce((sum, entry) => sum + entry.count, 0);

  if (affectedAgentCount > 0) {
    log.warn(
      {
        affectedAgentCount,
        invalidAdapterTypes,
      },
      "found legacy agents with unsupported adapter types; repair stale rows to a supported adapter",
    );
  }

  return {
    affectedAgentCount,
    invalidAdapterTypes,
  };
}
