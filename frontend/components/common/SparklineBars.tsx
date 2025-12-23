"use client";

import React, { useState } from "react";

// Helpers para cores dinâmicas por tendência
function getSeriesTrendPct(series: Array<number | null | undefined>): number {
  const vals = series.filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
  if (vals.length < 2) return 0;
  const first = vals[0];
  const last = vals[vals.length - 1];
  const denom = Math.max(Math.abs(first), 1e-9);
  return (last - first) / denom;
}

function colorByTrend(pct: number, inverse: boolean = false): string {
  if (inverse) {
    // Invertido: subir é ruim (vermelho), descer é bom (verde)
    if (pct >= 0.15) return "bg-danger-70"; // strong up = ruim
    if (pct >= 0.05) return "bg-warning-70"; // mild up = ruim
    if (pct <= -0.15) return "bg-brand-70"; // strong down = bom
    if (pct <= -0.05) return "bg-brand-60"; // mild down = bom
    return "bg-muted"; // flat
  }
  // Normal: subir é bom (verde), descer é ruim (vermelho)
  if (pct >= 0.15) return "bg-brand-70"; // strong up
  if (pct >= 0.05) return "bg-brand-60"; // mild up
  if (pct <= -0.15) return "bg-danger-70"; // strong down
  if (pct <= -0.05) return "bg-warning-70"; // mild down
  return "bg-muted"; // flat
}

function perBarColor(curr: number | null | undefined, prev: number | null | undefined, inverse: boolean = false): string {
  if (curr == null || Number.isNaN(curr as number) || prev == null || Number.isNaN(prev as number)) {
    return "bg-muted-20";
  }
  const c = Number(curr);
  const p = Number(prev);
  
  if (inverse) {
    // Invertido: aumentar é ruim, diminuir é bom
    if (c > p) return "bg-danger-70"; // aumentou = ruim
    if (c < p) return "bg-brand-60"; // diminuiu = bom
    return "bg-muted-30";
  }
  // Normal: aumentar é bom, diminuir é ruim
  if (c > p) return "bg-brand-60";
  if (c < p) return "bg-danger-70";
  return "bg-muted-30";
}

// Gradiente contínuo por valor normalizado: 0 -> vermelho, 0.5 -> laranja, 1 -> verde
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  const bigint = parseInt(clean, 16);
  return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
}

function rgbToHex({ r, g, b }: { r: number; g: number; b: number }): string {
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function interpolateColor(startHex: string, endHex: string, t: number): string {
  const s = hexToRgb(startHex);
  const e = hexToRgb(endHex);
  return rgbToHex({ r: lerp(s.r, e.r, t), g: lerp(s.g, e.g, t), b: lerp(s.b, e.b, t) });
}

function getInterpolatedBarColor(norm01: number, inverse: boolean = false): string {
  const t = Math.max(0, Math.min(1, norm01));
  const RED = "#EF4444"; // danger em tailwind.config
  const ORANGE = "#F59E0B"; // warning em tailwind.config
  const GREEN = "#2E7D32"; // brand DEFAULT em tailwind.config
  
  if (inverse) {
    // Invertido: valores maiores (próximos de 1) = vermelho, menores (próximos de 0) = verde
    const invertedT = 1 - t;
    if (invertedT <= 0.5) {
      const localT = invertedT / 0.5;
      return interpolateColor(RED, ORANGE, localT);
    }
    const localT = (invertedT - 0.5) / 0.5;
    return interpolateColor(ORANGE, GREEN, localT);
  }
  
  // Normal: valores maiores = verde, menores = vermelho
  if (t <= 0.5) {
    const localT = t / 0.5; // 0..0.5
    return interpolateColor(RED, ORANGE, localT);
  }
  const localT = (t - 0.5) / 0.5; // 0.5..1
  return interpolateColor(ORANGE, GREEN, localT);
}

// Converte classes Tailwind para cores hexadecimais
function getHexColorFromClass(colorClass: string): string {
  // Mapeamento de classes Tailwind para cores hexadecimais
  if (colorClass.includes("brand")) {
    if (colorClass.includes("-70")) return "#62C254"; // brand com opacidade
    if (colorClass.includes("-60")) return "#62C254"; // brand com opacidade
    return "#62C254"; // brand DEFAULT
  }
  if (colorClass.includes("danger")) {
    if (colorClass.includes("-70")) return "#E26F62";
    return "#E26F62"; // danger
  }
  if (colorClass.includes("warning")) {
    if (colorClass.includes("-70")) return "#F3BC4F";
    return "#F3BC4F"; // warning
  }
  if (colorClass.includes("muted")) {
    if (colorClass.includes("/30")) return "#171717"; // muted aproximado
    if (colorClass.includes("/20")) return "#262626"; // muted aproximado
    return "#6B7280"; // muted padrão
  }
  return "#2E7D32"; // fallback
}

// Cria um gradiente vertical com opacidade (80% topo, 0% fundo)
function getGradientStyle(baseColor: string): string {
  const rgb = hexToRgb(baseColor);
  return `linear-gradient(to bottom, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.6), rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.2))`;
}

export type SparklineSize = "small" | "medium" | "large";

const sizePresets: Record<SparklineSize, string> = {
  small: "w-16 h-6",    // Tabela (RankingsTable)
  medium: "w-24 h-6",   // Cards overview (AdDetailsDialog)
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
};

export const SparklineBars = React.memo(function SparklineBars({ series, className, size = "medium", barWidth = 2, gap = 2, colorClass = "bg-brand-70", nullClass = "bg-muted-20", minBarHeightPct = 6, validMinBarHeightPct = 12, valueFormatter, dynamicColor = true, colorMode = "series", inverseColors = false }: SparklineBarsProps) {
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
        let heightPct = 0;
        if (isNull) {
          heightPct = minBarHeightPct; // nulos visíveis, porém baixos
        } else if (max <= 1e-9) {
          // toda a série é 0 → barras válidas (verdes) com altura mínima igual às nulas
          heightPct = minBarHeightPct;
        } else {
          heightPct = (Number(v) / max) * 100; // normalização por máximo
          heightPct = Math.max(validMinBarHeightPct, heightPct);
        }
        const barColor = isNull ? nullClass : dynamicColor && colorMode === "per-bar" ? getInterpolatedBarColor(max > 1e-9 ? Math.max(0, Math.min(1, Number(v) / max)) : 0, inverseColors) : seriesColor;

        // Obter cor hexadecimal base para o gradiente
        const baseHexColor = isNull ? getHexColorFromClass(nullClass) : colorMode === "per-bar" && !isNull ? (barColor as string) : getHexColorFromClass(barColor as string);

        const gradientStyle = getGradientStyle(baseHexColor);
        const rgb = hexToRgb(baseHexColor);

        return (
          <div key={i} className="rounded-xs flex-1 relative cursor-pointer" style={{ height: `${heightPct}%` }} onMouseEnter={() => setHoveredIndex(i)} onMouseLeave={() => setHoveredIndex(null)}>
            <div
              className="w-full h-full rounded-xs"
              style={{
                background: gradientStyle,
                borderTop: `2px solid rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 1)`,
              }}
            />
            {hoveredIndex === i && <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-1 px-2 py-1 bg-gray-800 text-white text-xs rounded shadow-lg whitespace-nowrap z-20">{isNull ? "Sem dados" : valueFormatter ? valueFormatter(Number(v)) : `${Number(v).toFixed(2)}`}</div>}
          </div>
        );
      })}
    </div>
  );
});

SparklineBars.displayName = "SparklineBars";
