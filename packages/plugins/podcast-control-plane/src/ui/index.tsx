import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  usePluginAction,
  usePluginData,
  usePluginToast,
  type PluginCommentAnnotationProps,
  type PluginDetailTabProps,
  type PluginPageProps,
  type PluginSettingsPageProps,
  type PluginWidgetProps,
} from "@paperclipai/plugin-sdk/ui";
import { ACTION_KEYS, DATA_KEYS } from "../constants.js";
import { type PodcastWorkflowStageView } from "../stages.js";
import { type PodcastWorkflowArtifactReference } from "../runs.js";
import {
  WORKFLOW_STATUSES,
  WORKFLOW_TEMPLATES,
  type PodcastWorkflowStatus,
  type PodcastWorkflowSummary,
} from "../workflows.js";

const panelStyle = {
  display: "grid",
  gap: "0.75rem",
  padding: "1rem",
  border: "1px solid rgba(15, 23, 42, 0.12)",
  borderRadius: "0.75rem",
  background: "rgba(255, 255, 255, 0.88)",
} as const;

const metaGridStyle = {
  display: "grid",
  gap: "0.5rem",
} as const;

const formGridStyle = {
  display: "grid",
  gap: "0.75rem",
} as const;

const cardListStyle = {
  display: "grid",
  gap: "0.75rem",
} as const;

const rowStyle = {
  display: "flex",
  gap: "0.5rem",
  alignItems: "center",
  flexWrap: "wrap",
} as const;

const fieldStyle = {
  display: "grid",
  gap: "0.35rem",
} as const;

const inputStyle = {
  width: "100%",
  borderRadius: "0.65rem",
  border: "1px solid rgba(15, 23, 42, 0.16)",
  padding: "0.65rem 0.8rem",
  font: "inherit",
  background: "rgba(255, 255, 255, 0.96)",
} as const;

const textareaStyle = {
  ...inputStyle,
  minHeight: "5.5rem",
  resize: "vertical" as const,
} as const;

const buttonStyle = {
  borderRadius: "0.65rem",
  border: "1px solid rgba(15, 23, 42, 0.16)",
  padding: "0.65rem 0.9rem",
  font: "inherit",
  background: "rgba(15, 23, 42, 0.06)",
  cursor: "pointer",
} as const;

const primaryButtonStyle = {
  ...buttonStyle,
  background: "rgba(15, 118, 110, 0.12)",
  border: "1px solid rgba(13, 148, 136, 0.35)",
} as const;

const dangerButtonStyle = {
  ...buttonStyle,
  background: "rgba(239, 68, 68, 0.08)",
  border: "1px solid rgba(239, 68, 68, 0.24)",
} as const;

const annotationCardStyle = {
  display: "grid",
  gap: "0.75rem",
  padding: "0.85rem 0.95rem",
  borderRadius: "0.8rem",
  border: "1px solid rgba(15, 23, 42, 0.12)",
  background: "rgba(15, 23, 42, 0.04)",
} as const;

const artifactGridStyle = {
  display: "grid",
  gap: "0.6rem",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
} as const;

const artifactLinkStyle = {
  display: "grid",
  gap: "0.3rem",
  padding: "0.75rem 0.8rem",
  borderRadius: "0.75rem",
  border: "1px solid rgba(15, 118, 110, 0.2)",
  background: "rgba(15, 118, 110, 0.08)",
  color: "inherit",
  textDecoration: "none",
} as const;

const linkRowStyle = {
  display: "flex",
  gap: "0.5rem",
  alignItems: "center",
  flexWrap: "wrap",
} as const;

const actionLinkStyle = {
  ...buttonStyle,
  color: "inherit",
  textDecoration: "none",
} as const;

type WorkflowTemplatesData = {
  templates: Array<{
    key: string;
    displayName: string;
    description: string;
  }>;
};

type WorkflowListData = {
  workflows: PodcastWorkflowSummary[];
  total: number;
};

type WorkflowDetailResult = {
  workflow: PodcastWorkflowSummary | null;
};

type WorkflowActionResult = {
  workflow: PodcastWorkflowSummary;
};

type WorkflowStagesData = {
  stages: PodcastWorkflowStageView[];
};

type WorkflowStageSyncActionResult = {
  issue: {
    id: string;
    title: string;
    status: string;
  };
  stage: {
    key: string;
    displayName: string;
  };
};

type WorkflowStageOutputActionResult = {
  run: {
    id: string;
    summary: string;
    artifacts: PodcastWorkflowArtifactReference[];
  };
  comment: {
    id: string;
  };
  stage: {
    key: string;
    displayName: string;
  };
};

type WorkflowRunsData = {
  total: number;
  runs: Array<{
    workflowId: string;
    workflowName: string;
    stageKey: string;
    stageDisplayName: string;
    issueId: string;
    commentId: string;
    summary: string;
    details: string;
    artifacts: PodcastWorkflowArtifactReference[];
    createdAt: string;
  }>;
};

type CommentStageOutputData = {
  annotation: {
    workflowId: string;
    workflowName: string;
    stageKey: string;
    stageDisplayName: string;
    issueId: string;
    commentId: string;
    summary: string;
    details: string;
    artifacts: PodcastWorkflowArtifactReference[];
    createdAt: string;
  } | null;
};

type StageOutputDraft = {
  summary: string;
  details: string;
  artifacts: PodcastWorkflowArtifactReference[];
};

type WorkflowFormState = {
  workflowId: string | null;
  name: string;
  templateKey: string;
  status: PodcastWorkflowStatus;
  description: string;
  projectId: string;
};

function emptyWorkflowForm(projectId?: string | null): WorkflowFormState {
  return {
    workflowId: null,
    name: "",
    templateKey: WORKFLOW_TEMPLATES[0].key,
    status: "draft",
    description: "",
    projectId: projectId ?? "",
  };
}

function workflowToForm(workflow: PodcastWorkflowSummary): WorkflowFormState {
  return {
    workflowId: workflow.id,
    name: workflow.name,
    templateKey: workflow.templateKey,
    status: workflow.status,
    description: workflow.description,
    projectId: workflow.projectId ?? "",
  };
}

function buildHostPath(companyPrefix: string | null | undefined, suffix: string): string {
  return companyPrefix ? `/${companyPrefix}${suffix}` : suffix;
}

export function buildIssueDetailHref(companyPrefix: string | null | undefined, issueRef: string): string {
  return buildHostPath(companyPrefix, `/issues/${encodeURIComponent(issueRef)}`);
}

export function buildIssueCommentHref(
  companyPrefix: string | null | undefined,
  issueRef: string,
  commentId: string,
): string {
  return `${buildIssueDetailHref(companyPrefix, issueRef)}#comment-${encodeURIComponent(commentId)}`;
}

function toneColor(status: PodcastWorkflowStatus) {
  if (status === "active") return "rgba(13, 148, 136, 0.75)";
  if (status === "archived") return "rgba(100, 116, 139, 0.75)";
  return "rgba(245, 158, 11, 0.82)";
}

function stageToneColor(status: PodcastWorkflowStageView["sync"]["status"]) {
  if (status === "linked") return "rgba(13, 148, 136, 0.75)";
  if (status === "stale") return "rgba(185, 28, 28, 0.74)";
  return "rgba(71, 85, 105, 0.72)";
}

function ScaffoldPanel(props: {
  title: string;
  summary: string;
  meta: Array<{ label: string; value: string }>;
}) {
  return (
    <section style={panelStyle}>
      <div>
        <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>{props.title}</h2>
        <p style={{ margin: "0.5rem 0 0", color: "rgba(15, 23, 42, 0.72)" }}>{props.summary}</p>
      </div>
      <div style={metaGridStyle}>
        {props.meta.map((entry) => (
          <div key={entry.label}>
            <strong>{entry.label}:</strong> {entry.value}
          </div>
        ))}
      </div>
    </section>
  );
}

function WorkflowForm(props: {
  companyId: string;
  projectId?: string | null;
  form: WorkflowFormState;
  templates: WorkflowTemplatesData["templates"];
  saving: boolean;
  onChange(next: WorkflowFormState): void;
  onSubmit(event: FormEvent): void;
  onCancel(): void;
}) {
  return (
    <form onSubmit={props.onSubmit} style={formGridStyle}>
      <div style={fieldStyle}>
        <label htmlFor="podcast-workflow-name">Workflow name</label>
        <input
          id="podcast-workflow-name"
          style={inputStyle}
          value={props.form.name}
          onChange={(event) => props.onChange({ ...props.form, name: event.target.value })}
          placeholder="Episode Pipeline"
        />
      </div>

      <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <div style={fieldStyle}>
          <label htmlFor="podcast-workflow-template">Template</label>
          <select
            id="podcast-workflow-template"
            style={inputStyle}
            value={props.form.templateKey}
            onChange={(event) => props.onChange({ ...props.form, templateKey: event.target.value })}
          >
            {props.templates.map((template) => (
              <option key={template.key} value={template.key}>
                {template.displayName}
              </option>
            ))}
          </select>
        </div>

        <div style={fieldStyle}>
          <label htmlFor="podcast-workflow-status">Status</label>
          <select
            id="podcast-workflow-status"
            style={inputStyle}
            value={props.form.status}
            onChange={(event) => props.onChange({ ...props.form, status: event.target.value as PodcastWorkflowStatus })}
          >
            {WORKFLOW_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={fieldStyle}>
        <label htmlFor="podcast-workflow-project">Project binding</label>
        <input
          id="podcast-workflow-project"
          style={inputStyle}
          value={props.form.projectId}
          onChange={(event) => props.onChange({ ...props.form, projectId: event.target.value })}
          placeholder={props.projectId ?? "Optional project id"}
        />
      </div>

      <div style={fieldStyle}>
        <label htmlFor="podcast-workflow-description">Description</label>
        <textarea
          id="podcast-workflow-description"
          style={textareaStyle}
          value={props.form.description}
          onChange={(event) => props.onChange({ ...props.form, description: event.target.value })}
          placeholder="Describe what this workflow coordinates."
        />
      </div>

      <div style={rowStyle}>
        <button type="submit" style={primaryButtonStyle} disabled={props.saving || !props.companyId}>
          {props.saving ? "Saving…" : props.form.workflowId ? "Update workflow" : "Create workflow"}
        </button>
        <button type="button" style={buttonStyle} disabled={props.saving} onClick={props.onCancel}>
          Reset
        </button>
      </div>
    </form>
  );
}

function WorkflowList(props: {
  workflows: PodcastWorkflowSummary[];
  onEdit(workflow: PodcastWorkflowSummary): void;
  onDelete(workflowId: string): void;
  deletingId: string | null;
  emptyMessage: string;
}) {
  if (props.workflows.length === 0) {
    return <div style={{ fontSize: "0.95rem", color: "rgba(15, 23, 42, 0.64)" }}>{props.emptyMessage}</div>;
  }

  return (
    <div style={cardListStyle}>
      {props.workflows.map((workflow) => (
        <section key={workflow.id} style={panelStyle}>
          <div style={{ ...rowStyle, justifyContent: "space-between" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>{workflow.name}</h3>
              <div style={{ fontSize: "0.82rem", color: "rgba(15, 23, 42, 0.62)" }}>{workflow.slug}</div>
            </div>
            <div
              style={{
                borderRadius: "999px",
                padding: "0.2rem 0.65rem",
                fontSize: "0.8rem",
                background: toneColor(workflow.status),
                color: "#fff",
                textTransform: "capitalize",
              }}
            >
              {workflow.status}
            </div>
          </div>
          <div style={metaGridStyle}>
            <div><strong>Template:</strong> {workflow.templateKey}</div>
            <div><strong>Project:</strong> {workflow.projectId ?? "Unbound"}</div>
            <div><strong>Updated:</strong> {new Date(workflow.updatedAt).toLocaleString()}</div>
          </div>
          <div style={{ color: "rgba(15, 23, 42, 0.74)" }}>
            {workflow.description || "No description yet."}
          </div>
          <div style={rowStyle}>
            <button type="button" style={buttonStyle} onClick={() => props.onEdit(workflow)}>
              Edit
            </button>
            <button
              type="button"
              style={dangerButtonStyle}
              disabled={props.deletingId === workflow.id}
              onClick={() => props.onDelete(workflow.id)}
            >
              {props.deletingId === workflow.id ? "Deleting…" : "Delete"}
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}

function WorkflowStageList(props: {
  stages: PodcastWorkflowStageView[];
  syncingStageKey: string | null;
  postingStageKey: string | null;
  drafts: Record<string, StageOutputDraft>;
  onDraftChange(stageKey: string, patch: Partial<StageOutputDraft>): void;
  onSync(stageKey: string): void;
  onPostOutput(stageKey: string): void;
}) {
  if (props.stages.length === 0) {
    return <div style={{ fontSize: "0.95rem", color: "rgba(15, 23, 42, 0.64)" }}>No stages are defined for this workflow.</div>;
  }

  return (
    <div style={cardListStyle}>
      {props.stages.map((stage) => {
        const isSyncing = props.syncingStageKey === stage.key;
        const isPosting = props.postingStageKey === stage.key;
        const draft = props.drafts[stage.key] ?? { summary: "", details: "", artifacts: [{ label: "", href: "" }] };
        const buttonLabel = isSyncing
          ? "Syncing…"
          : stage.sync.status === "linked"
            ? "Update issue"
            : stage.sync.status === "stale"
              ? "Recreate issue"
              : "Create issue";

        return (
          <section key={stage.key} style={panelStyle}>
            <div style={{ ...rowStyle, justifyContent: "space-between" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "1rem" }}>{stage.displayName}</h3>
                <div style={{ fontSize: "0.82rem", color: "rgba(15, 23, 42, 0.62)" }}>{stage.key}</div>
              </div>
              <div
                style={{
                  borderRadius: "999px",
                  padding: "0.2rem 0.65rem",
                  fontSize: "0.8rem",
                  background: stageToneColor(stage.sync.status),
                  color: "#fff",
                  textTransform: "capitalize",
                }}
              >
                {stage.sync.status}
              </div>
            </div>

            <div style={{ color: "rgba(15, 23, 42, 0.74)" }}>{stage.description}</div>

            <div style={metaGridStyle}>
              <div><strong>Issue:</strong> {stage.sync.issueTitle ?? stage.sync.issueId ?? "Not created yet"}</div>
              <div><strong>Issue status:</strong> {stage.sync.issueStatus ?? "n/a"}</div>
              <div><strong>Workspace:</strong> {stage.sync.projectWorkspaceId ?? "Unavailable"}</div>
            </div>

            {stage.lastRun ? (
              <div style={{ ...metaGridStyle, padding: "0.75rem", borderRadius: "0.65rem", background: "rgba(15, 23, 42, 0.04)" }}>
                <div><strong>Latest output:</strong> {stage.lastRun.summary}</div>
                <div><strong>Comment:</strong> {stage.lastRun.commentId}</div>
                <div><strong>Recorded:</strong> {new Date(stage.lastRun.createdAt).toLocaleString()}</div>
                {stage.lastRun.artifacts.length > 0 ? (
                  <div>
                    <strong>Artifacts:</strong>{" "}
                    {stage.lastRun.artifacts.map((artifact) => artifact.label).join(", ")}
                  </div>
                ) : null}
              </div>
            ) : null}

            {stage.blockedReason ? (
              <div style={{ color: "#b45309" }}>{stage.blockedReason}</div>
            ) : null}

            {stage.sync.status === "stale" ? (
              <div style={{ color: "#b91c1c" }}>
                The previously linked issue could not be found. Sync again to create a fresh stage issue.
              </div>
            ) : null}

            <div style={rowStyle}>
              <button
                type="button"
                style={primaryButtonStyle}
                disabled={isSyncing || !stage.canSync}
                onClick={() => props.onSync(stage.key)}
              >
                {buttonLabel}
              </button>
            </div>

            <div style={{ ...formGridStyle, paddingTop: "0.25rem" }}>
              <div style={fieldStyle}>
                <label htmlFor={`podcast-stage-summary-${stage.key}`}>Output summary</label>
                <input
                  id={`podcast-stage-summary-${stage.key}`}
                  style={inputStyle}
                  value={draft.summary}
                  onChange={(event) => props.onDraftChange(stage.key, { summary: event.target.value })}
                  placeholder="Summarize what this stage produced."
                />
              </div>
              <div style={fieldStyle}>
                <label htmlFor={`podcast-stage-details-${stage.key}`}>Details</label>
                <textarea
                  id={`podcast-stage-details-${stage.key}`}
                  style={textareaStyle}
                  value={draft.details}
                  onChange={(event) => props.onDraftChange(stage.key, { details: event.target.value })}
                  placeholder="Add reviewer notes, artifact references, or follow-up context."
                />
              </div>
              <div style={fieldStyle}>
                <label>Artifacts</label>
                <div style={formGridStyle}>
                  {draft.artifacts.map((artifact, index) => (
                    <div key={`${stage.key}-artifact-${index}`} style={{ display: "grid", gap: "0.5rem", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr) auto" }}>
                      <input
                        style={inputStyle}
                        value={artifact.label}
                        onChange={(event) => {
                          const nextArtifacts = draft.artifacts.map((entry, entryIndex) => (
                            entryIndex === index ? { ...entry, label: event.target.value } : entry
                          ));
                          props.onDraftChange(stage.key, { artifacts: nextArtifacts });
                        }}
                        placeholder="Artifact label"
                      />
                      <input
                        style={inputStyle}
                        value={artifact.href}
                        onChange={(event) => {
                          const nextArtifacts = draft.artifacts.map((entry, entryIndex) => (
                            entryIndex === index ? { ...entry, href: event.target.value } : entry
                          ));
                          props.onDraftChange(stage.key, { artifacts: nextArtifacts });
                        }}
                        placeholder="Artifact URL or reference"
                      />
                      <button
                        type="button"
                        style={buttonStyle}
                        disabled={draft.artifacts.length === 1}
                        onClick={() => {
                          const nextArtifacts = draft.artifacts.filter((_, entryIndex) => entryIndex !== index);
                          props.onDraftChange(stage.key, { artifacts: nextArtifacts.length > 0 ? nextArtifacts : [{ label: "", href: "" }] });
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <div>
                    <button
                      type="button"
                      style={buttonStyle}
                      onClick={() => props.onDraftChange(stage.key, {
                        artifacts: [...draft.artifacts, { label: "", href: "" }],
                      })}
                    >
                      Add artifact
                    </button>
                  </div>
                </div>
              </div>
              <div style={rowStyle}>
                <button
                  type="button"
                  style={buttonStyle}
                  disabled={isPosting || stage.sync.status !== "linked" || draft.summary.trim().length === 0}
                  onClick={() => props.onPostOutput(stage.key)}
                >
                  {isPosting ? "Posting…" : "Post update"}
                </button>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function WorkflowRunFeed(props: {
  companyPrefix?: string | null;
  runs: WorkflowRunsData["runs"];
  total: number;
  stageFilter: string;
  stageOptions: Array<{ key: string; displayName: string }>;
  loading: boolean;
  error: { message: string } | null;
  onStageFilterChange(next: string): void;
}) {
  return (
    <section style={panelStyle}>
      <div style={{ ...rowStyle, justifyContent: "space-between" }}>
        <div style={{ display: "grid", gap: "0.35rem" }}>
          <strong>Recorded stage outputs</strong>
          <div style={{ color: "rgba(15, 23, 42, 0.68)" }}>
            Browse prior workflow handoffs without reopening the linked issue timeline.
          </div>
        </div>
        <div style={{ ...fieldStyle, minWidth: "200px" }}>
          <label htmlFor="podcast-workflow-run-stage-filter">Stage filter</label>
          <select
            id="podcast-workflow-run-stage-filter"
            style={inputStyle}
            value={props.stageFilter}
            onChange={(event) => props.onStageFilterChange(event.target.value)}
          >
            <option value="all">All stages</option>
            {props.stageOptions.map((stage) => (
              <option key={stage.key} value={stage.key}>
                {stage.displayName}
              </option>
            ))}
          </select>
        </div>
      </div>

      {props.loading ? <div style={{ color: "rgba(15, 23, 42, 0.68)" }}>Loading workflow runs…</div> : null}
      {props.error ? <div style={{ color: "#b91c1c" }}>Workflow run load failed: {props.error.message}</div> : null}
      {!props.loading && !props.error && props.runs.length === 0 ? (
        <div style={{ color: "rgba(15, 23, 42, 0.64)" }}>
          {props.stageFilter === "all"
            ? "No stage outputs have been recorded for this workflow yet."
            : "No recorded outputs match the selected stage yet."}
        </div>
      ) : null}

      {!props.loading && !props.error && props.runs.length > 0 ? (
        <div style={cardListStyle}>
          {props.runs.map((run) => {
            const issueHref = buildIssueDetailHref(props.companyPrefix, run.issueId);
            const commentHref = buildIssueCommentHref(props.companyPrefix, run.issueId, run.commentId);

            return (
              <div key={`${run.commentId}:${run.createdAt}`} style={annotationCardStyle}>
                <div style={{ ...rowStyle, justifyContent: "space-between" }}>
                  <div style={{ display: "grid", gap: "0.2rem" }}>
                    <strong>{run.stageDisplayName}</strong>
                    <div style={{ fontSize: "0.85rem", color: "rgba(15, 23, 42, 0.66)" }}>
                      {run.workflowName}
                    </div>
                  </div>
                  <div style={{ fontSize: "0.8rem", color: "rgba(15, 23, 42, 0.58)" }}>
                    {new Date(run.createdAt).toLocaleString()}
                  </div>
                </div>

                <div style={{ color: "rgba(15, 23, 42, 0.84)" }}>{run.summary}</div>

                <div style={metaGridStyle}>
                  <div><strong>Issue:</strong> {run.issueId}</div>
                  <div><strong>Comment:</strong> {run.commentId}</div>
                </div>

                <div style={linkRowStyle}>
                  <a href={issueHref} style={actionLinkStyle}>
                    Open issue
                  </a>
                  <a href={commentHref} style={actionLinkStyle}>
                    Jump to comment
                  </a>
                </div>

                {run.details.trim().length > 0 ? (
                  <div style={{ fontSize: "0.9rem", color: "rgba(15, 23, 42, 0.72)", whiteSpace: "pre-wrap" }}>
                    {run.details}
                  </div>
                ) : null}

                {run.artifacts.length > 0 ? (
                  <div style={artifactGridStyle}>
                    {run.artifacts.map((artifact) => (
                      <a
                        key={`${run.commentId}:${artifact.label}:${artifact.href}`}
                        href={artifact.href}
                        target="_blank"
                        rel="noreferrer"
                        style={artifactLinkStyle}
                      >
                        <strong>{artifact.label}</strong>
                        <span style={{ fontSize: "0.82rem", color: "rgba(15, 23, 42, 0.7)", wordBreak: "break-all" }}>
                          {artifact.href}
                        </span>
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {!props.loading && !props.error && props.total > props.runs.length ? (
        <div style={{ fontSize: "0.85rem", color: "rgba(15, 23, 42, 0.58)" }}>
          Showing {props.runs.length} of {props.total} recorded outputs.
        </div>
      ) : null}
    </section>
  );
}

function PodcastWorkflowManager(props: {
  companyId: string | null | undefined;
  companyPrefix?: string | null;
  projectId?: string | null;
  title: string;
  summary: string;
  emptyMessage: string;
}) {
  const companyId = props.companyId ?? "";
  const toast = usePluginToast();
  const upsertWorkflow = usePluginAction(ACTION_KEYS.upsertWorkflow);
  const deleteWorkflow = usePluginAction(ACTION_KEYS.deleteWorkflow);
  const syncWorkflowStageIssue = usePluginAction(ACTION_KEYS.syncWorkflowStageIssue);
  const recordWorkflowStageOutput = usePluginAction(ACTION_KEYS.recordWorkflowStageOutput);
  const listParams = useMemo(
    () => (props.projectId ? { companyId, projectId: props.projectId } : { companyId }),
    [companyId, props.projectId],
  );
  const workflowsQuery = usePluginData<WorkflowListData>(DATA_KEYS.workflowList, listParams);
  const templatesQuery = usePluginData<WorkflowTemplatesData>(DATA_KEYS.workflowTemplates, {});
  const [form, setForm] = useState<WorkflowFormState>(() => emptyWorkflowForm(props.projectId));
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const detailParams = useMemo(
    () => (companyId && selectedWorkflowId ? { companyId, workflowId: selectedWorkflowId } : { companyId }),
    [companyId, selectedWorkflowId],
  );
  const workflowDetailQuery = usePluginData<WorkflowDetailResult>(DATA_KEYS.workflowDetail, detailParams);
  const workflowStagesQuery = usePluginData<WorkflowStagesData>(
    DATA_KEYS.workflowStages,
    companyId && selectedWorkflowId ? { companyId, workflowId: selectedWorkflowId } : {},
  );
  const [runStageFilter, setRunStageFilter] = useState("all");
  const workflowRunsQuery = usePluginData<WorkflowRunsData>(
    DATA_KEYS.workflowRuns,
    companyId && selectedWorkflowId
      ? {
        companyId,
        workflowId: selectedWorkflowId,
        stageKey: runStageFilter === "all" ? undefined : runStageFilter,
      }
      : {},
  );
  const [syncingStageKey, setSyncingStageKey] = useState<string | null>(null);
  const [postingStageKey, setPostingStageKey] = useState<string | null>(null);
  const [stageOutputDrafts, setStageOutputDrafts] = useState<Record<string, StageOutputDraft>>({});

  useEffect(() => {
    if (!selectedWorkflowId) return;
    const workflow = workflowDetailQuery.data?.workflow;
    if (!workflow) return;
    setForm(workflowToForm(workflow));
  }, [selectedWorkflowId, workflowDetailQuery.data]);

  useEffect(() => {
    if (!selectedWorkflowId) {
      setForm((current) => (
        current.projectId === (props.projectId ?? "") ? current : { ...current, projectId: props.projectId ?? "" }
      ));
    }
  }, [props.projectId, selectedWorkflowId]);

  useEffect(() => {
    setStageOutputDrafts({});
  }, [selectedWorkflowId]);

  useEffect(() => {
    setRunStageFilter("all");
  }, [selectedWorkflowId]);

  const workflows = workflowsQuery.data?.workflows ?? [];
  const templates = templatesQuery.data?.templates ?? listWorkflowFallbackTemplates();

  function resetForm() {
    setSelectedWorkflowId(null);
    setForm(emptyWorkflowForm(props.projectId));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!companyId) return;
    setSaving(true);
    try {
      const result = await upsertWorkflow({
        companyId,
        workflowId: form.workflowId ?? undefined,
        name: form.name,
        templateKey: form.templateKey,
        status: form.status,
        description: form.description,
        projectId: form.projectId || undefined,
      }) as WorkflowActionResult;
      workflowsQuery.refresh();
      workflowDetailQuery.refresh();
      toast({
        title: form.workflowId ? "Workflow updated" : "Workflow created",
        body: result.workflow.name,
        tone: "success",
      });
      resetForm();
    } catch (error) {
      toast({
        title: "Workflow save failed",
        body: error instanceof Error ? error.message : "Unknown plugin action failure",
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(workflowId: string) {
    if (!companyId) return;
    setDeletingId(workflowId);
    try {
      await deleteWorkflow({ companyId, workflowId });
      workflowsQuery.refresh();
      if (selectedWorkflowId === workflowId) {
        resetForm();
      }
      toast({
        title: "Workflow deleted",
        body: workflowId,
        tone: "success",
      });
    } catch (error) {
      toast({
        title: "Delete failed",
        body: error instanceof Error ? error.message : "Unknown plugin action failure",
        tone: "error",
      });
    } finally {
      setDeletingId(null);
    }
  }

  async function handleStageSync(stageKey: string) {
    if (!companyId || !selectedWorkflowId) return;
    setSyncingStageKey(stageKey);
    try {
      const result = await syncWorkflowStageIssue({
        companyId,
        workflowId: selectedWorkflowId,
        stageKey,
      }) as WorkflowStageSyncActionResult;
      workflowStagesQuery.refresh();
      workflowsQuery.refresh();
      toast({
        title: "Stage issue synced",
        body: `${result.stage.displayName} -> ${result.issue.title}`,
        tone: "success",
      });
    } catch (error) {
      toast({
        title: "Stage sync failed",
        body: error instanceof Error ? error.message : "Unknown plugin action failure",
        tone: "error",
      });
    } finally {
      setSyncingStageKey(null);
    }
  }

  async function handleStageOutput(stageKey: string) {
    if (!companyId || !selectedWorkflowId) return;
    const draft = stageOutputDrafts[stageKey] ?? { summary: "", details: "", artifacts: [{ label: "", href: "" }] };
    if (!draft.summary.trim()) return;

    setPostingStageKey(stageKey);
    try {
      const result = await recordWorkflowStageOutput({
        companyId,
        workflowId: selectedWorkflowId,
        stageKey,
        summary: draft.summary,
        details: draft.details || undefined,
        artifacts: draft.artifacts.filter((artifact) => artifact.label.trim().length > 0 || artifact.href.trim().length > 0),
      }) as WorkflowStageOutputActionResult;
      workflowStagesQuery.refresh();
      workflowRunsQuery.refresh();
      setStageOutputDrafts((current) => ({
        ...current,
        [stageKey]: { summary: "", details: "", artifacts: [{ label: "", href: "" }] },
      }));
      toast({
        title: "Stage output posted",
        body: `${result.stage.displayName} -> ${result.run.summary}`,
        tone: "success",
      });
    } catch (error) {
      toast({
        title: "Stage output failed",
        body: error instanceof Error ? error.message : "Unknown plugin action failure",
        tone: "error",
      });
    } finally {
      setPostingStageKey(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <ScaffoldPanel
        title={props.title}
        summary={props.summary}
        meta={[
          { label: "Company", value: companyId || "unknown" },
          { label: "Project", value: props.projectId ?? "all workflows" },
          { label: "Stored workflows", value: String(workflowsQuery.data?.total ?? 0) },
        ]}
      />

      {!companyId ? (
        <div style={{ color: "rgba(15, 23, 42, 0.7)" }}>Company context is required to manage podcast workflows.</div>
      ) : null}

      {templatesQuery.loading ? <div style={{ color: "rgba(15, 23, 42, 0.7)" }}>Loading workflow templates…</div> : null}
      {workflowsQuery.loading ? <div style={{ color: "rgba(15, 23, 42, 0.7)" }}>Loading workflows…</div> : null}
      {workflowsQuery.error ? <div style={{ color: "#b91c1c" }}>Workflow load failed: {workflowsQuery.error.message}</div> : null}

      {companyId ? (
        <section style={panelStyle}>
          <div style={{ marginBottom: "0.75rem" }}>
            <strong>{form.workflowId ? "Edit workflow" : "New workflow"}</strong>
          </div>
          <WorkflowForm
            companyId={companyId}
            projectId={props.projectId}
            form={form}
            templates={templates}
            saving={saving}
            onChange={setForm}
            onSubmit={handleSubmit}
            onCancel={resetForm}
          />
        </section>
      ) : null}

      {companyId ? (
        <section style={panelStyle}>
          <div style={{ display: "grid", gap: "0.35rem" }}>
            <strong>Stage issue sync</strong>
            <div style={{ color: "rgba(15, 23, 42, 0.68)" }}>
              Each saved workflow stage can create or update a Paperclip issue tied to the bound project.
            </div>
          </div>

          {!selectedWorkflowId ? (
            <div style={{ color: "rgba(15, 23, 42, 0.68)" }}>
              Select an existing workflow with <strong>Edit</strong> to manage stage issues.
            </div>
          ) : null}

          {selectedWorkflowId && workflowStagesQuery.loading ? (
            <div style={{ color: "rgba(15, 23, 42, 0.68)" }}>Loading stage sync status…</div>
          ) : null}

          {selectedWorkflowId && workflowStagesQuery.error ? (
            <div style={{ color: "#b91c1c" }}>Stage status load failed: {workflowStagesQuery.error.message}</div>
          ) : null}

          {selectedWorkflowId && !workflowStagesQuery.loading && !workflowStagesQuery.error ? (
            <WorkflowStageList
              stages={workflowStagesQuery.data?.stages ?? []}
              syncingStageKey={syncingStageKey}
              postingStageKey={postingStageKey}
              drafts={stageOutputDrafts}
              onDraftChange={(stageKey, patch) => {
                setStageOutputDrafts((current) => ({
                  ...current,
                  [stageKey]: {
                    summary: patch.summary ?? current[stageKey]?.summary ?? "",
                    details: patch.details ?? current[stageKey]?.details ?? "",
                    artifacts: patch.artifacts ?? current[stageKey]?.artifacts ?? [{ label: "", href: "" }],
                  },
                }));
              }}
              onSync={handleStageSync}
              onPostOutput={handleStageOutput}
            />
          ) : null}
        </section>
      ) : null}

      {companyId && selectedWorkflowId ? (
        <WorkflowRunFeed
          companyPrefix={props.companyPrefix}
          runs={workflowRunsQuery.data?.runs ?? []}
          total={workflowRunsQuery.data?.total ?? 0}
          stageFilter={runStageFilter}
          stageOptions={(workflowStagesQuery.data?.stages ?? []).map((stage) => ({
            key: stage.key,
            displayName: stage.displayName,
          }))}
          loading={workflowRunsQuery.loading}
          error={workflowRunsQuery.error}
          onStageFilterChange={setRunStageFilter}
        />
      ) : null}

      <WorkflowList
        workflows={workflows}
        deletingId={deletingId}
        emptyMessage={props.emptyMessage}
        onEdit={(workflow) => {
          setSelectedWorkflowId(workflow.id);
          setForm(workflowToForm(workflow));
        }}
        onDelete={handleDelete}
      />
    </div>
  );
}

function listWorkflowFallbackTemplates(): WorkflowTemplatesData["templates"] {
  return WORKFLOW_TEMPLATES.map((template) => ({ ...template }));
}

export function PodcastWorkflowCommentAnnotation({ context }: PluginCommentAnnotationProps) {
  const annotation = usePluginData<CommentStageOutputData>(
    DATA_KEYS.commentStageOutput,
    context.companyId
      ? {
        companyId: context.companyId,
        issueId: context.parentEntityId,
        commentId: context.entityId,
      }
      : {},
  );

  if (!annotation.data?.annotation) {
    return null;
  }

  const output = annotation.data.annotation;

  return (
    <div style={annotationCardStyle}>
      <div style={{ ...rowStyle, justifyContent: "space-between" }}>
        <div style={{ display: "grid", gap: "0.2rem" }}>
          <strong>{output.workflowName}</strong>
          <div style={{ fontSize: "0.85rem", color: "rgba(15, 23, 42, 0.66)" }}>
            {output.stageDisplayName} output handoff
          </div>
        </div>
        <div style={{ fontSize: "0.8rem", color: "rgba(15, 23, 42, 0.58)" }}>
          {new Date(output.createdAt).toLocaleString()}
        </div>
      </div>

      <div style={{ color: "rgba(15, 23, 42, 0.84)" }}>{output.summary}</div>

      {output.details.trim().length > 0 ? (
        <div style={{ fontSize: "0.9rem", color: "rgba(15, 23, 42, 0.72)", whiteSpace: "pre-wrap" }}>
          {output.details}
        </div>
      ) : null}

      {output.artifacts.length > 0 ? (
        <div style={artifactGridStyle}>
          {output.artifacts.map((artifact) => (
            <a
              key={`${output.commentId}:${artifact.label}:${artifact.href}`}
              href={artifact.href}
              target="_blank"
              rel="noreferrer"
              style={artifactLinkStyle}
            >
              <strong>{artifact.label}</strong>
              <span style={{ fontSize: "0.82rem", color: "rgba(15, 23, 42, 0.7)", wordBreak: "break-all" }}>
                {artifact.href}
              </span>
            </a>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: "0.85rem", color: "rgba(15, 23, 42, 0.6)" }}>
          No structured artifacts were attached to this workflow update.
        </div>
      )}
    </div>
  );
}

export function PodcastControlPlanePage({ context }: PluginPageProps) {
  return (
    <PodcastWorkflowManager
      companyId={context.companyId}
      companyPrefix={context.companyPrefix}
      projectId={context.projectId ?? null}
      title="Podcast Control Plane"
      summary="Manage company-scoped workflow definitions for episode production, promotion, and repeatable podcast operations."
      emptyMessage="No podcast workflows are configured for this company yet."
    />
  );
}

export function PodcastControlPlaneSettingsPage({ context }: PluginSettingsPageProps) {
  const templates = usePluginData<WorkflowTemplatesData>(DATA_KEYS.workflowTemplates, {});

  return (
    <ScaffoldPanel
      title="Podcast Control Plane Settings"
      summary="This slice introduces the reusable workflow templates and company-scoped plugin-state storage that later settings, bindings, and connector references will build on."
      meta={[
        { label: "Company", value: context.companyId ?? "unknown" },
        { label: "Template count", value: String(templates.data?.templates.length ?? WORKFLOW_TEMPLATES.length) },
        { label: "State namespace", value: "podcast-control-plane" },
      ]}
    />
  );
}

export function PodcastControlPlaneDashboardWidget({ context }: PluginWidgetProps) {
  const workflows = usePluginData<WorkflowListData>(DATA_KEYS.workflowList, { companyId: context.companyId ?? "" });
  const activeCount = (workflows.data?.workflows ?? []).filter((workflow) => workflow.status === "active").length;
  const latest = workflows.data?.workflows[0];

  return (
    <ScaffoldPanel
      title="Podcast Control Plane"
      summary="Quick visibility into the number of configured podcast workflows and the most recently updated definition."
      meta={[
        { label: "Company", value: context.companyId ?? "unknown" },
        { label: "Total workflows", value: String(workflows.data?.total ?? 0) },
        { label: "Active workflows", value: String(activeCount) },
        { label: "Latest", value: latest?.name ?? "None yet" },
      ]}
    />
  );
}

export function PodcastProjectDetailTab({ context }: PluginDetailTabProps) {
  return (
    <PodcastWorkflowManager
      companyId={context.companyId}
      companyPrefix={context.companyPrefix}
      projectId={context.entityId ?? null}
      title="Podcast Project Workflows"
      summary="Project-scoped view of podcast workflow definitions bound to this project."
      emptyMessage="No podcast workflows are bound to this project yet."
    />
  );
}
