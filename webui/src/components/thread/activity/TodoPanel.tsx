import { CheckCircle2, CircleSlash, ListChecks, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { todoListActive, type TodoItem } from "@/lib/todos";
import { cn } from "@/lib/utils";

/**
 * Session task list panel — a faithful port of the Hermes Desktop todo
 * display (the checklist group in the composer status stack).
 *
 * - Header reads "Tasks X/Y" with a checklist glyph (Hermes: `checklist`
 *   codicon; `Tasks ${done}/${total}` counting non-cancelled items).
 * - Rows speak checkbox, not spinner-and-dot: a dashed ring while the item is
 *   still open (pending), a live spinner on the in-progress item, a green
 *   check once completed, and a muted slash when cancelled.
 */
export function TodoPanel({
  todos,
  active = false,
  className,
}: {
  todos: TodoItem[];
  active?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();

  if (!todos.length) return null;

  const counted = todos.filter((todo) => todo.status !== "cancelled");
  const done = counted.filter((todo) => todo.status === "completed").length;
  const total = counted.length;
  const open = todoListActive(todos);

  return (
    <div
      data-testid="todo-panel"
      data-todo-active={active && open ? "true" : undefined}
      className={cn(
        "rounded-lg border border-border/70 bg-muted/30 px-2.5 py-1.5",
        active && open && "border-muted-foreground/20",
        className,
      )}
    >
      <div
        data-testid="todo-panel-header"
        className="flex min-w-0 items-center gap-1.5 text-[13px] leading-5"
      >
        <ListChecks
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            active && open ? "text-muted-foreground/80" : "text-muted-foreground/55",
          )}
          strokeWidth={2}
          aria-hidden
        />
        <span
          className={cn(
            "min-w-0 truncate font-medium",
            active && open ? "text-muted-foreground/85" : "text-muted-foreground/60",
          )}
        >
          {t("message.todoHeader", {
            done,
            total,
            defaultValue: "Tasks {{done}}/{{total}}",
          })}
        </span>
      </div>
      <ul className="mt-1 flex flex-col gap-1">
        {todos.map((todo) => (
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
