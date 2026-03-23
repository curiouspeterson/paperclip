import { describe, expect, it } from "vitest";
import { createAgentSchema } from "@paperclipai/shared";

describe("agent shared contracts", () => {
  it("accepts gemini_local as a supported adapter type", () => {
    const result = createAgentSchema.safeParse({
      name: "Gemini Agent",
      adapterType: "gemini_local",
    });

    expect(result.success).toBe(true);
  });
});
