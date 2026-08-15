import { describe, expect, it } from "vitest";

import { TodoStateStrip } from "@/components/thread/TodoStateStrip";
import {
  latestSessionTodos,
  parseTodos,
  todoListActive,
  todosFromToolEvents,
  type TodoItem,
} from "@/lib/todos";
import type { ToolProgressEvent, UIMessage } from "@/lib/types";
import { fireEvent, render, screen } from "@testing-library/react";

const PLAN: TodoItem[] = [
  { id: "1", content: "Research hermes todo display", status: "completed" },
  { id: "2", content: "Port the backend todo tool", status: "in_progress" },
  { id: "3", content: "Render the task list in the WebUI", status: "pending" },
  { id: "4", content: "Open the PR", status: "cancelled" },
];

function todoEndEvent(payload: unknown): ToolProgressEvent {
  const event: ToolProgressEvent = {
    version: 1,
    phase: "end",
    call_id: "call_todo",
    name: "todo",
    arguments: { todos: undefined },
    result: typeof payload === "string" ? payload : payload,
  };
  if (typeof payload === "object" && payload !== null && "todos" in payload) {
    (event as { todos?: unknown }).todos = (payload as { todos: unknown }).todos;
  }
  return event;
}

describe("parseTodos", () => {
  it("parses a raw {todos, summary} result object", () => {
    const parsed = parseTodos({ todos: PLAN, summary: { total: 4 } });
    expect(parsed).toEqual(PLAN);
  });

  it("parses a JSON string result", () => {
    const parsed = parseTodos(JSON.stringify({ todos: PLAN }));
    expect(parsed).toEqual(PLAN);
  });

  it("parses a bare array", () => {
    expect(parseTodos(PLAN)).toEqual(PLAN);
  });

  it("drops malformed items and unknown statuses", () => {
    const parsed = parseTodos([
      { id: "1", content: "ok", status: "pending" },
      { id: "", content: "no id", status: "pending" },
      { id: "2", content: "bad status", status: "done" },
      { id: "3", content: "", status: "completed" },
    ]);
    expect(parsed).toEqual([{ id: "1", content: "ok", status: "pending" }]);
  });

  it("returns null for non-todo payloads", () => {
    expect(parseTodos({ summary: {} })).toBeNull();
    expect(parseTodos("not json")).toBeNull();
    expect(parseTodos(42)).toBeNull();
  });
});

describe("todosFromToolEvents", () => {
  it("reads the parsed todos attached to a todo completion event", () => {
    const events: ToolProgressEvent[] = [todoEndEvent({ todos: PLAN })];
    expect(todosFromToolEvents(events)).toEqual(PLAN);
  });

  it("falls back to the raw JSON string result", () => {
    const events: ToolProgressEvent[] = [
      todoEndEvent(JSON.stringify({ todos: PLAN, summary: { total: 4 } })),
    ];
    expect(todosFromToolEvents(events)).toEqual(PLAN);
  });

  it("ignores non-todo events", () => {
    const events: ToolProgressEvent[] = [
      { phase: "end", call_id: "c1", name: "grep", result: "{}" },
    ];
    expect(todosFromToolEvents(events)).toBeNull();
  });

  it("keeps the last list from a sequence of todo events", () => {
    const events: ToolProgressEvent[] = [
      todoEndEvent({ todos: [PLAN[0]] }),
      todoEndEvent({ todos: PLAN }),
    ];
    expect(todosFromToolEvents(events)).toEqual(PLAN);
  });
});

describe("latestSessionTodos", () => {
  it("scans messages backwards and returns the last list", () => {
    const messages: UIMessage[] = [
      { id: "m1", role: "tool", kind: "trace", content: "", createdAt: 1 },
      {
        id: "m2",
        role: "tool",
        kind: "trace",
        content: "todo(...)",
        traces: ["todo(...)"],
        toolEvents: [todoEndEvent({ todos: [PLAN[0]] })],
        createdAt: 2,
      },
      { id: "m3", role: "assistant", content: "done", createdAt: 3 },
    ];
    expect(latestSessionTodos(messages)).toEqual([PLAN[0]]);
  });

  it("returns null when no todo events exist", () => {
    expect(latestSessionTodos([{ id: "m", role: "assistant", content: "", createdAt: 1 }])).toBeNull();
  });
});

describe("todoListActive", () => {
  it("is true while any item is pending or in_progress", () => {
    expect(todoListActive([{ id: "1", content: "x", status: "pending" }])).toBe(true);
    expect(todoListActive([{ id: "1", content: "x", status: "in_progress" }])).toBe(true);
    expect(todoListActive([{ id: "1", content: "x", status: "completed" }])).toBe(false);
    expect(todoListActive([{ id: "1", content: "x", status: "cancelled" }])).toBe(false);
  });
});

describe("TodoStateStrip", () => {
  it("renders nothing for an empty or missing list", () => {
    const { container } = render(<TodoStateStrip todos={[]} />);
    expect(container.firstChild).toBeNull();
    const none = render(<TodoStateStrip todos={null} />);
    expect(none.container.firstChild).toBeNull();
    const undefinedStrip = render(<TodoStateStrip />);
    expect(undefinedStrip.container.firstChild).toBeNull();
  });

  it("shows the current in_progress task in the collapsed strip", () => {
    render(<TodoStateStrip todos={PLAN} />);
    expect(screen.getByTestId("todo-strip-label")).toHaveTextContent(
      "Tasks · Port the backend todo tool",
    );
  });

  it("falls back to Tasks done/total when nothing is in progress yet", () => {
    const queued = [
      { id: "1", content: "a", status: "completed" as const },
      { id: "2", content: "b", status: "pending" as const },
      { id: "3", content: "c", status: "pending" as const },
      { id: "4", content: "d", status: "cancelled" as const },
    ];
    render(<TodoStateStrip todos={queued} />);
    expect(screen.getByTestId("todo-strip-label")).toHaveTextContent("Tasks 1/3");
  });

  it("expands into a panel with the full list and Hermes status glyphs", () => {
    render(<TodoStateStrip todos={PLAN} />);
    fireEvent.click(screen.getByRole("button", { name: "Show full task list" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByTestId("todo-panel-header")).toHaveTextContent("Tasks 1/3");
    const items = screen.getAllByTestId("todo-item");
    expect(items).toHaveLength(4);
    expect(screen.getByTestId("todo-glyph-completed")).toBeInTheDocument();
    expect(screen.getByTestId("todo-glyph-in-progress")).toBeInTheDocument();
    expect(screen.getByTestId("todo-glyph-pending")).toBeInTheDocument();
    expect(screen.getByTestId("todo-glyph-cancelled")).toBeInTheDocument();
    expect(screen.getByText("Port the backend todo tool")).toBeInTheDocument();
  });

  it("closes the expanded panel through its close button", () => {
    render(<TodoStateStrip todos={PLAN} />);
    fireEvent.click(screen.getByRole("button", { name: "Show full task list" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close task list" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("todo-strip-label")).toHaveTextContent(
      "Tasks · Port the backend todo tool",
    );
  });
});
