import type { CreateConfigValues, TranscriptEntry } from "@paperclipai/adapter-utils";
import type { UIAdapterModule } from "./types";

function parseUnsupportedStdoutLine(line: string, ts: string): TranscriptEntry[] {
  return [{ kind: "stdout", ts, text: line }];
}

function UnsupportedAdapterConfigFields() {
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
      This agent uses an unsupported adapter type in this Paperclip build. Its configuration is shown read-only until the adapter contract is restored.
    </div>
  );
}

function buildUnsupportedAdapterConfig(_values: CreateConfigValues): Record<string, unknown> {
  return {};
}

export const unsupportedUIAdapter: UIAdapterModule = {
  type: "unsupported",
  label: "Unsupported Adapter",
  parseStdoutLine: parseUnsupportedStdoutLine,
  ConfigFields: UnsupportedAdapterConfigFields,
  buildAdapterConfig: buildUnsupportedAdapterConfig,
};
