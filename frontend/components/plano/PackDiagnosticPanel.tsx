"use client";

import { useState, useMemo } from "react";
import {
  buildDiagnosticSummary,
  attributeDriverToAds,
  type PackDecomposition,
  type AdTwoDaySnapshot,
  type BudgetShareData,
  type DiagnosticTarget,
  type DriverKey,
  type DriverAttribution,
} from "@/lib/metrics/diagnostics";
import { StandardCard } from "@/components/common/StandardCard";
import { AppDialog } from "@/components/common/AppDialog";
import { AdDetailsDialog } from "@/components/ads/AdDetailsDialog";
import { DiagnosticTrendChart, type TrendLine } from "@/components/charts/DiagnosticTrendChart";
import { DriverWaterfall } from "@/components/charts/DriverWaterfall";
import { DriverAdList } from "@/components/charts/DriverAdList";
import { getMetricValueTextClass } from "@/lib/utils/metricQuality";
import { useFormatCurrency } from "@/lib/utils/currency";
import type { RankingsItem, RankingsResponse } from "@/lib/api/schemas";

interface PackDiagnosticPanelProps {
  // Pre-computed data from usePackDiagnostic (no fetch inside this component)
  snaps: AdTwoDaySnapshot[];
  decomposition: PackDecomposition | null;
  trendLines: TrendLine[];
  budgetShareData: BudgetShareData | null;
  target: DiagnosticTarget;
  adKeyToName: Map<string, string>;
  adMap: Map<string, RankingsItem>;
  comparisonLabel: string | null;
  // Context for AdDetailsDialog (not from series)
  benchmarkAverages: RankingsResponse["averages"];
  actionType: string;
  actionTypeOptions: string[];
  selectedPackIds: Set<string>;
  dateRange: { start: string; end: string };
}

export function PackDiagnosticPanel({
  snaps,
  decomposition,
  trendLines,
  budgetShareData,
  target,
  adKeyToName,
  adMap,
  comparisonLabel,
  benchmarkAverages,
  actionType,
  actionTypeOptions,
  selectedPackIds,
  dateRange,
}: PackDiagnosticPanelProps) {
  const formatCurrency = useFormatCurrency();
  const [selectedDriver, setSelectedDriver] = useState<DriverKey | null>(null);
  const [dialogAd, setDialogAd] = useState<RankingsItem | null>(null);

  // Level 3: attribution for the selected driver
  const driverAttribution = useMemo((): DriverAttribution | null => {
    if (!selectedDriver || !decomposition) return null;
    const contrib = decomposition.drivers.find((d) => d.driver === selectedDriver);
    if (!contrib || contrib.status !== "ok") return null;
    return attributeDriverToAds(snaps, selectedDriver, contrib.contributionCurrency ?? null);
  }, [selectedDriver, decomposition, snaps]);

  // Enrich summary with top driver attribution when a driver is selected
  const summary = useMemo(() => {
    if (!decomposition) return null;
    return buildDiagnosticSummary(decomposition, driverAttribution, formatCurrency);
  }, [decomposition, driverAttribution, formatCurrency]);

  // Averages shaped for AdDetailsDialog
  const dialogAverages = useMemo(() => {
    if (!benchmarkAverages) return undefined;
    return {
      hook: benchmarkAverages.hook ?? null,
      hold_rate: benchmarkAverages.hold_rate ?? null,
      video_watched_p50: benchmarkAverages.video_watched_p50 ?? null,
      scroll_stop: benchmarkAverages.scroll_stop ?? null,
      ctr: benchmarkAverages.ctr ?? null,
      website_ctr: benchmarkAverages.website_ctr ?? null,
      connect_rate: benchmarkAverages.connect_rate ?? null,
      cpm: benchmarkAverages.cpm ?? null,
      cpr: actionType ? (benchmarkAverages.per_action_type?.[actionType]?.cpr ?? null) : null,
      page_conv: actionType ? (benchmarkAverages.per_action_type?.[actionType]?.page_conv ?? null) : null,
    };
  }, [benchmarkAverages, actionType]);

  if (snaps.length === 0) return null;

  const hasWaterfall = decomposition != null && decomposition.deltaCurrency != null;
  const driverDirection: "up" | "down" =
    hasWaterfall && decomposition!.deltaCurrency! > 0 ? "up" : "down";

  function handleDriverClick(driver: DriverKey) {
    setSelectedDriver((prev) => (prev === driver ? null : driver));
  }

  return (
    <>
      <StandardCard variant="default" padding="md" className="space-y-5 overflow-visible">

        {/* Header */}
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            O que mudou no período
          </span>
          {comparisonLabel && (
            <span className="text-2xs text-muted-foreground">{comparisonLabel}</span>
          )}
          {decomposition && !decomposition.minVolumeOk && (
            <span className="text-2xs text-warning bg-warning-10 border border-warning-20 px-1.5 py-0.5 rounded font-medium">
              Volume baixo
            </span>
          )}
        </div>

        {/* Summary sentence (enriched with driverAttribution when available) */}
        {summary && (
          <p
            className={`text-sm font-medium leading-snug -mt-3 ${
              summary.muted ? "text-muted-foreground" : getMetricValueTextClass(summary.tone)
            }`}
          >
            {summary.headline}
          </p>
        )}

        {/* Level 1: Normalized trend chart with budget share bars */}
        {trendLines.length > 0 && (
          <DiagnosticTrendChart
            lines={trendLines}
            target={target}
            budgetData={budgetShareData}
            adKeyToName={adKeyToName}
          />
        )}

        {/* Level 2: Driver waterfall */}
        {hasWaterfall && (
          <DriverWaterfall
            decomposition={decomposition!}
            selectedDriver={selectedDriver}
            onSelectDriver={handleDriverClick}
          />
        )}

        {/* Level 3: Ad attribution (shown when a driver is clicked) */}
        {selectedDriver && driverAttribution && (
          <div className="border-t border-border pt-4">
            <DriverAdList
              attribution={driverAttribution}
              driver={selectedDriver}
              driverDirection={driverDirection}
              adMap={adMap}
              onOpenAd={setDialogAd}
            />
          </div>
        )}

      </StandardCard>

      {/* Ad details dialog */}
      {dialogAd && (
        <AppDialog
          isOpen
          onClose={() => setDialogAd(null)}
          title="Detalhes do anúncio"
          size="5xl"
          padding="md"
          className="flex h-[90dvh] min-h-0 flex-col overflow-hidden"
          bodyClassName="flex min-h-0 flex-1 flex-col"
        >
          <AdDetailsDialog
            ad={dialogAd}
            groupByAdName
            dateStart={dateRange.start}
            dateStop={dateRange.end}
            actionType={actionType}
            packIds={Array.from(selectedPackIds)}
            availableConversionTypes={actionTypeOptions}
            averages={dialogAverages}
          />
        </AppDialog>
      )}
    </>
  );
}
