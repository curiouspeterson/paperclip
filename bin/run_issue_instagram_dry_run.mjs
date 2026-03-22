#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

function usage() {
  console.log(`Usage: bin/run_issue_instagram_dry_run.mjs --issue-id ID [--api-url URL] [--api-key TOKEN] [--storage-state PATH] [--output-dir PATH] [--headless]

Downloads the synced instagram-dry-run packet from a Paperclip issue and feeds it
into the existing browser_channel_dry_run.mjs helper. It stops at Instagram's
final review/share screen and never publishes.
`);
}

function parseArgs(argv) {
  const args = {
    issueId: "",
    apiUrl: process.env.PAPERCLIP_API_URL ?? "http://127.0.0.1:3100/api",
    apiKey: process.env.PAPERCLIP_API_KEY ?? "",
    storageState: path.resolve(process.cwd(), "output/playwright/instagram-state.json"),
    outputDir: path.resolve(process.cwd(), "output/playwright"),
    headless: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    switch (value) {
      case "--issue-id":
        args.issueId = argv[++i] ?? "";
        break;
      case "--api-url":
        args.apiUrl = argv[++i] ?? "";
        break;
      case "--api-key":
        args.apiKey = argv[++i] ?? "";
        break;
      case "--storage-state":
        args.storageState = path.resolve(argv[++i] ?? "");
        break;
      case "--output-dir":
        args.outputDir = path.resolve(argv[++i] ?? "");
        break;
      case "--headless":
        args.headless = true;
        break;
      case "-h":
      case "--help":
        usage();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${value}`);
    }
  }

  if (!args.issueId) {
    throw new Error("--issue-id is required");
  }
  args.apiUrl = args.apiUrl.replace(/\/+$/, "");
  return args;
}

async function apiFetch(apiUrl, apiKey, pathname, init = {}) {
  const headers = new Headers(init.headers ?? {});
  if (apiKey) {
    headers.set("Authorization", `Bearer ${apiKey}`);
  }
  const normalizedPath =
    pathname.startsWith("http://") || pathname.startsWith("https://")
      ? pathname
      : pathname.startsWith("/api/")
        ? `${apiUrl.replace(/\/api$/, "")}${pathname}`
        : `${apiUrl}${pathname}`;
  const response = await fetch(normalizedPath, { ...init, headers });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${init.method ?? "GET"} ${pathname} failed: ${response.status} ${text}`);
  }
  return response;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.storageState)) {
    throw new Error(`Instagram storage state not found: ${args.storageState}`);
  }
  await fs.promises.mkdir(args.outputDir, { recursive: true });

  const attachmentsResponse = await apiFetch(args.apiUrl, args.apiKey, `/issues/${args.issueId}/attachments`);
  const attachments = await attachmentsResponse.json();
  const packetAttachment = attachments.find((item) => item.originalFilename === "instagram-dry-run.json");
  if (!packetAttachment?.contentPath) {
    throw new Error(`instagram-dry-run.json attachment was not found on issue ${args.issueId}`);
  }

  const packetResponse = await apiFetch(args.apiUrl, args.apiKey, packetAttachment.contentPath);
  const packetText = await packetResponse.text();
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ru-ig-issue-packet-"));
  const packetPath = path.join(tempDir, "instagram-dry-run.json");
  await fs.promises.writeFile(packetPath, packetText, "utf8");

  const browserScript = path.resolve(path.dirname(new URL(import.meta.url).pathname), "browser_channel_dry_run.mjs");
  const childArgs = [
    browserScript,
    "--packet",
    packetPath,
    "--storage-state",
    args.storageState,
    "--output-dir",
    args.outputDir,
  ];
  if (args.headless) {
    childArgs.push("--headless");
  }

  const child = spawn(process.execPath, childArgs, { stdio: "inherit" });
  child.on("exit", async (code) => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } finally {
      process.exit(code ?? 1);
    }
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
