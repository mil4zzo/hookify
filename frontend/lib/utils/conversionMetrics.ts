/**
 * page_conv / overall_conversion: única fórmula compartilhada entre `buildAdMetricsData`
 * (validateAdCriteria.ts, usado por Plano/GOLD/Insights) e `mapRankingRow` (Manager) —
 * ambos consomem a mesma linha de `/ad-performance` e precisam do mesmo cálculo.
 */
export function computeConversionMetrics(
  website_ctr: number,
  connect_rate: number,
  results: number,
  lpv: number
): { page_conv: number; overall_conversion: number } {
  const page_conv = lpv > 0 ? results / lpv : 0;
  const overall_conversion = website_ctr * connect_rate * page_conv;
  return { page_conv, overall_conversion };
}
