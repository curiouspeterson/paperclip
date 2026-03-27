import {
  execute as hermesExecute,
  sessionCodec,
  testEnvironment as hermesTestEnvironment,
} from "hermes-paperclip-adapter/server";
import type {
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterSessionCodec,
} from "../types.js";
import {
  normalizeHermesLocalExecutionResult,
  normalizeHermesLocalPaperclipRuntimeConfig,
} from "./paperclip.js";

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const normalizedConfig = await normalizeHermesLocalPaperclipRuntimeConfig(ctx.config, {
    companyId: ctx.agent.companyId,
    agentId: ctx.agent.id,
    onLog: ctx.onLog,
  });
  const result = await hermesExecute({
    ...ctx,
    config: normalizedConfig,
    agent: {
      ...ctx.agent,
      adapterConfig: normalizedConfig,
    },
  });
  return normalizeHermesLocalExecutionResult(result);
}

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const normalizedConfig = await normalizeHermesLocalPaperclipRuntimeConfig(
    (ctx.config ?? null) as Record<string, unknown> | null,
    {
      companyId: ctx.companyId,
    },
  );
  return hermesTestEnvironment({
    ...ctx,
    config: normalizedConfig,
  });
}

export { sessionCodec };
export type HermesLocalSessionCodec = AdapterSessionCodec;
export type HermesLocalEnvironmentTestContext = AdapterEnvironmentTestContext;
export type HermesLocalEnvironmentTestResult = AdapterEnvironmentTestResult;
