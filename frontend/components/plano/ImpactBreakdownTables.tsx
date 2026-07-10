"use client";

import { useState, useEffect, useMemo } from "react";
import { IconArrowsShuffle, IconInfoCircle, IconChevronUp, IconChevronDown } from "@tabler/icons-react";
import { StandardCard } from "@/components/common/StandardCard";
import { AdPlayArea } from "@/components/common/AdPlayArea";
import { AdStatusIcon } from "@/components/common/AdStatusIcon";
import { MetricDeltaBadge } from "@/components/common/MetricDeltaBadge";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import {
  getMetricValueTextClass,
  getMetricQualityToneByAverage,
  type MetricQualityTone,
} from "@/lib/utils/metricQuality";
import { useFormatCurrency, formatLocaleRatioPercent } from "@/lib/utils/currency";
import type { DriverKey } from "@/lib/metrics/diagnostics";
import type { RankingsItem } from "@/lib/api/schemas";
import type {
  DayComparisonImpactView,
  DayComparisonImpactAd,
  DayComparisonDriverCard,
} from "@/lib/hooks/usePackDayComparison";

// Column sizing shared by the header row and every data row so they line up.
// Weight-based (flex grow over basis 0) so the table breathes with the viewport;
// min-widths keep cells from crushing before the horizontal scroll kicks in.
// No rank column: sorting reorders rows freely, so a fixed "#" would be misleading —
// order itself (top → bottom) is the ranking signal. Every column is centered except
// Ad (the only text-forward column, which reads better left-aligned).
const COL_IMPACT = "w-[104px] flex-shrink-0";
const COL_AD = "flex-[4] min-w-[180px]";
const COL_SPEND = "flex-[2] min-w-[88px]";
const COL_SPEND_PCT = "flex-[1.4] min-w-[84px]";
const COL_METRIC = "flex-[2] min-w-[104px]";
const COL_METRIC_PCT = "flex-[1.4] min-w-[84px]";
const ROW_PAD = "px-4 py-2.5";

type SortKey = "ad" | "impacto" | "spend" | "spendPct" | "metrica" | "metricaPct";
type SortDir = "asc" | "desc";

// Tone for a currency-signed value: positive raised the cost (bad), negative lowered
// it (good) — same convention as the headline/driver cards, applied per-cell here.
function toneFor(v: number): MetricQualityTone {
  if (Math.abs(v) < 1e-9) return "muted-foreground";
  return v > 0 ? "destructive" : "success";
}

function signedCurrency(v: number, formatCurrency: (n: number) => string): string {
  return `${v > 0 ? "+" : ""}${formatCurrency(v)}`;
}

// Vertical rule between columns — full row height regardless of the row's own
// align-items (self-stretch overrides it), so it reads as a cell boundary rather than
// a short centered tick.
function ColDivider() {
  return <span aria-hidden="true" className="w-px flex-shrink-0 self-stretch bg-border-60" />;
}

function PillButton({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-150 ${
        selected
          ? "bg-primary text-primary-foreground"
          : "bg-muted-30 text-muted-foreground hover:bg-muted-50 hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

// Clickable column header. Cycle: default direction → inverted → back to the table's
// default order (|impacto| desc). Chevron marks the active sort.
function SortHeader({
  label,
  width,
  align = "center",
  sortKey,
  sort,
  onSort,
  extra,
}: {
  label: string;
  width: string;
  align?: "left" | "center";
  sortKey: SortKey;
  sort: { key: SortKey; dir: SortDir } | null;
  onSort: (key: SortKey) => void;
  extra?: React.ReactNode;
}) {
  const active = sort?.key === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={`${width} flex items-center gap-1 transition-colors duration-150 hover:text-foreground ${
        align === "center" ? "justify-center text-center" : "text-left"
      } ${active ? "text-foreground" : ""}`}
    >
      {label}
      {extra}
      {active && (sort!.dir === "asc" ? <IconChevronUp className="h-3.5 w-3.5" /> : <IconChevronDown className="h-3.5 w-3.5" />)}
    </button>
  );
}

// Value cell for Spend / Métrica: current value on top (evident), previous below
// (dimmed) — the day-over-day pair as a compact vertical stack. Value tone answers
// "level vs the pack today" (Métrica) or is neutral allocation (Spend). The signed
// change lives in its own adjacent column (DeltaCell).
function ValueStackCell({
  valueText,
  valueTone,
  prevText,
  tooltip,
  width,
}: {
  valueText: string;
  valueTone: MetricQualityTone | "foreground";
  prevText: string | null;
  tooltip: string | null;
  width: string;
}) {
  const valueCls = valueTone === "foreground" ? "text-foreground" : getMetricValueTextClass(valueTone);
  const inner = (
    <span className="inline-flex cursor-default flex-col items-center leading-tight">
      <span className={`text-sm font-semibold tabular-nums ${valueCls}`}>{valueText}</span>
      {prevText != null && <span className="text-2xs tabular-nums text-muted-foreground">{prevText}</span>}
    </span>
  );

  return (
    <div className={`${width} flex justify-center`}>
      {tooltip ? (
        <Tooltip>
          <TooltipTrigger asChild>{inner}</TooltipTrigger>
          <TooltipContent side="top" className="text-xs tabular-nums">
            {tooltip}
          </TooltipContent>
        </Tooltip>
      ) : (
        inner
      )}
    </div>
  );
}

function toneBgClass(tone: MetricQualityTone): string {
  switch (tone) {
    case "success":     return "bg-success";
    case "destructive": return "bg-destructive";
    default:            return "bg-muted-foreground";
  }
}

// Paired comparison bars for Spend: two slim rounded tracks, hoje's share on top
// (tone-colored, slightly thicker — the actual, leads the eye) and ontem's share below
// (neutral gray, thinner — the reference), each filled independently to its own length.
// Reading top-to-bottom mirrors the text above/below it (current value bold, previous
// value dim): bold text → colored bar → gray bar → dim text, a small gradient of visual
// weight from "now" to "then". Both bars share one scale (maxShare, the largest share
// in the visible table) so lengths stay comparable down the column.
function SpendShareBar({
  prevShare,
  lastShare,
  maxShare,
  tone,
  width,
  formatShare,
}: {
  prevShare: number | null;
  lastShare: number | null;
  maxShare: number;
  tone: MetricQualityTone;
  width: string;
  formatShare: (v: number) => string;
}) {
  const pct = (v: number | null) =>
    v == null || maxShare <= 0 ? 0 : Math.min(100, Math.max(v > 1e-9 ? 3 : 0, (v / maxShare) * 100));
  const prevPct = pct(prevShare);
  const lastPct = pct(lastShare);
  const valueText = lastShare != null ? formatShare(lastShare) : "—";
  const prevText = prevShare != null ? formatShare(prevShare) : null;
  const fillCls = toneBgClass(tone);

  return (
    <div className={`${width} flex justify-center`}>
      <div className="flex w-full flex-col items-center gap-1">
        <span className="text-sm font-semibold tabular-nums text-foreground">{valueText}</span>
        <div className="flex w-full max-w-[60px] flex-col items-stretch gap-[3px]">
          <span className="relative h-[5px] overflow-hidden rounded-full bg-muted-10">
            {lastShare != null && (
              <span
                className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ${fillCls}`}
                style={{ width: `${lastPct}%` }}
              />
            )}
          </span>
          <span className="relative h-[3px] overflow-hidden rounded-full bg-muted-10">
            {prevShare != null && (
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-muted-foreground/50 transition-[width] duration-300"
                style={{ width: `${prevPct}%` }}
              />
            )}
          </span>
        </div>
        {prevText != null && <span className="text-2xs tabular-nums text-muted-foreground">{prevText}</span>}
      </div>
    </div>
  );
}

// Dedicated change column: the day-over-day variation as a colored delta badge (its
// caret gives direction; tone = cost impact of that lever). Δ% for currency-scale
// metrics, percentage-points for proportions (spend share, funnel rates) — never a raw
// current/previous ratio, which explodes on a near-zero baseline (0.1%→7% = "+7000%").
function DeltaCell({
  delta,
  deltaFormat,
  deltaTone,
  width,
}: {
  delta: number | null;
  deltaFormat: "percent" | "currency" | "points";
  deltaTone: MetricQualityTone;
  width: string;
}) {
  return (
    <div className={`${width} flex justify-center`}>
      {delta != null ? (
        <MetricDeltaBadge value={delta} tone={deltaTone} format={deltaFormat} size="sm" />
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      )}
    </div>
  );
}

// Diverging composition bar: how the ad's net impact splits across parts (drivers in
// "Resultado" mode; verba × desempenho with a driver selected). Zero axis at the
// center — cost-lowering parts stack LEFTWARD in success green, cost-raising parts
// RIGHTWARD in destructive red. Segments within a side step down in opacity so
// adjacent parts stay distinguishable without introducing categorical colors. All
// rows share one scale (maxSide) so bar length is comparable across the whole column,
// even though it's only ever shown one row at a time (inside the Impacto tooltip).
function CompositionBarVisual({ parts, maxSide }: { parts: DayComparisonImpactAd["parts"]; maxSide: number }) {
  const EPS = 1e-9;
  const neg = parts.filter((p) => p.currency < -EPS).sort((a, b) => Math.abs(b.currency) - Math.abs(a.currency));
  const pos = parts.filter((p) => p.currency > EPS).sort((a, b) => Math.abs(b.currency) - Math.abs(a.currency));
  const SEG_OPACITY = [1, 0.65, 0.45, 0.3, 0.2];

  if ((neg.length === 0 && pos.length === 0) || maxSide <= 0) return null;

  const pct = (c: number) => `${Math.max(1.5, (Math.abs(c) / maxSide) * 100)}%`;

  return (
    <span className="flex h-2.5 w-full items-stretch">
      {/* Cost-lowering side (green), stacking toward the center axis */}
      <span className="flex flex-1 items-stretch justify-end gap-px">
        {neg.map((p, i) => (
          <span
            key={p.key}
            className={i === neg.length - 1 ? "rounded-l-full bg-success" : "bg-success"}
            style={{ width: pct(p.currency), opacity: SEG_OPACITY[Math.min(i, SEG_OPACITY.length - 1)] }}
          />
        ))}
      </span>
      {/* Zero axis */}
      <span className="w-px flex-shrink-0 bg-border" />
      {/* Cost-raising side (red) */}
      <span className="flex flex-1 items-stretch justify-start gap-px">
        {pos.map((p, i) => (
          <span
            key={p.key}
            className={i === pos.length - 1 ? "rounded-r-full bg-destructive" : "bg-destructive"}
            style={{ width: pct(p.currency), opacity: SEG_OPACITY[Math.min(i, SEG_OPACITY.length - 1)] }}
          />
        ))}
      </span>
    </span>
  );
}

// Impacto tooltip content: the bar (visual) + the itemized breakdown (written) — the
// breakdown of the net R$ value, one hover away instead of its own always-on column.
function CompositionBreakdown({
  parts,
  maxSide,
  formatCurrency,
}: {
  parts: DayComparisonImpactAd["parts"];
  maxSide: number;
  formatCurrency: (v: number) => string;
}) {
  const sorted = [...parts].sort((a, b) => Math.abs(b.currency) - Math.abs(a.currency));
  const zeroText = formatCurrency(0);

  return (
    <div className="flex w-[196px] flex-col gap-2">
      <CompositionBarVisual parts={parts} maxSide={maxSide} />
      <div className="flex flex-col gap-0.5">
        {sorted.map((p) => {
          // A tiny part that rounds to R$0,00 at display precision would otherwise read
          // as "+R$0,00"/"-R$0,00" (misleading sign on nothing) → show an em dash, muted.
          const isZero = formatCurrency(Math.abs(p.currency)) === zeroText;
          return (
            <div key={p.key} className="flex items-center justify-between gap-4 tabular-nums">
              <span className="text-muted-foreground">{p.label}</span>
              <span className={isZero ? "text-muted-foreground" : getMetricValueTextClass(toneFor(p.currency))}>
                {isZero ? "—" : signedCurrency(p.currency, formatCurrency)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ImpactRow({
  item,
  index,
  onOpenAd,
  metricFormat,
  packMetricToday,
  metricInverse,
  maxCompSide,
  maxSpendShare,
  formatMetricAbs,
  formatCurrency,
}: {
  item: DayComparisonImpactAd;
  index: number;
  onOpenAd: (ad: RankingsItem) => void;
  metricFormat: "percent" | "points";
  packMetricToday: number | null;
  metricInverse: boolean;
  maxCompSide: number;
  maxSpendShare: number;
  // Formats an absolute value of the selected metric (currency for cpm/costs, percent
  // for the funnel rates).
  formatMetricAbs: (v: number | null) => string;
  formatCurrency: (v: number) => string;
}) {
  const ad = item.ad;
  const open = () => { if (ad) onOpenAd(ad); };

  // MÉTRICA: current over previous; today's value colored vs the pack's value today (the
  // "stock" that explains the mix color — an ad can improve day-over-day and still run
  // above average). Change badge tone = desempenhoCurrency.
  const metricValueTone: MetricQualityTone | "foreground" =
    item.metricLast != null && packMetricToday != null
      ? getMetricQualityToneByAverage(item.metricLast, packMetricToday, metricInverse)
      : "foreground";
  const metricPrevText = item.metricPrev != null ? formatMetricAbs(item.metricPrev) : null;
  const metricTooltip = packMetricToday != null ? `média do conjunto hoje: ${formatMetricAbs(packMetricToday)}` : null;

  return (
    <div
      role="button"
      tabIndex={ad ? 0 : -1}
      aria-disabled={!ad}
      className={`animate-in fade-in slide-in-from-bottom-2 flex w-full items-center gap-2.5 border-b border-border-60 text-left transition-colors duration-150 last:border-b-0 ${ROW_PAD} ${
        ad ? "cursor-pointer hover:bg-card-hover" : "opacity-60"
      }`}
      style={{ animationDelay: `${index * 30}ms`, animationDuration: "400ms", animationFillMode: "backwards" }}
      onClick={open}
      onKeyDown={(e) => { if (ad && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(); } }}
    >
      {/* IMPACTO: the ranking quantity — solid signed badge, +/- prefix (not a caret —
          this is the sortable magnitude itself, direction is the sign, not a trend
          arrow). Leads the row (the biggest consequence, first), compact. Hover reveals
          its composition — the same bar+breakdown that used to be its own always-on
          column. */}
      <span className={`${COL_IMPACT} flex justify-center`}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex cursor-default">
              <MetricDeltaBadge
                value={item.total}
                tone={toneFor(item.total)}
                format="currency"
                size="md"
                signStyle="sign"
              />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            <CompositionBreakdown parts={item.parts} maxSide={maxCompSide} formatCurrency={formatCurrency} />
          </TooltipContent>
        </Tooltip>
      </span>

      <ColDivider />

      <div className={`${COL_AD} flex items-center gap-2.5`}>
        {ad ? (
          <AdPlayArea ad={ad as unknown} aspectRatio="1:1" size={32} className="flex-shrink-0 rounded" onPlayClick={open} />
        ) : (
          <div className="h-8 w-8 flex-shrink-0 rounded bg-muted-30" />
        )}
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {ad && <AdStatusIcon status={(ad as { effective_status?: string }).effective_status} />}
          <span className="truncate text-sm font-medium text-foreground">{item.adName}</span>
          {item.opposingLevers && (
            <IconArrowsShuffle
              className="h-3 w-3 flex-shrink-0 text-attention"
              aria-label="Verba e desempenho puxaram em direções opostas"
            />
          )}
        </div>
      </div>

      <ColDivider />

      <SpendShareBar
        prevShare={item.spendSharePrev}
        lastShare={item.spendShareLast}
        maxShare={maxSpendShare}
        tone={toneFor(item.verbaCurrency)}
        width={COL_SPEND}
        formatShare={formatLocaleRatioPercent}
      />

      <ColDivider />

      <DeltaCell
        delta={item.spendShareDeltaPp}
        deltaFormat="points"
        deltaTone={toneFor(item.verbaCurrency)}
        width={COL_SPEND_PCT}
      />

      <ColDivider />

      <ValueStackCell
        valueText={formatMetricAbs(item.metricLast)}
        valueTone={metricValueTone}
        prevText={metricPrevText}
        tooltip={metricTooltip}
        width={COL_METRIC}
      />

      <ColDivider />

      <DeltaCell
        delta={item.metricDeltaPct}
        deltaFormat={metricFormat}
        deltaTone={toneFor(item.desempenhoCurrency)}
        width={COL_METRIC_PCT}
      />
    </div>
  );
}

export function ImpactBreakdownTables({
  view,
  driverCards,
  selectedDriver,
  onSelectDriver,
  onOpenAd,
}: {
  view: DayComparisonImpactView | null;
  driverCards: DayComparisonDriverCard[];
  selectedDriver: DriverKey | null;
  onSelectDriver: (driver: DriverKey | null) => void;
  onOpenAd: (ad: RankingsItem) => void;
}) {
  const formatCurrency = useFormatCurrency();

  // Column sort: null = default order from the hook (|impacto| desc, "top movers").
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null);

  // Column meanings change with the metric filter — a stale sort would silently apply
  // to different quantities, so reset when the filter changes.
  useEffect(() => {
    setSort(null);
  }, [view?.driver]);

  // Sorts the VISIBLE items only (the 85% cutoff already decided what's shown) — the
  // sorted value is the column's primary number. Nulls go last regardless of direction.
  const items = view?.movers.items;
  const sortedItems = useMemo(() => {
    const base = items ?? [];
    if (!sort) return base;
    const get = (it: DayComparisonImpactAd): number | string | null => {
      switch (sort.key) {
        case "ad":         return it.adName.toLowerCase();
        case "impacto":    return it.total;
        case "spend":      return it.spendShareLast;
        case "spendPct":   return it.spendShareDeltaPp;
        case "metrica":    return it.metricLast;
        case "metricaPct": return it.metricDeltaPct;
      }
    };
    return [...base].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "string" && typeof vb === "string") {
        return sort.dir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      return sort.dir === "asc" ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
  }, [items, sort]);

  // Shared scale for the composition bars: the largest single-side gross (Σ of
  // same-sign parts) across visible rows — bar lengths stay comparable down the column.
  const maxCompSide = useMemo(() => {
    let max = 0;
    for (const it of items ?? []) {
      const negSum = it.parts.reduce((s, p) => s + (p.currency < 0 ? -p.currency : 0), 0);
      const posSum = it.parts.reduce((s, p) => s + (p.currency > 0 ? p.currency : 0), 0);
      max = Math.max(max, negSum, posSum);
    }
    return max;
  }, [items]);

  // Shared scale for the Spend bullet-bars: the largest single share (prev or last)
  // across visible rows — same rationale as maxCompSide.
  const maxSpendShare = useMemo(() => {
    let max = 0;
    for (const it of items ?? []) {
      if (it.spendSharePrev != null) max = Math.max(max, it.spendSharePrev);
      if (it.spendShareLast != null) max = Math.max(max, it.spendShareLast);
    }
    return max;
  }, [items]);

  const toggleSort = (key: SortKey) => {
    const defaultDir: SortDir = key === "ad" ? "asc" : "desc";
    setSort((cur) => {
      if (cur?.key !== key) return { key, dir: defaultDir };
      if (cur.dir === defaultDir) return { key, dir: defaultDir === "asc" ? "desc" : "asc" };
      return null; // third click restores the default "top movers" order
    });
  };

  const pills = (
    <div className="flex flex-wrap items-center gap-1.5">
      <PillButton label="Resultado" selected={selectedDriver == null} onClick={() => onSelectDriver(null)} />
      {driverCards.map((d) => (
        <PillButton key={d.key} label={d.label} selected={selectedDriver === d.key} onClick={() => onSelectDriver(d.key)} />
      ))}
    </div>
  );

  // The default filter (view.driver === null) is the cross-driver total; name it
  // "Resultado (CPR)" so it never reads as if CPR were a selectable driver.
  const metricLabel = view ? (view.driver == null ? `Resultado (${view.label})` : view.label) : null;

  // Title (left) + metric pills (right) live OUTSIDE the card — the card is purely the
  // table, which gives it a cleaner hierarchy: context above, data below. When a driver
  // is filtered, the metric name lights up in primary — the same accent as the selected
  // card's ring and the active pill, threading the three selection cues together.
  const headerBar = (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <span className="text-lg font-bold text-foreground">
        {metricLabel ? (
          <>
            Maior impacto no{" "}
            <span className={selectedDriver != null ? "text-primary transition-colors duration-300" : "transition-colors duration-300"}>
              {metricLabel}
            </span>
          </>
        ) : (
          "Impacto por anúncio"
        )}
      </span>
      {pills}
    </div>
  );

  if (!view) {
    return (
      <div className="flex flex-col gap-3">
        {headerBar}
        <StandardCard padding="none" className="overflow-hidden">
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            Sem dados suficientes para detalhar por anúncio.
          </div>
        </StandardCard>
      </div>
    );
  }

  const isCrossDriver = view.driver == null;
  const isCpm = view.driver === "cpm";
  // Métrica delta: relative % for currency-scale metrics (cpm, CPR/CPMQL no modo
  // Resultado); percentage-points for the funnel-rate proportions.
  const metricFormat: "percent" | "points" = isCrossDriver || isCpm ? "percent" : "points";
  // Costs (cpm, CPR/CPMQL) are lower-better; funnel rates are higher-better.
  const metricInverse = isCrossDriver || isCpm;
  const metricColLabel = isCrossDriver ? `${view.label} do ad` : view.label;

  // Header tooltip: "Impacto" is the ad's attributed contribution to the PACK's cost —
  // without this, the column reads as the ad's own cost. Also hints at the per-row
  // composition tooltip (bar+breakdown), which otherwise has no visible affordance.
  const impactTooltip = isCrossDriver
    ? `Quanto este anúncio puxou o ${view.label} do conjunto pra cima (+) ou pra baixo (−) vs ontem. Não é o custo do anúncio. Passe o mouse no valor de cada linha para ver a composição.`
    : `Quanto a mudança de ${view.label} deste anúncio puxou o custo do conjunto pra cima (+) ou pra baixo (−) vs ontem, em R$. Não é o custo do anúncio. Passe o mouse no valor de cada linha para ver a composição.`;

  // Absolute-value formatter for the Métrica column + tooltips.
  const formatMetricAbs = (v: number | null) =>
    v == null ? "—" : isCrossDriver || isCpm ? formatCurrency(v) : formatLocaleRatioPercent(v);

  const { movers } = view;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex flex-col gap-3">
        {headerBar}

        {/* Single "top movers" table: both directions mixed, ranked by |impacto| —
            direction is carried by each row's signed/colored Impacto. Spend/Métrica read
            current-over-previous (stacked) with the signed change in its own column;
            hovering Impacto reveals its composition breakdown. Rows stagger in when the
            metric filter changes (keyed container below). Centered except Ad. */}
        <StandardCard padding="none" className="overflow-hidden">
          <div className="flex flex-col overflow-x-auto">
            <div className="min-w-[760px]">
              {movers.items.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  Nenhum anúncio mexeu de forma relevante no {metricLabel} hoje.
                </div>
              ) : (
                <>
                  {/* Tinted band separates the header from body rows at a glance. */}
                  <div className={`flex items-center gap-2.5 border-b border-border bg-muted-30 text-sm font-medium text-muted-foreground ${ROW_PAD}`}>
                    <SortHeader
                      label="Impacto"
                      width={COL_IMPACT}
                      sortKey="impacto"
                      sort={sort}
                      onSort={toggleSort}
                      extra={
                        /* "Impacto" é a contribuição atribuída ao custo do CONJUNTO — não o
                           custo do anúncio. Sem isto a coluna é lida como o custo do ad. */
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex cursor-default" onClick={(e) => e.stopPropagation()}>
                              <IconInfoCircle className="h-3.5 w-3.5" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-[240px] text-xs">
                            {impactTooltip}
                          </TooltipContent>
                        </Tooltip>
                      }
                    />
                    <ColDivider />
                    <SortHeader label="Ad" width={COL_AD} align="left" sortKey="ad" sort={sort} onSort={toggleSort} />
                    <ColDivider />
                    <SortHeader label="Spend" width={COL_SPEND} sortKey="spend" sort={sort} onSort={toggleSort} />
                    <ColDivider />
                    <SortHeader label="Var." width={COL_SPEND_PCT} sortKey="spendPct" sort={sort} onSort={toggleSort} />
                    <ColDivider />
                    <SortHeader label={metricColLabel} width={COL_METRIC} sortKey="metrica" sort={sort} onSort={toggleSort} />
                    <ColDivider />
                    <SortHeader label="Var." width={COL_METRIC_PCT} sortKey="metricaPct" sort={sort} onSort={toggleSort} />
                  </div>

                  {/* Keyed by the active filter so rows remount and stagger in on change. */}
                  <div key={view.driver ?? "__resultado"} className="flex flex-col">
                    {sortedItems.map((item, i) => (
                      <ImpactRow
                        key={item.adKey}
                        item={item}
                        index={i}
                        onOpenAd={onOpenAd}
                        metricFormat={metricFormat}
                        packMetricToday={view.packMetricToday}
                        metricInverse={metricInverse}
                        maxCompSide={maxCompSide}
                        maxSpendShare={maxSpendShare}
                        formatMetricAbs={formatMetricAbs}
                        formatCurrency={formatCurrency}
                      />
                    ))}
                  </div>

                  <p className="px-4 py-3 text-xs leading-relaxed text-muted-foreground">
                    {movers.coveragePct != null && (
                      <>
                        Estes {movers.items.length} anúncio{movers.items.length === 1 ? "" : "s"} explicam ~
                        {Math.round(movers.coveragePct * 100)}% do movimento (piora e melhora).{" "}
                      </>
                    )}
                    {movers.remainderCount > 0 && (
                      <>
                        +{movers.remainderCount} outro{movers.remainderCount === 1 ? "" : "s"}:{" "}
                        {signedCurrency(movers.remainderCurrency, formatCurrency)} líquido.
                      </>
                    )}
                  </p>
                </>
              )}
            </div>
          </div>
        </StandardCard>
      </div>
    </TooltipProvider>
  );
}
