"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { RankingsItem } from "@/lib/api/schemas";
import { getAdThumbnail } from "@/lib/utils/thumbnailFallback";
import { ThumbnailImage } from "@/components/common/ThumbnailImage";
import { IconChevronDown } from "@tabler/icons-react";

interface AdNameCellProps {
  original: RankingsItem;
  value: string;
  getRowKey: (row: any) => string;
  expanded: Record<string, boolean>;
  setExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  groupByAdNameEffective: boolean;
  currentTab: string;
  /** Quando true (visualização minimal), thumbnail usa tamanho menor (w-10 h-10) */
  minimal?: boolean;
}

// Custom comparison function for React.memo
function arePropsEqual(prev: AdNameCellProps, next: AdNameCellProps): boolean {
  // Value comparison
  if (prev.value !== next.value) return false;

  // Original object reference comparison
  if (prev.original !== next.original) return false;

  // Current tab comparison
  if (prev.currentTab !== next.currentTab) return false;

  // Minimal (view mode) comparison
  if (prev.minimal !== next.minimal) return false;

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

export const AdNameCell = React.memo(function AdNameCell({ original, value, getRowKey, expanded, setExpanded, groupByAdNameEffective, currentTab, minimal = false }: AdNameCellProps) {
  const showThumbnail = currentTab !== "por-conjunto" && currentTab !== "por-campanha";
  const thumbnail = getAdThumbnail(original);
  const name = String(value || "—");
  const id = original?.ad_id;
  const adCount = original?.ad_count ?? 0;
  const activeCount = original?.active_count ?? adCount;
  const key = getRowKey({ original });
  const isExpanded = !!expanded[key];
  const hasActive = (original?.effective_status || "").toUpperCase() === "ACTIVE";
  const dotActive = adCount > 0 && hasActive;
  const thumbnailSize = minimal ? "sm" : "md";

  let secondLine = "";
  if (groupByAdNameEffective || currentTab === "por-conjunto" || currentTab === "por-campanha") {
    const isPorCampanha = currentTab === "por-campanha";
    if (isPorCampanha) {
      const total = adCount;
      secondLine = total === 1 ? "1 conjunto" : `${total} conjuntos`;
    } else {
      const total = adCount;
      const x = typeof activeCount === "number" ? activeCount : total;
      const countLabel = total === 1 ? "anúncio" : "anúncios";
      secondLine = `${x} / ${total} ${countLabel}`;
    }
  } else if (currentTab === "individual") {
    const adsetName = (original as any)?.adset_name;
    secondLine = adsetName ? String(adsetName) : `ID: ${id || "-"}`;
  } else {
    const countLabel = "dias";
    const count = Math.max(adCount, 1);
    secondLine = count === 1 ? `ID: ${id || "-"}` : `ID: ${id || "-"} (${count} ${countLabel})`;
  }

  const handleToggleExpand = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const next = !isExpanded;
    setExpanded((prev) => ({ ...prev, [key]: next }));
  };

  return (
    <div className="flex items-center gap-3 w-full">
      {showThumbnail && <ThumbnailImage src={thumbnail} alt="thumb" size={thumbnailSize} />}
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="flex items-center gap-2 truncate">
          <span className="truncate flex-1">{name}</span>
        </div>
        {groupByAdNameEffective || currentTab === "por-campanha" || currentTab === "por-conjunto" ? (
          <div className="mt-1">
            <Button size="sm" variant={isExpanded ? "default" : "ghost"} onClick={handleToggleExpand} className={`h-auto py-1 px-2 text-xs gap-1.5 ${isExpanded ? "text-primary-foreground" : "text-muted-foreground"} hover:text-text`}>
              {isExpanded ? (
                "- Recolher"
              ) : currentTab === "por-campanha" ? (
                <>
                  {secondLine}
                  <IconChevronDown className="w-3 h-3 shrink-0 opacity-70" aria-hidden />
                </>
              ) : (
                <>
                  <span className={`shrink-0 rounded-full w-1.5 h-1.5 ${dotActive ? "bg-green-500" : "bg-muted-foreground/60"}`} aria-hidden />
                  {secondLine}
                  <IconChevronDown className="w-3 h-3 shrink-0 opacity-70" aria-hidden />
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
