import postgres from "postgres";
import { AGENT_ADAPTER_TYPES } from "@paperclipai/shared";

export type UnsupportedAgentAdapterTypeSummary = {
  adapterType: string;
  count: number;
};

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export async function listUnsupportedAgentAdapterTypes(
  connectionString: string,
): Promise<UnsupportedAgentAdapterTypeSummary[]> {
  const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
  const supportedList = AGENT_ADAPTER_TYPES.map((value) => quoteLiteral(value)).join(", ");

  try {
    const rows = await sql.unsafe<Array<{ adapter_type: string; count: number }>>(`
      SELECT "adapter_type", count(*)::int AS count
      FROM "agents"
      WHERE "adapter_type" NOT IN (${supportedList})
      GROUP BY "adapter_type"
      ORDER BY count(*) DESC, "adapter_type" ASC
    `);

    return rows
      .filter((row) => typeof row.adapter_type === "string" && row.adapter_type.length > 0)
      .map((row) => ({
        adapterType: row.adapter_type,
        count: Number(row.count ?? 0),
      }));
  } catch (err) {
    const code =
      typeof err === "object" && err && "code" in err
        ? String((err as { code?: unknown }).code)
        : null;
    if (code === "42P01") {
      return [];
    }
    throw err;
  } finally {
    await sql.end();
  }
}
