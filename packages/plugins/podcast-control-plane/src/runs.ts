import type { PluginContext, ScopeKey } from "@paperclipai/plugin-sdk";
import { STATE_NAMESPACES } from "./constants.js";
import type { PodcastWorkflowRecord } from "./workflows.js";
import type { PodcastWorkflowStageTemplate } from "./stages.js";

export interface PodcastWorkflowArtifactReference {
  label: string;
  href: string;
}

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
  artifacts: PodcastWorkflowArtifactReference[];
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
  artifacts: PodcastWorkflowArtifactReference[];
  createdAt: string;
}

export interface PodcastWorkflowCommentAnnotationRecord {
  version: 1;
  companyId: string;
  workflowId: string;
  workflowName: string;
  stageKey: string;
  stageDisplayName: string;
  runId: string;
  issueId: string;
  commentId: string;
  summary: string;
  details: string;
  artifacts: PodcastWorkflowArtifactReference[];
  createdAt: string;
}

function isArtifactReference(value: unknown): value is PodcastWorkflowArtifactReference {
  return Boolean(
    value
    && typeof value === "object"
    && typeof (value as PodcastWorkflowArtifactReference).label === "string"
    && typeof (value as PodcastWorkflowArtifactReference).href === "string",
  );
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

function workflowCommentAnnotationKey(companyId: string, commentId: string): ScopeKey {
  return {
    scopeKind: "company",
    scopeId: companyId,
    namespace: STATE_NAMESPACES.workflowCommentRun,
    stateKey: commentId,
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
    || !Array.isArray(record.artifacts)
    || !record.artifacts.every(isArtifactReference)
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
    artifacts: record.artifacts.map((artifact) => ({ ...artifact })),
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

export async function readWorkflowCommentAnnotationRecord(
  ctx: PluginContext,
  companyId: string,
  commentId: string,
): Promise<PodcastWorkflowCommentAnnotationRecord | null> {
  const stored = await ctx.state.get(workflowCommentAnnotationKey(companyId, commentId));
  if (!stored || typeof stored !== "object") return null;

  const record = stored as Partial<PodcastWorkflowCommentAnnotationRecord>;
  if (
    record.version !== 1
    || record.companyId !== companyId
    || typeof record.workflowId !== "string"
    || typeof record.workflowName !== "string"
    || typeof record.stageKey !== "string"
    || typeof record.stageDisplayName !== "string"
    || typeof record.runId !== "string"
    || typeof record.issueId !== "string"
    || record.commentId !== commentId
    || typeof record.summary !== "string"
    || typeof record.details !== "string"
    || !Array.isArray(record.artifacts)
    || !record.artifacts.every(isArtifactReference)
    || typeof record.createdAt !== "string"
  ) {
    return null;
  }

  return {
    version: 1,
    companyId,
    workflowId: record.workflowId,
    workflowName: record.workflowName,
    stageKey: record.stageKey,
    stageDisplayName: record.stageDisplayName,
    runId: record.runId,
    issueId: record.issueId,
    commentId,
    summary: record.summary,
    details: record.details,
    artifacts: record.artifacts.map((artifact) => ({ ...artifact })),
    createdAt: record.createdAt,
  };
}

export async function writeWorkflowCommentAnnotationRecord(
  ctx: PluginContext,
  record: PodcastWorkflowCommentAnnotationRecord,
): Promise<void> {
  await ctx.state.set(workflowCommentAnnotationKey(record.companyId, record.commentId), record);
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
    artifacts: run.artifacts.map((artifact) => ({ ...artifact })),
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
  artifacts: PodcastWorkflowArtifactReference[];
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
    artifacts: input.artifacts.map((artifact) => ({ ...artifact })),
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

export function createWorkflowCommentAnnotationRecord(input: {
  run: PodcastWorkflowStageRunRecord;
  workflowName: string;
  stageDisplayName: string;
}): PodcastWorkflowCommentAnnotationRecord {
  return {
    version: 1,
    companyId: input.run.companyId,
    workflowId: input.run.workflowId,
    workflowName: input.workflowName,
    stageKey: input.run.stageKey,
    stageDisplayName: input.stageDisplayName,
    runId: input.run.id,
    issueId: input.run.issueId,
    commentId: input.run.commentId,
    summary: input.run.summary,
    details: input.run.details,
    artifacts: input.run.artifacts.map((artifact) => ({ ...artifact })),
    createdAt: input.run.createdAt,
  };
}

export function buildWorkflowStageOutputCommentBody(input: {
  workflow: PodcastWorkflowRecord;
  stage: PodcastWorkflowStageTemplate;
  summary: string;
  details: string;
  artifacts: PodcastWorkflowArtifactReference[];
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

  if (input.artifacts.length > 0) {
    sections.push(
      "",
      "Artifacts:",
      ...input.artifacts.map((artifact) => `- ${artifact.label}: ${artifact.href}`),
    );
  }

  return sections.join("\n");
}
