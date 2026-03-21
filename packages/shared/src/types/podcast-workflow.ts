import type {
  PodcastWorkflowStatus,
  PodcastWorkflowType,
} from "../constants.js";

export type PodcastWorkflowStageState =
  | "missing"
  | "pending"
  | "ready"
  | "blocked";

export interface PodcastWorkflowManifest {
  episodeId: string | null;
  manifestPath: string | null;
  runtimeRoot: string | null;
  sourceMediaPath: string | null;
  publicUrl: string | null;
  channelUrl: string | null;
}

export interface PodcastWorkflowScriptRefs {
  initializeManifestPath: string | null;
  runLatestYouTubePipelinePath: string | null;
  generateApprovalPacketPath: string | null;
  generateSocialDraftsPath: string | null;
  generateBoardReviewPath: string | null;
  generateConnectorRunbooksPath: string | null;
  syncBatchToPaperclipPath: string | null;
  publishEpisodeToHomepagePath: string | null;
  updateStaticHomepagePath: string | null;
}

export interface PodcastWorkflow {
  id: string;
  companyId: string;
  projectId: string | null;
  issueId: string | null;
  ownerAgentId: string | null;
  type: PodcastWorkflowType;
  status: PodcastWorkflowStatus;
  title: string;
  description: string | null;
  manifest: PodcastWorkflowManifest;
  stageStatus: Record<string, PodcastWorkflowStageState>;
  scriptRefs: PodcastWorkflowScriptRefs;
  metadata: Record<string, unknown>;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
