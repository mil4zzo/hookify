import { useSettingsStore } from "@/lib/store/settings";

/**
 * Idioma do app: a ÚNICA fonte do locale usado em número, data e lista.
 *
 * Nenhuma tela escreve "pt-BR" à mão para formatar o que o usuário lê: chama
 * `getAppLocale()` (ou os atalhos abaixo). O idioma vem da preferência do usuário
 * (`settings.language`, a mesma do seletor da Topbar), com `pt-BR` como padrão.
 *
 * Fica FORA daqui, de propósito: chave de comparação que precisa ser a mesma para
 * todo mundo (ex.: normalizar nome para detectar duplicado), página pública do
 * link compartilhado (o idioma é de quem lê, não de quem criou) e campo que
 * interpreta o que o usuário digita (vírgula decimal) — esses seguem fixos.
 */
export const SUPPORTED_LOCALES = ["pt-BR", "en-US", "es-ES"] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = "pt-BR";

export function isSupportedLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Código desconhecido (ou vazio) cai no padrão: nunca um locale que o `Intl` recusa. */
export function getAppLocale(): AppLocale {
  const language = useSettingsStore.getState().settings.language;
  return isSupportedLocale(language) ? language : DEFAULT_LOCALE;
}

/** Número com separador de milhar do idioma (1.234 em pt-BR, 1,234 em en-US). */
export function formatLocaleNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return value.toLocaleString(getAppLocale(), options);
}

/** Data no formato do idioma (31/10/2026 em pt-BR, 10/31/2026 em en-US). */
export function formatLocaleDate(value: Date | string | number, options?: Intl.DateTimeFormatOptions): string {
  return new Date(value).toLocaleDateString(getAppLocale(), options);
}
