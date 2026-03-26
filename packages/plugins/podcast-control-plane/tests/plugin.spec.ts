import { describe, expect, it } from "vitest";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";

describe("podcast control plane plugin scaffold", () => {
  it("declares the phase-1 control plane surfaces", () => {
    expect(manifest.id).toBe("paperclip.podcast-control-plane");
    expect(manifest.displayName).toBe("Podcast Control Plane");
    expect(manifest.categories).toEqual(["ui", "automation"]);

    expect(manifest.ui?.slots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "page",
          id: "podcast-control-plane-page",
          routePath: "podcast",
          exportName: "PodcastControlPlanePage",
        }),
        expect.objectContaining({
          type: "settingsPage",
          id: "podcast-control-plane-settings-page",
          exportName: "PodcastControlPlaneSettingsPage",
        }),
        expect.objectContaining({
          type: "dashboardWidget",
          id: "podcast-control-plane-dashboard-widget",
          exportName: "PodcastControlPlaneDashboardWidget",
        }),
        expect.objectContaining({
          type: "detailTab",
          id: "podcast-control-plane-project-tab",
          exportName: "PodcastProjectDetailTab",
          entityTypes: ["project"],
        }),
      ]),
    );
  });

  it("exposes a healthy worker definition", async () => {
    await expect(plugin.definition.onHealth?.()).resolves.toEqual({
      status: "ok",
      message: "Podcast control plane plugin ready",
    });
  });
});
