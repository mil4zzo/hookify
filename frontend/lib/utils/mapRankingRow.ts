export type ManagerTab = "individual" | "por-anuncio" | "por-conjunto" | "por-campanha";

/** Deriva o nome de exibição conforme o agrupamento. */
export function resolveAdName(row: any, tab: ManagerTab): string {
  if (tab === "por-conjunto") return row.ad_name || row.adset_name || row.adset_id;
  if (tab === "por-campanha") return row.ad_name || row.campaign_name || row.campaign_id;
  return row.ad_name; // por-anuncio / individual: sem sobrescrita
}

/** Resolve a chave de grupo para casar com seriesByGroup. */
export function resolveGroupKey(row: any, tab: ManagerTab): string {
  if (tab === "individual")    return String(row?.group_key || row?.ad_id || "");
  if (tab === "por-conjunto")  return String(row?.group_key || row?.adset_id || "");
  if (tab === "por-campanha")  return String(row?.group_key || row?.campaign_id || "");
  return String(row?.group_key || row?.ad_name || row?.ad_id || ""); // por-anuncio
}

/**
 * Mapeia uma linha bruta da RPC para o formato do Manager.
 * Unifica a regra de cpm em todas as abas: NaN/Infinity/ausente → 0.
 */
export function mapRankingRow(row: any, actionType: string, tab: ManagerTab) {
  const conversionsObj = row.conversions || {};
  const results = actionType ? Number(conversionsObj[actionType] || 0) : 0;
  const lpv = Number(row.lpv || 0);
  const spend = Number(row.spend || 0);
  const page_conv = lpv > 0 ? results / lpv : 0;
  const cpr = results > 0 ? spend / results : 0;
  const cpm = Number.isFinite(row.cpm) ? row.cpm : 0;
  const website_ctr = typeof row.website_ctr === "number" ? row.website_ctr : 0;
  const connect_rate = Number(row.connect_rate || 0);
  const overall_conversion = website_ctr * connect_rate * page_conv;
  return {
    ...row,
    ad_name: resolveAdName(row, tab),
    lpv,
    spend,
    cpr,
    cpm,
    page_conv,
    overall_conversion,
    website_ctr,
    connect_rate,
    video_total_plays: Number(row.plays || 0),
    conversions: conversionsObj,
    series: null,
    series_loading: false,
    creative: {},
  };
}
