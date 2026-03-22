import type { PodcastWorkflow } from "@paperclipai/shared";

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

function workflowSortTimestamp(workflow: PodcastWorkflow): number {
  const syncedAt = workflow.lastSyncedAt ? new Date(workflow.lastSyncedAt).getTime() : 0;
  if (Number.isFinite(syncedAt) && syncedAt > 0) {
    return syncedAt;
  }
  const updatedAt = new Date(workflow.updatedAt).getTime();
  return Number.isFinite(updatedAt) ? updatedAt : 0;
}

function hasProcessedArtifacts(workflow: PodcastWorkflow): boolean {
  return PROCESSED_STAGE_KEYS.some((key) => workflow.stageStatus[key] === "ready");
}

export function isProcessedEpisodeWorkflow(workflow: PodcastWorkflow): boolean {
  return (
    workflow.type === "episode" &&
    Boolean(workflow.manifest.manifestPath) &&
    (Boolean(workflow.lastSyncedAt) || hasProcessedArtifacts(workflow))
  );
}

export function sortProcessedEpisodeWorkflows(workflows: PodcastWorkflow[]): PodcastWorkflow[] {
  return [...workflows]
    .filter(isProcessedEpisodeWorkflow)
    .sort((a, b) => workflowSortTimestamp(b) - workflowSortTimestamp(a));
}
