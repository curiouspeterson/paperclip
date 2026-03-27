import { describe, expect, it } from "vitest";
import type { AdapterExecutionResult } from "../adapters/index.js";
import {
  buildHeartbeatIssueCompletionComment,
  buildPersistedHeartbeatResultJson,
  resolveHeartbeatRunOutcome,
} from "../services/heartbeat-run-policy.js";

function makeResult(overrides: Partial<AdapterExecutionResult> = {}): AdapterExecutionResult {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    summary: null,
    resultJson: null,
    ...overrides,
  };
}

describe("heartbeat run policy", () => {
  it("treats adapter error codes as failures even when exit code is zero", () => {
    expect(
      resolveHeartbeatRunOutcome({
        latestRunStatus: "running",
        adapterResult: makeResult({
          errorCode: "provider_auth_required",
          summary: "Hermes is not logged into Nous Portal.",
        }),
      }),
    ).toBe("failed");
  });

  it("persists run summaries even when the adapter does not provide resultJson", () => {
    expect(
      buildPersistedHeartbeatResultJson(
        makeResult({
          summary: "Completed work.",
        }),
      ),
    ).toEqual({
      summary: "Completed work.",
    });
  });

  it("merges adapter summaries and errors into existing resultJson without discarding fields", () => {
    expect(
      buildPersistedHeartbeatResultJson(
        makeResult({
          summary: "Paperclip API server is not responding.",
          errorMessage: "Paperclip API server is not responding.",
          resultJson: {
            provider: "codex",
          },
        }),
      ),
    ).toEqual({
      provider: "codex",
      summary: "Paperclip API server is not responding.",
      message: "Paperclip API server is not responding.",
      error: "Paperclip API server is not responding.",
    });
  });

  it("builds a completion comment that carries the run outcome and summary", () => {
    expect(
      buildHeartbeatIssueCompletionComment({
        runId: "12345678-1234-4123-8123-123456789abc",
        status: "failed",
        error: "Paperclip API server is not responding.",
        resultJson: {
          summary: "Paperclip API server is not responding.",
        },
      }),
    ).toBe(
      [
        "Run `12345678` failed.",
        "",
        "Summary: Paperclip API server is not responding.",
        "Error: Paperclip API server is not responding.",
      ].join("\n"),
    );
  });
});
