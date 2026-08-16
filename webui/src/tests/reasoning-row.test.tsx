import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ReasoningRow } from "@/components/thread/activity/ReasoningRow";

describe("ReasoningRow", () => {
  it("shows the compact preview and hides the full text by default", () => {
    render(<ReasoningRow text={"step one\nstep two\n".repeat(20)} streaming={false} />);
    expect(screen.getByTestId("activity-step")).toBeInTheDocument();
    expect(screen.queryByTestId("reasoning-full-text")).not.toBeInTheDocument();
    // The toggle is present because there is text to expand.
    expect(screen.getByTestId("reasoning-toggle")).toHaveAttribute("aria-expanded", "false");
  });

  it("expands to the full raw reasoning text on click", () => {
    const text = "first line\nsecond line\nthird line";
    render(<ReasoningRow text={text} streaming={false} />);

    fireEvent.click(screen.getByTestId("reasoning-toggle"));

    expect(screen.getByTestId("reasoning-toggle")).toHaveAttribute("aria-expanded", "true");
    const full = screen.getByTestId("reasoning-full-text");
    expect(full).toHaveTextContent("first line");
    expect(full).toHaveTextContent("third line");
  });

  it("collapses again on a second click", () => {
    render(<ReasoningRow text="some reasoning" streaming={false} />);
    const toggle = screen.getByTestId("reasoning-toggle");

    fireEvent.click(toggle);
    expect(screen.getByTestId("reasoning-full-text")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.queryByTestId("reasoning-full-text")).not.toBeInTheDocument();
  });

  it("renders a plain row without a toggle when there is no text", () => {
    render(<ReasoningRow text="" streaming={false} />);
    expect(screen.getByTestId("activity-step")).toBeInTheDocument();
    expect(screen.queryByTestId("reasoning-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("reasoning-full-text")).not.toBeInTheDocument();
  });

  it("shows the streaming fallback label while streaming with no text", () => {
    render(<ReasoningRow text="" streaming />);
    // The fallback label renders inside the header (compact preview path).
    expect(screen.getByTestId("activity-step")).toHaveTextContent("Thinking");
  });

  it("links the disclosure button to its full-text region", () => {
    render(<ReasoningRow text="some reasoning" streaming={false} />);
    const toggle = screen.getByTestId("reasoning-toggle");
    fireEvent.click(toggle);

    const full = screen.getByTestId("reasoning-full-text");
    const controls = toggle.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    expect(full).toHaveAttribute("id", controls);
  });

  it("gives multiple reasoning rows unique disclosure targets", () => {
    render(
      <>
        <ReasoningRow text="first reasoning" streaming={false} />
        <ReasoningRow text="second reasoning" streaming={false} />
      </>,
    );
    const toggles = screen.getAllByTestId("reasoning-toggle");

    fireEvent.click(toggles[0]);
    fireEvent.click(toggles[1]);

    const controls = toggles.map((toggle) => toggle.getAttribute("aria-controls"));
    expect(controls[0]).toBeTruthy();
    expect(controls[1]).toBeTruthy();
    expect(controls[0]).not.toBe(controls[1]);
    expect(screen.getAllByTestId("reasoning-full-text")).toHaveLength(2);
    expect(screen.getAllByTestId("reasoning-full-text").map((region) => region.id)).toEqual(
      controls,
    );
  });

  it("keeps caller spacing on the wrapper in both states", () => {
    render(<ReasoningRow text="some reasoning" streaming={false} className="mb-2" />);
    const collapsedWrapper = screen.getByTestId("reasoning-toggle").parentElement;
    expect(collapsedWrapper).toHaveClass("mb-2");
    expect(screen.getByTestId("activity-step")).not.toHaveClass("mb-2");

    fireEvent.click(screen.getByTestId("reasoning-toggle"));
    const expandedWrapper = screen.getByTestId("reasoning-full-text").parentElement;
    expect(expandedWrapper).toHaveClass("mb-2");
    expect(screen.getByTestId("reasoning-full-text")).not.toHaveClass("mb-1");
  });

  it("composes the shared activity step row layout", () => {
    render(<ReasoningRow text="some reasoning" streaming={false} />);
    const step = screen.getByTestId("activity-step");
    expect(step).toHaveClass("grid-cols-[1.125rem_minmax(0,1fr)]");
    expect(screen.getByTestId("activity-line")).toHaveAttribute("title", "some reasoning");
    // The chevron rides as a trailing sibling of the label, not inside the truncating span.
    const line = screen.getByTestId("activity-line");
    const chevron = line.querySelector("svg");
    expect(chevron).toBeInTheDocument();
    expect(line.contains(chevron)).toBe(true);
    expect(chevron?.parentElement).not.toHaveClass("truncate");
  });
});
