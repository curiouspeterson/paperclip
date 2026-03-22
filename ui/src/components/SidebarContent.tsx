import { useMemo, useState } from "react";
import { NavLink, useLocation } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Radio } from "lucide-react";
import { useCompany } from "../context/CompanyContext";
import { podcastWorkflowsApi } from "../api/podcast-workflows";
import { queryKeys } from "../lib/queryKeys";
import { cn, formatDateTime, relativeTime } from "../lib/utils";
import { sortProcessedEpisodeWorkflows } from "../lib/podcast-content";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export function SidebarContent() {
  const [open, setOpen] = useState(true);
  const { selectedCompanyId } = useCompany();
  const location = useLocation();

  const { data: workflows } = useQuery({
    queryKey: queryKeys.podcastWorkflows.list(selectedCompanyId!),
    queryFn: () => podcastWorkflowsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const episodes = useMemo(
    () => sortProcessedEpisodeWorkflows(workflows ?? []),
    [workflows],
  );

  const activeEpisodeId = location.pathname.match(/^\/(?:[^/]+\/)?content\/([^/]+)/)?.[1] ?? null;

  if (!selectedCompanyId) {
    return null;
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="group">
        <div className="flex items-center px-3 py-1.5">
          <CollapsibleTrigger className="flex items-center gap-1 flex-1 min-w-0">
            <ChevronRight
              className={cn(
                "h-3 w-3 text-muted-foreground/60 transition-transform opacity-0 group-hover:opacity-100",
                open && "rotate-90",
              )}
            />
            <span className="text-[10px] font-medium uppercase tracking-widest font-mono text-muted-foreground/60">
              Content
            </span>
            <span className="text-[10px] text-muted-foreground/50">{episodes.length}</span>
          </CollapsibleTrigger>
        </div>
      </div>

      <CollapsibleContent>
        <div className="flex flex-col gap-0.5 mt-0.5">
          {episodes.length === 0 ? (
            <div className="px-3 py-2 text-[12px] text-muted-foreground/70">
              No processed episodes yet.
            </div>
          ) : (
            episodes.map((workflow) => (
              <NavLink
                key={workflow.id}
                to={`/content/${workflow.id}`}
                className={({ isActive }) =>
                  cn(
                    "flex flex-col gap-0.5 px-3 py-2 text-[13px] font-medium transition-colors",
                    isActive || activeEpisodeId === workflow.id
                      ? "bg-accent text-foreground"
                      : "text-foreground/80 hover:bg-accent/50 hover:text-foreground",
                  )
                }
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Radio className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">{workflow.title}</span>
                  <span className="shrink-0 rounded-full border border-border/80 px-1.5 py-0.5 text-[10px] text-muted-foreground capitalize">
                    {workflow.status.replaceAll("_", " ")}
                  </span>
                </div>
                <div className="ml-5 truncate text-[11px] text-muted-foreground/70">
                  Episode {workflow.manifest.episodeId ?? workflow.id.slice(0, 8)} · Synced{" "}
                  {relativeTime(workflow.lastSyncedAt ?? workflow.updatedAt)}
                </div>
                <div className="ml-5 truncate text-[10px] text-muted-foreground/50">
                  {formatDateTime(workflow.lastSyncedAt ?? workflow.updatedAt)}
                </div>
              </NavLink>
            ))
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
