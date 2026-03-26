import { describe, expect, it } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";

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
    }>("upsert-workflow", {
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
    }>("workflow-list", { companyId: "company-1" });

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
    }>("upsert-workflow", {
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
    }>("workflow-detail", { companyId: "company-1", workflowId: created.workflow.id });

    expect(detail.workflow).toEqual(
      expect.objectContaining({
        id: created.workflow.id,
        projectId: "project-1",
        description: "Track episodes and newsletter promotion.",
      }),
    );

    const projectList = await harness.getData<{
      workflows: Array<{ id: string }>;
    }>("workflow-list", { companyId: "company-1", projectId: "project-1" });

    expect(projectList.workflows).toEqual([expect.objectContaining({ id: created.workflow.id })]);

    await expect(
      harness.performAction("delete-workflow", {
        companyId: "company-1",
        workflowId: created.workflow.id,
      }),
    ).resolves.toEqual({
      ok: true,
      workflowId: created.workflow.id,
    });

    await expect(
      harness.getData("workflow-list", { companyId: "company-1" }),
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
    }>("workflow-templates")).resolves.toEqual({
      templates: [
        expect.objectContaining({ key: "episode-pipeline", displayName: "Episode Pipeline" }),
        expect.objectContaining({ key: "clips-social", displayName: "Clips + Social" }),
        expect.objectContaining({ key: "newsletter-promo", displayName: "Newsletter Promotion" }),
      ],
    });
  });
});
