/**
 * Prova que `reference/legacyEvaluators.ts` é cópia FIEL dos avaliadores de hoje.
 *
 * POR QUE ESTE TESTE EXISTE
 *   O congelamento da fase 0 só vale como referência do diferencial se for igual ao
 *   original. Uma cópia "conferida a olho" não prova nada — e os originais vão ser
 *   apagados nas fases 3 e 4, quando ninguém mais conseguirá comparar. Este teste
 *   confronta cópia × produção ENQUANTO os dois existem.
 *
 * DEPOIS DA FASE 4
 *   Os imports de produção aqui deixam de existir. Este arquivo então é APAGADO —
 *   ele já terá cumprido o papel; quem continua é `reference/legacyEvaluators.ts`,
 *   usado pelos diferenciais das fases 1 e 3.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { rowMatchesRules } from "@/lib/rules/evaluate";
import { evaluateValidationCriteria } from "@/lib/utils/validateAdCriteria";
import type { RuleTree } from "@/lib/rules/types";

import {
  compareDate,
  compareNumeric,
  compareText,
  evaluateCondition,
  LEGACY_DEAD_FIELDS,
  LEGACY_FIELD_TYPES,
  type LegacyFilterOperator,
  type LegacyTextFilterOperator,
} from "./reference/legacyEvaluators";

/* ------------------------------------------------------------------ *
 * Matrizes adversariais — os valores que costumam quebrar comparação
 * ------------------------------------------------------------------ */

const NUMERIC_OPERATORS: LegacyFilterOperator[] = [">", "<", ">=", "<=", "=", "!="];
const TEXT_OPERATORS: LegacyTextFilterOperator[] = [
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "equals",
  "not_equals",
];


const ROW_TEXTS = ["", "   ", "BF_2026", "bf_2026", "Hook_v3 | BF", "ÁGUA"];
const FILTER_TEXTS = ["", " ", "bf", "BF", "hook", "ÁGUA", "z"];

const DATES = ["", "2026-01-01", "2026-08-27", "2026-08-28"];

/* ------------------------------------------------------------------ *
 * 1. Linhas-filhas do Manager: laço inteiro, cópia × produção
 * ------------------------------------------------------------------ */

// Os quatro testes "cópia × produção" do applyRowFilters saíram junto com o
// original, na fase 3 — não havia mais produção com que comparar. O que eles
// protegiam (a cópia ser fiel) já estava provado, e o valor agora está em
// managerChildrenDifferential.test.ts: motor NOVO × comportamento congelado.

/** Uma condição de texto sobre `ad_name`, no formato da árvore. */
function textRule(operator: string, value: string): RuleTree {
  return { logic: "AND", conditions: [{ id: "c1", type: "condition", field: "ad_name", operator, value }] };
}

test("Boards: compareText congelado bate com rowMatchesBoardRules", () => {
  for (const rowText of ROW_TEXTS) {
    for (const operator of TEXT_OPERATORS) {
      for (const value of FILTER_TEXTS) {
        const real = rowMatchesRules({ ad_name: rowText }, textRule(operator, value));
        // Alvo vazio é condição em branco: o avaliador ignora antes de comparar.
        const expected = value === "" ? true : compareText(rowText, value, operator);
        assert.equal(real, expected, `divergiu: "${rowText}" ${operator} "${value}"`);
      }
    }
  }
});

test("Boards: compareNumeric congelado bate com rowMatchesBoardRules (spend, sem escala)", () => {
  // `spend` não é ratioPercent → o avaliador compara sem dividir por 100.
  for (const rowValue of [0, 1, 2, 30, 300.5]) {
    for (const operator of NUMERIC_OPERATORS) {
      for (const value of [0, 1, 2, 30, 300.5]) {
        const real = rowMatchesRules(
          { spend: rowValue },
          { logic: "AND", conditions: [{ id: "c1", type: "condition", field: "spend", operator, value }] },
        );
        assert.equal(real, compareNumeric(rowValue, value, operator), `divergiu: spend ${rowValue} ${operator} ${value}`);
      }
    }
  }
});

test("Boards: métrica ratioPercent divide o alvo por 100 — incondicionalmente, inclusive abaixo de 1", () => {
  // É a diferença viva contra a heurística `> 1` das linhas-filhas: aqui 0,5 é 0,5%.
  for (const rowValue of [0.002, 0.005, 0.02, 0.3]) {
    for (const operator of NUMERIC_OPERATORS) {
      for (const value of [0.5, 1, 2, 30]) {
        const real = rowMatchesRules(
          { hook: rowValue, plays: 100 },
          { logic: "AND", conditions: [{ id: "c1", type: "condition", field: "hook", operator, value }] },
        );
        assert.equal(
          real,
          compareNumeric(rowValue, value / 100, operator),
          `divergiu: hook ${rowValue} ${operator} ${value}%`,
        );
      }
    }
  }
});

test("Boards: compareDate congelado bate com rowMatchesBoardRules", () => {
  for (const rowDate of DATES) {
    for (const operator of [">", "<", ">=", "<=", "="]) {
      for (const value of DATES) {
        const real = rowMatchesRules(
          { meta_created_time: rowDate },
          { logic: "AND", conditions: [{ id: "c1", type: "condition", field: "meta_created_time", operator, value }] },
        );
        // Alvo vazio = condição incompleta (true); linha sem data nunca satisfaz (false).
        const expected = value === "" ? true : rowDate === "" ? false : compareDate(rowDate, value, operator);
        assert.equal(real, expected, `divergiu: "${rowDate}" ${operator} "${value}"`);
      }
    }
  }
});

/* ------------------------------------------------------------------ *
 * 3. Critério de validação: evaluateCondition congelado × avaliador real
 * ------------------------------------------------------------------ */

const CRITERIA_OPERATORS = [
  "EQUAL",
  "NOT_EQUAL",
  "GREATER_THAN",
  "GREATER_THAN_OR_EQUAL",
  "LESS_THAN",
  "LESS_THAN_OR_EQUAL",
  "CONTAIN",
  "NOT_CONTAIN",
  "STARTS_WITH",
  "ENDS_WITH",
  "OPERADOR_INEXISTENTE",
];

test("Critério: evaluateCondition congelado bate com evaluateValidationCriteria (campos vivos)", () => {
  const metrics: Record<string, any> = {
    ad_name: "BF_2026",
    ad_id: "123",
    account_id: "act_9",
    spend: 300.5,
    impressions: 40000,
    clicks: 0,
    ctr: 0.0187,
    website_ctr: 0,
    connect_rate: 0.5,
    cpm: 7.5,
    inline_link_clicks: 12,
  };
  for (const field of Object.keys(metrics)) {
    for (const operator of CRITERIA_OPERATORS) {
      for (const value of ["0", "2", "0.02", "300.5", "BF", "bf_2026", "", "abc"]) {
        const condition = { id: "c1", type: "condition" as const, field, operator, value };
        assert.equal(
          evaluateValidationCriteria([condition], metrics),
          evaluateCondition(condition, metrics, LEGACY_FIELD_TYPES[field]),
          `divergiu: ${field} ${operator} "${value}"`,
        );
      }
    }
  }
});

test("Critério: os 11 campos mortos rejeitam TODO anúncio — o bug que a fase 4 conserta", () => {
  // Linha rica de propósito: mesmo tendo os dados, o mapper não os repassa.
  const metrics: Record<string, any> = { ad_name: "BF_2026", spend: 300, ctr: 0.02 };
  assert.equal(LEGACY_DEAD_FIELDS.length, 11);
  for (const field of LEGACY_DEAD_FIELDS) {
    for (const operator of CRITERIA_OPERATORS) {
      for (const value of ["", "0", "BF", "2026-08-28"]) {
        const condition = { id: "c1", type: "condition" as const, field, operator, value };
        assert.equal(
          evaluateValidationCriteria([condition], metrics),
          false,
          `${field} ${operator} "${value}" deveria rejeitar (campo morto)`,
        );
        assert.equal(
          evaluateCondition(condition, metrics, LEGACY_FIELD_TYPES[field]),
          false,
          `cópia divergiu em ${field} ${operator} "${value}"`,
        );
      }
    }
  }
});

test("Critério: hook e page_conv funcionam mas não são oferecidos — a outra metade do bug", () => {
  const metrics: Record<string, any> = { hook: 0.3, page_conv: 0.1 };
  // Provam que o dado chega; o que falta é o campo no dropdown (adMetricsFields.ts).
  assert.equal(
    evaluateValidationCriteria(
      [{ id: "c1", type: "condition", field: "hook", operator: "GREATER_THAN", value: "0.2" }],
      metrics,
    ),
    true,
  );
  assert.equal(LEGACY_FIELD_TYPES.hook, undefined, "hook não deveria estar no registry do Critério");
  assert.equal(LEGACY_FIELD_TYPES.page_conv, undefined, "page_conv não deveria estar no registry do Critério");
});
