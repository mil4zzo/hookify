/**
 * Diferencial do motor único contra o comportamento CONGELADO das três telas.
 *
 * O QUE MUDOU DESDE QUE ESTE ARQUIVO NASCEU
 *   Ele começou como "cópia × produção": provava que `reference/legacyEvaluators.ts`
 *   era cópia fiel dos avaliadores enquanto os dois existiam. Os originais foram
 *   apagados nas fases 3 e 4, e o que sobrou tem MAIS valor, não menos — comparar o
 *   motor de hoje contra o registro do que a tela fazia antes é justamente o
 *   diferencial que o método do projeto exige antes de um cutover.
 *
 *   O bloco do Critério de validação (que importava `evaluateValidationCriteria` da
 *   produção) mudou de casa junto com a fase 4: virou `criteriaDifferential.test.ts`,
 *   onde as divergências INTENCIONAIS estão listadas uma a uma. Este arquivo fica com
 *   o que não diverge — texto, número e data.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { rowMatchesRules } from "@/lib/rules/evaluate";
import type { RuleTree } from "@/lib/rules/types";

import {
  compareDate,
  compareNumeric,
  compareText,
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
