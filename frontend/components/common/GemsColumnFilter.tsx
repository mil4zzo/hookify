"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { IconChevronDown } from "@tabler/icons-react";
import { FilterListPopover } from "@/components/common/FilterListPopover";

export type GemsColumnType = "hook" | "website_ctr" | "ctr" | "page_conv" | "hold_rate" | "cpr" | "cpmql";

const GEMS_COLUMNS: { id: GemsColumnType; name: string }[] = [
  { id: "hook", name: "Hooks" },
  { id: "website_ctr", name: "Website CTR" },
  { id: "ctr", name: "CTR" },
  { id: "page_conv", name: "Page" },
  { id: "hold_rate", name: "Hold Rate" },
  { id: "cpr", name: "CPR" },
  { id: "cpmql", name: "CPMQL" },
];

interface GemsColumnFilterProps {
  activeColumns: Set<GemsColumnType>;
  onToggleColumn: (columnId: GemsColumnType) => void;
  className?: string;
}

export function GemsColumnFilter({ activeColumns, onToggleColumn, className }: GemsColumnFilterProps) {
  const selectedCount = activeColumns.size;
  const totalCount = GEMS_COLUMNS.length;

  const buttonText = selectedCount === 0 ? "Métricas (0)" : selectedCount === totalCount ? `Métricas (${totalCount})` : `Métricas (${selectedCount} de ${totalCount})`;

  const options = useMemo(() => GEMS_COLUMNS.map((column) => ({ id: column.id, label: column.name })), []);

  return (
    <div className={className || ""}>
      <FilterListPopover
        options={options}
        selectedIds={activeColumns}
        onSelect={(id) => onToggleColumn(id as GemsColumnType)}
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
