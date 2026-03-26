import { useState } from "react";
import { Activity } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { agentsApi } from "../api/agents";
import { useCompany } from "../context/CompanyContext";
import { useToast } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface HeartbeatButtonProps {
  agentId: string;
  companyId?: string | null;
  isAlive?: boolean;
  className?: string;
}

export function HeartbeatButton({
  agentId,
  companyId,
  isAlive = false,
  className,
}: HeartbeatButtonProps) {
  const [justTriggered, setJustTriggered] = useState(false);
  const [lastResult, setLastResult] = useState<"started" | "skipped" | null>(null);
  const { selectedCompanyId } = useCompany();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const resolvedCompanyId = companyId ?? selectedCompanyId ?? undefined;

  const invoke = useMutation({
    mutationFn: () => agentsApi.invoke(agentId, resolvedCompanyId),
    onSuccess: (result) => {
      if ("id" in result) {
        setLastResult("started");
        setJustTriggered(true);
        window.setTimeout(() => setJustTriggered(false), 3000);
        return;
      }

      setLastResult("skipped");
      pushToast({
        title: "Heartbeat skipped",
        body: "The agent is paused, pending approval, or otherwise not eligible for a new run.",
        tone: "warn",
      });
    },
    onError: (error) => {
      setLastResult(null);
      pushToast({
        title: "Heartbeat failed",
        body: error instanceof Error ? error.message : "Could not start a heartbeat.",
        tone: "error",
      });
    },
    onSettled: () => {
      if (!resolvedCompanyId) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.liveRuns(resolvedCompanyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.heartbeats(resolvedCompanyId, agentId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(agentId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(resolvedCompanyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.sidebarBadges(resolvedCompanyId) });
    },
  });

  const showAlive = isAlive || justTriggered || invoke.isPending;
  const tooltipLabel = invoke.isPending
    ? "Starting heartbeat..."
    : lastResult === "skipped"
      ? "Heartbeat skipped"
      : justTriggered
        ? "Heartbeat started"
        : "Run heartbeat";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex items-center justify-center rounded p-0.5 transition-colors",
              showAlive
                ? "text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
                : "text-muted-foreground/50 hover:text-muted-foreground",
              invoke.isPending && "animate-pulse",
              className,
            )}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!invoke.isPending) invoke.mutate();
            }}
            aria-label="Run heartbeat"
          >
            <Activity className="h-3 w-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltipLabel}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
