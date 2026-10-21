"use client";

import React from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { IconFolderOpen, IconFolderPlus, IconPencil, IconRefresh, IconTrash } from "@tabler/icons-react";
import type { PackFolder } from "@/lib/types";

export interface FolderActionsMenuProps {
  folder: PackFolder;
  /** Já inclui os packs das subpastas. */
  packCount: number;
  hasSubfolders?: boolean;
  /** O gatilho. Vira `DropdownMenuTrigger asChild` — o `⋯` do tile ou o da árvore. */
  children: React.ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  onOpenChange?: (open: boolean) => void;
  onOpen: (folderId: string) => void;
  onRename: (folder: PackFolder) => void;
  onDelete: (folder: PackFolder) => void;
  onRefreshAll: (folder: PackFolder) => void;
  onCreateSubfolder: (folder: PackFolder) => void;
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
  hasSubfolders = false,
  children,
  align = "end",
  side,
  onOpenChange,
  onOpen,
  onRename,
  onDelete,
  onRefreshAll,
  onCreateSubfolder,
}: FolderActionsMenuProps) {
  const noun = packCount === 1 ? "pack" : "packs";

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} side={side} className="w-60">
        <DropdownMenuItem icon={<IconFolderOpen />} onClick={() => onOpen(folder.id)}>
          Abrir
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          icon={<IconRefresh />}
          description={`${packCount} ${noun} ${hasSubfolders ? "com as subpastas" : "desta pasta"}`}
          onClick={() => onRefreshAll(folder)}
          disabled={packCount === 0}
        >
          Atualizar todos
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<IconFolderPlus />} onClick={() => onCreateSubfolder(folder)}>
          Nova subpasta
        </DropdownMenuItem>
        <DropdownMenuItem icon={<IconPencil />} onClick={() => onRename(folder)}>
          Renomear
        </DropdownMenuItem>
        {/* Nada é apagado: o conteúdo sobe um nível (migration 174). */}
        <DropdownMenuItem
          icon={<IconTrash />}
          description="O conteúdo sobe um nível"
          onClick={() => onDelete(folder)}
          className="text-destructive focus:bg-destructive-10 focus:text-destructive"
        >
          Desfazer pasta
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
