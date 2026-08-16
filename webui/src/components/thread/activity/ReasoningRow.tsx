import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, CircleDashed } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

import { ActivityStep } from "./ActivityStep";
import { compactReasoningPreview } from "./reasoning-preview";

export function ReasoningRow({
  text,
  streaming,
  className,
}: {
  text: string;
  streaming: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const fallback = streaming
    ? t("message.reasoningStreaming", { defaultValue: "Thinking…" })
    : t("message.reasoning", { defaultValue: "Thinking" });
  const preview = compactReasoningPreview(text) || fallback;
  const [expanded, setExpanded] = useState(false);
  const canExpand = text.trim().length > 0;
  const fullTextId = useId();

  const header = (
    <ActivityStep
      active={streaming}
      title={preview}
      labelClassName="italic text-muted-foreground/78"
      marker={<ReasoningMarker streaming={streaming} />}
      label={preview}
      trailing={canExpand ? (
        <ChevronDown
          aria-hidden
          className={cn(
            "h-3 w-3 shrink-0 text-muted-foreground/50 transition-transform [transition-duration:200ms] ease-out",
            "motion-reduce:transition-none",
            expanded && "rotate-180",
          )}
          strokeWidth={1.8}
        />
      ) : undefined}
    />
  );

  return (
    <div className={cn("min-w-0", className)}>
      {canExpand ? (
        <button
          type="button"
          data-testid="reasoning-toggle"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-controls={fullTextId}
          aria-label={preview}
          className="block w-full text-left"
        >
          {header}
        </button>
      ) : (
        header
      )}
      {expanded ? (
        <div
          id={fullTextId}
          data-testid="reasoning-full-text"
          className="ml-[1.125rem] border-l-2 border-muted/45 pl-3 pr-1"
        >
          <pre className="whitespace-pre-wrap break-words font-sans text-[12.5px] leading-5 text-muted-foreground/85">
            {text}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

function ReasoningMarker({ streaming }: { streaming: boolean }) {
  const wasStreamingRef = useRef(streaming);
  const [justCompleted, setJustCompleted] = useState(false);

  useEffect(() => {
    if (wasStreamingRef.current && !streaming) {
      setJustCompleted(true);
      const timeout = window.setTimeout(() => setJustCompleted(false), 300);
      wasStreamingRef.current = streaming;
      return () => window.clearTimeout(timeout);
    }
    wasStreamingRef.current = streaming;
    return undefined;
  }, [streaming]);

  if (streaming) {
    return (
      <CircleDashed
        data-testid="activity-reasoning-marker"
        data-state="thinking"
        className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground/55"
        strokeWidth={1.8}
        aria-hidden
      />
    );
  }
  return (
    <span
      data-testid="activity-reasoning-marker"
      data-state="done"
      className={cn(
        "grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border border-emerald-500/28 text-emerald-500/78",
        "bg-emerald-500/[0.035] transition-[border-color,background-color,box-shadow,transform] duration-300 ease-out",
        justCompleted
          && "animate-in fade-in-0 zoom-in-75 shadow-[0_0_0_3px_rgba(16,185,129,0.10)] motion-reduce:animate-none",
      )}
      aria-hidden
    >
      <Check
        className={cn(
          "h-2.5 w-2.5 stroke-[2.4]",
          justCompleted && "animate-in fade-in-0 zoom-in-50 duration-300 motion-reduce:animate-none",
        )}
      />
    </span>
  );
}
