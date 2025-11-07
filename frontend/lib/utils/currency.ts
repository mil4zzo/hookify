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
 * Formata um valor monetário usando as configurações do usuário
 * @param value Valor numérico a ser formatado
 * @param currency Código da moeda (opcional, usa o padrão das configurações se não fornecido)
 * @returns String formatada com o símbolo da moeda
 * @note Esta função NÃO é reativa. Use useFormatCurrency() em componentes React para reatividade
 */
export function formatCurrency(value: number, currency?: string): string {
  // Obter configurações do store (fora do componente React)
  const settings = useSettingsStore.getState().settings
  const currencyCode = currency || settings.currency
  const locale = currencyLocaleMap[currencyCode] || settings.language

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
      const locale = currencyLocaleMap[currencyCode] || settings.language

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

