import { describe, expect, it } from "vitest";
import { normalizeAgentMentionToken } from "../services/issues.ts";

describe("normalizeAgentMentionToken", () => {
  it("strips hex numeric entities such as space (&#x20;)", () => {
    expect(normalizeAgentMentionToken("Baba&#x20;")).toBe("Baba");
  });

  it("strips decimal numeric entities", () => {
    expect(normalizeAgentMentionToken("Baba&#32;")).toBe("Baba");
  });

  it("strips common named entities", () => {
    expect(normalizeAgentMentionToken("Baba&nbsp;")).toBe("Baba");
  });

  // Greptile: entity mid-token (not only trailing) — must decode &amp; to &, not delete the sequence.
  it("decodes &amp; in the middle of a mention token", () => {
    expect(normalizeAgentMentionToken("Ba&amp;ba")).toBe("Ba&ba");
  });

  it("decodes &amp; so agent names with ampersands still match", () => {
    expect(normalizeAgentMentionToken("M&amp;M")).toBe("M&M");
  });


  it("decodes additional named entities used in rich text (e.g. &copy;)", () => {
    expect(normalizeAgentMentionToken("Agent&copy;Name")).toBe("Agent©Name");
  });

  it("leaves unknown semicolon-terminated named references unchanged", () => {
    expect(normalizeAgentMentionToken("Baba&notarealentity;")).toBe("Baba&notarealentity;");
  });


  it("returns plain names unchanged", () => {
    expect(normalizeAgentMentionToken("Baba")).toBe("Baba");
  });

  it("trims after stripping entities", () => {
    expect(normalizeAgentMentionToken("Baba&#x20;&#x20;")).toBe("Baba");
  });
});
