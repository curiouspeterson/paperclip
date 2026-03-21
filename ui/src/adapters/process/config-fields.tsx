import type { AdapterConfigFieldsProps } from "../types";
import {
  Field,
  DraftInput,
  ToggleField,
  help,
} from "../../components/agent-config-primitives";

const inputClass =
  "w-full rounded-md border border-border px-2.5 py-1.5 bg-transparent outline-none text-sm font-mono placeholder:text-muted-foreground/40";

function formatArgList(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .join(", ");
  }
  return typeof value === "string" ? value : "";
}

function parseCommaArgs(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function ProcessConfigFields({
  isCreate,
  values,
  set,
  config,
  eff,
  mark,
}: AdapterConfigFieldsProps) {
  return (
    <>
      <Field label="Command" hint={help.command}>
        <DraftInput
          value={
            isCreate
              ? values!.command
              : eff("adapterConfig", "command", String(config.command ?? ""))
          }
          onCommit={(v) =>
            isCreate
              ? set!({ command: v })
              : mark("adapterConfig", "command", v || undefined)
          }
          immediate
          className={inputClass}
          placeholder="e.g. node, python"
        />
      </Field>
      <Field label="Args (comma-separated)" hint={help.args}>
        <DraftInput
          value={
            isCreate
              ? values!.args
              : eff("adapterConfig", "args", formatArgList(config.args))
          }
          onCommit={(v) =>
            isCreate
              ? set!({ args: v })
              : mark(
                  "adapterConfig",
                  "args",
                  v ? parseCommaArgs(v) : undefined,
                )
          }
          immediate
          className={inputClass}
          placeholder="e.g. script.js, --flag"
        />
      </Field>
      <Field label="Browser automation provider" hint={help.browserAutomationProvider}>
        <select
          className={inputClass}
          value={
            isCreate
              ? values!.browserAutomationProvider ?? ""
              : eff(
                  "adapterConfig",
                  "browserAutomationProvider",
                  String(config.browserAutomationProvider ?? ""),
                )
          }
          onChange={(e) => {
            const value = e.target.value;
            if (isCreate) {
              set!({
                browserAutomationProvider:
                  value === "" || value === "playwright" || value === "page_agent" || value === "lightpanda"
                    ? value
                    : "",
              });
              return;
            }
            mark("adapterConfig", "browserAutomationProvider", value || undefined);
          }}
        >
          <option value="">None</option>
          <option value="playwright">Playwright</option>
          <option value="page_agent">Page Agent</option>
          <option value="lightpanda">Lightpanda</option>
        </select>
      </Field>
      <Field label="Browser runtime command" hint={help.browserAutomationCommand}>
        <DraftInput
          value={
            isCreate
              ? values!.browserAutomationCommand ?? ""
              : eff(
                  "adapterConfig",
                  "browserAutomationCommand",
                  String(config.browserAutomationCommand ?? ""),
                )
          }
          onCommit={(v) =>
            isCreate
              ? set!({ browserAutomationCommand: v })
              : mark("adapterConfig", "browserAutomationCommand", v || undefined)
          }
          immediate
          className={inputClass}
          placeholder="e.g. page-agent, lightpanda, ./scripts/browser-worker.sh"
        />
      </Field>
      <Field label="Browser session profile" hint={help.browserSessionProfile}>
        <DraftInput
          value={
            isCreate
              ? values!.browserSessionProfile ?? ""
              : eff(
                  "adapterConfig",
                  "browserSessionProfile",
                  String(config.browserSessionProfile ?? ""),
                )
          }
          onCommit={(v) =>
            isCreate
              ? set!({ browserSessionProfile: v })
              : mark("adapterConfig", "browserSessionProfile", v || undefined)
          }
          immediate
          className={inputClass}
          placeholder="e.g. Default, Profile 1, /tmp/paperclip-browser"
        />
      </Field>
      <ToggleField
        label="Prefer headless browser runtime"
        hint={help.browserHeadless}
        checked={
          isCreate
            ? values!.browserHeadless ?? false
            : eff(
                "adapterConfig",
                "browserHeadless",
                config.browserHeadless === true,
              )
        }
        onChange={(v) =>
          isCreate
            ? set!({ browserHeadless: v })
            : mark("adapterConfig", "browserHeadless", v ? true : undefined)
        }
      />
    </>
  );
}
