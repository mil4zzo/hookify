"use client";

import React from "react";

interface ChartTooltipProps {
  title?: string;
  value: string | number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Componente de tooltip reutilizável para gráficos
 * Baseado no estilo usado no SparklineBars
 */
export function ChartTooltip({ title, value, className = "", style }: ChartTooltipProps) {
  return (
    <div
      className={`absolute px-2 py-1 bg-gray-800 text-white text-xs rounded shadow-lg whitespace-nowrap z-20 pointer-events-none ${className}`}
      style={style}
    >
      {title && <div className="font-medium mb-0.5">{title}</div>}
      <div>{value}</div>
    </div>
  );
}

