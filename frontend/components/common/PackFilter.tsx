"use client";

import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { IconCheck, IconCards } from "@tabler/icons-react";
import { cn } from "@/lib/utils/cn";
import { FilterSelectButton } from "@/components/common/FilterSelectButton";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";

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

interface PackFilterProps {
  packs: Pack[];
  selectedPackIds: Set<string>;
  onTogglePack: (packId: string) => void;
  className?: string;
  showLabel?: boolean;
  isLoading?: boolean; // Se true, mostra loading state
  packsClient?: boolean; // Se false, ainda está carregando
  groupByPacks?: boolean; // Se true, agrupa por packs
  onGroupByPacksChange?: (checked: boolean) => void; // Handler para mudança do switch
  showGroupByPacksSwitch?: boolean; // Se true, mostra o switch "Agrupar por packs" dentro do popup
}

export function PackFilter({ packs, selectedPackIds, onTogglePack, className, showLabel = true, isLoading = false, packsClient = true, groupByPacks = false, onGroupByPacksChange, showGroupByPacksSwitch = false }: PackFilterProps) {
  const [open, setOpen] = useState(false);

  // Determinar se está carregando (prop explícita ou quando packsClient é false ou quando não há packs ainda)
  const isActuallyLoading = isLoading || !packsClient || packs.length === 0;

  // Se não há packs e não está carregando, mostrar mensagem de "nenhum pack"
  const hasNoPacks = packs.length === 0 && packsClient && !isLoading;

  if (hasNoPacks) {
    return (
      <div className={`space-y-2 ${className || ""}`}>
        {showLabel && <label className="text-sm font-medium">Packs</label>}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <FilterSelectButton disabled iconPosition="start" icon={<IconCards className="mr-2 h-4 w-4 flex-shrink-0" />}>
                <span className="text-muted-foreground">Nenhum pack carregado</span>
              </FilterSelectButton>
            </TooltipTrigger>
            <TooltipContent>
              <p>Pack selecionado</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    );
  }

  const selectedCount = selectedPackIds.size;
  const totalCount = packs.length;

  // Texto para o botão
  const getButtonText = () => {
    if (selectedCount === 0) {
      return "Nenhum pack selecionado";
    }
    if (selectedCount === totalCount) {
      return `Todos os packs (${totalCount})`;
    }
    if (selectedCount === 1) {
      const selectedPack = packs.find((p) => selectedPackIds.has(p.id));
      return selectedPack?.name || "1 pack selecionado";
    }
    return `${selectedCount} de ${totalCount} packs selecionados`;
  };

  return (
    <div className={`space-y-2 ${className || ""}`}>
      {showLabel && <label className="text-sm font-medium">Packs</label>}
      <TooltipProvider>
        <Popover open={open} onOpenChange={setOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <FilterSelectButton aria-expanded={open} disabled={isActuallyLoading} iconPosition="start" icon={<IconCards className="mr-2 h-4 w-4 flex-shrink-0" />}>
                  {isActuallyLoading ? (
                    <span className="text-muted-foreground flex items-center gap-2">
                      <Skeleton className="h-4 w-32" />
                    </span>
                  ) : (
                    <span className="truncate text-left">{getButtonText()}</span>
                  )}
                </FilterSelectButton>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>
              <p>Pack selecionado</p>
            </TooltipContent>
          </Tooltip>
          <PopoverContent className="w-[300px] p-0" align="start">
            {showGroupByPacksSwitch && onGroupByPacksChange && (
              <div className="flex items-center gap-2 p-3 border-b border-border">
                <Switch id="group-by-packs-popover" checked={groupByPacks} onCheckedChange={onGroupByPacksChange} />
                <label htmlFor="group-by-packs-popover" className="text-sm font-medium cursor-pointer">
                  Agrupar por packs
                </label>
              </div>
            )}
            <div className="max-h-[300px] overflow-y-auto">
              <div className="p-2">
                <div className="space-y-1">
                  {packs.map((pack) => {
                    const isSelected = selectedPackIds.has(pack.id);
                    // Usar stats.uniqueAds (preferencialmente do backend)
                    // Não usar pack.ads porque ads estão no cache IndexedDB
                    const adCount = pack.stats?.uniqueAds || 0;

                    return (
                      <div key={pack.id} className={cn("relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground", isSelected && "bg-accent")} onClick={() => onTogglePack(pack.id)}>
                        <div className="flex items-center space-x-2 flex-1 min-w-0">
                          <div className={cn("flex h-4 w-4 items-center justify-center rounded border border-border shrink-0", isSelected && "bg-primary border-primary")}>{isSelected && <IconCheck className="h-3 w-3 text-primary-foreground" />}</div>
                          <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                            <span className="truncate text-sm">{pack.name}</span>
                            <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                              ({adCount} {adCount === 1 ? "anúncio" : "anúncios"})
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
      </TooltipProvider>
    </div>
  );
}
