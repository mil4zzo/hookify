import { getMetricNumericValueOrNull, type ManagerAverages } from "@/lib/metrics";
import type { RankingsItem } from "@/lib/api/schemas";
import type { ShareItemMetrics } from "./types";

/**
 * Snapshot de métricas de uma linha da aba Criativos, com os MESMOS valores que
 * o modal de detalhamento exibiria: tudo passa pelo registry (`getMetricNumericValueOrNull`),
 * que aplica fallbacks de cálculo idênticos (cpr por actionType, cpmql por
 * leadscore, frequency por impressions/reach, etc.). null = métrica indisponível
 * (o viewer a esconde).
 */
export function buildShareMetricsFromRow(
  row: RankingsItem,
  context: { actionType: string; mqlLeadscoreMin: number },
): ShareItemMetrics {
  const value = (key: string): number | null =>
    getMetricNumericValueOrNull(row as any, key, {
      actionType: context.actionType,
      mqlLeadscoreMin: context.mqlLeadscoreMin,
    });

  return {
    cpmql: value("cpmql"),
    cpr: value("cpr"),
    cpc: value("cpc"),
    cpm: value("cpm"),
    ctr: value("ctr"),
    website_ctr: value("website_ctr"),
    connect_rate: value("connect_rate"),
    page_conv: value("page_conv"),
    scroll_stop: value("scroll_stop"),
    hook: value("hook"),
    hold_rate: value("hold_rate"),
    video_watched_p50: value("video_watched_p50"),
    spend: value("spend"),
    frequency: value("frequency"),
    impressions: value("impressions"),
    reach: value("reach"),
    results: value("results"),
    clicks: value("clicks"),
    // Backend/viewer usam "mql_count"; no registry a chave canônica é "mqls".
    mql_count: value("mqls"),
  };
}

/**
 * Médias do conjunto para dentro do snapshot — a página pública não tem como
 * recalculá-las (não acessa ad_metrics). É a MESMA média do modal de
 * detalhamento (`useManagerAverages`), então a cor/delta do link batem com o
 * que o gestor viu no app.
 *
 * Só as métricas que o modal compara: Visibilidade (spend/frequency/
 * impressions/reach) não mostra média lá e também não mostra aqui.
 */
export function buildShareAverages(averages: ManagerAverages | null | undefined): ShareItemMetrics {
  if (!averages) return {};
  return {
    cpmql: averages.cpmql,
    cpr: averages.cpr,
    cpc: averages.cpc,
    cpm: averages.cpm,
    ctr: averages.ctr,
    website_ctr: averages.website_ctr,
    connect_rate: averages.connect_rate,
    page_conv: averages.page_conv,
    scroll_stop: averages.scroll_stop,
    hook: averages.hook,
    hold_rate: averages.hold_rate,
    video_watched_p50: averages.video_watched_p50,
  };
}
