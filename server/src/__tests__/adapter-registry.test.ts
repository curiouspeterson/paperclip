import { describe, expect, it } from "vitest";
import { findServerAdapter, getServerAdapter } from "../adapters/index.js";

describe("server adapter registry", () => {
  it("exposes gemini_local as a first-class adapter", () => {
    const adapter = findServerAdapter("gemini_local");
    expect(adapter?.type).toBe("gemini_local");
  });

  it("fails closed for unknown adapter types", () => {
    expect(() => getServerAdapter("unknown_adapter")).toThrowError(
      "Unsupported adapter type: unknown_adapter",
    );
  });
});
