import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceProjectPicker } from "@/components/thread/WorkspaceControls";
import type { WorkspaceScopePayload, WorkspacesPayload } from "@/lib/types";

function scope(path: string): WorkspaceScopePayload {
  return {
    project_path: path,
    project_name: "project",
    access_mode: "restricted",
    restrict_to_workspace: true,
    sandbox_status: { status: "unknown" },
  };
}

function controls(overrides: Partial<WorkspacesPayload["controls"]> = {}): WorkspacesPayload["controls"] {
  return {
    can_change_project: true,
    can_use_full_access: true,
    can_pick_folder: false,
    ...overrides,
  };
}

function renderPicker({
  scope: activeScope,
  defaultScope,
  controls: controlsValue,
  onPickFolder,
  onChange,
}: {
  scope: WorkspaceScopePayload;
  defaultScope: WorkspaceScopePayload;
  controls: WorkspacesPayload["controls"];
  onPickFolder?: () => Promise<string | null>;
  onChange?: (next: WorkspaceScopePayload) => void;
}) {
  return render(
    <WorkspaceProjectPicker
      isHero
      scope={activeScope}
      defaultScope={defaultScope}
      controls={controlsValue}
      onPickFolder={onPickFolder}
      onChange={onChange}
    />,
  );
}

function openPicker() {
  return userEvent.click(screen.getByRole("button", { name: /choose project/i }));
}

describe("WorkspaceProjectPicker (remote setups)", () => {
  it("renders the manual-path picker when project switching is allowed without a native folder picker", async () => {
    const onChange = vi.fn();
    renderPicker({
      scope: scope("/srv/project"),
      defaultScope: scope("/srv/default"),
      controls: controls(),
      onChange,
    });

    await openPicker();

    // Manual path entry is the remote story (no native picker available).
    expect(await screen.findByLabelText(/paste path/i)).toBeInTheDocument();
  });

  it("applies an absolute path typed by a remote user", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderPicker({
      scope: scope("/srv/project"),
      defaultScope: scope("/srv/default"),
      controls: controls(),
      onChange,
    });

    await openPicker();
    const input = await screen.findByLabelText(/paste path/i);
    await user.clear(input);
    await user.type(input, "/srv/other-project");
    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        project_path: "/srv/other-project",
        project_name: "other-project",
        restrict_to_workspace: true,
      }),
    );
  });

  it("rejects a relative path with an error message", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderPicker({
      scope: scope("/srv/project"),
      defaultScope: scope("/srv/default"),
      controls: controls(),
      onChange,
    });

    await openPicker();
    const input = await screen.findByLabelText(/paste path/i);
    await user.clear(input);
    await user.type(input, "relative/path");
    await user.keyboard("{Enter}");

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("hides the picker entirely when project switching is disabled", () => {
    const { container } = renderPicker({
      scope: scope("/srv/project"),
      defaultScope: scope("/srv/default"),
      controls: controls({ can_change_project: false }),
    });
    expect(container).toBeEmptyDOMElement();
  });
});
