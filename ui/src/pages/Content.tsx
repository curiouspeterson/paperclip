import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Radio } from "lucide-react";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { podcastWorkflowsApi } from "../api/podcast-workflows";
import { queryKeys } from "../lib/queryKeys";
import { EmptyState } from "../components/EmptyState";
import { EntityRow } from "../components/EntityRow";
import { PageSkeleton } from "../components/PageSkeleton";
import { StatusBadge } from "../components/StatusBadge";
import { sortProcessedEpisodeWorkflows } from "../lib/podcast-content";
import { formatDateTime, relativeTime } from "../lib/utils";

export function Content() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Content" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.podcastWorkflows.list(selectedCompanyId!),
    queryFn: () => podcastWorkflowsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  const episodes = useMemo(
    () => sortProcessedEpisodeWorkflows(data ?? []),
    [data],
  );

  if (!selectedCompanyId) {
    return <EmptyState icon={Radio} message="Select a company to view content episodes." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="space-y-2">
          <h1 className="text-lg font-semibold">Content</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Processed episodes from the pipeline, grouped here for review after sync.
          </p>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {episodes.length === 0 ? (
        <EmptyState icon={Radio} message="No processed episodes yet." />
      ) : (
        <div className="border border-border">
          {episodes.map((workflow) => (
            <EntityRow
              key={workflow.id}
              to={`/content/${workflow.id}`}
              leading={<Radio className="h-4 w-4 text-muted-foreground" />}
              identifier={workflow.manifest.episodeId ?? workflow.id.slice(0, 8)}
              title={workflow.title}
              subtitle={`Synced ${relativeTime(workflow.lastSyncedAt ?? workflow.updatedAt)} · Updated ${formatDateTime(workflow.lastSyncedAt ?? workflow.updatedAt)}${workflow.issueId ? " · Linked issue" : ""}`}
              trailing={<StatusBadge status={workflow.status} />}
            />
          ))}
        </div>
      )}
    </div>
  );
}
