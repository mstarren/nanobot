import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FilePreviewPanel } from "@/components/FilePreviewPanel";
import { setAppLanguage } from "@/i18n";
import { fetchFilePreview } from "@/lib/api";

vi.mock("@/components/CodeBlock", () => ({
  CodeBlock: ({
    code,
    language,
    highlight,
  }: {
    code: string;
    language?: string;
    highlight?: boolean;
  }) => (
    <pre
      data-testid="mock-code-block"
      data-language={language}
      data-highlight={String(highlight)}
    >
      {code}
    </pre>
  ),
}));

vi.mock("@/components/MarkdownText", () => ({
  MarkdownText: ({
    children,
  }: {
    children: string;
  }) => <div data-testid="mock-markdown-text">{children}</div>,
}));

vi.mock("@/components/ui/segmented-control", () => ({
  SegmentedControl: ({
    value,
    options,
    onChange,
    ariaLabel,
  }: {
    value: string;
    options: Array<{ value: string; label: string }>;
    onChange: (value: string) => void;
    ariaLabel?: string;
  }) => (
    <div aria-label={ariaLabel} data-testid="mock-segmented-control">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    fetchFilePreview: vi.fn(),
  };
});

describe("FilePreviewPanel", () => {
  beforeEach(async () => {
    await setAppLanguage("en");
    vi.mocked(fetchFilePreview).mockReset();
  });

  it("shows a compact breadcrumb with one file name and a visible close action", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    vi.mocked(fetchFilePreview).mockResolvedValue({
      path: "/Users/hr/workspace/quicksort.py",
      display_path: "quicksort.py",
      language: "python",
      content: "print('ok')",
      truncated: false,
    });

    render(
      <FilePreviewPanel
        sessionKey="websocket:chat-1"
        path="quicksort.py"
        token="tok"
        onClose={onClose}
      />,
    );

    const codeBlock = await screen.findByTestId("mock-code-block");
    expect(codeBlock).toHaveTextContent("print('ok')");
    expect(codeBlock).toHaveAttribute("data-language", "python");
    expect(codeBlock).toHaveAttribute("data-highlight", "true");
    expect(screen.getByTestId("file-preview-breadcrumb")).toHaveTextContent("...");
    expect(screen.getByTestId("file-preview-breadcrumb")).toHaveTextContent("workspace");
    expect(screen.getByTestId("file-preview-title")).toHaveTextContent("quicksort.py");
    expect(screen.getAllByText("quicksort.py")).toHaveLength(1);

    const closeButton = screen.getByRole("button", { name: "Close file preview" });
    expect(closeButton).toBeVisible();

    await user.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("updates translated chrome without refetching the open file", async () => {
    vi.mocked(fetchFilePreview).mockResolvedValue({
      path: "/workspace/notes.md",
      display_path: "notes.md",
      language: "markdown",
      content: "# Notes",
      truncated: false,
    });

    render(
      <FilePreviewPanel
        sessionKey="websocket:chat-1"
        path="notes.md"
        token="tok"
        onClose={() => {}}
      />,
    );

    await screen.findByTestId("mock-code-block");
    expect(fetchFilePreview).toHaveBeenCalledTimes(1);

    await act(async () => {
      await setAppLanguage("zh-CN");
    });

    expect(fetchFilePreview).toHaveBeenCalledTimes(1);
  });

  it("renders markdown content when the payload kind is markdown", async () => {
    vi.mocked(fetchFilePreview).mockResolvedValue({
      path: "/workspace/notes.md",
      display_path: "notes.md",
      project_path: "/workspace",
      language: "markdown",
      content: "# Heading\n\nSome **bold** text.",
      size: 31,
      truncated: false,
      kind: "markdown",
      media_url: null,
    });

    render(
      <FilePreviewPanel
        sessionKey="websocket:chat-1"
        path="notes.md"
        token="tok"
        onClose={() => {}}
      />,
    );

    const markdown = await screen.findByTestId("mock-markdown-text");
    expect(markdown).toHaveTextContent("# Heading");
    expect(screen.queryByTestId("mock-code-block")).not.toBeInTheDocument();
  });

  it("switches between rendered and source views for markdown", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchFilePreview).mockResolvedValue({
      path: "/workspace/notes.md",
      display_path: "notes.md",
      project_path: "/workspace",
      language: "markdown",
      content: "# Heading",
      size: 9,
      truncated: false,
      kind: "markdown",
      media_url: null,
    });

    render(
      <FilePreviewPanel
        sessionKey="websocket:chat-1"
        path="notes.md"
        token="tok"
        onClose={() => {}}
      />,
    );

    await screen.findByTestId("mock-markdown-text");
    await user.click(screen.getByRole("button", { name: "Source" }));
    expect(screen.getByTestId("mock-code-block")).toHaveTextContent("# Heading");

    await user.click(screen.getByRole("button", { name: "Rendered" }));
    expect(screen.getByTestId("mock-markdown-text")).toBeInTheDocument();
  });

  it("defaults html payloads to the source view", async () => {
    vi.mocked(fetchFilePreview).mockResolvedValue({
      path: "/workspace/page.html",
      display_path: "page.html",
      project_path: "/workspace",
      language: "html",
      content: "<h1>hi</h1>",
      size: 11,
      truncated: false,
      kind: "html",
      media_url: null,
    });

    render(
      <FilePreviewPanel
        sessionKey="websocket:chat-1"
        path="page.html"
        token="tok"
        onClose={() => {}}
      />,
    );

    const codeBlock = await screen.findByTestId("mock-code-block");
    expect(codeBlock).toHaveTextContent("<h1>hi</h1>");
    expect(screen.queryByTestId("mock-markdown-text")).not.toBeInTheDocument();
  });

  it("keeps the source view for plain text payloads", async () => {
    vi.mocked(fetchFilePreview).mockResolvedValue({
      path: "/workspace/script.py",
      display_path: "script.py",
      project_path: "/workspace",
      language: "python",
      content: "print('ok')",
      size: 11,
      truncated: false,
      kind: "text",
      media_url: null,
    });

    render(
      <FilePreviewPanel
        sessionKey="websocket:chat-1"
        path="script.py"
        token="tok"
        onClose={() => {}}
      />,
    );

    const codeBlock = await screen.findByTestId("mock-code-block");
    expect(codeBlock).toHaveTextContent("print('ok')");
    expect(screen.queryByTestId("mock-segmented-control")).not.toBeInTheDocument();
  });
});
