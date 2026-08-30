/**
 * O estado de regra do Manager: o que acende funil, o que conta no "Filtros (N)",
 * o que sobrevive a ocultar coluna, e o default da aba individual.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_INDIVIDUAL_RULES,
  countRestrictiveConditions,
  ensureLeafForField,
  getFilteredFieldIds,
  getManagerRulesStorageKey,
  isRestrictiveLeaf,
  pruneRulesForVisibleFields,
} from "@/lib/manager/managerRules";
import type { RuleConditionLeaf, RuleTree } from "@/lib/rules/types";

function leaf(field: string, operator: string, value: any, id = `${field}_${operator}`): RuleConditionLeaf {
  return { id, type: "condition", field, operator, value };
}

test("a chave de sessão é por aba e não colide com a do formato antigo", () => {
  assert.equal(getManagerRulesStorageKey("individual"), "hookify-manager-rules:individual");
  assert.notEqual(getManagerRulesStorageKey("individual"), "hookify-manager-filters:individual");
  assert.notEqual(getManagerRulesStorageKey("individual"), getManagerRulesStorageKey("por-anuncio"));
});

test("aba individual nasce filtrando por veiculação ativa", () => {
  // Sem isto a aba abre com o inventário inteiro e trava em packs grandes.
  assert.equal(DEFAULT_INDIVIDUAL_RULES.conditions.length, 1);
  const only = DEFAULT_INDIVIDUAL_RULES.conditions[0] as RuleConditionLeaf;
  assert.equal(only.field, "status");
  assert.equal(only.operator, "is_active");
  assert.equal(countRestrictiveConditions(DEFAULT_INDIVIDUAL_RULES), 1);
});

test("condição em branco não restringe — não acende funil nem conta", () => {
  assert.equal(isRestrictiveLeaf(leaf("ad_name", "contains", "")), false);
  assert.equal(isRestrictiveLeaf(leaf("ad_name", "contains", "   ")), false);
  assert.equal(isRestrictiveLeaf(leaf("ad_name", "contains", null)), false);
  assert.equal(isRestrictiveLeaf(leaf("pack_ids", "has_any", [])), false);
  assert.equal(isRestrictiveLeaf(leaf("hook", ">", null)), false);
});

test("condição preenchida restringe, inclusive com zero e sem valor", () => {
  assert.equal(isRestrictiveLeaf(leaf("hook", ">", 0)), true, "zero é um corte válido");
  assert.equal(isRestrictiveLeaf(leaf("ad_name", "contains", "BF")), true);
  assert.equal(isRestrictiveLeaf(leaf("pack_ids", "has_any", ["p1"])), true);
  assert.equal(isRestrictiveLeaf(leaf("status", "is_active", null)), true, "status é a pergunta inteira");
  assert.equal(isRestrictiveLeaf(leaf("hook", "is_empty", null)), true, "operador sem valor restringe");
});

test("campo que saiu do registry não restringe", () => {
  assert.equal(isRestrictiveLeaf(leaf("metrica_que_nao_existe", ">", 10)), false);
});

test("o funil enxerga folhas dentro de subgrupos", () => {
  const rules: RuleTree = {
    logic: "OR",
    conditions: [
      leaf("ad_name", "contains", "BF"),
      {
        id: "g1",
        type: "group",
        logic: "AND",
        conditions: [leaf("hook", ">", 30), leaf("spend", ">", 100), leaf("ctr", ">", null)],
      },
    ],
  };
  assert.deepEqual([...getFilteredFieldIds(rules)].sort(), ["ad_name", "hook", "spend"]);
  // ctr está em branco: não entra.
  assert.equal(countRestrictiveConditions(rules), 3);
});

test("num OU cruzando colunas o funil acende nas duas", () => {
  // É o comportamento honesto: as duas colunas participam da decisão.
  const rules: RuleTree = { logic: "OR", conditions: [leaf("ad_name", "contains", "BF"), leaf("hook", ">", 30)] };
  const ids = getFilteredFieldIds(rules);
  assert.ok(ids.has("ad_name") && ids.has("hook"));
});

test("clicar no funil cria a folha do campo, e não duplica se já existe", () => {
  const vazio: RuleTree = { logic: "AND", conditions: [] };
  const comHook = ensureLeafForField(vazio, "hook");
  assert.equal(comHook.conditions.length, 1);
  assert.equal((comHook.conditions[0] as RuleConditionLeaf).field, "hook");

  const denovo = ensureLeafForField(comHook, "hook");
  assert.equal(denovo.conditions.length, 1, "não empilha uma segunda condição igual");
  assert.equal(denovo, comHook, "sem mudança, devolve a MESMA referência (evita re-render)");

  // Mesmo em branco a folha já existe e deve ser reaproveitada para edição.
  const emBranco: RuleTree = { logic: "AND", conditions: [leaf("hook", ">", null)] };
  assert.equal(ensureLeafForField(emBranco, "hook").conditions.length, 1);
});

test("ocultar coluna remove a folha e esvazia subgrupo que ficou sem nada", () => {
  const rules: RuleTree = {
    logic: "AND",
    conditions: [
      leaf("ad_name", "contains", "BF"),
      leaf("cpmql", ">", 5),
      { id: "g1", type: "group", logic: "OR", conditions: [leaf("cpmql", "<", 2)] },
    ],
  };
  const visivel = (id: string) => id !== "cpmql";
  const podado = pruneRulesForVisibleFields(rules, visivel);
  assert.equal(podado.conditions.length, 1);
  assert.equal((podado.conditions[0] as RuleConditionLeaf).field, "ad_name");
});

test("poda sem nada a remover devolve a MESMA referência", () => {
  // Sem isto, o efeito de colunas dispararia re-render a cada render.
  const rules: RuleTree = { logic: "AND", conditions: [leaf("ad_name", "contains", "BF")] };
  assert.equal(pruneRulesForVisibleFields(rules, () => true), rules);
});
