import type { Issue, PluginContext } from "@paperclipai/plugin-sdk";
import { STATE_NAMESPACES } from "./constants.js";
import { readWorkflowStageLastRunView, type PodcastWorkflowStageLastRunView } from "./runs.js";
import type { PodcastWorkflowRecord, PodcastWorkflowTemplateKey } from "./workflows.js";

export interface PodcastWorkflowStageTemplate {
  key: string;
  displayName: string;
  description: string;
}

export interface PodcastWorkflowStageSyncRecord {
  version: 1;
  companyId: string;
  workflowId: string;
  stageKey: string;
  issueId: string;
  projectId: string;
  projectWorkspaceId: string;
  syncedAt: string;
  issueTitle: string;
  issueStatus: string;
  issueUpdatedAt: string;
}

export interface PodcastWorkflowStageView extends PodcastWorkflowStageTemplate {
  canSync: boolean;
  blockedReason: string | null;
  sync: {
    status: "unsynced" | "linked" | "stale";
    issueId: string | null;
    issueTitle: string | null;
    issueStatus: string | null;
    projectId: string | null;
    projectWorkspaceId: string | null;
    syncedAt: string | null;
  };
  lastRun: PodcastWorkflowStageLastRunView | null;
}

export interface WorkflowStageSyncTarget {
  canSync: boolean;
  blockedReason: string | null;
  projectId: string | null;
  projectWorkspace: {
    id: string;
  } | null;
}

export const WORKFLOW_STAGE_TEMPLATES: Record<PodcastWorkflowTemplateKey, readonly PodcastWorkflowStageTemplate[]> = {
  "episode-pipeline": [
    {
      key: "intake",
      displayName: "Intake",
      description: "Capture the episode source, project context, and editorial constraints.",
    },
    {
      key: "transcript",
      displayName: "Transcript",
      description: "Produce or validate the episode transcript and collect source notes for editorial review.",
    },
    {
      key: "review",
      displayName: "Review",
      description: "Review the transcript, notes, and editorial packet before publication work begins.",
    },
    {
      key: "publish",
      displayName: "Publish",
      description: "Finalize release readiness, distribution steps, and publication follow-through.",
    },
  ],
  "clips-social": [
    {
      key: "selection",
      displayName: "Clip Selection",
      description: "Identify the strongest moments for short-form clip production and approval.",
    },
    {
      key: "render",
      displayName: "Render",
      description: "Render approved clips and collect output references for downstream review.",
    },
    {
      key: "copy",
      displayName: "Copy Review",
      description: "Draft and review captions, headlines, and publishing metadata for clip release.",
    },
  ],
  "newsletter-promo": [
    {
      key: "draft",
      displayName: "Draft",
      description: "Draft newsletter copy and assemble references for editorial review.",
    },
    {
      key: "approval",
      displayName: "Approval",
      description: "Collect approvals for newsletter copy, assets, and send timing.",
    },
    {
      key: "send",
      displayName: "Send",
      description: "Confirm final send readiness and track launch or delivery follow-through.",
    },
  ],
};

export function listWorkflowStageTemplates(templateKey: PodcastWorkflowTemplateKey): PodcastWorkflowStageTemplate[] {
  return [...(WORKFLOW_STAGE_TEMPLATES[templateKey] ?? [])].map((stage) => ({ ...stage }));
}

export function getWorkflowStageTemplate(
  templateKey: PodcastWorkflowTemplateKey,
  stageKey: string,
): PodcastWorkflowStageTemplate | null {
  return WORKFLOW_STAGE_TEMPLATES[templateKey]?.find((stage) => stage.key === stageKey) ?? null;
}

function workflowStageSyncStateKey(companyId: string, workflowId: string, stageKey: string) {
  return {
    scopeKind: "company" as const,
    scopeId: companyId,
    namespace: STATE_NAMESPACES.workflowStageIssue,
    stateKey: `${workflowId}:${stageKey}`,
  };
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.length > 0) return value;
  return new Date().toISOString();
}

export async function readWorkflowStageSyncRecord(
  ctx: PluginContext,
  companyId: string,
  workflowId: string,
  stageKey: string,
): Promise<PodcastWorkflowStageSyncRecord | null> {
  const stored = await ctx.state.get(workflowStageSyncStateKey(companyId, workflowId, stageKey));
  if (!stored || typeof stored !== "object") return null;

  const record = stored as Partial<PodcastWorkflowStageSyncRecord>;
  if (
    record.version !== 1
    || record.companyId !== companyId
    || record.workflowId !== workflowId
    || record.stageKey !== stageKey
    || typeof record.issueId !== "string"
    || typeof record.projectId !== "string"
    || typeof record.projectWorkspaceId !== "string"
    || typeof record.syncedAt !== "string"
    || typeof record.issueTitle !== "string"
    || typeof record.issueStatus !== "string"
    || typeof record.issueUpdatedAt !== "string"
  ) {
    return null;
  }

  return {
    version: 1,
    companyId,
    workflowId,
    stageKey,
    issueId: record.issueId,
    projectId: record.projectId,
    projectWorkspaceId: record.projectWorkspaceId,
    syncedAt: record.syncedAt,
    issueTitle: record.issueTitle,
    issueStatus: record.issueStatus,
    issueUpdatedAt: record.issueUpdatedAt,
  };
}

export async function writeWorkflowStageSyncRecord(
  ctx: PluginContext,
  record: PodcastWorkflowStageSyncRecord,
): Promise<void> {
  await ctx.state.set(
    workflowStageSyncStateKey(record.companyId, record.workflowId, record.stageKey),
    record,
  );
}

export async function deleteWorkflowStageSyncRecord(
  ctx: PluginContext,
  companyId: string,
  workflowId: string,
  stageKey: string,
): Promise<void> {
  await ctx.state.delete(workflowStageSyncStateKey(companyId, workflowId, stageKey));
}

export async function deleteWorkflowStageSyncRecords(
  ctx: PluginContext,
  workflow: PodcastWorkflowRecord,
): Promise<void> {
  const stages = listWorkflowStageTemplates(workflow.templateKey);
  for (const stage of stages) {
    await deleteWorkflowStageSyncRecord(ctx, workflow.companyId, workflow.id, stage.key);
  }
}

function toLinkedStageView(
  stage: PodcastWorkflowStageTemplate,
  issue: Issue,
  syncRecord: PodcastWorkflowStageSyncRecord,
  target: WorkflowStageSyncTarget,
  lastRun: PodcastWorkflowStageLastRunView | null,
): PodcastWorkflowStageView {
  return {
    ...stage,
    canSync: target.canSync,
    blockedReason: target.blockedReason,
    sync: {
      status: "linked",
      issueId: issue.id,
      issueTitle: issue.title,
      issueStatus: issue.status,
      projectId: syncRecord.projectId,
      projectWorkspaceId: syncRecord.projectWorkspaceId,
      syncedAt: syncRecord.syncedAt,
    },
    lastRun,
  };
}

function toFallbackStageView(
  stage: PodcastWorkflowStageTemplate,
  target: WorkflowStageSyncTarget,
  syncRecord: PodcastWorkflowStageSyncRecord | null,
  lastRun: PodcastWorkflowStageLastRunView | null,
): PodcastWorkflowStageView {
  return {
    ...stage,
    canSync: target.canSync,
    blockedReason: target.blockedReason,
    sync: {
      status: syncRecord ? "stale" : "unsynced",
      issueId: syncRecord?.issueId ?? null,
      issueTitle: syncRecord?.issueTitle ?? null,
      issueStatus: syncRecord?.issueStatus ?? null,
      projectId: syncRecord?.projectId ?? target.projectId,
      projectWorkspaceId: syncRecord?.projectWorkspaceId ?? target.projectWorkspace?.id ?? null,
      syncedAt: syncRecord?.syncedAt ?? null,
    },
    lastRun,
  };
}

export async function listWorkflowStageViews(
  ctx: PluginContext,
  workflow: PodcastWorkflowRecord,
  target: WorkflowStageSyncTarget,
): Promise<PodcastWorkflowStageView[]> {
  const stages = listWorkflowStageTemplates(workflow.templateKey);
  const results: PodcastWorkflowStageView[] = [];

  for (const stage of stages) {
    const syncRecord = await readWorkflowStageSyncRecord(ctx, workflow.companyId, workflow.id, stage.key);
    const lastRun = await readWorkflowStageLastRunView(ctx, workflow.companyId, workflow.id, stage.key);
    if (!syncRecord) {
      results.push(toFallbackStageView(stage, target, null, lastRun));
      continue;
    }

    const issue = await ctx.issues.get(syncRecord.issueId, workflow.companyId);
    if (issue) {
      results.push(toLinkedStageView(stage, issue, syncRecord, target, lastRun));
      continue;
    }

    results.push(toFallbackStageView(stage, target, syncRecord, lastRun));
  }

  return results;
}

export function buildWorkflowStageIssueTitle(
  workflow: PodcastWorkflowRecord,
  stage: PodcastWorkflowStageTemplate,
): string {
  return `${workflow.name}: ${stage.displayName}`;
}

export function buildWorkflowStageIssueDescription(input: {
  workflow: PodcastWorkflowRecord;
  stage: PodcastWorkflowStageTemplate;
  projectName: string;
  workspace: {
    name: string;
    path: string;
  };
}): string {
  const sections = [
    `Workflow: ${input.workflow.name}`,
    `Template: ${input.workflow.templateKey}`,
    `Stage: ${input.stage.displayName}`,
    `Project: ${input.projectName}`,
    `Primary workspace: ${input.workspace.name} (${input.workspace.path})`,
  ];

  if (input.workflow.description) {
    sections.push(`Workflow description:\n${input.workflow.description}`);
  }

  sections.push(`Stage objective:\n${input.stage.description}`);
  return sections.join("\n\n");
}

export function createWorkflowStageSyncRecord(input: {
  companyId: string;
  workflowId: string;
  stageKey: string;
  issue: Issue;
  projectId: string;
  projectWorkspaceId: string;
}): PodcastWorkflowStageSyncRecord {
  return {
    version: 1,
    companyId: input.companyId,
    workflowId: input.workflowId,
    stageKey: input.stageKey,
    issueId: input.issue.id,
    projectId: input.projectId,
    projectWorkspaceId: input.projectWorkspaceId,
    syncedAt: new Date().toISOString(),
    issueTitle: input.issue.title,
    issueStatus: input.issue.status,
    issueUpdatedAt: toIsoString(input.issue.updatedAt),
  };
}
