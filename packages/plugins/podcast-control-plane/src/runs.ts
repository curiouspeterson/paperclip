import type { PluginContext, ScopeKey } from "@paperclipai/plugin-sdk";
import { STATE_NAMESPACES } from "./constants.js";
import type { PodcastWorkflowRecord } from "./workflows.js";
import type { PodcastWorkflowStageTemplate } from "./stages.js";

export interface PodcastWorkflowStageRunRecord {
  version: 1;
  id: string;
  companyId: string;
  workflowId: string;
  stageKey: string;
  issueId: string;
  commentId: string;
  projectId: string;
  projectWorkspaceId: string;
  summary: string;
  details: string;
  createdAt: string;
}

export interface PodcastWorkflowStageLatestRunRecord {
  version: 1;
  companyId: string;
  workflowId: string;
  stageKey: string;
  latestRunId: string;
  latestCommentId: string;
  latestIssueId: string;
  latestSummary: string;
  latestCreatedAt: string;
}

export interface PodcastWorkflowStageLastRunView {
  runId: string;
  commentId: string;
  issueId: string;
  summary: string;
  createdAt: string;
}

function workflowRunKey(companyId: string, runId: string): ScopeKey {
  return {
    scopeKind: "company",
    scopeId: companyId,
    namespace: STATE_NAMESPACES.workflowRun,
    stateKey: runId,
  };
}

function workflowStageLatestRunKey(companyId: string, workflowId: string, stageKey: string): ScopeKey {
  return {
    scopeKind: "company",
    scopeId: companyId,
    namespace: STATE_NAMESPACES.workflowStageRun,
    stateKey: `${workflowId}:${stageKey}`,
  };
}

export async function readWorkflowStageRunRecord(
  ctx: PluginContext,
  companyId: string,
  runId: string,
): Promise<PodcastWorkflowStageRunRecord | null> {
  const stored = await ctx.state.get(workflowRunKey(companyId, runId));
  if (!stored || typeof stored !== "object") return null;

  const record = stored as Partial<PodcastWorkflowStageRunRecord>;
  if (
    record.version !== 1
    || record.companyId !== companyId
    || typeof record.id !== "string"
    || typeof record.workflowId !== "string"
    || typeof record.stageKey !== "string"
    || typeof record.issueId !== "string"
    || typeof record.commentId !== "string"
    || typeof record.projectId !== "string"
    || typeof record.projectWorkspaceId !== "string"
    || typeof record.summary !== "string"
    || typeof record.details !== "string"
    || typeof record.createdAt !== "string"
  ) {
    return null;
  }

  return {
    version: 1,
    id: record.id,
    companyId,
    workflowId: record.workflowId,
    stageKey: record.stageKey,
    issueId: record.issueId,
    commentId: record.commentId,
    projectId: record.projectId,
    projectWorkspaceId: record.projectWorkspaceId,
    summary: record.summary,
    details: record.details,
    createdAt: record.createdAt,
  };
}

export async function writeWorkflowStageRunRecord(
  ctx: PluginContext,
  record: PodcastWorkflowStageRunRecord,
): Promise<void> {
  await ctx.state.set(workflowRunKey(record.companyId, record.id), record);
}

export async function readWorkflowStageLatestRunRecord(
  ctx: PluginContext,
  companyId: string,
  workflowId: string,
  stageKey: string,
): Promise<PodcastWorkflowStageLatestRunRecord | null> {
  const stored = await ctx.state.get(workflowStageLatestRunKey(companyId, workflowId, stageKey));
  if (!stored || typeof stored !== "object") return null;

  const record = stored as Partial<PodcastWorkflowStageLatestRunRecord>;
  if (
    record.version !== 1
    || record.companyId !== companyId
    || record.workflowId !== workflowId
    || record.stageKey !== stageKey
    || typeof record.latestRunId !== "string"
    || typeof record.latestCommentId !== "string"
    || typeof record.latestIssueId !== "string"
    || typeof record.latestSummary !== "string"
    || typeof record.latestCreatedAt !== "string"
  ) {
    return null;
  }

  return {
    version: 1,
    companyId,
    workflowId,
    stageKey,
    latestRunId: record.latestRunId,
    latestCommentId: record.latestCommentId,
    latestIssueId: record.latestIssueId,
    latestSummary: record.latestSummary,
    latestCreatedAt: record.latestCreatedAt,
  };
}

export async function writeWorkflowStageLatestRunRecord(
  ctx: PluginContext,
  record: PodcastWorkflowStageLatestRunRecord,
): Promise<void> {
  await ctx.state.set(workflowStageLatestRunKey(record.companyId, record.workflowId, record.stageKey), record);
}

export async function readWorkflowStageLastRunView(
  ctx: PluginContext,
  companyId: string,
  workflowId: string,
  stageKey: string,
): Promise<PodcastWorkflowStageLastRunView | null> {
  const latest = await readWorkflowStageLatestRunRecord(ctx, companyId, workflowId, stageKey);
  if (!latest) return null;
  const run = await readWorkflowStageRunRecord(ctx, companyId, latest.latestRunId);
  if (!run) return null;
  return {
    runId: run.id,
    commentId: run.commentId,
    issueId: run.issueId,
    summary: run.summary,
    createdAt: run.createdAt,
  };
}

export function createWorkflowStageRunRecord(input: {
  id: string;
  companyId: string;
  workflowId: string;
  stageKey: string;
  issueId: string;
  commentId: string;
  projectId: string;
  projectWorkspaceId: string;
  summary: string;
  details: string;
}): PodcastWorkflowStageRunRecord {
  return {
    version: 1,
    id: input.id,
    companyId: input.companyId,
    workflowId: input.workflowId,
    stageKey: input.stageKey,
    issueId: input.issueId,
    commentId: input.commentId,
    projectId: input.projectId,
    projectWorkspaceId: input.projectWorkspaceId,
    summary: input.summary,
    details: input.details,
    createdAt: new Date().toISOString(),
  };
}

export function createWorkflowStageLatestRunRecord(
  run: PodcastWorkflowStageRunRecord,
): PodcastWorkflowStageLatestRunRecord {
  return {
    version: 1,
    companyId: run.companyId,
    workflowId: run.workflowId,
    stageKey: run.stageKey,
    latestRunId: run.id,
    latestCommentId: run.commentId,
    latestIssueId: run.issueId,
    latestSummary: run.summary,
    latestCreatedAt: run.createdAt,
  };
}

export function buildWorkflowStageOutputCommentBody(input: {
  workflow: PodcastWorkflowRecord;
  stage: PodcastWorkflowStageTemplate;
  summary: string;
  details: string;
}): string {
  const sections = [
    `Podcast workflow update`,
    ``,
    `Workflow: ${input.workflow.name}`,
    `Stage: ${input.stage.displayName}`,
    ``,
    `Summary:`,
    input.summary,
  ];

  if (input.details.trim().length > 0) {
    sections.push("", "Details:", input.details.trim());
  }

  return sections.join("\n");
}
