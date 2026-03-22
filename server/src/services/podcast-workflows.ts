import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { podcastWorkflows } from "@paperclipai/db";
import type { PodcastWorkflow, PodcastWorkflowStageState, PodcastWorkflowStatus } from "@paperclipai/shared";

const PROCESSED_STAGE_KEYS = [
  "transcript",
  "clip_candidates",
  "quote_candidates",
  "rendered_clips",
  "quote_cards",
  "approval_packet",
  "social_drafts",
  "board_review",
  "newsletter_draft",
  "instagram_dry_run",
  "mailchimp_dry_run",
  "riverside_runbook",
  "vercel_runbook",
  "fable_runbook",
  "homepage_update",
  "paperclip_sync",
] as const;

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
}

function resolveString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseDate(value: unknown): Date | null {
  const candidate = resolveString(value);
  if (!candidate) return null;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeStageState(value: unknown): PodcastWorkflowStageState {
  const normalized = resolveString(value)?.toLowerCase() ?? "missing";
  if (normalized === "ready") return "ready";
  if (normalized === "blocked" || normalized === "failed") return "blocked";
  if (normalized === "pending" || normalized === "running") return "pending";
  return "missing";
}

function hasProcessedArtifacts(stageStatus: Record<string, PodcastWorkflowStageState>): boolean {
  return PROCESSED_STAGE_KEYS.some((key) => stageStatus[key] === "ready");
}

function deriveWorkflowStatus(stageStatus: Record<string, PodcastWorkflowStageState>): PodcastWorkflowStatus {
  if (Object.values(stageStatus).some((value) => value === "blocked")) {
    return "blocked";
  }
  if (hasProcessedArtifacts(stageStatus)) {
    return "active";
  }
  return "planned";
}

function listEpisodeManifestPaths(runtimeRoot: string): string[] {
  const episodesDir = path.resolve(runtimeRoot, "episodes");
  if (!fs.existsSync(episodesDir) || !fs.statSync(episodesDir).isDirectory()) {
    return [];
  }
  const manifestPaths: string[] = [];
  for (const entry of fs.readdirSync(episodesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestDir = path.join(episodesDir, entry.name, "manifests");
    if (!fs.existsSync(manifestDir) || !fs.statSync(manifestDir).isDirectory()) continue;
    for (const file of fs.readdirSync(manifestDir, { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith(".json")) continue;
      manifestPaths.push(path.join(manifestDir, file.name));
    }
  }
  return manifestPaths.sort();
}

export function buildEpisodeWorkflowDraft(
  template: PodcastWorkflow,
  manifestPath: string,
): Omit<PodcastWorkflow, "id" | "companyId" | "createdAt" | "updatedAt"> | null {
  const resolvedManifestPath = path.resolve(manifestPath);
  if (!fs.existsSync(resolvedManifestPath)) return null;

  const manifest = readJson(resolvedManifestPath);
  const rawStatus = (manifest.status ?? {}) as Record<string, unknown>;
  const stageStatus = Object.fromEntries(
    Object.entries(rawStatus).map(([key, value]) => [key, normalizeStageState(value)]),
  ) as Record<string, PodcastWorkflowStageState>;

  if (!hasProcessedArtifacts(stageStatus)) {
    return null;
  }

  const runtime = (manifest.runtime ?? {}) as Record<string, unknown>;
  const source = (manifest.source ?? {}) as Record<string, unknown>;
  const governance = (manifest.governance ?? {}) as Record<string, unknown>;
  const lastSyncedAt =
    parseDate(governance.board_review_synced_at) ??
    parseDate(manifest.updated_at) ??
    parseDate(manifest.created_at);
  const issueId = resolveString(governance.paperclip_issue_id);
  const runtimeRoot =
    resolveString(runtime.root_path) ??
    resolveString(template.manifest.runtimeRoot) ??
    path.resolve(resolvedManifestPath, "..", "..", "..");

  return {
    projectId: template.projectId,
    issueId,
    ownerAgentId: template.ownerAgentId,
    type: "episode",
    status: deriveWorkflowStatus(stageStatus),
    title:
      resolveString(manifest.title) ??
      resolveString(manifest.episode_id) ??
      path.basename(resolvedManifestPath, ".json"),
    description: template.description,
    manifest: {
      episodeId: resolveString(manifest.episode_id),
      manifestPath: resolvedManifestPath,
      runtimeRoot,
      sourceMediaPath: resolveString(source.media_path),
      publicUrl: resolveString(source.public_url),
      channelUrl: resolveString(source.channel_url) ?? template.manifest.channelUrl,
    },
    stageStatus,
    scriptRefs: template.scriptRefs,
    metadata: {
      ...(template.metadata ?? {}),
      source: "runtime_manifest",
      episodeManifestUpdatedAt: resolveString(manifest.updated_at),
    },
    lastSyncedAt,
  };
}

function workflowNeedsUpdate(
  existing: PodcastWorkflow,
  next: Omit<PodcastWorkflow, "id" | "companyId" | "createdAt" | "updatedAt">,
): boolean {
  const existingSyncedAt = existing.lastSyncedAt?.toISOString() ?? null;
  const nextSyncedAt = next.lastSyncedAt?.toISOString() ?? null;
  return (
    existing.projectId !== next.projectId ||
    existing.issueId !== next.issueId ||
    existing.ownerAgentId !== next.ownerAgentId ||
    existing.status !== next.status ||
    existing.title !== next.title ||
    existing.description !== next.description ||
    existingSyncedAt !== nextSyncedAt ||
    JSON.stringify(existing.manifest) !== JSON.stringify(next.manifest) ||
    JSON.stringify(existing.stageStatus) !== JSON.stringify(next.stageStatus) ||
    JSON.stringify(existing.scriptRefs) !== JSON.stringify(next.scriptRefs) ||
    JSON.stringify(existing.metadata ?? {}) !== JSON.stringify(next.metadata ?? {})
  );
}

async function syncEpisodeWorkflowCatalog(db: Db, companyId: string, rows: PodcastWorkflow[]): Promise<PodcastWorkflow[]> {
  const templateWorkflows = rows.filter((workflow) => {
    if (workflow.type !== "episode") return false;
    const runtimeRoot = resolveString(workflow.manifest.runtimeRoot);
    const manifestPath = resolveString(workflow.manifest.manifestPath);
    return Boolean(runtimeRoot) && !manifestPath;
  });

  if (templateWorkflows.length === 0) {
    return rows;
  }

  const existingEpisodeRows = rows.filter((workflow) => {
    if (workflow.type !== "episode") return false;
    return Boolean(resolveString(workflow.manifest.manifestPath));
  });

  const existingByManifestPath = new Map(
    existingEpisodeRows
      .map((workflow) => [resolveString(workflow.manifest.manifestPath), workflow] as const)
      .filter((entry): entry is [string, PodcastWorkflow] => Boolean(entry[0])),
  );

  let mutated = false;
  const seenManifestPaths = new Set<string>();
  for (const template of templateWorkflows) {
    const runtimeRoot = resolveString(template.manifest.runtimeRoot);
    if (!runtimeRoot) continue;
    for (const manifestPath of listEpisodeManifestPaths(runtimeRoot)) {
      if (seenManifestPaths.has(manifestPath)) continue;
      seenManifestPaths.add(manifestPath);
      const draft = buildEpisodeWorkflowDraft(template, manifestPath);
      if (!draft) continue;

      const existing = existingByManifestPath.get(draft.manifest.manifestPath ?? "");
      if (existing) {
        if (!workflowNeedsUpdate(existing, draft)) continue;
        const updateData: Partial<typeof podcastWorkflows.$inferInsert> = {
          projectId: draft.projectId,
          issueId: draft.issueId,
          ownerAgentId: draft.ownerAgentId,
          type: draft.type,
          status: draft.status,
          title: draft.title,
          description: draft.description,
          manifest: draft.manifest as unknown as Record<string, unknown>,
          stageStatus: draft.stageStatus as unknown as Record<string, unknown>,
          scriptRefs: draft.scriptRefs as unknown as Record<string, unknown>,
          metadata: draft.metadata,
          lastSyncedAt: draft.lastSyncedAt,
          updatedAt: new Date(),
        };
        await db
          .update(podcastWorkflows)
          .set(updateData)
          .where(eq(podcastWorkflows.id, existing.id));
        mutated = true;
        continue;
      }

      const insertData: typeof podcastWorkflows.$inferInsert = {
        companyId,
        projectId: draft.projectId,
        issueId: draft.issueId,
        ownerAgentId: draft.ownerAgentId,
        type: draft.type,
        status: draft.status,
        title: draft.title,
        description: draft.description,
        manifest: draft.manifest as unknown as Record<string, unknown>,
        stageStatus: draft.stageStatus as unknown as Record<string, unknown>,
        scriptRefs: draft.scriptRefs as unknown as Record<string, unknown>,
        metadata: draft.metadata,
        lastSyncedAt: draft.lastSyncedAt,
      };
      await db.insert(podcastWorkflows).values(insertData);
      mutated = true;
    }
  }

  if (!mutated) {
    return rows;
  }

  const refreshed = await db.select().from(podcastWorkflows).where(eq(podcastWorkflows.companyId, companyId));
  return refreshed as unknown as PodcastWorkflow[];
}

export function podcastWorkflowService(db: Db) {
  return {
    list: async (companyId: string) => {
      const rows = await db.select().from(podcastWorkflows).where(eq(podcastWorkflows.companyId, companyId));
      return syncEpisodeWorkflowCatalog(db, companyId, rows as unknown as PodcastWorkflow[]);
    },

    getById: (id: string) =>
      db
        .select()
        .from(podcastWorkflows)
        .where(eq(podcastWorkflows.id, id))
        .then((rows) => rows[0] ?? null),

    create: (companyId: string, data: Omit<typeof podcastWorkflows.$inferInsert, "companyId">) =>
      db
        .insert(podcastWorkflows)
        .values({ ...data, companyId })
        .returning()
        .then((rows) => rows[0]),

    update: (id: string, data: Partial<typeof podcastWorkflows.$inferInsert>) =>
      db
        .update(podcastWorkflows)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(podcastWorkflows.id, id))
        .returning()
        .then((rows) => rows[0] ?? null),
  };
}
