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

vi.mock("@/components/ImageLightbox", () => ({
  ImageLightbox: ({
    images,
    index,
  }: {
    images: Array<{ url?: string }>;
    index: number | null;
  }) => (index === null ? null : (
    <div data-testid="mock-lightbox">{images[0]?.url}</div>
  )),
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

  it("renders an inline image for image payloads with a media URL", async () => {
    vi.mocked(fetchFilePreview).mockResolvedValue({
      path: "/workspace/photo.png",
      display_path: "photo.png",
      project_path: "/workspace",
      language: "",
      content: "",
      size: 1234,
      truncated: false,
      kind: "image",
      media_url: "/api/media/sig/payload",
    });

    render(
      <FilePreviewPanel
        sessionKey="websocket:chat-1"
        path="photo.png"
        token="tok"
        onClose={() => {}}
      />,
    );

    const img = await screen.findByRole("img", { name: "photo.png" });
    expect(img).toHaveAttribute("src", "/api/media/sig/payload");

    img.dispatchEvent(new Event("load", { bubbles: true }));
    await userEvent.click(img);
    expect(screen.getByTestId("mock-lightbox")).toHaveTextContent("/api/media/sig/payload");
  });

  it("shows an unavailable message for image payloads without a media URL", async () => {
    vi.mocked(fetchFilePreview).mockResolvedValue({
      path: "/workspace/photo.png",
      display_path: "photo.png",
      project_path: "/workspace",
      language: "",
      content: "",
      size: 1234,
      truncated: false,
      kind: "image",
      media_url: null,
    });

    render(
      <FilePreviewPanel
        sessionKey="websocket:chat-1"
        path="photo.png"
        token="tok"
        onClose={() => {}}
      />,
    );

    expect(
      await screen.findByText("This file type is not previewable on this gateway."),
    ).toBeInTheDocument();
  });

  it("requires an explicit opt-in before rendering HTML in a sandboxed iframe", async () => {
    const user = userEvent.setup();
    const html = "<!doctype html><html><head></head><body><h1>hi</h1></body></html>";
    vi.mocked(fetchFilePreview).mockResolvedValue({
      path: "/workspace/page.html",
      display_path: "page.html",
      project_path: "/workspace",
      language: "html",
      content: html,
      size: html.length,
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

    await screen.findByTestId("mock-code-block");
    await user.click(screen.getByRole("button", { name: "Rendered" }));

    expect(screen.queryByTestId("file-preview-html-frame")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("file-preview-html-render"));

    const frame = screen.getByTestId("file-preview-html-frame") as HTMLIFrameElement;
    expect(frame.getAttribute("sandbox")).toContain("allow-scripts");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(frame.getAttribute("srcDoc") ?? "").toContain("Content-Security-Policy");
    expect(frame.getAttribute("srcDoc") ?? "").toContain("connect-src 'none'");
    expect(frame.getAttribute("srcDoc") ?? "").toContain("<h1>hi</h1>");
  });

  it("can back out of HTML rendering to the source view", async () => {
    const user = userEvent.setup();
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

    await screen.findByTestId("mock-code-block");
    await user.click(screen.getByRole("button", { name: "Rendered" }));
    await user.click(screen.getByRole("button", { name: "Back to source" }));

    expect(screen.getByTestId("mock-code-block")).toHaveTextContent("<h1>hi</h1>");
    expect(screen.queryByTestId("file-preview-html-frame")).not.toBeInTheDocument();
  });

  it("renders PDF payloads in an iframe", async () => {
    vi.mocked(fetchFilePreview).mockResolvedValue({
      path: "/workspace/doc.pdf",
      display_path: "doc.pdf",
      project_path: "/workspace",
      language: "",
      content: "",
      size: 2048,
      truncated: false,
      kind: "pdf",
      media_url: "/api/media/sig/pdf",
    });

    render(
      <FilePreviewPanel
        sessionKey="websocket:chat-1"
        path="doc.pdf"
        token="tok"
        onClose={() => {}}
      />,
    );

    const frame = await screen.findByTestId("file-preview-pdf-frame");
    expect(frame).toHaveAttribute("src", "/api/media/sig/pdf");
  });

  it("renders video payloads with controls", async () => {
    vi.mocked(fetchFilePreview).mockResolvedValue({
      path: "/workspace/clip.mp4",
      display_path: "clip.mp4",
      project_path: "/workspace",
      language: "",
      content: "",
      size: 102400,
      truncated: false,
      kind: "video",
      media_url: "/api/media/sig/video",
    });

    render(
      <FilePreviewPanel
        sessionKey="websocket:chat-1"
        path="clip.mp4"
        token="tok"
        onClose={() => {}}
      />,
    );

    const video = await screen.findByTestId("file-preview-video") as HTMLVideoElement;
    expect(video).toHaveAttribute("src", "/api/media/sig/video");
    expect(video.controls).toBe(true);
  });

  it("renders CSV payloads as a table", async () => {
    vi.mocked(fetchFilePreview).mockResolvedValue({
      path: "/workspace/data.csv",
      display_path: "data.csv",
      project_path: "/workspace",
      language: "csv",
      content: "name,count\n\"alpha, inc\",3\nbeta,4\n",
      size: 30,
      truncated: false,
      kind: "csv",
      media_url: null,
    });

    render(
      <FilePreviewPanel
        sessionKey="websocket:chat-1"
        path="data.csv"
        token="tok"
        onClose={() => {}}
      />,
    );

    const table = await screen.findByTestId("file-preview-csv-table");
    expect(table).toHaveTextContent("name");
    expect(table).toHaveTextContent("alpha, inc");
    expect(table).toHaveTextContent("beta");
    expect(screen.queryByTestId("mock-code-block")).not.toBeInTheDocument();
  });

  it("falls back for pdf/video payloads without a media URL", async () => {
    vi.mocked(fetchFilePreview).mockResolvedValue({
      path: "/workspace/doc.pdf",
      display_path: "doc.pdf",
      project_path: "/workspace",
      language: "",
      content: "",
      size: 2048,
      truncated: false,
      kind: "pdf",
      media_url: null,
    });

    render(
      <FilePreviewPanel
        sessionKey="websocket:chat-1"
        path="doc.pdf"
        token="tok"
        onClose={() => {}}
      />,
    );

    expect(
      await screen.findByText("This file type is not previewable on this gateway."),
    ).toBeInTheDocument();
  });
});
