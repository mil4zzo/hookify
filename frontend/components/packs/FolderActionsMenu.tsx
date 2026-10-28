"use client";

import React from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { IconFolderOpen, IconFolderPlus, IconLogout, IconPencil, IconRefresh, IconTrash, IconUsers } from "@tabler/icons-react";
import { canEditFolder, isOwnFolder } from "@/lib/utils/folderShares";
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
  /** Compartilhar a pasta inteira (subpastas e packs, de hoje e de depois). */
  onShare?: (folder: PackFolder) => void;
  /** Pessoas com quem a pasta (ou uma de cima) já está compartilhada. */
  sharedWith?: number;
  /**
   * Mover/desfazer: o dono, ou o editor da pasta de cima (a pasta compartilhada com o
   * usuário só o dono desfaz). Calculado pela página, que conhece a árvore.
   */
  canRestructure?: boolean;
  /** Sair de uma pasta compartilhada com o usuário (só na raiz do que ele vê). */
  onLeave?: (folder: PackFolder) => void;
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
  onShare,
  sharedWith = 0,
  canRestructure = true,
  onLeave,
  getPackActions,
}: FolderActionsMenuProps) {
  const noun = packCount === 1 ? "pack" : "packs";
  const packActions = getPackActions ? getPackActions(folder) : [];
  // Pasta compartilhada (181): convidar é do dono; editar, de quem edita; sair, de
  // quem recebeu (na pasta compartilhada com ele, não numa subpasta dela).
  const isOwn = isOwnFolder(folder);
  const canEdit = canEditFolder(folder);
  const canLeave = !isOwn && !!folder.shared_root && !!onLeave;

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
        {onShare && isOwn && (
          <DropdownMenuItem
            icon={<IconUsers />}
            description={sharedWith > 0 ? `Com ${sharedWith} ${sharedWith === 1 ? "pessoa" : "pessoas"}` : "Packs de hoje e de depois"}
            onClick={() => onShare(folder)}
          >
            Compartilhar pasta
          </DropdownMenuItem>
        )}
        {canEdit && (
          <>
            <DropdownMenuItem icon={<IconFolderPlus />} onClick={() => onCreateSubfolder(folder)}>
              Nova subpasta
            </DropdownMenuItem>
            <DropdownMenuItem icon={<IconPencil />} onClick={() => onRename(folder)}>
              Renomear
            </DropdownMenuItem>
          </>
        )}
        {/* Nada é apagado: o conteúdo sobe um nível (migration 174). */}
        {canRestructure && (
          <DropdownMenuItem
            icon={<IconTrash />}
            description="O conteúdo sobe um nível"
            onClick={() => onDelete(folder)}
            className="text-destructive focus:bg-destructive-10 focus:text-destructive"
          >
            Desfazer pasta
          </DropdownMenuItem>
        )}
        {canLeave && (
          <DropdownMenuItem
            icon={<IconLogout />}
            description={folder.owner_name ? `Compartilhada por ${folder.owner_name}` : "Você deixa de ver os packs dela"}
            onClick={() => onLeave!(folder)}
            className="text-destructive focus:bg-destructive-10 focus:text-destructive"
          >
            Sair da pasta
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
