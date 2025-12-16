"use client";

import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { IconChevronDown, IconCheck } from "@tabler/icons-react";
import { cn } from "@/lib/utils/cn";

export type GemsColumnType = "hook" | "website_ctr" | "ctr" | "page_conv" | "hold_rate" | "cpr";

interface GemsColumn {
  id: GemsColumnType;
  name: string;
}

const GEMS_COLUMNS: GemsColumn[] = [
  { id: "hook", name: "Hooks" },
  { id: "website_ctr", name: "Website CTR" },
  { id: "ctr", name: "CTR" },
  { id: "page_conv", name: "Page" },
  { id: "hold_rate", name: "Hold Rate" },
  { id: "cpr", name: "CPR" },
];

interface GemsColumnFilterProps {
  activeColumns: Set<GemsColumnType>;
  onToggleColumn: (columnId: GemsColumnType) => void;
  className?: string;
}

export function GemsColumnFilter({ activeColumns, onToggleColumn, className }: GemsColumnFilterProps) {
  const [open, setOpen] = useState(false);

  const selectedCount = activeColumns.size;
  const totalCount = GEMS_COLUMNS.length;

  // Texto para o botão
  const getButtonText = () => {
    if (selectedCount === 0) {
      return "Métricas (0)";
    }
    if (selectedCount === totalCount) {
      return `Métricas (${totalCount})`;
    }
    return `Métricas (${selectedCount} de ${totalCount})`;
  };

  return (
    <div className={className || ""}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between">
            <span className="truncate">{getButtonText()}</span>
            <IconChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0" align="start">
          <div className="max-h-[300px] overflow-y-auto">
            <div className="p-2">
              <div className="space-y-1">
                {GEMS_COLUMNS.map((column) => {
                  const isSelected = activeColumns.has(column.id);

                  return (
                    <div key={column.id} className={cn("relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground", isSelected && "bg-accent")} onClick={() => onToggleColumn(column.id)}>
                      <div className="flex items-center space-x-2 flex-1 min-w-0">
                        <div className={cn("flex h-4 w-4 items-center justify-center rounded border border-border shrink-0", isSelected && "bg-primary border-primary")}>{isSelected && <IconCheck className="h-3 w-3 text-primary-foreground" />}</div>
                        <div className="flex-1 min-w-0">
                          <span className="truncate text-sm">{column.name}</span>
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
