import type { PluginContext, ScopeKey } from "@paperclipai/plugin-sdk";
import { STATE_KEYS, STATE_NAMESPACES } from "./constants.js";

export const WORKFLOW_TEMPLATES = [
  {
    key: "episode-pipeline",
    displayName: "Episode Pipeline",
    description: "Track transcript, review, and publishing stages for a full episode.",
  },
  {
    key: "clips-social",
    displayName: "Clips + Social",
    description: "Manage short-form clip generation, copy drafting, and review.",
  },
  {
    key: "newsletter-promo",
    displayName: "Newsletter Promotion",
    description: "Coordinate newsletter copy, assets, and send readiness.",
  },
] as const;

export const WORKFLOW_STATUSES = ["draft", "active", "archived"] as const;

export type PodcastWorkflowTemplateKey = (typeof WORKFLOW_TEMPLATES)[number]["key"];
export type PodcastWorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export interface PodcastWorkflowRecord {
  version: 1;
  id: string;
  companyId: string;
  name: string;
  slug: string;
  templateKey: PodcastWorkflowTemplateKey;
  status: PodcastWorkflowStatus;
  description: string;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PodcastWorkflowSummary {
  id: string;
  companyId: string;
  name: string;
  slug: string;
  templateKey: PodcastWorkflowTemplateKey;
  status: PodcastWorkflowStatus;
  description: string;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PodcastWorkflowIndex {
  version: 1;
  workflowIds: string[];
  updatedAt: string;
}

export function listWorkflowTemplates() {
  return WORKFLOW_TEMPLATES.map((template) => ({ ...template }));
}

export function toWorkflowSummary(workflow: PodcastWorkflowRecord): PodcastWorkflowSummary {
  return {
    id: workflow.id,
    companyId: workflow.companyId,
    name: workflow.name,
    slug: workflow.slug,
    templateKey: workflow.templateKey,
    status: workflow.status,
    description: workflow.description,
    projectId: workflow.projectId,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
  };
}

export function isWorkflowTemplateKey(value: unknown): value is PodcastWorkflowTemplateKey {
  return typeof value === "string" && WORKFLOW_TEMPLATES.some((template) => template.key === value);
}

export function isWorkflowStatus(value: unknown): value is PodcastWorkflowStatus {
  return typeof value === "string" && WORKFLOW_STATUSES.includes(value as PodcastWorkflowStatus);
}

export function slugifyWorkflowName(value: string): string {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : "workflow";
}

export function normalizeOptionalString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeNullableString(value: unknown): string | null {
  const normalized = normalizeOptionalString(value);
  return normalized.length > 0 ? normalized : null;
}

function workflowIndexKey(companyId: string): ScopeKey {
  return {
    scopeKind: "company",
    scopeId: companyId,
    namespace: STATE_NAMESPACES.workflowIndex,
    stateKey: STATE_KEYS.workflowIndex,
  };
}

function workflowRecordKey(companyId: string, workflowId: string): ScopeKey {
  return {
    scopeKind: "company",
    scopeId: companyId,
    namespace: STATE_NAMESPACES.workflowRecord,
    stateKey: workflowId,
  };
}

async function readWorkflowIndex(ctx: PluginContext, companyId: string): Promise<PodcastWorkflowIndex> {
  const stored = await ctx.state.get(workflowIndexKey(companyId));
  if (
    stored
    && typeof stored === "object"
    && (stored as PodcastWorkflowIndex).version === 1
    && Array.isArray((stored as PodcastWorkflowIndex).workflowIds)
  ) {
    return {
      version: 1,
      workflowIds: [...(stored as PodcastWorkflowIndex).workflowIds],
      updatedAt:
        typeof (stored as PodcastWorkflowIndex).updatedAt === "string"
          ? (stored as PodcastWorkflowIndex).updatedAt
          : new Date().toISOString(),
    };
  }

  return {
    version: 1,
    workflowIds: [],
    updatedAt: new Date().toISOString(),
  };
}

async function writeWorkflowIndex(ctx: PluginContext, companyId: string, workflowIds: string[]): Promise<void> {
  await ctx.state.set(workflowIndexKey(companyId), {
    version: 1,
    workflowIds,
    updatedAt: new Date().toISOString(),
  } satisfies PodcastWorkflowIndex);
}

export async function readWorkflowRecord(
  ctx: PluginContext,
  companyId: string,
  workflowId: string,
): Promise<PodcastWorkflowRecord | null> {
  const stored = await ctx.state.get(workflowRecordKey(companyId, workflowId));
  if (!stored || typeof stored !== "object") return null;

  const record = stored as Partial<PodcastWorkflowRecord>;
  if (
    record.version !== 1
    || record.id !== workflowId
    || record.companyId !== companyId
    || typeof record.name !== "string"
    || typeof record.slug !== "string"
    || !isWorkflowTemplateKey(record.templateKey)
    || !isWorkflowStatus(record.status)
    || typeof record.description !== "string"
    || (record.projectId !== null && typeof record.projectId !== "string")
    || typeof record.createdAt !== "string"
    || typeof record.updatedAt !== "string"
  ) {
    return null;
  }

  return {
    version: 1,
    id: record.id,
    companyId: record.companyId,
    name: record.name,
    slug: record.slug,
    templateKey: record.templateKey,
    status: record.status,
    description: record.description,
    projectId: record.projectId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export async function listWorkflowRecords(ctx: PluginContext, companyId: string): Promise<PodcastWorkflowRecord[]> {
  const index = await readWorkflowIndex(ctx, companyId);
  const workflows: PodcastWorkflowRecord[] = [];

  for (const workflowId of index.workflowIds) {
    const record = await readWorkflowRecord(ctx, companyId, workflowId);
    if (record) workflows.push(record);
  }

  if (workflows.length !== index.workflowIds.length) {
    await writeWorkflowIndex(ctx, companyId, workflows.map((workflow) => workflow.id));
  }

  return workflows;
}

export async function upsertWorkflowRecord(ctx: PluginContext, workflow: PodcastWorkflowRecord): Promise<void> {
  const existingIndex = await readWorkflowIndex(ctx, workflow.companyId);
  const nextIds = existingIndex.workflowIds.includes(workflow.id)
    ? existingIndex.workflowIds
    : [...existingIndex.workflowIds, workflow.id];

  await ctx.state.set(workflowRecordKey(workflow.companyId, workflow.id), workflow);
  await writeWorkflowIndex(ctx, workflow.companyId, nextIds);
}

export async function deleteWorkflowRecord(
  ctx: PluginContext,
  companyId: string,
  workflowId: string,
): Promise<void> {
  const existingIndex = await readWorkflowIndex(ctx, companyId);
  await ctx.state.delete(workflowRecordKey(companyId, workflowId));
  await writeWorkflowIndex(
    ctx,
    companyId,
    existingIndex.workflowIds.filter((entry) => entry !== workflowId),
  );
}
