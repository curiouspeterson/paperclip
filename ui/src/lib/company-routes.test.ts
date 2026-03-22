import { describe, expect, it } from "vitest";
import {
  applyCompanyPrefix,
  extractCompanyPrefixFromPath,
  toCompanyRelativePath,
} from "./company-routes";

describe("company route helpers", () => {
  it("treats content pages as board routes instead of company prefixes", () => {
    expect(extractCompanyPrefixFromPath("/content/0c4deb2f-fe82-424c-aa79-5523f3b58eff")).toBeNull();
    expect(applyCompanyPrefix("/content/0c4deb2f-fe82-424c-aa79-5523f3b58eff", "ROM")).toBe(
      "/ROM/content/0c4deb2f-fe82-424c-aa79-5523f3b58eff",
    );
    expect(toCompanyRelativePath("/ROM/content/0c4deb2f-fe82-424c-aa79-5523f3b58eff")).toBe(
      "/content/0c4deb2f-fe82-424c-aa79-5523f3b58eff",
    );
  });

  it("keeps podcast ops and test routes in the board-route allowlist", () => {
    expect(extractCompanyPrefixFromPath("/podcast-ops/episode-123")).toBeNull();
    expect(applyCompanyPrefix("/podcast-ops/episode-123", "ROM")).toBe("/ROM/podcast-ops/episode-123");
    expect(toCompanyRelativePath("/ROM/tests/ux/runs")).toBe("/tests/ux/runs");
  });
});
