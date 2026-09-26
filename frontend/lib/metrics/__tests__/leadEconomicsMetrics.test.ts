import test from "node:test";
import assert from "node:assert/strict";
import { computeManagerAverages, getMetricNumericValueOrNull, MANAGER_METRIC_KEYS } from "@/lib/metrics";
import { formatManagerChildMetricValue } from "@/lib/metrics/managerPresentation";
import { getAvailableRuleFields, getRuleSortMetrics } from "@/lib/rules/fields";
import { filterRowsByRules } from "@/lib/rules/evaluate";
import { getVisibleManagerColumns, isManagerColumnAvailable, isManagerMetricColumnVisible } from "@/components/manager/managerColumnPreferences";
import type { LeadEconomics, LeadEconomicsByPack } from "@/lib/utils/leadEconomics";

/**
 * Teto de CPL e Margem ligados ao resto do Manager: a porta única de leitura
 * (`getMetricNumericValueOrNull`), as médias do cabeçalho, a disponibilidade das
 * colunas e o motor de regras. A conta em si é testada em leadEconomicsRows.test.ts.
 */

function economics(ticket: number, contribution: number, target: number, conversion: number): LeadEconomics {
  return {
    products: [{ id: "p", name: "Produto", ticket, contribution_margin: contribution, target_margin: target }],
    bands: [{ min: null, product: "p", conversion }],
  };
}
// Teto por lead: A = 0,1 × 1000 × 0,3 = 30 · B = 0,1 × 2000 × 0,3 = 60.
const A = economics(1000, 0.5, 0.2, 0.1);
const B = economics(2000, 0.6, 0.3, 0.1);
const BY_PACK: LeadEconomicsByPack = { a: A, b: B };

const ROW_A = { pack_ids: ["a"], spend: 400, leadscore_histogram: { "70": 10 } }; // CPL 40
const ROW_B = { pack_ids: ["b"], spend: 400, leadscore_histogram: { "70": 10 } }; // CPL 40
const ROW_MIXED = { pack_ids: ["a", "b"], spend: 100, leadscore_histogram: { "70": 5 } };

test("leitura: cada linha com o cadastro do SEU pack, na mesma tela", () => {
  const context = { leadEconomicsByPack: BY_PACK };
  assert.equal(getMetricNumericValueOrNull(ROW_A, "cpl_ceiling", context), 30);
  assert.equal(getMetricNumericValueOrNull(ROW_B, "cpl_ceiling", context), 60);
  // A: margem = (50 − 40) ÷ 100 = 0,1 · B: (120 − 40) ÷ 200 = 0,4
  assert.ok(Math.abs((getMetricNumericValueOrNull(ROW_A, "lead_margin", context) ?? NaN) - 0.1) < 1e-12);
  assert.ok(Math.abs((getMetricNumericValueOrNull(ROW_B, "lead_margin", context) ?? NaN) - 0.4) < 1e-12);
  // Só a linha mista fica sem número — não a tela inteira (D27).
  assert.equal(getMetricNumericValueOrNull(ROW_MIXED, "cpl_ceiling", context), null);
});

test("leitura: sem o mapa, vale o campo pré-calculado — e ausente/null continua null, nunca 0", () => {
  assert.equal(getMetricNumericValueOrNull({ cpl_ceiling: 12.5 }, "cpl_ceiling"), 12.5);
  assert.equal(getMetricNumericValueOrNull({ cpl_ceiling: null }, "cpl_ceiling"), null, "null pré-calculado não vira teto R$ 0");
  assert.equal(getMetricNumericValueOrNull({}, "lead_margin"), null);
  // Um campo com o mesmo nome NÃO passa por cima da conta quando há mapa.
  assert.equal(getMetricNumericValueOrNull({ ...ROW_A, cpl_ceiling: 999 }, "cpl_ceiling", { leadEconomicsByPack: BY_PACK }), 30);
});

test("filhas: formatação mostra '—' sem valor, nunca 'R$ 0,00'", () => {
  const brl = (n: number) => `R$ ${n.toFixed(2)}`;
  assert.equal(formatManagerChildMetricValue("cpl_ceiling", { cpl_ceiling: null }, { currencyFormatter: brl }), "—");
  assert.equal(formatManagerChildMetricValue("lead_margin", {}, { currencyFormatter: brl }), "—");
  assert.equal(formatManagerChildMetricValue("cpl_ceiling", { cpl_ceiling: 30 }, { currencyFormatter: brl }), "R$ 30.00");
});

test("médias: teto e margem do conjunto, com o resumo de quem ficou de fora", () => {
  const averages = computeManagerAverages([ROW_A, ROW_B, ROW_MIXED], { hasSheetIntegration: true, leadEconomicsByPack: BY_PACK });
  // Ponderado pelos leads (10 e 10): teto (30 + 60) / 2 = 45; a mista (5 leads) fica de fora.
  assert.equal(averages.cpl_ceiling, 45);
  assert.equal(averages.lead_economics_rows?.excludedMixed, 1);
  assert.equal(averages.lead_economics_rows?.leadsScored, 20);
  // Sem planilha não há nota; sem o mapa, não há economia: nada de média fabricada.
  assert.equal(computeManagerAverages([ROW_A], { hasSheetIntegration: false, leadEconomicsByPack: BY_PACK }).cpl_ceiling, null);
  const noMap = computeManagerAverages([ROW_A], { hasSheetIntegration: true });
  assert.equal(noMap.cpl_ceiling, null);
  assert.equal(noMap.lead_economics_rows, null);
  // Mapa sem nenhum cadastro (packs selecionados, todos sem economia): nem resumo.
  assert.equal(computeManagerAverages([ROW_A], { hasSheetIntegration: true, leadEconomicsByPack: { a: null } }).lead_economics_rows, null);
});

test("colunas: existem só com planilha E cadastro — regra única para tabela, filhas e export", () => {
  assert.equal(isManagerColumnAvailable("cpl_ceiling", { hasSheetIntegration: true, hasLeadEconomics: true }), true);
  assert.equal(isManagerColumnAvailable("lead_margin", { hasSheetIntegration: true, hasLeadEconomics: false }), false);
  assert.equal(isManagerColumnAvailable("lead_margin", { hasSheetIntegration: false, hasLeadEconomics: true }), false);
  // As métricas de planilha de antes continuam com a mesma regra (a lista copiada virou definição).
  for (const id of ["cpmql", "mqls", "leadscore_avg", "mql_rate"] as const) {
    assert.equal(isManagerColumnAvailable(id, { hasSheetIntegration: false, hasLeadEconomics: true }), false, id);
    assert.equal(isManagerColumnAvailable(id, { hasSheetIntegration: true }), true, id);
  }
  assert.equal(isManagerColumnAvailable("spend", {}), true);

  const activeColumns = new Set(["spend", "cpl_ceiling", "lead_margin"] as const) as Set<any>;
  assert.equal(isManagerMetricColumnVisible("cpl_ceiling", { activeColumns, hasSheetIntegration: true, hasLeadEconomics: false }), false);
  // Ordem padrão: investimento primeiro, as duas logo depois do CPMQL.
  assert.deepEqual(getVisibleManagerColumns({ activeColumns, hasSheetIntegration: true, hasLeadEconomics: true }).map((c) => c.id), ["spend", "cpl_ceiling", "lead_margin"]);
  assert.deepEqual(getVisibleManagerColumns({ activeColumns, hasSheetIntegration: true, hasLeadEconomics: false }).map((c) => c.id), ["spend"]);
});

test("regras: oferecidas só no Manager e só com cadastro; fora da ordenação dos Boards", () => {
  const ids = (fields: { id: string }[]) => new Set(fields.map((f) => f.id));
  const managerWith = ids(getAvailableRuleFields({ hasSheetIntegration: true, hasLeadEconomics: true, context: "manager" }));
  assert.ok(managerWith.has("cpl_ceiling") && managerWith.has("lead_margin"));
  assert.ok(ids(getAvailableRuleFields({ hasSheetIntegration: true, hasLeadEconomics: true, context: "manager-children" })).has("lead_margin"));

  // Sem cadastro, sem campo. No Boards, no Critério: a conta não chega lá — campo que não responderia.
  assert.ok(!ids(getAvailableRuleFields({ hasSheetIntegration: true, hasLeadEconomics: false, context: "manager" })).has("lead_margin"));
  for (const context of ["boards", "criteria"] as const) {
    assert.ok(!ids(getAvailableRuleFields({ hasSheetIntegration: true, hasLeadEconomics: true, context })).has("lead_margin"), context);
  }
  const sortable = new Set(getRuleSortMetrics({ hasSheetIntegration: true }).map((m) => m.value));
  assert.ok(!sortable.has("cpl_ceiling") && !sortable.has("lead_margin"));
  assert.ok(sortable.has("cpmql"), "as outras de planilha continuam ordenáveis");
  assert.ok((MANAGER_METRIC_KEYS as readonly string[]).includes("lead_margin"));
});

test("regras: 'Margem < 20%' avalia cada linha com o cadastro dela; linha mista não casa", () => {
  const rules = {
    logic: "AND" as const,
    conditions: [{ id: "c1", type: "condition" as const, field: "lead_margin", operator: "<", value: 20 }],
  };
  const rows = [ROW_A, ROW_B, ROW_MIXED];
  const matched = filterRowsByRules(rows as any[], rules as any, { leadEconomicsByPack: BY_PACK });
  // A tem margem 10% (casa); B tem 40% (não); a mista não tem número (não casa nem com o contrário).
  assert.deepEqual(matched, [ROW_A]);
  // Sem o mapa (fora do Manager), nenhuma linha tem margem: a condição não casa ninguém.
  assert.deepEqual(filterRowsByRules(rows as any[], rules as any, {}), []);
});
