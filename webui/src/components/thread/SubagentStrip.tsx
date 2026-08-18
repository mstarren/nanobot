import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Bot } from "lucide-react";

import { SubagentCard } from "@/components/thread/SubagentCard";
import type { SubagentProgress } from "@/lib/types";

const MAX_RECENT_MS = 10 * 60 * 1000; // keep finished cards visible for 10 min

function SubagentStripInner({
  subagents,
  onStop,
}: {
  subagents: Record<string, SubagentProgress>;
  onStop: (taskId: string) => void;
}) {
  const { t } = useTranslation();
  const items = useMemo(() => {
    const now = Date.now();
    return Object.values(subagents)
      .filter((s) => {
        const running = s.running ?? !["done", "error", "cancelled"].includes(s.phase);
        if (running) return true;
        // Drop stale finished cards so the strip does not accumulate forever.
        const finishedAt = s.finished_wall_ms ?? s.started_wall_ms;
        if (!finishedAt) return false;
        return now - finishedAt < MAX_RECENT_MS;
      })
      .sort((a, b) => (b.started_wall_ms ?? 0) - (a.started_wall_ms ?? 0));
  }, [subagents]);

  if (items.length === 0) return null;

  return (
    <div
      className="flex max-h-56 flex-col gap-2 overflow-y-auto border-b bg-background/70 px-3 py-2 backdrop-blur"
      data-testid="subagent-strip"
    >
      <div className="flex items-center gap-2 px-1 text-xs font-medium text-muted-foreground">
        <Bot className="size-3.5" />
        <span>{t("subagent.running", { count: items.length })}</span>
      </div>
      {items.map((subagent) => (
        <SubagentCard key={subagent.task_id} subagent={subagent} onStop={onStop} />
      ))}
    </div>
  );
}

export const SubagentStrip = memo(SubagentStripInner);
