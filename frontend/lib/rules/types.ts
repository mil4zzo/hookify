/**
 * Tipos da REGRA — o vocabulário compartilhado por Manager, Boards e Critério de
 * validação (documentation/plano-filtros-unificados.md).
 *
 * Uma regra é uma ÁRVORE: nós de condição (campo + operador + valor) e nós de grupo,
 * cada nível com sua própria lógica E/OU. Foi a forma que o Board estreou em 2026-08
 * (migration 119) e é a única das três que expressa "X ou Y".
 *
 * A árvore não sabe onde é avaliada. Isso é de propósito: o motor roda 100% no
 * cliente, sobre as linhas que a tela já buscou. Avaliar parte no servidor
 * (pré-agregação) e parte aqui (pós-agregação) tornaria `A OU B` inexpressável —
 * o servidor teria descartado as linhas antes de alguém olhar o B.
 */

export type RuleLogic = "AND" | "OR";

/** Valor de uma condição. Lista = multi-seleção (tags, packs, contas). */
export type RuleConditionValue = string | number | string[] | null;

export interface RuleConditionLeaf {
  id: string;
  type: "condition";
  field: string;
  operator: string;
  value: RuleConditionValue;
}

export interface RuleConditionGroup {
  id: string;
  type: "group";
  logic: RuleLogic;
  conditions: RuleNode[];
}

export type RuleNode = RuleConditionLeaf | RuleConditionGroup;

export interface RuleTree {
  logic: RuleLogic;
  conditions: RuleNode[];
}

export const EMPTY_RULE_TREE: RuleTree = { logic: "AND", conditions: [] };

/** Regras vindas do banco são jsonb livre — normaliza antes de avaliar. */
export function normalizeRuleTree(raw: unknown): RuleTree {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return EMPTY_RULE_TREE;
  const source = raw as Partial<RuleTree>;
  const logic: RuleLogic = source.logic === "OR" ? "OR" : "AND";
  const conditions = Array.isArray(source.conditions) ? source.conditions : [];
  return { logic, conditions: conditions.filter(isRuleNode) };
}

function isRuleNode(value: unknown): value is RuleNode {
  if (!value || typeof value !== "object") return false;
  const node = value as Partial<RuleNode>;
  return node.type === "condition" || node.type === "group";
}

/** True se a regra não restringe nada — o grupo mostraria o recorte inteiro. */
export function isEmptyRuleTree(rules: RuleTree | undefined | null): boolean {
  return !rules || rules.conditions.length === 0;
}
