"use client";

import { ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { IconGripVertical, IconInfoCircle } from "@tabler/icons-react";
import { GenericColumn, GenericColumnColorScheme } from "./GenericColumn";

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
  /** Tooltip opcional para o header */
  tooltip?: {
    title: string;
  };
  /** Habilitar drag (padrão: true) */
  enableDrag?: boolean;
}

/**
 * Componente de coluna arrastável genérico.
 * Pode ser usado com qualquer tipo de coluna que use GenericColumn.
 */
export function SortableColumn({ id, title, items, colorScheme, emptyMessage = "Nenhum item encontrado", averageValue, renderCard, formatAverage, tooltip, enableDrag = true }: SortableColumnProps) {
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
    <button type="button" {...attributes} {...listeners} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 cursor-grab active:cursor-grabbing transition-colors" title="Arraste para reordenar" aria-label="Arraste para reordenar">
      <IconGripVertical className="h-4 w-4" />
    </button>
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
        headerRight={
          <div className="flex items-center gap-1">
            {tooltip && (
              <button type="button" className="flex items-center justify-center rounded-md p-1 opacity-60 hover:opacity-100 hover:bg-muted/50 transition-colors" title={tooltip.title}>
                <IconInfoCircle className="h-4 w-4 text-muted-foreground hover:text-foreground" />
              </button>
            )}
            {dragHandle}
          </div>
        }
      />
    </div>
  );
}
