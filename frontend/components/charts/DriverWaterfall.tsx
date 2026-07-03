"use client";

// design-system-exception: hardcoded-tailwind-color - chart components compare computed runtime colors

import { useMemo, useState } from "react";
import { ParentSize } from "@visx/responsive";
import { scaleLinear } from "@visx/scale";
import { AxisBottom } from "@visx/axis";
import type { PackDecomposition, DriverKey } from "@/lib/metrics/diagnostics";
import { getDriverLabel } from "@/lib/metrics/diagnostics";
import { getMetricTrendTone } from "@/lib/utils/metricQuality";
import { useFormatCurrency } from "@/lib/utils/currency";

interface DriverWaterfallProps {
  decomposition: PackDecomposition;
  selectedDriver: DriverKey | null;
  onSelectDriver: (driver: DriverKey) => void;
  className?: string;
}

interface WaterfallBar {
  label: string;
  driver: DriverKey | "__start__" | "__end__" | "__residual__";
  from: number;   // lower bound of the floating bar
  to: number;     // upper bound of the floating bar
  value: number;  // the contribution (signed)
  isBase: boolean;
  isClickable: boolean;
  tone: string;   // CSS color from vars
}

// Map tone name → CSS var color
function toneToColor(tone: string): string {
  switch (tone) {
    case "destructive": return "var(--destructive)";
    case "warning":     return "var(--warning)";
    case "attention":   return "var(--attention)";
    case "success":     return "var(--success)";
    case "accent":      return "var(--ring)";
    default:            return "var(--muted-foreground)";
  }
}

function DriverWaterfallInner({ decomposition, selectedDriver, onSelectDriver }: DriverWaterfallProps) {
  const formatCurrency = useFormatCurrency();
  const [hoveredBar, setHoveredBar] = useState<string | null>(null);

  const { targetPrev, targetLast, deltaCurrency, drivers, residualCurrency } = decomposition;

  const bars = useMemo((): WaterfallBar[] => {
    if (targetPrev == null || targetLast == null) return [];

    const result: WaterfallBar[] = [];

    // Start bar
    result.push({
      label: "Antes",
      driver: "__start__",
      from: 0,
      to: targetPrev,
      value: targetPrev,
      isBase: true,
      isClickable: false,
      tone: "muted-foreground",
    });

    // Driver step bars (floating)
    let running = targetPrev;
    for (const d of drivers) {
      if (d.status === "collapsed" || d.contributionCurrency == null) continue;
      const contrib = d.contributionCurrency;
      const from = contrib >= 0 ? running : running + contrib;
      const to   = contrib >= 0 ? running + contrib : running;
      const pct  = targetPrev > 0 ? contrib / targetPrev : 0;
      const tone = getMetricTrendTone(pct, true); // positive = cost went up = bad

      result.push({
        label: getDriverLabel(d.driver),
        driver: d.driver,
        from,
        to,
        value: contrib,
        isBase: false,
        isClickable: true,
        tone,
      });
      running += contrib;
    }

    // Residual (if significant)
    if (Math.abs(residualCurrency) > 0.01) {
      const from = residualCurrency >= 0 ? running : running + residualCurrency;
      const to   = residualCurrency >= 0 ? running + residualCurrency : running;
      result.push({
        label: "Outros",
        driver: "__residual__",
        from,
        to,
        value: residualCurrency,
        isBase: false,
        isClickable: false,
        tone: "muted-foreground",
      });
      running += residualCurrency;
    }

    // End bar
    result.push({
      label: "Agora",
      driver: "__end__",
      from: 0,
      to: targetLast,
      value: targetLast,
      isBase: true,
      isClickable: false,
      tone: deltaCurrency != null
        ? getMetricTrendTone(deltaCurrency / (targetPrev || 1), true)
        : "muted-foreground",
    });

    return result;
  }, [decomposition]); // eslint-disable-line react-hooks/exhaustive-deps

  if (bars.length === 0) {
    return <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Sem dados para o waterfall.</div>;
  }

  return (
    <ParentSize>
      {({ width }) => {
        const height = 160;
        const margin = { top: 16, right: 12, bottom: 32, left: 8 };
        const w = Math.max(0, (width || 300) - margin.left - margin.right);
        const h = Math.max(0, height - margin.top - margin.bottom);

        const barCount = bars.length;
        const barW = w / barCount;
        const barPad = Math.max(4, barW * 0.15);
        const effectiveBarW = barW - barPad;

        // Y scale: range covers all from/to values with padding
        const allVals = bars.flatMap((b) => [b.from, b.to]);
        const yMin = Math.min(...allVals) * 0.92;
        const yMax = Math.max(...allVals) * 1.08;
        const yScale = scaleLinear({ domain: [yMin, yMax], range: [h, 0] });

        const labelScale = scaleLinear({ domain: [0, barCount - 1], range: [barW / 2, w - barW / 2] });

        return (
          <div className="relative" style={{ height }}>
            <svg width={width || 300} height={height} className="overflow-visible">
              <g transform={`translate(${margin.left},${margin.top})`}>
                {bars.map((bar, i) => {
                  const bx = i * barW + barPad / 2;
                  const byTop = yScale(bar.to);
                  // Base bars ("Antes"/"Agora") are level columns: draw from the chart floor
                  // up to their value. Using yScale(0) here pushes them far below the visible
                  // band (yMin≈min*0.92), rendering them as giant empty boxes.
                  const byBot = bar.isBase ? h : yScale(bar.from);
                  const bh = Math.max(2, byBot - byTop);
                  const color = toneToColor(bar.tone);
                  const isSelected = bar.driver === selectedDriver;
                  const isHovered = hoveredBar === bar.label;
                  const opacity = bar.isClickable ? (isHovered || isSelected ? 1 : 0.8) : 0.6;

                  // Connector line to next bar
                  const nextBar = bars[i + 1];
                  const showConnector = !bar.isBase && nextBar && !nextBar.isBase;
                  const connectorY = yScale(bar.to);

                  return (
                    <g key={`${bar.driver}-${i}`}>
                      {showConnector && (
                        <line
                          x1={bx + effectiveBarW}
                          x2={bx + barW + barPad / 2}
                          y1={connectorY}
                          y2={connectorY}
                          stroke="var(--border)"
                          strokeWidth={1}
                          strokeDasharray="2 2"
                        />
                      )}
                      <rect
                        x={bx}
                        y={byTop}
                        width={effectiveBarW}
                        height={bh}
                        fill={bar.isBase ? "var(--muted)" : color}
                        stroke={isSelected ? color : "transparent"}
                        strokeWidth={isSelected ? 2 : 0}
                        rx={2}
                        opacity={opacity}
                        style={{ cursor: bar.isClickable ? "pointer" : "default", transition: "opacity 0.12s" }}
                        onClick={() => { if (bar.isClickable && bar.driver !== "__start__" && bar.driver !== "__end__" && bar.driver !== "__residual__") onSelectDriver(bar.driver as DriverKey); }}
                        onMouseEnter={() => setHoveredBar(bar.label)}
                        onMouseLeave={() => setHoveredBar(null)}
                      />

                      {/* Value label inside/above bar */}
                      {!bar.isBase && Math.abs(bar.value) > 0.01 && (
                        <text
                          x={bx + effectiveBarW / 2}
                          y={byTop - 4}
                          textAnchor="middle"
                          fontSize={9}
                          fill={color}
                          fontWeight={600}
                          pointerEvents="none"
                        >
                          {bar.value > 0 ? "+" : ""}{formatCurrency(bar.value)}
                        </text>
                      )}
                      {bar.isBase && (
                        <text
                          x={bx + effectiveBarW / 2}
                          y={byTop - 4}
                          textAnchor="middle"
                          fontSize={9}
                          fill="var(--foreground)"
                          fontWeight={600}
                          pointerEvents="none"
                        >
                          {formatCurrency(bar.value)}
                        </text>
                      )}

                      {/* Click hint for clickable bars */}
                      {bar.isClickable && (
                        <text
                          x={bx + effectiveBarW / 2}
                          y={Math.min(byBot + 11, h - 4)}
                          textAnchor="middle"
                          fontSize={8}
                          fill={color}
                          opacity={0.7}
                          pointerEvents="none"
                        >
                          {isSelected ? "▼" : "▸"}
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* X axis labels */}
                <AxisBottom
                  top={h + 4}
                  scale={labelScale}
                  hideAxisLine
                  hideTicks
                  stroke="transparent"
                  strokeWidth={0}
                  tickStroke="transparent"
                  numTicks={barCount}
                  tickValues={bars.map((_, i) => i)}
                  tickFormat={(v) => bars[Math.round(Number(v))]?.label ?? ""}
                  tickLabelProps={() => ({
                    fill: "var(--muted-foreground)",
                    fontSize: 9,
                    textAnchor: "middle",
                  })}
                />
              </g>
            </svg>

            {/* Delta summary */}
            {deltaCurrency != null && targetPrev != null && (
              <div className="absolute top-1 right-2 text-[10px] text-muted-foreground">
                {deltaCurrency > 0 ? "+" : ""}{formatCurrency(deltaCurrency)}
                {" "}({((deltaCurrency / targetPrev) * 100).toFixed(0)}%)
              </div>
            )}
          </div>
        );
      }}
    </ParentSize>
  );
}

export function DriverWaterfall(props: DriverWaterfallProps) {
  return (
    <div className="w-full min-w-0">
      <div className="text-[11px] font-medium text-muted-foreground mb-1">O que causou a mudança? <span className="font-normal">(clique para ver os anúncios)</span></div>
      <DriverWaterfallInner {...props} />
    </div>
  );
}
