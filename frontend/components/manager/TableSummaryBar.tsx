"use client";

import React from "react";
import { useTranslations } from "next-intl";
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
const ITEM_KIND: Record<TableSummaryItemLabel, string> = { "anúncios": "ads", "conjuntos": "adsets", "campanhas": "campaigns" };

export function TableSummaryBar({ filteredCount, totalCount, itemLabel, hasActiveFilters, onResetFilters }: TableSummaryBarProps) {
  const t = useTranslations("manager.summaryBar");
  return (
    <div className="mt-4 flex justify-center">
      <div className="w-full rounded-lg border border-border bg-card shadow-elevation-overlay">
        <div className="px-4 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
            <div className="flex items-center text-sm text-muted-foreground">
              <span>{t("showing", { kind: ITEM_KIND[itemLabel], filtered: filteredCount, total: totalCount })}</span>
            </div>
            {hasActiveFilters && (
              <Button variant="outline" size="sm" onClick={onResetFilters} className="text-xs text-foreground hover:text-destructive">
                <IconX className="w-4 h-4 mr-1.5" />
                {t("reset")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
