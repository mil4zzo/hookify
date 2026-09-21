"use client";

import React from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { IconFolderOpen, IconPencil, IconRefresh, IconTrash } from "@tabler/icons-react";
import type { PackFolder } from "@/lib/types";

export interface FolderActionsMenuProps {
  folder: PackFolder;
  packCount: number;
  /** O gatilho. Vira `DropdownMenuTrigger asChild` — o `⋯` do tile ou o da árvore. */
  children: React.ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  onOpenChange?: (open: boolean) => void;
  onOpen: (folderId: string) => void;
  onRename: (folder: PackFolder) => void;
  onDelete: (folder: PackFolder) => void;
  onRefreshAll: (folder: PackFolder) => void;
}

/**
 * Menu de ações de uma pasta, com o gatilho de quem chamar.
 *
 * "Atualizar todos" age sobre TODOS os packs da pasta — é a única ação em massa
 * que existe hoje aqui; compartilhar e transcrever em lote são do Lote 1 e ainda
 * não têm o diálogo agregado.
 *
 * Vive separado do `FolderCard` porque a árvore da Biblioteca precisa do mesmo
 * menu. Duplicar faria as duas divergirem no primeiro item novo — o mesmo motivo
 * que levou o menu do pack para `PackActionsMenu`.
 */
export function FolderActionsMenu({
  folder,
  packCount,
  children,
  align = "end",
  side,
  onOpenChange,
  onOpen,
  onRename,
  onDelete,
  onRefreshAll,
}: FolderActionsMenuProps) {
  const noun = packCount === 1 ? "pack" : "packs";

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} side={side} className="w-60">
        <DropdownMenuItem onClick={() => onOpen(folder.id)}>
          <IconFolderOpen className="h-4 w-4" />
          Abrir
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onRefreshAll(folder)} disabled={packCount === 0}>
          <IconRefresh className="h-4 w-4" />
          <div className="flex flex-col items-start">
            <span>Atualizar todos</span>
            <span className="text-2xs text-muted-foreground">
              {packCount} {noun} desta pasta
            </span>
          </div>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onRename(folder)}>
          <IconPencil className="h-4 w-4" />
          Renomear
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onDelete(folder)} className="text-destructive focus:bg-destructive-10 focus:text-destructive">
          <IconTrash className="h-4 w-4" />
          <div className="flex flex-col items-start">
            <span>Desfazer pasta</span>
            <span className="text-2xs text-muted-foreground">Os packs não são apagados</span>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
