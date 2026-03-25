import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "@paperclipai/db";
import type {
  PodcastWorkflow,
  RunPodcastWorkflow,
} from "@paperclipai/shared";
import type { StorageService } from "../storage/types.js";
import { resolvePodcastWorkflowPath } from "./podcast-workflow-defaults.js";
import { documentService } from "./documents.js";
import { issueService } from "./issues.js";
import { logActivity } from "./activity-log.js";

const SYNC_REQUIRED_STATUSES = [
  "board_review",
  "approval_packet",
  "social_drafts",
  "newsletter_draft",
  "instagram_dry_run",
  "mailchimp_dry_run",
] as const;

type ActorInfo = {
  actorType: "user" | "agent";
  actorId: string;
  agentId?: string | null;
  runId?: string | null;
};

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
}

function readText(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function writeJsonAtomic(filePath: string, payload: Record<string, unknown>) {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  fs.renameSync(tmpPath, filePath);
}

function sha256File(filePath: string) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function guessContentType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".json":
      return "application/json";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".mp4":
      return "video/mp4";
    case ".m4a":
      return "audio/mp4";
    case ".srt":
      return "application/x-subrip";
    case ".vtt":
      return "text/vtt";
    case ".md":
      return "text/markdown";
    case ".txt":
      return "text/plain";
    case ".csv":
      return "text/csv";
    case ".html":
      return "text/html";
    case ".pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}

function isSupportedAttachmentPath(filePath: string) {
  return /\.(png|jpe?g|json|srt|vtt|md|txt|csv|html|pdf)$/i.test(filePath);
}

function resolvePathIfPresent(input: unknown): string {
  if (typeof input !== "string" || input.trim().length === 0) return "";
  return path.resolve(input);
}

function requireManifestPath(
  workflow: PodcastWorkflow,
  request: RunPodcastWorkflow,
): string {
  const manifestPath = resolvePodcastWorkflowPath(
    request.manifestPath ?? workflow.manifest.manifestPath,
  );
  if (!manifestPath || !manifestPath.trim()) {
    throw new Error("Manifest path is required for sync_to_paperclip");
  }
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest file not found: ${manifestPath}`);
  }
  return manifestPath;
}

function requireReadyStatuses(manifest: Record<string, unknown>) {
  const status = (manifest.status ?? {}) as Record<string, unknown>;
  const missing = SYNC_REQUIRED_STATUSES.filter(
    (key) => String(status[key] ?? "").trim().toLowerCase() !== "ready",
  );
  if (missing.length > 0) {
    throw new Error(
      `Sync requires ready statuses for: ${missing.join(", ")}. Complete the pipeline before syncing to Paperclip.`,
    );
  }
}

function buildDocBody(sourcePath: string, introLabel: string) {
  return `${introLabel}\n\n_Source: \`${sourcePath}\`_\n\n${readText(sourcePath)}`;
}

function attachmentCandidatesFromManifest(manifest: Record<string, unknown>) {
  const targets = (manifest.targets ?? {}) as Record<string, unknown>;
  const social = (targets.social_poster ?? {}) as Record<string, unknown>;
  const clip = (targets.clip_extractor ?? {}) as Record<string, unknown>;
  const newsletter = (targets.newsletter_agent ?? {}) as Record<string, unknown>;
  const candidates = [
    social.board_review_json_path,
    social.approval_packet_json_path,
    social.instagram_dry_run_json_path,
    newsletter.mailchimp_dry_run_json_path,
    newsletter.draft_json_path,
    clip.clip_candidates_json_path,
    clip.rendered_clips_json_path,
    clip.quote_candidates_path,
    clip.quote_cards_json_path,
    clip.rendered_clips_path,
  ].filter(Boolean);

  const files: string[] = [];
  for (const candidate of candidates) {
    const resolved = resolvePathIfPresent(candidate);
    if (!resolved || !fs.existsSync(resolved)) continue;
    const stat = fs.statSync(resolved);
    if (stat.isFile()) {
      files.push(resolved);
      continue;
    }
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(resolved)) {
        const nested = path.join(resolved, name);
        if (fs.statSync(nested).isFile() && isSupportedAttachmentPath(nested)) {
          files.push(nested);
        }
      }
    }
  }
  return files;
}

function pickKeyAssets(manifest: Record<string, unknown>) {
  const targets = (manifest.targets ?? {}) as Record<string, unknown>;
  const social = (targets.social_poster ?? {}) as Record<string, unknown>;
  const approvalPacketJsonPath = resolvePathIfPresent(social.approval_packet_json_path);
  let leadAsset = "";
  let quoteCard = "";
  if (approvalPacketJsonPath && fs.existsSync(approvalPacketJsonPath)) {
    const packet = readJson(approvalPacketJsonPath);
    const lead = (packet.lead_asset ?? {}) as Record<string, unknown>;
    leadAsset = resolvePathIfPresent(lead.preview_path);
    quoteCard = resolvePathIfPresent(lead.quote_card_path);
  }
  const boardReviewJson = resolvePathIfPresent(social.board_review_json_path);
  return [leadAsset, quoteCard, boardReviewJson].filter(
    (value) => value && fs.existsSync(value),
  );
}

async function ensureReviewIssue(input: {
  db: Db;
  workflow: PodcastWorkflow;
  actor: ActorInfo;
  manifest: Record<string, unknown>;
  manifestPath: string;
  issueIdOverride?: string | null;
}) {
  const issues = issueService(input.db);
  const manifestIssueId =
    typeof input.manifest?.governance === "object" &&
    input.manifest.governance &&
    typeof (input.manifest.governance as Record<string, unknown>).paperclip_issue_id === "string"
      ? String((input.manifest.governance as Record<string, unknown>).paperclip_issue_id).trim()
      : "";
  const issueId = input.issueIdOverride ?? (manifestIssueId || input.workflow.issueId);
  if (issueId) {
    const issue = await issues.getById(issueId);
    if (!issue) throw new Error("Linked issue not found for sync_to_paperclip");
    return { issue, created: false };
  }

  const title = String(
    input.manifest.title ?? input.manifest.episode_id ?? "Episode batch review",
  ).trim();
  const { issue } = await issues.create(input.workflow.companyId, {
    projectId: input.workflow.projectId ?? null,
    title: `Review batch: ${title}`,
    description: `Auto-created from episode batch sync for \`${input.manifest.episode_id ?? title}\`.\n\nManifest: \`${input.manifestPath}\``,
    status: "backlog",
    priority: "medium",
    goalId: null,
    parentId: null,
    assigneeAgentId: null,
    assigneeUserId: null,
    billingCode: null,
    assigneeAdapterOverrides: null,
    projectWorkspaceId: null,
    executionWorkspaceId: null,
    executionWorkspacePreference: null,
    executionWorkspaceSettings: null,
    createdByAgentId: input.actor.agentId ?? null,
    createdByUserId: input.actor.actorType === "user" ? input.actor.actorId : null,
  });

  await logActivity(input.db, {
    companyId: input.workflow.companyId,
    actorType: input.actor.actorType,
    actorId: input.actor.actorId,
    agentId: input.actor.agentId ?? null,
    runId: input.actor.runId ?? null,
    action: "issue.created",
    entityType: "issue",
    entityId: issue.id,
    details: {
      title: issue.title,
      identifier: issue.identifier,
      source: "podcast_workflow_sync",
      workflowId: input.workflow.id,
    },
  });

  return { issue, created: true };
}

export async function syncPodcastWorkflowToPaperclip(input: {
  db: Db;
  storage: StorageService;
  workflow: PodcastWorkflow;
  request: RunPodcastWorkflow & { issueId?: string | null };
  actor: ActorInfo;
}) {
  const manifestPath = requireManifestPath(input.workflow, input.request);
  const manifest = readJson(manifestPath);
  const nowIso = new Date().toISOString();

  manifest.status = (manifest.status ?? {}) as Record<string, unknown>;
  (manifest.status as Record<string, unknown>).paperclip_sync = "running";
  manifest.updated_at = nowIso;
  writeJsonAtomic(manifestPath, manifest);

  try {
    requireReadyStatuses(manifest);
    const { issue, created } = await ensureReviewIssue({
      db: input.db,
      workflow: input.workflow,
      actor: input.actor,
      manifest,
      manifestPath,
      issueIdOverride: input.request.issueId ?? null,
    });

    const docs = documentService(input.db);
    const issues = issueService(input.db);
    const targets = (manifest.targets ?? {}) as Record<string, unknown>;
    const social = (targets.social_poster ?? {}) as Record<string, unknown>;
    const newsletter = (targets.newsletter_agent ?? {}) as Record<string, unknown>;
    const clip = (targets.clip_extractor ?? {}) as Record<string, unknown>;
    const operations = (targets.operations ?? {}) as Record<string, unknown>;

    const requiredDocSpecs = [
      { key: "board_review", title: "Board Review", path: resolvePathIfPresent(social.board_review_path), intro: "# Board Review\n", changeSummary: "Synced generated board review bundle from episode batch" },
      { key: "approval_packet", title: "Approval Packet", path: resolvePathIfPresent(social.approval_packet_path), intro: "# Approval Packet\n", changeSummary: "Synced generated approval packet from episode batch" },
      { key: "instagram_reel_draft", title: "Instagram Reel Draft", path: resolvePathIfPresent(social.instagram_reel_path), intro: "# Instagram Reel Draft\n", changeSummary: "Synced Instagram reel draft from episode batch" },
      { key: "facebook_post_draft", title: "Facebook Post Draft", path: resolvePathIfPresent(social.facebook_post_path), intro: "# Facebook Post Draft\n", changeSummary: "Synced Facebook post draft from episode batch" },
      { key: "tiktok_post_draft", title: "TikTok Post Draft", path: resolvePathIfPresent(social.tiktok_post_path), intro: "# TikTok Post Draft\n", changeSummary: "Synced TikTok post draft from episode batch" },
      { key: "newsletter_draft", title: "Newsletter Draft", path: resolvePathIfPresent(newsletter.draft_path), intro: "# Newsletter Draft\n", changeSummary: "Synced newsletter draft from episode batch" },
      { key: "instagram_dry_run", title: "Instagram Dry Run", path: resolvePathIfPresent(social.instagram_dry_run_path), intro: "# Instagram Dry Run\n", changeSummary: "Synced Instagram dry-run packet from episode batch" },
      { key: "mailchimp_dry_run", title: "Newsletter (Mailchimp) Dry Run", path: resolvePathIfPresent(newsletter.mailchimp_dry_run_path), intro: "# Newsletter Dry Run\n", changeSummary: "Synced newsletter dry-run packet from episode batch" },
      { key: "clip_candidates", title: "Clip Candidates", path: resolvePathIfPresent(clip.clip_candidates_path), intro: "# Clip Candidates\n", changeSummary: "Synced clip candidates from episode batch" },
      { key: "quote_candidates", title: "Quote Candidates", path: resolvePathIfPresent(clip.quote_candidates_path), intro: "# Quote Candidates\n", changeSummary: "Synced quote candidates from episode batch" },
      { key: "rendered_clips", title: "Rendered Clips", path: resolvePathIfPresent(clip.rendered_clips_path), intro: "# Rendered Clips\n", changeSummary: "Synced rendered clip manifest from episode batch" },
      { key: "quote_cards", title: "Quote Cards", path: resolvePathIfPresent(clip.quote_cards_path), intro: "# Quote Cards\n", changeSummary: "Synced quote-card specs from episode batch" },
    ];

    const optionalDocSpecs = [
      { key: "riverside_runbook", title: "Riverside Runbook", path: resolvePathIfPresent(operations.riverside_runbook_path), intro: "# Riverside Runbook\n", changeSummary: "Synced Riverside non-live runbook from episode batch" },
      { key: "vercel_runbook", title: "Vercel Runbook", path: resolvePathIfPresent(operations.vercel_runbook_path), intro: "# Vercel Runbook\n", changeSummary: "Synced Vercel deployment runbook from episode batch" },
      { key: "fable_runbook", title: "Fable Runbook", path: resolvePathIfPresent(operations.fable_runbook_path), intro: "# Fable Runbook\n", changeSummary: "Synced Fable non-live runbook from episode batch" },
    ];

    const missingRequired = requiredDocSpecs.filter((spec) => !spec.path || !fs.existsSync(spec.path));
    if (missingRequired.length > 0) {
      throw new Error(`Sync aborted: required documents are missing: ${missingRequired.map((spec) => spec.key).join(", ")}`);
    }

    const docSpecs = [
      ...requiredDocSpecs,
      ...optionalDocSpecs.filter((spec) => spec.path && fs.existsSync(spec.path)),
    ];

    const syncedDocuments: string[] = [];
    for (const spec of docSpecs) {
      const existing = await docs.getIssueDocumentByKey(issue.id, spec.key);
      const result = await docs.upsertIssueDocument({
        issueId: issue.id,
        key: spec.key,
        title: spec.title,
        format: "markdown",
        body: buildDocBody(spec.path, spec.intro),
        changeSummary: spec.changeSummary,
        baseRevisionId: existing?.latestRevisionId ?? null,
        createdByAgentId: input.actor.agentId ?? null,
        createdByUserId: input.actor.actorType === "user" ? input.actor.actorId : null,
      });
      await logActivity(input.db, {
        companyId: input.workflow.companyId,
        actorType: input.actor.actorType,
        actorId: input.actor.actorId,
        agentId: input.actor.agentId ?? null,
        runId: input.actor.runId ?? null,
        action: result.created ? "issue.document_created" : "issue.document_updated",
        entityType: "issue",
        entityId: issue.id,
        details: {
          key: result.document.key,
          documentId: result.document.id,
          title: result.document.title,
          format: result.document.format,
          revisionNumber: result.document.latestRevisionNumber,
        },
      });
      syncedDocuments.push(spec.key);
    }

    const existingAttachments = await issues.listAttachments(issue.id);
    const existingBySha = new Set(existingAttachments.map((attachment) => attachment.sha256));
    const attachmentCandidates = Array.from(new Set([
      ...pickKeyAssets(manifest),
      ...attachmentCandidatesFromManifest(manifest),
    ]));
    const uploadedAttachments: string[] = [];
    for (const filePath of attachmentCandidates) {
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile() || !isSupportedAttachmentPath(filePath)) continue;
      const sha = sha256File(filePath);
      if (existingBySha.has(sha)) continue;
      const buffer = fs.readFileSync(filePath);
      const stored = await input.storage.putFile({
        companyId: input.workflow.companyId,
        namespace: `issues/${issue.id}`,
        originalFilename: path.basename(filePath),
        contentType: guessContentType(filePath),
        body: buffer,
      });
      const attachment = await issues.createAttachment({
        issueId: issue.id,
        provider: stored.provider,
        objectKey: stored.objectKey,
        contentType: stored.contentType,
        byteSize: stored.byteSize,
        sha256: stored.sha256,
        originalFilename: stored.originalFilename,
        createdByAgentId: input.actor.agentId ?? null,
        createdByUserId: input.actor.actorType === "user" ? input.actor.actorId : null,
      });
      await logActivity(input.db, {
        companyId: input.workflow.companyId,
        actorType: input.actor.actorType,
        actorId: input.actor.actorId,
        agentId: input.actor.agentId ?? null,
        runId: input.actor.runId ?? null,
        action: "issue.attachment_added",
        entityType: "issue",
        entityId: issue.id,
        details: {
          attachmentId: attachment.id,
          originalFilename: attachment.originalFilename,
          contentType: attachment.contentType,
          byteSize: attachment.byteSize,
        },
      });
      uploadedAttachments.push(attachment.originalFilename ?? path.basename(filePath));
      existingBySha.add(sha);
    }

    const lines = [
      "## Batch Sync",
      "",
      `Synced the latest pre-publish batch artifacts for \`${String(manifest.episode_id ?? "episode")}\` into Paperclip.`,
      "",
      "- Documents updated:",
      ...syncedDocuments.map((key) => `  - \`${key}\``),
      uploadedAttachments.length > 0
        ? "- Attachments uploaded:"
        : "- Attachments uploaded: none (existing matching assets already present)",
      ...uploadedAttachments.map((name) => `  - \`${name}\``),
      `- Source issue: \`${issue.identifier ?? issue.id}\``,
    ];
    const comment = await issues.addComment(issue.id, `${lines.join("\n")}\n`, {
      agentId: input.actor.agentId ?? undefined,
      userId: input.actor.actorType === "user" ? input.actor.actorId : undefined,
    });
    await logActivity(input.db, {
      companyId: input.workflow.companyId,
      actorType: input.actor.actorType,
      actorId: input.actor.actorId,
      agentId: input.actor.agentId ?? null,
      runId: input.actor.runId ?? null,
      action: "issue.comment_added",
      entityType: "issue",
      entityId: issue.id,
      details: {
        commentId: comment.id,
        source: "podcast_workflow_sync",
      },
    });

    manifest.governance = (manifest.governance ?? {}) as Record<string, unknown>;
    (manifest.governance as Record<string, unknown>).paperclip_issue_id = issue.id;
    (manifest.governance as Record<string, unknown>).board_review_synced_at = nowIso;
    (manifest.status as Record<string, unknown>).paperclip_sync = "ready";
    manifest.updated_at = nowIso;
    writeJsonAtomic(manifestPath, manifest);

    return {
      issueId: issue.id,
      issueCreated: created,
      syncedDocuments,
      uploadedAttachments,
      workflowPatch: {
        issueId: issue.id,
        status: input.workflow.status === "done" ? "done" : "active",
        manifest: {
          ...input.workflow.manifest,
          manifestPath,
          episodeId: typeof manifest.episode_id === "string" ? manifest.episode_id : input.workflow.manifest.episodeId,
        },
        stageStatus: {
          ...input.workflow.stageStatus,
          paperclip_sync: "ready",
        },
        metadata: {
          ...(input.workflow.metadata ?? {}),
          lastSync: {
            issueId: issue.id,
            syncedAt: nowIso,
            uploadedAttachments,
            syncedDocuments,
          },
        },
        lastSyncedAt: new Date(nowIso),
      },
    };
  } catch (error) {
    try {
      const failedManifest = readJson(manifestPath);
      failedManifest.status = (failedManifest.status ?? {}) as Record<string, unknown>;
      (failedManifest.status as Record<string, unknown>).paperclip_sync = "failed";
      failedManifest.updated_at = new Date().toISOString();
      writeJsonAtomic(manifestPath, failedManifest);
    } catch {
      // best effort
    }
    throw error;
  }
}
