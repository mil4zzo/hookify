import test from "node:test";
import assert from "node:assert/strict";
import { getManagerFilterableColumns, getVisibleManagerColumns, isManagerMetricColumnVisible } from "../managerColumnPreferences";

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

test("builds filterable columns preserving status, text columns and metric order", () => {
  const visibleColumns = getVisibleManagerColumns({
    activeColumns: new Set(["spend", "results", "website_ctr"] as const) as Set<any>,
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

  assert.deepEqual(filterableColumns, [
    { id: "status", label: "Status", isStatus: true },
    { id: "ad_name", label: "Anúncio", isText: true },
    { id: "campaign_name_filter", label: "Campanha", isText: true },
    { id: "spend", label: "Spend", isPercentage: false },
    { id: "results", label: "Results", isPercentage: false },
    { id: "website_ctr", label: "Link CTR", isPercentage: true },
  ]);
});
