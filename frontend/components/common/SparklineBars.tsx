"use client";

import React, { useState } from "react";

// Helpers para cores dinâmicas por tendência
// Calcula a tendência usando regressão linear simples (mínimos quadrados)
// Isso captura melhor a tendência geral mesmo quando há variações no meio da série
function getSeriesTrendPct(series: Array<number | null | undefined>): number {
  const vals = series.filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
  if (vals.length < 2) return 0;

  const n = vals.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  // Calcular somas para regressão linear
  for (let i = 0; i < n; i++) {
    const x = i; // posição no tempo (0, 1, 2, ...)
    const y = vals[i];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  }

  // Calcular inclinação (slope) da linha de tendência
  // slope = (n*ΣXY - ΣX*ΣY) / (n*ΣX² - (ΣX)²)
  const denominator = n * sumX2 - sumX * sumX;
  if (Math.abs(denominator) < 1e-9) return 0; // Evitar divisão por zero

  const slope = (n * sumXY - sumX * sumY) / denominator;

  // Calcular valor médio para normalização
  const meanY = sumY / n;
  const denom = Math.max(Math.abs(meanY), 1e-9);

  // Retornar variação percentual baseada na inclinação
  // Multiplicar pela duração da série para obter variação total projetada
  return (slope * (n - 1)) / denom;
}

function colorByTrend(pct: number, inverse: boolean = false): string {
  if (inverse) {
    // Invertido: subir é ruim (vermelho), descer é bom (verde)
    if (pct >= 0.2) return "danger"; // strong up = ruim
    if (pct >= 0.05) return "warning"; // mild up = ruim
    if (pct <= -0.2) return "success"; // strong down = bom
    if (pct <= -0.05) return "success"; // mild down = bom
    return "accent"; // flat = neutro
  }
  // Normal: subir é bom (verde), descer é ruim (vermelho)
  if (pct >= 0.2) return "success"; // strong up = bom
  if (pct >= 0.05) return "success"; // mild up = bom
  if (pct <= -0.2) return "danger"; // strong down = ruim
  if (pct <= -0.05) return "warning"; // mild down = ruim
  return "accent"; // flat = neutro
}

// Mapeamento de classes de cor base para gradientes (sem redundâncias)
// Usa variantes com hífen conforme definido no tailwind.config.ts
const baseGradientMap: Record<string, string> = {
  danger: "bg-gradient-to-b from-danger-50 to-danger-20",
  warning: "bg-gradient-to-b from-warning-50 to-warning-20",
  attention: "bg-gradient-to-b from-attention-50 to-attention-20",
  success: "bg-gradient-to-b from-success-50 to-success-20",
  primary: "bg-gradient-to-b from-primary-50 to-primary-20",
  brand: "bg-gradient-to-b from-brand-50 to-brand-20",
  muted: "bg-gradient-to-b from-muted-50 to-muted-20",
  accent: "bg-gradient-to-b from-ring-50 to-ring-20",
  "muted-foreground": "bg-gradient-to-b from-muted-50 to-muted-20", // muted-foreground não tem variantes, usa muted
};

// Mapeamento de classes de cor base para bordas (sem redundâncias)
const baseBorderMap: Record<string, string> = {
  danger: "border-t-danger",
  warning: "border-t-warning",
  attention: "border-t-attention",
  success: "border-t-success",
  primary: "border-t-primary",
  brand: "border-t-brand",
  muted: "border-t-muted",
  accent: "border-t-ring",
  "muted-foreground": "border-t-muted-foreground",
};

// Mapeamento de classes de cor base para texto (para tooltips)
// Usa variantes mais claras (70-80) para melhor contraste em fundos escuros (bg-gray-800)
const baseTextMap: Record<string, string> = {
  danger: "text-danger-70",
  warning: "text-warning-70",
  attention: "text-attention-70",
  success: "text-success-70",
  primary: "text-primary-70",
  brand: "text-brand-70",
  muted: "text-muted-foreground",
  accent: "text-accent-foreground",
  "muted-foreground": "text-muted-foreground",
};

// Extrai a cor base de uma classe Tailwind (remove prefixo bg- e sufixos numéricos)
function extractBaseColor(colorClass: string): string {
  // Remove prefixo "bg-"
  let base = colorClass.replace(/^bg-/, "");
  // Remove sufixos numéricos como -70, -60, -500, -20, -30, etc.
  base = base.replace(/-\d+$/, "");
  return base;
}

// Converte classe Tailwind de cor ou chave do mapeamento para classe de gradiente com opacidade
function getGradientClass(colorClassOrKey: string): string {
  // Se já é uma chave do mapeamento (não começa com "bg-"), usar diretamente
  if (!colorClassOrKey.startsWith("bg-")) {
    return baseGradientMap[colorClassOrKey] || "bg-gradient-to-b from-muted-50 to-muted-20";
  }
  // Caso contrário, extrair a chave (para compatibilidade com nullClass e seriesColor)
  const baseColor = extractBaseColor(colorClassOrKey);
  return baseGradientMap[baseColor] || "bg-gradient-to-b from-muted-50 to-muted-20";
}

// Converte classe Tailwind de cor ou chave do mapeamento para classe de borda
function getBorderClass(colorClassOrKey: string): string {
  // Se já é uma chave do mapeamento (não começa com "bg-"), usar diretamente
  if (!colorClassOrKey.startsWith("bg-")) {
    return baseBorderMap[colorClassOrKey] || "border-t-muted-foreground";
  }
  // Caso contrário, extrair a chave (para compatibilidade com nullClass e seriesColor)
  const baseColor = extractBaseColor(colorClassOrKey);
  return baseBorderMap[baseColor] || "border-t-muted-foreground";
}

// Converte classe Tailwind de cor ou chave do mapeamento para classe de texto
function getTextClass(colorClassOrKey: string): string {
  // Se já é uma chave do mapeamento (não começa com "bg-"), usar diretamente
  if (!colorClassOrKey.startsWith("bg-")) {
    return baseTextMap[colorClassOrKey] || "text-white";
  }
  // Caso contrário, extrair a chave (para compatibilidade com nullClass e seriesColor)
  const baseColor = extractBaseColor(colorClassOrKey);
  return baseTextMap[baseColor] || "text-white";
}

// Retorna chave do mapeamento baseada na normalização pelo máximo da série
// Usa escala de 5 cores fixas: danger (vermelho) → warning (laranja) → attention (amarelo) → success (verde) → primary (azul)
function getColorClassByNormalized(norm01: number, inverse: boolean = false): string {
  const t = Math.max(0, Math.min(1, norm01));

  if (inverse) {
    // Invertido: valores maiores (próximos de 1) = vermelho, menores (próximos de 0) = azul
    const invertedT = 1 - t;
    if (invertedT <= 0.2) return "danger";
    if (invertedT <= 0.4) return "warning";
    if (invertedT <= 0.6) return "attention";
    if (invertedT <= 0.8) return "success";
    return "primary";
  }

  // Normal: valores maiores = azul, menores = vermelho
  if (t <= 0.2) return "danger";
  if (t <= 0.4) return "warning";
  if (t <= 0.6) return "attention";
  if (t <= 0.8) return "success";
  return "primary";
}

// Retorna chave do mapeamento baseada na comparação com a média do pack
// Usa escala de 5 cores: danger (vermelho) → warning (laranja) → attention (amarelo) → success (verde) → primary (azul)
function getColorClassByPackAverage(value: number, packAverage: number, inverse: boolean = false): string {
  if (packAverage <= 0 || !Number.isFinite(packAverage)) {
    // Se a média não é válida, usar cor neutra
    return "muted-foreground";
  }

  // Calcular diferença percentual em relação à média
  // Ex: se valor = 1.5 e média = 1.0, então ratio = 1.5 (50% acima)
  const ratio = value / packAverage;

  if (inverse) {
    // Invertido: valores acima da média = ruim (vermelho), abaixo = bom (azul)
    // Para métricas onde menor é melhor (CPR, CPM, CPMQL)
    if (ratio >= 1.5) return "danger"; // muito acima = muito ruim
    if (ratio >= 1.1) return "warning"; // acima = ruim
    if (ratio >= 0.9) return "attention"; // próximo = neutro
    if (ratio >= 0.6) return "success"; // abaixo = bom
    return "primary"; // muito abaixo = muito bom
  }

  // Normal: valores acima da média = bom (azul), abaixo = ruim (vermelho)
  // Para métricas onde maior é melhor (Hook, CTR, etc.)
  if (ratio <= 0.6) return "danger"; // bem pior que a média
  if (ratio <= 0.85) return "warning"; // pior que a média
  if (ratio <= 1.1) return "attention"; // próximo da média
  if (ratio <= 1.5) return "success"; // acima da média
  return "primary"; // muito acima da média
}

export type SparklineSize = "small" | "medium" | "large";

const sizePresets: Record<SparklineSize, string> = {
  small: "w-16 h-6", // Tabela (RankingsTable)
  medium: "w-24 h-6", // Cards overview (AdDetailsDialog)
  large: "w-full h-16", // Aba Series (AdDetailsDialog)
};

type SparklineBarsProps = {
  series: Array<number | null | undefined>;
  className?: string;
  size?: SparklineSize; // Tamanho predefinido (small, medium, large)
  barWidth?: number;
  gap?: number;
  colorClass?: string;
  nullClass?: string;
  minBarHeightPct?: number; // altura mínima para barras nulas
  validMinBarHeightPct?: number; // altura mínima para barras com valor
  valueFormatter?: (v: number) => string; // formatação customizável do tooltip
  // novos
  dynamicColor?: boolean; // ativa cor por tendência da série ou por barra
  colorMode?: "series" | "per-bar"; // aplica por série inteira ou por barra
  inverseColors?: boolean; // Se true, inverte a lógica de cores (menor é melhor, ex: CPR, CPM)
  packAverage?: number | null; // Média do pack para comparação (quando fornecido, usa comparação com média em vez de normalização por máximo)
  dataAvailability?: Array<boolean>; // Indica se há dados base (spend/impressions) para cada ponto da série
  zeroValueLabel?: string; // Label customizado para valores zero quando há dados mas valor é zero/null (ex: "Sem MQLs", "Sem leads")
  zeroValueColorClass?: string; // Classe de cor para valores zero quando há dados (padrão: "danger")
  dates?: Array<string>; // Array de datas correspondentes a cada ponto da série (formato YYYY-MM-DD)
};

export const SparklineBars = React.memo(function SparklineBars({ series, className, size = "medium", barWidth = 2, gap = 2, colorClass = "bg-brand-70", nullClass = "bg-muted-20", minBarHeightPct = 6, validMinBarHeightPct = 12, valueFormatter, dynamicColor = true, colorMode = "series", inverseColors = false, packAverage = null, dataAvailability, zeroValueLabel, zeroValueColorClass = "danger", dates }: SparklineBarsProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const values = series.filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
  const max = values.length ? Math.max(...values) : 0;
  const seriesColor = dynamicColor && colorMode === "series" ? colorByTrend(getSeriesTrendPct(series), inverseColors) : colorClass;

  // Usar className customizado se fornecido, senão usar preset baseado no size
  const finalClassName = className || sizePresets[size];

  return (
    <div className={`flex items-end justify-between ${finalClassName}`} style={{ gap: `${gap}px` }}>
      {series.map((v, i) => {
        const isNull = v == null || Number.isNaN(v as number);
        const hasData = dataAvailability?.[i] ?? (v != null && !Number.isNaN(v as number));
        const isZeroWithData = hasData && (isNull || v === 0);

        let heightPct = 0;
        if (isNull && !hasData) {
          // Sem dados base → altura mínima (muted)
          heightPct = minBarHeightPct;
        } else if (isZeroWithData) {
          // Há dados mas valor é zero → altura mínima (danger)
          heightPct = minBarHeightPct;
        } else if (isNull) {
          // Fallback: nulo sem informação de disponibilidade
          heightPct = minBarHeightPct;
        } else if (max <= 1e-9) {
          // toda a série é 0 → barras válidas com altura mínima
          heightPct = minBarHeightPct;
        } else {
          heightPct = (Number(v) / max) * 100; // normalização por máximo
          heightPct = Math.max(validMinBarHeightPct, heightPct);
        }

        // Determinar cor da barra (sempre retorna classe Tailwind)
        let barColor: string;
        if (isNull && !hasData) {
          // Sem dados base (não existe ad_metric) → usar nullClass (muted)
          barColor = nullClass;
        } else if (isZeroWithData) {
          // Há dados base mas valor é zero/null → usar zeroValueColorClass (danger por padrão)
          barColor = zeroValueColorClass;
        } else if (packAverage != null && Number.isFinite(packAverage)) {
          // Se packAverage fornecida, usar comparação com média do pack
          barColor = getColorClassByPackAverage(Number(v), packAverage, inverseColors);
        } else if (dynamicColor && colorMode === "per-bar") {
          // Normalização pelo máximo da série
          barColor = getColorClassByNormalized(max > 1e-9 ? Math.max(0, Math.min(1, Number(v) / max)) : 0, inverseColors);
        } else {
          barColor = seriesColor;
        }

        // Obter classes Tailwind para gradiente e borda
        const gradientClass = getGradientClass(barColor);
        const borderClass = getBorderClass(barColor);
        // Obter classe de texto para o tooltip baseada na cor da barra
        // Aplicar cor quando:
        // 1. Há valor válido e packAverage (comparação com média)
        // 2. Há valor válido e modo per-bar (normalização por máximo)
        // 3. Há dados mas valor é zero/null (isZeroWithData) - usa zeroValueColorClass
        const shouldColorText =
          isZeroWithData || // Caso especial: "Sem leads", "Sem MQLs", etc.
          (!isNull && hasData && ((packAverage != null && Number.isFinite(packAverage)) || (dynamicColor && colorMode === "per-bar")));
        const textClass = shouldColorText ? getTextClass(barColor) : "text-white";

        return (
          <div key={i} className="rounded-xs flex-1 relative cursor-pointer" style={{ height: `${heightPct}%` }} onMouseEnter={() => setHoveredIndex(i)} onMouseLeave={() => setHoveredIndex(null)}>
            <div className={`w-full h-full rounded-xs ${gradientClass} ${borderClass} border-t-2`} />
            {hoveredIndex === i && (
              <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-1 px-2 py-1 bg-gray-800 text-xs rounded shadow-lg z-20">
                {(() => {
                  // Verificar se há dados base (spend/impressions) para este ponto
                  const hasData = dataAvailability?.[i] ?? (v != null && !Number.isNaN(v as number));

                  // Formatar data se disponível
                  const formatDate = (dateStr: string): string => {
                    try {
                      const [year, month, day] = dateStr.split("-");
                      return `${day}/${month}/${year}`;
                    } catch {
                      return dateStr;
                    }
                  };

                  let dateDisplay: string | null = null;
                  if (dates && dates[i]) {
                    dateDisplay = formatDate(dates[i]);
                  }

                  let valueDisplay: string;
                  if (!hasData) {
                    // Não há dados base (não existe ad_metric para este dia)
                    valueDisplay = "Sem dados";
                  } else if (isNull || (v === 0 && hasData)) {
                    // Há dados base mas o valor é null ou zero (ex: há spend mas não há MQLs)
                    valueDisplay = zeroValueLabel || (valueFormatter ? valueFormatter(0) : "0");
                  } else {
                    // Valor válido
                    valueDisplay = valueFormatter ? valueFormatter(Number(v)) : `${Number(v).toFixed(2)}`;
                  }

                  return (
                    <div className="flex flex-col items-center">
                      {dateDisplay && <div className="text-[10px] text-gray-300 mb-0.5 whitespace-nowrap">{dateDisplay}</div>}
                      <div className={`whitespace-nowrap ${textClass}`}>{valueDisplay}</div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});

SparklineBars.displayName = "SparklineBars";
