/**
 * Colunas vinculadas como métricas (migration 140): chave, rótulos, união por packs,
 * valor por linha e o registro ativo por trás do motor de regras.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { SheetColumnMapping } from "@/lib/api/schemas";
import {
  buildCustomColumnDefs,
  buildCustomColumnKey,
  collectPackMappings,
  customColumnLabel,
  facetsForKind,
  getCustomMetricValue,
  getCustomTopValue,
  isCustomColumnKey,
  parseCustomColumnKey,
  resolveCustomColumn,
} from "../customColumns";
import { getActiveCustomColumn, setActiveCustomColumns } from "../customColumnsRegistry";
import { getMetricNumericValueOrNull } from "../calculations";
import { formatMetricValue, getMetricDefinition, getMetricDisplayLabel } from "../index";
import { getAvailableRuleFields, getRuleField } from "@/lib/rules/fields";
import { rowMatchesRules } from "@/lib/rules/evaluate";

const LS2: SheetColumnMapping = { id: "m-ls2", integration_id: "i1", column_index: 5, column_name: "LS2", label: "Leadscore V2", kind: "leadscore", config: { mql_min: 80 }, position: 0 };
const IDADE: SheetColumnMapping = { id: "m-idade", integration_id: "i1", column_index: 3, column_name: "IDADE", label: "Idade", kind: "number", config: {}, position: 1 };
const FAIXA: SheetColumnMapping = { id: "m-faixa", integration_id: "i1", column_name: "FAIXA", column_index: 4, label: "Faixa de renda", kind: "category", config: {}, position: 2 };

test("chave custom: monta, reconhece e desmonta", () => {
  const key = buildCustomColumnKey("m-idade", "avg");
  assert.equal(key, "custom:m-idade:avg");
  assert.ok(isCustomColumnKey(key));
  assert.deepEqual(parseCustomColumnKey(key), { mappingId: "m-idade", facet: "avg" });
  assert.equal(parseCustomColumnKey("custom:m-idade:nope"), null);
  assert.equal(isCustomColumnKey("spend"), false);
  assert.equal(isCustomColumnKey("custom:"), false);
});

test("facetas por tipo e rótulos", () => {
  assert.deepEqual(facetsForKind("leadscore"), ["avg", "mqls", "mql_rate", "cpmql"]);
  assert.deepEqual(facetsForKind("number"), ["avg"]);
  assert.deepEqual(facetsForKind("category"), ["top"]);
  assert.equal(customColumnLabel(LS2, "avg"), "Leadscore V2 médio");
  assert.equal(customColumnLabel(LS2, "cpmql"), "CPMQL (Leadscore V2)");
  assert.equal(customColumnLabel(IDADE, "avg"), "Média de Idade");
  assert.equal(customColumnLabel(FAIXA, "top"), "Faixa de renda");
  assert.equal(buildCustomColumnDefs([LS2, IDADE, FAIXA]).length, 6);
});

test("collectPackMappings: união sem repetição, só dos packs selecionados, ordenada", () => {
  const packs = [
    { id: "p1", sheet_integration: { column_mappings: [FAIXA, LS2] } },
    { id: "p2", sheet_integration: { column_mappings: [LS2, IDADE] } },
    { id: "p3", sheet_integration: { column_mappings: [{ ...IDADE, id: "outro" }] } },
    { id: "p4", sheet_integration: null },
  ];
  const got = collectPackMappings(packs, new Set(["p1", "p2", "p4"]));
  assert.deepEqual(got.map((m) => m.id), ["m-ls2", "m-idade", "m-faixa"]);
  assert.deepEqual(collectPackMappings(packs, new Set()), []);
  assert.deepEqual(collectPackMappings(packs, ["p3"]).map((m) => m.id), ["outro"]);
});

test("valor por linha: leadscore, número e categoria; sem histograma = null", () => {
  const defs = buildCustomColumnDefs([LS2, IDADE, FAIXA]);
  const row = {
    spend: 200,
    custom_histograms: {
      "m-ls2": { "70": 1, "80": 1, "90": 2 },
      "m-idade": { "20": 1, "40": 1 },
      "m-faixa": { A: 1, B: 3 },
    },
  };
  const by = Object.fromEntries(defs.map((d) => [d.key, d]));
  assert.equal(getCustomMetricValue(row, by["custom:m-ls2:avg"]), 82.5);
  assert.equal(getCustomMetricValue(row, by["custom:m-ls2:mqls"]), 3);
  assert.equal(getCustomMetricValue(row, by["custom:m-ls2:mql_rate"]), 0.75);
  assert.equal(getCustomMetricValue(row, by["custom:m-ls2:cpmql"]), 200 / 3);
  assert.equal(getCustomMetricValue(row, by["custom:m-idade:avg"]), 30);
  assert.equal(getCustomMetricValue(row, by["custom:m-faixa:top"]), null);
  assert.deepEqual(getCustomTopValue(row, "m-faixa"), { value: "B", qty: 3, share: 0.75 });
  assert.equal(getCustomMetricValue({ spend: 1, custom_histograms: {} }, by["custom:m-idade:avg"]), null);
  assert.equal(getCustomMetricValue({ spend: 1 }, by["custom:m-idade:avg"]), null);
});

test("registro ativo: a porta única de leitura de métrica e o motor de regra enxergam a coluna", () => {
  setActiveCustomColumns(buildCustomColumnDefs([IDADE, FAIXA]));
  assert.equal(getActiveCustomColumn("custom:m-idade:avg")?.label, "Média de Idade");
  assert.equal(resolveCustomColumn("custom:m-idade:avg", [IDADE])?.kind, "number");

  const row = { spend: 10, custom_histograms: { "m-idade": { "20": 1, "40": 1 }, "m-faixa": { A: 1, B: 3 } } };
  assert.equal(getMetricNumericValueOrNull(row, "custom:m-idade:avg", {}), 30);
  assert.equal(getMetricNumericValueOrNull(row, "custom:m-ls2:avg", {}), null, "vínculo fora do registro = sem dado");

  const fields = getAvailableRuleFields({ context: "manager" });
  assert.ok(fields.some((f) => f.id === "custom:m-idade:avg" && f.kind === "metric" && f.group === "Planilha"));
  assert.ok(fields.some((f) => f.id === "custom:m-faixa:top" && f.kind === "multiselect"));
  assert.ok(!getAvailableRuleFields({ context: "criteria" }).some((f) => f.id.startsWith("custom:")), "critério não oferece coluna de planilha");

  const idadeRule = { logic: "AND" as const, conditions: [{ id: "c1", type: "condition" as const, field: "custom:m-idade:avg", operator: ">=", value: "25" }] };
  assert.equal(rowMatchesRules(row, idadeRule), true);
  assert.equal(rowMatchesRules({ spend: 10, custom_histograms: {} }, idadeRule), false, "sem dado não casa");

  const faixaRule = { logic: "AND" as const, conditions: [{ id: "c2", type: "condition" as const, field: "custom:m-faixa:top", operator: "has_any", value: ["B"] }] };
  assert.equal(rowMatchesRules(row, faixaRule), true);
  assert.equal(rowMatchesRules(row, { ...faixaRule, conditions: [{ ...faixaRule.conditions[0], value: ["A"] }] }), false);

  // vínculo excluído: o campo continua conhecido (rotulado), a condição não casa
  setActiveCustomColumns([]);
  const gone = getRuleField("custom:m-idade:avg");
  assert.equal(gone?.label, "Coluna excluída (planilha)");
  assert.equal(rowMatchesRules(row, idadeRule), false);
});

test("as DUAS portas conhecem custom: a de leitura e a de FORMATAÇÃO", () => {
  // Regressão da primeira integração real (2026-09-04): o valor era calculado certo, mas
  // `formatMetricValue` resolvia pelo registry fixo, não achava a chave e devolvia "—".
  // Coluna com dado aparecendo vazia é o pior dos mundos: parece "não importou".
  setActiveCustomColumns(buildCustomColumnDefs([LS2, IDADE, FAIXA]));

  const definition = getMetricDefinition("custom:m-ls2:cpmql");
  assert.ok(definition, "getMetricDefinition tem de resolver chave custom");
  assert.equal(definition?.formatKind, "currency");
  assert.equal(definition?.polarity, "lower");
  assert.equal(getMetricDisplayLabel("custom:m-ls2:cpmql"), "CPMQL (Leadscore V2)");

  // Nenhuma faceta pode formatar como travessão tendo valor finito.
  const casos: Array<[string, number]> = [
    ["custom:m-ls2:avg", 82.5],
    ["custom:m-ls2:mqls", 3],
    ["custom:m-ls2:mql_rate", 0.75],
    ["custom:m-ls2:cpmql", 66.67],
    ["custom:m-idade:avg", 30],
  ];
  for (const [key, value] of casos) {
    const formatted = formatMetricValue(key, value, { currencyFormatter: (n) => `R$ ${n.toFixed(2)}` });
    assert.notEqual(formatted, "—", `${key} formatou como travessão`);
    assert.ok(formatted.length > 0, `${key} formatou vazio`);
  }
  assert.equal(formatMetricValue("custom:m-ls2:mql_rate", 0.75, {}), "75,00%");
  assert.equal(formatMetricValue("custom:m-ls2:cpmql", 66.67, { currencyFormatter: (n) => `R$ ${n.toFixed(2)}` }), "R$ 66.67");

  // Vínculo fora do registro continua sem definição (e a coluna nem é construída).
  setActiveCustomColumns([]);
  assert.equal(getMetricDefinition("custom:m-ls2:avg"), undefined);
});
