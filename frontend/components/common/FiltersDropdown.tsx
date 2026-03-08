"use client";

import { useState, useCallback } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { IconChevronDown, IconFilter } from "@tabler/icons-react";
import { DateRangeFilter } from "@/components/common/DateRangeFilter";
import { ActionTypeFilter } from "@/components/common/ActionTypeFilter";
import { PackFilter } from "@/components/common/PackFilter";
import { DateRangeValue } from "@/components/common/DateRangeFilter";

interface Pack {
  id: string;
  name: string;
  ads: any[];
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
  disableFutureDates?: boolean; // Se true (padrão), desabilita seleção de datas futuras no calendário
  expanded?: boolean;
  packDatesRange?: DateRangeValue | null; // Datas dos packs para selecionar no calendário quando switch for ativado. null = sem dados disponíveis, undefined = aguardando dados
  groupByPacks?: boolean; // Se true, agrupa por packs
  onGroupByPacksChange?: (checked: boolean) => void; // Handler para mudança do switch
  singlePackSelect?: boolean; // Se true (padrão), apenas um pack pode ser selecionado. Se false, permite multi-select.
  onSetSinglePack?: (packId: string) => void; // Handler atômico para single-select (evita race condition de múltiplos toggles)
}

/**
 * Componente reutilizável de dropdown de filtros.
 * Agrupa os filtros de Período, Evento de Conversão e Packs em um menu compacto.
 *
 * @param expanded - Se true, renderiza os filtros horizontalmente lado a lado.
 *                   Se false (padrão), renderiza em um menu collapsado (Popover).
 *
 * @example
 * // Modo collapsado (padrão)
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
 *
 * @example
 * // Modo expandido (horizontal)
 * <FiltersDropdown
 *   expanded={true}
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
export function FiltersDropdown({ dateRange, onDateRangeChange, actionType, onActionTypeChange, actionTypeOptions, packs, selectedPackIds, onTogglePack, packsClient, usePackDates = false, onUsePackDatesChange, dateRangeLabel = "Período", dateRangeRequireConfirmation = true, dateRangeDisabled = false, disableFutureDates = true, expanded = false, packDatesRange, groupByPacks = false, onGroupByPacksChange, singlePackSelect = true, onSetSinglePack }: FiltersDropdownProps) {
  const [open, setOpen] = useState(false);

  // Wrapper para onTogglePack que garante single-select
  // Prefere onSetSinglePack (operação atômica) quando disponível para evitar race condition
  const handleSingleSelectPack = useCallback(
    (packId: string) => {
      if (onSetSinglePack) {
        onSetSinglePack(packId);
        return;
      }
      // Fallback: múltiplos toggles (pode ter race condition com localStorage)
      if (selectedPackIds.has(packId)) {
        onTogglePack(packId);
      } else {
        const otherPackIds = Array.from(selectedPackIds).filter((id) => id !== packId);
        otherPackIds.forEach((id) => {
          onTogglePack(id);
        });
        onTogglePack(packId);
      }
    },
    [selectedPackIds, onTogglePack, onSetSinglePack],
  );

  // Contar quantos filtros estão ativos
  const getActiveFiltersCount = () => {
    let count = 0;
    if (dateRange.start && dateRange.end) count++;
    if (actionType) count++;
    if (selectedPackIds.size > 0) count++;
    return count;
  };

  const activeFiltersCount = getActiveFiltersCount();

  // Conteúdo dos filtros para modo collapsado (vertical)
  const filtersContentCollapsed = (
    <>
      <div className="space-y-2">
        <DateRangeFilter label={dateRangeLabel} value={dateRange} onChange={onDateRangeChange} requireConfirmation={dateRangeRequireConfirmation} disabled={dateRangeDisabled} disableFutureDates={disableFutureDates} usePackDates={usePackDates} onUsePackDatesChange={packsClient && packs.length > 0 && selectedPackIds.size > 0 ? onUsePackDatesChange : undefined} showPackDatesSwitch={packsClient && packs.length > 0 && selectedPackIds.size > 0 && !!onUsePackDatesChange} packDatesRange={packDatesRange} />
      </div>

      <ActionTypeFilter label="Evento de Conversão" value={actionType} onChange={onActionTypeChange} options={actionTypeOptions} isLoading={actionTypeOptions.length === 0} />

      {packsClient && <PackFilter packs={packs} selectedPackIds={selectedPackIds} onTogglePack={singlePackSelect ? handleSingleSelectPack : onTogglePack} isLoading={packs.length === 0} packsClient={packsClient} groupByPacks={groupByPacks} onGroupByPacksChange={onGroupByPacksChange} showGroupByPacksSwitch={packs.length > 0 && selectedPackIds.size > 0 && !!onGroupByPacksChange} singleSelect={singlePackSelect} />}
    </>
  );

  // Conteúdo dos filtros para modo expandido (horizontal)
  const filtersContentExpanded = (
    <>
      {packsClient && (
        <div className="flex flex-col min-w-[200px]">
          <PackFilter packs={packs} selectedPackIds={selectedPackIds} onTogglePack={singlePackSelect ? handleSingleSelectPack : onTogglePack} showLabel={false} isLoading={packs.length === 0} packsClient={packsClient} groupByPacks={groupByPacks} onGroupByPacksChange={onGroupByPacksChange} showGroupByPacksSwitch={packs.length > 0 && selectedPackIds.size > 0 && !!onGroupByPacksChange} singleSelect={singlePackSelect} />
        </div>
      )}

      <div className="flex flex-col min-w-[200px]">
        <ActionTypeFilter label="" value={actionType} onChange={onActionTypeChange} options={actionTypeOptions} isLoading={actionTypeOptions.length === 0} />
      </div>

      <div className="flex flex-col min-w-[200px]">
        <DateRangeFilter label={dateRangeLabel} showLabel={false} value={dateRange} onChange={onDateRangeChange} requireConfirmation={dateRangeRequireConfirmation} disabled={dateRangeDisabled} disableFutureDates={disableFutureDates} usePackDates={usePackDates} onUsePackDatesChange={packsClient && packs.length > 0 && selectedPackIds.size > 0 ? onUsePackDatesChange : undefined} showPackDatesSwitch={packsClient && packs.length > 0 && selectedPackIds.size > 0 && !!onUsePackDatesChange} packDatesRange={packDatesRange} />
      </div>
    </>
  );

  // Modo expandido: renderizar filtros horizontalmente
  if (expanded) {
    return <div className="flex flex-wrap items-end gap-4">{filtersContentExpanded}</div>;
  }

  // Modo collapsado: renderizar com Popover (comportamento padrão)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full sm:w-auto">
          <IconFilter className="h-4 w-4" />
          <span>Filtros</span>
          {activeFiltersCount > 0 && <span className="ml-1 rounded-full bg-primary text-primary-foreground text-xs px-2 py-0.5">{activeFiltersCount}</span>}
          <IconChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-4" align="start">
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold mb-3">Filtros</h3>
          </div>

          <div className="space-y-4">{filtersContentCollapsed}</div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
