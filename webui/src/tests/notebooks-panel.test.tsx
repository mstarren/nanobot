import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { AddToNotebookDialog } from "@/components/notebooks/AddToNotebookDialog";
import { NotebooksPanel } from "@/components/notebooks/NotebooksPanel";
import type { Notebook } from "@/lib/types";

const notebook: Notebook = {
  id: "nb1",
  name: "Research",
  emoji: "🔬",
  instructions: "Be precise.",
  session_keys: ["websocket:chat-1", "websocket:chat-2"],
  created_at: "2026-08-14T00:00:00Z",
  updated_at: "2026-08-14T00:00:00Z",
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof NotebooksPanel>> = {}) {
  const props = {
    notebooks: [notebook],
    sessionTitles: {
      "websocket:chat-1": "First chat",
      "websocket:chat-2": "Second chat",
    },
    activeSessionKey: null,
    onOpenSession: vi.fn(),
    onCreateNotebook: vi.fn(),
    onEditNotebook: vi.fn(),
    onAddCurrentSession: vi.fn(),
    onRemoveSession: vi.fn(),
    onDeleteNotebook: vi.fn(),
    ...overrides,
  };
  render(<NotebooksPanel {...props} />);
  return props;
}

describe("NotebooksPanel", () => {
  it("renders notebooks with emoji, name, and expandable sessions", () => {
    const props = renderPanel();
    expect(screen.getByText("Notebooks")).toBeTruthy();
    expect(screen.getByText("🔬")).toBeTruthy();
    expect(screen.getByText("Research")).toBeTruthy();
    expect(screen.getByText("First chat")).toBeTruthy();
    expect(screen.getByText("Second chat")).toBeTruthy();
    expect(props.onOpenSession).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("First chat"));
    expect(props.onOpenSession).toHaveBeenCalledWith("websocket:chat-1");
  });

  it("folds sessions when the notebook header is clicked again", () => {
    const { container } = render(
      <NotebooksPanel
        notebooks={[notebook]}
        sessionTitles={{ "websocket:chat-1": "First chat" }}
        activeSessionKey={null}
        onOpenSession={vi.fn()}
        onCreateNotebook={vi.fn()}
        onEditNotebook={vi.fn()}
        onAddCurrentSession={vi.fn()}
        onRemoveSession={vi.fn()}
        onDeleteNotebook={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Research"));
    expect(container.querySelectorAll("[aria-expanded]").length).toBe(1);
    expect(screen.queryByText("First chat")).toBeNull();
  });

  it("fires remove-session and add-current-chat callbacks", () => {
    const props = renderPanel();
    fireEvent.click(screen.getAllByLabelText("Remove from notebook")[0]);
    expect(props.onRemoveSession).toHaveBeenCalledWith("nb1", "websocket:chat-1");
    fireEvent.click(screen.getByText("Add current chat"));
    expect(props.onAddCurrentSession).toHaveBeenCalledWith("nb1");
  });

  it("fires create and delete callbacks", () => {
    const props = renderPanel();
    fireEvent.click(screen.getByLabelText("New notebook"));
    expect(props.onCreateNotebook).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Delete notebook"));
    fireEvent.click(screen.getByText("Confirm delete?"));
    expect(props.onDeleteNotebook).toHaveBeenCalledWith("nb1");
  });
});

describe("AddToNotebookDialog", () => {
  it("lists notebooks and calls onPick with the selected id", () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(
      <AddToNotebookDialog
        open
        notebooks={[notebook]}
        onClose={onClose}
        onPick={onPick}
        onCreateNew={vi.fn()}
      />,
    );
    expect(screen.getByText("Research")).toBeTruthy();
    fireEvent.click(screen.getByText("Research"));
    expect(onPick).toHaveBeenCalledWith("nb1");
  });

  it("offers a create-new notebook action", () => {
    const onCreateNew = vi.fn();
    render(
      <AddToNotebookDialog
        open
        notebooks={[]}
        onClose={vi.fn()}
        onPick={vi.fn()}
        onCreateNew={onCreateNew}
      />,
    );
    fireEvent.click(screen.getByText("New notebook"));
    expect(onCreateNew).toHaveBeenCalled();
  });
});
