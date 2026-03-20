import { randomUUID } from "node:crypto";
import type { Db } from "@paperclipai/db";
import type { AdapterEnvironmentTestResult } from "@paperclipai/adapter-utils";
import { findServerAdapter, listAdapterModels } from "../adapters/index.js";
import { secretService } from "./secrets.js";
import { runClaudeLogin } from "@paperclipai/adapter-claude-local/server";

export function adapterOperationService(db: Db) {
  const secrets = secretService(db);

  async function listModels(type: string): Promise<{ id: string; label: string }[]> {
    return listAdapterModels(type);
  }

  async function testEnvironment(
    type: string,
    companyId: string,
    inputConfig: Record<string, unknown>,
    opts: { strictSecretsMode: boolean },
  ): Promise<{ found: false } | { found: true; result: AdapterEnvironmentTestResult }> {
    const adapter = findServerAdapter(type);
    if (!adapter) return { found: false };
    const normalizedConfig = await secrets.normalizeAdapterConfigForPersistence(
      companyId,
      inputConfig,
      { strictMode: opts.strictSecretsMode },
    );
    const { config: runtimeConfig } = await secrets.resolveAdapterConfigForRuntime(
      companyId,
      normalizedConfig,
    );
    const result = await adapter.testEnvironment({ companyId, adapterType: type, config: runtimeConfig });
    return { found: true, result };
  }

  async function claudeLogin(input: {
    agentId: string;
    companyId: string;
    agentName: string;
    adapterType: string;
    adapterConfig: unknown;
  }): Promise<unknown> {
    const config = (input.adapterConfig ?? {}) as Record<string, unknown>;
    const { config: runtimeConfig } = await secrets.resolveAdapterConfigForRuntime(
      input.companyId,
      config,
    );
    return runClaudeLogin({
      runId: `claude-login-${randomUUID()}`,
      agent: {
        id: input.agentId,
        companyId: input.companyId,
        name: input.agentName,
        adapterType: input.adapterType,
        adapterConfig: input.adapterConfig,
      },
      config: runtimeConfig,
    });
  }

  return { listModels, testEnvironment, claudeLogin };
}
