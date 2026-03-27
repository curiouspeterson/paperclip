import { randomUUID } from "node:crypto";
import { definePlugin, runWorker, type PluginContext } from "@paperclipai/plugin-sdk";
import { ACTION_KEYS, DATA_KEYS, PLUGIN_ID } from "./constants.js";
import {
  addWorkflowRunToIndex,
  type PodcastWorkflowArtifactReference,
  buildWorkflowStageOutputCommentBody,
  createWorkflowCommentAnnotationRecord,
  createWorkflowStageLatestRunRecord,
  createWorkflowStageRunRecord,
  listWorkflowStageRunRecords,
  readWorkflowCommentAnnotationRecord,
  writeWorkflowStageLatestRunRecord,
  writeWorkflowCommentAnnotationRecord,
  writeWorkflowStageRunRecord,
} from "./runs.js";
import {
  buildWorkflowStageIssueDescription,
  buildWorkflowStageIssueTitle,
  createWorkflowStageSyncRecord,
  deleteWorkflowStageSyncRecords,
  getWorkflowStageTemplate,
  listWorkflowStageViews,
  readWorkflowStageSyncRecord,
  writeWorkflowStageSyncRecord,
} from "./stages.js";
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

function requireStageKey(params: Record<string, unknown>): string {
  const stageKey = normalizeOptionalString(params.stageKey);
  if (!stageKey) {
    throw new Error("stageKey is required");
  }
  return stageKey;
}

function requireOutputSummary(params: Record<string, unknown>): string {
  const summary = normalizeOptionalString(params.summary);
  if (!summary) {
    throw new Error("summary is required");
  }
  return summary;
}

function resolveArtifactReferences(params: Record<string, unknown>): PodcastWorkflowArtifactReference[] {
  const input = params.artifacts;
  if (input == null) return [];
  if (!Array.isArray(input)) {
    throw new Error("artifacts must be an array");
  }

  return input
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        throw new Error("artifact entries must be objects");
      }
      const label = normalizeOptionalString((entry as { label?: unknown }).label);
      const href = normalizeOptionalString((entry as { href?: unknown }).href);
      if (!label || !href) {
        throw new Error("artifact entries must include label and href");
      }
      return { label, href };
    });
}

function resolveWorkflowStatus(params: Record<string, unknown>, existing: PodcastWorkflowRecord | null) {
  const rawStatus = params.status ?? existing?.status ?? "draft";
  if (!isWorkflowStatus(rawStatus)) {
    throw new Error("status must be one of draft, active, or archived");
  }
  return rawStatus;
}

async function resolveWorkflowStageTarget(ctx: PluginContext, workflow: PodcastWorkflowRecord) {
  if (!workflow.projectId) {
    return {
      canSync: false,
      blockedReason: "Bind this workflow to a project before syncing stage issues.",
      project: null,
      primaryWorkspace: null,
    };
  }

  const project = await ctx.projects.get(workflow.projectId, workflow.companyId);
  if (!project) {
    return {
      canSync: false,
      blockedReason: "The bound project could not be resolved for workflow stage sync.",
      project: null,
      primaryWorkspace: null,
    };
  }

  if (!project.primaryWorkspace) {
    return {
      canSync: false,
      blockedReason: "Workflow project must expose a primary workspace before stage issues can sync",
      project,
      primaryWorkspace: null,
    };
  }

  return {
    canSync: true,
    blockedReason: null,
    project,
    primaryWorkspace: project.primaryWorkspace,
  };
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

  ctx.data.register(DATA_KEYS.workflowStages, async (params) => {
    const companyId = normalizeOptionalString(params.companyId);
    const workflowId = normalizeOptionalString(params.workflowId);
    if (!companyId || !workflowId) {
      return { stages: [] };
    }

    const workflow = await readWorkflowRecord(ctx, companyId, workflowId);
    if (!workflow) {
      return { stages: [] };
    }

    const target = await resolveWorkflowStageTarget(ctx, workflow);
    return {
      stages: await listWorkflowStageViews(ctx, workflow, {
        canSync: target.canSync,
        blockedReason: target.blockedReason,
        projectId: target.project?.id ?? workflow.projectId,
        projectWorkspace: target.primaryWorkspace ? { id: target.primaryWorkspace.id } : null,
      }),
    };
  });

  ctx.data.register(DATA_KEYS.commentStageOutput, async (params) => {
    const companyId = normalizeOptionalString(params.companyId);
    const commentId = normalizeOptionalString(params.commentId);
    const issueId = normalizeOptionalString(params.issueId);
    if (!companyId || !commentId || !issueId) {
      return { annotation: null };
    }

    const annotation = await readWorkflowCommentAnnotationRecord(ctx, companyId, commentId);
    if (!annotation || annotation.issueId !== issueId) {
      return { annotation: null };
    }

    return {
      annotation: {
        workflowId: annotation.workflowId,
        workflowName: annotation.workflowName,
        stageKey: annotation.stageKey,
        stageDisplayName: annotation.stageDisplayName,
        issueId: annotation.issueId,
        commentId: annotation.commentId,
        summary: annotation.summary,
        details: annotation.details,
        artifacts: annotation.artifacts.map((artifact) => ({ ...artifact })),
        createdAt: annotation.createdAt,
      },
    };
  });

  ctx.data.register(DATA_KEYS.workflowRuns, async (params) => {
    const companyId = normalizeOptionalString(params.companyId);
    const workflowId = normalizeOptionalString(params.workflowId);
    if (!companyId || !workflowId) {
      return {
        total: 0,
        runs: [],
      };
    }

    const workflow = await readWorkflowRecord(ctx, companyId, workflowId);
    if (!workflow) {
      return {
        total: 0,
        runs: [],
      };
    }

    const stageKey = normalizeNullableString(params.stageKey);
    const runRecords = await listWorkflowStageRunRecords(ctx, companyId, workflowId);
    const filteredRuns = stageKey
      ? runRecords.filter((run) => run.stageKey === stageKey)
      : runRecords;

    const runs = await Promise.all(filteredRuns.map(async (run) => {
      const annotation = await readWorkflowCommentAnnotationRecord(ctx, companyId, run.commentId);
      const stageDisplayName = annotation?.stageDisplayName
        ?? getWorkflowStageTemplate(workflow.templateKey, run.stageKey)?.displayName
        ?? run.stageKey;

      return {
        workflowId,
        workflowName: annotation?.workflowName ?? workflow.name,
        stageKey: run.stageKey,
        stageDisplayName,
        issueId: run.issueId,
        commentId: run.commentId,
        summary: run.summary,
        details: run.details,
        artifacts: run.artifacts.map((artifact) => ({ ...artifact })),
        createdAt: run.createdAt,
      };
    }));

    return {
      total: runs.length,
      runs,
    };
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

    if (existing && existing.templateKey !== workflow.templateKey) {
      await deleteWorkflowStageSyncRecords(ctx, existing);
    }

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
    const existing = await readWorkflowRecord(ctx, companyId, workflowId);
    if (existing) {
      await deleteWorkflowStageSyncRecords(ctx, existing);
    }
    await deleteWorkflowRecord(ctx, companyId, workflowId);
    ctx.logger.info("Deleted podcast workflow", { companyId, workflowId });
    return {
      ok: true,
      workflowId,
    };
  });

  ctx.actions.register(ACTION_KEYS.syncWorkflowStageIssue, async (params) => {
    const companyId = requireCompanyId(params);
    const workflowId = requireWorkflowId(params);
    const stageKey = requireStageKey(params);
    const workflow = await readWorkflowRecord(ctx, companyId, workflowId);
    if (!workflow) {
      throw new Error("Workflow not found");
    }

    const stage = getWorkflowStageTemplate(workflow.templateKey, stageKey);
    if (!stage) {
      throw new Error("stageKey must be a supported workflow stage for the selected template");
    }

    const target = await resolveWorkflowStageTarget(ctx, workflow);
    if (!target.canSync || !target.project || !target.primaryWorkspace) {
      throw new Error(target.blockedReason ?? "Workflow stage sync target is unavailable");
    }

    const nextTitle = buildWorkflowStageIssueTitle(workflow, stage);
    const nextDescription = buildWorkflowStageIssueDescription({
      workflow,
      stage,
      projectName: target.project.name,
      workspace: {
        name: target.primaryWorkspace.name,
        path: target.primaryWorkspace.cwd ?? target.primaryWorkspace.name,
      },
    });

    const existingSync = await readWorkflowStageSyncRecord(ctx, companyId, workflowId, stageKey);
    const existingIssue = existingSync?.issueId
      ? await ctx.issues.get(existingSync.issueId, companyId)
      : null;
    const canUpdateExistingIssue = Boolean(
      existingIssue
      && existingSync
      && existingSync.projectId === target.project.id,
    );

    const issue = canUpdateExistingIssue && existingIssue
      ? await ctx.issues.update(
        existingIssue.id,
        {
          title: nextTitle,
          description: nextDescription,
        },
        companyId,
      )
      : await ctx.issues.create({
        companyId,
        projectId: target.project.id,
        title: nextTitle,
        description: nextDescription,
      });

    const sync = createWorkflowStageSyncRecord({
      companyId,
      workflowId,
      stageKey,
      issue,
      projectId: target.project.id,
      projectWorkspaceId: target.primaryWorkspace.id,
    });
    await writeWorkflowStageSyncRecord(ctx, sync);

    await ctx.activity.log({
      companyId,
      entityType: "issue",
      entityId: issue.id,
      message: existingIssue
        ? `Podcast workflow synced stage "${stage.displayName}" to issue "${issue.title}"`
        : `Podcast workflow created stage issue "${issue.title}"`,
      metadata: {
        plugin: PLUGIN_ID,
        workflowId,
        stageKey,
        projectId: target.project.id,
        projectWorkspaceId: target.primaryWorkspace.id,
      },
    });

    ctx.logger.info(existingIssue ? "Updated podcast workflow stage issue" : "Created podcast workflow stage issue", {
      companyId,
      workflowId,
      stageKey,
      issueId: issue.id,
      projectId: target.project.id,
      projectWorkspaceId: target.primaryWorkspace.id,
    });

    return {
      issue,
      sync,
      stage,
    };
  });

  ctx.actions.register(ACTION_KEYS.recordWorkflowStageOutput, async (params) => {
    const companyId = requireCompanyId(params);
    const workflowId = requireWorkflowId(params);
    const stageKey = requireStageKey(params);
    const summary = requireOutputSummary(params);
    const details = normalizeOptionalString(params.details);
    const artifacts = resolveArtifactReferences(params);
    const workflow = await readWorkflowRecord(ctx, companyId, workflowId);
    if (!workflow) {
      throw new Error("Workflow not found");
    }

    const stage = getWorkflowStageTemplate(workflow.templateKey, stageKey);
    if (!stage) {
      throw new Error("stageKey must be a supported workflow stage for the selected template");
    }

    const sync = await readWorkflowStageSyncRecord(ctx, companyId, workflowId, stageKey);
    if (!sync) {
      throw new Error("Sync the stage issue before recording workflow output");
    }

    const issue = await ctx.issues.get(sync.issueId, companyId);
    if (!issue) {
      throw new Error("The linked stage issue could not be resolved. Sync the stage issue again first.");
    }

    const comment = await ctx.issues.createComment(
      issue.id,
      buildWorkflowStageOutputCommentBody({
        workflow,
        stage,
        summary,
        details,
        artifacts,
      }),
      companyId,
    );

    const run = createWorkflowStageRunRecord({
      id: randomUUID(),
      companyId,
      workflowId,
      stageKey,
      issueId: issue.id,
      commentId: comment.id,
      projectId: sync.projectId,
      projectWorkspaceId: sync.projectWorkspaceId,
      summary,
      details,
      artifacts,
    });
    await writeWorkflowStageRunRecord(ctx, run);
    await addWorkflowRunToIndex(ctx, run);
    await writeWorkflowStageLatestRunRecord(ctx, createWorkflowStageLatestRunRecord(run));
    await writeWorkflowCommentAnnotationRecord(ctx, createWorkflowCommentAnnotationRecord({
      run,
      workflowName: workflow.name,
      stageDisplayName: stage.displayName,
    }));

    await ctx.activity.log({
      companyId,
      entityType: "issue",
      entityId: issue.id,
      message: `Podcast workflow recorded output for stage "${stage.displayName}" on issue "${issue.title}"`,
      metadata: {
        plugin: PLUGIN_ID,
        workflowId,
        stageKey,
        runId: run.id,
        issueId: issue.id,
        commentId: comment.id,
        projectId: sync.projectId,
        projectWorkspaceId: sync.projectWorkspaceId,
      },
    });

    ctx.logger.info("Recorded podcast workflow stage output", {
      companyId,
      workflowId,
      stageKey,
      runId: run.id,
      issueId: issue.id,
      commentId: comment.id,
    });

    return {
      run,
      comment,
      stage,
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
