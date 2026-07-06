"use client";

import { IconCaretUpFilled, IconCaretDownFilled } from "@tabler/icons-react";
import { useFormatCurrency } from "@/lib/utils/currency";
import type { MetricQualityTone } from "@/lib/utils/metricQuality";

// Standardized delta pill used across the diagnostic widgets. The caret shows the
// raw number's own direction (up/down); the color (tone) reflects the impact on the
// result — the two are computed separately so a "good" increase (e.g. a rate improving)
// can carry an up-caret with a success tone instead of forcing red-for-up everywhere.
function badgeClass(tone: MetricQualityTone): string {
  switch (tone) {
    case "success":     return "bg-success-20 text-success";
    case "destructive": return "bg-destructive-20 text-destructive";
    case "warning":     return "bg-warning-20 text-warning";
    case "attention":   return "bg-attention-20 text-attention";
    default:            return "bg-muted-30 text-muted-foreground";
  }
}

// Plain = colored text + caret only, no pill background — for secondary/supporting
// columns so the solid badge stays reserved for the primary quantity of a table.
function plainClass(tone: MetricQualityTone): string {
  switch (tone) {
    case "success":     return "text-success";
    case "destructive": return "text-destructive";
    case "warning":     return "text-warning";
    case "attention":   return "text-attention";
    default:            return "text-muted-foreground";
  }
}

export function MetricDeltaBadge({
  value,
  tone,
  size = "sm",
  format = "percent",
  appearance = "solid",
  signStyle = "caret",
}: {
  // Raw signed number: a fraction (0.084 = 8.4%) for format="percent"/"points", an
  // absolute currency amount for format="currency". "points" renders the SAME fraction
  // as percentage-points (p.p.) instead of a relative %, for proportions where a
  // near-zero baseline would otherwise blow up (e.g. share 0.1%→7% reads as "+7000%"
  // relative, but "+6,9 p.p." absolute — use "points" for any quantity that is itself
  // already a proportion: share, CTR, connect rate, page conv, mql rate. Use "percent"
  // only for currency-scale rates like CPM, where relative % is the standard framing.
  value: number | null;
  tone: MetricQualityTone;
  size?: "sm" | "md";
  format?: "percent" | "currency" | "points";
  appearance?: "solid" | "plain";
  // "caret" (default): direction shown as an up/down triangle before the magnitude.
  // "sign": direction shown as a +/− prefix on the number itself, no icon — reads
  // better for a ranked list of net R$ contributions (Impacto column) where the
  // magnitude IS the sortable quantity and a caret adds no information the sign lacks.
  signStyle?: "caret" | "sign";
}) {
  const formatCurrency = useFormatCurrency();
  if (value == null) return null;

  const isPositive = value > 1e-9;
  const isNegative = value < -1e-9;
  const Caret = signStyle === "caret" && (isPositive || isNegative) ? (isPositive ? IconCaretUpFilled : IconCaretDownFilled) : null;
  const signPrefix = signStyle === "sign" ? (isPositive ? "+" : isNegative ? "−" : "") : "";
  const magnitude =
    format === "currency"
      ? formatCurrency(Math.abs(value))
      : format === "points"
        ? `${Math.abs(value * 100).toFixed(1).replace(".", ",")} p.p.`
        : `${Math.abs(value * 100).toFixed(1).replace(".", ",")}%`;
  const text = signPrefix + magnitude;
  const sizeCls =
    appearance === "plain"
      ? size === "md" ? "text-sm" : "text-xs"
      : size === "md" ? "px-2 py-0.5 text-sm" : "px-1.5 py-0.5 text-xs";
  const iconCls = size === "md" ? "h-3.5 w-3.5" : "h-3 w-3";
  const colorCls = appearance === "plain" ? plainClass(tone) : badgeClass(tone);
  const weightCls = appearance === "plain" ? "font-semibold" : "rounded-md font-bold";

  return (
    <span className={`inline-flex items-center gap-0.5 ${weightCls} ${sizeCls} ${colorCls}`}>
      {Caret && <Caret className={iconCls} />}
      {text}
    </span>
  );
}
