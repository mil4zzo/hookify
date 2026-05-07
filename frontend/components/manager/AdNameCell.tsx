"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { RankingsItem } from "@/lib/api/schemas";
import { getAdThumbnail } from "@/lib/utils/thumbnailFallback";
import { ThumbnailImage } from "@/components/common/ThumbnailImage";
import { IconChevronRight, IconMicrophone } from "@tabler/icons-react";

interface AdNameCellProps {
  original: RankingsItem;
  value: string;
  groupByAdNameEffective: boolean;
  currentTab: string;
  /** Quando true (visualização minimal), thumbnail usa tamanho menor (w-10 h-10) */
  minimal?: boolean;
  /** Acionado ao clicar no chevron — abre o modal de drill no nível apropriado. */
  onOpenDrill?: (original: RankingsItem) => void;
}

function arePropsEqual(prev: AdNameCellProps, next: AdNameCellProps): boolean {
  if (prev.value !== next.value) return false;
  if (prev.original !== next.original) return false;
  if (prev.currentTab !== next.currentTab) return false;
  if (prev.minimal !== next.minimal) return false;
  if (prev.groupByAdNameEffective !== next.groupByAdNameEffective) return false;
  if (prev.onOpenDrill !== next.onOpenDrill) return false;
  return true;
}

export const AdNameCell = React.memo(function AdNameCell({ original, value, groupByAdNameEffective, currentTab, minimal = false, onOpenDrill }: AdNameCellProps) {
  const showThumbnail = currentTab !== "por-conjunto" && currentTab !== "por-campanha";
  const thumbnail = getAdThumbnail(original);
  const name = String(value || "—");
  const id = original?.ad_id;
  const adCount = original?.ad_count ?? 0;
  const activeCount = original?.active_count ?? adCount;
  const thumbnailSize = minimal ? "sm" : "md";
  const canDrill = !!onOpenDrill && (groupByAdNameEffective || currentTab === "por-conjunto" || currentTab === "por-campanha");

  let secondLine = "";
  let activeCountForDisplay: number | undefined;
  if (groupByAdNameEffective || currentTab === "por-conjunto" || currentTab === "por-campanha") {
    const isPorCampanha = currentTab === "por-campanha";
    if (isPorCampanha) {
      const total = adCount;
      secondLine = total === 1 ? "1 conjunto" : `${total} conjuntos`;
    } else {
      const total = adCount;
      const x = typeof activeCount === "number" ? activeCount : total;
      activeCountForDisplay = x;
      const countLabel = total === 1 ? "anúncio" : "anúncios";
      secondLine = `${x} / ${total} ${countLabel}`;
    }
  }
  const dotActive = activeCountForDisplay !== undefined && activeCountForDisplay > 0;
  const showDot = activeCountForDisplay !== undefined;
  if (currentTab === "individual") {
    const adsetName = (original as any)?.adset_name;
    secondLine = adsetName ? String(adsetName) : `ID: ${id || "-"}`;
  } else if (!(groupByAdNameEffective || currentTab === "por-conjunto" || currentTab === "por-campanha")) {
    const countLabel = "dias";
    const count = Math.max(adCount, 1);
    secondLine = count === 1 ? `ID: ${id || "-"}` : `ID: ${id || "-"} (${count} ${countLabel})`;
  }

  const handleOpenDrill = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!onOpenDrill) return;
    onOpenDrill(original);
  };

  return (
    <div className="flex items-center gap-3 w-full">
      {showThumbnail && (
        <div className="relative flex-shrink-0">
          <ThumbnailImage src={thumbnail} alt="thumb" size={thumbnailSize} />
          {original.has_transcription && (
            <div className="absolute bottom-0.5 right-0.5 rounded bg-background/80 p-0.5 backdrop-blur-sm">
              <IconMicrophone className="h-2.5 w-2.5 text-primary" aria-hidden />
            </div>
          )}
        </div>
      )}
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="flex items-center gap-2 truncate">
          <span className="truncate flex-1">{name}</span>
        </div>
        {canDrill ? (
          <div className="mt-1">
            <Button size="sm" variant="ghost" onClick={handleOpenDrill} className="h-auto py-1 px-2 text-xs gap-1.5 text-muted-foreground hover:text-text">
              {currentTab === "por-campanha" ? (
                <>
                  {secondLine}
                  <IconChevronRight className="w-3 h-3 shrink-0 opacity-70" aria-hidden />
                </>
              ) : (
                <>
                  {showDot && <span className={`shrink-0 rounded-full w-1.5 h-1.5 ${dotActive ? "bg-success" : "bg-destructive"}`} aria-hidden />}
                  {secondLine}
                  <IconChevronRight className="w-3 h-3 shrink-0 opacity-70" aria-hidden />
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground truncate">{secondLine}</div>
        )}
      </div>
    </div>
  );
}, arePropsEqual);
