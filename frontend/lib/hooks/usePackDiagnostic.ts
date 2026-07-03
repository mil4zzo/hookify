"use client";

import { useMemo } from "react";
import { useAdPerformanceSeries } from "@/lib/api/hooks";
import {
  buildAdTwoDaySnapshots,
  buildBudgetShareSeries,
  buildDiagnosticSummary,
  selectTarget,
  decomposePack,
  type DiagnosticTarget,
  type PackDecomposition,
  type AdTwoDaySnapshot,
  type BudgetShareData,
  type DiagnosticSummaryResult,
} from "@/lib/metrics/diagnostics";
import { getResultsForActionType } from "@/lib/metrics/calculations";
import { getMetricTrendTone } from "@/lib/utils/metricQuality";
import type { MetricQualityTone } from "@/lib/utils/metricQuality";
import { useFormatCurrency } from "@/lib/utils/currency";
import type { RankingsItem } from "@/lib/api/schemas";
import type { TrendLine, TrendSeriesPoint } from "@/components/charts/DiagnosticTrendChart";

const SERIES_WINDOW = 14;
const TOP_N_BUDGET = 3;

function toneToLineColor(tone: MetricQualityTone): string {
  switch (tone) {
    case "destructive": return "var(--destructive)";
    case "warning":     return "var(--warning)";
    case "attention":   return "var(--attention)";
    case "success":     return "var(--success)";
    default:            return "var(--foreground)";
  }
}

export interface UsePackDiagnosticResult {
  summary: DiagnosticSummaryResult | null;
  minVolumeOk: boolean;
  decomposition: PackDecomposition | null;
  snaps: AdTwoDaySnapshot[];
  trendLines: TrendLine[];
  budgetShareData: BudgetShareData | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  seriesData: any;
  seriesLoading: boolean;
  seriesError: boolean;
  groupKeys: string[];
  adKeyToName: Map<string, string>;
  adMap: Map<string, RankingsItem>;
  comparisonLabel: string | null;
  target: DiagnosticTarget;
  canUseCpmql: boolean;
  seriesEnabled: boolean;
}

export function usePackDiagnostic({
  validatedAds,
  actionType,
  selectedPackIds,
  dateRange,
  targetOverride,
}: {
  validatedAds: RankingsItem[];
  actionType: string;
  selectedPackIds: Set<string>;
  dateRange: { start: string; end: string };
  // User-chosen cost metric (persisted preference). When set, overrides the auto
  // selectTarget — but falls back to "cpr" if "cpmql" is chosen without MQL data.
  targetOverride?: DiagnosticTarget | null;
}): UsePackDiagnosticResult {
  const formatCurrency = useFormatCurrency();

  const { groupKeys, adKeyToName, adMap } = useMemo(() => {
    const gk: string[] = [];
    const nameMap = new Map<string, string>();
    const itemMap = new Map<string, RankingsItem>();
    for (const ad of validatedAds) {
      const key = ad.group_key || ad.ad_id || "";
      if (!key) continue;
      gk.push(key);
      if (ad.ad_name) nameMap.set(key, ad.ad_name);
      itemMap.set(key, ad);
    }
    return { groupKeys: gk, adKeyToName: nameMap, adMap: itemMap };
  }, [validatedAds]);

  const seriesEnabled =
    selectedPackIds.size > 0 &&
    groupKeys.length > 0 &&
    !!actionType &&
    !!dateRange.start &&
    !!dateRange.end;

  const {
    data: seriesData,
    isLoading: seriesLoading,
    isError: seriesError,
  } = useAdPerformanceSeries(
    {
      date_start: dateRange.start,
      date_stop: dateRange.end,
      group_by: "ad_name",
      window: SERIES_WINDOW,
      pack_ids: Array.from(selectedPackIds),
      action_type: actionType,
      group_keys: groupKeys,
    },
    seriesEnabled,
  );

  const snaps = useMemo(() => {
    if (!seriesData?.series_by_group) return [];
    return buildAdTwoDaySnapshots(seriesData.series_by_group, actionType, adKeyToName);
  }, [seriesData, actionType, adKeyToName]);

  // CPMQL is selectable only when MQL data exists on BOTH days at pack level
  // (mirrors selectTarget's gate). Drives whether the toggle can offer CPMQL.
  const canUseCpmql = useMemo(() => {
    if (snaps.length === 0) return false;
    const hasMqlData = snaps.some((s) => s.last.mqls != null || s.prev.mqls != null);
    return selectTarget(snaps, hasMqlData) === "cpmql";
  }, [snaps]);

  const { target, decomposition } = useMemo(() => {
    if (snaps.length === 0) return { target: "cpr" as const, decomposition: null };
    const hasMqlData = snaps.some((s) => s.last.mqls != null || s.prev.mqls != null);
    const auto = selectTarget(snaps, hasMqlData);
    // Override wins, but CPMQL needs data — otherwise fall back to CPR.
    const tgt: DiagnosticTarget = targetOverride
      ? (targetOverride === "cpmql" && !canUseCpmql ? "cpr" : targetOverride)
      : auto;
    const dec = decomposePack(snaps, { target: tgt });
    return { target: tgt, decomposition: dec };
  }, [snaps, targetOverride, canUseCpmql]);

  const budgetShareData = useMemo(() => {
    if (!seriesData?.series_by_group) return null;
    return buildBudgetShareSeries(seriesData.series_by_group, TOP_N_BUDGET);
  }, [seriesData]);

  const trendLines = useMemo((): TrendLine[] => {
    const groups = seriesData?.series_by_group;
    if (!groups) return [];
    const adKeys = Object.keys(groups);
    if (adKeys.length === 0) return [];

    const axis = groups[adKeys[0]].axis as string[];
    const numDays = axis.length;
    if (numDays < 2) return [];

    const packByDay = Array.from({ length: numDays }, (_, i) => {
      let spend = 0, impr = 0, inline = 0, lpv = 0, results = 0, mqls = 0;
      for (const k of adKeys) {
        const s = groups[k];
        spend   += s.spend[i] ?? 0;
        impr    += s.impressions[i] ?? 0;
        inline  += s.inline_link_clicks?.[i] ?? 0;
        lpv     += s.lpv[i] ?? 0;
        results += getResultsForActionType({ conversions: s.conversions?.[i] ?? {} }, actionType) ?? 0;
        const cpmqlVal = s.cpmql?.[i];
        const sp = s.spend[i] ?? 0;
        if (cpmqlVal != null && cpmqlVal > 0 && sp > 0) mqls += sp / cpmqlVal;
      }
      return { date: axis[i], spend, impr, inline, lpv, results, mqls };
    });

    const make = (fn: (d: (typeof packByDay)[0]) => number | null): TrendSeriesPoint[] =>
      packByDay.map((d) => ({ date: d.date, value: fn(d) }));

    const tgtPct = decomposition?.targetPrev
      ? (decomposition.deltaCurrency ?? 0) / decomposition.targetPrev
      : 0;
    const targetColor = toneToLineColor(getMetricTrendTone(tgtPct, true));

    const lines: TrendLine[] = [
      {
        key: target === "cpmql" ? "cpmql" : "cpr",
        label: target === "cpmql" ? "CPMQL" : "CPR",
        color: targetColor,
        data: make((d) => {
          if (target === "cpmql") return d.mqls > 0 ? d.spend / d.mqls : null;
          return d.results > 0 ? d.spend / d.results : null;
        }),
      },
      {
        key: "website_ctr",
        label: "Link CTR",
        color: "var(--chart-1)",
        data: make((d) => (d.impr > 0 ? d.inline / d.impr : null)),
      },
      {
        key: "connect_rate",
        label: "Connect Rate",
        color: "var(--chart-2)",
        data: make((d) => (d.inline > 0 ? d.lpv / d.inline : null)),
      },
      {
        key: "page_conv",
        label: "Conv. Página",
        color: "var(--chart-3)",
        data: make((d) => (d.lpv > 0 ? d.results / d.lpv : null)),
      },
    ];

    if (target === "cpmql") {
      lines.push({
        key: "mql_rate",
        label: "Taxa MQL",
        color: "var(--chart-4)",
        data: make((d) => (d.results > 0 ? d.mqls / d.results : null)),
      });
    }

    return lines;
  }, [seriesData, target, actionType, decomposition]);

  // Summary without driver attribution (hero only needs the base sentence).
  // The panel recomputes it locally with driverAttribution when a driver is selected.
  const summary = useMemo(() => {
    if (!decomposition) return null;
    return buildDiagnosticSummary(decomposition, null, formatCurrency);
  }, [decomposition, formatCurrency]);

  const comparisonLabel = useMemo(() => {
    const data = trendLines[0]?.data ?? [];
    if (data.length < 2) return null;
    const fmt = (iso: string) => {
      const [, m, d] = iso.split("-");
      return `${parseInt(d, 10)}/${parseInt(m, 10)}`;
    };
    return `${fmt(data[data.length - 2].date)} → ${fmt(data[data.length - 1].date)}`;
  }, [trendLines]);

  return {
    summary,
    minVolumeOk: decomposition?.minVolumeOk ?? true,
    decomposition,
    snaps,
    trendLines,
    budgetShareData,
    seriesData: seriesData ?? null,
    seriesLoading,
    seriesError,
    groupKeys,
    adKeyToName,
    adMap,
    comparisonLabel,
    target,
    canUseCpmql,
    seriesEnabled,
  };
}
