import { useEffect, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Notebook } from "@/lib/types";

export interface NotebookValues {
  name: string;
  emoji: string;
  instructions: string;
}

interface NotebookEditDialogProps {
  open: boolean;
  notebook?: Notebook | null;
  onClose: () => void;
  onSubmit: (values: NotebookValues) => void;
  onDelete?: (notebookId: string) => void;
}

export function NotebookEditDialog({
  open,
  notebook,
  onClose,
  onSubmit,
  onDelete,
}: NotebookEditDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [instructions, setInstructions] = useState("");

  useEffect(() => {
    if (open) {
      setName(notebook?.name ?? "");
      setEmoji(notebook?.emoji ?? "");
      setInstructions(notebook?.instructions ?? "");
    }
  }, [open, notebook]);

  const trimmedName = name.trim();
  const isEditing = Boolean(notebook);

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (!next) onClose();
    }}>
      <DialogContent className="max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!trimmedName) return;
            onSubmit({ name: trimmedName, emoji: emoji.trim(), instructions });
          }}
        >
          <DialogHeader className="text-left">
            <DialogTitle>
              {isEditing ? t("notebooks.editTitle") : t("notebooks.newTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("notebooks.editDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-[auto_1fr] gap-3">
            <Input
              value={emoji}
              onChange={(event) => setEmoji(event.target.value.slice(0, 8))}
              placeholder={t("notebooks.emojiPlaceholder")}
              aria-label={t("notebooks.emoji")}
              className="w-16 text-center"
              maxLength={8}
            />
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("notebooks.namePlaceholder")}
              autoFocus
              maxLength={80}
            />
          </div>
          <Textarea
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder={t("notebooks.instructionsPlaceholder")}
            rows={5}
            maxLength={4000}
          />
          <DialogFooter className="flex items-center justify-between gap-2">
            {isEditing && onDelete ? (
              <Button
                type="button"
                variant="ghost"
                className="text-red-400 hover:text-red-300"
                onClick={() => onDelete(notebook!.id)}
              >
                {t("notebooks.delete")}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
              >
                {t("deleteConfirm.cancel")}
              </Button>
              <Button type="submit" disabled={!trimmedName}>
                {t("notebooks.save")}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
