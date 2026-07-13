import test from "node:test";
import assert from "node:assert/strict";
import { getManagerFilterableColumns, getVisibleManagerColumns, isManagerMetricColumnVisible, normalizeManagerColumnOrder } from "../managerColumnPreferences";
import { MANAGER_COLUMN_RENDER_ORDER } from "../managerColumns";

test("hides sheet-dependent metric columns when integration is unavailable", () => {
  const activeColumns = new Set([
    "spend",
    "results",
    "mqls",
    "cpmql",
  ] as const);

  assert.equal(isManagerMetricColumnVisible("spend", { activeColumns, hasSheetIntegration: false }), true);
  assert.equal(isManagerMetricColumnVisible("mqls", { activeColumns, hasSheetIntegration: false }), false);
  assert.equal(isManagerMetricColumnVisible("cpmql", { activeColumns, hasSheetIntegration: false }), false);

  const visibleWithoutSheet = getVisibleManagerColumns({
    activeColumns: activeColumns as Set<any>,
    hasSheetIntegration: false,
  }).map((column) => column.id);

  assert.deepEqual(visibleWithoutSheet, ["spend", "results"]);

  const visibleWithSheet = getVisibleManagerColumns({
    activeColumns: activeColumns as Set<any>,
    hasSheetIntegration: true,
  }).map((column) => column.id);

  assert.deepEqual(visibleWithSheet, ["spend", "results", "mqls", "cpmql"]);
});

test("renders visible columns in the user's order, not the default one", () => {
  const activeColumns = new Set(["spend", "results", "cpr"] as const) as Set<any>;
  // Ordem invertida em relação ao default (spend → results → cpr).
  const columnOrder = ["cpr", "results", "spend", ...MANAGER_COLUMN_RENDER_ORDER.filter((id) => id !== "cpr" && id !== "results" && id !== "spend")] as any;

  const visible = getVisibleManagerColumns({ activeColumns, columnOrder, hasSheetIntegration: true }).map((column) => column.id);
  assert.deepEqual(visible, ["cpr", "results", "spend"]);

  // Sem columnOrder, cai na ordem padrão.
  const visibleDefault = getVisibleManagerColumns({ activeColumns, hasSheetIntegration: true }).map((column) => column.id);
  assert.deepEqual(visibleDefault, ["spend", "results", "cpr"]);
});

test("normalizes a saved order: drops unknown/duplicated ids and appends columns added later", () => {
  const saved = ["cpr", "spend", "cpr", "metrica_que_nao_existe", "results"];
  const normalized = normalizeManagerColumnOrder(saved);

  assert.deepEqual(normalized.slice(0, 3), ["cpr", "spend", "results"]);
  // Toda coluna conhecida aparece exatamente uma vez — as que não estavam salvas entram no fim.
  assert.equal(normalized.length, MANAGER_COLUMN_RENDER_ORDER.length);
  assert.equal(new Set(normalized).size, MANAGER_COLUMN_RENDER_ORDER.length);
  for (const columnId of MANAGER_COLUMN_RENDER_ORDER) {
    assert.ok(normalized.includes(columnId), `coluna ausente após normalizar: ${columnId}`);
  }

  // Entrada inválida (sem preferência salva) devolve a ordem padrão.
  assert.deepEqual(normalizeManagerColumnOrder(null), [...MANAGER_COLUMN_RENDER_ORDER]);
});

test("builds filterable columns preserving status, text columns and metric order", () => {
  const visibleColumns = getVisibleManagerColumns({
    activeColumns: new Set(["spend", "impressions", "results", "website_ctr"] as const) as Set<any>,
    hasSheetIntegration: true,
  });

  const filterableColumns = getManagerFilterableColumns({
    visibleColumns,
    includeStatus: true,
    textColumns: [
      { id: "ad_name", label: "Anúncio", isText: true },
      { id: "campaign_name_filter", label: "Campanha", isText: true },
    ],
  });

  // Ordem padrão atual: spend → results (bloco de investimento/resultado) → website_ctr
  // (funil de página) → impressions (bloco bruto, no fim).
  assert.deepEqual(filterableColumns, [
    { id: "status", label: "Status", isStatus: true },
    { id: "ad_name", label: "Anúncio", isText: true },
    { id: "campaign_name_filter", label: "Campanha", isText: true },
    { id: "spend", label: "Spend", isPercentage: false },
    { id: "results", label: "Results", isPercentage: false },
    { id: "website_ctr", label: "Link CTR", isPercentage: true },
    { id: "impressions", label: "Impressions", isPercentage: false },
  ]);
});
