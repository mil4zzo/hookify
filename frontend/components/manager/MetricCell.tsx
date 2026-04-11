"use client";

import React from "react";
import { SparklineBars } from "@/components/common/SparklineBars";
import { SparklineSkeleton } from "@/components/common/SparklineSkeleton";
import { RankingsItem } from "@/lib/api/schemas";
import {
  buildMetricSeriesFromSourceSeries,
  formatMetricValue,
  getManagerMetricCurrentValue,
  getManagerMetricDeltaPresentation,
  getManagerMetricTrendPresentation,
  getMetricSeriesAvailability,
  type ManagerAverages,
  type ManagerMetricKey,
} from "@/lib/metrics";
import { getMetricValueTextClass } from "@/lib/utils/metricQuality";

interface MetricCellProps {
  row: RankingsItem | { original?: RankingsItem };
  value: React.ReactNode;
  metric: ManagerMetricKey;
  getRowKey: (row: any) => string;
  byKey: Map<string, any>;
  endDate?: string;
  showTrends?: boolean;
  averages: ManagerAverages;
  formatCurrency: (n: number) => string;
  actionType?: string;
  hasSheetIntegration?: boolean;
  mqlLeadscoreMin?: number;
  minimal?: boolean; // Prop para modo minimal
  lightweight?: boolean; // Quando true, SparklineBars usa title nativo em vez de Radix Tooltip
}

// Custom comparison function for React.memo
function arePropsEqual(prev: MetricCellProps, next: MetricCellProps): boolean {
  // Value comparison removida: value é sempre um novo ReactNode criado inline,
  // então a comparação sempre retorna false, tornando o memo ineficaz.
  // O valor real já é verificado através da comparação do row.original abaixo.

  // Metric comparison
  if (prev.metric !== next.metric) return false;

  // Row comparison (check original object reference)
  const prevOriginal = "original" in prev.row ? prev.row.original : prev.row;
  const nextOriginal = "original" in next.row ? next.row.original : next.row;
  if (prevOriginal !== nextOriginal) return false;

  // Primitive props
  if (prev.endDate !== next.endDate) return false;
  if (prev.showTrends !== next.showTrends) return false;
  if (prev.actionType !== next.actionType) return false;
  if (prev.hasSheetIntegration !== next.hasSheetIntegration) return false;
  if (prev.mqlLeadscoreMin !== next.mqlLeadscoreMin) return false;
  if (prev.minimal !== next.minimal) return false;
  if (prev.lightweight !== next.lightweight) return false;

  // Function references (should be stable if parent uses useCallback)
  if (prev.getRowKey !== next.getRowKey) return false;
  if (prev.formatCurrency !== next.formatCurrency) return false;

  // Map reference comparison (byKey should be stable via useMemo)
  if (prev.byKey !== next.byKey) return false;

  // Averages comparison (compare relevant metric average only)
  const avgKey = prev.metric === "cpmql" ? "cpmql" : prev.metric;
  if (prev.averages[avgKey] !== next.averages[avgKey]) return false;

  return true;
}

export const MetricCell = React.memo(function MetricCell({ row, value, metric, getRowKey, byKey, endDate, showTrends, averages, formatCurrency, actionType, hasSheetIntegration, mqlLeadscoreMin, minimal = false, lightweight = false }: MetricCellProps) {
  // row já é o objeto agregado (info.row.original), então precisamos ajustar
  const original: RankingsItem = ("original" in row ? row.original : row) as RankingsItem;
  const seriesLoading = Boolean((original as any).series_loading);
  const BAR_COUNT = 5;
  const FADE_DURATION_MS = 500;
  const STAGGER_MS = 250;
  const SPARKLINE_START_DELAY_MS = 250;
  const loadedBarsCount =
    Array.isArray((original as any).series?.axis) && (original as any).series.axis.length > 0
      ? Math.min(BAR_COUNT, (original as any).series.axis.length)
      : BAR_COUNT;
  const TOTAL_STAGGERED_TRANSITION_MS = SPARKLINE_START_DELAY_MS + (Math.max(loadedBarsCount, 1) - 1) * STAGGER_MS + FADE_DURATION_MS;
  // "skeleton": apenas skeleton visível
  // "transition": skeleton saindo + sparkline entrando (sobrepostos)
  // "done": apenas sparkline visível (skeleton desmontado)
  const [sparklinePhase, setSparklinePhase] = React.useState<"skeleton" | "transition" | "done">(seriesLoading ? "skeleton" : "done");
  const fadeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    if (fadeTimerRef.current) {
      clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }

    if (!showTrends) {
      setSparklinePhase("done");
      return;
    }

    if (seriesLoading) {
      setSparklinePhase("skeleton");
      return;
    }

    setSparklinePhase((prev) => {
      if (prev === "skeleton") {
        // Após a transição completa, remove o skeleton do DOM sem trocar o SparklineBars
        fadeTimerRef.current = setTimeout(() => {
          setSparklinePhase("done");
          fadeTimerRef.current = null;
        }, TOTAL_STAGGERED_TRANSITION_MS);
        return "transition";
      }
      // Se já estava em "done" (dados carregados sem passar pelo skeleton), mantém
      return "done";
    });

    return () => {
      if (fadeTimerRef.current) {
        clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
    };
  }, [seriesLoading, showTrends, TOTAL_STAGGERED_TRANSITION_MS]);

  if (showTrends && sparklinePhase === "skeleton") {
    return (
      <div className={`flex flex-col items-center ${minimal ? "gap-1" : "gap-3"}`}>
        <SparklineSkeleton minimal={minimal} barCount={loadedBarsCount} staggeredFadeOut={false} />
        <span className={`${minimal ? "text-xs" : "text-base"} font-medium leading-none`}>{value}</span>
      </div>
    );
  }

  const rowKey = getRowKey(row);
  const dates = original.series?.axis || (endDate ? byKey.get(rowKey)?.axis : null);

  const seriesData = original.series ? (original.series as any) : endDate ? byKey.get(rowKey)?.series : undefined;
  const s = buildMetricSeriesFromSourceSeries(seriesData, metric, { actionType, mqlLeadscoreMin });

  // Normalizar s para sempre ser um array (padronizar undefined → array de nulls)
  // Isso garante que sempre renderizamos o sparkline, mesmo quando não há dados
  const normalizedSeries = s || (dates ? Array(dates.length).fill(null) : Array(5).fill(null));

  // Se showTrends estiver ativo, mostrar sparklines
  if (showTrends) {
    const trendPresentation = getManagerMetricTrendPresentation(metric, averages);

    // Obter série apropriada para determinar disponibilidade de dados baseada na métrica
    const seriesData = original.series ? (original.series as any) : undefined;
    const { dataAvailability, zeroValueLabel } = getMetricSeriesAvailability(seriesData, metric, {
      actionType,
      mqlLeadscoreMin,
    });

    // "transition": skeleton saindo + sparkline entrando sobrepostos.
    // "done": apenas sparkline, sem troca de nó (evita o piscar).
    // Em ambos os casos, o SparklineBars fica no DOM — só o skeleton é desmontado.
    const sparklineBars = (
      <SparklineBars
        series={normalizedSeries}
        size="small"
        className={minimal ? "w-12 h-4" : "w-16 h-6"}
        lightweight={lightweight}
        staggeredFadeIn={sparklinePhase === "transition"}
        fadeInDurationMs={FADE_DURATION_MS}
        fadeInStaggerMs={STAGGER_MS}
        fadeInStartDelayMs={sparklinePhase === "transition" ? SPARKLINE_START_DELAY_MS : 0}
        valueFormatter={(n: number) => formatMetricValue(metric, n, { currencyFormatter: formatCurrency })}
        inverseColors={trendPresentation.inverseColors}
        packAverage={trendPresentation.packAverage}
        colorMode={trendPresentation.useTrendMode ? "series" : undefined}
        dataAvailability={dataAvailability}
        zeroValueLabel={zeroValueLabel}
        dates={dates}
      />
    );

    if (sparklinePhase === "transition") {
      return (
        <div className={`flex flex-col items-center ${minimal ? "gap-1" : "gap-3"}`}>
          <div className={`relative ${minimal ? "w-12 h-4" : "w-16 h-6"}`}>
            <div className="absolute inset-0">
              <SparklineSkeleton
                minimal={minimal}
                barCount={loadedBarsCount}
                staggeredFadeOut
                fadeOutDurationMs={FADE_DURATION_MS}
                fadeOutStaggerMs={STAGGER_MS}
              />
            </div>
            <div className="absolute inset-0">
              {sparklineBars}
            </div>
          </div>
          <span className={`${minimal ? "text-xs" : "text-base"} font-medium leading-none`}>{value}</span>
        </div>
      );
    }

    // "done": skeleton desmontado, SparklineBars sem animação de entrada (já estava visível)
    return (
      <div className={`flex flex-col items-center ${minimal ? "gap-1" : "gap-3"}`}>
        {sparklineBars}
        <span className={`${minimal ? "text-xs" : "text-base"} font-medium leading-none`}>{value}</span>
      </div>
    );
  }

  const currentValue = getManagerMetricCurrentValue(original as any, metric, {
    actionType,
    mqlLeadscoreMin,
    hasSheetIntegration,
  });
  const deltaPresentation = getManagerMetricDeltaPresentation(original as any, metric, averages, {
    actionType,
    mqlLeadscoreMin,
    hasSheetIntegration,
  });

  if (currentValue === null || isNaN(currentValue) || !isFinite(currentValue) || deltaPresentation.kind === "hidden") {
    // Se não conseguimos extrair o valor, mostrar apenas o valor original
    return (
      <div className="flex flex-col items-center gap-3">
        <span className="text-base font-medium leading-none">{value}</span>
      </div>
    );
  }

  const colorClass = getMetricValueTextClass(deltaPresentation.tone ?? "muted-foreground");

  return (
    <div className={`flex flex-col items-center ${minimal ? "gap-1" : "gap-3"}`}>
      <span className={`text-xs font-medium ${colorClass}`}>
        {deltaPresentation.text}
      </span>
      <span className={`${minimal ? "text-xs" : "text-base"} font-medium leading-none`}>{value}</span>
    </div>
  );
}, arePropsEqual);
