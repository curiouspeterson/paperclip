import { describe, expect, it } from "vitest";
import { parseCompanyHermesMcpServersInput } from "./company-hermes-mcp";

describe("parseCompanyHermesMcpServersInput", () => {
  it("returns null for blank input", () => {
    expect(parseCompanyHermesMcpServersInput("   ")).toBeNull();
  });

  it("parses a JSON object", () => {
    expect(parseCompanyHermesMcpServersInput('{"github":{"command":"npx"}}')).toEqual({
      github: { command: "npx" },
    });
  });

  it("rejects non-object JSON", () => {
    expect(() => parseCompanyHermesMcpServersInput('["github"]')).toThrow(
      "Hermes MCP servers must be a JSON object.",
    );
  });
});
