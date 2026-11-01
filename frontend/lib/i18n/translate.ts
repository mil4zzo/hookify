import { createTranslator } from "next-intl";
import { getAppLocale } from "./locale";
import { getMessages } from "./messages";
import type { AppLocale } from "./config";

/**
 * Tradução fora de componente (função pura, formatador, texto montado em módulo).
 * Lê o idioma NA HORA da chamada; o componente que a usa já re-renderiza quando o
 * idioma muda (o provider troca o contexto). Dentro de componente, prefira
 * `useTranslations`.
 */
type Translate = (key: string, values?: Record<string, string | number>) => string;
const translators = new Map<AppLocale, Translate>();

export function translate(key: string, values?: Record<string, string | number>): string {
  const locale = getAppLocale();
  let translator = translators.get(locale);
  if (!translator) {
    translator = createTranslator({ locale, messages: getMessages(locale) as never, onError: () => {} }) as unknown as Translate;
    translators.set(locale, translator);
  }
  return translator(key, values);
}
