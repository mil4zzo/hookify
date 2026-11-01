import ptBR from "../../messages/pt-BR.json";
import enUS from "../../messages/en-US.json";
import type { AppLocale } from "./locale";

/**
 * Textos por idioma. O português é a base: o que um idioma ainda não traduziu aparece
 * em português, nunca como chave crua ("onboarding.title") nem em branco. Espanhol
 * entra quando houver tradução; até lá o app em espanhol mostra português.
 */
const CATALOGS: Record<AppLocale, Record<string, unknown>> = {
  "pt-BR": ptBR,
  "en-US": enUS,
  "es-ES": {},
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mergeMessages(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = out[key];
    out[key] = isPlainObject(current) && isPlainObject(value) ? mergeMessages(current, value) : value;
  }
  return out;
}

export function getMessages(locale: AppLocale): Record<string, unknown> {
  return mergeMessages(CATALOGS["pt-BR"], CATALOGS[locale]);
}

/** Todas as chaves folha ("a.b.c") de um catálogo — para conferir paridade entre idiomas. */
export function flattenKeys(messages: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(messages).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return isPlainObject(value) ? flattenKeys(value, path) : [path];
  });
}

/** Catálogo cru de um idioma (sem a base em português), para o teste de paridade. */
export function getRawCatalog(locale: AppLocale): Record<string, unknown> {
  return CATALOGS[locale];
}
