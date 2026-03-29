export type RoutineTemplateId = "qa_status_review";

export interface RoutineTemplate {
  id: RoutineTemplateId;
  label: string;
  title: string;
  description: string;
  priority: "critical" | "high" | "medium" | "low";
  concurrencyPolicy: "coalesce_if_active" | "always_enqueue" | "skip_if_active";
  catchUpPolicy: "skip_missed" | "enqueue_missed_with_cap";
  helperText: string;
}

const ROUTINE_TEMPLATES: RoutineTemplate[] = [
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
];

export function listRoutineTemplates(): RoutineTemplate[] {
  return ROUTINE_TEMPLATES;
}

export function getRoutineTemplate(id: RoutineTemplateId): RoutineTemplate | null {
  return ROUTINE_TEMPLATES.find((template) => template.id === id) ?? null;
}
