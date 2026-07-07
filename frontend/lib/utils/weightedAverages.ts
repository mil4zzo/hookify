import { RankingsItem, RankingsResponse } from "@/lib/api/schemas";

/**
 * Réplica client-side do cálculo de médias do backend (analytics.py:
 * averages_base + per_action_type[actionType]) — média PONDERADA por volume
 * (regra da casa: somar contagens brutas, recomputar taxas), a média real que
 * bate com o Gerenciador do Meta.
 *
 * A fonte canônica da média é o backend (`serverAverages` na resposta de
 * ad-performance). Use esta função APENAS como fallback quando a resposta não
 * trouxer `averages` (caso do Explorer) — nunca para criar uma segunda média
 * a partir de um subconjunto (ex.: "média dos validados"): só existe UMA média
 * no app, a global.
 */
export function computeWeightedAveragesFromAdPerformance(
  ads: RankingsItem[],
  actionType?: string,
  availableConversionTypes?: string[]
): RankingsResponse["averages"] | undefined {
  if (!Array.isArray(ads) || ads.length === 0) {
    return undefined;
  }

  let totalImpr = 0;
  let totalClicks = 0;
  let totalInline = 0;
  let totalSpend = 0;
  let totalLpv = 0;
  let totalHookWsum = 0;
  let totalHoldRateWsum = 0;
  let totalVideoWatchedP50Wsum = 0;
  let totalScrollStopWsum = 0;
  let totalPlays = 0;

  // Acumular resultados por action_type (igual backend)
  // Inicializar com todos os tipos disponíveis para garantir que todos tenham entrada
  const perActionTotals: Record<string, { results: number }> = {};
  if (availableConversionTypes && Array.isArray(availableConversionTypes)) {
    availableConversionTypes.forEach((type) => {
      perActionTotals[type] = { results: 0 };
    });
  }

  ads.forEach((ad: any) => {
    const impressions = Number(ad.impressions || 0);
    const clicks = Number(ad.clicks || 0);
    const inline = Number(ad.inline_link_clicks || 0);
    const spend = Number(ad.spend || 0);
    const lpv = Number(ad.lpv || 0);
    const plays = Number(ad.plays || 0);

    const hook = Number(ad.hook || 0);
    const holdRate = Number(ad.hold_rate || 0);
    const videoWatchedP50 = Number(ad.video_watched_p50 || 0);
    const scrollStop = Number((ad as any).scroll_stop_value ?? (ad as any).scroll_stop_rate ?? ad.video_watched_p50 ?? 0);

    const conversions = (ad.conversions || {}) as Record<string, number>;

    totalImpr += impressions;
    totalClicks += clicks;
    totalInline += inline;
    totalSpend += spend;
    totalLpv += lpv;

    // Pesos por plays para hook/hold/scroll_stop (mesma ideia do backend)
    totalPlays += plays;
    totalHookWsum += hook * plays;
    totalHoldRateWsum += holdRate * plays;
    totalVideoWatchedP50Wsum += videoWatchedP50 * plays;
    totalScrollStopWsum += scrollStop * plays;

    // Somar resultados para TODOS os action_types presentes
    Object.entries(conversions).forEach(([key, value]) => {
      const numVal = Number(value || 0);
      if (!Number.isFinite(numVal) || numVal <= 0) return;
      if (!perActionTotals[key]) {
        perActionTotals[key] = { results: 0 };
      }
      perActionTotals[key].results += numVal;
    });
  });

  const safeDiv = (num: number, den: number) =>
    den > 0 && Number.isFinite(num) && Number.isFinite(den) ? num / den : 0;

  const avgHook = safeDiv(totalHookWsum, totalPlays);
  const avgHoldRate = safeDiv(totalHoldRateWsum, totalPlays);
  const avgVideoWatchedP50 = safeDiv(totalVideoWatchedP50Wsum, totalPlays);
  const avgScrollStop = safeDiv(totalScrollStopWsum, totalPlays);
  const avgCtr = safeDiv(totalClicks, totalImpr);
  const avgWebsiteCtr = safeDiv(totalInline, totalImpr);
  const avgConnectRate = safeDiv(totalLpv, totalInline);
  const avgCpm = safeDiv(totalSpend, totalImpr) * 1000;

  const averagesBase = {
    hook: avgHook,
    hold_rate: avgHoldRate,
    video_watched_p50: avgVideoWatchedP50,
    scroll_stop: avgScrollStop,
    ctr: avgCtr,
    website_ctr: avgWebsiteCtr,
    connect_rate: avgConnectRate,
    cpm: avgCpm,
  };

  const perActionType: Record<string, { results: number; cpr: number; page_conv: number }> = {};

  // Calcular médias para TODOS os action_types (mesmo os com 0 resultados)
  // Isso garante consistência com o backend que sempre cria entradas para todos os tipos disponíveis
  const typesToProcess = availableConversionTypes && Array.isArray(availableConversionTypes)
    ? availableConversionTypes
    : Object.keys(perActionTotals);

  typesToProcess.forEach((key) => {
    const results = perActionTotals[key]?.results || 0;
    const pageConv = safeDiv(results, totalLpv);
    const cpr = safeDiv(totalSpend, results);
    perActionType[key] = {
      results,
      cpr,
      page_conv: pageConv,
    };
  });

  return {
    ...averagesBase,
    per_action_type: perActionType,
  };
}
