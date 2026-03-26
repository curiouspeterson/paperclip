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
import { normalizeHermesLocalExecutionResult } from "./paperclip.js";

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const result = await hermesExecute(ctx);
  return normalizeHermesLocalExecutionResult(result);
}

export { testEnvironment };
export { sessionCodec };
export type HermesLocalSessionCodec = AdapterSessionCodec;
export type HermesLocalEnvironmentTestContext = AdapterEnvironmentTestContext;
export type HermesLocalEnvironmentTestResult = AdapterEnvironmentTestResult;
