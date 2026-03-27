import { describe, expect, it } from "vitest";
import { buildIssueDetailHref, buildIssueCommentHref } from "../src/ui/index.js";

describe("podcast workflow UI links", () => {
  it("builds issue detail links with or without a company prefix", () => {
    expect(buildIssueDetailHref(null, "issue-123")).toBe("/issues/issue-123");
    expect(buildIssueDetailHref("ROM", "ROM-594")).toBe("/ROM/issues/ROM-594");
  });

  it("builds comment deep links against the canonical issue detail route", () => {
    expect(buildIssueCommentHref(null, "issue-123", "comment-456")).toBe("/issues/issue-123#comment-comment-456");
    expect(buildIssueCommentHref("ROM", "ROM-594", "comment-456")).toBe("/ROM/issues/ROM-594#comment-comment-456");
  });
});
