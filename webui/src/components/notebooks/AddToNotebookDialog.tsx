import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Notebook } from "@/lib/types";

interface AddToNotebookDialogProps {
  open: boolean;
  sessionKey?: string | null;
  notebooks: Notebook[];
  onClose: () => void;
  onPick: (notebookId: string) => void;
  onCreateNew: () => void;
}

export function AddToNotebookDialog({
  open,
  notebooks,
  onClose,
  onPick,
  onCreateNew,
}: AddToNotebookDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (!next) onClose();
    }}>
      <DialogContent className="max-w-sm">
        <DialogHeader className="text-left">
          <DialogTitle>{t("notebooks.addToNotebook")}</DialogTitle>
          <DialogDescription>
            {t("notebooks.addToNotebookDescription")}
          </DialogDescription>
        </DialogHeader>
        {notebooks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("notebooks.empty")}</p>
        ) : (
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {notebooks.map((notebook) => (
              <li key={notebook.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent/70"
                  onClick={() => onPick(notebook.id)}
                >
                  <span className="text-base leading-none">
                    {notebook.emoji || "📓"}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{notebook.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
          >
            {t("deleteConfirm.cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => {
              onClose();
              onCreateNew();
            }}
          >
            {t("notebooks.new")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
