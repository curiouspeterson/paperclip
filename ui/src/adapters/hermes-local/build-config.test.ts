import { describe, expect, it } from "vitest";
import { buildHermesLocalConfig, DEFAULT_HERMES_LOCAL_MODEL } from "./build-config";

describe("buildHermesLocalConfig", () => {
  it("maps UI values onto Hermes runtime config", () => {
    expect(
      buildHermesLocalConfig({
        adapterType: "hermes_local",
        cwd: "/tmp/work",
        instructionsFilePath: "",
        promptTemplate: "Work the queue.",
        model: "",
        thinkingEffort: "high",
        chrome: false,
        dangerouslySkipPermissions: true,
        search: false,
        dangerouslyBypassSandbox: false,
        command: "/Users/test/.local/bin/hermes",
        args: "",
        extraArgs: "--verbose, --checkpoints",
        envVars: "FOO=bar",
        envBindings: {},
        url: "",
        bootstrapPrompt: "",
        payloadTemplateJson: "",
        workspaceStrategyType: "project_primary",
        workspaceBaseRef: "",
        workspaceBranchTemplate: "",
        worktreeParentDir: "",
        runtimeServicesJson: "",
        maxTurnsPerRun: 300,
        heartbeatEnabled: false,
        intervalSec: 300,
      }),
    ).toEqual({
      cwd: "/tmp/work",
      promptTemplate: "Work the queue.",
      model: DEFAULT_HERMES_LOCAL_MODEL,
      timeoutSec: 300,
      graceSec: 15,
      hermesCommand: "/Users/test/.local/bin/hermes",
      env: {
        FOO: { type: "plain", value: "bar" },
      },
      extraArgs: ["--verbose", "--checkpoints", "--reasoning-effort", "high"],
    });
  });
});
