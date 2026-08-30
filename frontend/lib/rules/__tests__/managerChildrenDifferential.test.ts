/**
 * DIFERENCIAL DA FASE 3 — motor novo × comportamento congelado das linhas-filhas.
 *
 * O QUE PROVA
 *   Que trocar `applyRowFilters` (apagado nesta fase) pelo avaliador único não
 *   mudou nenhuma resposta, EXCETO as divergências que a fase declarou de
 *   propósito. Cada divergência intencional tem um teste próprio abaixo, com o
 *   caso concreto — o que não estiver nessa lista é regressão.
 *
 * POR QUE O DIFERENCIAL É CONTRA A CÓPIA, E NÃO CONTRA A PRODUÇÃO
 *   A produção antiga não existe mais. `reference/legacyEvaluators.ts` é o registro
 *   congelado dela, e era cópia comprovadamente literal enquanto as duas
 *   coexistiam (o `referenceIsVerbatim.test.ts` provava isso, e morreu junto com
 *   os originais, como estava previsto).
 *
 * AS DUAS DIVERGÊNCIAS INTENCIONAIS
 *   1. Escala de porcentagem: a heurística `valor > 1 ? /100 : valor` errava em
 *      `hook < 0,5%`. Agora a escala é declarada e a divisão é incondicional.
 *   2. "Sem dado": métrica com divisor zero é `null` e não casa com comparador
 *      nenhum — antes o zero fabricado pela RPC passava por qualquer `<`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { rowMatchesRules } from "@/lib/rules/evaluate";
import type { RuleTree } from "@/lib/rules/types";
import {
  applyRowFiltersLegacy,
  type LegacyColumnFilterEntry,
  type LegacyFilterOperator,
  type LegacyTextFilterOperator,
} from "./reference/legacyEvaluators";

const NUMERIC_OPERATORS: LegacyFilterOperator[] = [">", "<", ">=", "<=", "=", "!="];
const TEXT_OPERATORS: LegacyTextFilterOperator[] = ["contains", "not_contains", "starts_with", "ends_with", "equals", "not_equals"];

/** Métricas SEM escala de porcentagem: o comportamento tem de ser idêntico. */
const PLAIN_METRICS = ["spend", "impressions", "clicks", "lpv"] as const;

const ROW_NUMBERS = [0, 1, 2, 30, 300.5, 12000];
const TARGETS = [0, 1, 2, 30, 300.5];

const ROW_TEXTS = ["", "   ", "BF_2026", "bf_2026", "Hook_v3 | BF", "ÁGUA"];
const TARGET_TEXTS = ["bf", "BF", "hook", "ÁGUA", "z"];

function numericRule(field: string, operator: string, value: number): RuleTree {
  return { logic: "AND", conditions: [{ id: "c1", type: "condition", field, operator, value }] };
}

function textRule(field: string, operator: string, value: string): RuleTree {
  return { logic: "AND", conditions: [{ id: "c1", type: "condition", field, operator, value }] };
}

function legacyNumeric(field: string, operator: string, value: number): LegacyColumnFilterEntry[] {
  return [{ id: field, value: { operator: operator as LegacyFilterOperator, value } }];
}

function legacyText(field: string, operator: string, value: string): LegacyColumnFilterEntry[] {
  return [{ id: field, value: { operator: operator as LegacyTextFilterOperator, value } }];
}

test("métrica sem escala: motor novo responde igual ao congelado, em toda a matriz", () => {
  let comparacoes = 0;
  for (const field of PLAIN_METRICS) {
    for (const rowValue of ROW_NUMBERS) {
      const row = { [field]: rowValue, impressions: 40000, plays: 5000 };
      for (const operator of NUMERIC_OPERATORS) {
        for (const target of TARGETS) {
          assert.equal(
            rowMatchesRules(row, numericRule(field, operator, target)),
            applyRowFiltersLegacy(row, legacyNumeric(field, operator, target)),
            `divergiu: ${field} ${rowValue} ${operator} ${target}`,
          );
          comparacoes += 1;
        }
      }
    }
  }
  assert.ok(comparacoes >= 500, `matriz pequena demais para provar algo: ${comparacoes}`);
});

test("texto: motor novo responde igual ao congelado, em toda a matriz", () => {
  for (const rowText of ROW_TEXTS) {
    const row = { ad_name: rowText };
    for (const operator of TEXT_OPERATORS) {
      for (const target of TARGET_TEXTS) {
        assert.equal(
          rowMatchesRules(row, textRule("ad_name", operator, target)),
          applyRowFiltersLegacy(row, legacyText("ad_name", operator, target)),
          `divergiu: "${rowText}" ${operator} "${target}"`,
        );
      }
    }
  }
});

test("condição em branco não restringe — igual nos dois", () => {
  const row = { ad_name: "BF_2026", spend: 300 };
  assert.equal(rowMatchesRules(row, textRule("ad_name", "contains", "")), true);
  assert.equal(applyRowFiltersLegacy(row, legacyText("ad_name", "contains", "")), true);
});

/* ------------------------------------------------------------------ *
 * Divergências INTENCIONAIS — cada uma com o caso concreto que a motiva
 * ------------------------------------------------------------------ */

test("DIVERGE (de propósito): a heurística `> 1` errava em hook < 0,5%", () => {
  // Linha com hook de 0,2%. O usuário quer "hook < 0,5%" e espera que ela entre.
  const row = { hook: 0.002, plays: 5000 };

  // Congelado: 0,5 não é > 1, então NÃO dividia — comparava 0,002 < 0,5 e acertava
  // por acidente aqui, mas errava no sentido oposto (ver o caso seguinte).
  const novo = rowMatchesRules(row, numericRule("hook", "<", 0.5));
  assert.equal(novo, true, "0,2% deve entrar em `hook < 0,5%`");

  // O caso onde a heurística realmente quebra: "hook > 0,5%" com uma linha de 2%.
  const linha2pct = { hook: 0.02, plays: 5000 };
  assert.equal(rowMatchesRules(linha2pct, numericRule("hook", ">", 0.5)), true, "2% é maior que 0,5%");
  assert.equal(
    applyRowFiltersLegacy(linha2pct, legacyNumeric("hook", ">", 0.5)),
    false,
    "o congelado comparava 0,02 > 0,5 e devolvia false — este era o bug",
  );
});

test("DIVERGE (de propósito): métrica com divisor zero não casa com comparador nenhum", () => {
  // Anúncio de imagem: a RPC devolve hook = 0, mas não houve vídeo.
  const imagem = { hook: 0, plays: 0, media_type: "image", impressions: 40000 };

  // Congelado: o zero fabricado passava por qualquer "menor que".
  assert.equal(applyRowFiltersLegacy(imagem, legacyNumeric("hook", "<", 5)), true, "o congelado trazia todo estático");

  // Novo: não casa com `<` NEM com `>=` — é ausência, não valor.
  assert.equal(rowMatchesRules(imagem, numericRule("hook", "<", 5)), false);
  assert.equal(rowMatchesRules(imagem, numericRule("hook", ">=", 5)), false);

  // E o mesmo para CPR sem conversão, que liderava "CPR mais barato".
  const semConversao = { spend: 300, conversions: {}, impressions: 1000 };
  assert.equal(rowMatchesRules(semConversao, numericRule("cpr", "<", 50)), false);
});

test("o que NÃO diverge: zero real de uma contagem continua sendo zero", () => {
  // `clicks = 0` é fato, não ausência — os dois têm de concordar.
  const row = { clicks: 0, impressions: 40000, spend: 12 };
  for (const operator of NUMERIC_OPERATORS) {
    for (const target of [0, 1, 30]) {
      assert.equal(
        rowMatchesRules(row, numericRule("clicks", operator, target)),
        applyRowFiltersLegacy(row, legacyNumeric("clicks", operator, target)),
        `divergiu: clicks 0 ${operator} ${target}`,
      );
    }
  }
});

/* ------------------------------------------------------------------ *
 * O que o formato antigo NÃO conseguia expressar
 * ------------------------------------------------------------------ */

test("OU entre colunas — o motivo de todo o refactor", () => {
  // Duas linhas: uma casa só pelo nome, outra só pela métrica.
  const porNome = { ad_name: "BF_2026", spend: 10, impressions: 100 };
  const porMetrica = { ad_name: "Sempre On", spend: 5000, impressions: 100 };
  const nenhuma = { ad_name: "Sempre On", spend: 10, impressions: 100 };

  const ou: RuleTree = {
    logic: "OR",
    conditions: [
      { id: "a", type: "condition", field: "ad_name", operator: "contains", value: "BF" },
      { id: "b", type: "condition", field: "spend", operator: ">", value: 1000 },
    ],
  };

  assert.equal(rowMatchesRules(porNome, ou), true);
  assert.equal(rowMatchesRules(porMetrica, ou), true);
  assert.equal(rowMatchesRules(nenhuma, ou), false);

  // No formato antigo isso era inexprimível: a lista plana só combinava em E.
  const e = applyRowFiltersLegacy(porNome, [
    ...legacyText("ad_name", "contains", "BF"),
    ...legacyNumeric("spend", ">", 1000),
  ]);
  assert.equal(e, false, "o congelado só sabia E — a linha caía fora");
});
