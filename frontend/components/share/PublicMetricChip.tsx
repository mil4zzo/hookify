"use client";

import { getMetricQualityToneByAverage, getMetricValueTextClass, type MetricQualityTone } from "@/lib/utils/metricQuality";
import { cn } from "@/lib/utils/cn";
import { METRIC_LABELS, formatShareDelta, formatShareMetric, isLowerBetter } from "@/lib/share/metricsDisplay";
import type { ShareMetricKey } from "@/lib/share/types";

/**
 * Borda tonal por qualidade. Classes estáticas de propósito: o JIT do Tailwind
 * lê o código-fonte, então `border-${tone}-40` nunca seria gerado.
 */
const CHIP_BORDER: Record<MetricQualityTone, string> = {
  destructive: "border-destructive-40",
  warning: "border-warning-40",
  attention: "border-attention-40",
  success: "border-success-40",
  primary: "border-primary-40",
  brand: "border-primary-40",
  muted: "border-border",
  accent: "border-border",
  "muted-foreground": "border-border",
};

interface PublicMetricChipProps {
  metricKey: ShareMetricKey;
  value: number;
  /** Média congelada do conjunto; ausente = chip neutro, sem cor nem delta. */
  average?: number | null;
  currency: string | null;
}

/**
 * Métrica em destaque no estado colapsado do viewer: pílula translúcida sobre
 * o degradê, em vez do card opaco. O fundo é o próprio background a 60% com
 * blur — a cor da qualidade vive na borda e no valor, para o criativo continuar
 * visível por trás. Versão completa (com contagens e seções) fica no painel
 * expandido, que segue usando o PublicMetricCell.
 */
export function PublicMetricChip({ metricKey, value, average, currency }: PublicMetricChipProps) {
  const canCompare = average != null && Number.isFinite(average) && average !== 0;
  const tone = canCompare ? getMetricQualityToneByAverage(value, average as number, isLowerBetter(metricKey)) : null;
  const delta = canCompare ? formatShareDelta(value, average) : null;

  return (
    <div className={cn("min-w-0 rounded-md border bg-background-60 px-2 py-1.5 backdrop-blur", tone ? CHIP_BORDER[tone] : "border-border")}>
      <div className="flex items-center justify-between gap-1.5 text-2xs text-muted-foreground">
        <span className="min-w-0 truncate">{METRIC_LABELS[metricKey]}</span>
        {delta ? <span className="shrink-0">{delta}</span> : null}
      </div>
      <div className="flex items-baseline gap-1.5 overflow-hidden">
        <span className={cn("shrink-0 text-sm font-semibold leading-tight", tone && getMetricValueTextClass(tone))}>
          {formatShareMetric(metricKey, value, currency)}
        </span>
        {canCompare ? (
          <span className="truncate text-2xs text-muted-foreground">vs. {formatShareMetric(metricKey, average as number, currency)}</span>
        ) : null}
      </div>
    </div>
  );
}
