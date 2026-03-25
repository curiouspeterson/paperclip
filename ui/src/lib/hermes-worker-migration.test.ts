import { describe, expect, it } from "vitest";
import { buildLegacyHermesWorkerMigrationPreview, isLegacyHermesWorkerProcessAgent } from "./hermes-worker-migration";

describe("hermes worker migration", () => {
  it("detects legacy Hermes worker process agents", () => {
    expect(isLegacyHermesWorkerProcessAgent({
      adapterType: "process",
      adapterConfig: {
        command: "python3",
        args: ["scripts/hermes_paperclip_worker.py"],
      },
    })).toBe(true);
  });

  it("rejects non-Hermes process agents", () => {
    expect(isLegacyHermesWorkerProcessAgent({
      adapterType: "process",
      adapterConfig: {
        command: "python3",
        args: ["scripts/something_else.py"],
      },
    })).toBe(false);
  });

  it("builds a compact migration preview", () => {
    const preview = buildLegacyHermesWorkerMigrationPreview({
      adapterType: "process",
      adapterConfig: {
        command: "python3",
        args: ["scripts/hermes_paperclip_worker.py"],
        browserAutomationProvider: "playwright",
        env: {
          HERMES_PROVIDER: { type: "plain", value: "zai" },
          HERMES_MODEL: { type: "plain", value: "glm-4.7" },
          HERMES_BIN: { type: "plain", value: "/usr/local/bin/hermes" },
        },
      },
    });

    expect(preview).toEqual({
      provider: "zai",
      model: "glm-4.7",
      hermesCommand: "/usr/local/bin/hermes",
      browserAutomationProvider: "playwright",
      managedHome: true,
      memorySeeding: true,
    });
  });
});
