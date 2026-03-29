import { spawnSync } from "node:child_process";
import { normalizeVitestScriptArgs } from "./run-vitest-args.mjs";

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const vitestArgs = normalizeVitestScriptArgs(process.argv.slice(2));
const result = spawnSync(command, ["exec", "vitest", ...vitestArgs], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
