import { useSettingsStore, useSettings } from '@/lib/store/settings'
import { useMemo } from 'react'

/**
 * Mapear moedas para seus locales apropriados
 */
const currencyLocaleMap: Record<string, string> = {
  'USD': 'en-US',
  'EUR': 'de-DE',
  'GBP': 'en-GB',
  'BRL': 'pt-BR',
  'MXN': 'es-MX',
  'CAD': 'en-CA',
  'AUD': 'en-AU',
  'JPY': 'ja-JP',
  'CNY': 'zh-CN',
}

/**
 * Locale usado em Intl para números e moeda: prioriza o locale típico do código de moeda,
 * senão cai no idioma das configurações (separadores de milhar/decimais corretos por região).
 */
export function getLocaleForFormatting(currencyCode?: string): string {
  const settings = useSettingsStore.getState().settings
  const code = currencyCode ?? settings.currency
  return currencyLocaleMap[code] || settings.language
}

/**
 * Número com separadores de grupo e casas decimais conforme locale (não é moeda).
 */
export function formatLocaleDecimalNumber(value: number, minFraction: number, maxFraction: number): string {
  const locale = getLocaleForFormatting()
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: minFraction,
    maximumFractionDigits: maxFraction,
    useGrouping: true,
  }).format(value)
}

export function formatLocaleInteger(value: number): string {
  return formatLocaleDecimalNumber(value, 0, 0)
}

/**
 * Percentual onde o valor armazenado é razão 0–1 (ex.: hook).
 */
export function formatLocaleRatioPercent(value: number): string {
  const locale = getLocaleForFormatting()
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

/**
 * Percentual onde o valor já está em escala 0–100 (ex.: P50 do vídeo).
 */
export function formatLocaleRawPercent(value: number): string {
  const locale = getLocaleForFormatting()
  const rounded = Math.round(value)
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0, useGrouping: true }).format(rounded)}%`
}

/**
 * Formata um valor monetário usando as configurações do usuário
 * @param value Valor numérico a ser formatado
 * @param currency Código da moeda (opcional, usa o padrão das configurações se não fornecido)
 * @returns String formatada com o símbolo da moeda
 * @note Esta função NÃO é reativa. Use useFormatCurrency() em componentes React para reatividade
 */
export function formatCurrency(value: number, currency?: string): string {
  const settings = useSettingsStore.getState().settings
  const currencyCode = currency || settings.currency
  const locale = getLocaleForFormatting(currencyCode)

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currencyCode,
  }).format(value)
}

/**
 * Hook reativo para formatar moeda que atualiza quando as configurações mudam
 * @returns Função formatCurrency que reage às mudanças de configuração
 */
export function useFormatCurrency() {
  const { settings } = useSettings()

  const formatCurrencyReactive = useMemo(() => {
    return (value: number, currency?: string) => {
      const currencyCode = currency || settings.currency
      const locale = getLocaleForFormatting(currencyCode)

      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: currencyCode,
      }).format(value)
    }
  }, [settings.currency, settings.language])

  return formatCurrencyReactive
}

/**
 * Obtém o símbolo da moeda atual
 * @param currency Código da moeda (opcional)
 * @returns Símbolo da moeda (ex: $, €, £)
 */
export function getCurrencySymbol(currency?: string): string {
  const settings = useSettingsStore.getState().settings
  const currencyCode = currency || settings.currency

  const formatter = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: currencyCode,
  })

  // Extrair o símbolo da moeda
  const parts = formatter.formatToParts(123.45)
  const currencyPart = parts.find(part => part.type === 'currency')
  return currencyPart?.value || currencyCode
}

