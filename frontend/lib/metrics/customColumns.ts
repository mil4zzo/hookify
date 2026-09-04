/**
 * Colunas vinculadas da planilha como métricas do app (migration 140).
 *
 * Chave de métrica: `custom:<mappingId>:<faceta>`. O id do vínculo é a identidade
 * estável (renomear o cabeçalho na planilha não quebra regra, preferência nem Board);
 * a faceta diz QUAL número da coluna a métrica mostra.
 *
 *   leadscore → avg | mqls | mql_rate | cpmql   (as quatro do leadscore V1)
 *   number    → avg                              (mín/máx/mediana só no modal)
 *   category  → top                              (resposta majoritária + fatia)
 */
import type { MetricFormatKind, MetricPolarity } from "@/lib/metrics/definitions";
import type { SheetColumnKind, SheetColumnMapping } from "@/lib/api/schemas";
import { computeLeadscoreFacets, histogramStats, histogramTop, type CustomHistograms, type HistogramTop } from "@/lib/utils/customHistogram";

export type { SheetColumnKind, SheetColumnMapping } from "@/lib/api/schemas";

export const CUSTOM_KEY_PREFIX = "custom:";

export type CustomFacet = "avg" | "mqls" | "mql_rate" | "cpmql" | "top";
export type CustomColumnKey = `custom:${string}:${CustomFacet}`;

const FACETS: readonly CustomFacet[] = ["avg", "mqls", "mql_rate", "cpmql", "top"];

export function isCustomColumnKey(key: unknown): key is CustomColumnKey {
  return typeof key === "string" && key.startsWith(CUSTOM_KEY_PREFIX) && parseCustomColumnKey(key) !== null;
}

export function buildCustomColumnKey(mappingId: string, facet: CustomFacet): CustomColumnKey {
  return `${CUSTOM_KEY_PREFIX}${mappingId}:${facet}`;
}

/** `custom:<id>:<faceta>` → partes; null para qualquer outra coisa. */
export function parseCustomColumnKey(key: string): { mappingId: string; facet: CustomFacet } | null {
  if (typeof key !== "string" || !key.startsWith(CUSTOM_KEY_PREFIX)) return null;
  const rest = key.slice(CUSTOM_KEY_PREFIX.length);
  const cut = rest.lastIndexOf(":");
  if (cut <= 0) return null;
  const mappingId = rest.slice(0, cut);
  const facet = rest.slice(cut + 1) as CustomFacet;
  if (!mappingId || !FACETS.includes(facet)) return null;
  return { mappingId, facet };
}

export function facetsForKind(kind: SheetColumnKind): CustomFacet[] {
  switch (kind) {
    case "leadscore":
      return ["avg", "mqls", "mql_rate", "cpmql"];
    case "number":
      return ["avg"];
    case "category":
      return ["top"];
    default:
      return [];
  }
}

/** Como a faceta se formata. `top` é texto: não passa pelo formatador numérico. */
export function customFacetFormatKind(facet: CustomFacet): MetricFormatKind | "text" {
  switch (facet) {
    case "avg":
      return "decimal";
    case "mqls":
      return "integer";
    case "mql_rate":
      return "ratioPercent";
    case "cpmql":
      return "currency";
    case "top":
      return "text";
  }
}

/** Polaridade: um leadscore maior é melhor, um CPMQL menor é melhor; idade e categoria não têm lado. */
export function customFacetPolarity(kind: SheetColumnKind, facet: CustomFacet): MetricPolarity {
  if (kind === "leadscore") return facet === "cpmql" ? "lower" : "higher";
  return "neutral";
}

export function customColumnLabel(mapping: Pick<SheetColumnMapping, "label" | "kind">, facet: CustomFacet): string {
  const label = (mapping.label || "").trim() || "Coluna";
  if (mapping.kind === "leadscore") {
    switch (facet) {
      case "avg":
        return `${label} médio`;
      case "mqls":
        return `MQLs (${label})`;
      case "mql_rate":
        return `% MQL (${label})`;
      case "cpmql":
        return `CPMQL (${label})`;
      default:
        return label;
    }
  }
  if (mapping.kind === "number" && facet === "avg") return `Média de ${label}`;
  return label;
}

export interface CustomColumnDef {
  key: CustomColumnKey;
  mappingId: string;
  facet: CustomFacet;
  kind: SheetColumnKind;
  label: string;
  /** rótulo curto para cabeçalho apertado (o próprio rótulo do vínculo) */
  shortLabel: string;
  formatKind: MetricFormatKind | "text";
  polarity: MetricPolarity;
  mapping: SheetColumnMapping;
}

export function buildCustomColumnDefs(mappings: ReadonlyArray<SheetColumnMapping>): CustomColumnDef[] {
  const out: CustomColumnDef[] = [];
  for (const mapping of mappings) {
    for (const facet of facetsForKind(mapping.kind)) {
      out.push({
        key: buildCustomColumnKey(mapping.id, facet),
        mappingId: mapping.id,
        facet,
        kind: mapping.kind,
        label: customColumnLabel(mapping, facet),
        shortLabel: mapping.label,
        formatKind: customFacetFormatKind(facet),
        polarity: customFacetPolarity(mapping.kind, facet),
        mapping,
      });
    }
  }
  return out;
}

/** Fonte mínima de vínculos: o que o store de packs carrega. */
export interface PackWithMappings {
  id: string;
  sheet_integration?: { column_mappings?: SheetColumnMapping[] | null } | null;
}

/**
 * União dos vínculos dos packs selecionados, sem repetição (por id), na ordem de
 * position e rótulo. É a lista que o Manager oferece como colunas.
 */
export function collectPackMappings(
  packs: ReadonlyArray<PackWithMappings> | null | undefined,
  selectedIds: ReadonlySet<string> | ReadonlyArray<string> | null | undefined,
): SheetColumnMapping[] {
  if (!packs?.length || !selectedIds) return [];
  const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds as ReadonlyArray<string>);
  if (selected.size === 0) return [];
  const byId = new Map<string, SheetColumnMapping>();
  for (const pack of packs) {
    if (!selected.has(pack.id)) continue;
    const list = pack.sheet_integration?.column_mappings;
    if (!Array.isArray(list)) continue;
    for (const m of list) {
      if (m && typeof m.id === "string" && !byId.has(m.id)) byId.set(m.id, m);
    }
  }
  return Array.from(byId.values()).sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id),
  );
}

export function hasCustomMappings(
  packs: ReadonlyArray<PackWithMappings> | null | undefined,
  selectedIds: ReadonlySet<string> | ReadonlyArray<string> | null | undefined,
): boolean {
  return collectPackMappings(packs, selectedIds).length > 0;
}

/** Linha mínima que carrega histogramas (linha do Manager, filha, detalhe). */
export interface CustomHistogramSource {
  spend?: number | string | null;
  custom_histograms?: CustomHistograms | null;
}

/**
 * Valor NUMÉRICO de uma faceta para uma linha; null = sem dado ou não se aplica.
 * `top` não é número (ver `getCustomTopValue`).
 */
export function getCustomMetricValue(
  row: CustomHistogramSource | null | undefined,
  def: Pick<CustomColumnDef, "mappingId" | "facet" | "kind" | "mapping">,
): number | null {
  const hist = row?.custom_histograms?.[def.mappingId];
  if (!hist) return null;
  if (def.kind === "leadscore") {
    const spend = Number(row?.spend ?? 0);
    const facets = computeLeadscoreFacets(hist, Number.isFinite(spend) ? spend : 0, def.mapping.config?.mql_min ?? null);
    switch (def.facet) {
      case "avg":
        return facets.avg;
      case "mqls":
        return facets.mqls;
      case "mql_rate":
        return facets.mql_rate;
      case "cpmql":
        return facets.cpmql;
      default:
        return null;
    }
  }
  if (def.kind === "number" && def.facet === "avg") {
    return histogramStats(hist)?.avg ?? null;
  }
  return null;
}

/** Resposta majoritária de uma coluna de categoria numa linha. */
export function getCustomTopValue(
  row: CustomHistogramSource | null | undefined,
  mappingId: string,
): HistogramTop | null {
  return histogramTop(row?.custom_histograms?.[mappingId]);
}

/** Resolve a definição de uma chave `custom:` contra a lista de vínculos disponíveis. */
export function resolveCustomColumn(
  key: string,
  mappings: ReadonlyArray<SheetColumnMapping>,
): CustomColumnDef | null {
  const parsed = parseCustomColumnKey(key);
  if (!parsed) return null;
  const mapping = mappings.find((m) => m.id === parsed.mappingId);
  if (!mapping || !facetsForKind(mapping.kind).includes(parsed.facet)) return null;
  return {
    key: key as CustomColumnKey,
    mappingId: mapping.id,
    facet: parsed.facet,
    kind: mapping.kind,
    label: customColumnLabel(mapping, parsed.facet),
    shortLabel: mapping.label,
    formatKind: customFacetFormatKind(parsed.facet),
    polarity: customFacetPolarity(mapping.kind, parsed.facet),
    mapping,
  };
}
