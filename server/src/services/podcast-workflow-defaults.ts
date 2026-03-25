import fs from "node:fs";
import path from "node:path";
import type {
  PodcastWorkflowManifest,
  PodcastWorkflowScriptRefs,
  PodcastWorkflowStageState,
  PodcastWorkflowType,
} from "@paperclipai/shared";
import { resolvePodcastWorkflowDefaultChannelUrl } from "./podcast-workflow-env.js";

type EnvLike = NodeJS.ProcessEnv;

type PodcastWorkflowSeed = {
  title: string;
  description: string;
  status: "planned";
  manifest: PodcastWorkflowManifest;
  stageStatus: Record<string, PodcastWorkflowStageState>;
  scriptRefs: PodcastWorkflowScriptRefs;
  metadata: Record<string, unknown>;
};

function normalizeEnvPath(value: string | undefined, cwd: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return path.resolve(cwd, trimmed);
}

function findRepoRoot(startCwd: string): string {
  let current = path.resolve(startCwd);
  while (true) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startCwd);
    }
    current = parent;
  }
}

export function resolvePodcastWorkflowRepoRoot(options?: {
  cwd?: string;
  env?: EnvLike;
}): string {
  const cwd = options?.cwd ?? process.cwd();
  const env = options?.env ?? process.env;
  return normalizeEnvPath(env.PAPERCLIP_REPO_ROOT, cwd) ?? findRepoRoot(cwd);
}

export function resolvePodcastWorkflowPath(
  value: string | null | undefined,
  options?: {
    cwd?: string;
    env?: EnvLike;
  },
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (path.isAbsolute(trimmed)) return trimmed;
  return path.resolve(resolvePodcastWorkflowRepoRoot(options), trimmed);
}

export function resolvePodcastWorkflowCwd(
  workflow?: { metadata?: Record<string, unknown> | null },
  options?: {
    cwd?: string;
    env?: EnvLike;
  },
): string {
  const repoRoot = resolvePodcastWorkflowRepoRoot(options);
  const metadataPath =
    typeof workflow?.metadata?.repositoryPath === "string"
      ? workflow.metadata.repositoryPath.trim()
      : "";
  if (metadataPath && path.isAbsolute(metadataPath) && fs.existsSync(metadataPath)) {
    return metadataPath;
  }
  return repoRoot;
}

export function buildPodcastWorkflowSeed(
  type: PodcastWorkflowType,
  options?: {
    env?: EnvLike;
  },
): PodcastWorkflowSeed {
  const env = options?.env ?? process.env;
  const defaultChannelUrl = resolvePodcastWorkflowDefaultChannelUrl(env);

  const commonScriptRefs: PodcastWorkflowScriptRefs = {
    initializeManifestPath: "bin/initialize_episode_manifest.py",
    runLatestYouTubePipelinePath: "bin/podcast-workflows/run_latest_youtube_pipeline.py",
    generateApprovalPacketPath: "bin/podcast-workflows/generate_approval_packet.py",
    generateSocialDraftsPath: "bin/podcast-workflows/generate_social_drafts.py",
    generateBoardReviewPath: "bin/podcast-workflows/generate_board_review.py",
    generateConnectorRunbooksPath: "bin/podcast-workflows/generate_connector_runbooks.py",
    syncBatchToPaperclipPath: "bin/podcast-workflows/sync_batch_to_paperclip.mjs",
    publishEpisodeToHomepagePath: "bin/publish_episode_to_homepage.py",
    updateStaticHomepagePath: "bin/podcast-workflows/update_static_homepage.py",
  };

  const manifest: PodcastWorkflowManifest = {
    episodeId: null,
    manifestPath: null,
    runtimeRoot: ".runtime/podcast-workflows",
    sourceMediaPath: null,
    publicUrl: null,
    channelUrl: defaultChannelUrl,
  };

  switch (type) {
    case "recording_session":
      return {
        title: "Recording Workflow",
        description: "Recording intake and transcript preparation workflow.",
        status: "planned",
        manifest,
        stageStatus: {
          intake: "pending",
          manifest: "missing",
          transcript: "missing",
          review: "missing",
        },
        scriptRefs: commonScriptRefs,
        metadata: {
          seedSource: "server_defaults",
        },
      };
    case "guest_booking":
      return {
        title: "Guest Booking Workflow",
        description: "Guest outreach, scheduling, and follow-up workflow.",
        status: "planned",
        manifest,
        stageStatus: {
          outreach: "pending",
          scheduling: "missing",
          prep_packet: "missing",
          post_recording_followup: "missing",
        },
        scriptRefs: commonScriptRefs,
        metadata: {
          seedSource: "server_defaults",
        },
      };
    case "episode":
    default:
      return {
        title: "Episode Workflow",
        description: "Episode content pipeline workflow backed by repo-owned script entrypoints.",
        status: "planned",
        manifest,
        stageStatus: {
          manifest: "missing",
          transcript: "missing",
          approval_packet: "missing",
          social_drafts: "missing",
          board_review: "missing",
          homepage_publish: "missing",
        },
        scriptRefs: commonScriptRefs,
        metadata: {
          seedSource: "server_defaults",
        },
      };
  }
}
