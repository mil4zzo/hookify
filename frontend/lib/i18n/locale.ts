import { useSettingsStore } from "@/lib/store/settings";
import { resolveLocale, type AppLocale } from "./config";

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
export { SUPPORTED_LOCALES, DEFAULT_LOCALE, LOCALE_COOKIE, isSupportedLocale, resolveLocale, pickLocale, type AppLocale } from "./config";

// Só a página pública do link compartilhado usa: lá o leitor é anônimo e o idioma é o dele, não o da conta.
let localeOverride: AppLocale | null = null;
export function setLocaleOverride(locale: AppLocale | null): void {
  localeOverride = locale;
}

/** Código desconhecido (ou vazio) cai no padrão: nunca um locale que o `Intl` recusa. */
export function getAppLocale(): AppLocale {
  return localeOverride ?? resolveLocale(useSettingsStore.getState().settings.language);
}

/** Número com separador de milhar do idioma (1.234 em pt-BR, 1,234 em en-US). */
export function formatLocaleNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return value.toLocaleString(getAppLocale(), options);
}

/** Data no formato do idioma (31/10/2026 em pt-BR, 10/31/2026 em en-US). */
export function formatLocaleDate(value: Date | string | number, options?: Intl.DateTimeFormatOptions): string {
  return new Date(value).toLocaleDateString(getAppLocale(), options);
}
