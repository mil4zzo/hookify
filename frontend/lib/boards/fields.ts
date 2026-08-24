/**
 * Vocabulário de regra do Board.
 *
 * POR QUE NÃO REUSA `lib/config/adMetricsFields`
 *   Aquele registry existe para o CRITÉRIO DE VALIDAÇÃO (/gold, /plano): rótulos
 *   em inglês, campos crus de `ad_metrics`, ids de campanha/adset. É o vocabulário
 *   de julgamento, não o de leitura. Mexer nele para caber aqui mudaria a
 *   classificação de todo mundo que já salvou critérios.
 *
 *   O Board fala a língua do Manager — as mesmas métricas, os mesmos operadores e
 *   a mesma convenção de porcentagem do popover "Filtros". É o que o usuário já
 *   aprendeu na tela ao lado.
 *
 * O QUE FICOU DE FORA, E POR QUÊ
 *   `campaign_name` / `adset_name`: a linha do Board é agregada por CRIATIVO, e
 *   um criativo roda em várias campanhas. Esses campos vêm do REPRESENTANTE do
 *   grupo (o ad de maior impressões) — uma regra sobre eles acertaria a maioria e
 *   mentiria no resto, em silêncio. Pack e Conta entram porque a linha carrega o
 *   array completo (`pack_ids` / `account_ids`), então a semântica "alguma" é real.
 */

import { MANAGER_METRIC_KEYS, getManagerMetricLabel, type ManagerMetricKey } from "@/lib/metrics";
import { METRIC_DEFINITIONS } from "@/lib/metrics/definitions";
import { TAG_FILTER_OPERATORS } from "@/lib/tags/filter";

export type BoardFieldKind = "metric" | "text" | "tags" | "status" | "date" | "multiselect";

export type BoardFieldGroup = "Tags" | "Criativo" | "Procedência" | "Métricas";

export interface BoardField {
  id: string;
  label: string;
  kind: BoardFieldKind;
  group: BoardFieldGroup;
  /** Métrica em escala 0-1 (ctr, hook, ...). O input do usuário é dividido por 100. */
  isRatioPercent?: boolean;
  /** Só aparece quando algum pack selecionado tem integração de planilha. */
  requiresSheetIntegration?: boolean;
  /** Depende do tipo de conversão escolhido no filtro global. */
  requiresActionType?: boolean;
}

export const BOARD_OPERATORS: Record<BoardFieldKind, { value: string; label: string }[]> = {
  metric: [
    { value: ">", label: "Maior que" },
    { value: "<", label: "Menor que" },
    { value: ">=", label: "Maior ou igual" },
    { value: "<=", label: "Menor ou igual" },
    { value: "=", label: "Igual a" },
    { value: "!=", label: "Diferente de" },
  ],
  text: [
    { value: "contains", label: "Contém" },
    { value: "not_contains", label: "Não contém" },
    { value: "starts_with", label: "Começa com" },
    { value: "ends_with", label: "Termina com" },
    { value: "equals", label: "É igual a" },
    { value: "not_equals", label: "É diferente de" },
  ],
  date: [
    { value: ">=", label: "A partir de" },
    { value: "<=", label: "Até" },
    { value: ">", label: "Depois de" },
    { value: "<", label: "Antes de" },
    { value: "=", label: "Exatamente em" },
  ],
  tags: TAG_FILTER_OPERATORS.map((op) => ({ value: op.value as string, label: op.label })),
  status: [
    { value: "is_active", label: "Tem veiculação ativa" },
    { value: "is_paused", label: "Está totalmente pausado" },
  ],
  multiselect: [
    { value: "has_any", label: "É algum de" },
    { value: "has_none", label: "Não é nenhum de" },
  ],
};

/** Operadores que são a pergunta inteira — não têm campo de valor. */
const VALUELESS_OPERATORS = new Set(["is_active", "is_paused", "is_empty", "is_not_empty"]);

export function boardOperatorNeedsValue(operator: string): boolean {
  return !VALUELESS_OPERATORS.has(operator);
}

const DIMENSION_FIELDS: BoardField[] = [
  { id: "tags", label: "Tags", kind: "tags", group: "Tags" },
  { id: "ad_name", label: "Nome do criativo", kind: "text", group: "Criativo" },
  { id: "status", label: "Status", kind: "status", group: "Criativo" },
  // meta_created_time é ATRIBUTO do criativo ("quando estreou"), não o recorte da
  // tela — por isso é regra, enquanto o período continua vindo do seletor global.
  { id: "meta_created_time", label: "Criado em", kind: "date", group: "Criativo" },
  { id: "pack_ids", label: "Pack", kind: "multiselect", group: "Procedência" },
  { id: "account_ids", label: "Conta", kind: "multiselect", group: "Procedência" },
];

function buildMetricField(key: ManagerMetricKey): BoardField {
  const definition = METRIC_DEFINITIONS[key];
  return {
    id: key,
    label: getManagerMetricLabel(key),
    kind: "metric",
    group: "Métricas",
    isRatioPercent: definition?.formatKind === "ratioPercent",
    requiresSheetIntegration: definition?.requiresSheetIntegration,
    requiresActionType: definition?.requiresActionType,
  };
}

export const BOARD_FIELDS: BoardField[] = [...DIMENSION_FIELDS, ...MANAGER_METRIC_KEYS.map(buildMetricField)];

const BOARD_FIELDS_BY_ID = new Map(BOARD_FIELDS.map((field) => [field.id, field]));

export function getBoardField(fieldId: string): BoardField | undefined {
  return BOARD_FIELDS_BY_ID.get(fieldId);
}

export interface BoardFieldAvailability {
  hasSheetIntegration?: boolean;
}

/**
 * Campos oferecidos no seletor. Métricas de MQL só aparecem com planilha ligada —
 * sem ela vêm sempre zeradas, e uma regra sobre zero é um grupo vazio que parece
 * bug. Um campo já salvo continua sendo avaliado mesmo se sair desta lista: a
 * regra não deve mudar de significado porque a planilha caiu.
 */
export function getAvailableBoardFields({ hasSheetIntegration = false }: BoardFieldAvailability = {}): BoardField[] {
  return BOARD_FIELDS.filter((field) => !field.requiresSheetIntegration || hasSheetIntegration);
}

export function getBoardOperators(fieldId: string): { value: string; label: string }[] {
  const field = getBoardField(fieldId);
  return field ? BOARD_OPERATORS[field.kind] : BOARD_OPERATORS.metric;
}

export function getDefaultBoardOperator(fieldId: string): string {
  return getBoardOperators(fieldId)[0]?.value ?? ">";
}

/** Valor inicial coerente com o tipo — evita condição nasce quebrada. */
export function getDefaultBoardValue(fieldId: string): import("./types").BoardConditionValue {
  const field = getBoardField(fieldId);
  if (!field) return null;
  if (field.kind === "tags" || field.kind === "multiselect") return [];
  if (field.kind === "status") return null;
  return "";
}

/** Métricas oferecidas para ordenar dentro do grupo. */
export function getBoardSortMetrics({ hasSheetIntegration = false }: BoardFieldAvailability = {}): { value: string; label: string }[] {
  return MANAGER_METRIC_KEYS.filter((key) => !METRIC_DEFINITIONS[key]?.requiresSheetIntegration || hasSheetIntegration).map((key) => ({
    value: key,
    label: getManagerMetricLabel(key),
  }));
}
