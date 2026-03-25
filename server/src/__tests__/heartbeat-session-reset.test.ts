import { describe, expect, it } from "vitest";
import {
  shouldResetHermesSessionForConfigDrift,
  shouldResetTaskSessionForWake,
} from "../services/heartbeat.ts";

describe("heartbeat session reset policy", () => {
  it("forces fresh sessions for issue assignment wakes", () => {
    expect(
      shouldResetTaskSessionForWake({
        wakeReason: "issue_assigned",
      }),
    ).toBe(true);
  });

  it("forces fresh Hermes sessions when the agent config changed after the active runtime", () => {
    expect(
      shouldResetHermesSessionForConfigDrift({
        agent: {
          adapterType: "hermes_local",
          updatedAt: new Date("2026-03-25T17:05:52.000Z"),
        },
        runtimeState: {
          sessionId: "20260325_082401_d54098",
          updatedAt: new Date("2026-03-25T16:56:40.000Z"),
        },
      }),
    ).toBe(true);
  });

  it("does not reset non-Hermes runtimes or empty Hermes runtimes for config drift", () => {
    expect(
      shouldResetHermesSessionForConfigDrift({
        agent: {
          adapterType: "codex_local",
          updatedAt: new Date("2026-03-25T17:05:52.000Z"),
        },
        runtimeState: {
          sessionId: "session-1",
          updatedAt: new Date("2026-03-25T16:56:40.000Z"),
        },
      }),
    ).toBe(false);

    expect(
      shouldResetHermesSessionForConfigDrift({
        agent: {
          adapterType: "hermes_local",
          updatedAt: new Date("2026-03-25T17:05:52.000Z"),
        },
        runtimeState: {
          sessionId: null,
          updatedAt: new Date("2026-03-25T16:56:40.000Z"),
        },
      }),
    ).toBe(false);
  });
});
