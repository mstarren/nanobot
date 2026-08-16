import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ToolApprovalPanel } from "@/components/thread/activity/ToolApprovalPanel";
import type { ApprovalRecord } from "@/lib/types";

function renderPanel(approval: Partial<ApprovalRecord>) {
  render(
    <ToolApprovalPanel
      approval={
        {
          status: "auto_approved",
          verdict: "approve",
          reason: "Read-only git command; no risk.",
          triage_raw: "APPROVE",
          request_id: null,
          ...approval,
        } as ApprovalRecord
      }
      toolName="exec"
      argumentsJson={{ command: "git status" }}
      result="clean"
    />,
  );
  // Expand the record so the details are visible.
  fireEvent.click(screen.getByTestId("approval-toggle"));
}

describe("ToolApprovalPanel", () => {
  it("shows the status badge, tool name and verdict label", () => {
    renderPanel({});
    expect(screen.getByTestId("approval-toggle")).toBeInTheDocument();
    expect(screen.getByText("Auto-approved")).toBeInTheDocument();
    expect(screen.getByText("exec")).toBeInTheDocument();
    expect(screen.getByText("Assessed safe")).toBeInTheDocument();
  });

  it("labels the triage explanation as Assessment", () => {
    renderPanel({});
    expect(screen.getByText("Assessment")).toBeInTheDocument();
    expect(screen.getByText("Read-only git command; no risk.")).toBeInTheDocument();
  });

  it("hides the raw response when it is only the verdict word", () => {
    renderPanel({ triage_raw: "APPROVE" });
    expect(screen.queryByText("Smart triage response")).not.toBeInTheDocument();
  });

  it("hides the raw response when it is empty (escalated call)", () => {
    renderPanel({
      status: "approved",
      verdict: "escalate",
      reason: "Writes to a system path; intent is unclear.",
      triage_raw: "",
      request_id: "abc123",
    });
    expect(screen.queryByText("Smart triage response")).not.toBeInTheDocument();
  });

  it("shows the raw response when it carries an explanation after the verdict", () => {
    renderPanel({ triage_raw: "APPROVE: Read-only git command; no risk." });
    expect(screen.getByText("Smart triage response")).toBeInTheDocument();
    expect(
      screen.getByText("APPROVE: Read-only git command; no risk."),
    ).toBeInTheDocument();
  });

  it("shows the tool call, result and request id when present", () => {
    renderPanel({
      status: "approved",
      verdict: "escalate",
      reason: "Uncertain",
      triage_raw: "ESCALATE: unclear intent",
      request_id: "abc123",
    });
    expect(screen.getByText("Tool call")).toBeInTheDocument();
    expect(
      screen.getByText(/"command": "git status"/, { selector: "pre" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Result")).toBeInTheDocument();
    expect(screen.getByText(/^Request:/)).toBeInTheDocument();
    expect(screen.getByText(/abc123/)).toBeInTheDocument();
  });

  it("labels yolo auto-approvals as Yolo in the pill's orange", () => {
    renderPanel({ yolo: true });
    expect(screen.getByText("Yolo")).toBeInTheDocument();
    expect(screen.queryByText("Auto-approved")).not.toBeInTheDocument();
    const badge = screen.getByText("Yolo").closest("span");
    expect(badge).toHaveClass("text-orange-600");
    expect(badge).toHaveClass("dark:text-orange-300");
  });

  it("bypasses the assessment workflow for yolo auto-approvals", () => {
    renderPanel({
      yolo: true,
      reason: "YOLO mode is enabled — approved without review.",
      triage_raw: "",
    });
    // Only the tool call and the response remain; no triage assessment.
    expect(screen.queryByText("Assessment")).not.toBeInTheDocument();
    expect(screen.queryByText("Smart triage response")).not.toBeInTheDocument();
    expect(screen.queryByText("Assessed safe")).not.toBeInTheDocument();
    expect(screen.getByText("Tool call")).toBeInTheDocument();
    expect(screen.getByText("Result")).toBeInTheDocument();
  });
});
