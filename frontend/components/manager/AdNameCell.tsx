"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { RankingsItem } from "@/lib/api/schemas";
import { getAdThumbnail } from "@/lib/utils/thumbnailFallback";
import { ThumbnailImage } from "@/components/common/ThumbnailImage";

interface AdNameCellProps {
  original: RankingsItem;
  value: string;
  getRowKey: (row: any) => string;
  expanded: Record<string, boolean>;
  setExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  groupByAdNameEffective: boolean;
  currentTab: string;
}

// Custom comparison function for React.memo
function arePropsEqual(prev: AdNameCellProps, next: AdNameCellProps): boolean {
  // Value comparison
  if (prev.value !== next.value) return false;

  // Original object reference comparison
  if (prev.original !== next.original) return false;

  // Current tab comparison
  if (prev.currentTab !== next.currentTab) return false;

  // GroupBy comparison
  if (prev.groupByAdNameEffective !== next.groupByAdNameEffective) return false;

  // Function references (should be stable from parent)
  if (prev.getRowKey !== next.getRowKey) return false;
  if (prev.setExpanded !== next.setExpanded) return false;

  // CRITICAL: Check if THIS row's expanded state changed
  const prevKey = prev.getRowKey({ original: prev.original });
  const nextKey = next.getRowKey({ original: next.original });

  // If the row key changed, re-render
  if (prevKey !== nextKey) return false;

  // Get the expanded state for this specific row
  const prevExpanded = prev.expanded[prevKey];
  const nextExpanded = next.expanded[nextKey];

  // If expanded state changed for THIS row, re-render
  if (prevExpanded !== nextExpanded) return false;

  // Don't care about other rows' expanded states
  return true;
}

export const AdNameCell = React.memo(
  function AdNameCell({
    original,
    value,
    getRowKey,
    expanded,
    setExpanded,
    groupByAdNameEffective,
    currentTab,
  }: AdNameCellProps) {
    const thumbnail = getAdThumbnail(original);
    const name = String(value || "—");
    const id = original?.ad_id;
    const adCount = original?.ad_count || 1;
    const key = getRowKey({ original });
    const isExpanded = !!expanded[key];

    let secondLine = "";
    if (groupByAdNameEffective) {
      secondLine = adCount === 1 ? "1 anúncio" : `+ ${adCount} anúncios`;
    } else {
      if (currentTab === "por-conjunto") {
        secondLine = adCount === 1 ? "1 anúncio" : `${adCount} anúncios`;
      } else if (currentTab === "por-campanha") {
        secondLine = adCount === 1 ? "1 conjunto" : `${adCount} conjuntos`;
      } else if (currentTab === "individual") {
        // Na aba individual, mostrar o nome do conjunto ao invés do ID do anúncio
        const adsetName = (original as any)?.adset_name;
        secondLine = adsetName ? String(adsetName) : `ID: ${id || "-"}`;
      } else {
        const countLabel = "dias";
        secondLine = adCount === 1 ? `ID: ${id || "-"}` : `ID: ${id || "-"} (${adCount} ${countLabel})`;
      }
    }

    const handleToggleExpand = (e?: React.MouseEvent) => {
      e?.stopPropagation();
      const next = !isExpanded;
      setExpanded((prev) => ({ ...prev, [key]: next }));
    };

    return (
      <div className="flex items-center gap-3 w-full">
        <ThumbnailImage src={thumbnail} alt="thumb" size="md" />
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="flex items-center gap-2 truncate">
            <span className="truncate flex-1">{name}</span>
          </div>
          {groupByAdNameEffective || currentTab === "por-campanha" || currentTab === "por-conjunto" ? (
            <div className="mt-1">
              <Button size="sm" variant={isExpanded ? "default" : "ghost"} onClick={handleToggleExpand} className={`h-auto py-1 px-2 text-xs ${isExpanded ? "text-primary-foreground" : "text-muted-foreground"} hover:text-text`}>
                {isExpanded ? "- Recolher" : secondLine}
              </Button>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground truncate">{secondLine}</div>
          )}
        </div>
      </div>
    );
  },
  arePropsEqual
);
