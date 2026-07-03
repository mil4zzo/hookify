"use client";

// design-system-exception: hardcoded-tailwind-color - chart components compare computed runtime colors

import { useMemo } from "react";
import { scaleLinear } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import { ParentSize } from "@visx/responsive";
import type { MetricQualityTone } from "@/lib/utils/metricQuality";

interface MetricLineSparklineProps {
  series: { date: string; value: number | null }[];
  tone: MetricQualityTone;
  height?: number;
  className?: string;
}

function toneColor(tone: MetricQualityTone): string {
  switch (tone) {
    case "destructive": return "var(--destructive)";
    case "warning":     return "var(--warning)";
    case "attention":   return "var(--attention)";
    case "success":     return "var(--success)";
    case "primary":     return "var(--primary)";
    case "brand":       return "var(--brand)";
    case "accent":      return "var(--ring)";
    default:            return "var(--muted-foreground)";
  }
}

export function MetricLineSparkline({ series, tone, height = 30, className }: MetricLineSparklineProps) {
  const pts = useMemo(
    () =>
      series
        .map((p, i) => ({ x: i, value: p.value }))
        .filter((p) => p.value != null && Number.isFinite(p.value)) as { x: number; value: number }[],
    [series],
  );

  const color = toneColor(tone);

  if (pts.length < 2) {
    return <div className={className} style={{ height }} />;
  }

  return (
    <div className={`w-full min-w-0 ${className ?? ""}`} style={{ height }}>
      <ParentSize>
        {({ width }) => {
          const w = Math.max(0, width || 100);
          const pad = 3;
          const vals = pts.map((p) => p.value);
          const lo = Math.min(...vals);
          const hi = Math.max(...vals);
          const span = hi - lo || Math.max(hi, 1);
          const xScale = scaleLinear({ domain: [0, series.length - 1], range: [pad, w - pad] });
          const yScale = scaleLinear({ domain: [lo - span * 0.15, hi + span * 0.15], range: [height - pad, pad] });
          const last = pts[pts.length - 1];
          return (
            <svg width={w} height={height} className="overflow-visible">
              <LinePath
                data={pts}
                x={(d) => xScale(d.x)}
                y={(d) => yScale(d.value)}
                curve={curveMonotoneX}
                stroke={color}
                strokeWidth={1.75}
                fill="none"
              />
              <circle cx={xScale(last.x)} cy={yScale(last.value)} r={2.5} fill={color} />
            </svg>
          );
        }}
      </ParentSize>
    </div>
  );
}
