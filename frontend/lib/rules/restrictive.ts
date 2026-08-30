/**
 * Quando uma condição REALMENTE restringe — e por que isso não é a mesma coisa
 * que "existir".
 *
 * Uma folha em branco (`hook > ` sem número, `Pack é algum de []` sem pack
 * escolhido) é pergunta pela metade: o avaliador a ignora, e a tela precisa
 * ignorá-la também. Se não ignorasse, o Manager mostraria "Filtros (3)" com duas
 * condições sem efeito, o funil acenderia numa coluna que não filtra nada, e o
 * onboarding aceitaria um critério vazio como "configurado".
 *
 * MORA EM `lib/rules/` PORQUE É CONHECIMENTO DO MOTOR, NÃO DO MANAGER
 *   Nasceu em `lib/manager/managerRules.ts`, quando o Manager era o único
 *   consumidor. O Critério de validação faz a MESMA pergunta ("este critério diz
 *   alguma coisa?") para liberar o botão do onboarding; importar de `lib/manager`
 *   para responder isso seria recriar em pequeno a dependência cruzada que a
 *   unificação dos filtros veio desfazer.
 */

import { getRuleField } from "./fields";
import type { RuleConditionLeaf, RuleNode, RuleTree } from "./types";

export function walkRuleLeaves(nodes: RuleNode[], visit: (leaf: RuleConditionLeaf) => void): void {
  for (const node of nodes) {
    if (node.type === "group") walkRuleLeaves(node.conditions ?? [], visit);
    else visit(node);
  }
}

/**
 * Uma folha só "restringe" quando tem o que comparar. Condição em branco (valor
 * vazio, multi-seleção sem nada escolhido) não acende funil nem conta no "Filtros
 * (N)" — é pergunta pela metade, e o avaliador a ignora do mesmo jeito.
 */
export function isRestrictiveLeaf(leaf: RuleConditionLeaf): boolean {
  const field = getRuleField(leaf.field);
  if (!field) return false;
  if (field.kind === "status") return true; // is_active / is_paused são a pergunta inteira
  if (leaf.operator === "is_empty" || leaf.operator === "is_not_empty") return true;
  const value = leaf.value;
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim() !== "";
  return Number.isFinite(Number(value));
}

/** Campos citados por alguma folha restritiva — alimenta o funil no header. */
export function getFilteredFieldIds(rules: RuleTree | null | undefined): Set<string> {
  const ids = new Set<string>();
  if (!rules) return ids;
  walkRuleLeaves(rules.conditions ?? [], (leaf) => {
    if (isRestrictiveLeaf(leaf)) ids.add(leaf.field);
  });
  return ids;
}

/** Quantas condições restritivas a regra tem — o N de "Filtros (N)". */
export function countRestrictiveConditions(rules: RuleTree | null | undefined): number {
  let total = 0;
  if (!rules) return 0;
  walkRuleLeaves(rules.conditions ?? [], (leaf) => {
    if (isRestrictiveLeaf(leaf)) total += 1;
  });
  return total;
}
