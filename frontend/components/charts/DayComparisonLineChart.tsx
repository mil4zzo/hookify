"use client";

// design-system-exception: hardcoded-tailwind-color - chart components compare computed runtime colors

import { useMemo, useState } from "react";
import { scaleLinear } from "@visx/scale";
import { LinePath, AreaClosed } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import { ParentSize } from "@visx/responsive";
import { localPoint } from "@visx/event";
import { IconCalendar } from "@tabler/icons-react";
import { getMetricQualityToneByAverage, getMetricValueTextClass, type MetricQualityTone } from "@/lib/utils/metricQuality";
import { useFormatCurrency, formatLocaleRatioPercent } from "@/lib/utils/currency";

export interface DayComparisonPoint {
  date: string; // ISO YYYY-MM-DD
  value: number | null;
}

interface DayComparisonLineChartProps {
  series: DayComparisonPoint[];
  tone: MetricQualityTone;
  isCurrency?: boolean;
  height?: number;
  className?: string;
  // Label for the primary line's value row in the hover tooltip (e.g. "CPR"/"CPMQL").
  valueLabel?: string;
  // Optional muted "shadow" layer (e.g. daily spend) — own scale, compressed into the
  // BOTTOM band of the plot (volume-pane style) so it gives context without competing
  // with the cost line. Readable via the hover tooltip; no axis/labels of its own.
  shadowSeries?: DayComparisonPoint[];
  shadowLabel?: string;
  // User's target for the plotted cost metric (e.g. targetCpr) — when set, the hover
  // tooltip colors the value against it (below target = success, above = destructive),
  // same scale as everywhere else. null/undefined → tooltip value stays neutral.
  costTarget?: number | null;
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

function formatDay(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  return `${d.padStart(2, "0")}/${m.padStart(2, "0")}`;
}

function Inner({ series, tone, isCurrency = true, height: heightProp, valueLabel = "Valor", shadowSeries, shadowLabel = "Spend", costTarget }: DayComparisonLineChartProps) {
  const formatCurrency = useFormatCurrency();
  const [hover, setHover] = useState<number | null>(null);

  const fmt = (v: number) => (isCurrency ? formatCurrency(v) : formatLocaleRatioPercent(v));

  const pts = useMemo(
    () => series.map((p, i) => ({ x: i, value: p.value, date: p.date })),
    [series],
  );
  const valid = pts.filter((p) => p.value != null && Number.isFinite(p.value));
  const hasData = valid.length >= 2;

  const shadowPts = useMemo(
    () =>
      (shadowSeries ?? [])
        .map((p, i) => ({ x: i, value: p.value }))
        .filter((p): p is { x: number; value: number } => p.value != null && Number.isFinite(p.value)),
    [shadowSeries],
  );
  const shadowMax = shadowPts.reduce((m, p) => Math.max(m, p.value), 0);
  const hasShadow = shadowPts.length >= 2 && shadowMax > 0;

  const lineColor = toneColor(tone);
  const mutedColor = "var(--muted-foreground)";
  const gradId = `day-cmp-area-${tone}`;

  if (!hasData) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Sem dados suficientes
      </div>
    );
  }

  const lastIdx = pts.length - 1;
  const prevIdx = pts.length - 2;

  return (
    <ParentSize>
      {({ width }) => {
        const height = heightProp ?? 224;
        const margin = { top: 30, right: 20, bottom: 22, left: 16 };
        const w = Math.max(0, (width || 300) - margin.left - margin.right);
        const h = Math.max(0, height - margin.top - margin.bottom);

        const vals = valid.map((p) => p.value as number);
        const lo = Math.min(...vals);
        const hi = Math.max(...vals);
        // Baseline at 0 so the area fills the full height (taller, like the reference);
        // headroom above the max keeps the top dot + its value label from clipping.
        const top = hi + Math.max((hi - lo) * 0.35, hi * 0.12, 1);

        // Target reference line — the vs-alvo delta becomes visible geometry (the cost
        // line running above/below the dashed line). Only drawn when the target sits
        // near the data's range: stretching the domain to reach a far-away target would
        // squash the series into a flat ribbon.
        const showTarget = costTarget != null && costTarget > 0 && costTarget <= hi * 2;
        const domainTop = showTarget ? Math.max(top, costTarget! * 1.15) : top;

        const xScale = scaleLinear({ domain: [0, Math.max(1, pts.length - 1)], range: [0, w] });
        const yScale = scaleLinear({ domain: [0, domainTop], range: [h, 0], clamp: true });
        // Shadow layer gets its OWN scale, compressed into the bottom ~38% of the plot
        // (volume-pane style) — it conveys the spend SHAPE, never comparable magnitudes.
        const shadowScale = scaleLinear({ domain: [0, shadowMax], range: [h, h * 0.62], clamp: true });

        const linePts = pts.filter((p) => p.value != null) as { x: number; value: number; date: string }[];

        const handleMove = (e: React.MouseEvent<SVGElement>) => {
          const coords = localPoint(e);
          if (!coords) return;
          const xInner = coords.x - margin.left;
          let closest = 0;
          let min = Infinity;
          for (let i = 0; i < pts.length; i++) {
            const dist = Math.abs(xScale(i) - xInner);
            if (dist < min) { min = dist; closest = i; }
          }
          setHover(closest);
        };

        const renderDot = (idx: number, color: string, label: string, anchor: "start" | "end") => {
          const p = pts[idx];
          if (!p || p.value == null) return null;
          const cx = xScale(p.x);
          const cy = yScale(p.value);
          const labelX = anchor === "end" ? cx - 6 : cx + 6;
          return (
            <g key={`dot-${idx}`}>
              <circle cx={cx} cy={cy} r={4} fill={color} stroke="var(--background)" strokeWidth={1.5} />
              <text
                x={labelX}
                y={cy - 10}
                fontSize={12}
                fontWeight={700}
                fill={color}
                textAnchor={anchor === "end" ? "end" : "start"}
              >
                {fmt(p.value)}
              </text>
              <text
                x={cx}
                y={h + 14}
                fontSize={10}
                fill={mutedColor}
                textAnchor="middle"
              >
                {label}
              </text>
            </g>
          );
        };

        // Same circle style as the ontem/hoje dots (r=4), but only for the hovered point
        // — and only when it's neither of those two (they already have their own always-on
        // dot). Muted (not tone-colored): it's just a data point, not a highlighted day.
        const renderHoverDot = () => {
          if (hover == null || hover === prevIdx || hover === lastIdx) return null;
          const p = pts[hover];
          if (!p || p.value == null) return null;
          return (
            <circle
              cx={xScale(p.x)}
              cy={yScale(p.value)}
              r={4}
              fill={mutedColor}
              stroke="var(--background)"
              strokeWidth={1.5}
            />
          );
        };

        return (
          <div className="relative" style={{ height }}>
            <svg
              width={width || 300}
              height={height}
              className="overflow-visible"
              onMouseMove={handleMove}
              onMouseLeave={() => setHover(null)}
            >
              <g transform={`translate(${margin.left},${margin.top})`}>
                <defs>
                  <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={lineColor} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                  </linearGradient>
                </defs>

                {/* Spend "shadow" (behind everything): muted fill + thin dashed outline
                    on its own compressed scale — context, not a second data series. */}
                {hasShadow && (
                  <>
                    <AreaClosed
                      data={shadowPts}
                      x={(d) => xScale(d.x)}
                      y={(d) => shadowScale(d.value)}
                      yScale={shadowScale}
                      curve={curveMonotoneX}
                      fill={mutedColor}
                      fillOpacity={0.08}
                      stroke="transparent"
                    />
                    <LinePath
                      data={shadowPts}
                      x={(d) => xScale(d.x)}
                      y={(d) => shadowScale(d.value)}
                      curve={curveMonotoneX}
                      stroke={mutedColor}
                      strokeOpacity={0.35}
                      strokeWidth={1.25}
                      strokeDasharray="4,3"
                      fill="none"
                    />
                  </>
                )}

                {/* Target reference line (behind the cost line): dashed, muted, labeled
                    at the LEFT edge (ontem/hoje labels own the right side). */}
                {showTarget && (
                  <g>
                    <line
                      x1={0}
                      x2={w}
                      y1={yScale(costTarget!)}
                      y2={yScale(costTarget!)}
                      stroke={mutedColor}
                      strokeOpacity={0.55}
                      strokeDasharray="6,4"
                      strokeWidth={1.25}
                    />
                    <text x={0} y={yScale(costTarget!) - 5} fontSize={10} fontWeight={600} fill={mutedColor} textAnchor="start">
                      alvo {fmt(costTarget!)}
                    </text>
                  </g>
                )}

                {/* Gradient fill under the line */}
                <AreaClosed
                  data={linePts}
                  x={(d) => xScale(d.x)}
                  y={(d) => yScale(d.value)}
                  yScale={yScale}
                  curve={curveMonotoneX}
                  fill={`url(#${gradId})`}
                  stroke="transparent"
                />

                <LinePath
                  data={linePts}
                  x={(d) => xScale(d.x)}
                  y={(d) => yScale(d.value)}
                  curve={curveMonotoneX}
                  stroke={lineColor}
                  strokeWidth={2}
                  fill="none"
                />

                {/* Non-highlighted points have NO permanent dot — at this line thickness
                    they were barely distinguishable from the curve itself. They only
                    appear on hover, sized to match the ontem/hoje dots. */}
                {renderHoverDot()}

                {/* Highlight the two compared days. "hoje" is the last point (near the right
                    edge) so its value label renders inward (anchor "end") — otherwise it
                    overflows the widget and hides behind the adjacent list. */}
                {renderDot(prevIdx, mutedColor, "ontem", "end")}
                {renderDot(lastIdx, lineColor, "hoje", "end")}

                {hover != null && pts[hover]?.value != null && (
                  <line
                    x1={xScale(hover)} x2={xScale(hover)} y1={0} y2={h}
                    stroke={mutedColor} strokeOpacity={0.4} strokeWidth={1}
                  />
                )}

                <rect x={0} y={0} width={w} height={h} fill="transparent" style={{ cursor: "crosshair" }} />
              </g>
            </svg>

            {hover != null && pts[hover]?.value != null && (() => {
              const hoveredValue = pts[hover].value as number;
              const valueTone =
                costTarget != null && costTarget > 0
                  ? getMetricQualityToneByAverage(hoveredValue, costTarget, true)
                  : null;
              const valueColorClass = valueTone ? getMetricValueTextClass(valueTone) : "text-foreground";
              const spendValue = hasShadow ? shadowSeries?.[hover]?.value : null;

              // Anchor via `bottom` (not `top`) so the box grows UPWARD from the point's
              // own Y position — it always floats above the dot instead of pinning to the
              // top of the chart and covering it.
              const pointY = margin.top + yScale(hoveredValue);
              const TOOLTIP_GAP = 12;
              const bottomOffset = Math.max(0, height - pointY + TOOLTIP_GAP);

              return (
                <div
                  className="absolute z-20 min-w-[132px] pointer-events-none rounded-md border border-border bg-background px-3 py-2 text-xs shadow-lg"
                  style={{ bottom: bottomOffset, left: Math.min(Math.max(0, xScale(hover) + margin.left - 70), (width || 300) - 150) }}
                >
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <IconCalendar className="h-3.5 w-3.5 flex-shrink-0" />
                    <span>{formatDay(pts[hover].date)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="text-muted-foreground">{valueLabel}</span>
                    <span className={`text-sm font-semibold tabular-nums ${valueColorClass}`}>{fmt(hoveredValue)}</span>
                  </div>
                  {/* The shadow has no axis — hover is the only way to read its value. */}
                  {spendValue != null && (
                    <div className="mt-1 flex items-center gap-1.5 text-muted-foreground">
                      <span>{shadowLabel}</span>
                      <span className="tabular-nums">{formatCurrency(spendValue)}</span>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        );
      }}
    </ParentSize>
  );
}

export function DayComparisonLineChart(props: DayComparisonLineChartProps) {
  return (
    <div className={`w-full min-w-0 ${props.className ?? ""}`}>
      <Inner {...props} />
    </div>
  );
}
