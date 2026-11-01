"use client";

import { StatePanel } from "@/components/common/States";
import { useTranslations } from "next-intl";
import { IconTrendingDown, IconArrowsShuffle, IconChevronRight } from "@tabler/icons-react";
import type { DriverAttribution, AdAttribution, DriverKey } from "@/lib/metrics/diagnostics";
import { getDriverLabel } from "@/lib/metrics/diagnostics";
import { getMetricValueTextClass, getMetricTrendTone } from "@/lib/utils/metricQuality";
import { useFormatCurrency, formatLocaleRatioPercent } from "@/lib/utils/currency";
import type { RankingsItem } from "@/lib/api/schemas";
import { AdPlayArea } from "@/components/common/AdPlayArea";

interface DriverAdListProps {
  attribution: DriverAttribution;
  driver: DriverKey;
  driverDirection: "up" | "down"; // "up" = cost went up (bad), "down" = cost went down (good)
  adMap: Map<string, RankingsItem>;
  onOpenAd: (ad: RankingsItem) => void;
}

function AdAttributionRow({
  attr,
  driverDirection,
  adMap,
  onOpenAd,
  formatCurrency,
}: {
  attr: AdAttribution;
  driverDirection: "up" | "down";
  adMap: Map<string, RankingsItem>;
  onOpenAd: (ad: RankingsItem) => void;
  formatCurrency: (v: number) => string;
}) {
  const t = useTranslations("metrics.chart");
  const ad = adMap.get(attr.adKey);
  const adName = attr.adName ?? ad?.ad_name ?? attr.adKey.slice(0, 32);
  const isNegative = attr.contributionCurrency < 0;
  // Tone: positive contribution when we expected an up-direction = bad (destructive)
  const tone = attr.contributionCurrency === 0
    ? "muted-foreground"
    : getMetricTrendTone(isNegative ? -0.2 : 0.2, driverDirection === "up");

  const spendPct = formatLocaleRatioPercent(attr.spendShareLast);

  const open = () => { if (ad) onOpenAd(ad); };

  // Não pode ser <button>: AdPlayArea renderiza um <button> de play interno (nested buttons
  // quebram a hidratação). Espelha o padrão de ActionPlanRow (div clicável + onPlayClick).
  return (
    <div
      role="button"
      tabIndex={ad ? 0 : -1}
      aria-disabled={!ad}
      className={`w-full flex items-center gap-3 p-2.5 rounded-md border border-border bg-card transition-all duration-150 text-left ${
        ad ? "cursor-pointer hover:bg-card-hover hover:border-primary" : "opacity-60"
      }`}
      onClick={open}
      onKeyDown={(e) => { if (ad && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(); } }}
    >
      {ad && (
        <AdPlayArea
          ad={ad as any}
          aspectRatio="1:1"
          size={36}
          className="rounded-sm flex-shrink-0"
          onPlayClick={open}
        />
      )}

      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-foreground truncate">{adName}</div>
        <div className="flex items-center gap-2 mt-0.5">
          {/* Tag: rate vs mix */}
          <span className={`flex items-center gap-0.5 text-2xs px-1.5 py-0.5 rounded-sm font-medium ${
            attr.tag === "rate"
              ? "bg-destructive-10 text-destructive border border-destructive-20"
              : "bg-warning-10 text-warning border border-warning-20"
          }`}>
            {attr.tag === "rate"
              ? <><IconTrendingDown className="h-2.5 w-2.5" /> {t("worsened")}</>
              : <><IconArrowsShuffle className="h-2.5 w-2.5" /> {t("gainedBudget")}</>
            }
          </span>
        </div>
      </div>

      {/* Spend share badge */}
      <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
        <span className="text-2xs text-muted-foreground">{t("budget")}</span>
        <span className="text-xs font-semibold text-foreground">{spendPct}</span>
      </div>

      {/* R$ contribution */}
      <div className="flex flex-col items-end gap-0.5 flex-shrink-0 min-w-[52px]">
        <span className="text-2xs text-muted-foreground">{t("impact")}</span>
        <span className={`text-xs font-bold ${getMetricValueTextClass(tone)}`}>
          {attr.contributionCurrency > 0 ? "+" : ""}{formatCurrency(attr.contributionCurrency)}
        </span>
      </div>

      {ad && <IconChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
    </div>
  );
}

export function DriverAdList({ attribution, driver, driverDirection, adMap, onOpenAd }: DriverAdListProps) {
  const t = useTranslations("metrics.chart");
  const formatCurrency = useFormatCurrency();
  const { rankedAds, remainder, sameSignTotal } = attribution;
  const driverLabel = getDriverLabel(driver);

  const totalAds = rankedAds.length + (remainder?.count ?? 0);
  // Coverage must divide by the gross same-sign total, not the net driver contribution —
  // otherwise offsetting ads push it past 100% ("201% do impacto"). ≤1 by construction.
  const coveredPct =
    sameSignTotal > 0
      ? Math.min(1, rankedAds.reduce((s, a) => s + Math.abs(a.contributionCurrency), 0) / sameSignTotal)
      : null;

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">
          {t("whichAds", { driver: driverLabel })}
        </span>
        {coveredPct != null && (
          <span className="text-2xs text-muted-foreground">
            {t("coverage", { shown: rankedAds.length, total: totalAds, pct: (coveredPct * 100).toFixed(0) })}
          </span>
        )}
      </div>

      {/* Ad rows */}
      {rankedAds.length === 0 && (
        <StatePanel kind="empty" layout="inline" density="compact" message={t("noSignificantAds")} />
      )}
      {rankedAds.map((attr) => (
        <AdAttributionRow
          key={attr.adKey}
          attr={attr}
          driverDirection={driverDirection}
          adMap={adMap}
          onOpenAd={onOpenAd}
          formatCurrency={formatCurrency}
        />
      ))}

      {/* Collapsed remainder */}
      {remainder && remainder.count > 0 && (
        // design-system-exception: ad-hoc-dashed-border - resumo dos ads recolhidos, lido como "os que não aparecem"
        <div className="flex items-center justify-between px-2.5 py-1.5 rounded-md border border-dashed border-border text-2xs text-muted-foreground">
          <span>{t("otherAds", { count: remainder.count })}</span>
          <span className="font-medium">
            {t("remainderSummary", {
              share: formatLocaleRatioPercent(remainder.spendShare),
              impact: `${remainder.contributionCurrency > 0 ? "+" : ""}${formatCurrency(remainder.contributionCurrency)}`,
            })}
          </span>
        </div>
      )}

      {/* Attribution note */}
      <div className="text-2xs text-muted-foreground mt-1 leading-relaxed">
        {t("attributionNote")}
      </div>
    </div>
  );
}
