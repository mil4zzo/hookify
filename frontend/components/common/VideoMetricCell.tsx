"use client";

import type { ReactNode } from "react";
import { SparklineBars } from "@/components/common/SparklineBars";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getMetricCardSurfaceClass, getMetricQualityToneByAverage, getMetricSeriesTrendPct, getMetricTrendTone, getMetricValueTextClass } from "@/lib/utils/metricQuality";

interface VideoMetricCellProps {
  label: string;
  value: ReactNode;
  valueClassName?: string;
  deltaDisplay?: ReactNode;
  subtitle?: ReactNode;
  subtitleInLabelRow?: boolean;
  averageDisplay?: ReactNode;
  averageTooltip?: string;
  series?: Array<number | null | undefined>;
  inverse?: boolean;
  formatFn?: (n: number) => string;
  valueRaw?: number | null;
  avgRaw?: number | null;
  better?: "higher" | "lower";
  packAverage?: number | null;
  colorMode?: "series" | "per-bar";
  disableSeriesFallback?: boolean;
}

function getMetricValueTone({ valueRaw, avgRaw, better, series, inverse, disableSeriesFallback = false }: Pick<VideoMetricCellProps, "valueRaw" | "avgRaw" | "better" | "series" | "inverse" | "disableSeriesFallback">) {
  if (valueRaw != null && avgRaw != null && better && !Number.isNaN(valueRaw) && !Number.isNaN(avgRaw) && Number.isFinite(valueRaw) && Number.isFinite(avgRaw) && avgRaw !== 0) {
    return getMetricQualityToneByAverage(valueRaw, avgRaw, better === "lower");
  }

  if (!disableSeriesFallback && series && series.length > 0) {
    return getMetricTrendTone(getMetricSeriesTrendPct(series), inverse ?? false);
  }

  return null;
}

export function VideoMetricCell({ label, value, valueClassName, deltaDisplay, subtitle, subtitleInLabelRow = false, averageDisplay, averageTooltip, series, inverse, formatFn, valueRaw, avgRaw, better, packAverage, colorMode, disableSeriesFallback = false }: VideoMetricCellProps) {
  const hasSeries = Boolean(series && series.length > 0 && series.some((item) => item != null && !Number.isNaN(item as number)));
  const tone = getMetricValueTone({ valueRaw, avgRaw, better, series, inverse, disableSeriesFallback });
  const qualitySurfaceClass = getMetricCardSurfaceClass(tone ?? "muted-foreground");
  const qualityValueClass = tone ? getMetricValueTextClass(tone) : "";
  const hasHeaderMeta = Boolean(subtitleInLabelRow && subtitle);

  return (
    <div className={`min-w-0 rounded border pb-2 transition-colors transition-shadow ${qualitySurfaceClass}`}>
      <div className={`mb-2 flex gap-2 border-b border-border p-2 text-[10px] text-muted-foreground ${hasHeaderMeta ? "items-center justify-between" : "flex-col"}`}>
        <span className={hasHeaderMeta ? "min-w-0 truncate" : ""}>{label}</span>
        {hasHeaderMeta ? <div className="min-w-0 flex flex-col items-end text-right leading-tight">{subtitleInLabelRow && subtitle ? <span className="truncate">{subtitle}</span> : null}</div> : null}
        {!subtitleInLabelRow && subtitle ? <span className="mt-0.5">{subtitle}</span> : null}
      </div>

      <div className="flex items-center justify-between gap-3 px-2">
        <div className="min-w-0 flex flex-col items-start text-left">
          <div className={`${valueClassName ?? "text-md"} font-semibold leading-tight ${qualityValueClass}`.trim()}>{value}</div>
          {averageDisplay ? (
            <div className="mt-0.5 text-left text-[10px] leading-tight text-muted-foreground">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-block cursor-help text-muted-foreground">{`vs. ${averageDisplay}`}</span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{averageTooltip ?? `${label} medio`}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          ) : null}
        </div>

        {deltaDisplay ? <div className="shrink-0 text-xs text-muted-foreground">{deltaDisplay}</div> : null}
      </div>

      {hasSeries ? (
        <div className="mt-2 w-full px-2">
          <SparklineBars series={series ?? []} size="small" className="h-5 w-full" valueFormatter={formatFn} inverseColors={inverse} packAverage={packAverage} colorMode={colorMode} />
        </div>
      ) : null}
    </div>
  );
}
