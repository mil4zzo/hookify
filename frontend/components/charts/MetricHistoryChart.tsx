"use client";

import { useMemo, useState, useEffect } from "react";
import { scaleLinear } from "@visx/scale";
import { AreaClosed, LinePath } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import { AxisLeft, AxisBottom } from "@visx/axis";
import { GridRows, GridColumns } from "@visx/grid";
import { LinearGradient } from "@visx/gradient";
import { ParentSize } from "@visx/responsive";
import { localPoint } from "@visx/event";
import { ChartTooltip } from "@/components/common/ChartTooltip";

interface MetricHistoryChartProps {
  data: Array<{
    date: string;
    spend?: number;
    lpv?: number;
    conversions?: Record<string, number>;
    [key: string]: any;
  }>;
  dateStart: string;
  dateStop: string;
  actionType?: string;
  formatValue?: (value: number) => string;
  availableMetrics: typeof AVAILABLE_METRICS;
  selectedMetrics: string[];
  onMetricsChange: (metrics: string[]) => void;
}

type DataPoint = { x: number; y: number; originalY?: number; date: string; label: string; metricKey: string };

// Métricas disponíveis e suas configurações
export const AVAILABLE_METRICS = [
  { key: "spend", label: "Spend", format: (v: number) => `R$ ${v.toFixed(2)}`, color: "#1447e6" },
  { key: "impressions", label: "Impressions", format: (v: number) => v.toLocaleString("pt-BR"), color: "#8b5cf6" },
  { key: "clicks", label: "Clicks", format: (v: number) => v.toLocaleString("pt-BR"), color: "#06b6d4" },
  { key: "hook", label: "Hook", format: (v: number) => `${(v * 100).toFixed(2)}%`, color: "#10b981" },
  { key: "ctr", label: "CTR", format: (v: number) => `${(v * 100).toFixed(2)}%`, color: "#f59e0b" },
  { key: "connect_rate", label: "Connect Rate", format: (v: number) => `${(v * 100).toFixed(2)}%`, color: "#ef4444" },
  { key: "cpm", label: "CPM", format: (v: number) => `R$ ${v.toFixed(2)}`, color: "#ec4899" },
  { key: "lpv", label: "Landing Page Views", format: (v: number) => v.toLocaleString("pt-BR"), color: "#6366f1" },
  { key: "plays", label: "Plays", format: (v: number) => v.toLocaleString("pt-BR"), color: "#14b8a6" },
  { key: "cpr", label: "CPR", format: (v: number) => `R$ ${v.toFixed(2)}`, color: "#f97316" },
  { key: "page_conv", label: "Page Conv", format: (v: number) => `${(v * 100).toFixed(2)}%`, color: "#84cc16" },
] as const;

// Função helper para parsear data sem problemas de timezone
function parseDate(dateStr: string): Date {
  // Se a data vem como "YYYY-MM-DD", parsear diretamente sem conversão de timezone
  const parts = dateStr.split("T")[0].split("-");
  if (parts.length === 3) {
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1; // month é 0-indexed
    const day = parseInt(parts[2], 10);
    return new Date(year, month, day);
  }
  // Fallback para formato padrão
  return new Date(dateStr);
}

// Função para calcular valor de uma métrica
function calculateMetricValue(item: any, metric: string, actionType?: string): number {
  if (metric === "cpr") {
    const spend = Number(item.spend || 0);
    const conversions = item.conversions || {};
    const results = actionType ? Number(conversions[actionType] || 0) : 0;
    return results > 0 && spend > 0 ? spend / results : 0;
  } else if (metric === "page_conv") {
    const lpv = Number(item.lpv || 0);
    const conversions = item.conversions || {};
    const results = actionType ? Number(conversions[actionType] || 0) : 0;
    return lpv > 0 && results > 0 ? results / lpv : 0;
  } else if (metric === "hook" || metric === "ctr" || metric === "connect_rate") {
    return Number(item[metric] || 0);
  } else {
    return Number(item[metric] || 0);
  }
}

function MetricHistoryChartInner({ data, formatValue, actionType, availableMetrics, selectedMetrics, onMetricsChange }: MetricHistoryChartProps) {
  const [tooltipData, setTooltipData] = useState<{ point: DataPoint; x: number; y: number } | null>(null);
  const [mutedForegroundColor, setMutedForegroundColor] = useState<string>("#6b7280");
  const [isNormalized, setIsNormalized] = useState<boolean>(false);
  const [tooltipWidth, setTooltipWidth] = useState<number>(200);

  // Callback ref para medir a largura do tooltip quando ele for renderizado
  const tooltipRefCallback = (node: HTMLDivElement | null) => {
    if (node) {
      setTooltipWidth(node.offsetWidth);
    }
  };

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

  // Processar dados para cada métrica
  const chartDataByMetric = useMemo(() => {
    if (selectedMetrics.length === 0) return {};

    const result: Record<string, DataPoint[]> = {};

    // Primeiro, calcular todos os valores originais
    const rawData: Record<string, DataPoint[]> = {};
    selectedMetrics.forEach((metricKey) => {
      rawData[metricKey] = data.map((item, index) => {
        const value = calculateMetricValue(item, metricKey, actionType);
        const date = parseDate(item.date);
        const day = date.getDate();
        const month = date.getMonth() + 1;
        const label = `${day}/${month}`;
        return { x: index, y: value, originalY: value, date: item.date, label, metricKey };
      });
    });

    // Se normalizado, normalizar cada métrica para 0-100%
    if (isNormalized) {
      selectedMetrics.forEach((metricKey) => {
        const metricData = rawData[metricKey] || [];
        const values = metricData.map((p) => p.y).filter((v) => !isNaN(v) && isFinite(v));

        if (values.length === 0) {
          result[metricKey] = metricData;
          return;
        }

        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = max - min;

        result[metricKey] = metricData.map((point) => {
          if (range === 0) {
            return { ...point, y: 50 }; // Se todos os valores são iguais, colocar no meio
          }
          const normalized = ((point.y - min) / range) * 100;
          return { ...point, y: normalized };
        });
      });
    } else {
      // Se não normalizado, usar valores originais
      selectedMetrics.forEach((metricKey) => {
        result[metricKey] = rawData[metricKey];
      });
    }

    return result;
  }, [data, selectedMetrics, actionType, isNormalized]);

  // Encontrar configurações das métricas selecionadas
  const selectedMetricsConfig = useMemo(() => {
    return selectedMetrics.map((key) => availableMetrics.find((m) => m.key === key)).filter((m): m is (typeof availableMetrics)[number] => m !== undefined);
  }, [selectedMetrics, availableMetrics]);

  // Calcular domínio Y unificado (considerando todas as métricas)
  const yDomain = useMemo(() => {
    if (selectedMetricsConfig.length === 0) return [0, 1];

    // Se normalizado, sempre usar 0-100
    if (isNormalized) {
      return [0, 100];
    }

    let yMax = -Infinity;
    let yMin = Infinity;

    selectedMetricsConfig.forEach((config) => {
      const metricData = chartDataByMetric[config.key] || [];
      metricData.forEach((point) => {
        if (point.y > yMax) yMax = point.y;
        if (point.y < yMin) yMin = point.y;
      });
    });

    if (yMax === -Infinity || yMin === Infinity) return [0, 1];
    if (yMax === yMin) return [0, Math.max(1, yMax)];

    return [Math.min(0, yMin), yMax];
  }, [chartDataByMetric, selectedMetricsConfig, isNormalized]);

  // Determinar formato do eixo Y (priorizar porcentagem se houver métricas de porcentagem)
  const yAxisFormat = useMemo(() => {
    // Se normalizado, sempre mostrar porcentagem
    if (isNormalized) {
      return (v: number) => `${v.toFixed(0)}%`;
    }

    const hasPercentage = selectedMetricsConfig.some((m) => m.key === "hook" || m.key === "ctr" || m.key === "connect_rate" || m.key === "page_conv");
    const hasCurrency = selectedMetricsConfig.some((m) => m.key === "spend" || m.key === "cpm" || m.key === "cpr");

    if (hasPercentage && !hasCurrency) {
      return (v: number) => `${(v * 100).toFixed(1)}%`;
    } else if (hasCurrency && !hasPercentage) {
      return (v: number) => `R$ ${v.toFixed(0)}`;
    }
    // Se misturar tipos, usar formato numérico genérico
    return (v: number) => v.toLocaleString("pt-BR");
  }, [selectedMetricsConfig, isNormalized]);

  // Calcular tooltipPoints no nível do componente, não dentro do render do ParentSize
  const tooltipPoints = useMemo(() => {
    if (!tooltipData) return [];
    return selectedMetricsConfig
      .map((config) => {
        const metricData = chartDataByMetric[config.key] || [];
        // Buscar pelo índice x do ponto, garantindo que existe
        const point = metricData.find((p) => p.x === tooltipData.point.x);
        return point || null;
      })
      .filter((p): p is DataPoint => p !== null);
  }, [tooltipData, chartDataByMetric, selectedMetricsConfig]);

  return (
    <div className="flex gap-12 h-full min-h-0 w-full">
      {/* Seletor de métricas à esquerda */}
      <div className="flex-shrink-0 w-auto flex flex-col min-h-0">
        <div className="text-xs font-medium text-foreground mb-2 flex-shrink-0">Métricas:</div>
        <div className="flex flex-col gap-1.5 flex-1 overflow-y-auto pr-1 min-h-0">
          {/* Toggle de normalização */}
          <label className="flex items-center gap-2 p-1.5 rounded-md cursor-pointer transition-colors text-xs bg-background border border-border hover:bg-muted mb-2">
            <input type="checkbox" checked={isNormalized} onChange={(e) => setIsNormalized(e.target.checked)} className="w-3.5 h-3.5 rounded border-border text-primary focus:ring-2 focus:ring-primary focus:ring-offset-1" />
            <span className="text-foreground text-[11px]">Normalizar (0-100%)</span>
          </label>
          {availableMetrics.map((metric) => {
            const isSelected = selectedMetrics.includes(metric.key);
            const requiresActionType = (metric.key === "cpr" || metric.key === "page_conv") && !actionType;

            return (
              <label key={metric.key} className={`flex items-center gap-2 p-1.5 rounded-md cursor-pointer transition-colors text-xs ${isSelected ? "bg-primary/10 border border-primary" : "bg-background border border-border hover:bg-muted"} ${requiresActionType ? "opacity-50 cursor-not-allowed" : ""}`}>
                <input
                  type="checkbox"
                  checked={isSelected}
                  disabled={requiresActionType}
                  onChange={(e) => {
                    if (e.target.checked) {
                      onMetricsChange([...selectedMetrics, metric.key]);
                    } else {
                      onMetricsChange(selectedMetrics.filter((m) => m !== metric.key));
                    }
                  }}
                  className="w-3.5 h-3.5 rounded border-border text-primary focus:ring-2 focus:ring-primary focus:ring-offset-1"
                />
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: metric.color }} />
                  <span className="text-foreground truncate">{metric.label}</span>
                </div>
              </label>
            );
          })}
        </div>
        {(selectedMetrics.includes("cpr") || selectedMetrics.includes("page_conv")) && !actionType && <div className="mt-2 text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 p-1.5 rounded text-[10px]">⚠️ CPR e Page Conv requerem tipo de conversão selecionado.</div>}
      </div>

      {/* Gráfico */}
      <div className="flex-1 min-h-0 min-w-0">
        <ParentSize>
          {({ width, height }) => {
            const innerWidth = Math.max(0, width || 0);
            const innerHeight = Math.max(0, height || 256);
            const margin = { top: 10, right: 24, bottom: 24, left: 36 };
            const w = Math.max(0, innerWidth - margin.left - margin.right);
            const h = Math.max(0, innerHeight - margin.top - margin.bottom);

            if (data.length === 0) {
              return <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Sem dados disponíveis</div>;
            }

            // Garantir dimensões mínimas
            const finalWidth = Math.max(w, 100);
            const finalHeight = Math.max(h, 100);

            const xScale = scaleLinear<number>({ domain: [0, Math.max(1, data.length - 1)], range: [0, finalWidth] });
            // Se não há métricas selecionadas, usar um domínio Y padrão para mostrar o eixo
            const finalYDomain = selectedMetricsConfig.length === 0 ? [0, 100] : yDomain;
            const yScale = scaleLinear<number>({ domain: finalYDomain, range: [finalHeight, 0] });

            // Calcular ticks do eixo Y
            const yTickCount = 5;
            const yTickStep = (finalYDomain[1] - finalYDomain[0]) / (yTickCount - 1);
            const yTickValues: number[] = [];
            for (let i = 0; i < yTickCount; i++) {
              yTickValues.push(finalYDomain[0] + yTickStep * i);
            }

            // Calcular ticks do eixo X com intervalo uniforme de 2 em 2 dias
            const xTickValues: number[] = [];
            const xTickLabels: string[] = [];

            if (data.length > 0) {
              // Obter primeira e última data (usar parseDate para evitar problemas de timezone)
              const firstDate = parseDate(data[0].date);
              const lastDate = parseDate(data[data.length - 1].date);

              // Criar mapa de data -> índice para busca rápida
              const dateToIndex = new Map<string, number>();
              data.forEach((item, idx) => {
                const date = parseDate(item.date);
                // Formatar como YYYY-MM-DD sem conversão de timezone
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, "0");
                const day = String(date.getDate()).padStart(2, "0");
                const dateStr = `${year}-${month}-${day}`;
                dateToIndex.set(dateStr, idx);
              });

              // Começar da primeira data e ir de 2 em 2 dias
              let currentDate = new Date(firstDate);
              const maxTicks = 15; // Limite máximo de ticks para não poluir o gráfico
              let tickCount = 0;

              while (currentDate <= lastDate && tickCount < maxTicks) {
                // Formatar data atual como YYYY-MM-DD
                const year = currentDate.getFullYear();
                const month = String(currentDate.getMonth() + 1).padStart(2, "0");
                const day = String(currentDate.getDate()).padStart(2, "0");
                const dateStr = `${year}-${month}-${day}`;
                const index = dateToIndex.get(dateStr);

                // Se a data existe nos dados, adicionar ao tick
                if (index !== undefined) {
                  xTickValues.push(index);
                  const dayNum = currentDate.getDate();
                  const monthNum = currentDate.getMonth() + 1;
                  xTickLabels.push(`${dayNum}/${monthNum}`);
                  tickCount++;
                } else {
                  // Se a data não existe, procurar a data mais próxima nos dados
                  let closestIndex = -1;
                  let minDistance = Infinity;

                  data.forEach((item, idx) => {
                    const itemDate = parseDate(item.date);
                    const distance = Math.abs(itemDate.getTime() - currentDate.getTime());
                    if (distance < minDistance) {
                      minDistance = distance;
                      closestIndex = idx;
                    }
                  });

                  // Só adicionar se não for duplicata e estiver próximo (dentro de 1 dia)
                  if (closestIndex >= 0 && minDistance < 24 * 60 * 60 * 1000 && !xTickValues.includes(closestIndex)) {
                    xTickValues.push(closestIndex);
                    const dayNum = currentDate.getDate();
                    const monthNum = currentDate.getMonth() + 1;
                    xTickLabels.push(`${dayNum}/${monthNum}`);
                    tickCount++;
                  }
                }

                // Avançar 2 dias
                currentDate.setDate(currentDate.getDate() + 2);
              }

              // Garantir que a última data sempre apareça
              if (data.length > 0 && !xTickValues.includes(data.length - 1)) {
                xTickValues.push(data.length - 1);
                const lastDay = lastDate.getDate();
                const lastMonth = lastDate.getMonth() + 1;
                xTickLabels.push(`${lastDay}/${lastMonth}`);
              }
            }

            const handleMouseMove = (event: React.MouseEvent<SVGElement>) => {
              const coords = localPoint(event);
              if (!coords) return;

              const x = coords.x - margin.left;
              const y = coords.y - margin.top;

              // Encontrar o índice X mais próximo (não o ponto mais próximo em distância)
              // Isso garante que todos os pontos do mesmo dia sejam mostrados
              let closestIndex = 0;
              let minDistance = Infinity;

              if (data.length > 0) {
                for (let i = 0; i < data.length; i++) {
                  const distance = Math.abs(xScale(i) - x);
                  if (distance < minDistance) {
                    minDistance = distance;
                    closestIndex = i;
                  }
                }

                // Só atualizar se a distância for razoável (dentro de um threshold)
                // O threshold é metade da distância entre dois pontos adjacentes
                const threshold = finalWidth / data.length / 2;
                if (minDistance < threshold && selectedMetricsConfig.length > 0) {
                  // Encontrar um ponto de qualquer métrica com esse índice
                  let foundPoint: DataPoint | null = null;
                  for (const config of selectedMetricsConfig) {
                    const metricData = chartDataByMetric[config.key] || [];
                    const point = metricData.find((p) => p.x === closestIndex);
                    if (point) {
                      foundPoint = point;
                      break;
                    }
                  }

                  if (foundPoint) {
                    setTooltipData({
                      point: foundPoint,
                      x: coords.x,
                      y: coords.y,
                    });
                  }
                }
              }
            };

            const handleMouseLeave = () => {
              setTooltipData(null);
            };

            return (
              <div className="relative">
                <style>{`
                  .metric-history-chart-axis line {
                    stroke: transparent !important;
                    stroke-width: 0 !important;
                  }
                  .metric-history-chart-axis path {
                    stroke: transparent !important;
                    stroke-width: 0 !important;
                  }
                `}</style>
                <svg width={Math.max(innerWidth, 100)} height={Math.max(innerHeight, 100)} className="overflow-visible" onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}>
                  <defs>
                    {selectedMetricsConfig.map((config) => (
                      <LinearGradient key={`gradient-${config.key}`} id={`metricHistoryGradient-${config.key}`} from={config.color} to={config.color} fromOpacity={0.8} toOpacity={0.2} />
                    ))}
                  </defs>
                  <g transform={`translate(${margin.left},${margin.top})`}>
                    {/* Grid lines - linhas de suporte pontilhadas */}
                    <GridRows scale={yScale} tickValues={yTickValues} width={finalWidth} strokeDasharray="3 3" stroke={mutedForegroundColor} strokeOpacity={0.2} pointerEvents="none" />
                    <GridColumns scale={xScale} height={finalHeight} tickValues={xTickValues} strokeDasharray="3 3" stroke={mutedForegroundColor} strokeOpacity={0.2} pointerEvents="none" />

                    {/* Renderizar áreas e linhas para cada métrica */}
                    {selectedMetricsConfig.map((config) => {
                      const metricData = chartDataByMetric[config.key] || [];
                      if (metricData.length === 0) return null;

                      return (
                        <g key={config.key}>
                          {/* Area - apenas preenchimento, sem stroke */}
                          <AreaClosed data={metricData} x={(d) => xScale(d.x)} y={(d) => yScale(d.y)} yScale={yScale} curve={curveMonotoneX} fill={`url(#metricHistoryGradient-${config.key})`} stroke="none" strokeWidth={0} />
                          {/* Linha superior da curva */}
                          <LinePath data={metricData} x={(d) => xScale(d.x)} y={(d) => yScale(d.y)} curve={curveMonotoneX} stroke={config.color} strokeWidth={2} fill="none" />
                        </g>
                      );
                    })}

                    {/* Linha invisível para capturar eventos de mouse (usar primeira métrica) */}
                    {selectedMetricsConfig.length > 0 && chartDataByMetric[selectedMetricsConfig[0].key] && <LinePath data={chartDataByMetric[selectedMetricsConfig[0].key]} x={(d) => xScale(d.x)} y={(d) => yScale(d.y)} curve={curveMonotoneX} stroke="transparent" strokeWidth={20} strokeLinecap="round" style={{ cursor: "crosshair" }} />}

                    {/* Pontos indicadores quando hover */}
                    {tooltipData &&
                      tooltipPoints.map((point) => {
                        const config = selectedMetricsConfig.find((m) => m.key === point.metricKey);
                        if (!config) return null;
                        return <circle key={point.metricKey} cx={xScale(point.x)} cy={yScale(point.y)} r={4} fill={config.color} stroke="#fff" strokeWidth={2} />;
                      })}

                    {/* Axis */}
                    <g className="metric-history-chart-axis">
                      <AxisLeft
                        scale={yScale}
                        hideAxisLine={true}
                        hideTicks={true}
                        tickValues={yTickValues}
                        tickFormat={(v) => {
                          if (selectedMetricsConfig.length === 0) {
                            return ""; // Não mostrar labels quando não há métricas
                          }
                          return yAxisFormat(Number(v));
                        }}
                        stroke="transparent"
                        strokeWidth={0}
                        tickStroke="transparent"
                        {...({ axisLineProps: { stroke: "transparent", strokeWidth: 0, className: "metric-history-chart-axis-line" } } as any)}
                        {...({ tickLineProps: { stroke: "transparent", strokeWidth: 0, className: "metric-history-chart-axis-tick" } } as any)}
                        tickLabelProps={() => ({
                          fill: mutedForegroundColor,
                          fontSize: 12,
                          textAnchor: "end",
                          dy: "0.33em",
                        })}
                      />
                      <AxisBottom
                        top={finalHeight}
                        scale={xScale}
                        hideAxisLine={true}
                        hideTicks={true}
                        stroke="transparent"
                        strokeWidth={0}
                        tickStroke="transparent"
                        {...({ axisLineProps: { stroke: "transparent", strokeWidth: 0, className: "metric-history-chart-axis-line" } } as any)}
                        {...({ tickLineProps: { stroke: "transparent", strokeWidth: 0, className: "metric-history-chart-axis-tick" } } as any)}
                        tickValues={xTickValues}
                        tickFormat={(v) => {
                          const index = Math.round(Number(v));
                          // Encontrar o índice correspondente em xTickValues
                          const tickIndex = xTickValues.indexOf(index);
                          if (tickIndex >= 0 && tickIndex < xTickLabels.length) {
                            return xTickLabels[tickIndex];
                          }
                          // Fallback: usar dados se disponível
                          if (data[index]) {
                            const date = parseDate(data[index].date);
                            const day = date.getDate();
                            const month = date.getMonth() + 1;
                            return `${day}/${month}`;
                          }
                          return "";
                        }}
                        tickLabelProps={() => ({
                          fill: mutedForegroundColor,
                          fontSize: 12,
                          textAnchor: "middle",
                        })}
                      />
                    </g>
                  </g>
                </svg>

                {/* Tooltip */}
                {tooltipData && tooltipPoints.length > 0 && (
                  <div
                    ref={tooltipRefCallback}
                    className="absolute bg-background border border-border rounded-md shadow-lg p-2 z-10 pointer-events-none"
                    style={{
                      left: (() => {
                        const containerWidth = Math.max(innerWidth, 100);
                        const offset = 15; // Offset padrão do cursor
                        const threshold = 200; // Distância da borda para inverter (em pixels)

                        // Se próximo da borda direita, colocar à esquerda do cursor
                        if (tooltipData.x + tooltipWidth + offset > containerWidth - threshold) {
                          return `${Math.max(0, tooltipData.x - tooltipWidth - offset)}px`;
                        }
                        // Se próximo da borda esquerda, garantir que não ultrapasse
                        if (tooltipData.x - tooltipWidth - offset < threshold) {
                          return `${tooltipData.x + offset}px`;
                        }
                        // Posição padrão: à direita do cursor
                        return `${tooltipData.x + offset}px`;
                      })(),
                      top: `${tooltipData.y - 60}px`,
                    }}
                  >
                    <div className="text-xs font-semibold text-muted-foreground mb-1">{tooltipData.point.date}</div>
                    {tooltipPoints.map((point) => {
                      const config = selectedMetricsConfig.find((m) => m.key === point.metricKey);
                      if (!config) return null;
                      const format = formatValue || config.format;
                      // Sempre mostrar o valor original no tooltip, mesmo quando normalizado
                      const displayValue = point.originalY !== undefined ? point.originalY : point.y;
                      return (
                        <div key={point.metricKey} className="flex items-center gap-2 text-xs">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: config.color }} />
                          <span className="text-foreground font-medium">{config.label}:</span>
                          <span className="text-foreground">{format(displayValue)}</span>
                          {isNormalized && point.originalY !== undefined && <span className="text-muted-foreground text-[10px]">({point.y.toFixed(1)}%)</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }}
        </ParentSize>
      </div>
    </div>
  );
}

export function MetricHistoryChart({ data, dateStart, dateStop, actionType, formatValue, availableMetrics, selectedMetrics, onMetricsChange }: MetricHistoryChartProps) {
  return (
    <div className="h-full flex min-h-0">
      <MetricHistoryChartInner data={data} dateStart={dateStart} dateStop={dateStop} actionType={actionType} formatValue={formatValue} availableMetrics={availableMetrics} selectedMetrics={selectedMetrics} onMetricsChange={onMetricsChange} />
    </div>
  );
}
