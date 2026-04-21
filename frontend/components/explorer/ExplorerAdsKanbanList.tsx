"use client";

import { useEffect, useMemo, useState } from "react";
import { IconArrowsSort, IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import { SearchInputWithClear } from "@/components/common/SearchInputWithClear";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils/cn";
import { formatMetricValue, getMetricDisplayLabel } from "@/lib/metrics";
import type { ExplorerKanbanMetricKey, ExplorerKanbanMetricOptionKey, ExplorerListItemViewModel, ExplorerSortState } from "@/lib/explorer/types";
import { getExplorerInitialSortDirection } from "@/lib/explorer/viewModels";
import { ExplorerAdSidebarCard } from "./ExplorerAdSidebarCard";

const EXPLORER_SORT_OPTIONS: Array<{
  key: ExplorerKanbanMetricOptionKey;
  label: string;
  disabled?: boolean;
  helperText?: string;
}> = [
  { key: "spend", label: getMetricDisplayLabel("spend") },
  { key: "cpm", label: getMetricDisplayLabel("cpm") },
  { key: "scroll_stop", label: getMetricDisplayLabel("scroll_stop") },
  { key: "hook", label: getMetricDisplayLabel("hook") },
  { key: "hold_rate", label: getMetricDisplayLabel("hold_rate") },
  { key: "video_watched_p50", label: getMetricDisplayLabel("video_watched_p50") },
  { key: "website_ctr", label: getMetricDisplayLabel("website_ctr") },
  { key: "connect_rate", label: getMetricDisplayLabel("connect_rate") },
  { key: "page_conv", label: getMetricDisplayLabel("page_conv") },
  { key: "cpc", label: getMetricDisplayLabel("cpc") },
  { key: "cpr", label: getMetricDisplayLabel("cpr") },
  { key: "cpmql", label: getMetricDisplayLabel("cpmql") },
  { key: "score", label: getMetricDisplayLabel("score"), disabled: true, helperText: "Indisponivel na Explorer" },
];

interface ExplorerAdsKanbanListProps {
  ads: ExplorerListItemViewModel[];
  selectedGroupKey: string | null;
  onSelectAd: (groupKey: string) => void;
  averagePrimaryMetric?: number | null;
  actionType?: string;
  sortState: ExplorerSortState;
  onSortChange: (nextState: ExplorerSortState) => void;
}

export function ExplorerAdsKanbanList({ ads, selectedGroupKey, onSelectAd, averagePrimaryMetric, sortState, onSortChange }: ExplorerAdsKanbanListProps) {
  const [searchValue, setSearchValue] = useState("");

  const filteredAds = useMemo(() => {
    const normalizedQuery = searchValue.trim().toLowerCase();
    if (!normalizedQuery) {
      return ads;
    }

    return ads.filter((ad) => {
      const haystacks = [ad.adName, ad.campaignName, ad.accountLabel, ad.searchableStatus || ""];
      return haystacks.some((value) => value.toLowerCase().includes(normalizedQuery));
    });
  }, [ads, searchValue]);

  useEffect(() => {
    if (filteredAds.length === 0) {
      return;
    }

    if (!selectedGroupKey || !filteredAds.some((ad) => ad.groupKey === selectedGroupKey)) {
      onSelectAd(filteredAds[0].groupKey);
    }
  }, [filteredAds, onSelectAd, selectedGroupKey]);

  const handleSortSelection = (metricKey: ExplorerKanbanMetricKey) => {
    if (sortState.metricKey === metricKey) {
      onSortChange({
        metricKey,
        direction: sortState.direction === "desc" ? "asc" : "desc",
      });
      return;
    }

    onSortChange({
      metricKey,
      direction: getExplorerInitialSortDirection(metricKey),
    });
  };

  const selectedMetricLabel = getMetricDisplayLabel(sortState.metricKey);
  const sortDirectionIcon =
    sortState.direction === "asc" ? <IconChevronUp className="h-4 w-4 flex-shrink-0" /> : <IconChevronDown className="h-4 w-4 flex-shrink-0" />;

  return (
    <section className="flex min-h-0 min-w-0 max-w-full flex-col md:h-full">
      <div className="flex items-center gap-3 pb-3">
        <div className="flex min-w-0 items-center">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Anuncios</h2>
        </div>

        <div className="ml-auto flex items-center">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:bg-muted-hover hover:text-foreground"
                aria-label="Ordenar anuncios por metrica"
                title={`Ordenar por ${selectedMetricLabel}`}
              >
                <span className="text-xs font-medium text-foreground">{selectedMetricLabel}</span>
                {sortDirectionIcon}
              </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="bg-card">Ordenar por metrica</DropdownMenuLabel>
              <DropdownMenuSeparator />

              {EXPLORER_SORT_OPTIONS.map((option) => {
                const isActive = option.key === sortState.metricKey;

                return (
                  <DropdownMenuItem
                    key={option.key}
                    disabled={option.disabled}
                    onSelect={() => {
                      if (!option.disabled) {
                        handleSortSelection(option.key as ExplorerKanbanMetricKey);
                      }
                    }}
                    className="flex items-center gap-3"
                  >
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{option.label}</span>
                      {option.helperText ? <span className="text-xs text-muted-foreground">{option.helperText}</span> : null}
                    </div>

                    {isActive ? sortState.direction === "asc" ? <IconChevronUp className="h-4 w-4 flex-shrink-0 text-foreground" /> : <IconChevronDown className="h-4 w-4 flex-shrink-0 text-foreground" /> : null}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="pb-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{selectedMetricLabel}</span>
        <span className="mx-1">Media:</span>
        <span>{averagePrimaryMetric != null ? formatMetricValue(sortState.metricKey, averagePrimaryMetric) : "—"}</span>
      </div>

      <div className="min-w-0">
        <SearchInputWithClear
          value={searchValue}
          onChange={setSearchValue}
          placeholder="Buscar por nome do anuncio..."
          wrapperClassName="w-full"
          inputClassName="bg-background rounded-none border-b border-r-0 border-l-0 border-t-0 border-border h-10 w-full focus-visible:border-b-primary focus-visible:ring-0 focus-visible:ring-offset-0"
        />
      </div>

      <div className="mt-3 min-w-0 md:min-h-0 md:flex-1 md:overflow-y-auto md:overflow-x-hidden [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        <div className="min-w-0 max-w-full space-y-4">
          {filteredAds.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-70 bg-background-40 px-4 py-8 text-center text-sm text-muted-foreground">Nenhum anuncio encontrado para essa busca.</div>
          ) : (
            filteredAds.map((item) => (
              <ExplorerAdSidebarCard
                key={item.groupKey}
                ad={item.cardData}
                metricLabel={item.primaryMetricLabel}
                metricKey={item.primaryMetricKey}
                selected={item.groupKey === selectedGroupKey}
                averageValue={averagePrimaryMetric ?? null}
                onClick={() => onSelectAd(item.groupKey)}
              />
            ))
          )}
        </div>
      </div>

      <div className={cn("pt-2 text-xs text-muted-foreground sm:hidden", averagePrimaryMetric != null && "border-t border-border-70")}>
        {averagePrimaryMetric != null ? `${selectedMetricLabel} Media: ${formatMetricValue(sortState.metricKey, averagePrimaryMetric)}` : null}
      </div>
    </section>
  );
}
