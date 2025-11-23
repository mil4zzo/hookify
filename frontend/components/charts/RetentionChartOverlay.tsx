"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { scaleLinear } from "@visx/scale";
import { AreaClosed, LinePath } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import { LinearGradient } from "@visx/gradient";
import { AxisLeft, AxisBottom } from "@visx/axis";
import { GridRows, GridColumns } from "@visx/grid";
import { ChartTooltip } from "@/components/common/ChartTooltip";

interface RetentionChartOverlayProps {
  videoPlayCurve: number[];
  currentTime?: number;
  duration?: number;
  isPlaying?: boolean;
  onTimeSeek?: (second: number) => void;
  className?: string;
}

// Função para converter índice do ponto para segundo do vídeo
const indexToSecond = (index: number): number => {
  if (index < 15) {
    return index;
  }
  const seconds = [15, 20, 25, 30, 40, 50, 60];
  return seconds[index - 15] || 60;
};

// Função para obter o valor de retenção em um segundo específico (com interpolação)
const getRetentionAtSecond = (second: number, data: { x: number; y: number }[]): number => {
  if (data.length === 0) return 0;

  // Se o segundo está antes do primeiro ponto
  if (second <= 0) return data[0].y;

  // Encontrar os dois pontos mais próximos para interpolação
  let lowerIndex = 0;
  let upperIndex = data.length - 1;

  for (let i = 0; i < data.length; i++) {
    const pointSecond = indexToSecond(data[i].x);
    if (pointSecond <= second) {
      lowerIndex = i;
    }
    if (pointSecond >= second && upperIndex === data.length - 1) {
      upperIndex = i;
      break;
    }
  }

  // Se encontramos o ponto exato
  if (lowerIndex === upperIndex) {
    return data[lowerIndex].y;
  }

  // Interpolação linear entre os dois pontos
  const lowerSecond = indexToSecond(data[lowerIndex].x);
  const upperSecond = indexToSecond(data[upperIndex].x);
  const lowerY = data[lowerIndex].y;
  const upperY = data[upperIndex].y;

  if (upperSecond === lowerSecond) return lowerY;

  const ratio = (second - lowerSecond) / (upperSecond - lowerSecond);
  return lowerY + (upperY - lowerY) * ratio;
};

export function RetentionChartOverlay({ videoPlayCurve, currentTime = 0, duration = 0, isPlaying = false, onTimeSeek, className = "" }: RetentionChartOverlayProps) {
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
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

  // Calcular o tempo máximo do gráfico (último ponto)
  const maxGraphTime = useMemo(() => {
    if (data.length === 0) return 60;
    return indexToSecond(data.length - 1);
  }, [data]);

  // Tempo máximo para usar (duração do vídeo ou tempo máximo do gráfico)
  const maxTime = duration > 0 ? Math.min(duration, maxGraphTime) : maxGraphTime;

  // Tempo máximo efetivo para cálculos (sempre usar duration quando disponível)
  const effectiveMaxTime = duration > 0 ? Math.min(duration, maxGraphTime) : maxTime;

  // Altura do overlay: ocupar toda a altura disponível, exceto a área dos controles
  const controlsHeight = 48; // Altura aproximada dos controles do vídeo HTML5
  // Margens: eixo Y fica à esquerda (fora), eixo X ocupa toda largura
  const axisYWidth = 32; // Largura do eixo Y (legenda lateral)
  const margin = { top: 4, right: 4, bottom: 20, left: 0 }; // Eixo X começa na borda esquerda

  const handleClick = (event: React.MouseEvent<SVGElement>) => {
    if (!onTimeSeek || !containerRef.current || !playerContainerRef.current) return;

    const playerRect = playerContainerRef.current.getBoundingClientRect();
    // Posição do clique relativa ao player (não ao overlay que inclui eixo Y)
    const x = event.clientX - playerRect.left - margin.left;
    const playerWidth = playerContainerRef.current.offsetWidth;
    const width = playerWidth - margin.left - margin.right;
    const percentage = Math.max(0, Math.min(1, x / width));

    // Converter porcentagem diretamente para segundo (linear)
    const targetSecond = percentage * effectiveMaxTime;

    onTimeSeek(targetSecond);
  };

  const handleMouseMove = (event: React.MouseEvent<SVGElement>) => {
    if (!containerRef.current || !playerContainerRef.current) return;

    const playerRect = playerContainerRef.current.getBoundingClientRect();
    // Posição do hover relativa ao player (não ao overlay que inclui eixo Y)
    const x = event.clientX - playerRect.left - margin.left;
    const playerWidth = playerContainerRef.current.offsetWidth;
    const width = playerWidth - margin.left - margin.right;
    const percentage = Math.max(0, Math.min(1, x / width));

    // Converter porcentagem diretamente para segundo (linear)
    const targetSecond = percentage * effectiveMaxTime;

    setHoverTime(targetSecond);
  };

  const handleMouseLeave = () => {
    setHoverTime(null);
  };

  // Usar useState para calcular escalas baseado no container width e height
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  // Atualizar largura e altura do container
  // O container do overlay tem largura maior (inclui eixo Y à esquerda)
  // Mas precisamos da largura do player (sem o eixo Y) para os cálculos
  const playerContainerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Encontrar o container do player (pai do overlay)
    if (containerRef.current?.parentElement) {
      playerContainerRef.current = containerRef.current.parentElement;
    }
  }, []);

  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current && playerContainerRef.current) {
        // Largura do player (sem o eixo Y)
        const playerWidth = playerContainerRef.current.offsetWidth;
        // Largura do container do overlay (player + eixo Y à esquerda)
        const overlayWidth = playerWidth + axisYWidth;
        setContainerWidth(overlayWidth);
        setContainerHeight(containerRef.current.offsetHeight);
      } else if (containerRef.current) {
        // Fallback: usar apenas o container do overlay
        setContainerWidth(containerRef.current.offsetWidth);
        setContainerHeight(containerRef.current.offsetHeight);
      }
    };

    // Atualizar inicialmente
    updateSize();

    // Usar ResizeObserver para detectar mudanças no tamanho
    if (containerRef.current) {
      const resizeObserver = new ResizeObserver(() => {
        updateSize();
      });
      resizeObserver.observe(containerRef.current);
      if (playerContainerRef.current) {
        resizeObserver.observe(playerContainerRef.current);
      }
      return () => resizeObserver.disconnect();
    }
  }, [axisYWidth]);

  // Calcular altura do overlay: toda a altura do container menos os controles
  const overlayHeight = containerHeight > 0 ? containerHeight - controlsHeight : 60;
  // Largura do player (sem o eixo Y à esquerda)
  const playerWidth = playerContainerRef.current?.offsetWidth || containerWidth - axisYWidth;
  // Largura do gráfico: toda a largura do player (eixo X ocupa toda largura do player)
  const w = Math.max(0, playerWidth - margin.left - margin.right);
  const h = overlayHeight - margin.top - margin.bottom;

  // Escala baseada nos índices (para os dados e eixos)
  // Se duration > 0, limitar o domínio aos índices que correspondem a segundos <= duration
  const maxIndex = useMemo(() => {
    if (duration > 0 && duration < maxGraphTime) {
      // Encontrar o maior índice cujo segundo correspondente seja <= duration
      for (let i = data.length - 1; i >= 0; i--) {
        const pointSecond = indexToSecond(i);
        if (pointSecond <= duration) {
          return i;
        }
      }
      return 0;
    }
    return Math.max(1, data.length - 1);
  }, [data, duration, maxGraphTime]);

  const xScale = scaleLinear<number>({
    domain: [0, maxIndex],
    range: [0, w],
  });

  // Escala linear de tempo (para o indicador de tempo atual)
  // Usar duration quando disponível, senão usar maxTime
  const timeScale = scaleLinear<number>({
    domain: [0, effectiveMaxTime],
    range: [0, w],
  });

  // Calcular posição X do indicador de tempo atual (linear, de 1 em 1 segundo)
  // Sempre mostrar quando currentTime e duration estiverem disponíveis
  const currentTimeX = duration > 0 && currentTime >= 0 && effectiveMaxTime > 0 && w > 0 ? timeScale(Math.min(currentTime, effectiveMaxTime)) : null;

  // Calcular posição X do hover (linear)
  const hoverTimeX = hoverTime != null && effectiveMaxTime > 0 && w > 0 ? timeScale(Math.min(hoverTime, effectiveMaxTime)) : null;

  const yMax = Math.max(100, Math.max(...data.map((d) => d.y)));
  const yScale = scaleLinear<number>({
    domain: [0, yMax],
    range: [h, 0],
  });

  // Calcular valor de retenção no tempo atual
  const currentRetention = currentTimeX != null && currentTime >= 0 ? getRetentionAtSecond(Math.min(currentTime, effectiveMaxTime), data) : null;

  // Calcular posição Y do tooltip (na curva do gráfico)
  const tooltipY = currentRetention != null ? yScale(currentRetention) : null;

  // Calcular valor de retenção no tempo do hover
  const hoverRetention = hoverTime != null && hoverTimeX != null ? getRetentionAtSecond(Math.min(hoverTime, effectiveMaxTime), data) : null;

  // Calcular posição Y do tooltip de hover (na curva do gráfico)
  const hoverTooltipY = hoverRetention != null ? yScale(hoverRetention) : null;

  // Labels específicos do eixo X conforme RetentionChart
  // Filtrar apenas pontos menores ou iguais à duração do vídeo
  // 0, 1, 2, 3, 6, 9, 12, 15, 20, 25, 30, 40, 50, 60+
  const desiredIndices = [0, 1, 2, 3, 6, 9, 12, 15, 16, 17, 18, 19, 20, 21];
  const xTickValues: number[] = [];
  for (const index of desiredIndices) {
    if (index < data.length) {
      const pointSecond = indexToSecond(index);
      // Se duration > 0, mostrar apenas pontos <= duration
      // Se duration === 0 ou não disponível, mostrar todos os pontos
      if (duration > 0) {
        if (pointSecond <= duration) {
          xTickValues.push(index);
        }
      } else {
        xTickValues.push(index);
      }
    }
  }

  // Linhas verticais do grid acompanhando os labels visíveis
  const xGridPoints = xTickValues;

  if (containerWidth === 0 || containerHeight === 0) {
    return (
      <div
        ref={containerRef}
        className={`absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity pointer-events-none ${className}`}
        style={{
          bottom: `${controlsHeight}px`,
          height: `calc(100% - ${controlsHeight}px)`,
        }}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className={`absolute transition-opacity pointer-events-none ${className}`}
      style={{
        top: 0,
        bottom: `${controlsHeight}px`, // Posicionado acima dos controles do vídeo HTML5
        left: `-${axisYWidth}px`, // Permite que o eixo Y ultrapasse a borda esquerda
        right: 0,
        height: `calc(100% - ${controlsHeight}px)`, // Ocupa toda a altura menos os controles
        width: `calc(100% + ${axisYWidth}px)`, // Largura total incluindo o eixo Y à esquerda
        zIndex: 10, // Acima do vídeo, mas abaixo dos controles
      }}
    >
      <style>{`
        .retention-chart-overlay-axis line {
          stroke: transparent !important;
          stroke-width: 0 !important;
        }
        .retention-chart-overlay-axis path {
          stroke: transparent !important;
          stroke-width: 0 !important;
        }
      `}</style>
      <svg width={containerWidth} height={overlayHeight} className="absolute inset-0 pointer-events-auto" onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} onClick={handleClick} style={{ cursor: onTimeSeek ? "pointer" : "default" }}>
        <LinearGradient id="overlayRetentionGradient" from="#1447e6" to="#1447e6" fromOpacity={0.6} toOpacity={0.2} />

        <g transform={`translate(${axisYWidth + margin.left},${margin.top})`}>
          {/* Grid lines - linhas de suporte pontilhadas */}
          <GridRows scale={yScale} tickValues={[20, 40, 60, 80, 100]} width={w} strokeDasharray="3 3" stroke={mutedForegroundColor} strokeOpacity={0.2} pointerEvents="none" />
          <GridColumns scale={xScale} height={h} tickValues={xGridPoints} strokeDasharray="3 3" stroke={mutedForegroundColor} strokeOpacity={0.2} pointerEvents="none" />

          {/* Área preenchida */}
          <AreaClosed data={data} x={(d) => xScale(d.x)} y={(d) => yScale(d.y)} yScale={yScale} curve={curveMonotoneX} fill="url(#overlayRetentionGradient)" stroke="none" />

          {/* Linha da curva */}
          <LinePath data={data} x={(d) => xScale(d.x)} y={(d) => yScale(d.y)} curve={curveMonotoneX} stroke="#1447e6" strokeWidth={1.5} fill="none" />

          {/* Linha vertical do tempo atual (linear, de 1 em 1 segundo) */}
          {currentTimeX != null && currentTime >= 0 && duration > 0 && (
            <g>
              <line x1={currentTimeX} x2={currentTimeX} y1={0} y2={h} stroke="#fbbf24" strokeWidth={2} strokeOpacity={0.9} />
              <circle cx={currentTimeX} cy={yScale(getRetentionAtSecond(Math.min(currentTime, effectiveMaxTime), data))} r={3} fill="#fbbf24" stroke="#fff" strokeWidth={1} />
            </g>
          )}

          {/* Linha vertical no hover (linear) */}
          {hoverTimeX != null && hoverTime !== currentTime && (
            <g>
              <line x1={hoverTimeX} x2={hoverTimeX} y1={0} y2={h} stroke="#93c5fd" strokeWidth={1} strokeOpacity={0.5} strokeDasharray="2 2" />
            </g>
          )}

          {/* Axis */}
          <g className="retention-chart-overlay-axis">
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
                fontSize: 10,
                textAnchor: "end",
                dy: "0.33em",
              })}
            />
            <AxisBottom
              top={h}
              scale={xScale}
              hideAxisLine={true}
              hideTicks={true}
              stroke="transparent"
              strokeWidth={0}
              tickStroke="transparent"
              tickValues={xTickValues}
              tickFormat={(v) => data[Math.round(Number(v))]?.label || ""}
              tickLabelProps={() => ({
                fill: mutedForegroundColor,
                fontSize: 10,
                textAnchor: "middle",
              })}
            />
          </g>
        </g>
      </svg>

      {/* Tooltip de retenção no hover */}
      {hoverTime != null && hoverTimeX != null && hoverRetention != null && hoverTooltipY != null && (
        <ChartTooltip
          title={`Tempo: ${hoverTime.toFixed(1)}s`}
          value={`Retenção: ${hoverRetention.toFixed(1)}%`}
          style={{
            left: `${axisYWidth + margin.left + hoverTimeX}px`,
            top: `${margin.top + hoverTooltipY}px`,
            transform: "translate(-50%, -100%)",
            marginTop: "-8px",
          }}
        />
      )}

      {/* Tooltip de retenção durante a reprodução */}
      {isPlaying && currentTimeX != null && tooltipY != null && currentRetention != null && duration > 0 && (
        <ChartTooltip
          title={`Tempo: ${currentTime.toFixed(1)}s`}
          value={`Retenção: ${currentRetention.toFixed(1)}%`}
          style={{
            left: `${axisYWidth + margin.left + currentTimeX}px`,
            top: `${margin.top + tooltipY}px`,
            transform: "translate(-50%, -100%)",
            marginTop: "-8px",
          }}
        />
      )}
    </div>
  );
}
