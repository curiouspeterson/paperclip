import { describe, expect, it } from "vitest";
import { buildHeartbeatRunIssueComment } from "../services/heartbeat-issue-comment.js";
import { buildPersistedHeartbeatResultJson } from "../services/heartbeat.ts";

describe("buildHeartbeatRunIssueComment", () => {
  it("includes provider, model, and summarized result fields when available", () => {
    const comment = buildHeartbeatRunIssueComment({
      status: "succeeded",
      usageJson: {
        provider: "zai",
        model: "glm-5",
      },
      resultJson: {
        summary: "Implemented the runtime bootstrap fix.",
        message: "Ready for review.",
      },
    });

    expect(comment).toContain("Run completed before the agent posted its structured update.");
    expect(comment).toContain("Provider: zai");
    expect(comment).toContain("Model: glm-5");
    expect(comment).toContain("Summary: Implemented the runtime bootstrap fix.");
    expect(comment).toContain("Message: Ready for review.");
  });

  it("falls back to the terminal status when no structured result is available", () => {
    const comment = buildHeartbeatRunIssueComment({
      status: "succeeded",
      resultJson: {
        stdout: "plain logs only",
      },
    });

    expect(comment).toContain("Run completed before the agent posted its structured update.");
    expect(comment).toContain("Status: succeeded");
  });

  it("prefers explicit error text for failed runs", () => {
    const comment = buildHeartbeatRunIssueComment({
      status: "failed",
      error: "Connection refused",
    });

    expect(comment).toContain("Run failed before the agent posted its structured update.");
    expect(comment).toContain("Error: Connection refused");
  });
});

describe("buildPersistedHeartbeatResultJson", () => {
  it("persists adapter summaries alongside existing result json", () => {
    expect(
      buildPersistedHeartbeatResultJson({
        exitCode: 0,
        signal: null,
        timedOut: false,
        resultJson: { stdout: "logs" },
        summary: "Implemented the bootstrap fix.",
      }),
    ).toEqual({
      stdout: "logs",
      summary: "Implemented the bootstrap fix.",
    });
  });

  it("returns null when there is no result payload to persist", () => {
    expect(
      buildPersistedHeartbeatResultJson({
        exitCode: 0,
        signal: null,
        timedOut: false,
      }),
    ).toBeNull();
  });
});
