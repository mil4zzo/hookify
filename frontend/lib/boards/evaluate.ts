/**
 * Avaliador de regra de grupo do Board.
 *
 * Roda 100% no cliente, sobre as MESMAS linhas que o Manager já buscou — nenhum
 * grupo custa uma query. É por isso que grupos podem se sobrepor à vontade: o
 * custo de N grupos é N passadas num array que já está na memória.
 *
 * CONVENÇÃO DE PORCENTAGEM
 *   O valor da condição é gravado na ESCALA QUE O USUÁRIO DIGITOU (30 para 30%).
 *   A divisão por 100 acontece aqui, para as métricas `ratioPercent` (que vivem
 *   em 0-1). O Manager converte na ENTRADA e o `applyRowFilters` das linhas-filhas
 *   converte só quando o valor é `> 1` — essa heurística erra em `hook > 0.5%`.
 *   Aqui a conversão é incondicional porque a escala de gravação é conhecida.
 */

import { getMetricNumericValueOrNull } from "@/lib/metrics";
import { rowMatchesTagFilter, type TagFilterOperator } from "@/lib/tags/filter";
import { getBoardField } from "./fields";
import { isEmptyBoardRules, type BoardConditionLeaf, type BoardConditionValue, type BoardRuleNode, type BoardRules } from "./types";

export interface BoardEvaluationContext {
  actionType?: string;
  mqlLeadscoreMin?: number | null;
}

/** Linha do Manager agrupada por criativo, mais o que a regra precisa ler. */
export type BoardRow = Record<string, any>;

function compareNumeric(rowValue: number, target: number, operator: string): boolean {
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

function compareText(rawValue: string, target: string, operator: string): boolean {
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

/** YYYY-MM-DD comparado como string: a ordem lexicográfica desse formato é a cronológica. */
function compareDate(rowDate: string, target: string, operator: string): boolean {
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

function toStringList(value: BoardConditionValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry)).filter(Boolean);
}

/**
 * Semântica "ALGUM", sempre. Um criativo roda em ~34 anúncios e pode espalhar-se
 * por várias contas/packs; "está na conta X" quase sempre quer dizer "tem alguma
 * veiculação na conta X". A alternativa ("só existe em X") esvaziaria grupos sem
 * o usuário entender por quê.
 */
function matchesMultiSelect(rowValues: unknown, value: BoardConditionValue, operator: string): boolean {
  const wanted = toStringList(value);
  if (wanted.length === 0) return true;

  const present = new Set(Array.isArray(rowValues) ? rowValues.map((entry) => String(entry)) : []);
  const intersects = wanted.some((entry) => present.has(entry));
  return operator === "has_none" ? !intersects : intersects;
}

/**
 * Ativo = tem ao menos UMA veiculação ativa. `active_count` é o número de ads
 * ativos do grupo; quando a RPC não o devolve (abas que não agregam), cai para o
 * status do representante.
 */
function matchesStatus(row: BoardRow, operator: string): boolean {
  // `Number(null)` e 0, nao NaN — checar ausencia ANTES de converter. Sem isso,
  // linha sem contagem seria lida como "zero ativos" e todo criativo cairia em
  // "totalmente pausado".
  const raw = row.active_count;
  const activeCount = raw == null ? null : Number(raw);
  const hasActive =
    activeCount != null && Number.isFinite(activeCount)
      ? activeCount > 0
      : String(row.effective_status || "").toUpperCase() === "ACTIVE";
  return operator === "is_paused" ? !hasActive : hasActive;
}

function evaluateLeaf(condition: BoardConditionLeaf, row: BoardRow, context: BoardEvaluationContext): boolean {
  const field = getBoardField(condition.field);
  // Campo que saiu do registry (renomeado, removido) não pode derrubar o grupo
  // inteiro em silêncio — a condição é ignorada, como um filtro em branco.
  if (!field) return true;

  const { operator, value } = condition;

  if (field.kind === "tags") {
    return rowMatchesTagFilter(row.tags, { operator: operator as TagFilterOperator, tagIds: toStringList(value) });
  }

  if (field.kind === "status") {
    return matchesStatus(row, operator);
  }

  if (field.kind === "multiselect") {
    return matchesMultiSelect(row[field.id], value, operator);
  }

  if (field.kind === "date") {
    const target = String(value ?? "").slice(0, 10);
    if (!target) return true; // condição incompleta não restringe, igual ao Manager
    const raw = row[field.id];
    // Linha sem data (ad não ressincronizado desde a migration 115) não pode
    // satisfazer um recorte temporal — sai do grupo em vez de fingir que é dele.
    if (!raw) return false;
    return compareDate(String(raw).slice(0, 10), target, operator);
  }

  if (field.kind === "text") {
    const target = String(value ?? "");
    if (!target) return true;
    return compareText(String(row[field.id] ?? ""), target, operator);
  }

  const target = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(target)) return true;

  const rowValue = getMetricNumericValueOrNull(row, field.id, {
    actionType: context.actionType,
    mqlLeadscoreMin: context.mqlLeadscoreMin ?? null,
  });
  // Métrica ausente/infinita não passa: o grupo afirma um número, e a linha não tem.
  if (rowValue == null || !Number.isFinite(rowValue)) return false;

  return compareNumeric(rowValue, field.isRatioPercent ? target / 100 : target, operator);
}

function evaluateNode(node: BoardRuleNode, row: BoardRow, context: BoardEvaluationContext): boolean {
  if (node.type === "group") {
    const children = node.conditions ?? [];
    // Subgrupo vazio é pergunta em branco: não restringe, nem em AND nem em OR.
    if (children.length === 0) return true;
    const results = children.map((child) => evaluateNode(child, row, context));
    return node.logic === "OR" ? results.some(Boolean) : results.every(Boolean);
  }
  return evaluateLeaf(node, row, context);
}

/** True se a linha pertence ao grupo. Regra vazia = grupo mostra o recorte inteiro. */
export function rowMatchesBoardRules(row: BoardRow, rules: BoardRules, context: BoardEvaluationContext = {}): boolean {
  if (isEmptyBoardRules(rules)) return true;
  const results = rules.conditions.map((node) => evaluateNode(node, row, context));
  return rules.logic === "OR" ? results.some(Boolean) : results.every(Boolean);
}

export function filterRowsByBoardRules<T extends BoardRow>(rows: readonly T[], rules: BoardRules, context: BoardEvaluationContext = {}): T[] {
  if (isEmptyBoardRules(rules)) return [...rows];
  return rows.filter((row) => rowMatchesBoardRules(row, rules, context));
}

/** Quantas condições-folha a regra tem — alimenta o resumo "3 condições" no header. */
export function countBoardConditions(rules: BoardRules | undefined | null): number {
  if (!rules) return 0;
  const walk = (nodes: BoardRuleNode[]): number =>
    nodes.reduce((total, node) => total + (node.type === "group" ? walk(node.conditions ?? []) : 1), 0);
  return walk(rules.conditions ?? []);
}
