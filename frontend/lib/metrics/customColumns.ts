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
import {
  computeLeadscoreFacets,
  histogramStats,
  histogramTop,
  mergeHistograms,
  type CustomHistograms,
  type Histogram,
  type HistogramTop,
  type LeadscoreFacets,
} from "@/lib/utils/customHistogram";

export type { SheetColumnKind, SheetColumnMapping } from "@/lib/api/schemas";

export const CUSTOM_KEY_PREFIX = "custom:";

export type CustomFacet = "avg" | "mqls" | "mql_rate" | "cpmql" | "top";
export type CustomColumnKey = `custom:${string}:${CustomFacet}`;

const FACETS: readonly CustomFacet[] = ["avg", "mqls", "mql_rate", "cpmql", "top"];

export function isCustomColumnKey(key: unknown): key is CustomColumnKey {
  return typeof key === "string" && key.startsWith(CUSTOM_KEY_PREFIX) && parseCustomColumnKey(key) !== null;
}

export function buildCustomColumnKey(columnId: string, facet: CustomFacet): CustomColumnKey {
  return `${CUSTOM_KEY_PREFIX}${columnId}:${facet}`;
}

/**
 * `custom:<id>:<faceta>` → partes; null para qualquer outra coisa. O `columnId` é o
 * id da coluna (grupo) ou, em chave salva antes do agrupamento, o id de um vínculo.
 */
export function parseCustomColumnKey(key: string): { columnId: string; facet: CustomFacet } | null {
  if (typeof key !== "string" || !key.startsWith(CUSTOM_KEY_PREFIX)) return null;
  const rest = key.slice(CUSTOM_KEY_PREFIX.length);
  const cut = rest.lastIndexOf(":");
  if (cut <= 0) return null;
  const columnId = rest.slice(0, cut);
  const facet = rest.slice(cut + 1) as CustomFacet;
  if (!columnId || !FACETS.includes(facet)) return null;
  return { columnId, facet };
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

/**
 * IDENTIDADE DA COLUNA = ARQUIVO + NOME DO CABEÇALHO (+ tipo)
 *
 * Cada pack guarda o próprio vínculo (uma linha em sheet_column_mappings), e o
 * histograma gravado em ad_metrics.custom_hist é etiquetado pelo id DESSE vínculo.
 * Sete packs ligados à mesma "IDADE" do mesmo arquivo eram sete colunas no Manager,
 * cada uma preenchida só para os anúncios do seu pack.
 *
 * Agora a coluna oferecida é o GRUPO de vínculos com o mesmo arquivo
 * (`spreadsheet_id`) e o mesmo cabeçalho normalizado (`normalizeSheetColumnName`:
 * sem diferença de caixa, acento e espaço). A aba fica fora: um lançamento novo
 * em outra aba do mesmo arquivo é a mesma coluna. O tipo entra na identidade —
 * categoria nunca soma com número.
 *
 * Nenhum dado é reescrito: o valor do grupo é a SOMA dos histogramas dos vínculos
 * (contagens somam exato). O corte de MQL continua por vínculo (é do pack): com
 * cortes iguais soma-se o histograma; com cortes diferentes, os MQLs de cada
 * vínculo são contados com o próprio corte e somados.
 *
 * Chave de métrica: `custom:<colunaId>:<faceta>`. A chave antiga
 * `custom:<mappingId>:<faceta>` (regras, preferências e Boards salvos antes) segue
 * valendo como APELIDO do grupo que contém aquele vínculo — ver
 * `customColumnsRegistry` e `resolveCustomColumn`.
 */
export interface CustomColumnDef {
  key: CustomColumnKey;
  /** id da coluna (grupo arquivo + cabeçalho); é o meio da chave `custom:` */
  columnId: string;
  /** vínculos do grupo — um por pack que tem essa coluna */
  mappingIds: readonly string[];
  mappings: readonly SheetColumnMapping[];
  facet: CustomFacet;
  kind: SheetColumnKind;
  label: string;
  /** rótulo curto para cabeçalho apertado (o próprio rótulo do vínculo) */
  shortLabel: string;
  formatKind: MetricFormatKind | "text";
  polarity: MetricPolarity;
  /** vínculo representante (o de menor posição): rótulo, tipo e corte para exibição */
  mapping: SheetColumnMapping;
}

/** Vínculo com a identidade da coluna já resolvida (ver `collectPackMappings`). */
export type GroupedSheetColumnMapping = SheetColumnMapping & { column_group?: string };

/** "  Patrimônio  Líquido " → "patrimonio liquido". */
export function normalizeSheetColumnName(name: string | null | undefined): string {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Hash de 53 bits (cyrb53), estável entre sessões — a chave vai para regra e preferência. */
function stableHash(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * Id da coluna. Sem arquivo ou sem cabeçalho gravado não há como reconhecer a mesma
 * coluna em outro pack: cai no id do próprio vínculo (coluna sozinha, como antes).
 */
export function sheetColumnGroupId(
  spreadsheetId: string | null | undefined,
  columnName: string | null | undefined,
  kind: SheetColumnKind,
  fallbackMappingId: string,
): string {
  const file = String(spreadsheetId ?? "").trim();
  const name = normalizeSheetColumnName(columnName);
  if (!file || !name) return fallbackMappingId;
  return `c${stableHash(`${file}\u0001${name}\u0001${kind}`)}`;
}

function groupIdOf(mapping: GroupedSheetColumnMapping): string {
  return mapping.column_group || mapping.id;
}

export function buildCustomColumnDefs(mappings: ReadonlyArray<GroupedSheetColumnMapping>): CustomColumnDef[] {
  const groups = new Map<string, GroupedSheetColumnMapping[]>();
  for (const mapping of mappings) {
    const id = groupIdOf(mapping);
    const list = groups.get(id);
    if (list) list.push(mapping);
    else groups.set(id, [mapping]);
  }
  const out: CustomColumnDef[] = [];
  for (const [columnId, members] of groups) {
    const mapping = members[0];
    const mappingIds = members.map((m) => m.id);
    for (const facet of facetsForKind(mapping.kind)) {
      out.push({
        key: buildCustomColumnKey(columnId, facet),
        columnId,
        mappingIds,
        mappings: members,
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
  sheet_integration?: { spreadsheet_id?: string | null; column_mappings?: SheetColumnMapping[] | null } | null;
}

/**
 * União dos vínculos dos packs selecionados, sem repetição (por id), na ordem de
 * position e rótulo, cada um com a identidade da coluna (`column_group`). Vínculos
 * do mesmo grupo viram UMA coluna em `buildCustomColumnDefs`.
 */
export function collectPackMappings(
  packs: ReadonlyArray<PackWithMappings> | null | undefined,
  selectedIds: ReadonlySet<string> | ReadonlyArray<string> | null | undefined,
): GroupedSheetColumnMapping[] {
  if (!packs?.length || !selectedIds) return [];
  const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds as ReadonlyArray<string>);
  if (selected.size === 0) return [];
  const byId = new Map<string, GroupedSheetColumnMapping>();
  for (const pack of packs) {
    if (!selected.has(pack.id)) continue;
    const list = pack.sheet_integration?.column_mappings;
    if (!Array.isArray(list)) continue;
    const spreadsheetId = pack.sheet_integration?.spreadsheet_id;
    for (const m of list) {
      if (!m || typeof m.id !== "string" || byId.has(m.id)) continue;
      byId.set(m.id, { ...m, column_group: sheetColumnGroupId(spreadsheetId, m.column_name, m.kind, m.id) });
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
  def: Pick<CustomColumnDef, "mappings" | "facet" | "kind">,
): number | null {
  if (def.kind === "leadscore") {
    const spend = Number(row?.spend ?? 0);
    const facets = computeColumnLeadscoreFacets(row?.custom_histograms, def.mappings, Number.isFinite(spend) ? spend : 0);
    if (!facets) return null;
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
    return histogramStats(getCustomHistogram(row, def))?.avg ?? null;
  }
  return null;
}

/**
 * Histograma da coluna numa linha: a soma dos histogramas dos vínculos do grupo.
 * Null quando nenhum vínculo tem dado na linha. Com um vínculo só, devolve o
 * próprio objeto da linha (sem cópia).
 */
export function getCustomHistogram(
  row: CustomHistogramSource | null | undefined,
  def: Pick<CustomColumnDef, "mappings">,
): Histogram | null {
  return mergeColumnHistograms(row?.custom_histograms, def.mappings);
}

export function mergeColumnHistograms(
  all: CustomHistograms | null | undefined,
  mappings: ReadonlyArray<Pick<SheetColumnMapping, "id">>,
): Histogram | null {
  if (!all) return null;
  let single: Histogram | null = null;
  let merged: Histogram | null = null;
  for (const m of mappings) {
    const hist = all[m.id];
    if (!hist) continue;
    if (!single && !merged) {
      single = hist;
      continue;
    }
    if (!merged) merged = mergeHistograms({}, single);
    mergeHistograms(merged, hist);
  }
  return merged ?? single;
}

/**
 * As quatro facetas de leadscore de uma COLUNA (grupo de vínculos), respeitando o
 * corte de cada vínculo. Cortes iguais: soma o histograma e calcula uma vez (é o
 * caso da configuração em massa). Cortes diferentes: MQLs contados vínculo a
 * vínculo com o próprio corte e somados; qualquer vínculo SEM corte com dado na
 * linha deixa MQL/%MQL/CPMQL nulos — corte nulo nunca vira 0.
 */
export function computeColumnLeadscoreFacets(
  all: CustomHistograms | null | undefined,
  mappings: ReadonlyArray<Pick<SheetColumnMapping, "id" | "config">>,
  spend: number,
): LeadscoreFacets | null {
  if (!all) return null;
  const parts: Array<{ hist: Histogram; cut: number | null }> = [];
  for (const m of mappings) {
    const hist = all[m.id];
    if (hist) parts.push({ hist, cut: m.config?.mql_min ?? null });
  }
  if (parts.length === 0) return null;
  const cut0 = parts[0].cut;
  if (parts.every((p) => p.cut === cut0)) {
    const hist = parts.length === 1 ? parts[0].hist : parts.reduce<Histogram>((acc, p) => mergeHistograms(acc, p.hist), {});
    return computeLeadscoreFacets(hist, spend, cut0);
  }
  let n = 0;
  let weighted = 0;
  let mqls: number | null = 0;
  for (const p of parts) {
    const f = computeLeadscoreFacets(p.hist, 0, p.cut);
    n += f.n;
    weighted += (f.avg ?? 0) * f.n;
    mqls = mqls === null || f.mqls === null ? null : mqls + f.mqls;
  }
  return {
    n,
    avg: n > 0 ? weighted / n : null,
    mqls,
    mql_rate: mqls === null || n === 0 ? null : mqls / n,
    // mesma regra do V1: 0 sem MQL ou sem gasto
    cpmql: mqls === null ? null : mqls > 0 && spend > 0 ? spend / mqls : 0,
  };
}

/** Resposta majoritária de uma coluna de categoria numa linha. */
export function getCustomTopValue(
  row: CustomHistogramSource | null | undefined,
  def: Pick<CustomColumnDef, "mappings">,
): HistogramTop | null {
  return histogramTop(getCustomHistogram(row, def));
}

/**
 * Resolve uma chave `custom:` contra as colunas disponíveis: pela chave atual ou,
 * para o que foi salvo antes do agrupamento, pelo id de qualquer vínculo do grupo
 * (`custom:<mappingId>:<faceta>` é apelido da coluna que contém o vínculo).
 */
export function resolveCustomColumn(
  key: string,
  defs: ReadonlyArray<CustomColumnDef>,
): CustomColumnDef | null {
  const parsed = parseCustomColumnKey(key);
  if (!parsed) return null;
  return (
    defs.find((d) => d.facet === parsed.facet && (d.columnId === parsed.columnId || d.mappingIds.includes(parsed.columnId))) ??
    null
  );
}
