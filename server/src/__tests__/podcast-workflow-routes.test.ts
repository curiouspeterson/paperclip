import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { podcastWorkflowRoutes } from "../routes/podcast-workflows.js";

const mockPodcastWorkflowService = vi.hoisted(() => ({
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

const mockWorkspaceOperationService = vi.hoisted(() => ({
  listForWorkflow: vi.fn(),
  createRecorder: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  logActivity: mockLogActivity,
  podcastWorkflowService: () => mockPodcastWorkflowService,
  workspaceOperationService: () => mockWorkspaceOperationService,
}));

vi.mock("../services/podcast-workflow-runs.js", () => ({
  runPodcastWorkflowAction: vi.fn(),
}));

vi.mock("../services/podcast-workflow-sync.js", () => ({
  syncPodcastWorkflowToPaperclip: vi.fn(),
}));

function createApp(actor: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", podcastWorkflowRoutes({} as any, {} as any));
  app.use(errorHandler);
  return app;
}

describe("POST /api/companies/:companyId/podcast-workflows", () => {
  beforeEach(() => {
    mockPodcastWorkflowService.list.mockReset();
    mockPodcastWorkflowService.getById.mockReset();
    mockPodcastWorkflowService.create.mockReset();
    mockPodcastWorkflowService.update.mockReset();
    mockWorkspaceOperationService.listForWorkflow.mockReset();
    mockWorkspaceOperationService.createRecorder.mockReset();
    mockLogActivity.mockReset();
  });

  it("seeds server-owned workflow defaults when the client only provides the type", async () => {
    mockPodcastWorkflowService.create.mockImplementation(async (companyId: string, data: any) => ({
      id: "workflow-1",
      companyId,
      ...data,
      createdAt: new Date("2026-03-25T22:00:00.000Z"),
      updatedAt: new Date("2026-03-25T22:00:00.000Z"),
    }));

    const app = createApp({
      type: "board",
      userId: "user-1",
      source: "local_implicit",
    });

    const res = await request(app)
      .post("/api/companies/company-1/podcast-workflows")
      .send({ type: "episode" });

    expect(res.status).toBe(201);
    expect(mockPodcastWorkflowService.create).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        type: "episode",
        title: "Episode Workflow",
        status: "planned",
        manifest: expect.objectContaining({
          manifestPath: null,
          runtimeRoot: ".runtime/podcast-workflows",
        }),
        scriptRefs: expect.objectContaining({
          runLatestYouTubePipelinePath: "bin/podcast-workflows/run_latest_youtube_pipeline.py",
          generateApprovalPacketPath: "bin/podcast-workflows/generate_approval_packet.py",
          syncBatchToPaperclipPath: "bin/podcast-workflows/sync_batch_to_paperclip.mjs",
        }),
      }),
    );
  });
});
