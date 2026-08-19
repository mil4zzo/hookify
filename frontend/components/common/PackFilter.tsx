"use client";

import { useMemo } from "react";
import { IconCards } from "@tabler/icons-react";
import { FilterSelectButton } from "@/components/common/FilterSelectButton";
import { FilterListPopover } from "@/components/common/FilterListPopover";
// design-system-exception: direct-skeleton-import - filter-option-shaped loading skeleton
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ToggleSwitch } from "@/components/common/ToggleSwitch";
import { usePackSortStore } from "@/lib/store/packSort";
import { sortPacks } from "@/lib/utils/packSort";

interface Pack {
  id: string;
  name: string;
  ads: any[];
  // Campos consumidos apenas pela ordenação compartilhada (ver lib/utils/packSort).
  adaccount_id?: string;
  created_at?: string;
  last_refreshed_at?: string;
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
  /**
   * Grafo de conflito cross-silo (usePackConflicts): packId -> packs com que ele
   * conflita. Pack NÃO selecionado que conflita com algum selecionado fica
   * desabilitado, com o motivo no hint — é a camada 1 do bloqueio: melhor não
   * deixar entrar no estado ruim do que explicá-lo depois. Desmarcar um pack já
   * selecionado continua sempre possível (canToggle do FilterListPopover).
   */
  conflictMap?: Map<string, Set<string>>;
}

export function PackFilter({ packs, selectedPackIds, onTogglePack, onClose, className, showLabel = true, isLoading = false, packsClient = true, groupByPacks = false, onGroupByPacksChange, showGroupByPacksSwitch = false, singleSelect = false, onSelectAll, onDeselectAll, conflictMap }: PackFilterProps) {
  // Determinar se está carregando (prop explícita ou quando packsClient é false ou quando não há packs ainda)
  const isActuallyLoading = isLoading || !packsClient || packs.length === 0;

  // Se não há packs e não está carregando, mostrar mensagem de "nenhum pack"
  const hasNoPacks = packs.length === 0 && packsClient && !isLoading;

  // Mesma preferência de ordenação (critério + direção) da página /packs: as duas
  // superfícies ficam montadas ao mesmo tempo e divergir de ordem confunde. Sem o mapa
  // de contas, o critério "Conta" agrupa pelo adaccount_id (a ordem entre contas é
  // arbitrária, mas packs da mesma conta ficam adjacentes).
  const sortKey = usePackSortStore((state) => state.sortKey);
  const sortDirection = usePackSortStore((state) => state.direction);

  const nameById = useMemo(() => new Map(packs.map((p) => [p.id, p.name])), [packs]);

  const options = useMemo(
    () =>
      sortPacks(packs, sortKey, { direction: sortDirection }).map((pack) => {
        // Usar stats.uniqueAds (preferencialmente do backend)
        // Não usar pack.ads porque ads estão no cache IndexedDB
        const adCount = pack.stats?.uniqueAds || 0;

        // Conflito só desabilita quem está FORA da seleção; quem está dentro
        // precisa continuar clicável para poder ser desmarcado.
        let disabled = false;
        let disabledHint: string | undefined;
        if (conflictMap && !selectedPackIds.has(pack.id)) {
          const enemies = conflictMap.get(pack.id);
          if (enemies) {
            for (const selectedId of selectedPackIds) {
              if (enemies.has(selectedId)) {
                const conflictName = nameById.get(selectedId) ?? "um pack selecionado";
                disabled = true;
                disabledHint = `Conflita com «${conflictName}»: mesmos anúncios em contas de donos diferentes. Desmarque um para usar o outro.`;
                break;
              }
            }
          }
        }

        return {
          id: pack.id,
          label: pack.name,
          meta: `(${adCount} ${adCount === 1 ? "anúncio" : "anúncios"})`,
          disabled,
          disabledHint,
        };
      }),
    [packs, sortKey, sortDirection, conflictMap, selectedPackIds, nameById],
  );

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
  // fica longa (>5 packs); os botões bulk aparecem quando o parent fornece os handlers.
  const showSearch = !singleSelect && totalCount > 5;

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
        <FilterListPopover
          options={options}
          selectedIds={selectedPackIds}
          onSelect={onTogglePack}
          mode={singleSelect ? "single" : "multi"}
          searchable={showSearch}
          searchPlaceholder="Buscar pack..."
          emptyMessage="Nenhum pack encontrado."
          onSelectAll={!singleSelect ? onSelectAll : undefined}
          onDeselectAll={!singleSelect ? onDeselectAll : undefined}
          contentClassName={singleSelect ? "w-[300px] bg-secondary text-text" : undefined}
          onOpenChange={(open) => {
            if (!open) onClose?.();
          }}
          disabled={isActuallyLoading}
          header={showGroupByPacksSwitch && onGroupByPacksChange ? <ToggleSwitch id="group-by-packs-popover" checked={groupByPacks} onCheckedChange={onGroupByPacksChange} label="Agrupar por packs" variant="default" size="md" /> : undefined}
          trigger={
            <FilterSelectButton disabled={isActuallyLoading} iconPosition="start" icon={<IconCards className="mr-2 h-4 w-4 flex-shrink-0" />}>
              {isActuallyLoading ? (
                <span className="text-muted-foreground flex items-center gap-2">
                  <Skeleton className="h-4 w-32" />
                </span>
              ) : (
                <span className="truncate text-left">{getButtonText()}</span>
              )}
            </FilterSelectButton>
          }
          triggerWrap={(node) => (
            <Tooltip>
              <TooltipTrigger asChild>{node}</TooltipTrigger>
              <TooltipContent>
                <p>Pack selecionado</p>
              </TooltipContent>
            </Tooltip>
          )}
        />
      </TooltipProvider>
    </div>
  );
}
