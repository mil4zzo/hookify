"use client";

import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { IconChevronDown, IconCheck } from "@tabler/icons-react";
import { cn } from "@/lib/utils/cn";
import { MANAGER_COLUMN_OPTIONS } from "@/components/manager/managerColumns";

export type ManagerColumnType = "hook" | "cpr" | "cpmql" | "spend" | "ctr" | "website_ctr" | "cpm" | "connect_rate" | "page_conv" | "results" | "mqls";

interface ManagerColumnFilterProps {
  activeColumns: Set<ManagerColumnType>;
  onToggleColumn: (columnId: ManagerColumnType) => void;
  /** Se true, a coluna não pode ser habilitada (mas pode ser desabilitada se já estiver selecionada) */
  isColumnDisabled?: (columnId: ManagerColumnType) => boolean;
  className?: string;
}

export function ManagerColumnFilter({ activeColumns, onToggleColumn, isColumnDisabled, className }: ManagerColumnFilterProps) {
  const [open, setOpen] = useState(false);

  const totalCount = MANAGER_COLUMN_OPTIONS.length;
  const selectedCount = activeColumns.size;

  const buttonText = useMemo(() => {
    if (selectedCount === 0) return "Colunas (0)";
    if (selectedCount === totalCount) return `Colunas (${totalCount})`;
    return `Colunas (${selectedCount} de ${totalCount})`;
  }, [selectedCount, totalCount]);

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
          <div className="max-h-[320px] overflow-y-auto">
            <div className="p-2">
              <div className="space-y-1">
                {MANAGER_COLUMN_OPTIONS.map((column) => {
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
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}


