import { useState } from "react";
import { Activity } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { agentsApi } from "../api/agents";
import { cn } from "../lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface HeartbeatButtonProps {
  agentId: string;
  isAlive?: boolean;
  className?: string;
}

export function HeartbeatButton({ agentId, isAlive = false, className }: HeartbeatButtonProps) {
  const [justTriggered, setJustTriggered] = useState(false);

  const invoke = useMutation({
    mutationFn: () => agentsApi.invoke(agentId),
    onSuccess: () => {
      setJustTriggered(true);
      setTimeout(() => setJustTriggered(false), 3000);
    },
  });

  const showAlive = isAlive || justTriggered;

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
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!invoke.isPending) invoke.mutate();
            }}
            aria-label="Run heartbeat"
          >
            <Activity className="h-3 w-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          {invoke.isPending ? "Starting heartbeat..." : justTriggered ? "Heartbeat triggered" : "Run heartbeat"}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
