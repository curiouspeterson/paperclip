import type { AdapterConfigFieldsProps } from "../types";
import {
  Field,
  DraftInput,
  help,
} from "../../components/agent-config-primitives";
import { ChoosePathButton } from "../../components/PathInstructionsModal";

const inputClass =
  "w-full rounded-md border border-border px-2.5 py-1.5 bg-transparent outline-none text-sm font-mono placeholder:text-muted-foreground/40";

export function HermesLocalConfigFields({
  isCreate,
  values,
  set,
  config,
  eff,
  mark,
}: AdapterConfigFieldsProps) {
  return (
    <>
      <Field label="Hermes binary path" hint="Path to the hermes binary. Leave blank to use the default from PATH.">
        <div className="flex items-center gap-2">
          <DraftInput
            value={
              isCreate
                ? values!.command ?? ""
                : eff("adapterConfig", "hermesCommand", String(config.hermesCommand ?? ""))
            }
            onCommit={(v) =>
              isCreate
                ? set!({ command: v })
                : mark("adapterConfig", "hermesCommand", v || undefined)
            }
            immediate
            className={inputClass}
            placeholder="hermes"
          />
          <ChoosePathButton />
        </div>
      </Field>
      <Field label="Extra CLI arguments" hint="Additional arguments passed to the hermes agent (space-separated).">
        <DraftInput
          value={
            isCreate
              ? values!.extraArgs ?? ""
              : eff(
                  "adapterConfig",
                  "extraArgs",
                  Array.isArray(config.extraArgs)
                    ? (config.extraArgs as string[]).join(" ")
                    : String(config.extraArgs ?? ""),
                )
          }
          onCommit={(v) =>
            isCreate
              ? set!({ extraArgs: v })
              : mark(
                  "adapterConfig",
                  "extraArgs",
                  v ? v.split(/\s+/).filter(Boolean) : undefined,
                )
          }
          immediate
          className={inputClass}
          placeholder="e.g. --reasoning-effort high"
        />
      </Field>
    </>
  );
}
