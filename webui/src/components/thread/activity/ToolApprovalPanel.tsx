import { ChevronDown, ShieldCheck, ShieldAlert, ShieldCheck as ShieldX } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import type { ApprovalRecord } from "@/lib/types";

/**
 * Expandable approval record for a gated tool call (approval gate POC).
 *
 * Renders in the session activity timeline after the fact, showing the tool
 * call, the smart-triage LLM response, the approval status, and the tool
 * result. Same expansion pattern as the reasoning rows ("show full context").
 */
export function ToolApprovalPanel({
  approval,
  toolName,
  argumentsJson,
  result,
  error,
}: {
  approval: ApprovalRecord;
  toolName: string;
  argumentsJson: unknown;
  result?: unknown;
  error?: unknown;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const statusMeta: Record<string, { label: string; tone: string; icon: typeof ShieldCheck }> = {
    approved: { label: "Approved", tone: "success", icon: ShieldCheck },
    auto_approved: { label: "Auto-approved", tone: "success", icon: ShieldCheck },
    denied: { label: "Denied", tone: "error", icon: ShieldAlert },
    pending: { label: "Pending", tone: "active", icon: ShieldCheck },
    cancelled: { label: "Cancelled", tone: "muted", icon: ShieldX },
  };
  const meta = statusMeta[approval.status] ?? {
    label: approval.status,
    tone: "muted",
    icon: ShieldCheck,
  };
  const StatusIcon = meta.icon;

  const verdictLabel =
    approval.verdict === "deny"
      ? t("app.approval.verdictDenied", { defaultValue: "Denied by smart triage" })
      : approval.verdict === "approve"
        ? t("app.approval.verdictApproved", { defaultValue: "Assessed safe" })
        : t("app.approval.verdictEscalated", { defaultValue: "Escalated for review" });

  let argsText = "";
  try {
    argsText = JSON.stringify(argumentsJson, null, 2);
  } catch {
    argsText = String(argumentsJson);
  }
  const resultText =
    error != null ? String(error) : result != null ? String(result) : "(no result)";

  // Raw triage responses are often just the verdict word ("APPROVE") — or
  // empty for reasoning models that exhausted the budget — which adds nothing
  // next to the verdict badge and the Assessment block. Only surface the raw
  // response when it actually carries an explanation after the verdict word,
  // and do it consistently for every verdict.
  const hasTriageDetail = Boolean(
    approval.triage_raw &&
      !/^\s*(approve|deny|escalate)[\s.:"'`-]*$/i.test(approval.triage_raw.trim()),
  );

  return (
    <div className="min-w-0">
      <button
        type="button"
        data-testid="approval-toggle"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="block w-full text-left"
      >
        <div
          data-testid="activity-step"
          data-approval-row=""
          className={cn(
            "flex min-w-0 items-center gap-1.5 py-0.5 text-[12.5px] leading-5",
            "text-muted-foreground/85",
          )}
        >
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium",
              meta.tone === "success" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
              meta.tone === "error" && "bg-destructive/10 text-destructive",
              meta.tone === "active" && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
              meta.tone === "muted" && "bg-muted text-muted-foreground",
            )}
          >
            <StatusIcon className="h-3 w-3" aria-hidden />
            {t(`app.approval.status.${approval.status}`, { defaultValue: meta.label })}
          </span>
          <span className="truncate font-mono">{toolName}</span>
          <span className="truncate italic text-muted-foreground/70">{verdictLabel}</span>
          <ChevronDown
            aria-hidden
            className={cn(
              "ml-auto h-3 w-3 shrink-0 text-muted-foreground/50 transition-transform [transition-duration:200ms] ease-out",
              "motion-reduce:transition-none",
              expanded && "rotate-180",
            )}
            strokeWidth={1.8}
          />
        </div>
      </button>
      {expanded ? (
        <div
          data-testid="approval-details"
          className="mb-1 ml-[1.125rem] border-l-2 border-muted/45 pl-3 pr-1 text-[12px] leading-5 text-muted-foreground"
        >
          {approval.reason ? (
            <div className="mb-1.5">
              <p className="font-medium text-foreground">
                {t("app.approval.assessment", { defaultValue: "Assessment" })}
              </p>
              <pre className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/60 bg-muted/40 p-2 font-mono text-[11.5px] leading-relaxed">
                {approval.reason}
              </pre>
            </div>
          ) : null}
          <div className="mb-1.5">
            <p className="font-medium text-foreground">
              {t("app.approval.fullCall", { defaultValue: "Tool call" })}
            </p>
            <pre className="mt-0.5 max-h-40 overflow-auto rounded-lg border border-border/60 bg-muted/40 p-2 font-mono text-[11.5px] leading-relaxed">
              {argsText}
            </pre>
          </div>
          {hasTriageDetail ? (
            <div className="mb-1.5">
              <p className="font-medium text-foreground">
                {t("app.approval.triageResponse", { defaultValue: "Smart triage response" })}
              </p>
              <pre className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/60 bg-muted/40 p-2 font-mono text-[11.5px] leading-relaxed">
                {approval.triage_raw}
              </pre>
            </div>
          ) : null}
          <div className="mb-1.5">
            <p className="font-medium text-foreground">
              {t("app.approval.result", { defaultValue: "Result" })}
            </p>
            <pre className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/60 bg-muted/40 p-2 font-mono text-[11.5px] leading-relaxed">
              {resultText}
            </pre>
          </div>
          {approval.request_id ? (
            <p className="font-mono text-[10.5px] text-muted-foreground/60">
              {t("app.approval.requestId", { defaultValue: "Request" })}: {approval.request_id}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
