import { useMemo, useState, useEffect } from "react";
import { Link, useParams, useSearchParams } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "../api/client";
import { podcastWorkflowsApi } from "../api/podcast-workflows";
import { heartbeatsApi } from "../api/heartbeats";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { workflowStageStatusText, workflowStageStatusTextDefault } from "../lib/status-colors";
import { cn, formatDateTime, relativeTime } from "../lib/utils";
import type { PodcastWorkflow, WorkspaceOperation } from "@paperclipai/shared";
import { redactHomePathUserSegments } from "@paperclipai/adapter-utils";

type RunLogChunk = {
  ts: string;
  stream: "stdout" | "stderr" | "system";
  chunk: string;
};

function parseStoredLogContent(content: string): RunLogChunk[] {
  const parsed: RunLogChunk[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const raw = JSON.parse(trimmed) as { ts?: unknown; stream?: unknown; chunk?: unknown };
      const stream = raw.stream === "stderr" || raw.stream === "system" ? raw.stream : "stdout";
      const chunk = typeof raw.chunk === "string" ? raw.chunk : "";
      const ts = typeof raw.ts === "string" ? raw.ts : new Date().toISOString();
      if (!chunk) continue;
      parsed.push({ ts, stream, chunk });
    } catch {
      // Ignore malformed log lines.
    }
  }
  return parsed;
}

function phaseLabel(phase: WorkspaceOperation["phase"]) {
  switch (phase) {
    case "external_workflow_run":
      return "Workflow run";
    case "worktree_prepare":
      return "Worktree setup";
    case "workspace_provision":
      return "Provision";
    case "workspace_teardown":
      return "Teardown";
    case "worktree_cleanup":
      return "Worktree cleanup";
    default:
      return phase;
  }
}

function statusTone(status: WorkspaceOperation["status"]) {
  switch (status) {
    case "succeeded":
      return "border-green-500/20 bg-green-500/10 text-green-700 dark:text-green-300";
    case "failed":
      return "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300";
    case "running":
      return "border-cyan-500/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300";
    case "skipped":
      return "border-yellow-500/20 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300";
    default:
      return "border-border bg-muted/40 text-muted-foreground";
  }
}

function StatusBadge({ status }: { status: WorkspaceOperation["status"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize",
        statusTone(status),
      )}
    >
      {status}
    </span>
  );
}

function OperationLogViewer({ operation }: { operation: WorkspaceOperation }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["podcast-workflow-operation-log", operation.id],
    queryFn: () => heartbeatsApi.workspaceOperationLog(operation.id),
    enabled: open && Boolean(operation.logRef),
    refetchInterval: open && operation.status === "running" ? 2000 : false,
  });
  const chunks = useMemo(() => (data?.content ? parseStoredLogContent(data.content) : []), [data?.content]);

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Hide log" : "Show log"}
      </button>
      {open && (
        <div className="rounded-md border border-border bg-background/70 p-2">
          {isLoading && <div className="text-xs text-muted-foreground">Loading log...</div>}
          {error && <div className="text-xs text-destructive">{error instanceof Error ? error.message : "Failed to load log"}</div>}
          {!isLoading && !error && chunks.length === 0 && (
            <div className="text-xs text-muted-foreground">No persisted log lines.</div>
          )}
          {chunks.length > 0 && (
            <div className="max-h-64 overflow-y-auto rounded bg-neutral-100 p-2 font-mono text-xs dark:bg-neutral-950">
              {chunks.map((chunk, index) => (
                <div key={`${chunk.ts}-${index}`} className="flex gap-2">
                  <span className="shrink-0 text-neutral-500">
                    {new Date(chunk.ts).toLocaleTimeString("en-US", { hour12: false })}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 w-14",
                      chunk.stream === "stderr"
                        ? "text-red-600 dark:text-red-300"
                        : chunk.stream === "system"
                          ? "text-blue-600 dark:text-blue-300"
                          : "text-muted-foreground",
                    )}
                  >
                    [{chunk.stream}]
                  </span>
                  <span className="whitespace-pre-wrap break-all">{redactHomePathUserSegments(chunk.chunk)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
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

type WorkflowAction = ReturnType<typeof actionsForWorkflow>[number]["action"];

type ActionFormState = {
  sourceMediaPath: string;
  manifestPath: string;
  runtimeRoot: string;
  episodeId: string;
  title: string;
  publishDate: string;
  publicUrl: string;
  issueId: string;
  channelUrl: string;
  playlistIndex: string;
  confirmDangerousAction: boolean;
  force: boolean;
};

function createActionFormState(workflow: PodcastWorkflow): ActionFormState {
  const repositoryPath =
    typeof workflow.metadata?.repositoryPath === "string" ? workflow.metadata.repositoryPath : "";
  return {
    sourceMediaPath: workflow.manifest.sourceMediaPath ?? "",
    manifestPath: workflow.manifest.manifestPath ?? "",
    runtimeRoot: workflow.manifest.runtimeRoot ?? repositoryPath,
    episodeId: workflow.manifest.episodeId ?? "",
    title: workflow.title ?? "",
    publishDate: "",
    publicUrl: workflow.manifest.publicUrl ?? "",
    issueId: workflow.issueId ?? "",
    channelUrl: workflow.manifest.channelUrl ?? workflow.manifest.publicUrl ?? "",
    playlistIndex: "1",
    confirmDangerousAction: false,
    force: false,
  };
}

function requiredScriptRef(workflow: PodcastWorkflow, action: WorkflowAction): string | null {
  switch (action) {
    case "initialize_manifest":
      return workflow.scriptRefs.initializeManifestPath;
    case "run_latest_youtube_pipeline":
      return workflow.scriptRefs.runLatestYouTubePipelinePath;
    case "generate_approval_packet":
      return workflow.scriptRefs.generateApprovalPacketPath;
    case "generate_social_drafts":
      return workflow.scriptRefs.generateSocialDraftsPath;
    case "generate_board_review":
      return workflow.scriptRefs.generateBoardReviewPath;
    case "generate_connector_runbooks":
      return workflow.scriptRefs.generateConnectorRunbooksPath;
    case "sync_to_paperclip":
      return workflow.scriptRefs.syncBatchToPaperclipPath;
    case "update_static_homepage":
      return workflow.scriptRefs.updateStaticHomepagePath;
    case "publish_episode_to_homepage":
      return workflow.scriptRefs.publishEpisodeToHomepagePath;
    default:
      return null;
  }
}

function getActionValidation(workflow: PodcastWorkflow, action: WorkflowAction, form: ActionFormState) {
  const errors: string[] = [];

  if (!requiredScriptRef(workflow, action)) {
    errors.push(`Missing script ref for ${action.replaceAll("_", " ")}`);
  }

  if (action === "initialize_manifest") {
    if (!form.sourceMediaPath.trim()) errors.push("Source media path is required.");
    if (!form.runtimeRoot.trim()) errors.push("Runtime root is required.");
  }

  if (action === "run_latest_youtube_pipeline" && !form.runtimeRoot.trim()) {
    errors.push("Runtime root is required.");
  }

  if (
    action === "generate_approval_packet" ||
    action === "generate_social_drafts" ||
    action === "generate_board_review" ||
    action === "generate_connector_runbooks" ||
    action === "sync_to_paperclip" ||
    action === "update_static_homepage" ||
    action === "publish_episode_to_homepage"
  ) {
    if (!form.manifestPath.trim()) errors.push("Manifest path is required.");
  }

  if (action === "update_static_homepage" && !form.publicUrl.trim()) {
    errors.push("Public URL is required.");
  }

  if (action === "publish_episode_to_homepage" && !form.confirmDangerousAction) {
    errors.push("Confirm the publish action before running it.");
  }

  return { errors, canRun: errors.length === 0 };
}

function buildRunBody(action: WorkflowAction, form: ActionFormState) {
  const body: Record<string, unknown> = { action, force: form.force };

  if (action === "initialize_manifest") {
    if (!form.sourceMediaPath.trim()) throw new Error("Source media path is required");
    body.sourceMediaPath = form.sourceMediaPath.trim();
    if (form.runtimeRoot.trim()) body.runtimeRoot = form.runtimeRoot.trim();
    if (form.episodeId.trim()) body.episodeId = form.episodeId.trim();
    if (form.title.trim()) body.title = form.title.trim();
    if (form.publishDate.trim()) body.publishDate = form.publishDate.trim();
    return body;
  }

  if (action === "run_latest_youtube_pipeline") {
    if (form.runtimeRoot.trim()) body.runtimeRoot = form.runtimeRoot.trim();
    if (form.channelUrl.trim()) body.channelUrl = form.channelUrl.trim();
    const playlistIndex = Number(form.playlistIndex);
    if (Number.isFinite(playlistIndex) && playlistIndex > 0) body.playlistIndex = playlistIndex;
    return body;
  }

  if (!form.manifestPath.trim()) throw new Error("Manifest path is required");
  body.manifestPath = form.manifestPath.trim();

  if (action === "sync_to_paperclip" && form.issueId.trim()) {
    body.issueId = form.issueId.trim();
  }

  if (action === "update_static_homepage" && form.channelUrl.trim()) {
    body.channelUrl = form.channelUrl.trim();
  }

  if (action === "update_static_homepage" && form.publicUrl.trim()) {
    body.publicUrl = form.publicUrl.trim();
  }

  if (action === "publish_episode_to_homepage") {
    if (!form.confirmDangerousAction) {
      throw new Error("Confirm the publish action before running it.");
    }
    body.confirmDangerousAction = true;
    if (form.publishDate.trim()) body.publishDate = form.publishDate.trim();
  }

  return body;
}

function ActionField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      <Input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="font-mono text-xs"
      />
    </div>
  );
}

function ActionForm({
  workflow,
  selectedAction,
  form,
  setForm,
  onRun,
  isRunning,
}: {
  workflow: PodcastWorkflow;
  selectedAction: WorkflowAction;
  form: ActionFormState;
  setForm: (updater: (current: ActionFormState) => ActionFormState) => void;
  onRun: () => void;
  isRunning: boolean;
}) {
  const setValue = (key: keyof ActionFormState, value: string | boolean) => {
    setForm((current) => ({ ...current, [key]: value }));
  };
  const validation = getActionValidation(workflow, selectedAction, form);

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Run Configuration</h2>
        <p className="text-xs text-muted-foreground">
          Inputs are persisted in the workflow state. Run only the selected governed action.
        </p>
      </div>

      {validation.errors.length > 0 && (
        <div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
          <div className="font-medium">Action is not ready</div>
          <ul className="mt-1 space-y-1 pl-4">
            {validation.errors.map((error) => (
              <li key={error} className="list-disc">
                {error}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {selectedAction === "initialize_manifest" && (
          <>
            <ActionField
              label="Source Media Path"
              value={form.sourceMediaPath}
              onChange={(value) => setValue("sourceMediaPath", value)}
              placeholder="/absolute/path/to/media.mp4"
            />
            <ActionField
              label="Runtime Root"
              value={form.runtimeRoot}
              onChange={(value) => setValue("runtimeRoot", value)}
              placeholder="/absolute/path/to/runtime"
            />
            <ActionField
              label="Episode Id"
              value={form.episodeId}
              onChange={(value) => setValue("episodeId", value)}
              placeholder="optional explicit id"
            />
            <ActionField
              label="Title"
              value={form.title}
              onChange={(value) => setValue("title", value)}
              placeholder="optional title override"
            />
            <ActionField
              label="Publish Date"
              value={form.publishDate}
              onChange={(value) => setValue("publishDate", value)}
              placeholder="optional ISO timestamp"
            />
          </>
        )}

        {selectedAction === "run_latest_youtube_pipeline" && (
          <>
            <ActionField
              label="Runtime Root"
              value={form.runtimeRoot}
              onChange={(value) => setValue("runtimeRoot", value)}
              placeholder="/absolute/path/to/runtime"
            />
            <ActionField
              label="Channel URL"
              value={form.channelUrl}
              onChange={(value) => setValue("channelUrl", value)}
              placeholder="https://www.youtube.com/@your-channel/videos"
            />
            <ActionField
              label="Playlist Index"
              value={form.playlistIndex}
              onChange={(value) => setValue("playlistIndex", value)}
              placeholder="1"
              type="number"
            />
          </>
        )}

        {selectedAction !== "initialize_manifest" &&
          selectedAction !== "run_latest_youtube_pipeline" && (
            <ActionField
              label="Manifest Path"
              value={form.manifestPath}
              onChange={(value) => setValue("manifestPath", value)}
              placeholder="/absolute/path/to/manifest.json"
            />
          )}

        {selectedAction === "sync_to_paperclip" && (
          <ActionField
            label="Review Issue Id"
            value={form.issueId}
            onChange={(value) => setValue("issueId", value)}
            placeholder="leave blank to auto-create"
          />
        )}

        {selectedAction === "update_static_homepage" && (
          <>
            <ActionField
              label="Channel URL"
              value={form.channelUrl}
              onChange={(value) => setValue("channelUrl", value)}
              placeholder="optional channel/archive url override"
            />
            <ActionField
              label="Public URL"
              value={form.publicUrl}
              onChange={(value) => setValue("publicUrl", value)}
              placeholder="https://www.youtube.com/watch?v=..."
            />
          </>
        )}

        {selectedAction === "publish_episode_to_homepage" && (
          <ActionField
            label="Publish Date"
            value={form.publishDate}
            onChange={(value) => setValue("publishDate", value)}
            placeholder="optional ISO timestamp"
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs">
        <label className="inline-flex items-center gap-2 text-muted-foreground">
          <input
            type="checkbox"
            checked={form.force}
            onChange={(event) => setValue("force", event.target.checked)}
          />
          Force overwrite when supported
        </label>
        {selectedAction === "publish_episode_to_homepage" && (
          <label className="inline-flex items-center gap-2 text-red-700 dark:text-red-300">
            <input
              type="checkbox"
              checked={form.confirmDangerousAction}
              onChange={(event) => setValue("confirmDangerousAction", event.target.checked)}
            />
            I confirm board approval is already satisfied
          </label>
        )}
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={onRun} disabled={isRunning || !validation.canRun}>
          {isRunning ? "Running…" : "Run Action"}
        </Button>
      </div>
    </div>
  );
}

export function PodcastWorkflowDetail() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const [searchParams] = useSearchParams();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [selectedAction, setSelectedAction] = useState<WorkflowAction | null>(null);
  const [form, setForm] = useState<ActionFormState | null>(null);

  const { data: workflow, isLoading, error } = useQuery({
    queryKey: queryKeys.podcastWorkflows.detail(workflowId!),
    queryFn: () => podcastWorkflowsApi.get(workflowId!),
    enabled: Boolean(workflowId),
  });

  const { data: operations = [] } = useQuery({
    queryKey: queryKeys.podcastWorkflows.operations(workflowId!),
    queryFn: () => podcastWorkflowsApi.operations(workflowId!),
    enabled: Boolean(workflowId),
    refetchInterval: workflow?.metadata?.lastRun ? 5000 : false,
  });

  useEffect(() => {
    if (!workflow) {
      setBreadcrumbs([{ label: "Podcast Ops", href: "/podcast-ops" }, { label: "Workflow" }]);
      return;
    }
    setBreadcrumbs([
      { label: "Podcast Ops", href: "/podcast-ops" },
      { label: workflow.title },
    ]);
  }, [setBreadcrumbs, workflow]);

  useEffect(() => {
    if (!workflow) return;
    const availableActions = actionsForWorkflow(workflow);
    const requestedAction = searchParams.get("action") as WorkflowAction | null;
    const nextAction =
      requestedAction && availableActions.some((entry) => entry.action === requestedAction)
        ? requestedAction
        : availableActions[0]?.action ?? null;
    setSelectedAction((current) =>
      requestedAction && availableActions.some((entry) => entry.action === requestedAction)
        ? requestedAction
        : current && availableActions.some((entry) => entry.action === current)
          ? current
          : nextAction,
    );
    setForm(createActionFormState(workflow));
  }, [searchParams, workflow]);

  const runWorkflow = useMutation({
    mutationFn: async () => {
      if (!workflow) throw new Error("Workflow not loaded");
      if (!selectedAction) throw new Error("Select a workflow action");
      if (!form) throw new Error("Workflow form not ready");
      const validation = getActionValidation(workflow, selectedAction, form);
      if (!validation.canRun) throw new Error(validation.errors[0] ?? "Workflow action is not ready");
      return podcastWorkflowsApi.run(workflow.id, buildRunBody(selectedAction, form));
    },
    onSuccess: async () => {
      if (!workflowId) return;
      await queryClient.invalidateQueries({ queryKey: queryKeys.podcastWorkflows.detail(workflowId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.podcastWorkflows.operations(workflowId) });
      await queryClient.invalidateQueries({ queryKey: ["podcast-workflows"] });
    },
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading workflow...</p>;
  if (error) return <p className="text-sm text-destructive">{error instanceof Error ? error.message : "Failed to load workflow"}</p>;
  if (!workflow) return null;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{workflow.type.replaceAll("_", " ")}</div>
        <h1 className="text-2xl font-semibold">{workflow.title}</h1>
        <p className="text-sm text-muted-foreground">{workflow.description ?? "No description."}</p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap gap-2">
          {actionsForWorkflow(workflow).map((action) => (
            <Button
              key={action.action}
              size="sm"
              variant={selectedAction === action.action ? "default" : "outline"}
              disabled={runWorkflow.isPending}
              onClick={() => setSelectedAction(action.action)}
            >
              {action.label}
            </Button>
          ))}
        </div>
        {runWorkflow.error && (
          <p className="mt-3 text-sm text-destructive">
            {runWorkflow.error instanceof ApiError
              ? runWorkflow.error.message
              : runWorkflow.error instanceof Error
                ? runWorkflow.error.message
                : "Failed to run workflow action."}
          </p>
        )}
      </div>

      {selectedAction && form && (
        <ActionForm
          workflow={workflow}
          selectedAction={selectedAction}
          form={form}
          setForm={(updater) => {
            setForm((current) => (current ? updater(current) : current));
          }}
          onRun={() => runWorkflow.mutate()}
          isRunning={runWorkflow.isPending}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Run History</h2>
          <div className="mt-4 space-y-3">
            {operations.length === 0 && (
              <div className="text-sm text-muted-foreground">No workflow operations recorded yet.</div>
            )}
            {operations.map((operation) => (
              <div key={operation.id} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{phaseLabel(operation.phase)}</span>
                  <StatusBadge status={operation.status} />
                  <span className="text-xs text-muted-foreground">{relativeTime(operation.startedAt)}</span>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Started {formatDateTime(operation.startedAt)}
                  {operation.finishedAt ? ` · Finished ${formatDateTime(operation.finishedAt)}` : ""}
                  {operation.exitCode != null ? ` · Exit ${operation.exitCode}` : ""}
                </div>
                {operation.command && (
                  <pre className="mt-2 overflow-x-auto rounded bg-muted/40 p-2 font-mono text-xs">
                    {redactHomePathUserSegments(operation.command)}
                  </pre>
                )}
                {operation.stderrExcerpt && (
                  <div className="mt-2 rounded bg-red-500/5 p-2 font-mono text-xs text-red-700 dark:text-red-300">
                    {redactHomePathUserSegments(operation.stderrExcerpt)}
                  </div>
                )}
                {operation.stdoutExcerpt && (
                  <div className="mt-2 rounded bg-muted/40 p-2 font-mono text-xs">
                    {redactHomePathUserSegments(operation.stdoutExcerpt)}
                  </div>
                )}
                <div className="mt-2">
                  <OperationLogViewer operation={operation} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4 space-y-4">
          <div>
            <h2 className="text-sm font-semibold">Workflow State</h2>
            <div className="mt-2 text-sm text-muted-foreground">Status: {workflow.status}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Manifest</div>
            <div className="mt-1 space-y-1 text-sm">
              <div className="font-mono break-all">{workflow.manifest.manifestPath ?? "Not initialized"}</div>
              <div className="font-mono break-all">{workflow.manifest.runtimeRoot ?? "No runtime root"}</div>
              {workflow.issueId && (
                <div>
                  Linked issue: <Link className="underline" to={`/issues/${workflow.issueId}`}>{workflow.issueId}</Link>
                </div>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Stages</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(workflow.stageStatus).map(([stage, value]) => (
                <span key={stage} className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground">
                  {stage}:{" "}
                  <span className={workflowStageStatusText[value] ?? workflowStageStatusTextDefault}>{value}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
