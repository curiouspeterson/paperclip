#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

let chromium;

async function loadPlaywright() {
  if (chromium) {
    return chromium;
  }
  try {
    ({ chromium } = await import("playwright"));
    return chromium;
  } catch {
    ({ chromium } = await import("@playwright/test"));
    return chromium;
  }
}

function usage() {
  console.log(`Usage: bin/capture_channel_storage_state.mjs --channel instagram|mailchimp --state-path PATH [--headed] [--output-dir PATH]

Opens a real browser, waits for you to complete login manually, validates that the
channel no longer shows the login gate, and saves Playwright storage state.

Examples:
  node bin/capture_channel_storage_state.mjs --channel instagram --state-path output/playwright/instagram-state.json --headed
  node bin/capture_channel_storage_state.mjs --channel mailchimp --state-path output/playwright/mailchimp-state.json --headed
`);
}

function parseArgs(argv) {
  const args = {
    channel: "",
    statePath: "",
    headed: false,
    outputDir: path.resolve(process.cwd(), "output/playwright"),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    switch (value) {
      case "--channel":
        args.channel = (argv[++i] ?? "").toLowerCase();
        break;
      case "--state-path":
        args.statePath = argv[++i] ?? "";
        break;
      case "--headed":
        args.headed = true;
        break;
      case "--output-dir":
        args.outputDir = path.resolve(argv[++i] ?? "");
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

  if (!args.channel || !["instagram", "mailchimp"].includes(args.channel)) {
    throw new Error("--channel must be instagram or mailchimp");
  }
  if (!args.statePath) {
    throw new Error("--state-path is required");
  }
  return args;
}

async function ensureDir(dirPath) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

async function capture(page, outputDir, name) {
  const safe = name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();
  const screenshotPath = path.join(outputDir, `${safe}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return screenshotPath;
}

async function waitForEnter(promptText) {
  process.stdout.write(`${promptText}\n`);
  process.stdout.write("Press Enter when ready.\n");
  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => resolve());
  });
}

async function validateInstagram(page) {
  await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  const loginField = page.locator('input[name="username"], input[name="password"]').first();
  const loginPrompt = page.locator('text=/log in|sign up/i').first();
  if (await loginField.count() || await loginPrompt.count()) {
    return false;
  }
  return true;
}

async function validateMailchimp(page) {
  await page.goto("https://login.mailchimp.com/", { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  const loginField = page.locator('input[type="email"], input[name="username"], input[name="email"]').first();
  const verificationText = page.locator("text=/verification code|log in to continue|check your email/i").first();
  if (await loginField.count() || await verificationText.count()) {
    return false;
  }
  return true;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await ensureDir(args.outputDir);
  await ensureDir(path.dirname(path.resolve(args.statePath)));

  const browserType = await loadPlaywright();
  const browser = await browserType.launch({ headless: !args.headed, channel: "chrome" });
  const context = await browser.newContext();
  context.setDefaultTimeout(20_000);
  context.setDefaultNavigationTimeout(20_000);
  const page = await context.newPage();

  try {
    if (args.channel === "instagram") {
      await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded" });
      await waitForEnter("Complete Instagram login in the opened browser.");
      const ok = await validateInstagram(page);
      const screenshotPath = await capture(page, args.outputDir, "instagram-storage-state-captured");
      if (!ok) {
        throw new Error(`Instagram still appears unauthenticated. Screenshot: ${screenshotPath}`);
      }
    } else {
      await page.goto("https://login.mailchimp.com/", { waitUntil: "domcontentloaded" });
      await waitForEnter("Complete Mailchimp login in the opened browser.");
      const ok = await validateMailchimp(page);
      const screenshotPath = await capture(page, args.outputDir, "mailchimp-storage-state-captured");
      if (!ok) {
        throw new Error(`Mailchimp still appears unauthenticated. Screenshot: ${screenshotPath}`);
      }
    }

    await context.storageState({ path: path.resolve(args.statePath) });
    console.log(
      JSON.stringify(
        {
          channel: args.channel,
          status: "captured",
          statePath: path.resolve(args.statePath),
        },
        null,
        2,
      ),
    );
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
