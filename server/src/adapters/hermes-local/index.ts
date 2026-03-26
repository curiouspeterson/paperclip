import {
  execute as hermesExecute,
  sessionCodec,
  testEnvironment,
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
  normalizeHermesLocalPaperclipConfig,
} from "./paperclip.js";

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const normalizedConfig = normalizeHermesLocalPaperclipConfig(ctx.config);
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

export { testEnvironment };
export { sessionCodec };
export type HermesLocalSessionCodec = AdapterSessionCodec;
export type HermesLocalEnvironmentTestContext = AdapterEnvironmentTestContext;
export type HermesLocalEnvironmentTestResult = AdapterEnvironmentTestResult;
