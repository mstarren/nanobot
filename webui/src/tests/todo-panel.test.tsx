import { describe, expect, it } from "vitest";

import { TodoPanel } from "@/components/thread/activity/TodoPanel";
import {
  latestSessionTodos,
  parseTodos,
  todoListActive,
  todosFromToolEvents,
  type TodoItem,
} from "@/lib/todos";
import type { ToolProgressEvent, UIMessage } from "@/lib/types";
import { render, screen } from "@testing-library/react";

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

describe("TodoPanel", () => {
  it("renders nothing for an empty list", () => {
    const { container } = render(<TodoPanel todos={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows Tasks done/total counting non-cancelled items", () => {
    render(<TodoPanel todos={PLAN} />);
    expect(screen.getByTestId("todo-panel-header")).toHaveTextContent("Tasks 1/3");
  });

  it("renders one row per item with the Hermes status glyphs", () => {
    render(<TodoPanel todos={PLAN} />);
    const items = screen.getAllByTestId("todo-item");
    expect(items).toHaveLength(4);
    expect(screen.getByTestId("todo-glyph-completed")).toBeInTheDocument();
    expect(screen.getByTestId("todo-glyph-in-progress")).toBeInTheDocument();
    expect(screen.getByTestId("todo-glyph-pending")).toBeInTheDocument();
    expect(screen.getByTestId("todo-glyph-cancelled")).toBeInTheDocument();
    expect(screen.getByText("Port the backend todo tool")).toBeInTheDocument();
  });

  it("marks the panel active while the turn runs and the list is open", () => {
    const { container, rerender } = render(
      <TodoPanel todos={PLAN} active={false} />,
    );
    expect(container.querySelector('[data-todo-active="true"]')).toBeNull();
    rerender(<TodoPanel todos={PLAN} active />);
    expect(container.querySelector('[data-todo-active="true"]')).not.toBeNull();
    rerender(<TodoPanel todos={[PLAN[0]]} active />);
    expect(container.querySelector('[data-todo-active="true"]')).toBeNull();
  });
});
