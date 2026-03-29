import { describe, expect, it } from "vitest";
import { getRoutineTemplate, listRoutineTemplates } from "./routine-templates";

describe("routine templates", () => {
  it("exposes the QA status review template with stable defaults", () => {
    expect(listRoutineTemplates()).toEqual([
      {
        id: "qa_status_review",
        label: "QA status review",
        title: "Review operational status and create concrete follow-up actions",
        description: [
          "Review the current operational status for this project and turn persistent problems into concrete issue updates.",
          "",
          "Check for:",
          "- failed runs that need triage",
          "- stale `in_progress` work with no recent movement",
          "- items in `in_review` that still lack evidence or a clear next owner",
          "- budget or delivery risks that need explicit escalation",
          "",
          "Leave a concise evidence-based update. Do not act like a polling watcher that rereads the board without producing a concrete conclusion.",
        ].join("\n"),
        priority: "medium",
        concurrencyPolicy: "coalesce_if_active",
        catchUpPolicy: "skip_missed",
        helperText: "Assign this to QA and use scheduled or webhook triggers to materialize review work only when needed.",
      },
    ]);
  });

  it("returns a single reusable QA template by id", () => {
    const template = getRoutineTemplate("qa_status_review");

    expect(template?.label).toBe("QA status review");
    expect(template?.description).toContain("Do not act like a polling watcher");
    expect(template?.concurrencyPolicy).toBe("coalesce_if_active");
    expect(template?.catchUpPolicy).toBe("skip_missed");
  });
});
