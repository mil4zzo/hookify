import ptBR from "../../messages/pt-BR.json";
import enUS from "../../messages/en-US.json";
import manager_morePt from "../../messages/manager-more.pt-BR.json";
import manager_moreEn from "../../messages/manager-more.en-US.json";
import packsPt from "../../messages/packs.pt-BR.json";
import packsEn from "../../messages/packs.en-US.json";
import adsPt from "../../messages/ads.pt-BR.json";
import adsEn from "../../messages/ads.en-US.json";
import metricsPt from "../../messages/metrics.pt-BR.json";
import metricsEn from "../../messages/metrics.en-US.json";
import commonPt from "../../messages/common.pt-BR.json";
import commonEn from "../../messages/common.en-US.json";
import legalPt from "../../messages/legal.pt-BR.json";
import legalEn from "../../messages/legal.en-US.json";
import type { AppLocale } from "./config";

/**
 * Textos por idioma. O português é a base: o que um idioma ainda não traduziu aparece
 * em português, nunca como chave crua ("onboarding.title") nem em branco. Espanhol
 * entra quando houver tradução; até lá o app em espanhol mostra português.
 */
/**
 * O catálogo é dividido por área (um arquivo por área e idioma) para que frentes
 * diferentes editem textos sem se pisar. `messages/pt-BR.json` e `en-US.json` são o
 * núcleo; os demais entram aqui. Chaves de áreas diferentes se fundem (mesmo
 * namespace pode ser dividido), então o nome do arquivo não vira prefixo.
 */
const PT_FILES: Record<string, unknown>[] = [ptBR, manager_morePt, packsPt, adsPt, metricsPt, commonPt, legalPt];
const EN_FILES: Record<string, unknown>[] = [enUS, manager_moreEn, packsEn, adsEn, metricsEn, commonEn, legalEn];

function mergeAll(files: Record<string, unknown>[]): Record<string, unknown> {
  return files.reduce<Record<string, unknown>>((acc, file) => mergeMessages(acc, file), {});
}

const CATALOGS: Record<AppLocale, Record<string, unknown>> = {
  "pt-BR": mergeAll(PT_FILES),
  "en-US": mergeAll(EN_FILES),
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
