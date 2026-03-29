import {
  DEFAULT_CODEX_LOCAL_BYPASS_APPROVALS_AND_SANDBOX,
  DEFAULT_CODEX_LOCAL_MODEL,
} from "@paperclipai/adapter-codex-local";
import { DEFAULT_CURSOR_LOCAL_MODEL } from "@paperclipai/adapter-cursor-local";
import { DEFAULT_GEMINI_LOCAL_MODEL } from "@paperclipai/adapter-gemini-local";
import type { CreateConfigValues } from "@paperclipai/adapter-utils";
import { listUIAdapters } from "../adapters";
import { DEFAULT_HERMES_LOCAL_MODEL } from "../adapters/hermes-local/build-config";
import { defaultCreateValues } from "../components/agent-config-defaults";

export function listAgentConfigSelectableAdapterTypes(): CreateConfigValues["adapterType"][] {
  return listUIAdapters().map((adapter) => adapter.type as CreateConfigValues["adapterType"]);
}

export function buildCreateValuesForAdapterType(
  adapterType: CreateConfigValues["adapterType"],
): CreateConfigValues {
  const { adapterType: _discard, ...defaults } = defaultCreateValues;
  const nextValues: CreateConfigValues = { ...defaults, adapterType };
  if (adapterType === "codex_local") {
    nextValues.model = DEFAULT_CODEX_LOCAL_MODEL;
    nextValues.dangerouslyBypassSandbox = DEFAULT_CODEX_LOCAL_BYPASS_APPROVALS_AND_SANDBOX;
  } else if (adapterType === "gemini_local") {
    nextValues.model = DEFAULT_GEMINI_LOCAL_MODEL;
  } else if (adapterType === "hermes_local") {
    nextValues.model = DEFAULT_HERMES_LOCAL_MODEL;
  } else if (adapterType === "cursor") {
    nextValues.model = DEFAULT_CURSOR_LOCAL_MODEL;
  } else if (adapterType === "opencode_local") {
    nextValues.model = "";
  }
  return nextValues;
}

export function buildEditAdapterConfigForAdapterSwitch(adapterType: string): Record<string, unknown> {
  return {
    model:
      adapterType === "codex_local"
        ? DEFAULT_CODEX_LOCAL_MODEL
        : adapterType === "gemini_local"
          ? DEFAULT_GEMINI_LOCAL_MODEL
          : adapterType === "hermes_local"
            ? DEFAULT_HERMES_LOCAL_MODEL
            : adapterType === "cursor"
              ? DEFAULT_CURSOR_LOCAL_MODEL
              : "",
    effort: "",
    modelReasoningEffort: "",
    variant: "",
    mode: "",
    ...(adapterType === "codex_local"
      ? {
          dangerouslyBypassApprovalsAndSandbox:
            DEFAULT_CODEX_LOCAL_BYPASS_APPROVALS_AND_SANDBOX,
        }
      : {}),
  };
}
