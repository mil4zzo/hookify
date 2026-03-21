"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { IconX } from "@tabler/icons-react";

export type TableSummaryItemLabel = "anúncios" | "conjuntos" | "campanhas";

export interface TableSummaryBarProps {
  filteredCount: number;
  totalCount: number;
  itemLabel: TableSummaryItemLabel;
  hasActiveFilters: boolean;
  onResetFilters: () => void;
}

/**
 * Barra flutuante fixa na parte inferior da tabela, independente do modo de visualização
 * (detalhada ou minimal). Exibe a contagem de itens exibidos e o botão de resetar filtros.
 */
export function TableSummaryBar({ filteredCount, totalCount, itemLabel, hasActiveFilters, onResetFilters }: TableSummaryBarProps) {
  return (
    <div className="sticky bottom-4 left-0 right-0 z-50 flex justify-center pointer-events-none mt-4">
      <div className="w-full bg-card border border-border shadow-lg pointer-events-auto rounded-lg">
        <div className="px-4 py-3">
          <div className="flex items-center justify-end gap-3">
            <div className="flex items-center text-sm text-muted-foreground">
              <span>
                Exibindo {filteredCount} de {totalCount} {itemLabel}
              </span>
            </div>
            {hasActiveFilters && (
              <Button variant="outline" size="sm" onClick={onResetFilters} className="h-8 text-xs text-text hover:text-destructive">
                <IconX className="w-4 h-4 mr-1.5" />
                Resetar filtros
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
