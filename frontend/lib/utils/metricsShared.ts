/**
 * Shared metric helpers used across aggregation utilities.
 */

/**
 * Safely divides two numbers. Returns 0 when denominator is 0.
 */
export function safeDivide(numerator: number, denominator: number): number {
  if (!denominator || Number.isNaN(denominator)) return 0;
  return numerator / denominator;
}

/**
 * Returns retention value at a given second from a video play curve.
 * The curve can be provided in percent [0..100] or decimal [0..1].
 * This function normalizes output to decimal [0..1].
 */
export function getHookAt(curve: number[] | undefined, seconds: number = 3): number {
  if (!Array.isArray(curve) || curve.length === 0) return 0;
  const index = Math.max(0, Math.min(curve.length - 1, seconds));
  const value = Number(curve[index] ?? 0);
  // Normalize: if value looks like percent (e.g., 37), convert to decimal 0.37
  return value > 1 ? value / 100 : value;
}

/**
 * Normalizes an array of retention values to decimals [0..1].
 * If values look like percents (>1), divides by 100.
 */
export function normalizeCurveToDecimal(curve: number[] | undefined): number[] {
  if (!Array.isArray(curve)) return [];
  return curve.map((v) => (v > 1 ? v / 100 : v));
}

/**
 * Verifica se uma métrica está abaixo da média.
 * 
 * @param currentValue - Valor atual da métrica
 * @param averageValue - Valor médio da métrica
 * @returns true se a métrica estiver abaixo da média, false caso contrário
 */
export function isMetricBelowAverage(currentValue: number | null | undefined, averageValue: number | null | undefined): boolean {
  // Se não houver média ou valor atual, não é possível comparar
  if (averageValue == null || currentValue == null) {
    return false;
  }
  
  // Verificar se ambos os valores são finitos
  if (!Number.isFinite(currentValue) || !Number.isFinite(averageValue)) {
    return false;
  }
  
  // Retornar true se o valor atual for menor que a média
  return currentValue < averageValue;
}



