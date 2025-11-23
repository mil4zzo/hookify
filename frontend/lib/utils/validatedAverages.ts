import { RankingsItem, RankingsResponse } from "@/lib/api/schemas";

/**
 * Computa médias globais (hook, ctr, website_ctr, connect_rate, cpm, page_conv, cpr)
 * a partir de um conjunto de RankingsItem, replicando a lógica do backend em
 * backend/app/routes/analytics.py (averages_base + per_action_type[ actionType ]).
 *
 * Esta função deve ser a FONTE ÚNICA de verdade para médias no frontend.
 * Qualquer widget que dependa de médias deve reusar o resultado desta função.
 */
export function computeValidatedAveragesFromRankings(
  ads: RankingsItem[],
  actionType: string
): RankingsResponse["averages"] | undefined {
  if (!Array.isArray(ads) || ads.length === 0 || !actionType) {
    return undefined;
  }

  let totalImpr = 0;
  let totalClicks = 0;
  let totalInline = 0;
  let totalSpend = 0;
  let totalLpv = 0;
  let totalHookWsum = 0;
  let totalHoldRateWsum = 0;
  let totalScrollStopWsum = 0;
  let totalPlays = 0;
  let totalResultsForAction = 0;

  ads.forEach((ad: any) => {
    const impressions = Number(ad.impressions || 0);
    const clicks = Number(ad.clicks || 0);
    const inline = Number(ad.inline_link_clicks || 0);
    const spend = Number(ad.spend || 0);
    const lpv = Number(ad.lpv || 0);
    const plays = Number(ad.plays || 0);

    const hook = Number(ad.hook || 0);
    const holdRate = Number(ad.hold_rate || 0);
    const scrollStop = Number(ad.video_watched_p50 || 0);

    const conversions = (ad.conversions || {}) as Record<string, number>;
    const resultsForAction = Number(conversions[actionType] || 0);

    totalImpr += impressions;
    totalClicks += clicks;
    totalInline += inline;
    totalSpend += spend;
    totalLpv += lpv;

    // Pesos por plays para hook/hold/scroll_stop (mesma ideia do backend)
    totalPlays += plays;
    totalHookWsum += hook * plays;
    totalHoldRateWsum += holdRate * plays;
    totalScrollStopWsum += scrollStop * plays;

    totalResultsForAction += resultsForAction;
  });

  const safeDiv = (num: number, den: number) =>
    den > 0 && Number.isFinite(num) && Number.isFinite(den) ? num / den : 0;

  const avgHook = safeDiv(totalHookWsum, totalPlays);
  const avgHoldRate = safeDiv(totalHoldRateWsum, totalPlays);
  const avgScrollStop = safeDiv(totalScrollStopWsum, totalPlays);
  const avgCtr = safeDiv(totalClicks, totalImpr);
  const avgWebsiteCtr = safeDiv(totalInline, totalImpr);
  const avgConnectRate = safeDiv(totalLpv, totalInline);
  const avgCpm = safeDiv(totalSpend, totalImpr) * 1000;

  const totalResults = totalResultsForAction;
  const pageConv = safeDiv(totalResults, totalLpv);
  const cpr = safeDiv(totalSpend, totalResults);

  const averagesBase = {
    hook: avgHook,
    hold_rate: avgHoldRate,
    scroll_stop: avgScrollStop,
    ctr: avgCtr,
    website_ctr: avgWebsiteCtr,
    connect_rate: avgConnectRate,
    cpm: avgCpm,
  };

  const perActionType: Record<string, { results: number; cpr: number; page_conv: number }> = {};
  perActionType[actionType] = {
    results: totalResults,
    cpr,
    page_conv: pageConv,
  };

  return {
    ...averagesBase,
    per_action_type: perActionType,
  };
}


