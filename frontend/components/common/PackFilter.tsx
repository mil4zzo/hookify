"use client";

import { useState, useEffect, useMemo } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconCheck, IconCards } from "@tabler/icons-react";
import { cn } from "@/lib/utils/cn";
import { FilterSelectButton } from "@/components/common/FilterSelectButton";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ToggleSwitch } from "@/components/common/ToggleSwitch";

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
  onClose?: () => void; // Chamado quando o popover fecha
  className?: string;
  showLabel?: boolean;
  isLoading?: boolean; // Se true, mostra loading state
  packsClient?: boolean; // Se false, ainda está carregando
  groupByPacks?: boolean; // Se true, agrupa por packs
  onGroupByPacksChange?: (checked: boolean) => void; // Handler para mudança do switch
  showGroupByPacksSwitch?: boolean; // Se true, mostra o switch "Agrupar por packs" dentro do popup
  singleSelect?: boolean; // Se true, usa estilo single-select (sem checkboxes, como ActionTypeFilter)
  onSelectAll?: () => void; // Bulk: seleciona todos os packs (mostra atalho "Selecionar todos")
  onDeselectAll?: () => void; // Bulk: limpa a seleção (mostra atalho "Limpar")
}

export function PackFilter({ packs, selectedPackIds, onTogglePack, onClose, className, showLabel = true, isLoading = false, packsClient = true, groupByPacks = false, onGroupByPacksChange, showGroupByPacksSwitch = false, singleSelect = false, onSelectAll, onDeselectAll }: PackFilterProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Reseta a busca ao fechar o popover
  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  // Filtra a lista de packs pelo nome (busca client-side, sem prefixo)
  const normalizedSearch = search.trim().toLowerCase();
  const filteredPacks = useMemo(() => {
    if (!normalizedSearch) return packs;
    return packs.filter((p) => p.name.toLowerCase().includes(normalizedSearch));
  }, [packs, normalizedSearch]);

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

  // Atalhos só fazem sentido no modo multi-select. A busca aparece quando a lista
  // fica longa (>5 packs), como pediu o usuário; os botões bulk aparecem quando o
  // parent fornece os handlers (só o Topbar hoje) e há mais de um pack.
  const showSearch = !singleSelect && totalCount > 5;
  const showBulkActions = !singleSelect && totalCount > 1 && (!!onSelectAll || !!onDeselectAll);

  // Texto para o botão
  const getButtonText = () => {
    if (selectedCount === 0) {
      return singleSelect ? "Selecione um pack" : "Nenhum pack selecionado";
    }
    if (singleSelect) {
      // Em single-select, sempre mostra o nome do pack selecionado
      const selectedPack = packs.find((p) => selectedPackIds.has(p.id));
      return selectedPack?.name || "Pack selecionado";
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
        <Popover open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (!nextOpen) onClose?.(); }}>
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
          <PopoverContent className={cn("w-[300px] p-0", singleSelect && "bg-secondary text-text")} align="start">
            {showGroupByPacksSwitch && onGroupByPacksChange && <ToggleSwitch id="group-by-packs-popover" checked={groupByPacks} onCheckedChange={onGroupByPacksChange} label="Agrupar por packs" variant="default" size="md" />}
            {showSearch && (
              <div className="border-b border-border p-2">
                <Input
                  placeholder="Buscar pack..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-9"
                  onKeyDown={(e) => {
                    // Enter com um único resultado alterna esse pack (não fecha — é multi-select)
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (filteredPacks.length === 1) {
                        onTogglePack(filteredPacks[0].id);
                        setSearch("");
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
            <div className="max-h-[300px] overflow-y-auto">
              {filteredPacks.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">Nenhum pack encontrado.</div>
              ) : (
              <div className="p-1">
                <div className="space-y-1">
                  {filteredPacks.map((pack) => {
                    const isSelected = selectedPackIds.has(pack.id);
                    // Usar stats.uniqueAds (preferencialmente do backend)
                    // Não usar pack.ads porque ads estão no cache IndexedDB
                    const adCount = pack.stats?.uniqueAds || 0;

                    if (singleSelect) {
                      // Estilo single-select (como ActionTypeFilter)
                      return (
                        <button
                          key={pack.id}
                          onClick={() => {
                            onTogglePack(pack.id);
                            setOpen(false);
                          }}
                          className={cn("relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50", isSelected ? "bg-accent" : "bg-transparent hover:bg-accent hover:text-accent-foreground")}
                        >
                          <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                            <IconCheck className={cn("h-4 w-4", isSelected ? "opacity-100" : "opacity-0")} />
                          </span>
                          <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                            <span className="truncate text-sm">{pack.name}</span>
                            <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                              ({adCount} {adCount === 1 ? "anúncio" : "anúncios"})
                            </span>
                          </div>
                        </button>
                      );
                    }

                    // Estilo multi-select (original com checkbox)
                    return (
                      <div key={pack.id} className={cn("relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground", isSelected)} onClick={() => onTogglePack(pack.id)}>
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
              )}
            </div>
          </PopoverContent>
        </Popover>
      </TooltipProvider>
    </div>
  );
}
