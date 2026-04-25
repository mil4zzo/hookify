import test from "node:test";
import assert from "node:assert/strict";
import {
  compareManagerChildRows,
  buildGroupedMetricBaseSeries,
  buildMetricSeriesFromSourceSeries,
  computeManagerAverages,
  formatMetricValue,
  formatManagerAverageValue,
  formatManagerChildMetricValue,
  getManagerChildSortInitialDirection,
  getManagerMetricCurrentValue,
  getManagerMetricDeltaPresentation,
  getManagerMetricTrendPresentation,
  getMetricAverageTooltip,
  getMetricDefinition,
  getMetricDisplayLabel,
  getMetricNumericValue,
  getManagerMetricLabel,
  getMetricTooltipContent,
  isLowerBetterMetric,
  resolveMetricKey,
} from "../index";
import { formatCurrency, formatLocaleRatioPercent } from "@/lib/utils/currency";

test("resolve aliases and preserve canonical labels", () => {
  assert.equal(resolveMetricKey("link_ctr"), "website_ctr");
  assert.equal(getMetricDisplayLabel("link_ctr"), "Link CTR");
  assert.equal(getMetricAverageTooltip("link_ctr"), "Link CTR medio");
});

test("exposes polarity, descriptions and context requirements from registry", () => {
  assert.equal(isLowerBetterMetric("cpr"), true);
  assert.equal(isLowerBetterMetric("hook"), false);

  const cprDefinition = getMetricDefinition("cpr");
  assert.equal(cprDefinition?.requiresActionType, true);
  assert.equal(cprDefinition?.polarity, "lower");

  const tooltip = getMetricTooltipContent("page_conv");
  assert.deepEqual(tooltip, {
    title: "Page Conv",
    description: "Mostra a eficiência da página em converter visitas em resultado.",
    technicalDescription: "Results dividido por LPV.",
  });
});

test("formats values according to canonical format kind", () => {
  assert.equal(formatMetricValue("cpm", 12.5), formatCurrency(12.5));
  assert.equal(formatMetricValue("hook", 0.2567), formatLocaleRatioPercent(0.2567));
  assert.equal(formatMetricValue("video_watched_p50", 43.2), "43%");
  assert.equal(formatMetricValue("impressions", 1234), "1.234");
});

test("calculates numeric metric values from backend or fallbacks", () => {
  const source = {
    spend: 120,
    impressions: 2000,
    clicks: 100,
    inline_link_clicks: 40,
    lpv: 20,
    conversions: { lead: 10 },
    mqls: 4,
  };

  assert.equal(getMetricNumericValue(source, "website_ctr"), 0.02);
  assert.equal(getMetricNumericValue(source, "page_conv", { actionType: "lead" }), 0.5);
  assert.equal(getMetricNumericValue(source, "cpr", { actionType: "lead" }), 12);
  assert.equal(getMetricNumericValue(source, "cpc"), 1.2);
  assert.equal(getMetricNumericValue(source, "cpm"), 60);
  assert.equal(getMetricNumericValue(source, "cpmql"), 30);
});

test("resolves action type aliases in values and series", () => {
  const source = {
    spend: 90,
    lpv: 15,
    conversions: { "conversion:lead": 6 },
  };

  assert.equal(getMetricNumericValue(source, "results", { actionType: "lead" }), 6);
  assert.equal(getMetricNumericValue(source, "cpr", { actionType: "lead" }), 15);

  const series = {
    spend: [45, 45],
    lpv: [10, 5],
    conversions: [{ "action:lead": 3 }, { "conversion:lead": 1 }],
  };

  assert.deepEqual(buildMetricSeriesFromSourceSeries(series, "results", { actionType: "lead" }), [3, 1]);
  assert.deepEqual(buildMetricSeriesFromSourceSeries(series, "page_conv", { actionType: "lead" }), [0.3, 0.2]);
});

test("builds derived series for aliases, results and cost metrics", () => {
  const series = {
    spend: [100, 50, 30],
    impressions: [1000, 500, 300],
    clicks: [50, 10, 3],
    inline_link_clicks: [20, 10, 0],
    lpv: [10, 5, 0],
    conversions: [{ lead: 5 }, { lead: 1 }, { lead: 0 }],
  };

  assert.deepEqual(buildMetricSeriesFromSourceSeries(series, "link_ctr"), [0.02, 0.02, 0]);
  assert.deepEqual(buildMetricSeriesFromSourceSeries(series, "connect_rate"), [0.5, 0.5, null]);
  assert.deepEqual(buildMetricSeriesFromSourceSeries(series, "results", { actionType: "lead" }), [5, 1, 0]);
  assert.deepEqual(buildMetricSeriesFromSourceSeries(series, "page_conv", { actionType: "lead" }), [0.5, 0.2, null]);
  assert.deepEqual(buildMetricSeriesFromSourceSeries(series, "cpr", { actionType: "lead" }), [20, 50, null]);
  assert.deepEqual(buildMetricSeriesFromSourceSeries(series, "cpm"), [100, 100, 100]);
  assert.deepEqual(buildMetricSeriesFromSourceSeries(series, "cpc"), [2, 5, 10]);
});

test("computes manager averages and short labels from the registry", () => {
  const averages = computeManagerAverages(
    [
      {
        spend: 100,
        impressions: 1000,
        clicks: 50,
        inline_link_clicks: 20,
        lpv: 10,
        plays: 100,
        hook: 0.3,
        conversions: { lead: 5 },
        leadscore_values: [80, 70, 60],
      },
      {
        spend: 50,
        impressions: 500,
        clicks: 10,
        inline_link_clicks: 5,
        lpv: 2,
        plays: 50,
        hook: 0.1,
        conversions: { "conversion:lead": 1 },
        leadscore_values: [90],
      },
    ],
    {
      actionType: "lead",
      hasSheetIntegration: true,
      mqlLeadscoreMin: 60,
    },
  );

  assert.equal(getManagerMetricLabel("connect_rate"), "Connect");
  assert.equal(getManagerMetricLabel("page_conv"), "Page");
  assert.equal(averages.sumImpressions, 1500);
  assert.equal(averages.sumResults, 6);
  assert.equal(averages.cpr, 25);
  assert.equal(averages.page_conv, 0.5);
  assert.equal(averages.website_ctr, 25 / 1500);
  assert.equal(formatManagerAverageValue("impressions", averages), "1.500");
  assert.equal(formatManagerAverageValue("results", averages), "6");
  assert.equal(formatManagerAverageValue("spend", averages, { currencyFormatter: (value) => `R$ ${value.toFixed(2)}` }), "R$ 150.00");
});

test("builds grouped base series with derived metrics for manager fallback", () => {
  const { axis, byKey } = buildGroupedMetricBaseSeries(
    [
      {
        account_id: "acc-1",
        ad_id: "ad-1",
        ad_name: "Criativo A",
        adset_id: "set-1",
        adset_name: "Conjunto 1",
        campaign_id: "camp-1",
        campaign_name: "Campanha 1",
        clicks: 20,
        impressions: 1000,
        inline_link_clicks: 10,
        reach: 900,
        video_total_plays: 100,
        video_total_thruplays: 30,
        video_watched_p50: 40,
        spend: 50,
        cpm: 50,
        ctr: 0.02,
        frequency: 1.1,
        website_ctr: 0.01,
        actions: [{ action_type: "landing_page_view", value: 4 }],
        conversions: [{ action_type: "lead", value: 2 }],
        cost_per_conversion: [],
        video_play_curve_actions: [1, 0.7, 0.6, 0.5],
        creative: {},
        date: "2026-03-27",
      },
      {
        account_id: "acc-1",
        ad_id: "ad-1",
        ad_name: "Criativo A",
        adset_id: "set-1",
        adset_name: "Conjunto 1",
        campaign_id: "camp-1",
        campaign_name: "Campanha 1",
        clicks: 10,
        impressions: 500,
        inline_link_clicks: 5,
        reach: 450,
        video_total_plays: 50,
        video_total_thruplays: 10,
        video_watched_p50: 20,
        spend: 25,
        cpm: 50,
        ctr: 0.02,
        frequency: 1.1,
        website_ctr: 0.01,
        actions: [{ action_type: "landing_page_view", value: 1 }],
        conversions: [{ action_type: "conversion:lead", value: 1 }],
        cost_per_conversion: [],
        video_play_curve_actions: [1, 0.5, 0.4, 0.3],
        creative: {},
        date: "2026-03-28",
      },
    ] as any,
    {
      groupBy: "ad_id",
      actionType: "lead",
      endDate: "2026-03-28",
      windowDays: 2,
    },
  );

  assert.deepEqual(axis, ["2026-03-27", "2026-03-28"]);
  const grouped = byKey.get("acc-1:ad-1");
  assert.ok(grouped);
  assert.deepEqual(grouped?.series.spend, [50, 25]);
  assert.deepEqual(grouped?.series.results, [2, 1]);
  assert.deepEqual(grouped?.series.page_conv, [0.5, 1]);
  assert.deepEqual(grouped?.series.cpr, [25, 25]);
  assert.deepEqual(grouped?.series.cpm, [50, 50]);
  assert.deepEqual(grouped?.series.website_ctr, [0.01, 0.01]);
});

test("derives manager presentation metadata from metric semantics", () => {
  const averages = {
    count: 1,
    spend: 100,
    impressions: 1000,
    clicks: 50,
    inline_link_clicks: 20,
    lpv: 10,
    plays: 100,
    results: 5,
    hook: 0.3,
    hold_rate: null,
    video_watched_p50: null,
    scroll_stop: null,
    ctr: 0.05,
    website_ctr: 0.02,
    connect_rate: 0.5,
    cpm: 100,
    cpr: 20,
    cpc: 2,
    cplc: 5,
    page_conv: 0.5,
    cpmql: 40,
    mqls: 2,
    sumSpend: 100,
    sumImpressions: 1000,
    sumResults: 5,
    sumMqls: 2,
  };

  assert.deepEqual(getManagerMetricTrendPresentation("spend", averages), {
    useTrendMode: true,
    packAverage: null,
    inverseColors: false,
  });

  assert.deepEqual(getManagerMetricTrendPresentation("cpr", averages), {
    useTrendMode: false,
    packAverage: 20,
    inverseColors: true,
  });

  assert.equal(
    getManagerMetricCurrentValue({ spend: 80, mqls: 3 }, "mqls", { hasSheetIntegration: false }),
    null,
  );

  assert.equal(
    getManagerMetricCurrentValue({ spend: 80, mqls: 3 }, "mqls", { hasSheetIntegration: true }),
    3,
  );

  assert.deepEqual(
    getManagerMetricDeltaPresentation({ spend: 80 }, "spend", averages),
    {
      kind: "text",
      text: "-20.0%",
      tone: "warning",
    },
  );

  assert.deepEqual(
    getManagerMetricDeltaPresentation({ spend: 10, conversions: { lead: 1 } }, "cpr", averages, { actionType: "lead" }),
    {
      kind: "text",
      text: "-50.0%",
      tone: "primary",
    },
  );
});

test("formats manager child table values with canonical empty-state rules", () => {
  assert.equal(
    formatManagerChildMetricValue("cpr", { results: 0, cpr: 12 }, { currencyFormatter: (value) => `R$ ${value.toFixed(2)}` }),
    "—",
  );

  assert.equal(
    formatManagerChildMetricValue("cpr", { results: 2, cpr: 12 }, { currencyFormatter: (value) => `R$ ${value.toFixed(2)}` }),
    "R$ 12.00",
  );

  assert.equal(
    formatManagerChildMetricValue("page_conv", { lpv: 0, page_conv: 0.4 }),
    "—",
  );

  assert.equal(
    formatManagerChildMetricValue("page_conv", { lpv: 10, page_conv: 0.4 }),
    "40,00%",
  );

  assert.equal(
    formatManagerChildMetricValue("cpmql", { mqls: 0, cpmql: 50 }, { currencyFormatter: (value) => `R$ ${value.toFixed(2)}` }),
    "—",
  );

  assert.equal(
    formatManagerChildMetricValue("spend", { spend: 50 }, { currencyFormatter: (value) => `R$ ${value.toFixed(2)}` }),
    "R$ 50.00",
  );
});

test("compares manager child rows with centralized sort rules", () => {
  assert.equal(getManagerChildSortInitialDirection("status"), "asc");
  assert.equal(getManagerChildSortInitialDirection("ad_id"), "asc");
  assert.equal(getManagerChildSortInitialDirection("adset_name"), "asc");
  assert.equal(getManagerChildSortInitialDirection("spend"), "desc");

  assert.equal(
    compareManagerChildRows(
      { effective_status: "ACTIVE" },
      { effective_status: "PAUSED" },
      "status",
      "asc",
    ),
    -1,
  );

  assert.equal(
    compareManagerChildRows(
      { ad_id: "a-1" },
      { ad_id: "b-1" },
      "ad_id",
      "asc",
    ),
    -1,
  );

  assert.equal(
    compareManagerChildRows(
      { spend: 100 },
      { spend: 50 },
      "spend",
      "desc",
    ),
    -50,
  );
});
