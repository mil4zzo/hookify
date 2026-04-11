"use client";

import { IconArrowBigDownLinesFilled, IconArrowBigUpLinesFilled, IconCurrencyDollar } from "@tabler/icons-react";
import { AdPlayArea } from "@/components/common/AdPlayArea";
import { StandardCard } from "@/components/common/StandardCard";
import { useFormatCurrency } from "@/lib/utils/currency";
import { isLowerBetterMetric } from "@/lib/metrics";
import type { ExplorerKanbanMetricKey, ExplorerListCardData } from "@/lib/explorer/types";
import { cn } from "@/lib/utils/cn";

interface ExplorerAdSidebarCardProps {
  ad: ExplorerListCardData;
  metricLabel: string;
  metricKey: ExplorerKanbanMetricKey;
  selected?: boolean;
  averageValue?: number | null;
  onClick?: () => void;
}

export function ExplorerAdSidebarCard({ ad, metricLabel, metricKey, selected = false, averageValue, onClick }: ExplorerAdSidebarCardProps) {
  const formatCurrency = useFormatCurrency();
  const spend = Number(ad.spend || 0);
  const metricValue = ad.metricValue != null && Number.isFinite(ad.metricValue) ? ad.metricValue : null;
  const isLowerBetter = isLowerBetterMetric(metricKey);
  const isBetter = averageValue != null && metricValue != null ? (isLowerBetter ? metricValue < averageValue : metricValue > averageValue) : false;
  const diffFromAverage =
    averageValue != null && averageValue > 0 && metricValue != null ? Math.abs(((metricValue - averageValue) / averageValue) * 100) : null;

  return (
    <StandardCard
      variant="default"
      padding="none"
      interactive
      onClick={onClick}
      className={cn(
        "group relative w-full min-w-0 max-w-full overflow-hidden rounded-md border p-3 pr-3 transition-opacity duration-420",
        selected ? "border-primary bg-card-hover opacity-100" : "opacity-50"
      )}
    >
      <div className="relative flex min-w-0 items-stretch gap-2 sm:gap-3">
        <AdPlayArea ad={ad} aspectRatio="3:4" size="w-12 aspect-[3/4]" className="rounded-sm" disablePlay />

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-w-0 space-y-0.5">
            <p className="truncate text-base font-medium text-white" title={ad.ad_name || undefined}>
              {ad.ad_name || "Sem nome"}
            </p>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <IconCurrencyDollar className="h-5 w-5 flex-shrink-0 rounded-full bg-secondary p-1" stroke={2} aria-hidden />
              <span>{formatCurrency(spend)}</span>
            </div>
          </div>

          <div className="mt-2 border-t border-border pt-2">
            <div className="flex min-w-0 w-full flex-row items-center justify-between gap-2">
              <span className="text-sm font-medium text-muted-foreground">{metricLabel}</span>
              <div className="flex min-w-0 flex-shrink-0 items-center gap-2">
                <span className="text-lg font-bold leading-none text-white sm:text-lg">{ad.metricFormatted}</span>
                {diffFromAverage != null && metricKey !== "spend" ? (
                  <div className={cn("inline-flex items-center gap-0.5 text-xs font-semibold", isBetter ? "text-success" : "text-destructive")}>
                    {isLowerBetter ? (
                      isBetter ? <IconArrowBigDownLinesFilled className="h-3 w-3" /> : <IconArrowBigUpLinesFilled className="h-3 w-3" />
                    ) : isBetter ? (
                      <IconArrowBigUpLinesFilled className="h-3 w-3" />
                    ) : (
                      <IconArrowBigDownLinesFilled className="h-3 w-3" />
                    )}
                    <span>{`${diffFromAverage.toFixed(0)}%`}</span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </StandardCard>
  );
}
