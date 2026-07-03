"use client";

import { IconChevronDown, IconCheck, IconAlertTriangle } from "@tabler/icons-react";
import { StandardCard } from "@/components/common/StandardCard";
import { MetricDeltaBadge } from "@/components/common/MetricDeltaBadge";
import { DayComparisonLineChart } from "@/components/charts/DayComparisonLineChart";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { getMetricValueTextClass, getMetricQualityToneByAverage, getMetricTrendTone } from "@/lib/utils/metricQuality";
import { useFormatCurrency } from "@/lib/utils/currency";
import type { DayComparisonBigMetric, DayComparisonFairness } from "@/lib/hooks/usePackDayComparison";
import type { DiagnosticTarget } from "@/lib/metrics/diagnostics";

function signedPct(v: number): string {
  return `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`;
}

export function HeadlineMetricCard({
  bigMetric,
  canUseCpmql,
  fairness,
  targetCpr,
  onSelectMetric,
}: {
  bigMetric: DayComparisonBigMetric;
  canUseCpmql: boolean;
  fairness: DayComparisonFairness;
  // User's configured target CPR — no target CPMQL exists in this app, so it only
  // colors the chart tooltip when the headline is currently showing CPR.
  targetCpr?: number | null;
  onSelectMetric: (m: DiagnosticTarget) => void;
}) {
  const formatCurrency = useFormatCurrency();
  const costTarget = bigMetric.target === "cpr" && targetCpr != null && targetCpr > 0 ? targetCpr : null;

  // With a target set, the big value's color answers "estou bem ou mal vs o alvo?"
  // (level — same vs-target scale the chart tooltip uses); the badge beside it keeps
  // answering "pra onde me movi vs ontem?" (flow). Without a target, fall back to the
  // day-trend tone as before.
  const valueTone =
    costTarget != null && bigMetric.current != null
      ? getMetricQualityToneByAverage(bigMetric.current, costTarget, true)
      : bigMetric.tone;

  // Signed distance to target: +25% = running 25% above (bad for a cost metric).
  const targetDeltaPct =
    costTarget != null && bigMetric.current != null ? (bigMetric.current - costTarget) / costTarget : null;

  return (
    <TooltipProvider delayDuration={150}>
      <StandardCard
        padding="none"
        className="grid grid-cols-1 gap-5 border-0 bg-transparent sm:grid-cols-4 sm:items-stretch sm:gap-4"
      >
        {/* Left (1 col): metric selector (high hierarchy) glued to the value + delta badge */}
        <div className="flex flex-col justify-center gap-2 sm:col-span-1">
          {/* The metric name dictates what every other metric is about → highest hierarchy.
              The fairness flag sits right next to it — it's about the selector's target
              metric as a whole, not about one specific number below. */}
          <div className="flex w-fit items-center gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-1 text-2xl font-bold text-foreground transition-colors hover:text-primary focus:outline-none">
                {bigMetric.label}
                <IconChevronDown className="h-5 w-5 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => onSelectMetric("cpr")}>
                  <span className="flex w-full items-center justify-between gap-4">
                    CPR {bigMetric.target === "cpr" && <IconCheck className="h-3.5 w-3.5" />}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!canUseCpmql}
                  onClick={() => canUseCpmql && onSelectMetric("cpmql")}
                >
                  <span className="flex w-full items-center justify-between gap-4">
                    CPMQL {bigMetric.target === "cpmql" && <IconCheck className="h-3.5 w-3.5" />}
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {fairness.changed && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex cursor-default text-warning">
                    <IconAlertTriangle className="h-4 w-4" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[260px] text-xs">
                  A entrega mudou bastante hoje
                  {fairness.spendDeltaPct != null && <> · gasto {signedPct(fairness.spendDeltaPct)}</>}
                  {fairness.resultsDeltaPct != null && <> · resultados {signedPct(fairness.resultsDeltaPct)}</>}
                  {" "}— a comparação com ontem pode não ser justa.
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          {/* Value + delta badge side-by-side (same pattern as the metric cards below).
              Value color = level vs target (when set); badge = movement vs ontem. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-3xl font-bold leading-none transition-colors duration-300 ${getMetricValueTextClass(valueTone)}`}>
              {bigMetric.current != null ? formatCurrency(bigMetric.current) : "—"}
            </span>
            <MetricDeltaBadge value={bigMetric.deltaPct} tone={bigMetric.tone} size="md" />
          </div>

          {/* Reference rows, same grammar: label + value (+ badge). "ontem" answers the
              flow (its delta already lives in the badge above); "alvo" answers the level
              (its own badge = signed distance to target, ±5% neutral band). */}
          <div className="flex flex-col gap-1">
            <span className="text-lg text-muted-foreground">
              ontem {bigMetric.prev != null ? formatCurrency(bigMetric.prev) : "—"}
            </span>
            {costTarget != null && (
              <span className="flex items-center gap-2 text-lg text-muted-foreground">
                alvo {formatCurrency(costTarget)}
                {targetDeltaPct != null && (
                  <MetricDeltaBadge
                    value={targetDeltaPct}
                    tone={getMetricTrendTone(targetDeltaPct, true)}
                    size="sm"
                  />
                )}
              </span>
            )}
          </div>
        </div>

        {/* Right (3 cols): 7-day line — spans over cards 2–4 below to align horizontally.
            Spend rides along as a muted bottom "shadow" so cost swings read against
            delivery size (a CPR spike on a R$50 day ≠ on a R$5k day). */}
        <div className="min-w-0 sm:col-span-3">
          <DayComparisonLineChart
            series={bigMetric.series7d}
            tone={bigMetric.tone}
            isCurrency
            valueLabel={bigMetric.label}
            shadowSeries={bigMetric.spendSeries7d}
            shadowLabel="Spend"
            costTarget={costTarget}
          />
        </div>
      </StandardCard>
    </TooltipProvider>
  );
}
