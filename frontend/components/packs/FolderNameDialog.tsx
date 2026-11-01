"use client";

import { useTranslations } from "next-intl";
import React, { useEffect, useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface FolderNameDialogProps {
  isOpen: boolean;
  mode: "create" | "rename";
  initialName?: string;
  /** Quantos packs vão junto ao criar — muda a copy do botão e do subtítulo. */
  packCount?: number;
  /** Nomes já usados NO MESMO NÍVEL, para avisar antes. */
  existingNames?: string[];
  /** Criando dentro de outra pasta: o nome dela, para dizer onde a nova vai nascer. */
  parentName?: string | null;
  onClose: () => void;
  onConfirm: (name: string) => void;
}

const MAX_NAME_LEN = 60; // espelha o CHECK folders_name_max_len da migration 168

export function FolderNameDialog({ isOpen, mode, initialName = "", packCount = 0, existingNames = [], parentName = null, onClose, onConfirm }: FolderNameDialogProps) {
  const t = useTranslations("packs.folderName");
  const tc = useTranslations("packs.common");
  const [name, setName] = useState(initialName);

  useEffect(() => {
    if (isOpen) setName(initialName);
  }, [isOpen, initialName]);

  const trimmed = name.trim();
  const isDuplicate = trimmed.length > 0 && trimmed.toLocaleLowerCase("pt-BR") !== initialName.trim().toLocaleLowerCase("pt-BR") && existingNames.some((n) => n.toLocaleLowerCase("pt-BR") === trimmed.toLocaleLowerCase("pt-BR"));
  const canSubmit = trimmed.length > 0 && trimmed.length <= MAX_NAME_LEN && !isDuplicate;

  const submit = () => {
    if (!canSubmit) return;
    onConfirm(trimmed);
    onClose();
  };

  const isCreate = mode === "create";
  const parentValues = { hasParent: parentName ? "yes" : "no", parent: parentName ?? "" };
  const subtitle = isCreate
    ? packCount > 0
      ? t("subtitleCreateWithPacks", { ...parentValues, count: packCount })
      : t("subtitleCreateEmpty", parentValues)
    : t("subtitleRename");

  return (
    <AppDialog isOpen={isOpen} onClose={onClose} title={isCreate ? t("titleCreate") : t("titleRename")} size="sm" padding="md" closeOnOverlayClick closeOnEscape showCloseButton>
      <div className="flex flex-col gap-6">
        {/* O `title` do AppDialog é só para leitor de tela — o título visível é este. */}
        <header className="space-y-1">
          <h2 className="text-lg font-semibold text-foreground">{isCreate ? (parentName ? t("titleSubfolder") : t("titleCreate")) : t("titleRename")}</h2>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </header>

        <div className="flex flex-col gap-2">
          <label htmlFor="folder-name" className="text-xs font-medium text-foreground">
            {t("nameLabel")}
          </label>
          <Input
            id="folder-name"
            value={name}
            autoFocus
            maxLength={MAX_NAME_LEN}
            placeholder={t("placeholder")}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            aria-invalid={isDuplicate}
          />
          {isDuplicate && <span className="text-xs text-destructive">{t("duplicate")}</span>}
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {isCreate ? (packCount > 0 ? t("createAndMove", { count: packCount }) : t("createFolder")) : tc("save")}
          </Button>
        </div>
      </div>
    </AppDialog>
  );
}
