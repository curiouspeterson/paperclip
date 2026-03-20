// ---------------------------------------------------------------------------
// OpenClaw gateway — join-defaults normalization
// Owns all OpenClaw-specific join payload shaping and device key generation
// so the server route layer does not need to branch on adapter type.
// ---------------------------------------------------------------------------
import { generateKeyPairSync } from "node:crypto";
import type { AdapterJoinDefaultsInput, AdapterJoinDefaultsResult } from "@paperclipai/adapter-utils";

// ---------------------------------------------------------------------------
// Header normalization helpers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeHeaderValue(value: unknown, depth: number = 0): string | null {
  const direct = nonEmptyTrimmedString(value);
  if (direct) return direct;
  if (!isPlainObject(value) || depth >= 3) return null;

  const candidateKeys = [
    "value", "token", "secret", "apiKey", "api_key", "auth", "authToken",
    "auth_token", "accessToken", "access_token", "authorization", "bearer",
    "header", "raw", "text", "string",
  ];
  for (const key of candidateKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const normalized = normalizeHeaderValue((value as Record<string, unknown>)[key], depth + 1);
    if (normalized) return normalized;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 1) {
    const [singleKey, singleValue] = entries[0]!;
    const normalizedKey = singleKey.trim().toLowerCase();
    if (
      normalizedKey !== "type" &&
      normalizedKey !== "version" &&
      normalizedKey !== "secretid" &&
      normalizedKey !== "secret_id"
    ) {
      const normalized = normalizeHeaderValue(singleValue, depth + 1);
      if (normalized) return normalized;
    }
  }
  return null;
}

function extractHeaderEntries(input: unknown): Array<[string, unknown]> {
  if (isPlainObject(input)) return Object.entries(input);
  if (!Array.isArray(input)) return [];

  const entries: Array<[string, unknown]> = [];
  for (const item of input) {
    if (Array.isArray(item)) {
      const key = nonEmptyTrimmedString(item[0]);
      if (!key) continue;
      entries.push([key, item[1]]);
      continue;
    }
    if (!isPlainObject(item)) continue;

    const mapped = item as Record<string, unknown>;
    const explicitKey =
      nonEmptyTrimmedString(mapped.key) ??
      nonEmptyTrimmedString(mapped.name) ??
      nonEmptyTrimmedString(mapped.header);
    if (explicitKey) {
      const explicitValue = Object.prototype.hasOwnProperty.call(mapped, "value")
        ? mapped.value
        : Object.prototype.hasOwnProperty.call(mapped, "token")
        ? mapped.token
        : Object.prototype.hasOwnProperty.call(mapped, "secret")
        ? mapped.secret
        : mapped;
      entries.push([explicitKey, explicitValue]);
      continue;
    }

    const singleEntry = Object.entries(mapped);
    if (singleEntry.length === 1) {
      entries.push(singleEntry[0] as [string, unknown]);
    }
  }
  return entries;
}

function normalizeHeaderMap(input: unknown): Record<string, string> | undefined {
  const entries = extractHeaderEntries(input);
  if (entries.length === 0) return undefined;

  const out: Record<string, string> = {};
  for (const [key, value] of entries) {
    const normalizedValue = normalizeHeaderValue(value);
    if (!normalizedValue) continue;
    const trimmedKey = key.trim();
    const trimmedValue = normalizedValue.trim();
    if (!trimmedKey || !trimmedValue) continue;
    out[trimmedKey] = trimmedValue;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function headerMapHasKeyIgnoreCase(
  headers: Record<string, string>,
  targetKey: string,
): boolean {
  const normalizedTarget = targetKey.trim().toLowerCase();
  return Object.keys(headers).some((key) => key.trim().toLowerCase() === normalizedTarget);
}

function headerMapGetIgnoreCase(
  headers: Record<string, string>,
  targetKey: string,
): string | null {
  const normalizedTarget = targetKey.trim().toLowerCase();
  const key = Object.keys(headers).find(
    (candidate) => candidate.trim().toLowerCase() === normalizedTarget,
  );
  if (!key) return null;
  const value = headers[key];
  return typeof value === "string" ? value : null;
}

function tokenFromAuthorizationHeader(rawHeader: string | null): string | null {
  const trimmed = nonEmptyTrimmedString(rawHeader);
  if (!trimmed) return null;
  const bearerMatch = trimmed.match(/^bearer\s+(.+)$/i);
  if (bearerMatch?.[1]) return nonEmptyTrimmedString(bearerMatch[1]);
  return trimmed;
}

function parseBooleanLike(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return null;
}

function generateEd25519PrivateKeyPem(): string {
  const generated = generateKeyPairSync("ed25519");
  return generated.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

// ---------------------------------------------------------------------------
// normalizeJoinDefaults — the ServerAdapterModule hook
// ---------------------------------------------------------------------------

export async function normalizeJoinDefaults(
  input: AdapterJoinDefaultsInput,
): Promise<AdapterJoinDefaultsResult> {
  const diagnostics: AdapterJoinDefaultsResult["diagnostics"] = [];
  const fatalErrors: string[] = [];

  if (!isPlainObject(input.defaultsPayload)) {
    diagnostics.push({
      code: "openclaw_gateway_defaults_missing",
      level: "warn",
      message: "agentDefaultsPayload is required for adapterType=openclaw_gateway.",
      hint: "Include agentDefaultsPayload.url and headers.x-openclaw-token for OpenClaw gateway joins.",
    });
    fatalErrors.push("agentDefaultsPayload is required for adapterType=openclaw_gateway");
    return { normalized: null, diagnostics, fatalErrors };
  }

  const defaults = input.defaultsPayload as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};

  // Gateway URL
  const rawGatewayUrl = nonEmptyTrimmedString(defaults.url);
  if (!rawGatewayUrl) {
    diagnostics.push({
      code: "openclaw_gateway_url_missing",
      level: "warn",
      message: "OpenClaw gateway URL is missing.",
      hint: "Set agentDefaultsPayload.url to ws:// or wss:// gateway URL.",
    });
    fatalErrors.push("agentDefaultsPayload.url is required");
  } else {
    try {
      const gatewayUrl = new URL(rawGatewayUrl);
      if (gatewayUrl.protocol !== "ws:" && gatewayUrl.protocol !== "wss:") {
        diagnostics.push({
          code: "openclaw_gateway_url_protocol",
          level: "warn",
          message: `OpenClaw gateway URL must use ws:// or wss:// (got ${gatewayUrl.protocol}).`,
        });
        fatalErrors.push(
          "agentDefaultsPayload.url must use ws:// or wss:// for openclaw_gateway",
        );
      } else {
        normalized.url = gatewayUrl.toString();
        diagnostics.push({
          code: "openclaw_gateway_url_configured",
          level: "info",
          message: `Gateway endpoint set to ${gatewayUrl.toString()}`,
        });
      }
    } catch {
      diagnostics.push({
        code: "openclaw_gateway_url_invalid",
        level: "warn",
        message: `Invalid OpenClaw gateway URL: ${rawGatewayUrl}`,
      });
      fatalErrors.push("agentDefaultsPayload.url is not a valid URL");
    }
  }

  // Gateway auth headers
  const headers = normalizeHeaderMap(defaults.headers) ?? {};

  // Also fold in inbound headers from the join request (e.g. forwarded by the CLI)
  if (input.inboundHeaders) {
    const inboundToken = nonEmptyTrimmedString(input.inboundHeaders["x-openclaw-token"]);
    const inboundAuth = nonEmptyTrimmedString(input.inboundHeaders["x-openclaw-auth"]);
    if (inboundToken && !headerMapHasKeyIgnoreCase(headers, "x-openclaw-token")) {
      headers["x-openclaw-token"] = inboundToken;
    }
    if (inboundAuth && !headerMapHasKeyIgnoreCase(headers, "x-openclaw-auth")) {
      headers["x-openclaw-auth"] = inboundAuth;
    }
  }

  const gatewayToken =
    headerMapGetIgnoreCase(headers, "x-openclaw-token") ??
    headerMapGetIgnoreCase(headers, "x-openclaw-auth") ??
    tokenFromAuthorizationHeader(headerMapGetIgnoreCase(headers, "authorization"));
  if (gatewayToken && !headerMapHasKeyIgnoreCase(headers, "x-openclaw-token")) {
    headers["x-openclaw-token"] = gatewayToken;
  }
  if (Object.keys(headers).length > 0) {
    normalized.headers = headers;
  }

  if (!gatewayToken) {
    diagnostics.push({
      code: "openclaw_gateway_auth_header_missing",
      level: "warn",
      message: "Gateway auth token is missing from agent defaults.",
      hint: "Set agentDefaultsPayload.headers.x-openclaw-token (or legacy x-openclaw-auth).",
    });
    fatalErrors.push(
      "agentDefaultsPayload.headers.x-openclaw-token (or x-openclaw-auth) is required",
    );
  } else if (gatewayToken.trim().length < 16) {
    diagnostics.push({
      code: "openclaw_gateway_auth_header_too_short",
      level: "warn",
      message: `Gateway auth token appears too short (${gatewayToken.trim().length} chars).`,
      hint: "Use the full gateway auth token from ~/.openclaw/openclaw.json (typically long random string).",
    });
    fatalErrors.push(
      "agentDefaultsPayload.headers.x-openclaw-token is too short; expected a full gateway token",
    );
  } else {
    diagnostics.push({
      code: "openclaw_gateway_auth_header_configured",
      level: "info",
      message: "Gateway auth token configured.",
    });
  }

  // Payload template
  if (isPlainObject(defaults.payloadTemplate)) {
    normalized.payloadTemplate = defaults.payloadTemplate;
  }

  // Device auth / device key
  const parsedDisableDeviceAuth = parseBooleanLike(defaults.disableDeviceAuth);
  const disableDeviceAuth = parsedDisableDeviceAuth === true;
  if (parsedDisableDeviceAuth !== null) {
    normalized.disableDeviceAuth = parsedDisableDeviceAuth;
  }

  const configuredDevicePrivateKeyPem = nonEmptyTrimmedString(defaults.devicePrivateKeyPem);
  if (configuredDevicePrivateKeyPem) {
    normalized.devicePrivateKeyPem = configuredDevicePrivateKeyPem;
    diagnostics.push({
      code: "openclaw_gateway_device_key_configured",
      level: "info",
      message: "Gateway device key configured. Pairing approvals should persist for this agent.",
    });
  } else if (!disableDeviceAuth) {
    try {
      normalized.devicePrivateKeyPem = generateEd25519PrivateKeyPem();
      diagnostics.push({
        code: "openclaw_gateway_device_key_generated",
        level: "info",
        message:
          "Generated persistent gateway device key for this join. Pairing approvals should persist for this agent.",
      });
    } catch (err) {
      diagnostics.push({
        code: "openclaw_gateway_device_key_generate_failed",
        level: "warn",
        message: `Failed to generate gateway device key: ${
          err instanceof Error ? err.message : String(err)
        }`,
        hint: "Set agentDefaultsPayload.devicePrivateKeyPem explicitly or set disableDeviceAuth=true.",
      });
      fatalErrors.push(
        "Failed to generate gateway device key. Set devicePrivateKeyPem or disableDeviceAuth=true.",
      );
    }
  }

  // Timing overrides
  const waitTimeoutMs =
    typeof defaults.waitTimeoutMs === "number" && Number.isFinite(defaults.waitTimeoutMs)
      ? Math.floor(defaults.waitTimeoutMs)
      : typeof defaults.waitTimeoutMs === "string"
      ? Number.parseInt((defaults.waitTimeoutMs as string).trim(), 10)
      : NaN;
  if (Number.isFinite(waitTimeoutMs) && waitTimeoutMs > 0) {
    normalized.waitTimeoutMs = waitTimeoutMs;
  }

  const timeoutSec =
    typeof defaults.timeoutSec === "number" && Number.isFinite(defaults.timeoutSec)
      ? Math.floor(defaults.timeoutSec)
      : typeof defaults.timeoutSec === "string"
      ? Number.parseInt((defaults.timeoutSec as string).trim(), 10)
      : NaN;
  if (Number.isFinite(timeoutSec) && timeoutSec > 0) {
    normalized.timeoutSec = timeoutSec;
  }

  // Session key strategy
  const sessionKeyStrategy = nonEmptyTrimmedString(defaults.sessionKeyStrategy);
  if (
    sessionKeyStrategy === "fixed" ||
    sessionKeyStrategy === "issue" ||
    sessionKeyStrategy === "run"
  ) {
    normalized.sessionKeyStrategy = sessionKeyStrategy;
  }

  const sessionKey = nonEmptyTrimmedString(defaults.sessionKey);
  if (sessionKey) normalized.sessionKey = sessionKey;

  // Role and scopes
  const role = nonEmptyTrimmedString(defaults.role);
  if (role) normalized.role = role;

  if (Array.isArray(defaults.scopes)) {
    const scopes = defaults.scopes
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (scopes.length > 0) normalized.scopes = scopes;
  }

  // Paperclip API URL override
  const rawPaperclipApiUrl =
    typeof defaults.paperclipApiUrl === "string"
      ? defaults.paperclipApiUrl.trim()
      : typeof input.paperclipApiUrl === "string"
      ? input.paperclipApiUrl.trim()
      : "";
  if (rawPaperclipApiUrl) {
    try {
      const parsedPaperclipApiUrl = new URL(rawPaperclipApiUrl);
      if (
        parsedPaperclipApiUrl.protocol !== "http:" &&
        parsedPaperclipApiUrl.protocol !== "https:"
      ) {
        diagnostics.push({
          code: "openclaw_gateway_paperclip_api_url_protocol",
          level: "warn",
          message: `paperclipApiUrl must use http:// or https:// (got ${parsedPaperclipApiUrl.protocol}).`,
        });
      } else {
        normalized.paperclipApiUrl = parsedPaperclipApiUrl.toString();
        diagnostics.push({
          code: "openclaw_gateway_paperclip_api_url_configured",
          level: "info",
          message: `paperclipApiUrl set to ${parsedPaperclipApiUrl.toString()}`,
        });
      }
    } catch {
      diagnostics.push({
        code: "openclaw_gateway_paperclip_api_url_invalid",
        level: "warn",
        message: `Invalid paperclipApiUrl: ${rawPaperclipApiUrl}`,
      });
    }
  }

  return { normalized, diagnostics, fatalErrors };
}

// ---------------------------------------------------------------------------
// normalizeConfigForPersistence — device key injection on agent create/update
// ---------------------------------------------------------------------------

export function normalizeOpenClawConfigForPersistence(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const disableDeviceAuth = parseBooleanLike(config.disableDeviceAuth) === true;
  if (disableDeviceAuth) return config;
  if (nonEmptyTrimmedString(config.devicePrivateKeyPem)) return config;
  return { ...config, devicePrivateKeyPem: generateEd25519PrivateKeyPem() };
}

// ---------------------------------------------------------------------------
// buildJoinDefaultsPayloadForAccept (used during accept flow)
// ---------------------------------------------------------------------------

export function buildJoinDefaultsPayloadForAccept(input: {
  adapterType: string | null;
  defaultsPayload: unknown;
  paperclipApiUrl?: unknown;
  inboundOpenClawAuthHeader?: string | null;
  inboundOpenClawTokenHeader?: string | null;
}): unknown {
  if (input.adapterType !== "openclaw_gateway") return input.defaultsPayload;

  const merged = isPlainObject(input.defaultsPayload)
    ? { ...(input.defaultsPayload as Record<string, unknown>) }
    : ({} as Record<string, unknown>);

  if (!nonEmptyTrimmedString(merged.paperclipApiUrl)) {
    const legacyPaperclipApiUrl = nonEmptyTrimmedString(input.paperclipApiUrl);
    if (legacyPaperclipApiUrl) merged.paperclipApiUrl = legacyPaperclipApiUrl;
  }
  const mergedHeaders = normalizeHeaderMap(merged.headers) ?? {};

  const inboundOpenClawAuthHeader = nonEmptyTrimmedString(input.inboundOpenClawAuthHeader);
  const inboundOpenClawTokenHeader = nonEmptyTrimmedString(input.inboundOpenClawTokenHeader);
  if (inboundOpenClawTokenHeader && !headerMapHasKeyIgnoreCase(mergedHeaders, "x-openclaw-token")) {
    mergedHeaders["x-openclaw-token"] = inboundOpenClawTokenHeader;
  }
  if (inboundOpenClawAuthHeader && !headerMapHasKeyIgnoreCase(mergedHeaders, "x-openclaw-auth")) {
    mergedHeaders["x-openclaw-auth"] = inboundOpenClawAuthHeader;
  }

  if (Object.keys(mergedHeaders).length > 0) {
    merged.headers = mergedHeaders;
  } else {
    delete merged.headers;
  }

  const discoveredToken =
    headerMapGetIgnoreCase(mergedHeaders, "x-openclaw-token") ??
    headerMapGetIgnoreCase(mergedHeaders, "x-openclaw-auth") ??
    tokenFromAuthorizationHeader(headerMapGetIgnoreCase(mergedHeaders, "authorization"));
  if (discoveredToken && !headerMapHasKeyIgnoreCase(mergedHeaders, "x-openclaw-token")) {
    mergedHeaders["x-openclaw-token"] = discoveredToken;
  }

  return Object.keys(merged).length > 0 ? merged : null;
}

// ---------------------------------------------------------------------------
// mergeJoinDefaultsPayloadForReplay
// ---------------------------------------------------------------------------

export function mergeJoinDefaultsPayloadForReplay(
  existingDefaultsPayload: unknown,
  nextDefaultsPayload: unknown,
): unknown {
  if (!isPlainObject(existingDefaultsPayload) && !isPlainObject(nextDefaultsPayload)) {
    return nextDefaultsPayload ?? existingDefaultsPayload;
  }
  if (!isPlainObject(existingDefaultsPayload)) return nextDefaultsPayload;
  if (!isPlainObject(nextDefaultsPayload)) return existingDefaultsPayload;

  const merged: Record<string, unknown> = {
    ...(existingDefaultsPayload as Record<string, unknown>),
    ...(nextDefaultsPayload as Record<string, unknown>),
  };

  const existingHeaders = normalizeHeaderMap(
    (existingDefaultsPayload as Record<string, unknown>).headers,
  );
  const nextHeaders = normalizeHeaderMap(
    (nextDefaultsPayload as Record<string, unknown>).headers,
  );
  if (existingHeaders || nextHeaders) {
    merged.headers = { ...(existingHeaders ?? {}), ...(nextHeaders ?? {}) };
  } else if (Object.prototype.hasOwnProperty.call(merged, "headers")) {
    delete merged.headers;
  }

  return merged;
}
