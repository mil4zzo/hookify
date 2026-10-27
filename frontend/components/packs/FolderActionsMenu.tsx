"use client";

import React from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { IconFolderOpen, IconFolderPlus, IconPencil, IconRefresh, IconTrash } from "@tabler/icons-react";
import type { PackFolder } from "@/lib/types";

/** Ação em massa sobre TODOS os packs da pasta (com as subpastas), montada pela página. */
export interface FolderPackAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  description?: string;
  disabled?: boolean;
  destructive?: boolean;
  onSelect: () => void;
}

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
  /**
   * As mesmas ações da barra de seleção, sobre os packs da pasta e de todas as
   * subpastas. Função (e não lista) para só montar quando o menu abre.
   */
  getPackActions?: (folder: PackFolder) => FolderPackAction[];
}

/**
 * Menu de ações de uma pasta, com o gatilho de quem chamar.
 *
 * As ações em massa ("Atualizar todos" e as de `getPackActions`) agem sobre TODOS
 * os packs da pasta e das subpastas, recursivamente: aplicar na pasta mãe é aplicar
 * em tudo que está debaixo dela. O rótulo do grupo diz isso com o número.
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
  getPackActions,
}: FolderActionsMenuProps) {
  const noun = packCount === 1 ? "pack" : "packs";
  const packActions = getPackActions ? getPackActions(folder) : [];

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} side={side} className="w-60">
        <DropdownMenuItem icon={<IconFolderOpen />} onClick={() => onOpen(folder.id)}>
          Abrir
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
          {packCount} {noun} {hasSubfolders ? "com as subpastas" : "desta pasta"}
        </DropdownMenuLabel>
        <DropdownMenuItem icon={<IconRefresh />} onClick={() => onRefreshAll(folder)} disabled={packCount === 0}>
          Atualizar todos
        </DropdownMenuItem>
        {packActions.map((action) => (
          <DropdownMenuItem
            key={action.id}
            icon={action.icon}
            description={action.description}
            onClick={action.onSelect}
            disabled={packCount === 0 || action.disabled}
            className={action.destructive ? "text-destructive focus:bg-destructive-10 focus:text-destructive" : undefined}
          >
            {action.label}
          </DropdownMenuItem>
        ))}
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
