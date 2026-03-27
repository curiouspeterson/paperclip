import { describe, expect, it } from "vitest";
import { getUIAdapter } from "./registry";

describe("ui adapter registry", () => {
  it("exposes gemini_local as a first-class adapter", () => {
    expect(getUIAdapter("gemini_local").type).toBe("gemini_local");
  });

  it("exposes hermes_local as a first-class adapter", () => {
    expect(getUIAdapter("hermes_local").type).toBe("hermes_local");
  });

  it("returns an explicit unsupported adapter for unknown types", () => {
    const adapter = getUIAdapter("unknown_adapter");
    expect(adapter.type).toBe("unsupported");
    expect(adapter.label).toBe("Unsupported Adapter");
  });
});
