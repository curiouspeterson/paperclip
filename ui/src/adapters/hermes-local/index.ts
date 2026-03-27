import type { UIAdapterModule } from "../types";
import { parseHermesStdoutLine } from "hermes-paperclip-adapter/ui";
import { buildHermesLocalConfig } from "./build-config";
import { HermesLocalConfigFields } from "./config-fields";

export const hermesLocalUIAdapter: UIAdapterModule = {
  type: "hermes_local",
  label: "Hermes (local)",
  parseStdoutLine: parseHermesStdoutLine,
  ConfigFields: HermesLocalConfigFields,
  buildAdapterConfig: buildHermesLocalConfig,
};
