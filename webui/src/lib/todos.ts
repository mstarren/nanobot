import type { ToolProgressEvent } from "@/lib/types";

/**
 * Session task list parsing (Hermes parity).
 *
 * The `todo` tool returns `{todos: [...], summary: {...}}`; the gateway also
 * attaches the parsed `todos` array to the tool's completion event (like the
 * Hermes gateway's `tool.complete` payload). Items are
 * `{id, content, status}` with status in
 * `pending | in_progress | completed | cancelled`.
 */
export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
}

export interface TodoMilestone {
  id: string;
  name: string;
  todos: TodoItem[];
}

const STATUSES: readonly TodoStatus[] = ["pending", "in_progress", "completed", "cancelled"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const isStatus = (value: unknown): value is TodoStatus =>
  typeof value === "string" && (STATUSES as readonly string[]).includes(value);

function parseMilestones(value: unknown[]): TodoMilestone[] {
  return value.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const id = String(item.id ?? `milestone-${index + 1}`).trim();
    const name = String(item.name ?? `Milestone ${index + 1}`).trim();
    const tasks = item.todos ?? item.tasks;
    if (!id || !name || !Array.isArray(tasks)) return [];
    return [{ id, name, todos: parseArray(tasks) }];
  });
}

function parseArray(value: unknown[]): TodoItem[] {
  return value.flatMap((item) => {
    if (!isRecord(item) || !isStatus(item.status)) return [];
    const id = String(item.id ?? "").trim();
    const content = String(item.content ?? "").trim();
    return id && content ? [{ content, id, status: item.status }] : [];
  });
}

function parse(value: unknown, depth: number): TodoItem[] | null {
  if (depth > 2) return null;

  if (Array.isArray(value)) return parseArray(value);

  if (typeof value === "string" && value.trim()) {
    try {
      return parse(JSON.parse(value), depth + 1);
    } catch {
      return null;
    }
  }

  if (isRecord(value) && Object.hasOwn(value, "todos")) {
    return parse(value.todos, depth + 1);
  }

  return null;
}

export const parseTodos = (value: unknown): TodoItem[] | null => parse(value, 0);

export function parseTodoMilestones(value: unknown): TodoMilestone[] | null {
  if (typeof value === "string" && value.trim()) {
    try { return parseTodoMilestones(JSON.parse(value)); } catch { return null; }
  }
  if (isRecord(value) && Array.isArray(value.milestones)) return parseMilestones(value.milestones);
  return Array.isArray(value) ? parseMilestones(value) : null;
}

/** Latest parseable todo list from one message's structured tool events.
 *  Live events carry the parsed `todos`; persisted ones may only have the raw
 *  JSON string `result` (and args on start). */
export function milestonesFromToolEvents(events: ToolProgressEvent[] | undefined): TodoMilestone[] | null {
  if (!events?.length) return null;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.name !== "todo") continue;
    const source = event.milestones ?? event.result ?? event.arguments;
    const parsed = parseTodoMilestones(source);
    if (parsed !== null) return parsed;
  }
  return null;
}

export function todosFromToolEvents(events: ToolProgressEvent[] | undefined): TodoItem[] | null {
  if (!events?.length) return null;

  let latest: TodoItem[] | null = null;

  for (const event of events) {
    if (event.name !== "todo") continue;

    const parsed =
      parseTodos(event.todos) ??
      parseTodos(event.result) ??
      parseTodos(event.arguments);

    if (parsed !== null) latest = parsed;
  }

  return latest;
}

/** Current todo state for a whole transcript — the last list wins. */
export function latestSessionTodos(messages: readonly { toolEvents?: ToolProgressEvent[] }[]): TodoItem[] | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const todos = todosFromToolEvents(messages[i]?.toolEvents);
    if (todos !== null) return todos;
  }
  return null;
}

/** Whether the list still has open work (drives the "active" styling). */
export function todoListActive(todos: readonly TodoItem[]): boolean {
  return todos.some((todo) => todo.status === "pending" || todo.status === "in_progress");
}
