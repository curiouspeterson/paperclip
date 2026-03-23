import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PodcastWorkflow, RunPodcastWorkflow } from "@paperclipai/shared";
import type { StorageService } from "../storage/types.js";

const mocks = vi.hoisted(() => {
  return {
    issueFns: {
      getById: vi.fn(),
      create: vi.fn(),
      listAttachments: vi.fn(),
      createAttachment: vi.fn(),
      addComment: vi.fn(),
    },
    documentFns: {
      getIssueDocumentByKey: vi.fn(),
      upsertIssueDocument: vi.fn(),
    },
    logActivity: vi.fn(),
  };
});

vi.mock("../services/issues.js", () => ({
  issueService: vi.fn(() => mocks.issueFns),
}));

vi.mock("../services/documents.js", () => ({
  documentService: vi.fn(() => mocks.documentFns),
}));

vi.mock("../services/activity-log.js", () => ({
  logActivity: mocks.logActivity,
}));

import { syncPodcastWorkflowToPaperclip } from "../services/podcast-workflow-sync.js";

const tempDirs = new Set<string>();

function createStorageDouble(): StorageService {
  return {
    putFile: vi.fn(async (input: { originalFilename: string; contentType: string; body: Buffer }) => ({
      provider: "local_disk",
      objectKey: `issues/test/${input.originalFilename}`,
      contentType: input.contentType,
      byteSize: input.body.byteLength,
      sha256: `sha-${input.originalFilename}`,
      originalFilename: input.originalFilename,
    })),
    getFile: vi.fn(),
    deleteFile: vi.fn(),
    getSignedUrl: vi.fn(),
  } as unknown as StorageService;
}

async function createManifestRuntime() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-podcast-sync-"));
  tempDirs.add(dir);

  const socialDir = path.join(dir, "assets", "social");
  const newsletterDir = path.join(dir, "assets", "newsletter");
  const clipsDir = path.join(dir, "assets", "clips");
  const quotesDir = path.join(dir, "assets", "quotes");
  await fs.mkdir(socialDir, { recursive: true });
  await fs.mkdir(newsletterDir, { recursive: true });
  await fs.mkdir(clipsDir, { recursive: true });
  await fs.mkdir(quotesDir, { recursive: true });

  const requiredDocs = {
    boardReview: path.join(socialDir, "board-review.md"),
    approvalPacket: path.join(socialDir, "approval-packet.md"),
    instagramReel: path.join(socialDir, "instagram-reel.md"),
    facebookPost: path.join(socialDir, "facebook-post.md"),
    tiktokPost: path.join(socialDir, "tiktok-post.md"),
    instagramDryRun: path.join(socialDir, "instagram-dry-run.md"),
    newsletterDraft: path.join(newsletterDir, "draft.md"),
    mailchimpDryRun: path.join(newsletterDir, "mailchimp-dry-run.md"),
    clipCandidates: path.join(clipsDir, "candidates.md"),
    renderedClips: path.join(clipsDir, "rendered.md"),
    quoteCandidates: path.join(quotesDir, "candidates.md"),
    quoteCards: path.join(quotesDir, "cards.md"),
  };

  await Promise.all(
    Object.values(requiredDocs).map((filePath) => fs.writeFile(filePath, `content for ${path.basename(filePath)}`, "utf8")),
  );

  const manifestPath = path.join(dir, "manifest.json");
  await fs.writeFile(
    manifestPath,
    JSON.stringify(
      {
        episode_id: "20260322-ep29",
        title: "29. Truth and Measure by Roslyn Sinclair",
        status: {
          board_review: "ready",
          approval_packet: "ready",
          social_drafts: "ready",
          newsletter_draft: "ready",
          instagram_dry_run: "ready",
          mailchimp_dry_run: "ready",
          paperclip_sync: "pending",
        },
        governance: {
          paperclip_issue_id: "issue-from-manifest",
          board_review_synced_at: null,
          board_approval: "pending",
        },
        targets: {
          social_poster: {
            board_review_path: requiredDocs.boardReview,
            approval_packet_path: requiredDocs.approvalPacket,
            instagram_reel_path: requiredDocs.instagramReel,
            facebook_post_path: requiredDocs.facebookPost,
            tiktok_post_path: requiredDocs.tiktokPost,
            instagram_dry_run_path: requiredDocs.instagramDryRun,
          },
          newsletter_agent: {
            draft_path: requiredDocs.newsletterDraft,
            mailchimp_dry_run_path: requiredDocs.mailchimpDryRun,
          },
          clip_extractor: {
            clip_candidates_path: requiredDocs.clipCandidates,
            rendered_clips_path: requiredDocs.renderedClips,
            quote_candidates_path: requiredDocs.quoteCandidates,
            quote_cards_path: requiredDocs.quoteCards,
          },
          operations: {},
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  return { dir, manifestPath };
}

function createWorkflow(manifestPath: string, runtimeRoot: string): PodcastWorkflow {
  const now = new Date("2026-03-22T10:00:00.000Z");
  return {
    id: randomUUID(),
    companyId: "company-1",
    projectId: null,
    issueId: null,
    ownerAgentId: null,
    type: "episode",
    status: "planned",
    title: "Episode Workflow",
    description: null,
    manifest: {
      episodeId: "20260322-ep29",
      manifestPath,
      runtimeRoot,
      sourceMediaPath: null,
      publicUrl: "https://www.youtube.com/watch?v=H5fSuLMbSTo",
      channelUrl: "https://www.youtube.com/@RomanceUnzipped/videos",
    },
    stageStatus: {
      paperclip_sync: "pending",
    },
    scriptRefs: {
      initializeManifestPath: null,
      runLatestYouTubePipelinePath: null,
      generateApprovalPacketPath: null,
      generateSocialDraftsPath: null,
      generateBoardReviewPath: null,
      generateConnectorRunbooksPath: null,
      syncBatchToPaperclipPath: null,
      publishEpisodeToHomepagePath: null,
      updateStaticHomepagePath: null,
    },
    metadata: {
      repositoryPath: runtimeRoot,
    },
    lastSyncedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

afterEach(async () => {
  await Promise.all(Array.from(tempDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempDirs.clear();
});

beforeEach(() => {
  mocks.issueFns.getById.mockReset();
  mocks.issueFns.create.mockReset();
  mocks.issueFns.listAttachments.mockReset();
  mocks.issueFns.createAttachment.mockReset();
  mocks.issueFns.addComment.mockReset();
  mocks.documentFns.getIssueDocumentByKey.mockReset();
  mocks.documentFns.upsertIssueDocument.mockReset();
  mocks.logActivity.mockReset();

  mocks.issueFns.listAttachments.mockResolvedValue([]);
  mocks.issueFns.addComment.mockResolvedValue({ id: "comment-1" });
  mocks.issueFns.createAttachment.mockImplementation(async ({ originalFilename }) => ({
    id: `attachment-${originalFilename}`,
    originalFilename,
    contentType: "application/octet-stream",
    byteSize: 1,
  }));
  mocks.documentFns.getIssueDocumentByKey.mockResolvedValue(null);
  mocks.documentFns.upsertIssueDocument.mockImplementation(async ({ issueId, key, title, format, body }) => ({
    created: true,
    document: {
      id: `doc-${key}`,
      issueId,
      key,
      title,
      format,
      body,
      latestRevisionNumber: 1,
    },
  }));
});

describe("syncPodcastWorkflowToPaperclip", () => {
  it("reuses the manifest-linked issue id by default on reruns", async () => {
    const { dir, manifestPath } = await createManifestRuntime();
    const workflow = createWorkflow(manifestPath, dir);
    mocks.issueFns.getById.mockResolvedValue({
      id: "issue-from-manifest",
      identifier: "ROM-999",
      companyId: "company-1",
      title: "Existing issue",
    });

    const result = await syncPodcastWorkflowToPaperclip({
      db: {} as any,
      storage: createStorageDouble(),
      workflow,
      request: {
        action: "sync_to_paperclip",
        manifestPath,
      } as RunPodcastWorkflow & { issueId?: string | null },
      actor: {
        actorType: "user",
        actorId: "user-1",
      },
    });

    expect(mocks.issueFns.getById).toHaveBeenCalledWith("issue-from-manifest");
    expect(mocks.issueFns.create).not.toHaveBeenCalled();
    expect(result.issueId).toBe("issue-from-manifest");
    expect(result.issueCreated).toBe(false);
    expect(result.workflowPatch.issueId).toBe("issue-from-manifest");

    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    expect(manifest.governance.paperclip_issue_id).toBe("issue-from-manifest");
    expect(manifest.status.paperclip_sync).toBe("ready");
  });
});
