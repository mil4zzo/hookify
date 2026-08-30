/**
 * Duas correções decididas em 2026-08-28, e o que elas impedem:
 *
 *   TAGS SÓ ONDE EXISTEM — a RPC devolve tags nos agrupamentos por criativo e por
 *   anúncio; nas abas de Conjunto e Campanha vem sempre lista vazia. Oferecer o
 *   campo lá seria uma opção de menu que devolve tabela vazia SEMPRE.
 *
 *   CONTA TAMBÉM NA LINHA-FILHA — a linha agregada traz `account_ids` (lista); a
 *   filha é UM anúncio e traz `account_id` (uma conta, exata). Mesma pergunta,
 *   chave diferente.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { rowMatchesRules } from "@/lib/rules/evaluate";
import { getAvailableRuleFields, getRuleField } from "@/lib/rules/fields";
import type { RuleTree } from "@/lib/rules/types";

function contaRule(operator: string, ids: string[]): RuleTree {
  return { logic: "AND", conditions: [{ id: "c1", type: "condition", field: "account_ids", operator, value: ids }] };
}

const ofere = (ctx: any, tab?: any) => new Set(getAvailableRuleFields({ context: ctx, tab, hasSheetIntegration: true }).map((f) => f.id));

test("Tags só é oferecida nas abas em que a RPC realmente devolve tags", () => {
  assert.ok(ofere("manager", "individual").has("tags"), "aba Anúncios tem tags");
  assert.ok(ofere("manager", "por-anuncio").has("tags"), "aba Criativos tem tags");
  assert.ok(!ofere("manager", "por-conjunto").has("tags"), "aba Conjuntos NÃO pode oferecer tags");
  assert.ok(!ofere("manager", "por-campanha").has("tags"), "aba Campanhas NÃO pode oferecer tags");
});

test("Tags segue disponível no Boards e no Critério, e ausente nas linhas-filhas", () => {
  assert.ok(ofere("boards").has("tags"));
  assert.ok(ofere("criteria").has("tags"));
  assert.ok(!ofere("manager-children").has("tags"), "a filha não carrega tags");
});

test("Conta e Pack são oferecidos na linha-filha; tags não", () => {
  const filhas = ofere("manager-children");
  assert.ok(filhas.has("account_ids"), "Conta sai de graça: a filha já traz account_id");
  assert.ok(filhas.has("pack_ids"), "Pack veio pela migration 134");
  assert.ok(!filhas.has("tags"), "tag é do criativo, não do anúncio");
});

test("Conta casa lendo a lista da linha agregada", () => {
  const agregada = { account_ids: ["act_1", "act_2"] };
  assert.equal(rowMatchesRules(agregada, contaRule("has_any", ["act_2"])), true);
  assert.equal(rowMatchesRules(agregada, contaRule("has_any", ["act_9"])), false);
  assert.equal(rowMatchesRules(agregada, contaRule("has_none", ["act_9"])), true);
});

test("Conta casa lendo o valor único da linha-filha", () => {
  const filha = { account_id: "act_1" };
  assert.equal(rowMatchesRules(filha, contaRule("has_any", ["act_1"])), true, "um valor é uma lista de um");
  assert.equal(rowMatchesRules(filha, contaRule("has_any", ["act_9"])), false);
  assert.equal(rowMatchesRules(filha, contaRule("has_none", ["act_9"])), true);
  assert.equal(rowMatchesRules(filha, contaRule("has_none", ["act_1"])), false);
});

test("a lista tem precedência sobre a chave única quando as duas existem", () => {
  // A linha agregada traz as duas (`account_id` é o representante e MENTE quando o
  // grupo mistura contas). A lista é que responde a pergunta.
  const agregada = { account_ids: ["act_1", "act_2"], account_id: "act_1" };
  assert.equal(rowMatchesRules(agregada, contaRule("has_any", ["act_2"])), true, "não pode ler só o representante");
});

test("linha sem conta nenhuma não casa com 'é alguma de', e casa com 'não é nenhuma'", () => {
  for (const vazia of [{}, { account_id: null }, { account_id: "" }, { account_ids: [] }]) {
    assert.equal(rowMatchesRules(vazia, contaRule("has_any", ["act_1"])), false, JSON.stringify(vazia));
    assert.equal(rowMatchesRules(vazia, contaRule("has_none", ["act_1"])), true, JSON.stringify(vazia));
  }
});

test("seleção vazia não restringe — nem em has_any nem em has_none", () => {
  const filha = { account_id: "act_1" };
  assert.equal(rowMatchesRules(filha, contaRule("has_any", [])), true);
  assert.equal(rowMatchesRules(filha, contaRule("has_none", [])), true);
});

test("o campo Conta declara a chave alternativa — é isso que faz a filha funcionar", () => {
  assert.equal(getRuleField("account_ids")?.rowKeyFallback, "account_id");
  // Pack NÃO declara chave alternativa: a filha recebe `pack_ids` de verdade
  // (migration 134), não um singular que precisasse ser adaptado.
  assert.equal(getRuleField("pack_ids")?.rowKeyFallback, undefined);
});
