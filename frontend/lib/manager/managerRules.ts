/**
 * O estado de filtro do Manager — agora uma ÁRVORE, não uma lista.
 *
 * O QUE MUDOU E POR QUÊ
 *   Antes cada coluna guardava o próprio filtro (`ColumnFiltersState` do TanStack),
 *   e a tabela combinava tudo em E. Não havia como escrever "nome contém X OU
 *   hook > 30%": a lista plana não tem onde pendurar o OU. Agora o Manager guarda
 *   a MESMA `RuleTree` do Boards e do Critério, avaliada pelo mesmo motor.
 *
 * O QUE SE PERDE, DE PROPÓSITO
 *   Uma folha não pertence mais a uma coluna — ela cita um CAMPO. O funil no
 *   header deixa de ser "esta coluna tem filtro" e passa a ser "alguma folha da
 *   regra cita este campo" (`getFilteredFieldIds`). Num OU cruzando colunas, o
 *   funil acende nas duas: é honesto, porque as duas participam da decisão.
 *
 * PERSISTÊNCIA
 *   `sessionStorage`, por aba, como sempre foi — filtro é recorte de sessão, não
 *   preferência. As chaves antigas (`hookify-manager-filters:*`) são ignoradas:
 *   o formato mudou e o dado é descartável por natureza. Ver
 *   documentation/plano-filtros-unificados.md.
 */

import { logger } from "@/lib/utils/logger";
import {
  getDefaultRuleOperator,
  getDefaultRuleValue,
  type RuleManagerTab,
} from "@/lib/rules/fields";
import { getFilteredFieldIds as getFilteredFieldIdsFromRules, walkRuleLeaves } from "@/lib/rules/restrictive";
import {
  EMPTY_RULE_TREE,
  normalizeRuleTree,
  type RuleConditionLeaf,
  type RuleNode,
  type RuleTree,
} from "@/lib/rules/types";

export type ManagerTab = RuleManagerTab;

/**
 * Id da coluna sintética que carrega a regra dentro do TanStack. Não desenha
 * nada: existe só para o modelo filtrado continuar sendo o do TanStack (média
 * filtrada do header, seleção em massa, virtualizador dependem dele).
 */
export const MANAGER_RULES_COLUMN_ID = "__rules";

/** A regra da aba mais a busca por nome da barra — avaliadas no mesmo ponto. */
export interface ManagerRuleFilterValue {
  rules: RuleTree;
  search: string;
}

export const MANAGER_RULES_STORAGE_PREFIX = "hookify-manager-rules";

export function getManagerRulesStorageKey(tab: ManagerTab): string {
  return `${MANAGER_RULES_STORAGE_PREFIX}:${tab}`;
}

/**
 * Aba individual nasce com "tem veiculação ativa": sem isso ela abre com o
 * inventário inteiro (incluindo anos de anúncios pausados) e trava em packs
 * grandes. Era o `status = ACTIVE` default da versão em lista.
 */
export const DEFAULT_INDIVIDUAL_RULES: RuleTree = {
  logic: "AND",
  conditions: [{ id: "status__default", type: "condition", field: "status", operator: "is_active", value: null }],
};

export function loadManagerRules(tab: ManagerTab): RuleTree {
  if (typeof window === "undefined") return EMPTY_RULE_TREE;
  try {
    const saved = sessionStorage.getItem(getManagerRulesStorageKey(tab));
    if (!saved) return tab === "individual" ? DEFAULT_INDIVIDUAL_RULES : EMPTY_RULE_TREE;
    return normalizeRuleTree(JSON.parse(saved));
  } catch (e) {
    logger.error("Erro ao carregar regras do Manager do sessionStorage:", e);
    return EMPTY_RULE_TREE;
  }
}

/**
 * `isRestrictiveLeaf` / `getFilteredFieldIds` / `countRestrictiveConditions` moraram
 * aqui enquanto o Manager era o único a perguntar "esta condição diz alguma coisa?".
 * O Critério de validação faz a mesma pergunta (para liberar o botão do onboarding),
 * então elas passaram para o motor. Reexportadas para quem já as importava daqui.
 */
export { countRestrictiveConditions, getFilteredFieldIds, isRestrictiveLeaf } from "@/lib/rules/restrictive";

let leafSeq = 0;
function nextLeafId(): string {
  leafSeq += 1;
  return `leaf_${Date.now().toString(36)}_${leafSeq}`;
}

/**
 * Clicar no funil de uma coluna abre o popover com uma folha nova NAQUELE campo.
 * Se o campo já é citado, não duplica — o usuário quer editar o que existe, não
 * empilhar uma segunda condição igual.
 */
export function ensureLeafForField(rules: RuleTree, fieldId: string): RuleTree {
  const existing = getFilteredFieldIdsFromRules(rules);
  let cited = existing.has(fieldId);
  if (!cited) {
    walkRuleLeaves(rules.conditions ?? [], (leaf) => {
      if (leaf.field === fieldId) cited = true;
    });
  }
  if (cited) return rules;

  const leaf: RuleConditionLeaf = {
    id: nextLeafId(),
    type: "condition",
    field: fieldId,
    operator: getDefaultRuleOperator(fieldId),
    value: getDefaultRuleValue(fieldId),
  };
  return { ...rules, conditions: [...(rules.conditions ?? []), leaf] };
}

/**
 * Coluna oculta não pode deixar filtro invisível para trás — o usuário veria a
 * tabela encolhida sem nada na tela explicando por quê. `ad_name` e `status`
 * sobrevivem sempre: existem independentemente da escolha de colunas.
 */
export function pruneRulesForVisibleFields(rules: RuleTree, isFieldVisible: (fieldId: string) => boolean): RuleTree {
  const prune = (nodes: RuleNode[]): RuleNode[] =>
    nodes
      .map((node) => (node.type === "group" ? { ...node, conditions: prune(node.conditions ?? []) } : node))
      .filter((node) => (node.type === "group" ? (node.conditions?.length ?? 0) > 0 : isFieldVisible(node.field)));

  const conditions = prune(rules.conditions ?? []);
  if (conditions.length === (rules.conditions ?? []).length) return rules;
  return { ...rules, conditions };
}
