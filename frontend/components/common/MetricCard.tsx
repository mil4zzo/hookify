"use client";

import React from "react";
import { SparklineBars, SparklineSize } from "./SparklineBars";

export type MetricType = "hook" | "cpr" | "spend" | "ctr" | "connect_rate" | "page_conv" | "cpm";

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
    if (metric === "spend" || metric === "cpr" || metric === "cpm") {
      return formatCurrency?.(n || 0) || `${(n || 0).toFixed(2)}`;
    }
    // percent-based metrics
    return formatPct?.(n) || `${((n || 0) * 100).toFixed(2)}%`;
  };

  const hasSeries = series && series.length > 0 && series.some((v) => v != null && !Number.isNaN(v));

  // Determinar altura baseada no size para manter a altura quando usar w-full
  const sparklineHeightClass = size === "large" ? "h-16" : "h-6";

  if (layout === "horizontal") {
    return (
      <div className={`p-3 rounded border border-border ${className}`}>
        <div className="text-xs text-muted-foreground mb-1">{label}</div>
        {/* Mobile: layout vertical (Label -> Valor -> Sparklines) */}
        <div className="flex flex-col md:hidden gap-2">
          <div className="text-base font-semibold">{value}</div>
          {hasSeries ? (
            <div className="w-full min-w-[96px]">
              <SparklineBars series={series} size={size} className={`w-full ${sparklineHeightClass}`} valueFormatter={valueFormatter} />
            </div>
          ) : null}
        </div>
        {/* Desktop: layout horizontal (Valor à esquerda, Sparkline à direita) */}
        <div className="hidden md:flex items-center gap-3">
          <div className="text-base font-semibold flex-shrink-0">{value}</div>
          {hasSeries ? (
            <div className="flex-1 min-w-[96px]">
              <SparklineBars series={series} size={size} className={`w-full ${sparklineHeightClass}`} valueFormatter={valueFormatter} />
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  // Layout vertical (padrão)
  return (
    <div className={`p-3 rounded border border-border ${className}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      {hasSeries ? (
        <div className="w-full min-w-[96px]">
          <SparklineBars series={series} size={size} className={`w-full ${sparklineHeightClass}`} valueFormatter={valueFormatter} />
        </div>
      ) : null}
      <div className={`text-base font-semibold ${hasSeries ? "mt-1" : "mt-7"}`}>{value}</div>
    </div>
  );
}
