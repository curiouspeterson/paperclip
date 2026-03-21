import type { BrowserAutomationConfig, BrowserAutomationProvider } from "./types.js";

const PROVIDERS = new Set<BrowserAutomationProvider>([
  "playwright",
  "page_agent",
  "lightpanda",
]);

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseBrowserAutomationConfig(
  input: Record<string, unknown>,
): BrowserAutomationConfig {
  const rawProvider = asTrimmedString(input.browserAutomationProvider);
  const provider = rawProvider && PROVIDERS.has(rawProvider as BrowserAutomationProvider)
    ? (rawProvider as BrowserAutomationProvider)
    : undefined;

  const config: BrowserAutomationConfig = {};
  if (provider) config.provider = provider;

  const command = asTrimmedString(input.browserAutomationCommand);
  if (command) config.command = command;

  const sessionProfile = asTrimmedString(input.browserSessionProfile);
  if (sessionProfile) config.sessionProfile = sessionProfile;

  if (typeof input.browserHeadless === "boolean") {
    config.headless = input.browserHeadless;
  }

  return config;
}

export function buildBrowserAutomationEnv(
  config: BrowserAutomationConfig,
): Record<string, string> {
  const env: Record<string, string> = {};
  if (config.provider) env.PAPERCLIP_BROWSER_AUTOMATION_PROVIDER = config.provider;
  if (config.command) env.PAPERCLIP_BROWSER_AUTOMATION_COMMAND = config.command;
  if (config.sessionProfile) {
    env.PAPERCLIP_BROWSER_SESSION_PROFILE = config.sessionProfile;
  }
  if (typeof config.headless === "boolean") {
    env.PAPERCLIP_BROWSER_HEADLESS = config.headless ? "1" : "0";
  }
  return env;
}
