export type MetricQualityTone =
  | "destructive"
  | "warning"
  | "attention"
  | "success"
  | "primary"
  | "brand"
  | "muted"
  | "accent"
  | "muted-foreground";

const sparklineGradientMap: Record<MetricQualityTone, string> = {
  destructive: "bg-gradient-to-b from-destructive-50 to-destructive-20",
  warning: "bg-gradient-to-b from-warning-50 to-warning-20",
  attention: "bg-gradient-to-b from-attention-50 to-attention-20",
  success: "bg-gradient-to-b from-success-50 to-success-20",
  primary: "bg-gradient-to-b from-primary-50 to-primary-20",
  brand: "bg-gradient-to-b from-brand-50 to-brand-20",
  muted: "bg-gradient-to-b from-muted-50 to-muted-20",
  accent: "bg-gradient-to-b from-ring-50 to-ring-20",
  "muted-foreground": "bg-gradient-to-b from-muted-50 to-muted-20",
};

const sparklineBorderMap: Record<MetricQualityTone, string> = {
  destructive: "border-t-destructive",
  warning: "border-t-warning",
  attention: "border-t-attention",
  success: "border-t-success",
  primary: "border-t-primary",
  brand: "border-t-brand",
  muted: "border-t-muted",
  accent: "border-t-ring",
  "muted-foreground": "border-t-muted-foreground",
};

const sparklineTextMap: Record<MetricQualityTone, string> = {
  destructive: "text-destructive-70",
  warning: "text-warning-70",
  attention: "text-attention-70",
  success: "text-success-70",
  primary: "text-primary-70",
  brand: "text-brand-70",
  muted: "text-muted-foreground",
  accent: "text-accent-foreground",
  "muted-foreground": "text-muted-foreground",
};

const metricValueTextMap: Record<MetricQualityTone, string> = {
  destructive: "text-destructive",
  warning: "text-warning",
  attention: "text-attention",
  success: "text-success",
  primary: "text-primary",
  brand: "text-brand",
  muted: "text-muted-foreground",
  accent: "text-accent-foreground",
  "muted-foreground": "text-muted-foreground",
};

const cardSurfaceMap: Record<MetricQualityTone, string> = {
  destructive: "border-destructive-10 shadow-[0_0_18px_rgba(239,68,68,0.08)]",
  warning: "border-warning-10 -[0_0_18px_rgba(245,158,11,0.08)]",
  attention: "border-attention-10 shadow-[0_0_18px_rgba(234,179,8,0.08)]",
  success: "border-success-10 shadow-[0_0_18px_rgba(34,197,94,0.08)]",
  primary: "border-primary-10 shadow-[0_0_18px_rgba(59,130,246,0.08)]",
  brand: "border-brand-10 shadow-[0_0_18px_rgba(168,85,247,0.08)]",
  muted: "border-border bg-background shadow-none",
  accent: "border-ring/10 bg-ring/5 shadow-[0_0_18px_rgba(148,163,184,0.08)]",
  "muted-foreground": "border-border bg-background shadow-none",
};

export function getMetricTrendTone(pct: number, inverse = false): MetricQualityTone {
  if (inverse) {
    if (pct >= 0.2) return "destructive";
    if (pct >= 0.05) return "warning";
    if (pct <= -0.2) return "success";
    if (pct <= -0.05) return "success";
    return "accent";
  }

  if (pct >= 0.2) return "success";
  if (pct >= 0.05) return "success";
  if (pct <= -0.2) return "destructive";
  if (pct <= -0.05) return "warning";
  return "accent";
}

export function getMetricSeriesTrendPct(series: Array<number | null | undefined>): number {
  const vals = series.filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
  if (vals.length < 2) return 0;

  const n = vals.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (let i = 0; i < n; i++) {
    const x = i;
    const y = vals[i];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  }

  const denominator = n * sumX2 - sumX * sumX;
  if (Math.abs(denominator) < 1e-9) return 0;

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const meanY = sumY / n;
  const denom = Math.max(Math.abs(meanY), 1e-9);

  return (slope * (n - 1)) / denom;
}

export function getMetricQualityToneByNormalized(norm01: number, inverse = false): MetricQualityTone {
  const t = Math.max(0, Math.min(1, norm01));

  if (inverse) {
    const invertedT = 1 - t;
    if (invertedT <= 0.2) return "destructive";
    if (invertedT <= 0.4) return "warning";
    if (invertedT <= 0.6) return "attention";
    if (invertedT <= 0.8) return "success";
    return "primary";
  }

  if (t <= 0.2) return "destructive";
  if (t <= 0.4) return "warning";
  if (t <= 0.6) return "attention";
  if (t <= 0.8) return "success";
  return "primary";
}

export function getMetricQualityToneByAverage(value: number, average: number, inverse = false): MetricQualityTone {
  if (average <= 0 || !Number.isFinite(average)) {
    return "muted-foreground";
  }

  const ratio = value / average;

  if (inverse) {
    if (ratio >= 1.5) return "destructive";
    if (ratio >= 1.1) return "warning";
    if (ratio >= 0.9) return "attention";
    if (ratio >= 0.6) return "success";
    return "primary";
  }

  if (ratio <= 0.6) return "destructive";
  if (ratio <= 0.85) return "warning";
  if (ratio < 1) return "attention";
  if (ratio <= 1.5) return "success";
  return "primary";
}

export function getMetricSparklineGradientClass(tone: MetricQualityTone): string {
  return sparklineGradientMap[tone] || sparklineGradientMap["muted-foreground"];
}

export function getMetricSparklineBorderClass(tone: MetricQualityTone): string {
  return sparklineBorderMap[tone] || sparklineBorderMap["muted-foreground"];
}

export function getMetricSparklineTextClass(tone: MetricQualityTone): string {
  return sparklineTextMap[tone] || sparklineTextMap["muted-foreground"];
}

export function getMetricValueTextClass(tone: MetricQualityTone): string {
  return metricValueTextMap[tone] || metricValueTextMap["muted-foreground"];
}

export function getMetricCardSurfaceClass(tone: MetricQualityTone): string {
  return cardSurfaceMap[tone] || cardSurfaceMap["muted-foreground"];
}
