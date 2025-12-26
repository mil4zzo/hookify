/**
 * Constantes e tipos relacionados a métricas de anúncios.
 * Centraliza definições para facilitar manutenção e evitar duplicação.
 */

/**
 * Tipo para todas as métricas disponíveis no sistema.
 */
export type MetricKey = "hook" | "website_ctr" | "ctr" | "page_conv" | "hold_rate" | "cpm" | "cpr" | "cpmql" | "connect_rate";

/**
 * Métricas onde menor valor é melhor (ex: CPM, CPR, CPMQL).
 * Quando o valor está acima da média, isso é ruim e deve mostrar seta para cima em vermelho.
 * 
 * Para essas métricas:
 * - Valor < média = bom (verde, seta para baixo)
 * - Valor > média = ruim (vermelho, seta para cima)
 */
export const LOWER_IS_BETTER_METRICS: readonly MetricKey[] = ["cpm", "cpr", "cpmql"] as const;

/**
 * Verifica se uma métrica é do tipo "lower is better".
 * @param metricKey - A chave da métrica a verificar
 * @returns true se a métrica é "lower is better", false caso contrário
 */
export function isLowerBetterMetric(metricKey: MetricKey): boolean {
  return LOWER_IS_BETTER_METRICS.includes(metricKey);
}

