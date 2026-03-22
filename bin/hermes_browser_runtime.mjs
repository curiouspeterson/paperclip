#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

function usage() {
  console.log(`Usage: node bin/hermes_browser_runtime.mjs <status|env|run> [-- <args...>]

Reads Hermes browser runtime settings from environment:
  HERMES_BROWSER_AUTOMATION_PROVIDER
  HERMES_BROWSER_AUTOMATION_COMMAND
  HERMES_BROWSER_SESSION_PROFILE
  HERMES_BROWSER_HEADLESS

Commands:
  status    Print JSON summary of the resolved browser runtime
  env       Print shell-style key=value lines for the browser runtime
  run       Execute HERMES_BROWSER_AUTOMATION_COMMAND with forwarded args
`);
}

function resolveConfig() {
  const provider = (process.env.HERMES_BROWSER_AUTOMATION_PROVIDER || "").trim();
  const command = (process.env.HERMES_BROWSER_AUTOMATION_COMMAND || "").trim();
  const sessionProfile = (process.env.HERMES_BROWSER_SESSION_PROFILE || "").trim();
  const headless = ["1", "true", "yes", "on"].includes(
    (process.env.HERMES_BROWSER_HEADLESS || "").trim().toLowerCase(),
  );
  const wrapper = path.resolve(process.argv[1] || "bin/hermes_browser_runtime.mjs");
  return {
    provider,
    command,
    sessionProfile,
    headless,
    wrapper,
  };
}

function resolveCommandStatus(commandLine) {
  if (!commandLine) return "missing";
  return "configured";
}

function shellQuote(value) {
  if (value === "") return "''";
  return `'${String(value).replaceAll("'", `'\"'\"'`)}'`;
}

async function runCommand(commandLine, forwardedArgs) {
  if (!commandLine) {
    throw new Error("HERMES_BROWSER_AUTOMATION_COMMAND is not set");
  }
  const suffix = forwardedArgs.length > 0
    ? ` ${forwardedArgs.map((value) => shellQuote(value)).join(" ")}`
    : "";
  const child = spawn(`${commandLine}${suffix}`, {
    stdio: "inherit",
    shell: true,
    env: process.env,
  });

  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (exitCode, signal) => {
      if (signal) {
        reject(new Error(`Browser runtime terminated by signal ${signal}`));
        return;
      }
      resolve(exitCode ?? 1);
    });
  });

  process.exit(code);
}

async function main() {
  const [command = "status", ...rest] = process.argv.slice(2);
  if (command === "-h" || command === "--help" || command === "help") {
    usage();
    return;
  }

  const config = resolveConfig();
  if (command === "status") {
    console.log(JSON.stringify({
      ...config,
      commandStatus: resolveCommandStatus(config.command),
    }, null, 2));
    return;
  }

  if (command === "env") {
    console.log(`HERMES_BROWSER_AUTOMATION_PROVIDER=${config.provider}`);
    console.log(`HERMES_BROWSER_AUTOMATION_COMMAND=${config.command}`);
    console.log(`HERMES_BROWSER_SESSION_PROFILE=${config.sessionProfile}`);
    console.log(`HERMES_BROWSER_HEADLESS=${config.headless ? "1" : "0"}`);
    console.log(`HERMES_BROWSER_RUNTIME_WRAPPER=${config.wrapper}`);
    return;
  }

  if (command === "run") {
    const forwardedArgs = rest[0] === "--" ? rest.slice(1) : rest;
    await runCommand(config.command, forwardedArgs);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
