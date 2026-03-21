import type { AdapterConfigFieldsProps } from "../types";
import {
  Field,
  DraftInput,
} from "../../components/agent-config-primitives";
import { ChoosePathButton } from "../../components/PathInstructionsModal";

const inputClass =
  "w-full rounded-md border border-border px-2.5 py-1.5 bg-transparent outline-none text-sm font-mono placeholder:text-muted-foreground/40";
const instructionsFileHint =
  "Absolute path to a markdown file (e.g. AGENTS.md) that defines this agent's behavior. Injected into the system prompt at runtime.";

export function OpenCodeLocalConfigFields({
  isCreate,
  values,
  set,
  config,
  eff,
  mark,
  hideInstructionsFile,
}: AdapterConfigFieldsProps) {
  const externalSkillDirsValue = isCreate
    ? values!.externalSkillDirs ?? ""
    : (() => {
        const value = eff("adapterConfig", "externalSkillDirs", config.externalSkillDirs);
        if (Array.isArray(value)) {
          return value.filter((item): item is string => typeof item === "string").join("\n");
        }
        return typeof value === "string" ? value : "";
      })();
  return (
    <>
      {!hideInstructionsFile && (
        <Field label="Agent instructions file" hint={instructionsFileHint}>
          <div className="flex items-center gap-2">
            <DraftInput
              value={
                isCreate
                  ? values!.instructionsFilePath ?? ""
                  : eff(
                      "adapterConfig",
                      "instructionsFilePath",
                      String(config.instructionsFilePath ?? ""),
                    )
              }
              onCommit={(v) =>
                isCreate
                  ? set!({ instructionsFilePath: v })
                  : mark("adapterConfig", "instructionsFilePath", v || undefined)
              }
              immediate
              className={inputClass}
              placeholder="/absolute/path/to/AGENTS.md"
            />
            <ChoosePathButton />
          </div>
        </Field>
      )}
      <Field
        label="External skill directories"
        hint="Optional newline-separated directories containing extra skill packs. This is the seam for Superpowers-style local skills."
      >
        <textarea
          className={`${inputClass} min-h-24`}
          value={externalSkillDirsValue}
          onChange={(e) =>
            isCreate
              ? set!({ externalSkillDirs: e.target.value })
              : mark(
                  "adapterConfig",
                  "externalSkillDirs",
                  e.target.value
                    .split(/\r?\n/)
                    .map((item) => item.trim())
                    .filter(Boolean),
                )
          }
          placeholder={"/absolute/path/to/superpowers/skills\n/absolute/path/to/another-pack"}
        />
      </Field>
      <Field
        label="Context prep command"
        hint="Optional shell command run before each OpenCode run. Its stdout is appended to the prompt for context-hub style repo summaries."
      >
        <DraftInput
          value={
            isCreate
              ? values!.contextPrepCommand ?? ""
              : eff(
                  "adapterConfig",
                  "contextPrepCommand",
                  String(config.contextPrepCommand ?? ""),
                )
          }
          onCommit={(v) =>
            isCreate
              ? set!({ contextPrepCommand: v })
              : mark("adapterConfig", "contextPrepCommand", v || undefined)
          }
          immediate
          className={inputClass}
          placeholder="context-hub build --stdout"
        />
      </Field>
    </>
  );
}
