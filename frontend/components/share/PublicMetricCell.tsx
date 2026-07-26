"use client";

import { getMetricCardSurfaceClass, getMetricQualityToneByAverage, getMetricValueTextClass } from "@/lib/utils/metricQuality";
import { cn } from "@/lib/utils/cn";
import { METRIC_LABELS, formatShareDelta, formatShareMetric, isLowerBetter } from "@/lib/share/metricsDisplay";
import type { ShareMetricKey } from "@/lib/share/types";

interface PublicMetricCellProps {
  metricKey: ShareMetricKey;
  value: number;
  /** Média congelada do conjunto; ausente = card neutro, sem cor nem delta. */
  average?: number | null;
  subtitle?: string;
  currency: string | null;
  className?: string;
}

/**
 * Card de métrica da página pública — mesma leitura visual do VideoMetricCell
 * do modal (superfície tonal por qualidade vs. média, valor colorido, delta à
 * direita, "vs. média" abaixo), porém sem sparkline, tooltip ou dependência
 * autenticada. Sem média (Visibilidade, ou share legado) cai em neutro, que é
 * exatamente o comportamento do modal.
 */
export function PublicMetricCell({ metricKey, value, average, subtitle, currency, className }: PublicMetricCellProps) {
  const canCompare = average != null && Number.isFinite(average) && average !== 0;
  const tone = canCompare ? getMetricQualityToneByAverage(value, average as number, isLowerBetter(metricKey)) : null;
  const delta = canCompare ? formatShareDelta(value, average) : null;

  return (
    <div className={cn("min-w-0 rounded border pb-2", tone ? getMetricCardSurfaceClass(tone) : "border-border bg-background", className)}>
      <div className="mb-1.5 flex items-center justify-between gap-2 border-b border-border p-1.5 text-2xs text-muted-foreground">
        <span className="min-w-0 truncate">{METRIC_LABELS[metricKey]}</span>
        {subtitle ? <span className="min-w-0 truncate text-right">{subtitle}</span> : null}
      </div>

      <div className="flex items-center justify-between gap-2 px-1.5">
        <div className="min-w-0 flex flex-col items-start text-left">
          <div className={cn("text-sm font-semibold leading-tight", tone && getMetricValueTextClass(tone))}>
            {formatShareMetric(metricKey, value, currency)}
          </div>
          {canCompare ? (
            <div className="mt-0.5 text-2xs leading-tight text-muted-foreground">
              vs. {formatShareMetric(metricKey, average as number, currency)}
            </div>
          ) : null}
        </div>
        {delta ? <div className="shrink-0 text-2xs text-muted-foreground">{delta}</div> : null}
      </div>
    </div>
  );
}
