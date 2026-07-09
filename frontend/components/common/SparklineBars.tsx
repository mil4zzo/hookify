"use client";

import React from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  type MetricQualityTone,
  getMetricQualityToneByAverage,
  getMetricQualityToneByNormalized,
  getMetricSeriesTrendPct,
  getMetricSparklineBorderClass,
  getMetricSparklineGradientClass,
  getMetricSparklineTextClass,
  getMetricTrendTone,
} from "@/lib/utils/metricQuality";

function colorByTrend(pct: number, inverse: boolean = false): MetricQualityTone {
  return getMetricTrendTone(pct, inverse);
}

function getGradientClass(colorTone: MetricQualityTone): string {
  return getMetricSparklineGradientClass(colorTone);
}

function getBorderClass(colorTone: MetricQualityTone): string {
  return getMetricSparklineBorderClass(colorTone);
}

function getTextClass(colorTone: MetricQualityTone): string {
  return getMetricSparklineTextClass(colorTone);
}

function getColorClassByNormalized(norm01: number, inverse: boolean = false): MetricQualityTone {
  return getMetricQualityToneByNormalized(norm01, inverse);
}

function getColorClassByPackAverage(value: number, packAverage: number, inverse: boolean = false): MetricQualityTone {
  return getMetricQualityToneByAverage(value, packAverage, inverse);
}

export type SparklineSize = "small" | "medium" | "large";

const sizePresets: Record<SparklineSize, string> = {
    small: "w-16 h-6", // Tabela (ManagerTable)
  medium: "w-24 h-6", // Cards overview (AdDetailsDialog)
  large: "w-full h-16", // Aba Series (AdDetailsDialog)
};

type SparklineBarsProps = {
  series: Array<number | null | undefined>;
  className?: string;
  size?: SparklineSize; // Tamanho predefinido (small, medium, large)
  barWidth?: number;
  gap?: number;
  colorClass?: MetricQualityTone;
  nullClass?: MetricQualityTone;
  minBarHeightPct?: number; // altura mÃ­nima para barras nulas
  validMinBarHeightPct?: number; // altura mÃ­nima para barras com valor
  valueFormatter?: (v: number) => string; // formataÃ§Ã£o customizÃ¡vel do tooltip
  // novos
  dynamicColor?: boolean; // ativa cor por tendÃªncia da sÃ©rie ou por barra
  colorMode?: "series" | "per-bar"; // aplica por sÃ©rie inteira ou por barra
  inverseColors?: boolean; // Se true, inverte a lÃ³gica de cores (menor Ã© melhor, ex: CPR, CPM)
  packAverage?: number | null; // MÃ©dia do pack para comparaÃ§Ã£o (quando fornecido, usa comparaÃ§Ã£o com mÃ©dia em vez de normalizaÃ§Ã£o por mÃ¡ximo)
  dataAvailability?: Array<boolean>; // Indica se hÃ¡ dados base (spend/impressions) para cada ponto da sÃ©rie
  zeroValueLabel?: string; // Label customizado para valores zero quando hÃ¡ dados mas valor Ã© zero/null (ex: "Sem MQLs", "Sem leads")
  zeroValueColorClass?: MetricQualityTone; // Classe de cor para valores zero quando hÃ¡ dados (padrÃ£o: "destructive")
  dates?: Array<string>; // Array de datas correspondentes a cada ponto da sÃ©rie (formato YYYY-MM-DD)
  lightweight?: boolean; // Quando true, usa title nativo em vez de Radix Tooltip (performance: elimina ~1250 componentes na ManagerTable)
  staggeredFadeIn?: boolean; // fade in sequencial por barra
  fadeInDurationMs?: number; // duraÃ§Ã£o do fade in por barra
  fadeInStaggerMs?: number; // atraso entre barras
  fadeInStartDelayMs?: number; // atraso inicial antes da primeira barra
  // Hover interativo (usado na ManagerTable no lugar do tooltip nativo):
  hoveredIndex?: number | null; // índice da barra destacada; as demais recebem opacidade baixa
  onBarHover?: (index: number) => void; // dispara ao entrar numa barra (habilita modo interativo, remove o title nativo)
  onBarLeave?: () => void; // dispara ao sair do sparkline
};

/** Formata YYYY-MM-DD como DD/MM/YYYY. Exportado para reuso (ex: legenda de data no MetricCell). */
export function formatSparklineDate(dateStr: string): string {
  try {
    const [year, month, day] = dateStr.split("-");
    return `${day}/${month}/${year}`;
  } catch {
    return dateStr;
  }
}

/**
 * Formata o valor exibido de uma barra do sparkline, respeitando "Sem dados" e o
 * label de zero. Exportado para que o MetricCell mostre o mesmo texto abaixo do
 * sparkline quando um dia está em hover (fonte única de formatação).
 */
export function getSparklineBarValueDisplay(params: {
  value: number | null | undefined;
  hasData: boolean;
  valueFormatter?: (v: number) => string;
  zeroValueLabel?: string;
}): string {
  const { value, hasData, valueFormatter, zeroValueLabel } = params;
  if (!hasData) return "Sem dados";
  const isNull = value == null || Number.isNaN(value as number);
  if (isNull || value === 0) return zeroValueLabel || (valueFormatter ? valueFormatter(0) : "0");
  return valueFormatter ? valueFormatter(Number(value)) : `${Number(value).toFixed(2)}`;
}

export const SparklineBars = React.memo(function SparklineBars({
  series,
  className,
  size = "medium",
  barWidth = 2,
  gap = 2,
  colorClass = "brand",
  nullClass = "muted",
  minBarHeightPct = 6,
  validMinBarHeightPct = 12,
  valueFormatter,
  dynamicColor = true,
  colorMode = "series",
  inverseColors = false,
  packAverage = null,
  dataAvailability,
  zeroValueLabel,
  zeroValueColorClass = "destructive",
  dates,
  lightweight = false,
  staggeredFadeIn = false,
  fadeInDurationMs = 500,
  fadeInStaggerMs = 250,
  fadeInStartDelayMs = 0,
  hoveredIndex = null,
  onBarHover,
  onBarLeave,
}: SparklineBarsProps) {
  const values = series.filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
  const max = values.length ? Math.max(...values) : 0;
  const seriesColor = dynamicColor && colorMode === "series" ? colorByTrend(getMetricSeriesTrendPct(series), inverseColors) : colorClass;

  // Usar className customizado se fornecido, senÃ£o usar preset baseado no size
  const finalClassName = className || sizePresets[size];

  const getRevealStyle = (index: number): React.CSSProperties | undefined => {
    if (!staggeredFadeIn) return undefined;
    return {
      ["--sparkline-fade-in-duration" as any]: `${fadeInDurationMs}ms`,
      ["--sparkline-fade-in-delay" as any]: `${fadeInStartDelayMs + index * fadeInStaggerMs}ms`,
    };
  };

  // Pre-compute bar data for all items (shared between lightweight and full modes)
  const bars = series.map((v, i) => {
    const isNull = v == null || Number.isNaN(v as number);
    const hasExplicitAvailability = Array.isArray(dataAvailability) && i < dataAvailability.length;
    const hasData = hasExplicitAvailability ? dataAvailability[i] === true : v != null && !Number.isNaN(v as number);
    const isZeroWithData = hasData && (isNull || v === 0);

    let heightPct = 0;
    if (isNull && !hasData) {
      heightPct = minBarHeightPct;
    } else if (isZeroWithData) {
      heightPct = minBarHeightPct;
    } else if (isNull) {
      heightPct = minBarHeightPct;
    } else if (max <= 1e-9) {
      heightPct = minBarHeightPct;
    } else {
      heightPct = (Number(v) / max) * 100;
      heightPct = Math.max(validMinBarHeightPct, heightPct);
    }

    let barColor: MetricQualityTone;
    if (!hasData) {
      barColor = nullClass;
    } else if (isZeroWithData) {
      barColor = zeroValueColorClass;
    } else if (packAverage != null && Number.isFinite(packAverage)) {
      barColor = getColorClassByPackAverage(Number(v), packAverage, inverseColors);
    } else if (dynamicColor && colorMode === "per-bar") {
      barColor = getColorClassByNormalized(max > 1e-9 ? Math.max(0, Math.min(1, Number(v) / max)) : 0, inverseColors);
    } else {
      barColor = seriesColor;
    }

    const gradientClass = getGradientClass(barColor);
    const borderClass = getBorderClass(barColor);

    const dateDisplay = dates && dates[i] ? formatSparklineDate(dates[i]) : null;
    const valueDisplay = getSparklineBarValueDisplay({ value: v, hasData, valueFormatter, zeroValueLabel });

    const titleText = dateDisplay ? `${dateDisplay}: ${valueDisplay}` : valueDisplay;

    return { heightPct, gradientClass, borderClass, barColor, isNull, hasData, isZeroWithData, dateDisplay, valueDisplay, titleText };
  });

  // Lightweight mode: native title attributes (no Radix Tooltip overhead)
  if (lightweight) {
    // Modo interativo: hover troca o title nativo por destaque (fade nas demais barras)
    // e notifica o pai (que sincroniza o dia entre as colunas da linha).
    const interactive = Boolean(onBarHover);
    return (
      <div
        className={`flex items-end justify-between ${finalClassName}`}
        style={{ gap: `${gap}px` }}
        onMouseLeave={onBarLeave}
      >
        {bars.map((bar, i) => {
          const dimmed = hoveredIndex != null && i !== hoveredIndex;
          return (
            <div
              key={i}
              className={`rounded-xs flex-1 relative ${staggeredFadeIn ? "sparkline-fade-in-bar" : "transition-opacity duration-150"}`}
              style={{ height: `${bar.heightPct}%`, ...(staggeredFadeIn ? {} : { opacity: dimmed ? 0.25 : 1 }), ...getRevealStyle(i) }}
              title={interactive ? undefined : bar.titleText}
              onMouseEnter={onBarHover ? () => onBarHover(i) : undefined}
            >
              <div className={`w-full h-full rounded-xs ${bar.gradientClass} ${bar.borderClass} border-t-2`} />
            </div>
          );
        })}
      </div>
    );
  }

  // Full mode: Radix Tooltips with rich formatting
  return (
    <TooltipProvider delayDuration={200}>
      <div className={`flex items-end justify-between ${finalClassName}`} style={{ gap: `${gap}px` }}>
        {bars.map((bar, i) => {
          const shouldColorText =
            !bar.hasData ||
            bar.isZeroWithData ||
            (!bar.isNull && bar.hasData && ((packAverage != null && Number.isFinite(packAverage)) || (dynamicColor && colorMode === "per-bar")));
          const textClass = shouldColorText ? getTextClass(bar.barColor) : "text-foreground";

          return (
            <Tooltip key={i}>
              <TooltipTrigger asChild>
                <div
                  className={`rounded-xs flex-1 relative cursor-pointer ${staggeredFadeIn ? "sparkline-fade-in-bar" : "transition-opacity duration-150"}`}
                  style={{ height: `${bar.heightPct}%`, ...(staggeredFadeIn ? {} : { opacity: hoveredIndex != null && i !== hoveredIndex ? 0.25 : 1 }), ...getRevealStyle(i) }}
                >
                  <div className={`w-full h-full rounded-xs ${bar.gradientClass} ${bar.borderClass} border-t-2`} />
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                <div className="flex flex-col items-center">
                  {bar.dateDisplay && <div className="text-[10px] text-muted-foreground mb-0.5 whitespace-nowrap">{bar.dateDisplay}</div>}
                  <div className={`whitespace-nowrap ${textClass}`}>{bar.valueDisplay}</div>
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
});

SparklineBars.displayName = "SparklineBars";
