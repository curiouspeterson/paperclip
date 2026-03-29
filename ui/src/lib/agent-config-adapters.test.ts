import { describe, expect, it } from "vitest";
import { DEFAULT_HERMES_LOCAL_MODEL } from "../adapters/hermes-local/build-config";
import {
  buildCreateValuesForAdapterType,
  buildEditAdapterConfigForAdapterSwitch,
  listAgentConfigSelectableAdapterTypes,
} from "./agent-config-adapters";

describe("agent config adapter helpers", () => {
  it("exposes all first-class UI adapters to the main agent config form", () => {
    expect(listAgentConfigSelectableAdapterTypes()).toEqual([
      "claude_local",
      "codex_local",
      "gemini_local",
      "hermes_local",
      "opencode_local",
      "pi_local",
      "cursor",
      "openclaw_gateway",
      "process",
      "http",
    ]);
  });

  it("seeds Hermes adapter switches with the Hermes default model", () => {
    expect(buildCreateValuesForAdapterType("hermes_local").model).toBe(DEFAULT_HERMES_LOCAL_MODEL);
    expect(buildEditAdapterConfigForAdapterSwitch("hermes_local").model).toBe(DEFAULT_HERMES_LOCAL_MODEL);
  });
});
