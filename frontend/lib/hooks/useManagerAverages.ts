"use client";

import { useMemo } from "react";
import { RankingsItem } from "@/lib/api/schemas";
import { computeMqlMetricsFromLeadscore } from "@/lib/utils/mqlMetrics";

export type ManagerAverages = {
  count: number;
  spend: number;
  impressions: number;
  clicks: number;
  inline_link_clicks: number;
  lpv: number;
  plays: number;
  results: number;
  hook: number | null;
  scroll_stop: number | null;
  ctr: number | null;
  website_ctr: number | null;
  connect_rate: number | null;
  cpm: number | null;
  cpr: number | null;
  page_conv: number | null;
  cpmql: number | null;
  mqls: number;
  // Somas absolutas (exibidas no header para spend, results, mqls)
  sumSpend: number;
  sumResults: number;
  sumMqls: number;
};

interface UseManagerAveragesOptions {
  ads: RankingsItem[];
  actionType?: string;
  hasSheetIntegration?: boolean;
  mqlLeadscoreMin: number;
}

/**
 * Calcula médias globais exibidas no header da ManagerTable.
 *
 * - Otimizado: 1 loop sobre `ads`
 * - Estável: memoiza por dependências de dados e parâmetros relevantes
 */
export function useManagerAverages({
  ads,
  actionType,
  hasSheetIntegration = false,
  mqlLeadscoreMin,
}: UseManagerAveragesOptions): ManagerAverages {
  return useMemo(() => {
    const n = ads.length;
    if (n === 0) {
      return {
        count: 0,
        spend: 0,
        impressions: 0,
        clicks: 0,
        inline_link_clicks: 0,
        lpv: 0,
        plays: 0,
        results: 0,
        hook: null,
        scroll_stop: null,
        ctr: null,
        website_ctr: null,
        connect_rate: null,
        cpm: null,
        cpr: null,
        page_conv: null,
        cpmql: null,
        mqls: 0,
        sumSpend: 0,
        sumResults: 0,
        sumMqls: 0,
      };
    }

    let sumSpend = 0;
    let sumImpr = 0;
    let sumClicks = 0;
    let sumInlineLinkClicks = 0;
    let sumLPV = 0;
    let sumPlays = 0;
    let sumResults = 0;

    let hookWeighted = 0;
    let hookWeight = 0;
    let scrollStopWeighted = 0;
    let scrollStopWeight = 0;

    // CPMQL accumulators
    let totalSpendForMql = 0;
    let totalMql = 0;

    for (const ad of ads) {
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

      const curve = (ad as any).video_play_curve_actions;
      if (Array.isArray(curve) && curve.length > 1) {
        const scrollStopRaw = Number(curve[1] || 0);
        if (!Number.isNaN(scrollStopRaw) && isFinite(scrollStopRaw) && scrollStopRaw >= 0) {
          const scrollStopVal = scrollStopRaw > 1 ? scrollStopRaw / 100 : scrollStopRaw;
          if (scrollStopVal >= 0 && scrollStopVal <= 1) {
            scrollStopWeighted += scrollStopVal * w;
            scrollStopWeight += w;
          }
        }
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
    const scrollStopAvg = scrollStopWeight > 0 ? scrollStopWeighted / scrollStopWeight : null;
    const cpr = sumResults > 0 ? sumSpend / sumResults : null;
    const pageConv = sumLPV > 0 ? sumResults / sumLPV : null;

    // Taxas como razão de somas (consistência global vs filtrada)
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
      scroll_stop: scrollStopAvg,
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
  }, [ads, actionType, hasSheetIntegration, mqlLeadscoreMin]);
}


