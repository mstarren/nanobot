import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { AlertCircle, ChevronRight, Loader2, ShieldAlert, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { CodeBlock } from "@/components/CodeBlock";
import { splitFilePath } from "@/components/FileReferenceChip";
import { ImageLightbox } from "@/components/ImageLightbox";
import { MarkdownText } from "@/components/MarkdownText";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ApiError, fetchFilePreview } from "@/lib/api";
import type { FilePreviewPayload, PreviewKind, UIImage } from "@/lib/types";
import { cn } from "@/lib/utils";

interface FilePreviewPanelProps {
  sessionKey: string;
  path: string;
  token: string;
  desktopWidth?: number;
  isClosing?: boolean;
  onResizeStart?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onClose: () => void;
}

type PreviewState =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "ready"; payload: FilePreviewPayload };

/**
 * CSP injected into the preview iframe (prepended so the first policy
 * wins, mirroring Open WebUI's IFRAME_CSP). Inline scripts/styles stay
 * usable while outbound network calls (fetch/XHR/WebSocket) are blocked.
 */
const PREVIEW_IFRAME_CSP = [
  "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:",
  "connect-src 'none'",
].join("; ");

function htmlPreviewSrcDoc(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_IFRAME_CSP}">`;
  const headMatch = /<head([^>]*)>/i.exec(html);
  if (headMatch) {
    const at = headMatch.index + headMatch[0].length;
    return `${html.slice(0, at)}${meta}${html.slice(at)}`;
  }
  const doctypeMatch = /^\s*(<!doctype[^>]*>)/i.exec(html);
  if (doctypeMatch) {
    const at = doctypeMatch.index + doctypeMatch[0].length;
    return `${html.slice(0, at)}${meta}${html.slice(at)}`;
  }
  return `${meta}${html}`;
}

function PreviewImage({ src, alt, name }: { src: string; alt: string; name: string }) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const images = useMemo<UIImage[]>(() => [{ url: src, name }], [src, name]);

  return (
    <div className="flex h-full flex-col">
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
        {!loaded && !failed ? (
          <div className="absolute inset-0 grid place-items-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
          </div>
        ) : null}
        {failed ? (
          <p className="max-w-sm text-center text-sm text-muted-foreground">
            {t("filePreview.imageFailed", {
              defaultValue: "Could not load this image.",
            })}
          </p>
        ) : (
          <img
            src={src}
            alt={alt}
            draggable={false}
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            onClick={() => setLightboxIndex(0)}
            className={cn(
              "max-h-full max-w-full cursor-zoom-in rounded-md object-contain shadow-sm",
              !loaded && "invisible",
            )}
          />
        )}
      </div>
      <ImageLightbox
        images={images}
        index={lightboxIndex}
        onIndexChange={setLightboxIndex}
        onOpenChange={(open) => setLightboxIndex(open ? 0 : null)}
      />
    </div>
  );
}

function HtmlRenderInterstitial({
  onRender,
  onBack,
}: {
  onRender: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center px-8">
      <div className="max-w-sm text-center">
        <ShieldAlert className="mx-auto mb-3 h-6 w-6 text-amber-500" aria-hidden />
        <p className="text-sm leading-relaxed text-foreground/90">
          {t("filePreview.htmlWarning", {
            defaultValue:
              "This file contains HTML. Rendering runs it in an isolated sandbox: scripts cannot access this app and outbound network requests are blocked.",
          })}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className={cn(
              "inline-flex h-8 items-center justify-center rounded-md px-3 text-sm",
              "text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            {t("filePreview.htmlBack", { defaultValue: "Back to source" })}
          </button>
          <button
            type="button"
            onClick={onRender}
            data-testid="file-preview-html-render"
            className={cn(
              "inline-flex h-8 items-center justify-center rounded-md bg-foreground px-3 text-sm font-medium",
              "text-background transition-colors hover:bg-foreground/90",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            {t("filePreview.htmlRender", { defaultValue: "Render HTML" })}
          </button>
        </div>
      </div>
    </div>
  );
}

function HtmlPreviewFrame({ html, title }: { html: string; title: string }) {
  const { t } = useTranslation();
  const srcDoc = useMemo(() => htmlPreviewSrcDoc(html), [html]);
  return (
    <iframe
      title={title}
      sandbox="allow-scripts allow-popups allow-forms allow-downloads"
      srcDoc={srcDoc}
      referrerPolicy="no-referrer"
      className="h-full w-full border-0 bg-white"
      data-testid="file-preview-html-frame"
    >
      {t("filePreview.htmlFrame", { defaultValue: "Rendered HTML preview" })}
    </iframe>
  );
}

export function FilePreviewPanel({
  sessionKey,
  path,
  token,
  desktopWidth = 544,
  isClosing = false,
  onResizeStart,
  onClose,
}: FilePreviewPanelProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  const [entered, setEntered] = useState(false);
  const [view, setView] = useState<"rendered" | "source">("rendered");
  const [htmlRenderArmed, setHtmlRenderArmed] = useState(false);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchFilePreview(tokenRef.current, sessionKey, path)
      .then((payload) => {
        if (!cancelled) setState({ status: "ready", payload });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "error", error });
      });
    return () => {
      cancelled = true;
    };
  }, [path, sessionKey]);

  const displayPath = state.status === "ready" ? state.payload.display_path : path;
  const previewPath = state.status === "ready" ? state.payload.path : displayPath;
  const kind: PreviewKind = state.status === "ready"
    ? (state.payload.kind ?? "text")
    : "text";
  const hasRenderedView = kind === "markdown" || kind === "html";
  const showRendered = hasRenderedView && view === "rendered";
  const mediaUrl = state.status === "ready" ? (state.payload.media_url ?? null) : null;

  // Default markdown to the rendered view; everything else stays on source
  // until the user asks for more (HTML gets an explicit render action).
  useEffect(() => {
    setView(kind === "markdown" ? "rendered" : "source");
  }, [kind, path]);

  // Re-arm the HTML sandbox gate whenever a new file is opened so scripts
  // never run without an explicit per-file confirmation.
  useEffect(() => {
    setHtmlRenderArmed(false);
  }, [path]);

  const normalizedPreviewPath = previewPath.replace(/\\/g, "/");
  const hasRootPrefix = normalizedPreviewPath.startsWith("/");
  const { name } = splitFilePath(displayPath);
  const fileName = name || displayPath;
  const pathParts = useMemo(
    () => normalizedPreviewPath.split("/").filter(Boolean),
    [normalizedPreviewPath],
  );
  const directoryParts = useMemo(
    () => (pathParts.length > 1 ? pathParts.slice(0, -1) : []),
    [pathParts],
  );
  const breadcrumbParts = useMemo(
    () => (directoryParts.length > 0 ? [...directoryParts, fileName] : [fileName]),
    [directoryParts, fileName],
  );
  const compactBreadcrumbParts = useMemo(
    () => (breadcrumbParts.length > 3 ? breadcrumbParts.slice(-3) : breadcrumbParts),
    [breadcrumbParts],
  );
  const hasCompactPrefix = breadcrumbParts.length > compactBreadcrumbParts.length;
  const breadcrumbTitle = `${hasRootPrefix ? "/" : ""}${[
    ...directoryParts,
    fileName,
  ].join("/")}`;
  const errorMessage = state.status === "error"
    ? (state.error instanceof ApiError
      ? (state.error.status === 404 && /API route not found/i.test(state.error.message)
        ? t("filePreview.routeMissing", {
          defaultValue: "File preview needs the latest gateway. Restart nanobot gateway and try again.",
        })
        : state.error.message)
      : t("filePreview.failed", { defaultValue: "Could not preview this file." }))
    : null;

  return (
    <aside
      aria-label={t("filePreview.aria", { defaultValue: "File preview" })}
      style={{
        "--file-preview-width": `${desktopWidth}px`,
        "--file-preview-slot-width": !entered || isClosing ? "0px" : `${desktopWidth}px`,
      } as CSSProperties}
      className={cn(
        "absolute inset-y-0 right-0 z-30 w-[min(100vw,var(--file-preview-slot-width))] overflow-hidden",
        "transition-[width] duration-300 ease-out will-change-[width]",
        "md:relative md:z-auto md:w-[var(--file-preview-slot-width)] md:min-w-0 md:shrink-0",
        isClosing && "pointer-events-none",
      )}
      data-testid="file-preview-panel"
      data-file-preview-panel
    >
      <div
        className={cn(
          "absolute inset-y-0 right-0 flex w-[min(100vw,var(--file-preview-width))] flex-col overflow-hidden pb-[env(safe-area-inset-bottom)] md:w-[var(--file-preview-width)] md:pb-0",
          "border-l border-border/70 bg-background shadow-2xl md:shadow-none",
          "transition-[opacity,transform] duration-300 ease-out will-change-transform",
          !entered || isClosing ? "translate-x-full opacity-0" : "translate-x-0 opacity-100",
          "motion-reduce:translate-x-0",
        )}
      >
        {onResizeStart ? (
          <button
            type="button"
            aria-label={t("filePreview.resize", { defaultValue: "Resize file preview" })}
            className={cn(
              "group absolute inset-y-0 left-0 z-20 hidden w-3 -translate-x-1/2 cursor-col-resize touch-none md:flex",
              "items-stretch justify-center focus-visible:outline-none",
            )}
            onPointerDown={onResizeStart}
          >
            <span
              aria-hidden
              className={cn(
                "h-full w-px bg-foreground/25 opacity-0 transition-opacity",
                "group-hover:opacity-100 group-focus-visible:bg-ring group-focus-visible:opacity-100",
              )}
            />
          </button>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col">
          <div
            className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 px-3"
            title={previewPath}
          >
            <nav
              aria-label={t("filePreview.breadcrumb", { defaultValue: "File path" })}
              className="flex min-w-0 flex-1 items-center overflow-hidden text-sm leading-5"
              title={breadcrumbTitle}
              data-testid="file-preview-breadcrumb"
            >
              {hasCompactPrefix ? (
                <>
                  <span className="shrink-0 text-muted-foreground/55">...</span>
                  <ChevronRight
                    className="mx-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/35"
                    aria-hidden
                  />
                </>
              ) : hasRootPrefix ? (
                <>
                  <span className="shrink-0 text-muted-foreground/55">/</span>
                  <ChevronRight
                    className="mx-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/35"
                    aria-hidden
                  />
                </>
              ) : null}
              {compactBreadcrumbParts.map((part, index) => {
                const isLast = index === compactBreadcrumbParts.length - 1;
                return (
                  <span
                    key={`${part}-${index}`}
                    className="flex min-w-0 items-center overflow-hidden"
                  >
                    {index > 0 ? (
                      <ChevronRight
                        className="mx-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/35"
                        aria-hidden
                      />
                    ) : null}
                    <span
                      className={cn(
                        "min-w-0 truncate rounded-mark px-1 py-0.5",
                        isLast
                          ? "font-medium text-foreground"
                          : "max-w-[26vw] shrink text-muted-foreground/78",
                      )}
                      data-testid={isLast ? "file-preview-title" : undefined}
                    >
                      {part}
                    </span>
                  </span>
                );
              })}
            </nav>
            {hasRenderedView ? (
              <div
                className="shrink-0"
                data-testid="file-preview-view-toggle"
              >
                <SegmentedControl
                  value={view}
                  onChange={setView}
                  ariaLabel={t("filePreview.viewToggle", {
                    defaultValue: "Preview view",
                  })}
                  options={[
                    {
                      value: "rendered",
                      label: t("filePreview.rendered", { defaultValue: "Rendered" }),
                    },
                    {
                      value: "source",
                      label: t("filePreview.source", { defaultValue: "Source" }),
                    },
                  ]}
                />
              </div>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className={cn(
                "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                "text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
              title={t("filePreview.close", { defaultValue: "Close file preview" })}
              aria-label={t("filePreview.close", { defaultValue: "Close file preview" })}
              data-testid="file-preview-close"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {state.status === "loading" ? (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                {t("filePreview.loading", { defaultValue: "Loading preview..." })}
              </div>
            ) : state.status === "error" ? (
              <div className="flex h-full items-center justify-center px-8 text-center text-sm text-muted-foreground">
                <div className="max-w-sm">
                  <AlertCircle
                    className="mx-auto mb-3 h-5 w-5 text-muted-foreground/70"
                    aria-hidden
                  />
                  <p>{errorMessage}</p>
                </div>
              </div>
            ) : (
              <div className={cn("min-h-full", (kind === "image" || kind === "html") && "h-full")}>
                {state.payload.truncated ? (
                  <div className="mx-4 mt-3 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-200">
                    {t("filePreview.truncated", {
                      defaultValue: "Preview is truncated because this file is large.",
                    })}
                  </div>
                ) : null}
                {kind === "image" ? (
                  mediaUrl ? (
                    <PreviewImage
                      src={mediaUrl}
                      alt={displayPath}
                      name={fileName}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center px-8 text-center text-sm text-muted-foreground">
                      <p className="max-w-sm">
                        {t("filePreview.mediaUnavailable", {
                          defaultValue: "This file type is not previewable on this gateway.",
                        })}
                      </p>
                    </div>
                  )
                ) : kind === "html" && view === "rendered" ? (
                  htmlRenderArmed ? (
                    <HtmlPreviewFrame
                      html={state.payload.content}
                      title={t("filePreview.htmlFrame", {
                        defaultValue: "Rendered HTML preview",
                      })}
                    />
                  ) : (
                    <HtmlRenderInterstitial
                      onRender={() => setHtmlRenderArmed(true)}
                      onBack={() => setView("source")}
                    />
                  )
                ) : showRendered ? (
                  <div className="min-h-full px-4 py-3">
                    <MarkdownText>{state.payload.content}</MarkdownText>
                  </div>
                ) : (
                  <CodeBlock
                    language={state.payload.language}
                    code={state.payload.content}
                    chrome="none"
                    highlight
                    showLineNumbers
                    wrapLongLines={false}
                    className="min-h-full"
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
