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
});
