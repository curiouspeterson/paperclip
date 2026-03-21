import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type {
  PodcastWorkflow,
  RunPodcastWorkflow,
  WorkspaceOperation,
} from "@paperclipai/shared";
import type { WorkspaceOperationRecorder } from "./workspace-operations.js";

type RunAction = RunPodcastWorkflow["action"];

function requireString(
  value: string | null | undefined,
  message: string,
): string {
  if (!value || value.trim().length === 0) {
    throw new Error(message);
  }
  return value.trim();
}

function requireScriptPath(
  scriptPath: string | null | undefined,
  action: RunAction,
): string {
  const resolved = requireString(scriptPath, `Workflow is missing a script ref for ${action}`);
  if (!path.isAbsolute(resolved)) {
    throw new Error(`Script ref for ${action} must be an absolute path`);
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`Script not found for ${action}: ${resolved}`);
  }
  return resolved;
}

function resolveManifestPath(
  workflow: PodcastWorkflow,
  input: RunPodcastWorkflow,
): string {
  return requireString(
    input.manifestPath ?? workflow.manifest.manifestPath,
    "Manifest path is required for this workflow action",
  );
}

function resolveRuntimeRoot(
  workflow: PodcastWorkflow,
  input: RunPodcastWorkflow,
): string {
  return requireString(
    input.runtimeRoot ?? workflow.manifest.runtimeRoot,
    "Runtime root is required for this workflow action",
  );
}

function commandForScript(scriptPath: string) {
  const ext = path.extname(scriptPath).toLowerCase();
  if (ext === ".py") return { command: "python3", args: [scriptPath] };
  if (ext === ".mjs") return { command: "node", args: [scriptPath] };
  if (ext === ".sh") return { command: "bash", args: [scriptPath] };
  throw new Error(`Unsupported script type: ${scriptPath}`);
}

function buildActionInvocation(workflow: PodcastWorkflow, input: RunPodcastWorkflow) {
  const force = input.force ? ["--force"] : [];
  switch (input.action) {
    case "initialize_manifest": {
      const scriptPath = requireScriptPath(
        workflow.scriptRefs.initializeManifestPath,
        input.action,
      );
      const sourceMediaPath = requireString(
        input.sourceMediaPath ?? workflow.manifest.sourceMediaPath,
        "Source media path is required to initialize the manifest",
      );
      const runtimeRoot = resolveRuntimeRoot(workflow, input);
      return {
        scriptPath,
        ...commandForScript(scriptPath),
        extraArgs: [
          "--source",
          sourceMediaPath,
          "--root",
          runtimeRoot,
          ...(input.episodeId ? ["--episode-id", input.episodeId] : []),
          ...(input.title ? ["--title", input.title] : []),
          ...(input.publishDate ? ["--publish-date", input.publishDate] : []),
          ...force,
        ],
      };
    }
    case "run_latest_youtube_pipeline": {
      const scriptPath = requireScriptPath(
        workflow.scriptRefs.runLatestYouTubePipelinePath,
        input.action,
      );
      const runtimeRoot = resolveRuntimeRoot(workflow, input);
      return {
        scriptPath,
        ...commandForScript(scriptPath),
        extraArgs: [
          "--root",
          runtimeRoot,
          ...(input.channelUrl ?? workflow.manifest.channelUrl
            ? ["--channel-url", input.channelUrl ?? workflow.manifest.channelUrl!]
            : []),
          ...(input.playlistIndex ? ["--playlist-index", String(input.playlistIndex)] : []),
          ...force,
        ],
      };
    }
    case "generate_approval_packet": {
      const scriptPath = requireScriptPath(
        workflow.scriptRefs.generateApprovalPacketPath,
        input.action,
      );
      return {
        scriptPath,
        ...commandForScript(scriptPath),
        extraArgs: ["--manifest", resolveManifestPath(workflow, input), ...force],
      };
    }
    case "generate_social_drafts": {
      const scriptPath = requireScriptPath(
        workflow.scriptRefs.generateSocialDraftsPath,
        input.action,
      );
      return {
        scriptPath,
        ...commandForScript(scriptPath),
        extraArgs: ["--manifest", resolveManifestPath(workflow, input), ...force],
      };
    }
    case "generate_board_review": {
      const scriptPath = requireScriptPath(
        workflow.scriptRefs.generateBoardReviewPath,
        input.action,
      );
      return {
        scriptPath,
        ...commandForScript(scriptPath),
        extraArgs: ["--manifest", resolveManifestPath(workflow, input), ...force],
      };
    }
    case "generate_connector_runbooks": {
      const scriptPath = requireScriptPath(
        workflow.scriptRefs.generateConnectorRunbooksPath,
        input.action,
      );
      return {
        scriptPath,
        ...commandForScript(scriptPath),
        extraArgs: ["--manifest", resolveManifestPath(workflow, input), ...force],
      };
    }
    case "update_static_homepage": {
      const scriptPath = requireScriptPath(
        workflow.scriptRefs.updateStaticHomepagePath,
        input.action,
      );
      return {
        scriptPath,
        ...commandForScript(scriptPath),
        extraArgs: [
          "--manifest",
          resolveManifestPath(workflow, input),
          ...(input.channelUrl ? ["--channel-url", input.channelUrl] : []),
          ...(input.publicUrl ? ["--public-url", input.publicUrl] : []),
          ...force,
        ],
      };
    }
    case "publish_episode_to_homepage": {
      if (!input.confirmDangerousAction) {
        throw new Error("Publishing requires confirmDangerousAction=true");
      }
      const scriptPath = requireScriptPath(
        workflow.scriptRefs.publishEpisodeToHomepagePath,
        input.action,
      );
      return {
        scriptPath,
        ...commandForScript(scriptPath),
        extraArgs: [
          "--manifest",
          resolveManifestPath(workflow, input),
          ...(input.publishDate ? ["--publish-date", input.publishDate] : []),
        ],
      };
    }
    default:
      throw new Error(`Unsupported scripted workflow action: ${String(input.action)}`);
  }
}

function patchWorkflowAfterRun(
  workflow: PodcastWorkflow,
  input: RunPodcastWorkflow,
  operation: WorkspaceOperation,
) {
  const now = new Date();
  const metadata = {
    ...(workflow.metadata ?? {}),
    lastRun: {
      operationId: operation.id,
      action: input.action,
      status: operation.status,
      exitCode: operation.exitCode,
      finishedAt: operation.finishedAt ?? now,
    },
  };
  const stageStatus = { ...workflow.stageStatus };
  let manifest = { ...workflow.manifest };
  let status = workflow.status;

  if (operation.status === "succeeded") {
    if (input.action === "initialize_manifest") {
      const stdout = operation.stdoutExcerpt?.trim() ?? "";
      const manifestPath =
        stdout.split("\n").map((line) => line.trim()).filter(Boolean).at(-1) ??
        manifest.manifestPath;
      if (manifestPath && fs.existsSync(manifestPath)) {
        const payload = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
        manifest = {
          ...manifest,
          manifestPath,
          runtimeRoot:
            typeof payload.runtime === "object" &&
            payload.runtime &&
            typeof (payload.runtime as Record<string, unknown>).root_path === "string"
              ? ((payload.runtime as Record<string, unknown>).root_path as string)
              : manifest.runtimeRoot,
          episodeId: typeof payload.episode_id === "string" ? payload.episode_id : manifest.episodeId,
          sourceMediaPath:
            typeof payload.source === "object" &&
            payload.source &&
            typeof (payload.source as Record<string, unknown>).media_path === "string"
              ? ((payload.source as Record<string, unknown>).media_path as string)
              : manifest.sourceMediaPath,
          publicUrl:
            typeof payload.source === "object" &&
            payload.source &&
            typeof (payload.source as Record<string, unknown>).public_url === "string"
              ? ((payload.source as Record<string, unknown>).public_url as string)
              : manifest.publicUrl,
          channelUrl:
            typeof payload.source === "object" &&
            payload.source &&
            typeof (payload.source as Record<string, unknown>).channel_url === "string"
              ? ((payload.source as Record<string, unknown>).channel_url as string)
              : manifest.channelUrl,
        };
      }
      stageStatus.manifest = "ready";
      status = "active";
    }
    if (input.action === "generate_approval_packet") stageStatus.approval_packet = "ready";
    if (input.action === "generate_social_drafts") stageStatus.social_drafts = "ready";
    if (input.action === "generate_board_review") stageStatus.board_review = "ready";
    if (input.action === "generate_connector_runbooks") stageStatus.connector_runbooks = "ready";
    if (input.action === "update_static_homepage") stageStatus.homepage_update = "ready";
    if (input.action === "publish_episode_to_homepage") {
      stageStatus.homepage_publish = "ready";
      status = "done";
    }
    if (input.action === "run_latest_youtube_pipeline") {
      stageStatus.intake = "ready";
      status = "active";
    }
  } else {
    stageStatus[input.action] = "blocked";
    status = "blocked";
  }

  return {
    metadata,
    manifest,
    stageStatus,
    status,
    lastSyncedAt: now,
  };
}

export async function runPodcastWorkflowAction(input: {
  workflow: PodcastWorkflow;
  request: RunPodcastWorkflow;
  recorder: WorkspaceOperationRecorder;
}) {
  const invocation = buildActionInvocation(input.workflow, input.request);
  const cwd =
    (typeof input.workflow.metadata?.repositoryPath === "string" &&
    input.workflow.metadata.repositoryPath.length > 0
      ? input.workflow.metadata.repositoryPath
      : path.dirname(invocation.scriptPath));

  const operation = await input.recorder.recordOperation({
    phase: "external_workflow_run",
    command: [invocation.command, ...invocation.args, ...invocation.extraArgs].join(" "),
    cwd,
    metadata: {
      kind: "podcast_workflow_run",
      workflowId: input.workflow.id,
      workflowType: input.workflow.type,
      action: input.request.action,
      scriptPath: invocation.scriptPath,
    },
    run: () =>
      new Promise((resolve, reject) => {
        const child = spawn(
          invocation.command,
          [...invocation.args, ...invocation.extraArgs],
          {
            cwd,
            env: {
              ...process.env,
              PYTHONUNBUFFERED: "1",
            },
          },
        );
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
          stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });
        child.on("error", reject);
        child.on("close", (code) => {
          resolve({
            status: code === 0 ? "succeeded" : "failed",
            exitCode: code,
            stdout,
            stderr,
          });
        });
      }),
  });

  return {
    operation,
    workflowPatch: patchWorkflowAfterRun(input.workflow, input.request, operation),
  };
}
