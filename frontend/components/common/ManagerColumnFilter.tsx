"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { IconChevronDown } from "@tabler/icons-react";
import { FilterListPopover } from "@/components/common/FilterListPopover";
import { MANAGER_COLUMN_OPTIONS } from "@/components/manager/managerColumns";

export type ManagerColumnType =
  // Dimensões de procedência (texto) — ver isDimension em MANAGER_COLUMNS
  | "pack"
  | "account"
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
  | "video_watched_p75"
  | "leadscore_avg";

interface ManagerColumnFilterProps {
  activeColumns: Set<ManagerColumnType>;
  /** Ordem das colunas (todas, ativas ou não) — é a ordem da lista aqui e a da tabela. */
  columnOrder: readonly ManagerColumnType[];
  onToggleColumn: (columnId: ManagerColumnType) => void;
  /** Nova ordem após arrastar uma coluna na lista. */
  onReorderColumns: (columnOrder: ManagerColumnType[]) => void;
  /** Se true, a coluna não pode ser habilitada (mas pode ser desabilitada se já estiver selecionada) */
  isColumnDisabled?: (columnId: ManagerColumnType) => boolean;
  /** Bulk: seleciona todas as colunas habilitadas (mostra atalho "Selecionar todos") */
  onSelectAll?: () => void;
  /** Bulk: limpa a seleção (mostra atalho "Limpar") */
  onDeselectAll?: () => void;
  className?: string;
}

const COLUMN_NAME_BY_ID = new Map<ManagerColumnType, string>(MANAGER_COLUMN_OPTIONS.map((column) => [column.id, column.name]));

export function ManagerColumnFilter({ activeColumns, columnOrder, onToggleColumn, onReorderColumns, isColumnDisabled, onSelectAll, onDeselectAll, className }: ManagerColumnFilterProps) {
  const totalCount = MANAGER_COLUMN_OPTIONS.length;
  const selectedCount = activeColumns.size;

  const buttonText = selectedCount === 0 ? "Colunas (0)" : selectedCount === totalCount ? `Colunas (${totalCount})` : `Colunas (${selectedCount} de ${totalCount})`;

  const options = useMemo(
    () =>
      columnOrder.map((columnId) => ({
        id: columnId,
        label: COLUMN_NAME_BY_ID.get(columnId) ?? columnId,
        disabled: isColumnDisabled?.(columnId) ?? false,
        disabledHint: " (requer planilha)",
      })),
    [columnOrder, isColumnDisabled],
  );

  return (
    <div className={className || ""}>
      <FilterListPopover
        options={options}
        selectedIds={activeColumns}
        onSelect={(id) => onToggleColumn(id as ManagerColumnType)}
        reorderable
        onReorder={(orderedIds) => onReorderColumns(orderedIds as ManagerColumnType[])}
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
