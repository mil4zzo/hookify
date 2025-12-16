/**
 * Utilitários de formatação de dados
 * Funções auxiliares para formatação de números, porcentagens e moedas
 */

/**
 * Abrevia números grandes (K, M, B)
 */
export function abbreviateNumber(number: number, decimals: number = 0): string {
  if (number >= 1_000_000_000) {
    return `${(number / 1_000_000_000).toFixed(decimals > 0 ? decimals : 2)}B`;
  } else if (number >= 1_000_000) {
    return `${(number / 1_000_000).toFixed(decimals > 0 ? decimals : 2)}M`;
  } else if (number >= 10_000) {
    return `${(number / 1_000).toFixed(decimals > 0 ? decimals : 2)}K`;
  } else {
    return `${number.toFixed(decimals)}`;
  }
}

/**
 * Formata moeda para exibição
 * @deprecated Use formatCurrency from '@/lib/utils/currency' instead
 */
export function formatCurrency(value: number): string {
  // Importar dinamicamente para evitar dependência circular
  const { formatCurrency: formatCurrencyWithSettings } = require('@/lib/utils/currency')
  return formatCurrencyWithSettings(value)
}

/**
 * Formata porcentagem para exibição
 */
export function formatPercentage(value: number, decimals: number = 2): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Formata número com separadores de milhares
 */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(value);
}
