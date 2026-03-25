import { z } from "zod";
import {
  PODCAST_WORKFLOW_STATUSES,
  PODCAST_WORKFLOW_TYPES,
} from "../constants.js";

export const podcastWorkflowStageStateSchema = z.enum([
  "missing",
  "pending",
  "ready",
  "blocked",
]);

export const podcastWorkflowManifestSchema = z.object({
  episodeId: z.string().trim().min(1).nullable().optional(),
  manifestPath: z.string().trim().min(1).nullable().optional(),
  runtimeRoot: z.string().trim().min(1).nullable().optional(),
  sourceMediaPath: z.string().trim().min(1).nullable().optional(),
  publicUrl: z.string().trim().min(1).nullable().optional(),
  channelUrl: z.string().trim().min(1).nullable().optional(),
});

export const podcastWorkflowScriptRefsSchema = z.object({
  initializeManifestPath: z.string().trim().min(1).nullable().optional(),
  runLatestYouTubePipelinePath: z.string().trim().min(1).nullable().optional(),
  generateApprovalPacketPath: z.string().trim().min(1).nullable().optional(),
  generateSocialDraftsPath: z.string().trim().min(1).nullable().optional(),
  generateBoardReviewPath: z.string().trim().min(1).nullable().optional(),
  generateConnectorRunbooksPath: z.string().trim().min(1).nullable().optional(),
  syncBatchToPaperclipPath: z.string().trim().min(1).nullable().optional(),
  publishEpisodeToHomepagePath: z.string().trim().min(1).nullable().optional(),
  updateStaticHomepagePath: z.string().trim().min(1).nullable().optional(),
});

const podcastWorkflowFields = {
  projectId: z.string().uuid().optional().nullable(),
  issueId: z.string().uuid().optional().nullable(),
  ownerAgentId: z.string().uuid().optional().nullable(),
  type: z.enum(PODCAST_WORKFLOW_TYPES),
  status: z.enum(PODCAST_WORKFLOW_STATUSES).optional().default("planned"),
  title: z.string().trim().min(1).optional(),
  description: z.string().optional().nullable(),
  manifest: podcastWorkflowManifestSchema.optional().default({}),
  stageStatus: z.record(podcastWorkflowStageStateSchema).optional().default({}),
  scriptRefs: podcastWorkflowScriptRefsSchema.optional().default({}),
  metadata: z.record(z.unknown()).optional().default({}),
  lastSyncedAt: z.string().datetime().optional().nullable(),
};

export const createPodcastWorkflowSchema = z.object(podcastWorkflowFields);
export type CreatePodcastWorkflow = z.infer<typeof createPodcastWorkflowSchema>;

export const updatePodcastWorkflowSchema = z.object(podcastWorkflowFields).partial();
export type UpdatePodcastWorkflow = z.infer<typeof updatePodcastWorkflowSchema>;

export const podcastWorkflowRunActionSchema = z.enum([
  "initialize_manifest",
  "run_latest_youtube_pipeline",
  "generate_approval_packet",
  "generate_social_drafts",
  "generate_board_review",
  "generate_connector_runbooks",
  "update_static_homepage",
  "publish_episode_to_homepage",
  "sync_to_paperclip",
]);

export const runPodcastWorkflowSchema = z.object({
  action: podcastWorkflowRunActionSchema,
  sourceMediaPath: z.string().trim().min(1).optional().nullable(),
  manifestPath: z.string().trim().min(1).optional().nullable(),
  runtimeRoot: z.string().trim().min(1).optional().nullable(),
  episodeId: z.string().trim().min(1).optional().nullable(),
  title: z.string().trim().min(1).optional().nullable(),
  publishDate: z.string().trim().min(1).optional().nullable(),
  publicUrl: z.string().trim().min(1).optional().nullable(),
  issueId: z.string().uuid().optional().nullable(),
  channelUrl: z.string().trim().min(1).optional().nullable(),
  playlistIndex: z.number().int().positive().optional(),
  force: z.boolean().optional().default(false),
  confirmDangerousAction: z.boolean().optional().default(false),
});

export type RunPodcastWorkflow = z.infer<typeof runPodcastWorkflowSchema>;
