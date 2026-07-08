"use client";

import { useEffect, useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconChevronDown, IconCheck } from "@tabler/icons-react";
import { cn } from "@/lib/utils/cn";
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
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Reseta a busca ao fechar o popover
  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const totalCount = MANAGER_COLUMN_OPTIONS.length;
  const selectedCount = activeColumns.size;

  const buttonText = useMemo(() => {
    if (selectedCount === 0) return "Colunas (0)";
    if (selectedCount === totalCount) return `Colunas (${totalCount})`;
    return `Colunas (${selectedCount} de ${totalCount})`;
  }, [selectedCount, totalCount]);

  // Busca client-side, mesmo padrão do PackFilter (aparece quando a lista fica longa)
  const normalizedSearch = search.trim().toLowerCase();
  const filteredColumns = useMemo(() => {
    if (!normalizedSearch) return MANAGER_COLUMN_OPTIONS;
    return MANAGER_COLUMN_OPTIONS.filter((column) => column.name.toLowerCase().includes(normalizedSearch));
  }, [normalizedSearch]);

  const showSearch = totalCount > 5;
  const showBulkActions = totalCount > 1 && (!!onSelectAll || !!onDeselectAll);

  return (
    <div className={className || ""}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between">
            <span className="truncate">{buttonText}</span>
            <IconChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0" align="end">
          {showSearch && (
            <div className="border-b border-border p-2">
              <Input
                placeholder="Buscar coluna..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (filteredColumns.length === 1) {
                      const column = filteredColumns[0];
                      const disabled = isColumnDisabled?.(column.id) ?? false;
                      if (!disabled || activeColumns.has(column.id)) {
                        onToggleColumn(column.id);
                        setSearch("");
                      }
                    }
                  }
                  if (e.key === "Escape") setOpen(false);
                }}
                onClick={(e) => e.stopPropagation()}
                autoFocus
              />
            </div>
          )}
          {showBulkActions && (
            <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5">
              <div className="flex items-center gap-2">
                {onSelectAll && (
                  <button
                    type="button"
                    onClick={onSelectAll}
                    disabled={selectedCount === totalCount}
                    className="text-xs font-medium text-text hover:underline disabled:pointer-events-none disabled:opacity-40"
                  >
                    Selecionar todos
                  </button>
                )}
                {onSelectAll && onDeselectAll && <span className="text-xs text-muted-foreground">·</span>}
                {onDeselectAll && (
                  <button
                    type="button"
                    onClick={onDeselectAll}
                    disabled={selectedCount === 0}
                    className="text-xs font-medium text-text hover:underline disabled:pointer-events-none disabled:opacity-40"
                  >
                    Limpar
                  </button>
                )}
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {selectedCount}/{totalCount}
              </span>
            </div>
          )}
          <div className="max-h-[320px] overflow-y-auto">
            {filteredColumns.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">Nenhuma coluna encontrada.</div>
            ) : (
              <div className="p-2">
                <div className="space-y-1">
                  {filteredColumns.map((column) => {
                    const isSelected = activeColumns.has(column.id);
                    const disabled = isColumnDisabled?.(column.id) ?? false;
                    // Regra: se estiver desabilitada (ex: falta integração), o usuário não pode ativar;
                    // mas se já estiver selecionada, pode desmarcar para limpar preferência.
                    const canToggle = !disabled || isSelected;
                    const showDisabledStyle = disabled && !isSelected;
                    return (
                      <div
                        key={column.id}
                        className={cn(
                          "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground",
                          isSelected && "bg-accent",
                          showDisabledStyle && "opacity-50 cursor-not-allowed hover:bg-transparent hover:text-inherit"
                        )}
                        onClick={() => {
                          if (!canToggle) return;
                          onToggleColumn(column.id);
                        }}
                      >
                        <div className="flex items-center space-x-2 flex-1 min-w-0">
                          <div className={cn("flex h-4 w-4 items-center justify-center rounded border border-border shrink-0", isSelected && "bg-primary border-primary")}>
                            {isSelected && <IconCheck className="h-3 w-3 text-primary-foreground" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="truncate text-sm">
                              {column.name}
                              {showDisabledStyle ? " (requer planilha)" : ""}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}


