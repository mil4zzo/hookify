/**
 * Tipos do Board — a lente de agrupamento de criativos.
 *
 * Um board tem grupos; um grupo tem uma REGRA. Quem está em cada grupo nunca é
 * persistido: é derivado das linhas do Manager a cada abertura, sobre o recorte
 * (packs + período) que estiver ativo no seletor global. Ver migration 119.
 *
 * Grupos NÃO são exclusivos entre si e não se enxergam: o mesmo criativo pode
 * aparecer em quantos grupos suas regras casarem. Foi decisão de produto — a
 * alternativa (primeiro match vence) transformaria a ordem dos grupos em regra
 * escondida, e o usuário perderia a interseção, que é justamente o que permite
 * olhar o mesmo acervo por dois ângulos na mesma tela.
 */

export type BoardLogic = "AND" | "OR";

/** Valor de uma condição. Lista = multi-seleção (tags, packs, contas). */
export type BoardConditionValue = string | number | string[] | null;

export interface BoardConditionLeaf {
  id: string;
  type: "condition";
  field: string;
  operator: string;
  value: BoardConditionValue;
}

export interface BoardConditionGroup {
  id: string;
  type: "group";
  logic: BoardLogic;
  conditions: BoardRuleNode[];
}

export type BoardRuleNode = BoardConditionLeaf | BoardConditionGroup;

export interface BoardRules {
  logic: BoardLogic;
  conditions: BoardRuleNode[];
}

export interface BoardGroup {
  id: string;
  board_id: string;
  name: string;
  /** Token --chart-* do design system, igual a tags.color. Nunca hex. */
  color: string;
  position: number;
  rules: BoardRules;
  /** Chave de métrica do registry do Manager (MANAGER_METRIC_KEYS). */
  sort_metric: string;
  sort_direction: "asc" | "desc";
}

export interface Board {
  id: string;
  name: string;
  position: number;
  groups: BoardGroup[];
}

export const EMPTY_BOARD_RULES: BoardRules = { logic: "AND", conditions: [] };

/** Regras vindas do banco são jsonb livre — normaliza antes de avaliar. */
export function normalizeBoardRules(raw: unknown): BoardRules {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return EMPTY_BOARD_RULES;
  const source = raw as Partial<BoardRules>;
  const logic: BoardLogic = source.logic === "OR" ? "OR" : "AND";
  const conditions = Array.isArray(source.conditions) ? source.conditions : [];
  return { logic, conditions: conditions.filter(isRuleNode) };
}

function isRuleNode(value: unknown): value is BoardRuleNode {
  if (!value || typeof value !== "object") return false;
  const node = value as Partial<BoardRuleNode>;
  return node.type === "condition" || node.type === "group";
}

/** True se a regra não restringe nada — o grupo mostraria o recorte inteiro. */
export function isEmptyBoardRules(rules: BoardRules | undefined | null): boolean {
  return !rules || rules.conditions.length === 0;
}
