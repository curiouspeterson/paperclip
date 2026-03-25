import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  createPodcastWorkflowSchema,
  type PodcastWorkflow,
  runPodcastWorkflowSchema,
  updatePodcastWorkflowSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import {
  logActivity,
  podcastWorkflowService,
  workspaceOperationService,
} from "../services/index.js";
import {
  buildPodcastWorkflowSeed,
  resolvePodcastWorkflowCwd,
} from "../services/podcast-workflow-defaults.js";
import { runPodcastWorkflowAction } from "../services/podcast-workflow-runs.js";
import { syncPodcastWorkflowToPaperclip } from "../services/podcast-workflow-sync.js";
import type { StorageService } from "../storage/types.js";

export function podcastWorkflowRoutes(db: Db, storage: StorageService) {
  const router = Router();
  const svc = podcastWorkflowService(db);
  const operations = workspaceOperationService(db);

  router.get("/companies/:companyId/podcast-workflows", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await svc.list(companyId));
  });

  router.get("/podcast-workflows/:id", async (req, res) => {
    const id = req.params.id as string;
    const workflow = await svc.getById(id);
    if (!workflow) {
      res.status(404).json({ error: "Podcast workflow not found" });
      return;
    }
    assertCompanyAccess(req, workflow.companyId);
    res.json(workflow);
  });

  router.get("/podcast-workflows/:id/operations", async (req, res) => {
    const id = req.params.id as string;
    const workflow = await svc.getById(id);
    if (!workflow) {
      res.status(404).json({ error: "Podcast workflow not found" });
      return;
    }
    assertCompanyAccess(req, workflow.companyId);
    res.json(await operations.listForWorkflow(workflow.companyId, workflow.id));
  });

  router.post(
    "/companies/:companyId/podcast-workflows",
    validate(createPodcastWorkflowSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const defaults = buildPodcastWorkflowSeed(req.body.type);
      const workflow = await svc.create(companyId, {
        ...defaults,
        ...req.body,
        title: req.body.title ?? defaults.title,
        description: req.body.description ?? defaults.description,
        status: req.body.status ?? defaults.status,
        manifest: {
          ...defaults.manifest,
          ...(req.body.manifest ?? {}),
        },
        stageStatus: {
          ...defaults.stageStatus,
          ...(req.body.stageStatus ?? {}),
        },
        scriptRefs: {
          ...defaults.scriptRefs,
          ...(req.body.scriptRefs ?? {}),
        },
        metadata: {
          ...defaults.metadata,
          ...(req.body.metadata ?? {}),
        },
        lastSyncedAt:
          typeof req.body.lastSyncedAt === "string"
            ? new Date(req.body.lastSyncedAt)
            : null,
      });
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "podcast_workflow.created",
        entityType: "project",
        entityId: workflow.id,
        details: {
          workflowType: workflow.type,
          title: workflow.title,
        },
      });
      res.status(201).json(workflow);
    },
  );

  router.patch(
    "/podcast-workflows/:id",
    validate(updatePodcastWorkflowSchema),
    async (req, res) => {
      const id = req.params.id as string;
      const existing = await svc.getById(id);
      if (!existing) {
        res.status(404).json({ error: "Podcast workflow not found" });
        return;
      }
      assertCompanyAccess(req, existing.companyId);
      const workflow = await svc.update(id, {
        ...req.body,
        lastSyncedAt:
          typeof req.body.lastSyncedAt === "string"
            ? new Date(req.body.lastSyncedAt)
            : req.body.lastSyncedAt === null
              ? null
              : undefined,
      });
      if (!workflow) {
        res.status(404).json({ error: "Podcast workflow not found" });
        return;
      }
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId: workflow.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "podcast_workflow.updated",
        entityType: "project",
        entityId: workflow.id,
        details: req.body,
      });
      res.json(workflow);
    },
  );

  router.post(
    "/podcast-workflows/:id/run",
    validate(runPodcastWorkflowSchema),
    async (req, res) => {
      const id = req.params.id as string;
      const workflow = (await svc.getById(id)) as unknown as PodcastWorkflow | null;
      if (!workflow) {
        res.status(404).json({ error: "Podcast workflow not found" });
        return;
      }
      assertCompanyAccess(req, workflow.companyId);
      const actor = getActorInfo(req);
      const recorder = operations.createRecorder({
        companyId: workflow.companyId,
      });
      try {
        const action = req.body.action;
        const result =
              action === "sync_to_paperclip"
            ? await recorder.recordOperation({
                phase: "external_workflow_run",
                command: "paperclip-native podcast sync",
                cwd: resolvePodcastWorkflowCwd(workflow),
                metadata: {
                  kind: "podcast_workflow_sync",
                  workflowId: workflow.id,
                  workflowType: workflow.type,
                  action,
                },
                run: async () => {
                  const syncResult = await syncPodcastWorkflowToPaperclip({
                    db,
                    storage,
                    workflow,
                    request: req.body,
                    actor,
                  });
                  return {
                    status: "succeeded" as const,
                    exitCode: 0,
                    stdout: JSON.stringify({
                      issueId: syncResult.issueId,
                      syncedDocuments: syncResult.syncedDocuments,
                      uploadedAttachments: syncResult.uploadedAttachments,
                    }),
                    metadata: {
                      workflowPatch: syncResult.workflowPatch,
                    },
                  };
                },
              }).then((operation) => ({
                operation,
                workflowPatch:
                  (operation.metadata as Record<string, unknown> | null)?.workflowPatch as
                    | Record<string, unknown>
                    | undefined,
              }))
            : await runPodcastWorkflowAction({
                workflow,
                request: req.body,
                recorder,
              });
        const { operation, workflowPatch } = result;
        const updated = workflowPatch ? await svc.update(id, workflowPatch) : workflow;
        await logActivity(db, {
          companyId: workflow.companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "podcast_workflow.run",
          entityType: "project",
          entityId: workflow.id,
          details: {
            workflowType: workflow.type,
            requestedAction: action,
            operationId: operation.id,
            operationStatus: operation.status,
            exitCode: operation.exitCode,
          },
        });
        res.json({
          workflow: updated ?? workflow,
          operation,
        });
      } catch (error) {
        res.status(422).json({
          error: error instanceof Error ? error.message : "Failed to run podcast workflow action",
        });
      }
    },
  );

  return router;
}
