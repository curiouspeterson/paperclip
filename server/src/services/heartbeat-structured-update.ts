import { redactSecretSnippet } from "../redaction.js";
import type { LogActivityInput } from "./activity-log.js";

const STRUCTURED_UPDATE_STATUSES = new Set(["in_progress", "blocked", "done"]);
const PLAN_DOCUMENT_KEY = "plan";
const PLAN_DOCUMENT_TITLE = "Implementation plan";
const PLAN_DOCUMENT_FORMAT = "markdown";

type StructuredHeartbeatIssueUpdateStatus = "in_progress" | "blocked" | "done";

type StructuredHeartbeatIssueUpdate = {
  status: StructuredHeartbeatIssueUpdateStatus;
  commentMarkdown: string;
  planMarkdown: string;
  changeSummary: string;
  raw: Record<string, unknown>;
};

type StructuredUpdateIssue = {
  id: string;
  companyId: string;
  identifier: string | null;
  title: string;
  status: string;
};

type StructuredUpdateComment = {
  id: string;
  body: string;
};

type StructuredUpdateDocument = {
  id: string;
  key: string;
  title: string | null;
  format: string;
  latestRevisionId: string | null;
  latestRevisionNumber: number;
};

export type HeartbeatStructuredUpdateServices = {
  getIssueById: (issueId: string) => Promise<StructuredUpdateIssue | null>;
  updateIssue: (issueId: string, patch: { status: "blocked" | "done" }) => Promise<StructuredUpdateIssue | null>;
  addComment: (
    issueId: string,
    body: string,
    actor: { agentId: string },
  ) => Promise<StructuredUpdateComment>;
  getIssueDocumentByKey: (issueId: string, key: string) => Promise<StructuredUpdateDocument | null>;
  upsertIssueDocument: (input: {
    issueId: string;
    key: string;
    title: string;
    format: string;
    body: string;
    changeSummary?: string | null;
    baseRevisionId?: string | null;
    createdByAgentId: string;
  }) => Promise<{ created: boolean; document: StructuredUpdateDocument }>;
  logActivity: (input: LogActivityInput) => Promise<void>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function extractBalancedJsonObject(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (!char) continue;
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char !== "}") continue;
    depth -= 1;
    if (depth === 0) {
      return text.slice(start, index + 1);
    }
    if (depth < 0) {
      return null;
    }
  }
  return null;
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  let text = raw.trim();
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    text = fenced[1].trim();
  }

  try {
    const parsed = JSON.parse(text);
    return asRecord(parsed);
  } catch {
    // Fall through to substring extraction.
  }

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "{") continue;
    const candidate = extractBalancedJsonObject(text, index);
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      const record = asRecord(parsed);
      if (record) return record;
    } catch {
      // Keep scanning.
    }
  }
  return null;
}

function normalizeStructuredUpdateCandidate(candidate: Record<string, unknown>) {
  const normalized = { ...candidate };
  const hasStructuredShape =
    "status" in normalized
    && "comment_markdown" in normalized
    && "plan_markdown" in normalized
    && "change_summary" in normalized;
  if (hasStructuredShape) return normalized;

  const hasIssueShape =
    "status" in normalized
    && !("comment_markdown" in normalized)
    && (readNonEmptyString(normalized.title) || readNonEmptyString(normalized.description));
  if (!hasIssueShape) return normalized;

  const commentMarkdown = [readNonEmptyString(normalized.title), readNonEmptyString(normalized.description)]
    .filter((value): value is string => Boolean(value))
    .join("\n\n");
  normalized.comment_markdown = commentMarkdown;
  normalized.plan_markdown = readNonEmptyString(normalized.plan_markdown) ?? "";
  normalized.change_summary = readNonEmptyString(normalized.change_summary) ?? "";
  return normalized;
}

export function parseStructuredHeartbeatIssueUpdate(resultJson: unknown): StructuredHeartbeatIssueUpdate | null {
  const result = asRecord(resultJson);
  if (!result) return null;
  const summarySource = readNonEmptyString(result.summary) ?? readNonEmptyString(result.message);
  if (!summarySource) return null;

  const parsed = extractJsonObject(summarySource);
  if (!parsed) return null;
  const normalized = normalizeStructuredUpdateCandidate(parsed);
  const status = readNonEmptyString(normalized.status)?.toLowerCase() ?? null;
  if (!status || !STRUCTURED_UPDATE_STATUSES.has(status)) return null;

  const commentMarkdown = readNonEmptyString(normalized.comment_markdown);
  if (!commentMarkdown) return null;

  return {
    status: status as StructuredHeartbeatIssueUpdateStatus,
    commentMarkdown,
    planMarkdown: readNonEmptyString(normalized.plan_markdown) ?? "",
    changeSummary: readNonEmptyString(normalized.change_summary) ?? "",
    raw: normalized,
  };
}

export async function applyStructuredHeartbeatIssueUpdate(
  services: HeartbeatStructuredUpdateServices,
  input: {
    issueId: string;
    companyId: string;
    runId: string;
    agentId: string;
    resultJson: unknown;
  },
): Promise<boolean> {
  const structuredUpdate = parseStructuredHeartbeatIssueUpdate(input.resultJson);
  if (!structuredUpdate) return false;

  let issue = await services.getIssueById(input.issueId);
  if (!issue) return false;

  let statusChanged = false;
  if (structuredUpdate.status !== "in_progress" && issue.status !== structuredUpdate.status) {
    const updated = await services.updateIssue(issue.id, { status: structuredUpdate.status });
    if (!updated) return false;
    issue = updated;
    statusChanged = true;
    await services.logActivity({
      companyId: input.companyId,
      actorType: "agent",
      actorId: input.agentId,
      agentId: input.agentId,
      runId: input.runId,
      action: "issue.updated",
      entityType: "issue",
      entityId: issue.id,
      details: {
        status: issue.status,
        identifier: issue.identifier,
        source: "heartbeat_structured_update",
        structured: true,
      },
    });
  }

  const comment = await services.addComment(issue.id, structuredUpdate.commentMarkdown, {
    agentId: input.agentId,
  });
  await services.logActivity({
    companyId: input.companyId,
    actorType: "agent",
    actorId: input.agentId,
    agentId: input.agentId,
    runId: input.runId,
    action: "issue.comment_added",
    entityType: "issue",
    entityId: issue.id,
    details: {
      commentId: comment.id,
      bodySnippet: redactSecretSnippet(comment.body),
      identifier: issue.identifier,
      issueTitle: issue.title,
      source: "heartbeat_structured_update",
      structured: true,
      ...(statusChanged ? { updated: true } : {}),
    },
  });

  if (structuredUpdate.planMarkdown) {
    const existingPlanDocument = await services.getIssueDocumentByKey(issue.id, PLAN_DOCUMENT_KEY);
    const result = await services.upsertIssueDocument({
      issueId: issue.id,
      key: PLAN_DOCUMENT_KEY,
      title: PLAN_DOCUMENT_TITLE,
      format: PLAN_DOCUMENT_FORMAT,
      body: structuredUpdate.planMarkdown,
      changeSummary: structuredUpdate.changeSummary || null,
      baseRevisionId: existingPlanDocument?.latestRevisionId ?? null,
      createdByAgentId: input.agentId,
    });
    await services.logActivity({
      companyId: input.companyId,
      actorType: "agent",
      actorId: input.agentId,
      agentId: input.agentId,
      runId: input.runId,
      action: result.created ? "issue.document_created" : "issue.document_updated",
      entityType: "issue",
      entityId: issue.id,
      details: {
        key: result.document.key,
        documentId: result.document.id,
        title: result.document.title,
        format: result.document.format,
        revisionNumber: result.document.latestRevisionNumber,
        source: "heartbeat_structured_update",
        structured: true,
      },
    });
  }

  return true;
}
