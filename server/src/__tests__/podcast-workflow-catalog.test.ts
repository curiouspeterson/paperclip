import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { PodcastWorkflow } from "@paperclipai/shared";
import { buildEpisodeWorkflowDraft } from "../services/podcast-workflows.ts";

const tempDirs = new Set<string>();

function buildTemplateWorkflow(runtimeRoot: string): PodcastWorkflow {
  const now = new Date("2026-03-22T10:00:00.000Z");
  return {
    id: randomUUID(),
    companyId: "company-1",
    projectId: null,
    issueId: null,
    ownerAgentId: null,
    type: "episode",
    status: "planned",
    title: "Episode Lifecycle Workflow",
    description: "Pipeline template",
    manifest: {
      episodeId: null,
      manifestPath: null,
      runtimeRoot,
      sourceMediaPath: null,
      publicUrl: null,
      channelUrl: "https://www.youtube.com/@RomanceUnzipped/videos",
    },
    stageStatus: {},
    scriptRefs: {
      initializeManifestPath: "/tmp/init.py",
      runLatestYouTubePipelinePath: "/tmp/latest.py",
      generateApprovalPacketPath: "/tmp/approval.py",
      generateSocialDraftsPath: "/tmp/social.py",
      generateBoardReviewPath: "/tmp/board.py",
      generateConnectorRunbooksPath: "/tmp/runbooks.py",
      syncBatchToPaperclipPath: "/tmp/sync.mjs",
      publishEpisodeToHomepagePath: "/tmp/publish.py",
      updateStaticHomepagePath: "/tmp/homepage.py",
    },
    metadata: {
      repositoryPath: "/tmp/repo",
    },
    lastSyncedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

afterEach(async () => {
  await Promise.all(
    Array.from(tempDirs).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
  tempDirs.clear();
});

describe("buildEpisodeWorkflowDraft", () => {
  it("builds a processed episode workflow draft from a runtime manifest", async () => {
    const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-podcast-catalog-"));
    tempDirs.add(runtimeRoot);
    const episodeDir = path.join(runtimeRoot, "episodes", "20260322-ep27");
    const manifestDir = path.join(episodeDir, "manifests");
    await fs.mkdir(manifestDir, { recursive: true });
    const manifestPath = path.join(manifestDir, "20260322-ep27.json");
    await fs.writeFile(
      manifestPath,
      JSON.stringify(
        {
          episode_id: "20260322-ep27",
          title: "27. Lizard Holds The Sun by Dani Trujillo",
          updated_at: "2026-03-22T19:16:36.034Z",
          source: {
            media_path: path.join(episodeDir, "input", "ep27.mp4"),
            public_url: "https://www.youtube.com/watch?v=huCg3DRSF18",
            channel_url: "https://www.youtube.com/@RomanceUnzipped/videos",
          },
          status: {
            approval_packet: "ready",
            board_review: "ready",
            paperclip_sync: "ready",
          },
          governance: {
            paperclip_issue_id: "7e9d0864-4551-46e5-b844-1ad9356955d3",
            board_review_synced_at: "2026-03-22T19:16:36.034Z",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const draft = buildEpisodeWorkflowDraft(buildTemplateWorkflow(runtimeRoot), manifestPath);

    expect(draft).not.toBeNull();
    expect(draft?.title).toBe("27. Lizard Holds The Sun by Dani Trujillo");
    expect(draft?.issueId).toBe("7e9d0864-4551-46e5-b844-1ad9356955d3");
    expect(draft?.manifest.episodeId).toBe("20260322-ep27");
    expect(draft?.manifest.manifestPath).toBe(path.resolve(manifestPath));
    expect(draft?.stageStatus.paperclip_sync).toBe("ready");
    expect(draft?.lastSyncedAt?.toISOString()).toBe("2026-03-22T19:16:36.034Z");
  });
});
