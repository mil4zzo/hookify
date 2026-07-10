"use client";

// design-system-exception: hardcoded-tailwind-color - chart components compare computed runtime colors

import { useMemo, useState, useEffect } from "react";
import { scaleLinear } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import { AxisLeft, AxisBottom } from "@visx/axis";
import { GridRows } from "@visx/grid";
import { ParentSize } from "@visx/responsive";
import { localPoint } from "@visx/event";
import type { DiagnosticTarget, BudgetShareData } from "@/lib/metrics/diagnostics";
import { formatLocaleRatioPercent } from "@/lib/utils/currency";
import { useFormatCurrency } from "@/lib/utils/currency";

export interface TrendSeriesPoint {
  date: string;     // ISO YYYY-MM-DD
  value: number | null;
}

export interface TrendLine {
  key: string;
  label: string;
  color: string;    // CSS var or hex — allowed in charts/
  data: TrendSeriesPoint[];
}

interface DiagnosticTrendChartProps {
  lines: TrendLine[];
  target: DiagnosticTarget;
  budgetData?: BudgetShareData | null;
  adKeyToName?: Map<string, string>;
  className?: string;
}

interface NormalizedPoint {
  x: number;
  y: number;       // index 100 at day 0
  original: number;
  date: string;
  key: string;
}

// Palette for the stacked budget bars (semantic chart vars)
const BUDGET_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
const BUDGET_KEY = "__budget__";

function parseDay(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatDay(dateStr: string): string {
  const dt = parseDay(dateStr);
  return `${dt.getDate()}/${dt.getMonth() + 1}`;
}

// Normalize a series to index=100 at the first non-null value
function normalizeToIndex(data: TrendSeriesPoint[]): NormalizedPoint[] {
  const base = data.find((p) => p.value != null && p.value > 0)?.value ?? null;
  return data.map((p, i) => ({
    x: i,
    y: base != null && p.value != null ? (p.value / base) * 100 : 0,
    original: p.value ?? 0,
    date: p.date,
    key: "",
  }));
}

// 5 evenly spaced, integer-rounded ticks over [lo, hi]
function buildTicks(lo: number, hi: number): number[] {
  const span = hi - lo;
  if (span <= 0) return [Math.round(lo)];
  const step = span / 4;
  const out: number[] = [];
  for (let i = 0; i <= 4; i++) out.push(Math.round(lo + step * i));
  return Array.from(new Set(out));
}

function DiagnosticTrendChartInner({ lines, budgetData, adKeyToName }: DiagnosticTrendChartProps) {
  const formatCurrency = useFormatCurrency();
  const [mutedColor, setMutedColor] = useState("rgba(0,0,0,0.35)");
  const [tooltip, setTooltip] = useState<{ x: number; y: number; dayIdx: number } | null>(null);

  // Interactive legend state: which line keys are hidden, and whether budget bars show.
  const [hiddenLines, setHiddenLines] = useState<Set<string>>(new Set());
  const [budgetVisible, setBudgetVisible] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const el = document.createElement("div");
      el.className = "text-muted-foreground";
      el.style.cssText = "position:absolute;opacity:0;pointer-events:none";
      document.body.appendChild(el);
      const color = getComputedStyle(el).color;
      document.body.removeChild(el);
      if (color && color !== "rgba(0, 0, 0, 0)") setMutedColor(color);
    } catch { /* keep default */ }
  }, []);

  const normalizedByKey = useMemo(() => {
    const map = new Map<string, NormalizedPoint[]>();
    for (const line of lines) {
      map.set(line.key, normalizeToIndex(line.data).map((p) => ({ ...p, key: line.key })));
    }
    return map;
  }, [lines]);

  const allDates = lines[0]?.data.map((p) => p.date) ?? [];
  const hasData = allDates.length > 1 && lines.some((l) => l.data.some((p) => p.value != null));

  // Stacked budget segments per day (top-N ads + "Outros")
  const budgetByDay = useMemo(() => {
    if (!budgetData) return [];
    const { axis, bars, otherByDay } = budgetData;
    return axis.map((date, i) => {
      const segments: { key: string; label: string; from: number; to: number; color: string }[] = [];
      let cum = 0;
      bars.forEach((bar, bi) => {
        const share = bar.shareByDay[i] ?? 0;
        if (share > 0.0001) {
          segments.push({
            key: bar.adKey,
            label: (adKeyToName?.get(bar.adKey) ?? bar.adKey).slice(0, 28),
            from: cum,
            to: cum + share,
            color: BUDGET_COLORS[bi % BUDGET_COLORS.length],
          });
        }
        cum += share;
      });
      const other = otherByDay[i] ?? 0;
      if (other > 0.0001) {
        segments.push({ key: "__other__", label: "Outros", from: cum, to: cum + other, color: mutedColor });
      }
      return { date, segments };
    });
  }, [budgetData, adKeyToName, mutedColor]);

  const showBudget = budgetVisible && budgetByDay.length > 0;

  if (!hasData) {
    return <div className="flex items-center justify-center h-full text-sm text-muted-foreground">Dados insuficientes para o gráfico.</div>;
  }

  const formatOriginal = (key: string, val: number): string => {
    if (key === "cpr" || key === "cpmql") return formatCurrency(val);
    return formatLocaleRatioPercent(val);
  };

  const toggleLine = (key: string) =>
    setHiddenLines((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Adaptive Y domain from visible lines (so small funnel shifts are readable even when CPR is flat)
  const visibleLines = lines.filter((l) => !hiddenLines.has(l.key));
  const visibleYs: number[] = [];
  for (const l of visibleLines) {
    for (const p of normalizedByKey.get(l.key) ?? []) {
      if (p.original > 0) visibleYs.push(p.y);
    }
  }
  const dataMin = visibleYs.length ? Math.min(...visibleYs) : 90;
  const dataMax = visibleYs.length ? Math.max(...visibleYs) : 110;
  const lo0 = Math.min(dataMin, 100);
  const hi0 = Math.max(dataMax, 100);
  const pad = Math.max((hi0 - lo0) * 0.18, 6);
  const yDomainLo = Math.max(0, lo0 - pad);
  const yDomainHi = hi0 + pad;
  const yTicks = buildTicks(yDomainLo, yDomainHi);

  return (
    <ParentSize>
      {({ width }) => {
        const height = 196;
        const margin = { top: 10, right: 16, bottom: 24, left: 36 };
        const w = Math.max(0, (width || 300) - margin.left - margin.right);
        const h = Math.max(0, height - margin.top - margin.bottom);

        const xScale = scaleLinear({ domain: [0, Math.max(1, allDates.length - 1)], range: [0, w] });
        const yScale = scaleLinear({ domain: [yDomainLo, yDomainHi], range: [h, 0], clamp: true });
        const yBudget = scaleLinear({ domain: [0, 1], range: [h, 0] });

        const spacing = allDates.length > 1 ? w / (allDates.length - 1) : w;
        const budgetBarW = Math.min(spacing * 0.55, 56);

        const tickCount = Math.min(allDates.length, 6);
        const tickStep = Math.max(1, Math.floor(allDates.length / tickCount));
        const xTickValues = allDates.map((_, i) => i).filter((i) => i % tickStep === 0 || i === allDates.length - 1);

        const handleMouseMove = (e: React.MouseEvent<SVGElement>) => {
          const coords = localPoint(e);
          if (!coords) return;
          const xInner = coords.x - margin.left;
          let closest = 0;
          let minDist = Infinity;
          for (let i = 0; i < allDates.length; i++) {
            const dist = Math.abs(xScale(i) - xInner);
            if (dist < minDist) { minDist = dist; closest = i; }
          }
          setTooltip({ x: coords.x, y: coords.y, dayIdx: closest });
        };

        return (
          <div className="relative" style={{ height }}>
            <svg
              width={width || 300}
              height={height}
              className="overflow-visible"
              onMouseMove={handleMouseMove}
              onMouseLeave={() => setTooltip(null)}
            >
              <g transform={`translate(${margin.left},${margin.top})`}>
                {/* Background: stacked budget bars (spend share per day) */}
                {showBudget && budgetByDay.map(({ date, segments }, dayIdx) => {
                  const cx = xScale(dayIdx);
                  const bx = cx - budgetBarW / 2;
                  const active = tooltip?.dayIdx === dayIdx;
                  return (
                    <g key={`bud-${date}`} opacity={active ? 0.5 : 0.32}>
                      {segments.map((seg) => {
                        const segY = yBudget(seg.to);
                        const segH = Math.max(0, (seg.to - seg.from) * h);
                        return (
                          <rect key={seg.key} x={bx} y={segY} width={budgetBarW} height={segH} fill={seg.color} />
                        );
                      })}
                    </g>
                  );
                })}

                <GridRows scale={yScale} width={w} tickValues={yTicks} strokeDasharray="3 3" stroke={mutedColor} strokeOpacity={0.18} pointerEvents="none" />

                {/* Reference line at 100 */}
                {yDomainLo < 100 && yDomainHi > 100 && (
                  <line x1={0} x2={w} y1={yScale(100)} y2={yScale(100)} stroke={mutedColor} strokeOpacity={0.45} strokeDasharray="4 2" />
                )}

                {visibleLines.map((line) => {
                  const pts = (normalizedByKey.get(line.key) ?? []).filter((p) => p.original > 0);
                  if (pts.length < 2) return null;
                  return (
                    <LinePath
                      key={line.key}
                      data={pts}
                      x={(d) => xScale(d.x)}
                      y={(d) => yScale(d.y)}
                      curve={curveMonotoneX}
                      stroke={line.color}
                      strokeWidth={2}
                      fill="none"
                    />
                  );
                })}

                {/* Hover indicator */}
                {tooltip && (
                  <line x1={xScale(tooltip.dayIdx)} x2={xScale(tooltip.dayIdx)} y1={0} y2={h} stroke={mutedColor} strokeOpacity={0.5} strokeWidth={1} pointerEvents="none" />
                )}
                {tooltip && visibleLines.map((line) => {
                  const pts = normalizedByKey.get(line.key) ?? [];
                  const pt = pts[tooltip.dayIdx];
                  if (!pt || pt.original <= 0) return null;
                  return (
                    <circle key={line.key} cx={xScale(pt.x)} cy={yScale(pt.y)} r={3.5} fill={line.color} stroke="var(--background)" strokeWidth={1.5} />
                  );
                })}

                <g style={{ pointerEvents: "none" }}>
                  <AxisLeft
                    scale={yScale}
                    hideAxisLine
                    hideTicks
                    tickValues={yTicks}
                    tickFormat={(v) => `${v}`}
                    tickLabelProps={() => ({ fill: mutedColor, fontSize: 10, textAnchor: "end", dy: "0.33em" })}
                    stroke="transparent"
                    strokeWidth={0}
                    tickStroke="transparent"
                  />
                  <AxisBottom
                    top={h}
                    scale={xScale}
                    hideAxisLine
                    hideTicks
                    tickValues={xTickValues}
                    tickFormat={(v) => formatDay(allDates[Math.round(Number(v))] ?? "")}
                    tickLabelProps={() => ({ fill: mutedColor, fontSize: 10, textAnchor: "middle" })}
                    stroke="transparent"
                    strokeWidth={0}
                    tickStroke="transparent"
                  />
                </g>

                {/* Invisible hover capture */}
                <rect x={0} y={0} width={w} height={h} fill="transparent" style={{ cursor: "crosshair" }} />
              </g>
            </svg>

            {/* Tooltip */}
            {tooltip && (() => {
              const dateLabel = allDates[tooltip.dayIdx] ? formatDay(allDates[tooltip.dayIdx]) : "";
              const pts = visibleLines.map((line) => {
                const series = normalizedByKey.get(line.key) ?? [];
                return { line, pt: series[tooltip.dayIdx] };
              }).filter(({ pt }) => pt && pt.original > 0);
              const budgetSegs = showBudget ? (budgetByDay[tooltip.dayIdx]?.segments ?? []) : [];
              if (pts.length === 0 && budgetSegs.length === 0) return null;
              const isRight = tooltip.x > (width || 300) * 0.6;
              return (
                <div
                  className="absolute z-20 pointer-events-none rounded-md border border-border bg-background shadow-elevation-overlay p-2 text-xs"
                  style={{ top: tooltip.y - 60, [isRight ? "right" : "left"]: isRight ? (width || 300) - tooltip.x + 10 : tooltip.x + 12 }}
                >
                  <div className="font-semibold text-muted-foreground mb-1">{dateLabel}</div>
                  {pts.map(({ line, pt }) => (
                    <div key={line.key} className="flex items-center gap-2">
                      <span className="inline-block w-1.5 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: line.color }} />
                      <span className="text-foreground">{line.label}:</span>
                      <span className="font-medium text-foreground">
                        {formatOriginal(line.key, pt!.original)}
                        <span className="text-muted-foreground ml-1">({pt!.y.toFixed(0)})</span>
                      </span>
                    </div>
                  ))}
                  {budgetSegs.length > 0 && (
                    <div className="mt-1.5 pt-1.5 border-t border-border">
                      <div className="text-2xs text-muted-foreground mb-0.5">Verba do dia</div>
                      {budgetSegs.map((seg) => (
                        <div key={seg.key} className="flex items-center gap-2">
                          <span className="inline-block w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: seg.color }} />
                          <span className="text-foreground truncate max-w-[140px]">{seg.label}</span>
                          <span className="font-medium text-foreground ml-auto pl-2">{formatLocaleRatioPercent(seg.to - seg.from)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Interactive legend — click to toggle each line and the budget bars */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-1 px-1">
              {lines.map((line) => {
                const hidden = hiddenLines.has(line.key);
                return (
                  <button
                    key={line.key}
                    type="button"
                    onClick={() => toggleLine(line.key)}
                    aria-pressed={!hidden}
                    className={`flex items-center gap-1.5 text-2xs transition-opacity ${hidden ? "opacity-40 line-through" : "opacity-100"} text-muted-foreground hover:text-foreground`}
                  >
                    <span className="inline-block w-3 h-0.5 rounded" style={{ backgroundColor: line.color }} />
                    {line.label}
                  </button>
                );
              })}
              {budgetByDay.length > 0 && (
                <button
                  type="button"
                  onClick={() => setBudgetVisible((v) => !v)}
                  aria-pressed={budgetVisible}
                  className={`flex items-center gap-1.5 text-2xs transition-opacity ${budgetVisible ? "opacity-100" : "opacity-40 line-through"} text-muted-foreground hover:text-foreground`}
                  data-key={BUDGET_KEY}
                >
                  <span className="inline-flex h-2.5 w-3 flex-shrink-0 overflow-hidden rounded-sm">
                    <span className="h-full w-1/3" style={{ backgroundColor: BUDGET_COLORS[0] }} />
                    <span className="h-full w-1/3" style={{ backgroundColor: BUDGET_COLORS[1] }} />
                    <span className="h-full w-1/3" style={{ backgroundColor: BUDGET_COLORS[2] }} />
                  </span>
                  Verba (share)
                </button>
              )}
              <span className="text-2xs text-muted-foreground ml-auto">Índice (base=100)</span>
            </div>
          </div>
        );
      }}
    </ParentSize>
  );
}

export function DiagnosticTrendChart(props: DiagnosticTrendChartProps) {
  return (
    <div className="w-full min-w-0">
      <DiagnosticTrendChartInner {...props} />
    </div>
  );
}
