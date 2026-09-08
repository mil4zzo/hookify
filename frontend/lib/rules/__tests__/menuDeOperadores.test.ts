/**
 * O que o menu de operador OFERECE, separado do que o avaliador ACEITA.
 *
 * O QUE ACONTECEU (2026-09-08)
 *   Data tinha quatro operadores de fronteira — "A partir de" (>=), "Até" (<=),
 *   "Depois de" (>), "Antes de" (<). Como a comparação é por dia, cada par difere em
 *   exatamente um dia, e o rótulo não dizia de que lado o dia escolhido caía:
 *   "Depois de 01/09" pensando "setembro em diante" perdia o dia 1º em silêncio. E
 *   "Está vazio" + "Tem valor" eram dois operadores que deixavam a coluna de valor
 *   morta ("A pergunta já está completa.").
 *
 * O CONTRATO
 *   `RULE_OPERATORS` continua sendo o vocabulário COMPLETO do avaliador — regra salva
 *   com `>` não muda de significado. `getRuleOperatorMenu` deriva dele o que a tela
 *   mostra: esconde os `hidden` (a menos que a condição já os use, senão o Select
 *   ficaria em branco) e colapsa is_empty/is_not_empty num único "Está", cujo valor
 *   é escolhido na coluna de valor.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PRESENCE_UI_OPERATOR,
  RULE_OPERATORS,
  getDefaultRuleOperator,
  getPresenceValueOptions,
  getRuleOperatorMenu,
  isPresenceOperator,
} from "../fields";

const values = (list: { value: string }[]) => list.map((item) => item.value);

test("data: menu oferece só os inclusivos; > e < ficam fora", () => {
  const menu = values(getRuleOperatorMenu("meta_created_time"));
  assert.deepEqual(menu, [">=", "<=", "=", PRESENCE_UI_OPERATOR]);
});

test("data: operador legado reaparece no menu quando a condição salva já o usa", () => {
  const menu = getRuleOperatorMenu("meta_created_time", ">");
  assert.ok(values(menu).includes(">"), "`>` precisa estar no menu para o Select não ficar em branco");
  assert.equal(menu.find((item) => item.value === ">")?.label, "Depois de");
  // Só o legado em uso volta — o gêmeo continua fora.
  assert.ok(!values(menu).includes("<"));
});

test("data: o avaliador continua conhecendo > e < (regra salva não muda de significado)", () => {
  const all = values(RULE_OPERATORS.date);
  assert.ok(all.includes(">") && all.includes("<"));
  assert.ok(RULE_OPERATORS.date.find((item) => item.value === ">")?.hidden);
});

test("data: condição nova nasce em 'Em ou depois de' (>=), inclusivo", () => {
  assert.equal(getDefaultRuleOperator("meta_created_time"), ">=");
  assert.equal(RULE_OPERATORS.date.find((item) => item.value === ">=")?.label, "Em ou depois de");
});

test("presença: is_empty e is_not_empty colapsam em UMA entrada, em qualquer tipo", () => {
  for (const fieldId of ["impressions", "ad_name", "meta_created_time"]) {
    const menu = values(getRuleOperatorMenu(fieldId));
    assert.equal(menu.filter((value) => value === PRESENCE_UI_OPERATOR).length, 1, fieldId);
    assert.ok(!menu.includes("is_empty") && !menu.includes("is_not_empty"), fieldId);
  }
});

test("presença: a coluna de valor fala a língua do tipo", () => {
  assert.deepEqual(values(getPresenceValueOptions("metric")), ["is_empty", "is_not_empty"]);
  assert.equal(getPresenceValueOptions("metric")[0].label, "Não se aplica");
  assert.equal(getPresenceValueOptions("text")[0].label, "Vazio");
  assert.ok(isPresenceOperator("is_empty") && isPresenceOperator("is_not_empty") && !isPresenceOperator(">"));
});

test("métrica: o menu não perde nenhum operador de comparação", () => {
  const menu = values(getRuleOperatorMenu("impressions"));
  assert.deepEqual(menu, [">", "<", ">=", "<=", "=", "!=", PRESENCE_UI_OPERATOR]);
});
