import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { Mic, Plus, Radio, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  PodcastWorkflow,
  PodcastWorkflowScriptRefs,
  PodcastWorkflowType,
} from "@paperclipai/shared";
import { podcastWorkflowsApi } from "../api/podcast-workflows";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";

const ROMANCE_UNZIPPED_ROOT = "/Users/adampeterson/GitHub/RomanceUnzipped";
const ROMANCE_UNZIPPED_BIN = `${ROMANCE_UNZIPPED_ROOT}/bin`;
const ROMANCE_UNZIPPED_RUNTIME = `${ROMANCE_UNZIPPED_ROOT}/.runtime/ru-podcast`;

function buildScriptRefs(): PodcastWorkflowScriptRefs {
  return {
    initializeManifestPath: `${ROMANCE_UNZIPPED_BIN}/initialize_episode_manifest.py`,
    runLatestYouTubePipelinePath: `${ROMANCE_UNZIPPED_BIN}/run_latest_youtube_pipeline.py`,
    generateApprovalPacketPath: `${ROMANCE_UNZIPPED_BIN}/generate_approval_packet.py`,
    generateSocialDraftsPath: `${ROMANCE_UNZIPPED_BIN}/generate_social_drafts.py`,
    generateBoardReviewPath: `${ROMANCE_UNZIPPED_BIN}/generate_board_review.py`,
    generateConnectorRunbooksPath: `${ROMANCE_UNZIPPED_BIN}/generate_connector_runbooks.py`,
    syncBatchToPaperclipPath: `${ROMANCE_UNZIPPED_BIN}/sync_batch_to_paperclip.mjs`,
    publishEpisodeToHomepagePath: `${ROMANCE_UNZIPPED_BIN}/publish_episode_to_homepage.py`,
    updateStaticHomepagePath: `${ROMANCE_UNZIPPED_BIN}/update_static_homepage.py`,
  };
}

function buildSeedWorkflow(type: PodcastWorkflowType): Record<string, unknown> {
  const titles: Record<PodcastWorkflowType, string> = {
    recording_session: "Recording Session Workflow",
    episode: "Episode Lifecycle Workflow",
    guest_booking: "Guest Booking Workflow",
  };
  const descriptions: Record<PodcastWorkflowType, string> = {
    recording_session:
      "Paperclip-native intake and recording workflow derived from the episode manifest pipeline.",
    episode:
      "Episode tracking and content pipeline workflow using the Romance Unzipped manifest, stage, and review scripts.",
    guest_booking:
      "Guest coordination workflow with approval, review, and publication handoff hooks.",
  };
  const stageStatus: Record<PodcastWorkflowType, Record<string, "missing" | "pending">> = {
    recording_session: {
      intake: "pending",
      manifest: "missing",
      transcript: "missing",
      review: "missing",
    },
    episode: {
      manifest: "missing",
      transcript: "missing",
      approval_packet: "missing",
      social_drafts: "missing",
      board_review: "missing",
      homepage_publish: "missing",
    },
    guest_booking: {
      outreach: "pending",
      scheduling: "missing",
      prep_packet: "missing",
      post_recording_followup: "missing",
    },
  };
  return {
    type,
    status: "planned",
    title: titles[type],
    description: descriptions[type],
    manifest: {
      episodeId: null,
      manifestPath: null,
      runtimeRoot: ROMANCE_UNZIPPED_RUNTIME,
      sourceMediaPath: null,
      publicUrl: null,
      channelUrl: "https://www.youtube.com/@RomanceUnzipped/videos",
    },
    stageStatus: stageStatus[type],
    scriptRefs: buildScriptRefs(),
    metadata: {
      repositoryPath: ROMANCE_UNZIPPED_ROOT,
      binDirectoryPath: ROMANCE_UNZIPPED_BIN,
      origin: "romanceunzipped-first-iteration",
    },
  };
}

function WorkflowTypeIcon({ type }: { type: PodcastWorkflowType }) {
  if (type === "recording_session") return <Mic className="h-4 w-4" />;
  if (type === "guest_booking") return <Users className="h-4 w-4" />;
  return <Radio className="h-4 w-4" />;
}

function WorkflowCard({ workflow }: { workflow: PodcastWorkflow }) {
  const readyStages = Object.values(workflow.stageStatus).filter(
    (value) => value === "ready",
  ).length;
  const totalStages = Object.keys(workflow.stageStatus).length;
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            <WorkflowTypeIcon type={workflow.type} />
            <Link to={`/podcast-ops/${workflow.id}`} className="hover:underline">
              {workflow.title}
            </Link>
          </div>
          <p className="text-sm text-muted-foreground">{workflow.description ?? "No description."}</p>
        </div>
        <span className="rounded-full border border-border px-2 py-0.5 text-xs uppercase tracking-wide text-muted-foreground">
          {workflow.status.replaceAll("_", " ")}
        </span>
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Manifest</dt>
          <dd className="mt-1 text-sm font-mono break-all">
            {workflow.manifest.manifestPath ?? "Not initialized"}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Runtime Root</dt>
          <dd className="mt-1 text-sm font-mono break-all">
            {workflow.manifest.runtimeRoot ?? "Not set"}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Progress</dt>
          <dd className="mt-1 text-sm">
            {readyStages}/{totalStages} stages ready
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        {Object.entries(workflow.stageStatus).map(([stage, value]) => (
          <span
            key={stage}
            className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground"
          >
            {stage}: {value}
          </span>
        ))}
      </div>
    </div>
  );
}

function actionsForWorkflow(workflow: PodcastWorkflow) {
  if (workflow.type === "recording_session") {
    return [
      { label: "Initialize Manifest", action: "initialize_manifest" as const },
      { label: "Run Latest Upload", action: "run_latest_youtube_pipeline" as const },
    ];
  }
  if (workflow.type === "episode") {
    return [
      { label: "Approval Packet", action: "generate_approval_packet" as const },
      { label: "Social Drafts", action: "generate_social_drafts" as const },
      { label: "Board Review", action: "generate_board_review" as const },
      { label: "Connector Runbooks", action: "generate_connector_runbooks" as const },
      { label: "Sync To Paperclip", action: "sync_to_paperclip" as const },
      { label: "Update Homepage", action: "update_static_homepage" as const },
      { label: "Publish Homepage", action: "publish_episode_to_homepage" as const },
    ];
  }
  return [];
}

export function PodcastWorkflows() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  useEffect(() => {
    setBreadcrumbs([{ label: "Podcast Ops" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.podcastWorkflows.list(selectedCompanyId!),
    queryFn: () => podcastWorkflowsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  const createWorkflow = useMutation({
    mutationFn: (type: PodcastWorkflowType) =>
      podcastWorkflowsApi.create(selectedCompanyId!, buildSeedWorkflow(type)),
    onSuccess: () => {
      if (!selectedCompanyId) return;
      queryClient.invalidateQueries({
        queryKey: queryKeys.podcastWorkflows.list(selectedCompanyId),
      });
    },
  });

  const grouped = useMemo(() => {
    const workflows = data ?? [];
    return {
      recording_session: workflows.filter((workflow) => workflow.type === "recording_session"),
      episode: workflows.filter((workflow) => workflow.type === "episode"),
      guest_booking: workflows.filter((workflow) => workflow.type === "guest_booking"),
    };
  }, [data]);

  if (!selectedCompanyId) {
    return <EmptyState icon={Radio} message="Select a company to view podcast workflows." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-destructive">{error.message}</p>}

      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <h1 className="text-lg font-semibold">Podcast Ops</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Paperclip-native podcast workflows derived from the Romance Unzipped manifest pipeline in
              <span className="font-mono"> {ROMANCE_UNZIPPED_BIN}</span>.
              Workflows store the manifest contract, stage status, and runtime script references so the control plane stays authoritative.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => createWorkflow.mutate("recording_session")}
              disabled={createWorkflow.isPending}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Recording Workflow
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => createWorkflow.mutate("episode")}
              disabled={createWorkflow.isPending}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Episode Workflow
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => createWorkflow.mutate("guest_booking")}
              disabled={createWorkflow.isPending}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Guest Workflow
            </Button>
          </div>
        </div>
      </div>

      {!data || data.length === 0 ? (
        <EmptyState
          icon={Radio}
          message="No podcast workflows yet."
          action="Create Episode Workflow"
          onAction={() => createWorkflow.mutate("episode")}
        />
      ) : (
        <div className="space-y-6">
          {(["recording_session", "episode", "guest_booking"] as const).map((type) => (
            <section key={type} className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {type.replaceAll("_", " ")}
                </h2>
              </div>
              <div className="grid gap-3">
                {grouped[type].map((workflow) => (
                  <div key={workflow.id} className="space-y-3">
                    <WorkflowCard workflow={workflow} />
                    <div className="flex flex-wrap gap-2">
                      {actionsForWorkflow(workflow).map((action) => (
                        <Button key={action.action} size="sm" variant="outline" asChild>
                          <Link to={`/podcast-ops/${workflow.id}?action=${action.action}`}>
                            {action.label}
                          </Link>
                        </Button>
                      ))}
                    </div>
                    {Boolean(workflow.metadata?.lastRun) &&
                      typeof workflow.metadata?.lastRun === "object" && (
                        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                          Last run:{" "}
                          {String(
                            (workflow.metadata.lastRun as Record<string, unknown>).action ?? "unknown",
                          )}{" "}
                          ·{" "}
                          {String(
                            (workflow.metadata.lastRun as Record<string, unknown>).status ?? "unknown",
                          )}{" "}
                          · operation{" "}
                          <span className="font-mono">
                            {String(
                              (workflow.metadata.lastRun as Record<string, unknown>).operationId ??
                                "unknown",
                            )}
                          </span>
                        </div>
                      )}
                  </div>
                ))}
                {grouped[type].length === 0 && (
                  <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                    No {type.replaceAll("_", " ")} workflows created yet.
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>
      )}

    </div>
  );
}
