import { describe, expect, it } from "vitest";
import { workflowStageStatusText, workflowStageStatusTextDefault } from "./status-colors";

describe("workflowStageStatusText", () => {
  it("highlights ready stages in green and missing stages in red", () => {
    expect(workflowStageStatusText.ready).toContain("text-green-600");
    expect(workflowStageStatusText.missing).toContain("text-red-600");
  });

  it("falls back to muted text for unknown stage states", () => {
    expect(workflowStageStatusTextDefault).toBe("text-muted-foreground");
  });
});
