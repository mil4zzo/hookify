"use client";

import { useMemo, useState } from "react";
import { StandardCard } from "@/components/common/StandardCard";
import { AppDialog } from "@/components/common/AppDialog";
import { AdDetailsDialog } from "@/components/ads/AdDetailsDialog";
import { HeadlineMetricCard } from "@/components/plano/HeadlineMetricCard";
import { DriverMetricCard } from "@/components/plano/DriverMetricCard";
import { TopImpactAdList } from "@/components/plano/TopImpactAdList";
import { ImpactBreakdownTables } from "@/components/plano/ImpactBreakdownTables";
import { usePackDayComparison } from "@/lib/hooks/usePackDayComparison";
import type { UsePackDiagnosticResult } from "@/lib/hooks/usePackDiagnostic";
import type { DiagnosticTarget, DriverKey } from "@/lib/metrics/diagnostics";
import type { RankingsItem, RankingsResponse } from "@/lib/api/schemas";

interface DayComparisonBlockProps {
  diagnostic: UsePackDiagnosticResult;
  actionType: string;
  onSelectMetric: (m: DiagnosticTarget) => void;
  validatedAverages: RankingsResponse["averages"];
  actionTypeOptions: string[];
  selectedPackIds: Set<string>;
  dateRange: { start: string; end: string };
  // User's configured target CPR — colors the headline chart tooltip when showing CPR.
  targetCpr?: number | null;
}

export function DayComparisonBlock({
  diagnostic,
  actionType,
  onSelectMetric,
  validatedAverages,
  actionTypeOptions,
  selectedPackIds,
  dateRange,
  targetCpr,
}: DayComparisonBlockProps) {
  // Q3 filter: null = cross-driver "Resultado" total; a DriverKey drills into that
  // single metric. Card click and the pills row in ImpactBreakdownTables both write here.
  const [selectedDriver, setSelectedDriver] = useState<DriverKey | null>(null);
  const comp = usePackDayComparison(diagnostic, actionType, selectedDriver);
  const [dialogAd, setDialogAd] = useState<RankingsItem | null>(null);

  // Averages shaped for AdDetailsDialog (mirrors PackDiagnosticPanel).
  const dialogAverages = useMemo(() => {
    if (!validatedAverages) return undefined;
    return {
      hook: validatedAverages.hook ?? null,
      hold_rate: validatedAverages.hold_rate ?? null,
      video_watched_p50: validatedAverages.video_watched_p50 ?? null,
      scroll_stop: validatedAverages.scroll_stop ?? null,
      ctr: validatedAverages.ctr ?? null,
      website_ctr: validatedAverages.website_ctr ?? null,
      connect_rate: validatedAverages.connect_rate ?? null,
      cpm: validatedAverages.cpm ?? null,
      cpr: actionType ? (validatedAverages.per_action_type?.[actionType]?.cpr ?? null) : null,
      page_conv: actionType ? (validatedAverages.per_action_type?.[actionType]?.page_conv ?? null) : null,
    };
  }, [validatedAverages, actionType]);

  // Only attempt to render once a series fetch is meaningful for this pack.
  if (!diagnostic.seriesEnabled) return null;

  if (diagnostic.seriesLoading && !comp.ready) {
    return <StandardCard padding="md" className="h-44 animate-pulse" />;
  }

  if (!comp.ready || !comp.bigMetric) {
    return (
      <StandardCard padding="md" className="py-6 text-center text-sm text-muted-foreground">
        Sem dia anterior para comparar neste período.
      </StandardCard>
    );
  }

  // Driver cards on a single horizontal row (4 for CPR, 5 for CPMQL).
  const cardCols = comp.driverCards.length >= 5 ? "grid-cols-2 sm:grid-cols-5" : "grid-cols-2 sm:grid-cols-4";

  return (
    <>
      {/* Column widths: left (widgets 1+2) = 2fr, right (top-impact list) = 1fr */}
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-[2fr_1fr]">
        {/* Left column: headline metric + driver cards */}
        <div className="flex flex-col gap-4">
          <HeadlineMetricCard
            bigMetric={comp.bigMetric}
            canUseCpmql={diagnostic.canUseCpmql}
            fairness={comp.fairness}
            targetCpr={targetCpr}
            onSelectMetric={onSelectMetric}
          />
          <div className={`grid ${cardCols} gap-3`}>
            {comp.driverCards.map((card) => (
              <DriverMetricCard
                key={card.key}
                card={card}
                selected={selectedDriver === card.key}
                dimmed={selectedDriver != null && selectedDriver !== card.key}
                onClick={() => setSelectedDriver((cur) => (cur === card.key ? null : card.key))}
              />
            ))}
          </div>
        </div>

        {/* Right column: top-impact ad ranking — fills the left column's height, scrolls inside.
            At lg the card is absolutely positioned so the long list never grows the grid row
            (row height is driven by the left column); below lg it flows normally. */}
        <div className="min-h-0 lg:relative">
          <StandardCard
            padding="none"
            className="flex flex-col overflow-hidden lg:absolute lg:inset-0"
          >
            <TopImpactAdList ads={comp.topAds} onOpenAd={setDialogAd} />
          </StandardCard>
        </div>
      </div>

      {/* Q3, full width: "quais anúncios pioraram/melhoraram [métrica]" — filtro por pill
          (ou pelo clique num driver card acima) troca entre Resultado total e um driver. */}
      <ImpactBreakdownTables
        view={comp.impactView}
        driverCards={comp.driverCards}
        selectedDriver={selectedDriver}
        onSelectDriver={setSelectedDriver}
        onOpenAd={setDialogAd}
      />

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
