"use client";

import { useMemo } from "react";
import type { Table } from "@tanstack/react-table";
import type { ColumnFiltersState } from "@tanstack/react-table";
import { RankingsItem } from "@/lib/api/schemas";
import { computeMqlMetricsFromLeadscore } from "@/lib/utils/mqlMetrics";
import type { ManagerAverages } from "@/lib/hooks/useManagerAverages";

interface UseFilteredAveragesOptions {
  table: Table<RankingsItem>;
  dataLength: number;
  columnFilters: ColumnFiltersState;
  globalFilter: string;
  actionType?: string;
  hasSheetIntegration?: boolean;
  mqlLeadscoreMin: number;
}

/**
 * Calcula médias dos dados filtrados (visíveis após filtros/sorting).
 * Retorna `null` quando não há filtro efetivo (i.e. n === dataLength) ou n === 0.
 */
export function useFilteredAverages({
  table,
  dataLength,
  columnFilters,
  globalFilter,
  actionType,
  hasSheetIntegration = false,
  mqlLeadscoreMin,
}: UseFilteredAveragesOptions): ManagerAverages | null {
  return useMemo(() => {
    const filteredRows = table.getFilteredRowModel().rows;
    const filteredAds = filteredRows.map((row) => row.original as RankingsItem);
    const n = filteredAds.length;

    if (n === 0 || n === dataLength) return null;

    let sumSpend = 0;
    let sumImpr = 0;
    let sumClicks = 0;
    let sumInlineLinkClicks = 0;
    let sumLPV = 0;
    let sumPlays = 0;
    let sumResults = 0;

    let hookWeighted = 0;
    let hookWeight = 0;

    let totalSpendForMql = 0;
    let totalMql = 0;

    for (const ad of filteredAds) {
      const spend = Number((ad as any).spend || 0);
      const impressions = Number((ad as any).impressions || 0);
      const clicks = Number((ad as any).clicks || 0);
      const inlineLinkClicks = Number((ad as any).inline_link_clicks || 0);
      const lpv = Number((ad as any).lpv || 0);
      const plays = Number((ad as any).plays ?? (ad as any).video_total_plays ?? 0);
      const hook = Number((ad as any).hook ?? 0);
      const convs = (ad as any).conversions || {};
      const res = actionType ? Number(convs[actionType] || 0) : 0;

      sumSpend += spend;
      sumImpr += impressions;
      sumClicks += clicks;
      sumInlineLinkClicks += inlineLinkClicks;
      sumLPV += lpv;
      sumPlays += plays;
      sumResults += res;

      const w = plays > 0 ? plays : 1;
      if (!Number.isNaN(hook)) {
        hookWeighted += hook * w;
        hookWeight += w;
      }

      if (hasSheetIntegration) {
        const { mqlCount } = computeMqlMetricsFromLeadscore({
          spend,
          leadscoreRaw: (ad as any).leadscore_values,
          mqlLeadscoreMin,
        });
        if (spend > 0 && mqlCount > 0) {
          totalSpendForMql += spend;
          totalMql += mqlCount;
        }
      }
    }

    const hookAvg = hookWeight > 0 ? hookWeighted / hookWeight : null;
    const cpr = sumResults > 0 ? sumSpend / sumResults : null;
    const pageConv = sumLPV > 0 ? sumResults / sumLPV : null;

    const ctr = sumImpr > 0 ? sumClicks / sumImpr : null;
    const websiteCtr = sumImpr > 0 ? sumInlineLinkClicks / sumImpr : null;
    const cpm = sumImpr > 0 ? (sumSpend * 1000) / sumImpr : null;
    const connectAvg = sumInlineLinkClicks > 0 ? sumLPV / sumInlineLinkClicks : null;

    const cpmqlAvg = totalMql > 0 && totalSpendForMql > 0 ? totalSpendForMql / totalMql : null;

    return {
      count: n,
      spend: n > 0 ? sumSpend / n : 0,
      impressions: n > 0 ? sumImpr / n : 0,
      clicks: n > 0 ? sumClicks / n : 0,
      inline_link_clicks: n > 0 ? sumInlineLinkClicks / n : 0,
      lpv: n > 0 ? sumLPV / n : 0,
      plays: n > 0 ? sumPlays / n : 0,
      results: n > 0 ? sumResults / n : 0,
      hook: hookAvg,
      // filtrado não calcula scroll_stop hoje; manter null para evitar semântica diferente
      scroll_stop: null,
      ctr,
      website_ctr: websiteCtr,
      connect_rate: connectAvg,
      cpm,
      cpr,
      page_conv: pageConv,
      cpmql: cpmqlAvg,
      mqls: n > 0 ? totalMql / n : 0,
      sumSpend: sumSpend,
      sumResults: sumResults,
      sumMqls: totalMql,
    };
  }, [table, dataLength, columnFilters, globalFilter, actionType, hasSheetIntegration, mqlLeadscoreMin]);
}


