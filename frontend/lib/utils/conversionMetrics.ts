/**
 * page_conv / overall_conversion — a fórmula, num lugar só.
 *
 * Nasceu para reconciliar dois consumidores que calculavam a mesma coisa de jeitos
 * ligeiramente diferentes sobre a MESMA linha de `/ad-performance`:
 * `buildAdMetricsData` (Critério de validação) e `mapRankingRow` (Manager). O
 * primeiro morreu na fase 4 dos filtros unificados — o Critério passou a avaliar a
 * linha crua, sem mapper — e sobrou `mapRankingRow`.
 *
 * Continua aqui, e não inlinada, porque `overall_conversion` (website_ctr ×
 * connect_rate × page_conv) não é métrica do registry: é um número composto que só
 * existe neste ponto, e enterrá-lo dentro do mapper esconderia a definição.
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
