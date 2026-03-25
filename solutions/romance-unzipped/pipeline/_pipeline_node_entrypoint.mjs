#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function main() {
  const wrapperPath = process.argv[1];
  const wrapperName = wrapperPath ? path.basename(wrapperPath) : "";
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const target = path.join(repoRoot, "bin", wrapperName);

  if (!wrapperName || !existsSync(target)) {
    console.error(`Romance Unzipped solution wrapper could not find root pipeline entrypoint: ${target}`);
    process.exit(1);
  }

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [target, ...process.argv.slice(2)], {
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 0));
  }).then((code) => {
    process.exit(code);
  });
}

