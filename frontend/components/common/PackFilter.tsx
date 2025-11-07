"use client";

import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { IconChevronDown, IconCheck } from "@tabler/icons-react";
import { cn } from "@/lib/utils/cn";

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
}

export function PackFilter({ packs, selectedPackIds, onTogglePack, className }: PackFilterProps) {
  const [open, setOpen] = useState(false);

  if (packs.length === 0) {
    return (
      <div className={`space-y-2 ${className || ""}`}>
        <label className="text-sm font-medium">Packs</label>
        <Button variant="outline" disabled className="w-full justify-between">
          <span className="text-muted-foreground">Nenhum pack carregado</span>
        </Button>
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
      <label className="text-sm font-medium">Packs</label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between">
            <span className="truncate">{getButtonText()}</span>
            <IconChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0" align="start">
          <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
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
    </div>
  );
}
