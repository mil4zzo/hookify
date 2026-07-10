"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { IconChevronDown } from "@tabler/icons-react";
import { FilterListPopover } from "@/components/common/FilterListPopover";
import { MANAGER_COLUMN_OPTIONS } from "@/components/manager/managerColumns";

export type ManagerColumnType =
  | "hook"
  | "cpr"
  | "cpc"
  | "cplc"
  | "cpmql"
  | "spend"
  | "impressions"
  | "clicks"
  | "reach"
  | "frequency"
  | "ctr"
  | "website_ctr"
  | "cpm"
  | "connect_rate"
  | "page_conv"
  | "results"
  | "mqls"
  | "lpv"
  | "plays"
  | "thruplays"
  | "scroll_stop"
  | "hold_rate"
  | "video_watched_p50"
  | "video_watched_p75";

interface ManagerColumnFilterProps {
  activeColumns: Set<ManagerColumnType>;
  onToggleColumn: (columnId: ManagerColumnType) => void;
  /** Se true, a coluna não pode ser habilitada (mas pode ser desabilitada se já estiver selecionada) */
  isColumnDisabled?: (columnId: ManagerColumnType) => boolean;
  /** Bulk: seleciona todas as colunas habilitadas (mostra atalho "Selecionar todos") */
  onSelectAll?: () => void;
  /** Bulk: limpa a seleção (mostra atalho "Limpar") */
  onDeselectAll?: () => void;
  className?: string;
}

export function ManagerColumnFilter({ activeColumns, onToggleColumn, isColumnDisabled, onSelectAll, onDeselectAll, className }: ManagerColumnFilterProps) {
  const totalCount = MANAGER_COLUMN_OPTIONS.length;
  const selectedCount = activeColumns.size;

  const buttonText = selectedCount === 0 ? "Colunas (0)" : selectedCount === totalCount ? `Colunas (${totalCount})` : `Colunas (${selectedCount} de ${totalCount})`;

  const options = useMemo(
    () =>
      MANAGER_COLUMN_OPTIONS.map((column) => ({
        id: column.id,
        label: column.name,
        disabled: isColumnDisabled?.(column.id) ?? false,
        disabledHint: " (requer planilha)",
      })),
    [isColumnDisabled],
  );

  return (
    <div className={className || ""}>
      <FilterListPopover
        options={options}
        selectedIds={activeColumns}
        onSelect={(id) => onToggleColumn(id as ManagerColumnType)}
        searchable={totalCount > 5}
        searchPlaceholder="Buscar coluna..."
        emptyMessage="Nenhuma coluna encontrada."
        onSelectAll={onSelectAll}
        onDeselectAll={onDeselectAll}
        align="end"
        trigger={
          <Button variant="outline" role="combobox" className="w-full justify-between">
            <span className="truncate">{buttonText}</span>
            <IconChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        }
      />
    </div>
  );
}
