#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
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
  console.log(`Usage: bin/browser_channel_dry_run.mjs --packet PATH [--channel instagram|mailchimp] [--headless] [--profile-dir PATH] [--chrome-user-data-dir PATH] [--chrome-profile-directory NAME] [--clone-chrome-profile] [--storage-state PATH] [--save-storage-state PATH] [--output-dir PATH]

Reads a generated dry-run packet JSON and drives the browser only up to the final
review screen. It never clicks Share or Send.

Examples:
  node bin/browser_channel_dry_run.mjs --packet .runtime/.../social/instagram-dry-run.json
  node bin/browser_channel_dry_run.mjs --packet .runtime/.../newsletter/mailchimp-dry-run.json --channel mailchimp
  node bin/browser_channel_dry_run.mjs --packet .runtime/.../social/instagram-dry-run.json --chrome-user-data-dir "$HOME/Library/Application Support/Google/Chrome" --chrome-profile-directory Default --clone-chrome-profile
  node bin/browser_channel_dry_run.mjs --packet .runtime/.../social/instagram-dry-run.json --storage-state output/playwright/instagram-state.json
`);
}

function parseArgs(argv) {
  const args = {
    packet: "",
    channel: "",
    headless: false,
    profileDir: "",
    chromeUserDataDir: "",
    chromeProfileDirectory: "",
    cloneChromeProfile: false,
    storageState: "",
    saveStorageState: "",
    outputDir: path.resolve(process.cwd(), "output/playwright"),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    switch (value) {
      case "--packet":
        args.packet = argv[++i] ?? "";
        break;
      case "--channel":
        args.channel = argv[++i] ?? "";
        break;
      case "--headless":
        args.headless = true;
        break;
      case "--profile-dir":
        args.profileDir = argv[++i] ?? "";
        break;
      case "--chrome-user-data-dir":
        args.chromeUserDataDir = argv[++i] ?? "";
        break;
      case "--chrome-profile-directory":
        args.chromeProfileDirectory = argv[++i] ?? "";
        break;
      case "--clone-chrome-profile":
        args.cloneChromeProfile = true;
        break;
      case "--storage-state":
        args.storageState = argv[++i] ?? "";
        break;
      case "--save-storage-state":
        args.saveStorageState = argv[++i] ?? "";
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

  if (!args.packet) {
    throw new Error("--packet is required");
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function ensureOutputDir(dirPath) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

async function cloneChromeProfile(userDataDir, profileDirectory) {
  const sourceRoot = path.resolve(userDataDir);
  const sourceProfile = path.join(sourceRoot, profileDirectory);
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ru-browser-profile-"));
  const targetProfile = path.join(tempRoot, profileDirectory);

  await fs.promises.mkdir(tempRoot, { recursive: true });
  for (const topLevelFile of ["Local State", "First Run", "Variations"]) {
    const sourcePath = path.join(sourceRoot, topLevelFile);
    if (fs.existsSync(sourcePath)) {
      await fs.promises.copyFile(sourcePath, path.join(tempRoot, topLevelFile));
    }
  }
  await fs.promises.cp(sourceProfile, targetProfile, {
    recursive: true,
    force: true,
    verbatimSymlinks: false,
    filter: (entry) => !/[/\\](Cache|Code Cache|GPUCache|ShaderCache|GrShaderCache|GraphiteDawnCache|Crashpad|blob_storage)([/\\]|$)/.test(entry),
  });
  return tempRoot;
}

async function capture(page, outputDir, name) {
  const safe = name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();
  const screenshotPath = path.join(outputDir, `${safe}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return screenshotPath;
}

async function withTimeout(task, ms, label) {
  let timer;
  try {
    return await Promise.race([
      task,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function withoutChromeChannel(launchOptions) {
  const fallback = { ...launchOptions };
  delete fallback.channel;
  return fallback;
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing ${label}`);
  }
  return value.trim();
}

async function clickFirstVisible(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      try {
        if (await locator.isVisible({ timeout: 750 })) {
          await locator.click();
          return selector;
        }
      } catch {
        // continue
      }
    }
  }
  return null;
}

async function waitForInstagramComposer(page) {
  const selectors = [
    "textarea",
    '[contenteditable="true"]',
    '[role="textbox"]',
    'div[aria-label*="Write a caption" i]',
    'div[aria-label*="caption" i]',
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      await locator.waitFor({ state: "visible", timeout: 5_000 });
      return locator;
    } catch {
      // Try the next caption surface.
    }
  }

  throw new Error("Instagram caption field was not available on the composer screen.");
}

async function fillInstagramCaption(captionLocator, captionText) {
  try {
    await captionLocator.fill(captionText);
    return;
  } catch {
    // Fall back to contenteditable typing.
  }

  await captionLocator.click();
  await captionLocator.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => {});
  await captionLocator.press("Backspace").catch(() => {});
  await captionLocator.type(captionText, { delay: 5 });
}

async function maybeAdvanceInstagramStep(page) {
  const next = page.getByRole("button", { name: /^Next$/i }).first();
  try {
    await next.waitFor({ state: "visible", timeout: 5_000 });
    await next.click();
    return true;
  } catch {
    return false;
  }
}

async function instagramComposerVisible(page) {
  const selectors = [
    "textarea",
    '[contenteditable="true"]',
    '[role="textbox"]',
    'div[aria-label*="Write a caption" i]',
    'div[aria-label*="caption" i]',
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      try {
        if (await locator.isVisible({ timeout: 500 })) {
          return true;
        }
      } catch {
        // Continue.
      }
    }
  }
  return false;
}

async function dismissInstagramInterruptions(page) {
  const okButton = page.getByRole("button", { name: /^OK$/i }).first();
  try {
    if (await okButton.isVisible({ timeout: 2_000 })) {
      await okButton.click();
      return "ok";
    }
  } catch {
    // Continue to other dismissal options.
  }

  return clickFirstVisible(page, [
    'button:has-text("OK")',
    'div[role="button"]:has-text("OK")',
    'button:has-text("Not now")',
    'div[role="button"]:has-text("Not now")',
    'button:has-text("Dismiss")',
    'div[role="button"]:has-text("Dismiss")',
  ]);
}

async function maybeSelectInstagramPostType(page) {
  const postTrigger = page.getByText(/^Post$/i).first();
  if (await postTrigger.count()) {
    try {
      if (await postTrigger.isVisible({ timeout: 2_000 })) {
        await postTrigger.click();
        return "Post";
      }
    } catch {
      // Fall through to selector-based attempts.
    }
  }

  return clickFirstVisible(page, [
    'div[role="button"]:has-text("Post")',
    'a[role="link"]:has-text("Post")',
    'span:has-text("Post")',
    'text=/^Post$/i',
  ]);
}

async function runInstagram(packet, page, outputDir) {
  const previewPath = requireString(packet?.selected_assets?.preview_path, "instagram selected_assets.preview_path");
  const captionText = requireString(packet?.copy?.caption, "instagram copy.caption");

  await withTimeout(page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded", timeout: 20_000 }), 25_000, "Instagram navigation");
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});

  const loginField = page.locator('input[name="username"], input[name="password"]').first();
  const loginPrompt = page.locator('text=/log in|sign up/i').first();
  if (await loginField.count() || await loginPrompt.count()) {
    const screenshotPath = await capture(page, outputDir, "instagram-login-required");
    return {
      channel: "instagram",
      status: "login_required",
      stopBefore: "login",
      screenshotPath,
      reason: "Instagram session is not authenticated in this browser context.",
    };
  }

  const createClicked = await clickFirstVisible(page, [
    'svg[aria-label="New post"]',
    'a[role="link"]:has-text("Create")',
    'div[role="button"]:has-text("Create")',
    'span:has-text("Create")',
  ]);
  if (!createClicked) {
    const screenshotPath = await capture(page, outputDir, "instagram-create-missing");
    return {
      channel: "instagram",
      status: "create_flow_unavailable",
      stopBefore: "create_flow",
      screenshotPath,
      reason: "Could not find the Instagram create flow trigger in the current browser context.",
    };
  }

  await maybeSelectInstagramPostType(page);

  const fileInput = page.locator('input[type="file"]').first();
  try {
    await fileInput.waitFor({ state: "attached", timeout: 10_000 });
  } catch {
    const screenshotPath = await capture(page, outputDir, "instagram-file-input-missing");
    return {
      channel: "instagram",
      status: "create_flow_unavailable",
      stopBefore: "upload",
      screenshotPath,
      reason: "Instagram create flow opened, but the upload control was not available.",
    };
  }
  await fileInput.setInputFiles(previewPath);

  for (let i = 0; i < 5; i += 1) {
    await dismissInstagramInterruptions(page);

    if (await instagramComposerVisible(page)) {
      break;
    }

    const shareVisible = await page.getByRole("button", { name: /^Share$/i }).first().isVisible({ timeout: 500 }).catch(() => false);
    if (shareVisible) {
      break;
    }

    const advanced = await maybeAdvanceInstagramStep(page);
    if (!advanced) {
      await page.waitForTimeout(1_000);
    }
  }

  const caption = await waitForInstagramComposer(page);
  await fillInstagramCaption(caption, captionText);

  const finalShare = page.getByRole("button", { name: /^Share$/i }).first();
  await finalShare.waitFor({ state: "visible", timeout: 20_000 });
  const screenshotPath = await capture(page, outputDir, "instagram-final-review");
  return {
    channel: "instagram",
    status: "ready_for_manual_review",
    stopBefore: "share_button",
    screenshotPath,
    selectedAsset: previewPath,
  };
}

async function runMailchimp(packet, page, outputDir) {
  await withTimeout(page.goto("https://login.mailchimp.com/", { waitUntil: "domcontentloaded", timeout: 20_000 }), 25_000, "Mailchimp navigation");
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});

  const verificationText = page.locator("text=/verification code|log in to continue|check your email/i").first();
  if (await verificationText.count()) {
    const screenshotPath = await capture(page, outputDir, "mailchimp-verification-required");
    return {
      channel: "mailchimp",
      status: "blocked_on_verification",
      stopBefore: "verification_gate",
      screenshotPath,
      reason: "Mailchimp requires account verification before the draft flow can continue.",
    };
  }

  const emailField = page.locator('input[type="email"], input[name="username"], input[name="email"]').first();
  if (await emailField.count()) {
    const screenshotPath = await capture(page, outputDir, "mailchimp-login-required");
    return {
      channel: "mailchimp",
      status: "login_required",
      stopBefore: "login",
      screenshotPath,
      reason: "Mailchimp session is not authenticated in this browser context.",
    };
  }

  const screenshotPath = await capture(page, outputDir, "mailchimp-dashboard");
  return {
    channel: "mailchimp",
    status: "authenticated_but_flow_not_automated",
    stopBefore: "send_button",
    screenshotPath,
    reason: "Authenticated Mailchimp session detected, but the draft-campaign creation flow still needs account-specific navigation wiring.",
    copy: packet?.copy ?? null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const packetPath = path.resolve(args.packet);
  const packet = readJson(packetPath);
  const channel = (args.channel || packet.channel || "").toLowerCase();
  if (!channel) {
    throw new Error("Could not resolve channel from packet or --channel");
  }

  await ensureOutputDir(args.outputDir);

  const launchOptions = {
    headless: args.headless,
    channel: "chrome",
  };
  const browserType = await loadPlaywright();
  const contextArgs = [];
  if (args.chromeProfileDirectory) {
    contextArgs.push(`--profile-directory=${args.chromeProfileDirectory}`);
  }
  if (contextArgs.length) {
    launchOptions.args = contextArgs;
  }
  const browserLaunchTimeoutMs = 60_000;

  let context;
  let page = null;
  let result;
  try {
    if (args.chromeUserDataDir) {
      let userDataDir = path.resolve(args.chromeUserDataDir);
      if (args.cloneChromeProfile) {
        if (!args.chromeProfileDirectory) {
          throw new Error("--clone-chrome-profile requires --chrome-profile-directory");
        }
        userDataDir = await withTimeout(
          cloneChromeProfile(userDataDir, args.chromeProfileDirectory),
          30_000,
          "Chrome profile clone",
        );
      }
      context = await withTimeout(
        browserType.launchPersistentContext(userDataDir, launchOptions),
        browserLaunchTimeoutMs,
        "Chrome profile launch",
      );
    } else if (args.profileDir) {
      context = await withTimeout(
        browserType.launchPersistentContext(path.resolve(args.profileDir), launchOptions),
        browserLaunchTimeoutMs,
        "Playwright profile launch",
      );
    } else {
      let browser;
      try {
        browser = await withTimeout(browserType.launch(launchOptions), browserLaunchTimeoutMs, "Browser launch");
      } catch (error) {
        browser = await withTimeout(
          browserType.launch(withoutChromeChannel(launchOptions)),
          browserLaunchTimeoutMs,
          "Browser launch fallback",
        );
      }
      const contextOptions = {};
      if (args.storageState) {
        contextOptions.storageState = path.resolve(args.storageState);
      }
      context = await browser.newContext(contextOptions);
    }

    context.setDefaultTimeout(20_000);
    context.setDefaultNavigationTimeout(20_000);
    page = context.pages()[0] ?? await context.newPage();

    if (channel === "instagram") {
      result = await withTimeout(runInstagram(packet, page, args.outputDir), 60_000, "Instagram dry run");
    } else if (channel === "mailchimp") {
      result = await withTimeout(runMailchimp(packet, page, args.outputDir), 60_000, "Mailchimp dry run");
    } else {
      throw new Error(`Unsupported channel: ${channel}`);
    }
  } catch (error) {
    const screenshotPath = page ? await capture(page, args.outputDir, `${channel}-automation-error`) : null;
    result = {
      channel,
      status: "automation_error",
      stopBefore: "unknown",
      screenshotPath,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (context && args.saveStorageState) {
      await context.storageState({ path: path.resolve(args.saveStorageState) });
    }
    if (context) {
      await context.close();
    }
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
