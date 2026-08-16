import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleSlash,
  ListChecks,
  Loader2,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { floatingSurfaceElevationClassName } from "@/components/ui/floating-surface";
import type { TodoItem } from "@/lib/todos";
import { cn } from "@/lib/utils";

/**
 * Session task list drawer pinned to the composer — the Hermes Desktop
 * checklist in the composer status stack, moved out of the scrolling
 * transcript so it stays on screen while the agent works.
 *
 * - Collapsed: a status strip that shows the current (in_progress) task, or
 *   "Tasks X/Y" while no item is in progress yet. Sits under the goal strip
 *   when both are shown.
 * - Expanded: an upward anchored panel with the full list. Rows speak
 *   checkbox, not spinner-and-dot: a dashed ring while the item is still
 *   open (pending), a live spinner on the in-progress item, a green check
 *   once completed, and a muted slash when cancelled. Header reads
 *   "Tasks X/Y" counting non-cancelled items (Hermes parity).
 */
export function TodoStateStrip({ todos }: { todos?: TodoItem[] | null }) {
  const { t } = useTranslation();
  const [todoPanelOpen, setTodoPanelOpen] = useState(false);
  const stripLabel = todoStateStripPreview(todos, t);
  const active = !!stripLabel;
  const [, setTick] = useState(0);
  const stripWrapperRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const expandToggleRef = useRef<HTMLButtonElement>(null);
  const stripSnapshotRef = useRef<{
    todos?: TodoItem[] | null;
    stripLabel: string | null;
  } | null>(null);
  const [panelMaxPx, setPanelMaxPx] = useState(280);

  if (active) {
    stripSnapshotRef.current = { todos, stripLabel };
  }

  useEffect(() => {
    if (!active) setTodoPanelOpen(false);
  }, [active]);

  const display = active ? { todos, stripLabel } : stripSnapshotRef.current;
  const displayTodos = display?.todos ?? [];
  const displayStripLabel = display?.stripLabel ?? null;

  useLayoutEffect(() => {
    if (!todoPanelOpen) return;

    function relayout(): void {
      const el = stripWrapperRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      setPanelMaxPx(measureTodoPanelMaxCssHeight(top));
    }

    relayout();
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => relayout())
        : null;
    if (stripWrapperRef.current && ro) {
      ro.observe(stripWrapperRef.current);
    }
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", relayout);
    viewport?.addEventListener("scroll", relayout);
    window.addEventListener("resize", relayout);
    window.addEventListener("scroll", relayout, true);
    return () => {
      ro?.disconnect();
      viewport?.removeEventListener("resize", relayout);
      viewport?.removeEventListener("scroll", relayout);
      window.removeEventListener("resize", relayout);
      window.removeEventListener("scroll", relayout, true);
    };
  }, [todoPanelOpen]);

  useEffect(() => {
    if (!todoPanelOpen) return;

    function onPointerDown(ev: MouseEvent): void {
      const target = ev.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (expandToggleRef.current?.contains(target)) return;
      setTodoPanelOpen(false);
    }

    function onKey(ev: KeyboardEvent): void {
      if (ev.key === "Escape") setTodoPanelOpen(false);
    }

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [todoPanelOpen]);

  if (!display) return null;

  const counted = displayTodos.filter((todo) => todo.status !== "cancelled");
  const done = counted.filter((todo) => todo.status === "completed").length;
  const total = counted.length;
  const headerLabel = t("message.todoHeader", {
    done,
    total,
    defaultValue: "Tasks {{done}}/{{total}}",
  });

  return (
    <div
      ref={stripWrapperRef}
      data-testid="todo-state-strip"
      className="composer-status-drawer relative z-30"
      data-composer-status-drawer=""
      data-state={active ? "open" : "closed"}
      aria-hidden={active ? undefined : true}
      onTransitionEnd={(event) => {
        if (active || event.target !== event.currentTarget) return;
        stripSnapshotRef.current = null;
        setTick((n) => n + 1);
      }}
    >
      {todoPanelOpen ? (
        <div
          ref={panelRef}
          id="nanobot-todo-panel-root"
          data-testid="todo-panel-root"
          role="dialog"
          aria-modal="false"
          aria-labelledby="nanobot-todo-panel-title"
          tabIndex={-1}
          className={cn(
            "absolute bottom-[calc(100%+8px)] left-3 right-3 z-[50] flex max-w-none flex-col overflow-hidden",
            "rounded-2xl",
            floatingSurfaceElevationClassName,
          )}
          style={{ maxHeight: `${Math.round(panelMaxPx)}px` }}
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-black/[0.06] px-3 py-2 dark:border-white/[0.08]">
            <h2
              id="nanobot-todo-panel-title"
              data-testid="todo-panel-header"
              className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold tracking-tight text-foreground"
            >
              <ListChecks className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
              <span className="truncate">{headerLabel}</span>
            </h2>
            <button
              type="button"
              className={cn(
                "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                "text-muted-foreground transition-colors hover:bg-muted/65 hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
              aria-label={t("thread.composer.todoStateCloseAria")}
              onClick={() => setTodoPanelOpen(false)}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <div
            id="nanobot-todo-panel-scroll"
            className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-3 pb-3 pt-2"
          >
            <ul className="flex flex-col gap-1.5">
              {displayTodos.map((todo) => (
                <li
                  key={todo.id}
                  data-testid="todo-item"
                  data-todo-status={todo.status}
                  className="flex min-w-0 items-center gap-2"
                >
                  <TodoGlyph status={todo.status} />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-[13px] leading-5",
                      todo.status === "completed" || todo.status === "cancelled"
                        ? "text-muted-foreground/70"
                        : "text-foreground/90",
                    )}
                    title={todo.content}
                  >
                    {todo.content}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      <div className="composer-status-drawer-clip">
        {display ? (
          <div
            className="composer-status-drawer-content flex min-h-[36px] items-center gap-2 px-3 py-2"
            role="status"
            aria-label={displayStripLabel ?? headerLabel}
          >
            <ListChecks className="h-4 w-4 shrink-0 text-primary/75" aria-hidden />
            <span
              data-testid="todo-strip-label"
              className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] font-medium text-foreground/75"
            >
              {displayStripLabel ? <span className="truncate">{displayStripLabel}</span> : null}
            </span>
            <button
              ref={expandToggleRef}
              type="button"
              className={cn(
                "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                "text-muted-foreground transition-colors hover:bg-muted/55 hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
              aria-expanded={todoPanelOpen}
              aria-controls={todoPanelOpen ? "nanobot-todo-panel-root" : undefined}
              aria-label={t("thread.composer.todoStateExpandAria")}
              title={t("thread.composer.todoStateExpandAria")}
              onClick={() => setTodoPanelOpen((o) => !o)}
            >
              {todoPanelOpen ? (
                <ChevronDown className="h-4 w-4" aria-hidden />
              ) : (
                <ChevronUp className="h-4 w-4" aria-hidden />
              )}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Collapsed strip text: the current task when one is in progress, otherwise "Tasks X/Y". */
function todoStateStripPreview(
  todos: TodoItem[] | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string | null {
  if (!todos?.length) return null;
  const current = todos.find((todo) => todo.status === "in_progress");
  if (current?.content) {
    return t("thread.composer.todoStateStrip", {
      label: current.content,
      defaultValue: "Tasks · {{label}}",
    });
  }
  const counted = todos.filter((todo) => todo.status !== "cancelled");
  const done = counted.filter((todo) => todo.status === "completed").length;
  return t("message.todoHeader", {
    done,
    total: counted.length,
    defaultValue: "Tasks {{done}}/{{total}}",
  });
}

function visualViewportBounds(): { top: number; bottom: number; height: number } {
  const viewport = window.visualViewport;
  if (!viewport) {
    return { top: 0, bottom: window.innerHeight, height: window.innerHeight };
  }
  const top = Math.max(0, viewport.offsetTop);
  const height = Math.max(0, viewport.height);
  return { top, bottom: top + height, height };
}

const TODO_PANEL_VIEWPORT_TOP_PAD = 20;
const TODO_PANEL_GAP_ABOVE_STRIP_PX = 10;
const TODO_PANEL_MIN_HEIGHT_PX = 112;
const TODO_PANEL_MAX_VIEWPORT_RATIO = 0.62;

function measureTodoPanelMaxCssHeight(stripTopY: number): number {
  const viewport = visualViewportBounds();
  const spaceAboveStrip =
    stripTopY - viewport.top - TODO_PANEL_VIEWPORT_TOP_PAD - TODO_PANEL_GAP_ABOVE_STRIP_PX;
  return Math.min(
    Math.max(spaceAboveStrip, TODO_PANEL_MIN_HEIGHT_PX),
    Math.floor(viewport.height * TODO_PANEL_MAX_VIEWPORT_RATIO),
  );
}

function TodoGlyph({ status }: { status: TodoItem["status"] }): ReactNode {
  // Hermes Desktop: pending = dashed ring, in_progress = spinner, completed =
  // green pass icon, cancelled = muted circle-slash.
  if (status === "pending") {
    return (
      <span
        aria-hidden
        data-testid="todo-glyph-pending"
        className="box-border size-[0.7rem] shrink-0 rounded-full border border-dashed border-muted-foreground/60"
      />
    );
  }
  if (status === "in_progress") {
    return (
      <Loader2
        aria-label="in progress"
        data-testid="todo-glyph-in-progress"
        className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground/80 motion-reduce:animate-none"
      />
    );
  }
  if (status === "completed") {
    return (
      <CheckCircle2
        aria-label="completed"
        data-testid="todo-glyph-completed"
        className="h-3.5 w-3.5 shrink-0 text-emerald-500/80"
        strokeWidth={2}
      />
    );
  }
  return (
    <CircleSlash
      aria-label="cancelled"
      data-testid="todo-glyph-cancelled"
      className="h-3.5 w-3.5 shrink-0 text-muted-foreground/45"
      strokeWidth={2}
    />
  );
}
