"use client";

import React, { useState } from "react";
import { IconDots } from "@tabler/icons-react";
import { FolderActionsMenu } from "./FolderActionsMenu";
import { FolderGlyph } from "./FolderGlyph";
import { cn } from "@/lib/utils/cn";
import type { PackFolder } from "@/lib/types";

export interface FolderCardProps {
  folder: PackFolder;
  packCount: number;
  totalSpend: number;
  hasSheet: boolean;
  hasShared: boolean;
  isCurrent?: boolean;
  /** Packs estão sendo arrastados sobre esta pasta. */
  isDropTarget?: boolean;
  formatCurrency: (value: number) => string;
  onOpen: (folderId: string) => void;
  onRename: (folder: PackFolder) => void;
  onDelete: (folder: PackFolder) => void;
  onRefreshAll: (folder: PackFolder) => void;
  onDropPacks: (folderId: string) => void;
  onDragStateChange: (folderId: string | null) => void;
}

/**
 * Tile de pasta, no padrão de gerenciador de arquivos: sem borda e transparente
 * em repouso, o fundo acendendo no hover. O tile inteiro é o alvo — se o fundo
 * todo acende, o clique todo responde.
 *
 * O `⋯` é irmão do botão, não filho: botão dentro de botão é HTML inválido e o
 * clique no menu acabaria navegando para a pasta.
 */
export function FolderCard({
  folder,
  packCount,
  totalSpend,
  hasSheet,
  hasShared,
  isCurrent = false,
  isDropTarget = false,
  formatCurrency,
  onOpen,
  onRename,
  onDelete,
  onRefreshAll,
  onDropPacks,
  onDragStateChange,
}: FolderCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const noun = packCount === 1 ? "pack" : "packs";

  return (
    <div
      className="group/folder relative"
      onDragOver={(e) => {
        // Sem preventDefault o navegador recusa o drop e o cursor fica "proibido".
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onDragStateChange(folder.id);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onDragStateChange(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDragStateChange(null);
        onDropPacks(folder.id);
      }}
    >
      <button
        type="button"
        onClick={() => onOpen(folder.id)}
        aria-label={`Abrir pasta ${folder.name}`}
        className={cn(
          "folder-tile focus-inset flex w-full flex-col items-center gap-2 rounded-lg px-1.5 pb-2.5 pt-2 text-center transition-colors",
          // Neutro, como a árvore. O azul do alvo de arrasto fica no contorno da
          // lombada (FolderGlyph), não no fundo do tile.
          // `menuOpen` entra junto: com o menu aberto o ponteiro saiu do tile, e sem
          // isto não sobra marca de qual pasta teve o menu aberto.
          (isDropTarget || isCurrent || menuOpen) && "bg-surface",
        )}
      >
        <FolderGlyph hasSheet={hasSheet} hasShared={hasShared} isDropTarget={isDropTarget} isCurrent={isCurrent} />
        <span className="flex w-full min-w-0 flex-col gap-0.5 px-1">
          <span className="truncate text-sm font-semibold text-foreground">{folder.name}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {packCount} {noun} · {formatCurrency(totalSpend)}
          </span>
        </span>
      </button>

      <FolderActionsMenu
        folder={folder}
        packCount={packCount}
        onOpenChange={setMenuOpen}
        onOpen={onOpen}
        onRename={onRename}
        onDelete={onDelete}
        onRefreshAll={onRefreshAll}
      >
        <button
          type="button"
          aria-label={`Ações da pasta ${folder.name}`}
          className={cn(
            "focus-inset absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/folder:opacity-100",
            menuOpen && "opacity-100",
          )}
        >
          <IconDots className="h-4 w-4" />
        </button>
      </FolderActionsMenu>
    </div>
  );
}
