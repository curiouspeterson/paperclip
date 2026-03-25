import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PodcastWorkflow, WorkspaceOperation } from "@paperclipai/shared";
import type { WorkspaceOperationRecorder } from "../services/workspace-operations.ts";
import { runPodcastWorkflowAction } from "../services/podcast-workflow-runs.ts";

const tempDirs = new Set<string>();

function createRecorderDouble(): WorkspaceOperationRecorder {
  return {
    attachExecutionWorkspaceId: async () => {},
    recordOperation: async (input) => {
      const startedAt = new Date();
      const result = await input.run();
      const finishedAt = new Date();
      return {
        id: randomUUID(),
        companyId: "company-1",
        executionWorkspaceId: null,
        heartbeatRunId: null,
        phase: input.phase,
        command: input.command ?? null,
        cwd: input.cwd ?? null,
        status: (result.status ?? "succeeded") as WorkspaceOperation["status"],
        exitCode: result.exitCode ?? null,
        logStore: "local_file",
        logRef: "test-operation.ndjson",
        logBytes: 0,
        logSha256: null,
        logCompressed: false,
        stdoutExcerpt: result.stdout ?? null,
        stderrExcerpt: result.stderr ?? null,
        metadata: input.metadata ?? null,
        startedAt,
        finishedAt,
        createdAt: startedAt,
        updatedAt: finishedAt,
      };
    },
  };
}

async function createTempWorkflow() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-podcast-workflow-"));
  tempDirs.add(dir);

  const manifestPath = path.join(dir, "manifest.json");
  await fs.writeFile(
    manifestPath,
    JSON.stringify(
      {
        episode_id: "episode-1",
        runtime: { root_path: dir },
        source: { media_path: "/tmp/source.mp4", public_url: "https://example.com/video", channel_url: "https://www.youtube.com/@example/videos" },
        status: {
          board_review: "ready",
          approval_packet: "ready",
          social_drafts: "ready",
          newsletter_draft: "ready",
          instagram_dry_run: "ready",
          mailchimp_dry_run: "ready",
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const boardReviewScript = path.join(dir, "generate_board_review.sh");
  const publishScript = path.join(dir, "publish_episode_to_homepage.sh");
  await fs.writeFile(boardReviewScript, "#!/usr/bin/env bash\necho board-review\n", "utf8");
  await fs.writeFile(publishScript, "#!/usr/bin/env bash\necho publish-homepage\n", "utf8");

  const workflow: PodcastWorkflow = {
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
      episodeId: "episode-1",
      manifestPath,
      runtimeRoot: dir,
      sourceMediaPath: "/tmp/source.mp4",
      publicUrl: "https://example.com/video",
      channelUrl: "https://www.youtube.com/@example/videos",
    },
    stageStatus: {
      board_review: "missing",
      homepage_publish: "missing",
    },
    scriptRefs: {
      initializeManifestPath: null,
      runLatestYouTubePipelinePath: null,
      generateApprovalPacketPath: null,
      generateSocialDraftsPath: null,
      generateBoardReviewPath: boardReviewScript,
      generateConnectorRunbooksPath: null,
      syncBatchToPaperclipPath: null,
      publishEpisodeToHomepagePath: publishScript,
      updateStaticHomepagePath: null,
    },
    metadata: {
      repositoryPath: dir,
    },
    lastSyncedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return workflow;
}

afterEach(async () => {
  await Promise.all(
    Array.from(tempDirs).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
  tempDirs.clear();
});

describe("runPodcastWorkflowAction", () => {
  it("uses the configured python binary for python scripts", async () => {
    const workflow = await createTempWorkflow();
    const scriptPath = path.join(workflow.manifest.runtimeRoot ?? "", "generate_board_review.py");
    await fs.writeFile(scriptPath, "#!/usr/bin/env python3\nprint('ok')\n", "utf8");
    await fs.chmod(scriptPath, 0o755);

    const original = process.env.PAPERCLIP_PYTHON_BIN;
    process.env.PAPERCLIP_PYTHON_BIN = "/opt/homebrew/bin/python3";

    try {
      const result = await runPodcastWorkflowAction({
        workflow: {
          ...workflow,
          scriptRefs: {
            ...workflow.scriptRefs,
            generateBoardReviewPath: scriptPath,
          },
        },
        request: {
          action: "generate_board_review",
          manifestPath: workflow.manifest.manifestPath,
        },
        recorder: createRecorderDouble(),
      });

      expect(result.operation.command).toContain("/opt/homebrew/bin/python3");
    } finally {
      if (original === undefined) delete process.env.PAPERCLIP_PYTHON_BIN;
      else process.env.PAPERCLIP_PYTHON_BIN = original;
    }
  });

  it("resolves relative script refs from the active repo root", async () => {
    const workflow = await createTempWorkflow();
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-podcast-repo-"));
    tempDirs.add(repoRoot);
    await fs.mkdir(path.join(repoRoot, "bin"), { recursive: true });
    await fs.writeFile(
      path.join(repoRoot, "bin", "generate_board_review.py"),
      "#!/usr/bin/env python3\nimport os\nprint(os.getcwd())\n",
      "utf8",
    );
    await fs.chmod(path.join(repoRoot, "bin", "generate_board_review.py"), 0o755);

    const originalRepoRoot = process.env.PAPERCLIP_REPO_ROOT;

    try {
      process.env.PAPERCLIP_REPO_ROOT = repoRoot;
      const canonicalRepoRoot = await fs.realpath(repoRoot);
      const result = await runPodcastWorkflowAction({
        workflow: {
          ...workflow,
          scriptRefs: {
            ...workflow.scriptRefs,
            generateBoardReviewPath: "bin/generate_board_review.py",
          },
          metadata: {},
        },
        request: {
          action: "generate_board_review",
          manifestPath: workflow.manifest.manifestPath,
        },
        recorder: createRecorderDouble(),
      });
      const canonicalOperationCwd = await fs.realpath(result.operation.cwd ?? "");
      const canonicalStdoutCwd = await fs.realpath(result.operation.stdoutExcerpt?.trim() ?? "");

      expect(result.operation.status).toBe("succeeded");
      expect(result.operation.command).toContain("bin/generate_board_review.py");
      expect(canonicalOperationCwd).toBe(canonicalRepoRoot);
      expect(canonicalStdoutCwd).toBe(canonicalRepoRoot);
    } finally {
      if (originalRepoRoot === undefined) delete process.env.PAPERCLIP_REPO_ROOT;
      else process.env.PAPERCLIP_REPO_ROOT = originalRepoRoot;
    }
  });

  it("marks successful non-final actions as active", async () => {
    const workflow = await createTempWorkflow();
    const result = await runPodcastWorkflowAction({
      workflow,
      request: {
        action: "generate_board_review",
        manifestPath: workflow.manifest.manifestPath,
      },
      recorder: createRecorderDouble(),
    });

    expect(result.operation.status).toBe("succeeded");
    expect(result.workflowPatch.status).toBe("active");
    expect(result.workflowPatch.stageStatus.board_review).toBe("ready");
  });

  it("marks publish actions as done", async () => {
    const workflow = await createTempWorkflow();
    const result = await runPodcastWorkflowAction({
      workflow,
      request: {
        action: "publish_episode_to_homepage",
        manifestPath: workflow.manifest.manifestPath,
        confirmDangerousAction: true,
      },
      recorder: createRecorderDouble(),
    });

    expect(result.operation.status).toBe("succeeded");
    expect(result.workflowPatch.status).toBe("done");
    expect(result.workflowPatch.stageStatus.homepage_publish).toBe("ready");
  });
});
