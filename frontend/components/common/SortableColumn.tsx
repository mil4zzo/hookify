"use client";

import { ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { IconGripVertical, IconSearch } from "@tabler/icons-react";
import { GenericColumn, GenericColumnColorScheme } from "./GenericColumn";
import { Input } from "@/components/ui/input";

/**
 * Props para uma coluna sortable genérica
 */
export interface SortableColumnProps {
  id: string;
  title: string;
  items: any[];
  colorScheme: GenericColumnColorScheme;
  emptyMessage?: string;
  averageValue?: number | null;
  renderCard: (item: any, cardIndex: number, colorScheme: GenericColumnColorScheme) => React.ReactNode;
  formatAverage?: (value: number | null | undefined) => string;
  showSearch?: boolean;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  maxHeight?: string;
  /** Tooltip opcional para o header */
  tooltip?: {
    title: string;
    content?: React.ReactNode;
  };
  headerRight?: ReactNode;
  /** Habilitar drag (padrão: true) */
  enableDrag?: boolean;
}

/**
 * Componente de coluna arrastável genérico.
 * Pode ser usado com qualquer tipo de coluna que use GenericColumn.
 */
export function SortableColumn({ id, title, items, colorScheme, emptyMessage = "Nenhum item encontrado", averageValue, renderCard, formatAverage, showSearch = false, searchValue = "", onSearchChange, searchPlaceholder = "Pesquisar", maxHeight, tooltip, headerRight, enableDrag = true }: SortableColumnProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  // Normalizar transform: manter apenas translate, forçando escala 1 para evitar deformação vertical
  // O dnd-kit aplica scaleY automaticamente quando há diferença de altura entre itens,
  // mas isso causa deformação visual. Forçamos scaleX=1 e scaleY=1 para manter proporções.
  const normalizedTransform = transform ? { ...transform, scaleX: 1, scaleY: 1 } : null;

  const style = {
    transform: normalizedTransform ? CSS.Transform.toString(normalizedTransform) : undefined,
    transition,
  };

  const dragHandle = enableDrag ? (
    <button type="button" {...attributes} {...listeners} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted-hover cursor-grab active:cursor-grabbing transition-colors" title="Arraste para reordenar" aria-label="Arraste para reordenar">
      <IconGripVertical className="h-4 w-4" />
    </button>
  ) : null;

  const headerContent = showSearch ? (
    <div className="relative">
      <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={searchValue} onChange={(event) => onSearchChange?.(event.target.value)} placeholder={searchPlaceholder} className="pl-9" />
    </div>
  ) : null;

  return (
    <div ref={setNodeRef} style={style} className={`w-full h-full ${isDragging ? "z-50 opacity-60" : ""}`}>
      <GenericColumn
        title={title}
        items={items}
        colorScheme={colorScheme}
        averageValue={averageValue}
        emptyMessage={emptyMessage}
        renderCard={renderCard}
        formatAverage={formatAverage}
        headerContent={headerContent}
        maxHeight={maxHeight}
        tooltip={tooltip}
        headerRight={
          <div className="flex items-center gap-1">
            {headerRight}
            {dragHandle}
          </div>
        }
      />
    </div>
  );
}
