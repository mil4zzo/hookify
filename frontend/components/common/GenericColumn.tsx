"use client";

import React from "react";
import { cn } from "@/lib/utils/cn";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { IconInfoCircle } from "@tabler/icons-react";

export interface GenericColumnColorScheme {
  headerBg?: string;
  title?: string;
  card: {
    border: string;
    bg: string;
    text: string;
    accent: string;
    badge: string;
  };
}

export interface GenericColumnProps {
  title: string;
  items: Array<{
    [key: string]: any;
  }>;
  colorScheme: GenericColumnColorScheme;
  averageValue?: number | null;
  renderCard: (item: any, index: number, colorScheme: GenericColumnColorScheme) => React.ReactNode;
  emptyMessage?: string;
  showAverage?: boolean;
  className?: string;
  /** Elemento opcional para renderizar à direita no header (após a média) */
  headerRight?: React.ReactNode;
  /** Função opcional para formatar o valor médio (padrão: formata como porcentagem) */
  formatAverage?: (value: number | null | undefined) => string;
  /** Altura máxima para a área de conteúdo com scroll vertical (ex: "60vh"). Quando definida, o header fica fixo e apenas o conteúdo rola. */
  maxHeight?: string;
  /** Tooltip opcional para exibir ao lado do título */
  tooltip?: {
    title: string;
    /** Conteúdo opcional com hierarquia visual (ReactNode) */
    content?: React.ReactNode;
  };
}

/**
 * Componente genérico de coluna reutilizável, baseado na estrutura de GemsColumn.
 * Permite customização completa de cores, cards e comportamento.
 */
export function GenericColumn({ title, items, colorScheme, averageValue, renderCard, emptyMessage = "Nenhum item encontrado", showAverage = true, className, headerRight, formatAverage, maxHeight, tooltip }: GenericColumnProps) {
  // Função para formatar o valor médio (padrão: formata como porcentagem)
  const formatAverageValue =
    formatAverage ||
    ((value: number | null | undefined): string => {
      if (value == null || Number.isNaN(value) || !isFinite(value) || value <= 0) return "—";
      return `${(value * 100).toFixed(2)}%`;
    });

  return (
    <div className={cn("flex h-full flex-col gap-2 bg-card p-2 rounded-xl w-full", className)}>
      {/* Cabeçalho da coluna, seguindo o estilo do print (título forte, sem card ao redor) */}
      <div className="w-full flex items-center justify-between pr-2 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <h3 className={cn("text-base sm:text-md font-semibold text-white", colorScheme.title)}>🔹 {title}</h3>
          {tooltip && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="flex items-center justify-center rounded-md p-0.5 opacity-60 hover:opacity-100 hover:bg-muted-hover transition-colors">
                    <IconInfoCircle className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8} className="max-w-sm">
                  {tooltip.content ? (
                    <div className="space-y-2">{tooltip.content}</div>
                  ) : (
                    <p className="text-sm">{tooltip.title}</p>
                  )}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <div className="flex items-center gap-2">
          {showAverage && <span className="text-[11px] text-muted-foreground">Média: {formatAverageValue(averageValue)}</span>}
          {headerRight}
        </div>
      </div>
      <div className={cn("space-y-4", maxHeight && "overflow-y-auto flex-1 min-h-0")} style={maxHeight ? { maxHeight } : undefined}>
        {items.length === 0 ? <div className="rounded-xl border border-dashed border-border/60 bg-background/40 px-4 py-6 text-center text-sm text-muted-foreground">{emptyMessage}</div> : items.map((item, index) => renderCard(item, index, colorScheme))}
      </div>
    </div>
  );
}
