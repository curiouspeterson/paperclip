import { describe, expect, it } from "vitest";
import type { PodcastWorkflow } from "@paperclipai/shared";
import { isProcessedEpisodeWorkflow, sortProcessedEpisodeWorkflows } from "./podcast-content";

function buildWorkflow(overrides: Partial<PodcastWorkflow> = {}): PodcastWorkflow {
  const base: PodcastWorkflow = {
    id: "workflow-1",
    companyId: "company-1",
    projectId: null,
    issueId: null,
    ownerAgentId: null,
    type: "episode",
    status: "planned",
    title: "Episode",
    description: null,
    manifest: {
      episodeId: "episode-1",
      manifestPath: "/tmp/manifest.json",
      runtimeRoot: "/tmp/runtime",
      sourceMediaPath: "/tmp/video.mp4",
      publicUrl: null,
      channelUrl: null,
    },
    stageStatus: {},
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
    metadata: {},
    lastSyncedAt: new Date("2026-03-22T10:00:00.000Z"),
    createdAt: new Date("2026-03-22T09:00:00.000Z"),
    updatedAt: new Date("2026-03-22T10:00:00.000Z"),
  };

  return {
    ...base,
    ...overrides,
    manifest: {
      ...base.manifest,
      ...overrides.manifest,
    },
    scriptRefs: {
      ...base.scriptRefs,
      ...overrides.scriptRefs,
    },
    stageStatus: {
      ...base.stageStatus,
      ...overrides.stageStatus,
    },
    metadata: {
      ...base.metadata,
      ...overrides.metadata,
    },
  };
}

describe("podcast content helpers", () => {
  it("treats episodes with generated artifacts as processed content even before sync", () => {
    const episode = buildWorkflow();
    expect(isProcessedEpisodeWorkflow(episode)).toBe(true);
    expect(isProcessedEpisodeWorkflow(buildWorkflow({ type: "recording_session" }))).toBe(false);
    expect(
      isProcessedEpisodeWorkflow(
        buildWorkflow({
          lastSyncedAt: null,
          stageStatus: {
            approval_packet: "ready",
          },
        }),
      ),
    ).toBe(true);
    expect(
      isProcessedEpisodeWorkflow(
        buildWorkflow({
          manifest: {
            ...episode.manifest,
            manifestPath: null,
          },
        }),
      ),
    ).toBe(false);
  });

  it("sorts processed episodes by most recent sync first", () => {
    const older = buildWorkflow({
      id: "older",
      title: "Older",
      lastSyncedAt: new Date("2026-03-21T10:00:00.000Z"),
      updatedAt: new Date("2026-03-21T10:00:00.000Z"),
    });
    const newer = buildWorkflow({
      id: "newer",
      title: "Newer",
      lastSyncedAt: new Date("2026-03-22T10:00:00.000Z"),
      updatedAt: new Date("2026-03-22T10:00:00.000Z"),
    });
    const processedUnsynced = buildWorkflow({
      id: "unsynced",
      title: "Unsynced",
      lastSyncedAt: null,
      updatedAt: new Date("2026-03-23T10:00:00.000Z"),
      stageStatus: {
        approval_packet: "ready",
      },
    });

    expect(sortProcessedEpisodeWorkflows([older, processedUnsynced, newer]).map((workflow) => workflow.id)).toEqual([
      "unsynced",
      "newer",
      "older",
    ]);
  });
});
