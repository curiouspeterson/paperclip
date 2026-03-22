import { describe, expect, it } from "vitest";
import { normalizeApiBase } from "./client";

describe("normalizeApiBase", () => {
  it("defaults to same-origin /api when unset", () => {
    expect(normalizeApiBase(undefined)).toBe("/api");
    expect(normalizeApiBase("")).toBe("/api");
    expect(normalizeApiBase("   ")).toBe("/api");
  });

  it("normalizes a host origin into /api", () => {
    expect(normalizeApiBase("https://paperclip.example.com")).toBe("https://paperclip.example.com/api");
  });

  it("preserves an explicit /api base", () => {
    expect(normalizeApiBase("https://paperclip.example.com/api")).toBe("https://paperclip.example.com/api");
  });
});
