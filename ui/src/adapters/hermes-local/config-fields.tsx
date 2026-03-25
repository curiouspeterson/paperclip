import type { AdapterConfigFieldsProps } from "../types";
import {
  Field,
  DraftInput,
  DraftTextarea,
  ToggleField,
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
  const hermesManagedHomeValue = isCreate
    ? Boolean(values!.hermesManagedHome)
    : eff("adapterConfig", "paperclipManagedHermesHome", Boolean(config.paperclipManagedHermesHome));
  const hermesSeedCompanyProfileMemoryValue = isCreate
    ? Boolean(values!.hermesSeedCompanyProfileMemory)
    : eff(
        "adapterConfig",
        "paperclipSeedCompanyProfileMemory",
        Boolean(config.paperclipSeedCompanyProfileMemory),
      );
  const hermesToolsetsValue = isCreate
    ? values!.hermesToolsets ?? ""
    : eff("adapterConfig", "toolsets", String(config.toolsets ?? ""));
  const hermesAllowedMcpServersValue = isCreate
    ? values!.hermesAllowedMcpServers ?? ""
    : eff(
        "adapterConfig",
        "allowedMcpServerNames",
        Array.isArray(config.allowedMcpServerNames)
          ? (config.allowedMcpServerNames as string[]).join(", ")
          : String(config.allowedMcpServerNames ?? ""),
      );
  const mcpServersValue = isCreate
    ? values!.mcpServersJson ?? ""
    : eff(
        "adapterConfig",
        "mcpServers",
        config.mcpServers ? JSON.stringify(config.mcpServers, null, 2) : "",
      );

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
      <Field label="Hermes toolsets" hint={help.hermesToolsets}>
        <DraftInput
          value={typeof hermesToolsetsValue === "string" ? hermesToolsetsValue : ""}
          onCommit={(v) =>
            isCreate
              ? set!({ hermesToolsets: v })
              : mark("adapterConfig", "toolsets", v.trim() || undefined)
          }
          immediate
          className={inputClass}
          placeholder="e.g. skills,browser"
        />
      </Field>
      <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-3">
        <ToggleField
          label="Use Paperclip-managed Hermes home"
          hint={help.hermesManagedHome}
          checked={hermesManagedHomeValue}
          onChange={(checked) =>
            isCreate
              ? set!({ hermesManagedHome: checked })
              : mark("adapterConfig", "paperclipManagedHermesHome", checked || undefined)
          }
        />
      </div>
      <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-3">
        <ToggleField
          label="Seed company profile into Hermes memory files"
          hint={help.hermesSeedCompanyProfileMemory}
          checked={hermesSeedCompanyProfileMemoryValue}
          onChange={(checked) =>
            isCreate
              ? set!({ hermesSeedCompanyProfileMemory: checked, ...(checked ? { hermesManagedHome: true } : {}) })
              : (() => {
                  mark("adapterConfig", "paperclipSeedCompanyProfileMemory", checked || undefined);
                  if (checked) mark("adapterConfig", "paperclipManagedHermesHome", true);
                })()
          }
        />
      </div>
      <Field label="Managed MCP servers (JSON)" hint={help.mcpServersJson}>
        <DraftTextarea
          value={typeof mcpServersValue === "string" ? mcpServersValue : ""}
          onCommit={(v) => {
            if (isCreate) {
              set!({ mcpServersJson: v });
              return;
            }
            const trimmed = v.trim();
            if (!trimmed) {
              mark("adapterConfig", "mcpServers", undefined);
              mark("adapterConfig", "paperclipManagedHermesHome", undefined);
              return;
            }
            try {
              const parsed = JSON.parse(trimmed);
              if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
              mark("adapterConfig", "mcpServers", parsed);
              mark("adapterConfig", "paperclipManagedHermesHome", true);
            } catch {
              // Keep the last valid adapter config until the JSON is corrected.
            }
          }}
          placeholder={'{\n  "github": {\n    "command": "npx",\n    "args": ["-y", "@modelcontextprotocol/server-github"]\n  }\n}'}
          minRows={6}
        />
      </Field>
      <Field label="Allowed MCP servers" hint={help.hermesAllowedMcpServers}>
        <DraftInput
          value={typeof hermesAllowedMcpServersValue === "string" ? hermesAllowedMcpServersValue : ""}
          onCommit={(v) =>
            isCreate
              ? set!({ hermesAllowedMcpServers: v })
              : mark(
                  "adapterConfig",
                  "allowedMcpServerNames",
                  v
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean),
                )
          }
          immediate
          className={inputClass}
          placeholder="e.g. github, filesystem"
        />
      </Field>
    </>
  );
}
