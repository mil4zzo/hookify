/**
 * Utilitários para calcular métricas de funil de conversão
 */

/**
 * Calcula a métrica de "Conversão geral" (Overall Conversion)
 * Fórmula: website_ctr * connect_rate * page_conv
 * 
 * Esta métrica representa a eficiência geral do funil de conversão,
 * útil para identificar anúncios com funil bom mas que podem estar
 * sendo prejudicados por Hook baixo ou CPM alto.
 * 
 * @param websiteCtr - Website CTR (taxa de cliques no site)
 * @param connectRate - Connect Rate (taxa de conexão/landing page views)
 * @param pageConv - Page Conversion (taxa de conversão na página)
 * @returns Valor da conversão geral (0 a 1, onde 1 = 100%)
 */
export function calculateOverallConversion(
  websiteCtr: number,
  connectRate: number,
  pageConv: number
): number {
  // Garantir que os valores são números válidos
  const wctr = Number.isFinite(websiteCtr) ? Math.max(0, websiteCtr) : 0;
  const cr = Number.isFinite(connectRate) ? Math.max(0, connectRate) : 0;
  const pc = Number.isFinite(pageConv) ? Math.max(0, pageConv) : 0;
  
  return wctr * cr * pc;
}

/**
 * Calcula a conversão geral a partir de um objeto de anúncio
 * 
 * @param ad - Objeto do anúncio (RankingsItem ou similar)
 * @param actionType - Tipo de ação/conversão para calcular page_conv
 * @returns Valor da conversão geral
 */
export function calculateOverallConversionFromAd(
  ad: any,
  actionType: string
): number {
  const websiteCtr = Number(ad.website_ctr || 0);
  const connectRate = Number(ad.connect_rate || 0);
  const lpv = Number(ad.lpv || 0);
  const results = actionType ? Number(ad.conversions?.[actionType] || 0) : 0;
  const pageConv = lpv > 0 ? results / lpv : 0;
  
  return calculateOverallConversion(websiteCtr, connectRate, pageConv);
}

/**
 * Formata a conversão geral como porcentagem
 * 
 * @param value - Valor da conversão geral (0 a 1)
 * @param decimals - Número de casas decimais (padrão: 3)
 * @returns String formatada (ex: "0.123%")
 */
export function formatOverallConversion(
  value: number,
  decimals: number = 3
): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0%";
  }
  return `${(value * 100).toFixed(decimals)}%`;
}

