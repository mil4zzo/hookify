import test from "node:test";
import assert from "node:assert/strict";
import { computeManagerAverages } from "@/lib/metrics";
import { filterRowsByRules } from "@/lib/rules/evaluate";
import { getAvailableRuleFields, LEAD_MARGIN_STATUS_FIELD_ID } from "@/lib/rules/fields";
import { hasBelowTargetFilter, toggleBelowTargetFilter } from "@/lib/rules/leadMarginFilter";
import { isManagerRuleFieldVisible, pruneRulesForVisibleFields } from "@/lib/manager/managerRules";
import { EMPTY_RULE_TREE, type RuleTree } from "@/lib/rules/types";
import type { LeadEconomics, LeadEconomicsByPack } from "@/lib/utils/leadEconomics";

/**
 * "Margem vs meta" — o filtro que o "N de M abaixo da meta de margem" liga no clique
 * (revisão P2). A meta muda de pack para pack, então nenhum "Margem < X%" responde
 * "abaixo da meta": o filtro compara cada linha com a meta DELA, pela mesma régua da
 * cor da célula e da contagem do resumo.
 */

function economics(ticket: number, contribution: number, target: number, conversion: number): LeadEconomics {
  return {
    products: [{ id: "p", name: "Produto", ticket, contribution_margin: contribution, target_margin: target }],
    bands: [{ min: null, product: "p", conversion }],
  };
}
// A: R 100, K 50, meta 20% (teto 30) · B: R 200, K 120, meta 30% (teto 60).
const BY_PACK: LeadEconomicsByPack = { a: economics(1000, 0.5, 0.2, 0.1), b: economics(2000, 0.6, 0.3, 0.1), sem: null };

const leads = { "70": 10 };
const BELOW = { id: "below", pack_ids: ["a"], spend: 400, leadscore_histogram: leads }; // CPL 40 → margem 10% < 20%, com lucro
const ON = { id: "on", pack_ids: ["b"], spend: 400, leadscore_histogram: leads }; // CPL 40 → margem 40% ≥ 30%
const EXACT = { id: "exact", pack_ids: ["a"], spend: 300, leadscore_histogram: leads }; // CPL no teto → margem = meta: na meta
const LOSS = { id: "loss", pack_ids: ["a"], spend: 800, leadscore_histogram: leads }; // CPL 80 → margem −30%
const MIXED = { id: "mixed", pack_ids: ["a", "b"], spend: 100, leadscore_histogram: leads }; // sem margem
const NO_ECONOMICS = { id: "sem", pack_ids: ["sem"], spend: 100, leadscore_histogram: leads }; // sem margem
const ROWS = [BELOW, ON, EXACT, LOSS, MIXED, NO_ECONOMICS];

const CONTEXT = { leadEconomicsByPack: BY_PACK };
const ids = (rows: { id: string }[]) => rows.map((row) => row.id);
const rule = (operator: string, value: string[]): RuleTree => ({
  logic: "AND",
  conditions: [{ id: "c", type: "condition", field: LEAD_MARGIN_STATUS_FIELD_ID, operator, value }],
});

test("cada linha contra a PRÓPRIA meta: 10% abaixo de 20% casa; 40% acima de 30% não", () => {
  assert.deepEqual(ids(filterRowsByRules(ROWS, rule("has_any", ["below_target", "loss"]), CONTEXT)), ["below", "loss"]);
  assert.deepEqual(ids(filterRowsByRules(ROWS, rule("has_any", ["on_target"]), CONTEXT)), ["on", "exact"]);
  assert.deepEqual(ids(filterRowsByRules(ROWS, rule("has_any", ["loss"]), CONTEXT)), ["loss"]);
});

test("linha sem margem não casa nem com \"é\" nem com \"não é\" (três estados)", () => {
  // "Não é: na meta" não traz a linha mista nem a de pack sem cadastro: não há margem a negar.
  assert.deepEqual(ids(filterRowsByRules(ROWS, rule("has_none", ["on_target"]), CONTEXT)), ["below", "loss"]);
  // Fora do Manager (sem o mapa), nenhuma linha tem margem.
  assert.deepEqual(filterRowsByRules(ROWS, rule("has_any", ["below_target", "loss"]), {}), []);
  // Nada escolhido: pergunta em branco, não restringe.
  assert.equal(filterRowsByRules(ROWS, rule("has_any", []), CONTEXT).length, ROWS.length);
});

test("o link filtra EXATAMENTE as linhas que o resumo conta", () => {
  const summary = computeManagerAverages(ROWS, { hasSheetIntegration: true, leadEconomicsByPack: BY_PACK }).lead_economics_rows;
  assert.ok(summary);
  const filtered = filterRowsByRules(ROWS, toggleBelowTargetFilter(EMPTY_RULE_TREE, () => "x"), CONTEXT);
  assert.equal(filtered.length, summary.rowsBelowTarget);
  assert.equal(summary.rowsWithMargin, 4);
  // Depois de filtrar, o resumo sobre o que está na tela: "2 de 2".
  const after = computeManagerAverages(filtered, { hasSheetIntegration: true, leadEconomicsByPack: BY_PACK }).lead_economics_rows;
  assert.equal(after?.rowsBelowTarget, 2);
  assert.equal(after?.rowsWithMargin, 2);
});

test("clique liga e desliga; soma à regra que já existe sem alargar a tela", () => {
  let n = 0;
  const newId = () => `id${++n}`;
  const on = toggleBelowTargetFilter(EMPTY_RULE_TREE, newId);
  assert.ok(hasBelowTargetFilter(on));
  assert.deepEqual(toggleBelowTargetFilter(on, newId), EMPTY_RULE_TREE, "segundo clique desliga");

  // Raiz "E" com outra condição: acrescenta ao lado.
  const spendOver: RuleTree = { logic: "AND", conditions: [{ id: "s", type: "condition", field: "spend", operator: ">", value: 350 }] };
  const both = toggleBelowTargetFilter(spendOver, newId);
  assert.equal(both.conditions.length, 2);
  assert.deepEqual(ids(filterRowsByRules(ROWS, both, CONTEXT)), ["below", "loss"]);
  assert.deepEqual(toggleBelowTargetFilter(both, newId), spendOver, "desligar devolve a regra de antes");

  // Raiz "OU": a regra antiga vira subgrupo. Acrescentar ao "OU" traria "on" e "exact" junto.
  const anyOf: RuleTree = {
    logic: "OR",
    conditions: [
      { id: "s1", type: "condition", field: "spend", operator: ">", value: 700 },
      { id: "s2", type: "condition", field: "spend", operator: "<", value: 350 },
    ],
  };
  const narrowed = toggleBelowTargetFilter(anyOf, newId);
  assert.equal(narrowed.logic, "AND");
  assert.ok(hasBelowTargetFilter(narrowed));
  assert.deepEqual(ids(filterRowsByRules(ROWS, narrowed, CONTEXT)), ["loss"]);
  // A mesma condição dentro de um "OU" não conta como ligada: sozinha ela não restringe a tela.
  assert.equal(hasBelowTargetFilter({ logic: "OR", conditions: on.conditions }), false);
});

test("oferecido só no Manager e só com cadastro; sobrevive à poda enquanto Margem ou Teto está na tela", () => {
  const offered = (context: "manager" | "manager-children" | "boards" | "criteria", hasLeadEconomics = true) =>
    getAvailableRuleFields({ hasSheetIntegration: true, hasLeadEconomics, context }).some((field) => field.id === LEAD_MARGIN_STATUS_FIELD_ID);
  assert.ok(offered("manager") && offered("manager-children"));
  assert.ok(!offered("boards") && !offered("criteria"), "lá a economia por linha não chega: campo que não responde");
  assert.ok(!offered("manager", false));

  assert.ok(isManagerRuleFieldVisible(LEAD_MARGIN_STATUS_FIELD_ID, new Set(["lead_margin"])));
  assert.ok(isManagerRuleFieldVisible(LEAD_MARGIN_STATUS_FIELD_ID, new Set(["cpl_ceiling"])));
  assert.ok(!isManagerRuleFieldVisible(LEAD_MARGIN_STATUS_FIELD_ID, new Set(["spend", "cpmql"])));
  const filtered = toggleBelowTargetFilter(EMPTY_RULE_TREE, () => "x");
  assert.equal(pruneRulesForVisibleFields(filtered, (id) => isManagerRuleFieldVisible(id, new Set(["lead_margin"]))), filtered);
  assert.equal(pruneRulesForVisibleFields(filtered, (id) => isManagerRuleFieldVisible(id, new Set(["spend"]))).conditions.length, 0);
  // O resto da regra da poda não mudou.
  assert.ok(isManagerRuleFieldVisible("ad_name", new Set()) && isManagerRuleFieldVisible("status", new Set()));
  assert.ok(isManagerRuleFieldVisible("cpmql", new Set(["cpmql"])) && !isManagerRuleFieldVisible("cpmql", new Set()));
});
