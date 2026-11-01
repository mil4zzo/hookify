/**
 * Idiomas do app e o cookie que o guarda. Sem dependência de tela nem de store:
 * o layout do servidor importa daqui (o store de configurações é só do navegador).
 */
export const SUPPORTED_LOCALES = ["pt-BR", "en-US", "es-ES"] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = "pt-BR";

export function isSupportedLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Cookie com o idioma, para o servidor já renderizar a página no idioma certo (sem piscar). */
export const LOCALE_COOKIE = "hookify-locale";

/** Valor de fora (cookie, banco) que pode ser lixo: desconhecido cai no padrão. */
export function resolveLocale(value: unknown): AppLocale {
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}

/** Idioma de quem lê, a partir das preferências do navegador (`navigator.languages`): o primeiro que o app tem completo. */
export function pickLocale(languages: readonly string[]): AppLocale {
  for (const tag of languages) {
    const lang = tag.toLowerCase();
    if (lang.startsWith("pt")) return "pt-BR";
    if (lang.startsWith("en")) return "en-US";
  }
  return DEFAULT_LOCALE;
}
