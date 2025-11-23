"use client";

import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { IconChevronDown, IconFilter } from "@tabler/icons-react";
import { DateRangeFilter } from "@/components/common/DateRangeFilter";
import { ActionTypeFilter } from "@/components/common/ActionTypeFilter";
import { PackFilter } from "@/components/common/PackFilter";
import { DateRangeValue } from "@/components/common/DateRangeFilter";
import { Switch } from "@/components/ui/switch";

interface Pack {
  id: string;
  name: string;
  ads?: any[];
  stats?: {
    totalAds?: number;
    uniqueAds?: number;
    uniqueCampaigns?: number;
    uniqueAdsets?: number;
    totalSpend?: number;
  };
}

export interface FiltersDropdownProps {
  dateRange: DateRangeValue;
  onDateRangeChange: (value: DateRangeValue) => void;
  actionType: string;
  onActionTypeChange: (value: string) => void;
  actionTypeOptions: string[];
  packs: Pack[];
  selectedPackIds: Set<string>;
  onTogglePack: (packId: string) => void;
  packsClient: boolean;
  usePackDates?: boolean;
  onUsePackDatesChange?: (checked: boolean) => void;
  dateRangeLabel?: string;
  dateRangeRequireConfirmation?: boolean;
  dateRangeDisabled?: boolean;
}

/**
 * Componente reutilizável de dropdown de filtros.
 * Agrupa os filtros de Período, Evento de Conversão e Packs em um menu compacto.
 * 
 * @example
 * <FiltersDropdown
 *   dateRange={dateRange}
 *   onDateRangeChange={handleDateRangeChange}
 *   actionType={actionType}
 *   onActionTypeChange={handleActionTypeChange}
 *   actionTypeOptions={uniqueConversionTypes}
 *   packs={packs}
 *   selectedPackIds={selectedPackIds}
 *   onTogglePack={handleTogglePack}
 *   packsClient={packsClient}
 *   usePackDates={usePackDates}
 *   onUsePackDatesChange={handleUsePackDatesChange}
 * />
 */
export function FiltersDropdown({
  dateRange,
  onDateRangeChange,
  actionType,
  onActionTypeChange,
  actionTypeOptions,
  packs,
  selectedPackIds,
  onTogglePack,
  packsClient,
  usePackDates = false,
  onUsePackDatesChange,
  dateRangeLabel = "Período",
  dateRangeRequireConfirmation = true,
  dateRangeDisabled = false,
}: FiltersDropdownProps) {
  const [open, setOpen] = useState(false);

  // Contar quantos filtros estão ativos
  const getActiveFiltersCount = () => {
    let count = 0;
    if (dateRange.start && dateRange.end) count++;
    if (actionType) count++;
    if (selectedPackIds.size > 0) count++;
    return count;
  };

  const activeFiltersCount = getActiveFiltersCount();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full sm:w-auto">
          <IconFilter className="h-4 w-4" />
          <span>Filtros</span>
          {activeFiltersCount > 0 && (
            <span className="ml-1 rounded-full bg-primary text-primary-foreground text-xs px-2 py-0.5">
              {activeFiltersCount}
            </span>
          )}
          <IconChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-4" align="start">
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold mb-3">Filtros</h3>
          </div>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <DateRangeFilter
                label={dateRangeLabel}
                value={dateRange}
                onChange={onDateRangeChange}
                requireConfirmation={dateRangeRequireConfirmation}
                disabled={dateRangeDisabled || usePackDates}
              />
              {packsClient && packs.length > 0 && selectedPackIds.size > 0 && onUsePackDatesChange && (
                <div className="flex items-center gap-2 p-2 bg-card border border-border rounded-md">
                  <Switch
                    id="use-pack-dates"
                    checked={usePackDates}
                    onCheckedChange={onUsePackDatesChange}
                  />
                  <label
                    htmlFor="use-pack-dates"
                    className="text-sm font-medium cursor-pointer"
                  >
                    Usar datas dos packs
                  </label>
                </div>
              )}
            </div>
            
            <ActionTypeFilter
              label="Evento de Conversão"
              value={actionType}
              onChange={onActionTypeChange}
              options={actionTypeOptions}
            />
            
            {packsClient && packs.length > 0 && (
              <PackFilter
                packs={packs}
                selectedPackIds={selectedPackIds}
                onTogglePack={onTogglePack}
              />
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

