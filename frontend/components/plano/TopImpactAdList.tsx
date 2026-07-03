"use client";

import { IconTrendingUp, IconTrendingDown, IconArrowsShuffle } from "@tabler/icons-react";
import { AdPlayArea } from "@/components/common/AdPlayArea";
import { AdStatusIcon } from "@/components/common/AdStatusIcon";
import { getMetricValueTextClass } from "@/lib/utils/metricQuality";
import { useFormatCurrency, formatLocaleRatioPercent } from "@/lib/utils/currency";
import type { RankingsItem } from "@/lib/api/schemas";
import type { DayComparisonTopAd } from "@/lib/hooks/usePackDayComparison";

// "verba realocada" (não "ganhou verba"): com o mix centrado na média do pack, um
// aumento de custo mix-dominado pode vir de PERDER share num ad barato, não só de ganhar.
const TAG_META = {
  piorou:            { label: "piorou",          className: "bg-destructive-10 text-destructive border border-destructive-20", Icon: IconTrendingUp },
  "verba realocada": { label: "verba realocada", className: "bg-warning-10 text-warning border border-warning-20",             Icon: IconArrowsShuffle },
  melhorou:          { label: "melhorou",        className: "bg-success-10 text-success border border-success-20",             Icon: IconTrendingDown },
} as const;

// Shared column widths so the fixed header lines up with the data rows.
const COL_SPEND = "w-16";
const COL_IMPACT = "w-20";
const ROW_PAD = "px-4 py-3";

function Row({
  item,
  rank,
  onOpenAd,
  formatCurrency,
}: {
  item: DayComparisonTopAd;
  rank: number;
  onOpenAd: (ad: RankingsItem) => void;
  formatCurrency: (v: number) => string;
}) {
  const ad = item.ad;
  const tag = TAG_META[item.tag];
  const TagIcon = tag.Icon;
  const open = () => { if (ad) onOpenAd(ad); };

  // Não pode ser <button>: AdPlayArea tem um <button> de play interno (nested buttons quebram
  // a hidratação). Espelha o padrão do DriverAdList (div clicável + onPlayClick).
  return (
    <div
      role="button"
      tabIndex={ad ? 0 : -1}
      aria-disabled={!ad}
      className={`flex w-full items-center gap-2.5 border-b border-border-60 text-left transition-all duration-150 last:border-b-0 ${ROW_PAD} ${
        ad ? "cursor-pointer hover:bg-card-hover" : "opacity-60"
      }`}
      onClick={open}
      onKeyDown={(e) => { if (ad && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(); } }}
    >
      <span className="w-5 flex-shrink-0 text-left text-[12px] font-semibold tabular-nums text-muted-foreground">
        {rank}
      </span>

      {ad ? (
        <AdPlayArea ad={ad as unknown} aspectRatio="1:1" size={36} className="rounded flex-shrink-0" onPlayClick={open} />
      ) : (
        <div className="h-9 w-9 flex-shrink-0 rounded bg-muted-30" />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {ad && <AdStatusIcon status={(ad as { effective_status?: string }).effective_status} />}
          <span className="truncate text-xs font-medium text-foreground">{item.adName}</span>
        </div>
        <span className={`mt-0.5 inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium ${tag.className}`}>
          <TagIcon className="h-2.5 w-2.5" /> {tag.label}
        </span>
      </div>

      <span className={`${COL_SPEND} flex-shrink-0 text-right text-xs font-semibold tabular-nums text-foreground`}>
        {formatLocaleRatioPercent(item.spendShareLast)}
      </span>

      <span className={`${COL_IMPACT} flex-shrink-0 text-right text-xs font-bold tabular-nums ${getMetricValueTextClass(item.tone)}`}>
        {item.totalContributionCurrency > 0 ? "+" : ""}
        {formatCurrency(item.totalContributionCurrency)}
      </span>
    </div>
  );
}

export function TopImpactAdList({
  ads,
  onOpenAd,
}: {
  ads: DayComparisonTopAd[];
  onOpenAd: (ad: RankingsItem) => void;
}) {
  const formatCurrency = useFormatCurrency();

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Title */}
      <div className="flex flex-shrink-0 items-baseline justify-between px-4 pt-4">
        <span className="text-lg font-bold text-foreground">Maior impacto</span>
      </div>

      {/* Table: fixed column header + scrollable rows */}
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="flex flex-shrink-0 items-center gap-2.5 border-b border-border px-4 pb-3 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
          <span className="w-5 flex-shrink-0 text-left">#</span>
          <span className="min-w-0 flex-1">Ad</span>
          <span className={`${COL_SPEND} flex-shrink-0 text-right`}>Spend</span>
          <span className={`${COL_IMPACT} flex-shrink-0 text-right`}>Impacto</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {ads.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              Nenhum anúncio com impacto significativo no período.
            </div>
          ) : (
            <div className="flex flex-col">
              {ads.map((item, i) => (
                <Row key={item.adKey} item={item} rank={i + 1} onOpenAd={onOpenAd} formatCurrency={formatCurrency} />
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
