"use client";

import { useMemo, useState, useEffect } from "react";
import { IconEye } from "@tabler/icons-react";
import { scaleLinear } from "@visx/scale";
import { AreaClosed, LinePath } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import { AxisLeft, AxisBottom } from "@visx/axis";
import { GridRows, GridColumns } from "@visx/grid";
import { LinearGradient } from "@visx/gradient";
import { ParentSize } from "@visx/responsive";
import { localPoint } from "@visx/event";
import { ChartTooltip } from "@/components/common/ChartTooltip";
import { Annotation, Connector, CircleSubject, Label } from "@visx/annotation";

interface RetentionChartProps {
  videoPlayCurve: number[];
  videoWatchedP50?: number;
  showIcon?: boolean;
  withCard?: boolean;
  averagesHook?: number | null;
  averagesScrollStop?: number | null;
}

type DataPoint = { x: number; y: number; label: string };

// Configuração padronizada para anotações do gráfico de retenção
const ANNOTATION_CONFIG = {
  connector: {
    stroke: "#1447e6",
    strokeWidth: 1.5,
  },
  circleSubject: {
    radius: 4,
    stroke: "#1447e6",
    fill: "#1447e6",
  },
  label: {
    showBackground: true,
    backgroundProps: {
      fill: "rgba(17, 24, 39, 0.9)",
      rx: 6,
    },
    titleProps: {
      fill: "#ffffff",
      fontSize: 14,
      fontWeight: 600,
      style: { whiteSpace: "nowrap" as const },
    },
    subtitleProps: {
      fill: "#93c5fd",
      fontSize: 20,
      fontWeight: 600,
      style: { fontSize: 20 },
    },
    anchorLineStroke: "transparent" as const,
    padding: { top: 12, right: 12, bottom: 12, left: 12 }, // Padding uniforme de 12px em todos os lados
  },
};

function RetentionChartInner({ videoPlayCurve, averagesHook, averagesScrollStop }: RetentionChartProps) {
  // Helper para calcular variação percentual
  const getDelta = (value: number, avg: number | null | undefined): { diff: number; text: string; color: string } | null => {
    if (avg == null || Number.isNaN(avg) || !isFinite(avg) || avg === 0) {
      return null;
    }
    const diff = value / avg - 1;
    const sign = diff >= 0 ? "+" : "";
    const color = diff > 0 ? "#22c55e" : diff < 0 ? "#ef4444" : "#93c5fd";
    return {
      diff,
      text: `(${sign}${(diff * 100).toFixed(1)}%)`,
      color,
    };
  };
  const [tooltipData, setTooltipData] = useState<{ point: DataPoint; x: number; y: number } | null>(null);
  const [mutedForegroundColor, setMutedForegroundColor] = useState<string>("#6b7280"); // fallback gray

  // Obter cor muted-foreground computada do CSS
  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const tempEl = document.createElement("div");
        tempEl.className = "text-muted-foreground";
        tempEl.style.position = "absolute";
        tempEl.style.opacity = "0";
        tempEl.style.pointerEvents = "none";
        document.body.appendChild(tempEl);
        const rgb = getComputedStyle(tempEl).color;
        document.body.removeChild(tempEl);
        if (rgb && rgb !== "rgba(0, 0, 0, 0)") {
          setMutedForegroundColor(rgb);
        }
      } catch {
        // fallback já definido no useState
      }
    }
  }, []);

  const data = useMemo(() => {
    return videoPlayCurve.map((value, index) => {
      let label = "";
      if (index < 15) {
        label = `${index}`;
      } else {
        // Mapeamento: 15 (índice 15), 20 (índice 16), 25 (índice 17), 30 (índice 18), 40 (índice 19), 50 (índice 20), 60+ (índice 21)
        const labels = ["15", "20", "25", "30", "40", "50", "60+"];
        label = labels[index - 15] || `${index}`;
      }
      return { x: index, y: Math.round(Number(value || 0) * 100) / 100, label };
    });
  }, [videoPlayCurve]);

  return (
    <ParentSize>
      {({ width, height }) => {
        const innerWidth = Math.max(0, width);
        const innerHeight = Math.max(0, height);
        const margin = { top: 10, right: 24, bottom: 24, left: 36 };
        const w = Math.max(0, innerWidth - margin.left - margin.right);
        const h = Math.max(0, innerHeight - margin.top - margin.bottom);

        const xScale = scaleLinear<number>({ domain: [0, Math.max(1, data.length - 1)], range: [0, w] });
        const yMax = Math.max(100, Math.max(...data.map((d) => d.y)));
        const yScale = scaleLinear<number>({ domain: [0, yMax], range: [h, 0] });

        // Labels específicos do eixo X conforme solicitado
        // 0, 1, 2, 3, 6, 9, 12, 15, 20, 25, 30, 40, 50, 60+
        const desiredIndices = [0, 1, 2, 3, 6, 9, 12, 15, 16, 17, 18, 19, 20, 21]; // Índices correspondentes aos labels desejados
        const xTickValues: number[] = [];
        for (const index of desiredIndices) {
          if (index < data.length) {
            xTickValues.push(index);
          }
        }

        // Linhas verticais do grid acompanhando os labels visíveis
        const xGridPoints = xTickValues;

        const handleMouseMove = (event: React.MouseEvent<SVGElement>) => {
          const coords = localPoint(event);
          if (!coords) return;

          const x = coords.x - margin.left;
          const y = coords.y - margin.top;

          // Encontrar o ponto mais próximo ao mouse
          let closestPoint = data[0];
          let minDistance = Math.abs(xScale(closestPoint.x) - x);

          for (const point of data) {
            const distance = Math.abs(xScale(point.x) - x);
            if (distance < minDistance) {
              minDistance = distance;
              closestPoint = point;
            }
          }

          setTooltipData({
            point: closestPoint,
            x: coords.x,
            y: coords.y,
          });
        };

        const handleMouseLeave = () => {
          setTooltipData(null);
        };

        return (
          <div className="relative">
            <style>{`
            .retention-chart-axis line {
              stroke: transparent !important;
              stroke-width: 0 !important;
            }
            .retention-chart-axis path {
              stroke: transparent !important;
              stroke-width: 0 !important;
            }
          `}</style>
            <svg width={innerWidth} height={innerHeight} className="overflow-visible" onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}>
              {/* Gradiente com cor primary: topo 80% opaco, base 20% translúcida */}
              <LinearGradient id="retentionGradient" from="#1447e6" to="#1447e6" fromOpacity={0.8} toOpacity={0.2} />
              <g transform={`translate(${margin.left},${margin.top})`}>
                {/* Grid lines - linhas de suporte pontilhadas */}
                <GridRows scale={yScale} tickValues={[20, 40, 60, 80, 100]} width={w} strokeDasharray="3 3" stroke={mutedForegroundColor} strokeOpacity={0.2} pointerEvents="none" />
                <GridColumns scale={xScale} height={h} tickValues={xGridPoints} strokeDasharray="3 3" stroke={mutedForegroundColor} strokeOpacity={0.2} pointerEvents="none" />

                {/* Area - apenas preenchimento, sem stroke */}
                <AreaClosed data={data} x={(d) => xScale(d.x)} y={(d) => yScale(d.y)} yScale={yScale} curve={curveMonotoneX} fill="url(#retentionGradient)" stroke="none" strokeWidth={0} />

                {/* Linha superior da curva - apenas esta linha terá stroke */}
                <LinePath data={data} x={(d) => xScale(d.x)} y={(d) => yScale(d.y)} curve={curveMonotoneX} stroke="#1447e6" strokeWidth={2} fill="none" />

                {/* Linha invisível para capturar eventos de mouse */}
                <LinePath data={data} x={(d) => xScale(d.x)} y={(d) => yScale(d.y)} curve={curveMonotoneX} stroke="transparent" strokeWidth={20} strokeLinecap="round" style={{ cursor: "crosshair" }} />

                {/* Ponto indicador quando hover */}
                {tooltipData && (
                  <g>
                    <circle cx={xScale(tooltipData.point.x)} cy={yScale(tooltipData.point.y)} r={4} fill="#1447e6" stroke="#fff" strokeWidth={2} />
                  </g>
                )}

                {/* Anotações ancoradas nos pontos 1s e 3s, posicionadas dentro do gráfico */}
                {data.length > 1 &&
                  (() => {
                    const scrollStopVal = data[1].y / 100;
                    const delta = getDelta(scrollStopVal, averagesScrollStop);
                    const annotationX = xScale(1);
                    const annotationY = yScale(data[1].y);
                    const labelX = annotationX + 40;
                    const labelY = annotationY - 20;
                    const padding = 12;
                    const titleFontSize = 14;
                    const valueFontSize = 20;
                    const badgeFontSize = 10;
                    const lineHeight = 4;

                    // Calcular dimensões do label
                    const titleText = "Scroll Stop";
                    const valueText = `${data[1].y.toFixed(1)}%`;
                    const badgeText = delta ? delta.text : "";
                    const badgeWidth = badgeText ? badgeText.length * 5.5 + 10 : 0;
                    const badgeHeight = 16;
                    const badgeSpacing = 6;

                    // Estimar largura do texto de valor (aproximação)
                    const valueTextWidth = valueText.length * (valueFontSize * 0.6);
                    const labelWidth = Math.max(120, valueTextWidth + (badgeText ? badgeWidth + badgeSpacing : 0) + padding * 2);
                    const labelHeight = padding * 2 + titleFontSize + lineHeight + valueFontSize;

                    return (
                      <g>
                        <Annotation x={annotationX} y={annotationY} dx={40} dy={-20}>
                          <Connector {...ANNOTATION_CONFIG.connector} />
                          <CircleSubject {...ANNOTATION_CONFIG.circleSubject} />
                        </Annotation>
                        {/* Background retângulo */}
                        <rect x={labelX} y={labelY - labelHeight} width={labelWidth} height={labelHeight} rx={6} fill="rgba(17, 24, 39, 0.9)" />
                        {/* Título */}
                        <text x={labelX + padding} y={labelY - labelHeight + padding + titleFontSize} fill="#ffffff" fontSize={titleFontSize} fontWeight={600}>
                          {titleText}
                        </text>
                        {/* Valor principal */}
                        <text x={labelX + padding} y={labelY - labelHeight + padding + titleFontSize + lineHeight + valueFontSize} fill="#93c5fd" fontSize={valueFontSize} fontWeight={600}>
                          {valueText}
                        </text>
                        {/* Badge com delta */}
                        {delta && (
                          <g>
                            <rect x={labelX + padding + valueTextWidth + badgeSpacing} y={labelY - labelHeight + padding + titleFontSize + lineHeight + valueFontSize - badgeHeight + 2} width={badgeWidth} height={badgeHeight} rx={4} fill={delta.color} fillOpacity={0.15} />
                            <text x={labelX + padding + valueTextWidth + badgeSpacing + badgeWidth / 2} y={labelY - labelHeight + padding + titleFontSize + lineHeight + valueFontSize - 2} fill={delta.color} fontSize={badgeFontSize} fontWeight={600} textAnchor="middle" dominantBaseline="middle">
                              {badgeText}
                            </text>
                          </g>
                        )}
                      </g>
                    );
                  })()}
                {data.length > 3 &&
                  (() => {
                    const hookVal = data[3].y / 100;
                    const delta = getDelta(hookVal, averagesHook);
                    const annotationX = xScale(3);
                    const annotationY = yScale(data[3].y);
                    const labelX = annotationX + 40;
                    const labelY = annotationY - 20;
                    const padding = 12;
                    const titleFontSize = 14;
                    const valueFontSize = 20;
                    const badgeFontSize = 10;
                    const lineHeight = 4;

                    // Calcular dimensões do label
                    const titleText = "Hook";
                    const valueText = `${data[3].y.toFixed(1)}%`;
                    const badgeText = delta ? delta.text : "";
                    const badgeWidth = badgeText ? badgeText.length * 5.5 + 10 : 0;
                    const badgeHeight = 16;
                    const badgeSpacing = 6;

                    // Estimar largura do texto de valor (aproximação)
                    const valueTextWidth = valueText.length * (valueFontSize * 0.6);
                    const labelWidth = Math.max(120, valueTextWidth + (badgeText ? badgeWidth + badgeSpacing : 0) + padding * 2);
                    const labelHeight = padding * 2 + titleFontSize + lineHeight + valueFontSize;

                    return (
                      <g>
                        <Annotation x={annotationX} y={annotationY} dx={40} dy={-20}>
                          <Connector {...ANNOTATION_CONFIG.connector} />
                          <CircleSubject {...ANNOTATION_CONFIG.circleSubject} />
                        </Annotation>
                        {/* Background retângulo */}
                        <rect x={labelX} y={labelY - labelHeight} width={labelWidth} height={labelHeight} rx={6} fill="rgba(17, 24, 39, 0.9)" />
                        {/* Título */}
                        <text x={labelX + padding} y={labelY - labelHeight + padding + titleFontSize} fill="#ffffff" fontSize={titleFontSize} fontWeight={600}>
                          {titleText}
                        </text>
                        {/* Valor principal */}
                        <text x={labelX + padding} y={labelY - labelHeight + padding + titleFontSize + lineHeight + valueFontSize} fill="#93c5fd" fontSize={valueFontSize} fontWeight={600}>
                          {valueText}
                        </text>
                        {/* Badge com delta */}
                        {delta && (
                          <g>
                            <rect x={labelX + padding + valueTextWidth + badgeSpacing} y={labelY - labelHeight + padding + titleFontSize + lineHeight + valueFontSize - badgeHeight + 2} width={badgeWidth} height={badgeHeight} rx={4} fill={delta.color} fillOpacity={0.15} />
                            <text x={labelX + padding + valueTextWidth + badgeSpacing + badgeWidth / 2} y={labelY - labelHeight + padding + titleFontSize + lineHeight + valueFontSize - 2} fill={delta.color} fontSize={badgeFontSize} fontWeight={600} textAnchor="middle" dominantBaseline="middle">
                              {badgeText}
                            </text>
                          </g>
                        )}
                      </g>
                    );
                  })()}

                {/* Axis */}
                <g className="retention-chart-axis">
                  <AxisLeft
                    scale={yScale}
                    hideAxisLine={true}
                    hideTicks={true}
                    tickValues={[20, 40, 60, 80, 100]}
                    tickFormat={(v) => `${v}%`}
                    stroke="transparent"
                    strokeWidth={0}
                    tickStroke="transparent"
                    tickLabelProps={() => ({
                      fill: mutedForegroundColor,
                      fontSize: 12,
                      textAnchor: "end",
                      dy: "0.33em",
                    })}
                  />
                  <AxisBottom top={h} scale={xScale} hideAxisLine={true} hideTicks={true} stroke="transparent" strokeWidth={0} tickStroke="transparent" tickValues={xTickValues} tickFormat={(v) => data[Math.round(Number(v))]?.label || ""} tickLabelProps={() => ({ fill: mutedForegroundColor, fontSize: 12, textAnchor: "middle" })} />
                </g>
              </g>
            </svg>

            {/* Tooltip */}
            {tooltipData && (
              <ChartTooltip
                title={`Tempo: ${tooltipData.point.label}`}
                value={`Retenção: ${Math.round(tooltipData.point.y)}%`}
                style={{
                  left: `${tooltipData.x}px`,
                  top: `${tooltipData.y - 40}px`,
                  transform: "translateX(-50%)",
                }}
              />
            )}
          </div>
        );
      }}
    </ParentSize>
  );
}

export function RetentionChart({ videoPlayCurve, videoWatchedP50, showIcon = false, averagesHook, averagesScrollStop }: RetentionChartProps) {
  return (
    <div className="space-y-4">
      <div className="text-lg font-semibold">
        {showIcon && <IconEye className="w-5 h-5 text-brand inline-block mr-2" />}
        Retenção
      </div>
      <div className="h-64">
        <RetentionChartInner videoPlayCurve={videoPlayCurve} averagesHook={averagesHook} averagesScrollStop={averagesScrollStop} />
      </div>
    </div>
  );
}
