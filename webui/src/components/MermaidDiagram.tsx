import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useThemeValue } from "@/hooks/useTheme";

/**
 * Renders a mermaid diagram source block to SVG at runtime.
 *
 * `mermaid` is imported lazily so its (large) graph/d3 dependency tree
 * only loads when a message actually contains a diagram. Rendering runs
 * with `securityLevel: "strict"` (mermaid's built-in sanitizer), and the
 * SVG is mounted via `dangerouslySetInnerHTML` — safe because strict
 * mode strips executable content from diagram markup.
 */
export function MermaidDiagram({ code }: { code: string }) {
  const { t } = useTranslation();
  const isDark = useThemeValue() === "dark";
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [attempt, setAttempt] = useState(0);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const previousCodeRef = useRef<string | null>(null);

  // mermaid caches rendered output by id; bump the id whenever the source
  // changes (e.g. while a message is still streaming) so re-renders work.
  useEffect(() => {
    if (previousCodeRef.current !== code) {
      previousCodeRef.current = code;
      setAttempt((n) => n + 1);
    }
  }, [code]);

  useEffect(() => {
    cancelledRef.current = false;
    let disposed = false;
    const current = attempt;
    setSvg(null);
    setError(null);

    const diagramId = `mermaid-${uid}-${current}`;
    void (async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        if (disposed || cancelledRef.current) return;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: isDark ? "dark" : "default",
          fontFamily: "inherit",
        });
        const { svg: rendered } = await mermaid.render(diagramId, code);
        if (disposed || cancelledRef.current) return;
        setSvg(rendered);
      } catch (err) {
        if (disposed || cancelledRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      disposed = true;
      cancelledRef.current = true;
    };
  }, [attempt, code, isDark, uid]);

  if (error) {
    return (
      <div
        className="my-3 overflow-x-auto rounded-lg border border-border/60 bg-muted/35 p-3"
        data-testid="mermaid-diagram-error"
      >
        <p className="mb-2 text-xs text-muted-foreground">
          {t("markdown.mermaidFailed", {
            defaultValue: "Could not render this diagram.",
          })}
        </p>
        {error ? (
          <p className="mb-2 text-xs text-destructive/80">{error}</p>
        ) : null}
        <pre className="whitespace-pre font-mono text-[0.8125rem] leading-snug text-foreground/90">
          {code}
        </pre>
      </div>
    );
  }

  return (
    <div
      className="my-3 flex justify-center overflow-x-auto"
      data-testid="mermaid-diagram"
      aria-label={t("markdown.mermaidAria", { defaultValue: "Mermaid diagram" })}
    >
      {svg ? (
        <div
          className="[&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="h-16 w-16 animate-pulse rounded-md bg-muted/50" aria-hidden />
      )}
    </div>
  );
}
