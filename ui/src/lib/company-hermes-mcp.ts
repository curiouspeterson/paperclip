export function parseCompanyHermesMcpServersInput(input: string): Record<string, unknown> | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const parsed = JSON.parse(trimmed);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Hermes MCP servers must be a JSON object.");
  }

  return parsed as Record<string, unknown>;
}
