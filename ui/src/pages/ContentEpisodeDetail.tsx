import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FileText, Paperclip, Radio } from "lucide-react";
import type { IssueAttachment, IssueDocument } from "@paperclipai/shared";
import { podcastWorkflowsApi } from "../api/podcast-workflows";
import { issuesApi } from "../api/issues";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { workflowStageStatusText, workflowStageStatusTextDefault } from "../lib/status-colors";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { StatusBadge } from "../components/StatusBadge";
import { cn, formatDateTime, issueUrl, relativeTime } from "../lib/utils";
import { MarkdownBody } from "../components/MarkdownBody";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type EpisodeDocumentGroup = "review" | "social" | "content" | "communication" | "ops" | "other";

const DOCUMENT_LABELS: Record<string, string> = {
  board_review: "Board review",
  approval_packet: "Approval packet",
  instagram_reel_draft: "Instagram reel draft",
  facebook_post_draft: "Facebook post draft",
  tiktok_post_draft: "TikTok post draft",
  newsletter_draft: "Newsletter draft",
  instagram_dry_run: "Instagram dry run",
  mailchimp_dry_run: "Mailchimp dry run",
  clip_candidates: "Clip candidates",
  quote_candidates: "Quote candidates",
  rendered_clips: "Rendered clips",
  quote_cards: "Quote cards",
  riverside_runbook: "Riverside runbook",
  vercel_runbook: "Vercel runbook",
  fable_runbook: "Fable runbook",
};

const DOCUMENT_GROUP_ORDER: EpisodeDocumentGroup[] = [
  "review",
  "social",
  "content",
  "communication",
  "ops",
  "other",
];

function documentGroupForKey(key: string): EpisodeDocumentGroup {
  if (key === "board_review" || key === "approval_packet") return "review";
  if (
    key === "instagram_reel_draft" ||
    key === "facebook_post_draft" ||
    key === "tiktok_post_draft" ||
    key === "instagram_dry_run"
  ) {
    return "social";
  }
  if (key === "clip_candidates" || key === "quote_candidates" || key === "rendered_clips" || key === "quote_cards") {
    return "content";
  }
  if (key === "newsletter_draft" || key === "mailchimp_dry_run") return "communication";
  if (key === "riverside_runbook" || key === "vercel_runbook" || key === "fable_runbook") return "ops";
  return "other";
}

function titleFromKey(key: string) {
  return DOCUMENT_LABELS[key] ?? key.replaceAll("_", " ");
}

function summarizeBody(body: string) {
  return body
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join("\n");
}

function groupDocuments(documents: IssueDocument[]) {
  const grouped: Record<EpisodeDocumentGroup, IssueDocument[]> = {
    review: [],
    social: [],
    content: [],
    communication: [],
    ops: [],
    other: [],
  };

  for (const document of [...documents].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())) {
    grouped[documentGroupForKey(document.key)].push(document);
  }

  return grouped;
}

function AttachmentPreview({ attachment }: { attachment: IssueAttachment }) {
  const isImage = attachment.contentType.startsWith("image/");
  const sizeLabel = `${(attachment.byteSize / 1024).toFixed(1)} KB`;

  return (
    <Card className="gap-3 py-0">
      <CardHeader className="border-b border-border pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-sm">{attachment.originalFilename ?? attachment.id}</CardTitle>
            <CardDescription className="mt-1">
              {attachment.contentType} · {sizeLabel}
            </CardDescription>
          </div>
          <Button variant="ghost" size="icon-sm" asChild>
            <a href={attachment.contentPath} target="_blank" rel="noreferrer" aria-label="Open attachment">
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pb-4">
        {isImage ? (
          <a href={attachment.contentPath} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border border-border">
            <img
              src={attachment.contentPath}
              alt={attachment.originalFilename ?? "attachment"}
              className="h-48 w-full object-cover"
            />
          </a>
        ) : (
          <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/20 px-4 py-6 text-center">
            <Paperclip className="h-8 w-8 text-muted-foreground" />
            <div className="text-sm font-medium">{attachment.originalFilename ?? "Attachment"}</div>
            <div className="text-xs text-muted-foreground">{attachment.contentType}</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DocumentCard({ document }: { document: IssueDocument }) {
  const [open, setOpen] = useState(false);

  return (
    <Card className="gap-3 py-0">
      <CardHeader className="border-b border-border pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-sm">{titleFromKey(document.key)}</CardTitle>
            <CardDescription className="mt-1 font-mono text-[11px]">{document.key}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">{formatDateTime(document.updatedAt)}</span>
            <Button variant="ghost" size="sm" onClick={() => setOpen((value) => !value)}>
              {open ? "Collapse" : "Expand"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pb-4">
        <div className={cn("space-y-3", !open && "max-h-56 overflow-hidden")}>
          {document.title && document.title !== titleFromKey(document.key) && (
            <div className="text-sm font-medium">{document.title}</div>
          )}
          <MarkdownBody className="prose-sm max-w-none">
            {open ? document.body : summarizeBody(document.body)}
          </MarkdownBody>
        </div>
        {!open && <div className="pointer-events-none mt-[-4rem] h-16 bg-gradient-to-b from-transparent to-background" />}
      </CardContent>
    </Card>
  );
}

function DocumentsSection({ documents }: { documents: IssueDocument[] }) {
  const grouped = useMemo(() => groupDocuments(documents), [documents]);

  return (
    <div className="space-y-6">
      {DOCUMENT_GROUP_ORDER.map((group) => {
        const groupDocuments = grouped[group];
        if (groupDocuments.length === 0) return null;
        const heading =
          group === "review"
            ? "Review bundle"
            : group === "content"
              ? "Content assets"
              : group === "communication"
                ? "Communication"
                : group === "ops"
                  ? "Operations"
                  : group === "social"
                    ? "Social"
                    : "Other";

        return (
          <section key={group} className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{heading}</h2>
              <p className="text-xs text-muted-foreground">
                {groupDocuments.length} document{groupDocuments.length === 1 ? "" : "s"}
              </p>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {groupDocuments.map((document) => (
                <DocumentCard key={document.id} document={document} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function AttachmentSection({ attachments }: { attachments: IssueAttachment[] }) {
  if (attachments.length === 0) return null;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Attachments</h2>
        <p className="text-xs text-muted-foreground">
          {attachments.length} attached artifact{attachments.length === 1 ? "" : "s"}
        </p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {attachments.map((attachment) => (
          <AttachmentPreview key={attachment.id} attachment={attachment} />
        ))}
      </div>
    </section>
  );
}

export function ContentEpisodeDetail() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  const { data: workflow, isLoading, error } = useQuery({
    queryKey: queryKeys.podcastWorkflows.detail(workflowId!),
    queryFn: () => podcastWorkflowsApi.get(workflowId!),
    enabled: Boolean(workflowId),
  });

  const issueId = workflow?.issueId ?? null;
  const { data: issue } = useQuery({
    queryKey: queryKeys.issues.detail(issueId ?? ""),
    queryFn: () => issuesApi.get(issueId!),
    enabled: Boolean(issueId),
  });

  const { data: documents = [] } = useQuery({
    queryKey: queryKeys.issues.documents(issueId ?? ""),
    queryFn: () => issuesApi.listDocuments(issueId!),
    enabled: Boolean(issueId),
  });

  const { data: attachments = [] } = useQuery({
    queryKey: queryKeys.issues.attachments(issueId ?? ""),
    queryFn: () => issuesApi.listAttachments(issueId!),
    enabled: Boolean(issueId),
  });

  useEffect(() => {
    if (!workflow) {
      setBreadcrumbs([{ label: "Content", href: "/content" }, { label: "Episode" }]);
      return;
    }
    setBreadcrumbs([
      { label: "Content", href: "/content" },
      { label: workflow.title },
    ]);
  }, [setBreadcrumbs, workflow]);

  const processedAt = workflow?.lastSyncedAt ?? workflow?.updatedAt ?? null;
  const issueLink = issue ? issueUrl(issue) : null;

  if (!selectedCompanyId) {
    return <EmptyState icon={Radio} message="Select a company to view content episodes." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="detail" />;
  }

  if (error) {
    return <p className="text-sm text-destructive">{error.message}</p>;
  }

  if (!workflow) {
    return <EmptyState icon={Radio} message="Episode not found." />;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-mono text-muted-foreground">
                {workflow.manifest.episodeId ?? workflow.id.slice(0, 8)}
              </span>
              <StatusBadge status={workflow.status} />
            </div>
            <div className="space-y-2">
              <h1 className="text-xl font-semibold">{workflow.title}</h1>
              <p className="max-w-3xl text-sm text-muted-foreground">
                {workflow.description ?? "Processed episode artifacts and linked issue context."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {issueLink && (
                <Button size="sm" variant="outline" asChild>
                  <Link to={issueLink}>Open linked issue</Link>
                </Button>
              )}
              <Button size="sm" variant="ghost" asChild>
                <Link to={`/podcast-ops/${workflow.id}`}>Open podcast ops</Link>
              </Button>
            </div>
          </div>

          <div className="grid gap-2 text-xs text-muted-foreground lg:min-w-80">
            <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
              <div className="uppercase tracking-wide">Processed</div>
              <div className="mt-1 text-sm text-foreground">
                {processedAt ? formatDateTime(processedAt) : "Not synced"}
              </div>
              <div>{processedAt ? relativeTime(processedAt) : "Awaiting sync"}</div>
            </div>
            <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
              <div className="uppercase tracking-wide">Issue</div>
              <div className="mt-1 text-sm text-foreground">
                {issue?.identifier ?? issue?.id ?? "No linked issue"}
              </div>
              <div>{issue ? issue.title : "Linked issue not available yet"}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Manifest path</CardDescription>
            <CardTitle className="text-sm font-mono break-all">{workflow.manifest.manifestPath ?? "Not set"}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Runtime root</CardDescription>
            <CardTitle className="text-sm font-mono break-all">{workflow.manifest.runtimeRoot ?? "Not set"}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Source media</CardDescription>
            <CardTitle className="text-sm font-mono break-all">{workflow.manifest.sourceMediaPath ?? "Not set"}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Artifacts</CardDescription>
            <CardTitle className="text-sm">
              {documents.length} documents · {attachments.length} attachments
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Stage status</CardTitle>
          <CardDescription>Pipeline stages captured on the workflow.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {Object.entries(workflow.stageStatus).map(([stage, status]) => (
            <span
              key={stage}
              className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground capitalize"
            >
              {stage.replaceAll("_", " ")}:{" "}
              <span className={workflowStageStatusText[status] ?? workflowStageStatusTextDefault}>{status}</span>
            </span>
          ))}
        </CardContent>
      </Card>

      {documents.length > 0 ? (
        <DocumentsSection documents={documents} />
      ) : (
        <EmptyState icon={FileText} message="No episode documents were synced to the linked issue yet." />
      )}

      {attachments.length > 0 && <AttachmentSection attachments={attachments} />}
    </div>
  );
}
