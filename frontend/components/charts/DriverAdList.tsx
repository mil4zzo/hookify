"use client";

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
          className="rounded flex-shrink-0"
          onPlayClick={open}
        />
      )}

      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-foreground truncate">{adName}</div>
        <div className="flex items-center gap-2 mt-0.5">
          {/* Tag: rate vs mix */}
          <span className={`flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded font-medium ${
            attr.tag === "rate"
              ? "bg-destructive-10 text-destructive border border-destructive-20"
              : "bg-warning-10 text-warning border border-warning-20"
          }`}>
            {attr.tag === "rate"
              ? <><IconTrendingDown className="h-2.5 w-2.5" /> piorou</>
              : <><IconArrowsShuffle className="h-2.5 w-2.5" /> ganhou verba</>
            }
          </span>
        </div>
      </div>

      {/* Spend share badge */}
      <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
        <span className="text-[10px] text-muted-foreground">verba</span>
        <span className="text-xs font-semibold text-foreground">{spendPct}</span>
      </div>

      {/* R$ contribution */}
      <div className="flex flex-col items-end gap-0.5 flex-shrink-0 min-w-[52px]">
        <span className="text-[10px] text-muted-foreground">impacto</span>
        <span className={`text-xs font-bold ${getMetricValueTextClass(tone)}`}>
          {attr.contributionCurrency > 0 ? "+" : ""}{formatCurrency(attr.contributionCurrency)}
        </span>
      </div>

      {ad && <IconChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
    </div>
  );
}

export function DriverAdList({ attribution, driver, driverDirection, adMap, onOpenAd }: DriverAdListProps) {
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
          {driverLabel} — quais ads causaram?
        </span>
        {coveredPct != null && (
          <span className="text-[10px] text-muted-foreground">
            {rankedAds.length} de {totalAds} ads • {(coveredPct * 100).toFixed(0)}% do efeito
          </span>
        )}
      </div>

      {/* Ad rows */}
      {rankedAds.length === 0 && (
        <div className="text-xs text-muted-foreground py-2">Nenhum ad encontrado com impacto significativo.</div>
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
        <div className="flex items-center justify-between px-2.5 py-1.5 rounded-md border border-dashed border-border text-[11px] text-muted-foreground">
          <span>+{remainder.count} outros ads</span>
          <span className="font-medium">
            {formatLocaleRatioPercent(remainder.spendShare)} da verba
            {" · "}
            {remainder.contributionCurrency > 0 ? "+" : ""}{formatCurrency(remainder.contributionCurrency)} impacto
          </span>
        </div>
      )}

      {/* Attribution note */}
      <div className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
        Impacto estimado por anúncio. Comparação: último dia vs. anterior —
        conversões têm janela de atribuição (dias recentes podem subnotificar).
      </div>
    </div>
  );
}
