import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  CircleDashed,
  Loader2,
  OctagonX,
  Square,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SubagentProgress } from "@/lib/types";

/** Terminal phases that keep the card around in a collapsed "finished" state. */
const TERMINAL_PHASES = new Set(["done", "error", "cancelled"]);

const PHASE_ICONS: Record<string, typeof Loader2> = {
  done: CheckCircle2,
  error: XCircle,
  cancelled: OctagonX,
};

function toolStatusLabel(phase: string | undefined): string {
  if (phase === "end") return "ok";
  if (phase === "error") return "error";
  return phase || "start";
}

function SubagentCardInner({
  subagent,
  onStop,
  defaultExpanded = false,
}: {
  subagent: SubagentProgress;
  onStop: (taskId: string) => void;
  defaultExpanded?: boolean;
}) {
  const { t } = useTranslation();
  const terminal = TERMINAL_PHASES.has(subagent.phase);
  const running = subagent.running ?? !terminal;
  const PhaseIcon = PHASE_ICONS[subagent.phase] ?? (running ? Loader2 : CircleDashed);
  const toolEvents = useMemo(
    () => (Array.isArray(subagent.tool_events) ? subagent.tool_events : []),
    [subagent.tool_events],
  );

  return (
    <div
      data-testid={`subagent-card-${subagent.task_id}`}
      className={cn(
        "flex flex-col gap-2 rounded-xl border bg-background/60 px-3 py-2.5 text-sm shadow-sm",
        terminal ? "opacity-90" : "border-border/80",
      )}
    >
      <div className="flex items-center gap-2">
        <PhaseIcon
          className={cn(
            "size-4 shrink-0 text-muted-foreground",
            running && "animate-spin text-primary",
            subagent.phase === "error" && "text-destructive",
          )}
        />
        <span className="min-w-0 flex-1 truncate font-medium" title={subagent.label}>
          {subagent.label}
        </span>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
            terminal
              ? "bg-muted text-muted-foreground"
              : "bg-primary/10 text-primary",
          )}
        >
          {t("subagent.phase", { phase: subagent.phase })}
        </span>
        {typeof subagent.iteration === "number" && subagent.iteration > 0 && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {t("subagent.iteration", { count: subagent.iteration })}
          </span>
        )}
        {!terminal && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => onStop(subagent.task_id)}
            data-testid={`subagent-stop-${subagent.task_id}`}
            title={t("subagent.stop_title")}
          >
            <Square className="size-3 fill-current" />
            {t("subagent.stop")}
          </Button>
        )}
      </div>

      {subagent.error ? (
        <p className="text-xs text-destructive" data-testid="subagent-error">
          {subagent.error}
        </p>
      ) : null}

      {defaultExpanded && toolEvents.length > 0 ? (
        <ul className="max-h-40 space-y-1 overflow-y-auto border-t pt-2 text-xs">
          {toolEvents.map((event, index) => {
            const status = toolStatusLabel(event.phase);
            return (
              <li key={`${event.call_id ?? index}`} className="flex items-center gap-2">
                <span
                  className={cn(
                    "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium capitalize",
                    status === "ok"
                      ? "bg-emerald-500/10 text-emerald-600"
                      : status === "error"
                        ? "bg-destructive/10 text-destructive"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {status}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono">{event.name}</span>
                {event.error ? (
                  <span className="truncate text-destructive" title={String(event.error)}>
                    {String(event.error)}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {terminal && subagent.final_result ? (
        <p className="line-clamp-3 whitespace-pre-wrap border-t pt-2 text-xs text-muted-foreground">
          {subagent.final_result}
        </p>
      ) : null}
    </div>
  );
}

export const SubagentCard = memo(SubagentCardInner);
