import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, ChevronDown, ChevronRight, Pencil, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Notebook } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface NotebooksPanelProps {
  notebooks: Notebook[];
  sessionTitles: Record<string, string>;
  activeSessionKey?: string | null;
  onOpenSession: (sessionKey: string) => void;
  onCreateNotebook: () => void;
  onEditNotebook: (notebook: Notebook) => void;
  onAddCurrentSession: (notebookId: string) => void;
  onRemoveSession: (notebookId: string, sessionKey: string) => void;
  onDeleteNotebook: (notebookId: string) => void;
  collapsed?: boolean;
}

export function NotebooksPanel({
  notebooks,
  sessionTitles,
  activeSessionKey,
  onOpenSession,
  onCreateNotebook,
  onEditNotebook,
  onAddCurrentSession,
  onRemoveSession,
  onDeleteNotebook,
  collapsed = false,
}: NotebooksPanelProps) {
  const { t } = useTranslation();
  const [collapsedNotebooks, setCollapsedNotebooks] = useState<Record<string, boolean>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  if (collapsed) {
    return null;
  }

  const toggleNotebook = (id: string) => {
    setCollapsedNotebooks((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="border-t border-sidebar-border/70 px-2 pb-2 pt-3">
      <div className="mb-1.5 flex items-center justify-between px-1">
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-sidebar-foreground/60">
          <BookOpen className="h-3 w-3" aria-hidden />
          {t("notebooks.title")}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-muted-foreground/70 hover:text-sidebar-foreground"
          aria-label={t("notebooks.new")}
          onClick={onCreateNotebook}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {notebooks.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground/70">{t("notebooks.empty")}</p>
      ) : (
        <ul className="space-y-1">
          {notebooks.map((notebook) => {
            const isCollapsed = Boolean(collapsedNotebooks[notebook.id]);
            return (
              <li key={notebook.id} className="group/notebook rounded-md px-1 py-0.5">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-1 text-left text-xs font-medium text-sidebar-foreground/90 hover:bg-sidebar-accent/60"
                    onClick={() => toggleNotebook(notebook.id)}
                    aria-expanded={!isCollapsed}
                  >
                    <span className="shrink-0 text-sm leading-none">
                      {notebook.emoji || "📓"}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{notebook.name}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground/70">
                      {notebook.session_keys.length}
                    </span>
                    {isCollapsed ? (
                      <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                    ) : (
                      <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                    )}
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 text-muted-foreground/70 opacity-0 transition-opacity group-hover/notebook:opacity-100 hover:text-sidebar-foreground"
                    aria-label={t("notebooks.edit")}
                    onClick={() => onEditNotebook(notebook)}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                </div>

                {!isCollapsed && notebook.session_keys.length > 0 && (
                  <ul className="mt-0.5 space-y-0.5 pl-5">
                    {notebook.session_keys.map((sessionKey) => {
                      const title =
                        sessionTitles[sessionKey] ??
                        sessionKey.split(":").pop() ??
                        sessionKey;
                      const isActive = sessionKey === activeSessionKey;
                      return (
                        <li key={sessionKey} className="group/session flex items-center gap-1">
                          <button
                            type="button"
                            className={cn(
                              "min-w-0 flex-1 truncate rounded px-1.5 py-0.5 text-left text-xs",
                              isActive
                                ? "bg-sidebar-accent/70 font-medium text-sidebar-foreground"
                                : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                            )}
                            onClick={() => onOpenSession(sessionKey)}
                            title={title}
                          >
                            {title}
                          </button>
                          <button
                            type="button"
                            className="shrink-0 rounded p-0.5 text-muted-foreground/50 opacity-0 transition-opacity hover:text-red-400 group-hover/session:opacity-100"
                            aria-label={t("notebooks.removeSession")}
                            onClick={() => onRemoveSession(notebook.id, sessionKey)}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <div className="mt-0.5 flex items-center gap-1 pl-5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-5 px-1.5 text-[11px] text-muted-foreground/70 hover:text-sidebar-foreground"
                    onClick={() => onAddCurrentSession(notebook.id)}
                  >
                    <Plus className="mr-1 h-3 w-3" aria-hidden />
                    {t("notebooks.addCurrentChat")}
                  </Button>
                  {confirmDeleteId === notebook.id ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-5 px-1.5 text-[11px] text-red-400 hover:text-red-300"
                      onClick={() => {
                        onDeleteNotebook(notebook.id);
                        setConfirmDeleteId(null);
                      }}
                    >
                      {t("notebooks.confirmDelete")}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-5 px-1.5 text-[11px] text-muted-foreground/50 hover:text-red-400"
                      onClick={() => setConfirmDeleteId(notebook.id)}
                    >
                      {t("notebooks.delete")}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
