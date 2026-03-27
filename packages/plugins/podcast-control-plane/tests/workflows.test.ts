import { describe, expect, it } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import type { Project } from "@paperclipai/plugin-sdk";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";
import { ACTION_KEYS, DATA_KEYS, EXPORT_NAMES, SLOT_IDS, STATE_NAMESPACES } from "../src/constants.js";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const PRIMARY_WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";

function createProjectFixture(options: { primaryWorkspace?: boolean } = {}): Project {
  const now = new Date();
  const primaryWorkspace: NonNullable<Project["primaryWorkspace"]> | null = options.primaryWorkspace === false
    ? null
    : {
      id: PRIMARY_WORKSPACE_ID,
      companyId: COMPANY_ID,
      projectId: PROJECT_ID,
      name: "Romance Unzipped Repo",
      sourceType: "local_path",
      cwd: "/tmp/romance-unzipped",
      repoUrl: null,
      repoRef: null,
      defaultRef: null,
      visibility: "default",
      setupCommand: null,
      cleanupCommand: null,
      remoteProvider: null,
      remoteWorkspaceRef: null,
      sharedWorkspaceKey: null,
      metadata: null,
      isPrimary: true,
      createdAt: now,
      updatedAt: now,
    };

  return {
    id: PROJECT_ID,
    companyId: COMPANY_ID,
    urlKey: "romance-unzipped",
    goalId: null,
    goalIds: [],
    goals: [],
    name: "Romance Unzipped",
    description: "Podcast production pipeline",
    status: "planned",
    leadAgentId: null,
    targetDate: null,
    color: null,
    pauseReason: null,
    pausedAt: null,
    executionWorkspacePolicy: null,
    codebase: {
      workspaceId: primaryWorkspace?.id ?? null,
      repoUrl: null,
      repoRef: null,
      defaultRef: null,
      repoName: null,
      localFolder: "/tmp/romance-unzipped",
      managedFolder: "/tmp/romance-unzipped",
      effectiveLocalFolder: "/tmp/romance-unzipped",
      origin: "local_folder",
    },
    workspaces: primaryWorkspace ? [primaryWorkspace] : [],
    primaryWorkspace,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("podcast workflow worker contract", () => {
  it("creates, updates, lists, and deletes company-scoped workflows in plugin state", async () => {
    const harness = createTestHarness({ manifest, capabilities: manifest.capabilities });
    await plugin.definition.setup(harness.ctx);

    const created = await harness.performAction<{
      workflow: {
        id: string;
        companyId: string;
        name: string;
        slug: string;
        templateKey: string;
        status: string;
        description: string;
        projectId: string | null;
      };
    }>(ACTION_KEYS.upsertWorkflow, {
      companyId: "company-1",
      name: "Episode Pipeline",
      templateKey: "episode-pipeline",
      description: "Track the main episode production flow.",
    });

    expect(created.workflow).toEqual(
      expect.objectContaining({
        companyId: "company-1",
        name: "Episode Pipeline",
        slug: "episode-pipeline",
        templateKey: "episode-pipeline",
        status: "draft",
        description: "Track the main episode production flow.",
        projectId: null,
      }),
    );

    expect(
      harness.getState({
        scopeKind: "company",
        scopeId: "company-1",
        namespace: "podcast-control-plane",
        stateKey: "workflow-index",
      }),
    ).toEqual(
      expect.objectContaining({
        version: 1,
        workflowIds: [created.workflow.id],
      }),
    );

    expect(
      harness.getState({
        scopeKind: "company",
        scopeId: "company-1",
        namespace: "podcast-control-plane.workflow",
        stateKey: created.workflow.id,
      }),
    ).toEqual(
      expect.objectContaining({
        id: created.workflow.id,
        companyId: "company-1",
        name: "Episode Pipeline",
      }),
    );

    const list = await harness.getData<{
      workflows: Array<{ id: string; name: string; status: string; templateKey: string }>;
    }>(DATA_KEYS.workflowList, { companyId: "company-1" });

    expect(list.workflows).toEqual([
      expect.objectContaining({
        id: created.workflow.id,
        name: "Episode Pipeline",
        status: "draft",
        templateKey: "episode-pipeline",
      }),
    ]);

    const updated = await harness.performAction<{
      workflow: {
        id: string;
        name: string;
        status: string;
        templateKey: string;
        projectId: string | null;
      };
    }>(ACTION_KEYS.upsertWorkflow, {
      companyId: "company-1",
      workflowId: created.workflow.id,
      name: "Episode Pipeline",
      templateKey: "newsletter-promo",
      status: "active",
      projectId: "project-1",
      description: "Track episodes and newsletter promotion.",
    });

    expect(updated.workflow).toEqual(
      expect.objectContaining({
        id: created.workflow.id,
        status: "active",
        templateKey: "newsletter-promo",
        projectId: "project-1",
      }),
    );

    const detail = await harness.getData<{
      workflow: {
        id: string;
        projectId: string | null;
        description: string;
      } | null;
    }>(DATA_KEYS.workflowDetail, { companyId: "company-1", workflowId: created.workflow.id });

    expect(detail.workflow).toEqual(
      expect.objectContaining({
        id: created.workflow.id,
        projectId: "project-1",
        description: "Track episodes and newsletter promotion.",
      }),
    );

    const projectList = await harness.getData<{
      workflows: Array<{ id: string }>;
    }>(DATA_KEYS.workflowList, { companyId: "company-1", projectId: "project-1" });

    expect(projectList.workflows).toEqual([expect.objectContaining({ id: created.workflow.id })]);

    await expect(
      harness.performAction(ACTION_KEYS.deleteWorkflow, {
        companyId: "company-1",
        workflowId: created.workflow.id,
      }),
    ).resolves.toEqual({
      ok: true,
      workflowId: created.workflow.id,
    });

    await expect(
      harness.getData(DATA_KEYS.workflowList, { companyId: "company-1" }),
    ).resolves.toEqual({
      workflows: [],
      total: 0,
    });

    expect(
      harness.getState({
        scopeKind: "company",
        scopeId: "company-1",
        namespace: "podcast-control-plane.workflow",
        stateKey: created.workflow.id,
      }),
    ).toBeUndefined();
  });

  it("exposes the supported workflow templates", async () => {
    const harness = createTestHarness({ manifest, capabilities: manifest.capabilities });
    await plugin.definition.setup(harness.ctx);

    await expect(harness.getData<{
      templates: Array<{ key: string; displayName: string }>;
    }>(DATA_KEYS.workflowTemplates)).resolves.toEqual({
      templates: [
        expect.objectContaining({ key: "episode-pipeline", displayName: "Episode Pipeline" }),
        expect.objectContaining({ key: "clips-social", displayName: "Clips + Social" }),
        expect.objectContaining({ key: "newsletter-promo", displayName: "Newsletter Promotion" }),
      ],
    });
  });

  it("lists workflow stages and syncs a stage to a reusable Paperclip issue", async () => {
    const harness = createTestHarness({ manifest, capabilities: manifest.capabilities });
    await plugin.definition.setup(harness.ctx);
    harness.seed({
      projects: [createProjectFixture()],
    });

    const created = await harness.performAction<{
      workflow: {
        id: string;
        name: string;
      };
    }>(ACTION_KEYS.upsertWorkflow, {
      companyId: COMPANY_ID,
      name: "Episode 26 Production",
      templateKey: "episode-pipeline",
      description: "Coordinate the episode transcript and release process.",
      projectId: PROJECT_ID,
    });

    await expect(
      harness.getData<{
        stages: Array<{
          key: string;
          displayName: string;
          sync: {
            status: string;
            issueId: string | null;
          };
        }>;
      }>("workflow-stages", {
        companyId: COMPANY_ID,
        workflowId: created.workflow.id,
      }),
    ).resolves.toEqual({
      stages: expect.arrayContaining([
        expect.objectContaining({
          key: "transcript",
          displayName: "Transcript",
          sync: expect.objectContaining({
            status: "unsynced",
            issueId: null,
          }),
        }),
      ]),
    });

    const firstSync = await harness.performAction<{
      issue: {
        id: string;
        title: string;
        projectId: string | null;
        status: string;
      };
      sync: {
        issueId: string;
        projectId: string;
        projectWorkspaceId: string;
        stageKey: string;
      };
    }>("sync-workflow-stage-issue", {
      companyId: COMPANY_ID,
      workflowId: created.workflow.id,
      stageKey: "transcript",
    });

    expect(firstSync.issue).toEqual(
      expect.objectContaining({
        title: "Episode 26 Production: Transcript",
        projectId: PROJECT_ID,
        status: "todo",
      }),
    );
    expect(firstSync.sync).toEqual(
      expect.objectContaining({
        issueId: firstSync.issue.id,
        projectId: PROJECT_ID,
        projectWorkspaceId: PRIMARY_WORKSPACE_ID,
        stageKey: "transcript",
      }),
    );

    expect(
      harness.getState({
        scopeKind: "company",
        scopeId: COMPANY_ID,
        namespace: "podcast-control-plane.workflow-stage-issue",
        stateKey: `${created.workflow.id}:transcript`,
      }),
    ).toEqual(
      expect.objectContaining({
        issueId: firstSync.issue.id,
        projectWorkspaceId: PRIMARY_WORKSPACE_ID,
      }),
    );

    await harness.performAction(ACTION_KEYS.upsertWorkflow, {
      companyId: COMPANY_ID,
      workflowId: created.workflow.id,
      name: "Episode 26 Launch",
      templateKey: "episode-pipeline",
      description: "Drive transcript production and launch readiness.",
      projectId: PROJECT_ID,
      status: "active",
    });

    const secondSync = await harness.performAction<{
      issue: {
        id: string;
        title: string;
        description: string | null;
      };
    }>("sync-workflow-stage-issue", {
      companyId: COMPANY_ID,
      workflowId: created.workflow.id,
      stageKey: "transcript",
    });

    expect(secondSync.issue.id).toBe(firstSync.issue.id);
    expect(secondSync.issue).toEqual(
      expect.objectContaining({
        title: "Episode 26 Launch: Transcript",
        description: expect.stringContaining("Drive transcript production and launch readiness."),
      }),
    );

    await expect(
      harness.getData<{
        stages: Array<{
          key: string;
          sync: {
            status: string;
            issueId: string | null;
            issueTitle: string | null;
          };
        }>;
      }>("workflow-stages", {
        companyId: COMPANY_ID,
        workflowId: created.workflow.id,
      }),
    ).resolves.toEqual({
      stages: expect.arrayContaining([
        expect.objectContaining({
          key: "transcript",
          sync: expect.objectContaining({
            status: "linked",
            issueId: firstSync.issue.id,
            issueTitle: "Episode 26 Launch: Transcript",
          }),
        }),
      ]),
    });

    expect(harness.activity).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "issue",
          entityId: firstSync.issue.id,
        }),
      ]),
    );
  });

  it("rejects stage sync when the bound project has no primary workspace", async () => {
    const harness = createTestHarness({ manifest, capabilities: manifest.capabilities });
    await plugin.definition.setup(harness.ctx);
    harness.seed({
      projects: [createProjectFixture({ primaryWorkspace: false })],
    });

    const created = await harness.performAction<{ workflow: { id: string } }>(ACTION_KEYS.upsertWorkflow, {
      companyId: COMPANY_ID,
      name: "Episode 26 Production",
      templateKey: "episode-pipeline",
      projectId: PROJECT_ID,
    });

    await expect(
      harness.performAction("sync-workflow-stage-issue", {
        companyId: COMPANY_ID,
        workflowId: created.workflow.id,
        stageKey: "transcript",
      }),
    ).rejects.toThrow("Workflow project must expose a primary workspace before stage issues can sync");
  });

  it("records a workflow stage output as a linked issue comment and latest run state", async () => {
    const harness = createTestHarness({ manifest, capabilities: manifest.capabilities });
    await plugin.definition.setup(harness.ctx);
    harness.seed({
      projects: [createProjectFixture()],
    });

    const created = await harness.performAction<{ workflow: { id: string } }>(ACTION_KEYS.upsertWorkflow, {
      companyId: COMPANY_ID,
      name: "Episode 26 Production",
      templateKey: "episode-pipeline",
      description: "Coordinate the episode transcript and release process.",
      projectId: PROJECT_ID,
    });

    const syncResult = await harness.performAction<{
      issue: {
        id: string;
        title: string;
      };
    }>(ACTION_KEYS.syncWorkflowStageIssue, {
      companyId: COMPANY_ID,
      workflowId: created.workflow.id,
      stageKey: "transcript",
    });

    const outputResult = await harness.performAction<{
      run: {
        id: string;
        workflowId: string;
        stageKey: string;
        issueId: string;
        commentId: string;
        summary: string;
        details: string;
      };
      comment: {
        id: string;
        issueId: string;
        body: string;
      };
    }>(ACTION_KEYS.recordWorkflowStageOutput, {
      companyId: COMPANY_ID,
      workflowId: created.workflow.id,
      stageKey: "transcript",
      summary: "Transcript imported and speaker labels normalized.",
      details: "Removed sponsor break duplication.\nReady for editorial review.",
    });

    expect(outputResult.run).toEqual(
      expect.objectContaining({
        workflowId: created.workflow.id,
        stageKey: "transcript",
        issueId: syncResult.issue.id,
        summary: "Transcript imported and speaker labels normalized.",
        details: "Removed sponsor break duplication.\nReady for editorial review.",
      }),
    );
    expect(outputResult.comment).toEqual(
      expect.objectContaining({
        id: outputResult.run.commentId,
        issueId: syncResult.issue.id,
      }),
    );
    expect(outputResult.comment.body).toContain("Episode 26 Production");
    expect(outputResult.comment.body).toContain("Transcript");
    expect(outputResult.comment.body).toContain("Transcript imported and speaker labels normalized.");
    expect(outputResult.comment.body).toContain("Removed sponsor break duplication.");

    const comments = await harness.ctx.issues.listComments(syncResult.issue.id, COMPANY_ID);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toEqual(expect.objectContaining({ id: outputResult.comment.id }));

    expect(
      harness.getState({
        scopeKind: "company",
        scopeId: COMPANY_ID,
        namespace: "podcast-control-plane.workflow-run",
        stateKey: outputResult.run.id,
      }),
    ).toEqual(
      expect.objectContaining({
        id: outputResult.run.id,
        issueId: syncResult.issue.id,
        commentId: outputResult.comment.id,
        summary: "Transcript imported and speaker labels normalized.",
      }),
    );

    expect(
      harness.getState({
        scopeKind: "company",
        scopeId: COMPANY_ID,
        namespace: "podcast-control-plane.workflow-stage-run",
        stateKey: `${created.workflow.id}:transcript`,
      }),
    ).toEqual(
      expect.objectContaining({
        latestRunId: outputResult.run.id,
        latestCommentId: outputResult.comment.id,
      }),
    );

    await expect(
      harness.getData<{
        stages: Array<{
          key: string;
          lastRun: {
            runId: string;
            commentId: string;
            summary: string;
          } | null;
        }>;
      }>(DATA_KEYS.workflowStages, {
        companyId: COMPANY_ID,
        workflowId: created.workflow.id,
      }),
    ).resolves.toEqual({
      stages: expect.arrayContaining([
        expect.objectContaining({
          key: "transcript",
          lastRun: expect.objectContaining({
            runId: outputResult.run.id,
            commentId: outputResult.comment.id,
            summary: "Transcript imported and speaker labels normalized.",
          }),
        }),
      ]),
    });
  });

  it("preserves structured artifact references on recorded stage output", async () => {
    const harness = createTestHarness({ manifest, capabilities: manifest.capabilities });
    await plugin.definition.setup(harness.ctx);
    harness.seed({
      projects: [createProjectFixture()],
    });

    const created = await harness.performAction<{ workflow: { id: string } }>(ACTION_KEYS.upsertWorkflow, {
      companyId: COMPANY_ID,
      name: "Episode 26 Production",
      templateKey: "episode-pipeline",
      description: "Coordinate the episode transcript and release process.",
      projectId: PROJECT_ID,
    });

    await harness.performAction(ACTION_KEYS.syncWorkflowStageIssue, {
      companyId: COMPANY_ID,
      workflowId: created.workflow.id,
      stageKey: "transcript",
    });

    const outputResult = await harness.performAction<{
      run: {
        id: string;
        artifacts: Array<{
          label: string;
          href: string;
        }>;
      };
      comment: {
        body: string;
      };
    }>(ACTION_KEYS.recordWorkflowStageOutput, {
      companyId: COMPANY_ID,
      workflowId: created.workflow.id,
      stageKey: "transcript",
      summary: "Transcript imported and speaker labels normalized.",
      details: "Removed sponsor break duplication.\nReady for editorial review.",
      artifacts: [
        {
          label: "Transcript Doc",
          href: "https://example.com/transcript-doc",
        },
        {
          label: "Editorial Notes",
          href: "paperclip://documents/editorial-notes",
        },
      ],
    });

    expect(outputResult.run.artifacts).toEqual([
      {
        label: "Transcript Doc",
        href: "https://example.com/transcript-doc",
      },
      {
        label: "Editorial Notes",
        href: "paperclip://documents/editorial-notes",
      },
    ]);

    expect(outputResult.comment.body).toContain("Artifacts:");
    expect(outputResult.comment.body).toContain("- Transcript Doc: https://example.com/transcript-doc");
    expect(outputResult.comment.body).toContain("- Editorial Notes: paperclip://documents/editorial-notes");

    expect(
      harness.getState({
        scopeKind: "company",
        scopeId: COMPANY_ID,
        namespace: "podcast-control-plane.workflow-run",
        stateKey: outputResult.run.id,
      }),
    ).toEqual(
      expect.objectContaining({
        artifacts: [
          {
            label: "Transcript Doc",
            href: "https://example.com/transcript-doc",
          },
          {
            label: "Editorial Notes",
            href: "paperclip://documents/editorial-notes",
          },
        ],
      }),
    );

    await expect(
      harness.getData<{
        stages: Array<{
          key: string;
          lastRun: {
            artifacts: Array<{
              label: string;
              href: string;
            }>;
          } | null;
        }>;
      }>(DATA_KEYS.workflowStages, {
        companyId: COMPANY_ID,
        workflowId: created.workflow.id,
      }),
    ).resolves.toEqual({
      stages: expect.arrayContaining([
        expect.objectContaining({
          key: "transcript",
          lastRun: expect.objectContaining({
            artifacts: [
              {
                label: "Transcript Doc",
                href: "https://example.com/transcript-doc",
              },
              {
                label: "Editorial Notes",
                href: "paperclip://documents/editorial-notes",
              },
            ],
          }),
        }),
      ]),
    });
  });

  it("registers a comment annotation surface that resolves artifact refs for a recorded output comment", async () => {
    const ui = await import("../src/ui/index.js");

    expect(manifest.capabilities).toContain("ui.commentAnnotation.register");
    expect(manifest.ui?.slots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "commentAnnotation",
          id: SLOT_IDS.commentAnnotation,
          exportName: EXPORT_NAMES.commentAnnotation,
          entityTypes: ["comment"],
        }),
      ]),
    );
    expect(typeof ui[EXPORT_NAMES.commentAnnotation]).toBe("function");

    const harness = createTestHarness({ manifest, capabilities: manifest.capabilities });
    await plugin.definition.setup(harness.ctx);
    harness.seed({
      projects: [createProjectFixture()],
    });

    const created = await harness.performAction<{ workflow: { id: string } }>(ACTION_KEYS.upsertWorkflow, {
      companyId: COMPANY_ID,
      name: "Episode 26 Production",
      templateKey: "episode-pipeline",
      description: "Coordinate the episode transcript and release process.",
      projectId: PROJECT_ID,
    });

    const syncResult = await harness.performAction<{ issue: { id: string } }>(
      ACTION_KEYS.syncWorkflowStageIssue,
      {
        companyId: COMPANY_ID,
        workflowId: created.workflow.id,
        stageKey: "transcript",
      },
    );

    const outputResult = await harness.performAction<{
      comment: {
        id: string;
      };
    }>(ACTION_KEYS.recordWorkflowStageOutput, {
      companyId: COMPANY_ID,
      workflowId: created.workflow.id,
      stageKey: "transcript",
      summary: "Transcript imported and speaker labels normalized.",
      details: "Removed sponsor break duplication.\nReady for editorial review.",
      artifacts: [
        {
          label: "Transcript Doc",
          href: "https://example.com/transcript-doc",
        },
        {
          label: "Editorial Notes",
          href: "paperclip://documents/editorial-notes",
        },
      ],
    });

    await expect(
      harness.getData<{
        annotation: {
          workflowId: string;
          workflowName: string;
          stageKey: string;
          stageDisplayName: string;
          issueId: string;
          commentId: string;
          summary: string;
          details: string;
          artifacts: Array<{
            label: string;
            href: string;
          }>;
          createdAt: string;
        } | null;
      }>(DATA_KEYS.commentStageOutput, {
        companyId: COMPANY_ID,
        issueId: syncResult.issue.id,
        commentId: outputResult.comment.id,
      }),
    ).resolves.toEqual({
      annotation: expect.objectContaining({
        workflowId: created.workflow.id,
        workflowName: "Episode 26 Production",
        stageKey: "transcript",
        stageDisplayName: "Transcript",
        issueId: syncResult.issue.id,
        commentId: outputResult.comment.id,
        summary: "Transcript imported and speaker labels normalized.",
        details: "Removed sponsor break duplication.\nReady for editorial review.",
        createdAt: expect.any(String),
        artifacts: [
          {
            label: "Transcript Doc",
            href: "https://example.com/transcript-doc",
          },
          {
            label: "Editorial Notes",
            href: "paperclip://documents/editorial-notes",
          },
        ],
      }),
    });
  });

  it("lists recorded workflow runs newest-first and supports stage filtering", async () => {
    const harness = createTestHarness({ manifest, capabilities: manifest.capabilities });
    await plugin.definition.setup(harness.ctx);
    harness.seed({
      projects: [createProjectFixture()],
    });

    const created = await harness.performAction<{ workflow: { id: string } }>(ACTION_KEYS.upsertWorkflow, {
      companyId: COMPANY_ID,
      name: "Episode 26 Production",
      templateKey: "episode-pipeline",
      description: "Coordinate the episode transcript and release process.",
      projectId: PROJECT_ID,
    });

    await harness.performAction(ACTION_KEYS.syncWorkflowStageIssue, {
      companyId: COMPANY_ID,
      workflowId: created.workflow.id,
      stageKey: "transcript",
    });
    await harness.performAction(ACTION_KEYS.syncWorkflowStageIssue, {
      companyId: COMPANY_ID,
      workflowId: created.workflow.id,
      stageKey: "review",
    });

    await harness.performAction(ACTION_KEYS.recordWorkflowStageOutput, {
      companyId: COMPANY_ID,
      workflowId: created.workflow.id,
      stageKey: "transcript",
      summary: "Transcript imported and speaker labels normalized.",
      details: "Removed sponsor break duplication.\nReady for editorial review.",
      artifacts: [
        {
          label: "Transcript Doc",
          href: "https://example.com/transcript-doc",
        },
      ],
    });

    await harness.performAction(ACTION_KEYS.recordWorkflowStageOutput, {
      companyId: COMPANY_ID,
      workflowId: created.workflow.id,
      stageKey: "review",
      summary: "Editorial review packet approved.",
      details: "Host notes and timestamps signed off.",
      artifacts: [
        {
          label: "Review Packet",
          href: "https://example.com/review-packet",
        },
      ],
    });

    await harness.performAction(ACTION_KEYS.recordWorkflowStageOutput, {
      companyId: COMPANY_ID,
      workflowId: created.workflow.id,
      stageKey: "transcript",
      summary: "Transcript updated after final typo pass.",
      details: "Final punctuation cleanup complete.",
      artifacts: [
        {
          label: "Final Transcript",
          href: "https://example.com/final-transcript",
        },
      ],
    });

    await expect(
      harness.getData<{
        total: number;
        runs: Array<{
          workflowId: string;
          workflowName: string;
          stageKey: string;
          stageDisplayName: string;
          summary: string;
          artifacts: Array<{
            label: string;
            href: string;
          }>;
        }>;
      }>(DATA_KEYS.workflowRuns, {
        companyId: COMPANY_ID,
        workflowId: created.workflow.id,
      }),
    ).resolves.toEqual({
      total: 3,
      runs: [
        expect.objectContaining({
          workflowId: created.workflow.id,
          workflowName: "Episode 26 Production",
          stageKey: "transcript",
          stageDisplayName: "Transcript",
          summary: "Transcript updated after final typo pass.",
          artifacts: [
            {
              label: "Final Transcript",
              href: "https://example.com/final-transcript",
            },
          ],
        }),
        expect.objectContaining({
          workflowId: created.workflow.id,
          workflowName: "Episode 26 Production",
          stageKey: "review",
          stageDisplayName: "Review",
          summary: "Editorial review packet approved.",
          artifacts: [
            {
              label: "Review Packet",
              href: "https://example.com/review-packet",
            },
          ],
        }),
        expect.objectContaining({
          workflowId: created.workflow.id,
          workflowName: "Episode 26 Production",
          stageKey: "transcript",
          stageDisplayName: "Transcript",
          summary: "Transcript imported and speaker labels normalized.",
          artifacts: [
            {
              label: "Transcript Doc",
              href: "https://example.com/transcript-doc",
            },
          ],
        }),
      ],
    });

    await expect(
      harness.getData<{
        total: number;
        runs: Array<{
          stageKey: string;
          summary: string;
        }>;
      }>(DATA_KEYS.workflowRuns, {
        companyId: COMPANY_ID,
        workflowId: created.workflow.id,
        stageKey: "transcript",
      }),
    ).resolves.toEqual({
      total: 2,
      runs: [
        expect.objectContaining({
          stageKey: "transcript",
          summary: "Transcript updated after final typo pass.",
        }),
        expect.objectContaining({
          stageKey: "transcript",
          summary: "Transcript imported and speaker labels normalized.",
        }),
      ],
    });
  });

  it("rejects stage output recording until the stage issue has been synced", async () => {
    const harness = createTestHarness({ manifest, capabilities: manifest.capabilities });
    await plugin.definition.setup(harness.ctx);
    harness.seed({
      projects: [createProjectFixture()],
    });

    const created = await harness.performAction<{ workflow: { id: string } }>(ACTION_KEYS.upsertWorkflow, {
      companyId: COMPANY_ID,
      name: "Episode 26 Production",
      templateKey: "episode-pipeline",
      description: "Coordinate the episode transcript and release process.",
      projectId: PROJECT_ID,
    });

    await expect(
      harness.performAction(ACTION_KEYS.recordWorkflowStageOutput, {
        companyId: COMPANY_ID,
        workflowId: created.workflow.id,
        stageKey: "transcript",
        summary: "Transcript imported and speaker labels normalized.",
      }),
    ).rejects.toThrow("Sync the stage issue before recording workflow output");
  });

  it("resolves linked issue workflow context for the issue detail tab", async () => {
    const harness = createTestHarness({ manifest, capabilities: manifest.capabilities });
    await plugin.definition.setup(harness.ctx);
    harness.seed({
      projects: [createProjectFixture()],
    });

    const created = await harness.performAction<{
      workflow: {
        id: string;
        name: string;
      };
    }>(ACTION_KEYS.upsertWorkflow, {
      companyId: COMPANY_ID,
      name: "Episode 26 Production",
      templateKey: "episode-pipeline",
      description: "Coordinate the episode transcript and release process.",
      projectId: PROJECT_ID,
    });

    const transcriptSync = await harness.performAction<{
      issue: {
        id: string;
        title: string;
      };
    }>(ACTION_KEYS.syncWorkflowStageIssue, {
      companyId: COMPANY_ID,
      workflowId: created.workflow.id,
      stageKey: "transcript",
    });

    await harness.performAction(ACTION_KEYS.recordWorkflowStageOutput, {
      companyId: COMPANY_ID,
      workflowId: created.workflow.id,
      stageKey: "transcript",
      summary: "Transcript generated",
      details: "Editorial notes are attached.",
      artifacts: [{ label: "Transcript", href: "https://example.com/transcript" }],
    });

    await expect(
      harness.getData<{
        linkedStage: {
          workflowId: string;
          workflowName: string;
          workflowStatus: string;
          workflowProjectId: string | null;
          stageKey: string;
          stageDisplayName: string;
          issueId: string;
          issueTitle: string;
          issueStatus: string;
          syncedAt: string;
          latestRun: {
            runId: string;
            commentId: string;
            issueId: string;
            summary: string;
            artifacts: Array<{ label: string; href: string }>;
            createdAt: string;
          } | null;
        } | null;
      }>("issue-stage-context", {
        companyId: COMPANY_ID,
        issueId: transcriptSync.issue.id,
      }),
    ).resolves.toEqual({
      linkedStage: expect.objectContaining({
        workflowId: created.workflow.id,
        workflowName: "Episode 26 Production",
        workflowStatus: "draft",
        workflowProjectId: PROJECT_ID,
        stageKey: "transcript",
        stageDisplayName: "Transcript",
        issueId: transcriptSync.issue.id,
        issueTitle: transcriptSync.issue.title,
        issueStatus: "todo",
        latestRun: expect.objectContaining({
          issueId: transcriptSync.issue.id,
          summary: "Transcript generated",
          artifacts: [{ label: "Transcript", href: "https://example.com/transcript" }],
        }),
      }),
    });

    await expect(
      harness.getData("issue-stage-context", {
        companyId: COMPANY_ID,
        issueId: "not-a-linked-issue",
      }),
    ).resolves.toEqual({
      linkedStage: null,
    });
  });
});
