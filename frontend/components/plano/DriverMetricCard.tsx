"use client";

import { IconCheck, IconAlertTriangle, IconMinus } from "@tabler/icons-react";
import { StandardCard } from "@/components/common/StandardCard";
import { MetricDeltaBadge } from "@/components/common/MetricDeltaBadge";
import { MetricLineSparkline } from "@/components/charts/MetricLineSparkline";
import type { MetricQualityTone } from "@/lib/utils/metricQuality";
import { useFormatCurrency, formatLocaleRatioPercent } from "@/lib/utils/currency";
import type { DayComparisonDriverCard } from "@/lib/hooks/usePackDayComparison";

// Colored border + a vertical gradient that tints the bottom of the card with the tone
// color, fading up to the default card gray (`to-transparent` over StandardCard's bg-card).
// Neutral/muted tones keep the plain card.
function driverCardSurface(tone: MetricQualityTone): string {
  switch (tone) {
    case "success":     return "border-success-30 bg-gradient-to-t from-success-20 to-transparent";
    case "destructive": return "border-destructive-30 bg-gradient-to-t from-destructive-20 to-transparent";
    case "warning":     return "border-warning-30 bg-gradient-to-t from-warning-20 to-transparent";
    case "attention":   return "border-attention-30 bg-gradient-to-t from-attention-20 to-transparent";
    default:            return "";
  }
}

// Icon box (top-left) by impact tone. The icon conveys sentiment (good/bad); the delta
// pill (MetricDeltaBadge) carries the matching color + the metric's direction caret.
function toneStyle(tone: MetricQualityTone): {
  box: string;
  Icon: React.ComponentType<{ className?: string }>;
} {
  switch (tone) {
    case "success":     return { box: "border-success-30 bg-success-20 text-success",             Icon: IconCheck };
    case "destructive": return { box: "border-destructive-30 bg-destructive-20 text-destructive", Icon: IconAlertTriangle };
    case "warning":     return { box: "border-warning-30 bg-warning-20 text-warning",             Icon: IconAlertTriangle };
    case "attention":   return { box: "border-attention-30 bg-attention-20 text-attention",       Icon: IconAlertTriangle };
    default:            return { box: "border-border bg-muted-30 text-muted-foreground",          Icon: IconMinus };
  }
}

export function DriverMetricCard({
  card,
  selected = false,
  dimmed = false,
  onClick,
}: {
  card: DayComparisonDriverCard;
  // Optional — the card doubles as a Q3-filter shortcut ("a mais" to the pills row in
  // ImpactBreakdownTables, not the primary mechanism). Omit both to keep it inert.
  selected?: boolean;
  // True when ANOTHER card holds the filter: this one recedes (opacity/saturation) so
  // the active card + pill + table title read as one connected selection.
  dimmed?: boolean;
  onClick?: () => void;
}) {
  const formatCurrency = useFormatCurrency();
  const fmt = (v: number) => (card.isCurrency ? formatCurrency(v) : formatLocaleRatioPercent(v));

  const { box, Icon } = toneStyle(card.tone);

  return (
    <StandardCard
      padding="md"
      interactive={false}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={`flex flex-col gap-2.5 bg-transparent transition-all duration-300 ${driverCardSurface(card.tone)} ${
        selected ? "-translate-y-0.5 ring-2 ring-primary shadow-elevation-overlay" : ""
      } ${dimmed ? "opacity-60 saturate-50" : ""}`}
    >
      {/* Top: status icon */}
      <span className={`flex h-8 w-8 items-center justify-center rounded-lg border ${box}`}>
        <Icon className="h-4 w-4" />
      </span>

      {/* Title */}
      <span className="text-sm font-medium text-muted-foreground">{card.label}</span>

      {/* Value + delta badge */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-2xl font-bold leading-none text-foreground">
          {card.current != null ? fmt(card.current) : "—"}
        </span>
        <MetricDeltaBadge value={card.deltaPct} tone={card.tone} format={card.isCurrency ? "percent" : "points"} />
      </div>

      {/* Comparison baseline */}
      <span className="text-2xs text-muted-foreground">
        vs ontem: {card.prev != null ? fmt(card.prev) : "—"}
      </span>

      {/* Trend sparkline */}
      <MetricLineSparkline series={card.series7d} tone={card.tone} height={32} className="mt-0.5" />
    </StandardCard>
  );
}
