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

test("created_date filters as date, not as text", () => {
  const visibleColumns = getVisibleManagerColumns({
    activeColumns: new Set(["spend", "pack", "created_date"] as const) as Set<any>,
    hasSheetIntegration: true,
  });

  const filterableColumns = getManagerFilterableColumns({ visibleColumns });

  // Pack e Conta sao dimensoes de TEXTO; "Criado em" e dimensao de DATA — o FilterBar
  // escolhe o editor (calendario vs input livre) por essa flag.
  assert.deepEqual(filterableColumns, [
    { id: "spend", label: "Spend", isPercentage: false },
    { id: "pack", label: "Pack", isText: true },
    { id: "created_date", label: "Criado em", isDate: true },
  ]);
});

// ── Colunas vinculadas da planilha (migration 140) ───────────────────────────
import { buildCustomColumnDefs } from "@/lib/metrics/customColumns";

const CUSTOM_DEFS = buildCustomColumnDefs([
  { id: "m-idade", integration_id: "i1", column_index: 3, column_name: "IDADE", label: "Idade", kind: "number", config: {}, position: 0 },
  { id: "m-faixa", integration_id: "i1", column_index: 4, column_name: "FAIXA", label: "Faixa", kind: "category", config: {}, position: 1 },
]);

test("140: chave custom só é conhecida quando o vínculo está na seleção; as novas entram no fim", () => {
  const saved = ["custom:m-idade:avg", "spend", "custom:vinculo-excluido:avg", "results"];

  // Sem colunas vinculadas na seleção: as duas chaves custom somem, a ordem fixa fica intacta.
  const semVinculo = normalizeManagerColumnOrder(saved);
  assert.deepEqual(semVinculo.slice(0, 2), ["spend", "results"]);
  assert.ok(!semVinculo.some((id) => String(id).startsWith("custom:")));

  // Com os vínculos: a salva mantém o lugar, a excluída some, a nova (categoria) entra no fim.
  const comVinculo = normalizeManagerColumnOrder(saved, CUSTOM_DEFS);
  assert.equal(comVinculo[0], "custom:m-idade:avg");
  assert.ok(!comVinculo.includes("custom:vinculo-excluido:avg" as any));
  assert.equal(comVinculo[comVinculo.length - 1], "custom:m-faixa:top");
  assert.equal(comVinculo.length, MANAGER_COLUMN_RENDER_ORDER.length + 2);
});

test("140: coluna vinculada ativa só é visível com o vínculo na seleção", () => {
  const activeColumns = new Set(["spend", "custom:m-idade:avg", "custom:m-faixa:top"] as const) as Set<any>;
  const ids = new Set(CUSTOM_DEFS.map((d) => d.key));

  assert.equal(isManagerMetricColumnVisible("custom:m-idade:avg", { activeColumns, customColumnIds: ids }), true);
  assert.equal(isManagerMetricColumnVisible("custom:m-idade:avg", { activeColumns }), false);

  const visible = getVisibleManagerColumns({ activeColumns, hasSheetIntegration: false, customColumns: CUSTOM_DEFS });
  assert.deepEqual(visible.map((c) => c.id), ["spend", "custom:m-idade:avg", "custom:m-faixa:top"]);
  // categoria é texto na célula: tratada como dimensão onde só métrica faz sentido
  assert.equal(visible.find((c) => c.id === "custom:m-faixa:top")?.isDimension, true);
  assert.equal(visible.find((c) => c.id === "custom:m-idade:avg")?.custom?.kind, "number");

  const filterable = getManagerFilterableColumns({ visibleColumns: visible });
  assert.deepEqual(filterable.find((c) => c.id === "custom:m-idade:avg"), { id: "custom:m-idade:avg", label: "Média de Idade", isPercentage: false });
});
