import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SubagentCard } from "@/components/thread/SubagentCard";
import { SubagentStrip } from "@/components/thread/SubagentStrip";
import type { SubagentProgress } from "@/lib/types";

function runningSubagent(overrides: Partial<SubagentProgress> = {}): SubagentProgress {
  return {
    task_id: "sub-1",
    label: "researcher",
    phase: "awaiting_tools",
    iteration: 2,
    tool_events: [
      { name: "exec", phase: "start" },
      { name: "read_file", phase: "end" },
    ],
    running: true,
    ...overrides,
  };
}

describe("SubagentCard", () => {
  it("renders phase, iteration, and tool events for a running subagent", () => {
    render(
      <SubagentCard subagent={runningSubagent()} onStop={() => {}} defaultExpanded />,
    );

    expect(screen.getByTestId("subagent-card-sub-1")).toBeInTheDocument();
    expect(screen.getByText("researcher")).toBeInTheDocument();
    expect(screen.getByText(/awaiting_tools/)).toBeInTheDocument();
    expect(screen.getByText("exec")).toBeInTheDocument();
    expect(screen.getByText("read_file")).toBeInTheDocument();
    expect(screen.getByTestId("subagent-stop-sub-1")).toBeInTheDocument();
  });

  it("requests a stop when the stop button is clicked", async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    render(<SubagentCard subagent={runningSubagent()} onStop={onStop} />);

    await user.click(screen.getByTestId("subagent-stop-sub-1"));
    expect(onStop).toHaveBeenCalledWith("sub-1");
  });

  it("hides the stop button and shows the final result once done", () => {
    render(
      <SubagentCard
        subagent={runningSubagent({
          phase: "done",
          running: false,
          final_result: "research complete",
          final_status: "ok",
        })}
        onStop={() => {}}
      />,
    );

    expect(screen.queryByTestId("subagent-stop-sub-1")).not.toBeInTheDocument();
    expect(screen.getByText("research complete")).toBeInTheDocument();
  });

  it("shows the subagent error when present", () => {
    render(
      <SubagentCard
        subagent={runningSubagent({
          phase: "error",
          running: false,
          error: "provider exploded",
        })}
        onStop={() => {}}
      />,
    );

    expect(screen.getByTestId("subagent-error")).toHaveTextContent("provider exploded");
  });
});

describe("SubagentStrip", () => {
  it("renders nothing when there are no subagents", () => {
    const { container } = render(<SubagentStrip subagents={{}} onStop={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders running cards and drops stale finished ones", () => {
    render(
      <SubagentStrip
        subagents={{
          "sub-1": runningSubagent(),
          "sub-2": runningSubagent({
            task_id: "sub-2",
            label: "archivist",
            phase: "done",
            running: false,
            finished_wall_ms: Date.now() - 1000,
          }),
          "sub-3": runningSubagent({
            task_id: "sub-3",
            label: "old",
            phase: "done",
            running: false,
            finished_wall_ms: Date.now() - 60 * 60 * 1000,
          }),
        }}
        onStop={() => {}}
      />,
    );

    expect(screen.getByTestId("subagent-strip")).toBeInTheDocument();
    expect(screen.getByTestId("subagent-card-sub-1")).toBeInTheDocument();
    expect(screen.getByTestId("subagent-card-sub-2")).toBeInTheDocument();
    expect(screen.queryByTestId("subagent-card-sub-3")).not.toBeInTheDocument();
  });
});
