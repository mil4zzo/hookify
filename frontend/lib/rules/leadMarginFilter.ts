/**
 * O filtro que o "N de M abaixo da meta de margem" liga no clique: "Margem vs meta
 * é algum de: Abaixo da meta, com lucro · Prejuízo". É uma condição comum da regra
 * do Manager — aparece no "Filtros (N)", edita e sai como qualquer outra; o clique
 * só a escreve por você.
 */

import { LEAD_MARGIN_STATUS_FIELD_ID } from "./fields";
import type { RuleConditionLeaf, RuleNode, RuleTree } from "./types";

/** As situações que o resumo conta como "abaixo da meta" (`rowsBelowTarget`). */
export const BELOW_TARGET_STATUSES = ["below_target", "loss"] as const;

function isBelowTargetLeaf(node: RuleNode): boolean {
  if (node.type !== "condition" || node.field !== LEAD_MARGIN_STATUS_FIELD_ID || node.operator !== "has_any") return false;
  const values = Array.isArray(node.value) ? node.value : [];
  return values.length === BELOW_TARGET_STATUSES.length && BELOW_TARGET_STATUSES.every((status) => values.includes(status));
}

/**
 * O filtro do link está ligado: a condição exata na RAIZ, numa raiz "E". Só na raiz
 * porque é onde o clique a põe; dentro de um "OU" ela não restringe a tela sozinha,
 * e o link diria "ligado" sobre uma tela que mostra mais do que as abaixo da meta.
 */
export function hasBelowTargetFilter(rules: RuleTree): boolean {
  return rules.logic === "AND" && rules.conditions.some(isBelowTargetLeaf);
}

/**
 * Liga ou desliga o filtro. Ligar SOMA à regra que já existe, sem trocá-la: numa
 * raiz "E", mais uma condição; numa raiz "OU" com condições, a regra antiga vira um
 * subgrupo — acrescentar a condição ao "OU" alargaria a tela em vez de estreitar.
 */
export function toggleBelowTargetFilter(rules: RuleTree, newId: () => string): RuleTree {
  if (hasBelowTargetFilter(rules)) {
    return { ...rules, conditions: rules.conditions.filter((node) => !isBelowTargetLeaf(node)) };
  }
  const leaf: RuleConditionLeaf = {
    id: newId(),
    type: "condition",
    field: LEAD_MARGIN_STATUS_FIELD_ID,
    operator: "has_any",
    value: [...BELOW_TARGET_STATUSES],
  };
  if (rules.logic === "AND" || rules.conditions.length === 0) {
    return { logic: "AND", conditions: [...rules.conditions, leaf] };
  }
  return { logic: "AND", conditions: [{ id: newId(), type: "group", logic: rules.logic, conditions: rules.conditions }, leaf] };
}
