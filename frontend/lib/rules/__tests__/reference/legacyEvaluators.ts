/**
 * CÓDIGO MORTO, DE PROPÓSITO — congelamento dos avaliadores de filtro que existiam
 * antes da unificação (documentation/plano-filtros-unificados.md, fase 0).
 *
 * PARA QUE SERVE
 *   Ser a referência dos testes DIFERENCIAIS das fases 1 e 3: o motor novo
 *   (`lib/rules/evaluate.ts`) tem de dar a MESMA resposta que estas funções em toda
 *   combinação de entrada, EXCETO nos casos que a unificação mudou de propósito —
 *   e esses ficam listados um a um no teste, nunca escondidos numa tolerância.
 *   O padrão é o mesmo de `packMembership.test.ts`: manter a implementação antiga
 *   como função de referência e provar equivalência sobre inputs adversariais, em
 *   vez de confiar numa prova no papel.
 *
 * REGRAS DESTE ARQUIVO
 *   - Cópia VERBATIM do comportamento de 2026-08-28 (só os tipos foram inlinados,
 *     para o arquivo não morrer quando `ColumnFilter.tsx` e `applyRowFilters.ts`
 *     forem apagados na fase 3). Nada aqui se conserta: um bug copiado é um bug
 *     que o diferencial precisa ver.
 *   - Nenhum import de código de produção. Este arquivo tem de sobreviver à deleção
 *     dos originais.
 *   - Ninguém em produção importa daqui. Só os testes.
 *
 * ORIGEM DE CADA BLOCO (commit 5d20005, 2026-08-28)
 *   1. components/manager/managerTableColumns.tsx  → matchesTextFilter, matchesDateFilter
 *   2. components/manager/ManagerTable.tsx         → applyNumericFilter (NÃO divide: a
 *                                                    FilterBar converte % na entrada)
 *   3. components/manager/managerTableMetricColumns.tsx → applyPercentageFilter (heurística > 1)
 *   4. lib/utils/applyRowFilters.ts                → applyNumericFilterChild (heurística > 1),
 *                                                    applyTextFilterChild, applyStatusFilterChild
 *   5. lib/rules/evaluate.ts                      → compareNumeric, compareText, compareDate
 *   6. lib/utils/validateAdCriteria.ts             → evaluateCondition (operadores SCREAMING_CASE)
 */

/* ------------------------------------------------------------------ *
 * Tipos inlinados (cópia de components/common/ColumnFilter.tsx)
 * ------------------------------------------------------------------ */

export type LegacyFilterOperator = ">" | "<" | ">=" | "<=" | "=" | "!=";
export type LegacyTextFilterOperator =
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "equals"
  | "not_equals";

export interface LegacyFilterValue {
  operator: LegacyFilterOperator;
  value: number | null;
}

export interface LegacyTextFilterValue {
  operator: LegacyTextFilterOperator;
  value: string | null;
}

export interface LegacyStatusFilterValue {
  selectedStatuses: string[];
  totalOptions?: number;
}

export interface LegacyDateFilterValue {
  operator: LegacyFilterOperator;
  value: string | null;
}

/* ------------------------------------------------------------------ *
 * 1. Manager — tabela pai (managerTableColumns.tsx)
 * ------------------------------------------------------------------ */

/** VERBATIM de managerTableColumns.tsx:81 */
export function matchesTextFilter(rawValue: string, filterValue: LegacyTextFilterValue | undefined): boolean {
  if (!filterValue || filterValue.value === null || filterValue.value === undefined) {
    return true;
  }
  const fieldValue = rawValue.toLowerCase();
  const searchValue = String(filterValue.value).toLowerCase();

  switch (filterValue.operator) {
    case "contains":
      return fieldValue.includes(searchValue);
    case "not_contains":
      return !fieldValue.includes(searchValue);
    case "starts_with":
      return fieldValue.startsWith(searchValue);
    case "ends_with":
      return fieldValue.endsWith(searchValue);
    case "equals":
      return fieldValue === searchValue;
    case "not_equals":
      return fieldValue !== searchValue;
    default:
      return true;
  }
}

/** VERBATIM de managerTableColumns.tsx:129 */
export function matchesDateFilter(rowDate: string | null, filterValue: LegacyDateFilterValue | undefined): boolean {
  if (!filterValue || !filterValue.value) return true;
  // Linha sem data (ad ainda não ressincronizado desde a migration 115) não pode satisfazer
  // um recorte temporal — sai do resultado em vez de fingir que é do período.
  if (!rowDate) return false;
  const target = filterValue.value;
  switch (filterValue.operator) {
    case ">":
      return rowDate > target;
    case "<":
      return rowDate < target;
    case ">=":
      return rowDate >= target;
    case "<=":
      return rowDate <= target;
    case "=":
      return rowDate === target;
    case "!=":
      return rowDate !== target;
    default:
      return true;
  }
}

/* ------------------------------------------------------------------ *
 * 2. Manager — comparador numérico da tabela pai (ManagerTable.tsx:629)
 *    NÃO converte porcentagem: a FilterBar já grava 0-1 (linha 429).
 * ------------------------------------------------------------------ */

/** VERBATIM de ManagerTable.tsx:629 (sem o useCallback) */
export function applyNumericFilter(
  rowValue: number | null | undefined,
  filterValue: LegacyFilterValue | undefined,
): boolean {
  if (!filterValue || filterValue.value === null || filterValue.value === undefined || isNaN(filterValue.value)) {
    return true; // Sem filtro, mostrar tudo
  }

  if (rowValue === null || rowValue === undefined || isNaN(rowValue) || !isFinite(rowValue)) {
    return false; // Valor inválido, não mostrar
  }

  const { operator, value: filterNum } = filterValue;

  switch (operator) {
    case ">":
      return rowValue > filterNum!;
    case "<":
      return rowValue < filterNum!;
    case ">=":
      return rowValue >= filterNum!;
    case "<=":
      return rowValue <= filterNum!;
    case "=":
      return Math.abs(rowValue - filterNum!) < 0.0001; // Tolerância para comparação de floats
    case "!=":
      return Math.abs(rowValue - filterNum!) >= 0.0001;
    default:
      return true;
  }
}

/* ------------------------------------------------------------------ *
 * 3. Manager — colunas de porcentagem (managerTableMetricColumns.tsx:107)
 *    A PRIMEIRA das duas heurísticas "> 1". Erra em `hook > 0,5%`.
 * ------------------------------------------------------------------ */

/** VERBATIM da closure `normalizeFilter` de applyPercentageFilterMaybeArray */
export function applyPercentageFilter(
  rowValue: number | null | undefined,
  singleFilter: LegacyFilterValue | undefined,
): boolean {
  if (!singleFilter) return true;
  const filterNum = singleFilter.value;
  if (filterNum !== null && filterNum !== undefined && !isNaN(filterNum)) {
    const normalizedFilter = filterNum > 1 ? filterNum / 100 : filterNum;
    return applyNumericFilter(rowValue, { ...singleFilter, value: normalizedFilter });
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * 4. Manager — linhas-filhas (lib/utils/applyRowFilters.ts)
 *    A SEGUNDA heurística "> 1", com a lista fixa de colunas de porcentagem.
 * ------------------------------------------------------------------ */

/** VERBATIM de applyRowFilters.ts:9 */
export const LEGACY_PERCENTAGE_COLUMNS = new Set(["hook", "ctr", "website_ctr", "connect_rate", "page_conv"]);

/** VERBATIM de applyRowFilters.ts:17 */
export const LEGACY_TEXT_COLUMN_TO_FIELD: Record<string, string> = {
  ad_name: "ad_name",
  adset_name_filter: "adset_name",
  campaign_name_filter: "campaign_name",
};

/** VERBATIM de applyRowFilters.ts:23 */
export function applyNumericFilterChild(
  rowValue: number | null | undefined,
  filterValue: LegacyFilterValue | undefined,
  isPercentage: boolean,
): boolean {
  if (!filterValue || filterValue.value === null || filterValue.value === undefined || isNaN(filterValue.value)) {
    return true;
  }
  if (rowValue === null || rowValue === undefined || isNaN(rowValue) || !isFinite(rowValue)) {
    return false;
  }
  let filterNum = filterValue.value!;
  if (isPercentage && filterNum > 1) {
    filterNum = filterNum / 100;
  }
  switch (filterValue.operator) {
    case ">":
      return rowValue > filterNum;
    case "<":
      return rowValue < filterNum;
    case ">=":
      return rowValue >= filterNum;
    case "<=":
      return rowValue <= filterNum;
    case "=":
      return Math.abs(rowValue - filterNum) < 0.0001;
    case "!=":
      return Math.abs(rowValue - filterNum) >= 0.0001;
    default:
      return true;
  }
}

/** VERBATIM de applyRowFilters.ts:56 */
export function applyTextFilterChild(
  row: Record<string, unknown>,
  filterValue: LegacyTextFilterValue | undefined,
  fieldName: string,
): boolean {
  if (!filterValue || filterValue.value === null || filterValue.value === undefined) {
    return true;
  }
  const fieldValue = String((row[fieldName] ?? "") as string).toLowerCase();
  const searchValue = String(filterValue.value).toLowerCase();
  switch (filterValue.operator) {
    case "contains":
      return fieldValue.includes(searchValue);
    case "not_contains":
      return !fieldValue.includes(searchValue);
    case "starts_with":
      return fieldValue.startsWith(searchValue);
    case "ends_with":
      return fieldValue.endsWith(searchValue);
    case "equals":
      return fieldValue === searchValue;
    case "not_equals":
      return fieldValue !== searchValue;
    default:
      return true;
  }
}

/** VERBATIM de applyRowFilters.ts:80 */
export function applyStatusFilterChild(
  row: Record<string, unknown>,
  filterValue: LegacyStatusFilterValue | undefined,
): boolean {
  if (!filterValue?.selectedStatuses?.length) return true;
  const status = row.effective_status as string | undefined;
  if (!status) return false;
  return filterValue.selectedStatuses.includes(status);
}

/** VERBATIM de columnFilters.ts:7 — o laço abaixo depende dele. */
export function getColumnId(filterId: string): string {
  const idx = filterId.indexOf("__");
  return idx >= 0 ? filterId.slice(0, idx) : filterId;
}

export type LegacyColumnFilterEntry = { id: string; value: unknown };

/**
 * VERBATIM de applyRowFilters.ts:94 — o laço inteiro, não só os comparadores.
 * Sem ele o diferencial provaria só as folhas e deixaria passar a composição
 * (agrupamento por coluna, desvio de tags, escolha do ramo numérico × texto).
 */
export function applyRowFiltersLegacy(
  row: Record<string, unknown>,
  columnFilters: LegacyColumnFilterEntry[],
): boolean {
  if (!columnFilters.length) return true;

  const byColumn = new Map<string, unknown[]>();
  for (const f of columnFilters) {
    if (!f.value) continue;
    const colId = getColumnId(f.id);
    const arr = byColumn.get(colId) ?? [];
    arr.push(f.value);
    byColumn.set(colId, arr);
  }

  for (const [colId, values] of byColumn) {
    for (const v of values) {
      if (!v || typeof v !== "object") continue;

      // Tags não se aplicam aqui: as linhas de filho não carregam tags.
      if (colId === "tags") continue;

      if ("selectedStatuses" in v) {
        if (!applyStatusFilterChild(row, v as LegacyStatusFilterValue)) return false;
        continue;
      }

      if ("operator" in v) {
        const fv = v as LegacyFilterValue | LegacyTextFilterValue;
        if ("value" in fv && typeof (fv as LegacyTextFilterValue).value === "string") {
          const fieldName = LEGACY_TEXT_COLUMN_TO_FIELD[colId] ?? colId;
          if (!applyTextFilterChild(row, fv as LegacyTextFilterValue, fieldName)) return false;
        } else {
          const numericValue = colId === "results" ? (row.results as number) : (row[colId] as number);
          const isPct = LEGACY_PERCENTAGE_COLUMNS.has(colId);
          if (!applyNumericFilterChild(numericValue ?? null, fv as LegacyFilterValue, isPct)) return false;
        }
        continue;
      }
    }
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * 5. Boards (lib/rules/evaluate.ts) — a implementação CORRETA da escala:
 *    divide por 100 incondicionalmente, porque a escala de gravação é conhecida.
 * ------------------------------------------------------------------ */

/** VERBATIM de boards/evaluate.ts:29 */
export function compareNumeric(rowValue: number, target: number, operator: string): boolean {
  switch (operator) {
    case ">":
      return rowValue > target;
    case "<":
      return rowValue < target;
    case ">=":
      return rowValue >= target;
    case "<=":
      return rowValue <= target;
    // Mesma tolerância do Manager: comparar float por igualdade exata nunca casa.
    case "=":
      return Math.abs(rowValue - target) < 0.0001;
    case "!=":
      return Math.abs(rowValue - target) >= 0.0001;
    default:
      return true;
  }
}

/** VERBATIM de boards/evaluate.ts:49 */
export function compareText(rawValue: string, target: string, operator: string): boolean {
  const value = rawValue.toLowerCase();
  const needle = target.toLowerCase();
  switch (operator) {
    case "contains":
      return value.includes(needle);
    case "not_contains":
      return !value.includes(needle);
    case "starts_with":
      return value.startsWith(needle);
    case "ends_with":
      return value.endsWith(needle);
    case "equals":
      return value === needle;
    case "not_equals":
      return value !== needle;
    default:
      return true;
  }
}

/** VERBATIM de boards/evaluate.ts:71 */
export function compareDate(rowDate: string, target: string, operator: string): boolean {
  switch (operator) {
    case ">":
      return rowDate > target;
    case "<":
      return rowDate < target;
    case ">=":
      return rowDate >= target;
    case "<=":
      return rowDate <= target;
    case "=":
      return rowDate === target;
    default:
      return true;
  }
}

/* ------------------------------------------------------------------ *
 * 6. Critério de validação (lib/utils/validateAdCriteria.ts:56)
 *    NUNCA divide por 100 — e devolve FALSE para campo ausente, que é o que
 *    transformava os 11 campos não-populados em "rejeita todo anúncio".
 * ------------------------------------------------------------------ */

export interface LegacyValidationCondition {
  field?: string;
  operator?: string;
  value?: string;
}

/** VERBATIM de validateAdCriteria.ts:56 (com getFieldInfo inlinado — ver LEGACY_FIELD_TYPES) */
export function evaluateCondition(
  condition: LegacyValidationCondition,
  metrics: Record<string, any>,
  fieldType: "text" | "numeric" | "integer" | "date" | undefined,
): boolean {
  const fieldValue = metrics[condition.field as string];
  const conditionValue = condition.value;
  const operator = condition.operator;

  // Se o campo não existe nas métricas, retorna false
  if (fieldValue === undefined || fieldValue === null) {
    return false;
  }

  const resolvedType = fieldType || "text";

  // Converter valores para comparação
  let metricValue: any = fieldValue;
  let compareValue: any = conditionValue;

  if (resolvedType === "integer" || resolvedType === "numeric") {
    metricValue = Number(metricValue);
    compareValue = Number(compareValue);

    if (isNaN(metricValue) || isNaN(compareValue)) {
      return false;
    }
  }

  // Avaliar operador
  switch (operator) {
    case "EQUAL":
      return metricValue === compareValue;
    case "NOT_EQUAL":
      return metricValue !== compareValue;
    case "GREATER_THAN":
      return metricValue > compareValue;
    case "GREATER_THAN_OR_EQUAL":
      return metricValue >= compareValue;
    case "LESS_THAN":
      return metricValue < compareValue;
    case "LESS_THAN_OR_EQUAL":
      return metricValue <= compareValue;
    case "CONTAIN":
      return String(metricValue).toLowerCase().includes(String(compareValue).toLowerCase());
    case "NOT_CONTAIN":
      return !String(metricValue).toLowerCase().includes(String(compareValue).toLowerCase());
    case "STARTS_WITH":
      return String(metricValue).toLowerCase().startsWith(String(compareValue).toLowerCase());
    case "ENDS_WITH":
      return String(metricValue).toLowerCase().endsWith(String(compareValue).toLowerCase());
    default:
      return false;
  }
}

/**
 * Tipo de cada campo em lib/config/adMetricsFields.ts, para o diferencial poder
 * chamar `evaluateCondition` sem depender do arquivo (apagado na fase 4).
 *
 * Os 11 campos marcados com `// MORTO` são os que `buildAdMetricsData` /
 * `mapRankingToMetrics` nunca constroem: `evaluateCondition` devolve `false`
 * para todos eles, sempre. É a divergência intencional da fase 4.
 */
export const LEGACY_FIELD_TYPES: Record<string, "text" | "numeric" | "integer" | "date"> = {
  campaign_name: "text", // MORTO
  adset_name: "text", // MORTO
  ad_name: "text",
  account_id: "text",
  campaign_id: "text", // MORTO
  adset_id: "text", // MORTO
  ad_id: "text",
  clicks: "integer",
  impressions: "integer",
  inline_link_clicks: "integer",
  reach: "integer", // MORTO
  video_total_plays: "integer", // MORTO (o mapper grava `plays`, não `video_total_plays`)
  video_total_thruplays: "integer", // MORTO
  video_watched_p50: "integer", // MORTO
  spend: "numeric",
  cpm: "numeric",
  ctr: "numeric",
  frequency: "numeric", // MORTO
  website_ctr: "numeric",
  connect_rate: "numeric",
  profile_ctr: "numeric", // MORTO
  date: "date", // MORTO
};

/** Os 11 campos que o Critério oferece e que rejeitam todo anúncio, sempre. */
export const LEGACY_DEAD_FIELDS = [
  "campaign_name",
  "adset_name",
  "campaign_id",
  "adset_id",
  "reach",
  "video_total_plays",
  "video_total_thruplays",
  "video_watched_p50",
  "frequency",
  "profile_ctr",
  "date",
] as const;
