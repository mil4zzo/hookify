"use client";

import React from "react";
import { StandardCard } from "@/components/common/StandardCard";
import { SparklineBars, SparklineSize } from "./SparklineBars";
import { formatMetricValue, getManagerMetricLabel, isLowerBetterMetric, type ManagerMetricKey } from "@/lib/metrics";

export type MetricType = Extract<ManagerMetricKey, "hook" | "cpr" | "spend" | "ctr" | "connect_rate" | "page_conv" | "cpm">;

type MetricCardLayout = "vertical" | "horizontal";

interface MetricCardProps {
  label: string;
  value: React.ReactNode;
  series?: Array<number | null | undefined>;
  metric: MetricType;
  size?: SparklineSize;
  layout?: MetricCardLayout; // Layout: vertical (padrão) ou horizontal (valor à esquerda, sparkline à direita)
  formatCurrency?: (n: number) => string;
  formatPct?: (v: number) => string;
  className?: string;
}

export function MetricCard({ label, value, series, metric, size = "medium", layout = "vertical", formatCurrency, formatPct, className = "" }: MetricCardProps) {
  const valueFormatter = (n: number) => {
    return formatMetricValue(metric, n, {
      currencyFormatter: formatCurrency,
    });
  };

  const hasSeries = series && series.length > 0 && series.some((v) => v != null && !Number.isNaN(v));

  // Determinar se a métrica é "inversa" (menor é melhor: CPR e CPM)
  const isInverseMetric = isLowerBetterMetric(metric);
  const metricLabel = label || getManagerMetricLabel(metric);

  // Determinar altura baseada no size para manter a altura quando usar w-full
  const sparklineHeightClass = size === "large" ? "h-16" : "h-6";

  if (layout === "horizontal") {
    return (
      <StandardCard density="compact" className={className}>
        <div className="text-xs text-muted-foreground mb-1">{metricLabel}</div>
        {/* Layout vertical (Label -> Valor -> Sparklines) - sempre vertical, mesmo em desktop */}
        <div className="flex flex-col gap-2">
          <div className="text-base font-semibold">{value}</div>
          {hasSeries ? (
            <div className="w-full min-w-[96px]">
              <SparklineBars series={series} size={size} className={`w-full ${sparklineHeightClass}`} valueFormatter={valueFormatter} inverseColors={isInverseMetric} />
            </div>
          ) : null}
        </div>
      </StandardCard>
    );
  }

  // Layout vertical (padrão)
  return (
    <StandardCard density="compact" className={className}>
      <div className="text-xs text-muted-foreground">{metricLabel}</div>
      {hasSeries ? (
        <div className="w-full min-w-[96px]">
          <SparklineBars series={series} size={size} className={`w-full ${sparklineHeightClass}`} valueFormatter={valueFormatter} inverseColors={isInverseMetric} />
        </div>
      ) : null}
      <div className={`text-base font-semibold ${hasSeries ? "mt-1" : "mt-7"}`}>{value}</div>
    </StandardCard>
  );
}
