import { randomUUID } from "node:crypto";
import { definePlugin, runWorker, type PluginContext } from "@paperclipai/plugin-sdk";
import { ACTION_KEYS, DATA_KEYS } from "./constants.js";
import {
  deleteWorkflowRecord,
  isWorkflowStatus,
  isWorkflowTemplateKey,
  listWorkflowRecords,
  listWorkflowTemplates,
  normalizeNullableString,
  normalizeOptionalString,
  readWorkflowRecord,
  slugifyWorkflowName,
  toWorkflowSummary,
  upsertWorkflowRecord,
  type PodcastWorkflowRecord,
} from "./workflows.js";

function requireCompanyId(params: Record<string, unknown>): string {
  const companyId = normalizeOptionalString(params.companyId);
  if (!companyId) {
    throw new Error("companyId is required");
  }
  return companyId;
}

function requireWorkflowId(params: Record<string, unknown>): string {
  const workflowId = normalizeOptionalString(params.workflowId);
  if (!workflowId) {
    throw new Error("workflowId is required");
  }
  return workflowId;
}

function requireWorkflowName(params: Record<string, unknown>): string {
  const name = normalizeOptionalString(params.name);
  if (!name) {
    throw new Error("name is required");
  }
  return name;
}

function requireTemplateKey(params: Record<string, unknown>) {
  if (!isWorkflowTemplateKey(params.templateKey)) {
    throw new Error("templateKey must be a supported workflow template");
  }
  return params.templateKey;
}

function resolveWorkflowStatus(params: Record<string, unknown>, existing: PodcastWorkflowRecord | null) {
  const rawStatus = params.status ?? existing?.status ?? "draft";
  if (!isWorkflowStatus(rawStatus)) {
    throw new Error("status must be one of draft, active, or archived");
  }
  return rawStatus;
}

async function registerWorkflowData(ctx: PluginContext) {
  ctx.data.register(DATA_KEYS.workflowTemplates, async () => {
    return {
      templates: listWorkflowTemplates(),
    };
  });

  ctx.data.register(DATA_KEYS.workflowList, async (params) => {
    const companyId = normalizeOptionalString(params.companyId);
    if (!companyId) {
      return {
        workflows: [],
        total: 0,
      };
    }
    const projectId = normalizeNullableString(params.projectId);
    const workflows = await listWorkflowRecords(ctx, companyId);
    const filtered = projectId
      ? workflows.filter((workflow) => workflow.projectId === projectId)
      : workflows;

    return {
      workflows: filtered.map(toWorkflowSummary),
      total: filtered.length,
    };
  });

  ctx.data.register(DATA_KEYS.workflowDetail, async (params) => {
    const companyId = normalizeOptionalString(params.companyId);
    const workflowId = normalizeOptionalString(params.workflowId);
    if (!companyId || !workflowId) {
      return { workflow: null };
    }
    const workflow = await readWorkflowRecord(ctx, companyId, workflowId);
    return { workflow };
  });
}

async function registerWorkflowActions(ctx: PluginContext) {
  ctx.actions.register(ACTION_KEYS.upsertWorkflow, async (params) => {
    const companyId = requireCompanyId(params);
    const requestedWorkflowId = normalizeNullableString(params.workflowId);
    const existing = requestedWorkflowId ? await readWorkflowRecord(ctx, companyId, requestedWorkflowId) : null;
    const name = requireWorkflowName(params);
    const now = new Date().toISOString();

    const workflow: PodcastWorkflowRecord = {
      version: 1,
      id: requestedWorkflowId ?? randomUUID(),
      companyId,
      name,
      slug: slugifyWorkflowName(name),
      templateKey: requireTemplateKey(params),
      status: resolveWorkflowStatus(params, existing),
      description: normalizeOptionalString(params.description),
      projectId: normalizeNullableString(params.projectId),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await upsertWorkflowRecord(ctx, workflow);
    ctx.logger.info(existing ? "Updated podcast workflow" : "Created podcast workflow", {
      companyId,
      workflowId: workflow.id,
      templateKey: workflow.templateKey,
    });

    return {
      workflow,
    };
  });

  ctx.actions.register(ACTION_KEYS.deleteWorkflow, async (params) => {
    const companyId = requireCompanyId(params);
    const workflowId = requireWorkflowId(params);
    await deleteWorkflowRecord(ctx, companyId, workflowId);
    ctx.logger.info("Deleted podcast workflow", { companyId, workflowId });
    return {
      ok: true,
      workflowId,
    };
  });
}

const plugin = definePlugin({
  async setup(ctx) {
    await registerWorkflowData(ctx);
    await registerWorkflowActions(ctx);
  },

  async onHealth() {
    return {
      status: "ok",
      message: "Podcast control plane plugin ready",
    };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
